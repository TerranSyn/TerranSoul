# LLM-Driven 3D Animation — Research & Taxonomy (Chunk 14.16a)

> **Status.** Research-only deliverable for Chunk 14.16a. No code
> changes. Provides the foundation for downstream sub-chunks
> 14.16b–14.16f (LLM-as-animator, motion library, retarget, self-improve
> loop, marketplace).

---

## 1. Problem statement

TerranSoul ships a VRM character that today plays one of:

1. Pre-baked **VRMA clips** (`public/animations/*.vrma`) selected by the
   intent classifier or stream tags.
2. Procedural **idle / breathing / blink** animations driven by
   `IdleAnimator`.
3. **Lip-sync visemes** computed from TTS audio.
4. **Webcam Master-Mirror** (Chunk 14.7) — full-body retarget from
   BlazePose landmarks to VRM bones.

What's missing: **novel** motion. When the brain says "Alice tilts her
head curiously," there's no clip for "tilts her head curiously" and the
fallback is either a static idle or the closest pre-baked emote — both
break presence.

Goal: the brain generates context-aware 3D animation in real time. The
self-improve system discovers, learns, and refines new patterns
autonomously without human re-authoring.

---

## 2. State-of-the-art techniques

A non-exhaustive survey of techniques applicable to a Vue + WebGL
desktop app talking to a local Ollama daemon.

### 2.1 Comparison matrix

| # | Technique | Reference | Output | Inference latency | Model size | Quality | License |
|---|---|---|---|---|---|---|---|
| 1 | **MotionGPT** | Jiang et al. 2024 (NeurIPS) | text -> motion-token sequence -> SMPL-family / dataset motion representation | Python research runtime; ONNX/export path not app-ready | model/download based | ⭐⭐⭐⭐ | MIT code; SMPL/SMPL-X/PyTorch3D/data licenses separate |
| 2 | **MotionDiffuse** | Zhang et al. 2022 | text → diffusion → joint angle frames | ~1 s / 60-frame clip on GPU; 5–10 s on CPU | ~400 MB | ⭐⭐⭐⭐⭐ | Apache-2.0 (code) |
| 3 | **MoMask** | Guo et al. 2024 | masked motion generation/inpainting; useful reference for motion reconstruction, but its public runtime is text/prompt or HumanML3D-feature oriented rather than direct BlazePose -> VRM | CPU WebUI exists; app-side sidecar still unproven | model-download based | ⭐⭐⭐⭐ | MIT code; third-party model/data/SMPL-family licenses must be audited |
| 4 | **AI4Animation MANN** | Holden et al. 2020 | mode-adaptive neural network, expert blending | ~5 ms / frame | ~50 MB | ⭐⭐⭐ | MIT |
| 5 | **T2M-GPT** | Zhang et al. 2023 | VQ-VAE motion tokens + GPT-2 decoder | Python 3.8 / PyTorch 1.8.1 research stack; model artifact not app-ready | pretrained downloads + dataset stats | ⭐⭐⭐⭐ | Apache-2.0 code; HumanML3D/KIT/SMPL assets separate |
| 6 | **LLM-as-animator** (novel) | TerranSoul-internal | structured JSON pose tags from chat LLM | shares chat latency (~free) | 0 (reuses chat model) | ⭐⭐⭐ | n/a — pure prompting |
| 7 | **HunyuanVideo / Hunyuan-Motion-class** | Tencent 2024-2026 | text/image/video-conditioned diffusion -> rendered video or motion reference | 45-60 GB+ VRAM class for open HunyuanVideo models | very large | ⭐⭐⭐⭐⭐ | Tencent community/model license; not bundled |
| 8 | **PriorMDM** | Tevet et al. 2024 | motion-prior diffusion conditioned on a sparse-pose prior | ~2 s / clip on CPU | ~300 MB | ⭐⭐⭐⭐ | MIT |
| 9 | **MotionBERT-Lite** | Zhu et al. 2023 | 2D skeleton sequence -> 3D pose / mesh representation | sidecar only; 243-frame window max per README | ~61 MB lite checkpoint | ⭐⭐⭐⭐ | Apache-2.0 code |

### 2.2 Categorisation

The eight techniques split cleanly into four families:

1. **LLM-as-animator (zero extra model).** Reuse the existing chat LLM
   to emit structured pose data alongside text. Free, zero install
   weight, low quality but zero-friction. **Best fit for the v1
   chunk.**

2. **Token-based generative (small model).** T2M-GPT and the codebook
   half of MotionGPT. ~50 MB extra weight, fast CPU inference, output
   is a discrete token sequence the brain can interleave with chat.

3. **Diffusion-based (large model).** MotionDiffuse, Hunyuan-Motion,
   PriorMDM. Best quality, but only viable on GPU machines and only
   for offline polish (precompute high-quality clips into the
   `LearnedMotion` library — see 14.16d).

4. **Continuous control (recurrent).** AI4Animation MANN. ~5 ms /
   frame, but trained per-character — not directly applicable
   without re-training, so we treat MANN as a research reference,
   not a shipping dependency.

---

## 3. VRM bone-mapping strategy

VRM exposes ~55 bones, but only **11** are needed for expressive
upper-body animation. The same 11 are already used by Master-Mirror
(Chunk 14.7) — keep them as the canonical contract.

| Group | Bone (Three.js / VRM) | Master-Mirror? | LLM-animator? | Token codec? |
|---|---|---|---|---|
| Head | `head` | ✅ | ✅ | ✅ |
| Head | `neck` | ✅ | ✅ | ✅ |
| Spine | `spine` | ✅ | ✅ | ✅ |
| Spine | `chest` | ✅ | ✅ | ✅ |
| Hips | `hips` | ✅ | ✅ | ✅ |
| Arms | `leftUpperArm` | ✅ | ✅ | ✅ |
| Arms | `rightUpperArm` | ✅ | ✅ | ✅ |
| Arms | `leftLowerArm` | ✅ | ✅ | ✅ |
| Arms | `rightLowerArm` | ✅ | ✅ | ✅ |
| Shoulders | `leftShoulder` | ✅ | ✅ | ✅ |
| Shoulders | `rightShoulder` | ✅ | ✅ | ✅ |
| Legs | `leftUpperLeg`, `rightUpperLeg`, `leftLowerLeg`, `rightLowerLeg` | partial | ❌ (v1) | ❌ (v1) |
| Hands | finger bones | ❌ | ❌ | ❌ |
| Face | blendshapes (52) | ❌ | optional `expression` | ❌ |

**Why not legs / hands in v1?** Locomotion (legs) needs IK and root-
motion; hands need finger IK or curl presets. Both are doable in
later sub-chunks (14.16e/f), but they double the prompt token count
and the failure surface. v1 keeps to the upper body.

**Coordinate system.** Right-handed, Y-up, Euler XYZ in radians.
Range: ±0.5 rad per bone (about 28°). Larger values produce
non-anatomical poses and the `PoseAnimator` must clamp.

---

## 4. Latency budget

The chat pipeline already has ~600 ms of speech-to-render latency
(LLM stream + TTS + viseme sync). Animation generation must fit
inside that envelope without adding perceptible lag.

| Sub-chunk | Technique | Per-frame budget | Per-clip budget |
|---|---|---|---|
| 14.16b | LLM-as-animator (in-stream pose tags) | n/a (interpolated) | shares chat tokens (free) |
| 14.16c | Motion library (offline LLM clip generation) | n/a — precomputed | <2 s for 2 s clip is fine |
| 14.16d | Diffusion polish (background job) | n/a | 5–30 s acceptable |
| 14.16e | T2M-GPT token brain capability | <250 ms / clip | <250 ms / clip |
| 14.16f | Self-improve loop | offline, batched | hours |

**Hard floor.** 14.16b must add **zero** measurable latency to the
chat stream — pose tags are interleaved with text and parsed
incrementally by `StreamTagParser`.

---

## 5. Recommended implementation order

| Order | Sub-chunk | Risk | Effort | User-visible benefit |
|---|---|---|---|---|
| 1 | **14.16b LLM-as-animator** | low | M | Immediate — every chat turn can emit a pose |
| 2 | **14.16c Motion library** | low | M | Reusable named clips ("/wave", "/bow") |
| 3 | **14.16d Offline diffusion polish** | medium | L | High-quality motion library backed by Hunyuan / MotionDiffuse |
| 4 | **14.16e T2M-GPT brain capability** | medium | L | Capability gate — opt-in, ships own model |
| 5 | **14.16f Self-improve loop** | high | XL | Closes the loop: brain catalogues + reuses generated motions |

Lock step 1 first. Steps 2–5 each unlock independently and can be
shipped over multiple sessions.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| LLM emits non-anatomical poses (limbs through torso) | `PoseAnimator` clamps each bone to ±0.5 rad and applies critical-damping spring; collisions are handled by clamp not LLM smarts |
| Pose tags collide with existing `<anim>` tag stream | New `<pose>` tag, parser already extensible; covered by `StreamTagParser` tests |
| VRMA clip + LLM pose conflict | VRMA always wins (existing precedence). `PoseAnimator` yields when VRMA lock is active |
| Pose tag floods the chat stream (token waste) | System prompt instructs ≤1 `<pose>` per response; orchestrator enforces with regex truncation |
| GPU-only models (MotionDiffuse, Hunyuan) on CPU-only machines | Capability-gate them — only enabled when `gpu_acceleration` capability is granted (already exists for diffusion image gen) |
| Hard licence constraints on SMPL-X (research-only by default) | We do not ship SMPL-X. MotionGPT integration uses its own (licence-clean) motion-token codec retargeted directly to VRM 11 bones — see chunk 14.15 (already shipped) |

---

## 7. Out of scope (future work)

- **Locomotion / root motion** — needs IK + ground-contact solving;
  separate phase.
- **Finger / facial animation from LLM** — needs a per-finger /
  per-blendshape token vocabulary; separate phase.
- **Multi-character coordination** — TerranSoul has one VRM scene at
  a time; group choreography is not on the roadmap.
- **VR / AR retarget** — desktop-only for now.

---

## 7.1 Chunk 27.4 MoMask-Style Retarget Decision

Chunk 27.4 revisited the MoMask row after the geometric retargeter and
MotionGPT token codec had shipped. The detailed deliverable is
[`docs/momask-full-body-retarget-research.md`](momask-full-body-retarget-research.md).

The short version: keep TerranSoul's Rust geometric retargeter as the baseline,
do not vendor MoMask, and prototype any ML reconstruction as an optional sidecar
that consumes saved landmark frames only. MoMask remains interesting for offline
temporal inpainting or motion synthesis, but MotionBERT-Lite or MMPose
RTMPose3D-style models are a cleaner first fit for lifting 2D/normalized
BlazePose landmarks into 3D pose.

Implementation remains out of scope for 27.4. A future implementation must:

- stay disabled by default;
- never process live camera frames;
- expose model license, checksum, source, and download size before first use;
- return TerranSoul-native `VrmBonePose` / `LearnedMotion` frames;
- surpass the geometric baseline on continuity, dropout recovery, or visible pose
   quality before it becomes user-facing.

---

## 7.2 Chunk 27.5 Offline Motion Polish Decision

Chunk 27.5 evaluated Hunyuan-Motion / HunyuanVideo-class systems,
MimicMotion, and MagicAnimate as possible offline polish engines for saved
teach-session clips. The detailed deliverable is
[`docs/offline-motion-polish-research.md`](offline-motion-polish-research.md).

The decision: keep the in-repo Gaussian smoother as the first product path and
do not bundle video diffusion. TerranSoul needs reusable `LearnedMotion` bone
frames, while the named systems primarily produce rendered videos or require a
large image/video diffusion stack. They remain useful references for a future
optional sidecar, but only if that sidecar returns TerranSoul-native frames,
records model/license metadata, and uses saved artifacts only.

---

## 7.3 Chunk 27.6 Neural Audio-To-Face Decision

Chunk 27.6 evaluated the shipped lip-sync stack against Audio2Face-3D,
FaceFormer, and EmoTalk-class systems. The detailed deliverable is
[`docs/neural-audio-to-face-evaluation.md`](neural-audio-to-face-evaluation.md).

The decision: keep the existing `phoneme-viseme` scheduler plus `lip-sync` FFT
fallback as the default. Audio2Face-3D is the only plausible future neural
backend because the current SDK is MIT and the current Audio2Face-3D model cards
use the NVIDIA Open Model License, but it still requires a local NVIDIA
CUDA/TensorRT setup and a model-license flow. FaceFormer and EmoTalk remain
research references because their public surfaces are mesh/dataset oriented or
not clearly available as maintained VRM-ready runtimes.

A future backend must be sidecar-style, local-only by default, and return
TerranSoul-native facial frames that degrade to the five existing VRM visemes.

---

## 7.4 Chunk 14.16g Motion Model Inference Decision

Optional Chunk 14.16g evaluated MotionGPT / T2M-GPT inference after the
deterministic `motion_tokens` codec and LLM motion generator had shipped. The
detailed deliverable is
[`docs/motion-model-inference-evaluation.md`](motion-model-inference-evaluation.md).

The decision: do not add `ort`, Python, CUDA, model downloads, or SMPL-family
assets to TerranSoul yet. The local machine has an RTX 3080 Ti, but the upstream
model contract is the real blocker: MotionGPT and T2M-GPT have permissive code
licenses but rely on separate model, dataset, SMPL/SMPL-X, and research-runtime
assets. There is no verified, checksummed, VRM-native ONNX artifact to wire into
Rust.

TerranSoul should keep using `generate_motion_from_text` plus the
feature-gated `motion_tokens` codec. A future neural backend must be a local
sidecar with a manifest describing license, checksum, runtime, input/output
schema, skeleton contract, and fallback behavior.

---

## 8. References

1. Jiang, B. et al. *MotionGPT: Human Motion as a Foreign Language.*
   ICML 2024.
2. Zhang, M. et al. *MotionDiffuse: Text-Driven Human Motion
   Generation with Diffusion Model.* arXiv:2208.15001 (2022).
3. Guo, C. et al. *MoMask: Generative Masked Modeling of 3D Human
   Motions.* CVPR 2024.
4. Holden, D. et al. *Mode-Adaptive Neural Networks for Quadruped
   Motion Control.* SIGGRAPH 2018; carried into 2020 AI4Animation.
5. Zhang, J. et al. *Generating Human Motion from Textual Descriptions
   with Discrete Representations* (T2M-GPT). CVPR 2023.
6. Tevet, G. et al. *PriorMDM: Human Motion Diffusion as a Generative
   Prior.* ICLR 2024.
7. Tencent. *Hunyuan-Motion 1.0 Technical Report.* 2025.
8. Zhu, W. et al. *MotionBERT: A Unified Perspective on Learning Human
   Motion Representations.* ICCV 2023.
9. OpenMMLab. *MMPose Pose Estimation Toolbox.*
10. Tencent. *MimicMotion: High-Quality Human Motion Video Generation
   with Confidence-aware Pose Guidance.* 2024/2025.
11. Xu, Z. et al. *MagicAnimate: Temporally Consistent Human Image
   Animation using Diffusion Model.* 2023.
12. Stability AI. *Stable Video Diffusion 1.1 Image-to-Video Model Card.*
13. NVIDIA. *Audio2Face-3D SDK* and *Audio2Face-3D v2.3/v3.0 Model Cards.*
14. Fan, Y. et al. *FaceFormer: Speech-Driven 3D Facial Animation with
   Transformers.* CVPR 2022.
15. Peng, Z. et al. *EmoTalk: Speech-Driven Emotional Disentanglement for
   3D Face Animation.* ICCV 2023.
16. `docs/persona-design.md` § 14.7 — Master-Mirror reference for the
   11-bone VRM contract used here.
17. `docs/research-reverse-engineering.md` § 7 — earlier MANN analysis.

---

## 9. Sign-off

This document is the deliverable for **Chunk 14.16a**. It does not
mandate a final implementation choice — that's reserved for each
follow-up sub-chunk's design notes. What it does establish:

- The 11-bone upper-body contract is the canonical surface.
- LLM-as-animator (14.16b) is the v1 path because it is
  zero-install, zero-latency, and reuses the existing brain.
- Diffusion / token-based techniques are deferred to optional
  capability-gated chunks; they will not block 14.16b.
- All techniques retarget to the same 11-bone VRM rig — no separate
  skeleton format proliferation.
