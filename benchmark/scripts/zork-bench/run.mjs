#!/usr/bin/env node
// benchmark/scripts/zork-bench/run.mjs
//
// Node dispatcher for the ZorkGPT × TerranSoul brain bench.
// Parses args, MCP-healthchecks, wipes the per-arm brain data dir, and
// delegates to `uv run python run_bench.py` inside the cloned ZorkGPT.

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ZORKGPT_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'zorkgpt-src');
const BRAIN_DATA_DIR = resolve(REPO_ROOT, 'mcp-data-bench');
const OUT_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'bench-results');

const VALID_ARMS = ['none', 'zorkgpt-default', 'terransoul-brain', 'all'];

function parseArgs(argv) {
  const out = {
    arm: 'all',
    episodes: 3,
    clearBrainEachEpisode: false,
    rom: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arm') out.arm = argv[++i];
    else if (a === '--episodes') out.episodes = parseInt(argv[++i], 10);
    else if (a === '--clear-brain-each-episode') out.clearBrainEachEpisode = true;
    else if (a === '--rom') out.rom = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: run.mjs --arm {none|zorkgpt-default|terransoul-brain|all} ' +
          '--episodes N [--clear-brain-each-episode] [--rom PATH]',
      );
      process.exit(0);
    }
  }
  if (!VALID_ARMS.includes(out.arm)) {
    console.error(`✗ unknown arm '${out.arm}'. Valid: ${VALID_ARMS.join(', ')}`);
    process.exit(1);
  }
  return out;
}

function probeMcp() {
  return new Promise((res) => {
    const ports = [7421, 7423, 7422];
    let i = 0;
    const next = () => {
      if (i >= ports.length) return res(null);
      const port = ports[i++];
      const req = http.get(
        { host: '127.0.0.1', port, path: '/health', timeout: 800 },
        (resp) => {
          let body = '';
          resp.on('data', (c) => (body += c));
          resp.on('end', () => (resp.statusCode === 200 ? res({ port, body }) : next()));
        },
      );
      req.on('error', next);
      req.on('timeout', () => {
        req.destroy();
        next();
      });
    };
    next();
  });
}

async function runArm(arm, opts, mcpPort) {
  console.log(`\n=== Arm: ${arm} (${opts.episodes} episodes) ===`);

  // Wipe brain data dir for terransoul-brain arm so each arm starts empty.
  if (arm === 'terransoul-brain' && existsSync(BRAIN_DATA_DIR)) {
    console.log(`→ wiping ${BRAIN_DATA_DIR} for fresh brain state`);
    rmSync(BRAIN_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(BRAIN_DATA_DIR, { recursive: true });

  const pyArgs = [
    'run',
    'python',
    'run_bench.py',
    '--arm',
    arm,
    '--episodes',
    String(opts.episodes),
    '--out-dir',
    OUT_DIR,
    '--mcp-port',
    String(mcpPort),
  ];
  if (opts.clearBrainEachEpisode) pyArgs.push('--clear-brain-each-episode');
  if (opts.rom) pyArgs.push('--rom', opts.rom);

  const r = spawnSync('uv', pyArgs, { cwd: ZORKGPT_DIR, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ arm ${arm} failed (exit ${r.status})`);
    return false;
  }
  return true;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!existsSync(ZORKGPT_DIR)) {
    console.error('✗ ZorkGPT not cloned. Run: node benchmark/scripts/zork-bench/setup.mjs');
    process.exit(1);
  }

  console.log('→ probing TerranSoul MCP …');
  const mcp = await probeMcp();
  if (!mcp && opts.arm !== 'none') {
    console.error('✗ TerranSoul MCP unhealthy or missing. Refusing to run a brain arm.');
    console.error('  (use --arm none to run the bare-LLM baseline without MCP)');
    process.exit(1);
  }
  if (mcp) console.log(`✓ MCP healthy on port ${mcp.port}`);

  mkdirSync(OUT_DIR, { recursive: true });

  const arms = opts.arm === 'all' ? ['none', 'zorkgpt-default', 'terransoul-brain'] : [opts.arm];
  for (const arm of arms) {
    const ok = await runArm(arm, opts, mcp ? mcp.port : 7423);
    if (!ok) process.exit(1);
  }

  console.log('\n=== Bench complete ===');
  console.log(`See ${OUT_DIR} for JSONL transcripts and summary JSON.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
