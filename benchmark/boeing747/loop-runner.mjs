// Iteration protocol runner for the Boeing 747 primitives vision benchmark.
//
// The coordinator (running the TerranSoul + Claude Opus 4.8 improvement loop) calls this
// once per iteration with the iteration-k candidate plane.js:
//   rig -> judge (median-of-3, frozen rubric) -> critic (weakest feature)
//   -> results/<actor>/iter-<k>.json + best-so-far tracking.
//
// Frozen protocol rules implemented here:
//   - a regression on the total vs best KEEPS best and marks the iteration
//     `regressed: true`;
//   - stop conditions (printed, NEVER silently enforced): all 9 views >=
//     rubric view_threshold (8.0/10), 3 consecutive non-improving
//     iterations, or the 12-iteration budget.
//
// CLI:
//   node benchmark/boeing747/loop-runner.mjs --plane <plane.js> [--iter <k>]
//     [--actor terransoul-opus48] [--skip-critic]
//   --from-scored <results.json>  (test utility: replay an already-judged
//     results file through best/stop bookkeeping without LLM calls)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRig } from './rig/render-rig.mjs';
import { criticPass, judgeShots, loadRubric } from './judge/judge.mjs';
import { evaluateStopConditions } from './lib/stop-conditions.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
// Hero configuration (user directive 2026-07-04): Claude Opus 4.8 coordinates
// the TerranSoul self-improve loop; the actor label names its results dir.
const DEFAULT_ACTOR = 'terransoul-opus48';

function loadHistory(actorDir) {
  if (!existsSync(actorDir)) return [];
  return readdirSync(actorDir)
    .filter((f) => /^iter-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(path.join(actorDir, f), 'utf8')))
    .sort((a, b) => a.iter - b.iter);
}

export async function runIteration({ planePath, iter, actor, skipCritic, fromScored }) {
  const { rubric, rubricSha256 } = loadRubric();
  const actorName = actor || DEFAULT_ACTOR;
  const actorDir = path.join(BENCH_DIR, 'results', actorName);
  mkdirSync(actorDir, { recursive: true });

  const history = loadHistory(actorDir);
  const iterNum = iter ?? (history.length > 0 ? history[history.length - 1].iter + 1 : 1);
  if (history.some((h) => h.iter === iterNum)) {
    throw new Error(`iteration ${iterNum} already recorded for actor ${actorName}`);
  }

  let judged;
  let runId;
  if (fromScored) {
    judged = JSON.parse(readFileSync(path.resolve(fromScored), 'utf8'));
    runId = judged.run_id;
    console.log(`(from-scored) replaying ${fromScored} as iteration ${iterNum}`);
  } else {
    runId = `${actorName}-iter-${iterNum}`;
    console.log(`rig: rendering ${planePath} as ${runId}`);
    const rig = await runRig({ planePath, runId });
    console.log(`judge: scoring 9 views (median of seeds ${rubric.judge_seeds.join('/')})`);
    judged = await judgeShots({ shotsDir: rig.outDir });
    if (!judged) throw new Error('judge did not complete all 9 views');
    if (!skipCritic) {
      await criticPass({
        resultsFile: path.join(rig.outDir, 'judge', 'results.json'),
        shotsDir: rig.outDir,
      });
      judged = JSON.parse(readFileSync(path.join(rig.outDir, 'judge', 'results.json'), 'utf8'));
    }
  }

  // Best-so-far bookkeeping (regression keeps best, marks the iteration).
  const bestFile = path.join(actorDir, 'best.json');
  const prevBest = existsSync(bestFile) ? JSON.parse(readFileSync(bestFile, 'utf8')) : null;
  const total = judged.total_0_100;
  const improved = typeof total === 'number' && (!prevBest || total > prevBest.total_0_100);
  const regressed = prevBest !== null && !improved;

  const record = {
    actor: actorName,
    iter: iterNum,
    run_id: runId,
    plane_sha256: judged.plane_sha256,
    rubric_sha256: judged.rubric_sha256 ?? rubricSha256,
    total_0_100: total,
    per_view: judged.per_view.map((v) => ({ view: v.view, key: v.key, score: v.score })),
    weakest_feature: judged.weakest_feature,
    critic: judged.critic ?? null,
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

  // Stop conditions: printed, never silently enforced.
  const iterations = [...history, record].map((h) => ({
    iter: h.iter,
    total: h.total_0_100,
    perView: h.per_view.map((v) => v.score),
  }));
  const stop = evaluateStopConditions(iterations, {
    viewThreshold: rubric.view_threshold,
    patience: rubric.stall_patience,
    budget: rubric.iteration_budget,
  });

  console.log('');
  console.log(`ITER ${iterNum} total=${total}/100 ${regressed ? 'REGRESSED (best kept)' : improved ? 'improved' : 'first'}`);
  console.log(`BEST  ${record.best_total_after}/100`);
  if (record.critic) console.log(`CRITIC ${record.critic.weakest_feature}: ${record.critic.fix_suggestion}`);
  console.log(
    `STOP-CHECK stop=${stop.stop} nonImproving=${stop.consecutiveNonImproving}/${rubric.stall_patience} budget=${iterations.length}/${rubric.iteration_budget}`,
  );
  for (const reason of stop.reasons) console.log(`  STOP REASON: ${reason}`);
  if (!stop.stop) console.log(`  continue: ${stop.remainingBudget} iterations of budget remain`);
  return { record, stop };
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
  if (!args.plane && !args['from-scored']) {
    console.error(
      'usage: node loop-runner.mjs --plane <plane.js> [--iter <k>] [--actor <name>] [--skip-critic] | --from-scored <results.json> [--iter <k>] [--actor <name>]',
    );
    process.exit(2);
  }
  runIteration({
    planePath: args.plane,
    iter: args.iter ? Number(args.iter) : undefined,
    actor: args.actor,
    skipCritic: args['skip-critic'] === true,
    fromScored: args['from-scored'],
  }).catch((err) => {
    console.error(`LOOP_FAIL ${err.message}`);
    process.exit(1);
  });
}
