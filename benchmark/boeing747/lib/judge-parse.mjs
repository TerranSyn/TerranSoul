// FROZEN judge-reply parsing for the Boeing 747 primitives vision benchmark.
// Pure functions only — covered by vitest (judge-parse.test.mjs). No Ollama,
// no network: callers inject the chat call (judge/judge.mjs owns transport).
//
// Why this module exists (measured 2026-07-03, THINKING-SWALLOW-1):
// gemma4:12b-it-qat under Ollama is a thinking model — without `think:false`
// it burns the whole num_predict budget inside `message.thinking` and returns
// EMPTY `message.content` with done_reason=length, which the old parser
// surfaced as the useless "judge reply is not JSON: " (empty slice) and
// zeroed a whole view (3/3 seeds failed on the stub-validation run). The
// protocol pins think:false in rubric.json, but the parser must still
// survive every shape the server can legally return:
//   - JSON in message.content (the normal think:false path)
//   - content empty, the reply living in message.thinking (thinking fallback)
//   - both empty (e.g. done_reason=length truncation) -> retryable 'empty'
//   - non-JSON / truncated JSON text -> retryable 'malformed'
// Retry policy (FROZEN in rubric.json `judge_parse_retries`): a retryable
// failure re-requests with the IDENTICAL seed and options — never a new seed,
// so the seed set stays exactly judge_seeds and results remain comparable.
// A seed that still fails is recorded and dropped (fail-open, DEAD-JUDGE-1).
import { normalizeScore } from './scoring.mjs';

/**
 * Extract the reply text from a raw Ollama /api/chat response body.
 * Prefers message.content; falls back to message.thinking when content is
 * empty (the thinking-swallow shape). Never throws — returns a diagnostic
 * struct so callers can build actionable errors:
 *   { text, source: 'content'|'thinking'|'empty', doneReason,
 *     contentLen, thinkingLen }
 */
export function extractReplyText(body) {
  const message = body && typeof body === 'object' ? (body.message ?? {}) : {};
  const rawContent = typeof message.content === 'string' ? message.content : '';
  const rawThinking = typeof message.thinking === 'string' ? message.thinking : '';
  const content = rawContent.trim();
  const thinking = rawThinking.trim();
  const doneReason =
    body && typeof body === 'object' && typeof body.done_reason === 'string'
      ? body.done_reason
      : null;
  const meta = { doneReason, contentLen: content.length, thinkingLen: thinking.length };
  if (content) return { text: content, source: 'content', ...meta };
  if (thinking) return { text: thinking, source: 'thinking', ...meta };
  return { text: '', source: 'empty', ...meta };
}

/** Parse the judge's reply text into normalized scores; tolerate a stray code fence. */
export function parseJudgeReply(text, criteriaIds) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('judge reply is empty');
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`judge reply is not JSON: ${text.slice(0, 120)}`);
    obj = JSON.parse(m[0]);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`judge reply JSON is not an object: ${text.slice(0, 120)}`);
  }
  const rawScores = obj.scores && typeof obj.scores === 'object' ? obj.scores : obj;
  const scores = {};
  for (const id of criteriaIds) {
    scores[id] = normalizeScore(rawScores[id]);
  }
  return {
    scores,
    weakestVisible:
      typeof obj.weakest_visible_feature === 'string' ? obj.weakest_visible_feature : null,
    notes: typeof obj.notes === 'string' ? obj.notes.slice(0, 400) : '',
  };
}

/**
 * Parse a raw Ollama /api/chat body into judge scores. Throws classified,
 * retryable errors so the caller can apply the frozen same-seed retry policy:
 *   err.kind = 'empty'      both content and thinking empty (e.g. truncation)
 *   err.kind = 'malformed'  text present but not parseable strict JSON
 * Both kinds carry err.retryable = true. On success the extraction
 * provenance is attached: { ...parsed, reply_source, done_reason }.
 */
export function parseJudgeBody(body, criteriaIds) {
  const extracted = extractReplyText(body);
  if (!extracted.text) {
    const err = new Error(
      `judge reply empty (done_reason=${extracted.doneReason ?? 'unknown'}, ` +
        `content_len=${extracted.contentLen}, thinking_len=${extracted.thinkingLen})`,
    );
    err.kind = 'empty';
    err.retryable = true;
    throw err;
  }
  try {
    const parsed = parseJudgeReply(extracted.text, criteriaIds);
    return { ...parsed, reply_source: extracted.source, done_reason: extracted.doneReason };
  } catch (cause) {
    const err = new Error(
      `judge reply malformed via ${extracted.source} ` +
        `(done_reason=${extracted.doneReason ?? 'unknown'}): ${String(cause.message || cause)}`,
    );
    err.kind = 'malformed';
    err.retryable = true;
    throw err;
  }
}

/**
 * FROZEN same-seed retry loop (rubric.json `judge_parse_retries`).
 * `call(attempt)` performs ONE chat request and resolves { body, ms } — the
 * caller closes over model/messages/options/seed, so every retry reuses the
 * IDENTICAL seed by construction. Retries happen only for classified
 * retryable parse failures ('empty'/'malformed'); transport errors thrown by
 * `call` itself propagate immediately (transport retry already lives inside
 * ollamaChat). Resolves { ...parsed, ms, parse_retries } or throws the last
 * parse error after maxRetries extra attempts. `parse` is injectable for
 * tests only — production always uses parseJudgeBody.
 */
export async function callWithParseRetry(call, criteriaIds, maxRetries, parse = parseJudgeBody) {
  const retries = Number.isInteger(maxRetries) && maxRetries > 0 ? maxRetries : 0;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { body, ms } = await call(attempt);
    try {
      return { ...parse(body, criteriaIds), ms, parse_retries: attempt };
    } catch (err) {
      lastErr = err;
      if (!err.retryable) throw err;
    }
  }
  throw lastErr;
}
