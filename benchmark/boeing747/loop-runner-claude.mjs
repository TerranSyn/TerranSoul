// Opus-4.8-vision iteration runner for the Boeing 747 benchmark.
//
// Same rig + same rubric + same best/stop bookkeeping as loop-runner.mjs, but
// scored by the Claude Opus 4.8 vision judge (judge/judge-claude.mjs) instead
// of gemma4. Results land in results/<actor>-claude/ so the two judge tracks
// sit side by side and never clobber each other.
//
// The weakest FEATURE is computed deterministically from the scores
// (lib/scoring.mjs weakestCriterion); the anchor-based fix hint is attached so
// the record is self-describing. The human/agent doing the geometry edits reads
// per-view `notes` from the judge results for richer steering.
//
// CLI:
//   node benchmark/boeing747/loop-runner-claude.mjs --plane <plane.js>
//     [--iter <k>] [--actor terransoul-opus48] [--samples N]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRig } from './rig/render-rig.mjs';
import { judgeShotsClaude } from './judge/judge-claude.mjs';
import { loadRubric } from './judge/judge.mjs';
import { evaluateStopConditions } from './lib/stop-conditions.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACTOR = 'terransoul-opus48';
const TRACK_SUFFIX = '-claude';

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

export async function runIterationClaude({ planePath, iter, actor, samples }) {
  const { rubric, rubricSha256 } = loadRubric();
  const actorName = (actor || DEFAULT_ACTOR) + TRACK_SUFFIX;
  const actorDir = path.join(BENCH_DIR, 'results', actorName);
  mkdirSync(actorDir, { recursive: true });

  const history = loadHistory(actorDir);
  const iterNum = iter ?? (history.length > 0 ? history[history.length - 1].iter + 1 : 1);
  if (history.some((h) => h.iter === iterNum)) {
    throw new Error(`iteration ${iterNum} already recorded for actor ${actorName}`);
  }

  // Unique per-run shots dir (timestamp suffix) so a re-run of the same iter
  // never reuses a previous run's stale judge-claude partials.
  const runId = `${actorName}-iter-${iterNum}-${Date.now().toString(36)}`;
  console.log(`rig: rendering ${planePath} as ${runId}`);
  const rig = await runRig({ planePath, runId });
  console.log(`judge: scoring 9 views with Claude Opus 4.8 vision (samples=${samples || 1})`);
  const judged = await judgeShotsClaude({ shotsDir: rig.outDir, samples: samples || 1 });
  if (!judged) throw new Error('claude judge did not complete all 9 views');

  const bestFile = path.join(actorDir, 'best.json');
  const prevBest = existsSync(bestFile) ? JSON.parse(readFileSync(bestFile, 'utf8')) : null;
  const total = judged.total_0_100;
  const improved = typeof total === 'number' && (!prevBest || total > prevBest.total_0_100);
  const regressed = prevBest !== null && !improved;

  const record = {
    actor: actorName,
    judge_track: 'claude-opus-4-8-vision',
    iter: iterNum,
    run_id: runId,
    plane_sha256: judged.plane_sha256,
    rubric_sha256: judged.rubric_sha256 ?? rubricSha256,
    total_0_100: total,
    per_view: judged.per_view.map((v) => ({ view: v.view, key: v.key, score: v.score, notes: v.notes })),
    weakest_feature: judged.weakest_feature,
    critic: anchorHint(rubric, judged.weakest_feature),
    total_cost_usd: judged.total_cost_usd,
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
  console.log(`ITER ${iterNum} total=${total}/100 ${regressed ? 'REGRESSED (best kept)' : improved ? 'improved' : 'first'} [Opus 4.8 vision]`);
  console.log(`BEST  ${record.best_total_after}/100`);
  console.log('PER-CRITERION (weakest→): ' + JSON.stringify(judged.weakest_feature?.perCriterion ?? {}));
  if (record.critic) console.log(`WEAKEST ${record.critic.weakest_feature}: mean ${judged.weakest_feature.mean}`);
  console.log(`COST $${judged.total_cost_usd}`);
  console.log(
    `STOP-CHECK stop=${stop.stop} nonImproving=${stop.consecutiveNonImproving}/${rubric.stall_patience} budget=${iterations.length}/${rubric.iteration_budget}`,
  );
  for (const reason of stop.reasons) console.log(`  STOP REASON: ${reason}`);
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
  if (!args.plane) {
    console.error('usage: node loop-runner-claude.mjs --plane <plane.js> [--iter <k>] [--actor <name>] [--samples N]');
    process.exit(2);
  }
  runIterationClaude({
    planePath: args.plane,
    iter: args.iter ? Number(args.iter) : undefined,
    actor: args.actor,
    samples: args.samples ? Number(args.samples) : 1,
  }).catch((err) => {
    console.error(`LOOP_CLAUDE_FAIL ${err.message}`);
    process.exit(1);
  });
}
