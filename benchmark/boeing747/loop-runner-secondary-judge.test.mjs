// Regression test for the credit-conscious gemma-only run mode: every
// iteration used to unconditionally spawn a second, paid Claude/Fable-5
// vision judge (judge-claude.mjs / judge-pairwise.mjs) regardless of
// `--judge`, even on the default 'gemma' track where Claude was purely a
// reported, non-gating diversity cross-check. `--secondary-judge none`
// skips that call entirely (zero Anthropic API calls), but Claude Opus is
// the SOLE GATING judge in opus-panel/opus-pairwise mode, so disabling it
// there would silently gate on nothing — refused with a clear error instead.
import { describe, expect, it } from 'vitest';
import { runIterationTerransoul } from './loop-runner-terransoul.mjs';

describe('--secondary-judge none is refused when Claude is the gating judge', () => {
  it('rejects opus-panel + secondary-judge none before any judge/actor call is attempted', async () => {
    await expect(
      runIterationTerransoul({
        planePath: 'irrelevant-never-read.js',
        judgeMode: 'opus-panel',
        secondaryJudge: 'none',
      }),
    ).rejects.toThrow(/--secondary-judge none is incompatible with --judge opus-panel/);
  });
});
