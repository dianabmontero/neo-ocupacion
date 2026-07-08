// Interfaz de generación enchufable con structured output.
// Usa "tool use" de Anthropic para forzar al modelo a devolver JSON válido
// que respete el schema de LlmAnswer.

import Anthropic from '@anthropic-ai/sdk';

export type LlmProvider = 'anthropic' | 'openai' | 'ollama';

export interface RetrievedChunk {
  faq_id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface LlmAnswer {
  needs_handoff: boolean;
  answer: string | null;
  cited_faq_id: string | null;
  reason: string;
}

const SYSTEM_PROMPT = `Sos el asistente interno de soporte de NEO. Tu tarea es responder preguntas operativas del equipo (Country Manager, staff NEO) usando ÚNICAMENTE el CONTEXTO provisto.

Reglas:
- Si el CONTEXTO cubre el punto principal de la pregunta -> respondé con lo que hay (needs_handoff=false). Si algún matiz específico del pedido no aparece explícito, aclaralo dentro de la respuesta pero NO derivés. Preferí ayudar sobre no ayudar.
- Si el CONTEXTO no toca el tema de la pregunta en absoluto -> needs_handoff=true.
- Si responder requiere INVENTAR datos, números, procedimientos o URLs que no aparecen en el CONTEXTO -> needs_handoff=true.
- Si respondés (needs_handoff=false) -> citá el faq_id EXACTO en "cited_faq_id" y escribí la respuesta clara en español.
- Nunca uses conocimiento fuera del CONTEXTO.
- Nunca inventes números, procedimientos o URLs.`;

const ANSWER_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    needs_handoff: {
      type: 'boolean',
      description: 'true si el CONTEXTO no responde la pregunta o solo la responde parcialmente.'
    },
    answer: {
      type: ['string', 'null'],
      description: 'La respuesta en español si needs_handoff=false. null en caso contrario.'
    },
    cited_faq_id: {
      type: ['string', 'null'],
      description: 'El faq_id EXACTO del chunk que sustenta la respuesta — copiado byte-a-byte del valor "faq_id=X" del CONTEXTO. Solo caracteres alfanuméricos y guiones. NO agregues puntos, comillas, corchetes, espacios ni ningún carácter extra. null si needs_handoff=true.'
    },
    reason: {
      type: 'string',
      description: 'Explicación breve: por qué se decidió handoff, o cómo se llegó a la respuesta.'
    }
  },
  required: ['needs_handoff', 'answer', 'cited_faq_id', 'reason']
};

const ANSWER_TOOL = {
  name: 'respond_with_answer',
  description: 'Devuelve la respuesta estructurada al usuario. Es la única forma de contestar.',
  strict: true,
  input_schema: ANSWER_SCHEMA
};

function userMessage(question: string, context: string): string {
  return `PREGUNTA:\n${question}\n\nCONTEXTO:\n${context}`;
}

export async function generateAnswer(
  question: string,
  chunks: RetrievedChunk[]
): Promise<LlmAnswer> {
  const provider = (process.env.LLM_PROVIDER ?? 'anthropic') as LlmProvider;
  const context = formatContext(chunks);
  switch (provider) {
    case 'anthropic':
      return generateAnthropic(question, context);
    case 'openai':
      return generateOpenAI(question, context);
    case 'ollama':
      throw new Error('Ollama LLM path not wired yet.');
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  }
}

function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '(sin chunks recuperados)';
  return chunks
    .map((c, i) => `[chunk ${i + 1}] faq_id=${c.faq_id}\n${c.content}`)
    .join('\n\n---\n\n');
}

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Missing ANTHROPIC_API_KEY in env.');
  anthropicClient = new Anthropic({ apiKey: key });
  return anthropicClient;
}

async function generateAnthropic(question: string, context: string): Promise<LlmAnswer> {
  const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

  const response = await getAnthropic().messages.create({
    model,
    max_tokens: 1024,
    temperature: 0, // Determinismo: mismo input → misma respuesta. Requerido para eval reproducible.
    system: SYSTEM_PROMPT,
    tools: [ANSWER_TOOL],
    tool_choice: { type: 'tool', name: ANSWER_TOOL.name },
    messages: [
      {
        role: 'user',
        content: userMessage(question, context)
      }
    ]
  });

  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude truncó la respuesta por max_tokens.');
  }
  const toolBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('Claude no devolvió tool_use — respuesta inesperada.');
  }
  return toolBlock.input as LlmAnswer;
}

async function generateOpenAI(question: string, context: string): Promise<LlmAnswer> {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_LLM_MODEL ?? 'gpt-4o-mini';
  if (!key) throw new Error('Missing OPENAI_API_KEY in env.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0, // Determinismo: mismo input → misma respuesta. Requerido para eval reproducible.
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage(question, context) }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: ANSWER_TOOL.name,
          strict: true,
          schema: ANSWER_SCHEMA
        }
      }
    })
  });

  if (!res.ok) throw new Error(`OpenAI LLM failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    choices: { message: { content: string | null }; finish_reason: string }[];
  };
  const choice = json.choices[0];
  if (!choice) throw new Error('OpenAI LLM returned no choices.');
  if (!choice.message.content || choice.finish_reason !== 'stop') {
    throw new Error(`OpenAI LLM sin respuesta usable (finish_reason: ${choice.finish_reason}).`);
  }
  return JSON.parse(choice.message.content) as LlmAnswer;
}
