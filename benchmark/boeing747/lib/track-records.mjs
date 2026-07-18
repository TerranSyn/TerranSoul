// Per-track iteration-record IO (history load, iter-N.json bookkeeping, the
// record-plane snapshot, and the actor-status patch), extracted VERBATIM from
// loop-runner-terransoul.mjs (max-lines refactor, 2026-07-18). bookkeepTrack
// is re-exported by the runner so loop-runner-record.test.mjs's import against
// './loop-runner-terransoul.mjs' is unchanged. Only the module-local imports
// and `export` keywords were added by the move — no logic changed.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function loadHistory(actorDir) {
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

export function bookkeepTrack({ actorDir, iterNum, runId, judged, judgeTrack, rubric, rubricSha256, planePath }) {
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
    // scored_views/missing_views: judge.mjs already computes these (lib/scoring.mjs's
    // totalScore) but never persisted them — without this, an 8-view total (a view
    // legitimately unassessable from its angle) silently compares against a stale
    // 9-view record with no record of the different basis.
    scored_views: judged.scored_views, missing_views: judged.missing_views,
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
    // Snapshot the geometry that PRODUCED the record, next to the record itself.
    //
    // best.json is the all-time high and is correctly monotone. best-plane.js is a
    // different thing: the edit-gate's BACKTRACK ANCHOR, advanced only when the gate
    // ACCEPTS an edit. Those two came apart on a real run and the record was lost:
    // iter-8 scored an all-time-high 61.29, but the gemma-downside veto demoted the
    // accept to `within_noise`, and within_noise takes no snapshot — so the record
    // geometry existed only in the working plane.js and iter-9's actor overwrote it
    // in place. best.json still names a sha256 that now matches no file on disk.
    //
    // A record you cannot re-render is not a record. Persist it here, on exactly the
    // condition that defines the record, and never through the gate.
    if (planePath && existsSync(planePath)) {
      try {
        copyFileSync(planePath, path.join(actorDir, 'record-plane.js'));
      } catch (err) {
        // Loud, not fatal: losing the loop over a failed copy would be worse, but a
        // silent failure here is what cost us the 61.29 geometry in the first place.
        console.log(`  WARNING: could not snapshot the record plane for iter ${iterNum}: ${String(err?.message || err)}`);
      }
    }
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
export function patchActorStatus(actorDir, iterNum, record, actorStatus) {
  record.actor_status = actorStatus;
  writeFileSync(path.join(actorDir, `iter-${iterNum}.json`), JSON.stringify(record, null, 2));
  return record;
}
