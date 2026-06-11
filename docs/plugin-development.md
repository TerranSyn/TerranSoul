# TerranSoul Plugin Development Guide

> Build extensions that add commands, views, themes, slash-commands, memory hooks, and more to TerranSoul — using the same contribution-point model as VS Code.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Manifest Reference](#manifest-reference)
4. [Contribution Points](#contribution-points)
5. [Activation Events](#activation-events)
6. [Capability System](#capability-system)
7. [Plugin Kinds](#plugin-kinds)
8. [WASM Sandbox](#wasm-sandbox)
9. [Settings](#settings)
10. [Memory Hooks](#memory-hooks)
11. [Slash Commands](#slash-commands)
12. [Themes](#themes)
13. [Example Plugins](#example-plugins)
14. [Testing](#testing)
15. [Publishing](#publishing)

---

## Overview

TerranSoul plugins extend the companion's abilities through a **declarative manifest** (`terransoul-plugin.json`). The system is inspired by VS Code's extension model:

- **Declarative contributions** — register commands, views, themes, slash-commands, and memory hooks via the manifest
- **Lazy activation** — plugins are only activated when their activation events fire
- **Capability-gated** — sensitive operations (filesystem, network, clipboard) require explicit user consent
- **WASM sandbox** — untrusted plugins run in an isolated wasmtime sandbox
- **Hot reload** — install, activate, deactivate, and uninstall without restarting

## Quick Start

### 1. Create the manifest

Create a `terransoul-plugin.json` file:

```json
{
  "id": "my-org.hello-world",
  "display_name": "Hello World",
  "version": "1.0.0",
  "description": "A minimal TerranSoul plugin that adds a greeting command.",
  "kind": "Tool",
  "install_method": "BuiltIn",
  "capabilities": [],
  "activation_events": [
    { "OnCommand": { "command": "my-org.hello-world.greet" } }
  ],
  "contributes": {
    "commands": [
      {
        "id": "my-org.hello-world.greet",
        "title": "Say Hello",
        "category": "Hello"
      }
    ]
  },
  "api_version": 1
}
```

### 2. Install via the frontend

```typescript
import { usePluginStore } from '@/stores/plugins'

const pluginStore = usePluginStore()
const manifest = await fetch('/plugins/hello-world/terransoul-plugin.json').then(r => r.text())
await pluginStore.install(manifest)
await pluginStore.activate('my-org.hello-world')
```

### 3. Use Tauri commands directly (Rust)

```rust
// Install
let installed = app_state.plugin_host.install(manifest).await?;
// Activate
app_state.plugin_host.activate("my-org.hello-world").await?;
// List commands
let commands = app_state.plugin_host.list_commands().await;
```

---

## Manifest Reference

### Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Unique plugin ID. Must be lowercase, alphanumeric, dots, and hyphens. Convention: `publisher.plugin-name`. |
| `display_name` | `string` | ✅ | Human-readable name shown in the marketplace. |
| `version` | `string` | ✅ | Semantic version (`MAJOR.MINOR.PATCH`). |
| `description` | `string` | ✅ | Short description (shown in marketplace cards). |
| `kind` | `string` | ✅ | Plugin type: `Agent`, `Tool`, `Theme`, `Widget`, or `MemoryProcessor`. |
| `install_method` | `string` | ✅ | How the plugin runs: `Binary`, `Wasm`, `Sidecar`, or `BuiltIn`. |
| `capabilities` | `string[]` | ✅ | Required capabilities (see [Capability System](#capability-system)). |
| `activation_events` | `object[]` | ✅ | When to activate (see [Activation Events](#activation-events)). |
| `contributes` | `object` | ✅ | Contribution points (see below). |
| `api_version` | `number` | ✅ | Must be `1` for the current API. |
| `homepage` | `string` | | URL to the plugin's homepage or repository. |
| `license` | `string` | | SPDX license identifier (e.g., `MIT`, `Apache-2.0`). |
| `author` | `string` | | Author name or email. |
| `icon` | `string` | | Path to a 128×128 icon (PNG or SVG). |
| `publisher` | `string` | | Publisher/organization name. |
| `signature` | `string` | | Ed25519 signature for verified plugins. |
| `sha256` | `string` | | SHA-256 hash of the plugin package. |
| `dependencies` | `object[]` | | Other plugins this one depends on. |

### ID Naming Convention

```
publisher.plugin-name
```

- Lowercase only
- Alphanumeric, dots (`.`), and hyphens (`-`)
- Examples: `terransoul.code-analysis`, `my-org.hello-world`, `acme.memory-export`

---

## Contribution Points

### Commands

Register executable commands that appear in the command palette and can be triggered programmatically.

```json
{
  "contributes": {
    "commands": [
      {
        "id": "my-plugin.analyze",
        "title": "Analyze Code",
        "icon": "🔍",
        "keybinding": "Ctrl+Shift+A",
        "category": "Analysis"
      }
    ]
  }
}
```

**Rules:**
- Command IDs must contain at least one dot (e.g., `my-plugin.command-name`)
- The `title` is shown in the UI
- `icon`, `keybinding`, and `category` are optional
- `OnCommand` activation is lazy: invoking a command activates an installed plugin before dispatching

### Command Runtime Contracts

Command dispatch depends on the plugin `install_method`:

| Install method | Invocation contract |
|---|---|
| `BuiltIn` | Runs the host's registered built-in handler. Unknown built-ins return a metadata fallback for local development. |
| `Wasm` | Calls exported `handle_command(ptr, len) -> i64` with JSON input `{ "command_id": string, "args": any }`. |
| `Binary` | Starts the configured executable and passes `command_id` as argv[1], followed by JSON-encoded args as argv[2] when args are present. |
| `Sidecar` | Starts the configured executable, writes one JSON line to stdin, then captures stdout, stderr, and exit code. |

Binary and sidecar command execution requires the sandbox `ProcessSpawn` grant for the plugin ID. Manifest capabilities are also checked before execution: `Filesystem` maps to `FileRead` and `FileWrite`, `Clipboard` maps to `Clipboard`, `Network` maps to `Network`, and `RemoteExec` maps to `ProcessSpawn`.

### Views

Register UI panels that appear in specific locations.

```json
{
  "contributes": {
    "views": [
      {
        "id": "my-plugin.dashboard",
        "label": "Plugin Dashboard",
        "location": "MainTab",
        "icon": "📊"
      }
    ]
  }
}
```

**View Locations:**
- `MainTab` — a new tab in the main content area
- `ChatSidebar` — sidebar panel next to chat
- `BrainPanel` — inside the brain configuration panel
- `MemoryPanel` — inside the memory viewer
- `Overlay` — floating overlay panel

### Settings

Declare configurable settings with types and defaults.

```json
{
  "contributes": {
    "settings": [
      {
        "key": "maxResults",
        "label": "Maximum Results",
        "description": "How many results to return per search",
        "default_value": 10,
        "value_type": "Number"
      }
    ]
  }
}
```

**Setting Value Types:** `String`, `Number`, `Boolean`, `Array`, `Object`

Settings are namespaced automatically: `plugin-id.key` (e.g., `my-plugin.maxResults`).

### Themes

Register custom color themes using TerranSoul's `--ts-*` design tokens.

```json
{
  "contributes": {
    "themes": [
      {
        "id": "my-plugin.ocean-blue",
        "label": "Ocean Blue",
        "tokens": {
          "--ts-accent": "#0077b6",
          "--ts-bg-primary": "#023e8a",
          "--ts-bg-secondary": "#0096c7",
          "--ts-text-primary": "#caf0f8",
          "--ts-text-secondary": "#90e0ef"
        }
      }
    ]
  }
}
```

See `src/style.css` for the full list of `--ts-*` tokens.

### Slash Commands

Register chat slash-commands (e.g., `/translate`).

```json
{
  "contributes": {
    "slash_commands": [
      {
        "name": "translate",
        "description": "Translate the last message to another language",
        "command_id": "my-plugin.translate"
      }
    ]
  }
}
```

### Memory Hooks

Hook into the memory pipeline at specific stages.

```json
{
  "contributes": {
    "memory_hooks": [
      {
        "id": "my-plugin.tag-extractor",
        "stage": "PreStore",
        "description": "Auto-extract tags from memory entries before storing"
      }
    ]
  }
}
```

**Memory Hook Stages:**
- `PreStore` — before a memory entry is written to the database
- `PostStore` — after a memory entry is persisted
- `OnRetrieve` — when memories are retrieved during RAG search
- `OnConsolidate` — during sleep-time memory consolidation

---

## Activation Events

Plugins are lazy-loaded. They only activate when one of their declared events fires.

| Event | Example | Fires When |
|---|---|---|
| `OnStartup` | `"OnStartup"` | App launches |
| `OnCommand` | `{ "OnCommand": { "command": "my.cmd" } }` | Command is invoked |
| `OnView` | `{ "OnView": { "view_id": "my.view" } }` | View is opened |
| `OnChatMessage` | `{ "OnChatMessage": { "pattern": "translate" } }` | Message contains pattern |
| `OnMemoryTag` | `{ "OnMemoryTag": { "tag": "code" } }` | Memory with tag is stored |
| `OnMarketplace` | `"OnMarketplace"` | Marketplace view is opened |
| `OnBrainModeChange` | `"OnBrainModeChange"` | Brain mode switches |
| `OnCapabilityGranted` | `{ "OnCapabilityGranted": { "capability": "Network" } }` | Capability is granted |

---

## Capability System

Plugins must declare their required capabilities upfront. Users grant consent before activation.

| Capability | Description |
|---|---|
| `Chat` | Access conversation history and send messages |
| `Filesystem` | Read/write files on the local filesystem |
| `Clipboard` | Read/write the system clipboard |
| `Network` | Make outbound HTTP requests |
| `RemoteExec` | Execute code on remote machines |
| `Character` | Control the 3D character (expressions, animations) |
| `ConversationHistory` | Read full conversation history |

Plugins with no capabilities run in a fully sandboxed environment with no side effects.

---

## Plugin Kinds

| Kind | Use Case |
|---|---|
| `Agent` | An AI agent that can be selected in the agent roster |
| `Tool` | A utility that adds commands and automation |
| `Theme` | A visual theme (CSS token overrides) |
| `Widget` | A UI component that renders in a view location |
| `MemoryProcessor` | A pipeline processor for the memory/RAG system |

---

## WASM Sandbox

> **Feature gate:** The WASM sandbox is available when built with `--features wasm-sandbox`
> (which pulls in the `wasmtime` crate). The feature is **not** enabled by default.
> See `src-tauri/Cargo.toml` for the feature definition.

Plugins with `"install_method": "Wasm"` run inside TerranSoul's wasmtime sandbox:

- **Isolation** — each WASM plugin runs in its own linear memory space
- **Capability enforcement** — only granted capabilities are exposed as host functions
- **Resource limits** — CPU and memory usage are bounded
- **No filesystem access** — unless the `Filesystem` capability is granted

### WASM Plugin Structure

```
my-plugin/
├── terransoul-plugin.json
└── plugin.wasm          # Compiled WASM module
```

The WASM module must export:
- `memory` — linear memory used for JSON input/output exchange
- `handle_command(cmd_ptr: i32, cmd_len: i32) -> i64` — command handler

`handle_command` receives UTF-8 JSON at `cmd_ptr..cmd_ptr + cmd_len`:

```json
{
  "command_id": "my-plugin.analyze",
  "args": { "selection": "..." }
}
```

Return `0` for success with no output, or pack the output pointer and length as `(output_ptr << 32) | output_len`. Output is interpreted as UTF-8 text and surfaced in the command result.

---

## Settings

### Reading Settings (Frontend)

```typescript
const pluginStore = usePluginStore()
const maxResults = await pluginStore.getSetting('my-plugin.maxResults')
```

### Writing Settings (Frontend)

```typescript
await pluginStore.setSetting('my-plugin.maxResults', 25)
```

### Reading Settings (Rust)

```rust
let value = app_state.plugin_host.get_setting("my-plugin.maxResults").await;
```

---

## Memory Hooks

Memory hooks let plugins intercept and transform memory entries at different pipeline stages.

### Example: Auto-Tagger

```json
{
  "id": "my-org.auto-tagger",
  "display_name": "Auto-Tagger",
  "version": "1.0.0",
  "description": "Automatically tags memory entries with extracted keywords.",
  "kind": "MemoryProcessor",
  "install_method": "BuiltIn",
  "capabilities": [],
  "activation_events": ["OnStartup"],
  "contributes": {
    "memory_hooks": [
      {
        "id": "my-org.auto-tagger.extract",
        "stage": "PreStore",
        "description": "Extract keywords and add as tags before storing"
      }
    ]
  },
  "api_version": 1
}
```

---

## Slash Commands

Slash commands provide a quick way for users to invoke plugin functionality from the chat input.

When the user types `/translate hello world`, TerranSoul:
1. Matches the `/translate` prefix to the registered slash command
2. Checks if the owning plugin is active (activates it if an activation event matches)
3. Invokes the linked `command_id` with the rest of the input as arguments

---

## Example Plugins

### Translator Mode Reference Plugin

TerranSoul ships a built-in reference plugin named `terransoul-translator`. It demonstrates the recommended pattern for chat-native plugins:

1. Declare a normal command (`terransoul-translator.start`) plus a slash command (`/translator`).
2. Use an `OnChatMessage` activation event so natural language like “become a translator to help me translate between English and Vietnamese” can activate the feature.
3. Keep plugin state in the host app (`translatorMode` in the conversation store) while the plugin command remains the stable extension point.
4. Require either a free cloud LLM provider with a user-owned key/token (for example OpenRouter/Gemini/NVIDIA/Pollinations) or a local LLM (Local Ollama / LM Studio).
5. Route the actual work through existing host capabilities instead of inventing a separate framework: ASR transcripts or typed turns enter the normal chat pipeline, and the active keyed/local brain receives a strict “translate only” prompt.

```json
{
  "id": "terransoul-translator",
  "display_name": "Translator Mode",
  "version": "1.0.0",
  "description": "Reference built-in plugin that turns TerranSoul into a two-person translator.",
  "kind": "tool",
  "install_method": "built_in",
  "capabilities": [],
  "activation_events": [
    { "type": "on_chat_message", "pattern": "translator" }
  ],
  "contributes": {
    "commands": [
      {
        "id": "terransoul-translator.start",
        "title": "Start Translator Mode",
        "icon": "🌍",
        "category": "Translation"
      },
      {
        "id": "terransoul-translator.stop",
        "title": "Stop Translator Mode",
        "icon": "🛑",
        "category": "Translation"
      }
    ],
    "slash_commands": [
      {
        "name": "translator",
        "description": "Start translator mode, e.g. /translator English Vietnamese",
        "command_id": "terransoul-translator.start"
      }
    ]
  },
  "api_version": 1
}
```

User flow:

- Start: “become a translator to help me translate between English and Vietnamese”
- Person A speaks/types in English; TerranSoul directly outputs Vietnamese
- Person B speaks/types in Vietnamese; TerranSoul directly outputs English
- Stop: “stop translator mode”

Use this plugin as the smallest complete example for a new chat-mode plugin: one manifest, one contributed command, one optional slash command, deterministic activation text, tests for state transitions, and documentation of the user-facing flow.

### OpenClaw Bridge Reference Plugin

TerranSoul also ships a built-in plugin named `openclaw-bridge`. It is the
reference pattern for external tool runtimes: TerranSoul owns the conversation,
memory, persona, and consent model, while OpenClaw owns the actual tool runtime
behind a narrow command boundary.

Use this pattern when the integration is a tool surface rather than a full brain
provider. OpenClaw should not appear as a selectable local model or Agent
Marketplace package. It contributes `/openclaw` and command ids that can be
called from chat, tests, or future UI buttons:

```json
{
  "id": "openclaw-bridge",
  "display_name": "OpenClaw Bridge",
  "version": "1.0.0",
  "description": "Built-in plugin for invoking OpenClaw-style read, fetch, and chat tools from TerranSoul.",
  "kind": "tool",
  "install_method": "built_in",
  "capabilities": ["chat", "filesystem", "network"],
  "activation_events": [
    { "type": "on_chat_message", "pattern": "/openclaw" }
  ],
  "contributes": {
    "commands": [
      { "id": "openclaw-bridge.read", "title": "OpenClaw Read" },
      { "id": "openclaw-bridge.fetch", "title": "OpenClaw Fetch" },
      { "id": "openclaw-bridge.chat", "title": "OpenClaw Chat" },
      { "id": "openclaw-bridge.status", "title": "OpenClaw Bridge Status" }
    ],
    "slash_commands": [
      {
        "name": "openclaw",
        "description": "Run OpenClaw tools, e.g. /openclaw read README.md",
        "command_id": "openclaw-bridge.dispatch"
      }
    ]
  },
  "api_version": 1
}
```

Capability mapping:

| Manifest capability | Sandbox grants written by the Plugins view | Used by |
|---|---|---|
| `filesystem` | `file_read`, `file_write` | `/openclaw read ...` currently requires `file_read` |
| `network` | `network` | `/openclaw fetch ...` |
| `chat` | none; low-risk chat capability | `/openclaw chat ...` |

Best practice for real OpenClaw deployments:

- Add a plugin setting for the OpenClaw runtime URL rather than hardcoding it.
- Validate that the runtime is loopback or explicitly trusted before network
  calls leave the app.
- Keep JSON-RPC request bodies small and auditable.
- Summarize large tool outputs through the active brain instead of dumping raw
  data into chat.
- Offer a memory-save action for useful tool results and include source/tool
  provenance.

See [`tutorials/openclaw-plugin-tutorial.md`](../tutorials/openclaw-plugin-tutorial.md)
for the detailed usage and future chunk plan.

### Code Analyzer

```json
{
  "id": "terransoul.code-analyzer",
  "display_name": "Code Analyzer",
  "version": "1.0.0",
  "description": "Analyze code snippets pasted in chat for complexity, patterns, and suggestions.",
  "kind": "Tool",
  "install_method": "BuiltIn",
  "capabilities": ["Chat"],
  "activation_events": [
    { "OnChatMessage": { "pattern": "analyze" } }
  ],
  "contributes": {
    "commands": [
      {
        "id": "terransoul.code-analyzer.analyze",
        "title": "Analyze Code",
        "icon": "🔍",
        "category": "Code"
      }
    ],
    "slash_commands": [
      {
        "name": "analyze",
        "description": "Analyze a code snippet for complexity and patterns",
        "command_id": "terransoul.code-analyzer.analyze"
      }
    ]
  },
  "api_version": 1
}
```

### Cyberpunk Theme

```json
{
  "id": "terransoul.cyberpunk-theme",
  "display_name": "Cyberpunk Neon",
  "version": "1.0.0",
  "description": "A neon-soaked cyberpunk color theme.",
  "kind": "Theme",
  "install_method": "BuiltIn",
  "capabilities": [],
  "activation_events": ["OnStartup"],
  "contributes": {
    "themes": [
      {
        "id": "terransoul.cyberpunk-theme.neon",
        "label": "Cyberpunk Neon",
        "tokens": {
          "--ts-accent": "#ff00ff",
          "--ts-bg-primary": "#0a0a1a",
          "--ts-bg-secondary": "#1a1a3e",
          "--ts-text-primary": "#00ffcc",
          "--ts-text-secondary": "#ff6ec7"
        }
      }
    ]
  },
  "api_version": 1
}
```

### Obsidian Memory Exporter

```json
{
  "id": "terransoul.obsidian-export",
  "display_name": "Obsidian Export",
  "version": "1.0.0",
  "description": "Export TerranSoul memories as Obsidian-compatible markdown files.",
  "kind": "Tool",
  "install_method": "BuiltIn",
  "capabilities": ["Filesystem"],
  "activation_events": [
    { "OnCommand": { "command": "terransoul.obsidian-export.export" } }
  ],
  "contributes": {
    "commands": [
      {
        "id": "terransoul.obsidian-export.export",
        "title": "Export to Obsidian",
        "icon": "📝",
        "category": "Memory"
      }
    ],
    "settings": [
      {
        "key": "vaultPath",
        "label": "Vault Path",
        "description": "Path to your Obsidian vault directory",
        "default_value": "",
        "value_type": "String"
      }
    ]
  },
  "api_version": 1
}
```

---

## Testing

### Rust Unit Tests

```bash
# Run all plugin tests
cargo test --lib plugins::

# Run specific test
cargo test --lib plugins::manifest::tests::valid_manifest_passes
```

### Frontend Unit Tests

```bash
# Run plugin store tests
npx vitest run src/stores/plugins.test.ts
```

### Manifest Validation

Use the `plugin_parse_manifest` Tauri command to validate a manifest:

```typescript
try {
  const manifest = await pluginStore.parseManifest(jsonString)
  console.log('Valid manifest:', manifest.id)
} catch (e) {
  console.error('Invalid manifest:', e)
}
```

Validation checks:
- ID format (lowercase, alphanumeric + dots/hyphens)
- Version is valid semver (`MAJOR.MINOR.PATCH`)
- API version is supported
- Command IDs contain at least one dot
- Dependency versions are valid semver ranges
- Required fields are non-empty

---

## Publishing

### Package Structure

```
my-plugin-1.0.0.tar.gz
├── terransoul-plugin.json
├── plugin.wasm           # (optional, for WASM plugins)
├── icon.png              # (optional, 128×128)
└── README.md             # (optional)
```

### Signing

Plugins can be signed with Ed25519 for verified distribution:

1. Generate a keypair using TerranSoul's identity system
2. Sign the package hash
3. Include the `signature` and `sha256` fields in the manifest

### Registry

TerranSoul's built-in registry server runs on `localhost` and catalogs available plugins. The marketplace view (`MarketplaceView.vue`) displays installable plugins with their descriptions, capabilities, and ratings.

---

## Architecture

```
Frontend (Vue 3 + Pinia)
  └── stores/plugins.ts — usePluginStore()
      ├── install(manifestJson)
      ├── activate(pluginId)
      ├── deactivate(pluginId)
      ├── uninstall(pluginId)
      ├── getSetting(key) / setSetting(key, value)
      └── refresh() — bulk-fetch all plugin state
          ↕ Tauri IPC (invoke)
Rust Plugin Host (src-tauri/src/plugins/)
  ├── manifest.rs — PluginManifest, validation, serde
  ├── host.rs — PluginHost lifecycle manager
  └── mod.rs — re-exports
      ↕ AppState.plugin_host
Tauri Commands (src-tauri/src/commands/plugins.rs)
  └── 13 commands: plugin_install, plugin_activate, plugin_deactivate,
      plugin_uninstall, plugin_list, plugin_get, plugin_list_commands,
      plugin_list_slash_commands, plugin_list_themes, plugin_get_setting,
      plugin_set_setting, plugin_host_status, plugin_parse_manifest
```

### Relationship to Existing Systems

- **Package Manager** (`package_manager/`) — Plugin manifests reuse `Capability`, `InstallMethod`, and `SystemRequirements` types from the existing agent package system
- **Sandbox** (`sandbox/`) — WASM plugins use the existing `WasmRunner` and `CapabilityStore`
- **Registry Server** (`registry_server/`) — The plugin catalog extends the existing registry
- **Marketplace View** (`MarketplaceView.vue`) — Existing UI for browsing and installing
