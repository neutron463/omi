# 03 — Motion, Animation & Interaction Physics

Scope: SwiftUI→web animation translation, macOS-only transition idioms, scrolling feel, hover/focus conventions, performance floor, reduced-motion. Windows app = Electron + Chromium (Blink/Skia) + React + Tailwind v4, `desktop/windows/`. Mac app = SwiftUI.

**Hard constraint from the product owner: distinctive animations are part of the product's feel. This charter translates them faithfully — it never flattens or removes choreography. Every recommendation below optimizes *implementation cost* (bundle size, maintainability, perf), never the motion itself.**

## Delta from current state (read this first)

The Windows app has **no animation runtime dependency today** — grep of `package.json` for `framer-motion`, `motion`, `react-spring`, `gsap`, `animejs`, `popmotion`, `lottie-react`, `@formkit/auto-animate` returns nothing. Motion is 100% hand-rolled across two idioms already in production:

1. **CSS transitions/keyframes with custom `cubic-bezier()` curves** — `src/renderer/src/styles/globals.css` defines `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` and `--ease-morph: cubic-bezier(0.3, 0.8, 0.3, 1)`, used across `logoReveal`, `slideInLeft`, `widgetFade`, `pageEnter`, `fadeRise`, `fadeDrop` keyframe animations. `src/renderer/src/components/bar/bar.css` uses per-transform durations from 170–240ms on its own `cubic-bezier(0.3, 0.8, 0.3, 1)` / `cubic-bezier(0.2, 0.9, 0.3, 1)` curves for the bar's expand/collapse geometry.
2. **rAF-driven canvas physics for the orb** — `src/renderer/src/orb/orbAnimator.ts` + `choreography.ts` hand-roll a self-throttled rAF loop (30fps idle / 60fps active / 0fps hidden) with explicit envelope/tween math (`stepMergeEnvelope`, `stepAmplitudeEnvelope`, `easeInOut`), verified by a **pixel-sampling invariant harness** (`scripts/orb/check-motion.mjs`) that asserts the rendered output — not the source formula — produces a unimodal, near-zero-at-the-ends velocity S-curve. There's also a startup jank probe (`lib/dev/animBench.ts`, `OMI_ANIM_BENCH`) that records frame intervals + PerformanceObserver longtasks during the entrance animation window.

There's also a **documented, load-bearing bug fix already in `globals.css`** (`.input-field`, lines ~316–327): `transition-all` animated the UA's default focus outline for one frame before `focus:outline-none` killed it, producing a white flash. Fixed by narrowing the transition to `transition-[border-color,background-color,box-shadow]` and declaring `outline: 2px solid transparent` at rest. This pattern must be the default for every future focus-visible style, not a one-off.

**Recommendation given this baseline: do not add a runtime animation library.** The two existing idioms (CSS/WAAPI for discrete UI, rAF for continuous/interruptible physics) already cover SwiftUI's animation surface. See §1 for the mechanical reason and the one precompute-time tool this charter does add (dev dependency only, zero runtime bytes).

---

## 1. SwiftUI → web animation translation table

### Mac reality: exact curve values

SwiftUI's animation surface splits into **easing curves** (fixed-duration, no physics) and **springs** (physics-based, response to interruption/re-targeting). Apple's precise defaults, corroborated across the `Animation` API docs and WWDC23 session 10158 ("Animate with springs"):

| SwiftUI construct | Exact parameters | Notes |
|---|---|---|
| `.easeInOut` / `.default` (no explicit duration) | duration **0.35s**, curve `cubic-bezier(0.42, 0, 0.58, 1)` | The implicit default when no `.animation()` modifier duration is given. |
| `.easeIn(duration:)` | curve `cubic-bezier(0.42, 0, 1, 1)` | Starts slow, no easing on exit. |
| `.easeOut(duration:)` | curve `cubic-bezier(0, 0, 0.58, 1)` | No easing on entry, decelerates into rest. |
| `.linear(duration:)` | curve `cubic-bezier(0, 0, 1, 1)` | |
| `.spring()` (bare default) | `response: 0.5`, `dampingFraction: 0.825`, `blendDuration: 0` | Apple's documented default for `spring(response:dampingFraction:blendDuration:)`. Community reverse-engineering sometimes cites `response: 0.55` — treat `0.5/0.825` as the primary figure per the API's own default-parameter declaration, `0.55` as the secondary/fallback if a specific screen visibly disagrees. |
| `.smooth` | `spring(duration: 0.5, bounce: 0)` | Critically damped — reaches target with no overshoot, as fast as possible without crossing it. |
| `.snappy` | `spring(duration: 0.5, bounce: 0.15)` | Small, barely-visible overshoot — the default "lively" feel Apple ships on most system chrome. |
| `.bouncy` | `spring(duration: 0.5, bounce: 0.3)` | Clearly visible overshoot + one settle oscillation — reserve for playful/celebratory moments. |
| `.interactiveSpring()` | `response: 0.15`, `dampingFraction: 0.86`, `blendDuration: 0.25` | Used for drag-follow / gesture-tracked values — much stiffer response so the UI doesn't lag the finger/cursor. |

`bounce` (range **-1.0 to 1.0**) and `duration` are the *modern* (iOS 17+/macOS 14+) spring parameterization — prefer reasoning in `duration`+`bounce` over `response`+`dampingFraction` when translating, because `duration`+`bounce` maps directly onto Motion's `spring(visualDuration, bounce)` signature (§ below) with no unit conversion.

### (a) CSS `linear()` spring approximation — the mechanical recipe

CSS cannot express a physics spring natively; `linear()` (Baseline since 2024, supported by every Chromium this app ships — Electron `^39.2.6` bundles a Chromium build far past the `linear()` support floor of Chrome 113) approximates one by sampling the spring's position curve at N points and encoding them as a polyline easing function. Do **not** hand-derive these samples. Two build-time tools do this correctly:

- **[jakearchibald/linear-easing-generator](https://github.com/jakearchibald/linear-easing-generator)** — paste a JS easing function (a physically-simulated spring, e.g. from `react-spring`'s solver) or an SVG path; it emits an optimized `linear(0, 0.006, 0.021 4.5%, 0.081 8.4%, ..., 1)` string, already point-reduced via Ramer–Douglas–Peucker so it isn't bloated.
- **Motion's `spring()` CSS generator** (from the `motion` npm package — see (c) below) — has a `toString()` that returns the exact SwiftUI-parameter shape: `` `${spring(visualDurationSeconds, bounce)}` `` → `"823ms linear(0, 0.0089, ..., 1)"`. Because its signature is literally `spring(visualDuration, bounce)`, translating a SwiftUI spring is copy-paste: `.spring(duration: 0.5, bounce: 0.15)` (`.snappy`) → `spring(0.5, 0.15)`.

**Recipe agents should follow mechanically:**
1. Identify the SwiftUI animation from the table above (or read it off the `.animation(...)` call in the Mac Swift source) → get `(duration, bounce)`.
2. Run a **one-time, dev-only** Node script (`devDependency` on `motion`, never imported by the renderer bundle) that calls `spring(duration, bounce).toString()` and prints the `<duration>ms linear(...)` string.
3. Paste the resulting duration + `linear()` string as a literal into the CSS custom property / Tailwind arbitrary value (`ease-[linear(...)]` or a `--ease-*` var in `globals.css`, matching the existing `--ease-out` / `--ease-morph` convention). No runtime dependency ships.
4. For **interruptible** springs (drag-follow, PTT press, anything that can be re-targeted mid-animation — SwiftUI springs re-solve from current velocity, CSS transitions cannot), do not use `linear()` at all — fall through to (b)/(c) below.

This keeps the "no runtime animation library" posture while still getting spring-accurate curves: the physics solve happens once at dev time, not on every animation frame in the shipped app.

### (b) WAAPI (`element.animate()`)

Use for JS-driven, one-shot or chainable sequences that need `Promise`-based completion (`anim.finished`) or need to be `.cancel()`-able mid-flight — e.g. a toast that can be dismissed before its entrance finishes. Feed it the same precomputed `linear()` easing strings from (a):

```ts
el.animate(
  [{ transform: 'translateY(12px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
  { duration: 823, easing: 'linear(0, 0.0089, ...)', fill: 'both' }
)
```

WAAPI runs on the compositor thread for `transform`/`opacity` exactly like a CSS transition, so there's no perf cost over CSS — the only reason to reach for it over a class-toggle CSS transition is needing JS-side lifecycle control (cancel, reverse, `.finished` await, chaining).

### (c) Interruptible physics — keep hand-rolling, don't add a spring runtime

SwiftUI springs are **re-targetable**: if the destination changes mid-animation, the spring re-solves from the current position *and velocity*, so motion never snaps or restarts. Neither CSS transitions nor `linear()` easings can do this (both play a fixed, precomputed curve from a fixed start). This is the one case where you need a live differential-equation solver ticking every frame — exactly what `orbAnimator.ts`/`choreography.ts` already does by hand for the orb, and exactly the reason not to introduce `framer-motion`/`react-spring` as a running dependency: **the app already has a working, perf-verified (via `check-motion.mjs`) rAF spring solver for its one truly interruptible, physics-critical surface.**

For any *new* UI that needs interruptible spring behavior (e.g., a draggable panel that should catch up smoothly if the user changes drag target), don't reach for a library — port the standard critically/under-damped spring integrator (a ~20-line closed-form or semi-implicit Euler step keyed on `stiffness = (2π/response)²`, `damping = 4π·dampingFraction/response`, `mass = 1`) into a small shared `useSpringValue` hook, driven by the same rAF pattern `orbAnimator.ts` already uses. This is the "optimize implementation cost, not choreography" instruction applied literally: reuse the existing rAF plumbing and throttle-state machine (30/60/0fps) instead of pulling in ~30-50kb (gzipped, full `motion`/`framer-motion` package with layout animation, gestures, and drag) for a capability the codebase already has a hand-rolled, tested version of.

**If** a future surface needs many independent interruptible springs at once (a Trello-style drag-reorder board, physically-simulated multi-item flings) — cross that bridge then by importing only `motion`'s standalone `spring()` *generator* function (not the whole animation/gesture/layout runtime; Motion is modular so importing `spring` alone doesn't pull in the DOM `animate`, layout, or gesture code) rather than `react-spring`, since `spring(visualDuration, bounce)` keeps the 1:1 SwiftUI parameter mapping from (a).

### Caveats
- `response`/`dampingFraction` values reported across secondary sources for the bare `.spring()` default disagree slightly (`0.5` vs `0.55` response); this charter treats `duration`/`bounce`-parameterized presets (`.smooth`/`.snappy`/`.bouncy`) as the higher-confidence source since Apple documents those as fixed named constants, not tunable defaults subject to interpretation.
- `linear()` devtools visualization/editing lands in Chrome 114+; Electron 39's bundled Chromium is far newer, so this is a non-issue for this app, but don't assume it in isolation for other Electron pins.

### Sources
- [spring(response:dampingFraction:blendDuration:) — Apple Developer Documentation](https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:))
- [spring(duration:bounce:blendDuration:) — Apple Developer Documentation](https://developer.apple.com/documentation/SwiftUI/Animation/spring(duration:bounce:blendDuration:))
- [snappy — Apple Developer Documentation](https://developer.apple.com/documentation/swiftui/animation/snappy)
- [Animate with springs — WWDC23 session 10158](https://developer.apple.com/videos/play/wwdc2023/10158/)
- [Understanding Spring Animations in SwiftUI — createwithswift.com](https://www.createwithswift.com/understanding-spring-animations-in-swiftui/)
- [Create complex animation curves in CSS with the linear() easing function — Chrome for Developers](https://developer.chrome.com/docs/css-ui/css-linear-easing-function)
- [jakearchibald/linear-easing-generator — GitHub](https://github.com/jakearchibald/linear-easing-generator)
- [The Path To Awesome CSS Easing With The linear() Function — Smashing Magazine](https://www.smashingmagazine.com/2023/09/path-css-easing-linear-function/)
- [JS and CSS spring generation — Motion.dev docs](https://motion.dev/docs/spring)
- [CSS animation generation | CSS springs — Motion.dev docs](https://motion.dev/docs/css)
- [Improvements to the Web Animations API — Motion.dev docs](https://motion.dev/docs/improvements-to-the-web-animations-api-dx)
- [`linear()` easing — caniuse](https://caniuse.com/wf-linear-easing)
- Repo: `desktop/windows/src/renderer/src/styles/globals.css`, `src/renderer/src/components/bar/bar.css`, `src/renderer/src/orb/orbAnimator.ts`, `src/renderer/src/lib/dev/animBench.ts`, `scripts/orb/check-motion.mjs`

---

## 2. macOS-specific transitions with no Windows analog

Fluent 2's own documented primitives (Microsoft Learn "Timing and easing" / "Motion in practice"):

| Token | Value |
|---|---|
| `ControlFasterAnimationDuration` | 83ms |
| `ControlFastAnimationDuration` | 167ms |
| `ControlNormalAnimationDuration` | 250ms |
| Fast Out, Slow In (**decelerate**, entering objects) | `cubic-bezier(0, 0, 0, 1)` |
| Slow Out, Fast In (**accelerate**, exiting objects) | `cubic-bezier(1, 0, 1, 1)` |
| Documented page-transition example | forward-out: fade 150ms accelerate · forward-in: slide-up 150px 300ms decelerate · backward-out: slide-down 150px 150ms accelerate · backward-in: fade-in 300ms decelerate |
| Documented object-transition example | expand: grow 300ms standard · contract: grow 150ms accelerate |

Per-transition mapping:

| Mac idiom | Mac mechanism | Windows-feel equivalent | Exact implementation |
|---|---|---|---|
| **Sheet slide-up** (modal presented from the bottom edge, e.g. a confirmation sheet) | `NSView`/SwiftUI `.sheet` transition — slides up from off-screen bottom with a spring, dims backdrop concurrently | Fluent **flyout/dialog entrance**: content slides up a *short* distance (not full-screen-height) while fading in, backdrop dims on a separate faster timeline | Content: `transform: translateY(24px)→translateY(0)` + `opacity: 0→1`, 250ms (`ControlNormalAnimationDuration`), decelerate curve `cubic-bezier(0,0,0,1)`. Backdrop: opacity-only, 167ms (`ControlFastAnimationDuration`), same decelerate curve, started at the same t=0 so it visually "arrives first" (matches the documented forward-transition pattern of a short fade layered under a slightly longer slide). Exit: reverse geometry, but switch to the **accelerate** curve `cubic-bezier(1,0,1,1)` and shorten to 150ms — Fluent's docs explicitly use a *different, shorter, accelerate* curve for exits, not a played-in-reverse decelerate curve (this is the one asymmetry to keep: entrances decelerate, exits accelerate, at different durations). |
| **Popover "genie" effect** (menu/popover appears to squeeze out of its anchor point, e.g. right-click context reveal near the triggering control) | `NSPopover` — scales + fades from the anchor edge with clipping | Fluent **flyout**: no genie/squeeze morph — flyouts scale-fade from a fixed anchor with no path-warp | `transform-origin` set to the anchor edge (e.g. `top left` if opening below-right of a button), `transform: scale(0.92)→scale(1)` + `opacity: 0→1`, 167ms, decelerate curve. Do **not** attempt to reproduce the genie's actual path-warp (CSS/WAAPI can't cheaply do non-affine mesh deformation) — a scale+fade from anchor reads as "Windows-native menu" without looking like a broken attempt at the Mac effect. This is a case where product fidelity is served by *not* chasing the literal Mac visual — Windows users' learned expectation for a flyout is scale-fade-from-anchor, and a genie-esque squeeze would read as uncanny/broken on this platform, not as faithful porting. |
| **Window zoom** (green traffic-light zoom transition when a window enters/exits fullscreen, morphing window bounds into/out of the display bounds) | `NSWindow` zoom — animates window frame from its windowed rect to the exact display rect (or reverse), synchronized with a content cross-fade | Fluent **maximize/restore**: Windows' own DWM already animates the native window-frame morph on maximize/restore (same underlying idea — bounds interpolate to/from full-screen) — this is OS chrome, not something the Electron content layer should re-implement. For **in-app** "expand to full surface" moments (e.g. bar → full window), match the *distance-scaled duration* principle from Fluent's Object example table: bigger bound changes get **longer** durations (300ms `grow`) than smaller ones (150ms `contract`), asymmetric like the sheet case | Animate `width`/`height`/`border-radius` (already the pattern in `bar.css` lines 72–82, using 170ms/240ms) rather than `top`/`left`/`right`/`bottom` (layout-triggering) — this file already gets this right; the guidance is to extend the *same* width/height/border-radius transform-adjacent trio, never introduce a top/left-based expand elsewhere in the app. |

### Caveats
- Fluent's own docs are sparse on numeric popover/flyout timings specifically (WinUI ships `PopupThemeTransition`/`ContentDialog` defaults compiled into the framework, not published as raw ms/curve pairs in public docs) — the 167ms/decelerate figure above is derived from the closest documented analog (`ControlFastAnimationDuration` + the documented decelerate curve), not a literal Microsoft-published popover spec. Validate against the reference oracle (Windows 11 Start menu flyouts, right-click context menus) if a specific flyout reads off.
- Don't reuse the Mac's sheet spring `(response, dampingFraction)` values verbatim for the Windows sheet equivalent — Fluent motion is fixed-duration-curve-based, not spring-based, by design; mixing a spring feel into an otherwise Fluent-cadence app will read as inconsistent with native Windows chrome (Start menu, Settings app, File Explorer) sitting right next to it.

### Sources
- [Timing and easing — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/design/motion/timing-and-easing)
- [Motion in practice — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/develop/motion/motion-in-practice)
- Repo: `desktop/windows/src/renderer/src/components/bar/bar.css` (existing width/height/border-radius pattern to extend, lines 72–82)

---

## 3. Scrolling

### Mac reality
macOS uses **overlay scrollbars** (zero layout width, fade in only while scrolling/hovering) plus **rubber-band/elastic overscroll** at content edges (a `10.7+`-era system behavior: content stretches past its edge under drag and springs back).

### Windows reality / recommended approach
Windows users expect **persistent, layout-reserving scrollbars** (or at minimum an always-visible-on-hover thin bar) and **no overscroll bounce** — Windows 11 apps rest hard at scroll boundaries.

**Recommendation: do not port rubber-band overscroll to Windows.** This is the one Mac motion idiom this charter recommends dropping outright rather than translating, because it isn't just aesthetic — Windows 10/11 users interpret edge-bounce as a bug/lag artifact (it has no equivalent native affordance anywhere in Windows shell chrome), and per §6/product-owner intent, the instruction to preserve "distinctive" motion is about the app's own choreography (orb, bar, cards), not about porting an OS-level platform convention that fights the target platform's own muscle memory.

**Scrollbar styling — CSS-only, no library:**
```css
/* Overlay-scrollbar feel without a dependency: zero-width track at rest,
   thin visible thumb only on hover/scroll. Chromium-only (::-webkit-scrollbar),
   which is fine — Electron's renderer is always Chromium. */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 999px;
  border: 2px solid transparent; /* creates padding via background-clip */
  background-clip: padding-box;
  transition: background-color 150ms ease-out;
}
.scroll-region:hover::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.18);
}
::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.32);
}
```
This is directionally closer to *macOS overlay feel* than stock Windows persistent scrollbars — deliberate, since the charter's goal is Mac visual fidelity, not Windows-native scrollbar chrome. Reserve full Fluent-native persistent scrollbars only for dense data views (tables/lists a power user scrolls constantly) where a reserved gutter genuinely helps usability; the conversation list, settings panels, and chat surfaces should use the overlay-feel treatment above.

`overscroll-behavior: contain` (not `none`) on scroll containers that sit inside other scrollable ancestors (e.g. a modal's inner list inside the app shell) — this stops scroll-chaining into the parent without disabling the container's own boundary behavior, and has no rubber-band side effect either way since Chromium doesn't implement elastic overscroll by default (that's a macOS-native-WebKit-only behavior; Chromium's default at-boundary behavior is already a hard stop, matching Windows expectations for free).

**No `overlayscrollbars` library needed.** It's a solid option (`npm install overlayscrollbars`, TS, dependency-free, React/Vue/Svelte wrappers, preserves native wheel/touch/keyboard feel) if the CSS-only approach above proves insufficient for a specific dense list (e.g. needs drag-to-scroll thumb, or JS-driven scroll-position sync with another surface) — but don't reach for it by default; the pure-CSS treatment above covers the visual goal (overlay feel) with zero JS/bundle cost, and this app currently has zero scrolling-library dependencies to match.

### Momentum differences
Chromium's default wheel/trackpad momentum on Windows is OS-driven (Windows Precision Touchpad momentum curve) and is **not** something the app layer controls or should try to override with JS-driven momentum simulation — doing so (a common anti-pattern: `wheel` event handlers that manually decay velocity) reliably produces janky, laggy-feeling scroll that fights the OS's own compositor-thread scrolling. Leave native scroll physics alone; only intercept `wheel` for scroll-linked *visual* effects (below), never to replace the scroll mechanism itself.

### Scroll-linked animation pitfalls
Any effect that reads scroll position to drive a parallel visual (parallax header, scroll-progress bar, sticky-header shrink) must **read scroll position from a rAF-batched loop, never from the raw `scroll` event handler directly** — the `scroll` event fires far more often than paint and running `style.transform = ...` synchronously inside it causes forced synchronous layout (read `scrollTop`, write `style`, browser must re-layout before the next scroll event can fire, serializing scroll with layout instead of letting the compositor thread scroll independently). Pattern:
```ts
let ticking = false
el.addEventListener('scroll', () => {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    applyScrollLinkedStyle(el.scrollTop)
    ticking = false
  })
}, { passive: true })
```
`{ passive: true }` is required — without it Chromium must wait for the handler to confirm it won't call `preventDefault()` before it can start the compositor scroll, adding input latency on every scroll tick. Modern CSS `scroll-timeline`/`animation-timeline: scroll()` (Chromium 115+, so available in this Electron pin) is the zero-JS alternative for pure scroll-progress-driven CSS animations (no `transform`/`opacity` JS writes at all, runs entirely on the compositor) — prefer it over the rAF pattern above for any effect that's a pure function of scroll position with no other app-state dependency.

### Sources
- [Elastic Overflow Scrolling — CSS-Tricks](https://css-tricks.com/elastic-overflow-scrolling/)
- [Preventing drag overscrolling behavior (Rubber Band) on macOS — dsalim.dev](https://dsalim.dev/css/2023/05/24/prevent-drag-overscroll-macos.html)
- [KingSora/OverlayScrollbars — GitHub](https://github.com/KingSora/OverlayScrollbars)
- [overlayscrollbars — npm](https://www.npmjs.com/package/overlayscrollbars)

---

## 4. Hover/pointer conventions & focus-visible

### Mac vs Windows hover
macOS UI hover states are subtle (opacity/tint shifts of a few percent, no elevation change) because trackpad-driven pointer movement is the dominant input and Mac users rarely rely on hover as a primary affordance signal. Windows users lean on hover more (mouse-first desktop usage is still the majority case), so hover states can and should be **slightly more pronounced** than the Mac original without breaking visual fidelity — this is corroborated by the existing `.surface-card-interactive:hover` treatment already in `globals.css` (background shift + `translateY(-1px)` lift), which already reads as a touch more "present" than a typical Mac hover and should stay that way; do not flatten it to match Mac's subtlety 1:1.

### Focus-visible: the safe pattern (already fixed once, encode it so it can't regress)
`globals.css`'s `.input-field` fix (lines ~316–327) is the canonical pattern — every future focusable custom control must follow it exactly:

1. **Never use `transition-all` / `transition: all` on any element that receives keyboard focus.** List the exact properties that visually change on focus/hover/active (`border-color`, `background-color`, `box-shadow`, `transform`, etc.) — e.g. Tailwind's `transition-[border-color,background-color,box-shadow]`. `transition-all` animates *every* property that differs between states, including the browser's own default focus outline, for one frame before an explicit override can suppress it — that one animated frame is the flash.
2. **Declare the resting outline explicitly as transparent**, don't rely on `outline: none` alone: `outline: 2px solid transparent; outline-offset: 2px;`. This means there is no color to flash *from* in the first place — `outline: none` removes the outline's box but doesn't preempt the UA's default outline color from being the interpolation source if something upstream still transitions it.
3. Focus visibility comes from the properties actually in the transition list (ring/border/background), never from the native outline. If a control has no natural border/background to shift, add a dedicated `:focus-visible` ring via `box-shadow` (already in the transition list) rather than re-introducing `outline`.

```css
.custom-focusable {
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition: border-color 200ms var(--ease-out), box-shadow 200ms var(--ease-out);
}
.custom-focusable:focus-visible {
  border-color: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
}
```

Use `:focus-visible` (not bare `:focus`) for the ring itself — this suppresses the ring on mouse-click focus (matches both platforms' native convention) while keeping it for keyboard/tab navigation, independent of the transition-list fix above (the two issues are orthogonal: `:focus-visible` controls *when* a ring shows, the transition-property list controls whether the browser's *own* outline flashes en route).

### Caveats
- This is a Chromium-specific bug shape (the flash is a UA-default-outline-interpolation artifact) — don't assume it reproduces identically in a from-scratch Safari/WebKit build; irrelevant here since the renderer is always Chromium, but worth knowing if any shared component code is ever cross-checked against the macOS app's own (WebKit-less, native AppKit) focus rendering.

### Sources
- Repo: `desktop/windows/src/renderer/src/styles/globals.css` lines 316–327 (existing documented fix, generalize it — this section formalizes the existing comment into a repo-wide rule)

---

## 5. Performance floor (software rendering, no GPU)

Windows dev builds on this machine already run **software rasterization** (a documented hybrid-GPU WebGL-crash workaround — see `windows-dev-gpu-webgl-fix` memory / the analogous fix already shipped for the Mac dev build) — meaning every animation must be judged against CPU-bound compositing, not the GPU-accelerated path a typical web perf article assumes. Rules, in priority order:

1. **Only animate `transform` and `opacity`.** These are the only two properties that can be applied at composite time from a previously-rasterized layer without a repaint. Under software rasterization every *paint* is CPU work with no GPU to hide it behind — `top`/`left`/`width`/`height` (layout), `background-color`/`border-color` transitions that aren't just interpolated compositing (some are, most simple color transitions on a solid-fill box are cheap; the risk is combining them with expensive filters, see #2), and any property that forces layout/paint is disproportionately more expensive here than on a GPU-accelerated machine.
2. **No animated `filter` or `box-shadow` on large surfaces.** Both force a repaint of the element's full bounds every frame (there's no compositor fast-path for either) — a `blur()`/`drop-shadow()` filter animating on a full-width card, or a `box-shadow` size/spread transition on the bar, is exactly the kind of thing that's invisible-cost on a GPU machine and visibly janky under software raster. If a glow/shadow needs to animate, animate its **opacity** on a separate pre-rendered pseudo-element/layer instead of animating the shadow's blur radius or color directly.
3. **`will-change` discipline: apply immediately before the animation starts, remove immediately after it ends — never leave it on at rest.** `will-change: transform` promotes the element to its own compositor layer persistently while set; under software rendering, layer promotion doesn't buy the GPU compositing win it would elsewhere, but it still costs memory (a full backing bitmap per promoted layer) and can *worsen* raster time if too many elements are promoted simultaneously (more surfaces to rasterize independently instead of one batched paint). Pattern: set it in a `pointerenter`/animation-start handler, clear it in the transition's `transitionend`/animation-completion callback — mirrors the orb's own `contextLost` lifecycle discipline in `orbAnimator.ts`.
4. **Canvas vs DOM: canvas (already the orb's choice) for anything with per-frame procedural geometry** (the orb's dot positions, waveform bars, any particle-style effect) — a canvas element's own internal redraw is one bounded raster op per frame regardless of how many "shapes" it contains, versus N DOM elements each individually re-rendered by the browser's layout/paint/composite pipeline. **DOM + transform/opacity for anything that's fundamentally a state machine between a small number of discrete visual states** (cards, panels, buttons, sheets) — DOM/CSS gives you accessibility tree integration, text layout, and hit-testing for free, which a canvas reimplementation would have to hand-roll.
5. **Keep the orb's existing throttle model (30fps idle / 60fps active / 0fps hidden) as the template for any other continuously-animating surface** — a waveform, a live transcript cursor blink, anything that runs indefinitely rather than playing once. A one-shot 200ms entrance transition doesn't need this; anything that loops for the lifetime of a screen does, and should size its frame rate to how much the state is actually changing, not run 60fps unconditionally.
6. **Reuse `lib/dev/animBench.ts`'s pattern for any new persistent/entrance animation surface** — a `PerformanceObserver({entryTypes: ['longtask']})` + max-frame-interval probe gated behind an env flag (`OMI_ANIM_BENCH`) is cheap to extend to a second animation window (e.g. bar summon/dismiss) and gives a real regression signal instead of "looks fine on my machine," which is exactly the risk software rendering creates (a change that's imperceptible on a GPU dev machine can visibly janks on this app's actual software-raster dev/CI path).

### Caveats
- Don't conflate "software rasterization" with "no compositor" — Chromium's compositor thread still exists and still batches transform/opacity animations off the main thread even without GPU acceleration; the perf risk is specifically paint-triggering properties (layout, filter, shadow, non-trivial color transitions on complex backgrounds), not compositing itself.

### Sources
- [CSS GPU Animation: Doing It Right — Smashing Magazine](https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/)
- [will-change in CSS — jakub.kr](https://jakub.kr/components/will-change-in-css)
- Repo: `desktop/windows/src/renderer/src/orb/orbAnimator.ts` (throttle model, `contextLost` lifecycle discipline), `src/renderer/src/lib/dev/animBench.ts` (jank probe pattern), user memory `windows-dev-gpu-webgl-fix` (software-render dev-build root cause)

---

## 6. Reduced-motion: the compliant middle ground

### The constraint
Product owner wants animations **kept** — `prefers-reduced-motion` compliance must not gut the choreography. The accessibility literature is explicit that this isn't actually in tension: `prefers-reduced-motion` exists for **vestibular triggers** (large-scale movement, spinning, parallax, big zooms) — not for animation in general. WCAG 2.3.3 and mainstream accessibility guidance (Smashing Magazine's "Designing With Reduced Motion For Motion Sensitivities", MDN) converge on the same compliant pattern: **swap large positional/scale motion for opacity/color-only motion of equivalent duration; don't just set every duration to 0.**

### Recommended middle ground, mapped to this app's actual animations

| Animation class | Full-motion behavior | `prefers-reduced-motion: reduce` behavior |
|---|---|---|
| Orb idle orbit / merge / dissolve (rotation, position) | Full rAF choreography per `choreography.ts` | **Keep** — this is small-scale, contained-within-its-own-bounds motion (a ~96px orb), not a large-viewport movement; not a vestibular trigger class per the "large movements/zooms/spinning/parallax" risk list. Do not gate the orb behind the media query. |
| Bar expand/collapse (`bar.css` width/height/border-radius) | Full 170–240ms geometry tween | **Keep**, but drop any translate-based bounce/overshoot component if one is added later — contained UI-chrome resizing at this scale reads closer to "opacity/small-scale-change" than "large movement." |
| Page/card entrance slides (`slideInLeft`, `fadeRise`, `fadeDrop`, `pageEnter` — all combine a translate with the fade) | Translate (12–150px depending on element) + opacity, 360–900ms | **Reduce**: keep the opacity fade at its existing duration, drop or shrink the translate distance to near-zero (e.g. 150px → 4px, or 0). This is the textbook "keep the cross-fade, cut the movement" swap — it preserves the temporal choreography (things still arrive in the same sequence with the same timing) without the positional motion that's the actual vestibular-risk component. |
| Sheet/popover/dialog entrance (§2 recommendations) | Slide/scale + fade | **Reduce**: fade only, same duration, transform pinned to final value from frame 0. |
| Focus-visible ring, hover states | Property-list transitions (§4) | **Keep unconditionally** — these are sub-pixel-scale, not a vestibular concern, and disabling them would actively hurt usability (focus needs to be visibly trackable). |
| Any future scroll-linked parallax (§3) | — | **Reduce to none** if ever added — parallax is explicitly named in the accessibility literature as a top-tier vestibular trigger; this is the one category to fully disable rather than downgrade. |

### Implementation
CSS-only, no JS branching needed for most of the above — define the reduced variants inside a `@media (prefers-reduced-motion: reduce)` block that overrides only the `transform`/translate portion of each keyframe/transition, leaving opacity and duration untouched:
```css
@media (prefers-reduced-motion: reduce) {
  @keyframes slideInLeft {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  /* transform removed entirely — opacity-only keyframe of the same duration */
}
```
For the rAF-driven orb (deliberately exempted above), no gating is needed at all — leave `orbAnimator.ts` unconditional. If a future rAF surface *does* need reduced-motion gating (e.g. a hypothetical future parallax), read `window.matchMedia('(prefers-reduced-motion: reduce)').matches` once at animator construction (plus a `change` listener, since this is a live-updatable OS setting) and branch the tween amplitude, not the frame loop itself — keeps one code path instead of forking the whole animator.

### Caveats
- Don't build a settings-page toggle that duplicates the OS setting unless a specific in-app reason emerges — `prefers-reduced-motion` already reflects Windows' own **Settings → Accessibility → Visual effects → Animation effects** toggle, and Windows exposes this natively (unlike some contexts where OS-level reduced-motion is obscure); trust the media query as the single source of truth.

### Sources
- [Understanding Success Criterion 2.3.3: Animation from Interactions — W3C WAI](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html)
- [Designing With Reduced Motion For Motion Sensitivities — Smashing Magazine](https://www.smashingmagazine.com/2020/09/design-reduced-motion-sensitivities/)
- [prefers-reduced-motion CSS media feature — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- Repo: `desktop/windows/src/renderer/src/styles/globals.css` (`slideInLeft`, `widgetFade`, `pageEnter`, `fadeRise`, `fadeDrop` keyframes to gate)
