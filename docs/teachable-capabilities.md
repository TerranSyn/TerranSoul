# Teachable Capabilities

Teachable Capabilities are user-configurable feature records for companion behavior that should be learned, measured, and eventually promoted into source defaults when the user proves a configuration works well.

The system deliberately uses neutral names for code, UI labels, persisted paths, and workflow plans. Research sources can inform the catalogue, but runtime identifiers stay descriptive and product-agnostic.

## What It Stores

Each capability has:

- a stable snake_case `id`
- a category such as Voice, Vision, Persona, Phone Control, File Assistant, Game Companion, Visual Generation, Hardware, or Integrations
- an `enabled` toggle
- a JSON `config` object
- a `config_schema` object that the Vue panel renders into controls
- source target hints for promotion workflows
- usage count, last-used time, rating totals, and promotion metadata

The backend persists everything under:

```text
<app_data_dir>/teachable_capabilities/capabilities.json
```

## Maturity Rules

The maturity ladder matches the shared promotion rules used by Charisma:

| Tier | Rule |
|---|---|
| Untested | disabled, never used, or not enough runtime evidence |
| Learning | enabled and used, but below the proven threshold |
| Proven | enabled, at least 10 uses, and average rating at least 4.0 |
| Canon | promoted into a source-default workflow plan |

Promotion creates a four-step coding workflow plan: Researcher, Coder, Tester, Reviewer. The Coder and Reviewer steps require approval.

## Frontend Surface

The pet context menu opens the Teachable Capabilities panel. The panel supports:

- category tabs
- enabling and disabling each capability
- schema-driven config editing
- a Test action that records a usage event
- 1-5 rating controls
- reset to bundled defaults while preserving usage history
- Promote for Proven capabilities

The Pinia store lives in [src/stores/teachable-capabilities.ts](../src/stores/teachable-capabilities.ts). The panel lives in [src/components/TeachableCapabilitiesPanel.vue](../src/components/TeachableCapabilitiesPanel.vue).

## Backend Commands

The panel calls these Tauri commands:

- `teachable_capabilities_list`
- `teachable_capabilities_set_enabled`
- `teachable_capabilities_set_config`
- `teachable_capabilities_record_usage`
- `teachable_capabilities_set_rating`
- `teachable_capabilities_reset`
- `teachable_capabilities_promote`
- `teachable_capabilities_summary`

The backend registry lives in [src-tauri/src/teachable_capabilities/registry.rs](../src-tauri/src/teachable_capabilities/registry.rs), and the command layer lives in [src-tauri/src/commands/teachable_capabilities.rs](../src-tauri/src/commands/teachable_capabilities.rs).

## GitHub Authorization

Self-improve can authorize GitHub through Device Flow from the Self-Improve panel:

1. The frontend calls `github_request_device_code`.
2. The user opens the browser verification page and enters the displayed code.
3. The frontend polls `github_poll_device_token` at the backend-provided interval.
4. On success, the backend saves the access token into the existing self-improve GitHub config.

Manual token entry remains available for users who prefer it.

## Safety Notes

- Config edits are stored as JSON objects only.
- Promotion plans carry target-file hints but do not edit files directly.
- Promotion requests explicitly ask reviewers to reject secrets, absolute user paths, and third-party-branded names in identifiers or UI strings.
- The catalogue should keep capability IDs and display names neutral even when research comes from outside projects.