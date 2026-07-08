// Smoke test para lib/llm.ts
// Corre: yarn tsx scripts/test-llm.ts

import 'dotenv/config';
import { generateAnswer, RetrievedChunk } from '../lib/llm.js';

const fakeChunks: RetrievedChunk[] = [
  {
    faq_id: 'faq-precios-mezcla-ocupacion',
    similarity: 0.85,
    content:
      'El precio del pase mezcla la ocupación real del momento con la ocupación esperada para esa hora. ' +
      'Si la sede está más vacía de lo esperado, el usuario paga un precio intermedio. ' +
      'Si está igual o más llena de lo esperado, paga el precio real. ' +
      'En los últimos 15 minutos de cada hora, el precio empieza a acercarse al esperado de la hora siguiente.',
    metadata: { source: 'faqs-corpus.md' }
  }
];

console.log(`Model:    ${process.env.OPENAI_LLM_MODEL ?? process.env.CLAUDE_MODEL ?? '(default)'}\n`);

console.log('=== Test 1: pregunta cubierta por el contexto ===');
const r1 = await generateAnswer(
  'Un cliente me pregunta por qué el precio del pase parece raro cuando la sede está vacía. Qué le digo?',
  fakeChunks
);
console.log(JSON.stringify(r1, null, 2));

console.log('\n=== Test 2: pregunta NO cubierta por el contexto ===');
const r2 = await generateAnswer(
  'Cómo doy de baja a un empleado que dejó de trabajar en la sede?',
  fakeChunks
);
console.log(JSON.stringify(r2, null, 2));
