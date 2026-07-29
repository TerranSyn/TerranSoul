// SPDX-License-Identifier: MIT
//
// Pure prompt construction for the optional LongMemEval-S evidence judge
// (benchmark/scripts/longmemeval-s.mjs --with-judge).
//
// Extracted from the runner so the LLM-visible surface is testable in
// isolation: everything here is a string transform with no I/O, so
// longmemeval-judge-prompt.test.mjs can assert what the model can and
// cannot see without standing up Ollama or the Rust IPC shim.
//
// MAX-100-23 — the judge is shown EVIDENCE ONLY. Two things are deliberately
// withheld, and the test suite is what keeps them withheld:
//
//   * Session ids. Every LongMemEval-S gold session is named `answer_<hash>`
//     and no distractor ever is, so a printed id is not a hint — it is a
//     perfect oracle. A judge reading labels instead of evidence reports a
//     support rate that measures nothing.
//   * The reference answer. Handing the grader the answer key turns
//     "is this evidence sufficient?" into "does this text resemble the string
//     I was just given?", which the gold session trivially satisfies.
//
// Ranks (#1, #2, …) stay: they are derived from the retrieved order the judge
// is being asked about, carry no gold signal, and are what lets the model
// refer to a specific candidate. Nothing here touches what is RETRIEVED or
// SCORED — the runner's metrics read `retrievedSessionIds` directly.

/** Render a haystack session's turns the way both the store and the judge see it. */
export function chunkSessionToText(turns) {
  return turns.map(turn => `${turn.role}: ${turn.content}`).join('\n');
}

export function buildJudgeContext(entry, retrievedSessionIds, topK, maxChars) {
  const byId = new Map(entry.haystack_session_ids.map((id, index) => [id, entry.haystack_sessions[index]]));
  return retrievedSessionIds.slice(0, topK).map((sessionId, index) => {
    const text = chunkSessionToText(byId.get(sessionId) ?? []);
    const capped = Array.from(text).slice(0, maxChars).join('');
    // Rank only. The id stays on the harness side of this boundary.
    return `#${index + 1}\n${capped}`;
  }).join('\n\n');
}

export function buildJudgePrompt(entry, retrievedSessionIds, options) {
  const context = buildJudgeContext(
    entry,
    retrievedSessionIds,
    options.judgeTopK,
    options.judgeMaxSessionChars,
  );
  return `You are judging retrieval evidence for LongMemEval-S.\n\nQuestion:\n${entry.question}\n\nRetrieved sessions:\n${context}\n\nReturn JSON only with keys supported (boolean) and reason (short string). supported=true means the retrieved sessions above contain enough evidence to answer the question correctly. Judge only from the evidence shown.`;
}
