// Interfaz de embeddings enchufable.
// Cambiar EMBED_PROVIDER en .env implica re-indexar todo el corpus,
// porque cada modelo produce vectores incompatibles entre sí.

export type EmbedProvider = 'openai' | 'ollama';

export async function embed(text: string): Promise<number[]> {
  const provider = (process.env.EMBED_PROVIDER ?? 'openai') as EmbedProvider;
  switch (provider) {
    case 'openai':
      return embedOpenAI(text);
    case 'ollama':
      return embedOllama(text);
    default:
      throw new Error(`Unknown EMBED_PROVIDER: ${provider}`);
  }
}

async function embedOpenAI(text: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.EMBED_MODEL ?? 'text-embedding-3-small';
  if (!key) throw new Error('Missing OPENAI_API_KEY in env.');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({ model, input: text })
  });
  if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  const first = json.data[0];
  if (!first) throw new Error('OpenAI embed returned no data.');
  return first.embedding;
}

async function embedOllama(text: string): Promise<number[]> {
  const url = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const model = process.env.EMBED_MODEL ?? 'nomic-embed-text';
  const res = await fetch(`${url}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text })
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
  const { embedding } = (await res.json()) as { embedding: number[] };
  return embedding;
}
