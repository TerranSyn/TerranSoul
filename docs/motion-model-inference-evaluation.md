# Motion Model Inference Evaluation

> Optional Chunk 14.16g deliverable, completed 2026-05-02. This note evaluates
> whether TerranSoul should add MotionGPT / T2M-GPT ONNX inference now. It does
> not add `ort`, CUDA, Python, model downloads, SMPL assets, or new runtime
> dependencies.

## Decision

Do not add bundled MotionGPT / T2M-GPT inference to TerranSoul yet.

TerranSoul should keep the current product path:

- `src-tauri/src/persona/motion_clip.rs` parses and validates LLM-generated
  `LearnedMotion` JSON clips.
- `src-tauri/src/commands/persona.rs::generate_motion_from_text` asks the
  configured brain to generate previewable motion clips.
- `src-tauri/src/persona/motion_tokens.rs` provides a feature-gated,
  deterministic MotionGPT-style token codec for research and prompt vocabulary
  experiments.
- `src/renderer/vrma-baker.ts` and `src/renderer/learned-motion-player.ts`
  already turn accepted `LearnedMotion` frames into playable VRM animation.

The optional neural motion-model path should remain a sidecar-only future
direction until a model artifact is available that is license-clean, checksummed,
documented, and emits either TerranSoul's VRM 11-bone frame contract or an
adapter-free motion-token contract that `motion_tokens.rs` can decode.

## Local Probe

The workstation can satisfy the GPU class requirement, but not a full model
runtime by itself:

| Check | Result |
|---|---|
| `nvidia-smi` | Present |
| GPU | NVIDIA GeForce RTX 3080 Ti |
| VRAM | 12,288 MiB |
| Driver | 560.94 |
| `nvcc` | Missing |
| Rust `ort` dependency | Not present |

This means a GPU-gated proof of concept is possible later, but adding `ort` now
would only create a runtime wrapper with no verified model contract to run.

## Candidate Matrix

| Candidate | License/runtime posture | Output fit | Verdict |
|---|---|---|---|
| Current LLM motion generator | In-repo Rust + existing brain providers | Direct `LearnedMotion` JSON | Keep as default |
| Current motion-token codec | In-repo Rust behind `motion-research`; no learned codebook | Encodes/decodes VRM-ish token frames | Keep as research seam |
| MotionGPT | MIT code, but README notes dependencies on SMPL, SMPL-X, PyTorch3D, and datasets with separate licenses | Motion-language model / SMPL-family motion pipeline | Do not bundle; sidecar research only |
| T2M-GPT | Apache-2.0 code, but research stack uses Python 3.8, PyTorch 1.8.1, HumanML3D/KIT-ML assets, pretrained scripts, and optional SMPL rendering | Text -> HumanML3D motion representation; not direct VRM frames | Do not bundle; sidecar research only |
| `ort` crate in Rust | Reasonable future ONNX runtime option | Needs a real exported ONNX model and stable tensor contract | Defer until model artifact exists |

## Why Not Add `ort` Now

Adding an ONNX runtime without a validated model would give TerranSoul the cost
of a heavy native dependency without a functional user feature. The missing piece
is not inference plumbing; it is a clean model contract:

- model license and source;
- checksum and versioned download URL;
- input tensor schema;
- output tensor schema;
- skeleton definition;
- retarget mapping to TerranSoul's canonical VRM bones;
- proof that no SMPL/SMPL-X runtime/data license is required for app use.

The repo already has the safer primitive: deterministic token encode/decode and
LLM-generated `LearnedMotion` clips. That gives users a working motion generator
without shipping model weights or SMPL-family dependencies.

## Future Sidecar Contract

If a model becomes viable, it should be integrated as a sidecar with a manifest,
not a hardwired in-process dependency:

```text
MotionModelBackend.probe(manifest) -> MotionModelStatus
MotionModelBackend.generate(request) -> MotionModelResult
```

Manifest fields:

```text
model_id
model_name
model_version
model_license
model_source_url
model_sha256
runtime: onnx | torch | external-command
requires_gpu: boolean
requires_smpl: boolean
input_schema
output_schema
target_skeleton: terransoul-vrm-11 | smpl-23 | humanml3d | motion-tokens
adapter_version?
```

Request shape:

```text
description: string
duration_s: number
fps: number
target_bones: string[]
quality_mode: fast | balanced | high
```

Result shape:

```text
motion: LearnedMotion
diagnostics: {
  backend: string
  elapsed_ms: number
  model_sha256: string
  adapter: string
  warnings: string[]
}
```

The sidecar can be user-facing only if it returns `LearnedMotion` frames that
pass the same parser and preview-before-save flow as `generate_motion_from_text`.

## Acceptance Gates

Before any MotionGPT / T2M-GPT-class backend lands in code, it must satisfy:

| Gate | Requirement |
|---|---|
| License | Code, model, dataset-derived artifacts, and skeleton assets are compatible with TerranSoul distribution |
| Artifact | Versioned model file has a stable URL and SHA-256 checksum |
| Runtime | Works from a local sidecar or feature-gated dependency without breaking default builds |
| Output | Emits `LearnedMotion` or deterministic `motion_tokens` that decode to canonical VRM bones |
| Fallback | Missing model/GPU cleanly falls back to the existing LLM generator |
| Preview | User can preview, accept, discard, and record feedback exactly like generated motions |
| Quality | Exceeds the LLM generator on smoothness or expressiveness in A/B tests |
| Privacy | No cloud call and no hidden training/upload path |

## Rejected For 14.16g

- Adding `ort` before a verified ONNX model exists.
- Vendoring MotionGPT or T2M-GPT Python source into the Tauri app.
- Downloading SMPL/SMPL-X, HumanML3D, KIT-ML, or evaluator assets as part of
  normal app setup.
- Treating a generated SMPL mesh/render as a reusable VRM animation without a
  validated retarget step.
- Hiding model downloads behind the existing LLM motion generator.

## Sources Checked

- TerranSoul `motion_clip`, `motion_tokens`, `generate_motion_from_text`,
  `retarget`, `vrma-baker`, and learned-motion player seams.
- Local GPU probe: RTX 3080 Ti, 12 GB VRAM, `nvidia-smi` present, `nvcc`
  missing.
- MotionGPT README and LICENSE: MIT code; separate SMPL/SMPL-X/PyTorch3D/data
  license obligations.
- T2M-GPT README and LICENSE: Apache-2.0 code; Python/PyTorch research stack,
  HumanML3D/KIT-ML assets, pretrained-model scripts, optional SMPL rendering.