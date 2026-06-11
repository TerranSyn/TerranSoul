# `.terransoul-persona` Pack Schema — v1

> **Stability:** This schema is **stable from v1 onward**. New fields may be
> added (additive), but existing fields will not be removed, renamed, or have
> their semantics changed within the same `packVersion`. Breaking changes
> require a `packVersion` bump.

## File Format

- **Encoding:** UTF-8, no BOM.
- **MIME type:** `application/json`
- **Extension:** `.json` (conventional filename: `terransoul-persona-YYYY-MM-DDTHH-MM-SS.json`)
- **Max size:** 1 MiB (1,048,576 bytes). Payloads exceeding this are rejected.

## Envelope

```jsonc
{
  "packVersion": 1,                  // required, u32
  "exportedAt": 1700000001000,       // required, i64 (ms epoch)
  "note": "My custom companion",     // optional, string (null or absent = no note)
  "traits": { /* PersonaTraits */ },  // required, JSON object
  "expressions": [ /* ... */ ],       // optional, defaults to []
  "motions": [ /* ... */ ]            // optional, defaults to []
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `packVersion` | `u32` | ✅ | Must be `≤` the reader's supported version. Readers reject future versions gracefully (error, not crash). |
| `exportedAt` | `i64` | ✅ | Milliseconds since Unix epoch. Informational only — never used to override internal timestamps. |
| `note` | `string \| null` | ❌ | Free-form one-liner. Trimmed on import; empty/whitespace normalized to absent. Max 500 chars recommended. |
| `traits` | `object` | ✅ | The persona traits object. Must be a JSON object (not array/null/string). |
| `expressions` | `array` | ❌ | Array of learned expression assets. Defaults to `[]` if absent. |
| `motions` | `array` | ❌ | Array of learned motion clip assets. Defaults to `[]` if absent. |

---

## `traits` Object (PersonaTraits)

```jsonc
{
  "version": 1,                       // schema version (currently 1)
  "name": "Soul",                     // display name (max 60 chars)
  "role": "TerranSoul companion",     // one-line archetype (max 80 chars)
  "bio": "A curious AI companion...", // free-form biography (max ~500 chars rendered)
  "tone": ["warm", "concise"],        // tone descriptors (max 8 rendered)
  "quirks": ["says 'indeed'"],        // catchphrases / habits (max 8 rendered)
  "avoid": ["medical advice"],        // hard "don't" list (max 8 rendered)
  "exampleDialogue": [                // example exchanges (max 4 rendered)
    "User: How are you? / Assistant: Splendid!"
  ],
  "active": true,                     // whether persona block is injected
  "updatedAt": 1700000000000          // ms epoch, last edit
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | `u32` | ✅ | Currently `1`. Future migrations bump this. |
| `name` | `string` | ✅ | Identity name the LLM uses for itself. |
| `role` | `string` | ✅ | One-line role / archetype description. |
| `bio` | `string` | ✅ | Free-form biography paragraph. |
| `tone` | `string[]` | ✅ | Tone/style descriptors. |
| `quirks` | `string[]` | ✅ | Habits, catchphrases. |
| `avoid` | `string[]` | ✅ | Hard constraints (things the persona must never do). |
| `exampleDialogue` | `string[]` | ❌ | Example dialogue lines (added in traits v1.1). Defaults to `[]`. |
| `active` | `boolean` | ✅ | Whether to inject into the system prompt. |
| `updatedAt` | `i64` | ✅ | Milliseconds since epoch; set on save. |

**Extensibility:** Unknown keys in `traits` are preserved on round-trip.
Consumers must not reject packs containing unrecognized keys — they are
forward-compatible additions from newer versions.

---

## Asset: Learned Expression

```jsonc
{
  "id": "lex_smug",                   // [A-Za-z0-9_-]{1,128}
  "kind": "expression",               // must be "expression"
  "name": "Smug",                     // human-readable display name
  "trigger": "smug",                  // LLM trigger key
  "weights": { "happy": 0.4 },        // VRM expression preset → weight (0–1)
  "lookAt": { "x": 0.5, "y": 0.3 },  // optional gaze direction (normalized)
  "blink": 0.1,                       // optional eyelid weight (0–1)
  "learnedAt": 1700000000000          // ms epoch
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `id` | `string` | ✅ | `[A-Za-z0-9_-]{1,128}`. Must be unique within the array. |
| `kind` | `"expression"` | ✅ | Literal discriminator. |
| `name` | `string` | ✅ | Human-readable label. |
| `trigger` | `string` | ✅ | Key the LLM emits to invoke this expression. |
| `weights` | `Record<string, number>` | ✅ | VRM expression preset name → blend weight (0–1). |
| `lookAt` | `{ x: number, y: number }` | ❌ | Gaze direction in normalized screen coordinates. |
| `blink` | `number` | ❌ | Eyelid weight (0 = open, 1 = closed). |
| `learnedAt` | `i64` | ✅ | Ms epoch when captured. |

---

## Asset: Learned Motion Clip

```jsonc
{
  "id": "lmo_shrug",                  // [A-Za-z0-9_-]{1,128}
  "kind": "motion",                   // must be "motion"
  "name": "Shrug",                    // human-readable label
  "trigger": "shrug",                 // LLM trigger key
  "fps": 30,                          // frames per second
  "duration_s": 1.0,                  // clip length in seconds
  "frames": [
    {
      "t": 0.0,                       // timestamp in seconds since clip start
      "bones": {
        "spine": [0.1, 0.0, 0.0],    // Euler XYZ radians
        "leftShoulder": [0.0, 0.0, 0.3]
      }
    }
  ],
  "learnedAt": 1700000000000,
  "provenance": "generated"           // optional: "generated" | "camera"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `id` | `string` | ✅ | `[A-Za-z0-9_-]{1,128}`. Must be unique within the array. |
| `kind` | `"motion"` | ✅ | Literal discriminator. |
| `name` | `string` | ✅ | Human-readable label. |
| `trigger` | `string` | ✅ | Key the LLM emits to play this clip. |
| `fps` | `number` | ✅ | Frames per second (typically 24 or 30). |
| `duration_s` | `number` | ✅ | Total duration in seconds. |
| `frames` | `array` | ✅ | Ordered array of keyframes. |
| `frames[].t` | `number` | ✅ | Timestamp in seconds, monotonically increasing. |
| `frames[].bones` | `Record<string, [x,y,z]>` | ✅ | Bone name → Euler XYZ radians (±0.5 max). |
| `learnedAt` | `i64` | ✅ | Ms epoch when captured/generated. |
| `provenance` | `string` | ❌ | `"generated"` (LLM-as-Animator) or `"camera"` (mirror capture). Absent for older clips. |

**Valid bone names:** `head`, `neck`, `spine`, `chest`, `hips`,
`leftUpperArm`, `rightUpperArm`, `leftLowerArm`, `rightLowerArm`,
`leftShoulder`, `rightShoulder`.

---

## Versioning Contract

### `packVersion` Semantics

| Value | Meaning |
|---|---|
| `1` | Current stable version. All fields documented above. |
| `> current` | **Rejected** at parse time with a clear error message. The user must upgrade TerranSoul to import this pack. |

### Compatibility Rules

1. **Additive-only within a version.** New optional fields may appear in any
   object at any time. Readers must ignore unknown keys (never reject).
2. **Breaking changes bump `packVersion`.** Removing a required field,
   changing a field's type, or altering import semantics = new version.
3. **Forward-compatibility.** A reader at version N can read packs at
   version ≤ N. It must reject version > N with a human-readable error.
4. **Backward-compatibility.** A writer at version N always writes version N.
   It does not downgrade. Older readers reject gracefully.

### Import Semantics

| Aspect | Behavior |
|---|---|
| `traits` | **Replaced** wholesale — all existing trait fields overwritten. |
| `expressions` | **Merged** — matching IDs overwrite; non-matching IDs in the store are preserved. |
| `motions` | **Merged** — same as expressions. |
| Invalid assets | **Skipped** (logged in `ImportReport.skipped`, max 32 messages). Import continues. |
| `exportedAt` | Informational only. Internal `learnedAt` / `updatedAt` timestamps are preserved as-is from the pack. |

### Size Limits

| Limit | Value | Enforcement |
|---|---|---|
| Total payload | 1 MiB | Hard reject at parse time |
| Asset ID length | 128 chars | Validated per asset |
| Asset ID charset | `[A-Za-z0-9_-]` | Regex validated |
| Skip messages | 32 max | Truncated with "…and N more" |
| Note length | Unbounded (500 chars recommended) | Trimmed, blank → absent |

---

## Example: Minimal Valid Pack

```json
{
  "packVersion": 1,
  "exportedAt": 1714600000000,
  "traits": {
    "version": 1,
    "name": "Soul",
    "role": "TerranSoul companion",
    "bio": "",
    "tone": [],
    "quirks": [],
    "avoid": [],
    "active": true,
    "updatedAt": 1714600000000
  }
}
```

## Example: Full-Featured Pack

```json
{
  "packVersion": 1,
  "exportedAt": 1714600000000,
  "note": "My custom librarian persona with trained expressions",
  "traits": {
    "version": 1,
    "name": "Lia",
    "role": "studious librarian",
    "bio": "A quiet bookworm who speaks in measured, precise prose.",
    "tone": ["warm", "precise", "slightly formal"],
    "quirks": ["ends sentences with 'indeed'", "references obscure books"],
    "avoid": ["slang", "unsolicited medical advice"],
    "exampleDialogue": [
      "User: What should I read next? / Assistant: That depends entirely on whether you seek comfort or challenge. Indeed, both have their merits."
    ],
    "active": true,
    "updatedAt": 1714600000000
  },
  "expressions": [
    {
      "id": "lex_curious_tilt",
      "kind": "expression",
      "name": "Curious tilt",
      "trigger": "curious",
      "weights": { "surprised": 0.3, "happy": 0.2 },
      "lookAt": { "x": 0.6, "y": 0.4 },
      "learnedAt": 1714500000000
    }
  ],
  "motions": [
    {
      "id": "lmo_page_turn",
      "kind": "motion",
      "name": "Page turn gesture",
      "trigger": "page-turn",
      "fps": 30,
      "duration_s": 0.8,
      "frames": [
        { "t": 0.0, "bones": { "rightUpperArm": [0.0, 0.0, -0.2] } },
        { "t": 0.4, "bones": { "rightUpperArm": [0.1, 0.0, -0.3], "rightLowerArm": [-0.2, 0.0, 0.0] } },
        { "t": 0.8, "bones": { "rightUpperArm": [0.0, 0.0, -0.2] } }
      ],
      "learnedAt": 1714500000000,
      "provenance": "generated"
    }
  ]
}
```

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-02 | Initial stable schema v1 published. |
