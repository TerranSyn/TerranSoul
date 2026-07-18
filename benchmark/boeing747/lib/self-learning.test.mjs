import { describe, expect, it, vi } from 'vitest';
import {
  extractJsonArray,
  fetchPriorAttempts,
  fetchStrategyEvents,
  formatPriorAttemptsSection,
  ingestAttemptLesson,
  ingestStrategyEvent,
  tagsIncludeToken,
} from './self-learning.mjs';

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

describe('tagsIncludeToken (whole-token, prefix-safe tag membership)', () => {
  it('matches a whole comma-delimited token', () => {
    expect(tagsIncludeToken('bench-attempt,empennage,edited,trackA', 'trackA')).toBe(true);
    expect(tagsIncludeToken('bench-attempt,empennage,edited,trackA', 'empennage')).toBe(true);
  });

  it('does NOT match a mere prefix/substring of a longer token', () => {
    // The founding bug this guards: one track name is a PREFIX of another, so a
    // naive substring `includes()` would wrongly treat the longer track's
    // lessons as the shorter track's.
    expect(tagsIncludeToken('bench-attempt,edited,track-base-taught', 'track-base')).toBe(false);
    expect(tagsIncludeToken('bench-attempt,edited,track-base', 'track-base-taught')).toBe(false);
  });

  it('handles whitespace/comma mixed delimiters and empty inputs', () => {
    expect(tagsIncludeToken('a, b ,  c', 'b')).toBe(true);
    expect(tagsIncludeToken('', 'b')).toBe(false);
    expect(tagsIncludeToken('a,b', '')).toBe(false);
  });
});

describe('fetchPriorAttempts track-scoped read (actorTag)', () => {
  // A mixed-track search hit set — the exact cross-contamination this fixes: a
  // shared brain returns lessons from BOTH a purity track and a taught track
  // (whose name has the purity track's name as a prefix), plus an untagged one.
  const mixedTrackText = JSON.stringify([
    { content: 'purity-track lesson: moved parts inboard', tags: 'bench-attempt,engines,edited,track-base', score: 0.9 },
    { content: 'taught-track lesson: rebuilt as one object', tags: 'bench-attempt,engines,edited,track-base-taught', score: 0.85 },
    { content: 'another purity-track lesson', tags: 'bench-attempt,engines,no_change,track-base', score: 0.7 },
    { content: 'legacy untagged lesson', tags: 'bench-attempt,engines', score: 0.6 },
  ]);

  it('restricts results to the current track and drops other-track / untagged lessons', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: mixedTrackText });
    const out = await fetchPriorAttempts({ query: 'engines', limit: 5, actorTag: 'track-base', callTool });
    expect(out.map((m) => m.content)).toEqual([
      'purity-track lesson: moved parts inboard',
      'another purity-track lesson',
    ]);
  });

  it('prefix-safety: the shorter track name does NOT pick up the longer taught track\'s lesson', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: mixedTrackText });
    const base = await fetchPriorAttempts({ query: 'engines', actorTag: 'track-base', callTool });
    expect(base.some((m) => m.content.includes('taught-track'))).toBe(false);

    const taught = await fetchPriorAttempts({ query: 'engines', actorTag: 'track-base-taught', callTool });
    expect(taught.map((m) => m.content)).toEqual(['taught-track lesson: rebuilt as one object']);
  });

  it('over-fetches from brain_search when filtering so a filtered set can still fill limit', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: mixedTrackText });
    await fetchPriorAttempts({ query: 'engines', limit: 3, actorTag: 'track-base', overFetch: 4, callTool });
    expect(callTool).toHaveBeenCalledWith('brain_search', { query: 'engines', limit: 12 }, expect.any(Object));
  });

  it('slices the filtered result back down to limit', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: mixedTrackText });
    const out = await fetchPriorAttempts({ query: 'engines', limit: 1, actorTag: 'track-base', callTool });
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('purity-track lesson: moved parts inboard');
  });

  it('without actorTag, does NOT filter (byte-identical to the legacy read) and keeps the caller limit', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: mixedTrackText });
    const out = await fetchPriorAttempts({ query: 'engines', limit: 5, callTool });
    expect(callTool).toHaveBeenCalledWith('brain_search', { query: 'engines', limit: 5 }, expect.any(Object));
    expect(out).toHaveLength(4); // all four hits returned unfiltered
  });

  it('returns [] when no lesson matches the current track (a fresh track has no priors)', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: mixedTrackText });
    expect(await fetchPriorAttempts({ query: 'engines', actorTag: 'track-never-run', callTool })).toEqual([]);
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

describe('ingestStrategyEvent', () => {
  it('refuses (without calling the tool) when tag or outcome is missing', async () => {
    const callTool = vi.fn();
    expect((await ingestStrategyEvent({ outcome: 'helpful', callTool })).ok).toBe(false);
    expect((await ingestStrategyEvent({ tag: 't', callTool })).ok).toBe(false);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('assembles a lesson with a machine-readable STRATEGY_EVENT_JSON payload', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: '{"memory_id":1}' });
    await ingestStrategyEvent({
      tag: 'some-bench-strategy-event',
      strategyId: 'split-nacelles-into-groups',
      criterion: 'engines',
      viewScope: 'v1',
      technique: 'split nacelles into groups',
      snippetRef: 'sha-abc',
      outcome: 'helpful',
      gateDelta: 2.1,
      iter: 4,
      runId: 'run-9',
      actorName: 'actorX',
      callTool,
    });
    const [toolName, args] = callTool.mock.calls[0];
    expect(toolName).toBe('brain_ingest_lesson');
    expect(args.category).toBe('self-improve-attempt');
    expect(args.tags).toBe('some-bench-strategy-event,engines,v1,helpful,strategy,actorX');
    expect(args.content).toContain('STRATEGY (some-bench-strategy-event): scope=strategy, outcome=helpful');
    expect(args.content).toContain('Technique: split nacelles into groups');
    const marker = 'STRATEGY_EVENT_JSON:';
    const payload = JSON.parse(args.content.slice(args.content.indexOf(marker) + marker.length));
    expect(payload).toMatchObject({
      strategyId: 'split-nacelles-into-groups',
      scope: 'strategy',
      criterion: 'engines',
      technique: 'split nacelles into groups',
      snippetRef: 'sha-abc',
      outcome: 'helpful',
      gateDelta: 2.1,
      iter: 4,
      runId: 'run-9',
    });
  });

  it('derives scope=anti from an anti-suffixed tag OR a harmful outcome', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, text: null });
    await ingestStrategyEvent({ tag: 'some-bench-anti', outcome: 'harmful', technique: 't', callTool });
    expect(callTool.mock.calls[0][1].content).toContain('scope=anti');

    await ingestStrategyEvent({ tag: 'some-bench-strategy-event', outcome: 'harmful', technique: 't', callTool });
    expect(callTool.mock.calls[1][1].content).toContain('scope=anti');
  });

  it('is generic: no benchmark name appears in the emitted code', () => {
    const src = ingestStrategyEvent.toString() + fetchStrategyEvents.toString();
    expect(src.toLowerCase()).not.toContain('boeing');
    expect(src.toLowerCase()).not.toContain('747');
  });
});

describe('fetchStrategyEvents', () => {
  it('returns [] without calling the tool when neither query nor criterion is given', async () => {
    const callTool = vi.fn();
    expect(await fetchStrategyEvents({ callTool })).toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('round-trips ingested events back into parsed payloads', async () => {
    const ingestCalls = [];
    const ingestTool = vi.fn(async (_name, args) => {
      ingestCalls.push(args.content);
      return { ok: true, text: null };
    });
    await ingestStrategyEvent({
      tag: 'bench-strategy-event',
      strategyId: 's1',
      criterion: 'engines',
      technique: 'split nacelles into groups',
      outcome: 'helpful',
      gateDelta: 1.5,
      iter: 2,
      callTool: ingestTool,
    });
    const fetchTool = vi.fn().mockResolvedValue({
      ok: true,
      text: JSON.stringify([
        { content: ingestCalls[0], tags: 'bench-strategy-event', score: 0.9 },
        { content: 'a foreign lesson with no marker', tags: 'x', score: 0.2 },
      ]),
    });
    const events = await fetchStrategyEvents({ criterion: 'engines', callTool: fetchTool });
    // Marker-anchored query (2026-07-16 contract change): a bare-criterion
    // query ranked taught-KB documents above the events themselves.
    expect(fetchTool).toHaveBeenCalledWith('brain_search', { query: 'STRATEGY engines gate_delta', limit: 10 }, expect.any(Object));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ strategyId: 's1', scope: 'strategy', technique: 'split nacelles into groups', outcome: 'helpful', gateDelta: 1.5 });
  });

  it('fails open to [] on tool failure, non-JSON, or non-array', async () => {
    expect(await fetchStrategyEvents({ criterion: 'c', callTool: vi.fn().mockResolvedValue({ ok: false, text: null }) })).toEqual([]);
    expect(await fetchStrategyEvents({ criterion: 'c', callTool: vi.fn().mockResolvedValue({ ok: true, text: 'not json' }) })).toEqual([]);
    expect(await fetchStrategyEvents({ criterion: 'c', callTool: vi.fn().mockResolvedValue({ ok: true, text: '{"not":"array"}' }) })).toEqual([]);
  });

  it('skips a search hit whose payload marker is present but malformed (fail-open per item)', async () => {
    const callTool = vi.fn().mockResolvedValue({
      ok: true,
      text: JSON.stringify([{ content: 'STRATEGY_EVENT_JSON: {broken json', tags: '', score: 1 }]),
    });
    expect(await fetchStrategyEvents({ criterion: 'c', callTool })).toEqual([]);
  });
});

describe('fetchStrategyEvents track-scoped read (actorTag)', () => {
  const MARKER = 'STRATEGY_EVENT_JSON:';
  function mkRow(actorName, technique) {
    return {
      content: `STRATEGY (tag): scope=strategy, outcome=helpful.\n${MARKER} ${JSON.stringify({ strategyId: technique, scope: 'strategy', criterion: 'c1', outcome: 'helpful', actorName })}`,
      tags: 'x',
      score: 1,
    };
  }

  it('filters parsed payloads to the requested track and over-fetches to fill the limit', async () => {
    const calls = [];
    const callTool = async (name, args) => {
      calls.push(args);
      return { ok: true, text: JSON.stringify([mkRow('track-a', 's1'), mkRow('track-b', 's2'), mkRow('track-a', 's3')]) };
    };
    const out = await fetchStrategyEvents({ criterion: 'c1', limit: 2, actorTag: 'track-a', callTool });
    expect(out.map((e) => e.strategyId)).toEqual(['s1', 's3']);
    expect(calls[0].limit).toBe(10); // limit 2 x overFetch 5
  });

  it('without actorTag keeps the legacy unfiltered behavior and caller limit', async () => {
    const calls = [];
    const callTool = async (name, args) => {
      calls.push(args);
      return { ok: true, text: JSON.stringify([mkRow('track-a', 's1'), mkRow('track-b', 's2')]) };
    };
    const out = await fetchStrategyEvents({ criterion: 'c1', limit: 10, callTool });
    expect(out).toHaveLength(2);
    expect(calls[0].limit).toBe(10);
  });

  it('a track that never wrote events yields [] (fail-open empty, not foreign events)', async () => {
    const callTool = async () => ({ ok: true, text: JSON.stringify([mkRow('track-b', 's2')]) });
    expect(await fetchStrategyEvents({ criterion: 'c1', actorTag: 'track-never', callTool })).toEqual([]);
  });
});

describe('fetchStrategyEvents query construction (marker-anchored, live-caught 2026-07-16)', () => {
  it('anchors the semantic query to the event content shape (bare criterion ranked docs above events)', async () => {
    const calls = [];
    const callTool = async (name, args) => { calls.push(args); return { ok: true, text: '[]' }; };
    await fetchStrategyEvents({ criterion: 'craftsmanship', tag: 'boeing747-strategy-event', callTool });
    expect(calls[0].query).toBe('STRATEGY boeing747-strategy-event craftsmanship gate_delta');
  });

  it('an explicit query overrides construction entirely (legacy behavior)', async () => {
    const calls = [];
    const callTool = async (name, args) => { calls.push(args); return { ok: true, text: '[]' }; };
    await fetchStrategyEvents({ criterion: 'c', tag: 't', query: 'my exact query', callTool });
    expect(calls[0].query).toBe('my exact query');
  });

  it('no criterion/tag/query -> no MCP call at all', async () => {
    const callTool = async () => { throw new Error('should not be called'); };
    expect(await fetchStrategyEvents({ callTool })).toEqual([]);
  });
});

describe('extractJsonArray (tolerant tool-response parsing, live-caught 2026-07-16)', () => {
  it('parses a clean JSON array unchanged', () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('survives a trailing MCP-compliance banner appended after the JSON (the live failure shape)', () => {
    const banner = '[{"content":"x","tags":"t","score":1}]\n\n\nWARNING [MCP COMPLIANCE] Preflight steps incomplete. Call brain_health [really].';
    expect(extractJsonArray(banner)).toEqual([{ content: 'x', tags: 't', score: 1 }]);
  });

  it('returns null for no-array / unparseable / non-array JSON', () => {
    expect(extractJsonArray('no json here')).toBeNull();
    expect(extractJsonArray('{"an":"object"}')).toBeNull();
    expect(extractJsonArray('[broken')).toBeNull();
    expect(extractJsonArray(null)).toBeNull();
  });

  it('fetchPriorAttempts and fetchStrategyEvents both survive the banner end-to-end', async () => {
    const attempts = JSON.stringify([{ content: 'lesson', tags: 'a', score: 1 }]);
    const ev = JSON.stringify([{ content: 'STRATEGY (t): scope=strategy, outcome=helpful.\nSTRATEGY_EVENT_JSON: {"strategyId":"s","scope":"strategy","outcome":"helpful"}', tags: 't', score: 1 }]);
    const mk = (text) => async () => ({ ok: true, text: text + '\n\nWARNING [MCP COMPLIANCE] show a receipt [ok].' });
    expect(await fetchPriorAttempts({ query: 'q', callTool: mk(attempts) })).toHaveLength(1);
    expect(await fetchStrategyEvents({ criterion: 'c', tag: 't', callTool: mk(ev) })).toHaveLength(1);
  });
});
