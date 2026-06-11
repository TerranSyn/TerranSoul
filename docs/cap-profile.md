# Per-Memory CAP Profile

> Design document for chunk **CAP-1** (Phase INFRA).
> Until this chunk's acceptance evidence is logged in `rules/completion-log.md`,
> the README pillar remains "design target".

---

## Overview

Every TerranSoul memory has a **CAP profile** that determines its write
behaviour under network partition:

| Profile | Write path | Offline behaviour | Best for |
|---------|-----------|-------------------|----------|
| **Availability (AP)** | CRDT immediate write → merge on reconnect | Succeeds immediately | Everyday memories, preferences, chat context |
| **Consistency (CP)** | Hive relay linearizable log, quorum-2 ack | **Blocks** until relay reachable | Legal/financial facts, shared-team truths |

Partition-tolerance (P) is always mandatory — the app works offline. The
user chooses between **A** and **C** per-memory (or sets an app-wide default).

---

## Configuration

### App-wide default

```rust
// src-tauri/src/settings/mod.rs
pub cap_profile_default: CapProfile,  // Default: Availability
```

### Per-memory override

```sql
-- memories table
cap_profile TEXT DEFAULT NULL  -- NULL = use app default; 'availability' or 'consistency'
```

---

## Write Paths

### AP Path (Availability)

1. Write to local SQLite immediately.
2. Emit CRDT delta via `compute_sync_deltas()`.
3. On reconnect, paired device receives delta via LWW merge.
4. Conflicts resolved by HLC total order (latest writer wins).

This is the **existing** behaviour for all memories today.

### CP Path (Consistency)

1. Write to local SQLite in `pending_ack` state (not yet confirmed).
2. Send write request to Hive relay as a signed envelope.
3. Relay writes to linearizable log, waits for quorum-2 ack.
4. On ack: local memory transitions to `confirmed` state; UI shows ✓.
5. On timeout/offline: write remains `pending_ack`; UI shows ⏳.
6. The `pending_ack` memory is **not** included in chat retrieval or
   outbound sync until confirmed — prevents divergent state.

---

## Trade-off Summary (Plain Language)

| Scenario | AP | CP |
|----------|----|----|
| You type a note on the train (no WiFi) | ✅ Saved immediately | ⏳ Blocked until you have signal |
| Two devices edit the same legal fact | Last writer wins silently | One writer is blocked, no conflict possible |
| Power loss mid-write | Recovered from local WAL | Same (local WAL), but ack is lost — will retry |
| Relay server goes down | No impact (local-first) | Writes block until relay recovers |

---

## Schema

```sql
ALTER TABLE memories ADD COLUMN cap_profile TEXT DEFAULT NULL;
-- NULL = use AppSettings.cap_profile_default
-- 'availability' = force AP even if default is CP
-- 'consistency' = force CP even if default is AP
```

---

## Test Contract

Two hermetic tests:

1. **`ap_write_succeeds_offline_merges_on_reconnect`** — Insert a memory
   with `cap_profile = Availability`. Simulate offline (no relay).
   Assert: write succeeds immediately, is retrievable, and after a mock
   reconnect the delta appears in `compute_sync_deltas_filtered`.

2. **`cp_write_blocks_offline_succeeds_online`** — Insert a memory with
   `cap_profile = Consistency`. Simulate offline (relay unreachable).
   Assert: memory is in `pending_ack` state, NOT retrievable via normal
   search. Simulate online (relay acks). Assert: memory transitions to
   confirmed, now retrievable, never produces a divergent state.

---

## File Layout

```
src-tauri/src/settings/mod.rs   ← CapProfile enum + cap_profile_default field
src-tauri/src/memory/schema.rs  ← ensure_cap_profile() migration
src-tauri/src/memory/cap.rs     ← write path logic (new)
docs/cap-profile.md             ← this file
```
