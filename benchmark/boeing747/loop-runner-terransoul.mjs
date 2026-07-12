// FULLY AUTONOMOUS "TerranSoul-Agent-driven" orchestrator for the Boeing 747
// primitives vision benchmark.
//
// Unlike loop-runner-claude.mjs / loop-runner.mjs (which the coordinator
// calls ONCE per iteration, after a human/agent hand-edits plane.js between
// calls — see benchmark/BOEING-COMPARISON.md's 2026-07-05 ACTOR-FIDELITY
// CORRECTION note), this script IS the loop end-to-end: it renders, judges on
// BOTH tracks, drives the actor's own edit, gates the edit against the frozen
// contract, and repeats — with no human touching plane.js between iterations.
//
// One iteration:
//   runRig (frozen rig/render-rig.mjs, ONE render, shared by both judges)
//     -> judgeShots (frozen gemma4 judge, judge/judge.mjs)
//     -> judgeShotsClaude({ model: 'claude-fable-5' }) (judge/judge-claude.mjs,
//        honest judge_track label from Task 1's fix)
//     -> runActorWithRetries (retry-with-backoff wrapper around
//        actor/actor-claude.mjs's runActorEdit: TerranSoul's OWN generic
//        agentic-edit CLI capability, `terransoul-cli --agent-task`
//        (WIRE-CLI-PARITY-GAP-3 rewire, 2026-07-10 — replaces the OLD
//        bespoke direct `claude` spawn), its own vision inspection,
//        Read+Edit only, gated end-to-end through the `action_trust`
//        earned-autonomy ledger)
//     -> contract gate (actor-claude.mjs already restores + records on
//        violation; the loop just reads the resulting status)
//     -> evaluateStopConditions (frozen lib/stop-conditions.mjs, EXACTLY the
//        thresholds/patience/budget loop-runner-claude.mjs already uses) —
//        fed ONLY genuine iterations (see LESSON BOEING-747-ACTOR-RETRY-1)
//
// LESSON BOEING-747-ACTOR-RETRY-1 (mcp-data/shared/memory-seed.sql): the
// committed terransoul-fable5 run stalled on 4 straight actor-timeout
// iterations that never produced a genuine attempt, yet were fed into
// evaluateStopConditions as ordinary non-improving scores — a measurement
// artifact, not a demonstrated capability ceiling. This file now: (1)
// retries a timed-out actor call with backoff instead of re-rendering/
// re-judging (lib/actor-retry.mjs), (2) tags every iteration with an
// actor_status and excludes actor_exhausted_retries entries from the arrays
// passed to evaluateStopConditions, firing a SEPARATE, honestly-labeled
// actor_exhausted_retries_cap stop reason instead of corrupting `stall`
// (WIRE-CLI-PARITY-GAP-3 rewire: an `action_trust` DENIAL is a NEW member of
// this same excluded bucket — see `denied` on actorResult/attempts — and
// short-circuits the retry loop immediately, since no timeout can fix a
// ledger decision; lib/actor-retry.mjs's `shouldRetryActor`), (3) gets
// streaming observability on every actor call (lib/actor-stream.mjs, wired
// inside actor-claude.mjs itself; rewritten for the terransoul-cli
// stderr-progress-line format — see that module's header), and (4) surfaces
// prior-attempt context to the actor and records a lesson once an edit's
// effect becomes observable (lib/self-learning.mjs, generic MCP brain
// plumbing) — unchanged by the CLI rewire, still runs alongside it.
//
// Results land under NEW actor-name directories so nothing existing is
// touched: results/<actor>/ (gemma4 track, mirrors terransoul-opus48/'s shape)
// and results/<actor>-claude/ (Fable-5-vision track, mirrors
// terransoul-opus48-claude/'s shape).
//
// Judge calls stay strictly sequential (existing discipline — the GPU/CLI may
// be shared); this script itself is the only thing looping, so there is
// exactly one `terransoul-cli --agent-task` subprocess in flight at any time.
//
// CLI:
//   node loop-runner-terransoul.mjs --plane <plane.js> [--actor terransoul-fable5]
//     [--model claude-fable-5] [--effort max] [--max-iter N] [--max-actor-retries N]
//     [--cli-bin <path>] [--cli-data-dir <dir>]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActorEdit } from './actor/actor-claude.mjs';
import { judgeShotsClaude } from './judge/judge-claude.mjs';
import { judgeShots, loadRubric } from './judge/judge.mjs';
import {
  computeAttemptTimeoutMs,
  computeTrailingExhaustionStreak,
  filterGenuineIterationsForStopConditions,
  loadActorRetryConfig,
  shouldRetryActor,
} from './lib/actor-retry.mjs';
import { fetchPriorAttempts, formatPriorAttemptsSection, ingestAttemptLesson } from './lib/self-learning.mjs';
import { evaluateStopConditions } from './lib/stop-conditions.mjs';
import { runRig } from './rig/render-rig.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
// Relaxed-contract track (OPEN-VARIANT-DESIGN.md). `--contract open` swaps ONLY
// the candidate contract validator + the actor-prompt contract text passed to
// runActorEdit; every measurement artifact (rig, rubric, cameras, scoring,
// judges, stop conditions) is byte-identical to the frozen track. Default is
// frozen — the frozen path never references this module.
const CONTRACT_OPEN_PATH = path.join(BENCH_DIR, 'lib', 'contract-open.mjs');
const DEFAULT_ACTOR = 'terransoul-fable5';
const DEFAULT_MODEL = 'claude-fable-5';
const DEFAULT_EFFORT = 'max';
const CLAUDE_JUDGE_SAMPLES = 1;
// Domain-specific ONLY as an argument value passed to the generic
// lib/self-learning.mjs functions — those functions never hardcode this
// string themselves (rules/brain-driven-self-improvement.md,
// rules/bench-agi-purity.md).
const SELF_LEARNING_TAG = 'boeing747-actor-attempt';
// Statuses actor-claude.mjs/runActorWithRetries can produce that reflect a
// REAL attempt (as opposed to a pure infra failure never worth learning from
// or counting toward stall/threshold/budget).
const GENUINE_ACTOR_STATUSES = new Set(['edited', 'no_change', 'contract_failed']);

function loadHistory(actorDir) {
  if (!existsSync(actorDir)) return [];
  return readdirSync(actorDir)
    .filter((f) => /^iter-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(path.join(actorDir, f), 'utf8')))
    .sort((a, b) => a.iter - b.iter);
}

function anchorHint(rubric, weakest) {
  if (!weakest) return null;
  const criterion = rubric.criteria.find((c) => c.id === weakest.id);
  if (!criterion) return null;
  return {
    weakest_feature: weakest.id,
    fix_suggestion:
      `Improve '${criterion.name}' (mean ${weakest.mean}/10). Target the 8 anchor: ` +
      `${criterion.anchors['8']}; then the 10 anchor: ${criterion.anchors['10']}.`,
    source: 'anchor',
  };
}

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

function bookkeepTrack({ actorDir, iterNum, runId, judged, judgeTrack, rubric, rubricSha256 }) {
  mkdirSync(actorDir, { recursive: true });
  const bestFile = path.join(actorDir, 'best.json');
  const prevBest = existsSync(bestFile) ? JSON.parse(readFileSync(bestFile, 'utf8')) : null;
  const total = judged.total_0_100;
  const improved = typeof total === 'number' && (!prevBest || total > prevBest.total_0_100);
  const regressed = prevBest !== null && !improved;

  const record = {
    actor: path.basename(actorDir),
    ...(judgeTrack ? { judge_track: judgeTrack } : {}),
    iter: iterNum,
    run_id: runId,
    plane_sha256: judged.plane_sha256,
    rubric_sha256: judged.rubric_sha256 ?? rubricSha256,
    total_0_100: total,
    per_view: judged.per_view.map((v) => ({
      view: v.view,
      key: v.key,
      score: v.score,
      ...(v.notes !== undefined ? { notes: v.notes } : {}),
    })),
    weakest_feature: judged.weakest_feature,
    critic: judged.critic ?? anchorHint(rubric, judged.weakest_feature),
    ...(judged.total_cost_usd !== undefined ? { total_cost_usd: judged.total_cost_usd } : {}),
    regressed,
    best_total_after: improved ? total : prevBest ? prevBest.total_0_100 : total,
    created_at: new Date().toISOString(),
  };
  writeFileSync(path.join(actorDir, `iter-${iterNum}.json`), JSON.stringify(record, null, 2));
  if (improved) {
    writeFileSync(
      bestFile,
      JSON.stringify(
        { iter: iterNum, run_id: runId, plane_sha256: judged.plane_sha256, total_0_100: total, per_view: record.per_view },
        null,
        2,
      ),
    );
  }
  return record;
}

/**
 * Stamp the (by-then-known) actor outcome onto an already-written iter-N.json
 * record, both in-memory (the caller keeps using the returned/mutated object
 * this call) and on disk (so a FUTURE loadHistory() call — i.e. the next
 * iteration, or a resumed run — sees it too). This is the mechanism fix 2
 * relies on: gemmaIterations/claudeIterations are filtered on this field.
 */
function patchActorStatus(actorDir, iterNum, record, actorStatus) {
  record.actor_status = actorStatus;
  writeFileSync(path.join(actorDir, `iter-${iterNum}.json`), JSON.stringify(record, null, 2));
  return record;
}

/**
 * Fix 1 (retry-with-backoff): retry the SAME actor call — same rendered
 * shots + already-computed judge results passed straight through, so NO
 * re-render/re-judge happens per retry — up to `retryCfg.maxRetries` times,
 * with computeAttemptTimeoutMs's backoff schedule. Only once every attempt
 * has come back 'actor_failed' does this resolve to the new terminal
 * 'actor_exhausted_retries' status; any genuine outcome (edited/no_change/
 * contract_failed) short-circuits immediately. Every attempt is recorded in
 * the returned `attempts` array for full audit (including each attempt's
 * streaming observability from actor-claude.mjs).
 */
async function runActorWithRetries({ retryCfg, ...actorArgs }) {
  const attempts = [];
  let attemptIdx = 0;
  let result;
  for (;;) {
    const timeoutMs = computeAttemptTimeoutMs(attemptIdx, retryCfg.baseTimeoutMs, retryCfg.timeoutCapMs);
    // Sequential by design (existing discipline): one `terransoul-cli
    // --agent-task` subprocess in flight at a time.
    result = await runActorEdit({ ...actorArgs, timeoutMs });
    attempts.push({
      attempt: attemptIdx + 1,
      timeout_ms: timeoutMs,
      status: result.status,
      ms: result.ms,
      actor_error: result.actor_error || null,
      timed_out: Boolean(result.timed_out),
      denied: Boolean(result.denied),
      observability: result.observability || null,
    });
    if (result.status !== 'actor_failed') break; // genuine outcome — stop retrying
    // WIRE-CLI-PARITY-GAP-3 rewire: an `action_trust` ledger DENIAL is
    // passed through so shouldRetryActor can short-circuit immediately — a
    // longer per-attempt timeout can never change a trust decision, unlike a
    // genuine subprocess timeout, which a longer budget might legitimately
    // fix.
    if (!shouldRetryActor(attemptIdx, retryCfg.maxRetries, { denied: Boolean(result.denied) })) break;
    console.log(
      `  actor attempt ${attemptIdx + 1}/${retryCfg.maxRetries + 1} failed (${result.actor_error}) — retrying with a longer timeout...`,
    );
    attemptIdx += 1;
  }
  const exhausted = result.status === 'actor_failed';
  return {
    ...result,
    status: exhausted ? 'actor_exhausted_retries' : result.status,
    attempts,
    retry_config: retryCfg,
  };
}

/**
 * Fix 4 (cross-iteration self-learning, read half): fetch prior attempts on
 * THIS weakest feature from the brain and format them into a prompt section.
 * Fails open (fetchPriorAttempts never throws) — a down/unreachable MCP tray
 * simply means no prior-attempts section this iteration.
 */
async function buildPriorAttemptsSection({ weakestId }) {
  const query = `${SELF_LEARNING_TAG} ${weakestId || 'general'}`;
  const priorAttempts = await fetchPriorAttempts({ query, limit: 5 });
  return formatPriorAttemptsSection(priorAttempts);
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
async function maybeIngestPriorIterationLesson({ gemmaDir, gemmaHistory, claudeHistory, gemmaRecord, claudeRecord, iterNum, actorName }) {
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
    prevClaude && typeof claudeRecord.total_0_100 === 'number' && typeof prevClaude.total_0_100 === 'number'
      ? Math.round((claudeRecord.total_0_100 - prevClaude.total_0_100) * 100) / 100
      : null;

  const summary =
    prevActor.status === 'edited'
      ? prevActor.claude_result_text || '(no summary text returned)'
      : prevActor.status === 'contract_failed'
        ? `edit rejected by the frozen contract: ${(prevActor.contract_violations || []).join('; ')}`
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

/** ONE full autonomous iteration: render (shared) -> gemma judge -> Fable-5-vision judge -> actor edit. */
export async function runIterationTerransoul({
  planePath,
  iter,
  actor,
  model,
  effort,
  maxActorRetries,
  cliBinary,
  cliDataDir,
  contractModulePath,
  contractLabel,
  patience,
  budget,
  judgeMode,
  judgeSamples,
}) {
  const { rubric, rubricSha256 } = loadRubric();
  const effPatience = patience || rubric.stall_patience;
  const effBudget = budget || rubric.iteration_budget;
  // Opus-4.8 PANEL judge mode (owner decision 2026-07-12): Opus 4.8 vision
  // (reference-anchored, judge/judge-claude.mjs) becomes the GATING judge, run
  // as a median-of-N panel, with a per-view CALIBRATED bar; gemma4:12b stays a
  // reported, non-gating diversity cross-check. Default 'gemma' keeps the frozen
  // track byte-identical.
  const opusPanel = judgeMode === 'opus-panel';
  const opusSamples =
    Number.isInteger(judgeSamples) && judgeSamples > 0 ? judgeSamples : opusPanel ? 3 : CLAUDE_JUDGE_SAMPLES;
  const opusJudgeModel = opusPanel ? 'claude-opus-4-8' : model || DEFAULT_MODEL;
  const calibratedBar =
    opusPanel && Array.isArray(rubric.view_threshold_calibrated)
      ? rubric.view_threshold_calibrated
      : rubric.view_threshold;
  const actorName = actor || DEFAULT_ACTOR;
  const gemmaDir = path.join(BENCH_DIR, 'results', actorName);
  const claudeDir = path.join(BENCH_DIR, 'results', `${actorName}-claude`);
  mkdirSync(gemmaDir, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });

  const gemmaHistory = loadHistory(gemmaDir);
  const claudeHistory = loadHistory(claudeDir);
  const iterNum = iter ?? (gemmaHistory.length > 0 ? gemmaHistory[gemmaHistory.length - 1].iter + 1 : 1);
  if (gemmaHistory.some((h) => h.iter === iterNum) || claudeHistory.some((h) => h.iter === iterNum)) {
    throw new Error(`iteration ${iterNum} already recorded for actor ${actorName}`);
  }

  const runId = `${actorName}-iter-${iterNum}-${Date.now().toString(36)}`;
  console.log(`\n=== ITER ${iterNum} (${actorName}) ===`);
  console.log(`rig: rendering ${planePath} as ${runId}`);
  const rig = await runRig({ planePath, runId, contractModulePath });

  console.log(
    `judge (gemma4${opusPanel ? ', reported diversity cross-check' : ', frozen primary'}): scoring 9 views (median of seeds ${rubric.judge_seeds.join('/')})`,
  );
  const gemmaJudged = await judgeShots({ shotsDir: rig.outDir });
  if (!gemmaJudged) throw new Error('gemma judge did not complete all 9 views');

  console.log(
    `judge (${opusJudgeModel} vision${opusPanel ? ' PANEL, gating' : ''}): scoring 9 views (samples=${opusSamples})`,
  );
  const claudeJudged = await judgeShotsClaude({
    shotsDir: rig.outDir,
    samples: opusSamples,
    model: opusJudgeModel,
  });
  if (!claudeJudged) throw new Error('claude vision judge did not complete all 9 views');

  let gemmaRecord = bookkeepTrack({
    actorDir: gemmaDir,
    iterNum,
    runId,
    judged: gemmaJudged,
    judgeTrack: undefined,
    rubric,
    rubricSha256,
  });
  let claudeRecord = bookkeepTrack({
    actorDir: claudeDir,
    iterNum,
    runId,
    judged: claudeJudged,
    judgeTrack: claudeJudged.judge_track,
    rubric,
    rubricSha256,
  });

  console.log(
    `ITER ${iterNum} gemma4=${gemmaRecord.total_0_100}/100 (best ${gemmaRecord.best_total_after}) | ` +
      `${claudeJudged.judge_track}=${claudeRecord.total_0_100}/100 (best ${claudeRecord.best_total_after})`,
  );

  // Fix 4 (write half): learn from the PREVIOUS iteration's actor edit now
  // that this iteration's fresh scores make its effect observable. Fails
  // open — an MCP error here must never break the bench loop.
  try {
    await maybeIngestPriorIterationLesson({
      gemmaDir,
      gemmaHistory,
      claudeHistory,
      gemmaRecord,
      claudeRecord,
      iterNum,
      actorName,
    });
  } catch (err) {
    console.log(`  self-learning lesson ingest skipped: ${String(err.message || err)}`);
  }

  // Primary (gating) vs secondary (reported) judge track. In opus-panel mode the
  // Opus 4.8 vision panel gates the loop (weakest feature, critic, escalation,
  // stop threshold); gemma4:12b is the reported diversity cross-check. Default:
  // gemma gates (frozen behavior).
  const primaryJudged = opusPanel ? claudeJudged : gemmaJudged;
  const primaryRecord = opusPanel ? claudeRecord : gemmaRecord;
  const primaryHistory = opusPanel ? claudeHistory : gemmaHistory;

  // Fix 4 (read half): surface prior attempts on this weakest feature.
  const weakestId =
    primaryJudged.weakest_feature?.id || gemmaJudged.weakest_feature?.id || claudeJudged.weakest_feature?.id;
  const priorAttemptsSection = await buildPriorAttemptsSection({ weakestId });

  // Plateau -> mesh escalation (open track ONLY). Uses the SAME genuine-iteration
  // filter the stop conditions use, so an infra-failed iteration never counts.
  // Driven by the PRIMARY (gating) judge's weakest feature.
  let plateauEscalation = null;
  if (contractModulePath) {
    const weakest = primaryJudged.weakest_feature;
    if (weakest && typeof weakest.mean === 'number') {
      const genuineChain = filterGenuineIterationsForStopConditions([...primaryHistory, primaryRecord]);
      const streak = meshEscalationStreak(genuineChain, weakest.id);
      const gap = rubric.view_threshold - weakest.mean;
      if (gap > MESH_ESCALATION_GAP || streak >= Math.max(2, effPatience - 1)) {
        plateauEscalation = buildMeshEscalation({ weakest, streak, gap, viewThreshold: rubric.view_threshold });
        console.log(
          `  PLATEAU ESCALATION armed for '${weakest.id}' (mean ${weakest.mean}/10, gap ${gap.toFixed(1)}, streak ${streak}) ` +
            `-- actor directed to rebuild it as a computed mesh`,
        );
      }
    }
  }

  // Fix 1: retry-with-backoff instead of a single all-or-nothing call.
  const retryCfg = loadActorRetryConfig({ overrideMaxRetries: maxActorRetries });
  console.log(
    `actor: driving ${model || DEFAULT_MODEL} (--effort ${effort || DEFAULT_EFFORT}) to edit ${planePath} ` +
      `(retry policy: ${retryCfg.maxRetries} retries, base ${retryCfg.baseTimeoutMs}ms, cap ${retryCfg.timeoutCapMs}ms, source=${retryCfg.source})`,
  );
  const actorResult = await runActorWithRetries({
    retryCfg,
    candidatePath: planePath,
    shotsDir: rig.outDir,
    gemmaResult: gemmaJudged,
    claudeResult: claudeJudged,
    model: model || DEFAULT_MODEL,
    effort: effort || DEFAULT_EFFORT,
    priorAttemptsSection,
    plateauEscalation,
    cliBinary,
    cliDataDir,
    contractModulePath,
    contractLabel,
  });
  console.log(
    `actor status: ${actorResult.status} (changed=${actorResult.changed}, $${actorResult.cost_usd}, ` +
      `${Math.round(actorResult.ms / 1000)}s, attempts=${actorResult.attempts.length})`,
  );
  if (actorResult.status === 'contract_failed') {
    console.log(`  CONTRACT VIOLATIONS (edit rejected, previous candidate restored):`);
    for (const v of actorResult.contract_violations) console.log(`    - ${v}`);
  }
  if (actorResult.status === 'actor_exhausted_retries') {
    // WIRE-CLI-PARITY-GAP-3 rewire: distinguish a `action_trust` ledger
    // DENIAL (no retry was even attempted — shouldRetryActor short-circuits
    // it, see lib/actor-retry.mjs) from a genuine infra timeout/crash that
    // burned the full retry budget, in the human-readable log only — both
    // still share the SAME `actor_exhausted_retries` status for the
    // stop-condition exclusion mechanism (lib/actor-retry.mjs's
    // filterGenuineIterationsForStopConditions/computeTrailingExhaustionStreak).
    const deniedRun = actorResult.attempts.some((a) => a.denied);
    console.log(
      deniedRun
        ? `  ACTOR CALL DENIED by the action_trust ledger (no retry attempted — a longer timeout cannot change a ` +
            `trust decision) — NOT fed into evaluateStopConditions as a capability signal: ${actorResult.actor_error}`
        : `  ACTOR EXHAUSTED ALL ${actorResult.attempts.length} RETRIES (no change applied) — infra failure, ` +
            `NOT fed into evaluateStopConditions as a capability signal: ${actorResult.actor_error}`,
    );
  }
  writeFileSync(path.join(gemmaDir, `iter-${iterNum}-actor.json`), JSON.stringify(actorResult, null, 2));

  // Fix 2: tag both tracks' records with the actor outcome so the stall/
  // threshold/budget counters (evaluateStopConditions, FROZEN) only ever see
  // genuine attempts — an actor_exhausted_retries iteration is excluded from
  // the arrays below, on THIS call and every future loadHistory() call.
  gemmaRecord = patchActorStatus(gemmaDir, iterNum, gemmaRecord, actorResult.status);
  claudeRecord = patchActorStatus(claudeDir, iterNum, claudeRecord, actorResult.status);

  const gemmaIterations = filterGenuineIterationsForStopConditions([...gemmaHistory, gemmaRecord]);
  const claudeIterations = filterGenuineIterationsForStopConditions([...claudeHistory, claudeRecord]);
  // gemma always uses its uniform bar; the Opus track uses the per-view
  // CALIBRATED bar in opus-panel mode (else the same uniform bar).
  const gemmaStopCfg = { viewThreshold: rubric.view_threshold, patience: effPatience, budget: effBudget };
  const claudeStopCfg = { viewThreshold: calibratedBar, patience: effPatience, budget: effBudget };
  const gemmaStop = evaluateStopConditions(gemmaIterations, gemmaStopCfg);
  const claudeStop = evaluateStopConditions(claudeIterations, claudeStopCfg);

  // A SEPARATE, explicit exhaustion cap — distinct from `stall` — so a
  // genuinely broken/unreachable `claude` CLI cannot spin the loop forever,
  // while a single exhausted iteration (a transient infra hiccup) does NOT
  // by itself end the loop the way a real stall does.
  const exhaustionStreak = computeTrailingExhaustionStreak([...gemmaHistory, gemmaRecord]);
  const exhaustionCapped = exhaustionStreak >= retryCfg.exhaustionCap;
  const exhaustionReason = exhaustionCapped
    ? [
        `actor_exhausted_retries_cap: ${exhaustionStreak} consecutive iteration(s) fully exhausted actor retries ` +
          `(cap ${retryCfg.exhaustionCap}) — infra failure, NOT a demonstrated capability ceiling`,
      ]
    : [];

  // GATING. Default (gemma primary): stop when EITHER track's own stop fires
  // (a threshold on either judge is a legitimate "done"; a stall/budget on
  // either legitimately stops the loop). opus-panel: the Opus 4.8 vision panel
  // is the SOLE gating judge (threshold on its per-view calibrated bar / stall /
  // budget); gemma is reported only and never gates. The exhaustion cap always
  // applies. Nothing is silently enforced — every reason is printed.
  const primaryStop = opusPanel ? claudeStop : { stop: gemmaStop.stop || claudeStop.stop };
  const stop = {
    stop: primaryStop.stop || exhaustionCapped,
    reasons: [
      ...gemmaStop.reasons.map((r) => `gemma4${opusPanel ? ' (reported)' : ''}: ${r}`),
      ...claudeStop.reasons.map((r) => `${claudeJudged.judge_track}${opusPanel ? ' (gating)' : ''}: ${r}`),
      ...exhaustionReason,
    ],
    gemma: gemmaStop,
    claude: claudeStop,
    actor_exhausted_retries_cap: exhaustionCapped,
  };
  console.log(
    `STOP-CHECK stop=${stop.stop} gemma[nonImproving=${gemmaStop.consecutiveNonImproving}/${effPatience} budget=${gemmaIterations.length}/${effBudget}] ` +
      `${claudeJudged.judge_track}[nonImproving=${claudeStop.consecutiveNonImproving}/${effPatience} budget=${claudeIterations.length}/${effBudget}] ` +
      `exhaustionStreak=${exhaustionStreak}/${retryCfg.exhaustionCap}`,
  );
  for (const reason of stop.reasons) console.log(`  STOP REASON: ${reason}`);

  return { iterNum, gemmaRecord, claudeRecord, actorResult, stop };
}

/** Drive the loop to ITS OWN stop condition (threshold / stall / budget / exhaustion cap) — never forced early, never fabricated. */
export async function runLoopTerransoul({
  planePath,
  actor,
  model,
  effort,
  maxIter,
  maxActorRetries,
  cliBinary,
  cliDataDir,
  contractModulePath,
  contractLabel,
  patience,
  budget,
  judgeMode,
  judgeSamples,
}) {
  const { rubric } = loadRubric();
  const effBudget = budget || rubric.iteration_budget;
  const hardCap = maxIter ? Math.min(maxIter, effBudget) : effBudget;
  let last = null;
  for (let i = 0; i < hardCap; i++) {
    last = await runIterationTerransoul({
      planePath,
      actor,
      model,
      effort,
      maxActorRetries,
      cliBinary,
      cliDataDir,
      contractModulePath,
      contractLabel,
      patience,
      budget,
      judgeMode,
      judgeSamples,
    });
    if (last.stop.stop) break;
  }
  return last;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plane) {
    console.error(
      'usage: node loop-runner-terransoul.mjs --plane <plane.js> [--actor terransoul-fable5] [--model claude-fable-5] ' +
        '[--effort max] [--max-iter N] [--max-actor-retries N] [--cli-bin <path>] [--cli-data-dir <dir>] [--contract open|frozen] [--budget N] [--patience N] [--judge gemma|opus-panel] [--judge-samples N]',
    );
    process.exit(2);
  }
  // --contract open swaps ONLY the candidate contract validator + actor-prompt
  // contract text (OPEN-VARIANT-DESIGN.md); default frozen leaves both undefined
  // so runActorEdit takes its byte-identical frozen path.
  const contractChoice = typeof args.contract === 'string' ? args.contract.toLowerCase() : 'frozen';
  if (contractChoice !== 'open' && contractChoice !== 'frozen') {
    console.error(`--contract must be 'open' or 'frozen' (got: ${args.contract})`);
    process.exit(2);
  }
  const contractModulePath = contractChoice === 'open' ? CONTRACT_OPEN_PATH : undefined;
  const contractLabel = contractChoice === 'open' ? 'lib/contract-open.mjs' : undefined;
  console.log(`contract track: ${contractChoice}${contractModulePath ? ` (${contractModulePath})` : ''}`);
  runLoopTerransoul({
    planePath: args.plane,
    actor: args.actor,
    model: typeof args.model === 'string' ? args.model : undefined,
    effort: typeof args.effort === 'string' ? args.effort : undefined,
    maxIter: args['max-iter'] ? Number(args['max-iter']) : undefined,
    maxActorRetries: args['max-actor-retries'] ? Number(args['max-actor-retries']) : undefined,
    cliBinary: typeof args['cli-bin'] === 'string' ? args['cli-bin'] : undefined,
    cliDataDir: typeof args['cli-data-dir'] === 'string' ? args['cli-data-dir'] : undefined,
    contractModulePath,
    contractLabel,
    patience: args.patience ? Number(args.patience) : undefined,
    budget: args.budget ? Number(args.budget) : undefined,
    judgeMode: args.judge === 'opus-panel' ? 'opus-panel' : 'gemma',
    judgeSamples: args['judge-samples'] ? Number(args['judge-samples']) : undefined,
  })
    .then((last) => {
      console.log('\nLOOP DONE');
      if (last) {
        console.log(`final iter=${last.iterNum} gemma4=${last.gemmaRecord.total_0_100}/100 opus/claude-vision=${last.claudeRecord.total_0_100}/100`);
      }
    })
    .catch((err) => {
      console.error(`LOOP_TERRANSOUL_FAIL ${err.message}`);
      process.exit(1);
    });
}
