# Mac Shell + Design System Spec (v0.12.72 beta)

> **⚠ Product rulings (2026-07-14, Chris) — these override any contrary guidance below:**
> 1. **Purple ports as-is.** Mac's purple (`#8B5CF6` accents, `#7A4DF2` Home glow, purple user bubbles, etc.) is copied faithfully to Windows. Ignore any instruction below to neutralize/substitute it. The INV-UI-1 invariant + guard test get updated in the first purple-introducing PR (owned by the UI Foundation track).
> 2. **Same as Mac, not ahead.** Where this spec rates a Windows surface "ahead" of Mac, the Mac v0.12.72 design still wins for anything user-visible in the main app — exceptions require a decision gate in PARALLEL-PLAN.md, not a judgment call here.
> 3. **The floating bar/orb overlay is exempt** — it keeps its current Windows design; Mac's bar is a functional reference only.
> 4. Authoritative plan: `../mac-parity-audit/PARALLEL-PLAN.md`.

Scope: main app window chrome, navigation/shell structure, the full design-token layer, and shared components. **Excludes** the notch bar / floating control bar / orb overlay (separate surface, out of scope here).

All citations are `desktop/macos/Desktop/Sources/...` paths against the read-only reference checkout at `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos`. Windows comparison paths are under `C:\Users\chris\projects\omi\.worktrees\mac-ui-refresh\desktop\windows\src\renderer\src`.

---

## 0. The single most important fact for this port

**The Mac app no longer has a persistent sidebar.** A June 2026 redesign ("Redesign macOS home", commit `dcf2c6014`, 2026-06-18) replaced the always-visible left sidebar with a centered "Hub" home screen (wordmark + stat ribbon + ask bar) that expands in-place into inline chat or a "Connect" data-sources tray. The old `SidebarView` still exists in the codebase and still fully works, but it is **gated behind a legacy flag that defaults off**:

```swift
// Desktop/Sources/MainWindow/DesktopHomeView.swift:37
@AppStorage("useLegacyHomeDesign") private var useLegacyHomeDesign = false
...
// DesktopHomeView.swift:581-583
private var showsPrimarySidebar: Bool {
  useLegacyHomeDesign && !hideSidebar
}
```

So out of the box, on every current build: **no sidebar, no persistent nav rail at all**, except while inside Settings (which shows a purpose-built `SettingsSidebar` full-screen takeover) or in the legacy/rewind-only fallback modes. See §5 for the full history and §2 for what replaced it. This is the #1 thing the Windows port's current `Sidebar.tsx` (always-mounted, `/home /conversations /tasks /rewind /apps`) gets structurally wrong relative to the *current* Mac app — Windows still mirrors the **pre-redesign** Mac sidebar. See §6.

---

## 1. Main window chrome

File: `Desktop/Sources/OmiApp.swift`, `Desktop/Sources/MainWindow/DesktopHomeView.swift`.

| Property | Value | Citation |
|---|---|---|
| Window kind | SwiftUI `Window("<title>", id: "main")` inside `WindowGroup`-less `App` scene | `OmiApp.swift:125` |
| Window style | `.windowStyle(.titleBar)` — **native macOS title bar, not hidden/transparent, no custom traffic-light offset.** No Window Controls Overlay hack; standard AppKit chrome. | `OmiApp.swift:134` |
| Default size | 1200×800 (normal mode); 1000×700 in `--mode=rewind` (Rewind-only launch) | `OmiApp.swift:117-119` |
| Minimum size | 1200×680, enforced at the AppKit level via `NSWindow.contentMinSize`/`minSize` (not SwiftUI `.frame(minWidth:)` alone — a `didResize` observer re-pins it every live resize because SwiftUI's automatic resizability otherwise resets it) | `DesktopHomeView.swift:17-18, 472-520` |
| Appearance | **Always forced dark** — `window.appearance = NSAppearance(named: .darkAqua)` set on window discovery/appear/activate. `.preferredColorScheme(.dark)` also set at the SwiftUI root. There is no light mode. | `OmiApp.swift:595,1055`; `DesktopHomeView.swift:410,476` |
| Window title | Dev/non-prod builds: `"<displayName>"` or `"<displayName> Rewind"`. Prod: `"omi v<version>"` / `"omi Rewind"`. Used everywhere as a window-matching prefix (`window.title.lowercased().hasPrefix("omi")`) — fragile but load-bearing plumbing. | `OmiApp.swift:102-114` |
| Background material | **None on the main window.** No `NSVisualEffectView` / vibrancy anywhere in the main window tree. The entire canvas is flat SwiftUI color fills (`OmiColors.backgroundPrimary`, gradients — see §3). The only `.ultraThinMaterial` use in main-window scope is the small floating "Home" pill button (`PageChromeBar`, §4). Contrast: the separate floating control bar (out of scope) *does* use `NSVisualEffectView(material: .vibrantDark)`. | grep across `Desktop/Sources` — `DesktopHomeView.swift:1113` only hit in main-window scope |
| Corner treatment | The **OS window itself has standard square/OS-rounded corners** (no custom window shape). Rounding is applied *inside* the content, to the main content panel only — `OmiChrome.windowRadius = 26pt` continuous corner radius on a `RoundedRectangle` that wraps everything right of the sidebar slot. | `DesktopHomeView.swift:922-937`; `Theme/OmiChrome.swift:5` |
| Root background | `OmiColors.backgroundPrimary` (`#0F0F0F`) fills the whole window behind everything | `DesktopHomeView.swift:408` |
| Content-panel background | `LinearGradient([backgroundSecondary.opacity(0.96) → backgroundPrimary.opacity(0.96)], topLeading→bottomTrailing)`, 1px `border.opacity(0.22)` stroke, `black.opacity(0.22)` shadow (radius 26, y 14) | `DesktopHomeView.swift:920-937` |
| Content padding | Main content area is inset `14pt` from the sidebar/window edges (`.padding(14)` on the `HStack` containing sidebar+content) | `DesktopHomeView.swift:968` |
| Font scaling | Global `fontScale` environment value (0.5–2.0, Cmd +/-/0), applied via `.scaledFont()` everywhere instead of raw `.font()` | `Theme/OmiFont.swift` |

---

## 2. Navigation / shell structure

There are effectively **three navigation regimes** live in the current build, selected by `@AppStorage("useLegacyHomeDesign")` (default `false`) and launch mode:

### 2a. Default (redesigned) regime — no persistent sidebar

`DesktopHomeView.mainContent` (`DesktopHomeView.swift:868-917`): when `useLegacyHomeDesign == false` and not in Settings, **no sidebar is rendered at all.** The content pane fills the whole window (minus the 14pt inset + rounded-panel chrome from §1). Dashboard (`selectedIndex == 0`) renders `DashboardPage.redesignedHome`; every other page (Conversations, Tasks, Rewind, Apps, Memories, etc.) renders full-bleed with a small floating "Home" pill (`PageChromeBar`) top-left to get back:

```swift
// DesktopHomeView.swift:943-952
if !useLegacyHomeDesign && selectedIndex != SidebarNavItem.dashboard.rawValue {
  PageChromeBar(onHome: { selectedIndex = SidebarNavItem.dashboard.rawValue })
    .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 4)
}
```

`PageChromeBar` is a single capsule button, `.ultraThinMaterial` fill, "Home" label + house icon, `OmiColors.border.opacity(0.4)` stroke that turns `success.opacity(0.34)` green on hover (`DesktopHomeView.swift:1082-1126`). This is the *entire* persistent chrome outside the Home hub — no tab bar, no breadcrumbs.

**The redesigned Home ("Hub") itself** (`DashboardPage.redesignedHome`, `DashboardPage.swift:633-693`) is a 3-mode state machine (`HomeStageMode`: `.hub` / `.chat` / `.connect`, `DashboardPage.swift:2058-2070`):

- **`.hub`** (default/idle) — a `GeometryReader`-driven vertical stack, centered:
  1. `"omi."` wordmark (58pt bold rounded serif-ish system font) — only shown when there are no active "What Matters Now" recommendations (`homeHubWordmark`, `DashboardPage.swift:814-821`)
  2. `WhatMattersNowSection` (proactive recommendation cards)
  3. `FocusedGoalsSection` (goal chips)
  4. `HomeStatRibbon` — 4-cell hairline-divided stat strip: Conversations / Tasks / Memories / Screenshots, each cell a nav button to that section (`DashboardPage.swift:824-851, 3274-3338`)
  5. `HomeAskBar` — the persistent pill-shaped chat input (§4)
  6. `homeSuggestionList` — up to 3 suggested-question rows under the ask bar, shown only in hub mode
  All of this is capped at `homeAskBarMinWidth 560 / homeAskBarMaxWidth 980` and grows with typed text width up to that cap (`DashboardPage.swift:1063-1081`).
- **`.chat`** — the hub content is replaced by an inline `ChatMessagesView` panel (barely-visible rounded card, `DashboardPage.swift:855-930`) with the same `HomeAskBar` docked below it. Entered by focusing/typing in the ask bar, tapping a suggestion, or tapping "Ask Omi" in the Connect tray.
- **`.connect`** — the hub content is replaced by a two-column "Connect data ⇄ Use omi memory anywhere" tray (`homeConnectPanel`, `DashboardPage.swift:934-989`): a Sources column (Gmail / Calendar / Files / Notes / Omi Device / More) and a Destinations column (Ask Omi / Claude / ChatGPT-Codex / OpenClaw / Hermes / More), joined by a chevron glyph. Entered via the "Connect" pill inside the ask bar (`HomeAskBarConnectButton`).

Transitions use `Animation.spring(response: 0.46, dampingFraction: 0.86)` (`homeStageAnimation`, `DashboardPage.swift:294`) plus custom `AnyTransition`s (`homeDropFromTop`, `homeHubFade`, `homeSuggestionsFade`, `DashboardPage.swift:2087-2108`). Clicking outside the active panel, or Esc, collapses back to `.hub` (`closeHomeStagePanel`).

A fixed **header row** floats top-right over the hub at all times (`homeHeader`, `DashboardPage.swift:1336-1367`): `HomeStatusButton` (Capture on/off/blocked pill), `HomeListeningStatusButton` (Listening on/off + meeting-mode sub-toggle, reveals on hover), `HomeSettingsMenuButton` (gear icon → popover: Refer a Friend / Discord / Settings).

There is **no dedicated top tab bar, breadcrumb strip, or nav rail anywhere in this regime** — navigation to Conversations/Tasks/Memories/Rewind happens only via the 4 stat-ribbon cells, the Connect tray's device/app affordances, or global Cmd+1..6 keyboard shortcuts (still registered even with no visible nav — `OmiApp.swift:163-213`). Once on a sub-page, the only way back is the floating "Home" pill or Cmd+1/Esc-style app-level nav.

### 2b. Legacy regime (`useLegacyHomeDesign = true`) — the pre-redesign sidebar

Still fully implemented and reachable via a Settings toggle (not found in a quick grep of currently-wired UI — likely dev/internal only at this point, or reachable through Advanced/General settings; flag is `@AppStorage`). This is the **older** design: a persistent left `SidebarView` (`Desktop/Sources/MainWindow/SidebarView.swift`), width `260pt` expanded / `64pt` collapsed, draggable to snap-toggle collapse (drag handle at the sidebar's trailing edge, midpoint = collapse threshold, `SidebarView.swift:110-116, 289-322`).

Sidebar nav item order top→bottom (`SidebarNavItem`, `SidebarView.swift:5-70`; **only `mainItems` render in the list**, i.e. dashboard/conversations/memories/tasks/rewind/apps — chat/focus/insight/settings/permissions/help exist as enum cases but are reached other ways):

| # | Item | Icon (SF Symbol) | Notes |
|---|---|---|---|
| 0 | Home | `house.fill` | |
| 1 | Conversations | `text.bubble.fill` | Icon replaced by a live 4-bar audio-level meter (`SidebarAudioLevelIcon`) when transcribing |
| 3 | Memories | `brain` | |
| 4 | Tasks | `checklist` | |
| 7 | Rewind | `clock.arrow.circlepath` | Icon replaced by a pulsing recording dot (`SidebarRewindIcon`) when capture/transcription active |
| 8 | Apps | `puzzlepiece.fill` | |

(Chat=2, Focus=5, Insight=6, Settings=9, Permissions=10, Help=12 are enum cases used for routing/keyboard-shortcut targets, not sidebar rows.)

Each row: 12pt icon-label gap, `.padding(12h/11v)`, `14pt` continuous corner radius, selected fill `backgroundSecondary`, hover fill `backgroundTertiary.opacity(0.75)`, unselected/selected text `textSecondary`/`textPrimary` (`NavItemView`, `SidebarView.swift:1136-1274`). Optional right-aligned badge (unread count circle, `purplePrimary` fill), status dot (Focus), or a tier lock icon.

Below the nav list: an "Update Available" purple capsule (conditionally, `updateAvailableWidget`), a permission-status stack (Screen Recording / Microphone / Accessibility rows, each a colored capsule with inline Grant/Fix/Reset button), a 1px hairline divider, then the **profile/settings menu button** — a `gearshape.fill` icon in a 34×34 rounded-square tile + "Settings" label + `⋯` chevron, opening a popover (Refer a Friend / Discord / Settings) — `SidebarView.swift:640-718`.

Header (top of sidebar): `herologo` PNG (20×20) + `"omi"` wordmark (22pt bold, tracking -0.5) + collapse toggle (`sidebar.left` SF Symbol) on the same row (`SidebarView.swift:409-455`).

### 2c. Settings — always a full-screen takeover, in both regimes

`SettingsSidebar` (`Desktop/Sources/MainWindow/SettingsSidebar.swift`) replaces whatever nav surface was showing (fixed 260pt width, same look-and-feel as the legacy sidebar). Structure: Back button (chevron.left + "Back", returns to whatever page you were on) → "Settings" title (22pt bold) → search field (magnifying glass, live-filters a flat keyword index of every setting, `SettingsSearchItem.allSearchableItems`) → section list. Sections in order: **General, Rewind, Transcription, Notifications, Privacy, Account, Plan and Usage, Ask omi Floating Bar, Shortcuts, Advanced, About** (`SettingsSidebar.swift:334-346`; `.aiChat` exists in the enum but renders `EmptyView()` — folded into Advanced). Each row: icon + label, selected = `backgroundTertiary.opacity(0.8)` fill, `10pt` radius.

Note the odd cross-mode plumbing: when in Settings, `DesktopHomeView` keeps the legacy `SidebarView` mounted-but-invisible (`.opacity(0).allowsHitTesting(false)`) purely to dodge a SwiftUI tooltip `EXC_BAD_ACCESS` crash on conditional removal (`DesktopHomeView.swift:871-884`, comment explains). Not port-relevant, just explains why the Swift code looks like it's always instantiating a sidebar.

### 2d. Rewind-only launch mode

`--mode=rewind` command-line flag renders `RewindOnlyView` instead of the sidebar+content split entirely (separate top-level branch, not detailed here — out of scope, it's a debug/kiosk launch mode).

---

## 3. Design tokens

### 3.0 Two competing token systems currently coexist

- **`OmiColors` / `OmiChrome` / `OmiFont`** (`Desktop/Sources/Theme/*.swift`) — the original/base design system. Used by the legacy sidebar, Settings, permission rows, chat bubbles, most non-Home surfaces. **This is the system already ported to Windows** (`globals.css` / `tailwind.config.ts` — see §6).
- **`HomePalette`** (private `enum` inside `Desktop/Sources/MainWindow/Pages/DashboardPage.swift:2032-2045`) — a **second, separate palette introduced by the June 2026 Home redesign**, used only by the new Hub/chat/connect surfaces. It is warmer/more editorial (off-white "ink" instead of pure white, a serif display face for numerals/headings) and is **not** ported to Windows at all yet, and not unified with `OmiColors`.

Both are documented below. Any screen spec that touches Dashboard/Home should use `HomePalette`; everything else uses `OmiColors`.

### 3.1 `OmiColors` — base palette (`Theme/OmiColors.swift`)

| Token | Hex | Usage |
|---|---|---|
| `backgroundPrimary` | `#0F0F0F` | Window root background |
| `backgroundSecondary` | `#1A1A1A` | Sidebar, selected nav row, cards |
| `backgroundTertiary` | `#252525` | Hover fills, control surfaces, badges |
| `backgroundQuaternary` | `#35343B` | Toggle track (off state) |
| `backgroundRaised` | `#1F1F25` | Raised panel fill (`omiPanel` default) |
| `border` | `#3A3940` | Hairlines, strokes (almost always `.opacity(0.1–0.4)`) |
| `purplePrimary` | `#8B5CF6` | **Accent** — badges, selected states, links, "Pro" pill, gradients |
| `purpleSecondary` | `#A855F7` | Gradient stop |
| `purpleAccent` | `#7C3AED` | Gradient stop, `.tint()` |
| `purpleLight` | `#D946EF` | Gradient stop |
| `purpleGradient` | linear `[purplePrimary → purpleAccent]`, topLeading→bottomTrailing | |
| `purpleLightGradient` | linear `[purpleSecondary → purpleLight]`, topLeading→bottomTrailing | |
| `textPrimary` | `#FFFFFF` | |
| `textSecondary` | `#E5E5E5` | |
| `textTertiary` | `#B0B0B0` | |
| `textQuaternary` | `#888888` | |
| `success` | `#10B981` | |
| `warning` | `#F59E0B` | also aliased as `amber` (starred items) |
| `error` | `#EF4444` | |
| `info` | `#3B82F6` | |
| `windowButtonClose/Minimize/Maximize` | `#FF5F57` / `#FFBD2E` / `#28CA42` | Not used — native title bar owns traffic lights, these constants appear to be dead/legacy |
| `speakerColors` | 6-color dark set: `#2D3748 #1E3A5F #2D4A3E #4A3728 #3D2E4A #4A3A2D` | Transcript speaker-bubble backgrounds |
| `userBubble` | `#43389F` | Chat "you" bubble — deliberately richer than chrome, softer than flat `purplePrimary` |

`Color(hex:)` init helper: `Color(.sRGB, red:, green:, blue:, opacity:)` from a `UInt` (`OmiColors.swift:69-93`).

**⚠️ Purple / INV-UI-1 note:** the *base* `OmiColors.purplePrimary` family predates the "never use purple" brand rule and appears grandfathered under the project's no-*increase* ratchet (`INV-UI-1`, `docs/product/invariants/brand-ui.md`) — it's still the default `.tint()` (`DesktopHomeView.swift:411`) and shows up in badges, the "Pro" pill, the update-available capsule, sidebar toggle track, etc. This is pre-existing and not a new finding on its own. What **is** a new finding: §3.2's `HomePalette.stageGlow`.

### 3.2 `HomePalette` — redesigned-Home palette (private, `DashboardPage.swift:2032-2045`)

| Token | RGB (0–1) | ≈ Hex | Usage |
|---|---|---|---|
| `paper` | `(0.018, 0.019, 0.021)` | `#050506` | Hub canvas background |
| `panel` | `(0.045, 0.046, 0.052)` | `#0C0C0D` | Settings-menu popover, status-pill resting fill |
| `tile` | `(0.078, 0.078, 0.088)` | `#141416` | Ask bar fill, source/destination tile resting fill |
| `tileHover` | `(0.115, 0.103, 0.142)` | `#1D1A24` | Tile hover fill — note the R/G/B are *not* equal (0.115/0.103/0.142), i.e. this "neutral" hover already leans violet |
| `ink` | `(0.94, 0.925, 0.89)` | `#F0EBE3` | Primary text — warm off-white, not pure `#FFF` |
| `secondary` | `(0.78, 0.765, 0.725)` | `#C7C3B9` | Secondary text |
| `muted` | `(0.49, 0.47, 0.43)` | `#7D786E` | Tertiary/placeholder text |
| `faint` | `(0.36, 0.35, 0.33)` | `#5C5954` | Chevrons, disabled-ish glyphs |
| `hairline` | `(0.155, 0.155, 0.172)` | `#27272C` | Borders/strokes |
| `green` | `(0.17, 0.78, 0.38)` | `#2BC761` | Connected-status dot, "connect" CTA fill |
| `stageGlow` (= `glow`) | `(0.48, 0.30, 0.95)` | **`#7A4DF2`** | Ambient radial-gradient glow, ask-bar focus ring/shadow, hub wordmark shadow, hover glow on source/destination tiles, chat-panel border — **used pervasively across the new Home surfaces** |

**🚩 Finding — new purple usage in the redesigned UI.** `HomePalette.stageGlow` = `#7A4DF2` is squarely in the same violet family as the banned `OmiColors.purplePrimary` (`#8B5CF6`) / `purpleAccent` (`#7C3AED`). It is a **new** token introduced by the June 2026 Home redesign (post-dates the brand-ui invariant's existence) and is used as the ambient ID color of the entire new Home surface: `HomeCanvasBackground`'s three radial gradients (`DashboardPage.swift:2403-2450`), the ask-bar focus glow/shadow (`DashboardPage.swift:2193-2198`), the hub wordmark's drop shadow (`DashboardPage.swift:819`), hover glow/border on `HomeSourceIconTile` / `HomeDataSourceCard` (`DashboardPage.swift:2644-2646, 2796-2798`), and the inline-chat panel's border glow (`DashboardPage.swift:922-928`). This reads as a real INV-UI-1 candidate violation on the Mac side — **do not port this color; use a neutral/white glow instead**, and flag it back for the Mac team per the brief.

One more near-purple accent: `HomeSuggestionRow`'s hover icon/hover-adjacent gold color `Color(hex: 0xE3BF63)` (`DashboardPage.swift:2371`) — **not purple**, it's a warm gold/amber, fine to port as-is.

### 3.3 Typography

- No custom font family — **system font** (SF Pro via `.system(size:weight:design:)`) everywhere except:
  - Hub wordmark `"omi."` and stat-ribbon numerals: `.system(size:, weight: .medium, design: .serif)` (`DashboardPage.swift:816, 3316`) — a deliberate serif accent unique to the new Home, not used anywhere else in the app.
  - `Connect data` / `Use omi memory anywhere` column headers: same serif, size 20 medium (`DashboardPage.swift:1372, 1409`).
- All body/UI text goes through `.scaledFont(size:weight:design:)` (`Theme/OmiFont.swift:41-56`), which multiplies by a global 0.5–2.0 `fontScale` (`Cmd +/-/0`, persisted `UserDefaults` key `fontScale`) — **every literal size below is the *base* size at 1.0× scale.**
- Observed size/weight scale (base OmiColors system, sampled across Sidebar/Settings/DashboardPage):
  - 22pt bold — sidebar/settings page titles
  - 17pt regular/semibold — nav icons (glyph size, not text)
  - 16pt semibold — section headings (chat welcome)
  - 15pt semibold–bold — hub-adjacent labels, ask-bar text (17pt on legacy chat welcome)
  - 14pt regular/medium/semibold — nav row labels, body text, buttons
  - 13pt regular/medium — secondary body, settings rows, search field
  - 12pt regular/medium/semibold — sub-labels, badges, captions
  - 11pt regular/medium/bold — micro-labels, badge counts, breadcrumbs, chevrons
  - 10–9pt — smallest chevrons/badge counts
  - 58pt bold rounded — hub wordmark (one-off, largest text in the app)
  - 22pt medium serif — stat-ribbon numerals (`HomeStatRibbonCell`)
- Monospaced-digit variants (`scaledMonospacedDigitFont`) exist for timers/counters (`Theme/OmiFont.swift:60-68`) but weren't hit in shell files — reserve for tasks/rewind timestamps.

### 3.4 Spacing / layout scale

No named spacing-token enum — spacing is ad-hoc SwiftUI `.padding()`/`spacing:` literals. Recurring values across the shell:

- **4 / 8 / 12 / 16 pt** — the dominant micro-spacing rhythm (icon-label gaps: 8–12pt; row padding: 8–12pt vertical, 12–16pt horizontal)
- **14 / 18 / 20 pt** — content padding, "Home" pill padding
- **30 / 32 pt** — legacy dashboard-widget horizontal/top padding
- Sidebar widths: **260pt** expanded, **64pt** collapsed (both regimes, legacy sidebar and settings sidebar)
- Home hub layout constants (`DashboardPage.swift:286-309`): `homeStageMaxWidth 1360`, side inset `min 30 / max 96` (6% of width), `homeAskBarMinWidth 560 / MaxWidth 980`, `homeStagePanelMaxWidth 1280`, top padding `74`, bottom padding `26`

### 3.5 Corner radii — `OmiChrome` (`Theme/OmiChrome.swift`)

| Token | Value | Usage |
|---|---|---|
| `windowRadius` | 26pt | Main content panel (§1) |
| `cardRadius` | 24pt | `omiPanel()` default — cards |
| `sectionRadius` | 20pt | Section groupings |
| `controlRadius` | 16pt | `omiControlSurface()` default — controls |
| `chipRadius` | 14pt | Chips/pills (also reused ad-hoc for sidebar nav-row radius) |

Ad-hoc radii seen outside this scale: nav rows 14pt/10pt/8pt (sidebar/settings), `HomeAskBar` 29pt capsule-ish rounded rect, `HomeStatRibbon` 16pt, hub tiles 15/17/21/22/26/28pt (all "close to but not locked to" the `OmiChrome` scale — the new Home redesign did not standardize on it).

### 3.6 Shared modifiers — `omiPanel` / `omiControlSurface` (`Theme/OmiChrome.swift:11-72`)

```
omiPanel(fill: backgroundSecondary, radius: cardRadius, stroke: border.opacity(0.28),
          shadowOpacity: 0.14, shadowRadius: 18, shadowY: 10)
omiControlSurface(fill: backgroundTertiary, radius: controlRadius, stroke: nil,
          shadowOpacity: 0.08, shadowRadius: 8, shadowY: 4)
```
Both render a `RoundedRectangle(style: .continuous)` fill + optional stroke + drop shadow. This is the closest thing to a reusable "card" primitive in the base system — but it's under-adopted; most surfaces (sidebar rows, Home tiles) hand-roll their own `RoundedRectangle` fill/stroke/shadow instead of calling these.

### 3.7 Motion

No shared `Animation` token enum. Recurring literals:

- `Animation.easeInOut(duration: 0.15–0.2)` — sidebar collapse, hover fills, tab selection (base system)
- `Animation.easeOut(duration: 0.08)` — page-navigation cross-fade (`pageNavigationAnimation`, `DashboardPage.swift`/`DesktopHomeView.swift`)
- `Animation.spring(response: 0.46, dampingFraction: 0.86)` — Home stage-mode transitions (`homeStageAnimation`, `DashboardPage.swift:294`) — the one true "signature" spring in the redesigned UI
- `Animation.easeInOut(duration: 0.8/1.2).repeatForever(autoreverses: true)` — permission-pulse, update-glow, logo-pulse loops
- Custom transitions: `homeDropFromTop` (offset −46, scale 0.97→1, opacity 0→1), `homeHubFade`, `homeSuggestionsFade` (`DashboardPage.swift:2072-2108`)

### 3.8 Shadows/materials summary

- Cards: `black.opacity(0.14–0.22)`, radius 12–30, y 4–16 (varies by surface, no single token)
- `HomePalette.stageGlow`-tinted shadows on Home surfaces (ask bar focus, wordmark, tiles) — see §3.2 flag
- `.ultraThinMaterial` — only the "Home" pill button and one guidance overlay (`CloudConnectorGuidanceOverlay.swift:654`, out of scope) in main-window scope
- No frosted/vibrancy material anywhere in the persistent shell — everything else is flat fills + shadow

---

## 4. Shared components

### Buttons
No single `ButtonStyle` abstraction — every button hand-rolls its own visual via `.buttonStyle(.plain)` + a custom label. Recurring variants:
- **Icon-only circular** — `HomeIconActionButton` (34×34 circle, `panel`/`tileHover` fill, `hairline` stroke, hover-lightens) and `HomeSettingsMenuButton` (identical shape, opens a popover)
- **Capsule pill w/ status** — `HomeStatusButton` / `HomeListeningStatusButton` (Capture/Listening toggles): icon + label, `green.opacity(0.12/0.20)` fill when active, `panel`/`tileHover` when off, `error`-red tint when blocked; `HomeListeningStatusButton` additionally reveals a secondary mode-icon button on hover
- **Filled circular send/stop** — `HomeAskBar`'s send button: solid white circle + black up-arrow (34×34); stop button: `white.opacity(0.14)` circle + white square/spinner
- **Connect toggle pill** — `HomeAskBarConnectButton`: white-filled + black text when active, `white.opacity(0.07/0.14)` translucent + `ink` text otherwise
- **Rounded-rect CTA** — `HomePrimaryRouteButton` (green `#2BC761` fill, brand icon + label, used for connector "connect" actions)
- **Text/ghost** — Settings' "Retry", collapse chevrons, "All goals" — plain text button, no chrome, color shifts on hover only
- Legacy-system equivalents (`SidebarView`, base `OmiColors`): permission-row Grant/Fix/Reset buttons are small filled capsules (`color` fill, white 11pt semibold text, 10h/4v padding, 6pt radius)

### Cards / tiles
- **`HomeSourceIconTile`** (92pt-tall square-ish tile, icon over 1-line label, green connected-dot badge top-right) and **`HomeDataSourceCard`** (64pt-tall horizontal row card: icon + title/subtitle + action label) — both `tile`/`tileHover` fill, `hairline` stroke, glow-tinted hover shadow (`DashboardPage.swift:2551-2821`)
- **`HomeAIChoiceButton`** — 48pt-tall horizontal rect: icon, title, optional "Connected" label, trailing chevron (`DashboardPage.swift:2823-2925`) — used for both the Connect tray's Ask-Omi/Claude/ChatGPT rows
- Legacy dashboard widgets (Tasks/Goals cards): `backgroundSecondary.opacity(0.65)`, 12pt radius, no stroke
- No generic "Card" component exists in either system — every card type is a bespoke `View` struct with its own fill/stroke/shadow literals

### List rows
- Sidebar nav row (`NavItemView`/`NavItemWithStatusView`) — icon (20pt frame) + label + optional trailing badge/status-dot/lock, 14pt radius, selected = `backgroundSecondary`, hover = `backgroundTertiary.opacity(0.75)`
- Settings row (`SettingsSidebarItem`) — same shape, 10pt radius, selected = `backgroundTertiary.opacity(0.8)`
- Settings search-result row (`SettingsSearchResultRow`) — icon + title/breadcrumb two-line stack, 8pt radius, hover only (no persistent selected state)

### Text inputs
- **`OmiTextEditor`** (`Theme/OmiTextEditor.swift`) — the one shared text-input primitive, an `NSViewRepresentable` wrapping `NSTextView` in an `NSScrollView`. Used by chat composers (main chat + floating bar). Configurable font size (default 13), text color (default white), `textContainerInset` (default 0h/8v), submit-on-Enter (Shift+Enter = newline), auto-quote/dash/text substitution all disabled, IME marked-text state exposed via callback, optional min/max height auto-grow.
- **Plain `TextField`** — used everywhere else (search fields, ask bar): `.textFieldStyle(.plain)`, custom placeholder color via `Text(...).foregroundColor(...)` prompt param. Search fields (`Settings`) get an 8pt-radius `backgroundTertiary` fill + focus-only `purplePrimary.opacity(0.5)` stroke. The Home ask bar (`HomeAskBar`) is its own 29pt-radius pill, `tile` fill, `stageGlow`-tinted focus ring (see §3.2 flag).

### Toggles
- Two independent toggle-switch implementations (no shared `ToggleStyle`):
  - `statusAccessoryToggle` (Sidebar permission rows): 30×18 capsule, `success.opacity(0.9)` on / `backgroundQuaternary.opacity(0.9)` off, 14×14 white thumb
  - `SidebarToggle` (unused-elsewhere generic component): 36×20 capsule, `purplePrimary` on / `error` red off, 16×16 white thumb
  - Windows-sidebar-style mini switches inside `HomeListeningStatusButton`/toggle rows use a custom 7×4-ish pill+dot, not a shared component either

### Dropdowns / menus
- SwiftUI `.popover(...)` used for the profile menu (Sidebar) and the Home settings-gear menu (`HomeSettingsMenuButton`) — both render a `VStack` of `ProfileMenuActionRow`/`popoverButton` rows (icon + label, 8–10pt radius, hover fill) inside a fixed-width (190–220pt) panel on `backgroundPrimary`/`HomePalette.panel`
- No native `Menu`/`Picker` styling captured in shell scope — likely per-settings-section, out of scope here

### Badges / pills
- **Count badge** — small circle (collapsed: 8×8 dot; expanded: `min 14×14`, `9pt bold` white text), `purplePrimary` fill, offset top-right of an icon (`NavItemView`)
- **"Pro" pill** — `purplePrimary.opacity(0.15)` fill, `purplePrimary.opacity(0.3)` stroke, `purplePrimary` 11pt semibold text, currently commented out/unused in the sidebar file but present as a component
- **Status pill** (Home header) — `HomeStatusButton`/`HomeListeningStatusButton`, described under Buttons above (it's simultaneously a status indicator and a toggle)
- **Connected dot** — 5–9pt filled `green` circle, sometimes with a 2px `tile`-colored ring border, used on tiles/rows to indicate a connected integration

### Section headers
- Sidebar/Settings: plain `Text` at 22pt bold, no underline/rule
- Home Connect tray columns: serif 20pt medium title + 12pt medium `muted` subtitle stacked (`sourceColumnHeader`, `DashboardPage.swift:1369-1380`)
- No generic reusable "SectionHeader" component — every screen composes its own title/subtitle `VStack`

### Scrollbars
- Native AppKit scrollbars throughout (`NSScrollView` defaults for `OmiTextEditor`; SwiftUI `ScrollView` elsewhere uses system scrollbars, `showsIndicators: false` set explicitly in Settings/search lists to hide them in favor of the native overlay-on-hover behavior). No custom scrollbar styling found in shell scope.

---

## 5. Structural delta — git history of the shell/nav overhaul

Command run: `git log --oneline -S"<marker>" -- desktop/macos/Desktop/Sources/MainWindow/...` (the literal commit range `0d09ede61b76dc4a144d05809432bf220394ee3a..v0.12.72+12072-macos` requested in the brief returned no hits for these specific files with a straight path-scoped `git log <range> -- <paths>` — the commits exist but sit earlier/differently in that ancestry path per `git log`'s default simplification; `-S` pickaxe search against `--all` found them reliably instead, and every commit below is confirmed present in `v0.12.72+12072-macos`'s history). Chronological order:

| Date | Commit | Subject | What changed |
|---|---|---|---|
| 2026-06-18 | `dcf2c6014` | **Redesign macOS home** | The overhaul commit. `SidebarView.swift` (−231/+… net rewrite), `DesktopHomeView.swift` (202 lines touched), `DashboardPage.swift` (**+2428 lines** — this is where `redesignedHome`/`HomeStageMode`/`HomePalette` were born), deleted `DeviceSettingsPage.swift` (499 lines, folded into the new Connect tray), trimmed `SettingsSidebar.swift`. Net: 2547 insertions / 954 deletions across 11 files. |
| 2026-06-19 | `9e0b8fe43` | **Add legacy macOS Home toggle** | Added `useLegacyHomeDesign` `@AppStorage` flag so the pre-redesign sidebar+dashboard could still be reached (fallback/dev escape hatch) — this is the commit that created the `showsPrimarySidebar` gate described in §0. |
| 2026-07-02 | `984e948ad` | chore: delete dead lib/ui components + salvaged fixes from the discarded button migration (#8858) | Cleanup pass; touched `redesignedHome` incidentally (a discarded parallel button-system migration was reverted/cleaned up here). |
| 2026-07-07 | `27ab406bd` | **desktop: redesigned Home — inline chat, Connect tray, suggested questions** | Added the `.chat` and `.connect` `HomeStageMode` panels and the suggested-questions row — i.e. turned the June 18 static hub into the 3-mode stage machine described in §2a. |
| 2026-07-07 | `fd7b28293` | **desktop: Home round 3 — connect flow chevron, ask-bar attachments, living background** | Added the chevron between Connect-tray columns, drag/drop + paperclip attachments on the ask bar, and the animated `HomeCanvasBackground` radial-gradient "living" background. |
| (later, referenced not fully audited) | `76d79e8f3` | Desktop harness: homeMode snapshot, fault suite, Sentry breadcrumb heartbeat (#9217) | Added `homeMode` to the automation-bridge snapshot contract (`DesktopAutomationBridge.swift`) so `omi-ctl state` can report which Home stage is active — automation-only, no visual change. |

**Old → new nav summary:**
- **Old:** persistent 64–260pt left `SidebarView` on every page, 6 always-visible top-level icons (Home/Conversations/Memories/Tasks/Rewind/Apps) + a bottom profile/settings button + inline permission-status rows + collapse toggle.
- **New:** no persistent nav surface. A single centered "Hub" screen (wordmark, 4-stat ribbon, ask bar, suggestions) is Home; every other section is reached via the stat ribbon or Connect tray and, once entered, has only a single floating "Home" pill button to get back. Settings is unchanged in shape (still a dedicated 260pt sidebar) but is now the *only* persistent nav-rail-shaped surface left in the app.
- The **old `DeviceSettingsPage`** (499 lines) was deleted outright — its "connect your Omi device / import sources" responsibilities were absorbed into the new Home's Connect tray (`homeConnectPanel`).

---

## 6. Windows comparison

Reference: `desktop/windows/src/renderer/src/components/layout/Sidebar.tsx`, `App.tsx`, `styles/globals.css`, `tailwind.config.ts`.

| Area | Mac (current, v0.12.72) | Windows (current) | Drift |
|---|---|---|---|
| **Persistent sidebar existence** | **Gone by default.** Only exists behind `useLegacyHomeDesign=true` (legacy/fallback) or inside Settings. | **Always mounted** except on `/settings` (`App.tsx:51,95`: `hideSidebar = pathname === '/settings'`). 60px/240px (`w-16`/`w-60`) collapse, same shape as Mac's *legacy* sidebar. | **MAJOR DRIFT.** Windows ports the pre-June-18 Mac sidebar model wholesale. There is no Windows equivalent of the redesigned Home Hub (§2a) at all — no stat ribbon, no ask-bar-as-navigation, no Connect tray, no `.hub/.chat/.connect` stage machine. |
| **Sidebar nav items** | Legacy: Home, Conversations, Memories, Tasks, Rewind, Apps (6) | Home, Conversations, Tasks, Rewind, Apps (5 — **no Memories tab**) `Sidebar.tsx:21-27` | Minor/major drift depending on intent — Memories is reachable some other way in Windows or missing; needs its own screen-spec agent to confirm. Icon set also differs (`lucide-react` glyphs vs SF Symbols) — expected, not a defect. |
| **Sidebar quick-toggles** | Screen Recording / Microphone permission rows with Grant/Reset buttons, shown conditionally (only when attention-needed) | "Screen recording" / "Microphone" always-visible toggle rows with mini switches (`Sidebar.tsx:106-143, 241-244`) | Minor drift — Windows always shows the toggles as a settings-style switch; Mac shows them as attention/permission rows that mostly stay hidden once granted, and additionally shows live audio-level bars on the Conversations icon and a pulsing rec-dot on Rewind that Windows doesn't replicate. |
| **Account/profile row** | Bottom "Settings" button (gear icon + "Settings" label + `⋯`), opens a popover (Refer/Discord/Settings) | Bottom account row (avatar/initial + display name), `NavLink to="/settings"` directly, no popover (`Sidebar.tsx:249-282`) | Minor drift — same position/role, different presentation (avatar+name vs gear+"Settings"+popover). |
| **Collapse mechanism** | Drag-handle at sidebar edge (continuous drag, snaps at midpoint) + explicit collapse button | Explicit button only (`PanelLeftClose`/`PanelLeftOpen`), `localStorage` persisted (`COLLAPSE_KEY`) — no drag-to-collapse | Minor drift. |
| **Color tokens** | Two systems: base `OmiColors` (ported) + new `HomePalette` (not ported) — see §3 | `globals.css`/`tailwind.config.ts` **explicitly ports `OmiColors`/`OmiChrome`** 1:1 (`--bg-primary: #0f0f0f`, `--radius-window: 26px`, etc., commented "ported from the macOS app's OmiColors/OmiChrome structure") | **Identical** for the base system — genuinely excellent parity on the token layer that exists. **Missing entirely**: `HomePalette` (paper/panel/tile/ink/secondary/muted/hairline/green/stageGlow) — none of these tokens exist in Windows yet, because the surface that needs them (Home Hub) hasn't been ported. |
| **Purple/accent** | `OmiColors.purplePrimary #8B5CF6` still used as `.tint()` and in several base-system components (badges, "Pro" pill, update capsule); **plus** the new `HomePalette.stageGlow #7A4DF2` used pervasively in Home (§3.2 flag) | Windows correctly ported **white/neutral accent only** — `--accent: #ffffff` / `--accent-contrast: #0f0f0f`, with an explicit code comment citing INV-UI-1 ("accent: white/neutral system... never purple") | Windows is **more brand-compliant than current Mac** here. Do not port `HomePalette.stageGlow` or any residual `OmiColors.purplePrimary` usage forward — Windows' existing white-accent choice is correct and should be the target for any new Home-Hub component work, not Mac's literal purple values. |
| **Window chrome / title bar** | Native `.windowStyle(.titleBar)`, OS traffic lights, no custom drag strip | Custom `titleBarStyle: 'hidden'` + Window Controls Overlay + a `TitleBar.tsx` drag-strip component (native caption buttons preserved via WCO) | Expected/necessary platform difference (Windows has no titlebar-transparent equivalent to `.titleBar` without losing Snap Layouts) — not a defect, just note it's a different mechanism achieving a similar "native chrome" goal. |
| **Corner radius on content panel** | 26pt (`windowRadius`) rounded content panel inset 14pt from window edge, on a square OS window | `--radius-window: 26px` token exists and is ported, but Windows' `.app-canvas`/`.page-outlet` (`globals.css:153-199`) is a flat full-bleed canvas — no evidence of an actual 26px-rounded inset content panel matching Mac's `RoundedRectangle` wrapper (`DesktopHomeView.swift:920-937`) | Needs visual confirmation from a screenshot-driven agent, but the CSS structure suggests **the token exists without the corresponding rounded-panel-with-shadow chrome being applied** the way Mac applies it. Flag for the screens/shell visual-QA pass. |
| **Materials/vibrancy** | None on main window (flat fills only); Windows correctly mirrors this — `--glass-*` tokens exist but are explicitly reserved for "floating surfaces (bar, toasts)" per the CSS comment, main content panels stay solid | Same split (`.glass`/`.glass-subtle`/`.glass-strong` vs `.surface-card-flat`/`.surface-panel` solid variants) | **Good parity**, deliberate and documented. |
| **Fonts** | System SF Pro (+ one-off serif for Home wordmark/numerals) | Inter Variable as the SF-Pro analog, Segoe UI Variable fallback, with an A/B `data-font='segoe'` hook (`globals.css:102-115`) | Reasonable substitution for the base system; **the Home Hub's serif accent (`design: .serif`, §3.3) has no Windows equivalent** since Windows hasn't built the Hub yet. |
| **Motion** | Ad-hoc literals, one signature spring (`response:0.46,dampingFraction:0.86`) for Home stage transitions | Structured `--ease-out`/`--ease-morph`/`--dur-fast/med/slow` CSS custom properties plus named keyframe classes (`slide-in-left`, `fade-in-slow`, `widget-fade`, `bubble-in`, `page-enter`, `fade-rise`/`fade-drop`) (`globals.css:78-83, 393-577`) | Windows' motion system is **more systematized than Mac's** (real named tokens vs scattered literals) — good foundation, but it encodes *legacy-sidebar-era* choreography (`slide-in-left` sidebar entrance, `widgetFade` dashboard widgets) that doesn't map onto the Hub's spring-based stage transitions at all. |

### Overall ratings

| Shell area | Rating |
|---|---:|
| Base design tokens (`OmiColors`/`OmiChrome`/radius/motion primitives) | **Identical** (excellent 1:1 port already) |
| Window chrome (size/min-size/appearance/materials) | **Minor drift** (native-chrome mechanism differs by necessity; behavior equivalent) |
| Navigation structure (sidebar model) | **Missing** — Windows ports the *retired* Mac sidebar; the *current* Mac app has no equivalent screen to Windows' persistent sidebar at all outside legacy/Settings |
| Redesigned Home Hub (stat ribbon / ask-bar-as-nav / chat & connect stages / `HomePalette`) | **Missing** entirely on Windows |
| Settings sidebar shape | **Minor drift** (not directly compared in depth here — flag for the settings screen-spec agent) |
| Accent/purple compliance | Windows is **ahead of** Mac (Mac has an unflagged new-purple regression in `HomePalette.stageGlow`; Windows already made the correct white-accent choice) |
| Shared component inventory (buttons/cards/toggles/badges) | **Major drift** — Mac has no unified component library either (every surface hand-rolls), so there's nothing to "match"; Windows should build its own consistent primitives from the token layer rather than chase Mac's inconsistency 1:1 |

---

## Open questions / flags for the orchestrator

1. **Product decision needed:** should the Windows port target the *current* redesigned Mac Home (Hub/ask-bar/Connect-tray, no persistent sidebar) or keep Windows' existing always-on sidebar? This spec documents both Mac regimes faithfully but does not decide which one Windows should follow — that's a product call, not something inferable from the code.
2. **`HomePalette.stageGlow` (`#7A4DF2`) is a likely INV-UI-1 violation on the Mac side** (§3.2). Recommend reporting this back rather than porting it — Windows' existing white-accent system (`--accent: #ffffff`) is the compliant target.
3. Could not confirm from shell-scope files alone where/whether `useLegacyHomeDesign` is exposed as a user-facing Settings toggle vs. a pure internal/dev flag — a settings-screen research agent should verify this before assuming end users can even reach the legacy sidebar today.
