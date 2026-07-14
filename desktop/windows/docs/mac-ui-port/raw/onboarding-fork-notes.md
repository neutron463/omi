# Raw onboarding spec (delivered by onboarding-fork, 2026-07-14)

> Verbatim capture of the onboarding sub-agent's findings from the v0.12.72 mac-ref worktree.
> To be synthesized into 06-settings-onboarding.md. Paths relative to `desktop/macos/` in
> `C:\Users\chris\projects\omi\.worktrees\mac-ref\`.

Read every file in `desktop/macos/Desktop/Sources/Onboarding/*.swift` (25 files), plus `Desktop/Sources/FileIndexing/OnboardingLoadingAnimation.swift`, `Desktop/Sources/PostOnboardingPromptViews.swift`, and `Desktop/Sources/SignInView.swift` (the only sign-in view found; it precedes onboarding, not inside the flow).

# 1. Exact step order (state machine)

`Desktop/Sources/Onboarding/OnboardingFlow.swift:4-23` — `OnboardingFlow.steps` is a documentation-only array of step names (not directly switched on; used for count/labels):

```
0 Name, 1 Language, 2 HowDidYouHear, 3 Trust, 4 ScreenRecording, 5 FullDiskAccess,
6 FileScan, 7 Microphone, 8 Accessibility, 9 Automation, 10 FloatingBarShortcut,
11 FloatingBar, 12 VoiceShortcut, 13 VoiceDemo, 14 DataSources, 15 Exports,
16 Goal, 17 Tasks
```
`introStepCount = 13` (used only as the progress-bar `totalSteps` denominator for the paged-intro-styled steps 0–8ish), `lastStepIndex = 17`.

The actual switch lives in `Desktop/Sources/Onboarding/OnboardingView.swift:122-457` (`onboardingContent`), driven by `@AppStorage("onboardingStep") currentStep`, `if/else if` chain on `currentStep` 0 through 16, `else` (17+) falls to Tasks:

| currentStep | View | stepIndex passed | totalSteps passed |
|---|---|---|---|
| 0 | `OnboardingWelcomeStepView` | 0 | `OnboardingFlow.introStepCount` (13) |
| 1 | `OnboardingLanguageStepView` | 1 | 13 |
| 2 | `OnboardingHowDidYouHearStepView` | 2 | 13 |
| 3 | `OnboardingTrustStepView` | 3 | 13 |
| 4 | `OnboardingPermissionStepView` (Screen Recording) | 4 | 13 |
| 5 | `OnboardingPermissionStepView` (Full Disk Access) | 5 | 13 |
| 6 | `OnboardingFileScanStepView` | 6 | 13 |
| 7 | `OnboardingPermissionStepView` (Microphone) | 7 | 13 |
| 8 | `OnboardingPermissionStepView` (Accessibility) | 8 | 13 |
| 9 | `OnboardingPermissionStepView` (Automation) | 9 | 13 |
| 10 | `OnboardingFloatingBarShortcutStepView` | — (no scaffold, custom header) | — |
| 11 | `OnboardingFloatingBarDemoView` | — (custom header) | — |
| 12 | `OnboardingVoiceShortcutStepView` | — (custom header) | — |
| 13 | `OnboardingVoiceDemoView` | — (custom header) | — |
| 14 | `OnboardingDataSourcesStepView` | 14 | 13 (stepIndex EXCEEDS totalSteps — progress bar over-fills; dot row fills all dots when `index <= stepIndex`) |
| 15 | `OnboardingExportsStepView` | 15 | 13 |
| 16 | `OnboardingGoalStepView` | 16 | 13 |
| else (17+) | `OnboardingTasksStepView` | — (custom header, no scaffold) | — |

Steps 10–13 and 17 use a bespoke `VStack` header (logo + Skip button + Divider) rather than `OnboardingStepScaffold` — full-bleed, non-split-pane screens. Steps 0–9 and 14–16 use `OnboardingStepScaffold` (split-pane with the memory-graph right pane, or centered mode).

Each step's `onContinue`/`onComplete` closure calls `AnalyticsManager.shared.onboardingStepCompleted(step:stepName:)` with a hardcoded step name string (e.g. `"Name"`, `"ScreenRecording_Skipped"` for skip paths), then increments `currentStep`. `onForceComplete` (long-press the logo, or "Skip onboarding" dev button on step 0) calls `handleOnboardingComplete()` directly from any step.

# 2. Step-skipping / migration logic

`OnboardingFlow.migratedStep(...)` (`OnboardingFlow.swift:28-135`) is a one-time migration run in `OnboardingView.onAppear` (`OnboardingView.swift:66-106`) that remaps a returning user's persisted `currentStep` when the step list changed shape between versions. Driven by `@AppStorage` boolean flags (e.g. `hasInsertedHowDidYouHearStep`, `hasRemovedBYOKStep`) set true after migration. Pure resume-position bookkeeping — no skipping based on "permission already granted"; every user proceeds through the full ordered list on first run.

Exceptions to strict linear progression:
1. **`exportStepOverride`** (`OnboardingView.swift:11,68-70`) — force-sets `currentStep` (used by `isExportPreview` mode for rendering a step in isolation).
2. **`resetOnboardingRequested` notification** (`OnboardingView.swift:116-119`) resets `currentStep = 0` from anywhere.
3. **Per-step "Skip" buttons** — most steps 4-16; logs analytics with `_Skipped` suffix and advances by exactly 1 — "don't do the action, still advance," never "jump ahead."
4. **Permission steps auto-advance** — polls every 1s (`Timer.publish`) plus on `scenePhase` `.active`; once `isGranted`, `scheduleAutoAdvance()` waits 350ms then calls `onContinue()` automatically.
5. **complete_onboarding tool** — the AI chat flow (`OnboardingChatView.swift`, NOT reachable from the linear `OnboardingView` switch in this build — appears to be a parallel/legacy chat-driven onboarding wired through `ChatToolExecutor`) can call `complete_onboarding`. `OnboardingChatPersistence` (`OnboardingChatView.swift:11-83`) has restart-survival state (`isMidOnboarding`, exploration text, tool-completed, goal-completed) — on restart mid-onboarding the chat resumes, replaying a system-prompt-injected conversation summary. This does NOT connect to `OnboardingView`'s AppStorage `currentStep` resume — possibly two coexisting onboarding UIs (see ambiguities).

# 3. Per-step view detail (in flow order)

## Step 0 — Name: `OnboardingWelcomeStepView.swift` (81 lines)
`OnboardingStepScaffold` with `layoutMode: .centered` (no split pane), `eyebrow: "Name"`, `title: "What should Omi call you?"`, `description: ""`.
Content: centered `VStack(spacing: 18)`:
- `TextField("Your name", text: $coordinator.draftName)` — plain style, 16h/14v padding, `RoundedRectangle(cornerRadius: 14)` fill `OmiColors.backgroundSecondary`, 1px white-8%-opacity stroke, `maxWidth: 320`, `onSubmit` triggers `confirmName()`.
- Optional error text: `coordinator.lastActionError`, 12pt medium, `OmiColors.warning`, centered.
- Button "Continue" — `OnboardingCardButtonStyle(isPrimary: true)`, `.keyboardShortcut(.defaultAction)`.
- Dev-only (`AnalyticsManager.isDevBuild`): "Skip onboarding" plain button, 12pt medium, `OmiColors.textTertiary`, calls `onForceComplete?()`.
On appear: clears error, pre-fills `draftName` from `coordinator.preferredName` (Apple/Google sign-in given name, or "there" fallback).
`confirmName()` calls `coordinator.confirmPreferredName()` (async — `set_user_preferences` tool + saves a `"user"` node to the knowledge graph), advances only if no error.

## Step 1 — Language: `OnboardingLanguageStepView.swift` (127 lines)
Split scaffold. `eyebrow: "Languages"`, `title: "Pick every language you speak."`, `description: "Omi listens in all of them — your first pick is the primary, used for prompts and summaries."`
- `LazyVGrid` of `OnboardingSelectableChip` (adaptive columns min 108pt) from `OnboardingPagedIntroCoordinator.commonLanguages` (10 fixed: English, Spanish, French, German, Portuguese, Russian, Hindi, Japanese, Italian, Dutch as `(code, name)` pairs) plus previously-added custom codes. FIRST selected language's chip gets checkmark suffix `"\(name) ✓"` (primary).
- Trailing "Other…" chip toggles custom field: `TextField("Ukrainian, Korean, Turkish…")` + "Add" button (`OnboardingCardButtonStyle(isPrimary: false)`).
- If ≥1 selected: `Text("Primary: \(primaryName)")`, 12pt medium, `textTertiary`.
- "Continue"/"Saving…" button, disabled while empty or saving. Error text if set.
Behavior: chip toggles in `selectedLanguageCodes` (order-preserving — order determines primary). `addCustomLanguage()` normalizes via `AssistantSettings.normalizeTranscriptionLanguageCode`, rejects unrecognized with error. `saveAndContinue()` → `coordinator.confirmLanguages()`: persists `AssistantSettings.shared.voiceLanguages`, PATCHes primary to backend (`APIClient.shared.updateUserLanguage`) with one retry after 1s, writes language nodes to knowledge graph.

## Step 2 — How did you hear: `OnboardingHowDidYouHearStepView.swift` (65 lines)
Split scaffold. `eyebrow: "Quick question"`, `title: "How did you hear\nabout Omi?"`, `description: ""`.
`FlowLayout` (imported from `AppsPage.swift`) of chips for a SHUFFLED (per session) list:
`"Social media", "YouTube", "Newsletter", "AI chat", "Search engine", "Event", "Friend", "Colleague", "Podcast", "Article", "Product Hunt", "Other"`.
No Continue button — tapping selects, fires `AnalyticsManager.shared.onboardingHowDidYouHear(source:)`, auto-advances after 0.25s.

## Step 3 — Trust: `OnboardingTrustStepView.swift` (92 lines)
`.centered` scaffold. `eyebrow: "Before we continue"`, `title: "I'm going to ask for a few permissions."`, `description: "Omi is open source and private by design. During setup, we'll ask for these permissions to understand your work and help in the right places:"`.
Three `permissionRow` cards (icon in 28x28 `RoundedRectangle` chip, title, detail), each `RoundedRectangle(cornerRadius: 14)` bg `backgroundTertiary.opacity(0.55)`, `VStack(spacing: 12)` maxWidth 560:
1. icon `"display"`, "Screen + files", "Build context from what you're working on."
2. icon `"mic.fill"`, "Microphone", "Capture voice notes and meeting context."
3. icon `"sparkles"`, "Accessibility + automation", "Know the active app and act when you ask."
Below: "Continue" (primary) + plain "Read the source code" link (13pt medium, `textSecondary`) → opens `https://github.com/BasedHardware/omi`.
Note: `hasReorderedTrustStep` migration flag — this step used to come first, was reordered after Name/Language/HowDidYouHear.
`OnboardingTrustPreviewCard` (`OnboardingView.swift:534-637`) — alternate/legacy trust-preview widget with demo video (`OnboardingVideoView`) + "Trust & Privacy" rows (Open Source w/ GitHub link, Encrypted, User-Owned) — NOT wired into the live flow; likely legacy.

## Steps 4, 5, 7, 8, 9 — Permissions: `OnboardingPermissionStepView.swift` (203 lines), parameterized per call site
Split scaffold, `showsSkip: true` always. Per instantiation (`OnboardingView.swift:172-324`):

| Step | eyebrow | title | description | permissionType | icon | reasonTitle | reasonDetail | primaryActionLabel | requiresRestart |
|---|---|---|---|---|---|---|---|---|---|
| 4 | "Permission" | "Let Omi read your screen." | "Screen Recording lets Omi see what you're working on." | screen_recording | display.and.arrow.down | "Screen Recording" | (same as description) | "Open Screen Recording settings" | true |
| 5 | "Access" | "Let Omi scan your work." | "File access lets Omi map your projects and files." | full_disk_access | externaldrive.fill.badge.person.crop | "Disk Access" | "This lets Omi scan your projects and recent files." | "Open Disk Access" | false |
| 7 | "Permission" | "Let Omi use your mic." | "Microphone lets Omi transcribe meetings." | microphone | mic.fill | "Microphone" | "This lets Omi transcribe meetings and voice notes." | "Grant microphone access" | false |
| 8 | "Permission" | "Let Omi see the active app." | "Accessibility lets Omi know which app is active." | accessibility | figure.wave | "Accessibility" | "This lets Omi know which app you are using." | "Open Accessibility settings" | false |
| 9 | "Permission" | "Let Omi act when asked." | "Automation lets Omi take actions for you." | automation | bolt.horizontal.circle.fill | "Automation" | "This lets Omi take actions when you ask." | "Grant automation access" | false |

Layout (`OnboardingPermissionStepView.swift:44-118`):
- `HStack`: 58x58 `RoundedRectangle(cornerRadius: 20)` icon chip (`backgroundSecondary`) with 24pt semibold SF Symbol (`textSecondary`), then `reasonTitle` (18pt semibold) + status (13pt medium — "Granted" in `OmiColors.success`, "Waiting for macOS..." / "Not granted yet" in `textTertiary`).
- `reasonDetail` 14pt, `textSecondary`, 4pt line spacing.
- Step 4 only, when `appState.isScreenRecordingStale`: warning "macOS still isn't granting screen capture to this build. In Screen & System Audio Recording, toggle Omi Dev off, then on again, then quit and reopen the app." — 13pt medium, `OmiColors.warning`.
- Step 5 only: shows `coordinator.userEmail()`, 13pt medium, `textTertiary`.
- If granted: `Text("Permission granted. Continuing…")`, 13pt medium, `textTertiary` (replaces button).
- Else: primary button with `primaryActionLabel` / "Waiting for macOS…" while requesting. Tap → `coordinator.requestPermission(type:appState:)` → `request_permission` tool.
State: 1s repeating timer + `scenePhase` both call `refreshPermissionState()`; screen-recording additionally does async `ScreenCaptureService.checkPermission(forceActualTestIfPreflightDenied: true)` off-thread. Once granted, `scheduleAutoAdvance()` (guarded by `hasAutoAdvanced`) waits 350ms → `onContinue()`.

## Step 6 — File Scan: `OnboardingFileScanStepView.swift` (91 lines)
Split scaffold, `showsSkip: true`. `eyebrow: "Discovery"`, `title: "Start building your profile."`, `description: "Omi scans projects and recent files."`.
Large `RoundedRectangle(cornerRadius: 28)` card (`backgroundSecondary`, white-8% stroke, maxWidth 560 / maxHeight 280):
- `OnboardingLoadingAnimation(progress: scanProgress)` at 160pt height.
- `coordinator.scanStatusText` (18pt semibold): "Ready to scan your files." → "Scanning your projects and apps..." → "Your workspace is mapped."
- Either `"\(fileCount.formatted()) files indexed"` (13pt medium monospacedDigit, `textTertiary`) or `"Your graph and suggestions will build from this scan."`.
Below: "Continue" once `scanSnapshot != nil`, else `"Scanning your workspace…"` (13pt, `textTertiary`).
`scanProgress` maps `coordinator.scanState`: `.idle`→0.12, `.scanning` no snapshot→0.55, `.scanning` w/ snapshot→0.82, `.complete`→1.0, `.failed`→0.2 — state-driven, not real percentage.
On `.task`: `coordinator.startFileScanIfNeeded(appState:)`; in parallel (`Task.detached`) kicks off Gmail/Calendar/web-research insight loading (`startBackgroundInsightsIfNeeded()`) so they're ready by DataSources.

## Step 10 — Floating Bar Shortcut: `OnboardingFloatingBarShortcutStepView.swift` (335 lines)
Bespoke `VStack` (logo + Skip header, 24h/16v padding, `Divider`).
Title: "Let's set \"Ask a question\" shortcut.\nPress this shortcut. Do the buttons light up?" — 22pt semibold, centered.
420pt-wide, 128pt-tall `RoundedRectangle(cornerRadius: 16)` (`backgroundSecondary`) preview: key-cap chips (`keyCap(_:)` — 48x48 min `RoundedRectangle(cornerRadius: 10)`, 2px border, fill/border turn solid white with black text once `shortcutDetected`) from `shortcutSettings.askOmiShortcut.displayTokens`, plus "Shortcut detected" / "Press to test" (13pt medium, `textTertiary`).
Below: "Choose a different shortcut:" (14pt medium, `textSecondary`) + preset pills (`ShortcutSettings.askOmiPresets`) + "Custom" pill. Custom reveals recorder panel: "Press your custom shortcut now" / "Custom shortcut", key-cap row, "Listening..." / "Save", helper "Use at least one non-modifier key, like J or Return.", error in red ("Ask omi needs a non-modifier key.").
Confirmed → "Continue" slides in from bottom (`.move(edge:.bottom).combined(with:.opacity)`, `.easeInOut(duration:0.3)`).
Mechanism: local + global `NSEvent` monitors for `.keyDown`/`.flagsChanged`; temporarily nils `NSApp.mainMenu` (stashed in `Self.savedMenu`) so first keypress isn't swallowed; restores on disappear. `GlobalShortcutManager.shared.setRegistrationSuspended(true/false)` brackets the step. Detection only — does not open the floating bar.

## Step 11 — Floating Bar Demo: `OnboardingFloatingBarDemoView.swift` (214 lines)
Bespoke header. Two phases via `barActivated` (flips when the real bar's `showingAIConversation` becomes true, polled 0.25s):
- Phase 1: headline "Omi sees your screen and gives you hyper-personalized responses" (20pt bold, maxWidth 560), sub "Press this shortcut to open Ask Omi." (18pt medium, `textSecondary`), shortcut token row, "Ask Omi opens at the top of your screen." (13pt, `textTertiary`).
- Phase 2: headline "Type in the Floating Bar 'Which computer should I buy?'" (24pt bold, maxWidth 560, 4pt line spacing). Below, `MacLineupPreview` renders `onboarding_mac_lineup.png` (fallback placeholder card "Mac lineup image unavailable"), maxWidth 980, `RoundedRectangle(cornerRadius: 24)` clip.
On appear: `FloatingControlBarManager.shared.setup(...)`, AI draft → `.onboardingFloating`, registers REAL global shortcuts. `waitForResponse()` polls 0.5s up to 60s for streamed response completion, then reveals "Continue" (white bg/black text, cornerRadius 12, slide+fade) — shown anyway on timeout.
On disappear: closes the bar's AI panel.

## Step 12 — Voice (PTT) Shortcut: `OnboardingVoiceShortcutStepView.swift` (353 lines)
Same pattern as step 10, for push-to-talk.
Title: "Let's set \"Audio ask a question\" shortcut.\nPress and hold to test. Does the button light up?"
Presets `ShortcutSettings.pttPresets`. Custom capture `allowModifierOnly: true` (unlike step 10). Helper: "You can use one key or a combination like ⌘ J." Error: "Press the key combination you want to use."
Listens for BOTH `.flagsChanged` (`matchesFlagsChanged`) and non-repeat `.keyDown` (`matchesKeyDown`).
On appear: sets up bar, resets conversation, HIDES bar (`FloatingControlBarManager.shared.hide()`), `PushToTalkManager.shared.cleanup()` — detection only.
Continue transition here is `.move(edge:.trailing)` (not `.bottom`) — inconsistency, flag for port decision.

## Step 13 — Voice Demo: `OnboardingVoiceDemoView.swift` (262 lines)
Bespoke header. Title: "Hold \(shortcut.displayLabel) and Ask" (24pt bold, dynamic). Sub: "Try asking: What's on my screen?" (18pt medium).
Three mutually exclusive states:
1. Volume warning (if `outputReadiness.shouldAskUserToTurnUpVolume`): 420pt card, title "Your Mac volume is muted" / "Your Mac volume is at 0" (15pt semibold, per `SystemAudioMuteController.OutputReadiness`), body "Turn up your Mac volume so you can hear Omi respond, then try push-to-talk.", "I turned it up" button re-checks. Polled every 1s.
2. Not yet pressed: "Hold the shortcut, speak, then release" (13pt, `textTertiary`) + key-cap row + "hold" label.
3. Pressed, waiting: "Waiting for omi to respond..." or "Listening... release when done" per `waitingForResponse`.
Continue (white bg, black text, 280pt maxWidth) fades/slides from bottom once response completes or send cycle finishes (even on error) — poll 0.25s up to 20s.
Mechanics: sets `shortcutSettings.pttTranscriptionMode = .live` for the duration (restored on disappear), warms chat bridge, `PushToTalkManager.shared.setup(barState:)`, observes `pttManager.state`. Gate: `OnboardingFlow.shouldUnlockVoiceShortcutContinue(observedShortcutPress:pttState:)` (`OnboardingFlow.swift:137-142`, `observedShortcutPress && pttState == .idle`).

## Step 14 — Data Sources: `OnboardingDataSourcesStepView.swift` (365 lines)
Split scaffold, `eyebrow: ""`, `title: "Your 2nd brain is live."`, `description: "Connect more of your context."`, `rightPaneFooterText: coordinator.connectedContextSummary` (right pane gains "Who you are" footer).
Card (`RoundedRectangle(cornerRadius: 22)`, `backgroundSecondary`) with rows separated by inset dividers (`listDivider`, left-padded 66pt):
1. **Calendar** — `ConnectorBrandIcon(.calendar)`, always-on toggle (disabled), metrics `"<N events> • <N memories>"`, status via `OnboardingDataSourceRowStatus` (green, "Scanning..." while `scanFinished == false`, red "Couldn't read - check access" on `scanFailed`).
2. **Email** — `ConnectorBrandIcon(.gmail)`, same pattern, "email/emails".
3. **Local files** — `ConnectorBrandIcon(.localFiles)`, metrics from `scanSnapshot?.fileCount`, "file/files", no scan-in-progress indicator.
4. **Apple Notes** — `ConnectorBrandIcon(.appleNotes)`, "note/notes"; while `appleNotesInsightCount == 0` shows "Select Folder" → `selectAppleNotesFolderAndSync()` (`NSOpenPanel` defaulted to `~/Library/Group Containers/group.com.apple.notes`); locked-on once synced.
5. **ChatGPT memory import** (`compactMemoryLogRow(.chatgpt)`) — expandable: "Open ChatGPT, paste the copied prompt, then drop the full response here.", "Open ChatGPT and Copy Prompt" button (copies `source.prompt`, opens `https://chatgpt.com/?q=<prompt>`), `TextEditor` (placeholder "Paste the full ChatGPT response here…"), "Import ChatGPT"/"Importing…" + "Cancel". Once `importedMemoryCount > 0`: locked-on with "N memories".
6. **Claude memory import** — identical via `.claude`, deep link `https://claude.ai/new?q=<prompt>`.
Shared memory-log prompt (`OnboardingMemoryLogSource.prompt`, `OnboardingMemoryLogImportService.swift:48-52`): "Return everything you know about me inside one fenced code block. Include long-term memory, bio details, and any model-set context you have with dates when available. I want a thorough memory export of what you've learned about me. Skip tool details and include only information that is actually about me. Be exhaustive and careful."
Below: error text, then "Continue" (once `coordinator.isResearchComplete`, scale+fade `.opacity.combined(with: .scale(scale: 0.95))`) or `ProgressView` + "Scanning your data sources..." (13pt medium, `textTertiary`).
On `.task`: loads graph from storage; `startBackgroundInsightsIfNeeded()` (idempotent).

## Step 15 — Exports: `OnboardingExportsStepView.swift` (307 lines)
Split scaffold, `eyebrow: ""`, `title: "Put your memories where you work."`, `description: "Connect the tools where you want Omi context to live."`, `rightPaneFooterText: summaryText`.
Card of destination rows, one per `MemoryExportDestination` where `supportsMemoryPack || supportsAgentSetup`. Each: `ConnectorBrandIcon`, title, dynamic metrics (`"<N> memories exported"` / `"Automatic export"` / `"Copy-ready page"` (Notion) / `"Agent prompt ready"`/`"Connect an agent"` / `"Prompt + memory pack"`), "Connect"/"Close" pill toggling an inline panel (`OnboardingInlineExportPanel`):
- `.notion`: "Omi copies a ready-to-paste memory page, saves a backup in Downloads, and opens Notion."
- `.obsidian`: "Pick your Obsidian vault once. Omi will keep refreshing `Omi/Memories.md` there." or chosen vault path; "Choose vault"/"Change vault".
- `.chatgpt, .claude, .gemini`: "Omi copies the prompt and memory pack together, saves a Markdown backup, and opens \(title)."
- `.agents`: "Omi copies one setup prompt for your agent. It includes the connection keys and a short guide the agent can save for later."
- `.claudeCode, .codex, .openclaw, .hermes`: "Connect \(title) over MCP from Apps after onboarding." (deferred).
Action label: "Copy & open" (notion/chatgpt/claude/gemini/agent-code), "Choose vault"/"Export" (obsidian), "Copy prompt" (agents); running: "Preparing…"/"Exporting…". Plus "Cancel". Success = green `statusMessage`; failure via `UserFacingErrorPresentation.message(from:while: .memoryExport)`.
Static "Continue" — not gated on any destination.

## Step 16 — Goal: `OnboardingGoalStepView.swift` (157 lines)
Split scaffold, `showsSkip: true`. `eyebrow: "Goal"`, `title: "Pick one goal."`, `description: "Selecting a correct and detailed goal is very important - Omi will optimize all advice to achieve that goal. Make sure your goal contains a number to measure progress."`.
`GoalChipGrid` — `LazyVGrid` (adaptive, min 180pt) of up to 4 suggested-goal chips (`coordinator.goalSuggestionCards()` from file-scan/email/calendar/web-research heuristics, or 3 generic fallbacks + "I'll type my own") plus fixed "Type my own" chip. Suggestion sets `coordinator.goalDraft`; "Type my own" reveals `TextField("Type your goal")`.
Below: error text, "Continue"/"Saving…" once `trimmedGoal` non-empty, disabled while `isSavingGoal`.
`saveGoalAndContinue()`: `coordinator.saveGoalIfNeeded()` (AI-normalizes via `GoalsAIService` into `GoalType`/target/unit, POSTs `APIClient.shared.createGoal` with `[1,3,6]`s backoff on 429 — parallel local-file-memory batch import can saturate the rate limiter), then `coordinator.completeIntro(appState:)` → `complete_onboarding` tool; advances only if both succeed.

## Step 17 — Tasks: `OnboardingTasksStepView.swift` (146 lines)
Bespoke header (logo only, NO Skip button rendered).
Pulsing glow circle (`Color.white.opacity(0.15)`, blur 20, scale 1.0↔1.2, `.easeInOut(duration:2).repeatForever`) behind 44pt `"checklist"` SF Symbol with white→gray linear gradient. Headline "Auto-created Tasks" (24pt bold), body "omi listens to your conversations and automatically\ncreates tasks, action items, and follow-ups for you." (14pt, centered, 4pt line spacing).
3 mock task rows (staggered spring-in after 0.4s, `.spring(response:0.5, dampingFraction:0.8)`) — hardcoded: `("Task 1","From today's meeting",false)`, `("Task 2","Mentioned in Slack",false)`, `("Task 3","Getting started",true)` (third checked/struck-through).
Final: "Take me to Omi" (white bg, black text, 280pt maxWidth) → `onComplete()` → `handleOnboardingComplete()`.

# 4. Permission steps — mechanics summary
5 types: `screen_recording` (4), `full_disk_access` (5), `microphone` (7), `accessibility` (8), `automation` (9), all via one reusable view.
- Request: `coordinator.requestPermission(type:appState:)` → `ChatToolExecutor.execute(ToolCall(name:"request_permission", arguments:["type":type]), isOnboardingSurface:true)`.
- Status: green "Granted" vs `textTertiary` "Not granted yet"/"Waiting for macOS..." — no distinct denied state (macOS can't reliably distinguish); relies on re-polling.
- Retry: the primary button IS the retry; screen recording gets the stale-permission warning banner (`requiresRestart: true` only there; no other UI branches on it).
- Auto-advance: all 5, 350ms after grant detected (poll + scenePhase + one-shot deep re-check for screen recording).

# 5. Sign-in (precedes onboarding)
`Desktop/Sources/SignInView.swift` (165 lines) — outside/before the step machine:
- Centered card: `herologo.png` 64x64, "omi" wordmark (48pt bold), "Sign in to continue" (title3, `textTertiary`).
- Two 320pt-wide white buttons, 50pt tall, cornerRadius 10:
  - "Sign in with Apple" — `applelogo` SF Symbol, `AuthService.shared.signInWithApple()`.
  - "Sign in with Google" — custom `GoogleLogo()` (`google_logo.png`), `AuthService.shared.signInWithGoogle()`, extra 1px gray-30% border.
- Loading: buttons disabled while `authState.isLoading`; circular `ProgressView` (tint `textPrimary`) + "Cancel" (`AuthService.shared.cancelSignIn()`).
- Error: `authState.error` via `UserFacingErrorPresentation.message(from:while: .signIn)`, `OmiColors.error`, caption. Cancellation silently swallowed.
- Apple/Google OAuth only — no email/password.

# 6. Completion
`OnboardingView.handleOnboardingComplete()` (`OnboardingView.swift:461-524`) — Tasks IS the last screen, no dedicated completion screen:
1. `AnalyticsManager.shared.onboardingCompleted()`.
2. Stops in-flight onboarding chat agent (`chatProvider.stopAgent(owner: .mainChat)`).
3. UserDefaults: `onboardingJustCompleted = true`; unless `AppBuild.usesLazyDevPermissions`, `hasCompletedFileIndexing = true`.
4. Saves post-onboarding prompt suggestions (`PostOnboardingPromptSuggestions.save`, from `OnboardingPromptSuggestionBuilder.build(from: introCoordinator)`).
5. Clears onboarding chat state: `chatProvider.isOnboarding = false`, `ChatToolExecutor.onboardingAppState = nil`, `OnboardingChatPersistence.clear()`, drafts cleared, bar AI draft → `.floatingMain`.
6. `onComplete?()` invoked if provided.
7. UI transition FIRST, deferred one tick: `DispatchQueue.main.async { appState.hasCompletedOnboarding = true }` — comment: "Setting this synchronously crashes in Button.body.getter, so defer it." Top-level `Group` swaps to `Color.clear` + starts monitoring + calls `onComplete()` again (`OnboardingView.swift:44-59`) — possible double-invoke, flag for port.
8. THEN non-blocking service starts: `AgentVMService.shared.startPipeline()`, `GoalGenerationService.shared.generateNow()`, Launch-at-Login enable, (unless lazy-dev) screen monitoring + transcription. Comment: "Transition UI FIRST — service failures must never block the UI."
9. Welcome task via `TasksStore.shared.createTask`: "Run omi for two days to start receiving helpful insights", due today, priority low, deduped via `ActionItemStorage.shared.actionItemExists(description:)`.

**Post-onboarding "try asking" surface** (`PostOnboardingPromptViews.swift`, 262 lines):
`OnboardingPromptSuggestionBuilder.build(from:)` (`OnboardingPromptSuggestions.swift:39-64`): always "What should I focus on today to achieve my goals?" first; conditional "What email follow-ups matter most today?" (email context), "Where can I find focus time this week?" (calendar), "Break my goal into the next 3 steps." (goal set); always appends "What on my screen matters most right now?" and "What's the highest-leverage thing I can do next?" — deduped, capped at 6.
`TryAskingPopupView` — full-screen modal (52%-black scrim, dismiss-on-tap-outside), card 560-660pt wide / 360-520pt tall, amber accent `Color(hex: 0xE3BF63)`, "Suggested first ask" pill with sparkles, headline "What would you like to ask omi first?" (32pt semibold SERIF), sub "Pick one and we'll run it through the floating bar with your real context.", suggestion buttons (sparkle + text + arrow-up-right), close (x) top-right.
`PromptSuggestionBanner` — inline banner: "Next step -> Ask omi" (20pt semibold serif), body "Use your real screen and your existing context to get value quickly. Tap to open a few suggested questions.", up to 3 compact pills (`compactLabel(for:)` shortens), dismissible, gradient bg (`backgroundSecondary`→`Color(hex: 0x22201C)`), amber corner glow blur.

# 7. Scaffold — colors/typography/spacing (`OnboardingStepScaffold.swift`, 460 lines; steps 0-9, 14-16)

**Layout modes:**
- `.split` (default): `HStack` — left pane 470-560pt (ideal 520) with header+progress+title+content in `ScrollView`, `Divider`, right pane `OnboardingSecondBrainPane` filling rest.
- `.centered`: full-width `VStack` — header, divider, centered `ScrollView` column maxWidth 560, padding 40h/36v. Steps 0 and 3.

**Header**: `HStack` — `OnboardingLogoMark` + `Spacer` + optional "Skip" (13pt medium, `textTertiary`, if `showsSkip && onSkip != nil`). Padding 24h/16v.
- `OnboardingLogoMark`: `omi_text_logo.png` template (52x18, white tint) or literal "omi" (18pt semibold). Hidden dev feature: `.onLongPressGesture(minimumDuration: 1)` → `onForceComplete?()` from ANY step.

**Progress dots** (`progressRow`): `HStack(spacing:8)` of `Capsule`s, one per `totalSteps` (13). Filled (`index <= stepIndex`) solid white; unfilled `Color.white.opacity(0.1)`. CURRENT dot wider (28pt vs 8pt); all 6pt tall.

**Title block**: `VStack(spacing:14)` —
- Eyebrow: 12pt semibold, `tracking(1.2)`, `.uppercased()`, `textTertiary`.
- Title: 40pt BOLD, `textPrimary`, 2pt line spacing.
- Description: 16pt regular, `textSecondary`, 4pt line spacing, maxWidth 460.
Alignment leading (split) / center (centered).

**Content wrapper:** outer `VStack(spacing:28)`, padding 40h/36v, content maxWidth 500 (split).

**Right pane** (`OnboardingSecondBrainPane`): `ZStack(alignment:.bottom)` over `backgroundSecondary`.
- `.graph` (default): live 3D `MemoryGraphSceneView` once nodes exist, floating `OnboardingGraphBrandMark` pill ("omi" template logo + ".me", black-28% rounded pill), bottom overlay "This is your 2nd brain" (15pt semibold white) + 3 hints: "Drag to rotate" (arrow.triangle.2.circlepath), "Scroll to zoom" (magnifyingglass), "Two-finger to pan" (hand.draw) — 11pt icon+label, 50% white. Placeholder before data: "Your graph appears once Omi has something real to map." (15pt medium, `textTertiary`, maxWidth 320).
- `.message(title, detail)`: reserved, unused by current steps (28pt bold title + 15pt `textTertiary` detail).
- Footer (`.graph`, when `rightPaneFooterText` set — DataSources/Exports): `Divider`, "Who you are" (12pt semibold, tracked 0.6, `textTertiary`), text (13pt, `textSecondary`, 3pt line spacing, max 4 lines), on `backgroundPrimary.opacity(0.92)`.

**Shared component styles:**
- `OnboardingCardButtonStyle(isPrimary:)`: 15pt semibold (black-on-white primary; `textPrimary`-on-`backgroundTertiary` secondary), 18h/12v padding, cornerRadius 14, secondary gets white-8% 1px stroke; press = opacity 0.92 + scale 0.985, `.easeOut(duration:0.12)`.
- `OnboardingInsightCard`: icon (16pt semibold, `textSecondary`) in 42x42 cornerRadius-14 chip (`backgroundQuaternary`), title 15pt semibold + detail 13pt `textTertiary` 3pt spacing, 18pt padding, card cornerRadius 20 `backgroundSecondary` + white-8% stroke. (Unused by current steps — legacy/reserved.)
- `OnboardingSelectableChip`: 14pt semibold, 16h/10v padding, `Capsule` — selected white fill/black text; unselected `backgroundSecondary`/`textSecondary` + white-8% stroke.

Colors are `OmiColors.*` from `OmiTheme` (backgroundPrimary/Secondary/Tertiary/Quaternary, textPrimary/Secondary/Tertiary/Quaternary, success, warning, error, purplePrimary). No raw hex except amber `0xE3BF63` and grays `0x22201C`/`0x4E4535` in `PostOnboardingPromptViews.swift`.

# 8. Animations

**`OnboardingLoadingAnimation.swift`** (95 lines, step 6 only) — `Canvas` in `TimelineView(.animation)`, 180x180pt:
- Center pulse: radial gradient circle (white 40%→0%), radius breathes `0.15 + 0.08 * sin(time * 1.8)` of outer radius (~3.5s period).
- Ring track: static full-circle stroke, white 12%, 3pt, radius = min(w,h)/2 - 20.
- Fill arc: from -90° sweeping to `-90 + progress*360`°, white→gray linear gradient, 3pt, round cap — fills on `progress`, doesn't rotate.
- 4 orbiting particles: angular speeds `[0.6, 0.9, 1.3, 1.7]` rad/s, offsets `i*π/2`, sizes `[4,3,3.5,2.5]`pt, opacities `[0.9,0.7,0.8,0.6]` — white dots with 3x-radius radial-gradient gray glows; orbit continuously regardless of progress.

**Transitions:** step-to-step is an instant cut (no transition modifier on the switch); per-element:
- Conditional Continue buttons (10-13, 17): `.move(edge: .bottom).combined(with: .opacity)`, `.easeInOut(duration: 0.3)` (step 12 uses `.move(edge: .trailing)` — inconsistency).
- Step 11 phase-2: `.opacity.combined(with: .move(edge: .bottom))` for the image; phase-1 hint plain `.opacity`.
- Step 17 glow: scale 1.0↔1.2, `.easeInOut(duration: 2).repeatForever(autoreverses: true)`.
- Step 17 task rows: staggered spring after 0.4s, `.spring(response: 0.5, dampingFraction: 0.8)`, asymmetric (insert: move-from-bottom+fade; removal: fade).
- Legacy `OnboardingNotificationStepView.swift` (dead — `hasRemovedNotificationPermissionStep` defaults true): bell pulsing glow, notification banner spring-slide from top after 0.6s, fires ONE real system notification, Continue 0.5s later.
- `OnboardingCardButtonStyle` press: opacity 0.92 + scale 0.985, `.easeOut(duration: 0.12)`.
- DataSources Continue: `.opacity.combined(with: .scale(scale: 0.95))`.

# Flagged ambiguities (decide, don't blind-port)
1. **Two onboarding UIs may coexist**: linear `OnboardingView` is live; `OnboardingChatView.swift` (2181 lines, AI-conversation-driven with own persistence/tools/quick-replies/Gmail-Calendar-exploration cards) is NOT referenced from the live switch — legacy, alternate entry point, or mid-migration. Grep wider repo for `OnboardingChatView(` call sites before deciding whether Windows spec includes it.
2. **`OnboardingNotificationStepView.swift`**, `OnboardingTrustPreviewCard`/`OnboardingPrivacySheet` (`OnboardingView.swift:534-857`) appear unreferenced — likely legacy, exclude from port unless confirmed live.
3. Step 14-16 pass `stepIndex` 14-16 vs `totalSteps: 13` — all 13 dots render filled, none is "current" (28pt). May be intentional "final stretch" visual or off-by-N; DECIDE for Windows rather than porting the bug.
