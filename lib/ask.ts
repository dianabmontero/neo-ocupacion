// Pipeline principal: retrieval + gate de similarity + gate de LLM.
// Portón de dos etapas: gate 1 (umbral duro de similarity) rechaza queries
// sin match cercano; gate 2 (structured output del LLM) declara needs_handoff
// cuando el contexto no responde. Cualquiera de los dos dispara handoff a humano.

import { embed } from '../lib/embed.js';
import { generateAnswer, LlmAnswer, RetrievedChunk } from '../lib/llm.js';
import { getSupabase } from '../lib/supabase.js';

export interface AskResult extends LlmAnswer {
  chunks: RetrievedChunk[];
  top_similarity: number | null;
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be numeric, got "${raw}".`);
  }
  return value;
}

const TOP_K = numericEnv('TOP_K', 3);
const SIMILARITY_THRESHOLD = numericEnv('SIMILARITY_THRESHOLD', 0.35);
if (TOP_K <= 0) throw new Error('TOP_K must be greater than zero.');

export async function ask(question: string): Promise<AskResult> {
  const supabase = getSupabase();

  // 1. Embed la pregunta
  const queryEmbedding = await embed(question);

  // 2. Retrieval
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_count: TOP_K
  });
  if (error) throw error;
  const chunks: RetrievedChunk[] = (data ?? []) as RetrievedChunk[];
  const topSimilarity = chunks[0]?.similarity ?? null;

  // 3. Gate 1 — umbral duro
  if (chunks.length === 0 || (topSimilarity ?? 0) < SIMILARITY_THRESHOLD) {
    const result: AskResult = {
      needs_handoff: true,
      answer: null,
      cited_faq_id: null,
      reason: 'below_threshold',
      chunks,
      top_similarity: topSimilarity
    };
    await Promise.all([
      logHandoff(question, topSimilarity, 'below_threshold', chunks),
      logQuery(question, topSimilarity, result)
    ]);
    return result;
  }

  // 4. Gate 2 — structured output del LLM
  let llmAnswer: LlmAnswer;
  try {
    llmAnswer = await generateAnswer(question, chunks);
  } catch (err) {
    const failed: LlmAnswer = {
      needs_handoff: true,
      answer: null,
      cited_faq_id: null,
      reason: 'error'
    };
    await Promise.all([
      logHandoff(question, topSimilarity, 'error', chunks),
      logQuery(question, topSimilarity, failed)
    ]);
    throw err;
  }

  // 5. Logging
  await Promise.all([
    ...(llmAnswer.needs_handoff
      ? [logHandoff(question, topSimilarity, 'llm_declared', chunks)]
      : []),
    logQuery(question, topSimilarity, llmAnswer)
  ]);

  return { ...llmAnswer, chunks, top_similarity: topSimilarity };
}

async function logEvent(table: string, row: Record<string, unknown>) {
  const { error } = await getSupabase().from(table).insert(row);
  if (error) console.error(`${table} insert failed:`, error);
}

function logHandoff(
  question: string,
  topSimilarity: number | null,
  reason: string,
  chunks: RetrievedChunk[]
) {
  return logEvent('handoff_events', {
    question,
    top_similarity: topSimilarity,
    reason,
    retrieved_faq_ids: chunks.map(c => c.faq_id)
  });
}

function logQuery(
  question: string,
  topSimilarity: number | null,
  answer: LlmAnswer
) {
  return logEvent('query_events', {
    question,
    cited_faq_id: answer.cited_faq_id,
    top_similarity: topSimilarity,
    needs_handoff: answer.needs_handoff
  });
}
