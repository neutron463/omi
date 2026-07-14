# macOS Home / Dashboard — UI Spec (reference: v0.12.72+12072-macos)

> **⚠ Product rulings (2026-07-14, Chris) — these override any contrary guidance below:**
> 1. **Purple ports as-is.** Mac's purple (`#8B5CF6` accents, `#7A4DF2` Home glow, purple user bubbles, etc.) is copied faithfully to Windows. Ignore any instruction below to neutralize/substitute it. The INV-UI-1 invariant + guard test get updated in the first purple-introducing PR (owned by the UI Foundation track).
> 2. **Same as Mac, not ahead.** Where this spec rates a Windows surface "ahead" of Mac, the Mac v0.12.72 design still wins for anything user-visible in the main app — exceptions require a decision gate in PARALLEL-PLAN.md, not a judgment call here.
> 3. **The floating bar/orb overlay is exempt** — it keeps its current Windows design; Mac's bar is a functional reference only.
> 4. Authoritative plan: `../mac-parity-audit/PARALLEL-PLAN.md`.

Surface: the Home/dashboard screen shown after sign-in + onboarding (main app window only — notch bar / floating control bar / orb overlay are explicitly out of scope for this doc).

Primary Swift sources:
- `desktop/macos/Desktop/Sources/MainWindow/DesktopHomeView.swift` — top-level app shell, auth/onboarding gate, window chrome, page switch.
- `desktop/macos/Desktop/Sources/MainWindow/Pages/DashboardPage.swift` (4,430 lines) — the Home page itself: both the current "redesigned" Home and the legacy chat-first Home live in this one file, gated by a single `@AppStorage` flag.
- `desktop/macos/Desktop/Sources/MainWindow/Pages/HomeStatusStore.swift` — cached counts (conversations/memories/tasks/screenshots) shown in the stat ribbon.
- `desktop/macos/Desktop/Sources/MainWindow/Dashboard/DashboardIntelligenceStore.swift` — "What Matters Now" recommendations + canonical Goals.
- `desktop/macos/Desktop/Sources/MainWindow/Dashboard/WhatMattersNowSection.swift` — the recommendation cards, focused-goals chips, All Goals sheet, Goal detail sheet.
- `desktop/macos/Desktop/Sources/PostOnboardingPromptViews.swift` — the "Try asking" popup + legacy suggestion banner.
- `desktop/macos/Desktop/Sources/Theme/OmiColors.swift`, `OmiChrome.swift` — shared app-wide color/radius tokens.
- `desktop/macos/Desktop/Sources/MainWindow/Components/TodaysTasksWidget.swift`, `GoalsWidget.swift` — legacy-only Tasks/Goals cards.

## 0. Two Home designs behind one flag

`DashboardPage` renders one of two entirely different UIs based on `@AppStorage("useLegacyHomeDesign")` (default **`false`**):

```swift
// DashboardPage.swift:366-376
private var homeSurface: some View {
    Group {
        if useLegacyHomeDesign { legacyHome } else { redesignedHome }
    }
    .background(useLegacyHomeDesign ? Color.clear : HomePalette.paper)
}
```

- **Redesigned Home (`redesignedHome`, default, ~90% of this doc)** — a centered "hub" stage: no left sidebar, a wordmark, an ask bar, a stat ribbon, and slide-in inline Chat/Connect panels. This is what ships to users today.
- **Legacy Home (`legacyHome`)** — a chat-first layout: collapsible Tasks/Goals widget row above a full chat transcript, permanently visible. Reachable only via **Settings → Advanced → "Show the previous chat-first dashboard instead of the simplified Home"** toggle (`desktop/macos/Desktop/Sources/MainWindow/Pages/Settings/Sections/SettingsContentView+Assistants.swift:1041-1050`). Kept for users who prefer the old flow; not the primary port target but documented in §7 because current Windows Home resembles it more than the redesigned one (see §9).

The toggle also controls whether the left **sidebar** exists at all:
```swift
// DesktopHomeView.swift:581-583
private var showsPrimarySidebar: Bool {
    useLegacyHomeDesign && !hideSidebar
}
```
**In the default (redesigned) mode there is no persistent left sidebar anywhere in the app.** `SidebarView` only mounts when `useLegacyHomeDesign == true`. Navigation happens through the Home stat ribbon, the header's Settings popover, and a small "Home" pill (`PageChromeBar`, `DesktopHomeView.swift:1082-1092`) that appears at the top of every non-Home page.

## 1. Window chrome (applies to every page, incl. Home)

- Window min size 1200×680 (`DesktopHomeView.swift:17-18`), enforced at the AppKit level.
- Content sits inside a rounded container: `RoundedRectangle(cornerRadius: OmiChrome.windowRadius /* 26 */)` filled with a diagonal gradient `backgroundSecondary.opacity(0.96) → backgroundPrimary.opacity(0.96)`, 1px `border.opacity(0.22)` stroke, `shadow(black.opacity(0.22), radius: 26, y: 14)`, padded 14pt from the outer window (`DesktopHomeView.swift:920-968`).
- App forces `.preferredColorScheme(.dark)` — Home has no light mode.
- On non-Home pages (`selectedIndex != .dashboard`) a `PageChromeBar` shows a single pill button "Home" (house icon) top-left inside the rounded container, `.ultraThinMaterial` capsule, green-tinted border on hover. Clicking navigates back to Home. Home itself has no such bar (it *is* the home).
- Page-to-page navigation animation: `Animation.easeOut(duration: 0.08)` (`pageNavigationAnimation`).

## 2. Redesigned Home — layout structure

`redesignedHome` (`DashboardPage.swift:633-693`) is a `GeometryReader`-driven `ZStack`, back to front:

1. `HomeCanvasBackground` — full-bleed background (§4).
2. A near-transparent tap-catcher (`Color.black.opacity(0.001)`) covering the whole stage, present only when `homeMode != .hub`; tapping it collapses back to hub.
3. `homeStage(...)` — the actual content (§3), full-size.
4. `homeHeader` — top-right status pills, `.padding(.top, 26)`, side inset (§5).
5. Apps-catalog popup overlay (opened from "More" tiles in the Connect panel) and the Connect-sheet overlay (app detail / import connector / export destination sheets) — both centered modals with scrim, `Esc`-to-dismiss, `scale+opacity` transitions.
6. `OverlayModalEscapeCatcher` — lets Esc collapse the inline panel back to hub when no modal owns focus.

Sizing helpers (`DashboardPage.swift:286-309`, `1050-1081`):
- Side inset: `min(96, max(30, stageWidth * 0.06))`.
- Stage content max width: 1360pt.
- Panel (chat/connect) max width: 1280pt.
- Ask bar width: hub mode grows from 560pt to 980pt as the user types (measured against the typed text width + 210pt chrome); locked to the full panel width once in chat/connect mode.
- Panel height: `clamp(proxy.height - 132, 440...640)`, vertically centered.

`homeStage` switches on `homeMode: HomeStageMode` (`.hub` / `.chat` / `.connect`, `DashboardPage.swift:2058-2070`) — this is the entire state machine for Home content. Transition animation for the mode switch: `Animation.spring(response: 0.46, dampingFraction: 0.86)` (`homeStageAnimation`).

## 3. Hub stage (`homeMode == .hub`) — the resting state

Vertical stack, centered, built so the wordmark and the bottom cluster never overlap (`homeHubStage`, `DashboardPage.swift:719-782`):

1. **Wordmark** `"omi."` — `Font.system(size: 58, weight: .bold, design: .rounded)`, color `HomePalette.ink`, `shadow(HomePalette.stageGlow.opacity(0.46), radius: 26)`. Only shown while `intelligenceStore.recommendations.isEmpty` (i.e. no "What matters now" cards) — fades out (`homeHubFade` transition: 14pt offset + opacity) once recommendations exist, since the cluster grows taller and needs the room.
2. **Bottom cluster**, in order, each `.frame(width: askBarWidth)`:
   - `WhatMattersNowSection` — up to 3 recommendation cards (§3a). Renders nothing when empty.
   - `dashboardIntelligenceError` — inline error/retry row when `intelligenceStore.error` is set (§6).
   - `FocusedGoalsSection` — focused-goal chip row (§3b). Renders nothing when both focused goals and recommendations are empty (unless `accountGeneration != nil`, in which case it shows "No focused goals").
   - `homeStatRibbon` — the 4-metric strip (§3c).
   - `homeAskBar` — the persistent input pill (§3d).
   - `homeSuggestionList` — up to 3 suggested-question rows (§3e), fades in (`homeSuggestionsFade`: 10pt offset + opacity).

The wordmark's top inset is computed to sit at the true vertical center when the window is tall enough, and lifts (with a 24pt minimum gap) above the cluster when it isn't — `clusterHeight` is estimated at 390pt (no recommendations) or 570pt (with recommendations) purely to keep this calculation from clipping.

### 3a. "What matters now" cards (`WhatMattersNowSection`)
Source: `WhatMattersNowSection.swift:4-45` (`private struct WhatMattersNowCard` :47-143).
- Section only renders `if !store.recommendations.isEmpty` (max 3, see §8 data source).
- Header "What matters now" (15pt semibold) + up to 3 cards in an `HStack`, each `minHeight: 152`, `RoundedRectangle(cornerRadius: 10)` fill `backgroundTertiary.opacity(0.72)`.
- Card content, top to bottom: headline (13pt semibold, 2-line clamp), "why now" body (11pt, 3-line clamp), optional context label with a target icon (9pt), optional evidence-preview row with a link icon (9pt).
- Footer button row (`.controlSize(.small)`):
  - Primary action button, label = `recommendation.recommendedAction` (e.g. "Continue", server-driven text), `.borderedProminent`, white/black.
  - "Later" — `.bordered`.
  - "Dismiss" — `.bordered`, opens a small popover with 3 reason choices ("Already handled" / "Not mine" / "Not useful"); dismissing the popover without choosing still records a no-reason dismiss (`onChange(of: showDismissReasons)`).
- Whole section has `.accessibilityIdentifier("what-matters-now")`; buttons carry per-card automation identifiers (`wmn-primary-<id>`, `wmn-later-<id>`, `wmn-dismiss-<id>`).

### 3b. Focused goals row (`FocusedGoalsSection`)
Source: `WhatMattersNowSection.swift:145-189`.
- If `store.focusedGoals` non-empty: "Focused goals" label (11pt semibold) + up to 5 title chips (10pt medium, capsule, `backgroundSecondary.opacity(0.8)`) + trailing "All goals" text button.
- Else if `store.accountGeneration != nil` (user is in the canonical-goals cohort but has none focused): "No focused goals" + a button that reads "Add goal" (no goals at all) or "Choose focus" (has goals, none focused).
- Else (not in canonical cohort): renders nothing.

### 3c. Stat ribbon (`homeStatRibbon` / `HomeStatRibbon`)
Source: `DashboardPage.swift:823-851` (data), `3274-3338` (view).
- One fused pill, 4 equal cells separated by 1px hairlines, height 76pt, `RoundedRectangle(cornerRadius: 16)` fill `HomePalette.tile.opacity(0.88)`, 1px hairline stroke, drop shadow.
- Cells, each icon (11pt) + value (22pt serif medium) + label (11pt), each clickable and independently hoverable (`tileHover` background on hover):
  | Label | Icon | Value source | Navigates to |
  |---|---|---|---|
  | Conversations | `text.bubble.fill` | `homeStatusStore.conversationCount ?? appState.totalConversationsCount ?? appState.conversations.count` | `.conversations` |
  | Tasks | `checklist` | `homeStatusStore.taskCount ?? incompleteTaskCount` (overdue+today+no-due-date) | `.tasks` |
  | Memories | `brain` | `homeStatusStore.memoryCount ?? memoriesViewModel.totalMemoriesCount` | `.memories` |
  | Screenshots | `photo.on.rectangle.angled` | `homeStatusStore.screenshotCount` (em-dash `—` while nil) | `.rewind` |
  Values are `Int.formatted()` (locale thousands separators).

### 3d. Ask bar (`homeAskBar` / `HomeAskBar`)
Source: `DashboardPage.swift:1008-1028` (wiring), `2113-2316` (view).
- Pill, height 58pt, `RoundedRectangle(cornerRadius: 29)` fill `HomePalette.tile` (opacity 0.92 resting / 1.0 hover-or-focused), glow-tinted 1px stroke (blur 1.8), drop shadow that intensifies on focus.
- Left: paperclip attach button (disabled at `kMaxChatAttachments`), opens `NSOpenPanel` filtered to images/PDF/text/JSON/CSV/HTML types. Also accepts drag-and-drop of file URLs (white-stroke highlight while a drag is targeted).
- Attachment previews (`AttachmentPreviewRow`) render above the input row when present.
- Center: borderless `TextField`, placeholder "Ask omi anything", 15pt, bound to `chatProvider.draftText` (shared with every other chat surface).
- Right, one of 4 mutually-exclusive states (`HomeAskBarActionMode`):
  - **Stop** (sending) — translucent white circle, square-stop glyph or spinner while stopping.
  - **Send** (has text) — solid white circle, black up-arrow.
  - **Connect** (idle, not focused, no text) — "Connect" capsule with a link icon; solid white when the Connect panel is open, translucent otherwise. This is the *default* resting state of the bar.
  - **none** (focused, empty) — no trailing control.
- Tapping anywhere in the bar calls `onActivate` (opens chat mode) and focuses the field. `Return` submits (send or stop depending on state).
- Text is required to send — attachment-only submissions are silently no-ops (`ChatProvider.sendMessage` drops empty text), so the send affordance never appears for attachment-only state.

### 3e. Suggested questions (`homeSuggestionList` / `HomeSuggestionRow`)
Source: `DashboardPage.swift:1030-1048`, `2360-2401`.
- Up to 3 rows, each a full-width pill (42pt tall, `cornerRadius 21`), sparkles icon (amber `#E3BF63` on hover) + question text (13pt medium, 1-line clamp) + trailing arrow-up-right glyph.
- Source: `PostOnboardingPromptSuggestions.suggestions()` if non-empty, else a 3-item hardcoded fallback:
  - "What should I focus on today to achieve my goals?"
  - "What did I spend my time on this week?"
  - "What's the highest-leverage thing I can do next?"
- Tapping opens Chat mode and sends the question immediately (`askHomeSuggestion`).

## 4. Background (`HomeCanvasBackground`)
Source: `DashboardPage.swift:2403-2451`. Layered radial/linear gradients over `HomePalette.paper` (near-black, `#050506`-ish):
- Soft white radial key-light high behind the wordmark (`center (0.5, 0.16)`, opacity 0.040, radius 560).
- Two `HomePalette.stageGlow` (violet-blue, `#7A4CF2`-ish — see §10 palette) radial washes at `(0.48, 0.24)` and `(0.20, 0.78)`, low opacity (0.075 / 0.040).
- A vignette radial darkening toward the edges.
- A thin bottom linear-gradient sheen.
All `.ignoresSafeArea()`.

## 5. Header (`homeHeader`)
Source: `DashboardPage.swift:1336-1367`. Top-right, height 36pt, 3 controls right-aligned:

1. **Capture status** (`HomeStatusButton`, title "Capture", `viewfinder` icon) — screen-analysis / proactive-assistants monitoring toggle. States: **On** (green tint) when `isCaptureLive`; **Blocked** (red `#FF3D4D`) when `isScreenCaptureKitBroken || isScreenRecordingStale || !hasScreenRecordingPermission`; **Off** (muted) otherwise. Clicking toggles; if enabling without screen-recording permission it opens System Settings via `ScreenCaptureService.requestScreenRecordingAccessAndOpenSettings()` instead of turning on. Shows a small spinner while toggling.
2. **Listening status** (`HomeListeningStatusButton`, title "Listening") — transcription on/off. Icon `waveform.circle.fill` (on) / `mic.circle` (off). On hover, reveals a secondary mode-title label ("Always" / "Meetings only" / "In meeting" / "Mic only") and a second small button (person / person.2 icon) that flips `systemAudioCaptureMode` between `.onlyDuringMeetings` and `.always`. Clicking the main button with no mic permission calls `appState.requestMicrophonePermission()` instead of toggling.
3. **Settings gear** (`HomeSettingsMenuButton`, `gearshape.fill`) — popover with 3 rows: "Refer a Friend" (opens `affiliate.omi.me`), "Discord" (opens invite link), divider, "Settings" (navigates to `.settings`).

All three are pill/circle buttons on `HomePalette.tile`/`panel`, hover state lightens fill + border.

## 6. Errors / empty / loading states

- **Intelligence error** (`dashboardIntelligenceError`, `DashboardPage.swift:1820-1850`): inline row (warning-triangle icon, message text, "Retry" button), amber-adjacent, shown under the What-Matters-Now cards whenever `intelligenceStore.error` is non-empty (network failure loading workflow control/goals, or "Saved feedback will retry automatically" after an offline feedback write). `accessibilityIdentifier("dashboard-intelligence-error")`.
- **No recommendations**: `WhatMattersNowSection` renders nothing (not an empty-state card) — the wordmark just stays visible instead.
- **No focused goals, in canonical cohort**: "No focused goals" text row with "Add goal"/"Choose focus" CTA (§3b).
- **Not in canonical intelligence cohort** (`intelligenceStore.accountGeneration == nil`): both What-Matters-Now and Focused-Goals sections render nothing; Home degrades gracefully to wordmark + stat ribbon + ask bar only.
- **App-level loading splash** (before Home ever mounts, `DesktopHomeView.swift:366-393`): pulsing hero logo (72pt, 1.2s ease-in-out pulse, 0.7→1.0 opacity, 1.0→1.08 scale) + `viewModelContainer.initStatusMessage` text + a small `ProgressView`, over `OmiColors.backgroundPrimary`, cross-fades out over 0.3s once `viewModelContainer.isInitialLoadComplete`.
- **Auth-restoring splash**: hero logo (64pt, static) + `ProgressView`.
- **Permission-missing**: no Home-specific permission gate — screen-recording/mic permission gaps surface as the Capture/Listening header pills going to "Blocked"/off + `PermissionsPage` (separate sidebar/nav item, out of scope for this doc) is where the full permission grants live. `ScreenCaptureService.requestScreenRecordingAccessAndOpenSettings()` is the only in-Home permission remediation path (triggered from the Capture pill).
- **Citation loading** (from chat citations, not Home-specific but reachable from Home's inline chat): full-bleed scrim + spinner + "Loading source..." while fetching a cited conversation.
- **Update banner**: `DesktopUpdatePolicyBanner` can overlay top of the whole main content (not Home-specific) when a non-required update is available; a required update blocks with a full-screen scrim + `DesktopRequiredUpdatePrompt`.

## 7. Chat stage (`homeMode == .chat`)

`homePanelStage` → `homeChatPanel` (`DashboardPage.swift:786-810`, `855-930`):
- Same `ChatMessagesView` component used by the standalone Chat page and legacy Home, reused verbatim — full message list, citations, agent-open links, rate buttons, load-more, streaming state.
- Wrapped in a barely-visible glass card: `RoundedRectangle(cornerRadius: 26)` filled with a very faint white/violet gradient (max opacity 0.018), 1px glow-tinted stroke blurred 2.5px, soft shadow — "reads as a bounded surface while still dissolving into the ambient Home canvas."
- Top/bottom fade mask on the message list (5%/97% stops).
- Ask bar re-docks directly beneath the panel (`.padding(.top, 22)`), full panel width now (not the narrower hub width).
- Error card (`dashboardChatErrorCard`) below the ask bar when `chatProvider.currentError` is set.
- Entry/exit transition: `homeDropFromTop` — slides down 46pt from above with a 0.97 top-anchored scale and fade-in, driven by the shared `homeStageAnimation` spring.
- Empty-state welcome (`dashboardChatWelcome`, shown by `ChatMessagesView` when there are 0 messages): 40pt hero logo, "Ask omi anything" (16pt semibold), subtitle "Your personal AI assistant — knows you through your memories and conversations" (13pt, centered, 40pt horizontal padding).
- Esc / clicking outside the panel closes back to hub (`closeHomeStagePanel`).

## 8. Connect stage (`homeMode == .connect`)

`homeConnectPanel` (`DashboardPage.swift:934-990`): two-column tray, `RoundedRectangle(cornerRadius: 28)` on `HomePalette.panel.opacity(0.94)`, close (X) button top-right.

- **Left column — "Connect data" / "Sources Omi learns from."** (serif 20pt heading + 12pt muted subtitle), then 6 rows (`HomeAIChoiceButton`, 48pt tall pills):
  Gmail, Calendar, Files, Notes (Apple Notes), Omi Device, "More" (`+`, opens the Apps popup Imports tab). Each shows a small green dot + "Connected" label when already linked (`homeStatusStore.connectorStatusStore` / `hasOmiDeviceHistory`).
- Center: a circular chevron divider between the two cards (source → destination direction).
- **Right column — "Use omi memory anywhere" / "Bring your memories to the apps you use"**, 6 rows: "Ask Omi" (opens Chat stage), "Claude / Claude Code", "ChatGPT / Codex", "OpenClaw", "Hermes", "More" (`+`, opens Apps popup Exports tab). Connected state same green-dot pattern via `homeStatusStore.memoryExportStatuses`.
- Brand icon set used throughout (`ConnectorBrandIcon.swift:5-19`): `.calendar .gmail .localFiles .appleNotes .chatgpt .claude .codex .openclaw .hermes`.
- Clicking a row opens a centered modal sheet (`homeConnectSheetOverlay`) sized per content type: App detail 500×650, Import connector 520×620, Export destination 520×620 — scrim + scale/opacity transition, Esc-to-dismiss.
- Same `homeDropFromTop` entry animation and hub-width→panel-width sizing as the Chat stage.

## 9. "Try asking" popup (both Home designs, app-shell level)

Not part of `DashboardPage` — lives in `DesktopHomeView.mainContent` as a `ZStack` overlay (`DesktopHomeView.swift:974-996`) so it renders identically over redesigned or legacy Home. Triggered by `.showTryAskingPopup` notification, posted once post-onboarding if `PostOnboardingPromptSuggestions.shouldShowPopup`.
- `TryAskingPopupView` (`PostOnboardingPromptViews.swift:4-129`): centered modal, `clamp(width-72, 560...660)` × `clamp(height-80, 360...520)`, `RoundedRectangle(cornerRadius: 28)` on `backgroundSecondary.opacity(0.98)`, amber (`#E3BF63`) accent stroke + corner gradient, X-dismiss top-right.
- Content: "Suggested first ask" amber pill label, "What would you like to ask omi first?" (32pt serif semibold headline), subtitle, then a vertical list of suggestion rows (sparkles icon, 15pt text, arrow-up-right). Tapping a suggestion opens the floating control bar's AI input pre-filled with that query (`FloatingControlBarManager.shared.openAIInputWithQuery`) — **not** the Home ask bar.

## 10. Palette & typography (Home-specific)

`HomePalette` (private enum, `DashboardPage.swift:2032-2045`) — used only by the redesigned Home, layered on top of the app-wide `OmiColors`:

| Token | Hex (approx) | Use |
|---|---|---|
| `paper` | `#050506` | Canvas background |
| `panel` | `#0B0B0D` | Connect tray fill |
| `tile` | `#141416` | Ask bar / stat ribbon / pill fill |
| `tileHover` | `#1D1A24` | Hover fill (violet-tinted) |
| `ink` | `#F0EBE3` | Primary text (warm off-white, not pure white) |
| `secondary` | `#C7C3B9` | Secondary text |
| `muted` | `#7D786E` | Tertiary text |
| `faint` | `#5C5954` | Quaternary / icon-rest |
| `hairline` | `#28282C` | Borders/dividers |
| `green` | `#2BC761` | Connected/success accent |
| `stageGlow` | `#7A4CF2` | Violet glow used in shadows/background — **note:** this is visually in the purple family; `AGENTS.md` bans purple as an accent for icons/primary actions, but this token is used only as a soft ambient glow/shadow tint, not a solid accent fill. Flag for design review when porting — Windows should confirm whether this glow survives the "never use purple" rule or gets swapped to a neutral glow. |

Shared app-wide tokens still apply to the legacy Home and to `dashboardIntelligenceError`/`WhatMattersNowCard`/`AllGoalsSheet` (all built on `OmiColors`, not `HomePalette`): `OmiColors.swift:8-33` — background `#0F0F0F/#1A1A1A/#252525`, text white/`#E5E5E5`/`#B0B0B0`/`#888888`, `success #10B981`, `warning #F59E0B`, `error #EF4444`. `OmiChrome.windowRadius = 26`, `cardRadius = 24`.

Typography is mostly `.scaledFont(size:weight:)` (respects the app's text-scale setting) at small sizes (9–16pt) for body/labels, with a handful of `Font.system(..., design: .rounded)` (wordmark, 58pt bold) and `design: .serif` accents (stat ribbon values 22pt medium serif; section headings in the Connect tray 20pt medium serif) — the serif is a deliberate editorial accent used sparingly, not the body font.

## 11. Animations summary

| Element | Transition | Timing |
|---|---|---|
| Home mode switch (hub↔chat↔connect) | content swap | `.spring(response: 0.46, dampingFraction: 0.86)` |
| Chat/Connect panel entry | `homeDropFromTop`: -46pt offset, 0.97 top-anchored scale, fade | rides the spring above |
| Wordmark hide (once recommendations appear) | `homeHubFade`: +14pt offset, fade | rides the spring above |
| Suggested-questions reveal | `homeSuggestionsFade`: +10pt offset, fade | rides the spring above |
| Apps popup / Connect sheet open/close | scale(0.95–0.96) + opacity | `.easeOut(duration: 0.2)` |
| Page-to-page nav (leaving/entering Home) | none visible beyond the 0.08s ease-out on the container | `.easeOut(duration: 0.08)` |
| Ask bar focus/hover/attachment changes | opacity/scale of the bar chrome | `.easeOut(duration: 0.16)` |
| Init-loading splash logo | pulse scale 1.0↔1.08, opacity 0.7↔1.0 | `.easeInOut(duration: 1.2).repeatForever` |
| Init-loading splash exit | cross-fade | `.easeOut(duration: 0.3)` |
| Dashboard widgets collapse (legacy only) | opacity + move | `.easeInOut(duration: 0.25)` |

## 12. Data sources (for Windows wiring)

| Widget/element | Swift store/type | Backend surface |
|---|---|---|
| What Matters Now cards | `DashboardIntelligenceStore` (`Dashboard/DashboardIntelligenceStore.swift`) → `client.getWhatMattersNow(deviceID:)`, `client.getCandidateWorkflowControl()` | Canonical task-intelligence "What Matters Now" projection API; gated by `TaskWorkflowControl.workflowMode == .read` and per-account `accountGeneration` |
| Focused goals / All Goals / Goal detail | same store → `getCanonicalGoals`, `getCanonicalGoalDetail`, `focusCanonicalGoal`, `unfocusCanonicalGoal`, `transitionCanonicalGoal`, `createCanonicalGoal` | Canonical Goals API (distinct from the legacy numeric Goal model — see §13 drift) |
| Recommendation feedback (Do now/Later/Dismiss) | `DashboardIntelligenceStore.recordFeedback` + `DashboardFeedbackOutboxDefaults` (UserDefaults-backed offline outbox, keyed `whatMattersNowFeedbackOutbox.v1.<ownerID>`, retried on next `load()`) | `client.recordTaskFeedback`, `client.createTaskOutcome` |
| Stat ribbon counts | `HomeStatusStore` (`Pages/HomeStatusStore.swift`) — cached across navigation, refreshed on 60s+ activation cooldown (`PollingConfig.shouldAllowActivationRefresh`) or force | `APIClient.getConversationsCount`, `MemoryStorage.getLocalMemoriesCount` (local SQLite), `ActionItemStorage.getLocalActionItemsCount` (local SQLite), `RewindIndexer.getStats()` (local), `APIClient.hasOmiDeviceConversations()` (once, then cached per-user in UserDefaults) |
| Connect-panel connection dots | `homeStatusStore.connectorStatusStore` (`ImportConnectorStatusStore`) for imports; `homeStatusStore.memoryExportStatuses` (`MemoryExportService.shared.allStatuses()`) for exports | Local UserDefaults-persisted connector state + `MemoryExportService` |
| Ask bar / Chat panel | `ChatProvider` (shared singleton across Home/Chat page/floating bar — `historyChatProvider` / `ChatProvider.mainInstance`, see desktop AGENTS.md "Chat Continuity Write-Path Contract") | Kernel `main_chat` turns |
| Legacy Tasks/Goals widgets | `DashboardViewModel` → `TasksStore.shared` (tasks), `GoalStorage.shared` + `APIClient.getGoals/createGoal/updateGoalProgress` (legacy numeric goals — local SQLite cache, server sync) | `/v1/goals` (legacy), local action-items store |
| Suggested questions | `PostOnboardingPromptSuggestions.suggestions()` (`Onboarding/OnboardingPromptSuggestions.swift`) | Local, derived from onboarding answers |

## 13. Delta since baseline (0d09ede6, 2026-07-09 → v0.12.72+12072-macos, 2026-07-12)

The full "redesigned Home" (hub/chat/connect stages, `HomePalette`, stat ribbon, ask bar, Connect tray) **already existed at the baseline commit** — confirmed via `git show 0d09ede6:desktop/macos/Desktop/Sources/MainWindow/Pages/DashboardPage.swift | grep HomeStageMode` (present). So this is not a "what changed in the redesign" delta — it's what changed in the 3-day window on top of an already-redesigned Home:

```
git -C C:\Users\chris\projects\omi log --oneline 0d09ede61b76dc4a144d05809432bf220394ee3a..v0.12.72+12072-macos -- \
  desktop/macos/Desktop/Sources/MainWindow/DesktopHomeView.swift \
  desktop/macos/Desktop/Sources/MainWindow/Pages/DashboardPage.swift \
  desktop/macos/Desktop/Sources/MainWindow/Pages/HomeStatusStore.swift \
  "desktop/macos/Desktop/Sources/MainWindow/Dashboard/*"
```
19 commits, most relevant to Home:
- `03e851fa8` **feat(desktop): add What Matters Now and canonical goals** — this is the commit that introduced the §3a/§3b/§8 (goal-detail sheet) intelligence layer's *data plumbing* into this window (the UI shell for it already existed; this wired the real canonical-goals/What-Matters-Now backend calls in).
- `65723019c` feat(tasks): add contextual resurfacing gates — the `.openWhatMattersNowRecommendation` / `ContextualTaskNavigationRouter` deep-link path that lets a background notification open a specific recommendation card on Home.
- `3f7bf4353` / `f29326703` / `23cad87cc` — Home status caching across navigation + scoping the cache by account (`HomeStatusStore`'s current session-scoped design, §12).
- `613e41a20`, `6aac19df0`, `086281413` — hardening: closing continuity/generation races, isolating task intelligence by owner, capture-gate/fencing/attribution hardening for the recommendation feedback outbox.
- `9bbcccfa6`, `5e3084b5d` — clearer non-chat error presentation and dashboard-only session-load-error mapping (feeds `dashboardIntelligenceError` in §6).
- `03b8593f4`, `e1733fd8a`, `12c694e0b` — automation-presentation confirmation + general hardening (not Home-visual).

Net effect for a Windows port: treat the canonical Goals/What-Matters-Now system as the **current, intended feature**, not a recent unstable add-on — it's had a hardening pass already.

## 14. Windows comparison

Current Windows Home implementation: `desktop/windows/src/renderer/src/pages/Home.tsx` (chat-centric idle screen) + `desktop/windows/src/renderer/src/components/home/QuickTaskWidget.tsx` + `QuickGoalsWidget.tsx`, shelled by `desktop/windows/src/renderer/src/components/layout/Sidebar.tsx` and `MainViews.tsx`.

**Headline finding: Windows Home is architecturally closer to the Mac *legacy* chat-first Home (§7) than to the Mac *default* redesigned Home (§§1–9).** Windows keeps a permanent left sidebar and a permanent chat transcript on Home; Mac's default has neither.

| Element | Mac (redesigned, default) | Windows today | Rating |
|---|---|---|---|
| Left sidebar | **None** — no persistent nav rail in default Home | `Sidebar.tsx`: persistent nav rail (Home/Conversations/Tasks/Rewind/Apps) + Screen recording/Mic toggles + account row, collapsible to a 64px icon rail | **Major drift** — Windows ships the pattern Mac deprecated behind an opt-out toggle |
| Home content model | Idle "hub": wordmark, cards, ask bar — no permanent transcript | Idle greeting ("Hi, {name}") that morphs into a permanent scrolling chat transcript once a conversation starts, widgets pinned above it | **Major drift** — same idle-greeting-then-chat *shape* as Mac's legacy mode, not the hub/chat/connect state machine |
| Capture/Listening status | Header pills (§5) with live on/off/blocked state + meetings-only mode toggle | Sidebar toggle rows ("Screen recording", "Microphone") — binary on/off, no "blocked/permission" state distinction, no meetings-only mode surfaced on Home | **Major drift** |
| Tasks widget | Legacy-only `TasksWidget` (overdue+today+recent, 3 rows, "View all tasks") — **not shown in redesigned Home at all**; redesigned Home has no tasks card, only the stat-ribbon count | `QuickTaskWidget.tsx`: 2 upcoming tasks + due chips, links to `/tasks` | **Minor drift vs. legacy shape; but redesigned Mac Home has no equivalent element**, so there's no 1:1 target — decide whether Windows should drop this card to match redesigned Home, or keep it (closer to legacy) |
| Goals widget | Legacy-only `GoalsWidget` (numeric goals, progress bars) is separate from and older than the canonical `FocusedGoalsSection`/`WhatMattersNowSection` system (§3a/§3b) that redesigned Home actually uses | `QuickGoalsWidget.tsx`: reads `/v1/goals/all`, `target_value`/`current_value`/`is_active` — the **legacy numeric goal model**, not canonical Goals (`goalId`/`status`/`focusRank`/`desiredOutcome`) | **Major drift** — Windows has not adopted the canonical Goals API at all; no focus/thread/"Work on this with Omi" concept exists |
| What Matters Now recommendations | Core Home feature (§3a) — up to 3 AI-generated recommendation cards with Do-now/Later/Dismiss feedback loop | **Missing entirely** | **Missing** |
| Connect data / Connect panel | Dedicated stage (§8) — 12 source/destination rows (Gmail/Calendar/Files/Notes/Omi Device + Claude/ChatGPT/OpenClaw/Hermes/Ask Omi), connected-state dots | **Missing** — no equivalent surface on Windows Home (Apps page may partially overlap, out of scope for this doc) | **Missing** |
| Stat ribbon (Conversations/Tasks/Memories/Screenshots counts) | Persistent 4-cell clickable strip (§3c) | **Missing** on Home | **Missing** |
| Ask bar | Pill with paperclip attach, drag-drop, Connect-toggle-in-idle / Send / Stop tri-state (§3d) | `ChatBar` (`Home.tsx:41-92`): text input + voice-toggle button + send button — **no attachment support, no drag-drop, no Connect affordance** | **Major drift** |
| Suggested questions | 3-row list, sourced from `PostOnboardingPromptSuggestions` or a fixed fallback (§3e) | Not present on Windows Home | **Missing** |
| "Try asking" first-ask popup | App-shell-level modal shown once post-onboarding (§9) | Not found in Windows Home/onboarding flow searched | **Missing** (needs separate confirmation against the onboarding surface, out of this doc's scope) |
| Voice session | N/A on Home directly (voice lives in the floating bar, excluded from this doc) | `VoiceSessionSurface` toggled inline in the chat bar area | **N/A / Windows-specific** — not a Mac Home element, flag for the floating-bar/orb doc instead |
| Background/canvas treatment | Layered radial-gradient glow canvas (`HomeCanvasBackground`, §4), warm off-white `ink` text, serif accents on stat values/section headers | Standard dark app background, no equivalent layered-glow canvas, no serif accent usage | **Major drift** (visual identity) |
| Color system | `HomePalette` warm-neutral/violet-glow micro-palette layered over `OmiColors` (§10) | Uses the shared `--accent`/`--surface`/`--line`/`--bg-raised` CSS custom-property system (seen in `Home.tsx`'s `ChatBar`) — no Home-specific palette | **Major drift** — Windows would need a parallel `HomePalette`-equivalent token set to match, or a product decision to skip it |
| Window chrome (rounded container, 26pt radius, gradient fill) | `OmiChrome.windowRadius = 26` applied to the whole main-content container (§1) | Not verified in this pass — flag for the app-shell/window-chrome doc | **Unverified** |

**Overall**: this is not an incremental-polish gap — Windows Home is currently built to an older architecture than what Mac ships by default. Porting faithfully means replacing the sidebar+permanent-transcript model with the hub/chat/connect state machine, adopting the canonical Goals + What-Matters-Now APIs (not the legacy numeric goal model Windows currently reads), and building the Connect panel, stat ribbon, and header status pills from scratch. The one thing *not* to port 1:1 is the legacy Mac Home (§7) — it's explicitly deprecated behind an opt-out toggle, even though Windows' current shape most resembles it.
