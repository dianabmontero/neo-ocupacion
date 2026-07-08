// Smoke test para lib/embed.ts
// Corre: yarn tsx scripts/test-embed.ts
//
// Éxito esperado: imprime "Vector length: 1536" (OpenAI) o 768 (Ollama).
// Errores frecuentes:
//   - "Missing OPENAI_API_KEY in env"  -> no hay .env o falta la key
//   - "OpenAI embed failed: 401"       -> la key es inválida
//   - "OpenAI embed failed: 429"       -> la cuenta no tiene billing activo

import 'dotenv/config';
import { embed } from '../lib/embed.js';

const sample = 'hola mundo, esto es una prueba';

console.log(`Provider: ${process.env.EMBED_PROVIDER ?? 'openai (default)'}`);
console.log(`Model:    ${process.env.EMBED_MODEL ?? '(default por proveedor)'}`);
console.log(`Texto:    "${sample}"`);
console.log('');

const start = Date.now();
const vector = await embed(sample);
const elapsed = Date.now() - start;

console.log(`✔ Vector length: ${vector.length}`);
console.log(`✔ Primeros 5 números: [${vector.slice(0, 5).map(n => n.toFixed(4)).join(', ')}, ...]`);
console.log(`✔ Latencia: ${elapsed}ms`);
