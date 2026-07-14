# 03 — Chat (main-window surface)

Scope: the **main-window** Chat experience only (macOS `ChatPage`; Windows `Home.tsx`
thread). The notch/floating-bar chat surface (macOS `FloatingControlBar/AIResponseView`,
Windows `BarChatSurface.tsx`) is explicitly out of scope — see `docs/mac-ui-port/0X-bar.md`
if that exists.

Reference tag: macOS beta **v0.12.72+12072-macos**, worktree
`C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos` (SwiftUI, Swift Package under
`Desktop/`). Windows comparison worktree:
`C:\Users\chris\projects\omi\.worktrees\mac-ui-refresh\desktop\windows` (Electron + React +
Tailwind).

**Headline finding:** Windows has **no dedicated main-window Chat page**. `MainViews.tsx`
redirects `/chat` → `/home` ("Home merges the old Chat and Record screens" —
`src/renderer/src/components/layout/MainViews.tsx:52-55`), and the Windows sidebar
(`src/renderer/src/components/layout/Sidebar.tsx:21-27`) has no "Chat" nav item at all. The
actual comparison target is the chat thread embedded in `Home.tsx`
(`src/renderer/src/pages/Home.tsx`), which is a **much smaller, single-purpose implementation**
than macOS's `ChatPage` — no sessions, no attachments, no citations UI, no per-message actions,
no structured tool-call/agent cards. Every gap below is called out explicitly.

---

## 1. Thread layout

### macOS (`ChatPage.swift`, `ChatMessagesView.swift`, `ChatBubble.swift`)

- **Container**: `ChatPage` is a `VStack(spacing: 0)` — header → divider → `messagesView`
  (`ChatMessagesView`) → optional error card/banner → `inputArea`. Background
  `OmiColors.backgroundPrimary` (`#0F0F0F`).
  (`Desktop/Sources/MainWindow/Pages/ChatPage.swift:20-85`)
- **Message list**: `ScrollView` → `LazyVStack(spacing: 18)` with `.padding(.horizontal, 24)
  .padding(.vertical, 22)`. An invisible `Color.clear.frame(height: 1).id("bottom-anchor")`
  sits **outside** the `LazyVStack` so `scrollTo` always has a real, eagerly-rendered target.
  (`ChatMessagesView.swift:253-275`)
- **Bubbles** (`ChatBubble.swift:85-286`):
  - Row is `HStack(alignment: .top, spacing: 12)`; avatar leads for AI (`.leading`), trails for
    user (`.trailing`), full-width `.frame(maxWidth: .infinity, alignment: user ? .trailing : .leading)`.
  - **Avatars**: 32×32 circle. AI = selected app's `AsyncImage` or, for default Omi, the bundled
    `herologo.png` at 20×20 inset into a 32×32 `OmiColors.backgroundTertiary` circle. User =
    SF Symbol `person.fill`, 14pt, on a 32×32 `OmiColors.backgroundTertiary` circle
    (`ChatBubble.swift:92-121`, `:273-281`).
  - **User bubble**: `SelectableMarkdown` text, `.padding(.horizontal, 14).padding(.vertical, 10)`,
    background **`OmiColors.userBubble`** (`#43389F` — a purple/indigo), clip shape
    `RoundedRectangle(cornerRadius: 20, style: .continuous)` (`ChatBubble.swift:226-236`).
  - **AI bubble** (plain-text path, no content blocks — e.g. reloaded-from-Firestore messages):
    same padding/radius, background `OmiColors.backgroundTertiary.opacity(0.95)`
    (`#252525` at 95%) (`ChatBubble.swift:230-234`).
  - **AI structured content** (the live/streaming path, `message.contentBlocks` non-empty):
    text segments render the same 20pt-radius bubble at `OmiColors.backgroundTertiary.opacity(0.92)`;
    additional block kinds render as their own cards below (tool calls, thinking, discovery,
    agent spawn/completion — see §3) (`ChatBubble.swift:127-187`).
  - **Long-message truncation**: messages > 500 chars (`truncationThreshold`) collapse to the
    first 500 chars + "…" with a "Show more" / "Show less" toggle
    (`ChatBubble.swift:46-62`, `:238-247`).
  - **Duplicate detection**: messages > 200 chars whose first-200-char fingerprint repeats an
    earlier message in the same session collapse into a "Duplicate message" pill (`doc.on.doc`
    icon) the user can tap to expand (`ChatBubble.swift:172-186`, `:188-205`).
- **Timestamps**: `Text(message.createdAt, format: .dateTime.hour().minute())`, 10pt medium,
  `OmiColors.textTertiary`; hovering reveals the month/day next to it with a 0.12s ease-in-out
  opacity transition (`ChatBubble.swift:302-314`).
- **Day separators**: **none.** No date-divider row exists anywhere in `ChatMessagesView` or
  `ChatBubble` — only the per-message hover-reveal date next to the time.
- **Scroll anchor / follow behavior** (`ChatScrollMode` in `ChatScrollBehavior.swift:195-198`,
  logic in `ChatMessagesView.swift:188-501`):
  - Two explicit modes: `.followingBottom` (default) and `.freeScrolling`. Only *physical* user
    input (scroll wheel/trackpad via `NSEvent` local monitor, mouse click/drag, or keyboard
    scroll-nav keys while the scroll view has focus) flips to `.freeScrolling`
    (`ChatScrollBehavior.swift:88-192`) — geometry/layout changes never do.
  - `ScrollPositionDetector` (an `NSViewRepresentable` walking up to the enclosing `NSScrollView`)
    reports "at bottom" with a 100pt threshold, debounced 0.06s (`ChatScrollBehavior.swift:6-84`).
  - Streaming text/tool-block growth triggers a **throttled** scroll-to-bottom, coalesced to at
    most once per 80ms (`ChatMessagesView.swift:690-699`) — avoids the scroll→layout→scroll
    feedback loop.
  - A local send anchors the viewport via `LocalSendToken` (a monotonic generation counter passed
    down from `ChatProvider`), distinguishing "I just sent a message" from "a message arrived via
    poll/sync" (`ChatMessagesView.swift:3-11`, `:404-416`).
  - Initial load settles the viewport with three staggered scroll attempts at 0.05s/0.18s/0.45s
    (`ChatMessagesView.swift:390-400`) to absorb late layout passes.
  - **Jump-to-latest button**: circular `arrow.down.circle.fill`, 36×36,
    `OmiColors.backgroundPrimary` fill + drop shadow, shown only in `.freeScrolling` with
    messages present; pulses (scale 1.08, stroke ring at 0.6 opacity) when new content arrived
    below (`hasActivityBelow`). Transition `.scale.combined(with: .opacity)`,
    `.easeInOut(duration: 0.2)` for mode, `0.3` for the activity pulse
    (`ChatMessagesView.swift:640-676`).
  - **Load earlier messages**: a text button above the list (`"Load earlier messages"` /
    spinner while loading) when `hasMoreMessages`; after load, the previously-topmost message is
    scrolled back to `.top` (no animation) to preserve reading position, gated on the user not
    actively scrolling (`ChatMessagesView.swift:418-447`, `:505-527`).

### Windows (`Home.tsx:409-548`)

- **Container**: a single CSS grid, 5 rows `[topSpacer][widgets][middle][bar][bottomSpacer]`,
  animating `grid-template-rows` between an idle centered layout (`ROWS_IDLE`) and a
  split/full layout (`ROWS_FULL`) over 1000ms `cubic-bezier(0.4,0,0.2,1)`
  (`Home.tsx:38-39`, `:412-413`). This has no macOS analog — macOS's chat surface is a fixed
  header/list/input stack, never a centered "hero → thread" transition.
- **Bubbles**:
  - **User**: right-aligned, `bg-[var(--accent)]` (white) fill, `text-[color:var(--accent-contrast)]`
    (near-black) text, `rounded-[18px] rounded-br-[6px]` (iMessage-style tail corner), 75% max
    width, no avatar (`Home.tsx:476-485`).
  - **Assistant**: left-aligned, **no bubble at all** — "omi mark + open text on the canvas ...
    so replies read like a document, not a widget" (`Home.tsx:487-488`). 44×44 circular white
    badge with the `omi-mark.png` brand image, text at 85% max width, `text-white/90`, `leading-[1.65]`
    (`Home.tsx:489-525`).
  - Both use a `.bubble-in` entrance: `translateY(8px) scale(0.985)` → identity, 0.38s
    `var(--ease-out)` (`cubic-bezier(0.22,1,0.36,1)`) (`globals.css:447-463`).
- **Timestamps**: **none.** No per-message time is rendered anywhere in `Home.tsx`.
- **Day separators**: **none.**
- **Scroll anchor / follow behavior** (`Home.tsx:107-407`): a close structural port of the macOS
  logic — same two-mode `ChatScrollMode` (`'followingBottom' | 'freeScrolling'`), same
  wheel/touch/scrollbar detection releasing to free-scroll, same "resume following at the live
  edge" resumption, same throttled re-pin via `ResizeObserver` on the content div (mirrors macOS's
  streaming-growth throttle), same jump-to-latest affordance (`ArrowDown` pill, "Latest" label,
  bottom-center) shown only in `freeScrolling`. **Difference**: windowed rendering instead of a
  true "load earlier" round-trip — `visibleCount` grows by `PAGE_SIZE = 30` client-side messages
  already in `chat.history` (no backend pagination call), restoring scroll position via
  `useLayoutEffect` (`Home.tsx:190-192`, `:368-399`). macOS's `hasMoreMessages` is a real
  server-paginated fetch (`APIClient.getMessages(sessionId:limit:offset:)`); Windows has no
  session/backend-paginated history at all — `chat.history` is the full in-memory + locally
  persisted (SQLite) thread.
- **Top fade**: a `linear-gradient` mask fades the top ~190px of the thread once it overflows
  (`FADE_MASK`, `Home.tsx:27-29`, `:403`) — no macOS equivalent (macOS has no fade mask on the
  scroll container).

### Verdict — thread layout: **major drift**

Bubble shape/color, avatar treatment, timestamps, day separators, duplicate-message collapsing,
and truncation are all either different or entirely absent on Windows. Scroll-follow *mechanics*
are a faithful, deliberate port (comments in `Home.tsx` explicitly reference "mac
parity") and should be rated identical/minor-drift on their own, but they're wrapped in a
hero-layout animation macOS doesn't have.

---

## 2. Composer

### macOS (`ChatInputView.swift`)

- **Container**: `VStack` wrapping an optional attachment-preview row + an `HStack` (paperclip +
  input + send/stop), `.padding(12)`, `.omiPanel(fill: OmiColors.backgroundSecondary, radius: 22,
  stroke: dropStrokeColor, shadowOpacity: 0.1, shadowRadius: 12, shadowY: 6)`
  (`ChatInputView.swift:53-151`).
- **Text field**: custom `OmiTextEditor` (AppKit `NSTextView` wrapper) overlaid on a hidden
  `Text` used purely for SwiftUI auto-height measurement (`.frame(maxHeight: 200)`, `.clipped()`),
  background `OmiColors.backgroundTertiary`, `RoundedRectangle(cornerRadius: 18, style: .continuous)`.
  Placeholder `"Type a message..."`, 14pt, `OmiColors.textTertiary`, padding 12/12 matching the
  editor's `textContainerInset` exactly so cursor and placeholder align (`ChatInputView.swift:76-114`).
- **Attachments** (opt-in via `attachments`/`onAttachmentsAdded`/`onAttachmentRemoved` bindings —
  active for main chat): paperclip button (SF Symbol, 18pt) opens `NSOpenPanel` allowing images,
  PDF, plaintext, JSON, CSV, HTML; drag-and-drop onto the whole input (`UTType.fileURL`) with a
  highlighted border (`dropStrokeColor` = `purplePrimary.opacity(0.6)` while targeted). Staged
  files render as a horizontal scroll row of chips above the input (image thumbnail or
  document-icon + filename + mimetype), each removable, capped at **`kMaxChatAttachments = 4`**
  (`ChatInputView.swift:55-73`, `:198-259`, `:261-386`; `ChatAttachment.swift:141-143`).
- **Send button**: `arrow.up.circle.fill`, 24pt, `OmiColors.purplePrimary` when `canSend`
  (text non-empty OR ≥1 attachment) else `OmiColors.textQuaternary`. While sending: replaces with
  `stop.circle.fill` (red 0.8 opacity) or, while stopping, a small `ProgressView`
  (`ChatInputView.swift:124-146`).
- **Ask/Act mode toggle**: a floating pill (`ChatModeToggle`, top-right inside the input) shown
  only when the `askModeEnabled` `@AppStorage` flag is on — segmented "Ask"/"Act" control,
  active segment filled `OmiColors.userBubble` (`ChatInputView.swift:116-121`, `:407-431`).
  **Off by default** and not surfaced in the settings the desktop-parity brief covers here beyond
  noting its existence.
- **Keyboard**: Enter submits (`OmiTextEditor`'s `onSubmit`); no explicit Shift+Enter newline
  documented in this file (delegated to `OmiTextEditor`, not read for this pass).
- **No inline voice/PTT affordance inside `ChatInputView` itself** — PTT lives in the floating
  bar, out of scope here; `ChatPage` does not embed a mic button in the main-window composer.

### Windows (`Home.tsx:41-92`, `ChatBar`)

- **Container**: single-row `flex items-center gap-1.5`, `rounded-section` (20px, the
  `--radius-section` token — matches macOS `OmiChrome.sectionRadius`), `border border-line`,
  `bg-[var(--surface)]` (`= --bg-secondary`, `#1A1A1A` — matches macOS's
  `OmiColors.backgroundSecondary`), `py-1.5 pl-4 pr-1.5`, shadow
  `0 10px 28px rgba(0,0,0,0.28)`, focus ring via `focus-within:border-line-strong`
  (`Home.tsx:52-53`). Explicitly **not** blurred — comment notes a blurred bar re-rasterized every
  frame during the slide transition and felt laggy.
- **Text field**: plain `<input>` (single-line, not a growing textarea), placeholder
  `"Ask Omi…"`, 15px, `placeholder:text-white/35` (`Home.tsx:54-62`).
- **Attachments**: **none.** No paperclip, no drag-drop, no file staging anywhere in `ChatBar`
  or `Home.tsx`.
- **Send button**: circular, `ArrowUp` (lucide) 16px stroke 2.25. Filled `bg-[var(--accent)]`
  (white) + `text-[var(--accent-contrast)]` when `canSend`, else `bg-white/[0.06] text-white/40`
  (`Home.tsx:77-89`). No dedicated "stop" glyph/state — `sending` only disables `canSend`; there
  is no stop/cancel button in the composer at all (macOS's `stop.circle.fill` mid-turn cancel has
  no Windows equivalent in the main-window composer).
- **Voice button**: a dedicated circular `AudioLines` (lucide) toggle to the left of Send, opens
  `VoiceSessionSurface` inline above the bar (`Home.tsx:63-74`, `:554-558`). This is a **Windows
  addition** with no macOS main-chat-composer equivalent (macOS's voice/PTT affordance lives only
  in the floating bar, out of this doc's scope).
- **Mode toggle (Ask/Act)**: **absent.**
- **Keyboard**: Enter submits (`onKeyDown` checks `e.key === 'Enter'`, `Home.tsx:57-59`); no
  Shift+Enter multiline handling since it's a single-line `<input>` (can't hold newlines at all —
  a structural gap vs. macOS's multi-line `OmiTextEditor`).

### Verdict — composer: **major drift**

Radius/surface/shadow language matches (ported design tokens). But: no attachments, no multi-line
input, no explicit stop-button state, no Ask/Act toggle, and an extra inline voice toggle macOS's
main-chat composer doesn't have (that capability lives in the Mac floating bar instead).

---

## 3. Rich content rendering

### macOS

All of the following render only via `message.contentBlocks` (`ChatContentBlock`, encoded/decoded
by `ChatContentBlockCodec.swift`) — the live/streaming path. Reloaded plain-text history renders
as flat markdown only.

- **Markdown**: `SelectableMarkdown` (`MainWindow/Components/SelectableMarkdown.swift`) — a
  custom splitter that separates text/code-fence segments so cross-paragraph text selection works
  (MarkdownUI's per-block `Markdown` view breaks selection across paragraphs). GFM tables detected
  and routed to a real `MarkdownUI.Markdown` render with horizontal-scroll wrapping
  (`:73-123`, `:221-261`). Code blocks render boxed, monospace, `OmiColors.backgroundTertiary`
  (`aiMessage` theme) or `white.opacity(0.15)` (`userMessage` theme), `cornerRadius(8)`
  (`ChatBubble.swift:1694-1788`, `SelectableMarkdown.swift:125-143`).
- **Citations / sources**: `CitationCardsView` — a "Sources" header (`quote.opening` icon) above
  a stack of `CitationCardView` rows (emoji/icon + title + one-line preview + chevron), each
  tappable; tapping a `.conversation`-sourced citation fetches and opens `ConversationDetailView`
  in a sheet, `.memory` citations log-only (no detail view yet) (`ChatPage.swift:496-522`,
  `CitationCardView.swift`). Rendered only when `!message.citations.isEmpty && !isStreaming`,
  max width 280 (`ChatBubble.swift:255-261`).
- **Charts/graphs**: **none found** in the chat surface — no chart-rendering view referenced by
  `ChatBubble`/`ChatMessagesView`/`ChatContentBlock`.
- **Action-item / task cards**: none inline in chat (task chat has its own `TaskChatPanel`, out of
  scope — this is the main `ChatPage` only).
- **Agent/tool activity**:
  - **Tool call groups** (`ToolCallsGroup`, `ChatBubble.swift:972-1248`): consecutive `.toolCall`
    blocks collapse into one header row (status icon + tool name + inline arg summary + step
    count), expandable to per-tool `ToolCallCard`s showing Input/Output. Auto-expands while any
    tool is running (`expandRunning`). A "taking longer than usual" `ToolCallStalledBanner`
    (orange, Cancel button wired to `AgentBridge.interrupt()`) appears above the group when a
    tool's status is `.stalled` and isn't in the "expected to run long" allowlist
    (`isSlowExpectedTool`).
  - **Status icon language** (shared `statusIcon(for:size:)`, `ChatBubble.swift:1504-1529`):
    `.running`/`.slow` = spinner (orange tint for slow), `.stalled` = orange
    `exclamationmark.triangle.fill`, `.completed` = green `checkmark.circle.fill`, `.failed` = red
    `xmark.circle.fill`.
  - **Thinking block** (`ThinkingBlock`, `:1576-1626`): collapsible, `brain` icon, italic text,
    `OmiColors.backgroundTertiary.opacity(0.72)`. Only shown while streaming
    (`visibleChatGroups` drops `.thinking` once the turn completes).
  - **Discovery card** (`DiscoveryCard`, `:1631-1690`): collapsible profile-summary card,
    `doc.text.magnifyingglass` icon in `OmiColors.purplePrimary`, scrollable full text up to 300pt.
  - **Agent spawn / completion cards** (`AgentSpawnCard`, `AgentCompletionCard`,
    `BackgroundAgentSummaryCard`, `:576-808`, `:448-574`): a spawned background agent renders as
    a card with title/objective, a link-out button (`arrow.up.forward.app`) that opens the agent's
    floating pill via `onOpenAgent`/`onOpenAgentRef`; completion adds a status icon
    (success/failure/unknown) and expandable prompt+output. `AgentLifecycleDisplayProjection`
    (top of `ChatMessagesView.swift:13-135`) merges a spawn+completion pair for the same
    run/pill into **one** card instead of showing launch and completion as two separate rows.
  - **Resources/artifacts**: `ChatResourceStrip` (`Chat/ChatResource.swift:321-359`) renders user
    attachments and agent-generated artifacts as a vertical stack of cards — image tiles (140pt
    height, gradient caption overlay) or document tiles (icon badge + title + subtitle), each with
    open/reveal-in-Finder/copy-path actions. User attachments render **above** the text (`"here's
    what I'm sending"`); AI-generated artifacts render **below** it (`ChatBubble.swift:207-222`).
- **Streaming indicator**: `TypingIndicator` (`Chat/TypingIndicator.swift`) — an 8-dot rotating
  ring (`OmiThinkingMark`, 0.9s linear infinite rotation, per-dot opacity trail), shown for an
  empty streaming message and appended after content if still streaming with no in-flight tool
  spinner already visible (`ChatBubble.swift:124-126`, `:171-184`).
- **Error / retry affordances**: **two coexisting layers**:
  1. `ChatErrorCard` (`MainWindow/Pages/ChatErrorCard.swift`) — structured, per-`ChatErrorState`
     case (`.authRequired`, `.timeout(toolName:)`, `.bridgeUnavailable(reason:)`, `.interrupted`,
     `.noDataFound`; `Chat/ChatErrorState.swift:37-59`), each with its own icon/accent
     color/headline/detail/single primary CTA (Retry / Sign in / Install runtime / dismiss) and
     an optional redacted "Show details" disclosure. Rendered above the legacy banner
     (`ChatPage.swift:39-51`).
  2. Legacy `errorMessage` banner — a flat warning-triangle + text + dismiss row,
     `OmiColors.backgroundSecondary` background, for unmappable `BridgeError` cases (encoding
     errors, quota, free-form agent errors) (`ChatPage.swift:53-77`).
  Plus two dedicated **sheets** kept outside the error-card system entirely: `ClaudeAuthSheet`
  (Claude OAuth paywall) and a `showOmiThresholdAlert` alert ("Upgrade to Omi Pro for $199/month
  to continue chatting") (`ChatPage.swift:108-140`).

### Windows

- **Markdown**: `RevealMarkdown` → `Markdown` component (`components/Markdown.tsx`, not read in
  this pass) — renders full markdown, but with a **char-by-char reveal** animation
  (`REVEAL_MS = 16`, minimum 2 chars/tick, remaining-distance/24 step size) for the actively
  streaming message only; every other message renders instantly in full
  (`RevealMarkdown.tsx:9-42`). No text-selection-across-paragraphs concern documented (browser
  text selection is native).
- **Citations**: `ChatMsg.citations` (`ChatCitation[]`) is captured from the SSE `done:` frame
  (`useChat.ts:24-25`, `:606-616`) but is **never rendered anywhere** — grep confirms no
  citation-card component exists in `Home.tsx` or `components/chat/`. Dead data on the wire.
- **Charts**: `ChatMsg.chartData` is likewise captured (`useChat.ts:26-27`, comment: "opaque — no
  chart UI yet") and **never rendered**.
- **Action items / tasks**: no inline cards; not applicable to the current thread rendering.
- **Agent/tool activity**: the `/v2/messages` streaming path (normal chat) has **no tool-call or
  thinking-block UI at all** — it only accumulates plain text. There IS a separate delegated
  coding-agent path (`tryAgentTask` in `useChat.ts:271-422`) that renders a single composed
  markdown string per turn combining a header line, `_status notes_`, accumulated text, and a
  trailing `_activity…_` italic line for the currently-running tool — all inside **one bubble**,
  re-rendered on every event, with no per-tool cards, no collapsible groups, no status icons, and
  no stalled-tool banner/cancel affordance.
- **Resources/artifacts**: no resource-card component; no attachment upload path exists to produce
  them in the first place.
- **Streaming indicator**: three staggered dots (`typing-dots`, `globals.css:466-500`), shown only
  when the assistant message content is empty and `chat.sending` is true (`Home.tsx:518-524`) —
  visually a simpler primitive than macOS's rotating 8-dot ring, but functionally equivalent
  placement/trigger.
- **Error / retry**: no structured per-failure-class card. Errors render as **plain assistant
  bubble text**: `"Response took too long. Try again."` (watchdog timeout) or `"Error:
  ${e.message}"` (any other failure) (`useChat.ts:657-663`); a blank-reply guard substitutes
  `"Omi didn't send a reply. Try again."` (`:642-646`). None of these are retryable via a button —
  the user must retype. Quota-exceeded has a **separate, decoupled** mechanism:
  `UsageLimitTriggerHost` polls chat quota once whenever `chat.sending` flips `true→false` and
  raises a standalone `UsageLimitPopup` (not an inline chat card) — explicitly marked
  `TODO(stream-1 chat integration)` pending "an explicit quota-exceeded signal from the chat
  engine" (`UsageLimitTriggerHost.tsx:15-30`).

### Verdict — rich content rendering: **missing** (tool/agent cards, citations UI, resources,
structured error cards) / **major drift** (markdown reveal mechanism, error-as-plain-text)

This is the single biggest gap. macOS's chat surface is built around a rich `ChatContentBlock`
timeline (text/tool/thinking/discovery/agent-spawn/agent-completion); Windows's `/v2/messages`
path is a flat text accumulator with citations/chart data silently dropped on the floor.

---

## 4. Session / thread UI

### macOS — multi-session, gated by a feature flag

- **INV-CHAT-1** ("shared chat continuity"): one default/synced chat thread shares messages with
  the mobile app (`isInDefaultChat`); this is the invariant, documented in
  `docs/product/invariants/` (not re-derived here).
- `@AppStorage("multiChatEnabled")` (default `false`) gates an entire secondary UI layer
  (`ChatProvider.swift:997-999`):
  - **Off** (default): header shows only the app-picker + model chip + copy/clear buttons — no
    session chrome at all, behaves like a single persistent thread.
  - **On**: header additionally shows a "Synced Chat" pill (📥 `icloud`, green,
    `OmiColors.success.opacity(0.15)`) when viewing the default/shared thread, or a "Synced"
    button to switch back to it plus the current session's title, a "+" new-session button, and a
    history-clock button opening `ChatHistoryPopover` (`ChatPage.swift:162-224`, `:333-348`).
  - `ChatHistoryPopover` (`ChatPage.swift:671-864`): 320pt-wide popover — header (title + starred
    filter + new-chat), search field, then a `LazyVStack` of sessions grouped by relative date
    (`groupedSessions`), each row (`HistorySessionRow`, `:868-1008`) showing star/title/preview/
    relative-time, with hover-revealed rename (double-click or pencil), star-toggle, and delete
    (confirm alert) actions.
  - There is also an **unused** `ChatSessionsSidebar.swift` component (full sidebar list variant)
    — referenced only from its own `#Preview` and the internal `ViewExporter` dev tool
    (`grep` confirms zero call sites in `ChatPage.swift` or elsewhere in the shipped UI). Treat it
    as dead code for parity purposes.
- **Header actions** always present regardless of multi-chat: app picker (`AppPickerPopover`,
  select a configured Omi "app"/assistant persona), model indicator chip (hardcoded `"Claude"` —
  `ChatProvider.swift:1177-1179`), copy-conversation button (clipboard icon → checkmark for 2s),
  clear-chat button (trash icon, disabled while loading/clearing, spinner while clearing)
  (`ChatPage.swift:226-360`), and a gear button that posts `.navigateToAIChatSettings`.
- **Backend endpoints** (`APIClient.swift`): `GET/POST/DELETE v2/desktop/messages`,
  `PATCH v2/desktop/messages/{id}/rating`, `POST v2/messages/share`, `POST v2/files` (multipart),
  session CRUD at `POST/GET v2/chat-sessions`, `PATCH/DELETE v2/chat-sessions/{id}`,
  `POST v2/chat/initial-message`, `POST v2/chat-sessions/{id}` title generation.

### Windows — single implicit thread, no session chrome

- **No session list, no switcher, no starring, no rename, no per-session history UI of any
  kind.** `useChat.ts` resolves exactly one conversation id per hook lifetime based on a user
  preference (`getPreferences().chatHistoryMode`):
  - `'infinite'`: one stable id shared across app launches and across main/overlay windows, held
    in `localStorage[CHAT_INFINITE_ID_KEY]` (`useChat.ts:102-121`).
  - `'per-launch'`: a fresh UUID-based id every mount; `reset()` starts a new one
    (`useChat.ts:678-706`).
- **Persistence is local-only**: `window.omi.insertLocalConversation({..., kind: 'chat', ...})`
  writes to the local SQLite store (surfaced later in the Conversations list, not a "chat
  sessions" list), merged by message id in infinite mode (`useChat.ts:187-230`,
  `mergeChatMessages` in `lib/chatConversation.ts`). This is a fundamentally different data model
  from macOS's server-backed `v2/desktop/messages` / `v2/chat-sessions` — Windows chat threads are
  **not** synced to the backend as chat sessions at all; they ride the local recordings/
  conversations pipeline instead.
- **No app/assistant picker** — Windows chat always talks to the single default Omi assistant via
  `POST ${OMI_BASE}/v2/messages` (`useChat.ts:537-548`), a different endpoint family from macOS's
  `v2/desktop/messages` persistence + Node-bridge-driven turn execution.
- **No header at all** — Home.tsx's "chat" is a thread embedded in a hero page; there is no
  app-picker, model chip, copy button, clear-chat button, or settings gear anywhere near it. The
  only reset affordance is programmatic (`chat.reset()`, wired to the bar's Esc — outside this
  doc's scope).
- **No rating UI** — no thumbs up/down anywhere.
- **No copy-message / copy-conversation button.**

### Verdict — session/thread UI: **missing**

Windows has no session concept, no history UI, no app picker, no header controls, and a
completely different (local-SQLite vs. backend-session) persistence model. This is the largest
structural gap after rich content rendering.

---

## 5. All states

| State | macOS | Windows |
|---|---|---|
| **Empty/welcome** | `welcomeMessage` panel (`ChatPage.swift:395-451`): centered card, `omiPanel` (28pt radius, `backgroundSecondary.opacity(0.82)`, subtle border/shadow), 64×64 (per-app) or 48×48 (`herologo.png`, default) icon, "Chat with {app/omi}" 18pt semibold title, description text. Shown only when `messages.isEmpty` and no load error. | A giant `"Hi, {firstName}"` H1 (`font-display text-4xl font-semibold`), centered, `fade-in-slow` (0.9s, 0.4s delay) — no icon, no description, no "chat" framing at all; this is a greeting screen, not a chat-empty-state card (`Home.tsx:529-533`). |
| **Loading initial** | Centered `ProgressView` + `"Loading..."` 13pt tertiary text, `.padding(.vertical, 80)` — shown while `isLoading || isLoadingSessions` and `messages.isEmpty` (`ChatMessagesView.swift:531-540`). | **None.** `chat.history` starts `[]` and the async local-conversation load (`useChat.ts:156-182`) has no loading indicator — the greeting/empty state is indistinguishable from "still loading history." |
| **Streaming** | Per-message `TypingIndicator` (empty message) or trailing indicator after partial content; tool-call spinners; see §3. | Three-dot `typing-dots` when content is empty + `chat.sending`; char-reveal animation once content starts arriving (§3). No tool/thinking indicators (no tool-call path in normal chat). |
| **Error (generic)** | `ChatErrorCard` (structured) + legacy banner, both described in §3; distinguishes auth/timeout/bridge-unavailable/interrupted/no-data-found with tailored CTAs. | Plain assistant-bubble text, no retry button, no error taxonomy (§3). |
| **Quota exceeded** | `showOmiThresholdAlert` — native SwiftUI `.alert`, "Upgrade Required" / "Upgrade to Omi Pro for $199/month to continue chatting" with an "Upgrade to Omi Pro" button opening `omi.me/pricing`, or "Later" to dismiss (`ChatPage.swift:128-140`). Triggered inline from `sendMessage`'s error handling (3 call sites in `ChatProvider.swift`: `:2676`, `:3858`, `:4827`). | Decoupled `UsageLimitPopup` triggered post-hoc by `UsageLimitTriggerHost` polling quota on the sending→idle edge (not from the failing response itself) — explicitly a placeholder pending a real signal (§3). Not an inline chat-card/alert at the point of failure. |
| **Offline / network failure** | No dedicated offline UI found; network failures surface through the generic `BridgeError`/`errorMessage` path (bridge is a local Node subprocess, not a direct network call from the SwiftUI layer for the main chat turn). | No dedicated offline UI either — a failed `fetch` to `/v2/messages` falls into the generic `catch` → `"Error: ${e.message}"` bubble (`useChat.ts:652-663`). Symmetric gap on both platforms. |
| **Interrupted/stopped** | `.interrupted` `ChatErrorState` — headline "Response stopped", CTA "Try a different question" (dismiss-only) (`ChatErrorCard.swift:145-149`, `:169-173`). Also a dedicated Stop button mid-stream (`ChatInputView`'s `stop.circle.fill`). | No Stop button in the main composer at all (§2) and no distinct "interrupted" message state — `reset()` just aborts the fetch and clears history/latch silently (`useChat.ts:680-706`), no bubble is left behind. |

### Verdict — states: **major drift / missing**

Loading, quota, and interrupted states are meaningfully different or absent; offline handling is
symmetrically weak on both platforms (not a Windows-specific gap).

---

## 6. Animations (durations/curves)

| Element | macOS | Windows |
|---|---|---|
| Jump-to-bottom button appear/mode change | `.easeInOut(duration: 0.2)`, `.scale.combined(with: .opacity)` transition (`ChatMessagesView.swift:673`) | No explicit transition class on the `Latest` button (plain conditional render) |
| Jump-to-bottom "activity" pulse | `.easeInOut(duration: 0.3)` on `hasActivityBelow` (`:674`) | N/A — Windows button has no activity-pulse state |
| Timestamp hover reveal | `.easeInOut(duration: 0.12)` (`ChatBubble.swift:314`) | N/A (no timestamps rendered) |
| Rating "Thank you!" feedback | `.easeInOut(duration: 0.2)`, auto-hides after 2s (`ChatBubble.swift:357`, `:360-364`) | N/A (no rating UI) |
| Copy-message checkmark | flips icon for 1.5s, no explicit curve specified (`ChatBubble.swift:373-375`) | N/A (no copy-message UI) |
| Copy-conversation checkmark | flips for 2s (`ChatPage.swift:490-493`) | N/A |
| Tool group / card expand-collapse | `.easeInOut(duration: 0.2)` (`ChatBubble.swift:1139`, `:1298`) or `0.18` for spawn/completion cards (`:538`, `:561`, `:750`, `:773`) | N/A (no tool-call UI) |
| Thinking-block expand | `.easeInOut(duration: 0.2)` (`ChatBubble.swift:1585`) | N/A |
| Streaming typing indicator | 8-dot ring, `.linear(duration: 0.9).repeatForever(autoreverses: false)` (`TypingIndicator.swift:19`) | 3-dot stagger, `1.2s ease-in-out infinite`, 0.15s/0.3s child delays (`globals.css:478-487`) |
| Message entrance | **none explicit** — SwiftUI's default insertion (no `.transition` on bubble rows) | `.bubble-in`: `translateY(8px) scale(0.985)` → identity, **0.38s** `cubic-bezier(0.22,1,0.36,1)` (`globals.css:449-463`) — a Windows-only polish macOS's list doesn't have |
| Hero → thread layout split | N/A (no hero layout) | Grid-row morph **1000ms** `cubic-bezier(0.4,0,0.2,1)` (`Home.tsx:412-413`), staggered 150ms lead-in before the split, thread reveal at `150+1000`ms (`:311-325`); widget-row reveal `600ms cubic-bezier(0.4,0,0.2,1)` transform+opacity (`:436-441`) |
| Greeting / composer fade-in | N/A | `fade-in-slow`: `0.9s ease-out`, `0.4s` delay (`globals.css:415-418`), applied to the H1 greeting and to the composer wrapper |

### Verdict — animations: **different design language, not a strict port**

macOS's chat surface is largely non-animated chrome with small interaction-feedback transitions
(0.12–0.3s eases on hover/expand/copy states). Windows invested in a distinctive hero-to-thread
choreography macOS's `ChatPage` doesn't have, at the cost of the many small per-element
transitions (rating feedback, copy feedback, expand/collapse) that don't exist because the
underlying UI elements themselves don't exist yet.

---

## 7. Data / wiring

### macOS

- **State owner**: `ChatProvider` (`@MainActor class ChatProvider: ObservableObject`,
  `Desktop/Sources/Providers/ChatProvider.swift`, 6163 lines). `ChatProvider.mainInstance` is a
  weak static ref used by the in-process automation bridge (INV-6, see `desktop/macos/AGENTS.md`
  → "Chat Continuity Write-Path Contract").
- **Turn execution**: **not** a direct backend SSE call from Swift. Chat runs through a local
  Node.js "bridge" subprocess (`AgentBridge.swift`, `AgentRuntimeProcess.swift`,
  `AgentClient.swift`) implementing one of several harness modes exposed via
  `ChatProvider.BridgeMode`: `omiAI`/`piMono` (Omi-managed Claude, the default —
  `@AppStorage("chatBridgeMode")`), `userClaude` (user's own Claude Code auth), `hermes`,
  `openClaw` (`ChatProvider.swift:1033-1048`). `currentModel` is hardcoded to the literal string
  `"Claude"` regardless of harness (`:1177-1179`).
  - Streaming content arrives as **local bridge callbacks**, buffered/coalesced by
    `ChatStreamingBuffer` (flush-interval batched text/thinking deltas,
    `Chat/ChatStreamingBuffer.swift`) rather than raw network SSE frames.
  - `ChatTurnLifecycle` (new since baseline — see §8) is the single source of truth for whether a
    turn `.active`/`.completed`/`.revoked(reason)`, explicitly kept independent of analytics so a
    stopped/timed-out turn can never be made authoritative by disabling telemetry
    (`Chat/ChatTurnLifecycle.swift:9-46`).
- **Persistence** (`APIClient.swift`, `extension APIClient` "Chat Messages API" /
  "Chat Sessions API"):
  - `GET/POST v2/desktop/messages` (list/save), `DELETE v2/desktop/messages` (clear),
    `PATCH v2/desktop/messages/{id}/rating`, `POST v2/messages/share`, `POST v2/files` (multipart
    attachment upload).
  - `POST v2/chat-sessions` (create), `GET v2/chat-sessions` (list, `starred` filter),
    `PATCH v2/chat-sessions/{id}` (rename/star), `DELETE v2/chat-sessions/{id}`,
    `POST v2/chat/initial-message` (session greeting), title-generation via
    `POST v2/chat-sessions/{id}` variant (`generateSessionTitle`, `APIClient.swift:5660-5680+`).
  - `saveMessage` is called from **5 distinct sites** across the send lifecycle (user message at
    turn start, AI message from a synthesized response, the "critical" streamed-AI-message save,
    a partial-on-error save, and a follow-up save) — the file has extensive inline comments
    numbering these sites because of historical duplicate-turn bugs (see §8 delta:
    `e100f522a "evict applied-turn keys oldest-first to prevent duplicate chat turns (INV-6)"`).
- **New/changed support types since baseline** (§8): `ChatDraftStore` (per-scope local draft
  persistence — main chat / floating / onboarding / per-agent / per-task — atomically-replaced
  files under Application Support, coalesced writes, `ChatDraftStore.swift`), `ChatQueryTelemetry`
  (432 lines, new), `ChatTurnLifecycle` (new, above), `PermissionRequestAuthorization` (new,
  consent-gated permission requests), `WritingToolsFix` (new, small).
- **Not a raw SSE/WebSocket consumer** for the main chat surface at the SwiftUI layer — this is
  the key architectural fact for porting: Windows's `/v2/messages` SSE stream is the **backend**
  chat endpoint, but macOS's main chat does NOT call it directly; it goes through the local Claude
  Agent SDK bridge process instead. `POST v2/messages` / `POST v2/chat/initial-message` and the
  bridge are two different systems macOS uses for different purposes.

### Windows

- **State owner**: `useChat()` hook (`hooks/useChat.ts`), instantiated once in
  `AppStateProvider`/`state/appState` and shared app-wide (`useAppState().chat`) — this is
  **the single chat engine** (INV-CHAT-1 parity comment: "this hook is the app's single chat
  engine now (the bar is a viewport over it via the main-process bridge)",
  `useChat.ts:154-156`). `Home.tsx` and `BarChatSurface.tsx` both read/write the same instance.
- **Turn execution**: a direct authenticated `fetch` SSE-style stream to
  **`POST ${OMI_BASE}/v2/messages`** (`useChat.ts:537-548`) — i.e. Windows talks to the
  **same backend endpoint family** macOS's Flutter/mobile client would use, not the Node-bridge
  path macOS desktop uses. Headers include `X-App-Platform: windows` (parity with mac/Flutter's
  own platform header) and a bearer Firebase ID token.
  - **Frame format**: newline-delimited `data: <chunk>` lines; `think:`-prefixed payloads are
    ephemeral status and dropped; a terminal `done:` line carries a base64 `ResponseMessage` with
    citation-stripped text + server id + citations + chart data + NPS flag
    (`lib/messagesSse.ts` `parseDoneMessage`, referenced `useChat.ts:568-616`); reply newlines are
    encoded as the literal token `__CRLF__` and restored client-side (`:559-565`).
  - **180s watchdog** (`CHAT_STREAM_TIMEOUT_MS`, `useChat.ts:38`) explicitly documented as mirroring
    "the macOS client's per-send watchdog (ChatProvider.swift)".
  - **Generation counter + `AbortController`** (`genRef`/`abortRef`) guards against a
    dismissed/reset turn writing stale state — the code comments extensively describe this as
    preventing a "C5 zombie-reply" class of bug, i.e. **the same problem class** macOS's
    `ChatTurnLifecycle`/`sendGeneration` machinery exists to solve, independently re-derived on
    Windows.
- **Persistence**: **local SQLite only**, via `window.omi.insertLocalConversation` /
  `getLocalConversation` (Electron main-process IPC), stored as a `kind: 'chat'` local
  conversation, merged by message id in `'infinite'` mode. **No backend chat-session or
  chat-message persistence endpoints are called at all** — this is a fundamentally different
  wiring model from macOS's `v2/desktop/messages`/`v2/chat-sessions`.
- **No local bridge / agent-SDK process** for normal chat — the delegated coding-agent path
  (`tryAgentTask`) is a separate, explicitly-named-agent-triggered flow (`window.omi.codingAgentRun`,
  IPC to a main-process agent runner), not the default chat path.
- **Pre-send context gathering**: Windows prepends ambient context (current-screen OCR text via
  `readCurrentScreen()`, local knowledge-graph context via `gatherLocalContext()`) to the
  **outgoing** text (not the persisted/displayed text) before every send
  (`useChat.ts:519-536`) — no direct macOS main-chat equivalent was found in the files read for
  this pass (macOS's screenshot-context injection lives in the floating-bar system prompt prefix,
  out of scope here).

### Verdict — data/wiring: **major drift (different architecture, not just a styling gap)**

This is not portable by re-skinning components: Windows chat is a thin client of the **public**
`/v2/messages` streaming endpoint with local-only persistence, while macOS chat is a client of a
**local Node bridge process** running the Claude Agent SDK, backed by dedicated
`v2/desktop/messages` + `v2/chat-sessions` persistence endpoints. Porting the *Bridge* architecture
itself is a separate, much larger undertaking than porting the UI documented in §1–§6.

---

## 8. Delta since baseline (`0d09ede61b7` v0.12.66, 2026-07-09 → `v0.12.72+12072-macos`, 2026-07-12)

```
git -C C:\Users\chris\projects\omi log --oneline 0d09ede61b76dc4a144d05809432bf220394ee3a..v0.12.72+12072-macos -- desktop/macos
```
returns 288 commits touching `desktop/macos` broadly. Filtered to chat-relevant paths
(`Desktop/Sources/Chat/**`, `MainWindow/Components/Chat*.swift`, `MainWindow/Pages/ChatPage.swift`,
`Providers/ChatProvider.swift`, plus sibling files `CitationCardView.swift`,
`SelectableMarkdown.swift`, `ChatScrollBehavior.swift`, `ChatSessionsSidebar.swift`,
`TaskChatPanel.swift`):

```
20 files changed, 2476 insertions(+), 250 deletions(-)
```

**New files** (did not exist at baseline):
- `Chat/ChatDraftStore.swift` (223 lines) — per-scope local draft persistence.
- `Chat/ChatQueryTelemetry.swift` (432 lines) — query-outcome analytics (see
  `desktop/macos/AGENTS.md` → "Product analytics integrity": exactly one terminal outcome per
  query, revoked/timed-out turns can't apply late results even with analytics disabled).
- `Chat/ChatTurnLifecycle.swift` (128 lines) — turn state authority (`.active`/`.completed`/
  `.revoked`), described in §7.
- `Chat/PermissionRequestAuthorization.swift` (141 lines) — consent-gated agent permission
  requests surfaced in chat.
- `Chat/WritingToolsFix.swift` (14 lines) — small `.writingToolsBehavior`-related fix.

**Files unchanged in this window** (i.e. NOT part of "the recent overhaul" — already stable at
baseline v0.12.66, so everything documented in §1–§4 above from these files reflects
**pre-existing, not new**, UI): `ChatBubble.swift`, `ChatErrorCard.swift`, `ChatErrorState.swift`,
`ChatResource.swift`, `ChatAttachment.swift`, `ChatContentBlockCodec.swift`,
`ChatContinuityInvariants.swift`, `ChatScrollBehavior.swift`, `CitationCardView.swift`,
`SelectableMarkdown.swift`, `ChatSessionsSidebar.swift`, `TypingIndicator.swift`.

**Files with substantial changes**:
- `Providers/ChatProvider.swift`: **+1087/−[large]** (net ~1087 lines added) — by far the largest
  delta. Bulk of the 288-commit window's chat work landed here: duplicate-turn eviction (INV-6:
  `e100f522a "evict applied-turn keys oldest-first to prevent duplicate chat turns"`), truthful
  chat/gateway outcome telemetry (`4d711b4db "make chat and gateway outcomes truthful"`), routing
  originating user text through runtime context (`34e42e25d`), agent-control-contract enforcement
  (`ed106449d`), main-agent permission gating (`62488d3e8`), PTT turn-continuity fixes
  (`76ebc6602`, `d403072df`), stall-recovery deadlock fix (`b9df473f1`, off-actor SIGCONT so
  `DebugSuspendControl` can't self-deadlock), chat-bridge mode-switch timeout bounding
  (`607ff6a47`, `dfc4b3f14`), draft persistence + flush-before-termination
  (`72051e7ec`, `f83e70cf1`), fail-soft/health-event observability
  (`474c3a99f "fail-soft fallbacks with health-event observability"`).
- `Chat/AgentRuntimeProcess.swift`: +292 lines — bridge process lifecycle hardening.
- `MainWindow/Components/ChatMessagesView.swift`: +139/−~30 — includes
  `44633aeb6 "Fix chat scroll-jump on load-earlier and PTT dropping repeated words"` and
  `4a334c095 "Fix dead prepend-anchor restore in ChatMessagesView"` — i.e. the prepend-anchor
  restore logic documented in §1 (`ChatMessagesView.swift:418-447`) was itself buggy and fixed
  inside this window.
- `MainWindow/Components/TaskChatPanel.swift`: +169/−16 (out of scope — sidebar task chat, not
  main `ChatPage`, but noted since it shares `ChatInputView`/`ChatMessagesView`).
- `Chat/KernelTurnProjection.swift`, `Chat/AgentBridge.swift`, `Chat/AgentControlService.swift`,
  `Chat/AgentClient.swift`, `Chat/AgentRuntimeStatusStore.swift`, `Chat/StallDetector.swift`,
  `Chat/ChatPrompts.swift`, `Chat/ChatStreamingBuffer.swift` (+10 lines), `Chat/
  DesktopCapabilityRegistry.swift`, `Chat/ScreenContextTelemetry.swift`: smaller, mostly
  reliability/telemetry/permission-contract changes, not visual.

**Conclusion**: the "recent overhaul" referenced in the assignment brief, as far as *this* window
is concerned, is a **reliability/continuity/telemetry hardening pass** (duplicate-turn prevention,
truthful outcome telemetry, stall-recovery, mode-switch bounding, permission gating, draft
persistence) — **not** a visual redesign of bubbles/composer/error-cards, which were already at
their current shape before v0.12.66. Anyone porting the *visual* spec in §1–§6 should treat it as
the long-stable Mac chat design, while anyone porting the *reliability* contracts in §7 should
budget for the 1087-line `ChatProvider.swift` delta and its associated INV-6 write-path rules
(`desktop/macos/AGENTS.md` → "Chat Continuity Write-Path Contract (INV-6)").

---

## 9. Windows comparison — summary table

| Element | Rating | Notes |
|---|---|---|
| Main-window Chat as a distinct surface | **missing** | No `/chat` route; redirects to `/home`. No sidebar nav entry. |
| User bubble shape/radius | major drift | Windows: white fill, `rounded-[18px] rounded-br-[6px]`, no avatar. macOS: purple `userBubble` fill, uniform 20pt radius, person-icon avatar. |
| Assistant bubble | major drift | Windows: no bubble, avatar + open text ("document" style). macOS: tinted bubble (or content-block cards) + avatar. |
| Avatars | major drift | Windows: 44×44 white badge, assistant only. macOS: 32×32 for both sides, app-specific images supported. |
| Timestamps | missing | Windows renders none; macOS shows hover-reveal time+date. |
| Day separators | identical (both absent) | Neither platform has them. |
| Duplicate-message collapsing | missing | macOS-only. |
| Long-message truncation ("Show more") | missing | macOS-only. |
| Scroll-follow state machine (2-mode, wheel-detection, throttled re-pin) | minor drift | Faithful structural port; wrapped in an extra hero-layout animation macOS lacks. |
| Load-earlier-messages | major drift | Windows: client-side windowing over already-fetched local history. macOS: real server-paginated fetch. |
| Jump-to-latest button | minor drift | Present both sides; Windows lacks the "new activity" pulse animation. |
| Composer surface (radius/color/shadow) | minor drift | Same design tokens (ported), Windows composer simplified to a single row. |
| Multi-line input | missing | Windows composer is a single-line `<input>`; macOS uses an auto-growing `NSTextView`. |
| Attachments (paperclip, drag-drop, previews) | missing | macOS-only. |
| Stop/cancel mid-stream button | missing | macOS-only. |
| Ask/Act mode toggle | missing | macOS-only (also off by default). |
| Inline voice toggle in composer | Windows-only addition | Not present in macOS's main-chat composer (macOS's voice/PTT lives in the floating bar, out of this doc's scope). |
| Markdown rendering | minor drift | Both render markdown; Windows adds a char-reveal animation macOS doesn't have, macOS adds cross-paragraph text-selection engineering Windows gets for free via the browser. |
| Citations UI | missing | Data (`citations`) is fetched but never rendered on Windows. |
| Charts | missing (both, functionally) | macOS: no chart UI found either. Windows: data captured, explicitly marked "no chart UI yet." |
| Tool-call / agent activity cards | missing | macOS-only; Windows's coding-agent path composes one plain-markdown bubble with no structured cards. |
| Thinking block | missing | macOS-only. |
| Discovery card | missing | macOS-only. |
| Agent spawn/completion cards + link-out | missing | macOS-only. |
| Resource/artifact cards | missing | macOS-only (also: Windows has no attachment upload to produce user-side resources). |
| Streaming typing indicator | minor drift | Both present; different visual (8-dot ring vs. 3-dot stagger) and different code but equivalent trigger. |
| Structured per-failure-class error cards | missing | macOS-only (`ChatErrorCard` + 5-case `ChatErrorState` taxonomy); Windows renders raw error text as an assistant bubble. |
| Quota-exceeded UX | major drift | macOS: inline alert triggered from the failing send. Windows: decoupled post-hoc popup polling quota after any send completes (explicitly a placeholder). |
| Offline handling | identical (both weak) | Neither platform has a dedicated offline state; both fall into generic error text. |
| Loading-initial-history state | missing | Windows shows nothing distinct from the empty/greeting state while history loads. |
| Empty/welcome state | major drift | macOS: app-branded card with icon/title/description. Windows: a bare "Hi, {name}" greeting with no chat framing. |
| Session list / switcher / starring / rename | missing | macOS-only (gated behind `multiChatEnabled`, off by default, but present). |
| App/assistant picker | missing | macOS-only. |
| Copy message / copy conversation | missing | macOS-only. |
| Rating (thumbs up/down) | missing | macOS-only. |
| Chat header (any controls) | missing | Windows has no header near the thread at all. |
| Backend persistence model | major drift (architectural) | macOS: `v2/desktop/messages` + `v2/chat-sessions` (server-backed sessions). Windows: local SQLite conversation, no backend chat-session persistence. |
| Turn execution architecture | major drift (architectural) | macOS: local Node/Claude-Agent-SDK bridge process. Windows: direct `fetch` SSE stream to `POST /v2/messages`. |
| Draft persistence | not compared (out of file-read scope for Windows) | macOS has `ChatDraftStore` (new this cycle); Windows equivalent not located in files read for this pass — flag for follow-up. |
| Design tokens (colors, radii, shadows) | minor drift / good-faith port | Windows `globals.css` explicitly ports macOS's `OmiColors`/`OmiChrome` ramp 1:1 for backgrounds/text/radii, substituting white for macOS's purple accent per `INV-UI-1` ("never use purple") — note macOS's own chat surface still uses `OmiColors.purplePrimary`/`userBubble` (a violation-by-grandfather of its own now-enforced rule; INV-UI-1 is a no-*increase* ratchet, not a full ban on existing purple). |

---

## Key file references

**macOS** (`C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos\Desktop\Sources\`):
- `MainWindow/Pages/ChatPage.swift` — page shell, header, welcome state, sheets/alerts, app
  picker, history popover.
- `MainWindow/Components/ChatMessagesView.swift` — scroll list, scroll-mode state machine,
  agent-lifecycle display projection.
- `MainWindow/Components/ChatBubble.swift` — bubbles, tool/thinking/discovery/agent cards, status
  icons, markdown themes.
- `MainWindow/Components/ChatInputView.swift` — composer, attachments, Ask/Act toggle.
- `MainWindow/Components/ChatScrollBehavior.swift` — `NSScrollView` scroll/user-input detection.
- `MainWindow/Components/SelectableMarkdown.swift`, `MainWindow/Components/CitationCardView.swift`.
- `MainWindow/Pages/ChatErrorCard.swift`, `Chat/ChatErrorState.swift`.
- `Chat/ChatResource.swift`, `Chat/ChatAttachment.swift`, `Chat/TypingIndicator.swift`,
  `Chat/ChatContinuityInvariants.swift`, `Chat/ChatStreamingBuffer.swift`,
  `Chat/ChatTurnLifecycle.swift`, `Chat/ChatDraftStore.swift`.
- `Providers/ChatProvider.swift` — state owner, bridge modes, send/persist lifecycle.
- `APIClient.swift` (chat/session endpoint extensions, ~lines 5195–5690).
- `Theme/OmiColors.swift`, `Theme/OmiChrome.swift` — color/radius tokens.

**Windows** (`C:\Users\chris\projects\omi\.worktrees\mac-ui-refresh\desktop\windows\src\renderer\src\`):
- `pages/Home.tsx` — the actual main-window chat surface (hero layout + thread + composer).
- `hooks/useChat.ts` — chat engine (send/stream/persist/reset), shared app-wide.
- `components/chat/RevealMarkdown.tsx` — streaming markdown reveal.
- `components/chat/ChatMessages.tsx`, `components/bar/BarChatSurface.tsx` — bar-only, out of
  scope, listed for completeness.
- `components/layout/Sidebar.tsx`, `components/layout/MainViews.tsx` — confirms no Chat nav/route.
- `components/settings/billing/UsageLimitTriggerHost.tsx`,
  `components/settings/billing/UsageLimitPopup.tsx` — quota UX.
- `lib/chatConversation.ts`, `lib/chatStorageKeys.ts`, `lib/messagesSse.ts` (referenced,
  not fully read) — local persistence + SSE frame parsing.
- `styles/globals.css` — ported design tokens (lines ~36–110) and chat animation keyframes
  (`bubble-in`, `typing-dots`, `fade-in-slow`, `widget-fade`, lines ~414–500).
