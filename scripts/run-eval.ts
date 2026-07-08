// Corre docs/eval-set.yaml contra el pipeline y reporta hit@3, keypoints,
// citation, handoff. Métricas objetivo: hit@3 >= 80%, keypoints >= 90%,
// citation 100% in-scope, handoff 100% en out-of-scope.
//
// Uso: `yarn eval`

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { ask } from '../lib/ask.js';

interface EvalQuestion {
  id: string;
  question: string;
  expected_faq_id: string;
  expected_key_points: string[];
  notes?: string;
}

interface EvalOOS {
  id: string;
  question: string;
  expected_behavior: 'handoff';
  notes?: string;
}

interface EvalFile {
  questions: EvalQuestion[];
  out_of_scope: EvalOOS[];
}

async function main() {
  const path = new URL('../docs/eval-set.yaml', import.meta.url);
  const raw = await readFile(fileURLToPath(path), 'utf-8');
  const evalSet = parse(raw) as EvalFile;

  console.log(`In-scope: ${evalSet.questions.length} · OOS: ${evalSet.out_of_scope.length}\n`);

  // TODO: iterar, correr `ask`, medir hit@3 / keypoints / citation / handoff.
  // Imprimir tabla + resumen.
  throw new Error('run-eval not implemented yet.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
