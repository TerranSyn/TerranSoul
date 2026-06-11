# ADR 007 — Tauri 2 as the desktop runtime

**Status:** Accepted  
**Date:** 2025  
**Source:** `src-tauri/`

---

## Context

TerranSoul needs a native desktop window with:
- Transparent, always-on-top overlay for pet mode
- System tray integration
- Access to local files, SQLite, network, and GPU (via WebGL2)
- Cross-platform installers (Windows, macOS, Linux)
- A Vue 3 + Three.js frontend (impractical to rebuild in native toolkit code)

## Decision

Use **Tauri 2** as the desktop runtime.

The Rust backend exposes ≈ 540 Tauri commands via `invoke()`. The Vue 3
frontend calls these over the IPC bridge via `@tauri-apps/api`.

## Why not Electron

| Factor | Electron | Tauri 2 |
|--------|----------|---------|
| Bundle size | ~150 MB (bundles Chromium + Node.js) | ~8 MB (uses system WebView2 / WebKit) |
| Memory baseline | ~200 MB | ~40 MB |
| Native system API | Node.js bindings (subprocess) | Rust — full OS access, direct syscalls |
| Pet-mode transparent window | Poorly documented, fragile | First-class: `transparent: true`, `always_on_top` |
| IPC overhead | JSON over `contextBridge` (serialise → postMessage → deserialise) | Direct Rust serialisation to frontend buffer |
| Code signing | Complex multiplatform setup | Built-in MSI/DMG signing via Tauri CLI |
| Offline capability | Full (Node bundles everything) | Full (Rust binary + system WebView) |

The 8 MB vs 150 MB installer difference matters for a first-impression download.
The transparent window support is non-negotiable for pet mode (ADR 006).

## Trade-offs

- **WebView2 on Windows:** Uses the system Edge WebView2 runtime rather than
  a pinned Chromium. Behaviour is consistent in practice (WebView2 auto-updates
  via Windows Update), but the rendering engine version is not in our control.
  Mitigated by: vitest component tests + vue-tsc type checking.

- **Real-E2E testing:** Playwright must attach to the WebView2 process via CDP
  (`--remote-debugging-port`) rather than launching a plain browser instance.
  Requires `tauri dev` to be running before the test process starts.
  See `Real-E2E/helpers.ts`.

- **WASM plugins:** Tauri's WASM sandbox (`wasmtime`) for untrusted plugins
  adds ≈ 2 s cold-start per plugin. Acceptable for plugin activation events
  (not per-turn).

## Related ADRs

- [ADR 006](006-vrm-avatar-and-motion-pipeline.md) — pet mode transparent window drives this choice
