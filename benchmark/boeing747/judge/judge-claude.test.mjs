// Tests for the callClaudeCliVision extraction (PAIRWISE_JUDGE_SPEC transport
// reuse). judge-claude.mjs factored its `claude` CLI spawn out of the pointwise
// callClaudeVision into an exported, execImpl-injectable callClaudeCliVision so
// the new opus-pairwise judge (judge/judge-pairwise.mjs) can reuse the exact
// same transport. These tests pin the argv shape + the success/error grammar so
// the extraction stays a pure factoring (the pointwise track's behavior is
// unchanged; it still calls this then parseJudgeReply).
//
// No `claude` binary is ever spawned — execImpl is mocked, so the suite is
// deterministic and CI-safe (the real live vision calls stay local-only).
import { describe, expect, it, vi } from 'vitest';
import { callClaudeCliVision } from './judge-claude.mjs';

const okOuter = (result, overrides = {}) =>
  JSON.stringify({ subtype: 'success', is_error: false, result, total_cost_usd: 0.0123, duration_ms: 4321, ...overrides });

describe('callClaudeCliVision (shared transport seam)', () => {
  it('spawns `claude` with the frozen judge argv shape and returns the raw result/cost/ms', async () => {
    const execImpl = vi.fn(async () => ({ stdout: okOuter('{"scores":{}}') }));

    const out = await callClaudeCliVision({ prompt: 'JUDGE THIS', execImpl });

    expect(execImpl).toHaveBeenCalledTimes(1);
    const [binary, args, opts] = execImpl.mock.calls[0];
    expect(binary).toBe('claude');
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe('JUDGE THIS');
    expect(args).toEqual(
      expect.arrayContaining([
        '--output-format',
        'json',
        '--allowedTools',
        'Read',
        '--disallowedTools',
        'WebSearch,WebFetch,Bash,Edit,Write,Task',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--add-dir',
      ]),
    );
    // no --model unless one is supplied
    expect(args).not.toContain('--model');
    expect(opts.windowsHide).toBe(true);
    expect(opts.maxBuffer).toBe(16 * 1024 * 1024);

    expect(out.resultText).toBe('{"scores":{}}');
    expect(out.cost).toBeCloseTo(0.0123);
    expect(out.ms).toBe(4321);
  });

  it('appends --model when a model override is supplied', async () => {
    const execImpl = vi.fn(async () => ({ stdout: okOuter('{}') }));
    await callClaudeCliVision({ prompt: 'x', model: 'claude-opus-4-8', execImpl });
    const [, args] = execImpl.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['--model', 'claude-opus-4-8']));
  });

  it('throws a clear error when the CLI stdout is not JSON', async () => {
    const execImpl = vi.fn(async () => ({ stdout: 'not json at all' }));
    await expect(callClaudeCliVision({ prompt: 'x', execImpl })).rejects.toThrow(/did not return JSON/);
  });

  it('throws when the CLI reports an error subtype rather than success', async () => {
    const execImpl = vi.fn(async () => ({
      stdout: JSON.stringify({ subtype: 'error_max_turns', is_error: true, result: 'boom' }),
    }));
    await expect(callClaudeCliVision({ prompt: 'x', execImpl })).rejects.toThrow(/claude judge error/);
  });

  it('throws when result is missing/non-string even on a success subtype', async () => {
    const execImpl = vi.fn(async () => ({ stdout: JSON.stringify({ subtype: 'success', is_error: false }) }));
    await expect(callClaudeCliVision({ prompt: 'x', execImpl })).rejects.toThrow(/claude judge error/);
  });
});
