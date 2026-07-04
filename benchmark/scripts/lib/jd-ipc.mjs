// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH: JSONL IPC client for the `longmemeval-ipc` shim
// (same shape as benchmark/scripts/longmemeval-s.mjs JsonlClient).
// Extracted from jd-million-bench.mjs so jd-sample-bench.mjs can reuse it.
//
// The shim is spawned via `cargo run --target-dir <targetDir>` (the bench
// convention: artifacts live in target-copilot-bench inside the worktree,
// so a prebuilt shim starts instantly and a stale one rebuilds itself).

import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

export class JsonlClient {
  /**
   * @param {object} opts
   * @param {string} opts.repoRoot  repo root containing src-tauri/Cargo.toml
   * @param {string} opts.targetDir cargo target dir for the shim build
   */
  constructor({ repoRoot, targetDir }) {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    // LONGMEM_SHIM_EXE (MILLION-RESUME-2): spawn a specific prebuilt shim
    // binary directly instead of `cargo run`. Two bench needs: (a) config
    // ladders that must A/B an OLDER binary generation (cargo run would
    // silently rebuild to HEAD and destroy the baseline leg), and (b) no
    // cargo lock/rebuild contention while a bench owns the machine.
    const shimExe = process.env.LONGMEM_SHIM_EXE;
    this.proc = shimExe
      ? spawn(shimExe, [], { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn('cargo', [
        'run',
        '--quiet',
        '--manifest-path',
        resolve(repoRoot, 'src-tauri', 'Cargo.toml'),
        '--bin',
        'longmemeval-ipc',
        '--target-dir',
        targetDir,
      ], {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', chunk => process.stderr.write(chunk));
    this.proc.on('exit', code => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`IPC process exited before response (code ${code})`));
      }
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      throw new Error(`invalid IPC JSON: ${line}\n${err.message}`, { cause: err });
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(new Error(message.error ?? `IPC request ${message.id} failed`));
  }

  send(payload) {
    const id = this.nextId;
    this.nextId += 1;
    const line = JSON.stringify({ id, ...payload });
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      this.proc.stdin.write(`${line}\n`, err => {
        if (err) {
          this.pending.delete(id);
          rejectPromise(err);
        }
      });
    });
  }

  async close() {
    if (!this.proc.killed) {
      try {
        await this.send({ op: 'shutdown' });
      } catch {
        this.proc.kill();
      }
    }
  }
}

export default JsonlClient;
