import { describe, expect, it } from 'vitest';
import { parseActorStreamBuffer, parseActorStreamLine, summarizeActorStream } from './actor-stream.mjs';

// REWIRE NOTE: these tests used to exercise a JSONL (`--output-format
// stream-json`) classifier for the OLD bare-`claude` actor call. The actor
// now spawns `terransoul-cli --agent-task`, whose stderr progress format is
// plain lines (`cli.rs::print_agentic_event`), not JSONL — see
// actor-stream.mjs's header for the full rationale. These tests cover the
// NEW format.

describe('parseActorStreamLine', () => {
  it('returns null for blank/whitespace lines', () => {
    expect(parseActorStreamLine('')).toBeNull();
    expect(parseActorStreamLine('   \n')).toBeNull();
    expect(parseActorStreamLine('\t')).toBeNull();
  });

  it('returns null for a non-string input', () => {
    expect(parseActorStreamLine(null)).toBeNull();
    expect(parseActorStreamLine(undefined)).toBeNull();
    expect(parseActorStreamLine(42)).toBeNull();
  });

  it('classifies a [tool] progress line with an input summary', () => {
    const out = parseActorStreamLine('[tool] Edit {"file_path":"/x/plane.js","preview":"const y = 1;"}');
    expect(out).toEqual({
      kind: 'tool_use',
      name: 'Edit',
      input_summary: '{"file_path":"/x/plane.js","preview":"const y = 1;"}',
    });
  });

  it('classifies a [tool] line with no summary text as an empty input_summary', () => {
    const out = parseActorStreamLine('[tool] Read');
    expect(out).toEqual({ kind: 'tool_use', name: 'Read', input_summary: '' });
  });

  it('classifies a successful [tool-result] line', () => {
    expect(parseActorStreamLine('[tool-result] Edit ok')).toEqual({
      kind: 'tool_result',
      name: 'Edit',
      is_error: false,
    });
  });

  it('classifies a failed [tool-result] line', () => {
    expect(parseActorStreamLine('[tool-result] Edit FAILED')).toEqual({
      kind: 'tool_result',
      name: 'Edit',
      is_error: true,
    });
  });

  it('classifies anything else (assistant prose, banners, etc.) as text', () => {
    expect(parseActorStreamLine('I looked at the renders and widened the wing sweep.')).toEqual({
      kind: 'text',
      text: 'I looked at the renders and widened the wing sweep.',
    });
  });

  it('does not misclassify a line that merely CONTAINS the tool markers mid-string as tool_use/tool_result', () => {
    // Only a line that STARTS with the marker (after trimming) is special-cased.
    const out = parseActorStreamLine('note: the string "[tool] Edit" appeared in a docstring');
    expect(out.kind).toBe('text');
  });
});

describe('parseActorStreamBuffer', () => {
  it('flattens a multi-line buffer, dropping blank lines', () => {
    const buffer = ['[tool] Read /shots/view-1.png', '', '[tool-result] Read ok', 'thinking...'].join('\n');
    const events = parseActorStreamBuffer(buffer);
    expect(events).toEqual([
      { kind: 'tool_use', name: 'Read', input_summary: '/shots/view-1.png' },
      { kind: 'tool_result', name: 'Read', is_error: false },
      { kind: 'text', text: 'thinking...' },
    ]);
  });

  it('tolerates a trailing partial line (the exact shape a killed/timed-out process leaves behind)', () => {
    const buffer = ['[tool] Read /shots/view-1.png', '[tool] Edit /candidate/plane.js', 'partial tex'].join('\n');
    const events = parseActorStreamBuffer(buffer);
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({ kind: 'text', text: 'partial tex' });
  });

  it('returns [] for an empty/missing buffer', () => {
    expect(parseActorStreamBuffer('')).toEqual([]);
    expect(parseActorStreamBuffer(undefined)).toEqual([]);
    expect(parseActorStreamBuffer(null)).toEqual([]);
  });
});

describe('summarizeActorStream', () => {
  it('tallies tool calls, text chunks, and tool failures across a realistic transcript', () => {
    const buffer = [
      '[tool] Read /shots/view-1.png',
      '[tool-result] Read ok',
      '[tool] Read /shots/view-2.png',
      '[tool-result] Read ok',
      '[tool] Edit /candidate/plane.js',
      '[tool-result] Edit ok',
      'Adjusted the wing sweep angle.',
    ].join('\n');
    const summary = summarizeActorStream(parseActorStreamBuffer(buffer));
    expect(summary.tool_calls).toEqual({ Read: 2, Edit: 1 });
    expect(summary.total_tool_calls).toBe(3);
    expect(summary.text_chunks).toBe(1);
    expect(summary.tool_failures).toBe(0);
    expect(summary.event_count).toBe(7);
  });

  it('counts a FAILED tool-result as a tool failure without excluding it from the tool tally', () => {
    const buffer = ['[tool] Edit /candidate/plane.js', '[tool-result] Edit FAILED'].join('\n');
    const summary = summarizeActorStream(parseActorStreamBuffer(buffer));
    expect(summary.tool_calls).toEqual({ Edit: 1 });
    expect(summary.tool_failures).toBe(1);
  });

  it('summarizes an empty/no-event transcript without throwing', () => {
    const summary = summarizeActorStream([]);
    expect(summary).toEqual({
      event_count: 0,
      tool_calls: {},
      total_tool_calls: 0,
      text_chunks: 0,
      tool_failures: 0,
    });
  });

  it('tolerates a nullish events array', () => {
    expect(summarizeActorStream(null)).toEqual({
      event_count: 0,
      tool_calls: {},
      total_tool_calls: 0,
      text_chunks: 0,
      tool_failures: 0,
    });
    expect(summarizeActorStream(undefined).event_count).toBe(0);
  });
});
