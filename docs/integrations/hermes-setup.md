# Hermes Desktop + Hermes Agent — TerranSoul Integration Guide

> **Date:** 2026-05-14
> **Status:** Doc shipped (INTEGRATE-2). The detect-and-link Tauri commands +
> chat-side suggest-hook + quest-based guided installer are queued under
> Phase INTEGRATE in [`rules/milestones.md`](../../rules/milestones.md).
> Everything in §1–§3 of this doc is real today; §4 ("Guided install via
> TerranSoul") is the contract the implementation must meet.

Hermes is the recommended companion for TerranSoul users who need a
**dedicated coding-agent surface** — multi-day workflows, dozens of
parallel sessions, deep-research over hundreds of sources, or full
keyboard-driven CLI access. TerranSoul handles your **3D companion,
brain/memory, voice, persona, and quest progression**; Hermes handles the
heavyweight agent surface and exposes TerranSoul's brain to it via MCP.

This guide covers:

1. What Hermes Desktop and Hermes Agent are.
2. Why TerranSoul recommends Hermes (and what the recommendation gate looks like).
3. What's already wired in TerranSoul today.
4. How TerranSoul will guide you through installation.
5. Manual install fallback if you prefer the upstream path.
6. Verifying the integration.
7. Troubleshooting.

---

## 1. What you're installing

| Component | What it is | Where to get it |
|---|---|---|
| **Hermes Agent** | The Python CLI — self-improving AI assistant with tool use, multi-platform messaging, and a closed learning loop. MIT-licensed. | [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) |
| **Hermes Desktop** | The native Electron GUI for the agent: chat, sessions, profiles, memory, skills, tools, scheduling, 16 messaging gateways, 14 toolsets. MIT-licensed. | [`fathah/hermes-desktop`](https://github.com/fathah/hermes-desktop) — latest release `v0.3.7` at the time of writing |

You can install **Hermes Agent on its own** (CLI only) or **Hermes
Desktop**, which bundles a first-run installer that walks you through
installing the agent into `~/.hermes` and configuring a provider.

> TerranSoul integrates with the **agent's `cli-config.yaml`**, so the
> agent must end up installed regardless of whether you use the GUI.
> Hermes Desktop is the easiest path because its installer does that for
> you.

---

## 2. Why TerranSoul recommends Hermes (and when)

TerranSoul is a **personal assistant**, not a coding-agent IDE. There
are real workloads where a dedicated Hermes surface is a better answer:

- **Deep research** — long, branched investigations over dozens of sources.
- **Multi-day workflows** — cron-scheduled jobs that should keep running
  whether or not your TerranSoul window is open.
- **Full-IDE coding sessions** — heavy edit-loops where you want a
  keyboard-driven CLI/terminal-first surface.

When the TerranSoul chat path detects one of those, you'll see a
**dismissable one-line hint** suggesting Hermes Desktop. The hint trigger
is **all three** of:

1. Estimated turn tokens ≥ `TS_HERMES_HINT_TOKENS` (default `4000`,
   override via environment).
2. Classified intent in `{deep_research, long_running_workflow, full_ide_coding}`.
3. `app_settings.hermes_hint_enabled` is true (default true; toggle in
   **Settings → Integrations**).

The hint **never auto-launches anything**. Clicking it opens the install
quest (§4) which is the only path that runs an installer.

---

## 3. What's already wired

TerranSoul ships these Hermes-aware Tauri commands today (see
[`src-tauri/src/commands/auto_setup.rs`](../../src-tauri/src/commands/auto_setup.rs)
and [`src-tauri/src/ai_integrations/mcp/auto_setup.rs`](../../src-tauri/src/ai_integrations/mcp/auto_setup.rs)):

| Command | Purpose |
|---|---|
| `setup_hermes_mcp` | Writes (or upserts) a marker-managed MCP block into Hermes's `cli-config.yaml` so the agent treats your TerranSoul brain as a first-class MCP server over HTTP. |
| `setup_hermes_mcp_stdio` | Same, but uses a stdio MCP transport (useful when you want a fully local hermes-agent ↔ TerranSoul handshake without binding `:7421`). |
| `remove_hermes_mcp` | Removes the marker-managed block. Anything you wrote outside the markers is preserved verbatim. |
| `check_all_clients` | Reports whether the TerranSoul block is present in Hermes's `cli-config.yaml`. |

Behind the commands:

- **Config path:** `~/.hermes/cli-config.yaml` on macOS/Linux, or
  `%LOCALAPPDATA%\hermes\cli-config.yaml` if that path exists on Windows.
- **YAML safety:** TerranSoul does **not** parse the YAML file (no Rust
  YAML library preserves comments). Instead it wraps its block in
  unique marker comments and upserts in place:
  ```yaml
  # >>> TerranSoul MCP auto-config (managed; do not edit between markers) >>>
  …
  # <<< TerranSoul MCP auto-config <<<
  ```
  Re-runs locate the markers and replace the block; if the markers are
  missing the block is appended.
- **HTTP block** (default) wires the agent to the running TerranSoul MCP
  server at `127.0.0.1:7421` (release) or `:7422` (dev) or `:7423`
  (`npm run mcp` tray), with `timeout: 120` and `connect_timeout: 60`.
- **stdio block** wires the agent to a TerranSoul-owned MCP child
  process.

See [`docs/hermes-vs-openclaw-analysis.md`](../hermes-vs-openclaw-analysis.md)
for the full design rationale (why marker-based upsert, why we go beyond
the upstream Hermes config schema, what we deliberately did *not* port
from Hermes).

---

## 4. Guided install via TerranSoul (queued — INTEGRATE-5)

> **Status:** This is the **contract** the implementation must meet, per
> the user-confirmed install policy:
> *"Guided installer with explicit user click + UAC through our quest system."*

When you accept the Hermes Desktop quest:

1. TerranSoul opens the **Companion: Hermes Desktop** quest panel.
2. The panel shows your OS-specific install command and an **Install**
   button.
3. Clicking **Install** runs the official installer **in an elevated
   terminal** that the OS owns:
   - **Windows:** `winget install NousResearch.HermesDesktop` (once the
     winget-pkgs PR lands) **or** download the `.exe` from the
     [Releases page](https://github.com/fathah/hermes-desktop/releases)
     and let SmartScreen prompt for confirmation.
   - **macOS:** open the official `.dmg`. Because the upstream is not
     yet code-signed, the GUI will tell you to right-click → Open or run
     `xattr -cr "/Applications/Hermes Agent.app"` after install.
   - **Linux (Debian/Ubuntu):** `sudo apt install ./hermes-desktop-<version>.deb`.
   - **Linux (Fedora/RHEL):** `sudo dnf install ./hermes-desktop-<version>.rpm`
     (append `--nogpgcheck` if your system enforces signature checking).
   - **Linux (other):** download and `chmod +x ./hermes-desktop-<version>.AppImage`.
4. The OS elevation prompt (UAC / sudo / Gatekeeper) is the **consent
   gate** — TerranSoul cannot bypass it and will not try.
5. After install, the quest panel waits for Hermes Desktop's own first-
   run wizard to put `hermes-agent` into `~/.hermes`, then offers a one-
   click **Wire TerranSoul brain** action that calls `setup_hermes_mcp`.
6. The quest closes when `check_all_clients` reports the TerranSoul
   block is present in Hermes's `cli-config.yaml`.

> **Auto-update.** Hermes Desktop's `electron-updater` handles auto-
> update on Windows / macOS / Linux AppImage. TerranSoul does **not**
> auto-update Hermes itself; doing so would step on Hermes's own update
> channel and is out of scope for any TerranSoul release.
> `.rpm` Fedora builds do not auto-update (a limitation of
> `electron-updater`) — reinstall the new `.rpm` to update.

---

## 5. Manual install fallback

If you'd rather skip the quest and install Hermes Desktop yourself:

1. Download the right binary from
   [`fathah/hermes-desktop` Releases](https://github.com/fathah/hermes-desktop/releases):
   `.exe` (Windows) · `.dmg` (macOS) · `.AppImage` / `.deb` / `.rpm` (Linux).
2. Run it. Let Hermes Desktop's first-run wizard install
   `hermes-agent` into `~/.hermes` and pick a provider.
3. In TerranSoul, run `setup_hermes_mcp` (or `setup_hermes_mcp_stdio`)
   from **Settings → Integrations → Hermes**. This writes the
   TerranSoul MCP block into `~/.hermes/cli-config.yaml`.
4. Restart Hermes Desktop (or the Hermes CLI). It will now load
   TerranSoul's brain as an MCP server.

CLI-only path (no GUI): follow the upstream
[Hermes Agent](https://github.com/NousResearch/hermes-agent) install,
then call `setup_hermes_mcp` from TerranSoul the same way.

---

## 6. Verifying the integration

After install:

1. Open Hermes Desktop **or** run `hermes-agent` from your terminal.
2. List MCP servers (`/mcp` in Hermes Desktop, or check
   `~/.hermes/cli-config.yaml`). You should see a `terransoul-brain`
   entry inside the TerranSoul marker block.
3. From inside Hermes, ask the agent a question that should hit the
   TerranSoul brain (e.g. *"What is TerranSoul's default embedding
   model?"*). The agent should call `brain_search` and return a
   memory-grounded answer.
4. In TerranSoul, run `check_all_clients` and confirm Hermes shows as
   **wired**.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `setup_hermes_mcp` returns "could not determine Hermes config path" | Hermes is not installed, or it lives somewhere `dirs::home_dir()` can't reach. | Install Hermes Desktop first; verify `~/.hermes/cli-config.yaml` exists. |
| Hermes does not see TerranSoul as an MCP server | TerranSoul MCP isn't running. | Open TerranSoul (release `:7421`), run `npm run dev` (`:7422`), or `npm run mcp` (`:7423`). The Hermes block points at `:7421` by default. |
| Windows SmartScreen blocks Hermes Desktop install | Upstream is not code-signed. | Click **More info** → **Run anyway**. This is the upstream's documented behavior, not a TerranSoul issue. |
| macOS blocks "Hermes Agent.app" on first launch | Upstream is not notarized. | Run `xattr -cr "/Applications/Hermes Agent.app"` or right-click → Open → Open in the confirmation dialog. |
| Fedora `dnf` rejects the `.rpm` | Upstream `.rpm` is not GPG-signed. | Append `--nogpgcheck` to the install command. |
| The TerranSoul block in `cli-config.yaml` looks wrong after a manual edit | You edited inside the markers. | Re-run `setup_hermes_mcp` — TerranSoul will rewrite the block. Everything **outside** the markers is preserved verbatim. |

---

## Related

- [`docs/hermes-vs-openclaw-analysis.md`](../hermes-vs-openclaw-analysis.md)
  — full comparison + adoption rationale.
- [`docs/AI-coding-integrations.md`](../AI-coding-integrations.md)
  — wider AI-coding-integration matrix.
- [`rules/milestones.md`](../../rules/milestones.md) Phase INTEGRATE
  — live status of the queued code-side work.
- Upstream:
  [`fathah/hermes-desktop`](https://github.com/fathah/hermes-desktop) ·
  [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent).
