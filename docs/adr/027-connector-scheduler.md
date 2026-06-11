# ADR 027 — ConnectorSource Trait + Scheduler

**Status:** Accepted  
**Date:** 2026-06-07  
**Spec:** Spec 027 — ConnectorSource Trait + Tokio Scheduler (IMAP, GitHub, RSS, LocalFS)

---

## Context

TerranSoul's hybrid RAG pipeline ingests documents from a single local embedding
index. Power users accumulate knowledge across email, code hosts, RSS feeds, and
local file trees — all of which age out of context windows quickly. There was no
mechanism to pull those sources incrementally into the brain.

The gap: the memory store could receive documents via `ingest_document_silent`,
but no subsystem was responsible for fetching new documents on a schedule. Each
connector also needs to store credentials (passwords, API tokens) without
compromising the local-first, no-cloud-dependency posture.

Reference ecosystem: Onyx (formerly Danswer) ships 50+ enterprise connectors with
Celery queues, Redis brokers, and Postgres state — infrastructure unsuitable for a
personal desktop app. TerranSoul's scope is 4 personal connectors; the transport
must be zero-dependency beyond what is already in the Cargo.toml.

---

## Decision

### 1. Tokio interval tasks instead of Celery/Redis

Each enabled connector runs inside a `tokio::spawn` task started at app boot by
`connectors::scheduler::start_scheduler`. The task loops:

```
loop {
    interval.tick().await;          // honours interval_secs from DB
    run_connector_cycle(…).await;   // fetch_since → ingest
}
```

`MissedTickBehavior::Skip` prevents burst pileup after a long ingest cycle.

**Why not Celery/Redis:**

| Option | Problem for TerranSoul |
|--------|------------------------|
| Celery + Redis broker | External process; Docker beyond Ollama; no offline |
| OS task scheduler (cron/Task Scheduler) | Requires elevated permissions; no access to Tauri app state |
| `std::thread::sleep` loop | Cannot `await` within a sync context; must hold `AppState` Arc |
| `tokio::spawn` interval | Fits naturally inside Tauri's async runtime; shares `AppState` without locks beyond the existing `Mutex<MemoryStore>` |

The decision keeps TerranSoul as a single process with no external infrastructure.

### 2. `ConnectorSource` trait — `fetch_since(DateTime<Utc>)`

```rust
#[async_trait]
pub trait ConnectorSource: Send + Sync {
    fn id(&self) -> &str;
    fn kind(&self) -> &str;
    async fn fetch_since(&self, since: DateTime<Utc>) -> anyhow::Result<Vec<ConnectorDoc>>;
}
```

`fetch_since` is the sole sync primitive. The scheduler reads `last_sync_ts` from
the `connector_sources` table and passes it as `since`; connectors return only
documents published or updated after that timestamp. On a cold connector (no
`last_sync_ts`) the scheduler defaults to 30 days ago, capping the initial
backfill.

The trait enforces **incremental sync** at the API boundary: connectors cannot
accidentally return unbounded full dumps. Every adapter — regardless of whether
its backend supports server-side date filtering — is responsible for honouring the
`since` anchor (client-side filtering is acceptable for v1).

### 3. mtime polling for Local FS v1 (trait uniformity)

The `LocalFsConnector` walks a configured directory, filters files by modification
time (`fs::metadata().modified() >= since`), reads each file, and returns a
`ConnectorDoc`.

**Why mtime polling rather than `notify` push-mode:**

- `notify` requires an OS-specific watcher thread that must be kept alive across
  Tauri window lifecycle events. That lifecycle management is non-trivial and not
  yet needed for personal-scale file trees.
- Push-mode adds a separate code path that conflicts with the uniform
  `fetch_since` pull interface.
- For the personal use case (hundreds to low thousands of local files) the polling
  overhead per interval tick is negligible.

Push-mode via `notify` is explicitly deferred to v2 as an optimisation once the
`ConnectorSource` contract is stable.

### 4. AES-256-GCM credential storage via DeviceIdentity key

Connector credentials (IMAP passwords, GitHub PATs) are stored in the
`connector_credentials` SQLite table as `(ciphertext BLOB, nonce BLOB)` pairs.

Encryption: `aes-gcm` crate, 256-bit key, 96-bit random nonce (fresh per write).  
Key derivation: the 32-byte device identity key from `identity::key_store::load_or_generate_identity`.

```
plaintext JSON  ──AES-256-GCM(device_key, random_nonce)──►  ciphertext + nonce
                                                              stored in SQLite
```

**Limitation — not an OS keychain:** Credentials are protected by the device
identity key, which is itself stored in the app data directory, not in the OS
secure enclave (Windows Credential Manager, macOS Keychain, libsecret). A
full-disk-access attacker could extract both the key and the ciphertext.

This limitation is acceptable for v1 for two reasons:

1. TerranSoul is a personal app; threats from local account compromise are out of
   scope for the current trust model.
2. The OS keychain APIs have no stable cross-platform Tauri v2 binding without a
   Tauri plugin that is not yet in the official plugin registry.

OS keychain integration is tracked as a hardening item for v2.

### 5. Scope — 4 personal connectors vs Onyx's 50+

| Connector | Auth | Sync Anchor | Default interval |
|-----------|------|------------|-----------------|
| IMAP | `BasicAuth` (host/user/pass) | `fetch_since` via `SEARCH SINCE` | 900 s (15 min) |
| GitHub | `ApiToken` (PAT) | `updated_at` field on `/repos/:owner/:repo/issues` | 3 600 s (1 h) |
| RSS | `None` | `<pubDate>` / `<dc:date>` from feed | 3 600 s (1 h) |
| LocalFS | `None` | `mtime` polling | 3 600 s (1 h) |

Onyx ships connectors for Confluence, Jira, Slack, Salesforce, and 45+ more — all
requiring OAuth flows, webhook registration, or organisation-level API tokens.
These are enterprise dependencies incompatible with a personal app that must work
fully offline.

---

## Consequences

- `start_scheduler` is called once from `lib.rs` `setup()`. No watcher threads,
  no external brokers.
- Disabling a connector via the UI (`enable_connector` command) does not kill an
  already-running Tokio task; the next `tick()` checks `enabled` in the DB.
  (A full task cancellation registry is a v2 concern.)
- `last_sync_ts` is updated **only when every document in a cycle ingests
  without error**, ensuring no docs are silently skipped on partial failure.
- Credential deletion cascades to the `connector_credentials` table via the
  `delete_connector` command; no orphaned ciphertext blobs remain.
- Adding a new connector kind requires: implementing `ConnectorSource`, adding a
  match arm in `build_connector`, and registering a new `kind` string in the
  frontend form. No scheduler changes are needed.

---

## Related ADRs

- [ADR 001](001-brain-and-memory-architecture.md) — memory store that receives ingested docs
- [ADR 003](003-mcp-single-source-of-truth.md) — AppStateGateway as single write path
- [ADR 007](007-tauri-2-desktop-runtime.md) — Tauri async runtime that hosts the Tokio tasks
- [ADR 009](009-sqlite-for-memory.md) — `connector_sources` + `connector_credentials` tables
- [ADR 028](028-connector-management-tab.md) — UI tab for connector management (MemorySourcesTab)
