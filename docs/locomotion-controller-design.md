# Locomotion Controller Design — ConditionalFlow / FlowMatching

> ANIM-AI-11 design note. Created 2026-05-24.

## Overview

A neural locomotion controller that generates character motion frame-by-frame,
conditioned on past trajectory, guidance signals (from ANIM-AI-8 `GuidanceFeatures`),
and the current pose state. Uses Flow Matching (Lipman et al. 2023) as the generative
backbone.

## Papers

- **Flow Matching for Generative Modeling** — Lipman et al., 2023. Defines the
  conditional flow ODE that transforms noise into data samples via a learned
  velocity field.
- **DeepPhase** — Starke et al., 2022. Periodic phase features for smooth
  locomotion transitions; the phase manifold avoids foot-skating artifacts.
- **Motion Matching** — Clavet, GDC 2016. Trajectory-conditioned search over
  a motion database; our neural network replaces the database lookup.

## Architecture

```
Input:
  ┌─────────────────────────────────────┐
  │ past_trajectory (RootFeatures)       │  ← ANIM-AI-7
  │ guidance (GuidanceFeatures)          │  ← ANIM-AI-8
  │ current_state (MotionFeatures)       │  ← ANIM-AI-8
  │ contact_state (ContactFeatures)      │  ← ANIM-AI-8
  └──────────────────┬──────────────────┘
                     │ concatenated feature vector
                     ▼
  ┌─────────────────────────────────────┐
  │ ConditionalFlow Network (ONNX MLP)   │  ← ANIM-AI-9
  │ velocity_field(x_t, t, condition)    │
  │ ODE steps: x_{t+dt} = x_t + v·dt    │
  └──────────────────┬──────────────────┘
                     │ next_frame_residual
                     ▼
  ┌─────────────────────────────────────┐
  │ Codebook snap (optional)             │  ← ANIM-AI-10
  │ ContactModule → LegIK foot-plant    │  ← ANIM-AI-6
  └──────────────────┬──────────────────┘
                     │ final pose
                     ▼
               Output: Frame
```

## Rust API (`src-tauri/src/animation/networks/locomotion.rs`)

```rust
pub struct LocomotionController {
    flow_network: Mlp,           // ONNX velocity field
    state: LocomotionState,      // running state
    config: LocomotionConfig,    // ODE steps, dt, feature dims
}

pub struct LocomotionState {
    pub current_frame: Frame,
    pub root_features: RootFeatures,
    pub motion_features: MotionFeatures,
    pub contact_features: ContactFeatures,
    pub phase: f32,              // DeepPhase periodic variable [0, 2π)
}

impl LocomotionController {
    pub fn new(config: LocomotionConfig) -> Self;
    pub fn load_weights(path: &Path) -> Result<Self, LocomotionError>;
    pub fn step(&mut self, guidance: &GuidanceFeatures) -> Result<Frame, LocomotionError>;
    pub fn reset(&mut self);
}
```

## ODE Integration

The flow network predicts a velocity field `v(x_t, t, c)` where:
- `x_t` — current noisy state at diffusion time `t`
- `t` — diffusion timestep ∈ [0, 1]
- `c` — conditioning (trajectory + guidance + current_state)

At inference we integrate from `t=0` (noise) to `t=1` (clean sample) using
Euler steps (configurable `num_ode_steps`, default 5 for real-time):

```
x_0 = randn() or current_state (warm start)
for step in 0..num_ode_steps:
    t = step / num_ode_steps
    v = network.forward(concat(x_t, t, condition))
    x_{t+dt} = x_t + v * (1/num_ode_steps)
output = x_1
```

## Post-processing Pipeline

1. **Codebook snap** (optional) — if enabled, snap the raw network output to
   the nearest codebook entry to remove drift/noise (ANIM-AI-10).
2. **Contact detection** — run `ContactFeatures::detect()` on the output frame.
3. **Leg IK** — if contacts are active, pin feet to ground targets via
   `LegIkSolver::solve()` (ANIM-AI-6).
4. **Root update** — advance root position/rotation from the trajectory features.

## Training (sidecar, not shipped)

`scripts/train-locomotion-flow.py`:
- Dataset: LAFAN1 BVH (MIT license) processed through ANIM-AI-4 BVH importer
- Features: extracted via ANIM-AI-7 (root) + ANIM-AI-8 (motion, contact, guidance)
- Architecture: 4-layer MLP, hidden 512, ReLU, layer norm
- Loss: MSE on velocity field (flow matching objective)
- Export: `.onnx` via `torch.onnx.export`

## Weights Distribution

Weights ship via opt-in first-run download (not bundled in app binary).
Stored at `<app_data>/models/locomotion-flow.onnx`.
Fallback: if weights are missing, `step()` returns `LocomotionError::WeightsNotFound`.

## Metrics & Testing

- **Foot skating:** measure distance feet travel while in contact (target: < 2mm/frame)
- **Drift:** after 30s of straight-line walking, root position error ≤ 5cm
- **Determinism:** same input + same seed → identical output
- **Mirror invariance:** mirrored input → mirrored output (via ANIM-AI-3)
