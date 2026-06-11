# Supertonic — Integration Research

> **Date:** 2026-05-15
> **Chunk:** TTS-SUPERTONIC-1 (research phase / stage 1a)
> **Status:** Research complete; chunk split into 1a/1b/1c. See
> `rules/milestones.md` for 1b/1c implementation queue.

This document captures the design research the **TTS-SUPERTONIC-1** chunk
explicitly required before any code is written:

> *"**Blocker risk**: model size, packaging weight (>=200 MB?), platform
> support (Windows/macOS/Linux/mobile), and consent UX may force a
> stage-gated rollout — surface those in the chunk's research notes
> before writing code."*

## Upstream

- Repo: <https://github.com/supertone-inc/supertonic> (5.4 k stars,
  active in May 2026; current public release: **Supertonic 3**, April 2026).
- DeepWiki: <https://deepwiki.com/supertone-inc/supertonic> (reachable;
  used as a first-pass map and cross-checked against upstream README).
- Models on Hugging Face: <https://huggingface.co/Supertone/supertonic-3>
  (v3 — 31 languages), with `release/supertonic-2` branch preserved
  on GitHub for the v2 code path.
- Paper: *SupertonicTTS — Towards Highly Efficient and Streamlined Text-to-Speech
  System*, Kim et al., arXiv:2503.23108 (2025); LARoPE arXiv:2509.11084;
  Self-Purifying Flow Matching arXiv:2509.19091.

## License analysis (the critical finding)

The README's "License" section makes the licensing surface **two-tier**:

| Artifact | License | Commercial-use posture |
|---|---|---|
| **Sample code** (`py/`, `rust/`, `cpp/`, `nodejs/`, `web/`, …) | **MIT** | ✅ Clean. Compatible with TerranSoul's non-GPL stance. We may study, adapt, and re-publish derivative Rust code under MIT/Apache-2.0 without restriction. |
| **Model weights** (the ONNX assets we actually ship at runtime) | **OpenRAIL-M** — Open Responsible AI License — Model | 🟡 **Conditional clearance.** OpenRAIL-M is a *use-based* license: it permits commercial use but imposes behavioural restrictions on downstream applications. We must comply with the restriction list and we must propagate the same restrictions to **end users**. |
| Training framework | PyTorch (BSD-3-Clause) | ✅ Not redistributed by Supertonic — only mentioned for attribution. Does **not** apply to us since we are loading ONNX assets, not PyTorch. |

### OpenRAIL-M obligations summary

Reference: <https://www.licenses.ai/ai-licenses> and the canonical
OpenRAIL-M v1 text. The exact use-restriction list on the Supertonic 3
model card on Hugging Face governs us. Headline obligations:

1. **No discrimination / harassment.** The model must not be used to
   discriminate against, harass, or harm individuals or groups based on
   legally protected characteristics.
2. **No mass surveillance / unauthorised profiling.**
3. **No generation of mis-/dis-information** intended to harm.
4. **No CSAM / non-consensual intimate imagery.**
5. **No automated legal / medical / financial advice** without human
   review.
6. **Propagate the same restrictions** to any user who runs derivatives
   (we must surface a short notice or a link to the model card).
7. **Attribution** in the running app's about/credits surface.

These obligations are compatible with TerranSoul's product posture
(personal AI companion, not a content-generation farm), but they require
**three concrete artifacts** before TTS-SUPERTONIC-1b can ship:

- An entry in `docs/licensing-audit.md` under a new **"🟡 Conditional
  clearance"** section (added in this stage 1a).
- A line in `CREDITS.md` attributing Supertonic + the model card
  (added in this stage 1a).
- A **user-visible consent dialog** in the first-run TTS install UX that
  (a) links to the upstream model card / OpenRAIL-M text, (b) names the
  use restrictions in plain English, and (c) requires an explicit Accept
  before the model is downloaded. This is **stage 1c** work, gated on
  the auto-download UX.

### What OpenRAIL-M does **not** block

- Commercial distribution of TerranSoul itself.
- Bundling or redistributing the model assets, **provided** the
  restrictions and attribution travel with them.
- Using Supertonic as the *default* TTS provider once installed.

## Runtime architecture

| Concern | Finding |
|---|---|
| Inference engine | **ONNX Runtime** — native, cross-platform C/C++ library. No Python required at runtime. |
| Model format | ONNX (v2-compatible public interface preserved in v3). Optimised variants via OnnxSlim are available. |
| Parameter count | ~99 M parameters total across the public ONNX assets. |
| **Asset size on disk** | ~300 MB unsliimmed (per HF repo size); OnnxSlim variants reduce this, but the full multi-voice / multi-language bundle still lands in the **200–400 MB** range. **This is the blocker the milestone scope flagged.** We cannot bundle this into the Tauri installer (which is currently ~30 MB) without ballooning install size by an order of magnitude. **Decision: first-run download from Hugging Face, gated on user consent.** |
| Languages | 31 (English, Korean, Japanese, Arabic, Bulgarian, Czech, Danish, German, Greek, Spanish, Estonian, Finnish, French, Hindi, Croatian, Hungarian, Indonesian, Italian, Lithuanian, Latvian, Dutch, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Swedish, Turkish, Ukrainian, Vietnamese). |
| Preset voices | 8 fixed-voice presets in the public ONNX assets (M1–M5, F1–F5, with M3/M4/M5/F3/F4/F5 added in late 2025). |
| Expressive tags | Inline tags `<laugh>`, `<breath>`, `<sigh>` supported by the model. |
| GPU requirement | **None** — the open-weight fixed-voice setting runs on CPU. RTF ~0.3× has been demonstrated on Raspberry Pi 4. |
| Sample rate / format | 16-bit WAV output. |
| Tokenizer / phonemiser | Bundled with the model assets; the Rust example under `rust/` in the upstream repo demonstrates loading. |

## Rust integration path

Supertonic's `rust/` directory in the upstream repo provides a working
ONNX-Runtime-based Rust example. This is the reference TerranSoul will
adapt — **not vendor**. The straightforward path is:

| Component | Crate / approach |
|---|---|
| ONNX Runtime bindings | [`ort`](https://crates.io/crates/ort) (Apache-2.0 / MIT) — mature, actively maintained, downloads ORT binaries automatically. **Preferred.** |
| Tokenizer | Hugging Face `tokenizers` crate (Apache-2.0). |
| Model download | `reqwest` against Hugging Face raw URLs (no API key required for public repos). Per-file with SHA-256 verification against a pinned manifest committed in `src-tauri/src/voice/supertonic_manifest.rs`. |
| Audio I/O | We already emit 16-bit WAV from other providers — reuse the existing helpers. |
| Storage path | `app_data_dir().join("voice/supertonic/v3/")` — same pattern as other downloadable assets. The path must be exposed via a Tauri command so the settings UI can show "Installed at: …" and offer "Remove model". |

### No sidecar process needed

The milestone scope asked us to evaluate a Tauri sidecar binary. **It is
not needed.** The `ort` crate runs ONNX Runtime in-process, the model
weights load into our existing async runtime, and synthesis returns WAV
bytes through the `TtsEngine` trait. Sidecar architecture would only be
required if Supertonic shipped Python-only, which it does not (v3 has
first-class Rust support upstream).

### Bundle weight impact

- ORT shared library: ~10–15 MB per platform, pulled in by `ort`.
- Tokenizer crate: ~2 MB binary footprint.
- **No model weights bundled** — downloaded on first use.

Net binary growth: roughly **+15 MB to the Tauri installer**, plus the
**~300 MB on-disk model** after first-run download. This is acceptable.

## Platform support

| Platform | Supported by Supertonic v3 | Supported by our integration plan |
|---|---|---|
| Windows (x86_64) | ✅ | ✅ stage 1b |
| macOS (Apple Silicon + Intel) | ✅ | ✅ stage 1b |
| Linux (x86_64) | ✅ | ✅ stage 1b |
| iOS | ✅ (native ONNX Runtime iOS) | 🟡 stage 1d (post-1c) — depends on Tauri 2 mobile maturity for our app, not on Supertonic. |
| Android | ✅ (via Flutter SDK upstream; ONNX Runtime Android exists) | 🟡 stage 1d (post-1c) — same caveat. |
| WebView2 / browser fallback | ✅ (onnxruntime-web upstream) | ⛔ Out of scope — TerranSoul ships as a Tauri desktop app and uses native Rust providers. |

Stage 1b will ship desktop only; mobile parity is its own follow-up.

## First-run UX

Three states the UI must cover:

1. **Not installed** — Voice Setup panel shows the existing "Supertonic
   (on-device, neural)" tier with an **"Install"** button. Clicking opens
   a consent dialog that names the OpenRAIL-M restrictions, links the
   model card, shows the **~300 MB** download size, and offers Accept /
   Cancel. Cancel keeps `web-speech` as the active provider.
2. **Downloading** — progress bar with bytes / total, per-file status,
   and a Cancel button. Failures show actionable error messages
   (offline / disk full / SHA-256 mismatch).
3. **Installed** — provider card flips to "Active", the per-voice picker
   (M1–M5, F1–F5) becomes available, and the user can either set
   Supertonic as default or keep their existing default. If the user
   has no explicit TTS provider, **stage 1c will switch the default from
   `web-speech` to `supertonic`** at first launch after install.

## Stage gating

The original TTS-SUPERTONIC-1 chunk is split into three sequential
chunks. Stage 1a is closed in this session; 1b and 1c remain in
`rules/milestones.md`.

| Stage | Scope | Deliverables |
|---|---|---|
| **1a (this session)** | Research + license audit + attribution + chunk split. | `docs/supertonic-integration-research.md` (this file), `docs/licensing-audit.md` conditional-clearance entry, `CREDITS.md` row, `mcp-data/shared/memory-seed.sql` durable-lesson row, `rules/milestones.md` split into 1b/1c. |
| **1b** | Rust ONNX provider — desktop only. | `src-tauri/src/voice/supertonic_tts.rs` with `SupertonicTts` implementing `TtsEngine`; `ort` + `tokenizers` Cargo dependencies; SHA-256-verified model download via `reqwest`; install-path Tauri commands (`supertonic_install_path`, `supertonic_is_installed`, `supertonic_remove`); Rust unit + integration tests with a tiny pinned synthesis fixture; update `voice/mod.rs::tts_providers()` to flip `installed: true` dynamically. **Does not** auto-switch the default — stays opt-in. |
| **1c** | First-run consent UX + default switch + frontend vitest. | Vue dialog component for the OpenRAIL-M consent step; progress UI for download; default-provider promotion (when `voice_config.tts_provider` is unset / equals `web-speech` and Supertonic is installed, prefer Supertonic); vitest coverage. |

Stage 1d (mobile parity) is intentionally **not** filed yet — it depends
on the broader Tauri 2 mobile readiness work and should ride on whatever
mobile milestone unblocks the rest of the voice stack on iOS/Android.

## Self-improve cross-references

- `mcp-data/shared/memory-seed.sql` row `tts-supertonic-1a-research` will
  carry the durable lessons (OpenRAIL-M two-tier license, ~300 MB
  download size, no-sidecar-needed conclusion, stage split) so future
  sessions don't re-litigate them.
- `docs/licensing-audit.md` gains a new **🟡 Conditional clearance**
  section for OpenRAIL-M model weights — this section is the canonical
  policy reference for any future on-device model that ships under a
  RAIL-family license.
- `CREDITS.md` row attributes Supertone Inc. plus the three arXiv papers
  per the upstream README's citation request.

## Decisions log

| Decision | Outcome |
|---|---|
| Vendor the upstream Rust example? | **No.** Adapt under MIT in a new file `src-tauri/src/voice/supertonic_tts.rs`. |
| Sidecar process? | **No.** `ort` crate in-process. |
| Bundle model in installer? | **No.** First-run download. |
| Default provider switch? | **Stage 1c.** Not in 1b. |
| Support iOS/Android in 1b? | **No.** Desktop only. Mobile is a future chunk. |
| License compatible with TerranSoul commercial use? | **Yes, with conditional clearance.** Must propagate OpenRAIL-M restrictions to end users via consent dialog (1c) and document in `licensing-audit.md` (1a, this session). |
