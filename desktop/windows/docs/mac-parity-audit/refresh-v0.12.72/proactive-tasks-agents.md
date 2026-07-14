# Staleness Refresh — Proactive Tasks, Goals, Task Agents, Coding Agents/ACP, Insight/Focus

> Baseline audited against: upstream commit `0d09ede61b76dc4a144d05809432bf220394ee3a` (2026-07-09).
> New reference: `v0.12.72+12072-macos` (2026-07-12), checkout at `.worktrees/mac-ref` (read-only).
> 288 commits touched `desktop/macos` in that window. Domain: tasks/goals (incl. quiet capture,
> workstream continuity), TaskAgentManager (tmux/Claude Code), coding agents/ACP runtime, Focus/Insight,
> proactive screen-capture pipelines. Also covers the coordinator's scope addition: staleness of
> `PARALLEL-PLAN.md` Stream 1 (agent-kernel items, Gates 7/8/9) and all of Stream 3.

## Headline finding

The single biggest development in this window is **`e722929bf` "Make Omi tasks context-aware with
durable workstreams" (#9396)** — landed 2026-07-10, with hardening follow-ups through
`613e41a20`/`086281413` (2026-07-11/12). It is a large, additive-but-transformational rework of the
Tasks pipeline: a new **Candidate capture** model, a **canonical review lifecycle**, **durable
workstreams**, an **agent-kernel-backed continuity contract** for the per-task chat/agent, a
**"What Matters Now"** dashboard layer, **contextual resurfacing gates**, and **attributable
feedback**. It runs **alongside** (not instead of) the pipeline `02-proactive-tasks-goals.md`
documents (`TaskAssistant`, `TaskDeduplicationService`, `TaskPrioritizationService`,
`TaskPromotionService` all still exist unchanged in file terms), gated by a **server-driven**
`TaskWorkflowMode` (`off | shadow | write | read | _unknown`) that determines whether an account is
on the legacy staged-task pipeline or the new canonical Candidate/workstream pipeline. This means
the existing audit's detailed staged-task-pipeline writeup is now describing **one of two modes**,
and the mode is not client-controlled.

## NEW features/behaviors since baseline

- **Candidate capture + canonical review lifecycle** (`e722929bf` #9396). New files:
  `Desktop/Sources/ProactiveAssistants/Assistants/TaskExtraction/ScreenCandidateAdapter.swift`
  (340 lines). Screen-observed facts (`ScreenCaptureFacts`: explicitCommand, clearCommitment,
  concreteDeliverable, directRequest, inferredNextStep, owner, publicBroadcast, directMention,
  alreadyDone, duplicateOf, refinesTask, captureConfidence, ownershipConfidence) are evaluated by
  `ScreenCapturePolicy.evaluate(_:)` into one of 7 outcomes: `ignore`, `createDirect`,
  `autoAcceptSilent`, `pendingCandidate`, `proposeEnrichment`, `proposeUpdate`, `proposeCompletion`.
  `minimumCaptureConfidence = 0.8` gates silent auto-accept vs. pending-candidate review — the
  comment notes it must be "kept in sync with `backend/utils/task_intelligence/capture_policy.py`."
  Backend: `backend/routers/candidates.py` (new router), `backend/models/candidate.py`
  (`CandidateCreate`, `CandidateStatus`, `CandidateAction`, `CandidateSubjectKind`).
- **Durable workstreams + kernel-backed continuity** (`16e387876` "add workstream runtime
  continuity", `0560d11b9` "ship persistent macOS task threads", `563da7537` "align generated
  client contracts"). New Swift: `TaskWorkstreamContinuity.swift` (390 lines),
  `TaskThreadProjection.swift` (413 lines). New TS: `agent/src/runtime/workstream-continuity.ts` +
  `agent/tests/workstream-continuity.test.ts`. The per-task "Investigate" chat
  (`TaskChatCoordinator`, documented in the existing audit as a standalone feature) now persists
  through 5 new kernel **control tools** — `prepare_workstream_continuity`,
  `persist_workstream_continuity`, `persist_prepared_workstream_artifact`,
  `resolve_workstream_continuity_delivery`, `project_workstream_continuity` — via
  `TaskChatRuntime.controlTool`, i.e. the same kernel/agent-runtime substrate Stream 1 is porting,
  not a bespoke Swift-only store. This is a genuinely new integration point the existing audit
  (written pre-#9396) does not mention at all.
- **New kernel SQLite tables backing this**, in `desktop/macos/agent/src/runtime/sqlite-store.ts`
  (now 2418 lines): `desktop_task_candidates`, `desktop_memory_candidates`,
  `desktop_context_access_log`, `desktop_attention_overrides`, `surface_conversations`,
  `conversation_turns`, `completion_delta_checkpoints`, `workstream_artifact_versions`,
  `workstream_artifact_heads`, `workstream_continuation_checkpoints`, plus a `desktop_dispatches` /
  `desktop_artifact_deliveries` / `desktop_context_packets` cluster and a `schema_migrations` table.
  None of these existed at baseline.
- **"What Matters Now" dashboard layer** (`03e851fa8` "add What Matters Now and canonical goals").
  New: `Desktop/Sources/MainWindow/Dashboard/WhatMattersNowSection.swift` (506 lines) — a
  max-three-card surface per the PR description.
- **Canonical Suggested-task review UI** (`f0d188990` "add canonical Suggested task review"). New:
  `Desktop/Sources/MainWindow/Tasks/SuggestedTasksSection.swift`,
  `Desktop/Sources/MainWindow/Tasks/SuggestedTasksStore.swift`.
- **Contextual resurfacing gates** (`65723019c` "add contextual resurfacing gates"). New:
  `TaskContextualResurfacingService.swift`. Per the PR description: explicit quiet-hours, spacing,
  budget, focus, dedupe, and policy-grant gates control when a Suggested task/candidate is allowed
  to resurface to the user — a new throttling layer with no baseline analogue.
  Post-tag hardening: `50d4c8699` "re-add defensive newest-first sort for suggested candidates."
- **Attributable, small feedback model** (`adf58a91a` "add attributable attention recommendations").
  Accept/later/dismiss with at most 3 optional reason choices — replaces (for canonical-mode
  accounts) whatever ad hoc accept/dismiss the existing audit assumed.
- **Owner-scoped isolation hardening** (`6aac19df0` "isolate task intelligence by owner",
  `171 8b6f64491`-adjacent fixes): account-generation fencing across recommendation/task/
  goal/workstream/recurrence/vector-index writes, so a fast account-switch can't let a prior
  owner's async Suggested-task result mutate or navigate the current owner's UI. Not mentioned in
  either existing audit file; relevant if Windows ever ports account-switch-adjacent task/goal UI.
- **`sqlite-store.ts` schema drift is bigger than the 8-table description Stream 1's plan uses**
  (see PARALLEL-PLAN.md corrections below).

## CHANGED behaviors invalidating specific existing-audit claims

- **02-proactive-tasks-goals.md, "Screen-based AI task extraction" (lines 29-39)** describes
  `TaskAssistant.extractTaskSingleStage` unconditionally producing `staged_tasks` rows. **New
  truth:** whether an account uses that path at all is gated by a **server-driven**
  `OmiAPI.TaskWorkflowMode` (`off`/`shadow`/`write`/`read`/`_unknown`, delivered alongside an
  `accountGeneration` counter — see `Desktop/Sources/Generated/OmiApi.generated.swift:3822-3851`).
  `TaskCaptureModePolicy.usesLegacyStaging(_:)` in `ScreenCandidateAdapter.swift` returns `true`
  only for `.off/.shadow/.write` and `false` for `.read` (canonical) — meaning `.read`-mode accounts
  run the new Candidate pipeline instead of the documented staged-task flow. Backend confirms this
  is an active migration, not a hypothetical: `backend/utils/task_intelligence/staged_migration.py`
  is explicitly "Mode-aware, resumable staged-task to Candidate reconciliation," with
  `proposal_from_legacy_staged()` converting old `staged_tasks` rows into `CandidateCreate` objects.
- **02-proactive-tasks-goals.md, "Staged-task deduplication" / "Task prioritization" / "Staged→
  action-item promotion" (lines 41-75)**: same caveat — `TaskCaptureModePolicy.allowsLegacyPromotion
  /allowsLegacyRanking/allowsDestructiveLegacyDeduplication` all gate on the same
  `usesLegacyStaging` check. The three services (`TaskDeduplicationService.swift`,
  `TaskPrioritizationService.swift`, `TaskPromotionService.swift`) still exist unmodified in file
  terms, but their applicability to "current Mac behavior" is now conditional, not universal. Since
  the mode is server-controlled per account, neither Mac's UI nor the Windows audit reader can
  assume the legacy pipeline is authoritative without checking which mode a test account is in.
- **02-proactive-tasks-goals.md, "Tasks page richness" (lines 121-129)** cites `TasksPage.swift`'s
  filter surface (status/date/category/source/priority/origin + sort/indent) as a Mac advantage
  Windows lacks. **Post-tag** (not yet in the frozen v0.12.72 reference, but immediately next in
  upstream history — flag for tracking): `71cb9af64` "feat(desktop): simplify Tasks filters to a
  mobile-parity completed toggle (#9665)" **removes** that rich filter surface in favor of a single
  completed-toggle matching mobile. If/when the next Mac reference tag is cut, this claim will
  likely flip from "Mac has richer filters" to "Mac simplified toward Windows' existing model" —
  worth not building the rich-filter-parity item at all pending confirmation, since Mac itself
  concluded it was the wrong direction. Companion post-tag commits: `b348a399c` "converge Tasks to
  empty when all tasks were completed or removed on other devices," `ec2e4f1c4` "fallback telemetry
  for empty-cloud task reconciliation," `daad09098` "drop client-side createdAt sort — preserve
  backend order" — all pointing at a broader post-beta "trust the backend, stop local
  reconciliation cleverness" direction for Tasks specifically.
- **01-proactive-focus-insight.md's Focus/Insight/coordinator claims remain accurate.** Verified at
  the tag: `AssistantProtocol.swift`'s `ProactiveAssistant` protocol (`shouldAnalyze`, `analyze`,
  `onAppSwitch`, `onContextSwitch`) is unchanged in shape; `FocusAssistant.swift`,
  `GlowEdgeWindow.swift`, `InsightAssistant.swift`, `AIUserProfileService.swift` all still exist with
  no structural rename. No commit in the domain grep touched `Focus*`/`Insight*`/`Glow*` files in
  this window — the two areas evolved independently. No correction needed to file 01.

## REMOVED/reworked things the plan assumes

- Nothing in the Tasks/Goals/TaskAgent domain was outright removed at the v0.12.72 tag — the
  workstreams work was additive (legacy pipeline kept, gated by mode). The one **planned** removal
  (per the post-tag scan) is the Tasks filter-richness surface (`71cb9af64`, see above) — not yet
  landed at the frozen tag, but immediately upstream of it.
- **`TaskAgentManager` (System B, the tmux/Claude Code spawner) is unchanged in mechanism** —
  confirmed by reading `TaskAgentManager.swift` (720 lines) at the tag: still shells `/bin/zsh -c`,
  still does `tmux new-session -d ... claude --dangerously-skip-permissions "$(cat promptfile)"`,
  still polls via `tmux capture-pane`. It remains completely disconnected from the new
  kernel/workstream-continuity contract that `TaskChatCoordinator` (System A, the "Investigate"
  chat) now uses. If anything, the gap between System A and System B widened in this window: System
  A gained kernel-backed continuity (control tools, SQLite tables, artifact versioning) while System
  B stayed exactly as documented in the existing audit.

## Backend contract changes in this domain

- New backend router `backend/routers/candidates.py` + `backend/models/candidate.py`
  (`CandidateCreate`, `CandidateStatus`, `CandidateAction`, `CandidateSubjectKind`).
- New backend router `backend/routers/workstreams.py`.
- New `backend/models/task_intelligence.py`-adjacent `TaskWorkflowControl`/`TaskWorkflowMode` model,
  and `backend/utils/task_intelligence/capture_policy.py` (the server-side twin of
  `ScreenCapturePolicy.evaluate` in Swift — comment in Swift explicitly says "keep in sync with"
  this file).
- `backend/utils/task_intelligence/staged_migration.py` — resumable staged→Candidate reconciliation,
  confirming the backend, not just the client, is mid-migration off the legacy staged-tasks model.
- Legacy `backend/routers/staged_tasks.py` still exists (not deleted) — both systems are live
  simultaneously, selected per-account by `TaskWorkflowMode`.
- Kernel control-tool surface: confirmed **still exactly 18 tools** in
  `agent/src/runtime/control-tool-manifest.ts` (`list_agent_sessions`, `get_agent_run`,
  `build_desktop_awareness_snapshot`, `list_desktop_action_queue`, `get_desktop_open_loops`,
  `build_desktop_context_packet`, `route_desktop_intent`, `evaluate_desktop_tool_policy`,
  `create_desktop_dispatch`, `resolve_desktop_dispatch`, `cancel_agent_run`,
  `inspect_agent_artifacts`, `update_agent_artifact_lifecycle`, `send_agent_message`,
  `spawn_background_agent`, `spawn_agent`, `run_agent_and_wait`,
  `set_desktop_attention_override`) — matches Stream 1's "18 control tools regardless of provider"
  claim exactly. The 5 new workstream-continuity tools (`prepare_workstream_continuity`, etc.) are
  **not** in this manifest — they are host-only control tools invoked directly by
  `TaskWorkstreamContinuity.swift`, not part of the LLM-exposed 18.

## Impact on the 4 Windows parity streams

- **Stream 3 item 5** ("screen-based AI task extraction: staged-tasks pipeline: backend
  `/v1/staged-tasks` with relevance scores + promote flow already exists server-side") **targets the
  legacy pipeline that Mac itself is actively migrating away from.** Before Stream 3 builds this,
  confirm with Chris/product whether Windows should port (a) the legacy staged-tasks model the audit
  describes in detail, (b) the new canonical Candidate/workstream model, or (c) whichever mode is
  live for most accounts today (unknown from static reading — `TaskWorkflowMode` is server-assigned,
  possibly per-account rollout cohort). Building toward (a) risks porting a system Mac is
  decommissioning.
- **Stream 3's Tasks-page-richness ambitions** (implicit in "port `pages/{Tasks,Goals}.tsx`" scope,
  and explicit in audit file 02's "Tasks page richness" gap) should **not** chase Mac's
  filter/sort/indent surface — post-tag commit `71cb9af64` shows Mac deliberately simplified toward
  a mobile-parity single completed-toggle. This is a "post-beta, don't port yet" item per the
  brief, but it changes the target enough that Stream 3 should not spend effort on rich Tasks
  filters without re-confirming intent once the next Mac reference lands.
- **Stream 1's kernel-schema porting scope is undercounted.** PARALLEL-PLAN.md line 51-54 says the
  kernel is "a port of Mac's `sqlite-store.ts` schema: sessions, runs, adapter_bindings,
  run_attempts, events, artifacts, delegations, grants" — that's the original 8-table baseline
  schema and is still accurate as a *subset*, but `sqlite-store.ts` at v0.12.72 has grown to 2418
  lines and ~20 tables total, adding (post-baseline) `desktop_context_packets`, `desktop_dispatches`,
  `desktop_artifact_deliveries`, `desktop_memory_candidates`, `desktop_task_candidates`,
  `desktop_context_access_log`, `desktop_attention_overrides`, `surface_conversations`,
  `conversation_turns`, `completion_delta_checkpoints`, `workstream_artifact_versions`,
  `workstream_artifact_heads`, `workstream_continuation_checkpoints`, `schema_migrations`. Several of
  these (the `desktop_*` cluster, `surface_conversations`/`conversation_turns`) look like they
  belong to Stream 1's own "structured content blocks" and "chat sessions sidebar" scope, not just
  Stream 3's task candidates — Stream 1 should re-read the full current schema before finalizing its
  kernel port, not just the 8-table description in its own plan section.
- **Stream 1's Gate 9 ("skip `TaskAgentManager`, upstream is consolidating on the kernel as single
  run authority") is CONFIRMED correct and, if anything, understated.** At the tag, System A
  (`TaskChatCoordinator`) is now kernel-integrated via `TaskWorkstreamContinuity`; System B
  (`TaskAgentManager`) remains pure tmux/Process with zero kernel involvement — the architectural
  gap the gate's rationale describes is real and has widened, not narrowed. Post-tag commit
  `144216bb0` "refactor(agent): make kernel the single run authority" (upstream, not yet in a
  tagged Mac release) further confirms this direction. No action needed; the gate's decision holds.
- **Stream 1's Gate 7 ("pi-mono default provider") is CONFIRMED accurate.** Verified
  `ChatProvider.swift:1040`: `@AppStorage("chatBridgeMode") var bridgeMode: String =
  BridgeMode.piMono.rawValue`, with the legacy `omiAI` value auto-migrated to `piMono` on read
  (line 1211-1213). `pi-mono` remains a live adapter in `agent/src/adapters/pi-mono.ts` /
  `agent/src/runtime/adapter-selection.ts`.
- **Stream 1's "Mac routes bar text through an LLM intent classifier (Haiku, ~300-500ms)" claim is
  CONFIRMED accurate but was conflated with a different component** — worth Stream 1 noting the
  distinction. There are two separate router mechanisms at the tag:
  1. **Bar chat-vs-agent classifier** — `Desktop/Sources/FloatingControlBar/AgentPill.swift:267-286`,
     a real LLM call (`model: "claude-haiku-4-5-20251001"`, 4s timeout, JSON `{route, title, ack}`
     schema) deciding chat-bar-inline vs. spawn-background-agent. This is what Windows' regex-based
     `detectAgentTask` should be compared against/upgraded toward.
  2. **`routeDesktopIntent` in `agent/src/runtime/desktop-intent-router.ts`** — a pure regex/heuristic
     function (no LLM call at all) that decides among `resume`/`fork`/`delegate`/`dispatch`/
     `quick_answer`/`new_run` for routing to/among *existing agent sessions* once the decision to use
     an agent has already been made. This is a different, non-LLM decision layer Stream 1's plan
     doesn't currently distinguish from item 1 — both exist and are both worth porting, but they are
     not the same "intent router."
- **Stream 1's Gate 8 (staged kernel-as-default-chat rollout) is unaffected** by anything found in
  this domain scan — no evidence contradicts the staged/flagged rollout plan; post-tag commits
  (`eef09b359` "Converge desktop agent, voice, and journal ownership," `447a891ce` "close convergence
  authority races," `16d212ff9` "lock convergence ownership contracts") show upstream actively
  hardening exactly the ownership/race concerns Gate 8's safeguards anticipate — directionally
  validating the safeguards, nothing to correct.
- **No impact found on Stream 2 or Stream 4** from this domain's commit set — Focus/Insight (Stream
  3, file 01) and TaskAgentManager/kernel (Stream 1/3) commits don't touch bar/voice (Stream 2) or
  Rewind/shell (Stream 4) files.

## PARALLEL-PLAN.md corrections

1. **Stream 1, kernel schema (line 51-54)** — "a port of Mac's `sqlite-store.ts` schema: sessions,
   runs, adapter_bindings, run_attempts, events, artifacts, delegations, grants" is **incomplete, not
   wrong**. Those 8 tables are still the core (confirmed via `CREATE TABLE` grep at the tag — all 8
   present unchanged), but ~13 more tables exist that the sentence doesn't mention (listed above).
   Recommend Stream 1 read `desktop/macos/agent/src/runtime/sqlite-store.ts` in full at whatever Mac
   reference it ends up pinning, not rely on the 8-table summary already in its own plan.
2. **Stream 1, "Mac routes bar text through an LLM intent classifier (Haiku, ~300-500ms) to pick
   chat vs agent" (line 84-85)** — accurate for the mechanism it describes (`AgentPill.swift`'s
   `route:"chat"|"agent"` call), but the plan doesn't distinguish it from the separate, non-LLM
   `routeDesktopIntent` session-routing layer in `desktop-intent-router.ts`. Both are real and both
   are candidates for Windows to port; recommend the plan name them separately so Stream 1 doesn't
   accidentally build only one when "intent router" is referenced.
3. **Stream 1, "Mac has a second, disconnected agent system (`TaskAgentManager`)... scope it out of
   this stream explicitly; if ever wanted it belongs to Stream 3's task-extraction work" (line
   86-88) and Gate 9** — confirmed still true and, per the headline finding, more entrenched than
   when written (System A now kernel-integrated, System B still isolated tmux/Process). No wording
   change needed; flagging as verified rather than stale.
4. **Stream 3 item 5 (line 142-144)** — "screen-based AI task extraction: staged-tasks pipeline:
   backend `/v1/staged-tasks` with relevance scores + promote flow already exists server-side" now
   needs a caveat: that pipeline is the **legacy** path per `TaskWorkflowMode`, actively being
   migrated server-side to a Candidate/workstream model (`backend/routers/candidates.py`,
   `backend/routers/workstreams.py`, `backend/utils/task_intelligence/staged_migration.py`). Building
   Windows' task-extraction against `/v1/staged-tasks` alone risks targeting a system Mac is
   decommissioning. Needs a decision gate: port legacy, port canonical, or port whichever
   `TaskWorkflowMode` is live for most production accounts (requires asking backend/product, not
   determinable from source alone).
5. **Cross-cutting corrections section — add one:** the Tasks-page filter/sort/indent richness gap
   documented in audit file 02 and implicitly in Stream 3's `pages/{Tasks,Goals}.tsx` scope should
   be treated as **contested, not settled** — Mac's own post-tag direction (`71cb9af64`, not yet in
   the frozen v0.12.72 reference) is to *simplify* Tasks filters toward mobile parity, the opposite
   direction from "close the gap by adding Mac's rich filters to Windows." Recommend Stream 3 defer
   this specific item until a newer Mac reference tag confirms which direction stuck.
6. **No corrections found for:** Gate 7 (pi-mono default — confirmed), the "18 control tools"
   claim (confirmed exact count), Stream 1's kernel-as-single-run-authority framing (confirmed,
   post-tag upstream commits reinforce it), Stream 3's Focus/Insight/coordinator descriptions
   (file 01 — confirmed unchanged at the tag), or Gate 8's staged-rollout safeguards (unaffected,
   directionally reinforced by post-tag convergence-hardening commits).

## Post-beta scan (v0.12.72..upstream/main, desktop/macos, 111 commits) — track, don't port yet

- `144216bb0` refactor(agent): make kernel the single run authority
- `eef09b359` Converge desktop agent, voice, and journal ownership (#9597)
- `447a891ce` fix(agent): close convergence authority races
- `16d212ff9` docs(agent): lock convergence ownership contracts
- `46f062762` fix(agent-control): derive consent from PTT transcript for `request_permission`
  (matches the Stream 1 plan's own forward note about "voice-transcript-derived consent" — already
  correctly anticipated, now landed upstream)
- `85a58a29f` fix(macos): enforce cross-surface agent contracts
- `71cb9af64` feat(desktop): simplify Tasks filters to a mobile-parity completed toggle (#9665)
- `b348a399c` fix(desktop): converge Tasks to empty when all tasks were completed/removed elsewhere
- `ec2e4f1c4` feat(desktop): fallback telemetry for empty-cloud task reconciliation (#9671)
- `daad09098` fix(tasks): drop client-side createdAt sort — preserve backend order
- `50d4c8699` fix(tasks): re-add defensive newest-first sort for suggested candidates
- `c371a83a4` Improve Smart Tasks signal quality and isolation
- `3228e4de6` test(desktop/task-03): 150-reorder stability as a seeded property test
- `9ff249242` test(desktop): harness seams + tests for TASK-05, CHAT-07, AUTH-03/04, TASK-03, MIC-04

None of these are in the frozen v0.12.72 reference, so none should be ported today, but Stream 1 and
Stream 3 should both be aware the "kernel as single run authority" and "simplify Tasks toward mobile"
directions are already committed upstream — the next Mac reference bump will likely make several
items above (Tasks filter richness, especially) obsolete outright rather than just weakened.

## Files/paths referenced

- `desktop/macos/Desktop/Sources/ProactiveAssistants/Assistants/TaskExtraction/{TaskAssistant,TaskAssistantSettings,TaskDeduplicationService,TaskPrioritizationService,TaskPromotionService,TaskModels,ScreenCandidateAdapter}.swift`
- `desktop/macos/Desktop/Sources/ProactiveAssistants/Assistants/TaskAgent/{TaskAgentManager,TaskAgentSettings,TaskAgentStatusRegistry,TaskAgentViews,TaskChatCoordinator,TaskChatRuntime,TaskChatState,TaskThreadProjection,TaskWorkstreamContinuity}.swift`
- `desktop/macos/Desktop/Sources/MainWindow/Dashboard/WhatMattersNowSection.swift`
- `desktop/macos/Desktop/Sources/MainWindow/Tasks/{SuggestedTasksSection,SuggestedTasksStore}.swift`
- `desktop/macos/Desktop/Sources/FloatingControlBar/AgentPill.swift`
- `desktop/macos/Desktop/Sources/Providers/{ChatProvider,AgentRuntimeRouting}.swift`
- `desktop/macos/Desktop/Sources/Generated/OmiApi.generated.swift` (`TaskWorkflowMode`)
- `desktop/macos/agent/src/runtime/{sqlite-store,workstream-continuity,control-tool-manifest,control-tools,desktop-intent-router,adapter-selection}.ts`
- `backend/routers/{candidates,workstreams,staged_tasks}.py`
- `backend/utils/task_intelligence/{staged_migration,capture_policy}.py`
