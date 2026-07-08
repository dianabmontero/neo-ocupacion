// Serverless entrypoint del bot de soporte NEO — es la única función Node
// que expone Vercel bajo /api/*. La lógica del bot vive en lib/.
//
// vercel.json enruta todo /api/(.*) a este archivo, y Hono resuelve el resto
// vía basePath('/api').
//
// Same-origin con el resto de la app (Flask sirve las páginas, este endpoint
// sirve el bot) → no hace falta CORS. El widget en templates/index.html
// llama a fetch('/api/ask') como URL relativa.

import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { ask } from '../lib/ask.js';

export const config = { runtime: 'nodejs' };

const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

app.post('/ask', async (c) => {
  let body: { question?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'question is required' }, 400);
  }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return c.json({ error: 'question is required' }, 400);

  try {
    const result = await ask(question);
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

export const GET = handle(app);
export const POST = handle(app);
