// Parser del corpus: convierte el markdown de docs/faqs-corpus.md en chunks
// listos para indexar. Función pura — no toca red, disco ni Supabase.
//
// Reglas de parseo:
//   1. Intro     = desde el H1 hasta el primer `---`. section "Introducción", faq_id "intro".
//   2. H2 sin H3 = chunk único con todo el bloque (ej. glosario). faq_id "glossary".
//   3. H2 con H3 = un chunk por H3. El faq_id sale del comentario HTML
//                  `<!-- faq_id: X | source_url: Y -->` que sigue al heading.
//   4. source_url === "TODO" o vacío se trata como undefined.
//
// Los literales "intro" y "glossary" son intencionales: la columna faq_id es
// NOT NULL en la DB y ON CONFLICT (faq_id) no dedupea NULLs entre sí — con
// null el upsert duplicaría el chunk en cada re-ingest.

export interface Chunk {
  faq_id: string;
  content: string;
  metadata: {
    source: string;
    source_url?: string;
    section: string;
    heading: string;
    chunk_index: number;
  };
}

interface ChunkBase {
  source: string;
  source_url?: string;
}

const H2_REGEX = /^## (.+?)$/gm;
const H3_FAQ_REGEX =
  /^### (.+?)\r?\n<!--\s*faq_id:\s*([\w-]+)\s*(?:\|\s*source_url:\s*(\S+))?\s*-->/gm;
const INTRO_REGEX = /^([\s\S]*?)\n---\s*$/m;

export function chunkByFaq(md: string, base: ChunkBase): Chunk[] {
  const chunks: Chunk[] = [];
  const baseUrl = normalizeUrl(base.source_url);
  let index = 0;

  const push = (
    chunk: Omit<Chunk, 'metadata'> & { metadata: Omit<Chunk['metadata'], 'chunk_index'> }
  ) => {
    chunks.push({
      ...chunk,
      metadata: { ...chunk.metadata, chunk_index: index++ }
    });
  };

  // 1. Intro
  const introMatch = md.match(INTRO_REGEX);
  if (introMatch) {
    const introText = introMatch[1]?.trim() ?? '';
    const h1 = introText.match(/^# (.+)$/m);
    if (h1 && introText.length > 0) {
      push({
        faq_id: 'intro',
        content: introText,
        metadata: {
          source: base.source,
          source_url: baseUrl,
          section: 'Introducción',
          heading: h1[1]!.trim()
        }
      });
    }
  }

  // 2. Iterar por H2s
  const h2Matches = [...md.matchAll(H2_REGEX)];
  for (let i = 0; i < h2Matches.length; i++) {
    const h2 = h2Matches[i]!;
    const h2Title = h2[1]!.trim();
    const h2Start = h2.index!;
    const h2End = h2Matches[i + 1]?.index ?? md.length;
    const h2Block = md.slice(h2Start, h2End);

    const h3Matches = [...h2Block.matchAll(H3_FAQ_REGEX)];

    if (h3Matches.length === 0) {
      // H2 sin H3 → chunk único (glosario)
      push({
        faq_id: 'glossary',
        content: trimTrailingDivider(h2Block),
        metadata: {
          source: base.source,
          source_url: baseUrl,
          section: h2Title,
          heading: h2Title
        }
      });
      continue;
    }

    for (let j = 0; j < h3Matches.length; j++) {
      const h3 = h3Matches[j]!;
      const h3Heading = h3[1]!.trim();
      const faqId = h3[2]!.trim();
      const sourceUrl = normalizeUrl(h3[3]?.trim());
      const h3Start = h3.index!;
      const h3End = h3Matches[j + 1]?.index ?? h2Block.length;
      const h3Content = trimTrailingDivider(h2Block.slice(h3Start, h3End));

      push({
        faq_id: faqId,
        content: h3Content,
        metadata: {
          source: base.source,
          source_url: sourceUrl ?? baseUrl,
          section: h2Title,
          heading: h3Heading
        }
      });
    }
  }

  return chunks;
}

function trimTrailingDivider(text: string): string {
  return text.replace(/\n---\s*$/, '').trim();
}

function normalizeUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const clean = url.trim();
  if (clean === '' || clean === 'TODO') return undefined;
  return clean;
}
