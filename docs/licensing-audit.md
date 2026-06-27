# Commercial-Licence Audit — 2026-04-24

> Triggered by: agent task requirement *"check to make sure all package
> or integrations or libraries meet the commercial usage."*

This document records the commercial-use review of every third-party
package, integration, and library shipped in the TerranSoul desktop app.
The bar is **strict commercial use**: a TerranSoul build distributed as
a paid commercial product (or as part of one) must not require any
extra licence purchase, must not violate any upstream Terms of Service,
and must not silently send user data to any third-party endpoint.

The audit is repeated whenever a new dependency is added (see
`rules/coding-standards.md` *"Use Existing Libraries First"* — the
checklist already includes a licence step). When in doubt, prefer
permissive (MIT / Apache-2.0 / BSD / ISC / MPL-2.0) and prefer
zero-network libraries over SaaS integrations.

## ✅ Cleared for commercial use

### npm dependencies

| Package | Licence | Notes |
|---|---|---|
| `vue`, `pinia`, `@vue/test-utils`, `vue-tsc` | MIT | Core UI framework |
| `@pixiv/three-vrm`, `@pixiv/three-vrm-animation`, `three` | MIT | Avatar rendering (VRM is the only supported avatar format — Live2D is permanently rejected, see avatar-rendering memory) |
| `@tauri-apps/api`, `@tauri-apps/cli`, `@tauri-apps/plugin-shell` | MIT / Apache-2.0 | Desktop shell |
| `cytoscape`, `@types/cytoscape` | MIT | Knowledge-graph mini-viz |
| `pdfkit` | MIT | Persona/memory PDF export |
| `better-sqlite3` | MIT | Embedded DB |
| `@ricky0123/vad-web` | MIT | Voice-activity detection (ONNX, runs in-browser via WebAssembly) |
| `vite`, `@vitejs/plugin-vue` | MIT | Bundler |
| ESLint / TypeScript-ESLint / typescript / globals | MIT / Apache-2.0 | Tooling |
| `vitest`, `jsdom`, `@playwright/test` | MIT | Testing |

### Rust crates

| Crate | Licence | Notes |
|---|---|---|
| `tauri*`, `tauri-plugin-shell` | MIT / Apache-2.0 | Desktop shell |
| `tokio*`, `tokio-tungstenite`, `tokio-util`, `futures-util`, `async-trait` | MIT | Async runtime |
| `axum` | MIT | Local HTTP server (registry / IPC) |
| `reqwest`, `rustls`, `rustls-pemfile`, `quinn`, `rcgen` | MIT / Apache-2.0 / ISC | Networking + TLS |
| `serde`, `serde_json`, `thiserror` | MIT / Apache-2.0 | Core utilities |
| `sqlx`, `rusqlite`, `tiberius`, `scylla`, `postgres` | MIT / Apache-2.0 | StorageBackend implementations |
| `wasmtime` | Apache-2.0 (with WASM exception) | WASM agent runtime |
| `ed25519-dalek`, `ring`, `sha2`, `base64`, `hex`, `rand`, `rand_core` | BSD-3 / MIT / Apache-2.0 | Crypto primitives + manifest signing |
| `scraper`, `url`, `uuid`, `qrcode`, `sysinfo`, `tempfile` | MIT / Apache-2.0 / ISC | General-purpose utilities |

### GitHub advisory database

`gh-advisory-database` scan (2026-04-24): **no vulnerabilities** in the
spot-checked subset. Re-run the scan whenever a dependency version
changes.

### Suno Bark — singing TTS (removed 2026-05-19)

The SING-BARK-* scaffold (MIT model, Python sidecar) was removed in the
SING-RUST-0 chunk in favour of a fully pure-Rust singing path
(Supertonic TTS + `pitch-core-onnx` F0 retargeting). The license analysis
remained sound — Bark is MIT for both source and weights — but the
runtime cost (Python + ~600 MB weights + ~8 GB VRAM) and lack of
per-note pitch control made it the wrong fit. See
`rules/completion-log.md` for the SING-RUST-0 archive entry.

### `pitch-core` + `pitch-core-onnx` — F0 detection (scaffolded in SING-RUST-0)

- **Upstream:** <https://docs.rs/pitch-core-onnx> /
  <https://docs.rs/pitch-core>
- **License:** **Apache-2.0** for the crate and the recommended RMVPE
  weights (MIT mirror also available); SwiftF0, CREPE, and FCPE
  estimators are MIT-licensed. PESTO (LGPL-3.0) is opt-in via a
  separate Cargo feature and will not be enabled by default.
- **What we ship in this commit:** only scaffolding —
  [src-tauri/src/voice/pitch.rs](../src-tauri/src/voice/pitch.rs)
  (`PitchAnalyzer` struct, typed `PitchError`, `PitchBackend` enum,
  `F0Track` / `PitchSample` payload types) and the `pitch-analysis`
  Cargo feature. **No** upstream source, model weights, or branded
  identity is bundled. The actual `pitch-core-onnx` dependency lands in
  SING-RUST-2.
- **What lands later (SING-RUST-2):** the `pitch-core-onnx` + `pitch-core`
  crates plus RMVPE ONNX weights (~362 MB) downloaded on opt-in user
  consent into `<app_data>/pitch/rmvpe.onnx`. Same first-run-consent
  pattern as the Supertonic TTS provider.

### `msedge-tts` — re-introduced as a feature-gated fallback voice (license exception)

> Originally removed 2026-04-24 (see history). **Re-introduced** as an
> opt-in, feature-gated fallback and recorded here as an explicit
> license exception per the audit Process below.

- **Crate licence:** MIT (commercial-OK as code).
- **Standing ToS blocker (unchanged):** the crate calls Microsoft
  Edge's undocumented `speech.platform.bing.com` *"Read Aloud"*
  WebSocket endpoint. That endpoint is **not** part of any public
  Microsoft API; the Microsoft Services Agreement directs commercial
  users to **paid Azure Cognitive Services — Text to Speech** instead.
  Programmatic third-party use of the Edge endpoint is not sanctioned
  by Microsoft and has historically been rate-limited or blocked when
  abuse is detected. **This is the same blocker that triggered the
  2026-04-24 removal and it still applies.**
- **Why it ships now:** `msedge-tts` is gated behind the
  `tts-supertonic` Cargo feature (`src-tauri/Cargo.toml`) and is used
  only as a **fallback neural voice for languages Supertonic does not
  cover** (zh / ja / etc.) — see
  [`src-tauri/src/voice/edge_tts.rs`](../src-tauri/src/voice/edge_tts.rs)
  (`supports_language()` skips any language Supertonic already covers)
  and [`src-tauri/src/commands/voice.rs`](../src-tauri/src/commands/voice.rs)
  (failover path). Supertonic remains the primary on-device path.
- **Recorded exception:** clearance is **conditional and bounded** — the
  Edge endpoint must not be the default voice for any Supertonic-covered
  language, and a commercial TerranSoul build that wants Microsoft neural
  voices without ToS risk should route those languages to a paid Azure
  TTS provider or the user-supplied OpenAI TTS provider. The
  `web-speech` (browser `SpeechSynthesis`) and OpenAI TTS providers
  remain the ToS-clean alternatives.

## � Conditional clearance (use-based / RAIL-family licenses)

Some downloadable assets — primarily on-device ML model weights — ship
under **use-based** licenses that permit commercial use *with*
behavioural restrictions on downstream applications. These are not
classic FOSS licenses and require us to (a) comply with the restriction
list, (b) propagate the same restrictions to end users, and (c) attribute
the upstream model card. They are cleared for TerranSoul only on the
conditions recorded here.

### Supertonic TTS — model weights (`Supertone/supertonic-3`)

- **Upstream:** <https://github.com/supertone-inc/supertonic> +
  <https://huggingface.co/Supertone/supertonic-3>
- **Sample code license:** MIT (the upstream `rust/`, `py/`, `cpp/` etc.
  example directories). Cleared without restriction.
- **Model weights license:** **OpenRAIL-M v1** (Open Responsible AI
  License — Model). Use-based; commercial use permitted with the
  upstream model card's restriction list.
- **Cleared on conditions** (see
  [docs/supertonic-integration-research.md](supertonic-integration-research.md)
  for full analysis):
  1. End-user consent dialog in TerranSoul's first-run TTS install UX
     names the OpenRAIL-M restrictions in plain English and links to the
     upstream model card. Implemented in chunk **TTS-SUPERTONIC-1c**.
  2. Restrictions propagate to derivative use: a short notice appears in
     the running app's About / Credits surface.
  3. Attribution to Supertone Inc. + the three arXiv papers
     (arXiv:2503.23108, arXiv:2509.11084, arXiv:2509.19091) lives in
     [`CREDITS.md`](../CREDITS.md).
  4. Model weights are **not** bundled in the Tauri installer — they are
     downloaded on first use after explicit user consent. The ~300 MB
     download size is disclosed before any bytes flow.
- **Headline use restrictions** (canonical OpenRAIL-M v1 surface; the
  upstream model card is authoritative): no discrimination/harassment,
  no mass surveillance, no malicious mis-/disinformation, no
  CSAM/non-consensual intimate imagery, no automated legal/medical/
  financial advice without human review, and the same restrictions must
  travel with any redistribution.
- **Training framework note:** Supertonic was trained with PyTorch
  (BSD-3-Clause). PyTorch is **not** redistributed by Supertonic and is
  **not** a runtime dependency for TerranSoul (we load ONNX assets via
  the `ort` crate). PyTorch's license therefore does not apply to
  TerranSoul.

> **Policy:** any future on-device model that ships under a RAIL-family
> license (OpenRAIL, BigScience RAIL, CreativeML OpenRAIL-M, etc.) goes
> in this section and follows the same four-condition template. Models
> under non-commercial-only licenses (e.g. Llama 2 ≤7B research-only,
> CC BY-NC) belong in the **🚫 Removed** section below — not here.

### MinerU document parser (removed 2026-05-19 in DOCPARSE-0)

- **Upstream:** <https://github.com/opendatalab/MinerU>
  ([LICENSE.md commit `326d5027`](https://github.com/opendatalab/MinerU/blob/master/LICENSE.md),
  DeepWiki indexed 14 May 2026).
- **License at time of scaffold:** Apache-2.0 with additional terms —
  commercial threshold (100M MAU / USD 20M monthly revenue), online-
  service attribution clause, auto-termination on non-compliance.
- **Why removed:** the MINERU-2a wrapper required a Python sidecar
  (`uv`-managed virtualenv, ~600 MB Python deps + ~1.2 GB model
  weights) which contradicts the local-first / Rust-first stance.
  MinerU's pipeline backend is itself a chain of ONNX models
  (DocLayout-YOLO, PaddleOCR, UniMERNet, table structure) — TerranSoul
  already ships the `ort` ONNX runtime for Supertonic TTS, so the heavy
  lifting moves into Rust directly via the new pure-Rust pipeline in
  `src-tauri/src/attachments/docparse.rs` (feature
  `attachments-docparse`). See the DOCPARSE-0 archive entry in
  [rules/completion-log.md](../rules/completion-log.md).
- **What shipped under MinerU branding:** Rust scaffold + ADR only. No
  source, weights, CLI binary, or Python deps were ever bundled. The
  ADR (`docs/mineru-adoption-adr.md`) was deleted as part of DOCPARSE-0
  to remove third-party branding from the codebase; the historical
  research/license context is preserved here and in
  [CREDITS.md](../CREDITS.md).
- **Replacement licensing trail (filled in as DOCPARSE-1..5 land):**
  - DOCPARSE-1 — `lopdf` (MIT), `docx-rs` (Apache-2.0 / MIT),
    `calamine` (Apache-2.0 / MIT), `quick-xml` (MIT).
  - DOCPARSE-2 — `pdfium-render` (Apache-2.0; bundled Pdfium under
    BSD-3-Clause), one of `tesseract-rs` (Apache-2.0) /
    `rten` (Apache-2.0) + PaddleOCR ONNX weights (Apache-2.0).
  - DOCPARSE-3 — DocLayout-YOLO ONNX weights (verify upstream license
    before bundling; opt-in download only).
  - DOCPARSE-4 — UniMERNet ONNX weights (verify upstream license
    before bundling; opt-in download only).
  - Each new crate / weight set lands in this file with its own entry
    in the same commit it is first used.

## �🚫 Removed (commercial blockers)

The following integrations were present in earlier builds but removed
on 2026-04-24 because they fail the strict commercial-use bar:

### `@vercel/analytics` + `@vercel/speed-insights` (npm, was mounted in `src/App.vue`)

- **Library licence:** MPL-2.0 (commercial-OK as code).
- **Blocker 1:** runtime telemetry is sent to Vercel's analytics
  servers without a user-visible privacy contract. This conflicts with
  TerranSoul's local-first privacy posture (camera frames never leave
  the device, persona suggestions are computed locally, brain memories
  live in SQLite, etc.).
- **Blocker 2:** Vercel's free Web Analytics tier is restricted to
  *non-commercial / personal* projects. Commercial use requires a paid
  Vercel plan and is a poor fit for a desktop binary that doesn't run
  on Vercel.
- **Replacement:** none. A privacy-first desktop app should not phone
  home for usage analytics. If a future opt-in telemetry channel is
  desired, it must be built as a first-party service with explicit
  user consent and a privacy policy.
- **Bonus removal:** `vue-router` was only included to satisfy the
  Vercel libraries' unconditional `useRoute()` calls. With Vercel
  removed, the router was deleted too.

### `ai4animationpy` (Python reference, never vendored)

- **Repository:** `facebookresearch/ai4animationpy` (commit `da41b05f`, ~250 KB Python).
- **Licence:** **CC BY-NC 4.0** — NonCommercial clause (§2.a.1.b) inherits to any Adapted Material.
- **Status:** 🚫 Source code, GLSL shaders, and trained `.pt` weights may NOT be copied, transliterated, or vendored into TerranSoul.
- **What we use:** Public algorithm shapes (Euler↔Quaternion conversions, FABRIK IK, exponential damping, TRS composition) as described in their originating papers. These algorithms are not copyrightable; only the specific Python expression is.
- **Implementation approach:** Clean-room Rust reimplementation using `glam` SIMD math, guided by the public papers (Aristidou & Lasenby 2011, Holden et al. 2017, Starke et al. 2018/2019/2022). The AI4AnimationPy source was read once for audit verification, then the file was closed — implementation references only the papers and `glam` documentation.
- **Added:** 2026-05-24 (ANIM-AI-1).

## Process

1. New dependencies are evaluated against the table above before the
   PR that adds them is opened — see the
   *"Use Existing Libraries First"* checklist in
   `rules/coding-standards.md` (steps 3 & 4).
2. The `gh-advisory-database` MCP tool must be invoked for every new
   dependency on a supported ecosystem (npm, rust, pip, …).
3. Any integration that calls a SaaS endpoint must be reviewed for
   ToS compliance, **even if** the client library itself is
   permissively licensed.
4. Telemetry / analytics integrations are forbidden in the desktop
   binary. A future opt-in telemetry surface, if any, must be a
   first-party service with explicit user consent.

## Related documents

- [`rules/coding-standards.md`](../rules/coding-standards.md) — *"Use Existing Libraries First"* checklist
- [`docs/brain-advanced-design.md`](./brain-advanced-design.md) — privacy contract for memory & RAG
- [`docs/persona-design.md`](./persona-design.md) — privacy contract for camera & audio-prosody features
