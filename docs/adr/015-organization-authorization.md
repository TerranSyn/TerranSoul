# ADR 015 — Organization authorization (RBAC + org-of-one local-first)

**Status:** Accepted (foundation shipped 2026-06-06; UI + sync pending)
**Adapted from:** nduckmink/arkon (Apache-2.0) — RBAC + data-layer MCP scope enforcement
**Design doc:** [`docs/organization_authorization.md`](../organization_authorization.md)

## Context

TerranSoul is local-first and single-user by default, but the brain is also an
MCP server that multiple principals can reach: the desktop user, AI agents
(service accounts), API keys, and — eventually — teammates on shared org memory.
We needed an authorization model that:

1. Never adds a login wall for the solo offline user (the overwhelming common case).
2. Lets an LLM/agent be scoped so it can **never** retrieve out-of-org memories.
3. Has one central permission vocabulary (not duplicated between Rust and the frontend).
4. Supports multiple organizations (arkon is single-tenant; we extend to multi-org).

## Decision

Model: **`principal → organization → membership → role → permission`**, with a
single central `authorize()` function that is **deny-by-default**.

- **Permission vocabulary** lives in one Rust module (`authz/permissions.rs`),
  `resource:action:scope` with `scope ∈ {own, org, all}`. The frontend reads it
  via MCP (`authz_list_permissions`) so it is never duplicated.
- **Org-of-one for solo installs:** a `SoloOwner` principal holds all permissions
  and bypasses every check. A seeded `org-solo` row + `role-owner` membership means
  an existing offline user sees zero change — no auth, no login.
- **Deny-by-default policy** (`authz/policy.rs`): `authorize(principal, action,
  resource, scope)` returns `Ok` only when the principal holds the matching
  permission (or `:all`); everything else is denied.
- **Schema** (`authz/schema.rs`): `organizations`, `principals`, `roles`,
  `memberships`, `mcp_tokens` — every brain resource gains an `org_id` stamp so a
  scoped query can filter at the data layer (arkon's `apply_scope_filter` pattern).

## Why this over alternatives

| Alternative | Why rejected |
|-------------|-------------|
| No authz (token-only, current) | An agent can read the entire brain; no multi-user, no scoping |
| Per-route guards only | Scattered checks drift; an LLM retrieval path can bypass a UI guard — scope must be enforced at the data layer |
| Copy arkon verbatim | arkon is single-tenant (departments) with a 24h localStorage JWT; we need multi-org + a safer credential model |
| Force login for everyone | Breaks the local-first, zero-friction solo desktop experience |

## Consequences

**Good**
- Solo users are unaffected (org-of-one owner, no login).
- One permission vocabulary, mirrored to the frontend via MCP — no duplication.
- Deny-by-default means a new resource is locked until explicitly granted.
- Designed so an OIDC/SSO provider and org-scoped CRDT sync slot in later (AUTHZ-5).

**Trade-offs / pending**
- AUTHZ-1/2/3 shipped the vocabulary, policy, Tauri commands, and Pinia store.
  `authz_create_token` / `authz_list_tokens` are **stubs** until AUTHZ-4 runs the
  schema migration and implements token hashing.
- The data-layer scope filter on `brain_search` / `brain_suggest_context` is
  designed but not yet wired into `MemoryStore` queries (AUTHZ-2 follow-up).
- Multi-device org-scoped sync builds on ADR 005 (Hive CRDT) — tracked as AUTHZ-5.

## Related

- [ADR 003](003-mcp-single-source-of-truth.md) — the brain all principals share
- [ADR 005](005-hive-protocol-crdt-sync.md) — CRDT sync that AUTHZ-5 will scope per-org
- [ADR 009](009-sqlite-for-memory.md) — where the authz tables + `org_id` stamps live
