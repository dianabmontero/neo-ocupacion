-- neo-support-bot — schema base
-- Correr en Supabase (SQL Editor) o vía psql contra el proyecto.

create extension if not exists vector;

-- Corpus indexado
create table if not exists documents (
  id bigserial primary key,
  faq_id text not null unique,       -- ID estable extraído del corpus (el glosario usa 'glossary'). NOT NULL + UNIQUE habilitan el upsert(onConflict:faq_id).
  content text not null,
  metadata jsonb not null,           -- {source, source_url, section, chunk_index}
  embedding vector(1536) not null,   -- OpenAI text-embedding-3-small = 1536 dims
  created_at timestamptz default now()
);

-- Índice vectorial: hnsw funciona bien desde la primera fila (a diferencia de ivfflat, que necesita datos para entrenarse).
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

-- Retrieval principal
create or replace function match_documents(
  query_embedding vector(1536),
  match_count int default 3
)
returns table (
  id bigint,
  faq_id text,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable as $$
  select
    id,
    faq_id,
    content,
    metadata,
    1 - (embedding <=> query_embedding) as similarity
  from documents
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Logging de handoffs: cada fila es un caso donde el bot no supo responder
-- y es candidato a convertirse en FAQ nueva del corpus.
create table if not exists handoff_events (
  id bigserial primary key,
  created_at timestamptz default now(),
  question text not null,
  top_similarity float,
  reason text,                       -- 'below_threshold' | 'llm_declared' | 'error'
  retrieved_faq_ids text[],
  resolved_faq_id text               -- se completa cuando se agrega FAQ nueva
);

-- Logging general de queries (métricas + feedback)
create table if not exists query_events (
  id bigserial primary key,
  created_at timestamptz default now(),
  question text not null,
  cited_faq_id text,
  top_similarity float,
  needs_handoff boolean not null,
  feedback smallint,                 -- 1 = 👍, -1 = 👎, null = sin feedback
  feedback_note text
);
