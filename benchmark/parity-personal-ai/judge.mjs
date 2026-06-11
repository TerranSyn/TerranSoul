/**
 * LLM-as-Judge scorer for the parity bench.
 * Uses Ollama to score each (prompt, response) pair 0–10.
 */

const OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_JUDGE_MODEL = 'gemma3:4b';

const JUDGE_SYSTEM_PROMPT = `You are a strict quality judge for an AI personal assistant benchmark.
You will receive a USER PROMPT and the ASSISTANT RESPONSE from a personal AI system.
You will also receive a SCORING RUBRIC specific to the task type.

Score the response on a scale of 0–10 based on:
- Relevance (does it address the prompt?)
- Accuracy (are facts correct, no hallucinations?)
- Completeness (does it cover what's needed?)

Output ONLY a JSON object: {"score": <number 0-10>, "reason": "<one sentence>"}
Do not output anything else.`;

/**
 * Score a single response using Ollama LLM-as-judge.
 * @param {{ prompt: string, response: string, rubric: object, model?: string, context?: string }} opts
 *   context — the memory/context the assistant legitimately had access to.
 *   Facts the response draws from this context are NOT hallucinations; the
 *   judge MUST be told this or it penalises correct memory recall as
 *   fabrication (the recalled facts aren't in the bare prompt).
 * @returns {Promise<{ score: number, reason: string, latency: number }>}
 */
export async function judgeResponse({ prompt, response, rubric, model, context }) {
  const judgeModel = model || DEFAULT_JUDGE_MODEL;
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
        options: { temperature: 0.0 },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const elapsed = (performance.now() - start) / 1000;
    if (!res.ok) {
      const text = await res.text();
      return { score: -1, reason: `Judge HTTP ${res.status}: ${text}`, latency: elapsed };
    }

    const body = await res.json();
    const content = body.message?.content ?? '';

    // Parse JSON from the response (handle markdown code fences)
    const jsonMatch = content.match(/\{[^}]*"score"\s*:\s*(\d+)[^}]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { score: parsed.score, reason: parsed.reason || '', latency: elapsed };
    }

    // Fallback: try to find a bare number
    const numMatch = content.match(/\b(\d+)\b/);
    if (numMatch) {
      return { score: parseInt(numMatch[1], 10), reason: content.trim(), latency: elapsed };
    }

    return { score: -1, reason: `Could not parse judge output: ${content}`, latency: elapsed };
  } catch (err) {
    const elapsed = (performance.now() - start) / 1000;
    return { score: -1, reason: `Judge error: ${err.message}`, latency: elapsed };
  }
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
