# Mac-Parity Execution Plan — Windows catches up to Mac beta (features + UI)

> **Goal (Chris):** bring the Windows app level with the macOS app's latest beta in **both features
> and UI — "same features, same design, everything."**
> **Frozen reference:** macOS tag **`v0.12.72+12072-macos`** (read-only checkout at
> `C:\Users\chris\projects\omi\.worktrees\mac-ref\desktop\macos`). Post-beta upstream commits are a
> tracked "don't port yet" list (one early cherry-pick excepted — see runbook).
> **Date:** 2026-07-14. Supersedes the 4-stream 2026-07-13 plan.
> **Inputs (ground truth, read before executing your track):**
> - Staleness audits: `refresh-v0.12.72/{chat-voice-listen, proactive-tasks-agents,
>   memory-rewind-capture, infra-auth-backend}.md` — newest truth; where they conflict with older
>   docs, they win.
> - Screen-by-screen UI specs: `../mac-ui-port/01..07-*.md` (acceptance criteria for UI work).
> - Windows adaptation charter: `../mac-ui-port/charter/01..04-*.md`.
> - Feature gaps: `00-INDEX.md`. Wiring correctness of shipped subsystems: `WIRING-AUDIT.md`.

---

## Default engineering posture (applies to every track)

**Rip Mac's code; don't re-derive it (ruling C).**
- Mac's **agent kernel, chat bridge, and intent routers are TypeScript** (the Node sidecar under
  `desktop/macos/agent/**`). Lift those source files nearly verbatim where the platform allows.
- From **Swift**: copy exact constants, hex values, spacing, durations/curves, copy strings, and
  state-machine structure; translate logic 1:1. Deviate only where the platform genuinely forces a
  different mechanism (CoreAudio→WASAPI, Keychain→DPAPI, SceneKit→three.js), then match the
  **behavioral contract**, not the API. A faithful behavior port — not a Swift-to-TS transliteration.
- **Where the wiring audit proved Mac wrong, the backend contract is the reference, not Mac** — e.g.
  goal-completion PATCH fields (C10: Windows' drive-to-target sim is correct, Mac 400/404s).

**Same, not ahead — for UI/UX (ruling A).** Where Windows built a different or "better" *surface*
than Mac (dedicated Goals page, continuous Rewind timeline, brain-graph look, richer what's-new
toast), the plan **replaces it with Mac's v0.12.72 design.**
- **Exception — internal engineering survives where the rendered result matches Mac:** adaptive
  noise-floor gate, outbox CAS+dedupe, per-size tray-icon rendering, local-KG schema superset,
  UI-automation planner, markdown link-safety, `SENSITIVE_WINDOW_MARKERS`, idle-capture-pause,
  off-thread KG worker. Keep the implementation; make the pixels match Mac.
- **Where dropping a Windows-only surface is a functional regression with no Mac equivalent**
  (meeting-detection toast — Mac has *zero* meeting UI), do **not** decide: it's a decision gate.

**⚠️ EXEMPTION — the floating bar / orb overlay keeps its Windows design (ruling, Chris 2026-07-14).**
Chris built the bar/orb deliberately and wants it kept mostly as-is. Consequences:
- Do **NOT** port Mac's notch-bar / floating-bar *visual* design to Windows. The bar's look, motion,
  and orb system stay Windows-native.
- Functional bar work continues (TTS read-aloud, agent pills, PTT depth, in-session tool-calling)
  but **builds on the existing Windows bar UI — adding capability without restyling it.**
- The **main-window** chat/Hub surfaces are NOT exempt — same-as-Mac applies there (the Home Hub's
  ask bar is a main-window surface, distinct from the floating bar).
- Where a Mac bar feature needs **new** bar UI (e.g. agent pills), match the **existing Windows bar's
  own design language**, using Mac only as a functional reference.

**Purple ports as-is (ruling B).** Mac's purple is copied faithfully — `#8B5CF6` accents
(`purplePrimary`), `#43389F` user bubble, `#7A4DF2` Home stage glow (`HomePalette.stageGlow`),
`Thing`-node purple in the brain graph, dark-purple speaker bubble.
- **This reverses Windows' current INV-UI-1 de-purpling** (`--accent: #ffffff`, `thing`=pink
  `#ff375f`, neutral speaker palette). The UI-port specs repeatedly say "substitute neutral / don't
  port the glow" — **ruling B overrides them: port the purple.**
- The **INV-UI-1 invariant doc + its guard test + the AGENTS.md line must be UPDATED in the first PR
  that introduces purple** (owned by Track 5, the design-tokens PR). Otherwise the no-increase
  ratchet fails CI. This is an explicit work item, not an afterthought.
- **⚠ Heads-up (see gate G-H):** upstream Mac itself **removed all purple right after the frozen
  tag** (post-beta neutral design system — infra audit §3c). Ruling B stands until Chris re-confirms
  it knowing this; G-H blocks only the purple portion of Track 5's tokens PR, nothing else.

**Frozen reference = v0.12.72 (ruling D).** Do not port post-beta upstream work. Each refresh audit
lists the post-beta "track, don't port yet" commits for its domain — read them so you don't
accidentally port a direction Mac later reversed (notably: Tasks-filter simplification `71cb9af64`,
kernel-single-authority `144216bb0`, settings declutter `891c26de2`).

---

## Launch runbook

**Already merged — do NOT redo (see per-track "DONE" lists):** `fix/windows-wiring-criticals`
(C1–C10 + reconnect/401/sign-out/outbox/tasks-pagination), `feat/windows-settings-parity`
(Plan & Usage, Transcription partial, Shortcuts, About, billing/usage-limit), the July-14 bugfix
batch (PRs #25/#26 + backend silent-stream-error fix).

**Pre-work PRs (small, land before the tracks that depend on them):**
1. **Regenerate `src/renderer/src/lib/omiApi.generated.ts`** — the fork's client is stale vs the tag
   on three contracts, and UI work will build against the wrong shapes otherwise:
   - Conversation mutations (`PATCH /v1/conversations/{id}/{title,starred,folder}`) now return
     `ConversationMutationResponse{status, conversation}`, not bare `{status}`/`FolderMutationResponse`.
     **Blocks Track 4 conversation-mutation UI.**
   - Memory edit/visibility (`PATCH /v3/memories/{id}`, `/visibility`) now take a
     `MemoryValueRequest{value}` JSON **body** (canonical); query param is deprecated compat.
     **Blocks Track 3 memory-edit.**
   - `POST /v2/voice-message/transcribe` gained `stt_provider`/`stt_model` + a
     `503 stt_provider_configuration_error` shape. **Track 2 should read/handle these.**
   - New `ConversationAudio` (merged-MP3 span manifest) type exists — no consumer yet; informational.
2. **Cherry-pick `a4c50bcb4`** ("cross-platform device provenance") — it contains ready-made,
   tested **Windows** client code (`lib/clientDevice.ts` + `omiListen.ts` header wiring +
   `apiClient.ts`/`types.ts` plumbing) that is **NOT in our fork's `main`** (verified). Unblocks
   Track 3's "This device" memory filter without re-implementing. Verify with
   `git branch --contains a4c50bcb4` before assuming it's absent.
3. **Windows platform gating — substance already DONE on fork main; do NOT cherry-pick `e2556479a`.**
   The fork independently merged the identical fix as **PR #23 (`45ff5dd32`,
   `DESKTOP_PLATFORMS={'macos','windows'}` SSOT + `should_show_new_plans`)** plus **PR #24
   (`81ff77531`, client-side legacy-catalog canary)**; cherry-picking `e2556479a` on top would
   conflict. Remaining action is verification only: re-check Windows' plan catalog + trial-paywall
   against the deployed backend's `should_show_new_plans`/`effective_desktop_access_tier` (Neo is now
   `desktop_free`, not zero-access), and confirm Windows' loopback OAuth callback matches the new
   backend `redirect_uri` allowlist (§1d infra).

**Sequencing:**
1. **Track 5 lands its design-tokens PR first** (Mac palette incl. purple + `HomePalette` + INV-UI-1
   doc/guard/AGENTS.md update + shared primitives) — unblocks purple everywhere and gives every
   track the token layer + `Modal`/`ContextMenu`/`Button`/`Card`/`Toggle` primitives to build on.
2. **Track 1 publishes its TypeScript interfaces in its first PR** (tool surface, content-block
   model, kernel session API, `<ChatMessages>` component, BYOK helper) so Tracks 2/6 code against them.
3. **Feature tracks (1–4) run in parallel** from that point.
4. **Track 6 goes wide after Track 5's tokens + primitives land** (its settings/onboarding/modal
   work depends on both).
5. **Per-surface UI + wiring land together** — never a big-bang UI swap detached from its data.
6. Each track lands its **additive** `main/ipc/db.ts` / `src/shared/types.ts` / `src/preload/index.ts`
   schema PR immediately (rules below). Pin every track to the `mac-ref` v0.12.72 checkout.
7. Provision per-track test accounts OR serialize live-test windows with mandatory fixture teardown
   — 6 tracks share ONE backend uid; interleaved chat threads / extractions are the top cross-track
   risk. Stagger CI pushes; branch each track from `origin/main` and rebase after every merge.

---

## The six tracks

### Track 1 — Agent Kernel & Chat Platform (`feat/win-agent-kernel`)
**Mission:** port Mac's TS agent kernel + control plane + pi-mono provider + the structured
content-block chat rendering and chat-sessions data layer. Everything Tracks 2/6 block on — staff first.

Ordered work items:
1. **Kernel (SQLite store).** Port `desktop/macos/agent/src/runtime/sqlite-store.ts` — **now ~2418
   lines / ~20 tables, NOT the 8-table subset the old plan named.** The 8 core tables
   (sessions/runs/adapter_bindings/run_attempts/events/artifacts/delegations/grants) are still the
   core, but **read the full current schema before finalizing** — it also has
   `desktop_context_packets`/`desktop_dispatches`/`desktop_artifact_deliveries`,
   `surface_conversations`/`conversation_turns` (chat-sessions/content-block adjacent — Track 1's own
   scope), `desktop_task_candidates`/`desktop_memory_candidates`/`desktop_context_access_log`/
   `desktop_attention_overrides`, workstream-continuity tables, `schema_migrations`. Today Windows has
   **no kernel persistence** (every task is a fresh `openBinding`; `resumeBinding` modeled, never called).
2. **Control plane — exactly 18 LLM-exposed control tools** (verified count in
   `agent/src/runtime/control-tool-manifest.ts`) injected regardless of provider, **plus the two new
   permission tools `check_permission_status` / `request_permission`** (route mic/notification/etc.
   permission asks directly instead of misrouting through `spawn_agent`). Real tool-policy engine
   replacing `toolPolicyStub.ts` — keep its host-owned-identity invariant (INV-AGENT (b)). The 5
   workstream-continuity control tools are host-only (not in the manifest) — Track 3 territory.
3. **Two distinct routers (port both, name them separately — the old plan conflated them):**
   - **Bar chat-vs-agent classifier** — `AgentPill.swift`'s real Haiku call
     (`claude-haiku-4-5-20251001`, 4s timeout, JSON `{route,title,ack}`). Windows' regex
     `detectAgentTask` should upgrade toward this.
   - **`routeDesktopIntent`** (`agent/src/runtime/desktop-intent-router.ts`) — a pure regex/heuristic
     function (no LLM) choosing `resume`/`fork`/`delegate`/`dispatch`/`quick_answer`/`new_run` among
     existing sessions. Different layer; port it too.
4. **Structured content blocks in chat (rendering).** One content-block model in `ChatMessages.tsx`:
   tool-call/thinking/discovery/agent-spawn+completion cards, markdown **GFM tables**, 8-dot typing
   ring, citation cards, resource/artifact strip, `ChatErrorCard` taxonomy (5 states). Match Mac's
   `ChatBubble.swift` visual spec (`../mac-ui-port/03-chat.md` §3). **Data plumbing is DONE** (C4:
   `done:` payload's `serverId`/`citations`/`chartData`/`askForNps` parsed + stored) — remaining scope
   is **rendering** those fields; `chart_data` UI is the only true residual.
5. **90s per-tool stall guard** under the existing 180s chat watchdog (C5 abort path is DONE:
   AbortController + generation counter + 180s watchdog + agent-task guard in `useChat.ts`).
6. **Chat sessions sidebar + session data layer** — multi-thread history (date-grouped/starred/
   searchable/renamable). Backend targets confirmed unchanged: `v2/chat-sessions` CRUD +
   `v2/desktop/messages`. Note Mac's `multiChatEnabled` defaults **off** (single synced thread) —
   build the layer, ship the sidebar behind the same default-off gate.
7. **Background-agent pill data + `continueAgent`** (UI in Track 2's bar); **agent-task guard already
   fixed** (reset race). Managed/background agents **fail closed to cloud (piMono) routing** and
   reject local ACP overrides at the control-tool layer; a failed required child-control op
   terminates the parent run.
8. **`localAgent.ts` enrichment loop** (`ENRICH_ENABLED=false` today) — re-enable as part of the real
   tool-calling loop with the ~2.5s latency engineered out (this is the full loop, not a flag flip).
9. **`screenContext.ts` upgrade** — send screen context **as image** (`imageBase64` + structured
   envelope), matching Mac, instead of OCR text prepended to the user message. **Respect the C-level
   consent gate** (WIRING-AUDIT: Windows sends screen OCR on every message with no consent gate; Mac
   never sends screen content for chat).
10. **BYOK** — build the key store + `withByokHeaders` helper and **publish it as a contract**
    (Track 2 attaches it to the listen socket; Track 6 builds the Developer API Keys settings UI).

Mac-beta spec notes:
- **Default provider = `pi-mono`** (`ChatProvider.swift:1040`, `omiAI`→`piMono` auto-migrated) — an
  in-process SDK agent proxied through Omi's backend (zero-setup, works for any signed-in user).
- **If Windows ports the pi-mono proxy:** Mac's local Backend-Rust chat-completions proxy now includes
  a **retrieval-policy layer** (`retrieval_policy.rs`) that *forces* `web_search` on explicit
  web-lookup intent and *excludes* it on private-lookup intent (fails `503 web_search_unavailable`).
  Port that behavior, not just the OpenAI→Anthropic translation, or answer quality diverges.
- Upstream is converging on "kernel as single run authority" + voice-transcript-derived consent —
  don't over-fit to the v0.12.72 multi-owner model.

**Owns:** `hooks/useChat.ts`, `components/chat/**`, `lib/chatConversation.ts`, `lib/localAgent.ts`,
`lib/localAgentMemoryCache.ts`, `lib/screenContext.ts`, `lib/agentTask.ts`, `lib/messagesSse.ts`,
`main/codingAgent/**`, `main/screenSynth/**`, new `main/agentKernel/**`, new `lib/byok*`.
**Publishes:** tool surface (get_tasks/get_memories/search_screen/spawn_agent/…, ~18+2 tools), kernel
session API, content-block message model, `<ChatMessages>` component (Track 5 mounts in the Hub),
chat-sessions data layer, BYOK helper. Publish the interfaces in PR #1.

### Track 2 — Voice & PTT Depth (`feat/win-voice-depth`)
**Mission:** deepen voice/PTT capability on top of the **existing (exempt) Windows bar/orb UI** — no
restyle. Areas 06 + 07 minus chat rendering (Track 1 owns those files).

Phase A (independent of Track 1 — start immediately):
- **TTS read-aloud** of AI replies in the bar + barge-in interrupt (Mac: cloud TTS proxy via desktop
  backend, local synth fallback). PTT replies always spoken; typed-question voice answers behind a
  setting (Track 6 exposes the toggle).
- **PTT vocabulary boosting** — screen OCR + recent activity → `keywords` query param on
  **`POST /v2/voice-message/transcribe`** (endpoint name corrected — NOT `-stream`). Read/log the new
  `stt_provider`/`stt_model` response fields and handle the `503 stt_provider_configuration_error` shape.
- **PTT spoken-language auto-detection**; **system-audio mute/duck** during capture.
- **Warm-hub system-wide PTT** — global hotkey into the realtime session (Windows' realtime voice is
  currently a page-bound button session). **Port target is the event-sourced reducer:
  `VoiceTurnStateMachine.swift` / `VoiceTurnCoordinator.swift` / `VoiceOutputCoordinator` (PR #9370,
  97 focused tests) — `RealtimeHubController.swift` is now a compatibility facade over it; do NOT port
  the facade.** Carry the typed-ID fencing (`VoiceTurnID`/`VoiceCaptureID`/…) that prevents a stale
  callback mutating a newer turn. Per-provider barge-in (OpenAI `response.cancel` vs Gemini
  session-replace + token re-mint — WIRING-AUDIT flags Windows may reproduce the Gemini bug Mac worked
  around; live-test). Idle/wake reconnect; device-change handling; silent-mic recovery escalation.
- **Auto "Auto" model selection** (`AutoModelSelector.swift`, at `RealtimeOmni/`); rich per-session
  system instructions; **`<about_user>` context card** (only real consumer is the realtime hub → owned
  here, though areas 03/06 flagged it).
- **Bar usage-limiter** — CONSUMES `main/billing/**` (settings-parity work); reuse, don't rebuild.
  Build against `effective_desktop_access_tier` (`desktop_free`/`desktop_full`/`desktop_architect`),
  not a binary entitled check.

Phase B (consumes Track 1 — do last):
- **In-session tool-calling** (voice-as-router, ~20 tools + the 2 permission tools) — requires Track
  1's published tool surface; do not build a parallel one.
- **Voice turns recorded into shared chat/kernel history** — port `RealtimeVoiceTurnOutbox.swift`
  (UserDefaults-durable handoff with `idempotencyKey`, replays on restart, cleared only after
  `turn_recorded` ack). Include barge-in partials; in-turn screen/vision context.

**Owns:** `lib/voice/**`, `lib/ptt/**`, `main/bar/**`, `main/overlay/**`, `components/bar/**`,
`components/voice/**`, `components/orb/**`, and the orb/waveform engine `src/renderer/src/orb/**`
(`waveform.ts`, `orbRenderer.ts`, `orbAnimator.ts`, `shader.ts`, `choreography.ts`).
**Must NOT edit:** `useChat.ts`, `ChatMessages.tsx`, `screenContext.ts` (request from Track 1).
⚠ Do not regress Windows-ahead engineering: adaptive noise-floor waveform, orb visual system.
**New bar UI (pills) matches the Windows bar's own design language — not Mac's.**

### Track 3 — Proactive Intelligence & Memory (`feat/win-proactive`)
**Mission:** the proactive-assistant framework + AI understanding-of-user + memory/goals/tasks data
layer AND their page surfaces (redesigned to Mac spec). Areas 01 + 02 + 03 + connectors (10/12).

Sequenced (first two are enablers):
1. **AI User Profile** (quick win — `get/update_ai_profile` in the generated client, zero callers).
   Daily 2-stage synthesis grounding Focus/Insight/task-prioritization/goal-generation. No contract
   change in-window; proceed as planned.
2. **AssistantCoordinator framework** (context-switch detection, backpressure, orchestration policy,
   notification throttling) — the substrate for items 3–6. Port throttling exactly:
   per-assistant + global clocks, frequency levels 0–5 (Off/60/30/10/3min/none),
   suppression order snooze→master→frequency.
3. **Focus assistant** (per-screenshot attention judging + nudges + session history/score + daily
   score) and the **glow overlay** (areas 01 + 13, one item). Focus/Insight/coordinator Swift
   confirmed unchanged at the tag — spec is stable.
4. **Insight assistant depth** — two-phase SQL-investigation + vision confirm, **backend-synced as
   searchable memory** (cheapest high-value win), history UI.
5. **Continuous AI memory extraction** (screen → LLM → confidence-gated memory, dedup) + memory
   data-model richness. **Cherry-pick `a4c50bcb4` for device provenance** (pre-work) rather than
   re-deriving. **Memory edit/visibility (C9): use the JSON body** (`MemoryValueRequest{value}`) —
   the backend made it canonical (`f630e8cfd`); the WIRING-AUDIT "use query-param, don't copy Mac"
   hedge is now stale. **Screen-based AI task extraction → DECISION GATE** (staged-tasks vs
   Candidate/workstream — Mac is mid-migration server-side; see gates). **C8 batch import is DONE**.
6. **Auto daily goal generation** + stale-goal cleanup + goal **advice** (quick win: `GET
   /v1/goals/{id}/advice` exists, richer than Mac's local version, unused). Mac generates goals
   client-side with full context (500 memories/100 conversations/100 tasks) — decide per-item whether
   to match that or use the backend endpoint. **Goals navigation model is a DECISION GATE.**
7. **Semantic embeddings** service (tasks/memories ranking; Windows is lexical-only). **Source-namespace
   the index key `(source, id)` from day one** and require `embeddings.count == texts.count` — Mac hit
   both bugs (`2446444a9`); don't reintroduce them. Local-cache pagination: **cursor advances off the
   raw DB row count, never the filter-narrowed visible count** (Mac's four-fix lesson).
8. **Unified connectors capability** — ONE "read external source → import + LLM-synthesize"
   implementation (Gmail, Calendar) + MCP export destinations (Notion push; Claude Code/Codex/
   OpenClaw/Hermes local config; ChatGPT/Claude OAuth PKCE). **The existing connector plumbing
   `main/integrations/**` (`google.ts`, `oauth.ts`, `oauthPkce.ts`, `tokenStore.ts`, `syncState.ts`,
   …) is Track 3's exclusive property — extend it, don't fork it.** **Publishes three entry points:**
   Memories page (Track 3), onboarding Data-Sources step (Track 6), Apps Imports/Exports hub (Track
   6). Build once here; Track 6 mounts the UI shells via the published API only.
9. **Home hub widgets** — build `WhatMattersNowSection` + `FocusedGoalsSection` components (canonical
   task-intelligence + canonical-goals driven) for **Track 5's Hub** to mount. The redesigned Mac Home
   shows these, NOT the legacy Tasks/Goals widgets — Track 3 owns all of `components/home/**` and
   **deletes `QuickTaskWidget.tsx`/`QuickGoalsWidget.tsx`** as part of this item.

Page surfaces (redesign to Mac spec, `../mac-ui-port/04` + `05` §1–2):
- **Memories page** — layer filter, category filter, "This device" toggle, add/management menus,
  MemoryCardView, detail sheet, undo-delete toast, **Brain Graph** (match Mac: `thing`-node **purple**
  per ruling B, 30fps cap, node-color set; preserve Windows' WebGL-recovery/off-screen-unmount
  engineering per exception rule — keep the guts, match the look; keep the assemble-in choreography per
  Chris's animation preference). **Graph ownership is NOT shared:** Track 4 sole-owns
  `components/graph/**` incl. `nodeColor.ts`; Track 3 mounts `<BrainGraph>` via props only; Track 5
  supplies the purple token; Track 4 wires it in. No cross-track edits to `nodeColor.ts`.
- **Tasks page** — grouped-by-due-date, inline row create, swipe/indent/reorder, interactive badges,
  detail sheet, suggested-tasks quiet-capture card, undo toast, keyboard nav. **Do NOT build Mac's rich
  multi-group filter** — post-tag `71cb9af64` simplified Mac to a mobile-parity completed toggle (which
  Windows' current 3-way toggle already resembles); defer to the gate.
- **Goals** — see decision gate; the emoji auto-icon, traffic-light progress gradient, insight sheet,
  and **completion confetti celebration** are Mac-only delight gaps worth porting.

**Owns:** `lib/insight*`, new `main/assistants/**`, `main/integrations/**`, `main/memoryExport/**`,
`main/memoryImport/**`, `main/memoryCleanup/**`, `main/insight/{notification,state}.ts`,
`main/usage/**`, `hooks/useMemories.ts`, `lib/memoriesBulk.ts`, `lib/memoryExtract.ts`,
`lib/goals.ts`, `lib/embeddings*`, `lib/clientDevice.ts` (from cherry-pick), `pages/Memories.tsx`,
`pages/{Tasks,Goals}.tsx`, `components/insight/**`, `components/home/**` (incl. deleting the legacy
Quick widgets), and the whole file `components/settings/tabs/IntegrationsTab.tsx` (Track 6 mounts it,
never edits it).
**Publishes:** Hub widgets (to Track 5), connectors capability (to Track 6), memory tools (to Track 1).
⚠ Parked: **Persona** (backend routes don't exist even in the generated client — a backend project).

### Track 4 — Rewind, Conversations & Capture (`feat/win-rewind-shell`)
**Mission:** the self-contained local cluster — Rewind, Conversations, capture durability, file
index/KG. Area 05 + 11 + capture-adjacent 12/13 items + WIRING-AUDIT capture Majors.

- **Rewind search un-gating** (quick win: fully built, dead `showSearch` flag) → OCR-embedding
  semantic search (vs `LIKE`), FTS5, OCR bounding-box on-image highlight (match Mac
  `../mac-ui-port/05` §4). Redesign the Rewind surface to Mac's day-scoped browse + list/timeline
  search-view toggle + date picker (ruling A: Windows' continuous break-collapsing timeline is a
  Windows-ahead *surface* → replace with Mac's model). Keep the frame-viewer (no auto-play transport,
  matches live `RewindPage`).
- **Storage = JPEGs (Gate 2 DECIDED).** Plus the capture WIRING-AUDIT fixes (this track's files):
  30s keyframe anchor, battery-aware cadence (3× interval), suspend/resume, orphaned-JPEG cleanup, OCR
  re-backfill, DB corruption recovery (note: Mac's recovery is now a 10-actor pool-epoch concern — does
  NOT port 1:1 to Windows' single connection; architecture note, not a checklist). **OCR `dispose()` on
  quit is DONE (C7).**
- **Conversations pages** — regenerate the client first (pre-work). Redesign list/detail to Mac spec
  (`../mac-ui-port/05` §3): folders + tabs, starred/date filters, multi-select merge, emoji-tile rows,
  slide-in transcript drawer, speaker bubbles (user `userBubble`, 6-color cycle incl. dark-purple per
  ruling B), tap-to-name speaker. Note Windows' interactive action-item toggle (C3-fixed) is correct;
  Mac renders them read-only — keep the Windows interaction.
- **Capture: C1 (90s-silence keepalive), C2 (live-conversation persistence + `from-segments`
  fallback), and C6 (double-mic race) are DONE** — fixed on `fix/windows-wiring-criticals` (PR #21,
  per WIRING-AUDIT's status header); do not redo. Still open in this track:
  **app-crash-mid-recording segment durability** (explicitly deferred then).
- **LiveNotes** (auto meeting-minutes during recording) + **speaker naming** (live + post-hoc) — no
  Mac commits touched these in-window; spec stable.
- **File index / KG** — scan-dir skip-list fix (21 vs 4 dirs), incremental 3h re-scan, **BrainGraph
  interactivity flip** (quick win: `interactive={false}` everywhere; standalone viewer route; rebuild
  button — coordinate node-color with Track 3's Memories BrainGraph), onboarding file-scan entity
  extraction. Fix the fail-open deletion bug pattern (`3bf5a27e4`: don't treat "couldn't read dir" as
  "deleted"). Preserve Windows' KG schema superset (exception rule).
- **Shell/system:** crash/clean-exit detection (`lastSessionCleanExit` + Sentry + DB integrity trigger),
  launch-at-login default migration, `main/{sentry,updater,lifecycle}.ts`. **Updater = DECISION GATE**
  (Mac's is now elaborate: immutable manifests, T2 qualification, LKG recovery, fail-open policy plane;
  Windows has no equivalent backend manifest infra).

**Owns:** `main/rewind/**`, `main/ocr/**`, `main/meeting/**`, `pages/Rewind.tsx`, `hooks/useRewind.ts`,
`components/rewind/**`, `components/recording/**`, `pages/{Conversations,ConversationDetail,LiveConversation}.tsx`,
`components/TranscriptPopup.tsx`, `main/fileIndex/**`, `main/ipc/{kg,kgWorker,kgWriteQueue,localGraph}.ts`,
`components/graph/**` (sole owner incl. `nodeColor.ts` — see Track 3 note), `main/{sentry,updater,lifecycle}.ts`.
**Consumes:** Track 5 tokens + primitives. Coordinates meeting-toast (gate) with Track 6.

### Track 5 — UI Foundation & Shell (`feat/win-ui-foundation`)
**Mission:** the token layer, the Hub-that-replaces-the-sidebar, window chrome, animated background,
charter-compliance rules, and the shared UI primitives every other track builds on. **Lands its
tokens + primitives + INV-UI-1 update FIRST.**

- **Design tokens PR (first, unblocks everyone):**
  - Re-introduce Mac's purple palette per ruling B: `purplePrimary #8B5CF6` family, `userBubble
    #43389F`, and the new **`HomePalette`** token set (`paper #050506`, `panel`, `tile`, `tileHover`,
    `ink #F0EBE3` warm off-white, `secondary`, `muted`, `faint`, `hairline`, `green #2BC761`,
    **`stageGlow #7A4DF2`**). Windows has none of `HomePalette` today.
  - **Update `INV-UI-1`** (`docs/product/invariants/brand-ui.md`) + its guard test + the AGENTS.md
    "never use purple" line to reflect the ruling (purple ports as-is). Without this the ratchet CI
    fails. **This is the load-bearing work item of the whole plan's first PR.**
  - Keep the base `OmiColors`/`OmiChrome` radius/motion tokens (already 1:1 ported).
- **Hub home + navigation-model replacement (the single largest structural change).** Windows currently
  ships the **retired** Mac sidebar model (always-mounted `Sidebar.tsx` + permanent chat transcript on
  Home — resembles Mac's *legacy* home). Mac's default is the **Hub**: no persistent sidebar, a centered
  wordmark + 4-cell stat ribbon + ask bar + suggested questions, with a 3-mode state machine
  (`.hub`/`.chat`/`.connect`) and a floating "Home" pill (`PageChromeBar`) on sub-pages. Build it per
  `../mac-ui-port/01` §2 + `02`:
  - Retire the persistent sidebar; nav happens via the stat ribbon, Connect tray, and Cmd/Ctrl-1..6.
  - **Recommend a transition feature flag** mirroring Mac's `useLegacyHomeDesign` (keep the Windows
    sidebar reachable during rollout, ship Hub default-on once verified) — de-risks a deep rewiring.
  - Header status pills (Capture on/off/blocked, Listening + meetings-only mode, Settings gear popover).
  - Hub mounts **Track 1's `<ChatMessages>`** in the `.chat` stage and **Track 3's WhatMattersNow +
    FocusedGoals** widgets. Stat-ribbon counts from existing count hooks. Connect tray mounts Track 3's
    connectors capability.
  - Serif accent (wordmark 58pt, stat numerals 22pt) — use the existing Inter + a serif display face
    (charter 02: no SF; keep Inter, add a licensed serif for the accent). Signature spring
    `spring(response:0.46, dampingFraction:0.86)` for stage transitions (charter 03 recipe).
  - **`HomeCanvasBackground`** — layered radial-gradient glow over `paper`, including the `stageGlow`
    violet washes (ruling B). Software-render safe (charter 05: animate opacity, not filters).
- **Window chrome (charter 01):** keep the current correct choices — Mica on the main window
  (`backgroundMaterial`, gated `≥ build 22621`), WCO caption buttons (Snap Layouts), rounded corners.
  Add the `--omi-soft-render` flag + `data-soft-render` gate so dev/CI screenshots use flat `.glass`
  fallbacks. Verify the drag-maximize/restore material-desync (Electron #46753) empirically.
- **Charter-compliance rules (encode once, all tracks follow):** SwiftUI→`linear()` spring translation
  (dev-only `motion` generator, zero runtime dep); motion tokens; `font-synthesis: none`; bundle
  JetBrains Mono for code; overlay-scrollbar CSS + no rubber-band; the focus-visible no-flash pattern;
  `prefers-reduced-motion` (keep choreography, swap translate→opacity); software-render perf floor
  (transform/opacity only, `will-change` discipline, canvas for procedural geometry).
- **Shared UI primitives:** `Modal`/`Sheet` (centered scrim + scale-fade card + Esc, Fluent
  `ContentDialog` shape per charter 04 §3 — NOT Mac's titlebar-attached sheet), `ContextMenu` wrapper
  over Electron native `Menu` (charter 04 §4 — DOM context menus fail Windows a11y), `Button`, `Card`,
  `Toggle`, `Badge`, `Pill`. Mac has no shared component library (every surface hand-rolls) — Windows
  builds consistent primitives from the token layer.

**Owns:** `styles/globals.css`, `tailwind.config.ts`, `App.tsx`, `components/layout/**`,
`pages/Home.tsx`, new `components/ui/**` (primitives), `main/index.ts` (chrome only) + `TitleBar.tsx`,
`docs/product/invariants/brand-ui.md` + its guard test + the AGENTS.md INV-UI-1 line.
**Publishes:** design tokens, `HomePalette`, shared primitives, the Hub (mount points for Track 1 chat
+ Track 3 widgets/connectors), **and a route manifest** — an additive registration seam (e.g.
`routes.manifest.ts` re-exported into `App.tsx`) so Tracks 3/4/6 register/rename their pages' routes
by appending to the manifest instead of editing `App.tsx` while Track 5 rewrites the shell. Direct
`App.tsx` edits by other tracks are forbidden; anything the manifest can't express is a
request-to-Track-5. Lands first.

### Track 6 — UI Surfaces: Settings, Onboarding & System Chrome (`feat/win-ui-surfaces`)
**Mission:** the surfaces not owned by a feature track — settings, onboarding, context menus, modals,
tray, Apps hub, toasts. Goes wide **after** Track 5's tokens + primitives land. Every surface verified
against its `../mac-ui-port/06`–`07` spec.

- **Settings** (`../mac-ui-port/06`) — add the two **missing** panes: **Notifications** (master toggle,
  6-step frequency slider, Focus/Task/Insight/Memory toggles, Daily Summary + time — backend settings
  already exist) and **Floating Bar** (show toggle, background style, draggable, typed-question voice,
  screen-share, voice picker, voice-speed). Bring **General** up to the Mac card set (Screen Capture /
  Audio Recording status cards, System Audio mode, Notifications permission tri-state, Font Size + Reset
  Window Size). **Transcription**: add Voice Assistant Languages + Custom Vocabulary cards.
  **Shortcuts**: rework to Mac's preset-pills + custom recorder + Disable pill + 3 PTT toggles.
  **Advanced**: AI Setup (voice model/provider/workspace/dev mode) + Preferences + Troubleshooting +
  **Developer API Keys (BYOK UI — consumes Track 1's helper)**. **Account**: add **Delete Account &
  Data** flow + confirmation. **Plan & Usage / About are DONE (settings-parity)** — verify against §3.7/
  §3.12 (BYOK promo card, overage explainer, promo-code, update-channel picker + downgrade alert). Keep
  Windows-ahead settings tabs (**Memories**, **Agents**) per posture; place per Mac's Advanced→AI Setup.
  Do NOT port Mac dead code (Gmail/Calendar reader cards, per-assistant setting cards, feature-tiers).
- **Onboarding** (`../mac-ui-port/06` §5) — Mac's live flow is the **18-step linear `OnboardingView`**
  (Name→Language→HowDidYouHear→Trust→ScreenRecording→FullDiskAccess→FileScan→Microphone→Accessibility→
  Automation→FloatingBarShortcut→FloatingBar→VoiceShortcut→VoiceDemo→DataSources→Exports→Goal→Tasks).
  Windows has 13+terminal today; add the missing **DataSources** + **Exports** steps (mount Track 3
  connectors), **split the single shortcut step into the two press-to-verify steps** (FloatingBarShortcut
  + VoiceShortcut with live key-cap "did it light up" feedback), and match the permission-step state
  machine (granted→auto-advance 350ms + 1s polling). Do NOT port the chat-driven `OnboardingChatView`
  (not in the live router) or `OnboardingNotificationStepView` (removed). Make completion idempotent.
- **Context menus** (`../mac-ui-port/07` §9) — Windows has **zero** right-click UI; Mac has 4. Build via
  Electron **native `Menu`** (charter 04 §4): chat resource card (Open/Reveal/Copy Path), conversation
  row (Copy Transcript/Copy Link/Edit Title/Move to Folder/Delete), folder chip (Edit/Delete), saved
  filter chip (Delete). (Renderer emits `context-menu` → main pops native menu; coordinate the
  conversation-row menu with Track 4's Conversations page.)
- **Modals/sheets** — port Mac's inventory (`07` §8) using Track 5's `Modal` primitive: Delete Account,
  merge/delete confirmations, folder CRUD, goal sheets, billing web flow (embedded WKWebView →
  Electron checkout window, already exists), etc. Centered-scrim-card, not Mac's titlebar sheet.
- **Tray menu parity** (`07` §11) — Windows tray is missing Mac's Screen Capture / Audio Recording
  toggle switches, "Signed in as {email}", Report Issue, Sign Out, Reset Onboarding. Add them; keep
  Windows-ahead per-state tray icons + update-ready hint (exception rule) and the correct left-click-
  toggle / right-click-menu split (charter 04 §1.6).
- **Apps page / marketplace shell** — Imports hub + Exports/MCP hub, mounting Track 3's connectors.
- **Report Issue / Feedback** window (`07` §6.1) — Windows entry point unconfirmed; add if missing.
- **What's-new toast** — ruling A: match Mac's simpler main-window design (bottom-right, ~12s,
  "See what's new"). **Insight toast** stays (Mac delivers insights via the bar; Windows' acrylic toast
  is the functional equivalent — bar is exempt). **Meeting toast → DECISION GATE** (Mac has no meeting
  UI at all). Track 6 owns `main/insight/toastWindow.ts` (window shell + `showToast` API); Track 3
  provides insight content, Track 4 provides meeting content (pending gate).

**Owns:** `pages/Settings.tsx`, `components/settings/**` (except the whole `IntegrationsTab.tsx` file
→ Track 3), `lib/settingsNav.ts`, `pages/Onboarding.tsx`, `components/onboarding/**`, `pages/Apps.tsx`,
`main/tray.ts` + `main/trayState.ts` + `components/tray/**`, native context-menu wiring (new
`main/contextMenu*`), `main/insight/toastWindow.ts` (window shell only — `main/insight/{notification,
state}.ts` are Track 3's), Delete-Account + Feedback flows.
**Consumes:** Track 5 primitives, Track 1 chat/content model + BYOK helper, Track 3 connectors capability.

---

## Decision gates for Chris (park, don't guess)

**NEW gates (added this revamp):**
- **G-A. Staged-tasks vs Candidate/workstream model (Track 3).** Mac is actively migrating server-side:
  `TaskWorkflowMode` (`off`/`shadow`/`write`/`read`) gates legacy staged-tasks (`/v1/staged-tasks`) vs
  the new Candidate pipeline (`backend/routers/candidates.py`, `workstreams.py`,
  `staged_migration.py`). The mode is **server-assigned per account** — undeterminable from source.
  Porting Windows task-extraction against `/v1/staged-tasks` risks building on a system Mac is
  decommissioning. **Question for backend/product:** port legacy, port canonical, or port whichever mode
  is live for most production accounts? Blocks Track 3 item 5's task-extraction (memory extraction can
  proceed independently).
- **G-B. Meeting-detection toast — keep or drop (Track 4/6).** Mac has **zero** meeting UI (silent
  capture gate only). Windows built a full acrylic meeting toast. Dropping it to match Mac is a
  functional regression with no Mac equivalent. **Keep the Windows toast, or drop for Mac parity?**
- **G-C. Goals navigation model (Track 3).** Windows has a dedicated `/goals` route; Mac has **no Goals
  page** — only a dashboard widget + `AllGoalsSheet`, and Mac is mid-migration (legacy `GoalsWidget` vs
  canonical `WhatMattersNowSection`). **Keep Windows' fuller Goals page (arguably better UX) or narrow
  to Mac's sheet/dashboard-only?**
- **G-D. Tasks-page filter richness (Track 3).** Mac at the tag has a full multi-group filter, but
  post-tag `71cb9af64` **simplified it to a mobile-parity completed toggle** (Windows' current 3-way
  toggle already resembles that). **Recommend: do not build Mac's rich filters** — defer until the next
  Mac reference confirms the direction stuck. Flagged as contested, not settled.
- **G-E. Notifications settings shape (Track 6).** Tag = standalone Notifications section; post-tag
  `891c26de2` **merged Notifications+Privacy** into one presentation row (keeping 11 raw section ids).
  **Build the standalone (tag) shape or the merged (post-tag) shape?** (Minor.)
- **G-F. Windows updater sophistication (Track 4).** Mac's updater is now elaborate (immutable
  manifests, T2 qualification, LKG recovery, fail-open policy plane). Windows has no equivalent backend
  manifest/pointer infra. **Does Windows need this level, or is a simpler electron-updater policy
  acceptable?**
- **G-H. Purple re-confirmation (Track 5 — blocks only the purple part of the tokens PR).** Ruling B
  ("purple ports as-is") was given against the frozen v0.12.72 reference. New fact surfaced by the
  plan audit: **upstream Mac removed ALL purple immediately after the tag** (post-beta neutral design
  system — infra audit §3c; ~301 token refs → zero, aligning Mac with INV-UI-1). Porting the tag's
  purple now means de-purpling again at the next reference bump. **Question for Chris: keep ruling B
  (port the tag's purple), or adopt Mac's post-tag neutral palette now (one less churn cycle, and
  INV-UI-1 stays untouched)?** Everything else in Track 5's tokens PR proceeds regardless.
- **G-G. Gate-9 re-confirmation (Tracks 1 + 3).** Gate 9 says "skip `TaskAgentManager`, kernel is the
  single authority." Still correct — but Mac is **actively investing** in `TaskChatCoordinator` (System
  A: persistent task threads, workstream continuity, contextual resurfacing) as a *separate* per-task
  chat surface, now kernel-integrated. Re-confirm the skip holds given the new investment rather than
  treating it as settled (ties into G-A).

**Carried-forward open gates:**
- **Help/Crisp** (Track 6) — open, low priority; About links `help.omi.me` meanwhile.
- **BLE / wearables (08) + WAL offline sync (09)** — the ideal **7th track** whenever wanted; needs
  physical devices on the Windows box to verify. 09 is hard-blocked on 08. Parked.
- **Persona / AI-clone** — backend routes don't exist even in the generated client; a backend project,
  not a client port. Parked.

**DECIDED (do not reopen; outcomes below):**
- **Agent default provider = `pi-mono`** (confirmed at tag). Claude Code stays the power-user option.
  Track 1 owns the pi SDK port + proxy auth + `retrieval_policy.rs` web-search-intent behavior.
- **Rewind storage = keep JPEGs** (Gate 2). Reinforced: Mac's H.265 path had a capture-breaking blank-
  timeline bug and a non-functional Rebuild-Index in this exact window (both fixed by the tag).
- **Trial/paywall + usage limiter = built** (settings-parity). Footnote: re-verify against the moved
  backend entitlement model (Neo = `desktop_free`; `should_show_new_plans` windows-aware via
  `e2556479a`) — build consumers against `effective_desktop_access_tier`, not binary entitled/not.
- **Citation metadata = mostly resolved** (C4 parses + stores memories citations); residual is
  `chart_data` rendering only (Track 1).
- **Skip `TaskAgentManager` (System B)** — kernel is the single run authority (subject to G-G re-confirm).
- **Memory edit/visibility contract = JSON body** (backend `f630e8cfd` made it canonical; Mac was right).
- **Default chat architecture = staged kernel flip (Gate 8, DECIDED, STAGED).** The kernel is the target
  for DEFAULT chat too, but Track 1 ports the kernel + pi-mono for **agent sessions first**, implements
  the `/v2/desktop/messages` persistence contract, then flips default chat as a distinct milestone with
  explicit verification: (a) shared-thread continuity proven against mobile both directions (locked
  invariant), (b) grounding at least as good as the backend path, (c) feature-flag fallback to backend
  chat for the first release. **Required safeguards on the flip (hard requirements, reproduced verbatim
  — load-bearing):**
  - **Flag default-OFF shipping:** default chat stays on backend `/v2/messages` until every criterion
    below is green; the kernel flip is a runtime feature flag that ships OFF in the first release
    containing the kernel. Flipping it is its own decision point with Chris.
  - **Kill switch:** the same flag is a live kill switch — flipping back requires no migration, no data
    repair, at any time. Kernel chat persistence must therefore be ADDITIVE alongside the existing local
    chat store: no rewrites/moves of existing chat history, no destructive schema changes (`db.ts`
    additive-only rule applies doubly here).
  - **No one-way doors:** kernel session/run state lives in its own tables; nothing in the flip may
    alter or migrate existing conversations/messages such that the backend path can't resume them
    unchanged.
  - **Continuity invariant guarded by test BEFORE the flip:** a turn sent via kernel chat must appear in
    the backend thread (via the `/v2/desktop/messages` persistence contract) and turns from mobile must
    appear on Windows, verified both directions against a real second client.
  - **Fallback telemetry:** any runtime fallback from kernel → backend chat calls the shared
    `recordFallback` helper (`component=chat, from=kernel, to=backend, outcome`) — silent ops is banned.
  - **Failure containment:** a kernel crash/hang must degrade to the backend path within one turn
    (watchdog + auto-fallback), never a dead chat UI.
  - **Rollout order:** agent sessions on kernel first → internal/dev flag-on for daily use → only then
    consider default-on, staged per release-channel (beta before stable).

---

## Cross-cutting corrections (so tracks don't chase ghosts)

**Still true:**
- The "Windows feeds ~20 truncated memories vs Mac's full context to goal-suggest" claim is wrong as
  stated: `GET /v1/goals/suggest` takes **zero** caller payload — the ~20 truncation is the backend's own
  behavior. Real difference: Mac doesn't use that endpoint (client-side generation, full context).
- Memory review-queue endpoints are dead codegen on **both** platforms — not a Windows gap.
- **Windows-ahead ENGINEERING to keep (do not "fix" toward Mac):** adaptive-noise-gate waveform, local
  KG schema superset, one-shot UI-automation planner, markdown link safety, tray per-state icons,
  `SENSITIVE_WINDOW_MARKERS`, idle-capture pause, conversation outbox CAS+dedupe, BrainGraph
  WebGL-recovery/off-screen-unmount. (Distinct from Windows-ahead *surfaces*, which ruling A replaces.)

**New this revamp:**
- **`omiApi.generated.ts` is stale** — regenerate before Track 4 conversation-mutation UI and Track 3
  memory-edit (conversation `ConversationMutationResponse`; memory JSON body; `stt_provider`/`stt_model`;
  `ConversationAudio`). See runbook pre-work #1.
- **Kernel schema is ~20 tables / 2418 lines, not 8** — Track 1 reads the full current
  `sqlite-store.ts`, not the old 8-table summary.
- **Two intent routers** (Haiku chat-vs-agent classifier + regex `routeDesktopIntent`) — port both,
  distinctly.
- **Warm-hub port target moved** to `VoiceTurnStateMachine`/`VoiceTurnCoordinator`/`VoiceOutputCoordinator`;
  `RealtimeHubController` is a facade.
- **Endpoint name:** `/v2/voice-message/transcribe` (not `-stream`).
- **90s per-tool stall guard** under the 180s watchdog; **`check_permission_status`/`request_permission`**
  in the tool surface.
- **`e2556479a` (windows platform gating) is fixed on `upstream/main`** — re-verify plan catalog/paywall
  against it; **`a4c50bcb4` (device provenance) has ready Windows client code NOT in the fork** —
  cherry-pick. **Neo = `desktop_free`** (not zero-access).
- **Embedding index:** source-namespace the key + require count match (Mac's fixed bugs). **Memory-cache
  pagination:** advance cursor off raw row count, not filtered count.
- **retrieval_policy.rs:** port the web-search-intent force/exclude behavior if porting the pi-mono proxy.

---

## Shared-file collision rules (merge-conflict hotspots)

| File(s) | Owner | Others must |
|---|---|---|
| `hooks/useChat.ts`, `components/chat/**`, `lib/{screenContext,localAgent,localAgentMemoryCache,chatConversation,agentTask,messagesSse}.ts`, `main/{codingAgent,agentKernel,screenSynth}/**`, `lib/byok*` | Track 1 | request changes, never edit |
| `lib/voice/**`, `lib/ptt/**`, `main/{bar,overlay}/**`, `components/{bar,voice,orb}/**`, `src/renderer/src/orb/**` (waveform/renderer/animator/shader/choreography engine) | Track 2 | request changes |
| `lib/{goals,memoryExtract,memoriesBulk,embeddings*,insight*,clientDevice}.ts`, `hooks/useMemories.ts`, `main/{assistants,integrations,memoryExport,memoryImport,memoryCleanup,usage}/**`, `main/insight/{notification,state}.ts`, `pages/{Memories,Tasks,Goals}.tsx`, `components/{insight,home}/**`, `IntegrationsTab.tsx` (whole file) | Track 3 | Track 5 mounts widgets via props/exports only; Track 6 mounts connectors via published API only |
| `main/{rewind,ocr,fileIndex,meeting}/**`, `pages/{Rewind,Conversations,ConversationDetail,LiveConversation}.tsx`, `hooks/useRewind.ts`, `components/{rewind,recording,graph}/**` (incl. `nodeColor.ts` — Track 3 mounts via props, Track 5 supplies the purple token, only Track 4 edits), `TranscriptPopup.tsx`, `main/ipc/{kg,kgWorker,kgWriteQueue,localGraph}.ts`, `main/{sentry,updater,lifecycle}.ts` | Track 4 | request changes |
| `styles/globals.css`, `tailwind.config.ts`, `App.tsx`, `components/layout/**`, `pages/Home.tsx`, `components/ui/**`, `TitleBar.tsx`, `main/index.ts` (chrome), `brand-ui.md` + INV-UI-1 guard | Track 5 | consume tokens/primitives; register routes ONLY via Track 5's route manifest (never edit `App.tsx`); request Hub-mount changes |
| `pages/{Settings,Onboarding,Apps}.tsx`, `components/{settings,onboarding}/**` (except `IntegrationsTab.tsx`), `components/tray/**`, `lib/settingsNav.ts`, `main/{tray,trayState,contextMenu*}.ts`, `main/insight/toastWindow.ts` (shell only) | Track 6 | request changes; Track 3/4 provide toast content via `showToast` API |
| `main/ipc/db.ts`, `src/shared/types.ts`, `src/preload/index.ts` | shared | **additive-only**: append your own `ensureColumn`/`CREATE TABLE IF NOT EXISTS`/type in a clearly-labeled section at the end; never reorder; land schema PRs immediately (applies **doubly** to kernel-chat tables per Gate 8) |
| `pnpm-lock.yaml` | shared | on conflict: take main's + re-run `pnpm install` |
| `main/billing/**`, `lib/billing.ts`, `lib/usageLimit.ts` | settings-parity (settled) | Track 2 CONSUMES for the bar usage-limiter (reuse, don't rebuild) |
| capture-core (`capture/liveRescue.ts`, `capture/liveMicSession.ts`, `main/ipc/omiListen.ts`), auth (`lib/{authSession,authTeardown,apiClient}.ts`), sync (`lib/sync/outboxSweep.ts`, `main/ipc/dbWipe.ts`) | **settled** (wiring/auth branches) | request changes, standalone-PR only |

---

## UI verification standard

Every UI-surface PR is verified by screenshots reviewed by a **separate skeptical subagent** against
the Mac spec — Claude never approves its own UI work.
- The `../mac-ui-port/**` specs are the **acceptance criteria** (exact hex, spacing, radii,
  durations/curves, copy strings). Cite the spec section the PR satisfies.
- Compare against **Mac reference screenshots** where available (the shared Mac mini is a runnable
  reference oracle — see `CLAUDE.local.md`; use non-GUI verification by default, coordinate for GUI capture).
- Capture desktop (1280×720) + a representative narrow width; verify at **125% and 150% DPI** (charter
  04 §5 — integer-ratio assumptions break there and 100%-only QA misses the whole class).
- Reviewer framing: "Default assumption: the change has NOT succeeded. Describe what you observe.
  Actively search for misalignment, overflow, wrong color (esp. purple that should/shouldn't be there
  per ruling B), broken spacing, missing Mac elements. Approve only on exact match to the spec."
- Screenshots go in `.playwright-mcp/` (gitignored). The floating bar/orb is **exempt** from Mac-spec
  comparison (ruling) — verify it against its own existing Windows design, not Mac's.

---

## Parked-task ownership
- **BYOK:** Track 1 builds + publishes the key store + `withByokHeaders`; Track 2 attaches it to the
  listen socket (deferred WIRING-AUDIT item); Track 6 builds the Developer API Keys settings UI.
- **Firebase-token → DPAPI `safeStorage` migration:** standalone small PR; fallback owner Track 4 if
  not picked up independently (the *primary* auth token; unrelated to the browser-Keychain onboarding
  fix `c9fc403ef`, which is a different credential path).

## How this maps to the audit + UI-spec files
| Track | Feature audit areas | UI specs |
|---|---|---|
| 1 | 04 (all) + 13 (chat cards/tables/typing/citations/sessions) + 11 (localAgent flag) | `03-chat` |
| 2 | 06 (voice/PTT depth) + 07 (all) + 03/06 (`<about_user>`) | (bar exempt) |
| 3 | 03 (minus persona) + 01 (all) + 02 (all) + 10/12 (connectors) + 13 (glow) | `04-tasks-goals`, `05` §1–2 (memories/graph) |
| 4 | 05 (all) + 11 (rest) + 12 (LiveNotes/speakers) + capture Majors | `05` §3–4 (conversations/rewind) |
| 5 | shell/nav/tokens/chrome (INDEX §H, 12/13) | `01-shell-design-tokens`, `02-home`, charter 01–04 |
| 6 | 12 (settings/apps/permissions) + 10 (onboarding steps) + 07 (tray/modals/context-menus) | `06-settings-onboarding`, `07-notifications-modals-tray` |
| parked | 08, 09 (7th track), persona | — |
