# MoMask-Style Full-Body Retarget Research Spike

> Chunk 27.4 deliverable, completed 2026-05-02. This is a research and
> integration-plan note only. No model weights, Python environments, or runtime
> dependencies are vendored into TerranSoul by this chunk.

## Decision

Do not add MoMask as a bundled TerranSoul dependency yet.

The useful next architecture is an optional, explicit-user-triggered motion
reconstruction sidecar that refines saved landmark clips after recording, while
keeping the existing geometric retargeter as the default path. MoMask is worth
keeping as a candidate for text-guided inpainting or motion synthesis, but it is
not the cleanest first sparse-BlazePose-to-VRM reconstructor because its public
interfaces are centered on text-to-motion, BVH export, 22-joint motion arrays,
and HumanML3D 263D feature vectors.

The best first ML candidate for actual BlazePose lifting is MotionBERT-Lite or
an MMPose RTMPose3D-style model, behind the same sidecar interface. Both are
permissively licensed at the code level and map more directly to 2D/3D pose
estimation than MoMask does.

## Current TerranSoul Baseline

TerranSoul already has two relevant retarget seams:

| Seam | File | Contract | Role |
|---|---|---|---|
| Live browser mirror | `src/renderer/pose-mirror.ts` | 33 MediaPipe landmarks -> 11 VRM upper-body bones | Realtime, camera-session-only, no IPC frames |
| Offline Rust retarget | `src-tauri/src/persona/retarget.rs` | 33 BlazePose landmarks -> 17 VRM bones | Feature-gated `motion-research` geometric full-body baseline |

That means a future ML pass should refine or fill gaps in the saved landmark
sequence, not bypass the local privacy and learned-motion contracts.

## Candidate Matrix

| Candidate | License posture | Local runtime fit | Input/output fit | Verdict |
|---|---|---|---|---|
| Current geometric retargeter | TerranSoul code | Excellent; no new dependency | Direct 33-landmark input, 17 VRM bones | Keep as default and regression baseline |
| MoMask | MIT code; README notes SMPL, SMPL-X, PyTorch3D, and datasets have separate licenses | CPU demo exists, but reference stack is Python/PyTorch and model-download based | Outputs `(nframe, 22, 3)` joints and BVH; temporal editing expects HumanML3D 263D features | Do not bundle now; use only as optional inpainting/synthesis sidecar after adapter proof |
| MotionBERT-Lite | Apache-2.0 code | Plausible sidecar; published lite model is about 61 MB | 2D skeleton sequences in 17-joint H36M format -> 3D pose/mesh tasks | Best first ML lift candidate, after BlazePose-to-H36M remap proof |
| MMPose / RTMPose3D | Apache-2.0 code | Larger Python/OpenMMLab stack; good for experiments, heavy for app bundle | 2D/3D pose and whole-body pose toolbox | Good research harness; too heavy for default runtime |
| VideoPose3D | CC BY-NC | Local PyTorch possible | 2D keypoints -> 3D pose | Reject for bundled product due non-commercial license |

## Why MoMask Is Not The First Runtime Dependency

MoMask is strong for generating or inpainting human motion, and its code license
is permissive. The mismatch is interface shape:

- Generation starts from text prompts or prompt files, not directly from
  MediaPipe landmarks.
- Output is stored as numpy joint arrays `(nframe, 22, 3)`, rendered animation,
  or BVH. TerranSoul's learned-motion player consumes VRM bone Euler triples.
- Temporal inpainting expects a source motion in HumanML3D 263D feature format.
- The README explicitly calls out separate licenses for SMPL, SMPL-X,
  PyTorch3D, and datasets, so shipping a turnkey app integration requires a
  dependency and model-card audit beyond the MIT code license.

That makes MoMask better suited to a later offline polish or inbetweening tool:
record a rough clip, convert to HumanML3D-like features, let MoMask fill missing
or masked sections, then retarget the result back to VRM.

## Thin Integration Plan

### 1. Add a Backend Interface, Not a Model

Future code should introduce a small, model-agnostic boundary:

```rust
pub trait MotionReconstructionBackend {
    fn id(&self) -> &'static str;
    fn reconstruct(&self, request: MotionReconstructionRequest) -> Result<MotionReconstructionResult, MotionReconstructionError>;
}
```

The request should contain saved landmark frames only:

```text
fps
duration_s
frames[]: { t, landmarks[33]: { x, y, z, visibility } }
target_bones: [VRM bone names]
privacy_mode: saved_landmarks_only
```

The result should return TerranSoul-native pose frames:

```text
frames[]: { t, bones: Record<VrmBoneName, EulerTriple>, confidence? }
warnings[]
backend_metadata: { model, license, runtime, elapsed_ms }
```

No raw video or camera stream should cross this boundary.

### 2. Keep Execution Explicit And Offline

- Disabled by default.
- Only available from a saved learned-motion clip or a user-triggered polish
  action.
- Never runs during live camera mirroring.
- Requires a local sidecar or ONNX runtime health check before the UI enables the
  action.
- Must show model name, license, estimated download size, and hardware cost
  before first use.

### 3. Evaluate Against The Geometric Baseline

Use `src-tauri/src/persona/retarget.rs` as the baseline scorer. A model adapter
must surpass it on at least two of these without regressing privacy or latency:

| Metric | Measurement |
|---|---|
| Landmark dropout recovery | Hide wrists/knees/ankles in recorded fixtures and compare continuity |
| Temporal jerk | Mean frame-to-frame acceleration of bone Euler curves |
| Foot sliding | Foot displacement while foot visibility/confidence suggests contact |
| Bone completeness | Percentage of requested VRM bones returned with confidence above threshold |
| User-visible quality | Side-by-side preview preference against geometric retarget |

### 4. Recommended Prototype Order

1. Shipped in Chunk 27.4b: static saved-landmark fixtures with no camera frames
  in `persona::motion_reconstruction::static_landmark_fixtures`.
2. Shipped in Chunk 27.4b: a no-op `geometric` backend wrapper around the
  current Rust retargeter so tests exercise the future interface.
3. Prototype MotionBERT-Lite as an external sidecar: BlazePose 33 -> H36M 17 ->
   3D joints -> existing VRM retarget mapping.
4. Try MMPose RTMPose3D if MotionBERT fails on whole-body coverage.
5. Revisit MoMask for temporal inpainting only after a HumanML3D feature adapter
   can be tested without bundling SMPL-X assets.

## Acceptance Gate For A Future Implementation

- `cargo test persona::retarget` and frontend pose-mirror tests still pass.
- Sidecar disabled path is the default and does not change live mirror behavior.
- A missing sidecar produces an actionable UI message and keeps the geometric
  clip.
- Model license, model-card URL, checksum, and download source are recorded.
- Real camera privacy invariants from `docs/persona-design.md` section 5 remain
  unchanged.

## Chunk 27.4b Implementation Notes

Chunk 27.4b added the first implementation seam behind the existing
`motion-research` feature. `MotionReconstructionBackend` accepts saved landmark
frames only, exposes bundled backend metadata with `accepts_live_camera: false`,
and routes the default `geometric` backend through `retarget_pose` without
changing the live browser mirror path. The synthetic fixture clip gives future
sidecar adapters a deterministic baseline test input before any real exported
saved-motion landmarks are needed.

## Sources Checked

- MoMask project page and README: CVPR 2024 masked motion generation, CPU WebUI
  note, `(nframe, 22, 3)` joint output, BVH export, temporal inpainting with
  HumanML3D 263D input, MIT code license with separate third-party license notes.
- MotionBERT README and LICENSE: Apache-2.0 code, 17-keypoint H36M input shape,
  3D pose and mesh tasks, published lite/full model sizes.
- MMPose README and LICENSE: Apache-2.0 code, PyTorch pose toolbox with 3D and
  whole-body pose projects including RTMPose3D.
- VideoPose3D README and LICENSE: 2D-to-3D pose baseline, but CC BY-NC licensing.