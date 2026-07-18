// Source-shape regression guard for the DIRECT (non-best-of-N) actor call in
// loop-runner-terransoul.mjs. WHY THIS EXISTS (live-caught 2026-07-17): the
// direct path built `designReferenceSection` every iteration — the taught
// track's RAG --ask ran and was paid for — but the call site never passed it
// to runActorWithRetries, so the retrieved reference silently never reached
// the actor prompt. Only the best-of-N actorBase forwarded it. An omission at
// a call site is invisible to unit tests of the section builders themselves
// (they all pass), so this guard asserts the call-site shape directly —
// same pragmatic precedent as lib/seed-purity.test.mjs's source greps.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_SOURCE = readFileSync(path.join(HERE, 'loop-runner-terransoul.mjs'), 'utf8');

/** Extract the argument block of the direct `runActorWithRetries({...})` call. */
function directActorCallBlock(source) {
  const marker = 'actorResult = await runActorWithRetries({';
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const end = source.indexOf('});', start);
  return end < 0 ? null : source.slice(start, end);
}

describe('direct actor call forwards every additive prompt section', () => {
  const block = directActorCallBlock(RUNNER_SOURCE);

  it('finds the direct runActorWithRetries call site', () => {
    expect(block).toBeTruthy();
  });

  for (const section of [
    'priorAttemptsSection',
    'designReferenceSection',
    'strategyCheatsheetSection',
    'badAttemptsSection',
    'rejectedEditsSection',
    'plateauEscalation',
    'burstStatusSection',
    'measuredFeedbackSection',
  ]) {
    it(`passes ${section}`, () => {
      expect(block).toContain(section);
    });
  }
});
