# 01 — Window Chrome, Materials & Compositing

Scope: how the Windows Electron app should reproduce the macOS Swift app's window chrome
(translucent materials, shape, snap behavior, theme, multi-window popovers) using the best
Windows-native mechanism, grounded in what this repo's Electron build actually supports today.

## Baseline: what we run today

Checked directly against `desktop/windows` on `docs/mac-ui-port-refresh` (2026-07-14):

- **Electron `39.2.6`** (`package.json`). This matters a lot for §1 and §3 below — several
  `backgroundMaterial` bugs were fixed in exactly this range (see §1).
- **Main window** (`src/main/index.ts:299-351`): `titleBarStyle: 'hidden'` + `titleBarOverlay`
  (36px, `color: '#0f0f0f'`, `symbolColor: '#b0b0b0'`), `backgroundMaterial: 'mica'` gated on
  `supportsMica()` (Win11 **build ≥ 22621**, see `src/main/windowsVersion.ts`), else
  `backgroundColor: '#0f0f0f'`. `transparent: false`. Resizable (default true).
- **Bar window** (`src/main/bar/window.ts:177-200`): frameless, `transparent: true`,
  `resizable: false`, `focusable: false`, `hasShadow: false`. Fully renderer-painted (no DWM
  material — transparent windows can't have one, see §1). This window has a hard-won
  persistent-window/no-hide-show pattern documented at the top of the file — **do not touch its
  show/hide mechanics** when working on chrome; it's out of scope here and already solved.
- **Toast window** (`src/main/insight/toastWindow.ts:80-124`): frameless, **opaque**
  (`backgroundColor: '#000000'`, not transparent), `resizable: false`, `focusable: true`,
  `hasShadow: true`, tries `setBackgroundMaterial('acrylic')` → falls back to `'mica'` → falls
  back to none (CSS glass in the renderer).
- **Checkout window** (`src/main/billing/checkoutWindow.ts`): a normal **framed** modal window
  (native title bar). Out of scope for this doc — it's Stripe's hosted page, not app chrome.
- **Capture window** (`src/main/captureWindow.ts`): never shown. Out of scope.
- **CRITICAL constraint**: `src/main/dev/bench.ts` (`applyDevGpuStability`, dev-only —
  `if (app.isPackaged) return`) calls `app.disableHardwareAcceleration()` +
  `use-gl=angle` + `use-angle=swiftshader` + `enable-unsafe-swiftshader` on every dev/worktree
  launch unless `OMI_DEV_HW_GPU=1`, because hybrid-GPU laptops crash the GPU process under
  hardware WebGL. **Packaged (shipped) builds always run hardware-accelerated** — this only
  affects local dev, screenshots, and CI-style verification. Every recommendation below is
  evaluated under both conditions and flagged where they diverge.
- Renderer already leans on **CSS `backdrop-filter`** heavily (`globals.css` `.glass`,
  `.glass-strong`, `.btn-primary`, `.input-field`, `.badge`, all `blur(8–16px) saturate(1.2–1.4)`),
  with an existing **`.glass-flat`** fallback (no `backdrop-filter`) already used for scroll-heavy
  card grids because "live backdrop-blur is the most expensive property to composite" (their
  words, `globals.css:235-238`). This is the seam to extend for §1's software-render finding.
- Mica tint is CSS-driven off a `data-mica` attribute set by `useMicaChrome()` in
  `App.tsx:133-153`, itself driven by an `--omi-mica=1|0` flag passed via
  `webPreferences.additionalArguments` and read in `preload/index.ts:208`
  (`process.argv.includes('--omi-mica=1')`). This exact pattern is the template for the
  `data-soft-render` flag recommended in §1.

---

## 1. Translucent materials (NSVisualEffectView / `.ultraThinMaterial` → Windows)

**Mac mechanism:** `NSVisualEffectView` (window chrome vibrancy, sidebar `.sidebar`/`.hudWindow`
materials) and SwiftUI `.ultraThinMaterial`/`.regularMaterial` (in-content translucency, e.g. a
popover or card). Both are compositor-side effects — cheap, GPU-composited, live-updated as the
desktop/content behind them changes.

**Recommended Windows equivalent, split by layer:**

| Mac layer | Windows equivalent | Cost under software compositing |
|---|---|---|
| Window-level vibrancy (sidebar, whole-window backdrop) | DWM system backdrop via Electron `backgroundMaterial` (`mica` for the main window, `acrylic` for transient toasts) | **Cheap — unaffected.** DWM composites the backdrop; it's set via a Win32 window attribute (`DWMWA_SYSTEMBACKDROP_TYPE`), not through Chromium's own GPU pipeline. |
| In-content glass (cards, buttons, inputs) | CSS `backdrop-filter: blur(...) saturate(...)` | **Expensive — degrades badly.** Requires Chromium's GPU compositor; under `disableHardwareAcceleration()` it falls back to CPU blur. |

**Exact implementation — already correct, keep it:**
```ts
// main window (src/main/index.ts) — long-lived window → 'mica'
...(mica ? { backgroundMaterial: 'mica' as const } : { backgroundColor: '#0f0f0f' })

// toast window (src/main/insight/toastWindow.ts) — transient surface → 'acrylic', graceful fallback
win.setBackgroundMaterial('acrylic')   // try
win.setBackgroundMaterial('mica')      // catch → fallback
// catch → no material, CSS glass in renderer
```
`backgroundMaterial` values: `'auto' | 'none' | 'mica' | 'acrylic' | 'tabbed'`. `mica` = long-lived
app window; `acrylic` = transient/flyout surface; `tabbed` = tabbed title bar look. Requires
**Win11 22H2 (build 22621)+**; Electron docs mark it Windows-only. `win.setBackgroundMaterial()`
is the runtime setter (also usable to react to a future theme toggle).

**Electron version history that matters for our pin (39.2.6):**
- Electron **37** fixed `backgroundMaterial` not applying on a frameless window's *initial*
  creation (PR #46657), **backported to 35 and 36**.
- Electron **38/39** (our range) shipped PR #47920: fixed applying background material on window
  creation, restored the material's live-update animation, and fixed *dynamically* setting the
  material having no effect. **We should already have these fixes at 39.2.6.**
- **Still open as of this research** (issue #46753, filed against 35.2.1, labeled for 35/36):
  material + rounded corners can desync specifically around **maximize/restore**, and the failure
  mode depends on *how* the user maximizes (button click is fine; drag-to-maximize, double-click
  title bar, or button-maximize→drag-restore lose the material and/or the rounded corners). A fix
  PR (#47386) exists but the issue's resolution status in 39.x wasn't confirmed by this research —
  **verify empirically** on our pinned version by dragging the main window to the top edge
  (Win11's drag-to-maximize) and restoring, since our main window is resizable and thus exercises
  this path (bar/toast windows are `resizable: false` and never maximized, so they're unaffected).

**The software-rendering finding (the part of this brief that's actually load-bearing):**
DWM backdrop materials (Mica/Acrylic) are set via a Win32 window attribute the main process calls
into (`DwmSetWindowAttribute` under the hood) — this lives entirely in the **compositor
(`dwm.exe`)**, outside Chromium's rendering pipeline. `app.disableHardwareAcceleration()` /
SwiftShader affects how Chromium rasterizes and composites *page content*; it does not touch how
DWM composites the window surface DWM receives from Chromium. **Conclusion: `backgroundMaterial`
mica/acrylic should render identically in dev (software-rendered) and packaged
(hardware-accelerated) builds** — this is the mechanism to trust for chrome-level translucency
regardless of the GPU-crash mitigation.

CSS `backdrop-filter`, by contrast, is a Chromium **compositor** filter: Chromium only runs the
GPU-accelerated filter path when the source is already in a composited GPU layer; without a GPU
compositor it either falls back to a CPU blur or (per Chromium's filter-effects design doc)
degrades frame budget significantly — one measured case put combined CPU filter compositing at
~14ms of a 16.6ms (60fps) frame budget, before layout/JS/scroll get anything. This directly
explains why `globals.css` already had to add `.glass-flat` (backdrop-filter-free) for scroll-heavy
grids even under normal hardware rendering — under the dev software-render path this cost is worse
and hits every window, not just scroll-heavy ones.

**Actionable recommendation:** extend the existing `--omi-mica=1|0` → `data-mica` flag pattern
(`src/main/index.ts:342` → `preload/index.ts:208` → `App.tsx` `useMicaChrome()`) with a parallel
**`--omi-soft-render=1|0`** flag, set whenever `applyDevGpuStability()` actually disables hardware
acceleration, read the same way in preload, and stamped as `data-soft-render` on `<html>`. Gate
`.glass`, `.glass-strong`, `.btn-primary`, `.input-field`, `.badge` behind
`html:not([data-soft-render='true']) .glass { backdrop-filter: ... }` so dev/soak/CI screenshot
runs automatically render the already-built `.glass-flat`-style flat fallback instead of paying the
CPU-blur cost — keeps visual regression screenshots representative without jank, and needs no new
dependency (same wiring already in the file).

**Where to use which, concretely for this app:**
- Main window canvas / overall app backdrop → `backgroundMaterial: 'mica'` (already done).
- Toast/insight popovers → `backgroundMaterial: 'acrylic'` with mica/none fallback (already done).
- Bar window (transparent, per-pixel-alpha) → **cannot** have a DWM material at all (see §2 — alpha
  windows opt out of DWM composition rounding/materials entirely); correctly stays renderer-painted.
- Cards/buttons/inputs inside any window → CSS `backdrop-filter`, but gated by `data-soft-render` as above; keep `.glass-flat` for any new scroll-heavy or dev-visible surface.

**Sources:**
- [win.setBackgroundMaterial(material) — Electron docs](https://www.electronjs.org/docs/latest/api/browser-window)
- [Issue #46753 — Material/rounded-corner desync on maximize/restore](https://github.com/electron/electron/issues/46753)
- [PR #46657 — backgroundMaterial on initial frameless creation (37, backported 35/36)](https://github.com/electron/electron/pull/46657)
- [PR #46452 — backgroundMaterial visibility on first window draw](https://github.com/electron/electron/pull/46452)
- [Issue #48031 — Windows backgroundMaterial doesn't work (edge cases)](https://github.com/electron/electron/issues/48031)
- [Chromium — Filter Effects design doc (GPU vs CPU filter path)](https://www.chromium.org/developers/design-documents/image-filters/)
- [SwiftShader brings software 3D rendering to Chrome — Chrome for Developers](https://developer.chrome.com/blog/swiftshader-brings-software-3d-rendering-to-chrome)
- [shadcn/ui #327 — backdrop-filter performance issues](https://github.com/shadcn-ui/ui/issues/327)
- Repo: `src/main/index.ts`, `src/main/insight/toastWindow.ts`, `src/main/windowsVersion.ts`, `src/main/dev/bench.ts`, `src/renderer/src/styles/globals.css`, `src/preload/index.ts`

---

## 2. Window shape — rounded corners, shadows, borders

**Mac mechanism:** macOS windows are rounded by the system compositor automatically; a frameless/
custom-chrome Mac window still gets rounded corners + native shadow for free via
`NSWindow` unless explicitly opted out.

**Windows equivalent:** Windows 11 (build ≥ 22000) rounds top-level windows automatically **if the
window presents enough frame information to DWM** (has `WS_THICKFRAME`/`WS_CAPTION`, or a
non-empty non-client area). Electron exposes an opt-in for the ambiguous cases via the
`roundedCorners` `BaseWindowConstructorOptions` flag (default `true`), which is a *hint* to DWM,
not a guarantee — Microsoft's own doc frames it as "if appropriate."

**Three-tier reality per Microsoft's window-rounding doc (`apply-rounded-corners`):**
1. Apps DWM rounds automatically (real frame styles / 1px non-client border) — most Electron
   windows land here.
2. Apps not rounded by policy but *can* opt in — `roundedCorners: true` (Electron) or
   `DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE)` (native) is a hint that can bring these
   back.
3. Apps that **can never be rounded**, even with the opt-in: windows using **per-pixel alpha
   layering** (`transparent: true`) or **window regions**. Our **bar window is in this
   category by construction** — it's fine, because it never shows OS chrome (fully transparent,
   renderer draws its own rounded shape in CSS); this is the correct call, not a gap.
   Also: **apps are never rounded while maximized, snapped, in a VM, in an AVD session, or a WDAG
   window** — by design, not a bug to chase.

**Known interaction bug to check against our toast/checkout windows:** Electron issue #32981 —
`resizable: false` on a frameless window has historically caused **sharp/square corners** on
Win11 even though the same window is rounded with `resizable: true`. Our **toast window**
(`toastWindow.ts`) is `frame: false` + `resizable: false` + **opaque** (`backgroundColor:
'#000000'`, not transparent) — it is exactly the shape that can hit this bug, and it does NOT
currently set `roundedCorners` explicitly (relies on the Electron default `true`, which per this
bug's history is not reliably honored when combined with `resizable: false`).

**Exact implementation — recommended fix for the toast window:**
```ts
// toastWindow.ts ensureWindow() — add explicit opt-in (harmless if already rounded by default)
const win = new BrowserWindow({
  // ...existing options...
  roundedCorners: true // explicit hint; Windows 11 22000+ only, no-op on older builds
})
```
If live testing on the pinned Electron 39.2.6 shows the `resizable:false` bug still manifests
(square toast corners), fall back to the native API directly — the codebase already loads Win32
DLLs via `koffi` for the bar window's click detection (`src/main/bar/keyState.ts:80`,
`koffi.load('user32.dll')`), so the same pattern applies with zero new dependencies:
```ts
import koffi from 'koffi'
const dwmapi = koffi.load('dwmapi.dll')
const DwmSetWindowAttribute = dwmapi.func(
  '__stdcall',
  'DwmSetWindowAttribute',
  'long',
  ['void *', 'uint32', 'void *', 'uint32']
)
const DWMWA_WINDOW_CORNER_PREFERENCE = 33
const DWMWCP_ROUND = 2 // or DWMWCP_ROUNDSMALL = 3 for a smaller 4px radius (menus/small popovers)
const pref = Buffer.alloc(4)
pref.writeInt32LE(DWMWCP_ROUND)
DwmSetWindowAttribute(
  win.getNativeWindowHandle().readBigUInt64LE ? win.getNativeWindowHandle() : win.getNativeWindowHandle(),
  DWMWA_WINDOW_CORNER_PREFERENCE,
  pref,
  4
)
```
(`win.getNativeWindowHandle()` returns a `Buffer` containing the HWND; pass it directly as the
`void *` arg — same call shape as any other koffi Win32 interop already in this codebase.)

**Shadows:** `hasShadow: true` (toast window's current setting) requests the standard Electron/DWM
drop shadow for a frameless window; this has historically been coupled to the same
`WS_THICKFRAME`/resizable machinery as rounding, so verify shadow presence in the same pass as
corner verification — if `resizable:false` breaks rounding it may also flatten the shadow.
The bar window explicitly sets `hasShadow: false` (correct — it's per-pixel-alpha and paints its
own soft shadow in CSS if wanted, matching how it already paints its own rounded shape).

**Borders / 36px drag strip refinements (Mac toolbar parity):**
- Current: `titleBarOverlay.height: 36` matches `TitleBar.tsx`'s `h-9` (36px) drag strip, and
  `color`/`symbolColor` are pulled from `shared/chrome.ts` (`APP_BG_HEX = '#0f0f0f'`,
  `WCO_SYMBOL_HEX = '#b0b0b0'`) — single source of truth with the CSS tokens, which is the right
  pattern; keep it.
- The code's own comment (`index.ts:314-326`) already did the empirical legwork here: Windows
  **flattens the overlay's alpha** (a translucent `titleBarOverlay.color` renders opaque, no
  desktop bleed-through), so the overlay color must exactly equal the *opaque-rendered* strip tone,
  not the raw translucent CSS value. This is a real Electron/DWM limitation (the WCO caption
  cluster is a separate DWM-owned surface, not part of the Chromium-composited page) — nothing to
  fix, just don't relitigate it if a future Mica tint change makes the strip's rendered color drift
  from `#0f0f0f`; re-derive `APP_BG_HEX` from the *opaque* rendered tone, not the CSS rgba value.
- Mac's toolbar buttons (traffic lights) sit inset ~13px from the left edge at a fixed vertical
  center in a ~28px-tall strip; Windows caption buttons are fixed by the OS to the top-right at
  `titleBarOverlay.height` and cannot be repositioned or restyled beyond `color`/`symbolColor` —
  there's no Windows equivalent of moving/inset-ing the button cluster. Match Mac's *visual weight*
  (subtle, low-contrast, blends into the strip) via `symbolColor` alone, which is already what
  `WCO_SYMBOL_HEX = '#b0b0b0'` (a muted `--text-tertiary`, not full white) does.

**Sources:**
- [Apply rounded corners in desktop apps for Windows 11 — Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-rounded-corners)
- [DWM_WINDOW_CORNER_PREFERENCE enum — Win32 API — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_window_corner_preference)
- [Issue #32981 — Frameless window has sharp corners on Win11 when not resizable](https://github.com/electron/electron/issues/32981)
- [Issue #38834 — roundedCorners option feature request / Win11 discussion](https://github.com/electron/electron/issues/38834)
- [BaseWindowConstructorOptions — `roundedCorners` — Electron docs](https://www.electronjs.org/docs/latest/api/structures/base-window-options)
- Repo: `src/main/insight/toastWindow.ts`, `src/main/bar/window.ts`, `src/main/bar/keyState.ts` (koffi pattern), `src/renderer/src/components/layout/TitleBar.tsx`, `src/shared/chrome.ts`

---

## 3. Snap Layouts / maximize behavior with custom titlebars

**Mac mechanism:** the green traffic-light button offers a native fullscreen/tile menu on hover
(Stage Manager / tile-left/tile-right), OS-owned, no app code involved beyond providing a
standard `NSWindow` zoom button.

**Windows equivalent:** Windows 11 Snap Layouts — hovering (or holding) the maximize button in the
**native caption-button cluster** pops the snap-position flyout. This *only* works if the maximize
button is the OS's own button, which is exactly what `titleBarOverlay` gives you (the "Window
Controls Overlay" — WCO — a real Win32/DWM-owned button cluster rendered on top of the page, not a
DOM element).

**Exact implementation — already correct, nothing to add:**
```ts
titleBarStyle: 'hidden',
titleBarOverlay: { color: APP_BG_HEX, symbolColor: WCO_SYMBOL_HEX, height: 36 }
```
This is the *only* way to get Snap Layouts with a custom title bar in Electron — a fully custom
DOM-drawn maximize button (`-webkit-app-region: no-drag` + a React button calling
`win.maximize()`) does **not** get the hover flyout, because Windows keys the flyout off the real
OS caption button, not off maximize *behavior*. Do not replace the WCO with a DOM button for
styling reasons — you'd silently lose Snap Layouts.

**Pitfalls to watch for:**
- **DOM cannot draw under the overlay rect.** `titleBarOverlay` reserves its `height` × (button
  cluster width, OS-determined, not configurable) region; any interactive DOM there is inert. Our
  36px drag strip (`TitleBar.tsx`) is `-webkit-app-region: drag` and otherwise empty, so this is
  already respected — just don't add interactive content into that strip without accounting for
  the reserved right-hand region.
- **Historic per-version breakage:** the maximize button silently failing to respond to hover (no
  flyout, or clicks not registering) was reported for Electron 18–21-alpha.1 and for windows on a
  secondary/external monitor (#35245); both were version- and multi-monitor-specific regressions
  in Electron's WCO plumbing, not something the app can work around — if a future Electron bump
  regresses this, it shows up as "maximize works but Snap Layouts don't," which is a very specific,
  easy-to-miss symptom to smoke-test after any Electron version bump (hover the maximize button on
  the primary AND a secondary monitor and confirm the flyout appears).
- **`titleBarOverlay` requires `titleBarStyle` to be anything other than `'default'`** — we already
  use `'hidden'`, correct.
- No dynamic re-theming today: `win.setTitleBarOverlay({...})` exists for runtime color updates
  (e.g. a future light/dark toggle) but isn't called anywhere, matching the code's own comment that
  "the app has no theme/backdrop switching." If dark/light theming is ever added, this is the API
  to call from a `nativeTheme.on('updated')` listener (see §4).

**Sources:**
- [Custom Title Bar / Window Controls Overlay — Electron docs](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [Support snap layouts for desktop apps on Windows 11 — Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)
- [Issue #35245 — WCO maximize button doesn't work with external monitor](https://github.com/electron/electron/issues/35245)
- [PR #29600 — enable Windows Control Overlay on Windows](https://github.com/electron/electron/pull/29600)
- Repo: `src/main/index.ts:299-334`, `src/renderer/src/components/layout/TitleBar.tsx`

---

## 4. Dark theme — frame colors, `titleBarOverlay`, `nativeTheme`, startup white-flash

**Mac mechanism:** SwiftUI/AppKit follow `NSAppearance`, and the whole chrome (materials, controls,
titlebar) re-themes automatically; the app also sets an explicit dark appearance since Omi is
dark-only today (matches the Windows app's current all-dark design).

**Current state (dark-only, matches Mac's locked palette):** no `nativeTheme` usage anywhere in
`src/main`, single static `titleBarOverlay.color`/`symbolColor`, static `backgroundColor`/
`backgroundMaterial`. This is correct for a dark-only app — do not add `nativeTheme` machinery
speculatively; only wire it if/when a light mode ships.

**If a light/dark toggle is ever added, exact implementation:**
```ts
import { nativeTheme, BrowserWindow } from 'electron'

function titleBarColorsFor(dark: boolean) {
  return dark
    ? { color: APP_BG_HEX_DARK, symbolColor: WCO_SYMBOL_HEX_DARK }
    : { color: APP_BG_HEX_LIGHT, symbolColor: WCO_SYMBOL_HEX_LIGHT }
}

nativeTheme.on('updated', () => {
  const { color, symbolColor } = titleBarColorsFor(nativeTheme.shouldUseDarkColors)
  for (const win of BrowserWindow.getAllWindows()) {
    win.setTitleBarOverlay({ ...titleBarColorsFor(nativeTheme.shouldUseDarkColors), height: 36 })
    win.setBackgroundColor(color)
  }
})
```
`backgroundMaterial` itself doesn't need re-setting on theme change — Mica/Acrylic auto-adapt to
system light/dark, only the *fallback* flat `backgroundColor` and the WCO overlay need explicit
updates.

**Startup white-flash prevention — already correct, verify it stays this way:**
```ts
show: false,                         // don't paint until ready
backgroundColor: '#0f0f0f',          // (or omitted when Mica is active — see below)
```
```ts
mainWindow.on('ready-to-show', () => { if (!startHidden) mainWindow.show() })
```
This is the documented Electron pattern: create with `show: false`, set `backgroundColor` up
front (still recommended even with `ready-to-show`, since it's what paints for the few ms between
window creation and first composite), show only on `ready-to-show` — confirmed as flash-free by
Electron's own guidance and by issue reports where *skipping* `backgroundColor` on a dark app
produced a visible white flash even with `ready-to-show` correctly wired (#46602). One nuance
specific to our Mica path: when `mica` is true we pass `backgroundMaterial: 'mica'` **instead of**
`backgroundColor` (`index.ts:336`) — worth a quick empirical check that the pre-paint frame under
Mica doesn't flash the *system* light/dark default before the CSS `data-mica` tint applies, since
Mica's own base color is theme-driven and our `useMicaChrome()` effect only stamps `data-mica`
after React mounts (a few ms later than `ready-to-show`). If a flash is ever observed there, the
fix is to also pass an explicit dark `backgroundColor` fallback used only for that pre-composite
gap even in the Mica branch (harmless — Mica draws over it once active).

**Sources:**
- [BrowserWindow — Electron docs (`ready-to-show`, `backgroundColor`)](https://www.electronjs.org/docs/latest/api/browser-window)
- [Issue #46602 — Initially hidden BrowserWindow with dark background flashes white](https://github.com/electron/electron/issues/46602)
- [Issue #45774 — White flash on `BrowserWindow.show()` when animation effects disabled](https://github.com/electron/electron/issues/45774)
- Repo: `src/main/index.ts:299-363`, `src/renderer/src/App.tsx:126-153`, `src/shared/chrome.ts`

---

## 5. Multi-window: toasts/popovers as separate frameless windows

**Mac mechanism:** `NSPopover`/attached panels render inside the app's window layer or as
borderless auxiliary windows with vibrancy, generally non-activating (don't steal focus) unless
the user interacts.

**Windows equivalent — already the app's approach, and the right one:** separate small frameless
`BrowserWindow`s (`toastWindow.ts`, `bar/window.ts`) shown via **`showInactive()`**, not `show()`
— this is the correct Electron primitive for "appear without stealing focus," and both windows
already use it correctly (`toastWindow.ts:145,160,176`, and the bar's `unparkWindow`/prime path
never calls focus-stealing `show()`).

**Click-through — the codebase already has the definitive writeup; don't re-derive it.** The bar
window's extensive top-of-file comment and the `clickTick`/`applyClickThrough` machinery in
`src/main/bar/window.ts` document the two root causes of the known overlay click-trap and their
fix:
1. **DWM/DirectComposition hit-tests transparent windows against the composited frame's alpha
   channel**, not window/logical state — clicks fall through transparent regions regardless of
   `setIgnoreMouseEvents` state (Electron #1335, #48064). This reproduces even under software
   compositing (SwiftShader), so it's not a GPU-toggle-fixable issue.
2. **`setFocusable(false)` makes Chromium's `HWNDMessageHandler::OnMouseActivate` return
   `MA_NOACTIVATEANDEAT`**, discarding the mouse-down before the window proc sees it.

**Mitigation already implemented (the pattern to reuse for any future toast/popover window):**
- `win.setIgnoreMouseEvents(true, { forward: true })` by default — click-through, but mouse-move
  events still forward so the renderer can track hover for its own interactive islands.
- Real hit-testing (`setIgnoreMouseEvents(false)`) toggled **only** while the cursor is over the
  window's visible surface — both a renderer-driven belt (`bar:setInteractive` IPC) and, because
  hardware clicks are physically eaten while non-focusable (root cause #2 above), a **main-process
  poll of the physical mouse button via `GetAsyncKeyState`** (`bar/keyState.ts`,
  `makePrimaryMouseButtonSampler`) as the actual source of truth for click detection — this is
  the mitigation for the click-trap, and it's specific to non-focusable transparent windows. A new
  toast/popover that is `focusable: true` (like today's `toastWindow.ts`, which sets
  `focusable: true` specifically "or Chromium won't route mouse input to it") does not need this
  poll — only a `focusable: false` + `transparent: true` window (the bar's regime) does.
- `win.setAlwaysOnTop(true, 'screen-saver')` on both — keeps the popover above fullscreen-ish
  surfaces without needing real Z-order fights.
- Content protection (`setContentProtection`) applied per-window as a user toggle, not hardcoded —
  keep that pattern for any new privacy-sensitive floating surface.

**Guidance for any *new* toast/popover window (a Windows-native equivalent to a Mac popover):**
- If it needs to be genuinely non-interactive except on hover (peek-style), copy the bar's
  `focusable: false` + `setIgnoreMouseEvents` + `GetAsyncKeyState` poll regime — but only if it's
  also **transparent**; per-pixel-alpha is what makes click-through necessary at all.
- If it's a normal opaque toast the user can click into (like `toastWindow.ts`), keep
  `focusable: true` + `showInactive()` — simpler, no click-trap, and gets the DWM material +
  rounding entitlements that transparent windows forfeit (§1, §2).
- Never call `win.show()` / `win.focus()` on a toast/popover unless the interaction genuinely
  requires taking focus (e.g. the bar's `expanded` mode, which explicitly calls `win.focus()`
  because "the user asked to type").

**Sources:**
- [Issue #23042 — Click-through frameless/transparent window not supported](https://github.com/electron/electron/issues/23042)
- [Issue #26512 — frameless window steals focus when calling maximize()](https://github.com/electron/electron/issues/26512)
- [Issue #8649 — Hidden windows can steal focus from non-hidden ones](https://github.com/electron/electron/issues/8649)
- [BaseWindow — `setIgnoreMouseEvents`, `showInactive` — Electron docs](https://www.electronjs.org/docs/latest/api/base-window)
- Repo: `src/main/bar/window.ts` (full click-trap writeup + fix, lines 1-30 and 577-629), `src/main/bar/keyState.ts`, `src/main/insight/toastWindow.ts`

---

## 6. What best-in-class Mac-first Electron apps do on Windows

Direct teardown access (DevTools-inspecting a live install, or an official engineering writeup)
was not obtainable for a from-scratch comparison in this pass — flagging rather than fabricating.
What is verifiable from the Electron ecosystem itself:

- **Mica/Acrylic adoption is still the exception, not the rule**, even among well-resourced
  Electron apps as of this Electron-39-era research window — one general survey of the space
  states plainly that "while the OS has moved towards organic, light-reactive materials like Mica
  and Acrylic, most Electron apps remain stubborn, flat, opaque rectangles," which is consistent
  with `backgroundMaterial` only having stabilized (per §1's version history) in the last few
  Electron majors. This is a soft signal, not a hard teardown, but it does mean **shipping Mica on
  the main window + Acrylic on toasts (as this app already does) is ahead of the median
  Electron app**, not catching up to one.
- **Community tooling exists specifically because core Electron support was late**:
  `mica-electron` (GregVido) is a third-party library some apps reached for before Electron's own
  `backgroundMaterial` matured — a signal that this space was DIY-solved by app authors before it
  was a first-class API, which is why version-specific verification (§1) matters more here than for
  a longer-stable Electron feature.
- **Snap Layouts via `titleBarOverlay`/WCO is Electron's only sanctioned path** (§3) and is what
  Microsoft's own docs describe as *the* mechanism for custom-titlebar Windows apps to keep Snap
  Layouts — there is no alternative "what Linear/Notion do differently" pattern to find here; any
  app with a custom titlebar and working Snap Layouts on Windows is using this exact API surface.

**Recommendation given the gap:** if a definitive "how does Notion/Slack/Figma do it" comparison is
needed before finalizing this section, it requires either (a) live DevTools/process inspection of
installed builds (checking `backgroundMaterial`-equivalent DWM attributes on their windows via a
tool like `dwmapi` introspection, or the Win32 Spy++-style approach) or (b) their public engineering
blogs, neither of which turned up in this research pass — this is a gap, not a finding, and should
not be treated as "they don't use materials" without direct verification.

**Sources:**
- [Implementing Windows 11 Mica & Acrylic Effects in Electron Apps (survey/tutorial)](https://coldfusion-example.blogspot.com/2025/12/implementing-windows-11-mica-acrylic.html)
- [mica-electron — GitHub](https://github.com/GregVido/mica-electron)
- [Mica material — Windows apps — Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)

---

## Open questions for the charter owner (not blocking, flagging per brief)

1. **§1**: does Electron 39.2.6 fully resolve issue #46753 (material/rounded-corner desync on
   drag-maximize/restore)? Needs a live drag-to-maximize/restore smoke test on the main window —
   this research could not confirm PR #47386's merge/backport status into 39.x from the sources
   available.
2. **§2**: does the toast window (`resizable: false`, opaque, frameless) actually show square
   corners on our pinned Electron version? Needs a live screenshot comparison with
   `roundedCorners: true` explicitly set vs. relying on the default. If still square, the koffi
   `DwmSetWindowAttribute` fallback in §2 is ready to drop in.
3. **§6**: no first-party or teardown source was found for Linear/Notion/Figma/Slack/Spotify's
   specific Windows chrome choices within this research pass's time budget — worth a dedicated
   follow-up if the charter needs it as a citation-backed section rather than an inference from
   Electron API history.
