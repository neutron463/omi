# 07 — Menu Bar, Notifications, Modals & Tray (macOS reference spec)

**Reference:** Omi macOS desktop app at tag `v0.12.72+12072-macos` (commit `50d264c94`, 2026-07-12), read-only worktree `.worktrees/mac-ref/desktop/macos`. All Swift paths below are relative to `desktop/macos/` unless given in full. Baseline for the delta section: `0d09ede61b76dc4a144d05809432bf220394ee3a`.
**Scope:** everything that is NOT the main window content and NOT the notch/floating control bar — menu-bar (status item) menu, top-of-screen app menu, native notification banners, in-app toasts/overlays, modals/sheets/confirmation dialogs, secondary windows, context menus, dock icon behavior, and the login/auth surface.
**Explicitly excluded:** the notch bar / floating control bar / orb overlay and everything under `Desktop/Sources/FloatingControlBar/` and `Desktop/Sources/SpatialOverlay/` (owned separately). Where a notification's *delivery mechanism* is the floating bar, that is called out but not specced visually here.
**Windows comparison root:** `desktop/windows/src/main/` (Electron main) and `desktop/windows/src/renderer/src/` (React renderer) in this worktree.

> **⚠️ Brand invariant flag (INV-UI-1):** this Mac tag still uses `OmiColors.purplePrimary` (`#8B5CF6`) and friends as an accent in several places below (WhatsNewToast link color, GoalsWidget buttons, deep-link highlight tint). The repo's current brand invariant (`docs/product/invariants/brand-ui.md`, "never use purple") post-dates this UI — **do not port the purple**, substitute white/neutral. Flagged inline where it occurs.

### Color tokens referenced below — `Desktop/Sources/Theme/OmiColors.swift:8-45`

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `backgroundPrimary` | `#0F0F0F` | | `textPrimary` | `#FFFFFF` |
| `backgroundSecondary` | `#1A1A1A` | | `textSecondary` | `#E5E5E5` |
| `backgroundTertiary` | `#252525` | | `textTertiary` | `#B0B0B0` |
| `backgroundQuaternary` | `#35343B` | | `textQuaternary` | `#888888` |
| `backgroundRaised` | `#1F1F25` | | `success` | `#10B981` |
| `border` | `#3A3940` | | `warning` | `#F59E0B` |
| `purplePrimary` | `#8B5CF6` (⚠️ no-port) | | `error` | `#EF4444` |
| `purpleSecondary` | `#A855F7` (⚠️ no-port) | | `info` | `#3B82F6` |

Dark theme only, no light-theme variant anywhere in this app.

---

## 1. Menu bar (status item) — `Desktop/Sources/OmiApp.swift`

macOS calls this the "menu bar extra" / status item; the direct Windows equivalent is the system tray icon + context menu.

### 1.1 Mechanism

Built with raw `NSStatusBar`/`NSMenu` (`AppDelegate.setupMenuBar()`, lines 869-1032), **not** SwiftUI `MenuBarExtra` — a code comment explains SwiftUI's version had rendering reliability issues on macOS Sequoia. A 30-second repeating `Timer` (lines 565-578) health-checks the status item (`isVisible`, non-nil button, non-zero-width "phantom" frame) and recreates it if it silently vanished — a defensive pattern for an observed macOS Sequoia bug where status items disappear on activation-policy changes. `refreshMenuBarIcon()` (lines 827-866) re-asserts visibility/icon after any policy change, with a second verification pass 0.5s later.

### 1.2 Icon

- Normal launch mode: `omi_menu_bar_icon.png` from the resource bundle, forced to **18×18**, `isTemplate = true` (so it auto-adapts to menu-bar light/dark and highlight states — standard macOS status-item convention), `imagePosition = .imageOnly`. Fallback if the resource is missing: SF Symbol `waveform` (also template).
- `--mode=rewind` launch: SF Symbol `clock.arrow.circlepath` (template), tooltip `"omi Rewind"`.
- **The icon is static** — it does not change based on listening/recording/paused state. There is no equivalent of a "listening" vs "idle" vs "paused" icon variant anywhere in this file or its call graph.
- `button.toolTip` = app display name (`CFBundleDisplayName`, normal mode) or `"omi Rewind"` (rewind mode).

### 1.3 Menu contents, top to bottom (`setupMenuBar()` lines 936-1020)

1. **Screen Capture** toggle row (custom `NSView`, see §1.4) — icon `rectangle.dashed.badge.record`.
2. **Audio Recording** toggle row (custom `NSView`) — icon `mic.fill`.
3. `NSMenuItem.separator()`
4. **"Open \<displayName\>"** — key equivalent `o`, activates app + brings main window to front (`revealMainWindowIfAvailable()`, tries `AppDelegate.openMainWindow` SwiftUI-scene opener as a fallback if no window is found).
5. `separator()`
6. **"Check for Updates..."** — calls `UpdaterViewModel.shared.checkForUpdates()` (Sparkle).
7. `separator()`
8. **Signed-in state branch:**
   - Signed in: disabled label **"Signed in as \<email\>"** → separator → **"Reset Onboarding..."** → separator → **"Report Issue..."** (opens the Feedback window, §6.1) → separator → **"Sign Out"** (no confirmation — immediately calls `AuthService.shared.signOut()` after stopping proactive-assistant monitoring).
   - Signed out: disabled label **"Not signed in"** (no other items in this block).
9. `separator()`
10. **"Quit"** — key equivalent `q`.

Every clickable item logs `AnalyticsManager.shared.menuBarActionClicked(action:)` with a stable action string (`open_omi`, `check_updates`, `reset_onboarding`, `report_issue`, `sign_out`, `quit`, `screen_capture_on/off`, `audio_recording_on/off`).

### 1.4 Toggle rows — `makeToggleItemView()` (lines 1090-1139)

Custom `NSMenuItem.view`, not a native checkbox-style item: 260×36pt row, SF Symbol icon (13pt medium, `.secondaryLabelColor`) at x=16, label (`systemFont 13`, `.labelColor`) at x=40, and a right-aligned **`NSSwitch`** (`.small` control size, pinned to the trailing edge via `autoresizingMask = [.minXMargin]`).

**Paywall gating (both toggles):** when `AppState.isPaywalledEffective` (trial expired / usage limit hit), both switches render **off** regardless of the underlying setting, and turning either **on** is refused: the switch snaps back off and `.showUsageLimitPopup` fires with `reason: "trial_expired"` instead of enabling the feature. Screen Capture additionally checks screen-recording permission before enabling — if not granted, the switch reverts and `ScreenCaptureService.requestScreenRecordingAccessAndOpenSettings()` runs (§3.4).
`menuWillOpen(_:)` (`NSMenuDelegate`, lines 1205-1215) refreshes both switch states from live app state every time the menu opens (also re-applying the paywall-forces-off rule), so the menu never shows stale toggle state.

### 1.5 Menu lifecycle quirk

`menuDidClose(_:)` (lines 1217-1224) sweeps `NSApp.windows` 0.1s after close for any lingering `NSPopupMenuWindow`-class window titled `"Item-*"` and force-hides it — a defensive cleanup for a known AppKit popup-window leak pattern with custom `NSMenuItem.view`s.

### 1.6 App menu (top-of-screen menu bar) — `OmiApp.swift:136-222`

SwiftUI `.commands {}` block injected into the standard macOS app menu bar (View/Edit/Window menus), not a custom top-level menu:

- `CommandGroup(after: .textFormatting)`: **Increase Font Size** (⌘+), **Decrease Font Size** (⌘−), **Reset Font Size** (⌘0), divider, **Reset Window Size** (no shortcut) — drives `FontScaleSettings.shared.scale` (clamped 0.5–2.0, step 0.05) and resets the key window to 1200×800.
- `CommandGroup(after: .sidebar)`: **Home** (⌘1), **Conversations** (⌘2), **Memories** (⌘3), **Tasks** (⌘4), **Rewind** (⌘5), **Apps** (⌘6), divider, **Settings** (⌘,) — each posts `.navigateToSidebarItem` with the target `SidebarNavItem` raw value.
- `CommandGroup(after: .toolbar)`: **Refresh** (⌘R) — posts `.refreshAllData`.

These are pure keyboard-accelerator commands; macOS auto-generates the surrounding standard menu structure (App/File/Edit/View/Window/Help) — no custom menu bar layout beyond these injected groups.

### 1.7 Dock icon & app activation

- `NSApp.setActivationPolicy(.regular)` is set **unconditionally** at launch (line 554) — the dock icon is always visible, in every build/mode; there is no menu-bar-only / accessory-policy mode. Comment: *"Dock icon is always visible — LSUIElement=false and activation policy stays .regular."*
- Icon: loaded from `omi_app_icon.png`, mask-applied at launch (squircle, 6% margin, ~22.37% corner radius matching macOS Dock icon sizing conventions) and set via `NSApp.applicationIconImage` — done in code rather than relying on the bundle's `.icns` because raw `NSApp.applicationIconImage` doesn't auto-mask (lines 325-354). A one-time icon-cache reset (`lsregister` unregister/re-register + `killall iconservicesagent`, with a Dock-crash safety net) runs once per app version to force macOS to drop any stale cached icon (lines 716-762).
- **No dock badge** — confirmed by full-repo grep: zero occurrences of `NSDockTile`, `dockTile`, `.badgeLabel`, or `applicationDockMenu` anywhere in `Desktop/Sources`. No unread-count badge, no red dot, no custom right-click dock menu (Show/Hide/Quit is the unmodified system default).
- Dock-icon click (`applicationShouldHandleReopen`, lines 1241-1254): always tries to restore/deminiaturize/front the first window titled `"Omi*"`; suppresses the default "create a new window" behavior once one is found.
- `applicationShouldTerminateAfterLastWindowClosed` (lines 1231-1239): **quits the app** if onboarding was never completed (so an abandoned onboarding doesn't leave an orphaned menu-bar-only process); otherwise the app stays alive as a background/menu-bar process after the last window closes (standard "menu bar app" behavior).

---

## 2. Native macOS notification banners — `Desktop/Sources/ProactiveAssistants/Services/NotificationService.swift`

### 2.1 Delivery model — floating-bar is the default, system banner is opt-in

`sendNotification(...)` (lines 250-353) **always** routes through `FloatingControlBarManager.shared.showNotification(...)` — the notch/bar surface, out of this doc's scope. It additionally posts a real `UNUserNotificationCenter` banner **only** when the caller passes `deliverSystemBanner: true` (default `false`). Doc comment at the call site: *"proactive AI notifications are floating-bar only — users who disabled the floating bar reported clicking the top-right system banner and getting no conversation context, which was confusing."*

Confirmed call sites that pass `deliverSystemBanner: true` (i.e. the **only** notifications that ever produce a real macOS Notification Center banner) — all three in `ProactiveAssistantsPlugin.swift`:

| Trigger | Title | Body |
|---|---|---|
| Screen-recording permission fully lost (2 failed probes 1.5s apart) | "Screen Recording Permission Required" | "omi needs screen recording permission to continue monitoring. Please re-enable it in System Settings." |
| Screen-capture-broken, auto-reset path exhausted (×2 call sites) | "Screen Recording Needs Reset" (= `NotificationService.screenCaptureResetTitle`) | "Screen recording permission needs to be re-enabled. Click to open Settings." |

Every other notification path (proactive insights, task/memory/focus assistant nudges, `sendContextualTaskInterruption`, onboarding notification preview) omits the flag and is **floating-bar only** — never a system banner, never a Notification Center entry.

### 2.2 Categories / actions — `setupNotificationCategories()` (lines 124-150)

- `"omi.trackable"` (default category) — no actions, `.customDismissAction` (so explicit dismiss vs. click can be told apart in the delegate).
- `"omi.screen_capture_reset"` — one action, id `RESET_SCREEN_CAPTURE_NOW`, title **"Reset Now"**, `.foreground` option (brings app forward on tap); applied only when the notification title equals `screenCaptureResetTitle`.

### 2.3 Delegate behavior (lines 155-232)

- `willPresent`: always `[.banner, .badge]`; `.sound` only added if `content.sound != nil` (custom sounds bypass system sound, see §2.4).
- Default tap → `notificationClicked` analytics; if it's the reset-title notification, triggers the reset action.
- Explicit dismiss (X / swipe / Clear) → `notificationDismissed` analytics — separately trackable from tap thanks to `.customDismissAction`.
- `RESET_SCREEN_CAPTURE_NOW` action tap → same reset trigger, source tag `"notification_action_button"` vs `"notification_click"` for the default-tap path.

### 2.4 Sound — `NotificationSound` enum (lines 6-49)

- `.default` → `UNNotificationSound.default`, played by the OS as part of the banner.
- `.focusLost` / `.focusRegained` → `unSound` returns `nil` (SPM-bundled `.aiff` isn't resolvable via `UNNotificationSound(named:)`), so the OS banner is silent; instead `focus-lost.aiff` / `focus-regained.aiff` is loaded from the resource bundle and played manually via `NSSound(contentsOf:byReference:true).play()` right before the notification request is submitted.
- `.none` → no sound.

### 2.5 Throttling / frequency (lines 460-544)

Mirrors backend `notification_frequency` (int 0–5) and `notifications_enabled` (bool). Both default to permissive (`notifications_enabled` defaults `true` when unset; frequency defaults to `0`/Off — a one-time migration forces every existing install to Off once, pushed to the backend, never re-runs).

| Level | Name | Min interval between proactive notifications |
|---|---|---|
| 0 | Off | ∞ (dropped entirely) |
| 1 | Minimal | 60 min |
| 2 | Low | 30 min |
| 3 | Balanced | 10 min |
| 4 | High | 3 min |
| 5 | Maximum | none |

Throttle timestamps are tracked **both per-assistant and globally** — an allowed send stamps both clocks, so one chatty assistant can't starve another, but any send (any assistant) resets the shared global clock.

Suppression gate order in `sendNotification`: (1) screen-capture-reset dedupe flag → (2) floating-bar snooze (`isSnoozed`) → (3) master toggle (`respectFrequency`-gated) → (4) frequency throttle (`respectFrequency`-gated). Functional notifications pass `respectFrequency: false` to skip (3)/(4) but still honor snooze and dedupe.

### 2.6 Auth-state self-repair

If a `deliverSystemBanner: true` send finds notification auth `.notDetermined` (a known OS regression where authorized silently reverts), it debounces to once per 10 minutes and calls `ProactiveAssistantsPlugin.repairNotificationRegistration()` → `NotificationRegistrationRepair.swift` (§2.7).

### 2.7 `NotificationRegistrationRepair.swift` (full file, 201 lines) — silent background fixer, no UI of its own

Works around a macOS bug where LaunchServices refuses to register the app for notifications, so the OS permission prompt never appears. Gated once-per-app-version (`notificationRegistrationRepairedAppVersion` UserDefaults key) plus a separate once-per-version startup-only gate. The fix: on a background queue, optionally `lsregister -u <bundlePath>` then always `lsregister -f <bundlePath>` (re-register), `killall usernoted`, `killall NotificationCenter`, sleep 1.5s, then `LSRegisterURL(bundleURL, true)` on the main actor. Concurrent repair requests coalesce onto one in-flight run. The only user-visible effect is indirect: the *next* permission request may now succeed, or (after ~4-5s) the caller falls back to opening System Settings directly.

---

## 3. Screen-recording-reset flow (native banner + recovery ladder)

`Desktop/Sources/ScreenCaptureService.swift` + `ProactiveAssistantsPlugin.swift:1150-1558`.

1. Consecutive capture failures → check for a transient special system mode (Exposé/Mission Control/Notification Center) before treating as a real failure.
2. Two permission re-checks 1.5s apart before declaring permission genuinely lost → fires the **"Screen Recording Permission Required"** system banner (§2.1) and stops monitoring.
3. Recovery mode: retry every 5s up to a max retry count; special-mode retries reset the counter.
4. Background polling mode: retry every 60s after recovery is exhausted.
5. Auto-reset (`attemptAutoReset()`), each step **once per session**:
   - Soft recovery: re-register LaunchServices + re-request ScreenCaptureKit consent in-process; if that fails, relaunch the app after re-registering (no TCC wipe).
   - If soft recovery already ran: fires **"Screen Recording Needs Reset"** with the "Reset Now" action button (§2.1/§2.2), `respectFrequency: false`.
6. **Hard reset is never automatic** — only user-triggered, via the notification's default tap, its "Reset Now" action, or a Settings/sidebar "Reset" button: `tccutil reset ScreenCapture <bundleId>` (wipes the TCC grant) then relaunch.

`requestScreenRecordingAccessAndOpenSettings()` — the guided-grant flow — activates the app *before* requesting (both legacy TCC and ScreenCaptureKit APIs), then opens System Settings' Screen Recording pane via `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture` (falls back to the bare scheme, brings System Settings forward 0.3s later). Ordering matters: requesting while backgrounded never creates the TCC row at all.

The `screenCaptureResetShownKey` dedupe flag (one notification per broken-capture episode) is only **set** at actual delivery time (after every suppression gate passes, so a snoozed attempt doesn't permanently poison it) and is **cleared** the moment capture is confirmed working again (`AppState.checkScreenRecordingPermission()`).

**No pre-explainer UI exists** before this notice fires — the system notification body copy ("Click to open Settings") plus the "Reset Now" button *is* the entire explainer.

---

## 4. Meeting detection — **no user-visible prompt on macOS**

`Desktop/Sources/MeetingDetector.swift` (186 lines) + `Desktop/Sources/ConferencingApps.swift` (207 lines) + consumer `AppState+Transcription.swift:442-579`.

**Finding, confirmed by exhaustive grep (no "meeting detected"/"in a meeting"/"join meeting" strings anywhere in the tree outside a debug log line and an unrelated prompt-template example):** meeting detection on Mac has **zero UI surface**. It exists purely to gate audio capture when System Audio mode is `.onlyDuringMeetings` — there is no native notification, no floating-bar popup, no in-window banner, and no accept/dismiss affordance when a meeting is detected. It silently starts/stops capture and feeds an internal task-context signal.

- Detection: CoreAudio process scan (`kAudioHardwarePropertyProcessObjectList` + `kAudioProcessPropertyIsRunningInput`) against known native call-app bundle IDs (Teams classic/new, zoom.us, FaceTime, Webex, GoToMeeting), macOS 14.4+; falls back to a CGWindowList title scan for browser tabs (Meet/Teams-in-browser keywords) on older OS or when the process-list API is unavailable (requires Screen Recording permission).
- Poll interval 4s + immediate re-probes on app activate/launch/terminate. On-transition is immediate; off-transition has an 8s grace period to avoid flapping.
- **Windows note:** `desktop/windows/src/main/meeting/detector.test.ts` implies a Windows meeting detector exists — and unlike Mac, Windows built an actual user-facing **meeting toast** for it (§9.2 below). This is a case where the Windows app added net-new UI with no Mac precedent to match; confirm with Chris whether that's intentional product divergence or should be reconciled.

---

## 5. In-window toast overlays (main-window scoped, not system notifications)

### 5.1 "What's new" card — `Desktop/Sources/WhatsNewToast.swift` (162 lines, full file)

Shown once after a Sparkle update (build number increases), bottom-right corner **of the main window** (`.overlay(alignment: .bottomTrailing)` on the `Window("main")` scene in `OmiApp.swift:129`) — not anchored to the screen, so it's invisible if the main window is hidden/minimized. Presented 2.5s after launch (`applicationDidFinishLaunching`) so the window/overlay exist first.

- Card: `HStack` — 34×34 logo (`herologo.png`, falls back to `sparkles` SF Symbol in `purplePrimary` ⚠️ no-port), title **"omi updated"** (14 semibold, `textPrimary`) + `xmark` close button, subtitle **"Now on version \<x\>"** (12, `textTertiary`), and a tappable **"See what's new →"** row (12 medium, `purpleSecondary` ⚠️ no-port — substitute neutral) that opens the changelog URL in the default browser.
- Container: 304pt wide, padding 14, `RoundedRectangle(cornerRadius: 14)` fill `backgroundRaised`, 1px stroke `border`, shadow `black.opacity(0.35)` radius 16 y 6. Outer padding 20 from the window edge.
- Transition: `.move(edge: .trailing).combined(with: .opacity)`, spring animation `response: 0.4, dampingFraction: 0.85`.
- Auto-dismiss: 12 seconds (`Task.sleep`, cancellable via `.task(id: version)` so a version change restarts the timer).
- Whole card is tappable (opens changelog + dismisses); explicit close button also dismisses.

### 5.2 Local CRUD undo toasts (Tasks / Memories pages) — distinct pattern, not the notification system

- **`UndoToastView`** (`Desktop/Sources/MainWindow/Pages/TasksPage.swift:5871-5919`) — after a task delete: dark-gray `Capsule()` pill (`Color(.darkGray)`, shadow `black.opacity(0.3)` r8 y4), trash icon + **"Task deleted"** (white 13) + optional stacked-delete counter, **"Undo"** button (white-20%-opacity capsule chip). `max width 360`, fade/scale in-out `.easeInOut(0.25)`.
- **`shareCopiedToast`** (`TasksPage.swift:5227`) — same pill pattern, "Sharing link copied" confirmation after a clipboard-copy share action (see §7 — there is no OS share sheet anywhere in this app, share = copy-link + toast).
- **Memories page undo toast** (`Desktop/Sources/MainWindow/Pages/MemoriesPage.swift:1592-1645`) — themed with the shared `OmiColors`/`omiPanel` system instead of a hard-coded dark pill: trash icon + "Memory deleted" (`textPrimary`) + live countdown "\<n\>s" (`textTertiary`, monospaced digits) + "Undo" text button + separate `xmark` dismiss-now button. Container `omiPanel(fill: backgroundSecondary, radius: 20, stroke: border.opacity(0.18), shadowOpacity: 0.18, shadowRadius: 14, shadowY: 8)`, bottom-edge slide + fade, spring `response: 0.3, dampingFraction: 0.8`.

### 5.3 Task/memory *proactive* notifications = floating bar only

"Task notifications" as an AI-proactive concept route exclusively through `NotificationService.sendContextualTaskInterruption(...)` → floating-bar popup, gated by a dedicated interruption policy (cohort + master toggle + frequency>0 + per-feature toggle + Focus-mode suppression + snooze). **No native system banner** is ever produced for these — do not confuse them with the CRUD-undo toasts in §5.2, which are a separate, local, main-window-only UI pattern.

---

## 6. Secondary windows

### 6.1 Feedback / "Report Issue" — `Desktop/Sources/FeedbackView.swift` (234 lines, full file)

A **real separate `NSWindow`** (not a SwiftUI `.sheet`), triggered from the menu-bar "Report Issue..." item (§1.3) and from Settings. `FeedbackWindow.show(userEmail:)`: `NSHostingController` wrapped in an `NSWindow`, title **"Report Issue"**, `styleMask = [.titled, .closable]` (no resize/miniaturize), fixed content size **400×300**, centered, `level = .floating` (always-on-top), activates the app. Singleton — reopening closes any prior instance. Uses plain system colors (`.secondary`, default `Text`), not the `OmiColors` theme — this view predates/bypasses the app's theme system.

- **Form state:** headline "Report an Issue"; caption *"App logs will be included automatically. Optionally describe what went wrong, or save a redacted diagnostics file to share manually."*; multi-line description field (min height 100, 0.3-opacity border); Name (optional, prefilled from account) + Email (prefilled) side by side; footer: "Cancel", "Save Diagnostics…" (tooltip: *"Save a redacted diagnostics report locally — works offline, nothing is uploaded."*), spacer, "Send Report" (disabled while submitting).
- **Success state:** 48pt green checkmark, "Report sent!", "We'll look into this issue.", "Close" button.
- Submit → Sentry event (`"User Report (logs only)"` or `"User Report: <message>"`) with the app log file + a redacted JSON diagnostics attachment; if a message was typed, also attaches a linked `SentryFeedback` (name/email/message).
- "Save Diagnostics…" is a fully offline path — `NSSavePanel`, default filename `omi-diagnostics-<timestamp>.txt`, writes off-main, reveals in Finder — no network call, works for named test bundles without connectivity.

### 6.2 Guidance overlay panels (live, user-facing) — `Desktop/Sources/CloudConnectorGuidanceOverlay.swift` (771 lines)

Singleton that walks the user through pasting Omi's connector credentials into a third-party site (e.g. Claude's "Add connector" dialog). Uses borderless, `.popUpMenu`-level `NSPanel`s (`.nonactivatingPanel`), all styled `.ultraThinMaterial` + `black.opacity(0.42)` scrim tint, 20pt corner radius, shadow `black.opacity(0.42)` r26 y14:
1. **Pointing hint bubble** — 330×118, click-through, triangular arrow anchored to a detected UI target via accessibility/OCR, `success`-colored pointer. Copy: "Finish in Claude" / "Click the {Add|Connect} button." Auto-dismiss 14s.
2. **Instruction card** — 420pt wide, non-click-through with a close button; shown when no anchor target resolves. Auto-dismiss 30s or on tap.
3. **Field-copy card** — 460pt wide, per-field copy rows with secret-masking heuristics (matches "secret"/"key"/"token"/"password"/"credential"/"private"), each with a copy button (icon flips to a checkmark for 1.8s). Draggable. Auto-dismiss 240s.

### 6.3 Live production overlay — `GlowEdgeWindow.swift`

Four borderless, click-through, `.popUpMenu`-level edge windows (20pt thick, 4pt overlap) framing the currently-focused app window with an animated glow border (green = focused, red = distracted), gated behind a user setting. Fade-in 0.3s, glow animation `easeInOut(1.5s)` × 3 repeats, fade-out 0.5s after 2.5s total. Instantiated by `OverlayService.showGlow(around:colorMode:isPreview:)`.

### 6.4 Dev-only / currently-orphaned windows — do not port

Ten windows live under `Desktop/Sources/ProactiveAssistants/UI/`. Seven of them (`FocusTestRunnerWindow`, `PromptEditorWindow`, `TaskTestRunnerWindow`, `TaskPromptEditorWindow`, `InsightTestRunnerWindow`, `InsightPromptEditorWindow`, `MemoryPromptEditorWindow`, plus `GlowDemoWindow`) are prompt-editor / historical-replay-harness dev tools whose only trigger points (`focusAssistantSubsection`, `taskAssistantSubsection`, `insightAssistantSubsection`, `memoryAssistantSubsection` in `SettingsContentView+Assistants.swift`) are **defined but never wired into the live Settings tree** (`SettingsPage.swift` only composes `generalSection`/`advancedSection`, and `advancedSection` never references those four subsections). They are structurally unreachable in the shipped app right now — likely in-progress/shelved work, not an intentional dev-only gate. **Recommendation: do not port; flag to Chris that these may be dead on Mac itself.** `GlowOverlayWindow.swift` (a single-window variant of §6.3) is separately confirmed dead code — never instantiated anywhere.

**No picture-in-picture window and no separate "agent workstream" window exist anywhere in the codebase** (confirmed via exhaustive grep; the only genuine `Workstream` hit is a data-model file, not a UI surface).

---

## 7. Login / auth surface — **not a separate window**

`Desktop/Sources/SignInView.swift` (165 lines) + `Desktop/Sources/Auth/SessionRecoveryView.swift` (54 lines).

There is **no standalone login/auth window**. Sign-in is a full-bleed state of the single main `Window("main")` scene (`DesktopHomeView.body`, priority order): (1) `authState.isRestoringAuth` → loading splash (centered 64×64 logo + dimmed `ProgressView`), (2) `sessionPhase == .recoveryRequired` → `SessionRecoveryView`, (3) not signed in → `SignInView`, (4) onboarding incomplete → `OnboardingView`, (5) else → the full app. `--mode=rewind` launches follow the identical gate sequence.

- **`SignInView`**: full-bleed `backgroundPrimary`. 64×64 logo + "omi" (48pt bold) + "Sign in to continue" (`title3`, `textTertiary`). Two full-width 320pt-column, 50pt-tall, white-background, 10pt-radius buttons: **"Sign in with Apple"** (SF `applelogo` + black text) and **"Sign in with Google"** (multicolor "G" mark + text, white bg with a 1px gray-0.3-opacity stroke). While loading: `ProgressView` + a **"Cancel"** escape hatch (so a closed browser tab / denied OAuth never permanently traps the user behind disabled buttons). Errors render as red (`error`) caption text below the buttons.
- **The actual credential-entry UI is never rendered in-app** — both buttons open the OS default browser via the backend OAuth flow (`/v1/auth/authorize`); the callback returns through a custom URL scheme handler (`handleGetURLEvent` → `AuthService.shared.handleOAuthCallback(url:)`), which re-activates the app and fronts the main window. Onboarding is a separate, sequential gate *after* sign-in — not embedded inside it.
- **`SessionRecoveryView`**: shown when Keychain credentials exist but launch-time validation couldn't complete (offline / temporarily locked Keychain). SF Symbol `lock.rotation` (34pt) + **"We couldn't verify your session"** (title3 semibold) + *"Your local data and setup are safe. Check your connection and retry, or sign in again."* (body, `.secondary`, max width 420). Two buttons: **"Sign In Again"** (`.bordered`, invalidates the session and drops to `SignInView`) and **"Retry"** (`.borderedProminent`, shows an inline spinner while retrying, disabled during retry).

---

## 8. Modals & sheets

### 8.1 Two distinct mechanisms — port them differently

1. **Native SwiftUI `.sheet(isPresented:)` / `.sheet(item:)`** — a real AppKit sheet (slides from the title bar, system chrome/shadow/dismiss animation). No custom styling to port beyond content layout.
2. **Custom `dismissableSheet(...)`** (`Desktop/Sources/MainWindow/Pages/AppsPage.swift:3408-3475`) — **not** a real window sheet; a `.overlay` ZStack: scrim `Color.black.opacity(0.3)` (tap-to-dismiss) + centered content card (`backgroundPrimary`, `RoundedRectangle(cornerRadius: 12)`, shadow `black.opacity(0.3)` r20 y10), content transition `.scale(0.95).combined(with: .opacity)`, scrim `.opacity`, animation `.easeOut(duration: 0.2)`, Escape-key dismiss, `.isModal` accessibility trait. **This is the pattern to port as a custom centered Electron/React overlay modal** (dim scrim + scale/fade card) — not a native OS dialog.

Native `.alert(...)` / `confirmationDialog(...)` render as system alert panels with no custom styling — only copy/buttons carry over.

**No native macOS share sheet (`NSSharingServicePicker`/`ShareLink`) exists anywhere in this app**, confirmed by full-repo grep (all apparent hits were substring collisions on function names like `copyShareLink`). "Share" always means copy-a-URL-to-clipboard + a toast (§5.2) — port accordingly, no OS share-sheet parity is needed.

### 8.2 Account: Sign Out & Delete Account — `SettingsContentView+AccountBilling.swift`

- **Sign Out**: plain bordered button, **no confirmation of any kind** — immediately calls `signOut()`.
- **Delete Account & Data**: card titled in `error` red, body *"Permanently deletes server data, clears local data for this account, resets onboarding, and signs you out."* Button shows a spinner while deleting. Triggers a native `.alert`:
  - Title: **"Delete Account and Data?"**
  - Message: *"This cannot be undone. Your account, chat history, and all server data will be permanently deleted. Local data for this account will be cleared and you'll return to onboarding."*
  - Buttons: "Cancel" (`.cancel`) / **"Delete Permanently"** (`.destructive`).
  - Failure renders inline (`warning` color) below the card, not a second dialog.

### 8.3 Billing / overage explainer sheet

Native `.sheet`, `min 440×360`, header + close button, body copy + (if overage active) a stat table: Questions used / Included in plan / Over the limit / Real provider cost / Markup / Overage to bill (emphasized row, `warning`).

### 8.4 Billing web flow — `Settings/Components/BillingWebFlow.swift:18-48`

Native `.sheet` embedding a `WKWebView` (Stripe-style checkout/portal), `min 860×680`. Header shows the flow's dynamic title + "Close". Completion detected by URL-path matching in `decidePolicyFor` (path ending `/cancel` → cancelled, else completed). This is the single mechanism behind both subscription checkout and "Manage" (customer portal) in Plan & Usage — Windows will need an equivalent embedded-browser or system-browser checkout flow.

### 8.5 Browser Extension Setup — `Desktop/Sources/BrowserExtensionSetup.swift`

Native `.sheet`, 4-phase state machine (`welcome → connect → verify → done`), frame animates `880×520` (connect phase, two-column: numbered steps + animated GIF guide) vs `480×420` (other phases), rounded 16pt card on `backgroundSecondary`. Progress = 4 dots (`purplePrimary` ⚠️ no-port vs `textTertiary.opacity(0.3)`). Primary button label changes per phase (Set Up → Continue → Testing…/Try Again → Done); "Skip for now" only on welcome.

### 8.6 Claude Auth / Upgrade sheet — `Desktop/Sources/Chat/ClaudeAuthSheet.swift`

Native `.sheet`, fixed `400×380`. Crown icon, "Unlock Omi Pro for $199/month", explains the browser-based checkout hop, connecting state shows a spinner + "Complete sign-in in your browser...". Primary "Upgrade to Omi Pro" / plain "Cancel".

### 8.7 Destructive confirmation dialogs — full inventory (native `.alert`/`confirmationDialog` unless noted)

| Surface | Title | Message (verbatim where captured) | Buttons |
|---|---|---|---|
| ConversationRowView / ConversationDetailView | "Delete Conversation" | "Are you sure you want to delete this conversation? This action cannot be undone." | Cancel / Delete (destructive) |
| ConversationRowView / ConversationDetailView | "Edit Conversation Title" | inline TextField | Cancel / Save |
| ConversationsPage | "Merge Conversations" | "Are you sure you want to merge N conversations? This will combine them into a single conversation and delete the originals. This action cannot be undone." | Cancel / Merge |
| ConversationsPage | "Merge Failed" | dynamic error or "Failed to merge conversations. Please try again." | OK |
| ChatPage / ChatSessionsSidebar | "Delete Chat?" | "This will permanently delete this chat and all its messages." | Cancel / Delete (destructive) |
| ChatPage | "Upgrade Required" (native alert, distinct from §8.6's sheet) | "Upgrade to Omi Pro for $199/month to continue chatting." | Upgrade to Omi Pro / Later |
| FocusPage | "Clear All History" (confirmationDialog) | "Are you sure you want to clear all focus history? This cannot be undone." | Clear All (destructive) / Cancel |
| FocusPage | "Delete Session" (confirmationDialog, per row) | "Are you sure you want to delete this session?" | Delete (destructive) / Cancel |
| InsightPage | "Clear All Insights" (confirmationDialog) | "Are you sure you want to clear all insight history? This cannot be undone." | Clear All (destructive) / Cancel |
| InsightPage | "Delete Insight" (confirmationDialog, per row) | "Are you sure you want to delete this insight?" | Delete (destructive) / Cancel |
| TasksPage | "Save Filter View" (alert, inline TextField) | "Enter a name for this filter combination." | Save / Cancel |
| TasksPage | "Clean today's tasks?" — **genuine AppKit `NSAlert.runModal()`**, not SwiftUI | "This will only remove deadlines" | Confirm / Cancel |
| MemoriesPage | "Delete Default Memories?" | feature-flag-dependent copy about ST/LT-only deletion | Cancel / Delete Default Memories (destructive) |
| OnboardingChatView | "Are you sure?" (skip guard) | "Omi won't be useful for you if it doesn't know enough about you." | Skip anyway (destructive) / Continue setup (cancel) |
| PersonaPage | "Delete Persona" | "Are you sure you want to delete your AI persona? This cannot be undone." | Cancel / Delete (destructive) |
| SettingsContentView+Assistants | "Rescan Files?" | "This will re-scan your files and update your AI profile with the latest information about your projects and interests." | Cancel / Rescan |
| SettingsContentView+Assistants | "Reset Onboarding?" | "This will reset onboarding for this app build only, clear onboarding chat history, and restart the app without affecting the other installed build." | Cancel / Reset & Restart (destructive) |
| SettingsContentView+Controls (About) | "Switch to Stable Channel?" | dynamic — names current beta + latest stable version, warns updates pause until stable catches up | Stay on Beta (cancel) / Switch to Stable |
| MemoryPromptEditorWindow | "Reset Prompt?" | "This will reset the memory extraction prompt to its default value. This cannot be undone." | Cancel / Reset (destructive) |
| TaskAgentViews | "Agent Error" | dynamic caught-error message | OK |
| ChatLabView | "Save as New Version" | inline TextField "Version name" | Save (if non-empty) / Cancel |
| AppState+Permissions (`showPermissionAlert`) | "Permission Required" — **AppKit `NSAlert`** | "Screen Recording permission is needed.\n\nClick 'Grant Screen Permission' in the menu, then add this app and restart." | OK |
| AppInstaller (`showManualInstallHint`) — **AppKit `NSAlert`, macOS-install-specific, N/A for Windows parity** | "Move omi to Applications" | "omi is running from the installer image, so macOS permissions and updates won't work. Drag omi to the Applications folder, then open it from there." | OK |

### 8.8 Custom `dismissableSheet` inventory (centered-overlay pattern, §8.1.2) — one line each

Insight detail (450×500) · App selector for reprocessing (400×500) · Name-speaker-segment sheet · Create/Edit/Delete folder (Conversations page) · App detail / Connector detail / Export-destination picker (Apps catalog + legacy Dashboard) · Add app review · Add/Edit Memory, Memory Detail · Wi-Fi setup (paired BT device) · Rewind speaker-segment detail · Create-persona form (400×400) · Goal edit / Goal insight / Goals history / All-goals / focus-replacement / canonical-goal-create / canonical-goal-detail (GoalsWidget + WhatMattersNowSection, see below).

### 8.9 Goals sheets (dashboard) — `GoalsWidget.swift` + `WhatMattersNowSection.swift`

- **Add/Edit Goal**: `400×(320 new / 420 edit)`. Fields: title, current/target numeric pair. Footer: Delete (existing only, red) / Cancel / Add-or-Save (purple pill ⚠️ no-port, disabled + 0.5 opacity when title empty).
- **Goal Insight**: `400×380`. Lightbulb + "Goal Insight", mini progress ring summary strip, loading/error/result states, Refresh + Done.
- **Goals History**: `480×500`.
- **All Goals** (`WhatMattersNowSection`): `620×540`, segmented Current/History picker, per-row Open/Focus-toggle/More (Pause/Mark achieved/Abandon) menu; nests a **focus-replacement sheet** ("Replace a focused goal" when the focus set is full) and a **create-goal sheet** (`460`, Short name / Desired outcome / Why it matters / Success criteria, all multi-line).
- **Canonical Goal Detail**: `620×600` — why-it-matters, success criteria, metric progress, active work threads with "Continue", milestone timeline, primary CTA "Work on this with Omi" (purple pill ⚠️ no-port).
- **Dismiss-reason popover** (per recommendation card, `WhatMattersNowSection`): `.popover`, 210pt wide — "Optional reason" + 3 buttons (Already handled / Not mine / Not useful); closing without a choice still fires dismiss with `nil` reason.
- Progress-bar fill color ramp (hard-coded hex, not `OmiColors` tokens): `#22C55E` (≥0.8) / `#84CC16` (≥0.6) / `#FBBF24` (≥0.4) / `#F97316` (≥0.2) / gray.

### 8.10 First-launch install guard — `Desktop/Sources/Startup/AppInstaller.swift` (166 lines, full file)

macOS-specific (DMG/App-Translocation/Gatekeeper) — **not portable to Windows as-is**, only the underlying UX pattern ("you're running from the wrong place, here's how to fix it") is potentially reusable for an equivalent Windows install-location guard. Happy path is silent (auto-copies to `/Applications`, clears quarantine, relaunches); the one `NSAlert` (§8.7 last row) only fires on failure or after 2 failed auto-relaunch attempts.

---

## 9. Context menus (right-click)

Confirmed via repo-wide grep: `.contextMenu` usage exists in exactly 4 files within scope.

### 9.1 Chat resource card — `Desktop/Sources/Chat/ChatResource.swift:394,614-625`

Right-click on an inline attached/generated file card in chat. Conditional items (any subset may appear, no dividers):
- **"Open"** — only if `resource.canOpen`.
- **"Reveal in Finder"** — only if `resource.canRevealInFinder`.
- **"Copy Path"** — only if `resource.uri` is non-empty.

### 9.2 Conversation row — `Desktop/Sources/MainWindow/Components/ConversationRowView.swift:447-514`

Right-click on a conversation-list row:
1. **Copy Transcript** (icon `doc.on.doc`)
2. **Copy Link** (icon `link`; label becomes "Generating Link..." with a spinner icon while in flight, disabled during generation)
3. divider
4. **Edit Title** (icon `pencil`) → opens the inline-TextField alert (§8.7)
5. **Move to Folder** submenu (icon `folder`, hidden if no folders exist): "Remove from Folder" (only if currently in one, icon `folder.badge.minus`, then a divider) → one row per folder (checkmark on the current one, disabled if already there)
6. divider
7. **Delete** (destructive/red, icon `trash`) → confirmation alert (§8.7)

### 9.3 Folder tab chip — `Desktop/Sources/MainWindow/Components/FolderManagementViews.swift:81-92`

Right-click on a user-created folder chip (not "Starred", not "+"): exactly two items, no dividers —
1. **Edit** (icon `pencil`)
2. **Delete** (destructive/red, icon `trash`)

### 9.4 Saved filter-view chip — `Desktop/Sources/MainWindow/Pages/TasksPage.swift:3109-3115`

Right-click on a saved Tasks filter chip: exactly one item —
1. **Delete** (destructive/red, icon `trash`)

---

## 10. Delta since baseline (`0d09ede61b76dc4a144d05809432bf220394ee3a` → this tag)

`git log --oneline <baseline>..v0.12.72+12072-macos -- <files>` on every file cited above returns real history — these surfaces were actively touched in this window, not frozen legacy code. Notable commits touching this doc's scope:

- `5e4554116` fix(desktop): deliver screen-recording-reset notice even after a snooze window — the dedupe-flag-timing fix described in §2.5/§3.
- `063a97fe9` Run NSAppleScript on the main thread for automation permission — `AppState+Permissions.swift`.
- `0fa3703bc` fix(desktop): gate meeting probes per tick — `MeetingDetector`/related, confirms §4 is actively maintained even with no UI.
- `e1733fd8a`, `4d711b4db`, `9bbcccfa6`, `326f48689` — broader desktop bug-sweep and observability commits touching `OmiApp.swift`/`AppState+Permissions.swift`.
- `e722929bf`, `9fd991be6`, `65723019c`, `0560d11b9` — "smart tasks / durable workstreams" feature work touching `TasksPage.swift`'s notification/toast/alert surfaces (§5.2, §8.7).
- `6803d2849`, `591b40246`, `cb7cea49e` — conversation-sync correctness fixes with downstream effects on `ConversationRowView.swift`'s context menu / merge dialogs (§8.7, §9.2).

Full untruncated list available via the same `git log` invocation against this doc's file set.

---

## 11. Windows comparison

| Mac surface | Windows equivalent | Rating | Notes |
|---|---|---|---|
| Menu-bar status item + menu (§1.1-1.5) | `src/main/tray.ts` + `trayState.ts` | **Major drift** | Windows tray: 5 items (Open Omi, Pause/Resume listening, Settings, Quit) + 3 dynamic icon states (idle/listening/paused .ico) + tooltip "· update ready" suffix. Mac: static icon (no listening-state variant), richer menu (Screen Capture / Audio Recording toggle switches, signed-in email, Reset Onboarding, Report Issue, Sign Out, Check for Updates) but no update-ready indicator in the tray itself. **Neither is a superset of the other** — Windows tray is missing Mac's toggles/account row/report-issue/sign-out/reset-onboarding; Mac's status item is missing Windows' live listening-state icon and update-ready hint.
| App menu (top-of-screen ⌘-shortcuts, §1.6) | none found | **Missing** | `autoHideMenuBar: true` and no `Menu.setApplicationMenu(...)` custom template anywhere in `src/main`; a scan of `App.tsx` found no `ctrlKey`-based sidebar-nav/font-scale keyboard shortcuts either. Mac's ⌘1-6 sidebar nav, ⌘+/−/0 font scale, ⌘R refresh, ⌘, settings have no confirmed Windows equivalent — verify with the settings/shortcuts owner before assuming parity is needed (Ctrl-based accelerators may exist elsewhere in the renderer not covered by this scope).
| Dock icon (§1.7) | Windows taskbar icon | **N/A / platform-native** | Mac has no badge/custom dock menu to port; Windows taskbar icon is the direct standard-OS equivalent, nothing bespoke needed either side.
| Native notification banners (§2) | none confirmed | **Missing** | No `new Notification(...)` / Windows toast-notification usage found in this pass of `src/main`. Windows' insight/meeting/what's-new toasts (§9 below) are a **first-party acrylic window**, not OS notifications — functionally analogous to Mac's floating-bar delivery, not to Mac's rare native-banner path (screen-recording-lost/reset). If Windows needs a true "reaches the user even when the app UI is fully hidden" channel matching Mac's `deliverSystemBanner: true` cases, that's unbuilt.
| Screen-recording-reset flow (§3) | N/A | **N/A** | macOS-specific (TCC/ScreenCaptureKit permission model). Windows has an analogous-in-spirit permission-loss problem space but no equivalent recovery ladder was located in this pass — out of this doc's file set to verify further.
| Meeting detection UI (§4) | `src/main/insight/toastWindow.ts` `showMeetingToast()` + `InsightToast.tsx` `MeetingCard` | **Windows ahead of Mac** | Mac's meeting detector has **zero** UI (silent capture gate only). Windows built a full acrylic toast with "Meeting detected" header, capturing/prompt copy, Start capturing / Stop / Not now actions, and a first-run hint — genuinely new UI with no Mac source to port from. Flag for product: is this intentional divergence, or should Mac gain the same prompt?
| What's-new toast (§5.1) | `toastWindow.ts` `showWhatsNewToast()` + `WhatsNewCard` | **Minor drift, Windows more capable** | Both: bottom-right, auto-dismiss (Mac 12s vs Windows 20s), open-release-notes action. Windows' version is a real desktop-anchored acrylic window with hover-pause (shared with insight/meeting toasts) and a 3-item changelog list; Mac's is a main-window-only overlay (invisible if the window is hidden) with a single "see what's new" link and no hover-pause. Recommend keeping Windows' current (superior) behavior rather than downgrading to match Mac.
| Proactive insight toast (out of full scope, floating-bar owned on Mac) | `toastWindow.ts` `showInsightToast()` + `InsightToast.tsx` | **Architecturally different, not directly comparable** | Windows renders proactive insights via its own dedicated acrylic toast window (screen-anchored, hover-pause, 8s auto-dismiss); Mac renders the equivalent via the notch/floating-bar surface (out of this doc's scope — see the bar-owning doc). Both exist; they are simply different surfaces by design on each platform. Not a gap, just worth naming so nobody double-implements it.
| Sign-out confirmation (§8.2) | `AccountTab.tsx` | **Identical** | Both: plain button, zero confirmation dialog, immediate sign-out.
| Delete Account & Data (§8.2) | none found | **Missing** | `AccountTab.tsx` has only Profile (display name) and Sign out — no delete-account entry point, no confirmation alert, at all. This is a real product gap, not a styling delta, if account deletion is meant to be available on Windows.
| Destructive confirmation dialogs generally (§8.7) | not located as a shared pattern | **Unverified — needs a follow-up pass** | No dedicated Modal/Dialog/Confirm component exists under `components/ui/`; this doc's scope did not include a full per-page sweep of every Windows delete/merge/clear flow to confirm which of §8.7's ~20 dialogs have Windows equivalents. Recommend a dedicated pass cross-referencing each row against the matching Windows page.
| Custom `dismissableSheet` centered-overlay modal pattern (§8.1.2) | not confirmed as a shared component | **Unverified** | No generic modal/dialog component found under `components/ui/`; each Windows page likely hand-rolls its own overlay. Worth extracting a shared `Modal`/`Sheet` primitive matching Mac's scrim+scale-card+Escape-dismiss contract for consistency.
| Share = clipboard + toast, no OS share sheet (§8.1) | `ToastHost.tsx` + `lib/toast.ts` | **Identical in spirit** | Windows has a general-purpose toast pub/sub system (`toast()`/`onToast()`) rendered bottom-right via `ToastHost.tsx` — architecturally the direct equivalent of Mac's `UndoToastView`/`shareCopiedToast`/Memories-page toast (§5.2), just unified into one reusable primitive instead of three bespoke ones. Good parity; Windows' version is arguably cleaner.
| Context menus (§9) | none found | **Missing entirely** | Exhaustive grep for `onContextMenu`, `contextmenu`, `context-menu`, `onAuxClick` across `src/renderer/src` returned **zero matches**. None of Mac's four right-click menus (chat resource, conversation row, folder chip, saved filter chip) have any Windows equivalent — right-click currently does nothing custom anywhere in the Windows app. This is the single largest concrete gap in this doc's scope.
| Feedback / Report Issue window (§6.1) | not confirmed in this pass | **Unverified** | Not covered by this pass's file set — check whether Windows has any bug-report/feedback entry point at all; if not, this is a second real gap alongside Delete Account.
| Secondary guidance-overlay panels (§6.2) | not confirmed in this pass | **Unverified / likely missing** | `CloudConnectorGuidanceOverlay`'s connector-setup pointing-hint/instruction/field-copy panels are a fairly elaborate macOS-only Accessibility/OCR-driven overlay system; no equivalent was searched for in this pass — flag for a follow-up if Windows supports the same MCP-connector-credential-paste flow.
| Login/auth surface (§7) | not confirmed in this pass | **Unverified** | Not covered by this pass's file set. Given the shared backend OAuth flow (`/v1/auth/authorize`), Windows almost certainly follows the same "open system browser, catch the callback" pattern rather than an in-app credential form — worth a quick confirmation pass but no reason to expect drift here.

### Surfaces with confirmed no Windows mechanism at all (highest-priority gaps)

1. **Context menus** — zero right-click UI anywhere in the Windows renderer (§9 vs. comparison table).
2. **Delete Account & Data** — no entry point, no confirmation flow (§8.2).
3. **Rich tray/status-item menu parity** — Windows tray is missing the toggle switches, account row, Report Issue, Sign Out, and Reset Onboarding that Mac's menu-bar menu carries (§1.3 vs. §11 row 1).
4. **Top-of-screen app-menu keyboard shortcuts** (⌘1-6 sidebar nav, ⌘+/−/0 font scale, ⌘R) — no confirmed Windows accelerator equivalent (§1.6 vs. §11 row 2).
