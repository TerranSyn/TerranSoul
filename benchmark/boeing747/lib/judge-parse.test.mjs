import { describe, expect, it } from 'vitest';
import {
  callWithParseRetry,
  extractReplyText,
  parseJudgeBody,
  parseJudgeReply,
} from './judge-parse.mjs';

const IDS = ['engines_four_underwing', 'upper_deck_hump', 'silhouette_747'];

const goodJson = (scores = { engines_four_underwing: 8, upper_deck_hump: 7, silhouette_747: 9 }) =>
  JSON.stringify({
    scores,
    weakest_visible_feature: 'upper_deck_hump',
    notes: 'hump too long',
  });

describe('extractReplyText', () => {
  it('prefers message.content when present (the normal think:false path)', () => {
    const r = extractReplyText({
      message: { content: '{"scores":{}}', thinking: 'irrelevant' },
      done_reason: 'stop',
    });
    expect(r.source).toBe('content');
    expect(r.text).toBe('{"scores":{}}');
    expect(r.doneReason).toBe('stop');
    expect(r.contentLen).toBeGreaterThan(0);
    expect(r.thinkingLen).toBeGreaterThan(0);
  });

  it('falls back to message.thinking when content is empty (thinking-swallow shape)', () => {
    const r = extractReplyText({
      message: { content: '', thinking: '{"scores":{"a":1}}' },
      done_reason: 'stop',
    });
    expect(r.source).toBe('thinking');
    expect(r.text).toBe('{"scores":{"a":1}}');
    expect(r.contentLen).toBe(0);
    expect(r.thinkingLen).toBeGreaterThan(0);
  });

  it('treats whitespace-only content as empty and still falls back to thinking', () => {
    const r = extractReplyText({ message: { content: '  \n\t ', thinking: 'x' } });
    expect(r.source).toBe('thinking');
    expect(r.text).toBe('x');
  });

  it('reports empty with done_reason when both channels are empty (length truncation)', () => {
    const r = extractReplyText({ message: { content: '', thinking: '' }, done_reason: 'length' });
    expect(r.source).toBe('empty');
    expect(r.text).toBe('');
    expect(r.doneReason).toBe('length');
  });

  it('never throws on degenerate bodies (missing message, null, non-strings)', () => {
    expect(extractReplyText({}).source).toBe('empty');
    expect(extractReplyText(null).source).toBe('empty');
    expect(extractReplyText(undefined).source).toBe('empty');
    expect(extractReplyText({ message: { content: 42, thinking: {} } }).source).toBe('empty');
    expect(extractReplyText({ message: null }).source).toBe('empty');
    expect(extractReplyText({ done_reason: 7 }).doneReason).toBeNull();
  });
});

describe('parseJudgeReply', () => {
  it('parses strict JSON with a scores object', () => {
    const p = parseJudgeReply(goodJson(), IDS);
    expect(p.scores).toEqual({ engines_four_underwing: 8, upper_deck_hump: 7, silhouette_747: 9 });
    expect(p.weakestVisible).toBe('upper_deck_hump');
    expect(p.notes).toBe('hump too long');
  });

  it('extracts JSON out of a stray markdown code fence / prose wrapper', () => {
    const wrapped = 'Here is my judgement:\n```json\n' + goodJson() + '\n```\nDone.';
    const p = parseJudgeReply(wrapped, IDS);
    expect(p.scores.silhouette_747).toBe(9);
  });

  it('accepts flat top-level scores when the scores wrapper is missing', () => {
    const p = parseJudgeReply(
      JSON.stringify({ engines_four_underwing: 5, upper_deck_hump: 3, silhouette_747: 4 }),
      IDS,
    );
    expect(p.scores).toEqual({ engines_four_underwing: 5, upper_deck_hump: 3, silhouette_747: 4 });
    expect(p.weakestVisible).toBeNull();
    expect(p.notes).toBe('');
  });

  it('nulls missing criteria and clamps out-of-range values (never zeroes)', () => {
    const p = parseJudgeReply(
      JSON.stringify({ scores: { engines_four_underwing: 15, upper_deck_hump: -2 } }),
      IDS,
    );
    expect(p.scores.engines_four_underwing).toBe(10);
    expect(p.scores.upper_deck_hump).toBe(0);
    expect(p.scores.silhouette_747).toBeNull();
  });

  it('keeps explicit null (not-assessable) and nulls non-numeric junk', () => {
    const p = parseJudgeReply(
      JSON.stringify({
        scores: { engines_four_underwing: null, upper_deck_hump: 'n/a', silhouette_747: '7' },
      }),
      IDS,
    );
    expect(p.scores.engines_four_underwing).toBeNull();
    expect(p.scores.upper_deck_hump).toBeNull();
    expect(p.scores.silhouette_747).toBe(7); // numeric strings coerce
  });

  it('truncates runaway notes to 400 chars and nulls a non-string weakest', () => {
    const p = parseJudgeReply(
      JSON.stringify({ scores: {}, weakest_visible_feature: 3, notes: 'x'.repeat(1000) }),
      IDS,
    );
    expect(p.weakestVisible).toBeNull();
    expect(p.notes).toHaveLength(400);
  });

  it('throws on empty / whitespace-only / non-string input', () => {
    expect(() => parseJudgeReply('', IDS)).toThrow(/empty/);
    expect(() => parseJudgeReply('   \n', IDS)).toThrow(/empty/);
    expect(() => parseJudgeReply(undefined, IDS)).toThrow(/empty/);
  });

  it('throws on text with no JSON object and on truncated JSON', () => {
    expect(() => parseJudgeReply('I cannot judge this image.', IDS)).toThrow(/not JSON/);
    expect(() => parseJudgeReply('{"scores": {"engines_four_underwing": 8', IDS)).toThrow();
  });

  it('rejects JSON that is not an object (array / scalar)', () => {
    expect(() => parseJudgeReply('[1,2,3]', IDS)).toThrow(/not an object/);
    expect(() => parseJudgeReply('42', IDS)).toThrow(/not JSON|not an object/);
  });
});

describe('parseJudgeBody', () => {
  it('parses from content and records provenance', () => {
    const p = parseJudgeBody({ message: { content: goodJson() }, done_reason: 'stop' }, IDS);
    expect(p.scores.engines_four_underwing).toBe(8);
    expect(p.reply_source).toBe('content');
    expect(p.done_reason).toBe('stop');
  });

  it('parses from thinking when content is empty (the measured gemma4 failure shape)', () => {
    const p = parseJudgeBody(
      { message: { content: '', thinking: goodJson() }, done_reason: 'stop' },
      IDS,
    );
    expect(p.scores.silhouette_747).toBe(9);
    expect(p.reply_source).toBe('thinking');
  });

  it("classifies an all-empty reply as retryable 'empty' with done_reason in the message", () => {
    let err;
    try {
      parseJudgeBody({ message: { content: '', thinking: '' }, done_reason: 'length' }, IDS);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.kind).toBe('empty');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/done_reason=length/);
    expect(err.message).toMatch(/content_len=0/);
  });

  it("classifies non-JSON text as retryable 'malformed' with source + done_reason", () => {
    let err;
    try {
      parseJudgeBody(
        { message: { content: 'The model looks like a plane.' }, done_reason: 'stop' },
        IDS,
      );
    } catch (e) {
      err = e;
    }
    expect(err.kind).toBe('malformed');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/via content/);
    expect(err.message).toMatch(/done_reason=stop/);
  });

  it("classifies truncated JSON inside thinking as retryable 'malformed' via thinking", () => {
    let err;
    try {
      parseJudgeBody(
        { message: { content: '', thinking: '{"scores": {"engines' }, done_reason: 'length' },
        IDS,
      );
    } catch (e) {
      err = e;
    }
    expect(err.kind).toBe('malformed');
    expect(err.message).toMatch(/via thinking/);
  });
});

describe('callWithParseRetry (frozen same-seed retry policy)', () => {
  const good = { body: { message: { content: goodJson() }, done_reason: 'stop' }, ms: 10 };
  const empty = { body: { message: { content: '', thinking: '' }, done_reason: 'length' }, ms: 5 };
  const malformed = { body: { message: { content: 'not json' }, done_reason: 'stop' }, ms: 5 };

  it('succeeds first try: one call, parse_retries=0', async () => {
    const calls = [];
    const r = await callWithParseRetry(
      async (attempt) => {
        calls.push(attempt);
        return good;
      },
      IDS,
      1,
    );
    expect(calls).toEqual([0]);
    expect(r.parse_retries).toBe(0);
    expect(r.ms).toBe(10);
    expect(r.scores.upper_deck_hump).toBe(7);
  });

  it('retries an empty reply once with the same closure (same seed) and recovers', async () => {
    const calls = [];
    const replies = [empty, good];
    const r = await callWithParseRetry(
      async (attempt) => {
        calls.push(attempt);
        return replies.shift();
      },
      IDS,
      1,
    );
    expect(calls).toEqual([0, 1]);
    expect(r.parse_retries).toBe(1);
    expect(r.reply_source).toBe('content');
  });

  it('retries a malformed reply and recovers', async () => {
    const replies = [malformed, good];
    const r = await callWithParseRetry(async () => replies.shift(), IDS, 1);
    expect(r.parse_retries).toBe(1);
    expect(r.scores.silhouette_747).toBe(9);
  });

  it('exhausts retries and throws the LAST classified error (fail-open at the seed level)', async () => {
    const calls = [];
    await expect(
      callWithParseRetry(
        async (attempt) => {
          calls.push(attempt);
          return attempt === 0 ? malformed : empty;
        },
        IDS,
        1,
      ),
    ).rejects.toMatchObject({ kind: 'empty', retryable: true });
    expect(calls).toEqual([0, 1]); // exactly maxRetries+1 requests, never more
  });

  it('does not retry at all when maxRetries is 0, missing, or invalid', async () => {
    for (const max of [0, undefined, null, -1, 1.5]) {
      const calls = [];
      await expect(
        callWithParseRetry(
          async (attempt) => {
            calls.push(attempt);
            return empty;
          },
          IDS,
          max,
        ),
      ).rejects.toMatchObject({ kind: 'empty' });
      expect(calls).toEqual([0]);
    }
  });

  it('propagates transport errors from the call immediately (no parse retry burn)', async () => {
    const calls = [];
    await expect(
      callWithParseRetry(
        async (attempt) => {
          calls.push(attempt);
          throw new Error('ollama 500: boom');
        },
        IDS,
        3,
      ),
    ).rejects.toThrow(/ollama 500/);
    expect(calls).toEqual([0]);
  });

  it('rethrows non-retryable errors immediately even with budget left', async () => {
    // Defensive branch: if the parse step ever throws an unclassified
    // (non-retryable) error, the loop must NOT burn retries on it.
    const calls = [];
    const explodingParse = () => {
      throw new Error('programming error: unclassified');
    };
    await expect(
      callWithParseRetry(
        async (attempt) => {
          calls.push(attempt);
          return good;
        },
        IDS,
        3,
        explodingParse,
      ),
    ).rejects.toThrow(/unclassified/);
    expect(calls).toEqual([0]);
  });
});
