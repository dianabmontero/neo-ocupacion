import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { ask } from '../lib/ask.js';

const app = new Hono();

app.post('/ask', async c => {
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

app.get('/health', c => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`API up on http://localhost:${port}`);
