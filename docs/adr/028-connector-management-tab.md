# ADR 028 — Connector Management Tab (MemorySourcesTab)

**Status:** Accepted  
**Date:** 2026-06-07  
**Spec:** Spec 028 — Onyx-inspired Sources tab in BrainView

---

## Context

The memory-sources registry (introduced in BRAIN-REPO-RAG-1a, schema v22) stores
one row per logical "brain origin" (`self`, `repo`, `topic`). There was no dedicated
UI surface for managing these sources: listing, syncing, deleting, or adding new
ones. BrainView only showed overview metrics.

Users inspecting Spec 027 (`ConnectorSchedulerTab.vue`) need a companion tab that
shows source health at a glance — particularly freshness of the last sync — so they
can identify stale connectors before they degrade RAG quality.

---

## Decision

### 1. Card list over table (420 px constraint)

Sources are rendered as glassmorphism cards (`max-width: 420px`) rather than a
table. Rationale:

- BrainView is a single-column layout; a horizontal table overflows on the common
  1 280 px wide panel.
- Cards accommodate variable-length `repo_url` fields without horizontal scroll.
- Each card has independent confirm/error states that would require complex row
  management in a table approach.

### 2. Freshness thresholds (1 h / 24 h)

`freshnessClass(source, nowMs)` returns one of three buckets:

| Bucket | Threshold | UI tone |
|--------|-----------|---------|
| `fresh` | age < 1 h (3 600 000 ms) | `ok` (green) |
| `aging` | 1 h ≤ age < 24 h (86 400 000 ms) | `warn` (amber) |
| `stale` | age ≥ 24 h or `last_synced_at === null` | `muted` (grey) |

The 1 h / 24 h thresholds match the default scheduler cadences defined in
Spec 027 (`ConnectorSchedulerTab.vue`): hourly syncs produce `fresh` pills;
daily syncs that run on time remain `aging` intra-day.

Both helpers (`freshnessClass`, `freshnessLabel`) are exported pure functions
from `stores/memory-sources.ts` so they can be unit-tested without Pinia or
IPC mocking.

### 3. Inline confirmation over `browser.confirm()`

Delete confirmation uses an inline `<div role="alertdialog">` row that renders
directly inside the card. Rationale:

- `window.confirm()` is blocked inside Tauri 2 WebView2 by default.
- The inline row is scoped: only one delete can be pending per card, preventing
  accidental double-deletes.
- The confirmation message names the source label ("Delete **foo/bar**?") so
  the user cannot misidentify which source they are deleting.
- A 200 ms CSS opacity fade before the Tauri IPC call gives visual confirmation
  that the action is in progress without requiring a separate loading spinner.

### 4. MemorySourcesTab.vue name avoids collision with Spec 027

Spec 027 introduces `ConnectorSchedulerTab.vue`. This spec introduces
`MemorySourcesTab.vue` — a distinct name that:

- Cannot be confused with the scheduler tab by import tooling or grep.
- Follows the `<Feature>Tab.vue` convention established by the codebase
  (e.g. `WikiPanel.vue`, `BrainCapacityPanel.vue`).

### 5. Lazy-mount via `v-if` in BrainView.vue

`<MemorySourcesTab v-if="activeTab === 'sources'" />` means the component is
only created when the user switches to the Sources tab. This avoids the
`fetchAll()` IPC call and the 60-second `setInterval` clock tick while the user
is on the Overview tab — a meaningful saving since BrainView loads at app start.

### 6. `SyncStatusKind` enum is transient (no DB column)

The Rust enum `SyncStatusKind { Idle, Syncing, Ok, Error }` is defined in
`memory/sources.rs` as `#[derive(Serialize, Deserialize)]` for potential future
use in event payloads, but is not persisted to the `memory_sources` table.
The UI derives sync status reactively from `syncStatusMap` in the store.

---

## Consequences

- `sync_memory_source` Tauri command stamps `last_synced_at` and returns the
  updated row in a single locked transaction — no double-lock race.
- `freshnessClass` / `freshnessLabel` are pure exported functions tested by
  14 unit tests covering all bracket boundaries.
- The `syncStatusMap` reactive ref is part of the public store API; future
  background-sync jobs can update it to drive UI hints without component coupling.
- BrainView Overview content is untouched — the tab bar adds two buttons above
  the existing cockpit hero, with the overview body wrapped in
  `<template v-if="activeTab === 'overview'">`.

## Related ADRs

- [ADR 001](001-brain-and-memory-architecture.md) — memory-sources registry origin
- [ADR 009](009-sqlite-for-memory.md) — SQLite backing for `memory_sources` table
