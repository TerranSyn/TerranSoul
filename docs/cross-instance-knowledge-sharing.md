# Cross-Instance Knowledge Sharing

> Design document for chunk **SCALE-INF-1** (Phase INFRA).
> Until this chunk's acceptance evidence is logged in `rules/completion-log.md`,
> the README pillar remains "design target".

---

## Overview

TerranSoul instances can share knowledge across devices and users through
two mechanisms:

| Mechanism | Scope | Trust model | Transport |
|-----------|-------|-------------|-----------|
| **Link (paired sync)** | Same user, multiple devices | Full trust (Ed25519 device identity + mTLS) | QUIC / WebSocket |
| **Hive relay** | Multi-user org/team | ACL-gated (ShareScope + tag policy) | Hive Protocol (Bundle + Envelope + Ed25519 signing) |

---

## Use Cases

### 1. Personal Multi-Device (Partner/Another PC)

Two TerranSoul instances owned by the **same user** on different machines.

- **Trust:** Full — once paired via Ed25519 mutual attestation, both devices
  see all non-private memories.
- **Sync model:** Bidirectional push (CRDT LWW-Map for memories, 2P-Set for
  edges). `trigger_sync()` runs on connect/reconnect.
- **Privacy:** `ShareScope::Private` memories are excluded from the Hive
  bundle path, but the paired-device Link path currently has NO scope filter
  (both devices belong to the same user). **New in SCALE-INF-1:** add an
  opt-in per-tag ACL that allows a device to mark specific tags as
  "this device only" (e.g., `private:work-laptop`).

### 2. Team / Company

Multiple users in a shared org, each running their own TerranSoul.

- **Trust:** Partial — the relay operator (company-hosted Hive) enforces ACL.
  Each user's instance publishes only `ShareScope::Hive`-scoped memories.
- **Sync model:** Subscribe — a user subscribes to specific **shard topics**
  (e.g., `team:engineering/procedural`) and receives only memories in those
  shards that pass the ACL filter.
- **Privacy contract:** A memory tagged `private:<username>` MUST NEVER
  appear in any outbound sync bundle, regardless of `ShareScope` setting.
  This is the hard-ACL invariant tested in SCALE-INF-1.

### 3. Partner (Cross-Household)

Two users who trust each other for specific topics (e.g., shared family
calendar, travel plans) but not all memories.

- **Trust:** Scoped — both users configure a shared tag (e.g., `shared:family`)
  and only memories bearing that tag are synced.
- **Sync model:** Subscribe (tag-filtered). The Hive relay enforces the tag
  match at the protocol level; the local client also validates inbound bundles
  never contain memories lacking the shared tag.
- **Privacy contract:** Same as team — `private:*` tags are hard-blocked.

---

## Subscribe Model (New)

The current sync architecture is purely push/pull. SCALE-INF-1 introduces
a **subscribe** concept for the Hive relay path:

```
┌─────────────┐                ┌──────────────┐
│  TerranSoul │  ──subscribe──▶│  Hive Relay  │
│  (client)   │◀──bundles─────  │  (server)    │
└─────────────┘                └──────────────┘
```

### Subscribe Request

```rust
pub struct SubscribeRequest {
    /// Which shards to receive (e.g., ["procedural/long", "semantic/working"])
    pub shard_topics: Vec<String>,
    /// Tag filter: only receive memories matching these tags
    pub include_tags: Vec<String>,
    /// Hard-exclude: never receive memories with these tags
    pub exclude_tags: Vec<String>,
    /// Since HLC counter (for delta-only subscription)
    pub since_hlc: u64,
}
```

### Subscribe Handshake

1. Client sends `SubscribeRequest` in a signed `HiveEnvelope`.
2. Relay validates the client's Ed25519 identity against the org ACL roster.
3. Relay confirms with `SubscribeAck { subscription_id, shard_topics }`.
4. Relay pushes matching bundles as they arrive (filtered by scope + tags).
5. Client can `Unsubscribe { subscription_id }` or disconnect.

---

## ACL Invariant: `private:*` Tags Never Leak

The hard-ACL rule enforced at every sync boundary:

> **A memory whose `tags` array contains any tag matching the pattern
> `private:*` MUST be excluded from ALL outbound sync operations —
> regardless of `share_scope`, subscription filter, or relay
> configuration.**

This is enforced at three layers:

1. **Hive `filter_bundle()`** — already filters by `ShareScope`. Enhanced
   to also check tags for `private:*` pattern as a hard block.
2. **Link paired sync** — new `filter_private_tags()` applied in
   `compute_sync_deltas()` before emitting deltas.
3. **Subscribe relay** — relay-side filter rejects any memory with
   `private:*` tags before forwarding to subscribers.

### Test Contract

A hermetic Rust test (`acl_private_tag_never_leaks_in_sync`) proves:
- Insert 10 memories: 5 with `private:darren` tag, 5 without.
- Run `compute_sync_deltas()` from the perspective of a paired peer.
- Assert: zero of the `private:darren` memories appear in the delta set.
- Bonus: insert a Hive bundle and verify `filter_bundle()` also excludes them.

---

## Shard-Aware Subscribe Topics

Subscribe topics map to the existing 15-shard model:

```
<cognitive_kind>/<tier>
```

Examples: `episodic/short`, `procedural/long`, `semantic/working`.

A subscriber can request any subset. The relay only forwards memories
whose `(cognitive_kind, tier)` matches a subscribed topic AND passes
the tag/scope filters.

---

## File Layout

```
src-tauri/src/hive/
  privacy.rs          ← enhanced: private:* hard-block
  protocol.rs         ← new: SubscribeRequest, SubscribeAck, Unsubscribe

src-tauri/src/memory/
  crdt_sync.rs        ← enhanced: filter_private_tags() in delta computation

docs/
  cross-instance-knowledge-sharing.md  ← this file
```
