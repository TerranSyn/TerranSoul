# Offline Recorded-Motion Polish Research Spike

> Chunk 27.5 deliverable, completed 2026-05-02. This is a research and
> workflow-design note only. No model weights, Python environments, Docker
> images, or video-diffusion dependencies are added by this chunk.

## Decision

Do not bundle HunyuanVideo / Hunyuan-Motion-class, MimicMotion, or
MagicAnimate-style video diffusion into TerranSoul.

TerranSoul should keep the shipped zero-phase Gaussian smoother as the default
recorded-motion cleanup path and design any future ML/video polish as an
explicit, non-destructive, user-triggered background job over saved clips. The
job may produce a preview candidate, but it must never overwrite the original
learned motion and must never run during live camera mirroring.

The near-term implementation should be a native `motion_smooth` command and UI
preview around `src-tauri/src/persona/motion_smooth.rs`, not a generative video
model. Heavy diffusion systems stay research references until there is a
license-clean, locally runnable sidecar that returns TerranSoul-native motion
frames rather than rendered video.

**Implementation progress:** Chunk 27.5b shipped the backend command and Pinia
wrapper for the native path on 2026-05-02. `polish_learned_motion(id, config)`
now reads a saved motion, returns a polished candidate plus displacement stats,
and leaves persistence to the existing explicit `save_learned_motion` accept
flow. The original clip is never overwritten by the command. Chunk 27.5c shipped
the Persona-panel polish UI on 2026-05-03: users can choose a source clip,
switch light/medium/heavy smoothing presets, compare original vs polished
playback, inspect displacement stats, and save the candidate only as a new clip.

## Current TerranSoul Baseline

TerranSoul already has a motion-polish foundation:

| Seam | File | Contract | Role |
|---|---|---|---|
| Learned motion format | `src/stores/persona-types.ts` | `LearnedMotion.frames[]` stores timestamped VRM bone Euler triples | User-facing saved clip shape |
| Native smoothing | `src-tauri/src/persona/motion_smooth.rs` | `MotionClip` -> `SmoothResult` with displacement stats | Feature-gated zero-phase Gaussian cleanup |
| Playback/baking | `src/renderer/learned-motion-player.ts`, `src/renderer/vrma-baker.ts` | `LearnedMotion` -> animation clip/playback | Preview and reuse path |
| Offline reconstruction | `src-tauri/src/persona/retarget.rs` | 33 BlazePose landmarks -> 17 VRM bones | Geometric baseline for saved clips |

This baseline is enough for the shipped polish UI before any ML integration:
duplicate a saved motion, run Gaussian smoothing with configurable strength, show
displacement stats, preview original vs polished, and save only if the user
accepts.

## Candidate Matrix

| Candidate | License/runtime posture | Output fit | Verdict |
|---|---|---|---|
| Current Gaussian smoother | In-repo Rust, no new dependency | Direct `LearnedMotion` frames | Ship first as native polish workflow |
| HunyuanVideo / Hunyuan-Motion-class | Tencent Hunyuan community/model license; 45-60 GB+ VRAM class for open video models; Linux/PyTorch/Docker-oriented | Rendered video or image-to-video, not VRM bone frames | Do not bundle; possible external renderer only |
| MimicMotion | Apache-2.0 code, but model card depends on Stable Video Diffusion; 8-16 GB+ VRAM and long runtimes; model license marked `other` on Hugging Face | Rendered character video from reference image + pose guidance | Research reference only; not a motion-frame polish backend |
| MagicAnimate | BSD-3-Clause code, requires Stable Diffusion 1.5, VAE, MagicAnimate checkpoints, CUDA/ffmpeg | Rendered human image animation | Research reference only; heavy third-party model stack |
| Stable Video Diffusion base | Stability AI community license with gated access and commercial thresholds | Short image-to-video clips | Reject as bundled dependency; license and output shape mismatch |
| Future local motion-frame model | Must be permissive and return skeleton/VRM frames | Direct `LearnedMotion` / `VrmBonePose` | Acceptable if model card, checksum, and local sidecar contract are clean |

## Why Video Diffusion Is Not The Product Path Yet

The named systems are impressive, but they solve a different problem than
TerranSoul's learned-motion library.

- They generate **pixels** or rendered character videos, while TerranSoul needs
  reusable VRM bone animation that can be blended with expressions, lip sync,
  VRMA clips, and persona-triggered motion keys.
- They are GPU-heavy. MimicMotion's README describes 8 GB minimum / 16 GB VAE
  decoder requirements and a 35 s demo taking about 20 minutes on a 4090-class
  GPU. HunyuanVideo-class models list 45-60 GB+ VRAM requirements.
- They introduce third-party model licenses beyond their code licenses. MimicMotion
  depends on Stable Video Diffusion weights; MagicAnimate depends on Stable
  Diffusion 1.5, VAE, and project checkpoints; Hunyuan models use Tencent
  community model licenses.
- They would weaken the product boundary if treated as ordinary smoothing:
  a user expects polish to preserve their saved gesture, not synthesize a new
  rendered person or video.

## Recommended Workflow

### 1. Native Polish First

Add a command over `motion_smooth::smooth_clip`:

```text
polish_learned_motion(id, config) -> MotionPolishPreview
```

The preview should include:

```text
original_motion_id
candidate_id
candidate_motion
mean_displacement_by_bone
max_displacement
warnings[]
```

The UI should show:

- original / polished preview toggle;
- smoothing strength presets: light, medium, heavy;
- displacement stats so the user can see how much changed;
- Save as new clip / replace after confirmation / discard.

Default behavior must be **Save as new clip**.

### 2. Background Task Semantics

Longer polish jobs should use the existing task/workflow event path, not block
the UI thread:

- status: queued -> running -> preview-ready -> accepted/discarded/failed;
- cancel button while running;
- progress events suitable for the mobile notification watcher;
- artifacts written under a temporary candidate path until accepted.

### 3. Non-Destructive Storage

The original learned motion remains immutable unless the user explicitly chooses
replace. A polished candidate should carry provenance:

```json
{
  "provenance": "camera",
  "polish": {
    "sourceMotionId": "lmo_...",
    "backend": "gaussian-v1",
    "createdAt": 1777699200000,
    "meanDisplacement": 0.024,
    "acceptedByUser": true
  }
}
```

This implies a future backwards-compatible `LearnedMotion` metadata extension,
not a breaking schema bump.

### 4. Optional ML Sidecar Later

If a future model is added, it should implement a model-agnostic boundary:

```text
MotionPolishBackend.polish(request) -> MotionPolishResult
```

The request contains only saved, user-confirmed artifacts:

```text
motion: LearnedMotion
optional_landmarks: saved landmark frames, if available
target: smooth | inbetween | denoise | complete_missing_bones
privacy_mode: saved_artifacts_only
```

The result must return TerranSoul-native frames, not only video:

```text
candidate_motion: LearnedMotion
confidence_by_frame?
warnings[]
backend_metadata: model, license, checksum, runtime, elapsed_ms
```

### 5. Evaluation Gate

Before any ML backend is user-facing, it must surpass the native smoother on at
least one measured dimension without damaging the others:

| Metric | Required direction |
|---|---|
| Temporal jerk | Lower than original and no worse than Gaussian medium |
| Endpoint preservation | First/last poses stay within configured tolerance |
| Semantic preservation | Motion trigger intent remains recognizable in side-by-side preview |
| Bone completeness | Missing-bone fill improves over original where landmarks exist |
| Runtime | Clear ETA; can run in background; cancel works |
| Privacy | Uses saved artifacts only; no live camera stream or raw video |

## Rejected For 27.5

- Bundling MimicMotion or MagicAnimate.
- Calling remote hosted video-generation APIs as a hidden fallback.
- Storing rendered user videos in persona packs.
- Auto-polishing every captured motion on save.
- Treating a generated video as a reusable VRM motion clip without extracting
  and validating a bone-frame sequence.

## Sources Checked

- `src-tauri/src/persona/motion_smooth.rs` — in-repo zero-phase Gaussian
  smoother and displacement stats.
- MimicMotion README, LICENSE, and Hugging Face model card — Apache-2.0 code,
  Stable Video Diffusion dependency, 8-16 GB+ VRAM class, rendered-video output.
- MagicAnimate README and LICENSE — BSD-3-Clause code, CUDA/ffmpeg, Stable
  Diffusion 1.5 / VAE / MagicAnimate checkpoint stack, rendered-video output.
- HunyuanVideo and HunyuanVideo-I2V model cards — Tencent community model
  license, 45-60 GB+ VRAM class, generated video outputs.
- Stable Video Diffusion 1.1 model card — gated access and Stability AI
  community license with commercial thresholds.