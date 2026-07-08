// Dry-run del chunker: lee el corpus, lo trocea, y muestra los chunks
// en una tabla. NO llama OpenAI ni Supabase — verificás el parser sin gastar API.
//
// Uso: yarn tsx scripts/dry-run-chunks.ts

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { chunkByFaq } from '../lib/chunk.js';

const corpusPath = new URL('../docs/faqs-corpus.md', import.meta.url);
const raw = await readFile(fileURLToPath(corpusPath), 'utf-8');
const { data: frontmatter, content } = matter(raw);

const chunks = chunkByFaq(content, {
  source: (frontmatter.source as string) ?? 'faqs-corpus.md',
  source_url: frontmatter.source_url as string | undefined
});

const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…');
const pad = (s: string, n: number) => truncate(s, n).padEnd(n);

console.log(`\nChunks generados: ${chunks.length}\n`);
console.log(`${pad('#', 4)} ${pad('section', 26)} ${pad('faq_id', 40)} ${pad('heading', 55)}`);
console.log('─'.repeat(4 + 1 + 26 + 1 + 40 + 1 + 55));

for (const c of chunks) {
  const idx = String(c.metadata.chunk_index).padStart(3);
  const section = pad(c.metadata.section, 26);
  const faqId = pad(c.faq_id, 40);
  const heading = pad(c.metadata.heading, 55);
  console.log(`${idx}  ${section} ${faqId} ${heading}`);
}

console.log('');
const specialIds = new Set(['intro', 'glossary']);
const specialCount = chunks.filter(c => specialIds.has(c.faq_id)).length;
const faqCount = chunks.length - specialCount;
console.log(`✔ ${chunks.length} chunks · ${faqCount} FAQs · ${specialCount} especiales (intro/glossary)`);

const sizes = chunks.map(c => c.content.length);
const total = sizes.reduce((a, b) => a + b, 0);
const avg = Math.round(total / sizes.length);
console.log(`  Tamaño de content: min=${Math.min(...sizes)}  avg=${avg}  max=${Math.max(...sizes)} chars`);
