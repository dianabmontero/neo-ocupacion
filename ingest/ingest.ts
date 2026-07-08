// Ingesta del corpus: parsea docs/faqs-corpus.md, trocea por FAQ (### + faq_id
// del comentario HTML), embebe cada chunk, y hace upsert a Supabase.
//
// Uso: `yarn ingest`
// Volver a correr con el mismo corpus es idempotente (upsert por faq_id).

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { chunkByFaq } from '../lib/chunk.js';
import { embed } from '../lib/embed.js';
import { getSupabase } from '../lib/supabase.js';

async function main() {
  const corpusPath = new URL('../docs/faqs-corpus.md', import.meta.url);
  const raw = await readFile(fileURLToPath(corpusPath), 'utf-8');
  const { data: frontmatter, content } = matter(raw);

  const chunks = chunkByFaq(content, {
    source: (frontmatter.source as string) ?? 'faqs-corpus.md',
    source_url: frontmatter.source_url as string | undefined
  });

  console.log(`Chunks a indexar: ${chunks.length}`);

  const supabase = getSupabase();
  for (const chunk of chunks) {
    const embedding = await embed(chunk.content);
    const { error } = await supabase
      .from('documents')
      .upsert(
        {
          faq_id: chunk.faq_id,
          content: chunk.content,
          metadata: chunk.metadata,
          embedding
        },
        { onConflict: 'faq_id' }
      );
    if (error) throw error;
    console.log(`  ✔ ${chunk.faq_id}`);
  }

  console.log('Ingesta completa.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
