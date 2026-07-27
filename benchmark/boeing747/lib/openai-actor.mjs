// OpenAI-compat ACTOR transport for the Boeing 747 primitives bench.
//
// The default baseline actor speaks Ollama-native /api/chat (judge/judge.mjs
// ollamaChat), which is ALSO the frozen judge's transport. To run a head-to-head
// where the ACTOR is a llama.cpp server (e.g. the Bonsai 27B 1-bit fork on
// http://127.0.0.1:8092) WITHOUT disturbing the frozen judge, run-baselines.mjs
// switches ONLY generateCandidate to this module when ACTOR_OPENAI_BASE_URL is
// set. The judge keeps hitting Ollama gemma4:12b-it-qat, held byte-identical.
//
// Design (CORRECTED 2026-07-23 after the reasoning root-cause audit):
//   1. Reasoning is ON by default for hard tasks (enable_thinking=true). The
//      earlier "always inject enable_thinking=false" note was WRONG: with the
//      server run under `--jinja --reasoning-format deepseek` and an adequate
//      `-c`, Bonsai SELF-TERMINATES its `<think>` (~15k tokens) and lands the
//      answer in `content`. The empty-content failures were CONTEXT truncation
//      (`-c 8192`) + a too-small max_tokens cap, NOT the thinking flag.
//   2. NEVER hard-cap the reasoning budget below the natural trace — a cap that
//      force-cuts mid-thought is a STARVED measurement. Omit max_tokens (run to
//      EOS, bounded by the server's --reasoning-budget) or set it well above the
//      trace, and GATE on finish_reason: any reply with finish_reason!='stop'
//      (or empty content) is invalid and must NOT be scored (caller quarantines).
//   3. The reply is normalized back into the Ollama /api/chat body shape
//      (message.content / message.thinking / done_reason) so extractReplyText and
//      extractModule downstream stay byte-identical — no judge/parse code changes.
//
// Pure functions (normalizeOpenAiReply, buildActorRequest) are unit-tested in
// openai-actor.test.mjs; openaiActorChat takes an injectable fetch for the test.

import { Agent } from 'undici';

// A long-running native-reasoning generation (Bonsai reasons ~16-22k tokens
// before the NON-streaming response headers arrive) exceeds undici's default
// ~5-min headersTimeout and aborts a VALID gen (UND_ERR_HEADERS_TIMEOUT).
// Disable undici's own header/body timeouts on the actor request — the
// AbortController (timeoutMs) is the sole deadline.
const ACTOR_DISPATCHER = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

/**
 * Pure: reshape an OpenAI POST /v1/chat/completions reply into the Ollama
 * /api/chat response body shape that extractReplyText (lib/judge-parse.mjs)
 * expects: { message: { content, thinking }, done_reason }. Never throws.
 */
export function normalizeOpenAiReply(j) {
  const choice = (j && Array.isArray(j.choices) && j.choices[0]) || {};
  const msg = (choice && choice.message) || {};
  return {
    message: {
      content: typeof msg.content === 'string' ? msg.content : '',
      // llama.cpp exposes the reasoning channel as reasoning_content; map it to
      // the Ollama `thinking` field so the thinking-swallow fallback still works.
      thinking: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '',
    },
    done_reason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
  };
}

/**
 * Pure: build the OpenAI-compat request body for one actor turn. Defaults to the
 * Qwen3 thinking-coding sampling preset with enable_thinking ON; max_tokens is
 * OMITTED unless the caller passes one (highest effort = run to natural EOS,
 * bounded by the server's --reasoning-budget — never a starving hardcap). Kept
 * pure so a test can assert the request shape without a socket.
 */
export function buildActorRequest({ model, messages, options }) {
  const o = options ?? {};
  // Bonsai 27B = a 1.71-bit ternary quant of Qwen3.6-27B. Qwen3 thinking models
  // EXPLICITLY forbid greedy decoding ("DO NOT use greedy decoding — it leads to
  // performance degradation and endless repetitions"), and the ternary quant
  // makes it worse by flattening near-tied logits into deterministic loops. The
  // gemma4-tuned frozen builder uses temperature:0, which is exactly this trap —
  // so we NEVER pass temp 0 to Bonsai. Defaults here are the Qwen3.6-27B
  // thinking-mode CODING preset (temp 0.6 for code determinism, top_p 0.95,
  // top_k 20, min_p 0, presence_penalty 0, repeat_penalty 1.0 — Qwen says keep
  // repeat_penalty at 1.0 and reach for presence_penalty if loops persist).
  // All overridable via options. See docs/bonsai-27b-evaluation.md + the model card.
  const t = Number(o.temperature);
  const req = {
    model,
    messages,
    temperature: Number.isFinite(t) && t > 0 ? t : 0.6, // coerce a leaked temp:0 to the safe preset
    top_p: o.top_p ?? 0.95,
    top_k: o.top_k ?? 20,
    min_p: o.min_p ?? 0.0,
    presence_penalty: o.presence_penalty ?? 0.0,
    repeat_penalty: o.repeat_penalty ?? 1.0,
    seed: o.seed,
    stream: false,
    // Thinking model: ON by default (a full Three.js module is a hard task).
    // The caller can force it off for trivial prompts.
    chat_template_kwargs: { enable_thinking: o.enable_thinking ?? true },
  };
  // Output cap is EFFORT-driven, not a default. Highest effort = run to natural
  // EOS (the server's --reasoning-budget bounds the <think> trace, so the model
  // self-terminates and lands the answer in content). A hardcoded cap below the
  // ~15k trace STARVES it mid-thought → an invalid measurement. Only cap when the
  // caller explicitly asks. (reasoning root-cause audit 2026-07-23)
  const mt = Number(o.max_tokens);
  if (Number.isFinite(mt) && mt > 0) req.max_tokens = mt;
  return req;
}

/**
 * Transport: POST to `${baseUrl}/v1/chat/completions` and return the SAME
 * { body, content, ms } shape as judge/judge.mjs ollamaChat, so generateCandidate
 * is transport-agnostic. fetchImpl is injectable for tests.
 */
export async function openaiActorChat({ baseUrl, model, messages, options, timeoutMs, fetchImpl = fetch }) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildActorRequest({ model, messages, options })),
      signal: controller.signal,
      dispatcher: ACTOR_DISPATCHER,
    });
    if (!res.ok) throw new Error(`openai-actor ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = normalizeOpenAiReply(await res.json());
    return { body, content: body.message.content, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
