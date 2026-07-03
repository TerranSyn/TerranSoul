// ONE live judge call against the running Ollama — the smoke test that gates
// any full judge run. Ollama-dependent, LOCAL-ONLY (never in vitest; per
// rules/ci-vs-local-testing.md). Exercises the exact frozen request path
// (rubric prompts, think:false, format json, frozen options + seed) and
// prints structured diagnostics (observability-first): done_reason,
// reply_source (content vs thinking fallback), lengths, parsed scores.
//
// A parse failure exits 1 with the classified error (empty/malformed) —
// smoke exists to SURFACE the failure shape, not to fail open.
//
// Usage:
//   node benchmark/boeing747/judge/live-smoke.mjs
//     [--shots benchmark/boeing747/shots/stub-validation] [--view 1]
//     [--seed 7] [--model gemma4:12b-it-qat]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveSmokeCall } from './judge.mjs';

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SHOTS = path.join(BENCH_DIR, 'shots', 'stub-validation');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
liveSmokeCall({
  shotsDir: typeof args.shots === 'string' ? args.shots : DEFAULT_SHOTS,
  viewId: args.view ? Number(args.view) : 1,
  seed: args.seed !== undefined ? Number(args.seed) : undefined,
  model: typeof args.model === 'string' ? args.model : undefined,
})
  .then((r) => {
    console.log(`SMOKE model=${r.model} seed=${r.seed} view=${r.view} (${r.key})`);
    console.log(`RUBRIC_SHA256 ${r.rubric_sha256}`);
    console.log(
      `REPLY done_reason=${r.done_reason} source=${r.reply_source} ` +
        `content_len=${r.content_len} thinking_len=${r.thinking_len} ms=${r.ms}`,
    );
    console.log(`SCORES ${JSON.stringify(r.parsed.scores)}`);
    console.log(`WEAKEST_VISIBLE ${r.parsed.weakestVisible ?? 'n/a'}`);
    console.log(`NOTES ${r.parsed.notes || '(none)'}`);
    console.log('JUDGE_SMOKE_OK');
  })
  .catch((err) => {
    console.error(`JUDGE_SMOKE_FAIL${err.kind ? ` [${err.kind}]` : ''} ${err.message}`);
    process.exit(1);
  });
