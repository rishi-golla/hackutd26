// Nemotron through NVIDIA's OpenAI-compatible API, with tool calling. Same shape as agent/src/llm.ts, plus a
// model fallback: if the fast voice model's slug is unknown to the endpoint, the verified ultra takes over.
import { CONFIG } from './config';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };
export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

let activeModel = CONFIG.model;
export const modelInUse = () => activeModel;

/** Strip reasoning blocks some Nemotron variants put in the content. */
function clean(content: string | null | undefined): string {
  return (content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function call(model: string, messages: ChatMessage[], opts: { tools?: ToolDef[]; timeoutMs: number; maxTokens?: number }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, opts.timeoutMs));
  try {
    const res = await fetch(`${CONFIG.nvidiaBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${CONFIG.nvidiaApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        top_p: 0.95,
        max_tokens: opts.maxTokens ?? 300,
        stream: false,
        ...(CONFIG.thinking ? {} : { chat_template_kwargs: { enable_thinking: false } }),
        ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      const err = new Error(`NVIDIA API ${res.status}: ${text}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
    const message = data.choices?.[0]?.message;
    return { content: clean(message?.content), toolCalls: message?.tool_calls ?? [] };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`Nemotron timed out after ${opts.timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; timeoutMs: number; maxTokens?: number }
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  try {
    return await call(activeModel, messages, opts);
  } catch (err) {
    const e = err as Error & { status?: number };
    // Unknown slug (404, or the endpoint says so): switch to the verified model for the rest of the run.
    const unknownModel = activeModel !== CONFIG.fallbackModel && (e.status === 404 || /model|not found|does not exist/i.test(e.message));
    if (!unknownModel) throw err;
    console.warn(`[voice] model ${activeModel} rejected (${e.message.slice(0, 80)}); falling back to ${CONFIG.fallbackModel}`);
    activeModel = CONFIG.fallbackModel;
    return call(activeModel, messages, opts);
  }
}

const NUMBER = /\d+(?:\.\d+)?/g;

const SMALL: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * Numbers written as words become digits, in the wording spoken() produces and people use:
 * "two hundred" → 200, "one fifty-five" → 155, "one oh four" → 104, "eighty-eight" → 88, "thirty-six point four" → 36.4.
 * So "Heart rate two hundred" is checked against the facts like "Heart rate 200" would be.
 */
export function numberWordsToDigits(text: string): string {
  const tokens = text.split(/(\s+|-)/);
  const out: string[] = [];
  let cur: number | undefined;
  let decimals: string | undefined;
  const flush = () => {
    if (cur !== undefined) out.push(decimals !== undefined ? `${cur}.${decimals}` : String(cur));
    cur = undefined;
    decimals = undefined;
  };
  for (const raw of tokens) {
    const w = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) {
      if (/^\s+$|^-$/.test(raw) && cur !== undefined) continue; // inside a number
      flush();
      out.push(raw);
      continue;
    }
    if (decimals !== undefined && w in SMALL && SMALL[w] < 10) {
      decimals += String(SMALL[w]);
      continue;
    }
    if (w === 'and' && cur !== undefined && cur > 0 && cur % 100 === 0) continue; // "one hundred and five"
    if (w in SMALL) {
      const n = SMALL[w];
      if (cur === undefined) cur = n;
      else if (n === 0 && cur < 10) cur = cur * 100; // "one oh four"
      else if (cur < 10 && n >= 10) cur = cur * 100 + n; // "one fifteen"
      else if (cur % 10 === 0 && n < 10) cur += n; // "eighty-eight", "one oh four"
      else {
        flush();
        cur = n;
      }
      continue;
    }
    if (w in TENS) {
      const n = TENS[w];
      if (cur === undefined) cur = n;
      else if (cur < 10) cur = cur * 100 + n; // "one fifty"
      else if (cur % 100 === 0) cur += n; // "two hundred fifty"
      else {
        flush();
        cur = n;
      }
      continue;
    }
    if (w === 'hundred') {
      cur = ((cur ?? 1) || 1) * 100; // "a hundred", "two hundred"
      continue;
    }
    if (w === 'point' && cur !== undefined) {
      decimals = '';
      continue;
    }
    flush();
    out.push(raw);
  }
  flush();
  return out.join('');
}

/**
 * Every number in `text` (digits or words) must appear as a whole token in `corpus` (facts-only guard, as in
 * agent/src/llm.ts). Whole tokens, so "96" is not "found" inside a date like 1968-03-14.
 */
export function numbersSupported(text: string, corpus: string): boolean {
  const known = new Set(corpus.match(NUMBER) ?? []);
  const plain = numberWordsToDigits(text.replace(/SpO2/gi, 'SpO₂'));
  return (plain.match(NUMBER) ?? []).every(n => known.has(n));
}
