# Neural Audio-To-Face Upgrade Evaluation

> Chunk 27.6 deliverable, completed 2026-05-02. This is a research and
> backend-boundary note only. No NVIDIA, ONNX, TensorRT, Python, model-weight,
> or cloud dependency is added by this chunk.

## Decision

Keep TerranSoul's shipped phoneme-aware viseme path as the default lip-sync
system. It is fast, local, model-free, covered by tests, and already integrates
with the avatar render loop:

- `src/renderer/phoneme-viseme.ts` maps text -> approximate grapheme/phoneme
  viseme timeline when TTS text and duration are known.
- `src/renderer/lip-sync.ts` provides Web Audio FFT / RMS fallback when text or
  duration is unavailable.
- `src/workers/audio-analyzer.worker.ts` keeps FFT analysis off the main thread
  when workers are available.
- `src/composables/useLipSyncBridge.ts` prioritizes the phoneme scheduler and
  falls back to FFT analysis for browser-synth or unknown-duration audio.
- `src/renderer/avatar-state.ts` keeps the facial output contract intentionally
  small: five VRM visemes (`aa`, `ih`, `ou`, `ee`, `oh`) plus blink/look-at and
  emotion layers.

Do not replace this default path with a neural model in the app bundle.

The only viable future upgrade is an **optional local Audio2Face-3D sidecar**
for users with compatible NVIDIA hardware who explicitly opt in, accept the
model license, and install CUDA/TensorRT prerequisites. The sidecar must return
TerranSoul-native facial frames that can degrade to the same five VRM visemes.
It must never silently call a cloud service and must never be required for
normal TTS lip sync.

FaceFormer and EmoTalk remain research references, not implementation targets,
because their public artifacts are mesh/dataset oriented and do not provide a
clean, maintained, VRM-blendshape-ready local runtime.

## Current Baseline

| Layer | File | Behavior | Keep |
|---|---|---|---|
| Text scheduler | `src/renderer/phoneme-viseme.ts` | Tokenizes English graphemes/digraphs and builds a timed 5-viseme curve | Yes, default |
| Audio fallback | `src/renderer/lip-sync.ts` | Uses Web Audio RMS/FFT to produce 2- or 5-channel mouth weights | Yes, fallback |
| Worker fallback | `src/workers/audio-analyzer.worker.ts` | Computes RMS and band energies off-thread | Yes |
| Bridge | `src/composables/useLipSyncBridge.ts` | Routes TTS audio into phoneme scheduler first, FFT second | Yes |
| Avatar contract | `src/renderer/avatar-state.ts` | Applies visemes only while body state is `talk` | Yes |

The key product advantage is determinism. The shipped path has no model
download, no license click-through, no GPU requirement, and no privacy question:
it only processes the assistant's local TTS audio/text already being played.

## Candidate Matrix

| Candidate | License/runtime posture | Output fit | Verdict |
|---|---|---|---|
| Shipped phoneme scheduler + FFT fallback | In-repo TypeScript, no extra dependency | Direct five-channel VRM visemes | Default path |
| NVIDIA Audio2Face-3D SDK | MIT SDK; Windows/Linux; CUDA 12.8+, TensorRT 10.13+, NVIDIA GPU, 4 GB+ VRAM recommended; 10 GB storage class setup | Facial pose / motion arrays that need a model-specific adapter to VRM visemes/blendshapes | Best optional local sidecar candidate |
| NVIDIA Audio2Face-3D v2.3/v3.0 models | NVIDIA Open Model License; Hugging Face model cards say commercial/non-commercial use; TensorRT runtime | Facial motion over skin, tongue, jaw, and eyes | Potentially viable after license UI and hardware probe |
| NVIDIA Audio2Emotion | Gated license, contact-info acceptance, restricted to Audio2Face project, prohibits standalone emotion recognition | Emotion probabilities, not mouth shapes | Do not use by default; only as part of an explicit Audio2Face stack if ever needed |
| NVIDIA ACE cloud / Unreal / Maya plugins | Product/plugin ecosystem, not a TerranSoul-native runtime | Engine/DCC-specific outputs | Do not integrate as hidden dependency |
| FaceFormer | MIT code, but 2022 research repo; Ubuntu/Python 3.7/PyTorch 1.9; VOCASET/BIWI/FLAME mesh topology; pretrained weights via drive links | 3D mesh vertices, not VRM blendshapes | Research reference only |
| EmoTalk | ICCV 2023 paper; GitHub repository search did not find a clear public implementation; 3D emotional talking-face dataset/licensing unclear | Emotional 3D face animation concept | Research reference only |

## Why The Default Stays Model-Free

- TerranSoul needs a dependable per-frame mouth signal in the same render loop
  as VRM animation. A model that stalls setup, requires a GPU, or needs a
  license prompt cannot be the default speaking path.
- The shipped scheduler already improves over pure band-energy lip sync by using
  known TTS text and audio duration when available.
- Most neural systems output mesh vertices, dense facial poses, or engine-specific
  blendshape sets. TerranSoul's safe common denominator is five VRM visemes;
  advanced rigs can opt into extra ARKit-like channels separately.
- Audio2Face-3D is promising, but its own setup documents require CUDA,
  TensorRT, model conversion/download, and NVIDIA hardware. That belongs behind
  a capability gate, not the default app path.

## Optional Backend Boundary

A future implementation should introduce a backend-neutral contract rather than
wiring Audio2Face directly into Vue components:

```text
AudioFaceBackend.prepare(config) -> BackendStatus
AudioFaceBackend.infer(request) -> AudioFaceResult
```

Input should be local, explicit, and minimal:

```text
AudioFaceRequest
  audio_pcm_16k_mono: Float32Array | file path to local wav
  text?: string
  duration_s: number
  target_contract: "vrm-5-viseme" | "arkit-52" | "backend-native"
  allow_emotion_model: boolean
```

Output must be convertible to existing avatar state:

```text
AudioFaceResult
  frames: Array<{
    t: number
    viseme: { aa: number, ih: number, ou: number, ee: number, oh: number }
    expressions?: Record<string, number>
    blink?: number
    lookAt?: { x: number, y: number }
  }>
  backend_metadata: {
    backend: string
    model: string
    model_license: string
    model_checksum: string
    runtime: string
    elapsed_ms: number
  }
  warnings: string[]
```

The renderer consumes the result through the same `AvatarStateMachine.setViseme`
path. If a result includes rig-specific blendshapes, those channels must go
through a probe-before-set helper like `applyExpandedBlendshapes`, never through
assumptions about a particular VRM authoring style.

## UX And Safety Requirements

- Default setting remains `phoneme + FFT fallback`.
- Neural lip sync is a visible advanced setting, disabled until hardware and
  model checks pass.
- First use shows model name, license, size, source, checksum, runtime, and the
  fact that inference is local-only.
- No remote/cloud fallback is allowed without a separate explicit cloud opt-in.
- If the sidecar fails, returns late, or produces invalid frames, playback falls
  back to the shipped scheduler for that utterance.
- Audio2Emotion-class emotion inference is off unless the user explicitly
  enables it as part of the Audio2Face stack. It must not be used as a general
  emotion-recognition feature.
- Generated facial frames are transient by default. Persisting them as assets
  needs an explicit user save action and provenance metadata.

## Acceptance Gate For A Future Sidecar

Before a neural backend becomes user-facing, it must surpass the current baseline
without hurting reliability:

| Metric | Required gate |
|---|---|
| Startup | Backend status probe completes without blocking chat startup |
| Runtime | Full utterance facial frames generated faster than real time on supported hardware |
| First usable frame | Available early enough to avoid visible mouth lag, or baseline scheduler starts immediately until neural frames arrive |
| Quality | Side-by-side preview is at least as intelligible as the phoneme scheduler for common English sentences |
| Stability | No jitter spikes above configured viseme delta threshold after smoothing |
| Rig compatibility | Stock VRM 1.0 rigs receive valid five-viseme output; advanced rigs are optional |
| Privacy | Local audio only; no live microphone or remote service by default |
| Licensing | Model license, checksum, source, and user acceptance are recorded |

## Rejected For 27.6

- Adding `ort`, TensorRT, CUDA, NVIDIA SDKs, Python environments, or model
  downloads to the main bundle.
- Replacing the shipped phoneme scheduler with a neural-only path.
- Integrating NVIDIA ACE cloud services or Unreal/Maya plugins as app runtime
  dependencies.
- Using Audio2Emotion as a standalone emotion detector.
- Training FaceFormer/EmoTalk-style models on bundled datasets.

## Sources Checked

- TerranSoul `phoneme-viseme`, `lip-sync`, `audio-analyzer.worker`,
  `useLipSyncBridge`, and `avatar-state` implementation and tests.
- NVIDIA ACE for Games / Audio2Face-3D SDK documentation and repository:
  MIT SDK, CUDA/TensorRT setup, Windows/Linux, 4 GB+ VRAM recommendation.
- NVIDIA Audio2Face-3D v2.3/v3.0 Hugging Face model cards: NVIDIA Open Model
  License, TensorRT runtime, commercial/non-commercial use, facial pose output.
- NVIDIA Audio2Emotion v3.0 model card: gated custom license, Audio2Face-only
  use, and no standalone emotion-recognition use.
- FaceFormer README and LICENSE: MIT code, research mesh topology, VOCASET/BIWI
  data, PyTorch/Ubuntu setup.
- EmoTalk arXiv paper: emotion-disentangled audio-conditioned 3D face animation;
  no clear public repository found in GitHub searches during this spike.