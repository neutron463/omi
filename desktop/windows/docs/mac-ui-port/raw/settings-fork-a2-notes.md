# Settings Deep-Dive A2 — General / Rewind / Transcription / Notifications / Privacy / Shortcuts

Read-only research for the Windows port spec. All six files read in full at the paths below (macOS reference worktree `mac-ref`).

Context already established (do not re-derive): settings sidebar has 11 visible sections in order — General, Rewind, Transcription, Notifications, Privacy, Account, Plan and Usage, Floating Bar, Shortcuts, Advanced, About (`Desktop/Sources/MainWindow/SettingsSidebar.swift` `visibleSections`; enum in `Desktop/Sources/MainWindow/Pages/SettingsPage.swift` `SettingsContentView.SettingsSection`). Colors from `Desktop/Sources/Theme/OmiColors.swift`: `backgroundPrimary=0x0F0F0F`, `backgroundSecondary=0x1A1A1A`, `backgroundTertiary=0x252525`, `backgroundQuaternary=0x35343B`, `backgroundRaised=0x1F1F25`, `border=0x3A3940`, `purplePrimary=0x8B5CF6`, `purpleSecondary=0xA855F7`, `purpleAccent=0x7C3AED`, `purpleLight=0xD946EF`, `textPrimary=0xFFFFFF`, `textSecondary=0xE5E5E5`, `textTertiary=0xB0B0B0`, `textQuaternary=0x888888`, `success=0x10B981`, `warning=0xF59E0B`, `error=0xEF4444`, `info=0x3B82F6`. Fonts are all `.scaledFont(size:weight:design:)` — system font scaled by a user font-scale multiplier, not a custom typeface.

**IMPORTANT for the Windows port:** several of these Mac cards use `OmiColors.purplePrimary` as an icon accent color (Language Mode, Custom Vocabulary, Local VAD Gate, all four Rewind cards, all Notifications/Privacy card headers, and PTT/Ask-omi toggle tints). Per `AGENTS.md`, Windows must **never use purple** anywhere in the UI (`INV-UI-1` ratchet) — every one of these needs a neutral/white or `OmiColors.info`-equivalent substitute. This is flagged inline below at each occurrence too.

Files read (full contents, no truncation):
1. `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos\Desktop\Sources\MainWindow\Pages\Settings\Sections\SettingsContentView+General.swift` (349 lines)
2. `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos\Desktop\Sources\MainWindow\Pages\Settings\Sections\SettingsContentView+Transcription.swift` (442 lines)
3. `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos\Desktop\Sources\MainWindow\Pages\Settings\Sections\SettingsContentView+Rewind.swift` (182 lines)
4. `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos\Desktop\Sources\MainWindow\Pages\Settings\Sections\SettingsContentView+NotificationsPrivacy.swift` (305 lines)
5. `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos\Desktop\Sources\MainWindow\Pages\ShortcutsSettingsSection.swift` (467 lines)
6. `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos\Desktop\Sources\FloatingControlBar\ShortcutSettings.swift` (626 lines)

Gap to flag: several shared helper views referenced by these files — `settingsCard`, `settingRow`, `privacyToggleRow`, `notificationFrequencySlider`, `trackingItem`, `privacyBullet`, `fontShortcutRow`, `FlowLayout`, `SearchableDropdown`, `ExcludedAppRow`, `AppRuleEditorView`, `SettingHighlightModifier` — are called from these files but defined elsewhere and were out of scope for this read. Their exact padding/corner-radius/animation values beyond what's inferable at the call site are not captured here.

---

## 1. `SettingsContentView+General.swift` — `generalSection` (lines 8–347)

Five cards in `VStack(spacing: 20)`.

### Card 1 — Screen Capture (`settingsCard(settingId: "general.screencapture")`, lines 11–55)
- Status dot: `Circle().fill(isMonitoring ? OmiColors.success : OmiColors.textTertiary.opacity(0.3))`, 12×12, `.shadow(color: isMonitoring ? OmiColors.success.opacity(0.5) : .clear, radius: 6)` — glow only when active.
- Icon: SF Symbol `rectangle.dashed.badge.record`, `.scaledFont(size: 16)`, color `OmiColors.info`.
- Title: `"Screen Capture"` — size 16 semibold, `textPrimary`.
- Subtitle: `permissionError ?? (isMonitoring ? "Capturing screen content" : "Screen capture is paused")` — size 13; color `OmiColors.warning` if `permissionError != nil` else `textTertiary`.
- Right: `ProgressView().scaleEffect(0.8)` while `isToggling`; else native `Toggle` (`.toggleStyle(.switch)`, `.labelsHidden()`) bound to `isMonitoring`, whose setter also calls `toggleMonitoring(enabled:)`.

### Card 2 — Audio Recording (`settingId: "general.audiorecording"`, lines 58–112)
- Status dot color: `isTranscribing ? (appState.isAwaitingMeeting ? OmiColors.warning : OmiColors.success) : textTertiary.opacity(0.3)` — three states (idle / waiting-for-meeting / active), glow shadow when `isTranscribing`.
- Icon: `mic.fill`, size 16, `OmiColors.info`.
- Title: `"Audio Recording"`, size 16 semibold.
- Subtitle: `transcriptionError ?? (isTranscribing ? (appState.isAwaitingMeeting ? "Waiting for a meeting…" : "Recording and transcribing audio") : "Audio recording is paused")` — 4 possible text states; warning color on error.
- Right: `ProgressView` while `isTogglingTranscription`, else `Toggle` bound to `isTranscribing` → `toggleTranscription(enabled:)`.

### Card 3 — System Audio (`settingId: "general.systemaudio"`, lines 115–165) — **`if #available(macOS 14.4, *)`** gated (Core Audio taps requirement; no literal Windows equivalent — Windows should just always show this card)
- Icon `speaker.wave.2.fill`, size 16, `OmiColors.info`.
- Title `"System Audio"`, size 16 semibold.
- Caption: `"Choose when Omi records audio from other apps (calls, videos, music)."`, size 13, `textTertiary`.
- Control: `Picker(.menu)`, width 200, bound to `AssistantSettings.SystemAudioCaptureMode`: `.always` → `"Always"`, `.onlyDuringMeetings` → `"Only during meetings"`, `.never` → `"Never"`. Setter updates `systemAudioCaptureMode` + calls `setSystemAudioCaptureMode(newValue)`.
- Conditional helper text (only when `.onlyDuringMeetings` selected): `"Omi captures other apps' audio only while you're in a call (e.g. Zoom, Teams, FaceTime). Detecting browser-based calls like Google Meet requires Screen Recording permission."` — size 12, `textTertiary`, wraps.

### Card 4 — Notifications (`settingId: "general.notifications"`, lines 168–262)
- Status dot: green if `hasNotificationPermission && !isNotificationBannerDisabled`; warning color if banners disabled; else dim tertiary at 30% opacity. Glow only in the granted+enabled state.
- Title `"Notifications"`, size 16 semibold.
- Subtitle: `notificationStatusText` (computed elsewhere) — warning color if banners disabled.
- Right side, 3-way branch:
  - Granted+enabled: green `"Enabled"` capsule — size 12 medium, `.foregroundColor(.green)` (literal, not `OmiColors.success`), padding h10/v4, `Capsule().fill(Color.green.opacity(0.15))`.
  - Else: Button. Label `"Fix"` when `isNotificationBannerDisabled` (action: `appState.openNotificationPreferences()`), else `"Enable"` (action: fires `AnalyticsManager.shared.notificationRepairTriggered(reason: "settings_fix_button", previousStatus: "not_authorized", currentStatus: "not_authorized")` then `appState.repairNotificationAndFallback()` — tries an lsregister-style repair before falling back to opening system prefs). Styling: size 12 semibold white text, padding h12/v6, `RoundedRectangle(cornerRadius: 6)` filled `OmiColors.warning` (Fix) or `OmiColors.info` (Enable).
- Extra warning banner (only when `isNotificationBannerDisabled`, lines 241–260): `exclamationmark.triangle.fill` (size 12, warning) + `"Banners disabled - you won't see visual alerts. Set style to \"Banners\" in System Settings."` (size 12, warning), inside `RoundedRectangle(cornerRadius: 8).fill(OmiColors.warning.opacity(0.1))`, padding 10.

### Card 5 — Font Size (`settingId: "general.fontsize"`, lines 265–344)
- Icon `textformat.size`, size 16 medium, `OmiColors.info`, frame width 12.
- Title `"Font Size"`, size 16 semibold.
- Subtitle: `"Scale: \(Int(fontScaleSettings.scale * 100))%"`, size 13, `textTertiary` — live percentage.
- Conditional `"Reset"` text button (only if `scale != 1.0`): size 12 medium, `OmiColors.info`, calls `fontScaleSettings.resetToDefault()`.
- Slider row: `"A"` (size 12 medium, tertiary) — `Slider(value: $fontScaleSettings.scale, in: 0.5...2.0, step: 0.05)` tinted `OmiColors.info` — `"A"` (size 18 medium, tertiary, larger to anchor max). Range 50%–200% in 5% steps.
- Live preview text: `"The quick brown fox jumps over the lazy dog"`, size 14, `textSecondary`, full-width leading, `.padding(.top, 4)`.
- Keyboard-shortcut rows (`fontShortcutRow` helper, defined elsewhere): `"Increase font size"` = `⌘+`, `"Decrease font size"` = `⌘−` (`\u{2212}` real minus glyph), `"Reset font size"` = `⌘0`.
- `"Reset Window Size"` button, right-aligned: icon `arrow.uturn.backward` (size 11) + text (size 12 medium), color `textSecondary`, padding h10/v5, `RoundedRectangle(cornerRadius: 6).fill(OmiColors.backgroundTertiary)`. Calls `resetWindowToDefaultSize()`.

No loading/error/signed-out states beyond the inline ones above. No explicit `.animation`/`.transition` calls in this file.

---

## 2. `SettingsContentView+Transcription.swift` — `transcriptionSection` (lines 8–280) + `VoiceAssistantLanguagesCard` (lines 336–442)

### Card 1 — Language Mode (`settingId: "transcription.languagemode"`, lines 11–154)
- Header: icon `globe` (size 16, `OmiColors.purplePrimary` — **flag: purple, must be swapped on Windows**), title `"Language Mode"` (size 15 medium, `textPrimary`).
- **Auto-Detect option** — full-width tappable card (`Button`, `.buttonStyle(.plain)`), selected = `transcriptionAutoDetect == true`:
  - Leading icon `checkmark.circle.fill` (selected) / `circle` (unselected), size 20, `purplePrimary`/`textTertiary` (purple flag again).
  - Title `"Auto-Detect (Multi-Language)"`, size 14 medium.
  - Caption `"Automatically detects and transcribes:"`, size 12, tertiary.
  - Language list line (size 11, tertiary, wraps): `"English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian, Dutch"`.
  - Card bg: `RoundedRectangle(cornerRadius: 8)` filled `purplePrimary.opacity(0.1)` when selected else clear, stroked `purplePrimary.opacity(0.3)` (selected) / `backgroundQuaternary` (unselected), lineWidth 1, inner padding 12.
  - Tap: sets `transcriptionAutoDetect = true`, `AssistantSettings.shared.transcriptionAutoDetect = true`, `updateTranscriptionPreferences(singleLanguageMode: false)`, `restartTranscriptionIfNeeded()`.
- **Single Language option** — same card pattern, selected = `!transcriptionAutoDetect`:
  - Title `"Single Language (Better Accuracy)"`, size 14 medium.
  - Caption `"Best for speaking in one specific language"`, size 12.
  - **Conditional language picker** (only when `!transcriptionAutoDetect`): label `"Language:"` (size 12, tertiary) + `SearchableDropdown` (title "Language", options from `languageOptions` tuple list → `SearchableDropdownOption`, `selectedId: transcriptionLanguage`, `minWidth: 180`). On select: sets `transcriptionLanguage`, `AssistantSettings.shared.transcriptionLanguage`, checks `AssistantSettings.supportsAutoDetect(option.id)` to re-enable `transcriptionAutoDetect` for multi-capable languages, `updateTranscriptionPreferences(singleLanguageMode: !supportsMulti)`, `updateLanguage(option.id)`, `restartTranscriptionIfNeeded()`.
  - Tap of whole row: mirror of Auto-Detect, sets `false`.
- Info footer: `info.circle` (size 12, tertiary) + `"Single language mode supports \(AssistantSettings.supportedLanguages.count) languages including Chinese, Ukrainian, Russian, and more."` (size 11, tertiary) — count is dynamic.

### Card 2 — Voice Assistant Languages (`settingId: "transcription.voicelanguages"`, lines 157–159)
Delegates to private `VoiceAssistantLanguagesCard` (below). **Deliberately separate** from Language Mode (comment at lines 330–335): governs languages spoken TO the push-to-talk voice assistant; never touches the always-on ambient transcriber's language settings.

### Card 3 — Custom Vocabulary (`settingId: "transcription.vocabulary"`, lines 162–244)
- Header: icon `text.book.closed` (size 16, purplePrimary — flag), title `"Custom Vocabulary"` (size 15 medium), caption `"Improve recognition of names, brands, and technical terms"` (size 13, tertiary). Trailing: if non-empty, `"\(count) terms"` (size 12, tertiary).
- Tag cloud (only if non-empty): `FlowLayout(spacing: 6)` of removable chips — term text (size 12, `textSecondary`) + `xmark` remove button (size 9 medium, tertiary), padding h10/v6, `RoundedRectangle(cornerRadius: 6).fill(backgroundQuaternary)`. Remove → `removeVocabularyWord(term)`.
- `Divider().background(backgroundQuaternary)`.
- Add-word row: `TextField("Add a word...", text: $newVocabularyWord)` `.roundedBorder` style, `.onSubmit { addVocabularyWord() }`, + `plus.circle.fill` button (size 20), colored `purplePrimary` (flag) when non-empty trimmed else tertiary; disabled when empty/whitespace.
- Helper text: `"Press Enter or click + to add • Click × to remove"` (size 11, tertiary).
- Logic (lines 283–311): `addVocabularyWord()` trims whitespace, guards empty, does a **case-insensitive duplicate check** before appending, clears field, calls `saveVocabulary()`. `removeVocabularyWord(_:)` filters exact match. `saveVocabulary()` persists to `AssistantSettings.shared.transcriptionVocabulary` (array) AND syncs to backend via `updateTranscriptionPreferences(vocabulary: vocabularyList.joined(separator: ", "))` (comma-joined on the wire).

### Card 4 — Local VAD Gate (`settingId: "transcription.vadgate"`, lines 247–277)
- Icon `waveform.badge.minus` (size 16, purplePrimary — flag), title `"Local VAD Gate"` (size 15 medium), caption `"Uses on-device voice activity detection to skip silence, reducing Deepgram API usage. May save ~40% on transcription costs."` (size 13, tertiary, wraps).
- Trailing `Toggle` bound to `vadGateEnabled`; `onChange` sets `AssistantSettings.shared.vadGateEnabled` then `restartTranscriptionIfNeeded()`.

### `restartTranscriptionIfNeeded()` (lines 314–324)
Only acts if `appState.isTranscribing`. Calls `appState.stopTranscription()`, then after a **1.0-second `DispatchQueue.main.asyncAfter` delay**, calls `appState.startTranscription()`. This 1s cooldown-then-restart is a real timing contract to replicate on Windows.

### `VoiceAssistantLanguagesCard` (private struct, lines 336–442)
Multi-select chip picker, `@State private var selection: [String] = []`.
- Header: icon `person.wave.2` (size 16, **`textSecondary` — NOT purple**, inconsistent with sibling cards), title `"Voice Assistant Languages"` (size 15 medium), caption `"Languages you speak to Omi over push-to-talk — the first is your primary. Omi identifies which one you're speaking each turn."` (size 13, tertiary, wraps).
- `chipOptions`: `OnboardingPagedIntroCoordinator.commonLanguages` (fixed common set) plus any currently-selected languages not already in that set (so a previously-chosen "extra" language keeps a chip even off the common list).
- `addableLanguages`: `AssistantSettings.supportedLanguages` filtered to exclude codes containing `"-"` (regional variants like `en-US`), exclude already-selected, exclude already in `chipOptions`.
- `FlowLayout(spacing: 6)`: one chip per `chipOptions` entry, plus (only if `addableLanguages` non-empty) a `SearchableDropdown` labeled `"Add language"`, button label `"More…"`.
- Chip rendering (lines 407–429): label `"\(name) ✓"` when it's the **primary** (`selection.first == code`), else plain `name`. Selected: `.semibold`, foreground `OmiColors.backgroundPrimary` (dark text on light fill), background `Color.white.opacity(0.9)` filled `Capsule()`. Unselected: `.regular`, `textSecondary`, clear fill, `Capsule().stroke(backgroundQuaternary, lineWidth: 1)`. Tap toggles membership in `selection`; "primary" = oldest still-present entry (insertion order, not re-sorted on removal).
- `persist()` (lines 431–441): **never allows an empty selection** — if the user tries to deselect the last language, it reloads from `AssistantSettings.shared.voiceLanguages` instead of writing empty. Otherwise writes `voiceLanguages = selection` then re-reads to reconcile. Setter posts `.voiceLanguagesDidChange` (observed elsewhere to prewarm a language-ID model and re-warm the realtime session's system instructions — no explicit call needed here).
- `.onAppear { selection = AssistantSettings.shared.voiceLanguages }`.

---

## 3. `SettingsContentView+Rewind.swift` — `rewindSection` (lines 8–178)

### Card 1 — Storage (`settingId: "rewind.storage"`, lines 11–40)
- Icon `internaldrive.fill` (size 16, purplePrimary — flag), title `"Storage"` (size 15 medium).
- Async load via `.task { rewindStats = await RewindIndexer.shared.getStats() }` chained on the card (lines 38–40).
- **Loading state**: while `rewindStats == nil`, text `"Loading..."` (size 13, tertiary).
- **Loaded state**: `"\(stats.total) frames • \(RewindStorage.formatBytes(stats.storageSize))"` — frame count + human-formatted byte size.

### Card 2 — Excluded Apps (`settingId: "rewind.excludedapps"`, lines 43–115)
- Icon `eye.slash.fill` (purplePrimary — flag), title `"Excluded Apps"` (size 15 medium), caption `"Screen capture is paused when these apps are active"` (size 13, tertiary).
- Trailing `"Reset to Defaults"` button, `.buttonStyle(.bordered)`, `.controlSize(.small)` → `rewindSettings.resetToDefaults()`.
- `Divider()`.
- **Empty state** (lines 73–86): centered `checkmark.shield` (size 24, tertiary) + `"No apps excluded"` (size 13, tertiary), vertical padding 16, `Spacer()` both sides.
- **Populated state**: `LazyVStack(spacing: 8)` of `ExcludedAppRow(appName:onRemove:)` (defined elsewhere) — one per app in `rewindSettings.excludedApps` (`Set<String>`, alphabetically sorted for display: `Array(...).sorted()`). `onRemove` → `rewindSettings.includeApp(appName)`.
- `Divider()`.
- Add-app editor: `AppRuleEditorView(title: "Add App to Exclusion List", placeholder: "App name (e.g., Passwords)", addButtonTitle: "Add", existingApps: rewindSettings.excludedApps, builtInApps: TaskAssistantSettings.builtInExcludedApps, onAdd: { rewindSettings.excludeApp($0) })` — likely autocomplete/typeahead against `builtInApps`, component out of scope.

### Card 3 — Battery Optimization (`settingId: "rewind.battery"`, lines 118–144)
- Icon `battery.75percent` (purplePrimary — flag), title `"Battery Optimization"` (size 15 medium), caption `"On battery, Omi captures your screen less often to save power while keeping text recognition accurate."` (size 13, tertiary).
- Trailing: **display-only** text `"Automatic"` (size 13 medium, `textSecondary`) — no toggle, always automatic.

### Card 4 — Data Retention (`settingId: "rewind.retention"`, lines 147–176)
- Icon `clock.fill` (purplePrimary — flag), title `"Data Retention"` (size 15 medium), caption `"How long to keep screen recordings"` (size 13, tertiary).
- Trailing: `Picker(.menu)`, width 110, bound to `$rewindSettings.retentionDays` (`Int`): `"3 days"`→3, `"7 days"`→7, `"14 days"`→14, `"30 days"`→30. Default value not defined in this file (lives in `RewindSettings` model).

No permission-state UI, no explicit animations, no error states in this file. Rewind's screen-capture permission itself is surfaced in General, not here.

---

## 4. `SettingsContentView+NotificationsPrivacy.swift` — `notificationsSection` (lines 8–158) + `privacySection` (lines 162–301)

### Notifications section

**Card 1 — Notifications master toggle** (`settingId: "notifications.settings"`, lines 11–106)
- Header: icon `bell.badge.fill` (purplePrimary — flag), title `"Notifications"` (size 15 medium), trailing `Toggle` bound to `$notificationsEnabled` → `onChange` → `updateNotificationSettings(enabled:)`.
- Caption: `"Control how often you receive notifications"` (size 13, tertiary).
- **Conditional sub-content, only when `notificationsEnabled`** (lines 36–104):
  - `Divider()`.
  - `notificationFrequencySlider(settingId: "notifications.frequency")` — helper defined elsewhere, not captured here.
  - Four `settingRow(title:subtitle:settingId:)` rows, each with a `Toggle`:
    - `"Focus Notifications"` / `"Show notification on focus changes"` / id `"notifications.focus"` → `$focusNotificationsEnabled`; on change sets `FocusAssistantSettings.shared.notificationsEnabled` then `SettingsSyncManager.shared.pushPartialUpdate(AssistantSettingsResponse(focus: FocusSettingsResponse(notificationsEnabled: newValue)))`.
    - `"Task Notifications"` / `"Allow interruptions when a task needs attention"` / id `"notifications.task"` → `$taskNotificationsEnabled` → `TaskAssistantSettings.shared.notificationsEnabled` + `TaskSettingsResponse`.
    - `"Insight Notifications"` / `"Show notification when an insight is generated"` / id `"notifications.insight"` → `$insightNotificationsEnabled` → `InsightAssistantSettings.shared.notificationsEnabled` + `InsightSettingsResponse`.
    - `"Memory Notifications"` / `"Show notification when a memory is extracted"` / id `"notifications.memory"` → `$memoryNotificationsEnabled` → `MemoryAssistantSettings.shared.notificationsEnabled` + `MemorySettingsResponse`.
  - **Pattern**: every sub-toggle does a dual write — local per-domain settings singleton AND a partial update pushed to `SettingsSyncManager.shared` wrapped in `AssistantSettingsResponse`.

**Card 2 — Daily Summary** (`settingId: "notifications.dailysummary"`, lines 109–156)
- Icon `text.badge.checkmark` (purplePrimary — flag), title `"Daily Summary"` (size 15 medium), trailing `Toggle` bound to `$dailySummaryEnabled` → `updateDailySummarySettings(enabled:)`.
- Caption `"Receive a daily summary of your conversations and activities"` (size 13, tertiary).
- **Conditional**, only when `dailySummaryEnabled`: `Divider()` + `settingRow(title: "Summary Time", subtitle: "When to send your daily summary", settingId: "notifications.summarytime")` containing `Picker(.menu)`, width 100, options from `hourOptions` array rendered via `formatHour(hour)` (helper elsewhere), bound to `$dailySummaryHour`. `onChange` → `updateDailySummarySettings(hour: newValue)`.

### Privacy section (`var privacySection`, line 162)

**Card 1 — Data Controls** (`settingId: "privacy.storerecordings"`, lines 165–191)
- Header `"Data Controls"` (size 15 **semibold** — heavier than other card headers, which use `.medium`).
- Two `privacyToggleRow(icon:title:subtitle:isOn:onChange:)` rows separated by plain `Divider()`:
  - `mic.fill` / `"Store Recordings"` / `"Allow omi to store audio recordings of your conversations"` / `$recordingPermissionEnabled` → `updateRecordingPermission(newValue)`.
  - `cloud.fill` / `"Private Cloud Sync"` / `"Sync your data securely to your private cloud storage"` / `$privateCloudSyncEnabled` → `updatePrivateCloudSync(newValue)`.

**Card 2 — Encryption** (`settingId: "privacy.encryption"`, lines 194–230) — display-only, no controls.
- Header: icon `shield.lefthalf.filled` (size 14, purplePrimary — flag, frame width 20), title `"Encryption"` (size 14 medium).
- Status line: `checkmark.circle.fill` (size 12, `.green` literal, not `OmiColors.success`), text `"Server-side encryption"` (size 13, `textSecondary`), `"Active"` badge — size 10 semibold, `.green`, padding h5/v1, background `Color.green.opacity(0.15)`, `.cornerRadius(3)` (smaller radius than most badges; uses plain `.cornerRadius` not `RoundedRectangle`).
- Footer text: `"Your data is encrypted and stored securely with Google Cloud infrastructure."` (size 12, tertiary).

**Card 3 — What We Track** (`settingId: "privacy.tracking"`, lines 233–276) — expandable disclosure.
- Header is a `Button` toggling `isTrackingExpanded` inside `withAnimation(.easeInOut(duration: 0.2))` — the **one explicit animation timing** found in these six files.
- Header row: `list.bullet` (size 14, purplePrimary — flag, width 20), title `"What We Track"` (size 14 medium), trailing `chevron.right` (size 11 semibold, tertiary) with `.rotationEffect(.degrees(isTrackingExpanded ? 90 : 0))` — rotates to point down when expanded.
- Expanded content (`.transition(.opacity)`) — `VStack(spacing: 6)` of 10 `trackingItem(_:)` rows, exact literal strings in order:
  1. "Onboarding steps completed"
  2. "Settings changes"
  3. "App installations and usage"
  4. "Transcript processing events"
  5. "Conversation creation and updates"
  6. "Memory extraction events"
  7. "Chat interactions"
  8. "Speech profile creation"
  9. "Focus session events"
  10. "App open/close events"

**Card 4 — Privacy Guarantees** (`settingId: "privacy.privacy"`, lines 279–299) — display-only.
- Header: `hand.raised.fill` (size 14, purplePrimary — flag, width 20), title `"Privacy Guarantees"` (size 14 medium).
- Four `privacyBullet(_:)` rows, exact strings:
  1. "Anonymous tracking with randomly generated IDs"
  2. "No personal info stored in analytics"
  3. "Data is never sold or shared with third parties"
  4. "Opt out of tracking at any time"

No mic/screen/accessibility/notification permission-state rendering appears in either of these two sections — that lives in General's Notifications card (and presumably elsewhere for mic/screen).

---

## 5. `ShortcutsSettingsSection.swift` (467 lines)

`body` (lines 20–31): five cards in `VStack(spacing: 20)` — `askOmiKeyCard`, `pttKeyCard`, `doubleTapCard`, `pttSoundsCard`, `muteAudioCard`. `.onDisappear { stopShortcutCapture() }` tears down the recording monitor when leaving the screen. A `referenceCard` (lines 237–260) is defined but **not included in `body`** — dead/legacy code rendering a read-only shortcut summary table; not part of the live UI, but worth noting since it shows an alternate "reference row" pattern (`shortcutRow(label:keys:)`, monospaced key display) that might still be useful as a Windows design reference.

Every live card shares outer chrome: `.padding(20)`, background `RoundedRectangle(cornerRadius: 12).fill(OmiColors.backgroundTertiary.opacity(0.5))`, wrapped in `SettingHighlightModifier(settingId:, highlightedSettingId:)` (shared highlight-flash mechanism for deep-link/scroll-to-highlight, defined elsewhere).

### Card 1 — Ask omi Shortcut (`settingId: "floatingbar.shortcut"`, lines 33–79)
- Title `"Ask omi Shortcut"` (size 16 semibold), caption `"Global shortcut to open Ask omi from anywhere."` (size 13, `textSecondary`).
- Row: preset buttons from `ShortcutSettings.askOmiPresets` (4 presets) + a "Custom" button + a "Disable" button + `Spacer()`.
- Preset button (`askOmiKeyButton`, lines 81–93): selected when `settings.askOmiEnabled && settings.askOmiShortcut == shortcut && !settings.askOmiUsesCustomShortcut`. Tap: `stopShortcutCapture()`, sets `askOmiEnabled = true`, `askOmiShortcut = shortcut`.
- **Conditional recorder card** (lines 57–69), shown when enabled AND (recording this target OR using a custom shortcut OR capture error while recording this target). Title: `"Press your custom Ask omi shortcut now"` (recording) vs `"Custom Ask omi shortcut"` (static). Helper text: `"Use at least one non-modifier key."` — Ask omi **requires** a non-modifier key.

### Card 2 — Push to Talk (`settingId: "floatingbar.ptt"`, lines 95–141)
- Title `"Push to Talk"` (size 16 semibold), caption `"Hold the key to speak, release to send your question to AI."` (size 13, `textSecondary`).
- Preset row from `ShortcutSettings.pttPresets` (4, all **modifier-only**) + Custom + Disable.
- Conditional recorder card, same visibility logic for `.pushToTalk`. Recording title: `"Press your custom push-to-talk shortcut now"` vs `"Custom push-to-talk shortcut"`. Helper text: `"One key or a key combination both work."` — PTT **allows** modifier-only shortcuts (unlike Ask omi).

### Card 3 — Double-tap for Locked Mode (`settingId: "floatingbar.doubletap"`, lines 156–181) — `HStack`, not `VStack`.
- Title `"Double-tap for Locked Mode"` (size 16 semibold), caption `"Double-tap the push-to-talk key to keep listening hands-free. Tap again to send."` (size 13, `textSecondary`).
- Trailing `Toggle` bound to `$settings.doubleTapForLock`, `.tint(OmiColors.purplePrimary)` — **flag: explicit purple tint**, must be swapped.
- **Disabled state**: `.opacity(settings.pttEnabled ? 1 : 0.55)` + `.disabled(!settings.pttEnabled)` — dims/disables when PTT itself is off. Same pattern on cards 4 and 5.

### Card 4 — Push-to-Talk Sounds (`settingId: "floatingbar.pttsounds"`, lines 183–208)
- Title `"Push-to-Talk Sounds"`, caption `"Play audio feedback when starting and ending voice input."`. Toggle bound to `$settings.pttSoundsEnabled`, same purple tint (flag) and PTT-dependent disable/dim.

### Card 5 — Mute Audio While Talking (`settingId: "floatingbar.muteaudio"`, lines 210–235)
- Title `"Mute Audio While Talking"`, caption `"Silence music and other playback while holding push-to-talk, then restore it on release."`. Toggle bound to `$settings.pttMuteSystemAudio`, same tint/disable pattern (flag).

### Shortcut recorder UI mechanics (`shortcutRecorderCard`, lines 355–413; capture logic lines 415–466)
- Recorder card shows current shortcut's token chips (`shortcut.displayTokens`), each its own pill: size 13 semibold text, horizontal padding 10 if token length > 2 chars else 8, vertical padding 7, `RoundedRectangle(cornerRadius: 8).fill(OmiColors.backgroundPrimary)`. Plus a `Save`/`Listening...` button (label toggles on `isRecording`). Plus helper text. Plus inline error text (red, size 12 medium, `.red.opacity(0.9)`) shown only while recording and `captureError != nil`.
- `startShortcutCapture(_:)` (lines 415–425): stops any existing capture, sets `recordingTarget`, clears error, installs `NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged, .keyDown])` — **local-only** monitor (app must be focused during recording; not a global hook).
- `handleShortcutCapture(_:)` (lines 436–466): for `.askOmi`, a pure `.flagsChanged` (modifier-only) event sets `captureError = "Ask omi needs a non-modifier key."` and swallows the event (returns true) rather than accepting it — live-enforces the non-modifier rule during recording. For `.pushToTalk`, `.flagsChanged` IS accepted via `KeyboardShortcut.fromRecordingEvent(event, allowModifierOnly: true)`. On successful capture for either target: stops capture (removes monitor, clears `recordingTarget`/`captureError`), returns true.
- Monitor closure returns `nil` (swallow) when the event was handled, else passes it through — matched key events don't propagate further in the app while recording.
- Shared chip styling helpers: `shortcutSelectionLabel(tokens:isSelected:)` (lines 332–353) — selected state `purplePrimary.opacity(0.3)` fill + `purplePrimary` 1.5pt stroke (flag), unselected `backgroundTertiary.opacity(0.5)` fill + clear stroke. `customShortcutButton`/`disableShortcutButton` (lines 278–330) share near-identical chip styling (padding h14/v10, cornerRadius 10, same purple-flagged selected state).

**Conflict handling**: no explicit cross-target conflict detection in this file (Ask omi vs PTT shortcut collision isn't checked here) — only the per-target modifier-key-requirement validation described above.

---

## 6. `ShortcutSettings.swift` (`FloatingControlBar/ShortcutSettings.swift`, 626 lines) — `@MainActor` `ObservableObject` singleton backing #5

### `KeyboardShortcut` struct (lines 12–269)
Fields: `keyCode: UInt16?`, `keyDisplay: String?`, `modifiersRawValue: UInt` (stores `NSEvent.ModifierFlags.rawValue`), `modifierOnly: Bool`, `requiresRightCommand: Bool`. `Codable, Hashable`.
- `supportedModifierMask = [.command, .shift, .option, .control, .function]` — other modifier bits stripped by `normalizedModifiers`.
- Two constructors: keyed shortcut (`keyCode` + `keyDisplay` + modifiers) vs. modifier-only shortcut (no key, held modifiers; optional `requiresRightCommand`, only honored when the normalized modifier set is exactly `[.command]` — distinguishes "Right ⌘" as its own PTT preset from generic Command).
- `displayTokens`: modifier-only + `requiresRightCommand` → `["Right ⌘"]`; modifier-only → modifier symbol tokens only; keyed → modifier tokens + key display string.
- `displayLabel` / `promptLabel`: human/spoken names — `"Option"`, `"Fn"`, `"Command"`, `"Control"`, `"Shift"`, `"Right Cmd"` (and lowercase for prompts).
- `carbonModifiers`: maps to Carbon Event Manager bit flags (`cmdKey`/`shiftKey`/`optionKey`/`controlKey`/`kEventKeyModifierFnMask`) — used for registering the global hotkey. **No direct Windows analog** — flagged below.
- `matchesKeyDown`/`matchesKeyUp`/`matchesFlagsChanged`: exact-match helpers; right-command case checks literal `event.keyCode == 54` (macOS Right-⌘ keycode).
- `fromRecordingEvent(_:allowModifierOnly:)`: builds a shortcut from a live `NSEvent` — `.keyDown` always allowed; `.flagsChanged` only if `allowModifierOnly` and modifier set non-empty; if resulting set is exactly `[.command]` with `keyCode == 54`, marks `requiresRightCommand: true`.
- `keyDisplay(for:characters:)` (lines 191–268): big switch mapping raw macOS virtual keycodes to display glyphs. Return→`"↩"`(36), Tab→`"Tab"`(48), Space→`"Space"`(49), Delete→`"⌫"`(51), Escape→`"Esc"`(53), Clear→`"⌧"`(71), numpad Enter→`"Enter"`(76). F-keys are **not** in numeric keycode order: F5=96, F6=97, F7=98, F3=99, F8=100, F9=101, F11=103, F13=105, F16=106, F14=107, F10=109, F12=111, F15=113, F4=118, F2=120, F1=122 — a Windows port must remap via VK codes, not reuse these numbers. Also: Help(114)/Home(115)/PageUp(116)/`⌦`forward-delete(117)/End(119)/PageDown(121), arrows 123–126 → `←→↓↑`. Default: uses `characters` (uppercased, trimmed) if available, else `"Key \(keyCode)"`.

### Static presets (lines 271–293)
- Ask omi presets (4, all single-key + Command): `⌘O` (keyCode 31) — **default**, `⌘↩` (keyCode 36 + Command), `⌘⇧↩` (keyCode 36 + Command+Shift), `⌘J` (keyCode 38 + Command).
- PTT presets (4, all **modifier-only**): Option alone (**default**, `pttPresets[0]`), Right ⌘ (`requiresRightCommand: true`), Fn, Control.

### Published properties & UserDefaults keys (all `@Published`, persisted on `didSet`)

| Property | Type | UserDefaults key | Default | Notes |
|---|---|---|---|---|
| `pttShortcut` | `KeyboardShortcut` (JSON) | `shortcut_pttKey` | `pttPresets[0]` (Option) | legacy string migration via `legacyPTTShortcut` |
| `askOmiShortcut` | `KeyboardShortcut` (JSON) | `shortcut_askOmiKey` | `defaultAskOmiShortcut` (⌘O) | posts `askOmiShortcutChanged`; legacy migration via `legacyAskOmiShortcut` |
| `askOmiEnabled` | `Bool` | `shortcut_askOmiEnabled` | `true` | also posts `askOmiShortcutChanged` |
| `pttEnabled` | `Bool` | `shortcut_pttEnabled` | `true` | |
| `doubleTapForLock` | `Bool` | `shortcut_doubleTapForLock` | `true` | |
| `solidBackground` | `Bool` | `shortcut_solidBackground` | `false` | not surfaced in this Shortcuts UI file (likely Floating Bar section) |
| `pttSoundsEnabled` | `Bool` | `shortcut_pttSoundsEnabled` | `true` | |
| `pttMuteSystemAudio` | `Bool` | `shortcut_pttMuteSystemAudio` | `true` | |
| `selectedModel` | `String` | `shortcut_selectedModel` | `ModelQoS.Claude.sanitizedSelection(nil)` | re-sanitized on `.modelTierDidChange` |
| `pttTranscriptionMode` | enum `.live`/`.batch` (rawValue string) | `shortcut_pttTranscriptionMode` | `.batch` | `.live`="Real-time transcription as you speak", `.batch`="Transcribe after recording for better accuracy" — not exposed in this file (likely Floating Bar section) |
| `draggableBarEnabled` | `Bool` | `shortcut_draggableBarEnabled` | `false` | |
| `floatingBarTypedQuestionVoiceAnswersEnabled` | `Bool` | `shortcut_floatingBarTypedQuestionVoiceAnswersEnabled` | `false` | on-set, if `!hasAnyFloatingBarVoiceAnswersEnabled` calls `FloatingBarVoicePlaybackService.shared.stop()` — dead branch since that computed property always returns `true` (lines 509–511) |
| `voicePlaybackSpeed` | `Float` | `shortcut_voicePlaybackSpeed` | `1.4` | 6 presets `[0.8, 1.0, 1.2, 1.4, 1.6, 2.0]`, labeled Slow/Normal/Fast/Faster/"Very Fast"/Maximum |
| `selectedVoiceID` | `String` | `shortcut_selectedVoiceID` | `defaultVoiceID` = `"openai:shimmer"` | on real change, plays a voice sample via `FloatingBarVoicePlaybackService.shared.playVoiceSample` + prewarms kickoff phrases |
| `floatingBarVoiceAnswersEnabled` | `let` constant, always `true` | — | — | PTT replies are ALWAYS spoken; not user-configurable. Only the typed-question toggle above is user-facing. |

### Available voices (lines 440–489) — 4 curated OpenAI voices only (no local-system voice despite `Provider.localSystem` enum case existing)
- **Onyx** (male) — `"OpenAI, deep, grounded"` — instructions: "Speak in a deep, natural, grounded voice with calm confidence and smooth pacing."
- **Shimmer** (female, **default**) — `"OpenAI, warm human, cheap"` — instructions: "Speak naturally in a warm, relaxed adult tone. Keep it conversational, calm, and human without sounding exaggerated."
- **Coral** (female) — `"OpenAI, bright, expressive"` — instructions: "Speak naturally in a warm, expressive human tone with smooth pacing and light emotional color."
- **Nova** (female) — `"OpenAI, clear, friendly"` — instructions: "Speak in a natural, friendly, confident tone with clear articulation and relaxed pacing."

`voiceOption(for:)` falls back to `defaultVoiceID` then `availableVoices[0]` if id not found — never crashes on unknown id.

### Init (lines 528–574)
Loads each persisted value with `?? default` fallback. Legacy string-based shortcuts (pre-JSON format) migrated via `legacyAskOmiShortcut`/`legacyPTTShortcut` string tables (e.g. old `"⌘ Enter"` → `askOmiCommandReturnShortcut`, old `"Option (⌥)"` → `pttPresets[0]`) — **Mac-only baggage, no Windows equivalent needed** (fresh install, no legacy data). Registers observer on `.modelTierDidChange` to re-sanitize `selectedModel`. Calls `FloatingBarVoicePlaybackService.shared.prewarmBackgroundAgentKickoffPhrases()` via a detached `Task` on init.

`askOmiUsesCustomShortcut` / `pttUsesCustomShortcut` (lines 517–523): simply `!presets.contains(currentShortcut)` — "custom" is defined purely as "not one of the 4 canned presets," no separate stored flag.

### Cross-file wiring notes for the Windows port
- `askOmiShortcutChanged` notification (posted on both `askOmiShortcut` and `askOmiEnabled` change) is the signal consumed elsewhere to re-register the OS-level global hotkey. Windows needs an equivalent event/callback to re-bind its own global hotkey (e.g. Electron `globalShortcut.register`) whenever either property changes.
- `carbonModifiers` (Carbon Event Manager modifier bitmask) has **no direct Windows equivalent**; if this is an Electron port, `globalShortcut` takes accelerator strings, not raw bitmasks — the binding layer needs its own accelerator-string builder from `displayTokens`/modifier flags rather than porting `carbonModifiers` literally.
- The right-Command-specific keycode check (`event.keyCode == 54`) is Mac-only. Windows has real left/right modifier VK codes (`VK_LCONTROL`/`VK_RCONTROL`, `VK_LMENU`/`VK_RMENU`; no conventional "Right Windows key as PTT" but `VK_RWIN` exists). The "Right ⌘" PTT preset needs a Windows-appropriate replacement (e.g. Right Alt or Right Ctrl), not a literal same-key port, since Windows has no Command key.

---

## Consolidated purple-usage flag list (for the spec doc's "must re-skin" section)

Every one of these needs a non-purple substitute per `AGENTS.md` `INV-UI-1`:
- Transcription: Language Mode icon + both selected-state fills/strokes, Custom Vocabulary icon + add-button active color, Local VAD Gate icon.
- Rewind: all four card icons (Storage, Excluded Apps, Battery, Retention).
- Notifications/Privacy: both Notifications-section card header icons, all four Privacy-section card header icons.
- Shortcuts: `doubleTapForLock`/`pttSoundsEnabled`/`pttMuteSystemAudio` toggle `.tint(OmiColors.purplePrimary)`, and the selected-state chip fill/stroke in `shortcutSelectionLabel`/`customShortcutButton`/`disableShortcutButton`.
- General section is the one screen in this batch with **no purple** — all its accents use `OmiColors.info` (blue) instead, which is a safe pattern to reuse Windows-wide.
