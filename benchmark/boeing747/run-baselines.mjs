// Single-shot baseline protocol for the Boeing 747 primitives vision bench.
//
// Per model: prompt ONCE for plane.js (frozen builder prompt in rubric.json,
// temperature 0, fixed seed) -> contract-check -> execute in the rig ->
// judge -> results/baseline-<model>.json. No iteration, no critic feedback —
// this measures the model's one-shot ability under the same frozen rig+judge
// the loop uses.
//
// Every stage is resumable (generation, shots, and judged views are reused
// if present) so a GPU-contended run can be re-invoked until it converges.
//
// Sandbox note: the generated plane.js executes inside the rig page, so the
// SOURCE is contract-checked first (no imports/network/DOM/loaders — see
// lib/contract.mjs), the same class of gating as the repo's execute_code
// checks. A contract violation is recorded as a factual result, not retried.
//
// CLI: node benchmark/boeing747/run-baselines.mjs [--models m1,m2] [--force-generate]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlaneSource } from './lib/contract.mjs';
import { extractReplyText } from './lib/judge-parse.mjs';
import { judgeShots, loadRubric, ollamaChat } from './judge/judge.mjs';
import { openaiActorChat } from './lib/openai-actor.mjs';
import { runRig, sha256 } from './rig/render-rig.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
// Standardized on the two blessed local models (user directive 2026-07-04):
// gemma4:12b-it-qat is the sole local baseline. The hero configuration is
// Claude Opus 4.8 + TerranSoul self-improve (see run-loop), not a local model.
const DEFAULT_MODELS = ['gemma4:12b-it-qat'];

// Optional OpenAI-compat ACTOR endpoint (env-gated, default OFF). When
// ACTOR_OPENAI_BASE_URL is set, ONLY the baseline actor (generateCandidate) is
// driven via POST /v1/chat/completions — e.g. the Bonsai 27B 1-bit fork on
// http://127.0.0.1:8092 — for a gemma4-vs-Bonsai head-to-head. The frozen judge
// (judge/judge.mjs) is untouched and keeps hitting Ollama gemma4:12b-it-qat.
// Unset => the default path below is byte-identical to before this branch.
const ACTOR_OPENAI_BASE_URL = process.env.ACTOR_OPENAI_BASE_URL || '';
const ACTOR_OPENAI_MODEL = process.env.ACTOR_OPENAI_MODEL || 'bonsai-27b';

const sanitize = (model) => model.replace(/[^a-z0-9._-]+/gi, '_');

/** Extract the module source from the model reply (code fence preferred). */
export function extractModule(reply) {
  const fence = reply.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
  let src = (fence ? fence[1] : reply).trim();
  // Some models emit `function buildPlane` without the export keyword.
  if (!/export\s+(?:async\s+)?function\s+buildPlane/.test(src) && /function\s+buildPlane\s*\(/.test(src)) {
    src = src.replace(/(^|\n)(\s*)function\s+buildPlane\s*\(/, '$1$2export function buildPlane(');
  }
  return src;
}

async function generateCandidate({ rubric, model, outDir, force }) {
  const planePath = path.join(outDir, 'plane.js');
  const replyPath = path.join(outDir, 'generation.json');
  if (existsSync(planePath) && !force) {
    console.log(`  SKIP generation (exists: ${planePath})`);
    return { planePath, reused: true };
  }
  mkdirSync(outDir, { recursive: true });
  const via = ACTOR_OPENAI_BASE_URL
    ? `OpenAI-compat ${ACTOR_OPENAI_BASE_URL} (${ACTOR_OPENAI_MODEL})`
    : `Ollama ${model}`;
  console.log(`  generating plane.js via ${via} (single shot, temperature 0, seed ${rubric.baseline_builder_seed})...`);
  const started = Date.now();
  const messages = [{ role: 'user', content: rubric.baseline_builder_prompt }];
  const options = { ...rubric.baseline_builder_options, seed: rubric.baseline_builder_seed };
  // Actor transport is env-gated; the judge path is never affected (see above).
  const { body, ms } = ACTOR_OPENAI_BASE_URL
    ? await openaiActorChat({
        baseUrl: ACTOR_OPENAI_BASE_URL,
        model: ACTOR_OPENAI_MODEL,
        messages,
        options,
        timeoutMs: rubric.baseline_builder_timeout_ms,
      })
    : await ollamaChat({
        model,
        messages,
        options,
        think: rubric.baseline_builder_think,
        timeoutMs: rubric.baseline_builder_timeout_ms,
      });
  // Same extraction discipline as the judge: content -> thinking fallback,
  // with done_reason recorded (a truncated builder reply is a factual result).
  const reply = extractReplyText(body);
  const source = extractModule(reply.text);
  writeFileSync(planePath, source);
  writeFileSync(
    replyPath,
    JSON.stringify(
      {
        model,
        generated_at: new Date().toISOString(),
        ms: ms ?? Date.now() - started,
        reply_chars: reply.text.length,
        reply_source: reply.source,
        done_reason: reply.doneReason,
        source_sha256: sha256(source),
      },
      null,
      2,
    ),
  );
  console.log(`  generated ${source.length} chars in ${Math.round((ms ?? Date.now() - started) / 1000)}s`);
  return { planePath, reused: false };
}

export async function runBaseline({ model, forceGenerate }) {
  const { rubric, rubricSha256 } = loadRubric();
  const id = sanitize(model);
  const candDir = path.join(BENCH_DIR, 'candidates', `baseline-${id}`);
  const resultsDir = path.join(BENCH_DIR, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const resultFile = path.join(resultsDir, `baseline-${id}.json`);
  console.log(`BASELINE ${model}`);

  const { planePath } = await generateCandidate({ rubric, model, outDir: candDir, force: forceGenerate });
  const source = readFileSync(planePath, 'utf8');
  const contract = validatePlaneSource(source);

  const base = {
    protocol: `${rubric.protocol} (single-shot baseline)`,
    rubric_sha256: rubricSha256,
    builder_model: model,
    builder_seed: rubric.baseline_builder_seed,
    builder_options: rubric.baseline_builder_options,
    plane_sha256: sha256(source),
    contract_ok: contract.ok,
    contract_violations: contract.violations,
    created_at: new Date().toISOString(),
  };

  if (!contract.ok) {
    const result = { ...base, status: 'contract_failed', total_0_100: null };
    writeFileSync(resultFile, JSON.stringify(result, null, 2));
    console.log(`  CONTRACT FAILED (${contract.violations.length} violations) -> ${resultFile}`);
    return result;
  }

  const runId = `baseline-${id}`;
  let rigMeta;
  try {
    const shotsDir = path.join(BENCH_DIR, 'shots', runId);
    if (existsSync(path.join(shotsDir, 'meta.json'))) {
      rigMeta = { ...JSON.parse(readFileSync(path.join(shotsDir, 'meta.json'), 'utf8')), outDir: shotsDir };
      console.log(`  SKIP rig (shots exist: ${shotsDir})`);
    } else {
      rigMeta = await runRig({ planePath, runId });
    }
  } catch (err) {
    // Executing in the rig can still fail (runtime error, empty bbox).
    const result = { ...base, status: 'rig_failed', rig_error: String(err.message || err), total_0_100: null };
    writeFileSync(resultFile, JSON.stringify(result, null, 2));
    console.log(`  RIG FAILED -> ${resultFile}`);
    return result;
  }

  const judged = await judgeShots({ shotsDir: rigMeta.outDir });
  if (!judged) {
    console.log(`  judge incomplete — re-invoke to resume (partial views kept)`);
    return null;
  }
  const result = {
    ...base,
    status: 'scored',
    run_id: runId,
    total_0_100: judged.total_0_100,
    per_view: judged.per_view.map((v) => ({ view: v.view, key: v.key, score: v.score })),
    weakest_feature: judged.weakest_feature,
    judge_model: judged.judge_model,
    judge_seeds: judged.judge_seeds,
  };
  writeFileSync(resultFile, JSON.stringify(result, null, 2));
  console.log(`  BASELINE ${model} total=${judged.total_0_100}/100 -> ${resultFile}`);
  return result;
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
  const models = typeof args.models === 'string' ? args.models.split(',') : DEFAULT_MODELS;
  const run = async () => {
    for (const model of models) {
      // Strictly sequential — never overlap model calls on a shared GPU.
      await runBaseline({ model: model.trim(), forceGenerate: args['force-generate'] === true });
    }
  };
  run().catch((err) => {
    console.error(`BASELINE_FAIL ${err.message}`);
    process.exit(1);
  });
}
