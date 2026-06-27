# Organization Authorization — design & adoption principle

> **Status:** design ready (2026-06-02). Reference audit of
> [`nduckmink/arkon`](https://github.com/nduckmink/arkon) complete (§4–§5).
> This doc defines the **principle** TerranSoul adopts and what to copy.
> The design has since been **implemented** (`src-tauri/src/commands/authz.rs` +
> `src-tauri/src/authz/schema.rs`); the completed record is archived as phase
> **ORG-AUTHZ** in [`rules/completion-log.md`](../rules/completion-log.md).
> **Key finding:** arkon is **single-tenant** (departments, not multi-org) — we
> copy its RBAC / scope-engine / permission-vocabulary / auth UI verbatim and
> add a **multi-organization** layer on top (TerranSoul's extension).

## 1. Why this doc

TerranSoul is **local-first** today: a single desktop user, an Ollama-backed
brain, an MCP server guarded by a **single bearer token**
(`<data_dir>/mcp-token.txt`, `0600`, auto-generated, regenerable via the
`mcp_regenerate_token` Tauri command), and **CRDT cross-device sync** for one
identity across that user's devices. There is **no organization model, no
multi-user identity, and no role/permission system** today.

To support **teams / shared brains / hosted multi-tenant** use (multiple people
on one organization's brain, with who-can-do-what), we need an
**organization-authorization** layer. Rather than invent it, we adopt the
best-in-class reference — the same way we adopted
[`microsoft/SkillOpt`](https://github.com/microsoft/SkillOpt) as our
*skill-optimization* principle — and here that reference is `nduckmink/arkon`.

## 2. The principle (what "good" looks like)

**A principal-based, organization-scoped, role→permission authorization model
with a single policy layer.** Concretely:

```
principal  (a user, service-account, or API key — the authenticated identity)
   └── membership ── in an ── organization (tenant boundary; owns all data)
                                   └── role  (owner | admin | member | viewer | …)
                                          └── permissions (verbs on resource types)
every protected action → one authorize(principal, action, resource) check
```

Design rules (the principle):

1. **One identity abstraction — the `principal`.** Users, service accounts, and
   API keys are all principals; everything downstream authorizes a *principal*,
   never a "user" specifically. (This is the literal meaning of "principal" in
   auth: the entity a permission is granted to.)
2. **The organization is the tenancy boundary.** Every resource (memory, skill,
   repo, conversation) belongs to exactly one organization; cross-org access is
   impossible by construction, not by a forgotten `WHERE org_id = ?`.
3. **Authorization is centralized, not scattered.** One `authorize(...)` policy
   layer (middleware/guard) — never ad-hoc `if user.is_admin` checks sprinkled
   across routes. The same policy gates the backend (Tauri commands / MCP tools)
   *and* drives the frontend (hide/disable what the principal can't do).
4. **RBAC first, with permission granularity.** Coarse roles for the UI, fine
   permissions for enforcement, so the policy can evolve without renaming roles.
5. **Auditable & least-privilege.** Every grant is a row; default-deny;
   membership/role changes are logged.
6. **Local-first must still work.** A solo local user is just an
   organization-of-one whose principal is the owner — the model degrades to the
   current single-token experience with **zero friction** (no login wall for the
   offline desktop user).

## 3. "Is it a better principal?" — SkillOpt vs authorization

`microsoft/SkillOpt` and authorization are **orthogonal concerns**. SkillOpt is
a *skill-optimization* method (text-space reflect → gate → update of a Markdown
skill doc); it has nothing to say about identity, organizations, or
permissions. So the question is **not** "SkillOpt vs arkon" — it is *"is arkon a
strong enough reference to adopt as our **authorization** principle, the way
SkillOpt is our skill-opt principle?"*

Our answer is the model in §2: a **principal → organization → role → permission**
shape behind a single policy layer is the industry-standard, auditable, and
least-surprising design. We adopt arkon **to the extent it implements that
cleanly** (a centralized policy + a principal/org/role schema), and we
explicitly **do not** copy any anti-pattern (e.g. per-route `is_admin` checks,
org_id filtering left to each query, or auth state duplicated in the client).
§4–§5 record where arkon matches the principle and where we diverge.

## 4. arkon audit — auth UI/UX & architecture

Audited 2026-06-02 (deepwiki `2.1/2.4/5.2/6.2/7.3/7.4` + upstream source:
`app/services/{auth_service,permissions,permission_engine,mcp_auth_service}.py`,
`app/routers/{auth,rbac,scopes,oauth}.py`, `app/main.py`,
`frontend/src/lib/auth.tsx`, `frontend/src/app/login/page.tsx`,
`(portal)/layout.tsx`, `components/layout/sidebar.tsx`). Where README/deepwiki
lagged the code, the code (`permissions.py`) is authoritative.

**What arkon is — the near-twin of our brain.** A self-hosted **enterprise
knowledge-management system that doubles as an MCP server**: it ingests org
docs, compiles a wiki, and serves **permission-scoped context to Claude/LLMs**
("AI as a managed org resource"). Stack: FastAPI + SQLAlchemy-async + Alembic,
**PostgreSQL + pgvector**, Redis/arq, MinIO, **FastMCP**; **Next.js** App-Router
frontend. **Auth is hand-rolled** (no Clerk/Auth0/NextAuth): `bcrypt` + `pyjwt`,
a React `AuthProvider`, and a hand-built **OAuth 2.1 + PKCE** authorization
server for MCP clients.

**Principal model.** ONE principal type — `Employee` (no separate
service-account/API-key entity; machine access reuses the Employee via a token
column). Three credential surfaces: (1) **portal JWT** — HS256, `sub/role/name`,
**24 h, no refresh**, `Authorization: Bearer`; (2) **MCP `ark_` opaque token** —
`ark_`+`token_urlsafe(32)`, stored on the employee, **null-to-revoke**;
(3) **MCP OAuth 2.1 + PKCE** (full `.well-known` discovery, dynamic client
registration). Accounts are **admin-provisioned** (no self-signup, no password
reset, no email verification, no MFA/SSO).

**Tenancy — SINGLE-tenant, NOT multi-org.** There is **no Organization entity,
org switcher, cross-org membership, or email invites**; the deployment *is* the
one org. The internal scoping axes are: **Department** (M2M to employees, the
primary access boundary), **Project**/`ProjectMember`/`ProjectSource`
(cross-functional grouping), **ScopeMembership** (workspace collaborator roles),
and **KnowledgeScope** (allow/deny by employee/department/knowledge-type/source,
**deny overrides allow**). → *TerranSoul's multi-organization layer is our
extension on top of this; arkon's RBAC/scoping is what we copy verbatim.*

**Authorization — the strongest part (RBAC + ABAC-style scoping, policy in
code).** Permission grammar `resource:action:scope`, `scope ∈ {own_dept, all}`,
org-admin perms unscoped. **All 31 permissions + role maps live in ONE
`app/services/permissions.py`** (`ALL_PERMISSIONS`, `PERMISSION_GROUPS`,
`PERMISSION_LABELS/DESCRIPTIONS`, `ROLE_PRESETS`, `LEGACY_PERMISSION_MAP`) —
consumed by **both** the backend dependency and the frontend role editor (no
drift). Two role realms: **fixed system roles** (viewer / contributor /
knowledge_manager / admin=ALL) and **custom DB roles** (permission strings as a
JSONB array, validated against `ALL_PERMISSIONS`, `is_system` roles protected
from edit/delete so admins can't lock themselves out). No external policy engine
(no Casbin/Oso/Cerbos/OpenFGA) — a hand-built `permission_engine`.

**Enforcement.** No global middleware — protection is **per-route FastAPI
dependency injection**: `require_admin`, `require_permission("org:employees:read")`,
`get_current_user`. The data-scoping brain is `permission_engine.py`:
`build_document_filter()/build_skill_filter()` resolve a role into
`(needs_filter, allowed_dept_ids)` and **push the dept constraint into the SQL**
(no per-row checks); Global (no-dept) resources are visible to all. Crucially,
the **MCP layer enforces authz at the data layer** (`apply_scope_filter()`
injects `WHERE` on sources) so **the LLM literally cannot retrieve unauthorized
docs**.

**Auth UI/UX (what the user sees).** *Login page*: centered card, wordmark +
"Enterprise AI Control Center", Email + Password, "Sign in"→spinner, red error
banner, no signup/forgot links. *Route guard* (`(portal)/layout.tsx`):
`useAuth()` → spinner while loading → redirect to `/login` if no user. *Sidebar*:
nav items carry `requiredPermissions: string[]`, filtered by
`items.filter(i => !i.req || i.req.some(p => hasPermission(p)))` (item shows if
the user has ANY of its perms); Dashboard is admin-only. *Employees screen*:
table (name/email/system-role/custom-role/active) + dialog with **dual role
assignment** (system + custom) + **MCP token generate/revoke**. *Roles screen*:
cards with permission badges grouped by domain; dialog = grouped permission
**checkboxes** with per-perm tooltips + a **system-role lockout warning**.
*Departments* + shared **ScopeDialog** ("Full Access" default → add allow/deny
rules by knowledge category or specific document). *Profile/MCP token card*:
generate a Bearer token (**shown once**), revoke to kill, explains the token
inherits the employee's role + scopes. *Settings* (admin-only): provider/API-key
cards with **key masking** (server returns dots, omit-if-masked on save,
clear-on-focus). *Permission-denied UX*: primarily **hide-what-you-can't-do**;
403 (`"Permission required: …"`) is the backstop.

**Frontend enforcement** is UX-only (`hasPermission`/`canAccess` in
`auth.tsx`); every real check is re-enforced server-side — the correct split.

## 5. What TerranSoul copies (UI/UX + architecture), ranked

**Architecture to copy (highest value first):**

1. **One central permission module** — a single source of truth holding the
   permission vocabulary (`ALL_PERMISSIONS`, groups, labels, descriptions, role
   presets, legacy-map), consumed by *both* the Rust enforcement layer and the
   Vue role editor. This is the same doctrine as our "no hardcoded
   scores/verbs in source — policy lives in one place" rule; for authz the
   vocabulary should live in one Rust module (mirrored to the brain so the
   frontend reads it via MCP), never duplicated in the client.
2. **`resource:action:scope` permission grammar** (`scope ∈ {own, org, all}`),
   with Global (unscoped) resources visible to all — expressive RBAC without an
   external policy engine.
3. **Query-pushdown scope engine** — resolve a principal's role into
   `(needs_filter, allowed_ids)` and push the constraint into the
   `MemoryStore`/SQL query, not per-row checks. Scales to large memory sets.
4. **Data-layer MCP authorization** (arkon's `apply_scope_filter`) — enforce
   authz inside `brain_search`/`brain_suggest_context` so an LLM/agent can
   **never** retrieve memories outside its principal's scope. This is the
   single most important pattern for our brain (it serves context to LLMs).
5. **Allow/deny scoping with deny-precedence** for fine-grained per-memory /
   per-source access.
6. **Per-route dependency guards** → in Rust, one `authorize(caps, action,
   resource)` extension to `GatewayCaps` checked by every Tauri command + MCP
   tool (no scattered `is_admin`).
7. **Dual role realm** — fixed system roles + custom DB roles with `is_system`
   lockout protection + permission-string validation on save.
8. **Machine tokens** — admin-issued + self-service, one-time display,
   instant-revoke, scope-inherited from the owning principal (our MCP token
   evolves into this).

**UI/UX to copy (→ Vue 3 `<script setup>`, `var(--ts-*)` tokens, scoped CSS):**

1. **Declarative permission-gated nav** — each nav/route item carries
   `requiredPermissions[]`; a `useAuthz()` composable filters with
   `.some(hasPermission)`. Keeps the sidebar and the policy in lockstep.
2. **Roles screen** — cards with grouped permission badges; editor = grouped
   checkboxes with per-permission tooltips (from the central descriptions) + a
   **lockout warning** on system roles.
3. **Members screen** — table + dialog with **dual role assignment** and
   per-principal **token generate/revoke**.
4. **Scope dialog** — "Full Access" default → add allow/deny rules by
   memory-category or specific resource.
5. **Token card** — generate a Bearer token shown **once**, revoke to kill,
   with the `claude_desktop_config.json` / MCP snippet.
6. **API-key masking** — return dots, omit-if-masked on save, clear-on-focus
   (apply to our provider/API-key settings too).
7. **Auth gate + permission-denied UX** — route guard composable + a friendly
   **denied screen** (improving on arkon's thin 403).

**Anti-patterns to AVOID (arkon's weak spots):**

- **24 h JWT in `localStorage`, no refresh, no server-side logout/revocation.**
  Use an httpOnly cookie or OS-keychain-backed credential + short access token +
  refresh/rotation; keep a server-side revocation denylist.
- **One principal type blurring human vs service identity** — model a distinct
  `service-account`/`api-key` principal kind from day one for clean audit
  attribution.
- **No MFA/SSO** — design the principal/credential model so an OIDC/SSO provider
  can slot in later (we are not arkon's closed on-prem-only case).
- **Docs hand-written, drifting from `permissions.py`** — generate any
  permission reference from the canonical module.
- **Never trust frontend gating alone** — it is UX-only; re-check every action
  server-side (arkon does this correctly; preserve it).

## 6. Mapping to TerranSoul's architecture

How the principle integrates with what we already have:

- **MCP token → per-principal credentials.** Today one bearer token guards the
  MCP server. Extend to per-principal tokens/API-keys (each an authenticated
  `principal`); the gateway's `GatewayCaps` (already gates read/write) becomes
  the enforcement point of `authorize(principal, action, resource)`. The solo
  local user keeps the auto-generated owner token — no login required offline.
- **Tauri commands.** A single guard resolves the current principal + checks the
  permission before the command runs (the backend half of the policy layer).
- **Vue frontend.** A `useAuthz()` composable + a Pinia `auth` store drive
  conditional rendering (hide/disable what the principal can't do) and route
  guards — the policy is queried, never re-implemented client-side.
- **Brain/SQLite schema.** Add `principals`, `organizations`, `memberships`
  (principal × org × role), and `roles`/`permissions`; stamp every brain
  resource with `org_id` so tenancy is structural. A numbered seed migration
  (per `rules/`) creates the tables; a solo install seeds an org-of-one.
- **CRDT cross-device sync → org-scoped sync.** Today sync spans one identity's
  devices; org-authorization scopes a sync document to an organization and
  authorizes each participating principal — multi-user becomes multi-device with
  membership checks.

## 7. Implementation plan

Implemented; the completed record is archived as phase **ORG-AUTHZ** in
`rules/completion-log.md`. High level, deny-by-default and local-first-preserving:

1. Schema + seed (principals/orgs/memberships/roles/permissions; org-of-one for
   solo installs) + the central `authorize()` policy layer in the gateway.
2. Backend enforcement: Tauri command guard + MCP per-principal tokens wired
   into `GatewayCaps`.
3. Frontend: `auth` store + `useAuthz()` + auth UI/UX surfaces copied from
   arkon (login, org switcher, members/roles, invites, API keys,
   permission-denied), in TerranSoul design tokens.
4. CRDT sync scoping to organizations.
5. Tests: `cargo test` on the policy layer (deny-by-default, role matrix),
   `vitest` on the store/guards, plus an audit-log assertion.

## References

- [`nduckmink/arkon`](https://github.com/nduckmink/arkon) — auth reference (audit §4–§5). Credit in `CREDITS.md`.
- [`microsoft/SkillOpt`](https://github.com/microsoft/SkillOpt) — the *skill-optimization* principle (orthogonal; see §3).
- `src-tauri/src/ai_integrations/mcp/auth.rs` — current MCP bearer-token auth.
- `src-tauri/src/ai_integrations/gateway.rs` — `GatewayCaps` (current read/write capability gate; the future enforcement point).
