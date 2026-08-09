// Progress-line classifier/observability summarizer for the Boeing 747
// autonomous actor's `terransoul --agent-task` calls
// (benchmark/boeing747/actor/actor-claude.mjs). NOT frozen — part of the
// WIRE-CLI-an internal work item rewire (2026-07-10).
//
// REWIRE NOTE: this module previously parsed the bare `claude --output-
// format stream-json --verbose` JSONL directly (LESSON BOEING-747-ACTOR-
// RETRY-1's fix 3), back when actor-claude.mjs spawned the `claude` binary
// itself. The actor now spawns `terransoul --agent-task` instead
// (TerranSoul's own generic agentic-edit CLI capability,
// internal module, which internally drives `claude` via
// internal module and does its OWN JSONL parsing in Rust) —
// so the raw `claude` JSONL stream is no longer visible to this Node
// harness at all. What IS visible:
//   - stderr: `terransoul`'s own human-readable progress lines, printed
//     by `internal module::print_agentic_event` — `[tool] <name> <input_summary>`,
//     `[tool-result] <name> (ok|FAILED)`, and raw assistant text chunks
//     (printed via `eprint!` with no prefix, so they arrive as ordinary
//     lines here).
//   - stdout (only on a clean exit): ONE line of JSON — the final
//     `AgenticTaskOutcome` (`result_text`/`cost_usd`/`duration_ms`/
//     `tool_calls`), parsed directly in actor-claude.mjs — no line-by-line
//     reconstruction needed there since the CLI already tallies tool calls
//     for us on success.
// This module now only classifies the STDERR progress stream — its
// PURPOSE is unchanged (fix 3: give a killed/timed-out/denied call real
// evidence instead of a black box), but the shape it parses is a plain
// progress-line format, not JSONL, so the old `parseActorStreamLine`
// (assistant/tool_use/result/system JSONL variants) and `findResultEvent`/
// `summarizeToolInput` helpers built for that format are gone — a killed
// call's terminal outcome is now "no stdout JSON was ever produced",
// tracked by the caller (actor-claude.mjs), not reconstructed from stderr.
//
// Pure — no I/O. Exercised directly by vitest with fixture line buffers.

/**
 * Classify ONE stderr line from a `terransoul --agent-task` run.
 * Returns `null` for a blank/whitespace-only line, otherwise one event:
 *   - `{kind:'tool_use', name, input_summary}` for a `[tool] <name> ...` line
 *   - `{kind:'tool_result', name, is_error}` for a `[tool-result] <name> (ok|FAILED)` line
 *   - `{kind:'text', text}` for anything else (assistant prose, banner text, etc.)
 */
export function parseActorStreamLine(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const toolUse = trimmed.match(/^\[tool\]\s+(\S+)\s*(.*)$/);
  if (toolUse) {
    return { kind: 'tool_use', name: toolUse[1], input_summary: toolUse[2] || '' };
  }

  const toolResult = trimmed.match(/^\[tool-result\]\s+(\S+)\s+(ok|FAILED)$/);
  if (toolResult) {
    return { kind: 'tool_result', name: toolResult[1], is_error: toolResult[2] === 'FAILED' };
  }

  return { kind: 'text', text: trimmed };
}

/**
 * Flatten a raw stderr buffer (accumulated across the whole call — tolerant
 * of a trailing partial line from a killed process, since a partial line
 * with no newline is still classified, just possibly as `text`) into a flat
 * chronological list of classified events. Blank lines are dropped.
 */
export function parseActorStreamBuffer(text) {
  const events = [];
  for (const line of String(text || '').split('\n')) {
    const parsed = parseActorStreamLine(line);
    if (parsed) events.push(parsed);
  }
  return events;
}

/**
 * Reduce a chronological list of classified events into an observability
 * summary: tool-call tally (by name), text-chunk count, and whether any
 * `[tool-result] ... FAILED` was observed — the evidence a timed-out or
 * denied call otherwise leaves nothing behind.
 */
export function summarizeActorStream(events) {
  const toolCalls = {};
  let textChunks = 0;
  let toolFailures = 0;
  let eventCount = 0;
  for (const e of events || []) {
    if (!e) continue;
    eventCount += 1;
    if (e.kind === 'tool_use') {
      toolCalls[e.name] = (toolCalls[e.name] || 0) + 1;
    } else if (e.kind === 'tool_result') {
      if (e.is_error) toolFailures += 1;
    } else if (e.kind === 'text') {
      textChunks += 1;
    }
  }
  const totalToolCalls = Object.values(toolCalls).reduce((a, b) => a + b, 0);
  return {
    event_count: eventCount,
    tool_calls: toolCalls,
    total_tool_calls: totalToolCalls,
    text_chunks: textChunks,
    tool_failures: toolFailures,
  };
}
