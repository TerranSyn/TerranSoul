// FROZEN measurement rig for the Boeing 747 primitives vision benchmark.
//
// Loads rig.html (Three.js from the repo's own node_modules over a local
// static server — fully offline), injects a candidate plane.js module
// (`export function buildPlane(THREE) -> THREE.Group`, primitives only,
// contract-checked BEFORE it ever reaches the page), places it in the fixed
// neutral studio scene, and screenshots the NINE frozen camera angles at
// 1024x768. Outputs shots/<run-id>/view-1..9.png + contact-sheet.png + meta.json.
//
// CLI: node benchmark/boeing747/rig/render-rig.mjs --plane <path> [--run-id <id>]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { validatePlaneSource } from '../lib/contract.mjs';
import {
  CAMERA_SPEC_VERSION,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  SCENE_BACKGROUND,
  VIEWS,
} from '../lib/cameras.mjs';
import { startStaticServer } from './static-server.mjs';

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Build the 3x3 contact sheet (1536x1152) from the nine view PNGs. */
async function buildContactSheet(viewPaths, outPath) {
  const cellW = 512;
  const cellH = 384;
  const composites = [];
  for (let i = 0; i < viewPaths.length; i++) {
    const thumb = await sharp(viewPaths[i]).resize(cellW, cellH).png().toBuffer();
    const col = i % 3;
    const row = Math.floor(i / 3);
    composites.push({ input: thumb, left: col * cellW, top: row * cellH });
    const label = Buffer.from(
      `<svg width="${cellW}" height="${cellH}">` +
        `<rect x="6" y="6" width="120" height="26" rx="4" fill="#1f2937" opacity="0.85"/>` +
        `<text x="14" y="25" font-family="monospace" font-size="16" fill="#ffffff">view ${i + 1}</text>` +
        `</svg>`,
    );
    composites.push({ input: label, left: col * cellW, top: row * cellH });
  }
  await sharp({
    create: {
      width: cellW * 3,
      height: cellH * 3,
      channels: 3,
      background: SCENE_BACKGROUND,
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);
}

/**
 * Run the frozen rig on one candidate.
 * @param {{planePath: string, runId?: string, outRoot?: string}} opts
 * @returns run metadata (also written to shots/<run-id>/meta.json)
 */
export async function runRig(opts) {
  const planePath = path.resolve(opts.planePath);
  const runId = opts.runId || `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outRoot = path.resolve(opts.outRoot || path.join(BENCH_DIR, 'shots'));
  const outDir = path.join(outRoot, runId);

  const source = readFileSync(planePath, 'utf8');
  const contract = validatePlaneSource(source);
  if (!contract.ok) {
    const err = new Error(
      `candidate violates the primitives contract:\n- ${contract.violations.join('\n- ')}`,
    );
    err.contractViolations = contract.violations;
    throw err;
  }

  mkdirSync(outDir, { recursive: true });
  const server = await startStaticServer(REPO_ROOT);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: RENDER_WIDTH + 64, height: RENDER_HEIGHT + 64 },
      deviceScaleFactor: 1,
    });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.port}/benchmark/boeing747/rig/rig.html`);
    await page.waitForFunction(() => window.__rigReady === true, { timeout: 30000 });

    const bbox = await page.evaluate(
      (src) => window.__rig.loadPlane(src),
      source,
    );

    const canvas = page.locator('#rig-canvas');
    const viewFiles = [];
    const poses = [];
    for (const view of VIEWS) {
      const pose = await page.evaluate((id) => window.__rig.setView(id), view.id);
      poses.push({ id: view.id, key: view.key, ...pose });
      const file = path.join(outDir, `view-${view.id}.png`);
      await canvas.screenshot({ path: file });
      viewFiles.push(file);
    }
    if (pageErrors.length > 0) {
      throw new Error(`rig page errors: ${pageErrors.join(' | ')}`);
    }

    const contactSheet = path.join(outDir, 'contact-sheet.png');
    await buildContactSheet(viewFiles, contactSheet);

    const rigInfo = await page.evaluate(() => ({
      threeRevision: window.__rig.threeRevision,
      specVersion: window.__rig.specVersion,
    }));

    const meta = {
      runId,
      planePath: path.relative(REPO_ROOT, planePath).replace(/\\/g, '/'),
      planeSha256: sha256(source),
      cameraSpecVersion: CAMERA_SPEC_VERSION,
      threeRevision: rigInfo.threeRevision,
      renderSize: [RENDER_WIDTH, RENDER_HEIGHT],
      bbox,
      views: poses,
      viewFiles: viewFiles.map((f) => path.basename(f)),
      contactSheet: path.basename(contactSheet),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
    return { ...meta, outDir };
  } finally {
    await browser.close();
    await server.close();
  }
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
    console.error('usage: node render-rig.mjs --plane <plane.js> [--run-id <id>] [--out-root <dir>]');
    process.exit(2);
  }
  runRig({ planePath: args.plane, runId: args['run-id'], outRoot: args['out-root'] })
    .then((meta) => {
      console.log(`RIG_OK ${meta.outDir}`);
      console.log(JSON.stringify({ runId: meta.runId, planeSha256: meta.planeSha256, bbox: meta.bbox }, null, 2));
    })
    .catch((err) => {
      console.error(`RIG_FAIL ${err.message}`);
      process.exit(1);
    });
}
