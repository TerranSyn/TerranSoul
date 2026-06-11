# TerranSoul Hive Protocol Specification

> **Version:** 0.1.0 (Draft)
> **Date:** 2026-05-07
> **Status:** Design Review

## 1. Overview

The **Hive Protocol** enables opt-in federation between TerranSoul instances.
Devices can share knowledge bundles, synchronise CRDT operations, and dispatch
distributed work items through a lightweight relay server.

The protocol is layered atop gRPC (Tonic) for the relay transport and can
operate over QUIC or WebSocket for direct peer-to-peer paths (reusing the
existing `LinkManager` from Phase 42.5).

### Design principles

1. **Privacy-first** — nothing leaves a device without explicit consent.
   Every memory has a `share_scope` (`private | paired | hive`).
2. **Offline-tolerant** — bundles are self-contained and immutable once
   signed. No real-time coordination required.
3. **Cryptographically authenticated** — every bundle is Ed25519-signed by
   the originating device identity (`src-tauri/src/identity/`).
4. **CRDT-native** — uses the same LWW / 2P-Set primitives from Chunks 42.3–42.5.
5. **Capability-gated jobs** — work items declare requirements; workers pull
   only what they can fulfil.

---

## 2. Message Types

The protocol defines three top-level message types:

| Type | Purpose | Direction |
|------|---------|-----------|
| `BUNDLE` | Signed batch of memories + edges | Device → Relay → Devices |
| `OP` | Single CRDT operation (low-latency) | Device ↔ Relay (bidirectional) |
| `JOB` | Work item with capability requirements | Device → Relay → Worker → Device |

### 2.1 Envelope

Every message is wrapped in a common envelope:

```
HiveEnvelope {
    version:       u8,           // Protocol version (currently 1)
    msg_type:      MsgType,      // BUNDLE | OP | JOB
    sender_id:     String,       // Device UUID
    sender_pubkey: [u8; 32],     // Ed25519 verifying key
    timestamp:     u64,          // Unix-ms wall clock
    hlc_counter:   u64,          // Hybrid Logical Clock counter
    payload:       Vec<u8>,      // Serialised message body (MessagePack)
    signature:     [u8; 64],     // Ed25519 signature over (version ∥ msg_type ∥ sender_id ∥ timestamp ∥ hlc_counter ∥ payload)
}
```

### 2.2 Signature scheme

```
sign_input = version (1 byte)
           ∥ msg_type (1 byte, 0=BUNDLE 1=OP 2=JOB)
           ∥ sender_id (UTF-8 bytes)
           ∥ timestamp (8 bytes LE)
           ∥ hlc_counter (8 bytes LE)
           ∥ payload (raw bytes)

signature = Ed25519_sign(signing_key, sign_input)
```

Verification: any recipient can verify with the sender's public key.
The relay **MUST** verify signatures before accepting or forwarding a message.
Invalid signatures are dropped with an error response.

---

## 3. BUNDLE — Signed Knowledge Batch

A `Bundle` carries a batch of memory deltas and edge deltas, plus metadata
for the receiver to reconcile into their local store using LWW / 2P-Set CRDTs.

```rust
struct Bundle {
    /// Unique bundle identifier (UUID v4).
    bundle_id: String,
    /// The HLC range covered: receiver can request "since" this counter.
    hlc_from: u64,
    hlc_to: u64,
    /// Memory CRDT deltas (same shape as SyncDelta from crdt_sync.rs).
    memory_deltas: Vec<MemoryDelta>,
    /// Edge CRDT deltas (same shape as EdgeSyncDelta from edge_crdt_sync.rs).
    edge_deltas: Vec<EdgeDelta>,
    /// Optional: cognitive-kind distribution summary (for relay routing hints).
    kind_summary: Option<HashMap<String, u32>>,
}
```

### 3.1 MemoryDelta

```rust
struct MemoryDelta {
    key: SyncKey,              // (origin_device, created_at, content_hash)
    operation: SyncOp,         // Upsert | SoftClose { valid_to }
    content: String,
    tags: String,
    importance: u8,            // 1–5
    memory_type: String,       // fact | preference | context | summary
    cognitive_kind: Option<String>,
    created_at: u64,
    updated_at: u64,
    hlc_counter: u64,
    origin_device: String,
    share_scope: ShareScope,   // private | paired | hive
    source_url: Option<String>,
    source_hash: Option<String>,
    context_prefix: Option<String>,
}
```

### 3.2 EdgeDelta

```rust
struct EdgeDelta {
    src_content_hash: String,  // Content-addressable reference (not local ID)
    dst_content_hash: String,
    rel_type: String,
    confidence: f64,
    source: String,            // user | llm | auto
    created_at: u64,
    valid_from: Option<u64>,
    valid_to: Option<u64>,     // Some = tombstoned
    edge_source: Option<String>,
    origin_device: String,
    hlc_counter: u64,
}
```

### 3.3 Content-addressable references

Edge deltas reference memories by **content hash** (SHA-256 of `content` field)
rather than local integer IDs. This allows cross-device resolution without a
global ID authority. On apply, the receiver maps content hashes to local IDs.

### 3.4 Bundle size limits

- Max memories per bundle: **10,000**
- Max edges per bundle: **50,000**
- Max payload size: **64 MiB** (before compression)
- Compression: optional LZ4 frame (indicated by envelope flag)

---

## 4. OP — Single CRDT Operation

For low-latency sync (e.g., a user saves one memory while connected to the
relay), a single-op message avoids the overhead of a full bundle.

```rust
struct Op {
    /// Discriminant: Memory or Edge
    target: OpTarget,
    /// The delta payload (one MemoryDelta or one EdgeDelta)
    delta: OpDelta,
}

enum OpTarget { Memory, Edge }
enum OpDelta {
    Memory(MemoryDelta),
    Edge(EdgeDelta),
}
```

OPs are ephemeral — the relay holds them in a bounded queue (configurable,
default 1000 per device) and delivers to connected subscribers. Undelivered
OPs are subsumed by the next BUNDLE exchange.

---

## 5. JOB — Distributed Work Item

Jobs declare a unit of work that can be fulfilled by any capable peer.

```rust
struct Job {
    job_id: String,            // UUID v4
    job_type: String,          // e.g. "embed_chunks", "summarize", "extract_edges"
    status: JobStatus,
    /// Required capabilities the worker must have.
    capabilities: Vec<Capability>,
    /// Serialised input payload (opaque to the relay).
    input: Vec<u8>,
    /// Serialised result (filled by worker, returned as a BUNDLE).
    result: Option<Vec<u8>>,
    /// Timeout: if no worker claims within this, job returns to queue.
    timeout_ms: u64,
    /// Max retries before marking as failed.
    max_retries: u8,
    /// Current attempt count.
    attempt: u8,
}

enum JobStatus {
    Pending,
    Claimed { worker_id: String, claimed_at: u64 },
    Completed { worker_id: String, completed_at: u64 },
    Failed { reason: String },
}

struct Capability {
    kind: String,              // "brain_mode", "gpu", "embedding_model", etc.
    value: String,             // "ollama", "cuda", "nomic-embed-text", etc.
}
```

### 5.1 Job lifecycle

```
Originator                    Relay                         Worker
    |                           |                             |
    |--- JOB (Pending) ------->|                             |
    |                           |--- JOB available --------->|
    |                           |<-- JOB claim (Claimed) ----|
    |                           |                             |
    |                           |<-- BUNDLE (result) --------|
    |<-- BUNDLE (result) ------|                             |
    |                           |--- JOB (Completed) ------->|
```

### 5.2 Capability matching

The relay matches jobs to workers using a **subset requirement**: a worker can
claim a job iff `job.capabilities ⊆ worker.advertised_capabilities`. Workers
advertise capabilities on connect via a `HELLO` handshake.

---

## 6. Transport

### 6.1 Relay (gRPC / Tonic)

```protobuf
service HiveRelay {
    // Submit a signed envelope (BUNDLE, OP, or JOB).
    rpc Submit(HiveEnvelope) returns (SubmitResponse);

    // Subscribe to messages destined for this device.
    rpc Subscribe(SubscribeRequest) returns (stream HiveEnvelope);

    // Claim a job from the queue.
    rpc ClaimJob(ClaimJobRequest) returns (Job);

    // Complete a job (submits result bundle).
    rpc CompleteJob(CompleteJobRequest) returns (SubmitResponse);

    // Health / version check.
    rpc Health(Empty) returns (HealthResponse);
}

message SubscribeRequest {
    string device_id = 1;
    bytes public_key = 2;          // For the relay to verify identity
    repeated Capability capabilities = 3;  // Advertise what this device can do
    uint64 since_hlc = 4;          // Resume from this HLC counter
}
```

### 6.2 Peer-to-peer (LinkManager)

For paired devices on the same LAN, the existing `LinkManager` (QUIC + WS)
carries `HiveEnvelope` directly using `kind = "hive"`. No relay needed.

### 6.3 Wire format

- Envelope fields are serialised with **MessagePack** (compact, schema-less).
- The `payload` field within the envelope is also MessagePack.
- Optional LZ4 compression for bundles > 1 MiB (envelope flag bit 0).

---

## 7. Security Model

### 7.1 Authentication

- Every device has a persistent Ed25519 keypair (`identity/device.rs`).
- The relay maintains a registry of known public keys per hive group.
- A device joins a hive group by presenting a signed `JOIN` request
  counter-signed by an existing member (invitation model).

### 7.2 Authorisation

- The relay enforces that a device can only submit messages signed by its
  own key (no impersonation).
- `share_scope = private` memories **MUST** never appear in outbound bundles.
  This is enforced at the sender side before signing.
- The relay does NOT inspect payload content — it only verifies signatures
  and routes.

### 7.3 Replay protection

- Each envelope carries a monotonic `hlc_counter`. The relay tracks the
  highest counter per device and rejects envelopes with counter ≤ last seen.
- Subscribers receive a `since_hlc` cursor to resume from.

### 7.4 Threat model

| Threat | Mitigation |
|--------|------------|
| Relay compromise | Relay cannot forge signatures; payloads are opaque |
| Replay attack | HLC monotonicity check at relay |
| Impersonation | Ed25519 signature verification |
| Data exfiltration | `share_scope` enforcement at sender; relay doesn't decrypt |
| DoS on relay | Rate limiting per device; bundle size cap at 64 MiB |

---

## 8. Worked Examples

### 8.1 Device A shares a memory with the hive

```
1. User saves a memory with share_scope = "hive"
2. Background sync task wakes, sees new hive-scoped memory
3. Builds a Bundle:
   - memory_deltas = [MemoryDelta { content: "...", share_scope: Hive, ... }]
   - edge_deltas = [related edges with hive-scoped endpoints]
4. Serialises payload with MessagePack
5. Signs envelope with device A's Ed25519 key
6. Submits HiveEnvelope to relay via gRPC Submit()
7. Relay verifies signature → accepts → stores in Postgres → notifies subscribers
8. Device B (subscribed) receives the envelope via Subscribe() stream
9. Device B verifies signature, deserialises Bundle, applies CRDT deltas
```

### 8.2 Device B dispatches an embedding job

```
1. Device B has 500 un-embedded memories but no local Ollama
2. Creates a JOB:
   - job_type = "embed_chunks"
   - capabilities = [{ kind: "embedding_model", value: "nomic-embed-text" }]
   - input = serialised list of (content_hash, text) pairs
3. Signs and submits to relay
4. Device A (which has Ollama) has advertised the capability
5. Device A calls ClaimJob() → receives the job
6. Runs embeddings locally
7. Submits result as a BUNDLE with edge_deltas (embedding → memory mapping)
   via CompleteJob()
8. Relay marks job Completed, forwards result bundle to Device B
9. Device B applies the embedding vectors to its local store
```

### 8.3 Privacy enforcement — private memory never leaks

```
1. Device A has memory M1 (share_scope = "private") and M2 (share_scope = "hive")
2. Edge E1 connects M1 → M2 (rel_type = "related_to")
3. Sync task builds bundle:
   - M1 is excluded (private)
   - E1 is excluded (references a private endpoint)
   - M2 is included
4. Bundle contains only M2 and edges where both endpoints are hive-scoped
5. Signed and submitted — M1 never appears in any outbound payload
```

---

## 9. Rust Types (Implementation Reference)

The following types will live in `src-tauri/src/hive/protocol.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Protocol version.
pub const HIVE_PROTOCOL_VERSION: u8 = 1;

/// Maximum bundle payload size (64 MiB).
pub const MAX_BUNDLE_SIZE: usize = 64 * 1024 * 1024;

/// Maximum memories per bundle.
pub const MAX_MEMORIES_PER_BUNDLE: usize = 10_000;

/// Maximum edges per bundle.
pub const MAX_EDGES_PER_BUNDLE: usize = 50_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum MsgType {
    Bundle = 0,
    Op = 1,
    Job = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShareScope {
    /// Never leaves the device.
    Private,
    /// Syncs only between paired own-devices.
    Paired,
    /// Can be uploaded to a hive relay.
    Hive,
}

impl Default for ShareScope {
    fn default() -> Self {
        ShareScope::Private
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HiveEnvelope {
    pub version: u8,
    pub msg_type: MsgType,
    pub sender_id: String,
    pub sender_pubkey: Vec<u8>,  // 32 bytes
    pub timestamp: u64,
    pub hlc_counter: u64,
    pub payload: Vec<u8>,
    pub signature: Vec<u8>,      // 64 bytes
    pub compressed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bundle {
    pub bundle_id: String,
    pub hlc_from: u64,
    pub hlc_to: u64,
    pub memory_deltas: Vec<MemoryDelta>,
    pub edge_deltas: Vec<EdgeDelta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryDelta {
    pub content_hash: String,
    pub operation: String,       // "upsert" | "soft_close"
    pub content: String,
    pub tags: String,
    pub importance: u8,
    pub memory_type: String,
    pub cognitive_kind: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub hlc_counter: u64,
    pub origin_device: String,
    pub share_scope: ShareScope,
    pub source_url: Option<String>,
    pub source_hash: Option<String>,
    pub context_prefix: Option<String>,
    pub valid_to: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeDelta {
    pub src_content_hash: String,
    pub dst_content_hash: String,
    pub rel_type: String,
    pub confidence: f64,
    pub source: String,
    pub created_at: u64,
    pub valid_from: Option<u64>,
    pub valid_to: Option<u64>,
    pub edge_source: Option<String>,
    pub origin_device: String,
    pub hlc_counter: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSpec {
    pub job_id: String,
    pub job_type: String,
    pub capabilities: Vec<Capability>,
    pub input: Vec<u8>,
    pub timeout_ms: u64,
    pub max_retries: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability {
    pub kind: String,
    pub value: String,
}
```

---

## 10. Migration Path

| Phase | What changes |
|-------|-------------|
| 42.9 (this) | Spec document + Rust types in `src-tauri/src/hive/` |
| 42.10 | Relay server implementation (Tonic gRPC) |
| 42.11 | Job queue + capability matching |
| 42.12 | `share_scope` column + privacy enforcement + consent UI |

---

## 11. Open Questions (for review)

1. **Group management:** How are hive groups created/joined? Current design
   uses invitation (counter-signature). Alternative: shared secret + PAKE.
2. **Conflict policy for hive merges:** LWW by HLC (same as paired sync)?
   Or should hive merges be advisory (user reviews before apply)?
3. **Embedding vector sharing:** Should raw float vectors travel in bundles,
   or only content (and each device re-embeds locally)? Trade-off: bandwidth
   vs. compute. Current decision: content only; vectors are device-local.
4. **Relay persistence:** Postgres with pgvector (for routing hints) or
   simpler key-value store? Current decision: Postgres (matches 42.10 spec).
