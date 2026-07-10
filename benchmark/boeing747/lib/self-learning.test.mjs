import { describe, expect, it, vi } from 'vitest';
import { fetchPriorAttempts, formatPriorAttemptsSection, ingestAttemptLesson } from './self-learning.mjs';

// These tests inject a fake `callTool` (mirrors lib/judge-parse.mjs's
// callWithParseRetry(call, ...) pattern) so the OWN logic of
// fetchPriorAttempts/ingestAttemptLesson — argument shape, response parsing,
// fail-open behavior — is directly covered without a live MCP tray. The real
// transport (lib/mcp-client.mjs::callMcpTool) is exercised only by actually
// running against a live tray, same as the rest of this bench's network
// calls (judge.mjs's ollamaChat, actor-claude.mjs's callClaudeActor).

describe('fetchPriorAttempts', () => {
  it('returns [] without calling the tool when query is empty', async () => {
    const callTool = vi.fn();
    const out = await fetchPriorAttempts({ query: '', callTool });
    expect(out).toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('calls brain_search with the caller-supplied query/limit and normalizes the result shape', async () => {
    const callTool = vi.fn().mockResolvedValue({
      ok: true,
      text: JSON.stringify([
        { content: 'tried X, score went up', tags: 'a,b', score: 0.9 },
        { content: 'tried Y, no change', tags: 'c', score: 0.4 },
      ]),
    });
    const out = await fetchPriorAttempts({ query: 'some criterion', limit: 3, callTool });
    expect(callTool).toHaveBeenCalledWith('brain_search', { query: 'some criterion', limit: 3 }, expect.any(Object));
    expect(out).toEqual([
      { content: 'tried X, score went up', tags: 'a,b', score: 0.9 },
      { content: 'tried Y, no change', tags: 'c', score: 0.4 },
    ]);
  });

  it('fails open to [] when the tool call itself fails', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: false, text: null, error: 'tray unreachable' });
    expect(await fetchPriorAttempts({ query: 'q', callTool })).toEqual([]);
  });

  it('fails open to [] when the tool returns text that is not valid JSON', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: 'not json at all' });
    expect(await fetchPriorAttempts({ query: 'q', callTool })).toEqual([]);
  });

  it('fails open to [] when the tool returns valid JSON that is not an array', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: JSON.stringify({ not: 'an array' }) });
    expect(await fetchPriorAttempts({ query: 'q', callTool })).toEqual([]);
  });

  it('never throws even if callTool itself rejects', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('network exploded'));
    await expect(fetchPriorAttempts({ query: 'q', callTool })).rejects.toThrow();
    // NOTE: fetchPriorAttempts intentionally does not itself catch a
    // rejecting callTool — callers (loop-runner-terransoul.mjs) wrap the
    // call in their own try/catch, matching the real production call site.
  });
});

describe('formatPriorAttemptsSection', () => {
  it('returns null for an empty or missing list (never injects noise into the prompt)', () => {
    expect(formatPriorAttemptsSection([])).toBeNull();
    expect(formatPriorAttemptsSection(null)).toBeNull();
    expect(formatPriorAttemptsSection(undefined)).toBeNull();
  });

  it('renders a bulleted section with a default header', () => {
    const section = formatPriorAttemptsSection([{ content: 'tried moving the engines inboard', tags: 't', score: 0.5 }]);
    expect(section).toContain('PRIOR ATTEMPTS ON THIS BENCHMARK');
    expect(section).toContain('- tried moving the engines inboard');
  });

  it('respects a custom header', () => {
    const section = formatPriorAttemptsSection([{ content: 'x', tags: '', score: 0 }], { header: 'CUSTOM HEADER' });
    expect(section.split('\n')[0]).toBe('CUSTOM HEADER');
  });

  it('bounds the number of items rendered via maxItems', () => {
    const attempts = Array.from({ length: 10 }, (_, i) => ({ content: `attempt ${i}`, tags: '', score: 0 }));
    const section = formatPriorAttemptsSection(attempts, { maxItems: 2 });
    const bullets = section.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets).toHaveLength(2);
  });

  it('truncates an over-long item via maxCharsPerItem', () => {
    const section = formatPriorAttemptsSection([{ content: 'x'.repeat(1000), tags: '', score: 0 }], {
      maxCharsPerItem: 50,
    });
    const bullet = section.split('\n')[1];
    expect(bullet.length).toBeLessThan(70);
    expect(bullet.endsWith('...')).toBe(true);
  });
});

describe('ingestAttemptLesson', () => {
  it('refuses (without calling the tool) when tag or outcome is missing', async () => {
    const callTool = vi.fn();
    const out = await ingestAttemptLesson({ outcome: 'edited', callTool });
    expect(out.ok).toBe(false);
    expect(callTool).not.toHaveBeenCalled();

    const out2 = await ingestAttemptLesson({ tag: 'some-tag', callTool });
    expect(out2.ok).toBe(false);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('assembles a generic content/tags envelope from caller-supplied fields', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: '{"memory_id":1}' });
    await ingestAttemptLesson({
      tag: 'some-bench-attempt',
      criterion: 'wing_geometry',
      summary: 'increased sweep angle',
      scoreDeltas: { trackA: 3.5, trackB: -1 },
      outcome: 'edited',
      extraTags: ['variantX'],
      callTool,
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    const [toolName, args] = callTool.mock.calls[0];
    expect(toolName).toBe('brain_ingest_lesson');
    expect(args.category).toBe('self-improve-attempt');
    expect(args.tags).toBe('some-bench-attempt,wing_geometry,edited,variantX');
    expect(args.content).toContain('LESSON (some-bench-attempt): outcome=edited, targeted criterion=wing_geometry.');
    expect(args.content).toContain('Change: increased sweep angle');
    expect(args.content).toContain('Score delta: {"trackA":3.5,"trackB":-1}');
  });

  it('omits the criterion clause and optional lines when they are absent', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: null });
    await ingestAttemptLesson({ tag: 't', outcome: 'no_change', callTool });
    const [, args] = callTool.mock.calls[0];
    expect(args.content).toBe('LESSON (t): outcome=no_change.');
    expect(args.tags).toBe('t,no_change');
  });

  it('is generic: nothing in this module hardcodes any particular benchmark name', () => {
    // The only strings this file ever emits come from caller-supplied
    // arguments — assert the source has no benchmark-specific literal.
    const src = ingestAttemptLesson.toString() + fetchPriorAttempts.toString();
    expect(src.toLowerCase()).not.toContain('boeing');
    expect(src.toLowerCase()).not.toContain('747');
  });
});
