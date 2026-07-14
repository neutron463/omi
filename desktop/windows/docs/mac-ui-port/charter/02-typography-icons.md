# 02 — Typography & Iconography

Scope: fonts, font rendering, icon system, monospace/code fonts, numerals, emoji. Windows app = Electron + Chromium (Blink/Skia) + React + Tailwind, `desktop/windows/`. Mac app = SwiftUI + CoreText.

## Delta from current state (read this first)

The Windows app **already made most of the right calls**. This section is largely a validation + tightening pass, not a greenfield pick:

- `desktop/windows/package.json` already ships `@fontsource-variable/inter": "^5.2.8"` (bundled, not CDN).
- `src/renderer/src/styles/globals.css` already sets `--font-app: 'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;` with `font-optical-sizing: auto`, applied on `html,body,#root`.
- There is already an A/B escape hatch: `html[data-font='segoe']` swaps the whole app to the Segoe UI Variable stack (Phase 8 typography comparison harness).
- Icons: `lucide-react": "^1.16.0"` is already the only icon package (`grep` of `src/renderer/src` found zero imports from `@phosphor-icons/react`, `@tabler/icons-react`, `@fluentui/react-icons`, `react-icons`, `@heroicons/*`). 49 import sites, 68 unique glyphs, including `Brain` (`Memories.tsx`, `RewindTab.tsx`), `Sparkles` (`GoalStep.tsx`, `TrustStep.tsx`, `GenerateGoalsButton.tsx`, `ConversationDetail.tsx`, `Goals.tsx`), `Mic`/`MicOff` (`BackgroundConsentControls.tsx`, `MicPermissionStep.tsx`, `TrustStep.tsx`, `RewindTab.tsx`, `VoiceSessionSurface.tsx`), gear glyph is `Wrench`/`RotateCcw` (`AdvancedTab.tsx` — no plain `Settings`-gear icon import found despite a naive text-grep hit; those hits were the settings-tab *component* names, not the icon glyph). Waveform is `Waves` (`TranscriptionTab.tsx`) — an earlier grep pass for "Waveform" text was a false positive on the local `WaveformSource` TypeScript type (`shared/types.ts`, used in `Orb.tsx`/`usePushToTalk.ts`/`capture.ts`), not a lucide icon import; there is no lucide icon literally named `Waveform`, only `AudioWaveform`/`AudioLines`/`Waves` — worth confirming which one the audio-visualizer UI actually wants when that component is touched.
- Monospace: no custom `fontFamily.mono` override in `tailwind.config.ts`, so `font-mono` resolves to Tailwind's default stack (`ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`), used in `Markdown.tsx`, `AgentsTab.tsx`, `TranscriptPopup.tsx`, `ConversationDetail.tsx`. A leftover `src/renderer/src/assets/main.css` (electron-vite scaffold boilerplate, largely dead code — `.creator`/`.text`/`.tip`/`.react`/`.ts`/`.action` classes aren't used by the real app UI) separately hardcodes `'Menlo', 'Lucida Console', monospace` and a `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace` stack on a `code` selector — dead weight, flag for cleanup but out of scope here.
- No tabular-numeral font substitution needed at the font-family level — `.tnum` utility already does it via `font-variant-numeric: tabular-nums lining-nums` + `font-feature-settings`.
- No emoji-specific CSS anywhere; no `@fontsource` emoji package.

Net: **keep Inter Variable as primary, keep lucide-react, keep the Segoe fallback chain** — the deltas below are refinements (letter-spacing compensation, `font-synthesis`, dropping dead CSS, filling icon-glyph gaps) not replacements.

---

## 1. Typeface: SF Pro substitute

### Mac reality

SF Pro (and San Francisco generally) ships under Apple's **Apple Design Resources / Apple Fonts license**, not a general-purpose open font license. The current terms (Apple Developer Program License Agreement + the standalone Apple Font License PDF) restrict use to **mockups and software running on Apple's own operating systems (iOS/iPadOS/macOS/tvOS/watchOS/visionOS)**. Specifically: no embedding the font in non-Apple software, no use "for the purpose of creating mock-ups of user interfaces to be used in software products running on any non-Apple operating system," and no use in web content (web content isn't platform-scoped, so serving SF Pro as a webfont breaches the "Apple platforms only" clause regardless of the visitor's OS). There is no commercial license Apple sells to unlock cross-platform use — it is categorically not available for a Windows Electron app. (There exist unofficial repackaged "SF Pro for Windows" installers, e.g. `bradleyhodges/SFWindows` on GitHub — these do not carry a valid redistribution license from Apple and shipping one inside an installed Windows product would be a license violation, not a gray area.)

**Verdict: SF Pro is not legally usable in the Windows Omi app, in any form (system font reference, bundled webfont, or CSS `@font-face` pointing at an extracted TTF).**

### Recommended equivalent

**Primary: Inter Variable** (already bundled via `@fontsource-variable/inter`). Rationale over alternatives:

| Candidate | Verdict | Why |
|---|---|---|
| **Inter** | ✅ current choice, keep | OFL-1.1 (fully free, commercial-safe). Independent metric comparison puts Inter at ~88% visual similarity to SF Pro Display — both are screen-first grotesques with a tall x-height, open apertures, and optical-size support (`opsz` axis), which is the single biggest lever for matching SF Pro's per-size tuning (Text vs Display cuts). Inter reads slightly warmer/more humanist than SF Pro's cooler, more geometric-DIN character, but at 11–15px UI sizes this difference is close to imperceptible. |
| Geist (Vercel) | Viable alternative, not recommended as primary | OFL-licensed, explicitly designed as an SF-Pro-for-product-UI analog (shares SF Mono/SF Pro/Univers/Inter as stated influences), tighter/sharper terminals give it a slightly more "technical" feel than SF Pro's softer curves. Reasonable second choice if Inter's warmth reads wrong in a future review, but there's no basis to force a swap given Inter already tests near-identical and is already wired through the whole app (Tailwind config, CSS var, fontsource package). |
| Segoe UI Variable | Fallback only, not primary | This is Microsoft's own SF-Pro-equivalent (variable, optical-size instances) but its letterforms are visibly more "Windows" (wider apertures, different figure style) and it's Windows-11-only as a system font — Windows 10 users with no local copy silently fall back further down the stack. Correct as position 2 in the stack (matches native Windows apps when Inter fails to load), wrong as primary because the whole point of this charter is Mac-visual-fidelity. |
| Roboto / Noto Sans / Helvetica Neue metric clones | Not recommended | Roboto reads distinctly Android/Material; generic Helvetica clones lack SF Pro's tall x-height and optical-size behavior. No fidelity advantage over Inter. |

**Exact CSS (already correct, keep as-is):**
```css
--font-app:
  'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui,
  sans-serif;
```

### Metric compensation for SF-Pro-like reading at 11–15px

Inter's x-height runs slightly taller and its default tracking slightly looser than SF Pro at small sizes, which can make short UI labels feel a hair wider/airier than the Mac original. Two targeted, low-risk tweaks:

1. **Letter-spacing on small/dense UI text** (labels, nav items, badges, timestamps — the macOS app tracks these tighter than body text). Add a utility rather than a global override so it doesn't fight Tailwind's `tracking-*` scale already in use:
   ```css
   /* Small dense UI text (11-13px): SF Pro Text at these sizes tracks
      slightly tighter than Inter's default. -0.01em-0.011em closes the gap
      without hurting legibility. Do NOT apply to body copy >= 14px — Inter's
      default tracking already reads correctly there. */
   .tracking-sf-tight {
     letter-spacing: -0.011em;
   }
   ```
   Apply to `.section-label` (currently `tracking-wide`, which is the *opposite* direction of the Mac feel — `tracking-wide` adds positive letter-spacing; SF Pro's small caption/label text is closer to neutral-to-tight. Worth an explicit A/B check against a Mac screenshot before flipping it, since `tracking-wide` may have been a deliberate readability choice for all-caps-style labels).
2. **`font-optical-sizing: auto` is already set globally** — keep it; this is exactly the mechanism that makes Inter Variable pick a tighter/sturdier cut at small sizes and a more open one at display sizes, mirroring SF Pro Text vs SF Pro Display. Don't disable it for perf reasons without re-testing the small-size look.
3. Do not blanket-adjust `font-size` to compensate x-height — Inter's larger x-height is legible-neutral at UI sizes (11–15px) and matching pixel-for-pixel cap-height would require lowering `font-size` in a way that shrinks numerals/icons out of alignment with adjacent Lucide icons (which are sized independently). Leave sizes as-is.

### Caveats
- Inter Variable's variable-font file must stay a **single WOFF2** to avoid FOUC across weight jumps; `@fontsource-variable/inter` already ships this correctly (confirm at build time no separate static-weight fallback files got added by mistake).
- `font-optical-sizing: auto` requires the variable font to expose an `opsz` axis — Inter does; verify after any future font package bump.

### Sources
- [Fonts – Apple Developer](https://developer.apple.com/fonts/)
- [Apple Developer Forums — SF Fonts web font allowed?](https://developer.apple.com/forums/thread/127350)
- [APPLE INC. LICENSE AGREEMENT FOR APPLE DESIGN RESOURCES (PDF)](https://developer.apple.com/support/downloads/terms/apple-design-resources/Apple-Design-Resources-License-20230621-English.pdf)
- [SF Pro Display vs Inter: 88% Similar — FontAlternatives](https://fontalternatives.com/compare/sf-pro-display-vs-inter/)
- [An ode to the Inter typeface — Matt Westcott](https://mattwestcott.org/blog/an-ode-to-the-inter-typeface)
- [Geist Font — Vercel](https://vercel.com/font) / [vercel/geist-font — GitHub](https://github.com/vercel/geist-font)
- [Segoe UI Variable: Font Names and Implementation — Tiger Oakes](https://tigeroakes.com/posts/segoe-ui-variable/)
- [GitHub — bradleyhodges/SFWindows](https://github.com/bradleyhodges/SFWindows) (cited as evidence of the unofficial/unlicensed repackaging risk, not a recommendation)

---

## 2. Font rendering: CoreText vs ClearType/DirectWrite/Skia

### Mac reality
CoreText renders SF Pro with Apple's own hinting and subpixel-independent antialiasing (modern macOS does grayscale AA, not subpixel, at standard scaling); weights render close to the type designer's intended contrast, and `-webkit-font-smoothing: antialiased` on macOS Chromium/Safari thins the AA slightly for a lighter, more "Mac-native" look at body sizes.

### Windows reality (Chromium/Electron)
- **`-webkit-font-smoothing` is a no-op on Windows/Linux Chromium.** It only affects macOS WebKit/Blink. Setting it in `globals.css` (already present: `-webkit-font-smoothing: antialiased;` on `html,body,#root`) does nothing on Windows and should not be relied on or removed for "no effect either way" reasons — harmless to leave for the macOS Electron sibling build if one exists, but it buys nothing here.
- Chromium on Windows uses **Skia** for actual glyph rasterization; it only calls into **DirectWrite** for font enumeration, glyph metrics, and glyph bitmap generation, not for shaping/layout. Historically Skia's text-contrast/gamma values didn't match the OS ClearType Tuner or DirectWrite-based apps (Edge), making Chromium text look subtly different from native Windows apps on the same machine. This has been fixed: Chrome 132+ and current Chromium/Electron builds read the Windows ClearType Text Tuner settings and match Edge's contrast, so a modern Electron shell (confirm Electron's bundled Chromium version is recent enough) should already track the user's system ClearType setting correctly — no CSS workaround needed for this specific gap.
- **`font-synthesis: none;`** (or the granular `font-synthesis-weight: none;` / `font-synthesis-style: none;`) should be set explicitly wherever a variable font is used with a `font-weight` value that the font may not natively expose, to prevent Chromium from faux-bolding/faux-italicizing. With Inter Variable (weight axis 100–900, effectively continuous) this is mostly moot since real weights exist across the whole practical range — but it *is* relevant for the Segoe UI Variable fallback tier (`font-weight: 300 700` per Microsoft's named-instance spec) if the app ever requests a weight outside that band (e.g. `font-weight: 200` or `font-weight: 800` falls back to synthesis on Segoe). Recommend adding:
  ```css
  html, body, #root {
    font-synthesis: none; /* Inter/Segoe Variable both expose real weight axes;
      never let Chromium fake a bold/italic cut we don't have on-file. */
  }
  ```
- **`text-rendering: optimizeLegibility` is already set.** This enables kerning + ligatures via a slower text-layout path; fine at Omi's UI text volumes (not a long-document reader), keep it. (No evidence it causes the historical Chromium `text-rendering` perf cliff at this text density — that issue mainly hits very long single text nodes.)
- **Weight visual matching**: SF Pro's Regular (400) reads slightly heavier than Inter's Regular (400) at small sizes on Windows ClearType rendering, because macOS's grayscale AA + CoreText hinting is generally "fatter-looking" than Windows ClearType subpixel AA at the same nominal weight. If a side-by-side screenshot comparison (Playwright, both platforms) shows Windows body text reading visibly lighter than the Mac reference, the fix is **not** a global weight bump (would break the whole `font-weight` scale used by bold/semibold utility classes) — instead, use Inter Variable's fine-grained axis to step *just body text* up ~25–50 weight units (e.g. custom `font-variation-settings: 'wght' 425;` on the base text color class) rather than jumping a whole Tailwind step (400→500 is a visually large jump). Do this only after an actual side-by-side screenshot comparison — don't pre-emptively bump without evidence.

### CSS that helps on Windows (add)
```css
html, body, #root {
  font-synthesis: none;
  /* -webkit-font-smoothing / -moz-osx-font-smoothing: macOS/Firefox-macOS only, no-op on Windows Chromium — harmless to leave, don't rely on it here */
}
```

### Caveats
- Don't add `text-rendering: geometricPrecision` — deprecated in most engines and can hurt Chromium hinting on Windows.
- Verify Electron's Chromium version is ≥132-equivalent for the ClearType Tuner contrast fix; check via `electron --version` → chromium mapping. If the bundled Chromium predates the fix, Windows body text may look slightly heavier/blurrier than a native Segoe UI app regardless of font choice — that's an Electron-version issue, not a CSS one.

### Sources
- [Better text rendering in Chromium-based browsers on Windows — Chrome for Developers](https://developer.chrome.com/blog/better-text-rendering-in-chromium-based-browsers-on-windows)
- [Better text contrast for all Chromium-based browsers on Windows — Microsoft Edge Blog](https://blogs.windows.com/msedgedev/2025/01/30/better-text-contrast-for-all-chromium-based-browsers-on-windows/)
- [Chromium bug 152304 — `-webkit-font-smoothing: antialiased` stopped working / macOS-only](https://bugs.chromium.org/p/chromium/issues/detail?id=152304)
- [font-synthesis-weight — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-synthesis-weight)
- [font-synthesis — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/font-synthesis)

---

## 3. SF Symbols → icon set

### Mac reality
SF Symbols are licensed as "system-provided images" under the **Xcode and Apple SDKs Agreement**, layered with SF Symbols' own terms: usable inside apps built for Apple platforms, but explicitly **not** licensed for use in app icons/logos/trademark-adjacent use, and — as with SF Pro — scoped to Apple-platform software. There is no path to legally bundle SF Symbols glyphs into a Windows Electron app.

**Verdict: cannot ship SF Symbols on Windows — confirmed, same category of restriction as SF Pro.**

### What the Windows app already uses
`lucide-react ^1.16.0` — the **only** icon package imported anywhere in `src/renderer/src` (verified by grep; zero hits for Phosphor, Tabler, Fluent System Icons, Heroicons, react-icons). 68 unique glyphs across 49 import sites. Coverage confirmed by reading actual `import { ... } from 'lucide-react'` lines (not naive text search, which false-positived on the local `WaveformSource` TS type and on component names like `SettingsTabRail`/`SettingRow`): `Mic`/`MicOff` present (`BackgroundConsentControls.tsx`, `MicPermissionStep.tsx`, `TrustStep.tsx`, `RewindTab.tsx`, `VoiceSessionSurface.tsx`); `Brain` present (`Memories.tsx`, `RewindTab.tsx`); `Sparkles` present (5 sites); waveform/audio-visual glyph is `Waves` (`TranscriptionTab.tsx`) — Lucide also ships `AudioWaveform`/`AudioLines` if a more literal waveform glyph is wanted later. Gear/settings glyph: no bare `Settings`-icon import was found in the actual import statements — confirm whether the app needs one (Lucide ships `Settings`/`Settings2`) or whether gear-affordance is handled entirely by page navigation/labels today.

### Comparison: Lucide vs SF Symbols optical match

| Library | Stroke/grid | Optical match to SF Symbols | Weight variants | React package | Verdict |
|---|---|---|---|---|---|
| **Lucide** (current) | 24×24 grid, 2px stroke, rounded joins | Good — both are geometric outline systems with rounded terminals; Lucide is a fork of the discontinued Feather icon set, deliberately kept close to a "system icon" neutral register similar to SF Symbols' default (Regular) weight. | Single default weight; `strokeWidth` prop scales mathematically (not hand-tuned per weight the way SF Symbols' Ultralight–Black or Phosphor's hand-drawn weights are) | `lucide-react`, tree-shakable (`sideEffects: false`; per-icon files ~0.5KB gzipped after tree-shake) | **Keep.** Already integrated, already 68 glyphs deep, optical style is close enough that a wholesale swap would cost real engineering time for a marginal fidelity gain. |
| Tabler Icons | 24×24 grid, 2px stroke (slightly thinner rendering than Lucide's nominal 2px — reads lighter) | Similar structural family to Lucide (both Feather-lineage-adjacent); no meaningful fidelity edge over Lucide for this use case | Single weight | `@tabler/icons-react`, tree-shakable | Not recommended — no material advantage over what's already shipped, pure swap cost. |
| Phosphor | Custom grid | Six weights (Thin/Light/Regular/Bold/Fill/Duotone), **hand-drawn per weight** rather than stroke-width-scaled — closer in spirit to how SF Symbols ships genuinely distinct weight masters (Ultralight…Black), not a mathematical stroke multiply | 6 hand-tuned weights | `@phosphor-icons/react`, tree-shakable | Best fidelity option *if* the app ever needs true multi-weight icons (e.g. matching SF Symbols' `.light`/`.bold` rendering modes at different UI densities) — not currently a need since Lucide's single weight is what's wired everywhere today. Worth keeping in mind only if a future Mac-parity pass specifically needs weight-matched icon states. |
| Fluent System Icons (Microsoft) | 20/24/48px grids, filled + regular/outline variants | This is Microsoft's own SF-Symbols-equivalent (ships with Windows 11's own Fluent UI) — technically the most "Windows-native" choice, but its optical style (more rounded, Fluent's signature corner radii) reads more distinctly Windows/Fluent than Lucide's neutral geometric style, which ironically makes it a *worse* match for Mac visual fidelity, not better. | Outline + Filled | `@fluentui/react-icons`, large package, tree-shaking works but bundle is heavier per-icon than Lucide | Not recommended for this charter's goal (Mac fidelity) — correct choice if the goal were "feel native to Windows" instead. |
| Hugeicons | Broad multi-style catalog | Larger glyph catalog than Lucide/Tabler but less consistent optical discipline across styles; not evidently closer to SF Symbols | Multiple style families | npm package, less mature tree-shaking track record | Not recommended — no fidelity or engineering advantage found over Lucide for the glyphs already in use. |

### Recommendation: keep Lucide, no switch
Rationale: (1) SF Symbols cannot ship regardless of icon-library choice, so the real comparison is "which open outline-icon system reads closest to SF Symbols' default optical style" — Lucide already clears that bar; (2) it's fully wired (68 glyphs, 49 sites) with zero migration cost; (3) tree-shaking is already working correctly (`sideEffects: false`, per-icon imports observed in the grep, e.g. `import { Mic, AppWindow, Power, type LucideIcon } from 'lucide-react'`); (4) mic, brain, sparkles, and waveform (as `Waves`) all resolve in the current Lucide version — only the gear/settings glyph needs a follow-up check (see above) to confirm it's actually needed and, if so, which of `Settings`/`Settings2` matches the Mac gear glyph's optical weight.

### Caveats
- Confirm whether a literal gear icon is needed anywhere (see coverage note above) and add `Settings`/`Settings2` if so — not currently imported despite being commonly assumed present.
- If a future pass wants SF Symbols' `.light`/`.bold` per-context weight variation (e.g. a "thin" icon state in a dense toolbar vs a "bold" state when active/selected), Lucide's `strokeWidth` prop is a workable substitute (`strokeWidth={1.5}` / `strokeWidth={2.5}`) even without switching libraries — try that before reaching for Phosphor's hand-tuned weights.

### Sources
- [The use of SF Symbols — Apple Developer Forums](https://developer.apple.com/forums/thread/724523)
- [SF Symbols License Agreement — Apple Developer Forums](https://developer.apple.com/forums/thread/739523)
- [Lucide for React — lucide.dev](https://lucide.dev/guide/packages/lucide-react)
- [Phosphor Icons vs Lucide — All SVG Icons](https://allsvgicons.com/compare/phosphor-vs-lucide/)
- [Lucide vs Heroicons vs Phosphor Icons 2026 — PkgPulse](https://www.pkgpulse.com/guides/lucide-vs-heroicons-vs-phosphor-react-icon-libraries-2026)
- [Better Than Lucide: 5 Icon Libraries With More Variety — Hugeicons](https://hugeicons.com/blog/design/8-lucide-icons-alternatives-that-offer-better-icons) (used for Fluent/Hugeicons context, not as an endorsement to switch)

---

## 4. Numerals / tabular figures / monospace (code blocks)

### Tabular figures — no change needed
`.tnum` (`globals.css`) already does `font-variant-numeric: tabular-nums lining-nums` + `font-feature-settings: 'tnum' 1, 'lnum' 1`. Inter Variable supports `tnum`/`lnum` OpenType features natively, so this works correctly with the current font — no substitute font is needed for tabular numerals. Confirm it's applied everywhere the Mac app uses fixed-width digits (timers, elapsed-time counters, timestamps) — `TranscriptPopup.tsx`'s `{fmtElapsed(elapsed)}` span currently uses `font-mono text-[10px]` rather than `.tnum`, which also solves digit-jitter (monospace glyphs are uniform width by construction) but at the cost of using the code font for a UI element — either approach is defensible, just be consistent about which one Mac uses for its timer text and match it.

### Monospace / code-block font: SF Mono equivalent
Mac reality: SF Mono is Apple's monospace, Xcode/Terminal default, Apple-platform-only (same license family as SF Pro — not available for Windows).

Current Windows state: `font-mono` (Tailwind default) → `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`. On a Windows machine, `ui-monospace` and `SFMono-Regular` don't resolve to anything (they're Apple-system tokens), so **the stack silently falls through to `Consolas`** — a metrics-mismatched, older-style monospace not chosen for this UI. This is a real gap since `Markdown.tsx` code blocks/inline code, `ConversationDetail.tsx` timestamps, and `AgentsTab.tsx` command snippets all rely on `font-mono`.

**Recommendation: bundle JetBrains Mono Variable** as the code-block font, replacing the implicit `Consolas` fallback:

| Candidate | Verdict | Why |
|---|---|---|
| **JetBrains Mono** | ✅ recommended | OFL-licensed, tallest x-height of the common coding-font set (stays crisp at 12–13px, which matches Omi's small code-snippet sizes in `Markdown.tsx`/`AgentsTab.tsx`), variable-font build available (`@fontsource-variable/jetbrains-mono`), widest static weight range (Thin–ExtraBold) if weight variety is ever needed. |
| Cascadia Code | Viable alternative | Microsoft's own coding font (ships with Windows Terminal/VS Code on Windows) — most "Windows-native" choice, has true cursive italics for comments (neither JetBrains Mono nor Geist Mono has this). Reasonable pick if optimizing for "feels native to Windows dev tooling" rather than raw legibility at small sizes; JetBrains Mono's taller x-height is the better fit for Omi's small in-chat code chips. |
| Geist Mono | Viable alternative | Vercel's SF-Mono-inspired monospace, ~68% visually similar to JetBrains Mono per independent comparison — closer in spirit to the SF Mono original than JetBrains Mono is, but younger/less battle-tested and a smaller weight range. |

Exact implementation:
```bash
# in desktop/windows/
pnpm add @fontsource-variable/jetbrains-mono
```
```css
/* globals.css, alongside the existing Inter Variable import */
--font-code: 'JetBrains Mono Variable', 'Cascadia Code', Consolas, 'Liberation Mono', monospace;
```
```ts
// tailwind.config.ts — add fontFamily.mono so `font-mono` utility class
// (already used in Markdown.tsx, AgentsTab.tsx, ConversationDetail.tsx,
// TranscriptPopup.tsx) picks this up with zero call-site changes:
fontFamily: {
  display: ['var(--font-app)', 'sans-serif'],
  body: ['var(--font-app)', 'sans-serif'],
  mono: ['var(--font-code)', 'monospace']
}
```
This is a single-file font-family swap (Tailwind config) + one new package — no component changes needed since all four current `font-mono` call sites already use the Tailwind utility class rather than hardcoded font-family CSS.

### Sources
- [JetBrains Mono vs Fira Code vs Cascadia Code: The 2026 Showdown](https://moltamp.com/blog/jetbrains-mono-vs-fira-code-vs-cascadia-2026/)
- [Geist Mono vs JetBrains Mono: 68% Similar — FontAlternatives](https://fontalternatives.com/compare/geist-mono-vs-jetbrains-mono/)
- [20+ Best Monospace Fonts of 2026 — madegooddesigns](https://madegooddesigns.com/monospace-font/)

---

## 5. Emoji rendering

### Mac reality
Apple Color Emoji renders via WebKit/CoreText on macOS Safari/Electron; distinctive style choices (teardrop placement, warmer color palette on some glyphs) are part of the Mac app's visual identity wherever emoji appear (e.g. chat messages, reactions, any emoji picker).

### Windows reality
Chromium on Windows renders emoji via **Segoe UI Emoji** (Microsoft's own color-emoji font, `COLR`/`CPAL` format vs Apple's `sbix` bitmap format) — visually distinct art style (flatter, more saturated on some glyphs, different character designs for many faces/objects). This is unavoidable without bundling a replacement emoji font, and doing so carries the **same license problem as SF Pro/SF Symbols**: Apple Color Emoji itself is Apple's copyrighted artwork, not separately licensed for redistribution. (An unofficial repackaging exists — `samuelngs/apple-emoji-ttf` — but it carries the same unlicensed-redistribution risk flagged for `SFWindows` above; not recommended to bundle.)

### Recommendation
Accept Segoe UI Emoji as the Windows emoji rendering — do not attempt to bundle an Apple-emoji-alike font (license risk, plus a visual mismatch against every *other* Windows app the user has open would look more jarring than Segoe emoji looking different from Mac). If Omi ever needs guaranteed-consistent emoji across platforms (e.g. custom in-app reactions where pixel-identical rendering matters for a shared feature like reaction bubbles), the correct fix is a **fully open, cross-platform color-emoji web font** (e.g. Twemoji, Noto Color Emoji — both OFL/Apache-licensed and safe to bundle) rendered identically on every platform, not an attempt to mimic Apple's specific style. This is a "flag for a future decision if it becomes a problem," not an action item now — grep of `src/renderer` found no emoji usage requiring this today.

### Sources
- [The struggle of using native emoji on the web — Nolan Lawson](https://nolanlawson.com/2022/04/08/the-struggle-of-using-native-emoji-on-the-web/)
- [How Emoji Rendering Works Across Platforms — EmojiFYI](https://emojifyi.com/stories/emoji-rendering-across-platforms/)
- [samuelngs/apple-emoji-ttf — GitHub](https://github.com/samuelngs/apple-emoji-ttf) (cited for license-risk context, not a recommendation to use)

---

## Summary of concrete actions

1. **No font swap.** Keep `Inter Variable` primary / Segoe UI Variable → Segoe UI → `system-ui` fallback chain, exactly as currently wired in `globals.css`.
2. Add `font-synthesis: none;` to the base `html, body, #root` rule in `globals.css`.
3. Consider `.tracking-sf-tight` (or a direct `.section-label` tweak) after a real Mac-vs-Windows screenshot diff — don't apply blind.
4. Bundle `@fontsource-variable/jetbrains-mono`, add `--font-code`, wire `tailwind.config.ts` `fontFamily.mono` to it — fixes the current silent `Consolas` fallback for all four existing `font-mono` call sites.
5. Delete/ignore the dead monospace `font-family` declarations in `src/renderer/src/assets/main.css` (scaffold leftover) when that file is next touched — flagged, not in scope to fix here.
6. **No icon library swap.** Keep `lucide-react`; confirm whether a literal gear/`Settings` icon glyph is needed anywhere in the app (not currently imported) and add it if so.
7. No emoji font bundling — accept Segoe UI Emoji; revisit only if a shared cross-platform emoji feature (e.g. reactions) is built.
