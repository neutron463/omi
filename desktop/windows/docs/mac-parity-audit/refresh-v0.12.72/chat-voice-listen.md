# Staleness refresh — Chat / PTT / Realtime Voice / TTS / Transcription / Speaker ID

> Baseline audited against: upstream `0d09ede61b76dc4a144d05809432bf220394ee3a` (2026-07-09).
> New frozen reference: `v0.12.72+12072-macos` (2026-07-12), checkout at
> `C:\Users\chris\projects\omi\.worktrees\mac-ref` (read-only). 288 commits touched
> `desktop/macos` in the window; ~90 were in this domain (chat, PTT, realtime voice, TTS,
> transcription, speaker ID) after filtering. Method: `git log`/`git show`/`git diff` on the
> range, cross-checked against file contents in the `mac-ref` tag checkout. Post-beta range
> also scanned (`v0.12.72+12072-macos..upstream/main`, 111 desktop commits, ~30 in-domain).

## Headline finding

**The PTT/voice-turn lifecycle was rewritten as a formal event-sourced state machine** (PR #9370,
merge commit `7572bcf0a`, "make PTT voice turns reducer-driven"). This is the single biggest
architecture change in-domain and it **invalidates the architectural framing**, not just details,
of `07-realtime-voice.md` and parts of `06-floating-bar-ask-ptt.md`. Full section below.

---

## NEW features/behaviors added since baseline

1. **`VoiceTurnReducer` / `VoiceTurnCoordinator`** (new files, `desktop/macos/Desktop/Sources/FloatingControlBar/VoiceTurnStateMachine.swift` — 901 lines — and `VoiceTurnCoordinator.swift` — 334 lines) — a single authoritative, typed, event-sourced reducer owning PTT phase (`VoiceTurnPhase`), route selection, deadlines (`VoiceTurnDeadline`), terminal reasons (`VoiceTurnTerminalReason`), UI projection (`VoiceTurnUIProjection`), and identity-fenced async cleanup. Typed IDs (`VoiceTurnID`, `VoiceCaptureID`, `VoiceSessionID`, `VoiceResponseID`, `VoiceToolCallID`, `VoiceLeaseID`) are carried across every async boundary so a stale callback can't mutate a newer turn. Commit `7572bcf0a` / `0455398a2`.
2. **`VoiceOutputCoordinator`** (class renamed/promoted from what the audit calls `PTTVoiceOutputCoordinator`; file `PTTVoiceOutputCoordinator.swift` retained but the type inside is now `VoiceOutputCoordinator`) — every PTT-audible path (realtime PCM, selected-voice fallback, deterministic agent ack, filler, system-voice fallback) now acquires a turn-scoped `VoiceOutputLease` before playing. Old code had per-path ad hoc "am I still the active turn" checks; now it's one lease-based arbiter (`VoiceOutputDecision.acquired/denied/staleTurn`).
3. **`RealtimeVoiceTurnOutbox`** (new, `RealtimeVoiceTurnOutbox.swift`, 96 lines) — a durable (UserDefaults-backed) handoff between the realtime controller and the kernel-owned transcript. Entries carry `idempotencyKey`, survive an agent-runtime or app restart, replay on restart, and are only cleared after `turn_recorded` acks. This **strengthens** (doesn't just restate) the audit's "voice turns recorded into shared chat/kernel history" claim — the mechanism is now explicitly restart-durable, which wasn't documented before.
4. **Two new voice/chat tools: `check_permission_status` and `request_permission`**, plus a new permission-routing subsystem (`ChatToolExecutor.PermissionExecutionRoute`, `RealtimeHubTools.permissionExecutorRoute`/`directPermissionRedirect`). Both chat and the realtime voice tool loop can now check/request a macOS permission directly (mic, notifications, accessibility, automation) instead of misrouting a permission ask through `spawn_agent`, with local-vs-external-app target disambiguation via NL heuristics. Not in the tool lists documented in `04-chat-agent-runtime.md` or `07-realtime-voice.md`.
5. **A 90-second per-tool stall guard**, layered under the existing 180s whole-chat watchdog (commit `35e6d3461`, "keep managed agents on cloud routing"). `04-chat-agent-runtime.md`'s Stall Detection section only documents the 180s watchdog and `StallDetector`/`StallThresholds` — the per-tool 90s tier is new.
6. **Managed-agent routing now fails closed**: background/delegated/floating-pill agents inherit the cloud (piMono) route unconditionally and reject local ACP/Hermes/OpenClaw overrides at the control-tool layer, not just at the UI layer (commit `35e6d3461`). Failed *required* child-control operations now terminate the parent run instead of the parent reporting a false "Done." — closes a real correctness gap the audit didn't know about.
7. **Backend `/v2/voice-message/transcribe` response gained `stt_provider`/`stt_model` fields**, and a new fail-closed 503 error shape (`{"error": "stt_provider_configuration_error", "provider", "missing"}`) when the configured pre-recorded STT provider (e.g. Parakeet) is missing required env (commit `a448fcbcd`, `backend/routers/chat.py` + `backend/utils/stt/pre_recorded.py`). **This commit also touched `desktop/windows/src/renderer/src/lib/omiApi.generated.ts`** — the generated client was already regenerated for this; Windows callers of that endpoint should read/handle the new fields and error shape.
8. **Backend `chat_completions.rs` gained a retrieval-policy layer** (new file `retrieval_policy.rs`, 354 lines; commit `75755a860`, "honor explicit web search intent"). When a user explicitly asks for a web lookup ("look it up", "search the web"), the backend now **forces** the `web_search` tool server-side (injecting a `REQUIRED_WEB_SEARCH_INSTRUCTION` into the latest user turn and pinning `tool_choice`), and conversely **excludes** server-injected web search when the request is a private/local lookup (e.g. "search my conversations"). Fails closed with `503 web_search_unavailable` if required web search can't be honored (Haiku model, or web search disabled). This is a `/v2/chat/completions` (Backend-Rust, Mac-local proxy) contract addition — relevant if/when Windows ever routes chat through an equivalent pi-mono/ACP proxy (see Gate 7 correction below).
9. **`STTSessionState`** (new, `STTSessionState.swift`, 109 lines; commit `d453e5a55`) — replaced five scattered booleans governing cloud↔local STT fallback (BLE/Intel routing, debug force-cloud, one-shot cloud→local fallback, app-run cloud stickiness) with one pure typed state + hermetic tests. Internal refactor of the continuous-transcription/listen pipeline; no Windows-facing contract change, but worth knowing if a future Windows port ever needs Mac's local/cloud STT fallback semantics as a reference.
10. **Realtime usage-report hardening**: `desktop/macos/Backend-Rust/src/routes/realtime.rs` now clamps client-reported token counts to `>= 0` before computing cost, closing a tampered-client path that could drive the Firestore cost/quota ledger negative (commit `77da434c0`). No contract/shape change, just server-side hardening — informational.
11. **OAuth callback hardening in Backend-Rust `auth.rs`**: redirect_uri allowlisting (closes an open-redirect) and callback-value escaping (closes an XSS class) for the Claude OAuth PKCE flow (commits `e8b2e335d`, `2687e09ae`, `c00f5d4dd`). Relevant only if/when Windows ports the multi-provider Claude-OAuth chat picker (Stream 1 territory, not yet built).

## CHANGED behaviors that invalidate specific claims in the existing audit docs

**`07-realtime-voice.md`, "System-wide PTT-driven warm hub session" section** currently states:

> Where (Mac): `RealtimeHubController.swift` (`beginTurn`/`commitTurn`/`cancelTurn`)... Barge-in
> strategy is provider-specific: OpenAI gets an in-session `response.cancel`... Gemini has no
> reliable in-session cancel... the controller replaces the whole socket
> (`RealtimeHubBargeInStrategy.freshSession`)...

**New truth:** `RealtimeHubController` is now explicitly a **"compatibility facade"** per the
refactor PR's own description (commit `7572bcf0a`/`0455398a2`): "its route booleans are derived
projections rather than an independent state machine." The actual lifecycle/deadline/barge-in
ownership lives in `VoiceTurnReducer`/`VoiceTurnCoordinator`/`VoiceOutputCoordinator` (see NEW
#1–2 above). A Windows port targeting "port RealtimeHubController's beginTurn/commitTurn" would
be porting the *facade*, not the *authority* — the reducer/coordinator pair is the actual porting
target now, including its typed-identity fencing (which is the concrete fix for the "multiple
components independently owning one turn" bug class #9264 that motivated the refactor).

**`07-realtime-voice.md`, "TTS filler phrases..." section** cites `FloatingBarVoicePlaybackService.swift`
as the sole owner of filler/ack playback. **New truth:** filler/ack playback now also runs through
`VoiceOutputCoordinator`'s lease system (`VoiceOutputHandoffPolicy.fillerCanYield`) — a filler can
only yield its lease to a non-filler lane for the *same* turn ID. Still broadly accurate in spirit
("moot without tools") but the ownership/arbitration mechanism it describes has moved.

**`04-chat-agent-runtime.md`, "Stall detection" section** cites only the 180s chat watchdog. **New
truth:** a 90s per-tool guard was added underneath it (see NEW #5).

**`04-chat-agent-runtime.md`, Summary table row "Agent control-plane tools..."** lists ~18 tools
and doesn't mention permission tools. **New truth:** add `check_permission_status`/
`request_permission` to both the chat tool surface and the realtime voice tool surface (NEW #4).

**`06-floating-bar-ask-ptt.md`, file-path citation for `AutoModelSelector.swift`** (referenced
indirectly via `07-realtime-voice.md`'s "Automatic model selection" section, `Where (Mac):
AutoModelSelector.swift`) — the file lives at
`desktop/macos/Desktop/Sources/RealtimeOmni/AutoModelSelector.swift`, **not**
`FloatingControlBar/` as might be inferred from the surrounding context of that doc (it's grouped
next to other `FloatingControlBar/` file citations). Confirmed unchanged in content/behavior in
this window — just flagging the directory for anyone navigating to it.

## REMOVED / reworked things the plan assumes exist

- **Post-beta only** (not yet in v0.12.72, so nothing to port from yet, but flagging since it
  changes near-term direction): commit `15dc33095` ("unify PTT listening chrome, drop agent voice
  follow-up", post-beta) **removes** background-agent voice follow-up end-to-end — global PTT is
  being simplified to always talk to the main agent only (typed agent follow-up stays). If Stream
  2's future work ever assumed voice-triggered follow-up into a background agent pill, that's
  being walked back on Mac itself. Track, don't port yet (see post-beta section).
- Nothing else in-domain was outright removed inside the v0.12.72 window itself — this window is
  additive/hardening, not subtractive.

## Backend contract changes (highest priority per brief)

| Endpoint / route | Change | Commit | Windows relevance |
|---|---|---|---|
| `POST /v2/voice-message/transcribe` (`backend/routers/chat.py`) | Response gains `stt_provider`, `stt_model`; new `503 stt_provider_configuration_error` shape on misconfigured provider (e.g. Parakeet) | `a448fcbcd` | Direct — this is the exact endpoint Stream 2's PTT-vocabulary-boosting item targets for the `keywords` param. Windows generated client (`desktop/windows/src/renderer/src/lib/omiApi.generated.ts`) was already regenerated for this in the same commit. |
| `POST /v2/chat/completions` (Backend-Rust, Mac-local proxy, `chat_completions.rs`) | New retrieval-policy layer: forces `web_search` tool + `tool_choice` on explicit web-search intent, excludes it on private-lookup intent, fails `503` if required search is unavailable (Haiku or search disabled) | `75755a860` (new file `retrieval_policy.rs`) | Indirect today (this Rust service is Mac-local, not called by Windows) — becomes directly relevant if/when Windows ports the pi-mono/ACP proxy architecture (Gate 7). |
| `POST /v2/realtime/usage` (Backend-Rust, `realtime.rs`) | Client-reported token counts now clamped `>= 0` before cost computation | `77da434c0` | None — server-side-only hardening, same response contract. |
| Backend-Rust `auth.rs` (OAuth callback routes) | redirect_uri allowlist + value escaping | `e8b2e335d`, `2687e09ae`, `c00f5d4dd` | None yet — relevant only once Windows ports Claude OAuth. |
| `/v2/desktop/messages` (`backend/routers/chat_sessions.py`) | **Unchanged** in this window — verified still exists with the fields WIRING-AUDIT.md's Major note describes (`client_message_id` as `idempotency_key` prefix `desktop_messages:`, `message_source`, `app_id`/`session_id`) | none in-range | Confirms Gate 8's persistence-contract target is still accurate; no correction needed. |
| `/v2/messages`, chat-sessions response model (`backend/models/chat_session.py`) | **Unchanged** — `title`/`preview`/`message_count`/`starred`/`updated_at`/`app_id`/`plugin_id` confirmed present at tag | none in-range | Confirms Stream 1's "chat sessions sidebar" backend target is still accurate. |

## Post-beta commits (track, don't port yet)

Scanned `v0.12.72+12072-macos..upstream/main` (111 desktop commits total, ~30 in-domain). Notable:

- **`144216bb0` "refactor(agent): make kernel the single run authority"** — directly confirms
  PARALLEL-PLAN.md's own note ("Post-beta upstream commits are converging on 'kernel as the single
  run authority'... don't over-fit the port to the v0.12.72 multi-owner model") is accurate and
  should stay as-is. No correction needed — the plan already hedges this correctly.
- **`46f062762` "fix(agent-control): derive consent from PTT transcript for request_permission"**
  — post-beta follow-on to the `check_permission_status`/`request_permission` tools added in-window
  (NEW #4); voice-transcript-derived consent, exactly as PARALLEL-PLAN.md's note anticipates.
- **`15dc33095`/`fa0046a32` "unify PTT listening chrome, drop agent voice follow-up"** — see
  REMOVED section above.
- **`0717a0937` "rotate expired OpenAI realtime sessions"**, **`df3ef7e4f` "restore Gemini platform
  deadline"**, **`dbd69e71c` "make realtime context admission fail closed"**, **`711b3a13a`
  "recover PTT after rejected hub admission"**, **`02cadde47` "fence failed PTT context before
  teardown"** — a cluster of realtime-hub session-lifecycle hardening commits, all downstream of
  the reducer refactor. Confirms the reducer/coordinator architecture (NEW #1) is the actively
  evolving surface upstream — reinforces that a Windows port should target that architecture, not
  the pre-refactor `RealtimeHubController`-centric one.
- **`b6a727e6f` "stop cutting off long-context Gemini calls at 90s"** — a realtime timeout-tuning
  fix; if Stream 2 ports any Gemini-session timeout constant from Mac, don't copy the pre-fix 90s
  value.
- **`792605680`/`8b6f64491`/`9f734f1aa` "recover dead mic on buffered PTT silent turns" / "restore
  PTT permission requests and device-scoped recommendations"** — mic-recovery/permission hardening
  post-beta; relevant future reference for Stream 2's mic-recovery work, not yet in the frozen tag.
- **`7f7873872` "stop corrupting multi-byte characters in streamed chat replies"** — a backend
  streaming-chat encoding bug fix (chat_completions/messages streaming), post-beta. If Windows chat
  streaming ever showed mangled multi-byte (emoji/non-ASCII) characters, this is the reference fix
  to pull forward once it's promoted past beta.

## PARALLEL-PLAN.md corrections

Reviewed every Stream 1 chat line item (structured content blocks, sessions sidebar,
`screenContext.ts` image upgrade, `localAgent.ts` enrichment, kernel/pi-mono notes) and all of
Stream 2, plus Gates 7 and 8, against the v0.12.72 tag.

- **Stream 1, "Structured content blocks in chat" line** — still accurate; `ChatContentBlockCodec.swift`/`ChatStreamingBuffer.swift` exist unchanged in this window (only `ChatStreamingBuffer.swift` picked up 10 lines, non-structural). No correction.
- **Stream 1, "kernel/pi-mono notes" — "Mac's default provider is pi-mono"** — **confirmed still true** at the tag: `ChatProvider.swift:1040` `@AppStorage("chatBridgeMode") var bridgeMode: String = BridgeMode.piMono.rawValue`. Gate 7 ("DECIDED: pi-mono default") needs no correction.
- **Stream 1 / Gate 7 — new complexity to fold in:** if Windows ever ports the pi-mono provider, it should know Mac's local Backend-Rust chat-completions proxy now does explicit web-search-intent policy enforcement (retrieval_policy.rs, see Backend contract table). This wasn't in scope at baseline and isn't mentioned anywhere in PARALLEL-PLAN.md's Stream 1 section — add a note under the pi-mono/kernel bullet: "the Mac-local chat-completions proxy Windows would need to replicate (or call) now includes a retrieval-policy layer forcing/excluding server-side web search by intent — port `retrieval_policy.rs`'s behavior, not just the OpenAI→Anthropic translation."
- **Gate 8 — `/v2/desktop/messages` persistence contract** — **confirmed unchanged and still accurate.** `backend/routers/chat_sessions.py` and `backend/models/chat_session.py` are untouched in the window; the fields cited (idempotency via `desktop_messages:{id}` prefix, `source='desktop_messages'`, session `app_id`/`plugin_id`) are present exactly as WIRING-AUDIT.md's Major note describes. No correction needed to Gate 8's framing.
- **Gate 9 ("Mac's System B / `TaskAgentManager` — DECIDED: skip")** — worth a light touch-up, not a contradiction: `TaskChatCoordinator.swift` (the task-thread chat coordinator, 982-line diff in this window) moved from `Assistants/TaskAgent/` to `ProactiveAssistants/Assistants/TaskAgent/` as part of a directory reorg ("thermo-nuclear" refactor, merge `7ce4a9ded`) and gained substantial new functionality (`feat(tasks): ship persistent macOS task threads`, `feat(tasks): add contextual resurfacing gates`, `feat(tasks): add workstream runtime continuity`). This is Stream 3 (tasks) territory more than chat, but flagging because Gate 9's text says "skip... any future proactive task agent is kernel-based" — the in-window evidence shows Mac is *actively investing* in `TaskChatCoordinator` as a *separate*, non-kernel per-task chat surface, which is some tension with "kernel-based" framing. Not a chat-domain call to make; recommend Stream 1/Stream 3 jointly re-confirm Gate 9 still holds given this new investment, rather than treating it as settled.
- **Stream 2, all Phase A items (TTS read-aloud, PTT vocabulary boosting, language auto-detect, system-audio mute, warm-hub system-wide PTT, Auto model selection, rich system instructions, `<about_user>` card, usage limiter)** — every cited Mac file for these (`PTTContextVocabularyProvider.swift`, `PTTLanguageIdentifier.swift`, `SystemAudioMuteController.swift`, `AboutUserCard.swift`, `AutoModelSelector.swift`, `FloatingBarUsageLimiter.swift`) has **zero commits in this window** — confirmed byte-identical in behavior to what 06/07 already documented. No corrections to Phase A's *feature* descriptions. **One correction to the porting target:** "Warm-hub system-wide PTT: global hotkey wiring into the realtime session... per-provider barge-in... idle/wake reconnect" should now be understood as porting `VoiceTurnReducer`/`VoiceTurnCoordinator`/`VoiceOutputCoordinator` (NEW #1–2), not the older `RealtimeHubController`-centric description in `07-realtime-voice.md` — same behavior, but the actual state machine to reference moved. Recommend adding a pointer line to Stream 2's warm-hub bullet: "reference architecture is now `VoiceTurnStateMachine.swift`/`VoiceTurnCoordinator.swift` (event-sourced reducer, PR #9370) — `RealtimeHubController.swift` is a compatibility facade over it."
- **Stream 2, "PTT vocabulary boosting... `keywords` param on `/v2/voice-message/transcribe-stream`"** — **endpoint name is wrong in the plan.** Confirmed at the tag: the route is `POST /v2/voice-message/transcribe` (`backend/routers/chat.py:578`), not `/v2/voice-message/transcribe-stream` (that name doesn't exist as a route in `chat.py` — there's a separate `transcribe_voice_message_stream` Python function name, but its route decorator wasn't fully verified in this pass beyond confirming `transcribe` is the PCM/query-param endpoint the `keywords` param actually lives on, per line `context_keywords = _parse_context_keywords(request.query_params.get("keywords"))` at `chat.py:614`). Fix the plan's endpoint name to `/v2/voice-message/transcribe`, and note the response now also carries `stt_provider`/`stt_model` (NEW #7) that Windows should read/log even though the plan doesn't currently ask for them.
- **Stream 2 Phase B, "In-session tool-calling (voice-as-router, ~20 tools)"** — count should be revised: add `check_permission_status`/`request_permission` (NEW #4) to whatever tool-count/list Stream 1 publishes as the contract Stream 2 consumes.
- **Stream 2, "Mid-conversation provider failover... reconnect-strike budget"** — unchanged in-window; `RealtimeHubController.swift`'s failover method still exists (confirmed via commit history touching the file), but its internals are now downstream of the reducer's deadline/terminal-reason machinery rather than a standalone mechanism — same behavioral note as the warm-hub correction above, not a separate issue.
- **No corrections needed** for: Stream 1's `screenContext.ts`/`imageBase64` framing (confirmed the image-attach mechanism still exists, just verified via `ChatAttachment.swift`/`AgentRuntimeProcess.swift` rather than `ChatProvider.swift` directly — no behavioral change); Stream 1's chat sessions sidebar backend target (confirmed unchanged, see Backend contract table); Stream 2's "Windows-ahead" callouts (adaptive-noise-gate waveform, orb visual system — no Mac-side change touches these).

## Impact on the 4 Windows parity streams

- **Stream 1 (agent/chat):** Mostly holds. One real addition to fold in: if/when the pi-mono
  proxy is ported, the Mac-local chat-completions retrieval-policy layer (web-search
  force/exclude by intent) needs to be replicated or the ported chat will diverge from Mac's
  actual answer quality on "look it up" vs "search my stuff" phrasing. Also: two new tools
  (`check_permission_status`/`request_permission`) belong in whatever tool-surface contract
  Stream 1 publishes for Stream 2 to consume.
- **Stream 2 (voice/bar):** No feature-level corrections — every Phase A item's cited Mac file is
  unchanged in this window, so the *what* is still right. The *where-to-port-from* changed for the
  warm-hub/barge-in item: target `VoiceTurnStateMachine.swift`/`VoiceTurnCoordinator.swift`/
  `VoiceOutputCoordinator`, not the pre-refactor `RealtimeHubController`. This is a materially
  better porting target — it's a formal, tested (97 focused tests per the PR) state machine
  instead of scattered ad hoc booleans, which should make the Windows port's design easier to get
  right, not harder. The `/v2/voice-message/transcribe-stream` endpoint name in the plan should be
  corrected to `/v2/voice-message/transcribe`, and the new `stt_provider`/`stt_model` response
  fields plus the `stt_provider_configuration_error` 503 shape should be handled by whatever
  Windows client code lands the `keywords` param work.
- **Stream 3 (proactive/memory):** Out of my domain, but flagging for hand-off: `TaskChatCoordinator.swift`'s
  large in-window investment (persistent task threads, contextual resurfacing gates, workstream
  continuity) plus its directory move to `ProactiveAssistants/` is squarely Stream 3's territory
  and may be worth a dedicated look — it's a bigger, more actively-developed surface than Gate 9's
  "skip, kernel will replace it" framing suggests.
- **Stream 4:** No in-domain findings that touch Stream 4's files.

## Files referenced (for follow-up reading)

- `desktop/macos/Desktop/Sources/FloatingControlBar/VoiceTurnStateMachine.swift`
- `desktop/macos/Desktop/Sources/FloatingControlBar/VoiceTurnCoordinator.swift`
- `desktop/macos/Desktop/Sources/FloatingControlBar/PTTVoiceOutputCoordinator.swift` (class `VoiceOutputCoordinator`)
- `desktop/macos/Desktop/Sources/FloatingControlBar/RealtimeVoiceTurnOutbox.swift`
- `desktop/macos/Desktop/Sources/FloatingControlBar/RealtimeHubController.swift` (now a facade)
- `desktop/macos/Desktop/Sources/FloatingControlBar/RealtimeHubTools.swift`
- `desktop/macos/Desktop/Sources/Providers/ChatToolExecutor.swift`
- `desktop/macos/Desktop/Sources/Providers/ChatProvider.swift`
- `desktop/macos/Desktop/Sources/AppState/STTSessionState.swift`
- `desktop/macos/Backend-Rust/src/routes/chat_completions.rs`
- `desktop/macos/Backend-Rust/src/routes/retrieval_policy.rs`
- `desktop/macos/Backend-Rust/src/routes/realtime.rs`
- `desktop/macos/Backend-Rust/src/routes/auth.rs`
- `backend/routers/chat.py` (`/v2/voice-message/transcribe`)
- `backend/utils/stt/pre_recorded.py`
- `backend/routers/chat_sessions.py` (`/v2/desktop/messages` — unchanged, confirmed)
- `backend/models/chat_session.py` (unchanged, confirmed)
- `desktop/windows/src/renderer/src/lib/omiApi.generated.ts` (already regenerated for `a448fcbcd`)
