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
//     -> runActorEdit (actor/actor-claude.mjs: TerranSoul's own Claude
//        Fable-5-driven edit, its own vision inspection, Read+Edit only)
//     -> contract gate (actor-claude.mjs already restores + records on
//        violation; the loop just reads the resulting status)
//     -> evaluateStopConditions (frozen lib/stop-conditions.mjs, EXACTLY the
//        thresholds/patience/budget loop-runner-claude.mjs already uses)
//
// Results land under NEW actor-name directories so nothing existing is
// touched: results/<actor>/ (gemma4 track, mirrors terransoul-opus48/'s shape)
// and results/<actor>-claude/ (Fable-5-vision track, mirrors
// terransoul-opus48-claude/'s shape).
//
// Judge calls stay strictly sequential (existing discipline — the GPU/CLI may
// be shared); this script itself is the only thing looping, so there is
// exactly one `claude` subprocess in flight at any time.
//
// CLI:
//   node loop-runner-terransoul.mjs --plane <plane.js> [--actor terransoul-fable5]
//     [--model claude-fable-5] [--effort max] [--max-iter N]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActorEdit } from './actor/actor-claude.mjs';
import { judgeShotsClaude } from './judge/judge-claude.mjs';
import { judgeShots, loadRubric } from './judge/judge.mjs';
import { evaluateStopConditions } from './lib/stop-conditions.mjs';
import { runRig } from './rig/render-rig.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACTOR = 'terransoul-fable5';
const DEFAULT_MODEL = 'claude-fable-5';
const DEFAULT_EFFORT = 'max';
const CLAUDE_JUDGE_SAMPLES = 1;

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

/** ONE full autonomous iteration: render (shared) -> gemma judge -> Fable-5-vision judge -> actor edit. */
export async function runIterationTerransoul({ planePath, iter, actor, model, effort }) {
  const { rubric, rubricSha256 } = loadRubric();
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
  const rig = await runRig({ planePath, runId });

  console.log(`judge (gemma4, frozen): scoring 9 views (median of seeds ${rubric.judge_seeds.join('/')})`);
  const gemmaJudged = await judgeShots({ shotsDir: rig.outDir });
  if (!gemmaJudged) throw new Error('gemma judge did not complete all 9 views');

  console.log(`judge (${model || DEFAULT_MODEL} vision): scoring 9 views (samples=${CLAUDE_JUDGE_SAMPLES})`);
  const claudeJudged = await judgeShotsClaude({
    shotsDir: rig.outDir,
    samples: CLAUDE_JUDGE_SAMPLES,
    model: model || DEFAULT_MODEL,
  });
  if (!claudeJudged) throw new Error('claude vision judge did not complete all 9 views');

  const gemmaRecord = bookkeepTrack({
    actorDir: gemmaDir,
    iterNum,
    runId,
    judged: gemmaJudged,
    judgeTrack: undefined,
    rubric,
    rubricSha256,
  });
  const claudeRecord = bookkeepTrack({
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

  console.log(`actor: driving ${model || DEFAULT_MODEL} (--effort ${effort || DEFAULT_EFFORT}) to edit ${planePath}`);
  const actorResult = await runActorEdit({
    candidatePath: planePath,
    shotsDir: rig.outDir,
    gemmaResult: gemmaJudged,
    claudeResult: claudeJudged,
    model: model || DEFAULT_MODEL,
    effort: effort || DEFAULT_EFFORT,
  });
  console.log(`actor status: ${actorResult.status} (changed=${actorResult.changed}, $${actorResult.cost_usd}, ${Math.round(actorResult.ms / 1000)}s)`);
  if (actorResult.status === 'contract_failed') {
    console.log(`  CONTRACT VIOLATIONS (edit rejected, previous candidate restored):`);
    for (const v of actorResult.contract_violations) console.log(`    - ${v}`);
  }
  if (actorResult.status === 'actor_failed') {
    console.log(`  ACTOR ERROR (no change applied): ${actorResult.actor_error}`);
  }
  writeFileSync(path.join(gemmaDir, `iter-${iterNum}-actor.json`), JSON.stringify(actorResult, null, 2));

  const gemmaIterations = [...gemmaHistory, gemmaRecord].map((h) => ({
    iter: h.iter,
    total: h.total_0_100,
    perView: h.per_view.map((v) => v.score),
  }));
  const claudeIterations = [...claudeHistory, claudeRecord].map((h) => ({
    iter: h.iter,
    total: h.total_0_100,
    perView: h.per_view.map((v) => v.score),
  }));
  const stopCfg = { viewThreshold: rubric.view_threshold, patience: rubric.stall_patience, budget: rubric.iteration_budget };
  const gemmaStop = evaluateStopConditions(gemmaIterations, stopCfg);
  const claudeStop = evaluateStopConditions(claudeIterations, stopCfg);
  // Stop when EITHER track's own stop condition fires (threshold on either
  // judge is a legitimate "done"; a stall/budget on either is a legitimate
  // "stop looping") — printed per-track, never silently enforced.
  const stop = {
    stop: gemmaStop.stop || claudeStop.stop,
    reasons: [...gemmaStop.reasons.map((r) => `gemma4: ${r}`), ...claudeStop.reasons.map((r) => `${claudeJudged.judge_track}: ${r}`)],
    gemma: gemmaStop,
    claude: claudeStop,
  };
  console.log(
    `STOP-CHECK stop=${stop.stop} gemma[nonImproving=${gemmaStop.consecutiveNonImproving}/${rubric.stall_patience} budget=${gemmaIterations.length}/${rubric.iteration_budget}] ` +
      `${claudeJudged.judge_track}[nonImproving=${claudeStop.consecutiveNonImproving}/${rubric.stall_patience} budget=${claudeIterations.length}/${rubric.iteration_budget}]`,
  );
  for (const reason of stop.reasons) console.log(`  STOP REASON: ${reason}`);

  return { iterNum, gemmaRecord, claudeRecord, actorResult, stop };
}

/** Drive the loop to ITS OWN stop condition (threshold / stall / budget) — never forced early, never fabricated. */
export async function runLoopTerransoul({ planePath, actor, model, effort, maxIter }) {
  const { rubric } = loadRubric();
  const hardCap = Math.min(maxIter || rubric.iteration_budget, rubric.iteration_budget);
  let last = null;
  for (let i = 0; i < hardCap; i++) {
    last = await runIterationTerransoul({ planePath, actor, model, effort });
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
      'usage: node loop-runner-terransoul.mjs --plane <plane.js> [--actor terransoul-fable5] [--model claude-fable-5] [--effort max] [--max-iter N]',
    );
    process.exit(2);
  }
  runLoopTerransoul({
    planePath: args.plane,
    actor: args.actor,
    model: typeof args.model === 'string' ? args.model : undefined,
    effort: typeof args.effort === 'string' ? args.effort : undefined,
    maxIter: args['max-iter'] ? Number(args['max-iter']) : undefined,
  })
    .then((last) => {
      console.log('\nLOOP DONE');
      if (last) {
        console.log(`final iter=${last.iterNum} gemma4=${last.gemmaRecord.total_0_100}/100 fable5-vision=${last.claudeRecord.total_0_100}/100`);
      }
    })
    .catch((err) => {
      console.error(`LOOP_TERRANSOUL_FAIL ${err.message}`);
      process.exit(1);
    });
}
