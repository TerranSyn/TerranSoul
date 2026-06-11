# ADR 005 — Hive Protocol: CRDT offline-first multi-device sync

**Status:** Accepted  
**Date:** 2026  
**Design doc:** [`docs/hive-protocol.md`](../hive-protocol.md)  
**Source:** `src-tauri/src/sync/`, `src-tauri/src/link/`, `src-tauri/src/hive/`

---

## Context

A user's TerranSoul brain should be accessible from multiple devices (desktop,
laptop, paired mobile shell) without requiring a central cloud server.

Standard sync approaches break the privacy and offline-first posture:

| Approach | Problem |
|----------|---------|
| Cloud DB sync (Firestore, Supabase) | Data leaves the device; monthly cost; offline → conflict |
| Git-based sync | Not real-time; merge conflicts for binary SQLite; poor mobile story |
| WebSocket relay (always-on server) | Single point of failure; server cost; breaks on LAN |
| Manual export/import | No UX; breaks companion continuity |

## Decision

Implement the **Hive Protocol**: a federated, P2P-capable, cryptographically
authenticated sync layer using:

- **Ed25519 signing** — every sync envelope is signed with a device key; recipients
  verify before applying. No impersonation, no replay.
- **Hybrid Logical Clocks (HLC)** — causal ordering across clocks that drift; enables
  "happened-before" without a centralised time source.
- **CRDT merge semantics** — Last-Write-Wins for scalar fields (`lww`), 2P-Set for
  tag/edge additions, append-only for version history.
- **MessagePack encoding** — binary, compact, fast to deserialise on mobile.
- **Privacy tiers** — three scopes per memory: `private` (device-only), `paired`
  (user's own devices), `hive` (shared with trusted peers).

### What syncs

| Data | Tier | CRDT type |
|------|------|----------|
| Long-term memories | `paired` / `hive` | LWW on importance/decay; append-only on content versions |
| Memory edges (KG) | `paired` / `hive` | 2P-Set (edges can be added or removed, no duplication) |
| Persona settings | `paired` | LWW |
| Chat history | `private` only | Not synced by default |
| VRM models | `paired` | Transfer once, stable hash reference |

### Optional relay

When devices are on different networks, a user-supplied relay URL
(`hive_url` in settings) forwards signed MessagePack blobs between devices.
TerranSoul never operates a public relay — the user runs their own or uses
a self-hosted instance. Without `hive_url`, sync is LAN-only.

## Why CRDT over OT (Operational Transformation)

| Factor | CRDT | OT |
|--------|------|-----|
| No central sequencer needed | Yes | Requires sequencer for convergence |
| Works with arbitrary merge order | Yes | Requires total-order delivery |
| Implementation complexity | Moderate | High |
| Supports offline-then-merge | Native | Requires tombstoning + rebasing |

For a memory store where:
- Writes are infrequent (one per turn, not per keystroke)
- Conflicts are rare (user rarely edits the same fact on two devices simultaneously)
- Offline periods are common (laptop closed for days)

CRDT is a significantly simpler and more reliable choice than OT.

## Privacy guarantee

The `private` tier is **never transmitted**, even when a relay is configured.
The enforcement is in `src-tauri/src/sync/filter.rs`: any memory with
`privacy_tier = "private"` is stripped before serialisation.

Only memories the user explicitly promotes to `paired` or `hive` leave the device.

## Consequences

**Good:**
- Two devices reconcile perfectly after an offline period with no manual merge.
- The user's brain is the same on every device without a cloud account.
- A paired mobile shell can receive notifications for long-running desktop work
  (ADR 001 background maintenance events).

**Trade-offs:**
- LAN discovery requires mDNS or manual IP entry — no automatic "find my other devices" via cloud.
- The relay model means the user must own their relay for remote sync. This is a deliberate
  privacy trade-off, not an oversight.
- First-time pairing requires a QR code or manual PIN exchange (offline key bootstrap).

## Related ADRs

- [ADR 001](001-brain-and-memory-architecture.md) — the memory model being synced
- [ADR 003](003-mcp-single-source-of-truth.md) — MCP is the write gate; sync events also go through it
