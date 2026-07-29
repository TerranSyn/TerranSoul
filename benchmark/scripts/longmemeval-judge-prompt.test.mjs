// SPDX-License-Identifier: MIT
//
// MAX-100-23: gold-oracle leak guard for the LongMemEval-S evidence judge.
//
// WHY THIS EXISTS: in the LongMemEval-S dataset every one of the 948 gold
// sessions carries an `answer_` id prefix, and no non-gold distractor in the
// retrieved slots ever carries it. A session id printed into a judge prompt is
// therefore not a hint — it is a PERFECT oracle: the model can score support
// by reading the label instead of the evidence. The reference answer is the
// same failure in plainer form. Today's published numbers are clean only
// because the judge was never switched on (judge_support_rate is null in every
// committed report); this test is what keeps them clean once it is.
//
// WHY NOT IN lib/: vitest.config.ts globs `benchmark/scripts/lib/*.test.mjs`.
// A node:test file caught by that glob registers its assertions with node:test,
// vitest finds no suites, and the file reports green having executed nothing —
// the exact trap documented in vitest.config.ts. Run via
// `npm run brain:longmem:prompt:test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJudgeContext,
  buildJudgePrompt,
  chunkSessionToText,
} from './lib/longmem-judge-prompt.mjs';

// The sentinel is a token no session text contains, so a "reference answer
// leaked" failure can never be a false positive from evidence text that
// legitimately paraphrases the answer.
const ANSWER_SENTINEL = 'sentinel-tea-9f3a';
const GOLD_ID = 'answer_7c41d9e2';

const ENTRY = {
  question_id: 'leak-guard-1',
  question_type: 'single-session-user',
  question: 'Which drink does Alex prefer while coding?',
  answer: `Alex prefers green tea while coding (${ANSWER_SENTINEL}).`,
  answer_session_ids: [GOLD_ID],
  haystack_session_ids: ['distractor_5b8f', GOLD_ID, 'distractor_2ae0'],
  haystack_sessions: [
    [
      { role: 'user', content: 'I debugged the sync issue after lunch.' },
      { role: 'assistant', content: 'We found the problem in the queue retry path.' },
    ],
    [
      { role: 'user', content: 'Please remember that I prefer green tea while coding.' },
      { role: 'assistant', content: 'Noted: green tea is your coding drink.' },
    ],
    [
      { role: 'user', content: 'Standup moved to Thursday.' },
      { role: 'assistant', content: 'Calendar updated.' },
    ],
  ],
};

// Gold ranked second, mirroring the rank-2/rank-3 misses that MAX mode exists
// to fix — the ordering the judge is most likely to be asked to adjudicate.
const RETRIEVED = ['distractor_5b8f', GOLD_ID, 'distractor_2ae0'];

const OPTIONS = { judgeTopK: 5, judgeMaxSessionChars: 1800 };

/** Every identifier the harness knows about — none may reach the model. */
function forbiddenIds(entry) {
  return [...new Set([...entry.answer_session_ids, ...entry.haystack_session_ids])];
}

test('judge prompt leaks no session id', () => {
  const prompt = buildJudgePrompt(ENTRY, RETRIEVED, OPTIONS);
  for (const id of forbiddenIds(ENTRY)) {
    assert.ok(
      !prompt.includes(id),
      `session id "${id}" reached the judge prompt — an "answer_"-prefixed id is a perfect gold oracle\n--- prompt ---\n${prompt}`,
    );
  }
});

test('judge prompt leaks no gold "answer_" prefix in any form', () => {
  const prompt = buildJudgePrompt(ENTRY, RETRIEVED, OPTIONS);
  // Guards the id-shaped leak generically: even a truncated or reformatted id
  // still carries the oracle if the prefix survives.
  assert.ok(
    !/answer_/.test(prompt),
    `the "answer_" gold prefix reached the judge prompt\n--- prompt ---\n${prompt}`,
  );
});

test('judge prompt leaks no reference answer', () => {
  const prompt = buildJudgePrompt(ENTRY, RETRIEVED, OPTIONS);
  assert.ok(
    !prompt.includes(ANSWER_SENTINEL),
    `the reference answer reached the judge prompt — the judge would grade its own crib sheet\n--- prompt ---\n${prompt}`,
  );
  assert.ok(!prompt.includes(ENTRY.answer), 'full reference answer string reached the judge prompt');
  assert.ok(
    !/reference answer/i.test(prompt),
    'prompt still instructs the model to compare against a reference answer it can no longer see',
  );
});

test('buildJudgeContext is clean on its own, for any future caller', () => {
  const context = buildJudgeContext(ENTRY, RETRIEVED, OPTIONS.judgeTopK, OPTIONS.judgeMaxSessionChars);
  for (const id of forbiddenIds(ENTRY)) {
    assert.ok(!context.includes(id), `session id "${id}" reached the judge context`);
  }
  assert.ok(!context.includes(ANSWER_SENTINEL), 'reference answer reached the judge context');
});

test('stripping the oracle keeps the judge answerable', () => {
  const prompt = buildJudgePrompt(ENTRY, RETRIEVED, OPTIONS);
  assert.ok(prompt.includes(ENTRY.question), 'question must still be visible');
  // The evidence itself is the whole point of the diagnostic — a prompt that
  // passes the leak checks by showing nothing would be worse than useless.
  assert.ok(
    prompt.includes('I prefer green tea while coding'),
    'gold session evidence must still be visible',
  );
  assert.ok(prompt.includes('debugged the sync issue'), 'distractor evidence must still be visible');
  assert.ok(/supported/.test(prompt), 'output contract must survive');
});

test('rank labels survive so the judge can still tell candidates apart', () => {
  const prompt = buildJudgePrompt(ENTRY, RETRIEVED, OPTIONS);
  // Retrieved order is preserved: rank 1 is the distractor, rank 2 the gold.
  assert.ok(prompt.indexOf('#1') < prompt.indexOf('#2'), 'ranks must appear in retrieved order');
  assert.ok(
    prompt.indexOf('debugged the sync issue') < prompt.indexOf('I prefer green tea'),
    'session bodies must stay in retrieved order',
  );
});

test('topK and per-session char cap are unchanged by the de-identification', () => {
  const capped = buildJudgeContext(ENTRY, RETRIEVED, 2, 1800);
  assert.equal(capped.split('\n\n').length, 2, 'judgeTopK still truncates the shown sessions');
  assert.ok(!capped.includes('Standup moved to Thursday'), 'session 3 must be cut by topK=2');

  const clipped = buildJudgeContext(ENTRY, [GOLD_ID], 5, 12);
  const body = clipped.split('\n').slice(1).join('\n');
  assert.equal(Array.from(body).length, 12, 'judgeMaxSessionChars still clips by code point');
});

test('an id with no haystack session degrades to an empty body, not a crash', () => {
  const context = buildJudgeContext(ENTRY, ['ghost_id_not_in_haystack'], 5, 1800);
  assert.ok(!context.includes('ghost_id_not_in_haystack'), 'unknown ids must not leak either');
  assert.equal(chunkSessionToText([]), '');
});

test('chunkSessionToText is byte-identical to the pre-extraction runner version', () => {
  // This function moved out of longmemeval-s.mjs to be shared with the judge,
  // but sessionPayloads() still feeds it straight into the store — so a drift
  // here would silently change what is INDEXED, i.e. every published metric.
  assert.equal(
    chunkSessionToText(ENTRY.haystack_sessions[1]),
    'user: Please remember that I prefer green tea while coding.\n'
      + 'assistant: Noted: green tea is your coding drink.',
  );
});
