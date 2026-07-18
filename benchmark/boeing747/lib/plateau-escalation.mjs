// Plateau-escalation directives, extracted VERBATIM from
// loop-runner-terransoul.mjs (max-lines refactor, 2026-07-18). The runner
// imports AND re-exports every name here, so loop-runner-escalation.test.mjs's
// pins against './loop-runner-terransoul.mjs' are unchanged. PURE: no imports,
// no I/O — exactly the code that moved.

// --- Plateau -> computed-mesh escalation (AGI-pure, open-track ONLY) --------
// A GENERIC loop-engineering escalation: when the single weakest feature sits
// far below the view target, or has stayed weakest across several primitive
// edits, a parameter tweak is the wrong tool -- the actor is told to change
// strategy and REBUILD that one feature as a computed mesh. It names only the
// strategy and the rubric's own feature id; it seeds NO geometry, coordinates,
// or 747-specific shape -- the actor must derive the profile from the reference
// photos itself. Fires only under the open contract; the frozen track never
// sees it (plateauEscalation stays null), so the frozen number is untouched.
export const MESH_ESCALATION_GAP = 2.0; // a feature > 2/10 below the view target is a structural gap, not a tweakable one

export function meshEscalationStreak(genuineChain, weakestId) {
  if (!weakestId) return 0;
  let streak = 0;
  for (let i = genuineChain.length - 1; i >= 0; i--) {
    if (genuineChain[i]?.weakest_feature?.id !== weakestId) break;
    streak += 1;
  }
  return streak;
}

export function buildMeshEscalation({ weakest, streak, gap, viewThreshold }) {
  const persisted =
    streak >= 2
      ? ` It has stayed the single weakest feature for ${streak} consecutive iterations of primitive edits -- primitive-tweaking has plateaued on it.`
      : '';
  return [
    'PLATEAU ESCALATION (open medium -- change of strategy required):',
    `The weakest feature '${weakest.id}' is at mean ${weakest.mean}/10, ${gap.toFixed(1)} below the ${viewThreshold}/10 view target.${persisted}`,
    'A gap this size is STRUCTURAL, not a parameter you can nudge. STOP adjusting primitive dimensions/positions for this feature.',
    'REBUILD this one feature from scratch as COMPUTED MESH geometry -- a hand-built THREE.BufferGeometry, a THREE.LatheGeometry sweeping a 2-D profile you define, or a THREE.Shape + ExtrudeGeometry (all permitted by the open contract).',
    'Derive the profile/cross-section YOURSELF by inspecting the reference photos for this view -- there are no coordinates in these instructions to copy. A bold re-architecture of THIS feature is expected and will NOT be scored as a regression.',
  ].join('\n');
}

/**
 * FROZEN-TRACK plateau escalation (v4, 2026-07-17): the frozen-primitives
 * track had NO plateau breaker at all — buildMeshEscalation's text directs
 * computed-mesh geometry that the frozen contract rejects, and its gate was
 * `if (contractModulePath)` (open track only), so a paralyzed actor could
 * no_change forever with nothing changing its strategy. Same escalation shape,
 * frozen-contract-safe directive: recompose the feature from scratch as a NEW
 * arrangement of PRIMITIVES with re-derived dimensions, never a mesh. PURE +
 * exported for vitest.
 */
export function buildFrozenEscalation({ weakest, streak, gap, viewThreshold, stallIters }) {
  const persisted =
    streak >= 2
      ? ` It has stayed the single weakest feature for ${streak} consecutive iterations.`
      : '';
  // SINGLE-SHOT REWRITE (2026-07-17 replay evidence): every record this loop
  // ever banked came from ONE bounded edit; every rebuild-class directive
  // outcome (2 burst windows + 1 clean-baseline attempt) declined and was
  // restored. Escalate the TARGET's novelty pressure, never the edit scope —
  // and never promise dip tolerance the gate does not grant.
  return [
    'PLATEAU (frozen primitives -- change of TARGET, never of edit scope):',
    `The weakest feature '${weakest.id}' is at mean ${weakest.mean}/10, ${gap.toFixed(1)} below the ${viewThreshold}/10 view target, and the accepted best has not improved for ${stallIters} iterations.${persisted}`,
    `This iteration make exactly ONE bounded change to the single existing code block that renders '${weakest.id}': ` +
      'set ONE parameter/position from its current value to a better one, add ONE missing element at a stated ' +
      'location, or swap ONE named geometry for a one-for-one replacement (same variable, same group.add, zero ' +
      'other lines touched). Every improvement this loop has ever banked was one such bounded edit; sprawling ' +
      'multi-part rewrites have always been rolled back.',
    'Do not rebuild, redesign, rework, or recompose anything, and do not modify any line outside that one block. ' +
      'Stay strictly inside the frozen contract (primitives only, export function buildPlane(THREE)).',
    'Before finishing: (a) name the ONE visible difference this edit should make and which views should show it; ' +
      '(b) confirm zero lines changed outside the block; (c) confirm the file still runs. ' +
      'If any check fails, make the edit SMALLER -- never larger.',
  ].join('\n');
}
