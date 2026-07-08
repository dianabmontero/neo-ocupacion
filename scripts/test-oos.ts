// Batch test de todas las preguntas out-of-scope del eval-set.yaml contra el
// bot real. Para cada pregunta muestra: top score de retrieval, en qué gate
// se detuvo, decisión final. Al final produce resumen por categoría + resumen
// por gate + detalle de fallos.
//
// A diferencia de test-ask.ts (3 preguntas hardcodeadas), este es el batch test
// de robustez del bot. Se enfoca en OOS + adversariales.
//
// ⚠️ Costo típico: ~$0.01 por corrida (20 embeds + eventuales llamadas al LLM
// si alguna pregunta pasa gate 1).
//
// Uso: yarn tsx scripts/test-oos.ts

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { ask, AskResult } from '../lib/ask.js';

interface OOSQuestion {
  id: string;
  category: string;
  question: string;
  expected_behavior: string;
  notes?: string;
}

interface EvalFile {
  out_of_scope: OOSQuestion[];
}

type Gate = 'gate-1' | 'gate-2' | 'answered' | 'error';

interface Row {
  q: OOSQuestion;
  passed: boolean;
  gate: Gate;
  topScore: number | null;
  elapsed: number;
  answer: string | null;
}

const path = new URL('../docs/eval-set.yaml', import.meta.url);
const raw = await readFile(fileURLToPath(path), 'utf-8');
const evalSet = parse(raw) as EvalFile;

console.log(`\nCorriendo ${evalSet.out_of_scope.length} preguntas out-of-scope.`);
console.log('Esperado: needs_handoff=true en todas.\n');

const rows: Row[] = [];

for (const q of evalSet.out_of_scope) {
  const label = `  ${q.id.padEnd(14)} [${q.category.padEnd(18)}]`;
  process.stdout.write(label + ' ');
  const start = Date.now();

  try {
    const result: AskResult = await ask(q.question);
    const elapsed = Date.now() - start;
    const gate: Gate = !result.needs_handoff
      ? 'answered'
      : result.reason === 'below_threshold'
      ? 'gate-1'
      : 'gate-2';
    const passed = result.needs_handoff;
    const mark = passed ? '✅' : '❌';
    const scoreStr = result.top_similarity !== null ? result.top_similarity.toFixed(3) : '(none)';
    console.log(`${mark} handoff=${result.needs_handoff}  top=${scoreStr}  ${gate.padEnd(8)}  ${elapsed}ms`);
    rows.push({
      q,
      passed,
      gate,
      topScore: result.top_similarity,
      elapsed,
      answer: result.answer
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    rows.push({ q, passed: false, gate: 'error', topScore: null, elapsed, answer: null });
  }
}

// Resumen por categoría
console.log('\n' + '═'.repeat(80));
console.log('RESUMEN por categoría');
console.log('═'.repeat(80));

const byCategory = new Map<string, { total: number; passed: number }>();
for (const r of rows) {
  const stat = byCategory.get(r.q.category) ?? { total: 0, passed: 0 };
  stat.total++;
  if (r.passed) stat.passed++;
  byCategory.set(r.q.category, stat);
}

for (const [category, stats] of byCategory) {
  const mark = stats.passed === stats.total ? '✅' : '⚠ ';
  console.log(`  ${mark} ${category.padEnd(20)}  ${stats.passed}/${stats.total}`);
}

// Resumen por gate
console.log('\n' + '═'.repeat(80));
console.log('RESUMEN por gate (dónde se detuvieron)');
console.log('═'.repeat(80));

const gateCounts: Record<Gate, number> = { 'gate-1': 0, 'gate-2': 0, answered: 0, error: 0 };
for (const r of rows) gateCounts[r.gate]++;

console.log(`  ✅ Rechazadas por gate 1 (sin costo LLM):   ${gateCounts['gate-1']}/${rows.length}`);
console.log(`  ✅ Rechazadas por gate 2 (LLM correcto):     ${gateCounts['gate-2']}/${rows.length}`);
console.log(`  ❌ Respondidas (FALLO):                      ${gateCounts.answered}/${rows.length}`);
if (gateCounts.error > 0) {
  console.log(`  ⚠  Errores:                                  ${gateCounts.error}/${rows.length}`);
}

const totalPassed = rows.filter(r => r.passed).length;
console.log('─'.repeat(80));
console.log(`TOTAL: ${totalPassed}/${rows.length} preguntas correctamente rechazadas`);

// Fallos con detalle
const failed = rows.filter(r => !r.passed && r.gate !== 'error');
if (failed.length > 0) {
  console.log('\n' + '═'.repeat(80));
  console.log('⚠ CASOS DONDE EL BOT RESPONDIÓ (debería haber hecho handoff)');
  console.log('═'.repeat(80));
  for (const f of failed) {
    console.log(`\n  ${f.q.id} [${f.q.category}]  (top ${f.topScore?.toFixed(3) ?? '(none)'})`);
    console.log(`    Pregunta: ${f.q.question}`);
    if (f.answer) {
      const truncated = f.answer.length > 200 ? f.answer.substring(0, 200) + '…' : f.answer;
      console.log(`    Respondió: ${truncated}`);
    }
  }
}

// Estadísticas de latencia
const avgLatency = Math.round(rows.reduce((sum, r) => sum + r.elapsed, 0) / rows.length);
const g1Latency = rows.filter(r => r.gate === 'gate-1').map(r => r.elapsed);
const g2Latency = rows.filter(r => r.gate === 'gate-2').map(r => r.elapsed);
const avgG1 = g1Latency.length ? Math.round(g1Latency.reduce((a, b) => a + b) / g1Latency.length) : null;
const avgG2 = g2Latency.length ? Math.round(g2Latency.reduce((a, b) => a + b) / g2Latency.length) : null;

console.log('\n' + '═'.repeat(80));
console.log('LATENCIAS');
console.log('═'.repeat(80));
console.log(`  Promedio global:              ${avgLatency}ms`);
if (avgG1 !== null) console.log(`  Promedio gate 1 (sin LLM):    ${avgG1}ms`);
if (avgG2 !== null) console.log(`  Promedio gate 2 (con LLM):    ${avgG2}ms`);
