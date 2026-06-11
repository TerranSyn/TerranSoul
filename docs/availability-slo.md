# TerranSoul — Availability SLO

> Design document for chunk **RESILIENCE-1** (Phase INFRA).
> Until this chunk's acceptance evidence is logged in `rules/completion-log.md`,
> the README must say "design target — five nines" not "five nines".

---

## SLO Definition

| Metric | Target | Measurement period |
|---|---|---|
| **Uptime** | ≥ 99.999 % | Per calendar quarter (90 days) |
| **Unplanned downtime budget** | ≤ 5 min 15 s | Per calendar quarter |
| **Recovery time** | ≤ 30 s | Per unplanned interruption |
| **Crash-loop detection** | ≥ 3 crashes in 5 min | Triggers safe-mode |

### Scope

This SLO covers the **local TerranSoul desktop app** — the Tauri process,
its embedded SQLite memory store, and the in-process services (embedding
worker, MCP server, hive relay). It does NOT cover:

- External services (Ollama, cloud LLM providers, remote peers)
- The OS itself (power failure is classified separately from app crashes)
- Planned maintenance (the app has no planned downtime — it restarts instantly)

---

## Telemetry: Heartbeat

A background task writes a heartbeat entry every 30 seconds to:

```
<data_dir>/uptime/heartbeat.jsonl
```

Each line is a JSON object:

```json
{ "ts": 1715700000, "pid": 12345, "version": "0.1.0" }
```

- **Atomic write** — the file is opened in append mode; each write is a
  single `write_all` of a pre-serialized line + `\n`. On POSIX this is
  atomic for lines ≤ PIPE_BUF (4096 bytes). On Windows, the file is opened
  with `FILE_SHARE_READ` so readers can inspect it live.
- **Rotation** — on startup, if the file exceeds 1 MB, it is renamed to
  `heartbeat.prev.jsonl` (overwriting any existing prev) before the new
  session begins writing.

---

## Startup Classification

On every launch, the app reads the last heartbeat from the previous session's
file and classifies the previous shutdown:

| Last heartbeat age | Classification |
|---|---|
| Written within the last 60 s + a clean-exit marker exists | `clean_exit` |
| Written within the last 60 s + NO clean-exit marker | `crash` |
| Written more than 5 min ago (or file missing) | `power_loss` |
| No heartbeat file at all | `first_run` |

The **clean-exit marker** is a final heartbeat line with an extra field:
`{ "ts": ..., "pid": ..., "version": ..., "exit": "clean" }`.

---

## Crash-Loop Guard

If the startup classifier detects **≥ 3 crashes within the last 5 minutes**
(by reading the N most recent heartbeat timestamps and exit markers), the app
enters **safe mode**:

### Safe-Mode Behaviour

| Subsystem | Normal | Safe-mode |
|---|---|---|
| Plugins | All loaded | All disabled |
| Embedding worker | Active | Suspended (no background embed) |
| Hive relay | Active | Suspended (no sync) |
| MCP server | Active | Suspended (no external connections) |
| Chat / memory read | Active | **Active** (read-only is always safe) |

Safe-mode is surfaced to the user via:
- A persistent banner in the UI: "⚠️ Safe mode — TerranSoul detected
  repeated crashes. Some features are disabled. [Send debug bundle] [Exit safe mode]"
- The `app_settings.safe_mode` flag (readable via Tauri command).

### Exiting Safe-Mode

- **Automatic:** after 10 minutes without a crash, the app clears safe-mode
  and re-enables all subsystems.
- **Manual:** the user clicks "Exit safe mode" in the banner.
- **Debug bundle:** the "Send debug bundle" action collects the last 100
  heartbeat lines + the crash log + `app_settings` and opens a file-save
  dialog (no network send without consent).

---

## Chaos Test Contract

Two hermetic tests prove the resilience contract:

1. **`crash_loop_triggers_safe_mode`** — Simulates 3 crash markers within
   5 min in the heartbeat file, then runs `classify_previous_shutdown` and
   asserts the guard returns `SafeModeRequired`.

2. **`heartbeat_resumes_after_safe_mode_timeout`** — Asserts that after
   the 10-minute timer (simulated with `tokio::time::pause`), safe-mode
   is cleared and the heartbeat writer continues.

---

## SLO Calculation

```
uptime_percent = 1 - (total_unplanned_downtime_seconds / total_quarter_seconds) * 100
total_quarter_seconds = 90 * 24 * 3600 = 7_776_000
budget_seconds = 7_776_000 * 0.00001 = 77.76 s ≈ 78 s (conservative: 315 s at 5-min)
```

Wait — 99.999% of 90 days:
```
allowed_downtime = 90 * 24 * 3600 * (1 - 0.99999) = 90 * 86400 * 0.00001 = 77.76 s
```

So the actual budget is **~78 seconds per quarter**, not 5 minutes. The 5-min
figure in the milestone was a simplification. We document the precise number
here and use the 78 s figure as the hard target.

### Downtime Detection

A gap in heartbeats longer than 60 s (2 missed beats) that is NOT preceded by
a clean-exit marker counts as unplanned downtime. The duration is:
`gap_start = last_heartbeat_ts + 30s` to `next_heartbeat_ts` (or session end
if the app never came back that quarter).

---

## File Layout

```
<data_dir>/
  uptime/
    heartbeat.jsonl          ← current session (append-only)
    heartbeat.prev.jsonl     ← previous session (rotated on startup)
    slo-report.json          ← quarterly summary (computed on demand)
```
