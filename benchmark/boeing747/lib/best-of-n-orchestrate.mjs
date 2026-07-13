// PURE opus-pairwise BEST-OF-N plateau-breaking ORCHESTRATION glue for the Boeing
// 747 primitives vision benchmark (`--judge opus-pairwise` track). This module
// composes the statistical primitives in lib/best-of-n.mjs + lib/certification-
// stats.mjs into the actual actor-step decision, WITHOUT doing any I/O itself:
// every side-effecting operation (copy a candidate file, run the actor, render +
// judge, promote the winner) is an INJECTED SEAM, so the whole plateau-break
// decision is directly vitest-covered with a MOCKED runActorEdit + judge — no rig,
// no CLI, no GPU, no real filesystem (see lib/best-of-n-orchestrate is exercised by
// loop-runner-bestofn.test.mjs).
//
// GATED (loop-runner-terransoul.mjs): these functions are reached ONLY on the
// opus-pairwise path AND only when the --best-of-n flag is > 0. The frozen gemma
// default, the opus-panel path, and the single-edit opus-pairwise path (flag == 0)
// never import a behavior from here that changes their output — they stay
// byte-identical.
//
// GENERIC ON PURPOSE (rules/bench-agi-purity.md): NO Boeing-747 geometry, verb
// list, coordinate, or answer-derived seed. The diversity directive names only the
// model-reported weakest feature/view id and asks for a distinct re-architecture;
// every dimension is derived by the actor from the reference photos.
//
// WHY (July-2026 plateau-breaking findings, sourced in lib/best-of-n.mjs's header):
//   #1 best-of-N on the worst view + worst-view-LCB selection (2503.21878 coverage;
//      2506.19248 InferenceTimePessimism; 2604.04648 caution);
//   #2 difficulty-aware budget allocation over plateaued sub-bar views (2605.29268
//      MAB; 2605.26849 UAB; 2607.05297 Allocator);
//   #8 reward-hack guardrail via an independent held-out re-judge (2606.14629 When
//      Good Verifiers Go Bad).

import { DEFAULT_ALPHA, DEFAULT_P_FLOOR } from './certification-stats.mjs';
import { allocateBudget, detectPlateau, rewardHackDivergence, selectBestCandidate } from './best-of-n.mjs';

/** Finite-number guard (null/undefined/NaN/Infinity => false). */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Hard cap on the best-of-N candidate budget (coverage theory 2503.21878: a few
 * DIVERSE samples help; scaling N large turns argmax into a judge-hacking
 * outlier-finder — never sample more than this many candidates per plateau). */
export const BEST_OF_N_CAP = 4;

/**
 * GENERIC, AGI-pure diversity directive injected (via the actor prompt's existing
 * free-text `plateauEscalation` slot) into each best-of-N candidate's actor call so
 * the N sampled edits explore STRUCTURALLY DIFFERENT fixes instead of near-
 * duplicates (the coverage caveat: best-of-N only helps if the actor SAMPLES a good
 * edit). It names ONLY the model-reported weakest feature / view id and asks for a
 * distinct re-architecture — it seeds NO coordinates, geometry, or answer-derived
 * constant (rules/bench-agi-purity.md); every dimension is derived by the actor.
 *
 * @param {Object} p
 * @param {string} [p.worstFeatureId]  the rubric feature id the plateau is on.
 * @param {number} [p.worstView]       the 1-based view number targeted.
 * @param {number} [p.slotIndex]       0-based candidate slot (for the "candidate i of n" line).
 * @param {number} [p.totalSlots]      total candidates being sampled this round.
 * @returns {string}
 */
export function buildBestOfNDiversityInstruction({ worstFeatureId, worstView, slotIndex = 0, totalSlots = 1 } = {}) {
  const target =
    worstFeatureId || (isNum(worstView) ? `view ${worstView}` : 'the plateaued weakest feature');
  return [
    `BEST-OF-N DIVERSITY (candidate ${slotIndex + 1} of ${totalSlots} — propose a STRUCTURALLY DIFFERENT fix):`,
    `The weakest feature '${target}' has PLATEAUED: incremental parameter nudges have stopped moving it.`,
    'Do NOT nudge existing dimensions/positions. Propose a distinct RE-ARCHITECTURE of this ONE feature —',
    'change the geometric STRATEGY itself (a different primitive decomposition, a different sub-assembly built',
    'from a different set of shapes, or a different way the parts join), not the numbers.',
    `Each of the ${totalSlots} sibling candidates must explore a DIFFERENT approach so the set covers genuinely`,
    'distinct fixes — a near-duplicate of a sibling is wasted coverage. A bold re-architecture is expected and',
    'will NOT be scored as a regression provided the overall aggregate across the nine views does not drop.',
    'Derive every dimension YOURSELF from the reference photos — there are NO coordinates in these instructions to copy.',
  ].join('\n');
}

/**
 * #2 — decide WHETHER best-of-N should fire this iteration and, if so, size the
 * N-budget PER stuck view. A view is a best-of-N ARM iff it is BOTH sub-bar
 * (score < its calibrated bar) AND has PLATEAUED (detectPlateau: the same weakest
 * view, non-improving, over `patience` genuine iters). The `totalN` budget (clamped
 * to [0, cap]) is then split across the arms by allocateBudget (gap-proportional
 * bandit weighting — most samples to the largest-gap stuck view). No plateaued
 * sub-bar view => not triggered (normal single-edit progress is still working).
 *
 * @param {Object} p
 * @param {Array<Array<{view:number, score:number}>>} p.perViewHistory  genuine
 *   per-iter per-view arrays (oldest first), INCLUDING this iteration.
 * @param {number|number[]} p.bars   per-view calibrated bar(s) (scalar broadcasts).
 * @param {Array<{view:number, score:number}>} p.latestPerView  this iter's primary per-view.
 * @param {number} p.totalN          requested best-of-N budget (the --best-of-n flag).
 * @param {number} [p.patience]      plateau patience (default 2).
 * @param {number} [p.cap]           hard cap on N (default BEST_OF_N_CAP).
 * @returns {{triggered:boolean, totalN:number, worstView:(number|null),
 *   perView:Array<{view:number, n:number}>, plateauViews:number[]}}
 */
export function planBestOfNBudget({
  perViewHistory = [],
  bars,
  latestPerView = [],
  totalN,
  patience = 2,
  cap = BEST_OF_N_CAP,
} = {}) {
  const capN = isNum(cap) ? Math.max(0, Math.floor(cap)) : BEST_OF_N_CAP;
  const N = Math.max(0, Math.min(Math.floor(isNum(totalN) ? totalN : 0), capN));
  const rows = (Array.isArray(latestPerView) ? latestPerView : []).filter((v) => v && isNum(v.score));
  if (N === 0 || rows.length === 0) {
    return { triggered: false, totalN: N, worstView: null, perView: [], plateauViews: [] };
  }
  const barFor = (view, i) => (Array.isArray(bars) ? bars[isNum(view) ? view - 1 : i] : bars);
  let weakest = rows[0];
  for (const r of rows) if (r.score < weakest.score) weakest = r;

  const plateauViews = [];
  const arms = [];
  rows.forEach((r, i) => {
    const bar = barFor(r.view, i);
    const subBar = isNum(bar) ? r.score < bar : true;
    if (subBar && detectPlateau({ perViewHistory, viewId: r.view, patience })) {
      plateauViews.push(r.view);
      arms.push({ view: r.view, gap: isNum(bar) ? Math.max(bar - r.score, 0) : 0, improveRate: 0 });
    }
  });
  if (arms.length === 0) {
    return { triggered: false, totalN: N, worstView: weakest.view, perView: [], plateauViews: [] };
  }
  const perView = allocateBudget({ viewGaps: arms, totalN: N, minPerView: 0 }).filter((a) => a.n > 0);
  return { triggered: perView.length > 0, totalN: N, worstView: weakest.view, perView, plateauViews };
}

/**
 * #1 — ORCHESTRATE the best-of-N sampling: for each budgeted view/slot, make a
 * FRESH COPY of the current candidate (so the N attempts never stomp each other),
 * run ONE actor edit on the copy with the STRUCTURALLY-DIFFERENT diversity directive,
 * render + judge the copy, then SELECT the winner by worst-view LCB minus caution
 * (selectBestCandidate). PURE given its injected seams — the test hands in a mock
 * `copyCandidate` / `runActorFn` / `renderJudgeFn` returning canned candidates, so no
 * rig / CLI / GPU / real filesystem is touched.
 *
 * @param {Object} p
 * @param {{perView:Array<{view:number, n:number}>}} p.plan  planBestOfNBudget output.
 * @param {string} p.candidatePath   the current candidate file every copy is forked from.
 * @param {number|number[]} p.bars   per-view calibrated bar(s) for the LCB ranker.
 * @param {number} [p.cautionWeight] OOD caution weight (default 0 = pure LCB).
 * @param {number} [p.pFloor]        pass-probability floor (default 0.5).
 * @param {number} [p.alpha]         one-sided LCB level (default 0.05).
 * @param {string} [p.worstFeatureId] rubric feature id for the diversity directive.
 * @param {function} p.copyCandidate  async (src, dest, slot) => void.
 * @param {function} p.tempPathFor    (slot) => dest candidate path.
 * @param {function} p.runActorFn     async ({candidatePath, plateauEscalation, targetView, slot, ...actorArgs}) => actorResult.
 * @param {function} p.renderJudgeFn  async ({candidatePath, slot}) => {per_view, total_0_100, shotsDir?}.
 * @param {Object} [p.actorArgs]     extra args merged into every runActorFn call.
 * @param {function} [p.logger]      progress logger (default no-op).
 * @returns {Promise<{slots:Array<Object>, candidates:Array<{perView:Array}>,
 *   selection:Object, winner:(Object|null), winnerIndex:number}>}
 */
export async function runBestOfNCandidates({
  plan,
  candidatePath,
  bars,
  cautionWeight = 0,
  pFloor = DEFAULT_P_FLOOR,
  alpha = DEFAULT_ALPHA,
  worstFeatureId,
  copyCandidate,
  tempPathFor,
  runActorFn,
  renderJudgeFn,
  actorArgs = {},
  logger = () => {},
} = {}) {
  const arms = plan && Array.isArray(plan.perView) ? plan.perView.filter((a) => a && a.n > 0) : [];
  const totalSlots = arms.reduce((s, a) => s + a.n, 0);
  const slots = [];
  let slot = 0;
  for (const arm of arms) {
    for (let j = 0; j < arm.n; j++) {
      const dest = tempPathFor(slot);
      await copyCandidate(candidatePath, dest, slot);
      const plateauEscalation = buildBestOfNDiversityInstruction({
        worstFeatureId,
        worstView: arm.view,
        slotIndex: slot,
        totalSlots,
      });
      logger(`  best-of-N candidate ${slot + 1}/${totalSlots} (view ${arm.view}): actor edit on a fresh copy`);
      const actorResult = await runActorFn({
        ...actorArgs,
        candidatePath: dest,
        plateauEscalation,
        targetView: arm.view,
        slot,
      });
      const judged = await renderJudgeFn({ candidatePath: dest, slot });
      const perView = judged && Array.isArray(judged.per_view) ? judged.per_view : [];
      slots.push({ slot, view: arm.view, dest, actorResult, judged, perView });
      slot += 1;
    }
  }
  const candidates = slots.map((s) => ({ perView: s.perView }));
  const selection = selectBestCandidate({ candidates, bars, cautionWeight, pFloor, alpha });
  const winner = selection.index >= 0 ? slots[selection.index] : null;
  return { slots, candidates, selection, winner, winnerIndex: selection.index };
}

/** Worst (minimum) finite per-view score across a candidate's per-view profile. */
export function worstViewScore(perView) {
  const scores = (Array.isArray(perView) ? perView : [])
    .map((v) => (v && isNum(v.score) ? v.score : null))
    .filter(isNum);
  return scores.length > 0 ? Math.min(...scores) : null;
}

/**
 * #1 + #8 — PROMOTION DECISION. Promote the best-of-N winner onto the real
 * candidate ONLY when BOTH gates pass:
 *   - EDIT-GATE (no total regression): the winner's judged gating total is not
 *     below the current best by more than `epsilonTotal` (the same no-regression
 *     rule the loop's edit-gate applies next iteration; here it is a cheap pre-gate
 *     so a strictly-worse winner is never promoted).
 *   - REWARD-HACK GUARDRAIL (#8): the worst-view score the selection OPTIMISED
 *     against must be tracked by an INDEPENDENT held-out re-judge it never optimised
 *     against. rewardHackDivergence flags the judge-hacking signature (optimised
 *     score up, held-out flat) — a divergence beyond `divergenceThreshold` BLOCKS
 *     promotion (do not accept a candidate that only fooled the panel it was ranked on).
 * On a block the caller keeps the current best (the real candidate file was never
 * touched — every edit landed on a throwaway copy — so a non-promotion IS the
 * backtrack, no restore needed).
 *
 * @param {Object} p
 * @param {{index:number}} p.selection            selectBestCandidate output.
 * @param {number} p.winnerJudgedTotal            winner's judged gating total (0..100).
 * @param {number} p.bestTotal                    current best gating total.
 * @param {number} [p.epsilonTotal]               no-regression noise band (default 0).
 * @param {number} p.winnerWorstViewScore         winner's optimised worst-view score.
 * @param {number} p.winnerHeldOutScore           winner's INDEPENDENT held-out worst-view score.
 * @param {number} p.baselineWorstViewScore       pre-best-of-N candidate's worst-view score.
 * @param {number} [p.divergenceThreshold]        reward-hack divergence tolerance (default 0).
 * @returns {{promote:boolean, reason:string, regressed:boolean, diverged:boolean,
 *   totalDelta:(number|null), divergence:Object}}
 */
export function decideBestOfNPromotion({
  selection,
  winnerJudgedTotal,
  bestTotal,
  epsilonTotal = 0,
  winnerWorstViewScore,
  winnerHeldOutScore,
  baselineWorstViewScore,
  divergenceThreshold = 0,
} = {}) {
  const div = rewardHackDivergence({
    selectedJudgedScore: winnerWorstViewScore,
    heldOutScore: winnerHeldOutScore,
    prevSelectedJudged: baselineWorstViewScore,
    prevHeldOut: baselineWorstViewScore,
    threshold: divergenceThreshold,
  });
  if (!selection || !Number.isInteger(selection.index) || selection.index < 0) {
    return { promote: false, reason: 'no viable candidate produced', regressed: false, diverged: false, totalDelta: null, divergence: div };
  }
  const eps = isNum(epsilonTotal) ? Math.max(0, epsilonTotal) : 0;
  const totalDelta =
    isNum(winnerJudgedTotal) && isNum(bestTotal) ? Math.round((winnerJudgedTotal - bestTotal) * 100) / 100 : null;
  const regressed = isNum(winnerJudgedTotal) && isNum(bestTotal) && winnerJudgedTotal < bestTotal - eps;
  if (regressed) {
    return {
      promote: false,
      reason: `winner regresses the gating total (${totalDelta} below best, beyond epsilon ${eps}) — keep best`,
      regressed: true,
      diverged: div.diverged,
      totalDelta,
      divergence: div,
    };
  }
  if (div.diverged) {
    return {
      promote: false,
      reason:
        `reward-hack guardrail: optimised worst-view improved (+${div.judgedDelta}) but the held-out re-judge ` +
        `did not track it (divergence ${div.delta} > ${divergenceThreshold}) — refuse candidate, stop scaling N`,
      regressed: false,
      diverged: true,
      totalDelta,
      divergence: div,
    };
  }
  return {
    promote: true,
    reason: `winner promoted (worst-view LCB selection; total delta ${totalDelta}, held-out tracks)`,
    regressed: false,
    diverged: false,
    totalDelta,
    divergence: div,
  };
}

/**
 * The full best-of-N ACTOR STEP (pairwise-only): orchestrate N diverse candidate
 * edits, select the worst-view-LCB winner, decide promotion under the edit-gate +
 * reward-hack guardrail, and (on promote) copy the winner onto the real candidate.
 * Returns an `actorResult`-shaped object compatible with the loop's downstream
 * bookkeeping (`status`/`changed`/`cost_usd`/`ms`/`attempts`), plus a `best_of_n`
 * diagnostics block. Every side-effecting operation is an injected seam
 * (`copyCandidate`/`tempPathFor`/`runActorFn`/`renderJudgeFn`/`heldOutJudgeFn`/
 * `promoteFn`) so this whole step is vitest-covered with mocks (no rig/CLI/GPU/fs).
 * The real candidate file is only ever written by `promoteFn`; on a non-promotion it
 * is left untouched, so keep-best/backtrack is automatic.
 *
 * @param {Object} p
 * @param {Object} p.plan                 planBestOfNBudget output (must be triggered).
 * @param {string} p.candidatePath        the real candidate file.
 * @param {number|number[]} p.bars        per-view calibrated bar(s).
 * @param {string} [p.worstFeatureId]     rubric feature id (diversity directive).
 * @param {number} [p.cautionWeight]      OOD caution weight (default 0).
 * @param {number} [p.pFloor] @param {number} [p.alpha]
 * @param {number} p.bestTotal            current best gating total (edit-gate).
 * @param {number} [p.epsilonTotal]       no-regression band.
 * @param {number} p.baselineWorstViewScore  current candidate's worst-view score.
 * @param {number} [p.divergenceThreshold]
 * @param {function} p.copyCandidate @param {function} p.tempPathFor
 * @param {function} p.runActorFn @param {function} p.renderJudgeFn
 * @param {function} [p.heldOutJudgeFn]   async ({winner}) => held-out worst-view score.
 * @param {function} p.promoteFn          async (winnerDest) => void.
 * @param {Object} [p.actorArgs] @param {function} [p.logger]
 * @returns {Promise<{actorResult:Object, info:Object}>}
 */
export async function runBestOfNActorStep({
  plan,
  candidatePath,
  bars,
  worstFeatureId,
  cautionWeight = 0,
  pFloor = DEFAULT_P_FLOOR,
  alpha = DEFAULT_ALPHA,
  bestTotal,
  epsilonTotal = 0,
  baselineWorstViewScore,
  divergenceThreshold = 0,
  copyCandidate,
  tempPathFor,
  runActorFn,
  renderJudgeFn,
  heldOutJudgeFn,
  promoteFn,
  actorArgs = {},
  logger = () => {},
} = {}) {
  const started = Date.now();
  const orch = await runBestOfNCandidates({
    plan,
    candidatePath,
    bars,
    cautionWeight,
    pFloor,
    alpha,
    worstFeatureId,
    copyCandidate,
    tempPathFor,
    runActorFn,
    renderJudgeFn,
    actorArgs,
    logger,
  });

  const attempts = orch.slots.map((s) => ({
    slot: s.slot,
    view: s.view,
    status: s.actorResult ? s.actorResult.status : 'actor_failed',
    changed: Boolean(s.actorResult && s.actorResult.changed),
    total_0_100: s.judged ? s.judged.total_0_100 : null,
    worst_view_lcb: orch.selection.ranked.find((r) => r.index === s.slot)?.worstViewLCB ?? null,
  }));
  const totalCost = orch.slots.reduce(
    (c, s) => c + (s.actorResult && isNum(s.actorResult.cost_usd) ? s.actorResult.cost_usd : 0),
    0,
  );

  const winner = orch.winner;
  if (!winner) {
    const info = {
      triggered: true,
      promoted: false,
      reason: 'no viable candidate produced',
      worst_view: plan.worstView,
      budget: plan.perView,
      selection_index: -1,
      candidates: attempts,
    };
    return {
      actorResult: {
        status: 'no_change',
        changed: false,
        cost_usd: Math.round(totalCost * 1e6) / 1e6,
        ms: Date.now() - started,
        attempts,
        best_of_n: info,
        claude_result_text: null,
        observability: null,
      },
      info,
    };
  }

  const winnerWorst = worstViewScore(winner.perView);
  const heldOut = heldOutJudgeFn ? await heldOutJudgeFn({ winner }) : winnerWorst;
  const decision = decideBestOfNPromotion({
    selection: orch.selection,
    winnerJudgedTotal: winner.judged ? winner.judged.total_0_100 : null,
    bestTotal,
    epsilonTotal,
    winnerWorstViewScore: winnerWorst,
    winnerHeldOutScore: heldOut,
    baselineWorstViewScore,
    divergenceThreshold,
  });

  const info = {
    triggered: true,
    promoted: decision.promote,
    reason: decision.reason,
    worst_view: plan.worstView,
    budget: plan.perView,
    selection_index: orch.winnerIndex,
    winner_worst_view_score: winnerWorst,
    held_out_worst_view_score: isNum(heldOut) ? heldOut : null,
    total_delta: decision.totalDelta,
    diverged: decision.diverged,
    regressed: decision.regressed,
    divergence: decision.divergence,
    candidates: attempts,
  };

  if (decision.promote) {
    await promoteFn(winner.dest);
  }
  logger(`  BEST-OF-N: ${decision.promote ? 'PROMOTED' : 'kept best'} — ${decision.reason}`);

  return {
    actorResult: {
      status: decision.promote ? 'edited' : 'no_change',
      changed: decision.promote,
      cost_usd: Math.round(totalCost * 1e6) / 1e6,
      ms: Date.now() - started,
      attempts,
      best_of_n: info,
      claude_result_text: winner.actorResult ? winner.actorResult.claude_result_text ?? null : null,
      observability: winner.actorResult ? winner.actorResult.observability ?? null : null,
    },
    info,
  };
}
