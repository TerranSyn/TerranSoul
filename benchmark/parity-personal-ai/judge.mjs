/**
 * LLM-as-Judge scorer for the parity bench.
 * Uses Ollama to score each (prompt, response) pair 0–10.
 *
 * JUDGE-STABILITY-1 (2026-07-03): per-prompt forensics across the
 * 2026-06-07 canonical, 2026-07-01, and 2026-07-03 runs showed the dominant
 * source of run-to-run quality drift was SINGLE-CALL judge variance, not
 * pipeline changes — materially equivalent answers were scored 8 vs 6 vs 5
 * (sm-2, both stacks in the same run), and a MORE complete cs-4 answer
 * (3/3 items) scored lower than a 2/3 answer. temperature:0 alone does not
 * pin gemma4 on this GPU (logits jitter run-to-run — same class of
 * nondeterminism as the documented ~15% embedding ID-order variance).
 * Fix, applied IDENTICALLY to every system under test:
 *   - JUDGE_REPEATS (PARITY_JUDGE_REPEATS, default 3) independent judge
 *     calls per answer, reduced with the MEDIAN score (odd counts: middle;
 *     even counts: mean of the two middle values). The reported reason is
 *     taken from the repeat whose score is closest to the median.
 *   - Repeats must actually SAMPLE the judge's verdict distribution or the
 *     median degenerates to a single draw (measured: temperature 0 + one
 *     fixed seed returned identical triplets). So repeat i runs at
 *     PARITY_JUDGE_TEMP (default 0.3) with the deterministic seed
 *     PARITY_JUDGE_SEED + i (default 7+i) — diverse within the triplet,
 *     reproducible across runs.
 *   - Rubric-calibration line in the system prompt: completeness is judged
 *     against what the USER PROMPT asked for, not the full context
 *     inventory (measured misapplication: an answer containing ALL THREE
 *     seeded topics was penalised for "providing a list rather than
 *     highlighting one fact"; a recall question was penalised for not
 *     covering "setup, frequency, and notification" it never asked about).
 */

const OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_JUDGE_MODEL = 'gemma3:4b';
const JUDGE_REPEATS = Math.max(1, Number(process.env.PARITY_JUDGE_REPEATS || 3));
const JUDGE_SEED = Number(process.env.PARITY_JUDGE_SEED || 7);
const JUDGE_TEMP = Number(process.env.PARITY_JUDGE_TEMP || 0.3);

const JUDGE_SYSTEM_PROMPT = `You are a strict quality judge for an AI personal assistant benchmark.
You will receive a USER PROMPT and the ASSISTANT RESPONSE from a personal AI system.
You will also receive a SCORING RUBRIC specific to the task type.

Score the response on a scale of 0–10 based on:
- Relevance (does it address the prompt?)
- Accuracy (are facts correct, no hallucinations?)
- Completeness (does it cover what's needed?)

Apply every rubric criterion relative to what the USER PROMPT actually asks
for: do not penalise the response for omitting rubric elements or context
facts the prompt did not call for.

Output ONLY a JSON object: {"score": <number 0-10>, "reason": "<one sentence>"}
Do not output anything else.`;

/**
 * Median of an array of numeric scores.
 * Odd count → middle value; even count → mean of the two middle values.
 * Returns -1 for an empty array (matches the "judge failed" sentinel).
 * @param {number[]} scores
 * @returns {number}
 */
export function medianScore(scores) {
  const v = scores.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return -1;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Parse the judge model's raw output into a {score, reason} verdict.
 * Handles the strict JSON shape, markdown fences, and a bare-number fallback.
 * Returns score -1 when nothing parseable is found.
 * @param {string} content
 * @returns {{ score: number, reason: string }}
 */
export function parseJudgeVerdict(content) {
  const jsonMatch = content.match(/\{[^}]*"score"\s*:\s*(\d+)[^}]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { score: parsed.score, reason: parsed.reason || '' };
    } catch { /* fall through to bare number */ }
  }
  const numMatch = content.match(/\b(\d+)\b/);
  if (numMatch) {
    return { score: parseInt(numMatch[1], 10), reason: content.trim() };
  }
  return { score: -1, reason: `Could not parse judge output: ${content}` };
}

/** One judge call. @returns {Promise<{ score: number, reason: string, latency: number }>} */
async function judgeOnce({ prompt, response, rubric, judgeModel, context, seed }) {
  const userMsg = [
    ...(context ? [
      `MEMORY CONTEXT AVAILABLE TO THE ASSISTANT (facts drawn from this are legitimate recall, NOT hallucination):`,
      context,
      '',
    ] : []),
    `USER PROMPT: ${prompt}`,
    `ASSISTANT RESPONSE: ${response}`,
    `SCORING RUBRIC:`,
    `- Relevance: ${rubric.relevance}`,
    `- Accuracy: ${rubric.accuracy}`,
    `- Completeness: ${rubric.completeness}`,
    '',
    'Score this response 0–10. Treat facts grounded in the MEMORY CONTEXT as correct recall. Output ONLY {"score": N, "reason": "..."}',
  ].join('\n');

  const start = performance.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: judgeModel,
        messages: [
          { role: 'system', content: JUDGE_SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
        stream: false,
        // Disable hidden reasoning on thinking models (gemma4:*) so the JSON
        // verdict lands in `content` instead of the model burning its budget on
        // reasoning and returning empty. `think:false` is honoured by /api/chat.
        think: false,
        options: { temperature: JUDGE_TEMP, seed },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const elapsed = (performance.now() - start) / 1000;
    if (!res.ok) {
      const text = await res.text();
      return { score: -1, reason: `Judge HTTP ${res.status}: ${text}`, latency: elapsed };
    }

    const body = await res.json();
    const verdict = parseJudgeVerdict(body.message?.content ?? '');
    return { ...verdict, latency: elapsed };
  } catch (err) {
    const elapsed = (performance.now() - start) / 1000;
    return { score: -1, reason: `Judge error: ${err.message}`, latency: elapsed };
  }
}

/**
 * Score a single response using Ollama LLM-as-judge.
 * Runs JUDGE_REPEATS independent calls and reduces with the median score
 * (JUDGE-STABILITY-1) — identical treatment for every system under test.
 * @param {{ prompt: string, response: string, rubric: object, model?: string, context?: string, repeats?: number }} opts
 *   context — the memory/context the assistant legitimately had access to.
 *   Facts the response draws from this context are NOT hallucinations; the
 *   judge MUST be told this or it penalises correct memory recall as
 *   fabrication (the recalled facts aren't in the bare prompt).
 * @returns {Promise<{ score: number, reason: string, latency: number, scores: number[] }>}
 *   latency — total judge wall time across repeats;
 *   scores  — every valid per-repeat score (transparency in the artifact).
 */
export async function judgeResponse({ prompt, response, rubric, model, context, repeats }) {
  const judgeModel = model || DEFAULT_JUDGE_MODEL;
  const n = Math.max(1, Number(repeats || JUDGE_REPEATS));

  const attempts = [];
  let totalLatency = 0;
  for (let i = 0; i < n; i++) {
    // Deterministic-but-diverse repeats: seed varies per repeat (reproducible
    // across runs), temperature JUDGE_TEMP samples the verdict distribution.
    const r = await judgeOnce({ prompt, response, rubric, judgeModel, context, seed: JUDGE_SEED + i });
    totalLatency += r.latency;
    attempts.push(r);
  }

  const valid = attempts.filter((a) => a.score >= 0);
  if (!valid.length) {
    // Every repeat failed — surface the last failure (parse error / HTTP / timeout).
    const last = attempts[attempts.length - 1];
    return { score: -1, reason: last.reason, latency: totalLatency, scores: [] };
  }

  const scores = valid.map((a) => a.score);
  const score = medianScore(scores);
  // Reason from the repeat closest to the median (exact match when odd count).
  const closest = valid.reduce((best, a) =>
    Math.abs(a.score - score) < Math.abs(best.score - score) ? a : best);
  return { score, reason: closest.reason, latency: totalLatency, scores };
}

/**
 * Check if Ollama is reachable.
 */
export async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
