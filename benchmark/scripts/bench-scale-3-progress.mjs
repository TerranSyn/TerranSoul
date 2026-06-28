#!/usr/bin/env node
// BENCH-SCALE-3 progress poller — appends a timestamped progress line to
// `benchmark/progress.md` every 5 minutes by parsing the latest
// `target-copilot-bench/bench-scale-3-*.log` file.
//
// Usage: node scripts/bench-scale-3-progress.mjs
//
// Stops automatically when:
//   - the log file has been idle for > 30 min, OR
//   - a line matching /completed|error|fail|exited|crashed/i appears, OR
//   - the controlling node bench process exits (mtime stops advancing).

import { promises as fs } from 'node:fs';
import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w):/, '$1:'), '..', '..');
const LOG_DIR = path.join(ROOT, 'target-copilot-bench');
const PROGRESS_MD = path.join(ROOT, 'benchmark', 'progress.md');
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// 2026-05-16: the previous 30-minute idle cap fired a false positive when a
// slow embedding batch paused log writes briefly. Bump to 6 hours and also
// gate the stop on BOTH `mtime` and `size` being unchanged for the whole
// window — a partially-buffered append still bumps size even when mtime
// hasn't been flushed to disk.
const IDLE_GIVE_UP_MS = 6 * 60 * 60 * 1000; // 6 hours of no log growth -> stop

const LIVE_LOG_HEADER = '## Live log';

function findLatestLog() {
  if (!existsSync(LOG_DIR)) return null;
  const files = readdirSync(LOG_DIR)
    .filter((f) =>
      f.startsWith('bench-scale-3-') &&
      f.endsWith('.log') &&
      !f.includes('poller'),
    )
    .map((f) => {
      const full = path.join(LOG_DIR, f);
      const st = statSync(full);
      return { name: f, full, mtime: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ?? null;
}

async function tailLast(file, maxBytes = 64 * 1024) {
  const stat = await fs.stat(file);
  const start = Math.max(0, stat.size - maxBytes);
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(stat.size - start);
    await handle.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    await handle.close();
  }
}

// Resume runs append `, since-resume=N` after `elapsed=` before the closing
// paren, so the regex must accept arbitrary extra k=v pairs after elapsed.
const PROGRESS_RE = /\[(ivfpq|hnsw|emb|rrf)\]\s+ingested\s+(\d+)\/(\d+)\s+\(embedded total=(\d+),\s*elapsed=([\d.]+)s(?:,\s*since-resume=(\d+))?[^)]*\)/;
const BUILD_RE = /\[(ivfpq|hnsw)\]\s+build_ivf_pq.*?built=(\d+).*?elapsed=([\d.]+)s/;
const RECALL_RE = /recall@?10[^0-9]*([0-9.]+)/i;
const TERMINAL_RE = /completed|exit(ed)? code|crashed|FATAL|panicked at|error: /i;

function parseTail(tail) {
  const lines = tail.split(/\r?\n/).filter(Boolean);
  let latestProgress = null;
  let latestBuild = null;
  let latestRecall = null;
  let terminalLine = null;
  for (const line of lines) {
    const p = PROGRESS_RE.exec(line);
    if (p) {
      latestProgress = {
        system: p[1],
        processed: Number(p[2]),
        total: Number(p[3]),
        embedded: Number(p[4]),
        elapsedSec: Number(p[5]),
        sinceResume: p[6] != null ? Number(p[6]) : null,
      };
    }
    const b = BUILD_RE.exec(line);
    if (b) latestBuild = { system: b[1], built: Number(b[2]), elapsedSec: Number(b[3]) };
    const r = RECALL_RE.exec(line);
    if (r) latestRecall = Number(r[1]);
    if (TERMINAL_RE.test(line)) terminalLine = line.trim();
  }
  return { latestProgress, latestBuild, latestRecall, terminalLine };
}

function formatEta(processed, total, elapsedSec) {
  if (!processed || !elapsedSec) return 'unknown';
  const rate = processed / elapsedSec; // docs / sec
  const remaining = total - processed;
  const etaSec = remaining / rate;
  if (!Number.isFinite(etaSec) || etaSec <= 0) return 'unknown';
  const h = Math.floor(etaSec / 3600);
  const m = Math.floor((etaSec % 3600) / 60);
  return `${h}h ${m}m`;
}

function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

async function appendEntry(line) {
  let md = '';
  try {
    md = await fs.readFile(PROGRESS_MD, 'utf8');
  } catch {
    md = '# BENCH-SCALE-3 — Progress Tracker\n\n## Live log\n';
  }
  if (!md.includes(LIVE_LOG_HEADER)) {
    md += `\n${LIVE_LOG_HEADER}\n`;
  }
  if (md.endsWith('\n')) md += line + '\n';
  else md += '\n' + line + '\n';
  await fs.writeFile(PROGRESS_MD, md, 'utf8');
}

async function updateOverallPct(pct, status) {
  let md = await fs.readFile(PROGRESS_MD, 'utf8');
  const overallLine = `## Overall: **${pct.toFixed(1)} % (${status})**`;
  const barLine = `${progressBar(pct)} ${pct.toFixed(1)} % — ${status}`;
  md = md.replace(/## Overall:\s*\*\*[^\n]*\*\*/m, overallLine);
  md = md.replace(/```\s*\n\[[█░\s[\]0-9.%\-—a-z()]+\]\s+[^\n]*\n```/m,
    '```\n' + barLine + '\n```');
  await fs.writeFile(PROGRESS_MD, md, 'utf8');
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

async function pollOnce(state) {
  const log = findLatestLog();
  if (!log) {
    if (state.lastNoLogReported) return { stop: false };
    await appendEntry(`- **${nowIso()}** — poller: no \`bench-scale-3-*.log\` found yet.`);
    state.lastNoLogReported = true;
    return { stop: false };
  }
  state.lastNoLogReported = false;

  // Detect idleness via BOTH mtime AND size — only stop when neither has
  // moved for the full IDLE_GIVE_UP_MS window. A slow batch can pause
  // writes for tens of minutes while still holding the file open; that
  // is not a reason to stop the poller.
  const mtime = log.mtime;
  const size = log.size;
  if (
    state.lastMtime &&
    mtime === state.lastMtime &&
    state.lastSize &&
    size === state.lastSize
  ) {
    state.idleMs += POLL_INTERVAL_MS;
  } else {
    state.idleMs = 0;
  }
  state.lastMtime = mtime;
  state.lastSize = size;

  const tail = await tailLast(log.full);
  const parsed = parseTail(tail);

  let pct = 0;
  let detail = '';
  let status = 'running';

  if (parsed.latestProgress) {
    pct = (parsed.latestProgress.processed / parsed.latestProgress.total) * 100;
    // For resume runs, `elapsed` is wall time since this resume started but
    // `processed` is the cumulative count including pre-resume ingest. Using
    // processed/elapsed there would inflate the rate ~40× and underestimate
    // ETA. When `since-resume` is present, base the rate on that subset.
    const rateProcessed =
      parsed.latestProgress.sinceResume != null && parsed.latestProgress.sinceResume > 0
        ? parsed.latestProgress.sinceResume
        : parsed.latestProgress.processed;
    const eta = formatEta(
      rateProcessed,
      parsed.latestProgress.total - parsed.latestProgress.processed + rateProcessed,
      parsed.latestProgress.elapsedSec,
    );
    const elapsedH = (parsed.latestProgress.elapsedSec / 3600).toFixed(2);
    const resumeNote = parsed.latestProgress.sinceResume != null
      ? ` (since-resume ${parsed.latestProgress.sinceResume.toLocaleString()})`
      : '';
    detail = `ingest ${parsed.latestProgress.processed.toLocaleString()}/${parsed.latestProgress.total.toLocaleString()} (${pct.toFixed(2)} %)${resumeNote}, elapsed ${elapsedH} h, ETA ~${eta}`;
  } else if (parsed.latestBuild) {
    pct = 95;
    status = 'build_ivf_pq';
    detail = `build_ivf_pq built=${parsed.latestBuild.built} elapsed=${parsed.latestBuild.elapsedSec.toFixed(1)}s`;
  } else {
    detail = 'no progress line yet';
  }

  if (parsed.latestRecall != null) {
    detail += `, recall@10=${parsed.latestRecall}`;
  }

  if (parsed.terminalLine) {
    status = 'terminated';
    detail += ` — TERMINAL: ${parsed.terminalLine}`;
  }

  const entry = `- **${nowIso()}** — \`${log.name}\`: ${detail}.`;

  // Value-based dedup: if the parsed `detail` is byte-identical to the last
  // appended detail (i.e. the bench has not advanced even one row), skip the
  // append. Emit a single "progress unchanged" note the first time we notice,
  // then stay silent until the value changes again or a terminal line lands.
  // This is what prevents the "wall of identical entries" failure mode when
  // the bench process dies mid-run but the log file remains present.
  const STALL_TICKS_BEFORE_STOP = 12; // 12 * 5 min = 1 h of zero progress
  if (state.lastDetail === detail && !parsed.terminalLine) {
    state.stalledTicks = (state.stalledTicks || 0) + 1;
    if (state.stalledTicks === 1) {
      await appendEntry(
        `- **${nowIso()}** — \`${log.name}\`: progress value unchanged since last poll (still ${detail}). Suppressing identical entries until value advances.`,
      );
    }
    if (state.stalledTicks >= STALL_TICKS_BEFORE_STOP) {
      await appendEntry(
        `- **${nowIso()}** — poller: progress value unchanged for ${state.stalledTicks} consecutive polls (~${(state.stalledTicks * POLL_INTERVAL_MS) / 60000} min). Bench appears dead; stopping poller.`,
      );
      return { stop: true, reason: 'value-stalled' };
    }
    try { await updateOverallPct(pct, status); } catch { /* ignore */ }
    return { stop: false };
  }
  state.lastDetail = detail;
  state.stalledTicks = 0;

  await appendEntry(entry);
  try { await updateOverallPct(pct, status); } catch { /* ignore */ }

  if (parsed.terminalLine) return { stop: true, reason: 'terminal line' };
  if (state.idleMs >= IDLE_GIVE_UP_MS) {
    await appendEntry(`- **${nowIso()}** — poller: log idle for >${(IDLE_GIVE_UP_MS / 60000)} min, stopping.`);
    return { stop: true, reason: 'idle' };
  }
  return { stop: false };
}

async function main() {
  const state = { lastMtime: 0, lastSize: 0, idleMs: 0, lastDetail: null, stalledTicks: 0, lastNoLogReported: false };
  await appendEntry(`- **${nowIso()}** — poller started (5-min cadence, idle cap ${IDLE_GIVE_UP_MS / 60000} min, mtime+size guard).`);
  // One immediate poll, then every POLL_INTERVAL_MS.
  while (true) {
    try {
      const { stop, reason } = await pollOnce(state);
      if (stop) {
        await appendEntry(`- **${nowIso()}** — poller stopped (${reason}).`);
        return;
      }
    } catch (err) {
      await appendEntry(`- **${nowIso()}** — poller error: ${err.message}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
