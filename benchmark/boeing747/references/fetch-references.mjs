// Downloads the FROZEN Boeing 747 reference set listed in manifest.json into
// references/prepared/ (judging use only — the images are gitignored; the
// manifest + README are the committed provenance record).
//
// Each image is normalized to PNG with max dimension 1024 (deterministic
// sharp pipeline) so judge prompts stay compact, and prepared/meta.json
// records source URL, license, and the sha256 of the prepared bytes so every
// judge result can pin the exact reference bytes it saw.
//
// CLI: node benchmark/boeing747/references/fetch-references.mjs [--force]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REF_DIR = path.dirname(fileURLToPath(import.meta.url));
const PREPARED_DIR = path.join(REF_DIR, 'prepared');
const USER_AGENT =
  'TerranSoulBench/1.0 (Boeing747 primitives bench reference fetch; judging use only)';

export function preparedRefPath(key) {
  return path.join(PREPARED_DIR, `${key}.png`);
}

export function loadPreparedMeta() {
  const metaPath = path.join(PREPARED_DIR, 'meta.json');
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, 'utf8'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Download with a polite inter-request delay and 429 backoff (Wikimedia rate limits burst fetches). */
async function politeDownload(url, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    await sleep(1500);
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 && attempt < attempts) {
      const wait = 5000 * attempt;
      console.log(`  429 rate-limited; retrying in ${wait / 1000}s (attempt ${attempt}/${attempts})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`download failed ${res.status} for ${url}`);
  }
}

async function main() {
  const force = process.argv.includes('--force');
  const manifest = JSON.parse(readFileSync(path.join(REF_DIR, 'manifest.json'), 'utf8'));
  mkdirSync(PREPARED_DIR, { recursive: true });
  const meta = { preparedAt: new Date().toISOString(), maxDim: 1024, references: {} };

  for (const ref of manifest.references) {
    const outPath = preparedRefPath(ref.key);
    if (existsSync(outPath) && !force) {
      const buf = readFileSync(outPath);
      meta.references[ref.key] = {
        ...ref,
        file: path.basename(outPath),
        sha256: createHash('sha256').update(buf).digest('hex'),
        skipped: 'already present',
      };
      console.log(`SKIP ${ref.key} (exists)`);
      continue;
    }
    console.log(`GET  ${ref.key} <- ${ref.url}`);
    const raw = await politeDownload(ref.url);
    const prepared = await sharp(raw)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // SVG-derived PNGs may be transparent
      .png()
      .toBuffer();
    writeFileSync(outPath, prepared);
    meta.references[ref.key] = {
      ...ref,
      file: path.basename(outPath),
      sha256: createHash('sha256').update(prepared).digest('hex'),
      rawBytes: raw.length,
      preparedBytes: prepared.length,
    };
  }

  writeFileSync(path.join(PREPARED_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`OK prepared ${Object.keys(meta.references).length} references -> ${PREPARED_DIR}`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`FETCH_FAIL ${err.message}`);
    process.exit(1);
  });
}
