# Fork notes: git delta since baseline + Windows Settings/Onboarding inventory

Directive: read-only research, no file edits (git log/show only). Report git delta
for Settings/Onboarding since baseline commit, and inventory Windows' current
Settings tabs + Onboarding steps for later detailed comparison.

## Part 1 — Git delta since baseline (0d09ede61b76dc4a144d05809432bf220394ee3a → v0.12.72+12072-macos)

Baseline commit: `0d09ede61b` — 2026-07-09 22:15:11 UTC ("Update desktop changelog for v0.12.66").
Tag commit: `50d264c9447e1c56d5650560f09ee6cbaa494b1e` — 2026-07-12 10:47:10 UTC.
**Window is only ~2.5 days.** Full `desktop/macos` log in that window: 288 commits total,
but scoped to Settings/Onboarding paths only **32 commits**, and of those, essentially
none are a UI redesign — they're bug fixes to the task/proactive-assistant system that
got swept in because the path filter included `ProactiveAssistants/`.

**Conclusion: no Settings/Onboarding visual redesign happened in this window.** The
"recently overhauled" framing in the task brief refers to something further back in
history, predating this baseline — the baseline tag itself already reflects whatever
that overhaul produced. Treat the current tag's Settings/Onboarding code as a stable
snapshot to document as-is; do not go hunting further back for a redesign commit unless
told to.

Commits actually touching Settings/Onboarding files directly (excluding the
ProactiveAssistants business-logic sweep):
- `0394c024d`/`54104a98b` (2026-07-09) — desktop-e2e coverage gap closure (test-only)
- `72051e7ec` (2026-07-09) — "Persist macOS chat drafts": touches
  `Onboarding/OnboardingChatView.swift`, `OnboardingFloatingBarDemoView.swift`,
  `OnboardingView.swift`, `OnboardingVoiceDemoView.swift`,
  `OnboardingVoiceShortcutStepView.swift` — adds chat-draft persistence plumbing to
  onboarding's embedded chat, not a layout change.
- `23cad87cc` — scope home status cache by account (unrelated to Settings UI)
- `d403072df`/`76ebc6602` — PTT turn continuity fix (unrelated to Settings UI)
- `62488d3e8` (2026-07-11) — "gate main agent permission requests": touches
  `OnboardingChatView.swift`, `OnboardingPagedIntroCoordinator.swift`,
  `OnboardingView.swift` — backend permission-gating logic, not visual.
- `f8f5c837f` (2026-07-09) — "fix(desktop): route AI Chat settings keys through
  DefaultsKey" — internal refactor (UserDefaults key typing ratchet), zero UI change.
- `46e930357` (2026-07-10) — "fix(desktop): use typed onboarding defaults key" — same
  kind of internal refactor.
- `1cb6f0ee7` (2026-07-09) — "chore(desktop): add changelog for onboarding reset fix" —
  changelog fragment only.

None of these change section structure, add/remove a settings tab, or restructure an
onboarding step. Screenshots/behavior documented from current source should be treated
as accurate for the whole recent history, not just this tag.

## Part 2 — Windows Settings inventory

Root files: `src/renderer/src/pages/Settings.tsx` (page shell),
`src/renderer/src/components/settings/tabs.ts` (tab list/order/icons/labels).

Tab order (from `tabs.ts`, `SETTINGS_TABS` array), each maps 1:1 to a file in
`src/renderer/src/components/settings/tabs/`:

| # | id | Label | Icon (lucide) | File |
|---|----|-------|----------------|------|
| 1 | general | General | Settings | `GeneralTab.tsx` |
| 2 | memories | Memories | Brain | (no tab file found directly — check MemoriesTab or embedded) |
| 3 | agents | Agents | Bot | `AgentsTab.tsx` (+ `AgentsTab.test.tsx`) |
| 4 | transcription | Transcription | AudioLines | `TranscriptionTab.tsx` (+ test) |
| 5 | rewind | Rewind | History | `RewindTab.tsx` |
| 6 | privacy | Privacy | ShieldCheck | `PrivacyTab.tsx` |
| 7 | account | Account | CircleUserRound | `AccountTab.tsx` |
| 8 | plan-usage | Plan & Usage | CreditCard | `PlanUsageTab.tsx` |
| 9 | shortcuts | Shortcuts | Keyboard | `ShortcutsTab.tsx` (+ test) |
| 10 | advanced | Advanced | SlidersHorizontal | `AdvancedTab.tsx` (+ test) |
| 11 | about | About | Info | `AboutTab.tsx` (+ test) |

Other settings-adjacent files found: `IntegrationsTab.tsx` exists in
`components/settings/tabs/` but **is not in the `SETTINGS_TABS` array** — i.e. Windows
has an Integrations tab component that is currently unreferenced/unrouted (same
"built but not wired" pattern worth flagging — parent should verify by grepping
`IntegrationsTab` usage before writing this up as a finding). Billing sub-components
live under `components/settings/billing/`: `BillingCard.tsx`, `ChatUsageCard.tsx`,
`CurrentPlanCard.tsx`, `OverageCard.tsx`, `PlanGrid.tsx`, `TrialCard.tsx`,
`UsageBar.tsx`, `UsageLimitPopup.tsx`, `UsageLimitTriggerHost.tsx`. Shared UI:
`SettingRow.tsx`, `Toggle.tsx`, `SettingsTabPanel.tsx`, `SettingsTabRail.tsx`,
`SettingsSearchProvider.tsx` + `searchContext.ts` (search parity with Mac's sidebar
search). Nav helper: `src/renderer/src/lib/settingsNav.ts` (+ test).

**Confirms the task brief's note**: Windows DOES already have Plan & Usage,
Transcription, Shortcuts, and About as real tabs with dedicated files and tests — the
"parity pass" landed. Not yet independently verified against Mac's actual per-control
content (that's the detailed comparison, left to the parent/other agents).

**No explicit "Notifications" or "Floating Bar" tab on Windows** — Mac has both as
separate top-level sidebar sections (`.notifications`, `.floatingBar` in
`SettingsContentView.SettingsSection`). Windows' 11 tabs vs Mac's 11 visible sidebar
sections do NOT line up 1:1:
- Mac has: General, Rewind, Transcription, Notifications, Privacy, Account,
  Plan and Usage, Floating Bar, Shortcuts, Advanced, About (11, `AI Chat` hidden in
  prod).
- Windows has: General, Memories, Agents, Transcription, Rewind, Privacy, Account,
  Plan & Usage, Shortcuts, Advanced, About (11).
- Windows-only tabs vs Mac: **Memories**, **Agents** (Mac has no dedicated Memories or
  Agents settings tab — Mac's memory/task/insight/focus assistant settings cards exist
  in source as `SettingsContentView+Assistants.swift` but are **orphaned/dead code**,
  never called from `advancedSection`'s body — see below).
- Mac-only tabs vs Windows: **Notifications** (dedicated tab with frequency slider +
  focus/task/insight/memory notification toggles + daily summary), **Floating Bar**
  (Ask Omi bar show/hide, background style, draggable, typed-question voice answers,
  screen-sharing-in-chat, voice picker, voice speed slider). Windows likely folds
  floating-bar-equivalent settings into its General tab or elsewhere — needs
  confirmation by whoever reads `GeneralTab.tsx` in detail (out of this fork's scope).

**IMPORTANT correction to task brief assumption**: The task brief listed Mac section
names as "General, Transcription, Rewind, NotificationsPrivacy, ShortcutsSettings,
AccountBilling, Advanced, Assistants, DeveloperKeys, FloatingBarAndChat, Integrations"
— those are **Swift file names**, not all live UI sections. Confirmed by reading
`SettingsContentView.SettingsSection` enum directly
(`Desktop/Sources/MainWindow/Pages/SettingsPage.swift:325-337`): the only cases are
`general, rewind, transcription, notifications, privacy, account, planUsage, aiChat,
floatingBar, shortcuts, advanced, about`. There is **no `.integrations` case at all** —
`SettingsContentView+Integrations.swift` (Gmail Reader + Calendar Sync cards) defines
`gmailReaderSubsection` and `calendarSyncSubsection`, but grep confirms **neither is
called from anywhere else in the codebase** (`grep -rn "gmailReaderSubsection\|calendarSyncSubsection" Desktop/Sources/` only self-matches in the defining file). Same
dead-code status for `focusAssistantSubsection`, `taskAssistantSubsection`,
`insightAssistantSubsection`, `memoryAssistantSubsection`, `analysisThrottleSubsection`
in `SettingsContentView+Assistants.swift` — all defined, none called from
`advancedSection`'s body (`Sections/SettingsContentView+Advanced.swift:21-41` only
calls `aiSetupSubsection, profileAndStatsSubsection, resetOnboardingSubsection,
goalsSubsection, preferencesSubsection, troubleshootingSubsection,
developerKeysSubsection, devToolsSubsection`). The `AdvancedSubsection` enum
(`SettingsPage.swift:364-398`) still lists all of these as cases with icons, and
`SettingsSidebar.swift` defines a `SettingsSubsectionItem` view for subsection nav —
but `grep -rn "SettingsSubsectionItem("` finds **zero call sites**, so that
sub-navigation UI is never instantiated either. **Net effect: on the current Mac
build, Gmail Reader, Calendar Sync, and per-assistant (Focus/Task/Insight/Memory)
settings cards are fully implemented in source but unreachable in the running app —
no sidebar entry, no search result, no menu path renders them.** This is a real and
important divergence to call out in the main spec: Windows should NOT port these as
"missing features to add for parity" — Mac itself doesn't expose them today.

Confirmed reachable via `SettingsSearchItem.allSearchableItems` (searchable settings
list) has zero entries for `advanced.focusassistant`, `advanced.taskassistant`,
`advanced.insightassistant`, `advanced.memoryassistant`, `advanced.gmail.*`,
`advanced.calendar.*`, `advanced.analysisthrottle` — consistent with the dead-code
finding (search index and live UI agree).

## Part 3 — Windows Onboarding inventory

Files: `src/renderer/src/pages/Onboarding.tsx` (router/state machine, `TOTAL_STEPS`
constant not read here — check locally), step components in
`src/renderer/src/components/onboarding/`.

Step order (from `Onboarding.tsx` render-step switch, imports in file order,
confirmed by reading the `renderStep()` conditional chain around lines 122–241):

1. `NameStep`
2. `LanguageStep`
3. `HowDidYouHearStep`
4. `TrustStep`
5. `BackgroundPrivacyStep`
6. `ScreenPermissionStep`
7. `BuildProfileStep` (comment at line ~173 notes: "The old DiskAccessStep
   (button-driven file scan) is hidden; this ..." — i.e. Windows already replaced/hid
   a prior Disk-Access-style step in favor of BuildProfileStep — worth checking if this
   maps to Mac's `FullDiskAccess` + `FileScan` pair)
8. `MicPermissionStep`
9. `AutomationPermissionStep`
10. `ShortcutSetupStep`
11. `VoiceIntroStep`
12. `AskDemoStep`
13. `GoalStep`
14. `AutoCreatedTasksStep` (terminal step, calls `onFinish`, no numbered index)

That's 13 indexed steps (0–12) + 1 terminal = matches variable `TOTAL_STEPS` usage
(`clampOnboardingStep(getPreferences().onboardingStep, TOTAL_STEPS)`).

Other onboarding-related files not directly in the step chain: `DiskAccessStep.tsx`
(exists but the inline comment says it's currently hidden/superseded by
`BuildProfileStep` — dead-code-adjacent, same pattern as Mac's orphaned settings
subsections, worth flagging), `BrainMap.tsx` + `brainMapModel.ts` (background visual,
Windows' equivalent of Mac's `OnboardingPagedIntroCoordinator`/graph background),
`OrbitScanner.tsx` (likely the file-scan visual). `useOnboardingComplete.ts`,
`onboardingGraph.ts`/`onboardingGraphModel.ts` (knowledge-graph node builder — mirrors
Mac's `MemoryGraphViewModel`), `onboardingProgress.ts` (step-clamping helper, has a
test file).

## Mac onboarding — actual live flow (important correction vs my own earlier assumption)

`OnboardingFlow.steps` (`Desktop/Sources/Onboarding/OnboardingFlow.swift:4-23`) lists
**18 steps** (indices 0–17): Name, Language, HowDidYouHear, Trust, ScreenRecording,
FullDiskAccess, FileScan, Microphone, Accessibility, Automation,
FloatingBarShortcut, FloatingBar, VoiceShortcut, VoiceDemo, DataSources, Exports,
Goal, Tasks. `introStepCount = 13`.

**I initially assumed `OnboardingPagedIntroCoordinator` was a separate/legacy paged-UI
path distinct from a flat step router — that's wrong.** Reading
`Desktop/Sources/Onboarding/OnboardingView.swift` in full (857 lines) shows:
`OnboardingView` is the **single live router** — a flat `if currentStep == N { ... }`
chain (lines 122–457) mapping all 18 indices directly to their step view struct
(`OnboardingWelcomeStepView`, `OnboardingLanguageStepView`,
`OnboardingHowDidYouHearStepView`, `OnboardingTrustStepView`,
`OnboardingPermissionStepView` ×4 [ScreenRecording/FullDiskAccess-no wait, see below],
`OnboardingFileScanStepView`, `OnboardingFloatingBarShortcutStepView`,
`OnboardingFloatingBarDemoView`, `OnboardingVoiceShortcutStepView`,
`OnboardingVoiceDemoView`, `OnboardingDataSourcesStepView`,
`OnboardingExportsStepView`, `OnboardingGoalStepView`, `OnboardingTasksStepView`).
`OnboardingPagedIntroCoordinator` (`@StateObject private var introCoordinator`,
instantiated once in `OnboardingView`) is **not an alternate flow** — it's a shared
background/state coordinator object (drives the animated brain-map/graph background,
connected-sources summary, etc.) passed into most step views as a `coordinator:`
parameter. `hasMigratedPagedIntro` etc. are one-time migration flags for users who
onboarded under an even older step layout (pre-dating this coordinator's introduction)
— historical migration logic in `OnboardingFlow.migratedStep(...)`, not a live
alternate UI.

Exact copy for the 4 permission steps (all render via the same
`OnboardingPermissionStepView`, `OnboardingView.swift:171-324`):

| Step idx | permissionType | eyebrow | title | description | icon | reasonTitle | reasonDetail | primaryActionLabel | requiresRestart |
|---|---|---|---|---|---|---|---|---|---|
| 4 | screen_recording | Permission | "Let Omi read your screen." | "Screen Recording lets Omi see what you're working on." | display.and.arrow.down | Screen Recording | "Screen Recording lets Omi see what you're working on." | "Open Screen Recording settings" | true |
| 5 | full_disk_access | Access | "Let Omi scan your work." | "File access lets Omi map your projects and files." | externaldrive.fill.badge.person.crop | Disk Access | "This lets Omi scan your projects and recent files." | "Open Disk Access" | false |
| 7 | microphone | Permission | "Let Omi use your mic." | "Microphone lets Omi transcribe meetings." | mic.fill | Microphone | "This lets Omi transcribe meetings and voice notes." | "Grant microphone access" | false |
| 8 | accessibility | Permission | "Let Omi see the active app." | "Accessibility lets Omi know which app is active." | figure.wave | Accessibility | "This lets Omi know which app you are using." | "Open Accessibility settings" | false |
| 9 | automation | Permission | "Let Omi act when asked." | "Automation lets Omi take actions for you." | bolt.horizontal.circle.fill | Automation | "This lets Omi take actions when you ask." | "Grant automation access" | false |

Every step has an `onSkip` path except step 0 (Name — no skip shown in the snippet
read) and step 3 (Trust — no skip param passed either); all steps accept
`onForceComplete: handleOnboardingComplete` (an escape hatch, likely
keyboard-shortcut- or dev-triggered — worth the parent checking
`OnboardingStepScaffold.swift` for how `onForceComplete` gets invoked in the UI, I did
not get to that file).

`handleOnboardingComplete()` (`OnboardingView.swift:461-524`) on finish: marks
`onboardingJustCompleted`/`hasCompletedFileIndexing` in UserDefaults, saves prompt
suggestions from the coordinator, clears onboarding chat drafts/persistence, sets
`appState.hasCompletedOnboarding = true` (deferred via `DispatchQueue.main.async` —
comment notes doing it synchronously crashes in `Button.body.getter`), then
kicks off `AgentVMService.startPipeline()` + `GoalGenerationService.generateNow()`,
enables Launch-at-Login, and — unless `AppBuild.usesLazyDevPermissions` — starts
screen monitoring + transcription. Also silently creates a default "welcome" task:
description `"Run omi for two days to start receiving helpful insights"`, due now,
priority low (dedup-checked by exact description match first).

I did not get to fully reading `OnboardingStepScaffold.swift` (459 lines, the shared
layout chrome — progress bar, eyebrow/title typography, back/skip button placement)
or the individual step view files' own copy/layout beyond what's summarized above
(Welcome/Name, Language, HowDidYouHear, Trust, FileScan, FloatingBarShortcut,
FloatingBarDemo, VoiceShortcut, VoiceDemo, DataSources, Exports, Goal, Tasks) — the
parent/main session was mid-way through reading those individually when I was told to
report. Treat this fork's output as the routing skeleton + permission-step copy only;
the remaining step-by-step visual/copy detail still needs to be read from:
- `Desktop/Sources/Onboarding/OnboardingStepScaffold.swift` (shared chrome)
- `OnboardingWelcomeStepView.swift`, `OnboardingLanguageStepView.swift`,
  `OnboardingHowDidYouHearStepView.swift`, `OnboardingTrustStepView.swift`,
  `OnboardingFileScanStepView.swift`, `OnboardingFloatingBarShortcutStepView.swift`,
  `OnboardingFloatingBarDemoView.swift`, `OnboardingVoiceShortcutStepView.swift`,
  `OnboardingVoiceDemoView.swift`, `OnboardingDataSourcesStepView.swift`,
  `OnboardingExportsStepView.swift`, `OnboardingGoalStepView.swift`,
  `OnboardingTasksStepView.swift`

## Settings detail already read (for the parent's benefit, not asked for in Part 2 but
gathered while working — full detail, safe to reuse directly in the spec)

All under `Desktop/Sources/MainWindow/Pages/Settings/`:

- **Nav shell**: `SettingsSidebar.swift` — 260px wide sidebar, back button, "Settings"
  title (22pt bold), search field (magnifying glass icon, purple focus ring — NOTE:
  Mac's accent color throughout Settings is `OmiColors.purplePrimary = #8B5CF6`
  (`Desktop/Sources/Theme/OmiColors.swift:18`), which **directly conflicts with the
  Windows repo's own brand rule "Never use purple" (`INV-UI-1`,
  `docs/product/invariants/brand-ui.md`)** — this is the single most important
  divergence to flag in the final spec: Mac's Settings uses purple as its primary
  accent for icons, toggles, sliders, selected states, and buttons throughout every
  section; Windows must NOT copy this and needs a documented substitute accent.
  `SettingsSearchItem.allSearchableItems` is the full fuzzy-search index (~70 entries)
  — cross-reference this list against live sections; entries pointing at orphaned
  subsections (focus/task/insight/memory assistants, gmail, calendar) are absent,
  confirming the search index matches the *live* UI, not the enum's full case set.
- **Section header**: `SettingsPage.swift` — 28pt bold title above content, 32px
  horizontal/32px top/24px bottom padding, content area background
  `OmiColors.backgroundSecondary.opacity(0.3)`.
- **Card style** (`Components/SettingsContentView+Controls.swift:645-668`,
  `settingsCard()` helper): 20px padding, 12px corner radius,
  `backgroundTertiary.opacity(0.5)` fill, `backgroundQuaternary.opacity(0.3)` 1px
  stroke. Highlight-on-search-jump: purple `.opacity(0.12)` fill fade in/out over
  0.3s/0.5s via `SettingHighlightModifier`.
- **General tab** (`Sections/SettingsContentView+General.swift`): Screen Capture
  toggle (status dot + permission error text), Audio Recording toggle (status dot,
  "Waiting for a meeting…" state), System Audio picker (Always/Only during
  meetings/Never, macOS 14.4+ gated, extra caption when "only during meetings"),
  Notifications card (Enabled badge or Fix/Enable button + banner-disabled warning),
  Font Size (slider 0.5–2.0 step 0.05, live preview pangram, ⌘+/⌘-/⌘0 shortcut hints,
  Reset Window Size button).
- **Rewind tab**: Storage (frame count + bytes), Excluded Apps (list + Reset to
  Defaults + `AppRuleEditorView` add-row), Battery Optimization (info-only,
  "Automatic"), Data Retention picker (3/7/14/30 days).
- **Transcription tab**: Language Mode (Auto-Detect vs Single-Language radio cards,
  language list "English, Spanish, French, German, Hindi, Russian, Portuguese,
  Japanese, Italian, Dutch" for auto-detect; `SearchableDropdown` for single-language
  picker), Voice Assistant Languages (separate multi-select chip picker for PTT voice
  input — explicitly documented in-code as NOT touching the ambient transcriber
  language), Custom Vocabulary (tag chips + add field), Local VAD Gate toggle ("~40%"
  cost-saving copy).
- **Notifications tab**: master toggle + frequency stepped-slider (Off/Minimal/
  Low/Balanced/High/Maximum, 6 positions) + Focus/Task/Insight/Memory notification
  toggles (all live — these ARE wired, unlike the Advanced-tab assistant cards) +
  Daily Summary toggle + Summary Time hour picker.
- **Privacy tab**: Store Recordings toggle, Private Cloud Sync toggle, Encryption
  (static "Active" badge, Google Cloud copy), What We Track (expandable 10-item list),
  Privacy Guarantees (4 static bullets).
- **Account tab**: avatar-less person icon, name/email, Sign Out button, destructive
  Delete Account & Data (confirmation alert, full copy captured in file).
- **Plan and Usage tab**: trial countdown card (progress ring, color-coded by time
  remaining) OR trial-expired card; Current Plan card (title logic: Free / Free
  (BYOK) / Neo / Operator / Architect — Operator is wire-compat-mapped from backend
  `unlimited` plan type, distinguished by price-id match, see
  `Components/SettingsContentView+BillingHelpers.swift:45-78`); plan-retiring banner;
  plan picker grid (Operator green accent, Architect purple accent, horizontal
  scroll, promo code field, per-price checkout buttons); chat usage quota bar; overage
  card + explainer sheet; BYOK promo card linking to Advanced's Developer Keys.
- **Floating Bar tab**: show/hide toggle, background style (Transparent/Solid Dark
  segmented-looking toggle), Draggable toggle, Typed Questions (voice-answer) toggle,
  Screen Sharing in Chat toggle, Voice picker, Voice Speed stepped slider (0.8×–2.0×,
  6 steps: Slow/Normal/Fast/Faster/Very Fast/Maximum) — custom drag-gesture slider
  widget shared with Notifications frequency slider.
- **Shortcuts tab** (own file `ShortcutsSettingsSection.swift`, not
  `SettingsContentView+*`): Ask omi Shortcut (4 presets ⌘O/⌘↩/⌘⇧↩/⌘J + Custom capture +
  Disable, default ⌘O), Push to Talk (4 presets: Option hold [default], Right-⌘ hold,
  Fn hold, Control hold + Custom + Disable), Double-tap for Locked Mode toggle
  (default ON), Push-to-Talk Sounds toggle (default ON), Mute Audio While Talking
  toggle (default ON). A `referenceCard` computed var exists (static shortcut-list
  summary) but is **never called from `body`** — dead code, do not port.
- **Advanced tab** (`Sections/SettingsContentView+Advanced.swift` +
  `+Assistants.swift` + `+DeveloperKeys.swift`): category-header pattern (icon + 18pt
  title), sections **actually rendered**: AI Setup (Voice Model picker, AI Provider
  picker + Claude-connection status, Workspace folder picker, Browser Extension
  toggle+token flow, Dev Mode toggle), Profile & Stats (collapsed by default, "Show"
  reveals AI User Profile [generate/regenerate/edit/delete, monospace text] + Your
  Stats [9 stat rows]), Reset Onboarding (destructive, scoped to "this app build
  only"), Goals (Auto-Generate Goals toggle), Preferences (Multiple Chat Sessions
  toggle, "Use old Home design" toggle — checkbox style not switch, Launch at Login
  toggle), Troubleshooting (Report Issue → FeedbackWindow, Rescan Files →
  confirmation alert), Developer API Keys (BYOK status banner + 4 SecureField key
  inputs [OpenAI/Anthropic/Gemini/Deepgram] + per-key validity badge + Clear All),
  Dev Tools (Chat Prompt Lab launcher — likely dev-build-only, not gated in visible
  code but worth checking `AppBuild` elsewhere). **`featureTiersSubsection` (Feature
  Tiers picker, tiers 0–6) is defined but never called — dead code, do not port.**
- **About tab** (`Components/SettingsContentView+Controls.swift:375-625`): app icon +
  "omi" wordmark + channel label + version/build (selectable text), link rows (What's
  New / Visit Website / Help Center / Privacy Policy [in-app nav, not external] /
  Terms of Service), Software Updates card (Check Now button, last-checked relative
  time, failure banner w/ Open Applications + Download Latest + Dismiss actions,
  Automatic Updates toggle, Auto-Install Updates toggle [only shown when auto-check
  on], managed/dev-build explainer text, Update Channel picker [stable/beta] with a
  downgrade-confirmation alert when beta→stable would be a version downgrade), Report
  an Issue card.
- **AI Chat tab**: exists in code (`aiChatSection`,
  `Sections/SettingsContentView+FloatingBarAndChat.swift:155-740`) but **hidden in
  production bundles** — `SettingsPage.swift:527-530,552-556`: `if
  AppBuild.isProductionBundle && selectedSection == .aiChat { selectedSection =
  .advanced }` on appear AND on section-change. Content: AI Provider picker
  (duplicate of Advanced's AI Setup card), Ask Mode toggle (Ask/Act restriction — NOT
  present anywhere in the production-visible Advanced tab, so in production this
  setting is **completely unreachable via UI**), Workspace (duplicate), CLAUDE.md
  card (global + project-level, view/toggle each, also prod-unreachable), Skills card
  (discovered-skills list, search, per-skill enable checkbox + View sheet, also
  prod-unreachable), Browser Extension (duplicate), Dev Mode (duplicate, with extra
  descriptive bullets not shown in the Advanced-tab version).
- **Colors** (`Desktop/Sources/Theme/OmiColors.swift`): backgroundPrimary #0F0F0F,
  backgroundSecondary #1A1A1A, backgroundTertiary #252525, backgroundQuaternary
  #35343B, backgroundRaised #1F1F25, border #3A3940, purplePrimary #8B5CF6 (main
  accent — see purple-conflict note above), purpleSecondary #A855F7, purpleAccent
  #7C3AED, purpleLight #D946EF, textPrimary #FFFFFF, textSecondary #E5E5E5,
  textTertiary #B0B0B0, textQuaternary #888888, success #10B981, warning #F59E0B,
  error #EF4444, info #3B82F6.

## Not yet covered by this fork (left for the parent / other forks)

- Full onboarding step-by-step copy/layout beyond the permission-step table above.
- `OnboardingStepScaffold.swift` shared chrome details.
- Permission-state UI variants (granted/denied/needs-restart rendering) beyond what's
  visible in `OnboardingPermissionStepView` usage sites — the view file itself
  (203 lines) was not read.
- Update-UI states beyond the About tab card described above (e.g. in-progress
  download/install states, if any exist beyond Check Now / failure banner).
- Detailed Windows tab-by-tab control inventory (only top-level tab list + file paths
  gathered here; no line-level reading of Windows tab components was done).
