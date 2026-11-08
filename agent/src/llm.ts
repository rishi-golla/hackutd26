// Nemotron through NVIDIA's OpenAI-compatible API, with tool calling.
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

/** Strip reasoning blocks some Nemotron variants put in the content. */
function clean(content: string | null | undefined): string {
  return (content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function chat(
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; timeoutMs: number; maxTokens?: number }
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, opts.timeoutMs));
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
        model: CONFIG.model,
        messages,
        temperature: 0.2,
        max_tokens: opts.maxTokens ?? 1024,
        stream: false,
        ...(CONFIG.thinking ? {} : { chat_template_kwargs: { enable_thinking: false } }),
        ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new Error(`NVIDIA API ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    };
    const message = data.choices?.[0]?.message;
    return { content: clean(message?.content), toolCalls: message?.tool_calls ?? [] };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`Nemotron timed out after ${opts.timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claims the model tends to add on its own (seen with nemotron-3-ultra: "male", "transporting" while on scene).
 * Each needs one of its own words in the source text, or the line or alert is rejected.
 */
const RISKY_CLAIMS: { claim: RegExp; needs: RegExp }[] = [
  { claim: /\b(male|female|man|woman|he|she|his|her)\b/i, needs: /\b(male|female|man|woman|he|she|his|her|him)\b/i },
  { claim: /\b(transport\w*|en route|en_route)\b/i, needs: /\b(transport\w*|en route|en_route)\b/i },
  { claim: /\b(shock\w*|defibrillat\w*)\b/i, needs: /\b(shock\w*|defibrillat\w*)\b/i },
  { claim: /\b(intubat\w*|i-gel|airway)\b/i, needs: /\b(intubat\w*|i-gel|airway)\b/i },
  { claim: /\b(witnessed|unwitnessed)\b/i, needs: /\b(witnessed|unwitnessed)\b/i },
];

/** The first risky claim in `text` that `corpus` doesn't support, or undefined. */
export function unsupportedClaim(text: string, corpus: string): string | undefined {
  for (const { claim, needs } of RISKY_CLAIMS) {
    const m = text.match(claim);
    if (m && !needs.test(corpus)) return m[0];
  }
  return undefined;
}

const NUMBER = /\d+(?:\.\d+)?/g;

/**
 * Every number in `text` must appear as a whole number in `corpus` (facts-only guard).
 * Whole tokens, so "96" is not "found" inside a date like 1968-03-14.
 */
export function numbersSupported(text: string, corpus: string): boolean {
  const known = new Set(corpus.match(NUMBER) ?? []);
  // "SpO2" is a name, not the number 2.
  const plain = text.replace(/SpO2/gi, 'SpO₂');
  return (plain.match(NUMBER) ?? []).every(n => known.has(n));
}
