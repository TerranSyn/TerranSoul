# ADR 013 — VTuber mode (MediaPipe + Kalidokit live motion capture)

**Status:** Accepted  
**Date:** 2026-06 (Spec 019)  
**Source:** `src/renderer/vtuber-capture.ts`, `src/components/VTuberCapture.vue`  
**Reference:** github.com/xianfei/SysMocap (MIT) — design reference, no code copied

---

## Context

TerranSoul's VRM avatar normally runs on procedural idle animation + LLM-driven
motion tokens. VTuber mode adds a third animation source: **the user's own
webcam**, driving the avatar in real time.

Requirements:
- No native binaries; must run inside Tauri's WebView2
- Single npm package (already installed as a dependency)
- Full body + face tracking (not just face)
- User can see the camera skeleton overlay and toggle it off
- Captured movements can optionally be learned into the animation library

## Decision

Use `@mediapipe/tasks-vision` (already installed) for pose and face landmark
detection, and `kalidokit` (MIT, 400 loc) for landmark → VRM bone rotation
conversion.

## Pipeline

```
Webcam stream (getUserMedia)
  │
  ├── PoseLandmarker.detectForVideo()   → 33 body landmarks
  └── FaceLandmarker.detectForVideo()   → 478 face mesh points
        │
        ├── Kalidokit.Pose.solve()      → { Hips, LeftUpperArm, … } Euler angles
        └── Kalidokit.Face.solve()      → { blinkLeft, blinkRight, aa, … }
              │
              emit('frame', bones, blendShapes)
              │
              CharacterViewport.onVtuberFrame()
              │
              PoseAnimator.applyFrame({ bones, expression, duration_s: 0.05 })
              │
              Three.js VRM mixer applies bone rotations at 60 fps
```

## Why `@mediapipe/tasks-vision` over older `@mediapipe/holistic`

- `@mediapipe/holistic` is deprecated by Google; last release was 2022.
- `tasks-vision` is the active maintained successor with separate
  `PoseLandmarker` and `FaceLandmarker` tasks.
- `tasks-vision` is **already in package.json** — no new dependency.
- VIDEO mode (`detectForVideo`) gives synchronous per-frame results,
  fitting cleanly into a `requestAnimationFrame` loop.

## Why kalidokit

- 400 lines of MIT code; does exactly one thing (landmark → bone rotations).
- Well-validated by the VTuber community against a wide range of VRM rigs.
- No peer dependencies.

The library's TypeScript types are incomplete (the `runtime: 'mediapipe'` option
object is typed as a narrow union). Calls are cast to `any` in `vtuber-capture.ts`
with explicit comments — acceptable for a 400-line well-tested library.

## Camera bones toggle

The "📷 Bones" pill button in `VTuberCapture.vue` toggles the canvas overlay
that draws the MediaPipe skeleton on top of the camera feed. This mirrors
SysMocap's show/hide camera UI and lets users disable the camera preview
while keeping the avatar driving active.

## Responsive layout

- **Mobile (≤ 640px):** full-width panel at the bottom of the viewport with
  camera expanding to fill the screen.
- **Desktop (≥ 641px):** compact side-by-side split — camera + controls occupy
  the bottom-right corner.

## Learn from owner

When `vtuber_learn_from_owner = true` (default), captured bone frames are
sampled at ~3 fps and committed at session end via `animation_batch_learn_vtuber`,
creating a `MotionCapture`-tagged animation in the studio library. The user
can review and promote these clips to the charisma codebook.

## Related ADRs

- [ADR 006](006-vrm-avatar-and-motion-pipeline.md) — the layered blending stack where VTuber fits
- [ADR 004](004-brain-driven-self-improvement.md) — learn-from-owner feeds the brain, not hardcoded
