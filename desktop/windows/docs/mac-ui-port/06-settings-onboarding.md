# 06 — Settings & Onboarding (macOS reference spec)

**Reference:** Omi macOS desktop app at tag `v0.12.72+12072-macos` (commit `50d264c94`, 2026-07-12), read-only worktree `.worktrees/mac-ref/desktop/macos`. All Swift paths below are relative to `desktop/macos/`.
**Scope:** Settings navigation + every settings pane, first-run onboarding flow, sign-in, permission-state UI, update UI. Excludes the notch/floating bar itself (only its *settings* pane is covered).

> **⚠️ Accent color — purple (`#8B5CF6`):** this Mac tag uses `OmiColors.purplePrimary` `#8B5CF6` pervasively as the Settings accent (toggle tints, selected states, slider fills, icons, highlight overlays); each usage is marked "accent" below. **Product ruling relayed by the orchestrator (2026-07-14): the Windows port copies Mac's design as-is, including the purple accents — treat the accent inventory as a faithful-port checklist.** Note this conflicts with the tracked brand invariant `INV-UI-1` (`docs/product/invariants/brand-ui.md` / `AGENTS.md`: "never use purple", no-increase ratchet). Before implementation lands, either the invariant doc/guard must be updated to reflect the ruling or the ratchet will fail — resolve that conflict explicitly rather than silently shipping purple.

---

## 1. Design tokens

### 1.1 Colors — `Desktop/Sources/Theme/OmiColors.swift:8-66`

Dark theme only; no light theme exists anywhere in the app.

| Token | Hex | Typical use in Settings/Onboarding |
|---|---|---|
| `backgroundPrimary` | `#0F0F0F` | settings sidebar bg, onboarding bg, key-cap chips |
| `backgroundSecondary` | `#1A1A1A` | page bg tint, shortcut recorder card, onboarding text fields |
| `backgroundTertiary` | `#252525` | cards (at 0.5 opacity), search field, hover fills |
| `backgroundQuaternary` | `#35343B` | card borders (0.3), dividers, unselected strokes, slider tracks |
| `backgroundRaised` | `#1F1F25` | raised surfaces |
| `border` | `#3A3940` | generic border |
| `purplePrimary` | `#8B5CF6` | **accent — do not port; substitute neutral** |
| `purpleSecondary` / `purpleAccent` / `purpleLight` | `#A855F7` / `#7C3AED` / `#D946EF` | gradient accents (same rule) |
| `textPrimary` | `#FFFFFF` | titles |
| `textSecondary` | `#E5E5E5` | body/labels |
| `textTertiary` | `#B0B0B0` | captions/subtitles |
| `textQuaternary` | `#888888` | faint text |
| `success` | `#10B981` | status dots, "Enabled"/"Active" badges |
| `warning` | `#F59E0B` | permission errors, banner warnings |
| `error` | `#EF4444` | delete account, sign-in errors |
| `info` | `#3B82F6` | General-pane icons, Enable buttons, font slider tint |

### 1.2 Typography — `Desktop/Sources/Theme/OmiFont.swift`

- No custom typeface — SF system font via `.scaledFont(size:weight:design:)` (`OmiFont.swift:41-56`) = `Font.system(size: round(size * fontScale), ...)`.
- `fontScale` is a global multiplier: `FontScaleSettings.shared.scale`, UserDefaults key `"fontScale"`, default `1.0`, range 0.5–2.0 (set in General → Font Size). Windows equivalent: a root `rem`/zoom multiplier.
- Monospaced variants `scaledMonospacedFont` / `scaledMonospacedDigitFont` (`OmiFont.swift:60-88`) — shortcut key-caps, numeric stats.
- Common scale: page header 28 bold; sidebar title 22 bold; card title 14–16 semibold; category header 18 semibold; label 14; caption/subtitle 12–13; hint 11.
- `resetWindowToDefaultSize()` (`OmiFont.swift:92-101`): animates key window to **1200×800** centered — bound to General's "Reset Window Size" button.

### 1.3 Shared card/row components — `Desktop/Sources/MainWindow/Pages/Settings/Components/SettingsContentView+Controls.swift`

- **`settingsCard`** (:645-668) — universal container: content leading-aligned, `maxWidth: .infinity`, **padding 20**, `RoundedRectangle(cornerRadius: 12)` fill `backgroundTertiary.opacity(0.5)`, 1px stroke `backgroundQuaternary.opacity(0.3)`. Optional `settingId` attaches the search-highlight modifier (§2.4).
- **`settingRow(title:subtitle:control:)`** (:670-696) — title 14 `textSecondary` + subtitle 12 `textTertiary` (spacing 2), `Spacer()`, trailing control.
- **`privacyToggleRow`** (:743-773) — icon 14 (purple → neutral) in 20pt frame, title 14 medium `textPrimary`, subtitle 12 `textTertiary`, small `.switch` toggle.
- **`trackingItem`** (:719-729) — 4pt dot `textTertiary.opacity(0.5)` + text 12 `textTertiary`. **`privacyBullet`** (:731-741) — green checkmark 9 bold + text 12 `textSecondary`.
- **Custom stepped slider** (voice speed :17-110; notification frequency :116-206) — NOT a native slider: 6px rounded track (`backgroundQuaternary`), filled portion `purplePrimary` (→ neutral), 8pt step dots (accent up to current index), **22pt white thumb** with shadow (black 0.25, r3, y1), drag snaps to nearest step; current-value chip 13 semibold accent on `accent.opacity(0.15)` r8 (padding h10/v4); min/max captions 11 `textTertiary`.
- **`fontShortcutRow`** (:629-643) — label 13 `textTertiary` + monospace key chip 13 medium `textSecondary` on `backgroundTertiary.opacity(0.8)` r5, padding h8/v3.

---

## 2. Settings navigation

### 2.1 Sidebar — `Desktop/Sources/MainWindow/SettingsSidebar.swift`

`SettingsSidebar` replaces the main app sidebar while in Settings (:322). Fixed width **260pt** (:332), bg `backgroundPrimary` (:413). Top→bottom (:363-414):

1. **Back button** — `chevron.left` (14 semibold) + "Back" (14 medium), `textSecondary`; padding h12/v10; hover fill `backgroundTertiary.opacity(0.5)` r8 (:480-505). Top padding 12, horizontal 16.
2. 24pt spacer.
3. **"Settings"** title — 22 bold `textPrimary`, h-padding 16, bottom 12 (:373-377).
4. **Search field** — placeholder `"Search settings..."`; `magnifyingglass` icon (13) turns accent when focused else `textTertiary` (`.easeInOut(0.15)`); plain TextField 13; `xmark.circle.fill` clear button (12) when non-empty. Container: padding h10/v8, r8 fill `backgroundTertiary`, 1px accent-0.5 stroke when focused (:416-451).
5. **Section list** (or search results), no-indicator ScrollView, h-padding 8, item spacing 2.

### 2.2 Section order, labels, icons

`visibleSections` (:334-346); labels = `SettingsSection.rawValue` (`SettingsPage.swift:325-338`); icons `SettingsSidebarItem.icon` (`SettingsSidebar.swift:517-532`):

| # | Label | enum | SF Symbol | Suggested Windows icon |
|---|---|---|---|---|
| 1 | General | `.general` | `gearshape` | gear |
| 2 | Rewind | `.rewind` | `clock.arrow.circlepath` | history |
| 3 | Transcription | `.transcription` | `waveform` | waveform |
| 4 | Notifications | `.notifications` | `bell` | bell |
| 5 | Privacy | `.privacy` | `lock.shield` | shield-lock |
| 6 | Account | `.account` | `person.circle` | user-circle |
| 7 | Plan and Usage | `.planUsage` | `creditcard` | credit-card |
| 8 | Floating Bar | `.floatingBar` | `sparkles` | sparkles |
| 9 | Shortcuts | `.shortcuts` | `keyboard` | keyboard |
| 10 | Advanced | `.advanced` | `chart.bar` | bar-chart |
| 11 | About | `.about` | `info.circle` | info-circle |

A 12th case `.aiChat` ("AI Chat", `cpu`) exists but is **hidden from the rail** (`SettingsSidebarItem` renders `EmptyView()`, :536-537) and force-redirected to `.advanced` on production bundles (`SettingsPage.swift:528-530, 553-556`).

Row rendering (:534-569): icon 17pt in 20pt frame; label 14 (medium when selected); selected icon/text `textPrimary`, unselected icon `textTertiary` / text `textSecondary`; padding h12/v11; selected bg `backgroundTertiary.opacity(0.8)`, hover `0.5`, r10. Section switch animates `.easeInOut(0.15)`.

### 2.3 Settings search registry

`SettingsSearchItem.allSearchableItems` (`SettingsSidebar.swift:19-319`) — static registry of **56 searchable entries** (name, subtitle, keywords, target section, icon, `settingId` anchor). Matching: every whitespace-split query word must substring-match name OR subtitle OR any keyword, case-insensitive (:348-361). Result row: icon 14 `textTertiary` (20 frame), name 13 medium `textPrimary`, breadcrumb = section rawValue 11 `textTertiary`; padding h12/v8, hover fill r8 (:618-657). Empty state: `"No results"` 13 `textTertiary` (padding h12/v20). Selecting: switch section (`.easeInOut(0.15)`), clear query, after 0.25s set `highlightedSettingId` (:463-474).

Full settingId registry (use as the port's anchor ids):
`general.rewind/.systemaudio/.notifications/.askomi/.fontsize/.resetwindow` · `rewind.rewind/.screencapture/.audiorecording/.storage/.excludedapps/.battery/.retention` · `transcription.settings/.languagemode/.voicelanguages/.vocabulary/.vadgate` · `notifications.settings/.frequency/.focus/.task/.insight/.memory/.dailysummary/.summarytime` · `privacy.privacy/.storerecordings/.cloudsync/.encryption/.tracking` · `account.account/.signout` · `planusage.overview/.current/.purchase` · `about.updates/.autoupdates/.autoinstall/.channel/.version/.reportissue` · `advanced.resetonboarding/.aiuserprofile/.stats/.goals/.goals.autogenerate/.preferences.multichat/.preferences.launchatlogin/.troubleshooting.reportissue/.troubleshooting.rescanfiles` · `aichat.provider/.workspace/.browserextension/.devmode` · `floatingbar.show/.background/.draggable/.typedvoiceanswers/.screenshare/.voicespeed/.shortcut/.ptt/.doubletap/.pttsounds`.

### 2.4 Deep-link highlight mechanic

`SettingHighlightModifier` (`SettingsSidebar.swift:661-685`): target card gets overlay `purplePrimary.opacity(0.12)` r8 (→ neutral tint on Windows) fading in `.easeInOut(0.3)`, holds 1.5s, fades out 0.5s. `SettingsPage` scrolls the anchor to `.center` with `.easeInOut(0.3)` after 0.2s (`SettingsPage.swift:45-52`). External deep links: `.navigateToTaskSettings` → Advanced + highlight; `.navigateToFloatingBarSettings` → Floating Bar (`SettingsPage.swift:567-575`).

### 2.5 Page container — `Desktop/Sources/MainWindow/Pages/SettingsPage.swift`

- ScrollView; header = section rawValue at **28 bold `textPrimary`**, padding h32/top32/bottom24, opacity crossfade `.easeInOut(0.15)` on section change; content `SettingsContentView` h-padding 32; page bg `backgroundSecondary.opacity(0.3)` (:54).
- `SettingsContentView`: `VStack(spacing: 24)`, switch over section (:492-522), `.id(selectedSection)` + `.transition(.opacity)` + `.animation(.easeInOut(0.15))`.
- **Section-entry side effects** (:527-565): on appear — load backend settings + subscription, sync `isTranscribing`, sync `showAskOmiBar` from `FloatingControlBarManager.shared.isEnabled`, read extension token, check Claude connection, refresh notification permission. Entering `.planUsage` refetches subscription + trial metadata + `FloatingBarUsageLimiter.shared.fetchPlan()`. Notification permission re-checked on window activation (:576-580).
- Sheets: `BillingWebFlowSheet` (item `activeBillingWebFlow`), `BrowserExtensionSetup` (:581-602).
- `SettingsViewModel.swift` (23 lines): `@Published isLoadingBackendSettings`, `isLoadingSubscription`, `subscriptionError: String?`, plus `lastBackendSettingsLoadAt/lastBillingRefreshAt/lastIntegrationSyncAt` timestamps.

---

## 3. Settings panes (in sidebar order)

### 3.1 General — `Sections/SettingsContentView+General.swift`

`VStack(spacing: 20)` of `settingsCard`s:

**Screen Capture** (`general.screencapture` — search registry maps it under rewind.*, card lives here; :11-55)
- HStack(16): **status dot** 12pt circle — `success` green when `isMonitoring` else `textTertiary.opacity(0.3)`; glow shadow `success.opacity(0.5)` r6 when on.
- Icon `rectangle.dashed.badge.record` 16 `info` blue. Title **"Screen Capture"** 16 semibold; subtitle 13 = `permissionError` (in `warning`) or `"Capturing screen content"` / `"Screen capture is paused"` (`textTertiary`).
- `.switch` Toggle bound to `isMonitoring` → `toggleMonitoring(enabled:)`; replaced by `ProgressView().scaleEffect(0.8)` while toggling. Backed by `ProactiveAssistantsPlugin.shared.isMonitoring`; externally synced via `.assistantMonitoringStateDidChange` (`SettingsPage.swift:543-548`).

**Audio Recording** (:57-112)
- Status dot: green when transcribing; **amber `warning` when `appState.isAwaitingMeeting`**; gray off.
- Icon `mic.fill` 16 info. Title **"Audio Recording"** 16 semibold. Subtitle: `transcriptionError` (warning) or `"Waiting for a meeting…"` / `"Recording and transcribing audio"` / `"Audio recording is paused"`.
- Toggle bound to `isTranscribing` → `toggleTranscription(enabled:)` (two-way synced with `appState.isTranscribing`).

**System Audio** (`general.systemaudio`, :114-165) — gated `#available(macOS 14.4, *)`
- Icon `speaker.wave.2.fill` 16 info. Title **"System Audio"**; caption `"Choose when Omi records audio from other apps (calls, videos, music)."`
- `.menu` Picker (width 200): **"Always" / "Only during meetings" / "Never"** → `AssistantSettings.shared.systemAudioCaptureMode` (UserDefaults `systemAudioCaptureMode`, **default `.onlyDuringMeetings`**, `AssistantSettings.swift:44`). Setter posts `.systemAudioCaptureModeDidChange`.
- Conditional footnote when "Only during meetings" (12 `textTertiary`): `"Omi captures other apps' audio only while you're in a call (e.g. Zoom, Teams, FaceTime). Detecting browser-based calls like Google Meet requires Screen Recording permission."`

**Notifications** (`general.notifications`, :167-262) — **permission-state UI**
- Status dot: green (granted && banners on), **amber** (banner-disabled), gray (not granted). Title **"Notifications"**; subtitle = `notificationStatusText` (`SettingsPage.swift:482-490`): `"Notifications are disabled"` / `"Enabled but banners are off"` / `"Proactive alerts enabled"` (amber when banner-disabled).
- Trailing per state:
  - Granted+banners → green **"Enabled"** capsule badge (12 medium, `.green` on `green.opacity(0.15)`, padding h10/v4).
  - Banner-disabled → **"Fix"** button (12 semibold white, r6 fill `warning`) → opens System Settings notification prefs.
  - Not granted → **"Enable"** button (same style, fill `info`) → `appState.repairNotificationAndFallback()`.
- Extra warning row when banners disabled: `exclamationmark.triangle.fill` 12 + `"Banners disabled - you won't see visual alerts. Set style to \"Banners\" in System Settings."` 12, both `warning`, in `warning.opacity(0.1)` r8 box, padding 10 (:241-260).
- Permission auto-refreshes on window activation.

**Font Size** (`general.fontsize`, :264-344)
- Icon `textformat.size` 16 medium info. Title **"Font Size"**; subtitle `"Scale: NN%"`.
- Conditional **"Reset"** text button (12 medium, info) when scale ≠ 1.0.
- Slider row: small "A" (12) … `Slider(0.5...2.0, step 0.05).tint(info)` … large "A" (18). Binds `FontScaleSettings.shared.scale`.
- Preview line `"The quick brown fox jumps over the lazy dog"` 14 `textSecondary`.
- `fontShortcutRow`s: "Increase font size" ⌘+ · "Decrease font size" ⌘− · "Reset font size" ⌘0 (Windows: Ctrl equivalents).
- Trailing **"Reset Window Size"** button: `arrow.uturn.backward` 11 + text 12 medium `textSecondary`, `backgroundTertiary` r6 chip, padding h10/v5 → resets window to 1200×800.

### 3.2 Rewind — `Sections/SettingsContentView+Rewind.swift`

Four cards (capture toggles live in General; search maps `rewind.screencapture`/`rewind.audiorecording` there):

1. **Storage** (`rewind.storage`, :11-40): `internaldrive.fill` 16 accent; "Storage" 15 medium; subtitle `"{total} frames • {size}"` via `RewindStorage.formatBytes`, or **"Loading..."** while nil. Loaded `.task { RewindIndexer.shared.getStats() }`.
2. **Excluded Apps** (`rewind.excludedapps`, :43-115): `eye.slash.fill` 16 accent; caption `"Screen capture is paused when these apps are active"`; trailing **"Reset to Defaults"** (`.bordered`, `.small`) → `rewindSettings.resetToDefaults()`. Empty state: `checkmark.shield` 24 + `"No apps excluded"` 13, centered, v-padding 16. Else `LazyVStack(spacing: 8)` of `ExcludedAppRow` (sorted) with remove buttons. Then **`AppRuleEditorView`** (`Components/AppRuleEditorView.swift`): title `"Add App to Exclusion List"`, placeholder `"App name (e.g., Passwords)"`, button `"Add"`, built-in suggestions from `TaskAssistantSettings.builtInExcludedApps`. Binds `RewindSettings.shared`.
3. **Battery Optimization** (`rewind.battery`, :118-144): `battery.75percent` 16 accent; caption `"On battery, Omi captures your screen less often to save power while keeping text recognition accurate."`; trailing static text **"Automatic"** 13 medium `textSecondary` (no control).
4. **Data Retention** (`rewind.retention`, :147-176): `clock.fill` 16 accent; caption `"How long to keep screen recordings"`; `.menu` Picker width 110 → `$rewindSettings.retentionDays`, options **3 / 7 / 14 / 30 days**.

### 3.3 Transcription — `Sections/SettingsContentView+Transcription.swift`

Four cards:

**Language Mode** (`transcription.languagemode`, :11-154)
- Header: `globe` 16 accent + **"Language Mode"** 15 medium.
- Two radio-card buttons (padding 12, r8; selected: fill `accent.opacity(0.1)` + stroke `accent.opacity(0.3)`; unselected: clear + `backgroundQuaternary` 1px). Radio icon `checkmark.circle.fill` (selected) / `circle` (`textTertiary`) at 20pt.
  - **"Auto-Detect (Multi-Language)"** (14 medium) — `"Automatically detects and transcribes:"` (12) + `"English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian, Dutch"` (11). Sets `AssistantSettings.shared.transcriptionAutoDetect=true` (key `transcriptionAutoDetect`, **default true**), backend sync `updateTranscriptionPreferences(singleLanguageMode:false)`, then `restartTranscriptionIfNeeded()` (stop → 1.0s → start, :314-324).
  - **"Single Language (Better Accuracy)"** (14 medium) — `"Best for speaking in one specific language"` (12). When selected reveals `"Language:"` + `SearchableDropdown(title:"Language", minWidth:180)` over `AssistantSettings.supportedLanguages` (86 entries, `AssistantSettings.swift:304-387`). Persists `transcriptionLanguage` (default `"en"`); auto-reverts to auto-detect if the picked language supports multi (`supportsAutoDetect`, :390-401).
- Footer: `info.circle` 12 + `"Single language mode supports {count} languages including Chinese, Ukrainian, Russian, and more."` (11 `textTertiary`).

**Voice Assistant Languages** (`transcription.voicelanguages`, :156-159, 336-442)
- Header: `person.wave.2` 16 `textSecondary` + **"Voice Assistant Languages"** 15 medium; caption `"Languages you speak to Omi over push-to-talk — the first is your primary. Omi identifies which one you're speaking each turn."` 13.
- Chip multi-select in `FlowLayout(spacing: 6)`: capsule chips, padding h10/v6, text 12; **selected: white-0.9 fill, `backgroundPrimary` text, semibold**; primary (first) shows `"Name ✓"`; unselected: clear + `backgroundQuaternary` stroke, `textSecondary`. Order preserved = priority.
- Trailing `SearchableDropdown(title:"Add language", label:"More…")`.
- Binds `AssistantSettings.shared.voiceLanguages` (key `voiceAssistantLanguages`); never persists empty; setter posts `.voiceLanguagesDidChange` (re-warms realtime hub). Default fallback `[transcriptionLanguage]`.

**Custom Vocabulary** (`transcription.vocabulary`, :162-244)
- Header: `text.book.closed` 16 accent; **"Custom Vocabulary"** 15 medium; caption `"Improve recognition of names, brands, and technical terms"`; trailing `"N terms"` 12 when non-empty.
- Tag cloud `FlowLayout(spacing: 6)`: chip = term 12 `textSecondary` + `xmark` remove (9 medium `textTertiary`), padding h10/v6, r6 fill `backgroundQuaternary`.
- Divider; add row: `TextField("Add a word...")` `.roundedBorder` + `plus.circle.fill` 20 (accent enabled / `textTertiary` disabled).
- Hint: `"Press Enter or click + to add • Click × to remove"` 11 `textTertiary`.
- Case-insensitive dedupe; persists `AssistantSettings.shared.transcriptionVocabulary` (default `[]`; "Omi" always appended for Deepgram via `effectiveVocabulary`) + backend sync comma-joined.

**Local VAD Gate** (`transcription.vadgate`, :247-277)
- `waveform.badge.minus` 16 accent; **"Local VAD Gate"** 15 medium; caption `"Uses on-device voice activity detection to skip silence, reducing Deepgram API usage. May save ~40% on transcription costs."`
- `.switch` Toggle → `AssistantSettings.shared.vadGateEnabled` (key `vadGateEnabled`, **default false**) + transcription restart.

### 3.4 Notifications — `Sections/SettingsContentView+NotificationsPrivacy.swift:8-158`

**Notifications card** (`notifications.settings`, :11-106)
- Header: `bell.badge.fill` 16 accent + **"Notifications"** 15 medium + master `.switch` `$notificationsEnabled` → backend `updateNotificationSettings(enabled:)` (**default true**).
- Caption `"Control how often you receive notifications"` 13.
- When enabled (conditional reveal below Divider):
  - **Frequency slider** (`notifications.frequency`) — custom 6-step slider (§1.3); labels `(0,"Off") (1,"Minimal") (2,"Low") (3,"Balanced") (4,"High") (5,"Maximum")` (`SettingsPage.swift:269-276`); **default 3 "Balanced"**; persists via backend `updateNotificationSettings(frequency:)`. Row label "Frequency" / caption "How often to receive notifications".
  - `settingRow` **"Focus Notifications"** / `"Show notification on focus changes"` (`notifications.focus`) → `FocusAssistantSettings.shared.notificationsEnabled` (key `focusNotificationsEnabled`, default **true**) + `SettingsSyncManager.shared.pushPartialUpdate`.
  - **"Task Notifications"** / `"Allow interruptions when a task needs attention"` (`notifications.task`) → `TaskAssistantSettings.shared.notificationsEnabled` (default **false**) + sync.
  - **"Insight Notifications"** / `"Show notification when an insight is generated"` (`notifications.insight`) → `InsightAssistantSettings.shared.notificationsEnabled` (default **true**) + sync.
  - **"Memory Notifications"** / `"Show notification when a memory is extracted"` (`notifications.memory`) → `MemoryAssistantSettings.shared.notificationsEnabled` (default **false**) + sync.

**Daily Summary card** (`notifications.dailysummary`, :109-155)
- `text.badge.checkmark` 16 accent + **"Daily Summary"** 15 medium + `.switch` `$dailySummaryEnabled` (**default true**) → backend `updateDailySummarySettings(enabled:)`.
- Caption `"Receive a daily summary of your conversations and activities"`.
- When enabled: `settingRow` **"Summary Time"** / `"When to send your daily summary"` (`notifications.summarytime`) — `.menu` Picker width 100 over hours 0–23 rendered 12-hour AM/PM; **default hour 22** (10 PM).

### 3.5 Privacy — same file, :162-301

1. **Data Controls** (`privacy.storerecordings`, :165-191): header **"Data Controls"** 15 semibold. Two `privacyToggleRow`s + Divider:
   - `mic.fill` **"Store Recordings"** / `"Allow omi to store audio recordings of your conversations"` → `$recordingPermissionEnabled` (backend; **default false**) → `updateRecordingPermission(_)`.
   - `cloud.fill` **"Private Cloud Sync"** / `"Sync your data securely to your private cloud storage"` → `$privateCloudSyncEnabled` (backend; **default true**) → `updatePrivateCloudSync(_)`.
2. **Encryption** (`privacy.encryption`, :194-230): `shield.lefthalf.filled` 14 accent + "Encryption" 14 medium; status row `checkmark.circle.fill` 12 green + `"Server-side encryption"` 13 + green **"Active"** badge (10 semibold on `green.opacity(0.15)` r3, padding h5/v1); footer `"Your data is encrypted and stored securely with Google Cloud infrastructure."` 12 `textTertiary`. Static.
3. **What We Track** (`privacy.tracking`, :233-276): disclosure — `list.bullet` 14 accent + "What We Track" 14 medium + `chevron.right` 11 semibold rotating 90°; `withAnimation(.easeInOut(0.2))`. Expanded: 10 `trackingItem` bullets, verbatim: "Onboarding steps completed", "Settings changes", "App installations and usage", "Transcript processing events", "Conversation creation and updates", "Memory extraction events", "Chat interactions", "Speech profile creation", "Focus session events", "App open/close events". `.transition(.opacity)`.
4. **Privacy Guarantees** (`privacy.privacy`, :279-299): `hand.raised.fill` 14 accent + "Privacy Guarantees" 14 medium; 4 `privacyBullet`s: "Anonymous tracking with randomly generated IDs", "No personal info stored in analytics", "Data is never sold or shared with third parties", "Opt out of tracking at any time".

### 3.6 Account — `Sections/SettingsContentView+AccountBilling.swift:8-123`

Single card:
- Row: `person.circle.fill` 40pt `textTertiary` · `AuthService.shared.displayName` (fallback "User") 16 semibold · `AuthState.shared.userEmail` 13 `textTertiary` · trailing **"Sign Out"** (`.bordered`) → stops transcription + monitoring, `AuthService.shared.signOut()`.
- Divider; **"Delete Account & Data"** row: title 15 semibold in `error`; caption `"Permanently deletes server data, clears local data for this account, resets onboarding, and signs you out."`; **"Delete"** button (`.borderedProminent` tint `error`), spinner while `isDeletingAccount`. Confirmation alert: **"Delete Account and Data?"** — Cancel / destructive **"Delete Permanently"** with warning body (:82-93). Errors 12 `warning` below card.
- A commented-out "Upgrade to Pro" card (:95-121) is dead code — do not port.

### 3.7 Plan and Usage — `+AccountBilling.swift:128-623` + `Components/SettingsContentView+BillingHelpers.swift` + `Components/BillingWebFlow.swift`

Cards in order (`planUsageSection`, :258-392):

1. **Trial countdown card** (:128-212) — only when `appState.trialMetadata` has an active/expired trial.
   - Active: clock icon colored by urgency (`≤1h` → `warning`, `≤24h` → yellow, else `success`); **"Premium Trial Active"** + countdown `"Xd Yh remaining"` / `"Xh Ym remaining"` / `"Xm remaining"`; circular progress ring (3pt stroke) of remaining/total; divider; "Included in your trial" checkmark bullets: "Unlimited listening & transcription", "Unlimited memories & insights", "Chat questions".
   - Expired: warning triangle, **"Trial Ended"** / "Upgrade to keep unlimited access", **"View Plans"** button (preselects Operator).
2. **Current plan card** (`planusage.current`) — `creditcard` icon (accent), `currentPlanTitle` + subtitle. Trailing: spinner while loading; **"Manage"** (opens Stripe customer portal, `isOpeningCustomerPortal` spinner) if paid, else **"Refresh"**. Paid plans show `"Renews on …"` / `"Access ends on …"`.
   - **Plan-name mapping** (`BillingHelpers.swift:35-78`): backend `.basic`→**"Free"**, `.unlimited`→**"Neo"** (unless current Stripe price matches an "Operator"-titled catalog entry → "Operator"), `.architect`/`.pro`→**"Architect"**, `.operator`→**"Operator"**; BYOK-active always displays **"Free (BYOK)"**. Loading text `"Loading plan..."`.
3. **Plan deprecation banner** (`planusage.deprecation`) — only if `subscription.deprecated`: warning icon, **"Plan Retiring"**, default message `"Your Unlimited plan is being retired. Try the new Operator plan — same great features at $49/mo."`, **"Try Operator"** button (green tint).
4. **Choose a plan card** (`planusage.purchase`, when `shouldShowPlanPurchaseOptions`) — horizontal scroll of plan cards (excludes current), sorted Neo(0) / Operator(1) / Architect(2).
5. **Chat usage quota card** (:560-623) — **"Usage this month"** + value (`"$X.XX / $Y"` cost-based or `"used / limit"` count-based); linear progress bar tinted accent normally, `warning` at ≥80% or over; description + reset text (`"Resets today"`/`"tomorrow"`/`"in N days"`); conditional over-limit / ≥80% warning copy. Loading: `"Loading usage…"` + spinner.
6. **Overage card** (`planusage.overage`, :394-453) — only when `overageInfo.isOveragePlan`: `dollarsign.circle.fill` (warning, excess>0) / `checkmark.circle.fill` (success) 18pt; **"Usage-based overage"** / **"No overage yet this cycle"** 14 semibold; right `$X.XX` 15 semibold warning monospacedDigit. Body: excess → `"You've gone {N} question(s) past your plan's {M} included. We'll bill the overage at end of your cycle."`; else `"Go over your {M} included questions and we'll charge real provider cost + {P}%. No hard cutoff."` Explainer link → sheet (:455-517, min 440×360): title ("How overage billing works" fallback) + rows "Questions used" / "Included in plan" / "Over the limit" / "Real provider cost" / "Markup" / "Overage to bill" (label 12 `textTertiary`, value 12 monospacedDigit; final row semibold warning).
7. **BYOK promo card** (`planusage.byok`, :519-556) — `key.fill` 20 accent; title **"Free plan active"** (BYOK active) / **"Use Omi free forever"**; caption active → `"You're using your own OpenAI, Anthropic, Gemini, and Deepgram keys. No subscription."` else `"Provide your own OpenAI, Anthropic, Gemini, and Deepgram keys to skip the subscription entirely."`; button **"Manage your keys"** / **"Switch to your own keys"** (`.bordered`) → switches to Advanced, highlights `advanced.devkeys.info` after 0.25s.

**Plan purchase card** (`BillingHelpers.swift:300-493`): padding 20, r18; selected fill `accent.opacity(0.12)` + 1.5px `accent.opacity(0.85)` stroke, unselected `backgroundPrimary.opacity(0.68)` + 1px `backgroundQuaternary`. Header: eyebrow 10 bold UPPERCASED tracking 0.8 in accent; title 18 bold; subtitle 12 `textTertiary`; right: starting price 17 bold (accent when selected, minScale 0.72) over "starting price" 10 medium. Description 13 `textSecondary`; up to 4 feature rows (18×18 `accent.opacity(0.16)` circle + 9-bold accent check + text 13 medium). Then: (a) selected+purchasable → **promo-code disclosure** (tag icon + "Promo code" 12 + chevron, expands `.easeInOut(0.2)`, TextField `"Enter promo code"`) + "Choose billing" 12 semibold + per-price `.borderedProminent` buttons (price.title 12 bold — "Monthly"/"Annual" — over priceString 11; spinner during checkout); (b) **"Current Plan"** badge + checkmark; (c) **"Select {plan.title}"** + arrow CTA. Downgrade guard: Architect/pro users can't buy Neo. Accent per plan (`planAccentColor`): Architect = `purplePrimary`, Operator/Neo = `success` green.

Verbatim copy tables (`BillingHelpers.swift:121-180`): eyebrows — unlimited "Starter", operator "Most popular", architect "Automation + coding" (rendered uppercase). Subtitles — unlimited "200 questions per month", operator "500 questions per month", architect "Power-user AI — thousands of chats + agentic automations". Descriptions — unlimited **"100 chat questions per month. Shared with mobile and web."** (⚠️ source inconsistency: subtitle says 200, description says 100 — don't propagate blindly), operator "500 chat questions per month. Shared with mobile and web.", architect "Power-user AI for heavy agentic workflows and vibe coding."

Fallback feature lists (`BillingHelpers.swift:217-243`, used when server catalog missing):
- Architect: "Automations and vibe coding" · "Unlimited listening, memories, and insights" · "Priority desktop AI features" · "~$400 of monthly AI compute included (fair-use cap)"
- Operator: "500 chat questions per month" · "Unlimited listening and transcription" · "Unlimited memories and insights" · "Shared with mobile and web"
- Neo: "200 chat questions per month" + the same last 3 lines.

**Checkout flow** (`AccountBilling.swift` `startCheckout`, `BillingHelpers.swift:919-1015`): existing active paid sub → `upgradeSubscription` (change at period end, no double charge); else `createCheckoutSession` → **`BillingWebFlow`** sheet (`Components/BillingWebFlow.swift`): embedded `WKWebView` min 860×680, title bar + "Close"; success/cancel detected by redirect match on `v1/payments/success` / `v1/payments/cancel`. Windows equivalent: embedded webview window or system-browser flow with a local callback.

### 3.8 Floating Bar — `Sections/SettingsContentView+FloatingBarAndChat.swift` (`floatingBarSection`)

- **"Show floating bar"** toggle (`floatingbar.show`) with green pulsing status dot when on; binds `FloatingControlBarManager.shared.isEnabled` (synced on section entry).
- **"Background Style"** (`floatingbar.background`) — segmented Transparent / Solid Dark labels flanking a `Toggle` bound to `ShortcutSettings.shared.solidBackground` (key `shortcut_solidBackground`, **default false** = transparent).
- **"Draggable Floating Bar"** toggle (`floatingbar.draggable`) → `draggableBarEnabled` (key `shortcut_draggableBarEnabled`, **default false**).
- **"Typed Questions"** toggle (`floatingbar.typedvoiceanswers`) — speak TTS replies for typed floating-bar questions → `floatingBarTypedQuestionVoiceAnswersEnabled` (**default false**; PTT replies always spoken — `floatingBarVoiceAnswersEnabled` hardcoded true, `ShortcutSettings.swift:371`).
- **"Screen Sharing in Chat"** toggle (`floatingbar.screenshare`) → `@AppStorage(chatScreenshotSharingEnabled)` (**default true**).
- **Voice picker** — menu width 180 over `ShortcutSettings.voiceOption` catalog (`ShortcutSettings.swift:440-489`): **Onyx** ("OpenAI, deep, grounded"), **Shimmer** ("OpenAI, warm human, cheap"), **Coral** ("OpenAI, bright, expressive"), **Nova** ("OpenAI, clear, friendly"); default **`openai:shimmer`** (key `shortcut_selectedVoiceID`). Changing voice plays a sample + prewarms kickoff phrases (:500-507).
- **Voice speed slider** (`floatingbar.voicespeed`) — custom stepped slider; steps `[0.8, 1.0, 1.2, 1.4, 1.6, 2.0]`, labels Slow/Normal/Fast/Faster/Very Fast/Maximum; **default 1.4** (key `shortcut_voicePlaybackSpeed`); dimmed to 0.55 opacity + disabled unless any voice answers enabled.

### 3.9 Shortcuts — `Desktop/Sources/MainWindow/Pages/ShortcutsSettingsSection.swift` + `Desktop/Sources/FloatingControlBar/ShortcutSettings.swift`

Standalone view; own cards (padding 20, r12, fill `backgroundTertiary.opacity(0.5)`, no stroke). Body = `askOmiKeyCard, pttKeyCard, doubleTapCard, pttSoundsCard, muteAudioCard` (:20-31). (A `referenceCard` "Keyboard Shortcuts" summary at :237-260 is **dead code** — not in body; don't port.)

**Ask omi Shortcut card** (`floatingbar.shortcut`, :33-79)
- Title **"Ask omi Shortcut"** 16 semibold; caption `"Global shortcut to open Ask omi from anywhere."` 13 `textSecondary`.
- Preset pills (HStack spacing 12) from `ShortcutSettings.askOmiPresets` (`ShortcutSettings.swift:281-286`): **⌘O** (default), **⌘↩**, **⌘⇧↩**, **⌘J**. Pill: tokens 13 medium, padding h14/v10, r10; selected fill `accent.opacity(0.3)` + 1.5px accent stroke; unselected `backgroundTertiary.opacity(0.5)` (:332-353).
- **"Custom"** pill → enables + starts capture. **"Disable"** pill (selected style when `askOmiEnabled == false`).
- **Recorder card** (:57-69, 355-413): title `"Press your custom Ask omi shortcut now"` (recording) / `"Custom Ask omi shortcut"` 13 semibold; tokens as key-caps (13 semibold on `backgroundPrimary` r8 chips, padding h8-10/v7); button **"Listening..."** (recording) / **"Save"** (12 semibold on `backgroundPrimary` r10); helper `"Use at least one non-modifier key."` 12; errors red-0.9 12 medium. Card padding 14, r12, fill `backgroundSecondary.opacity(0.85)`.
- Capture: local NSEvent monitor on `.flagsChanged/.keyDown`; **rejects modifier-only** with `"Ask omi needs a non-modifier key."`; removed on disappear (:415-466).

**Push to Talk card** (`floatingbar.ptt`, :95-141)
- Title **"Push to Talk"** 16 semibold; caption `"Hold the key to speak, release to send your question to AI."`
- Presets `pttPresets` (`ShortcutSettings.swift:288-293`): **⌥ Option** (default), **Right ⌘** (keyCode 54), **fn**, **⌃ Control** — all modifier-only. Plus Custom + Disable. Recorder helper: `"One key or a key combination both work."` (modifier-only allowed here).
- Modifier token order ⌃ ⌥ ⇧ ⌘ fn; special-key display map (`ShortcutSettings.swift:191-268`); modifier-only display labels "Option"/"Fn"/"Command"/"Control"/"Shift"/"Right Cmd".

**Toggle cards** (each padding 20 r12; **dimmed 0.55 + disabled when `pttEnabled == false`**; `.switch` tinted accent):
- **"Double-tap for Locked Mode"** / `"Double-tap the push-to-talk key to keep listening hands-free. Tap again to send."` → `doubleTapForLock` (key `shortcut_doubleTapForLock`, **default true**); id `floatingbar.doubletap`.
- **"Push-to-Talk Sounds"** / `"Play audio feedback when starting and ending voice input."` → `pttSoundsEnabled` (key `shortcut_pttSoundsEnabled`, **default true**); id `floatingbar.pttsounds`.
- **"Mute Audio While Talking"** / `"Silence music and other playback while holding push-to-talk, then restore it on release."` → `pttMuteSystemAudio` (key `shortcut_pttMuteSystemAudio`, **default true**); id `floatingbar.muteaudio` (not in search registry).

**`ShortcutSettings` persistence** (`ShortcutSettings.swift:528-574`): `KeyboardShortcut` Codable (`keyCode: UInt16?`, `keyDisplay`, `modifiersRawValue`, `modifierOnly`, `requiresRightCommand`) JSON-encoded to UserDefaults `shortcut_askOmiKey` / `shortcut_pttKey` (legacy string migration :598-624). Defaults: `askOmiShortcut` **⌘O**; `pttShortcut` **Option**; `askOmiEnabled`/`pttEnabled` **true**; `pttTranscriptionMode` `shortcut_pttTranscriptionMode` default **`.batch`** (enum: Live = "Real-time transcription as you speak" / Batch = "Transcribe after recording for better accuracy", :349-359 — no visible picker in this pane at this tag). Shortcut changes post `askOmiShortcutChanged` for hotkey re-registration (:301-313).

### 3.10 Advanced — `Sections/SettingsContentView+Advanced.swift` (+ parts of `+Assistants.swift`)

Linear scroll with **category headers** (icon + 18 semibold title, `advancedCategoryHeader`) — NOT sub-navigation. Exact order:

1. **"AI Setup"** (`cpu`) → `aiSetupSubsection`:
   - **Voice Model** picker — `RealtimeOmniSettings` (`RealtimeOmni/RealtimeOmniSettings.swift:15-47`): UserDefaults `realtimeOmniProvider` default `"auto"`. Options: **"Auto"** ("Daily-picks the best model by quality & speed", shows live-resolved effective provider), **"Gemini 3.1 Flash Live"** ("Google · native audio + vision, lowest cost"), **"GPT Realtime 2"** ("OpenAI · GA speech-to-speech").
   - **AI Provider** picker — `@AppStorage("chatBridgeMode")` default `"piMono"`, options from `AIProvider.all`; shows Claude-connected status + **Disconnect** when in `claudeCode` mode.
   - **Workspace** directory picker — NSOpenPanel, **Browse** / **Clear**.
   - **Browser Extension** toggle + token setup flow (`playwrightUseExtension` default true; token `playwrightExtensionToken`).
   - **Dev Mode** toggle — `"Let the AI modify the app's source code, rebuild it, and add custom features"` → `@AppStorage("devModeEnabled")` default false.
2. **"Profile & Stats"** (`brain`) → collapsed-by-default card, eye/eye-slash + **Show/Hide** button (`showProfileAndStats` default false). When shown:
   - **AI User Profile**: generated profile text block; **Generate Now/Regenerate**; edit mode (TextEditor + Cancel/Save); `"Last updated: {relative}"`; `"Data sources: N items"`; pencil (edit) + trash (delete/revert) icon buttons. Polls `AIUserProfileService` up to 6× at 5s intervals if no profile.
   - **Your Stats** card: `statRow`s — Conversations, Apps Installed, AI Chat Messages, Screenshots, Focus Sessions, Tasks (To Do/Done/Removed), Goals, Memories. Per-row spinner while loading; `"Unable to load stats"` on failure.
3. **"Reset Onboarding"** (`arrow.counterclockwise`) (`+Assistants.swift:1181`): **"Reset"** button (white bg, black text) → alert **"Reset Onboarding?"** / `"This will reset onboarding for this app build only, clear onboarding chat history, and restart the app without affecting the other installed build."` → `appState.resetOnboardingAndRestart()`.
4. **"Goals"** (`target`) (`+Assistants.swift:957`): caption `"Track personal goals with AI-powered progress detection from your conversations"`; **"Auto-Generate Goals"** toggle → `GoalGenerationService.shared.isAutoGenerationEnabled`.
5. **"Preferences"** (`slider.horizontal.3`) (`+Assistants.swift:997`):
   - **"Multiple Chat Sessions"** toggle → `@AppStorage("multiChatEnabled")` default false; subtitle switches "Create separate chat threads" / "Single chat synced with mobile app".
   - **"Use old Home design"** toggle → `@AppStorage("useLegacyHomeDesign")` default false.
   - **"Launch at Login"** toggle → `LaunchAtLoginManager.shared`; subtitle = `statusDescription`.
6. **"Troubleshooting"** (`wrench.and.screwdriver`) (`+Assistants.swift:1092`): **"Report Issue"** card (accent **"Report"** pill → `FeedbackWindow`); **"Rescan Files"** card (accent **"Rescan"** pill → alert "Rescan Files?" → posts `.triggerFileIndexing`).
7. **"Developer API Keys"** (`key`) → §3.11.
8. **"Dev Tools"** (`hammer`): **"Chat Prompt Lab"** card (flask icon) → **"Open"** opens `ChatLabWindowManager` window.

### 3.11 Developer API Keys — `Sections/SettingsContentView+DeveloperKeys.swift`

- **BYOK status banner** (`advanced.devkeys.info`): green `checkmark.seal` + **"Free plan active"** when BYOK active, else key icon `textTertiary` + **"Use Omi free forever"**; explains all 4 keys required.
- Four `developerKeyField` cards: **"OpenAI API Key"**, **"Anthropic API Key"**, **"Gemini API Key"**, **"Deepgram API Key"** — each: purpose subtitle, `SecureField` placeholder `"Leave blank for default"`, inline status badge by title: **"Checking…"** (spinner) / **"Valid"** (green) / **"Invalid"** (warning). Stored in `@AppStorage` keys `dev_openai_api_key` / `dev_anthropic_api_key` / `dev_gemini_api_key` / `dev_deepgram_api_key` (default empty).
- Validation on any change (`refreshBYOKActivation`) → `BYOKValidator.validateAll`; BYOK activates server-side only if **all 4 pass**, else deactivates + error naming failing providers (`byokActivationError` card).
- **"Clear All Custom Keys"** destructive text-button card — only when any key non-empty.

### 3.12 About — `Components/SettingsContentView+Controls.swift:373-625` (`aboutSection`)

1. **App info card** (`about.version`): hero logo 48×48 (`herologo.png`) + **"omi"** 18 bold + channel suffix `(Beta)` in accent + `"Version {currentVersion} ({buildNumber})"` 13 `textTertiary`, selectable. Divider; link rows (trailing `arrow.up.right`, or `arrow.right` for in-app): **"What's New"** (`AppBuild.changelogURLString`), **"Visit Website"** (omi.me), **"Help Center"** (help.omi.me), **"Privacy Policy"** (in-app nav → Privacy section), **"Terms of Service"** (omi.me/terms).
2. **Software Updates card** (`about.updates`) — backed by `UpdaterViewModel.shared` (Sparkle; Windows equivalent: electron-updater states):
   - Sync icon + **"Software Updates"** + **"Check Now"** button (`.bordered`, disabled while `!canCheckForUpdates`, tooltip "Check for app updates" / "Already checking for updates…"). `"Last checked: {relative} ago"`.
   - **Failure banner** (when `lastUpdateFailure`): warning triangle, **"Update Needs Attention"**, `failure.userMessage`, actions **"Open Applications"** (conditional on `isRecoverableLaunchLocation`), **"Download Latest"**, **"Dismiss"** — in `backgroundTertiary` rounded box.
   - Divider; **"Automatic Updates"** toggle (`about.autoupdates`) → Sparkle `automaticallyChecksForUpdates` (disabled if managed policy or dev build); subtitle `"Check for updates automatically in the background"`. When on, reveals **"Auto-Install Updates"** (`about.autoinstall`) / `"Automatically download and install updates when available"` → `automaticallyDownloadsUpdates`.
   - Footnote switches: "Release builds always auto-check and auto-install…" (managed policy) / "Development builds keep automatic installation disabled…" (dev build).
   - Divider; **"Update Channel"** row (`about.channel`) — menu picker width 100 over `UpdateChannel` (**Stable / Beta**), subtitle = channel description. Beta→Stable when `isDowngradeToStable` → alert **"Switch to Stable Channel?"** — "Stay on Beta" / **"Switch to Stable"** (also opens `https://macos.omi.me`); message compares current beta vs latest stable version.
3. **Report an Issue card** (`about.reportissue`): speech-bubble icon, **"Report an Issue"** / `"Help us improve omi"`, **"Report"** button → `FeedbackWindow.show(userEmail:)`.

### 3.13 Hidden AI Chat section — `+FloatingBarAndChat.swift` (`aiChatSection`)

Hidden from the rail; production bundles force-redirect `.aiChat` → `.advanced`. Content largely duplicates Advanced → AI Setup, plus:
- **Ask Mode** toggle (Ask/Act restriction for chat).
- **CLAUDE.md card** — Global (`~/.claude/CLAUDE.md`) and Project-scoped rows with size in KB, per-scope enable toggle, **"View"** → monospaced file-viewer sheet (600×500).
- **Skills card** — skills from `~/.claude/skills/` + project `.claude/skills/`, searchable filter, per-skill checkbox (persisted JSON at UserDefaults `disabledSkillsJSON`), "View" opens SKILL.md, origin badge **"Global"**/**"Project"**.
- Browser Extension + Dev Mode cards (duplicates; Dev Mode adds bullets when on: "AI can modify UI, add features, create custom SQLite tables" / "Backend API, auth, and sync logic are read-only").

Port note: treat as dev-only surface; mirror wherever Windows exposes its coding-agent settings.

### 3.14 Dead code — DO NOT PORT as visible UI

Defined but never composed anywhere at this tag (verified by repo-wide grep):
- `focusAssistantSubsection`, `taskAssistantSubsection`, `insightAssistantSubsection`, `memoryAssistantSubsection`, `analysisThrottleSubsection`, `featureTiersSubsection` (`+Assistants.swift`) — full per-assistant UIs (enable toggles, cooldown/interval/confidence sliders, prompt editors, excluded-app lists) that are unreachable.
- `gmailReaderSubsection`, `calendarSyncSubsection` (`Sections/SettingsContentView+Integrations.swift`) — cookie-based Gmail/Calendar readers; **there is no live "Integrations"/"Connectors" settings tab in this app at all**.
- `SettingsContentView.AdvancedSubsection` enum (`SettingsPage.swift:364-398`, 14 cases with icons) + `SettingsSubsectionItem` (`SettingsSidebar.swift:573-615`) — vestigial scaffolding from an older sub-sidebar design.
- Legacy `TaskAgentSettingsView` Form (`ProactiveAssistants/Assistants/TaskAgent/TaskAgentSettings.swift:170-300`) — separate window, not part of Settings.
- Shortcuts `referenceCard` (`ShortcutsSettingsSection.swift:237-260`).
- Commented-out "Upgrade to Pro" card (`+AccountBilling.swift:95-121`).

Underlying assistant model defaults (relevant if resurrected, and for Notifications toggles §3.4): Focus — enabled true, cooldown 10min, notifications true; Task — enabled true, notifications **false**; Insight — enabled true, notifications true; Memory — enabled true, notifications **false**. Shared `extractionIntervalOptions=[10s,600s,3600s]`, `analysisDelayOptions=[0,10,20,30,60,300]`s. (`ProactiveAssistants/Assistants/*/…Settings.swift`, `Services/AssistantSettings.swift:47-62`.)

### 3.15 `AssistantSettings` registered defaults (`ProactiveAssistants/Services/AssistantSettings.swift:47-62`)

`assistantsCooldownInterval=600`, `assistantsGlowOverlayEnabled=false`, `assistantsAnalysisDelay=60`, `screenAnalysisEnabled=true`, `transcriptionEnabled=true`, `transcriptionLanguage="en"`, `transcriptionAutoDetect=true`, `transcriptionVocabulary=[]`, `vadGateEnabled=false`, `batchTranscriptionEnabled=false`, `systemAudioCaptureMode="onlyDuringMeetings"`. `effectiveTranscriptionLanguage` returns `"multi"` when auto-detect + supported (:205-210). Notifications posted: `.assistantSettingsDidChange`, `.transcriptionSettingsDidChange`, `.systemAudioCaptureModeDidChange`, `.voiceLanguagesDidChange` (:485-492).

---

## 4. States summary (Settings)

- **Loading:** toggle → inline `ProgressView().scaleEffect(0.8)` replacing the switch (Screen Capture, Audio Recording); Rewind Storage → "Loading..." subtitle; plan card → "Loading plan..." + spinner; usage card → "Loading usage…"; stats → per-row spinner; gated by `SettingsViewModel.isLoadingBackendSettings` / `isLoadingSubscription`.
- **Error:** `permissionError`/`transcriptionError` replace subtitles in `warning` amber; shortcut-capture errors red 12 medium; BYOK activation error card; stats "Unable to load stats"; `subscriptionError` on plan pane; update failure banner (§3.12).
- **Signed-out:** none of the panes render signed-out variants — Settings is only reachable signed-in (Account/Plan handle auth server-side errors as above).
- **Permission states in Settings:** only the General → Notifications card has full tri-state UI (Enabled badge / Enable / Fix + amber banner note). Mic/screen-capture permission failures surface as amber subtitle strings on the General toggles. Full permission-grant flows live in Onboarding (§5).

## 4.1 Animation inventory (Settings)

- Section switch: `.easeInOut(0.15)` opacity crossfade (header + content).
- Search-highlight pulse: in `.easeInOut(0.3)` → hold 1.5s → out 0.5s; scroll-to `.easeInOut(0.3)` after 0.2s.
- "What We Track" disclosure: `.easeInOut(0.2)` + `.transition(.opacity)`; chevron rotates 0→90°.
- Sidebar hovers instant; search-icon focus tint `.easeInOut(0.15)`.
- Conditional reveals (notification sub-rows, summary time, single-language picker, recorder cards): default SwiftUI layout animation.
- Plan card selection: bg/border pulse to accent. Window resize animated (`setFrame(animate: true)`).

---

## 5. Onboarding (first-run flow)

### 5.1 Top-level gate — `DesktopHomeView.swift:70-114`

`isRestoringAuth` → loading splash → `sessionPhase == .recoveryRequired` → `SessionRecoveryView` → `!isSignedIn` → **`SignInView`** → `!hasCompletedOnboarding` → **`OnboardingView`** → main app. **Sign-in is a separate top-level screen, not an onboarding step**; onboarding never renders unless signed in. Dev flag `--skip-onboarding` bypasses OnboardingView.

### 5.2 Sign-in — `SignInView.swift`

Centered full-screen dark card: hero logo 64×64 + **"omi"** wordmark 48 bold + `"Sign in to continue"` (title3, `textTertiary`). Two full-width 50pt white pill buttons, black text/icon: **"Sign in with Apple"** (`applelogo`) and **"Sign in with Google"** (multicolor G PNG + 1px gray-0.3 border). Both are web/OAuth flows via `AuthService.shared` (no native sheets); cancellations swallowed silently. Loading: circular spinner + a **"Cancel"** escape-hatch button (prevents a closed web tab from trapping the user). Errors in `error` red below buttons. **No email/password option.** Windows: keep Google web OAuth; Apple as available.

### 5.3 Flow orchestration — `Desktop/Sources/Onboarding/OnboardingFlow.swift:4-23` + `OnboardingView.swift:122-458`

18 steps, exact order: **Name, Language, HowDidYouHear, Trust, ScreenRecording, FullDiskAccess, FileScan, Microphone, Accessibility, Automation, FloatingBarShortcut, FloatingBar, VoiceShortcut, VoiceDemo, DataSources, Exports, Goal, Tasks**. Routing = if/else chain on `@AppStorage("onboardingStep")` (persists across launches). `introStepCount = 13` — the progress-dot count for scaffolded steps; steps ≥13 render all dots filled.

**Skip logic:** `OnboardingFlow.migratedStep(...)` (:28-135) is a one-time *schema migration* for users mid-onboarding across app updates (13 `hasInserted…/hasReordered…/hasRemoved…` AppStorage flags) — not per-user runtime skipping. Runtime skips: per-step **"Skip"** button (top-right, where `showsSkip`), plus a global escape hatch — **long-press (1s) the omi logo** on any step → force-complete (`OnboardingStepScaffold.swift:189-213`). Dev builds add an explicit "Skip onboarding" link on the Name step (`OnboardingWelcomeStepView.swift:55-62`).

**Windows note:** `OnboardingNotificationStepView.swift` exists but is **not routed** — the notification-permission step was removed from the live flow (`hasRemovedNotificationPermissionStep`). Do not port it as an active step.

### 5.4 Shared chrome — `OnboardingStepScaffold.swift`

Background `backgroundPrimary` `#0F0F0F`. Two modes:
- **`.split`** (default): left pane 470–560pt (header + progress + title block + content, scrollable, padding h40/v36); `Divider()`; right pane `OnboardingSecondBrainPane` — live 3D memory graph (`MemoryGraphSceneView`) with hint row "Drag to rotate" / "Scroll to zoom" / "Two-finger to pan" + "omi.me" mark, or empty-state `"Your graph appears once Omi has something real to map."`; optional "Who you are" footer card summarizing collected context.
- **`.centered`**: header + progress + title + content centered, max 560pt.

Header (:131-148): omi wordmark (long-press = force-complete) + optional right **"Skip"**. Progress: `Capsule()` pills 8pt tall — active 28×6 white; inactive 8×6 `white.opacity(0.1)`. Title block: eyebrow 12 semibold uppercase tracking 1.2 `textTertiary` → title **40 bold** `textPrimary` → description 16 `textSecondary` max 460pt.
Shared: `OnboardingCardButtonStyle` — primary white bg/black text, secondary `backgroundTertiary` + 1px white-0.08 border, r14, press scale 0.985 + opacity 0.92, 0.12s ease-out. `OnboardingSelectableChip` — capsule; selected white bg/black text.

### 5.5 Steps in order

**0 — Name** (`OnboardingWelcomeStepView.swift`). Centered. Eyebrow "Name", title **"What should Omi call you?"**. `TextField("Your name")` (r14, `backgroundSecondary` fill, white-0.08 border) → `coordinator.draftName`. **"Continue"** primary (Enter submits). Errors in `warning`.

**1 — Language** (`OnboardingLanguageStepView.swift`). Split. Title **"Pick every language you speak."**; description `"Omi listens in all of them — your first pick is the primary, used for prompts and summaries."` Multi-select chip grid (`LazyVGrid` adaptive min 108) + **"Other…"** chip revealing a text field (`"Ukrainian, Korean, Turkish…"`) + **"Add"**. First pick shows "✓" (primary). Footer `"Primary: {name}"`. **"Continue"/"Saving…"** disabled until ≥1 selected.

**2 — HowDidYouHear** (`OnboardingHowDidYouHearStepView.swift`). Split. Title **"How did you hear\nabout Omi?"**. Single-select `FlowLayout` of shuffled chips: Social media, YouTube, Newsletter, AI chat, Search engine, Event, Friend, Colleague, Podcast, Article, Product Hunt, Other. Selecting **auto-advances after 0.25s** (no Continue) + analytics.

**3 — Trust** (`OnboardingTrustStepView.swift`). Centered. Eyebrow "Before we continue", title **"I'm going to ask for a few permissions."**, description `"Omi is open source and private by design. During setup, we'll ask for these permissions to understand your work and help in the right places:"`. Three static rows: **"Screen + files"** / "Build context from what you're working on." · **"Microphone"** / "Capture voice notes and meeting context." · **"Accessibility + automation"** / "Know the active app and act when you ask." Buttons: **"Continue"** + text link **"Read the source code"** (github.com/BasedHardware/omi).

**4 — ScreenRecording** (`OnboardingPermissionStepView`, instantiated `OnboardingView.swift:172-200`). Eyebrow "Permission", title **"Let Omi read your screen."**, description "Screen Recording lets Omi see what you're working on.", reasonTitle "Screen Recording", primary action **"Open Screen Recording settings"**, `requiresRestart: true`. Skippable.

**5 — FullDiskAccess** (`OnboardingView.swift:201-227`). Eyebrow "Access", title **"Let Omi scan your work."**, reasonTitle "Disk Access", action **"Open Disk Access"**. Shows signed-in email in `textTertiary`. *(Windows: no direct equivalent — likely fold into a file-access consent step.)*

**6 — FileScan** (`OnboardingFileScanStepView.swift`). Split, skippable. Eyebrow "Discovery", title **"Start building your profile."**, description "Omi scans projects and recent files." Card (560×280 max) with `OnboardingLoadingAnimation` (orbital ring canvas, `FileIndexing/OnboardingLoadingAnimation.swift`) + `coordinator.scanStatusText` + `"N files indexed"` (monospaced digits) once snapshot exists, else "Your graph and suggestions will build from this scan." **"Continue"** appears only when scan snapshot exists; until then `"Scanning your workspace…"`.

**7 — Microphone** (`OnboardingView.swift:245-270`). Title **"Let Omi use your mic."**, reasonTitle "Microphone", action **"Grant microphone access"**.

**8 — Accessibility** (`OnboardingView.swift:271-297`). Title **"Let Omi see the active app."**, reasonTitle "Accessibility", action **"Open Accessibility settings"**.

**9 — Automation** (`OnboardingView.swift:298-324`). Title **"Let Omi act when asked."**, reasonTitle "Automation", action **"Grant automation access"**.

**Permission-step copy table** (all five render the same `OnboardingPermissionStepView`; instantiation `OnboardingView.swift:171-324`):

| Step | permissionType | Eyebrow | Title | Description | Icon (SF) | reasonTitle | reasonDetail | Primary action | requiresRestart |
|---|---|---|---|---|---|---|---|---|---|
| 4 | screen_recording | Permission | "Let Omi read your screen." | "Screen Recording lets Omi see what you're working on." | `display.and.arrow.down` | Screen Recording | same as description | "Open Screen Recording settings" | true |
| 5 | full_disk_access | Access | "Let Omi scan your work." | "File access lets Omi map your projects and files." | `externaldrive.fill.badge.person.crop` | Disk Access | "This lets Omi scan your projects and recent files." | "Open Disk Access" | false |
| 7 | microphone | Permission | "Let Omi use your mic." | "Microphone lets Omi transcribe meetings." | `mic.fill` | Microphone | "This lets Omi transcribe meetings and voice notes." | "Grant microphone access" | false |
| 8 | accessibility | Permission | "Let Omi see the active app." | "Accessibility lets Omi know which app is active." | `figure.wave` | Accessibility | "This lets Omi know which app you are using." | "Open Accessibility settings" | false |
| 9 | automation | Permission | "Let Omi act when asked." | "Automation lets Omi take actions for you." | `bolt.horizontal.circle.fill` | Automation | "This lets Omi take actions when you ask." | "Grant automation access" | false |

**Permission-step state machine** (`OnboardingPermissionStepView.swift`): 58×58 r20 icon chip (`backgroundSecondary`, per-step SF Symbol) + reasonTitle 18 semibold + status 13 medium + detail 14. States:
- Idle/not granted: status `"Not granted yet"` `textTertiary`; primary button = the step's action label.
- Requesting: status `"Waiting for macOS..."`; button `"Waiting for macOS…"` disabled.
- **Granted:** status `"Granted"` in `success` green; button replaced by text `"Permission granted. Continuing…"` `textTertiary`; **auto-advances after 350ms** (one-shot).
- **Needs-restart** (screen recording, stale grant): warning line in `warning`: `"macOS still isn't granting screen capture to this build. In Screen & System Audio Recording, toggle Omi Dev off, then on again, then quit and reopen the app."` (:75-80).
- Error: `coordinator.lastActionError` in `warning` below detail.
- Polling: 1s repeating timer + `scenePhase == .active` re-check so grants made in System Settings are picked up automatically; screen recording does an extra background capture probe.
- "Skip" always available.
*(Windows mapping: mic → media capture consent; screen → graphics-capture consent; accessibility/automation → UIA / no-op; keep the same granted-auto-advance + polling pattern.)*

**10 — FloatingBarShortcut** (`OnboardingFloatingBarShortcutStepView.swift`). Bespoke full-bleed layout (header/skip only, no dots). Headline 22 semibold centered: **"Let's set \"Ask a question\" shortcut.\nPress this shortcut. Do the buttons light up?"** 420×128 card shows current shortcut as key-caps (48×48; filled white once detected, outlined before) + caption "Press to test" → "Shortcut detected". Below: "Choose a different shortcut:" + preset chips (`ShortcutSettings.askOmiPresets`) + **"Custom"** chip → inline recorder (key caps + "Save"/"Listening…", hint `"Use at least one non-modifier key, like J or Return."`, red errors). **"Continue"** (white pill, `.move(edge: .bottom)` transition) appears only after the press is detected. Installs local+global key monitors; temporarily removes the main menu so raw presses aren't swallowed.

**11 — FloatingBar demo** (`OnboardingFloatingBarDemoView.swift`). Two-phase: before — headline 20 bold **"Omi sees your screen and gives you hyper-personalized responses"** + "Press this shortcut to open Ask Omi." + key-caps + "Ask Omi opens at the top of your screen." After the real bar opens (0.25s poll of `barState.showingAIConversation`; `.spring(response:0.4, dampingFraction:0.8)`) — headline **"Type in the Floating Bar 'Which computer should I buy?'"** + `onboarding_mac_lineup.png` preview (r24) fades in. Instantiates the production floating bar. **"Continue"** only after the AI response finishes streaming (0.5s poll up to 60s), or on timeout.

**12 — VoiceShortcut** (`OnboardingVoiceShortcutStepView.swift`). Like step 10, for PTT. Headline **"Let's set \"Audio ask a question\" shortcut.\nPress and hold to test. Does the button light up?"** Presets `pttPresets`; caption "Try another shortcut if it doesn't react:"; recorder hint `"You can use one key or a combination like ⌘ J."`; preview caption "Press and hold to test" → "Shortcut detected". Continue transition `.move(edge: .trailing)`.

**13 — VoiceDemo** (`OnboardingVoiceDemoView.swift`). Headline **"Hold {shortcut} and Ask"** 24 bold + "Try asking: What's on my screen?" Sub-states: (a) volume warning — "Your Mac volume is muted"/"…at 0" + "Turn up your Mac volume so you can hear Omi respond, then try push-to-talk." + **"I turned it up"** recheck; (b) idle — "Hold the shortcut, speak, then release" + key-cap + "hold"; (c) active — "Listening... release when done" → "Waiting for omi to respond...". Continue unlocks after an observed press + PTT returns to idle, then polls for AI response (20s max) before revealing.

**14 — DataSources** (`OnboardingDataSourcesStepView.swift`). Split scaffold, skippable, no eyebrow. Title **"Your 2nd brain is live."**, description "Connect more of your context." Connector rows (icon/title/metrics/toggle): **Calendar, Email (Gmail), Local files, Apple Notes** — all `isOn: true, isDisabled: true` (always-on, shown for transparency). Two expandable **memory-log import** rows for **ChatGPT** and **Claude**: toggle expands panel — "Open {source}, paste the copied prompt, then drop the full response here." + **"Open {source} and Copy Prompt"** + paste `TextEditor` + **"Import"/"Importing…"** + "Cancel". Row status: "Scanning..." / "Couldn't read - check access" (warning) / "{count} {items} • {count} memories". **"Continue"** only when `coordinator.isResearchComplete`; else spinner + "Scanning your data sources...".

**15 — Exports** (`OnboardingExportsStepView.swift`). Split scaffold, skippable. Title **"Put your memories where you work."**, description "Connect the tools where you want Omi context to live." Rows of `MemoryExportDestination` (Notion, Obsidian, ChatGPT, Claude, Gemini, Agents, Claude Code, Codex, OpenClaw, Hermes) with **"Connect"/"Close"** expanding a per-destination panel (Notion: copies memory page + backup in Downloads + opens Notion; Obsidian: "Choose vault"/"Change vault"; LLMs: "Omi copies the prompt and memory pack together…"; MCP-only: "Connect {title} over MCP from Apps after onboarding."). Buttons: "Copy & open" / "Export" / "Copy prompt"; running "Preparing…"/"Exporting…"; success in `success`, error in `warning`. **"Continue"** always visible.

**16 — Goal** (`OnboardingGoalStepView.swift`). Split, skippable. Eyebrow "Goal", title **"Pick one goal."**, description `"Selecting a correct and detailed goal is very important - Omi will optimize all advice to achieve that goal. Make sure your goal contains a number to measure progress."` 2-col grid of up to 4 suggestion chips + **"Type my own"** chip → free-text. **"Continue"/"Saving…"** once non-empty; submit calls `coordinator.completeIntro(appState:)` (persists name/languages/goal).

**17 — Tasks (final)** (`OnboardingTasksStepView.swift`). Bespoke; no Skip. Pulsing icon: 100×100 white-0.15 circle glow (2s ease-in-out repeat-forever, scale 1.0↔1.2) behind `checklist` SF Symbol 44 (white→gray gradient). Headline **"Auto-created Tasks"** 24 bold + body `"omi listens to your conversations and automatically\ncreates tasks, action items, and follow-ups for you."` Three mock rows animate in staggered 0.4s (`.spring(0.5, 0.8)`, insert from bottom): "Task 1 / From today's meeting" (unchecked), "Task 2 / Mentioned in Slack" (unchecked), "Task 3 / Getting started" (checked, strikethrough). Button **"Take me to Omi"** (white pill) → completion.

### 5.6 Completion — `OnboardingView.swift:461-524` (`handleOnboardingComplete`)

No confetti/celebration. Sequence: analytics `onboardingCompleted()`; stop onboarding chat agent; set `onboardingJustCompleted=true` + `hasCompletedFileIndexing=true`; save post-onboarding prompt suggestions (feed `PostOnboardingPromptViews.swift` — amber `#E3BF63` callout card "Suggested first ask" / "Next step -> Ask omi" shown later in main app); clear onboarding chat drafts; **UI transition first** (`appState.hasCompletedOnboarding = true` on main queue — service failures must never block it); then async: start AgentVMService, goal generation, screen/transcription monitoring, enable Launch-at-Login, create starter task ("Run omi for two days to start receiving helpful insights", priority low). Main window auto-navigates to Dashboard/Tasks because `onboardingJustCompleted` is set.

### 5.7 Onboarding animation/visual summary

- Progress pills animate width on step change (active 28pt wide).
- Card button press: scale 0.985 / opacity 0.92, 0.12s ease-out.
- Continue reveals: `.move(edge: .bottom)` (step 10) / `.move(edge: .trailing)` (step 12).
- Floating-bar demo transitions: `.spring(response: 0.4, dampingFraction: 0.8)`.
- Tasks step: staggered spring insertions + 2s pulse loop.
- FileScan: orbital-ring canvas loader (`OnboardingLoadingAnimation.swift`).
- All typography SF system: title 40 bold; headline (bespoke steps) 20–24 bold; eyebrow 12 semibold uppercase tracked 1.2.

### 5.8 Onboarding — flagged ambiguities (decide, don't blind-port)

1. **Two onboarding UIs coexist in source.** The linear `OnboardingView` if/else router is the live flow. `OnboardingChatView.swift` (~2,181 lines — AI-conversation-driven onboarding with its own persistence, tools incl. `complete_onboarding`, quick replies, Gmail/Calendar exploration cards) is NOT referenced from the live routing switch — legacy or mid-migration. Do not spec it for Windows without a product decision.
2. **Unreferenced views:** `OnboardingNotificationStepView.swift` (removed notification-permission step), `OnboardingTrustPreviewCard`/`OnboardingPrivacySheet` (`OnboardingView.swift:534-857`) — exclude from the port.
3. **Progress-dot quirk:** steps 14–16 pass `stepIndex` 14–16 against `totalSteps: 13`, so all 13 dots render filled with no "current" 28pt pill. Possibly intentional "final stretch" visual, possibly off-by-N — decide for Windows rather than porting blindly.
4. **Continue-transition inconsistency:** step 10 uses `.move(edge: .bottom)`, step 12 `.move(edge: .trailing)`, DataSources `.opacity + .scale(0.95)` — pick one convention or copy each verbatim.
5. **Completion double-invoke:** `handleOnboardingComplete` defers `hasCompletedOnboarding = true` a tick (sync set crashes in `Button.body.getter`), and the top-level `Group` calls `onComplete()` again on swap (`OnboardingView.swift:44-59`) — make the Windows completion handler idempotent.

---

## 6. Delta since baseline (`0d09ede` → `v0.12.72+12072-macos`, settings/onboarding paths)

Baseline `0d09ede61b` (2026-07-09, "Update desktop changelog for v0.12.66") → tag `50d264c94` (2026-07-12) is only ~2.5 days. Scoped to Settings/Onboarding files: **12 commits, none a visual redesign.** The Settings/Onboarding overhaul referenced in the brief predates this baseline — the baseline already contains it. Treat the tag's UI as a stable snapshot.

Commits of note:
- `682e4a22c` (07-09) — **removed the BYOK onboarding step** (`OnboardingBYOKStepView.swift` deleted, −190 lines; `OnboardingFlow` step list reshuffled with a migration flag). The 18-step list in §5.3 is post-removal.
- `72051e7ec` (07-09) — "Persist macOS chat drafts": adds draft persistence to onboarding's embedded chat/demo steps (no layout change).
- `d1a3d9c9a` (07-10) — reworked `OnboardingMemoryLogImportService` + small `BillingHelpers` contract alignment.
- `62488d3e8` (07-11) — gates main-agent permission requests during onboarding chat (logic, not visual).
- `9bbcccfa6` / `326f48689` (07-10/11) — error-presentation copy fixes touching `SignInView`, updates card, exports step.
- `086281413` (07-10) — small `NotificationsPrivacy` + sidebar tweak; rest are test-only / refactor (`0394c024d`, `54104a98b`, `e1733fd8a`, `23cad87cc`, `d365c40f8`).

## 7. Windows comparison (state as of `mac-ui-refresh` worktree, 2026-07-14)

Windows: `desktop/windows/src/renderer/src` — settings shell `pages/Settings.tsx`, tab registry `components/settings/tabs.ts`, tabs under `components/settings/tabs/`, onboarding `pages/Onboarding.tsx` + `components/onboarding/`. Windows has settings search (`SettingsSearchProvider.tsx` + `lib/settingsNav.ts`) mirroring Mac's sidebar search — good.

### 7.1 Navigation — **major drift**

Windows tab order (lucide icons): General (Settings), **Memories** (Brain), **Agents** (Bot), Transcription (AudioLines), Rewind (History), Privacy (ShieldCheck), Account (CircleUserRound), Plan & Usage (CreditCard), Shortcuts (Keyboard), Advanced (SlidersHorizontal), About (Info).
- Mac-only sections Windows lacks: **Notifications** (whole pane: master toggle, frequency slider, 4 assistant toggles, daily summary), **Floating Bar** (show toggle, background style, draggable, typed questions, screen share, voice picker, voice speed).
- Windows-only tabs Mac lacks: **Memories**, **Agents** (Mac's agent settings live in Advanced→AI Setup / hidden AI Chat pane). Keep them (Windows is ahead here per port posture), but decide placement vs Mac's Advanced.
- `IntegrationsTab.tsx` (Google Gmail+Calendar, Windows Sticky Notes) exists but is **not in `SETTINGS_TABS`** — unrouted, mirrors Mac's dead Integrations code. Also note `memories` appears in `SETTINGS_TABS` but has no entry in `TAB_COMPONENTS` in `pages/Settings.tsx` — verify it renders.
- Mac label is **"Plan and Usage"**; Windows uses "Plan & Usage" — cosmetic.

### 7.2 Per-pane drift ratings

| Mac pane | Windows state | Rating | Gaps vs Mac spec (§3) |
|---|---|---|---|
| General | `GeneralTab.tsx` (131 ln): Launch at login, Chat history, Meeting detection | **Major drift** | Missing: Screen Capture card w/ status dot, Audio Recording card, System Audio mode picker, Notifications permission card, Font Size card + Reset Window Size. Windows' Launch-at-login lives in Mac's Advanced→Preferences. |
| Rewind | `RewindTab.tsx` (338 ln): Capture my screen, Capture interval, Continuous recording, Proactive insights, Screen→memories, Excluded apps, Keep history for, Auto-cleanup, notification style | **Major drift (divergent superset)** | Windows has extra controls Mac lacks (interval, insights, notification style) and lacks Mac's Storage stats card + Battery Optimization row. Retention + Excluded Apps roughly align. Decide per-control; don't delete Windows extras blindly. |
| Transcription | `TranscriptionTab.tsx` (161 ln): Language mode (auto/single radio cards), Local VAD gate | **Minor drift** | Structure matches Mac. Missing: **Voice Assistant Languages** chip card, **Custom Vocabulary** card. Caption/copy check needed (Mac copy in §3.3). |
| Notifications | — | **Missing** | Whole pane (§3.4): master toggle, 6-step frequency slider, Focus/Task/Insight/Memory toggles, Daily Summary + Summary Time. |
| Privacy | `PrivacyTab.tsx` (129 ln): App-usage tracking, Hide bar from screen sharing, Let Omi take actions, On-device by default | **Major drift** | Windows content is entirely different. Missing Mac's: Store Recordings, Private Cloud Sync, Encryption status, What We Track disclosure, Privacy Guarantees. Windows extras have no Mac home — keep + relocate decision needed. |
| Account | `AccountTab.tsx` (54 ln): Profile, Signed in, display name | **Minor drift** | Missing: **Delete Account & Data** destructive flow + confirmation alert; Sign Out present? (verify). Windows adds editable display name (Mac read-only). |
| Plan and Usage | `PlanUsageTab.tsx` (247 ln) + `billing/` (TrialCard, CurrentPlanCard, PlanGrid, ChatUsageCard, OverageCard, UsageBar, UsageLimitPopup) incl. "Plan Retiring" | **Minor drift (near parity)** | Parity pass landed; card set mirrors Mac. Verify against §3.7: BYOK promo card, overage explainer sheet copy, promo-code disclosure, Monthly/Annual buttons, plan copy tables (incl. Mac's own "200 vs 100 questions" source inconsistency, `BillingHelpers.swift:121-180` — don't propagate blindly), checkout webview success/cancel URLs. |
| Floating Bar | — | **Missing** | Whole pane (§3.8). Some equivalents may exist elsewhere (bar toggles in Windows General/Privacy) — map before building. |
| Shortcuts | `ShortcutsTab.tsx` (207 ln): Summon hotkey, Record hotkey, Default/Custom | **Major drift** | Windows model = 2 hotkeys w/ default/custom; Mac = preset pill rows (⌘O/⌘↩/⌘⇧↩/⌘J; Option/Right-⌘/fn/Ctrl) + Custom recorder + Disable pill + 3 PTT toggles (Double-tap Locked Mode, PTT Sounds, Mute Audio While Talking) with pttEnabled dimming. Mac has no "Record hotkey" concept in this pane. |
| Advanced | `AdvancedTab.tsx` (438 ln): Export/Import memories, File indexing, Knowledge graph, Memory maintenance, Replay onboarding | **Major drift** | Only overlap = Replay onboarding ≈ Mac's Reset Onboarding. Missing Mac's: AI Setup (voice model/provider/workspace/extension/dev mode), Profile & Stats, Goals, Preferences (multi-chat, legacy home, launch-at-login), Troubleshooting, **Developer API Keys (BYOK)**, Dev Tools. Windows memory tooling is Windows-only (likely belongs in its Memories tab). |
| About | `AboutTab.tsx` (177 ln): Omi for Windows, Links, Software updates, Update ready | **Minor drift** | Parity pass landed. Verify vs §3.12: link-row set (What's New/Website/Help/Privacy/Terms), Check Now + last-checked, failure banner w/ 3 actions, Automatic Updates → Auto-Install reveal, **Update Channel picker + downgrade alert**, Report an Issue card. |
| (hidden) AI Chat | `AgentsTab.tsx` (193 ln): Claude Code, Not connected | **Minor drift — Windows ahead** | Windows exposes agents as a real tab; Mac hides this pane in prod. Port target = Mac's content (CLAUDE.md card, Skills card, Ask Mode) where applicable. |

**Do NOT score as Windows gaps** (Mac dead code, §3.14): Gmail Reader / Calendar Sync cards, per-assistant (Focus/Task/Insight/Memory/Analysis-Throttle) settings cards, Feature Tiers picker, Shortcuts reference card, Advanced sub-sidebar scaffolding — all unreachable on the running Mac app.

### 7.3 Onboarding comparison

Windows (`pages/Onboarding.tsx`): 13 indexed steps + terminal — NameStep, LanguageStep, HowDidYouHearStep, TrustStep, **BackgroundPrivacyStep** (Windows-only), ScreenPermissionStep, BuildProfileStep (replaces Mac's FullDiskAccess + FileScan; old `DiskAccessStep.tsx` hidden), MicPermissionStep, AutomationPermissionStep, ShortcutSetupStep, VoiceIntroStep, AskDemoStep, GoalStep, AutoCreatedTasksStep (terminal). `BrainMap.tsx`/`brainMapModel.ts` = Mac's second-brain graph pane; `OrbitScanner.tsx` = Mac's `OnboardingLoadingAnimation`.

| Mac step (§5.5) | Windows | Rating |
|---|---|---|
| 0 Name / 1 Language / 2 HowDidYouHear / 3 Trust | NameStep / LanguageStep / HowDidYouHearStep / TrustStep | Present — verify copy vs §5.5 verbatim strings |
| 4 ScreenRecording | ScreenPermissionStep | Present — verify state machine (§ table + auto-advance 350ms, 1s polling) |
| 5 FullDiskAccess + 6 FileScan | BuildProfileStep (merged) | **Minor drift** (merge is a sensible Windows adaptation; DiskAccessStep hidden) |
| 7 Microphone / 9 Automation | MicPermissionStep / AutomationPermissionStep | Present |
| 8 Accessibility | — | **Missing/N-A** (no direct Windows equivalent; decide if a UIA-consent step is wanted) |
| 10 FloatingBarShortcut + 12 VoiceShortcut | ShortcutSetupStep (single) | **Major drift** — Mac has two separate press-to-verify steps with preset pills + custom recorder + "did it light up" live key-cap feedback |
| 11 FloatingBar demo + 13 VoiceDemo | AskDemoStep + VoiceIntroStep | **Minor drift** — verify two-phase demo behavior, response-wait gating, volume-warning sub-state |
| 14 DataSources | — | **Missing** (connector rows + ChatGPT/Claude memory-log import) |
| 15 Exports | — | **Missing** (memory-export destinations) |
| 16 Goal / 17 Tasks | GoalStep / AutoCreatedTasksStep | Present — verify goal-suggestion chips, staggered task-row animation, "Take me to Omi" |
| — | BackgroundPrivacyStep | **Windows-only** — keep or fold into Trust per product call |

Sign-in: Mac = separate pre-onboarding `SignInView` (Apple + Google web OAuth, no email/password). Windows uses its own auth flow — verify it matches the two-pill layout if visual parity is wanted.

### 7.4 Priority order for parity work (suggested)

1. **Notifications pane** (missing entirely; backend-persisted settings already exist).
2. **Floating Bar pane** (missing; controls mostly map to existing Windows bar features).
3. Shortcuts pane rework to Mac's preset-pills + recorder + 3 PTT toggles model.
4. Transcription: add Voice Assistant Languages + Custom Vocabulary cards.
5. Account: add Delete Account & Data flow.
6. Advanced: add AI Setup / Preferences / Developer API Keys (BYOK) groups; General: adopt Mac card set (capture/audio/system-audio/notifications/font).
7. Onboarding: DataSources + Exports steps; split shortcut setup into the two press-to-verify steps.

