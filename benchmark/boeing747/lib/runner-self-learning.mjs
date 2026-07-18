// Fix-4 cross-iteration self-learning seams (read + write halves) plus the
// genuine-actor-status set, extracted VERBATIM from loop-runner-terransoul.mjs
// (max-lines refactor, 2026-07-18). Only the module-local imports and `export`
// keywords were added by the move — no logic changed. The domain strings here
// remain argument VALUES passed to the GENERIC lib/self-learning.mjs functions
// (rules/brain-driven-self-improvement.md, rules/bench-agi-purity.md) — those
// functions never hardcode them.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fetchPriorAttempts, formatPriorAttemptsSection, ingestAttemptLesson } from './self-learning.mjs';

// Domain-specific ONLY as an argument value passed to the generic
// lib/self-learning.mjs functions — those functions never hardcode this
// string themselves (rules/brain-driven-self-improvement.md,
// rules/bench-agi-purity.md).
const SELF_LEARNING_TAG = 'boeing747-actor-attempt';
// Statuses actor-claude.mjs/runActorWithRetries can produce that reflect a
// REAL attempt (as opposed to a pure infra failure never worth learning from
// or counting toward stall/threshold/budget).
export const GENUINE_ACTOR_STATUSES = new Set(['edited', 'no_change', 'contract_failed', 'runtime_failed']);

/**
 * Fix 4 (cross-iteration self-learning, read half): fetch prior attempts on
 * THIS weakest feature from the brain and format them into a prompt section.
 * Fails open (fetchPriorAttempts never throws) — a down/unreachable MCP tray
 * simply means no prior-attempts section this iteration.
 */
export async function buildPriorAttemptsSection({ weakestId, actorName }) {
  const query = `${SELF_LEARNING_TAG} ${weakestId || 'general'}`;
  // TRACK-SCOPED read (2026-07-16): the write half already stamps every lesson
  // with this track's name (maybeIngestPriorIterationLesson's
  // extraTags:[actorName]); passing it back as actorTag keeps two tracks
  // sharing one brain from cross-contaminating each other's attempt lessons —
  // in particular, a v2-gate era's rejected-attempt lessons must not steer a
  // v3-gate era away from the very edit class the redesigned gate now accepts.
  const priorAttempts = await fetchPriorAttempts({ query, limit: 5, actorTag: actorName });
  return formatPriorAttemptsSection(priorAttempts);
}

/**
 * The prose of a criterion's HIGHEST-scored anchor — the rubric's own
 * definition of what "right" looks like for that criterion. Used to build the
 * design-reference retrieval query from the criterion's actual subject matter
 * (lib/design-reference.mjs's buildDesignReferenceQuery) instead of the old
 * dimension-biased template that retrieved nothing for technique-shaped
 * criteria. GENERIC: reads whatever rubric the caller loaded.
 */
export function topAnchorText(criterion) {
  const anchors = criterion?.anchors;
  if (!anchors || typeof anchors !== 'object') return undefined;
  const keys = Object.keys(anchors)
    .map(Number)
    .filter(Number.isFinite);
  if (keys.length === 0) return undefined;
  return anchors[String(Math.max(...keys))];
}

/**
 * Fix 4 (cross-iteration self-learning, write half): a self-improve loop
 * only learns whether iteration N-1's edit helped once iteration N's judge
 * has re-scored the (possibly now-edited) candidate — so this runs at the
 * START of iteration N, right after judging, using the PREVIOUS iteration's
 * recorded actor outcome (iter-{N-1}-actor.json) plus this iteration's fresh
 * scores. Skips silently (no lesson) when there is no previous iteration, or
 * the previous iteration's actor outcome was a pure infra failure (nothing
 * genuine to learn from) — never breaks the bench loop on an MCP error.
 */
export async function maybeIngestPriorIterationLesson({ gemmaDir, gemmaHistory, claudeHistory, gemmaRecord, claudeRecord, iterNum, actorName }) {
  if (gemmaHistory.length === 0) return;
  const prevGemma = gemmaHistory[gemmaHistory.length - 1];
  if (!prevGemma || prevGemma.iter !== iterNum - 1) return;
  const prevActorPath = path.join(gemmaDir, `iter-${prevGemma.iter}-actor.json`);
  if (!existsSync(prevActorPath)) return;
  let prevActor;
  try {
    prevActor = JSON.parse(readFileSync(prevActorPath, 'utf8'));
  } catch {
    return;
  }
  if (!GENUINE_ACTOR_STATUSES.has(prevActor.status)) return; // infra exhaustion — nothing to learn

  const prevClaude = claudeHistory[claudeHistory.length - 1];
  const gemmaDelta =
    typeof gemmaRecord.total_0_100 === 'number' && typeof prevGemma.total_0_100 === 'number'
      ? Math.round((gemmaRecord.total_0_100 - prevGemma.total_0_100) * 100) / 100
      : null;
  const claudeDelta =
    prevClaude && claudeRecord && typeof claudeRecord.total_0_100 === 'number' && typeof prevClaude.total_0_100 === 'number'
      ? Math.round((claudeRecord.total_0_100 - prevClaude.total_0_100) * 100) / 100
      : null;

  const summary =
    prevActor.status === 'edited'
      ? prevActor.claude_result_text || '(no summary text returned)'
      : prevActor.status === 'contract_failed'
        ? `edit rejected by the frozen contract: ${(prevActor.contract_violations || []).join('; ')}`
        : prevActor.status === 'runtime_failed'
          ? `edit rejected — buildPlane(THREE) threw at runtime: ${prevActor.runtime_error || '(no error captured)'}`
          : 'actor made no change to the candidate';

  await ingestAttemptLesson({
    tag: SELF_LEARNING_TAG,
    category: 'self-improve-attempt',
    criterion: prevGemma.weakest_feature?.id,
    summary,
    scoreDeltas: { gemma4: gemmaDelta, [prevClaude?.judge_track || 'claude-vision']: claudeDelta },
    outcome: prevActor.status,
    extraTags: [actorName],
  });
}
