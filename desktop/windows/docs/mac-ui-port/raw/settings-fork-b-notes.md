# Settings deep-dive (fork B) — Account/Billing, Advanced, Assistants, Developer Keys, Floating Bar/Chat, Integrations, Controls/design-system, About/Updates

Source of truth: `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos` at tag `v0.12.72+12072-macos` (HEAD `50d264c9447e`). All paths below relative to `Desktop/Sources/`. Read-only research; every claim cites file:line in that tree.

---

## 1. Design-system tokens (base components everything reuses)

### 1.1 Colors — `Theme/OmiColors.swift:8-52` (single dark theme; NO light theme exists)

| Token | Hex |
|---|---|
| `backgroundPrimary` | `#0F0F0F` |
| `backgroundSecondary` | `#1A1A1A` |
| `backgroundTertiary` | `#252525` |
| `backgroundQuaternary` | `#35343B` |
| `backgroundRaised` | `#1F1F25` |
| `border` | `#3A3940` |
| `purplePrimary` | `#8B5CF6` |
| `purpleSecondary` | `#A855F7` |
| `purpleAccent` | `#7C3AED` |
| `purpleLight` | `#D946EF` |
| `textPrimary` | `#FFFFFF` |
| `textSecondary` | `#E5E5E5` |
| `textTertiary` | `#B0B0B0` |
| `textQuaternary` | `#888888` |
| `success` | `#10B981` |
| `warning` | `#F59E0B` |
| `error` | `#EF4444` |
| `info` | `#3B82F6` |
| `userBubble` | `#43389F` |

**⚠️ PORT FLAG — purple vs INV-UI-1.** `OmiColors.purplePrimary` (#8B5CF6) is the pervasive accent in every Mac Settings pane (toggle tints, slider fills, selected states, plan-card accent, icons, search-focus border, highlight overlay). This contradicts the repo brand invariant `INV-UI-1` ("Never use purple", no-increase ratchet, `docs/product/invariants/brand-ui.md`). The Mac reference at this tag is NOT compliant with the invariant. Recommendation: do NOT port purple 1:1 to Windows — substitute the white/neutral accent per INV-UI-1 and flag to the parity/audit team. All "purplePrimary" mentions below are cited as observed on Mac, not as the target Windows color.

### 1.2 Typography — `Theme/OmiFont.swift:39-88`

- SF system font only, via `.scaledFont(size:weight:design:)` — a ViewModifier multiplying point size by global `fontScale` (`FontScaleSettings.shared`, UserDefaults key `"fontScale"`, default `1.0`; user-adjustable in General → Font Size; `resetToDefault()` → 1.0).
- Variants: `scaledMonospacedDigitFont` (numeric stats), `scaledMonospacedFont` (key caps, tokens).
- Common scale in Settings: page section header 28 bold (`SettingsPage.swift:21`), sidebar title 22 bold, category header 18 semibold, card title 15-16 semibold/medium, row title 14 regular, subtitle/caption 12-13 regular, fine print 11, badges 9-11.
- `resetWindowToDefaultSize()` (`OmiFont.swift:92-101`): default main-window size 1200×800, animated recenter.

### 1.3 Base card + row components — `MainWindow/Pages/Settings/Components/SettingsContentView+Controls.swift`

- **`settingsCard(settingId:content:)`** (:645-668) — universal container: content `.frame(maxWidth: .infinity, alignment: .leading)`, `padding(20)`, background `RoundedRectangle(cornerRadius: 12)` filled `backgroundTertiary.opacity(0.5)`, overlay stroke `backgroundQuaternary.opacity(0.3)` width 1. Optional `settingId` attaches `SettingHighlightModifier`.
- **`settingRow(title:subtitle:settingId:control:)`** (:670-696) — HStack: VStack(spacing 2) of title (14, textSecondary) + subtitle (12, textTertiary), Spacer, trailing control.
- **`linkRow(title:url:)`** (:698-717) — title 14 textSecondary, trailing `arrow.up.right` 12 textTertiary; opens URL via NSWorkspace.
- **`SettingHighlightModifier`** (`MainWindow/SettingsSidebar.swift:661-685`) — search/deep-link highlight: overlay `RoundedRectangle(cornerRadius: 8)` fill purplePrimary.opacity(0.12), easeInOut 0.3s in; auto-clears after 1.5s with 0.5s easeInOut fade-out. View gets `.id(settingId)` for ScrollViewReader targeting.
- **Scroll-to-highlight** (`SettingsPage.swift:45-52`): on `highlightedSettingId` change, after 0.2s delay, `proxy.scrollTo(id, anchor: .center)` with easeInOut 0.3s.
- Page chrome (`SettingsPage.swift:14-58`): ScrollView; header = section rawValue 28 bold, padding h32/top32/bottom24; content `SettingsContentView` padded h32; page background `backgroundSecondary.opacity(0.3)`. Section switch animates `.transition(.opacity)` easeInOut 0.15s (both header and body, `SettingsPage.swift:24-25`, `:523-525`).

### 1.4 Custom stepped slider (voice speed + notification frequency) — Controls.swift:17-110 and :116-206

Fully custom (NOT native `Slider`): GeometryReader; track = RoundedRectangle(cornerRadius 4) height 6, fill backgroundQuaternary; filled portion purplePrimary; step dots 8×8 circles (purple if ≤ current index else backgroundQuaternary); thumb = 22×22 white circle, shadow black 25% radius 3 y1, DragGesture(minimumDistance 0) snapping to nearest step. Below: "Slow"/"Max" (voice) or first/last option labels (frequency), 11pt textTertiary.
- Voice speed header row: current label (`ShortcutSettings.voiceSpeedLabel`) 16 semibold + "Voice playback speed" 13 textSecondary; right readout "N.N×" 22 bold rounded design, purplePrimary, in 52×52 rounded-rect(12) purple.opacity(0.15). Steps = `ShortcutSettings.voiceSpeedSteps`; binds `shortcutSettings.voicePlaybackSpeed`.
- Notification frequency: 6 steps `(0 Off, 1 Minimal, 2 Low, 3 Balanced, 4 High, 5 Maximum)` (`SettingsPage.swift:269-276`); header "Frequency" 14 textSecondary + "How often to receive notifications" 12 textTertiary; current-label pill 13 semibold purple on purple.opacity(0.15) rounded 8, padding h10/v4. Writes `notificationFrequency` and calls `updateNotificationSettings(frequency:)`. Not wrapped in its own card (lives inside the Notifications card).

### 1.5 Misc shared helpers (Controls.swift)

- `tierPickerRow` (:208-238): radio row — `largecircle.fill.circle`/`circle` 16pt (purple when selected), label 14 (medium when selected), subtitle 12 textTertiary; selected bg purple.opacity(0.1) rounded 8; taps `TierManager.shared.userDidSetTier(tier)`.
- `tierFeatureRow` (:240-285): "Tier N" chip 11 semibold (purple on purple.opacity(0.15) when unlocked, textTertiary on backgroundTertiary when locked), name 14 medium, trailing `checkmark.circle.fill` green / `lock.fill` textTertiary; requirement 12 textTertiary + progress "(x / y)" monospaced-digit.
- `statRow(label:value:)` (:287-299): label 14 textSecondary · value monospaced-digit 14 medium textPrimary (decimal-formatted). `statRowLoading` = same with `ProgressView().controlSize(.mini)`.
- `fontShortcutRow(label:keys:)` (:629-643): keys in monospaced 13 medium on backgroundTertiary.opacity(0.8), rounded 5, padding h8/v3.
- `trackingItem(_:)` (:719-729): 4×4 dot textTertiary.opacity(0.5) + text 12 textTertiary. `privacyBullet(_:)` (:731-741): green bold checkmark 9 + text 12 textSecondary.
- `privacyToggleRow(icon:title:subtitle:isOn:onChange:)` (:743-779): icon 14 purple width 20, title 14 medium, subtitle 12 textTertiary, small switch toggle.

---

## 2. Settings navigation (ground truth) — `MainWindow/SettingsSidebar.swift`, `MainWindow/Pages/SettingsPage.swift`

### 2.1 Sections

`SettingsContentView.SettingsSection` enum (`SettingsPage.swift:325-362`), rawValues are the display titles. `visibleSections` (`SettingsSidebar.swift:334-346`) — sidebar order:

1. **General** — icon `gearshape`
2. **Rewind** — `clock.arrow.circlepath`
3. **Transcription** — `waveform`
4. **Notifications** — `bell`
5. **Privacy** — `lock.shield`
6. **Account** — `person.circle`
7. **Plan and Usage** — `creditcard`
8. **Floating Bar** — `sparkles`
9. **Shortcuts** — `keyboard`
10. **Advanced** — `chart.bar`
11. **About** — `info.circle`

`aiChat` ("AI Chat", icon `cpu`) exists in the enum but is hidden: `SettingsSidebarItem` renders `EmptyView()` for it (`SettingsSidebar.swift:536-537`) and production bundles force-redirect `.aiChat` → `.advanced` (`SettingsPage.swift:528-530, 553-556`).

`SettingsSection.automationMatch(_:)` (`SettingsPage.swift:346-361`): tolerant name resolution for the omi-ctl automation bridge (case/spacing/hyphen/underscore-insensitive, also matches Swift case names like `planUsage`).

### 2.2 Sidebar chrome (`SettingsSidebar.swift:322-506`)

- Fixed width 260 (`expandedWidth`), background `backgroundPrimary`.
- Top: **Back** button (chevron.left 14 semibold + "Back" 14 medium, textSecondary; hover bg backgroundTertiary.opacity(0.5) rounded 8), padding top 12 / h16.
- "Settings" title 22 bold textPrimary, h16, bottom 12.
- **Search field**: magnifyingglass 13 (purplePrimary when focused else textTertiary, animated 0.15s), placeholder "Search settings...", plain TextField 13, clear `xmark.circle.fill` button; container padding h10/v8, rounded 8 fill backgroundTertiary, focus stroke purplePrimary.opacity(0.5) w1.
- Item rows (`SettingsSidebarItem` :509-570): icon 17 (textPrimary selected / textTertiary), label 14 (medium selected / regular, textPrimary selected / textSecondary), padding h12/v11, rounded 10 fill backgroundTertiary.opacity(0.8) selected / .opacity(0.5) hover / clear. Section select animates easeInOut 0.15s.
- Search results (`SettingsSearchResultRow` :618-657): icon 14 textTertiary w20, name 13 medium textPrimary, breadcrumb (= section rawValue) 11 textTertiary; hover bg backgroundTertiary.opacity(0.5) rounded 8. Empty query state: "No results" 13 textTertiary. Selecting a result: switch section (easeInOut 0.15s), clear query, then after 0.25s set `highlightedSettingId` → scroll+flash.

### 2.3 Search index

`SettingsSearchItem.allSearchableItems` (`SettingsSidebar.swift:19-319`) — ~60 hardcoded entries (name, subtitle, keywords[], target section, icon, settingId). Matching: query split on whitespace, ALL words must match name OR subtitle OR any keyword (case-insensitive contains) (`SettingsSidebar.swift:348-361`). Full list of settingIds referenced: general.rewind, general.systemaudio, general.notifications, general.askomi, general.fontsize, general.resetwindow, rewind.rewind, rewind.screencapture, rewind.audiorecording, rewind.storage, rewind.excludedapps, rewind.battery, rewind.retention, transcription.settings, transcription.languagemode, transcription.voicelanguages, transcription.vocabulary, transcription.vadgate, notifications.settings, notifications.frequency, notifications.focus, notifications.task, notifications.insight, notifications.memory, notifications.dailysummary, notifications.summarytime, privacy.privacy, privacy.storerecordings, privacy.cloudsync, privacy.encryption, privacy.tracking, account.account, account.signout, planusage.overview, planusage.current, planusage.purchase, about.updates, about.autoupdates, about.autoinstall, about.channel, about.version, about.reportissue, advanced.resetonboarding, advanced.aiuserprofile, advanced.stats, aichat.provider, aichat.workspace, aichat.browserextension, aichat.devmode, advanced.goals, advanced.goals.autogenerate, floatingbar.show, floatingbar.background, floatingbar.draggable, floatingbar.typedvoiceanswers, floatingbar.screenshare, floatingbar.voicespeed, floatingbar.shortcut, floatingbar.ptt, floatingbar.doubletap, floatingbar.pttsounds, advanced.preferences.multichat, advanced.preferences.launchatlogin, advanced.troubleshooting.reportissue, advanced.troubleshooting.rescanfiles.

### 2.4 Page-level state & lifecycle (`SettingsPage.swift:115-609`)

- `SettingsContentView` holds ALL pane state (@State/@AppStorage) — see per-pane bindings below.
- `onAppear` (:527-542): `loadBackendSettings()`, `loadSubscriptionInfo()`, sync `isTranscribing` from appState, `showAskOmiBar = FloatingControlBarManager.shared.isEnabled`, reload playwright token, `chatProvider?.checkClaudeConnectionStatus()`, `appState.checkNotificationPermission()`.
- `onChange(selectedSection == .planUsage)` (:557-565): refetch subscription + trial metadata + `FloatingBarUsageLimiter.fetchPlan()` (guards against stale previous-account trial/quota UI).
- NotificationCenter listeners: `.assistantMonitoringStateDidChange` → isMonitoring; `.navigateToTaskSettings` → Advanced + highlight `advanced.taskassistant`; `.navigateToFloatingBarSettings` → Floating Bar; `didBecomeActiveNotification` → re-check notification permission (permission may have changed in System Settings).
- Sheets at page level: `activeBillingWebFlow` (Stripe checkout), `showBrowserSetup` (BrowserExtensionSetup).
- Option constants (:265-276): `cooldownOptions = [1,2,5,10,15,30,60]` min; `analysisDelayOptions = [0,10,20,30,60,300]` s; `extractionIntervalOptions = [10, 600, 3600]` s; `hourOptions = 0...23`; `frequencyOptions` 0-5 as above.
- `loadBackendSettings()` (`Components/SettingsContentView+BillingHelpers.swift:719-807`): loads local AssistantSettings first (language, autoDetect, vocabulary, vadGate, systemAudioCaptureMode), then parallel backend fetches: dailySummary, notifications, userLanguage, recordingPermission, privateCloudSync, transcription prefs + `SettingsSyncManager.syncFromServer()`. Mirrors notification enabled/frequency into UserDefaults (`NotificationService.masterEnabledDefaultsKey` / `.frequencyDefaultsKey`). Vocabulary hydration is revision-guarded so an in-flight GET can't clobber a newer local PATCH (:771-778). Backend language is source of truth; auto-detect derived as `!singleLanguageMode && supportsAutoDetect(lang)`.

---

## 3. Account section — `Sections/SettingsContentView+AccountBilling.swift:8-123`

Single card `account.account`:
- Profile row: `person.circle.fill` 40pt textTertiary (no avatar image); `AuthService.shared.displayName` (fallback literal "User") 16 semibold; `AuthState.shared.userEmail` 13 textTertiary. Trailing **"Sign Out"** `.bordered` (disabled while deleting) → `appState.stopTranscription()`, `ProactiveAssistantsPlugin.shared.stopMonitoring()`, `AuthService.shared.signOut()` (:31-37).
- Divider (overlay backgroundQuaternary).
- **Delete Account & Data** row: title 15 semibold in `OmiColors.error`; caption "Permanently deletes server data, clears local data for this account, resets onboarding, and signs you out." 13 textTertiary. Trailing **"Delete"** `.borderedProminent` tint error (spinner while `isDeletingAccount`).
- Alert (:82-93): title **"Delete Account and Data?"**; buttons "Cancel" (cancel role, fires `deleteAccountCancelled` analytics) / **"Delete Permanently"** (destructive); message: "This cannot be undone. Your account, chat history, and all server data will be permanently deleted. Local data for this account will be cleared and you'll return to onboarding."
- Error text (deleteAccountError) 12 warning below.
- `deleteAccountAndData()` (`Components/SettingsContentView+SettingsUpdates.swift:110-138`): `APIClient.deleteAccount()` → stop transcription/monitoring → signOut; failure copy "Your account was deleted, but Omi couldn't sign you out. Quit and reopen Omi."
- Lines 95-121: commented-out "Upgrade to Pro" card (bolt icon, omi.me/pricing) — dead code, not rendered.

---

## 4. Plan and Usage section — `Sections/SettingsContentView+AccountBilling.swift:125-660` + `Components/SettingsContentView+BillingHelpers.swift` + `Components/BillingWebFlow.swift`

`planUsageSection` (:258-392) card order: trialCountdownCard → current-plan card → deprecation banner → purchase card → chatUsageQuotaCard → overageCard → byokPromoCard. Sheet: `overageExplainerSheet`.

### 4.1 Trial countdown card (:127-212)

- Shown if `appState.trialMetadata.trialStartedAt != nil && !trialExpired` → settingId `planusage.trial`:
  - `clock.fill` 28pt colored by `trialTimeColor` (:245-249): ≤3600s → warning; ≤24h → `.yellow`; else success.
  - "Premium Trial Active" 16 semibold; countdown 13 in same urgency color — `trialCountdownText` (:230-243): "Expired" / "Nd Nh remaining" / "Nh Nm remaining" / "Nm remaining".
  - Right: progress ring 32×32, stroke 3 (track backgroundQuaternary; progress = remaining/duration, rotated -90°, round cap).
  - Divider; "Included in your trial" 12 semibold textTertiary; 3 `trialFeatureRow`s (:214-228 — 18×18 purple.opacity(0.16) circle + purple checkmark 9 bold; text 13 medium textSecondary): "Unlimited listening & transcription", "Unlimited memories & insights", "Chat questions".
- Expired variant → settingId `planusage.trial-expired`: `exclamationmark.circle.fill` 28 warning; "Trial Ended" 16 semibold; "Upgrade to keep unlimited access" 13 textSecondary; divider; **"View Plans"** `.borderedProminent` tint purplePrimary → `selectedPlanIdForCheckout = "operator"`.

### 4.2 Current plan card (settingId `planusage.current`, :262-320)

- `creditcard.fill` 28 purplePrimary; `currentPlanTitle` 16 semibold; `currentPlanSubtitle` 13 textTertiary.
- Trailing: `ProgressView` small while `isLoadingSubscription`; **"Manage"** `.bordered` (spinner while opening) if `hasPaidSubscription` → `openCustomerPortal()`; else **"Refresh"** `.bordered` → `loadSubscriptionInfo()`.
- If `currentPlanPeriodText` (BillingHelpers :110-119): divider + "Renews on {medium date}" or "Access ends on {date}" (when `cancelAtPeriodEnd`) 12 textSecondary.
- `subscriptionError` 12 warning if set.

Plan title mapping (BillingHelpers :35-78): no sub → "Free" (or "Loading plan..."); `features` contains "byok" → **"Free (BYOK)"**; `.basic` → "Free"; `.unlimited` → **"Neo"** unless current Stripe priceId matches an Operator-titled catalog plan → **"Operator"** (wire-compat: backend serializes Operator as plan="unlimited" for old mobile builds, `isCurrentSubscriptionOperator()` :67-78); `.architect`/`.pro` → "Architect"; `.operator` → "Operator".
Subtitle (:80-91): loading → "Fetching subscription details from omi."; else `currentPlanBillingDetail` = "{Plan} {Monthly|Annual} • {priceString}" (:93-108); else "Your paid plan is active." / "You are currently on the free tier."
`hasPaidSubscription` (:8-12): plan != .basic && status == .active && NOT byok.

### 4.3 Deprecation banner (settingId `planusage.deprecation`, :322-356)

Only when `subscription.deprecated == true`: warning triangle 16 + "Plan Retiring" 14 semibold; message = `deprecationMessage` ?? "Your Unlimited plan is being retired. Try the new Operator plan — same great features at $49/mo."; **"Try Operator"** `.borderedProminent` tint success → selects operator for checkout.

### 4.4 Choose-a-plan card (settingId `planusage.purchase`, :358-381)

Header "Choose a plan" 15 semibold + "Pick one plan first. Billing options appear only after the card is selected." 12 textTertiary. Horizontal ScrollView (no indicators) of `subscriptionPlanCard(plan)` each `minWidth 220`, spacing 14. `subscriptionPlansForDisplay` (BillingHelpers :18-33): mergedPlanCatalog minus current plan, ordered unlimited(Neo) 0 → operator 1 → architect 2.

Plan catalog (BillingHelpers :206-298): merge of server `availablePlans` over `fallbackPlanCatalog` (built from `getAvailablePlans()` price list via `planCatalog(from:)`, grouping prices by title-keyword → plan id: "unlimited|neo"→unlimited(title "Neo"), "operator"→Operator, "architect|pro"→Architect; price title from interval: contains "year" → "Annual" else "Monthly"). Merger `SubscriptionPlanCatalogMerger` (`SettingsPage.swift:61-112`) — primary wins field-by-field, prices merged by id.

Copy tables:
- `planEyebrow` (:156-167): unlimited → "Starter"; operator → "Most popular"; architect → "Automation + coding"; default "Plan".
- `planSubtitle` (:121-132): unlimited → "200 questions per month"; operator → "500 questions per month"; architect → "Power-user AI — thousands of chats + agentic automations".
- `planDescription` (:169-180): unlimited → "100 chat questions per month. Shared with mobile and web."; operator → "500 chat questions per month. Shared with mobile and web."; architect → "Power-user AI for heavy agentic workflows and vibe coding." (NB unlimited subtitle says 200 but description says 100 — verbatim inconsistency in source.)
- `fallbackFeatures` (:217-243): architect = ["Automations and vibe coding", "Unlimited listening, memories, and insights", "Priority desktop AI features", "~$400 of monthly AI compute included (fair-use cap)"]; operator = ["500 chat questions per month", "Unlimited listening and transcription", "Unlimited memories and insights", "Shared with mobile and web"]; unlimited = ["200 chat questions per month", + same 3].
- `planAccentColor` (:134-138): architect → purplePrimary; others → success (green).

### 4.5 subscriptionPlanCard (BillingHelpers :300-493)

Layout: padding 20; bg RoundedRectangle(18) fill accent.opacity(0.12) when selected else backgroundPrimary.opacity(0.68); stroke accent.opacity(0.85) w1.5 selected else backgroundQuaternary w1. Tap selects (`selectedPlanIdForCheckout = plan.id`) if purchasable.
- Header: eyebrow UPPERCASED 10 bold accent tracking 0.8; title 18 bold; subtitle 12 textTertiary. Right: `planSummaryText` (starting price string) 17 bold (accent when selected), minScaleFactor 0.72; "starting price" 10 medium.
- Description 13 textSecondary; up to 4 feature rows (18×18 accent.opacity(0.16) circle + accent check 9 bold; text 13 medium textSecondary).
- If selected && canPurchase: divider; **Promo code** disclosure (tag icon 12 + "Promo code" 12 + chevron up/down 10, textTertiary; expands with `.easeInOut(duration: 0.2)`, transition opacity+move-top) revealing TextField "Enter promo code" (roundedBorder, 13; disabled during checkout; typing clears `subscriptionError`) + inline error (exclamation 11 + msg 11 warning). "Choose billing" 12 semibold textTertiary; billing buttons per sorted price (monthly first): `.borderedProminent` tint accent, VStack of price.title 12 bold + priceString 11 white.opacity(0.92), padding v10, spinner replaces content while `activeCheckoutPriceId == price.id`; all disabled while any checkout in flight.
- Else if isCurrentPlan: "Current Plan" 12 bold + `checkmark.circle.fill` 12, accent, padding v10.
- Else: **"Select {plan.title}"** 12 bold + arrow.right 11 bold, `.borderedProminent` tint accent.
- Downgrade guard: Architect/pro users cannot buy "unlimited" (`isDowngrade`, :305-309).

### 4.6 Checkout + portal flows (BillingHelpers :919-1163)

- `startCheckout(priceId)`: existing active paid non-cancelling sub → `APIClient.upgradeSubscription(priceId:promotionCode:)` (scheduled change, no web flow; errors surface `apiError.detail` or "Failed to schedule plan change."). Otherwise `createCheckoutSession` → status "reactivated" refreshes immediately; else opens **BillingWebFlowSheet** with `title: "Complete Your Upgrade"`, completionURLs `{base}/v1/payments/success|cancel`. Errors: `apiError.detail` ?? "Failed to open checkout." / "Could not start checkout."
- `BillingWebFlowSheet` (`Components/BillingWebFlow.swift:18-48`): header bar (title 18 semibold, "Close" plain button textSecondary, padding h20/v16, bg backgroundTertiary), divider, WKWebView min 860×680, page bg backgroundPrimary. Navigation-delegate matches completion URLs (scheme+host+path, query-tolerant); path ending "cancel" → `.cancelled` else `.completed` (:82-115). Popup (`targetFrame == nil`) loads in same web view (:117-127).
- Completion (:1049-1063): `.completed` → `completeLocalTestSubscriptionIfNeeded()` (local-dev shortcut hitting `v1/payments/success?session_id=` on local python or `test/complete-subscription` on local rust, :1112-1159) then `pollForUpdatedSubscription()` — 8 attempts × 1s; success applies refresh; exhaustion copy: "Payment completed, but plan refresh is still catching up. Please try reloading this page in a moment." / "Payment completed, but subscription refresh failed."
- `applySuccessfulSubscriptionRefresh` (:897-917): updates state, pushes plan into `FloatingBarUsageLimiter`, clears sticky `AppState.isPaywalled`.
- `openCustomerPortal` (:1017-1047): `createCustomerPortalSession` → open URL in default browser; info line "Billing portal opened in your browser."; failures "Could not open billing portal." / "Failed to open billing portal."

### 4.7 Chat usage quota card (AccountBilling :560-660, settingId `planusage.current`)

If `chatUsageQuota` present: "Usage this month" 14 semibold; right value 13 medium monospacedDigit colored `chatUsageBarColor` (:656-660 — warning when !allowed or ≥80%, else purplePrimary). Value format (:625-633): unit "cost_usd" → "$%.2f / $%.0f" (limit "—" if nil); else "used / limit" (limit "∞" if nil). Linear ProgressView height 6 tinted same. Below: description "Chat spend on {plan} plan" / "Chat questions on {plan} plan" (:635-640) + reset text "Resets today|tomorrow|in N days" (:642-654). Warnings: over-cap on overage plan → "You're past your included limit — extra usage is billed as overage at end of cycle."; hard-capped → "You've reached this month's limit. Upgrade your plan or wait until the next reset."; ≥80% → "You're close to your monthly limit." (12 warning).
Loading state: spinner + "Loading usage…" 13 textTertiary.
`refreshPlanUsageDetails` (BillingHelpers :852-895): request-ID-guarded parallel fetch of `fetchChatUsageQuota` + `getOverageInfo`; quota also pushed into `FloatingBarUsageLimiter.applyQuota`.

### 4.8 Overage card (AccountBilling :394-453, settingId `planusage.overage`)

Only when `overageInfo.isOveragePlan`. Icon `dollarsign.circle.fill` warning if excess>0 else `checkmark.circle.fill` success, 18pt. Title "Usage-based overage" / "No overage yet this cycle" 14 semibold; right "$%.2f" 15 semibold warning monospacedDigit when excess>0. Body: excess>0 → "You've gone {N} question(s) past your plan's {M} included. We'll bill the overage at end of your cycle."; else "Go over your {M} included questions and we'll charge real provider cost + {P}%. No hard cutoff." (12). Link button: `info.explainerTitle` 12 medium + info.circle 11, purplePrimary → sheet.
Explainer sheet (:455-517): min 440×360, padding 24; title (explainerTitle ?? "How overage billing works") 18 semibold + xmark.circle.fill 20 close; body text 13 textSecondary; if overage plan, divider + "Your current cycle" 13 semibold + rows (label 12 textTertiary / value 12 monospacedDigit): "Questions used", "Included in plan", "Over the limit", "Real provider cost" ($), "Markup" (%), "Overage to bill" ($, emphasized semibold warning). Silent while loading (EmptyView).

### 4.9 BYOK promo card (AccountBilling :519-556, settingId `planusage.byok`)

`key.fill` 20 purplePrimary; title `APIKeyService.isByokActive` ? "Free plan active" : "Use Omi free forever" 15 semibold; caption active → "You're using your own OpenAI, Anthropic, Gemini, and Deepgram keys. No subscription." else "Provide your own OpenAI, Anthropic, Gemini, and Deepgram keys to skip the subscription entirely." (12). Button "Manage your keys" / "Switch to your own keys" `.bordered` → `openBYOKSettings()` (:551-556): switch to `.advanced`, after 0.25s highlight `advanced.devkeys.info`.

---

## 5. About section — `Components/SettingsContentView+Controls.swift:375-625` (`aboutSection`)

### 5.1 App info card (settingId `about.version`)

- `herologo.png` from resource bundle, 48×48 fit.
- "omi" 18 bold + optional "({activeChannelLabel})" 13 medium purplePrimary (e.g. "(Beta)").
- "Version {currentVersion} ({buildNumber})" 13 textTertiary, `.textSelection(.enabled)`.
- Divider (backgroundQuaternary), then link rows: **"What's New"** → `AppBuild.changelogURLString`; **"Visit Website"** → https://omi.me; **"Help Center"** → https://help.omi.me; **"Privacy Policy"** → in-app nav (`selectedSection = .privacy`; trailing `arrow.right` 12 instead of `arrow.up.right`); **"Terms of Service"** → https://omi.me/terms.

### 5.2 Software Updates card (settingId `about.updates`)

- Header: `arrow.triangle.2.circlepath` 16 purplePrimary + "Software Updates" 15 medium + **"Check Now"** `.bordered`, disabled unless `updaterViewModel.canCheckForUpdates`, help tooltip "Check for app updates" / "Already checking for updates…".
- "Last checked: {relative} ago" 12 textTertiary when `lastUpdateCheckDate` set.
- **Failure banner** when `lastUpdateFailure != nil` (:470-511): `exclamationmark.triangle.fill` 14 warning; "Update Needs Attention" 13 semibold; `failure.userMessage` 12 textSecondary; buttons: "Open Applications" (`.bordered`, only if `failure.isRecoverableLaunchLocation` — opens /Applications), "Download Latest" (`.bordered` → `AppBuild.manualDownloadURL` in browser), "Dismiss" (`.borderless` → clears failure). Container padding 12, bg backgroundTertiary, corner 8.
- Divider. `settingRow` **"Automatic Updates"** / "Check for updates automatically in the background" (settingId `about.autoupdates`) → switch toggle bound `$updaterViewModel.automaticallyChecksForUpdates`, disabled if `usesManagedUpdatePolicy || AnalyticsManager.isDevBuild`.
- If auto-check on: `settingRow` **"Auto-Install Updates"** / "Automatically download and install updates when available" (settingId `about.autoinstall`) → `$updaterViewModel.automaticallyDownloadsUpdates`, same disable rule.
- Footnote 12 textTertiary: managed policy → "Release builds always auto-check and auto-install updates in the background."; dev build → "Development builds keep automatic installation disabled to avoid replacing the local app."
- Divider. `settingRow` **"Update Channel"** subtitle = `updateChannel.description` (settingId `about.channel`) → menu Picker of `UpdateChannel.allCases` (`displayName`), width 100. Beta→Stable while `isDowngradeToStable` → alert **"Switch to Stable Channel?"**: "Stay on Beta" (cancel) / "Switch to Stable" (also opens https://macos.omi.me); message: "You're on a newer beta build ({currentVersion}). The latest stable release is {latestStableVersionString ?? "an older version"}.\n\nSwitching to Stable means you won't receive new updates until a stable release surpasses your current version. You can also download the stable version now."
- Update engine: Sparkle (`import Sparkle`), `UpdaterViewModel.shared`. No in-pane download-progress or changelog rendering — Sparkle's own update window handles download/install UI; changelog is an external "What's New" URL.

### 5.3 Report an Issue card (settingId `about.reportissue`)

`exclamationmark.bubble.fill` 16 purplePrimary; "Report an Issue" 15 medium; "Help us improve omi" 13 textTertiary; **"Report"** `.bordered` → `FeedbackWindow.show(userEmail: AuthState.shared.userEmail)`.

---

## 6. Advanced section — `Sections/SettingsContentView+Advanced.swift`

`advancedSection` (:21-41) = single scroll, VStack spacing 24, with `advancedCategoryHeader(title:icon:)` (:8-19 — icon 16 purplePrimary + title 18 semibold, top padding 16) between groups. **Order:**

1. **"AI Setup"** (icon `cpu`) → `aiSetupSubsection` (:77-369):
   - **Voice Model** card (settingId `aichat.realtimevoice`): `waveform` 16 textTertiary; "Voice Model" 15 semibold; menu Picker width 200 over `RealtimeOmniProvider.allCases` → `@AppStorage("realtimeOmniProvider")` (default `.auto`). Auto shows "{subtitle} · currently {effectiveProvider.displayName}" 12; others just subtitle. onChange refreshes `AutoModelSelector` and posts `.realtimeOmniSettingsDidChange`.
   - **AI Provider** card (settingId `aichat.provider`): `cpu` 16; menu Picker width 200 over `AIProvider.all` → `@AppStorage("chatBridgeMode")` (default `"piMono"`); onChange `chatProvider.switchBridgeMode`. Below: provider tagline (as Link "{tagline} · {host}" if attributionURL). If mode == "claudeCode" && connected: divider + green `checkmark.circle.fill` 12 + "Connected to Claude" 12 + **"Disconnect"** plain red 12 medium.
   - **Workspace** card (settingId `aichat.workspace`): `folder` 16; **"Browse..."** `.bordered` small → NSOpenPanel (dirs only, message "Select a project directory") → `@AppStorage("aiChatWorkingDirectory")`; **"Clear"** button when set. Path shown 12 textTertiary truncate-middle; empty state "No workspace set. Choose a project directory for desktop chat context."
   - **Browser Extension** card (settingId `aichat.browserextension`): `globe` 16; green 6×6 dot + "Connected" 11 when token present; switch small → `@AppStorage("playwrightUseExtension")` (default true). Caption "Lets the AI use your Chrome browser with all your logged-in sessions." When enabled: token empty → **"Set Up"** `.borderedProminent` small (wrench icon) → `showBrowserSetup` sheet (`BrowserExtensionSetup`); token set → "Token" 12 + first-8-chars + "..." monospaced 12 + **"Reconfigure"** (arrow.clockwise) + **"Reset"** (xmark; clears UserDefaults "playwrightExtensionToken").
   - **Dev Mode** card (settingId `aichat.devmode`): `hammer` 16; switch small → `@AppStorage("devModeEnabled")` (default false; analytics `settingToggled("dev_mode")`). Caption "Let the AI modify the app's source code, rebuild it, and add custom features."
2. **"Profile & Stats"** (`brain`) → `profileAndStatsSubsection` (:371-407): gate card (settingId `advanced.profileandstats`) — eye/eye.slash icon 15 purple; "Profile and Stats" 15 semibold; "Keep the generated profile and usage stats hidden until you need them." 12; **Show/Hide** `.bordered` small toggling `showProfileAndStats` (default false) with easeInOut 0.2. When shown →
   - `aiUserProfileSubsection` (:409-565, settingId `advanced.aiuserprofile`): `brain` 16 purple + "AI User Profile" 15 medium; right: spinner while generating else **"Generate Now"** (no profile) / **"Regenerate"** `.bordered` small. Divider. Profile text: read mode = ScrollView maxHeight 200, monospaced 13 textSecondary, selectable; footer "Last updated: {relative named}" 12 + "Data sources: {N} items" 12 + pencil (edit; help "Edit profile") + trash (red 0.7 opacity; help "Delete this profile" → `deleteCurrentAIProfile()` restores previous profile if any, BillingHelpers :631-649). Edit mode = TextEditor monospaced 13 maxHeight 200 + "Cancel" `.bordered` / "Save" `.borderedProminent` small (`AIUserProfileService.updateProfileText`). Empty: "Your AI user profile will be generated automatically on next launch, or click \"Generate Now\" to create it now." 13. Generating: centered spinner + "Generating profile..." 13, padding v20. `.task` loads latest profile; if none, polls 6× every 5s (:544-564).
   - `statsSubsection` (:567-633, settingId `advanced.stats`): `chart.bar` 16 purple + "Your Stats" 15 medium; divider; `statRow`s: "Conversations", "Apps Installed", "AI Chat Messages" (independent load), "Screenshots", "Focus Sessions", "Tasks (To Do)", "Tasks (Done)", "Tasks (Removed)", "Goals", "Memories". Loading → per-row mini spinners; error → "Unable to load stats" 13. Data via `loadAdvancedStats()` (Controls.swift:320-360): parallel `APIClient.getConversationsCount`, `searchApps(installedOnly:)`, `ProactiveStorage.getTotalFocusSessionCount`, `ActionItemStorage.getFilterCounts`, `APIClient.getGoals`, `MemoryStorage.getStats`, `RewindDatabase.getScreenshotCount` (0 on error); chat messages via `APIClient.getChatMessageCount` (:362-371).
3. **"Reset Onboarding"** (`arrow.counterclockwise`) → `resetOnboardingSubsection` (`+Assistants.swift:1181-1227`, settingId `advanced.resetonboarding`): icon 16 textSecondary w24; "Reset Onboarding" 16 semibold; "Restart setup wizard for this app build only" 13; **"Reset"** pill (white fill, black text 13 medium, rounded 6, padding h14/v6). Alert **"Reset Onboarding?"**: Cancel / **"Reset & Restart"** (destructive) → `appState.resetOnboardingAndRestart()`; message "This will reset onboarding for this app build only, clear onboarding chat history, and restart the app without affecting the other installed build."
4. **"Goals"** (`target`) → `goalsSubsection` (`+Assistants.swift:957-995`, settingId `advanced.goals`): `target` 16 purple + "Goals" 15 medium; caption "Track personal goals with AI-powered progress detection from your conversations" 13; divider; settingRow **"Auto-Generate Goals"** / "Automatically suggest new goals daily based on your conversations and tasks" (settingId `advanced.goals.autogenerate`) → switch bound `GoalGenerationService.shared.isAutoGenerationEnabled`.
5. **"Preferences"** (`slider.horizontal.3`) → `preferencesSubsection` (`+Assistants.swift:997-1090`):
   - **Multiple Chat Sessions** (settingId `advanced.preferences.multichat`): `bubble.left.and.bubble.right` 16 textSecondary w24; title 16 semibold; dynamic caption — on: "Create separate chat threads" / off: "Single chat synced with mobile app"; switch → `@AppStorage("multiChatEnabled")` default false.
   - **Use old Home design** (settingId `advanced.preferences.legacyhome`): `rectangle.split.2x1` icon; caption "Show the previous chat-first dashboard instead of the simplified Home"; **checkbox**-style toggle → `@AppStorage("useLegacyHomeDesign")` default false.
   - **Launch at Login** (settingId `advanced.preferences.launchatlogin`): `power` icon; caption = `LaunchAtLoginManager.shared.statusDescription`; switch → `launchAtLoginManager.setEnabled(_)` (+analytics).
6. **"Troubleshooting"** (`wrench.and.screwdriver`) → `troubleshootingSubsection` (`+Assistants.swift:1092-1177`):
   - **Report Issue** (settingId `advanced.troubleshooting.reportissue`): `exclamationmark.bubble`; "Send app logs and report a problem"; **"Report"** pill (purplePrimary fill, white 13 medium, rounded 6, h14/v6) → `FeedbackWindow.show(userEmail:)`.
   - **Rescan Files** (settingId `advanced.troubleshooting.rescanfiles`): `folder.badge.gearshape`; "Re-index your files and update your AI profile"; **"Rescan"** purple pill → alert **"Rescan Files?"** Cancel/"Rescan" → posts `.triggerFileIndexing`; message "This will re-scan your files and update your AI profile with the latest information about your projects and interests."
7. **"Developer API Keys"** (`key`) → `developerKeysSubsection` (§7).
8. **"Dev Tools"** (`hammer`) → `devToolsSubsection` (:45-73): **Chat Prompt Lab** card (settingId `advanced.devtools.chatlab`): `flask.fill` 16 purple; "Chat Prompt Lab" 15 semibold; "Iterate on chat system prompts with real questions, AI grading, and production ratings" 12; **"Open"** pill (purple fill, white, rounded 8, h14/v6) → `ChatLabWindowManager.shared.openWindow(chatProvider:)`.

---

## 7. Developer API Keys — `Sections/SettingsContentView+DeveloperKeys.swift`

- **BYOK status banner** (settingId `advanced.devkeys.info`, :87-108): icon `checkmark.seal.fill` success when all 4 keys set else `key.fill` textTertiary; title "Free plan active" / "Use Omi free forever" 14 semibold; caption all-set → "You're paying your own providers. Omi skips the subscription charge. Keys stay on this Mac." else "Provide all four keys (OpenAI, Anthropic, Gemini, Deepgram) to switch to the free plan. Keys stay on this Mac — we never store them on our servers." 12.
- Four `developerKeyField` cards (:173-201), each: title 14 medium + status badge; subtitle 12; `SecureField("Leave blank for default")` roundedBorder 13; inline failure msg 11 warning.
  1. "OpenAI API Key" / "For GPT calls." — settingId `advanced.devkeys.openai` → `@AppStorage("dev_openai_api_key")`
  2. "Anthropic API Key" / "For chat (Claude)." — `advanced.devkeys.anthropic` → `@AppStorage("dev_anthropic_api_key")`
  3. "Gemini API Key" / "For proactive AI (memory, tasks, insights, focus)." — `advanced.devkeys.gemini` → `@AppStorage("dev_gemini_api_key")`
  4. "Deepgram API Key" / "For live transcription." — `advanced.devkeys.deepgram` → `@AppStorage("dev_deepgram_api_key")`
- Status badge (:203-218): notChecked → nothing; checking → mini spinner + "Checking…" 11; ok → "Valid" 11 semibold success; failed → "Invalid" 11 semibold warning.
- Error card (settingId `advanced.devkeys.error`) when `byokActivationError` set — warning triangle + message 12; e.g. "Rejected by provider: {names}. Free plan stays off until all 4 keys authenticate." (:157-158).
- **"Clear All Custom Keys"** card (settingId `advanced.devkeys.clear`, only when any key set): centered red plain text-button 13 medium → clears all four + `APIClient.deactivateBYOK()`.
- Validation flow `refreshBYOKActivation()` (:120-171), fired onChange of any key: if `APIKeyService.isByokActive` → `BYOKValidator.validateAll(snapshot)`; all ok → `APIClient.activateBYOK(fingerprints:)`, refresh `FloatingBarUsageLimiter`, clear sticky paywall; any fail → `deactivateBYOK` + error naming failed providers. Also refreshes subscription info at the end.

---

## 8. Floating Bar section — `Sections/SettingsContentView+FloatingBarAndChat.swift:8-149`

Cards in order:
1. **Show floating bar** (settingId `floatingbar.show`): status dot 12×12 (success + glow shadow radius 6 when on; textTertiary.opacity(0.3) off); "Show floating bar" 16 semibold; switch → `showAskOmiBar` (@State synced from `FloatingControlBarManager.shared.isEnabled` on appear) → `FloatingControlBarManager.shared.show()/hide()`.
2. **Background Style** (settingId `floatingbar.background`): title 16 semibold; row "Transparent" 13 … Toggle(tint purplePrimary) … "Solid Dark" 13 — the active side renders semibold textPrimary, inactive regular textTertiary; binds `shortcutSettings.solidBackground` (`ShortcutSettings.shared`).
3. **Draggable Floating Bar** (settingId `floatingbar.draggable`): caption "Allow repositioning the floating bar by dragging it."; switch tint purple → `shortcutSettings.draggableBarEnabled`.
4. **Typed Questions** (settingId `floatingbar.typedvoiceanswers`): caption "Speak answers aloud when you submit a typed question from the floating bar."; switch → `shortcutSettings.floatingBarTypedQuestionVoiceAnswersEnabled` (via `floatingBarTypedVoiceAnswersBinding`, Controls.swift:8-15).
5. **Screen Sharing in Chat** (settingId `floatingbar.screenshare`): caption "Let Ask Omi capture your screen when you ask about what's on it."; switch → `@AppStorage(DefaultsKey.chatScreenshotSharingEnabled)` default **true** (read by `ChatToolExecutor.localPolicyDecision`, `SettingsPage.swift:136-138`).
6. **Voice picker** (settingId `floatingbar.voice`, :124-149): "Voice" 16 semibold; caption = selected `ShortcutSettings.voiceOption(for:).description`; menu Picker width 180 tint purple over `ShortcutSettings.availableVoices` → `shortcutSettings.selectedVoiceID`.
7. **Voice speed slider** (settingId `floatingbar.voicespeed`) — §1.4.
Items 6-7 dim to opacity 0.55 + disabled unless `shortcutSettings.hasAnyFloatingBarVoiceAnswersEnabled`.

**Shortcuts section** (`shortcutsSection`, :151-153) just embeds `ShortcutsSettingsSection(highlightedSettingId:)` from `MainWindow/Pages/ShortcutsSettingsSection.swift` (467 lines — NOT covered in this fork's read; sibling coverage needed; search-index entries: floatingbar.shortcut, floatingbar.ptt, floatingbar.doubletap, floatingbar.pttsounds).

---

## 9. AI Chat section (hidden pane) — `+FloatingBarAndChat.swift:155-800`

Not in sidebar; `.aiChat` force-redirects to `.advanced` on production bundles. Content largely duplicated inside Advanced → AI Setup, plus extras:
- **AI Provider** card — same as Advanced (+`onAppear` `checkClaudeConnectionStatus`).
- **Ask Mode** card (settingId `aichat.askmode`): `bubble.left.and.bubble.right` 16; switch small → `@AppStorage("askModeEnabled")` default false; caption "When enabled, shows an Ask/Act toggle in the chat. Ask mode restricts the AI to read-only actions. When disabled, the AI always runs in Act mode."
- **Workspace** card — same as Advanced plus extra caption "Project-level CLAUDE.md and skills will be discovered from this directory".
- **CLAUDE.md** card (settingId `aichat.claudemd`): `doc.text` 16. "Global" chip 11 medium textTertiary on backgroundPrimary.opacity(0.5) rounded 4; **"View"** `.bordered` small (opens file-viewer sheet) + switch small → `@AppStorage("claudeMdEnabled")` default true. Path + size "({%.1f} KB)" 12 truncate-middle; missing → "No CLAUDE.md found at ~/.claude/CLAUDE.md". If workspace set: divider 0.3 + "Project" chip (purple on purple.opacity(0.1)) + View + switch → `@AppStorage("projectClaudeMdEnabled")` default true; missing → "No CLAUDE.md found at {workspace}/CLAUDE.md".
- **Skills** card (settingId `aichat.skills`): `sparkles` 16; title "Skills ({N} discovered)" or "Skills ({N} global + {M} project)" 15 semibold; refresh `arrow.clockwise` `.bordered` small → `refreshAIChatConfig()`. Empty: "No skills found in ~/.claude/skills/". Else caption "Skill descriptions are included in the AI chat system prompt"; search field (magnifyingglass 12, "Search skills...", clear x; padding 8, rounded 8 backgroundPrimary.opacity(0.5)); ScrollView maxHeight 300 of rows: checkbox toggle (enabled = NOT in `aiChatDisabledSkills`, persisted JSON array under UserDefaults key `"disabledSkillsJSON"`, :882-899), skill name 13 medium, origin badge "Global"/"Project" 9 medium (project = purple on purple.opacity(0.1); global = textTertiary on backgroundPrimary.opacity(0.5), rounded 3), description 11 textTertiary lineLimit 1, **"View"** `.bordered` `.mini` → file-viewer sheet with SKILL.md contents; row padding v6/h4, divider opacity 0.3 between.
- **Browser Extension** card — same as Advanced.
- **Dev Mode** card — same as Advanced, plus when enabled two bullets: green check "AI can modify UI, add features, create custom SQLite tables"; orange `lock.fill` "Backend API, auth, and sync logic are read-only".
- **File viewer sheet** (:767-800): 600×500, bg backgroundSecondary; header title 16 semibold + xmark.circle.fill 18 close, padding 16; divider 0.3; ScrollView monospaced 12 textSecondary selectable padding 16.
- Config sourcing `refreshAIChatConfig()` (:802-880): prefers live `ChatProvider` discovery; disk fallback reads `~/.claude/CLAUDE.md`, `~/.claude/skills/*/SKILL.md`, workspace equivalents.

---

## 10. DEAD CODE — defined but unreachable at v0.12.72 (repo-wide grep confirmed zero call sites)

These subsections exist fully-built in source but are NOT composed into `advancedSection` or any other rendered view. **Do not port as visible Windows UI without a product decision** — flag to parity audit as Mac-side leftovers from an older "Advanced sub-sidebar" design:

- `focusAssistantSubsection` (`+Assistants.swift:8-184`) — Focus Assistant toggle ("Detect distractions and help you stay focused"), Visual Glow Effect toggle (with 7s live preview via `GlowDemoWindow`, BillingHelpers :605-629), Focus Cooldown picker (1/2/5/10/15/30/60 min), Focus Analysis Prompt Test-Run/Edit buttons, Excluded Apps editor.
- `taskAssistantSubsection` (:186-521) — Task Assistant toggle, Task Agent toggle, Working Directory, Extraction Interval slider, Minimum Confidence slider (0.3–0.9 step 0.1), prompt Test-Run/Edit, Allowed Apps whitelist (browser badge), Browser Window Keywords chip editor, Task Prioritization Re-score button, `TaskAgentSettingsView` card.
- `insightAssistantSubsection` (:523-725) — same pattern; confidence 0.5–0.95 step 0.05; Excluded Apps.
- `memoryAssistantSubsection` (:727-915) — same pattern; confidence 0.5–0.95 step 0.05.
- `analysisThrottleSubsection` (:917-955) — "Analysis Throttle" / "Wait before analyzing after switching apps" slider over [0,10,20,30,60,300]s ("Instant"…"5 minutes").
- `featureTiersSubsection` (`+Advanced.swift:635-727`) — debug tier picker (Show All / Tier 1 "Conversations + Rewind" … Tier 6 "Apps (300 conversations)") + progress rows; binds `@AppStorage("currentTierLevel")` default 0 via `TierManager`.
- `gmailReaderSubsection` (`+Integrations.swift:8-141`) — "Read Gmail" (cookie-based via `GmailReaderService`, caption "Reads recent emails using browser cookies — no OAuth needed", saves emails as memories, lists ≤20 with subject/from/snippet).
- `calendarSyncSubsection` (`+Integrations.swift:145-256`) — "Sync Calendar" via `CalendarReaderService` (30 days back / 14 forward), "{N} memories and {M} tasks created from {K} events", lists ≤15 events.
- `AdvancedSubsection` enum (14 cases + icons, `SettingsPage.swift:364-398`) and `SettingsSubsectionItem` view (`SettingsSidebar.swift:573-615`) — vestigial sub-navigation scaffolding, never instantiated.

**There is NO live "Integrations/Connectors" settings tab in the Mac app at this tag.**

Underlying assistant-settings models (all UserDefaults singletons with `register(defaults:)`; sync mirror via `SettingsSyncManager.pushPartialUpdate(AssistantSettingsResponse(...))`):
- `FocusAssistantSettings` — defaults: enabled=true, cooldownInterval=10 (min), notificationsEnabled=true (`Focus/FocusAssistantSettings.swift:18-20`).
- `TaskAssistantSettings` — enabled=true, notificationsEnabled=**false** (:111-114); also `builtInExcludedApps`, `defaultAllowedApps`, `isBrowser(_)`, browser keywords.
- `InsightAssistantSettings` — enabled=true, notificationsEnabled=true (:19-22).
- `MemoryAssistantSettings` — enabled=true, notificationsEnabled=**false** (:19-22).
- Shared `AssistantSettings.shared`: `glowOverlayEnabled`, `analysisDelay`, `vadGateEnabled`, `systemAudioCaptureMode`, `transcriptionLanguage/AutoDetect/Vocabulary`, `screenAnalysisEnabled`, `transcriptionEnabled`; language helpers `supportsAutoDetect`, `supportedLanguages`, `normalizeTranscriptionLanguageCode`.

---

## 11. Shared editor components — `Components/AppRuleEditorView.swift` (used by the dead assistant subsections, but reusable)

- `ExcludedAppRow` (:5-38): AppIconView 24 + name 14 + xmark.circle.fill 16 (error color on hover); row hover bg backgroundQuaternary.opacity(0.5) rounded 8, padding h12/v8.
- `AppRuleEditorView` (:42-119): title 13 medium; TextField(roundedBorder) + Add `.bordered` (disabled when blank, submit-on-enter); "Currently Running Apps" 12 medium + refresh icon; horizontal scroll of `RunningAppChip`s (:218-250 — AppIconView 16 + name 12 + plus.circle.fill 12 purple-on-hover; chip bg backgroundQuaternary hover / backgroundTertiary.opacity(0.5); rounded 6, h10/v6) filtered to exclude already-added and built-ins; sourced from `NSWorkspace.shared.runningApplications`.
- `BrowserKeywordListView` (:121-214): filter field ("Filter keywords...", line.3.horizontal.decrease icon, bg backgroundTertiary rounded 6); FlowLayout chip cloud (chip = keyword 12 + xmark 8 bold; bg backgroundTertiary rounded 6, h8/v4) maxHeight 150; add field "Add keyword..." + Add small; count footer "{N} keywords" 11.
- `SearchableDropdown` (`Components/SearchableDropdown.swift`): generic picker — ≤8 options renders a native `Menu`; >8 renders button + popover with search field, options list (title 13 + optional subtitle 11), width auto-computed from content (min readable 170+48 padding, max 320), maxHeight 300. Used by Transcription language pickers (other fork's scope).

---

## 12. Backend-write helpers — `Components/SettingsContentView+SettingsUpdates.swift`

(Despite filename, contains NO update-UI — it's the backend PATCH helpers.) `updateDailySummarySettings(enabled:hour:)`, `updateNotificationSettings(enabled:frequency:)` (mirrors to UserDefaults `NotificationService.masterEnabledDefaultsKey`/`frequencyDefaultsKey` immediately, before roundtrip), `updateLanguage`, `updateRecordingPermission`, `updatePrivateCloudSync`, `updateTranscriptionPreferences(singleLanguageMode:vocabulary:)` (comma-split vocabulary), `deleteAccountAndData()`, `openURLInDefaultBrowser` (NSWorkspace with fallback). All fire-and-forget Tasks logging failures.

---

## 13. Animations summary

- Section switch: `.transition(.opacity)` easeInOut **0.15s** (header + content).
- Sidebar select: easeInOut 0.15s. Search-focus icon/border tint: 0.15s.
- Search-highlight flash: 0.3s in, holds 1.5s, 0.5s out; scroll-to easeInOut 0.3s after 0.2s delay.
- Promo-code disclosure: easeInOut 0.2s, transition opacity + move(edge: .top).
- Profile/Stats show-hide: easeInOut 0.2s.
- Glow preview choreography (dead code path): phases at +0.3s (focused/green) → +3.3s (distracted/red) → +7.0s close.
- Hover states: instant fill swaps (no explicit animation) on sidebar rows, chips, link rows.

---

## 14. Loading / error / signed-out states inventory

- **Subscription**: `isLoadingSubscription` spinner in current-plan card; error string "Failed to load plan information." 12 warning.
- **Chat usage**: dedicated loading card "Loading usage…"; quota-fetch failure simply renders nothing (quota nil, not loading).
- **Overage**: silent while loading; fetch failure → card hidden.
- **Stats**: per-row mini spinners; failure "Unable to load stats".
- **AI profile**: generating spinner + "Generating profile..."; empty-state instructional copy; 6×5s polling on first-run.
- **BYOK**: per-key Checking…/Valid/Invalid badges; activation error card.
- **Updates**: "Check Now" disabled while checking (help text swap); failure banner with recovery actions.
- **Account deletion**: button→spinner; error text below; post-delete sign-out failure copy.
- **Signed-out**: Settings is unreachable signed-out (main window requires auth; account card assumes AuthState). No per-pane signed-out design exists.
- Backend-settings load (`isLoadingSettings` via `SettingsViewModel`) gates nothing visually in these panes — values just pop in when hydrated.

---

## 15. Windows comparison — NOT COMPLETED by this fork

This fork covered the Mac side only (files listed above). The Windows-side comparison (`.worktrees/mac-ui-refresh/desktop/windows/src/renderer/src` Settings components, incl. the just-shipped Plan & Usage / Transcription / Shortcuts / About parity pass) and the Onboarding flow + General/Rewind/Transcription/Notifications/Privacy panes + `ShortcutsSettingsSection.swift` + delta-since-baseline git log were outside my assigned file list — the parent/sibling forks own those. Key items THIS fork contributes to the comparison rubric:
- Plan & Usage card inventory + exact plan copy/pricing strings (§4) — compare against Windows `PlanUsage` components.
- About/Updates card structure incl. Sparkle channel-downgrade alert (§5) — Windows has no Sparkle; map to its updater equivalent.
- The dead-code list (§10) — anything Windows "lacks" from these subsections is NOT a parity gap.
- The purple-accent INV-UI-1 conflict (§1.1) — decide accent substitution before visual parity scoring.
