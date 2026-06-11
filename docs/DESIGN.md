# TerranSoul

Deep-space companion console — a dark, immersive interface with cosmic purple
accents and layered depth, like piloting a sentient AI through a nebula.

TerranSoul presents a focused dark-mode experience built for AI companion
interaction. A deep navy base (#0f172a) creates an immersive, concentration-
friendly canvas, while layered slate surfaces build depth through opacity rather
than harsh contrasts. The brand accent — a vibrant violet (#7c6fff) — marks
interactive elements and focus states, preventing visual clutter and guiding the
user's eye. Secondary blue (#60a5fa) and success green (#34d399) provide
semantic breadth without competing with the primary accent.

[TerranSoul](https://github.com/user/TerranSoul)

---

## Color Palette

### BRAND

| Swatch | Name | Hex | Usage |
|--------|------|-----|-------|
| 🟣 | Cosmic Violet | `#7c6fff` | Primary actions, focus rings, active nav items, accent glow |
| 🟣 | Violet Hover | `#9589ff` | Hover state for primary actions |
| 🟣 | Violet Glow | `rgba(124, 111, 255, 0.22)` | Subtle glow behind active elements |

### ACCENT

| Swatch | Name | Hex | Usage |
|--------|------|-----|-------|
| 🔵 | Sky Blue | `#60a5fa` | Secondary interactive, links, info indicators |
| 🔵 | Blue Hover | `#3b82f6` | Hover for blue accents |
| 🟣 | Soft Violet | `#a78bfa` | Decorative highlights, gradient endpoints |
| 🟣 | Deep Violet | `#8b5cf6` | Tertiary accent, category markers |
| 🟡 | Quest Gold | `#dcc36e` | RPG/gamification elements, rewards, skill tree |
| 🟡 | Gold Bright | `#ffd700` | Achievement flash, celebration states |

### NEUTRALS

| Swatch | Name | Hex | Usage |
|--------|------|-----|-------|
| ⬛ | Void Navy | `#0f172a` | Page background, primary surface |
| ⬛ | Deep Slate | `#1e293b` | Elevated cards, panels |
| ⬛ | Slate Raised | `#283548` | Secondary elevated surfaces |
| ⬛ | Abyss | `#0b1120` | Navigation sidebar background |
| ⬜ | Frost | `#f1f5f9` | Primary text, headings |
| 🔘 | Steel | `#94a3b8` | Secondary text, labels |
| 🔘 | Slate Muted | `#64748b` | Tertiary text, placeholders |
| 🔘 | Dim | `rgba(255, 255, 255, 0.45)` | De-emphasized metadata |
| 🔘 | Border Base | `rgba(255, 255, 255, 0.10)` | Standard borders |
| 🔘 | Border Subtle | `rgba(255, 255, 255, 0.06)` | Soft separators |
| 🔘 | Border Medium | `#334155` | Card outlines, input borders |

### SEMANTIC

| Swatch | Name | Hex | Usage |
|--------|------|-----|-------|
| 🟢 | Success | `#34d399` | Positive states, online indicators, memory stored |
| 🟢 | Success Dim | `#22c55e` | Success text on dark backgrounds |
| 🟡 | Warning | `#fbbf24` | Caution states, degraded quality |
| 🔴 | Error | `#f87171` | Failure states, destructive actions |
| 🔵 | Info | `#38bdf8` | Informational banners, tips |

---

## Typography

### TYPE SCALE

Minor Third (1.2) from 14.4px base (0.9rem)

| Step | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| xs | 0.7rem (11.2px) | 400 | 1.3 | Badges, timestamps |
| sm | 0.8rem (12.8px) | 400 | 1.4 | Captions, metadata |
| base | 0.9rem (14.4px) | 400 | 1.5 | Body text, messages |
| lg | 1.1rem (17.6px) | 500 | 1.4 | Section headings |
| xl | 1.35rem (21.6px) | 600 | 1.3 | Page titles |

### FONTS

| Role | Family | Fallback | Usage |
|------|--------|----------|-------|
| PRIMARY | Inter | Segoe UI, system-ui, -apple-system, sans-serif | All UI text |
| CODE | JetBrains Mono | Fira Code, Courier New, monospace | Code blocks, technical data |

Inter provides a clean, modern aesthetic with strong readability at small sizes.
JetBrains Mono ensures consistent character alignment for code and data.

---

## Spacing & Shape

### SPACING

| Property | Value | Token |
|----------|-------|-------|
| Density | Comfortable | — |
| Base unit | 4px | `--ts-space-xs` |
| Element gap | 8px | `--ts-space-sm` |
| Card padding | 12px | `--ts-space-md` |
| Section gap | 16px | `--ts-space-lg` |
| Page margin | 24px | `--ts-space-xl` |

### BORDER RADIUS

| Element | Value | Token |
|---------|-------|-------|
| Tags, badges | 6px | `--ts-radius-sm` |
| Cards, inputs | 10px | `--ts-radius-md` |
| Panels, dialogs | 14px | `--ts-radius-lg` |
| Large containers | 20px | `--ts-radius-xl` |
| Pills, toggles | 999px | `--ts-radius-pill` |

### ELEVATION

| Level | Shadow | Token | Usage |
|-------|--------|-------|-------|
| Low | `0 1px 3px rgba(0,0,0,0.3)` | `--ts-shadow-sm` | Cards, inputs |
| Medium | `0 4px 16px rgba(0,0,0,0.35)` | `--ts-shadow-md` | Dropdowns, popovers |
| High | `0 12px 48px rgba(0,0,0,0.55)` | `--ts-shadow-lg` | Modals, overlays |

---

## Motion & Transitions

| Duration | Value | Token | Usage |
|----------|-------|-------|-------|
| Fast | 150ms ease | `--ts-transition-fast` | Hover, color change, toggle |
| Normal | 200ms ease | `--ts-transition-normal` | Panel expand, tab switch |
| Slow | 300ms ease | `--ts-transition-slow` | Modal appear, page transition |

**Easing:** Use `ease` (default) for most transitions. Reserve `ease-out` for
enter animations and `ease-in` for exit animations.

**Reduced motion:** Respect `prefers-reduced-motion: reduce` — replace motion
with instant opacity changes.

---

## Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--ts-z-base` | 1 | In-flow stacking contexts |
| `--ts-z-dropdown` | 100 | Dropdowns, popovers |
| `--ts-z-sticky` | 200 | Sticky headers, floating bars |
| `--ts-z-dialog` | 300 | Modal dialogs |
| `--ts-z-overlay` | 500 | Full-screen overlays |
| `--ts-z-toast` | 700 | Toast notifications |
| `--ts-z-splash` | 900 | Splash/loading screens |
| `--ts-z-context-menu` | 1000 | Context menus (top-most) |

---

## Guidelines

### DO

- Use Void Navy (`#0f172a`) for the primary page background to establish the
  dark immersive theme.
- Apply Frost (`#f1f5f9`) for all primary text and headings to ensure
  readability against dark surfaces.
- Highlight primary interactive elements with Cosmic Violet (`#7c6fff`) —
  restrict its use to guide user attention to actions.
- Create depth by layering surfaces: Void Navy → Deep Slate → Slate Raised,
  using the `--ts-bg-*` tokens for each level.
- Use Inter for all UI text with the defined type scale — maintain the compact
  base size (0.9rem) for information density.
- Apply `--ts-radius-md` (10px) for cards and inputs, `--ts-radius-sm` (6px)
  for smaller elements like badges and tags.
- Use Steel (`#94a3b8`) for secondary text and labels to create clear hierarchy
  without competing with primary content.
- Keep spacing consistent: 8px element gap, 12px card padding, 16px section gap.
- Provide semantic feedback using the designated colors: green for success,
  amber for warning, red for error, blue for info.
- Use `rgba()` borders (`--ts-border`) for subtle separation; they adapt to
  any surface automatically.

### DON'T

- Do not introduce bright or saturated colors beyond the defined accent palette;
  the violet/blue accent pair is the identity.
- Avoid white backgrounds or light patterns in the default theme — the system
  is anchored in deep dark mode. Light themes exist separately.
- Do not deviate from Inter + JetBrains Mono; these typefaces are fundamental
  to the visual identity.
- Do not use strong diffuse shadows; elevation is achieved through subtle
  layering and contained shadows.
- Do not hardcode hex colors — always use `var(--ts-*)` tokens.
- Do not hardcode pixel spacing — always use `var(--ts-space-*)` tokens.
- Do not use `position: fixed/absolute` for layout elements; use flex/grid.
- Avoid `!important` — fix specificity at the source instead.
- Do not exceed the z-index scale — never use bare integers or `9999`.
- Do not create one-off animation durations — use the transition token scale.

---

## Component Patterns

### Chat Message

```css
.message {
  background: var(--ts-bg-surface);
  border: 1px solid var(--ts-border-subtle);
  border-radius: var(--ts-radius-md);
  padding: var(--ts-space-md);
  font-size: var(--ts-text-base);
  color: var(--ts-text-primary);
}
.message--assistant {
  border-left: 3px solid var(--ts-accent);
}
```

### Card

```css
.card {
  background: var(--ts-bg-surface);
  border: 1px solid var(--ts-border);
  border-radius: var(--ts-radius-md);
  padding: var(--ts-space-lg);
  box-shadow: var(--ts-shadow-sm);
  transition: box-shadow var(--ts-transition-fast);
}
.card:hover {
  box-shadow: var(--ts-shadow-md);
}
```

### Button (Primary)

```css
.btn-primary {
  background: var(--ts-accent);
  color: var(--ts-text-on-accent);
  border: none;
  border-radius: var(--ts-radius-sm);
  padding: var(--ts-space-sm) var(--ts-space-lg);
  font-weight: 500;
  transition: background var(--ts-transition-fast);
}
.btn-primary:hover {
  background: var(--ts-accent-hover);
}
```

### Navigation Item

```css
.nav-item {
  color: var(--ts-text-secondary);
  padding: var(--ts-space-sm);
  border-radius: var(--ts-radius-sm);
  transition: all var(--ts-transition-fast);
}
.nav-item:hover {
  background: var(--ts-bg-hover);
  color: var(--ts-text-primary);
}
.nav-item--active {
  color: var(--ts-accent);
  background: var(--ts-bg-selected);
}
```

---

## CSS Variables (complete token set)

```css
:root {
  /* Surfaces */
  --ts-bg-base: #0f172a;
  --ts-bg-surface: #1e293b;
  --ts-bg-elevated: #283548;
  --ts-bg-nav: #0b1120;
  --ts-bg-overlay: rgba(8, 12, 24, 0.92);
  --ts-bg-input: rgba(255, 255, 255, 0.06);
  --ts-bg-hover: rgba(255, 255, 255, 0.10);
  --ts-bg-card: rgba(30, 41, 59, 0.92);
  --ts-bg-panel: rgba(15, 23, 42, 0.96);
  --ts-bg-selected: rgba(34, 197, 94, 0.10);

  /* Brand */
  --ts-accent: #7c6fff;
  --ts-accent-hover: #9589ff;
  --ts-accent-glow: rgba(124, 111, 255, 0.22);
  --ts-accent-blue: #60a5fa;
  --ts-accent-blue-hover: #3b82f6;
  --ts-accent-violet: #a78bfa;
  --ts-accent-violet-hover: #8b5cf6;

  /* Semantic */
  --ts-success: #34d399;
  --ts-warning: #fbbf24;
  --ts-error: #f87171;
  --ts-info: #38bdf8;

  /* Text */
  --ts-text-primary: #f1f5f9;
  --ts-text-secondary: #94a3b8;
  --ts-text-muted: #64748b;
  --ts-text-dim: rgba(255, 255, 255, 0.45);
  --ts-text-on-accent: #ffffff;

  /* Border */
  --ts-border: rgba(255, 255, 255, 0.10);
  --ts-border-subtle: rgba(255, 255, 255, 0.06);
  --ts-border-medium: #334155;
  --ts-border-focus: var(--ts-accent);

  /* Radius */
  --ts-radius-sm: 6px;
  --ts-radius-md: 10px;
  --ts-radius-lg: 14px;
  --ts-radius-xl: 20px;
  --ts-radius-pill: 999px;

  /* Spacing */
  --ts-space-xs: 4px;
  --ts-space-sm: 8px;
  --ts-space-md: 12px;
  --ts-space-lg: 16px;
  --ts-space-xl: 24px;

  /* Shadow */
  --ts-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
  --ts-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.35);
  --ts-shadow-lg: 0 12px 48px rgba(0, 0, 0, 0.55);

  /* Motion */
  --ts-transition-fast: 0.15s ease;
  --ts-transition-normal: 0.2s ease;
  --ts-transition-slow: 0.3s ease;

  /* Typography */
  --ts-font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --ts-font-mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  --ts-text-xs: 0.7rem;
  --ts-text-sm: 0.8rem;
  --ts-text-base: 0.9rem;
  --ts-text-lg: 1.1rem;
  --ts-text-xl: 1.35rem;

  /* Z-Index */
  --ts-z-base: 1;
  --ts-z-dropdown: 100;
  --ts-z-sticky: 200;
  --ts-z-dialog: 300;
  --ts-z-overlay: 500;
  --ts-z-toast: 700;
  --ts-z-splash: 900;
  --ts-z-context-menu: 1000;
}
```

---

## Tailwind v4 Theme Bridge

```css
@theme inline {
  --color-ts-accent: var(--ts-accent);
  --color-ts-accent-hover: var(--ts-accent-hover);
  --color-ts-surface: var(--ts-bg-surface);
  --color-ts-elevated: var(--ts-bg-elevated);
  --color-ts-text: var(--ts-text-primary);
  --color-ts-text-secondary: var(--ts-text-secondary);
  --color-ts-success: var(--ts-success);
  --color-ts-warning: var(--ts-warning);
  --color-ts-error: var(--ts-error);
  --radius-sm: var(--ts-radius-sm);
  --radius-md: var(--ts-radius-md);
  --radius-lg: var(--ts-radius-lg);
}
```

---

## Design References

This style is informed by:
- **Linear** — dark layered command-center aesthetic, compact density
- **Raycast** — focused dark UI with single-accent interaction model
- **Cursor** — warm developer tool with subtle surface layering
- **Warp** — deep-space terminal with precise accent usage

Research via [styles.refero.design](https://styles.refero.design) — search
"dark AI interface", "command center dashboard", "companion app dark mode".
