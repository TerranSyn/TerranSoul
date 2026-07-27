// Regression guard for the deterministic Boeing-747 geometry-correctness test.
// Enforces "never accept a score below 100" for the certified build, and that
// the test still DISCRIMINATES (broken builds score low) so the 100 is earned,
// not rubber-stamped. Runs geometry-check.mjs as a subprocess and parses --json.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(DIR, 'geometry-check.mjs');

function score(candidate) {
  const plane = path.join(DIR, 'candidates', candidate, 'plane.js');
  const out = execFileSync(process.execPath, [CHECK, plane, '--json'], { encoding: 'utf8' });
  return JSON.parse(out).total_0_100;
}

describe('boeing747 deterministic geometry-correctness', () => {
  it('the certified build scores a PERFECT, reproducible 100 (never accept less)', () => {
    const s = score('terransoul-optimized');
    expect(s).toBe(100);
  });

  it('is deterministic — same score on a second run', () => {
    expect(score('terransoul-optimized')).toBe(score('terransoul-optimized'));
  });

  it('DISCRIMINATES — broken/incomplete builds score well below 100', () => {
    expect(score('terransoul-gemma-teach-test')).toBeLessThan(60); // flat disc
    expect(score('terransoul-bonsai-spec-s8')).toBeLessThan(50);   // vertical fuselage
    expect(score('terransoul-gemma-s5')).toBeLessThan(95);         // decent-but-imperfect gemma build
  });
});
