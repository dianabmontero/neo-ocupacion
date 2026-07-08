// Batch test de todas las preguntas in-scope del eval-set.yaml contra el bot
// real. Chequea las 4 métricas de calidad para cada pregunta:
//
//   - hit@3     : ¿el faq_id esperado está en los top-3 chunks recuperados?
//   - citation  : ¿el bot cita el faq_id esperado?
//   - keypoints : % de expected_key_points que aparecen en la respuesta
//   - answered  : needs_handoff === false (no derivó por error)
//
// Al final resume por métrica y muestra detalle de fallos.
//
// ⚠️ Costo típico: ~$0.02 por corrida (10 embeds + 10 llamadas al LLM).
//
// Uso: yarn tsx scripts/test-inscope.ts

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { ask, AskResult } from '../lib/ask.js';

interface InScopeQuestion {
  id: string;
  question: string;
  expected_faq_id: string;
  expected_key_points: string[];
  notes?: string;
}

interface EvalFile {
  questions: InScopeQuestion[];
}

interface Row {
  q: InScopeQuestion;
  hitAt3: boolean;
  citation: boolean;
  keypointsHit: number;
  keypointsTotal: number;
  answered: boolean;
  topScore: number | null;
  elapsed: number;
  answer: string | null;
  citedFaqId: string | null;
}

const path = new URL('../docs/eval-set.yaml', import.meta.url);
const raw = await readFile(fileURLToPath(path), 'utf-8');
const evalSet = parse(raw) as EvalFile;

console.log(`\nCorriendo ${evalSet.questions.length} preguntas in-scope.`);
console.log('Esperado: needs_handoff=false, cita correcta, key_points presentes.\n');

const rows: Row[] = [];

for (const q of evalSet.questions) {
  process.stdout.write(`  ${q.id.padEnd(10)} `);
  const start = Date.now();

  try {
    const result: AskResult = await ask(q.question);
    const elapsed = Date.now() - start;

    const hitAt3 = result.chunks.some(c => c.faq_id === q.expected_faq_id);
    // Comparación tolerante: el LLM a veces agrega puntuación o corchetes al
    // faq_id. Normalizamos ambos lados quitando lo que no sea alfanumérico o
    // guión, para que "faq-abc." o "faq-abc】" se traten como "faq-abc".
    const normalizeId = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const citation = normalizeId(result.cited_faq_id ?? '') === normalizeId(q.expected_faq_id);
    const answered = !result.needs_handoff;
    const answerLower = (result.answer ?? '').toLowerCase();
    const keypointsHit = q.expected_key_points.filter(kp =>
      answerLower.includes(kp.toLowerCase())
    ).length;
    const keypointsTotal = q.expected_key_points.length;

    const allPass = hitAt3 && citation && answered && keypointsHit === keypointsTotal;
    const mark = allPass ? '✅' : '⚠ ';
    const scoreStr = result.top_similarity !== null ? result.top_similarity.toFixed(3) : '(none)';
    console.log(
      `${mark} hit@3=${hitAt3 ? '✓' : '✗'}  cite=${citation ? '✓' : '✗'}  kp=${keypointsHit}/${keypointsTotal}  answered=${answered ? '✓' : '✗'}  top=${scoreStr}  ${elapsed}ms`
    );

    rows.push({
      q,
      hitAt3,
      citation,
      keypointsHit,
      keypointsTotal,
      answered,
      topScore: result.top_similarity,
      elapsed,
      answer: result.answer,
      citedFaqId: result.cited_faq_id
    });
  } catch (err) {
    console.log(`❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Resumen por métrica
console.log('\n' + '═'.repeat(80));
console.log('RESUMEN por métrica');
console.log('═'.repeat(80));

const total = rows.length;
const hitAt3Pass = rows.filter(r => r.hitAt3).length;
const citationPass = rows.filter(r => r.citation).length;
const answeredPass = rows.filter(r => r.answered).length;
const keypointsSum = rows.reduce((sum, r) => sum + r.keypointsHit / r.keypointsTotal, 0);
const keypointsPct = total > 0 ? (keypointsSum / total) * 100 : 0;

const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
console.log(`  hit@3       : ${hitAt3Pass}/${total}    (${pct(hitAt3Pass)})   target ≥ 80%`);
console.log(`  citation    : ${citationPass}/${total}    (${pct(citationPass)})   target = 100%`);
console.log(`  answered    : ${answeredPass}/${total}    (${pct(answeredPass)})   target = 100%`);
console.log(`  keypoints   : ${keypointsPct.toFixed(0)}%          target ≥ 90%`);

// Fallos con detalle
const failed = rows.filter(
  r => !r.hitAt3 || !r.citation || !r.answered || r.keypointsHit < r.keypointsTotal
);
if (failed.length > 0) {
  console.log('\n' + '═'.repeat(80));
  console.log('⚠ CASOS CON ALGÚN CRITERIO FALLADO');
  console.log('═'.repeat(80));
  for (const f of failed) {
    console.log(`\n  ${f.q.id}`);
    console.log(`    Pregunta:     ${f.q.question}`);
    console.log(`    Esperado FAQ: ${f.q.expected_faq_id}`);
    console.log(`    hit@3:        ${f.hitAt3 ? '✓' : '✗ (no en top-3)'}`);
    console.log(
      `    Citation:     ${f.citation ? '✓' : `✗ (citó '${f.citedFaqId ?? 'ninguno'}' vs esperado '${f.q.expected_faq_id}')`}`
    );
    console.log(`    Keypoints:    ${f.keypointsHit}/${f.keypointsTotal}`);
    if (f.keypointsHit < f.keypointsTotal) {
      const missing = f.q.expected_key_points.filter(
        kp => !(f.answer ?? '').toLowerCase().includes(kp.toLowerCase())
      );
      console.log(`      Faltantes:  ${missing.join(', ')}`);
    }
    if (!f.answered) {
      console.log(`    Answered:     ✗ (needs_handoff=true — el bot NO respondió)`);
    }
  }
}

// Latencia
const avgLatency = total > 0 ? Math.round(rows.reduce((sum, r) => sum + r.elapsed, 0) / total) : 0;
console.log('\n' + '═'.repeat(80));
console.log(`LATENCIA promedio: ${avgLatency}ms`);
