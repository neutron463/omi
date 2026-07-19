# Upstream voice-turn harvest plan (Windows)

**Status: ACTIVE plan — D0 DECIDED (Chris, 2026-07-18): Option 1, harvest upstream.**
No code changes in this branch; doc only. Formerly `mac-turn-port-plan.md`.

> **How we got here (§0):** Windows did NOT invent the 4-layer turn machinery — it is an honest
> port of **upstream** Mac's current reducer design (adopted upstream 2026-07-09 in
> `0455398a27`); the "Mac has just an enum" claim came from searching the **fork's** Mac tree,
> which froze hours before that adoption. Chris decided: stay on the reducer design,
> **fidelity-audit our port against upstream's current Swift and harvest its fix stream.**

**The plan is §H1–§H4** (diff-map, fidelity-audit scope, tonight's-fixes cross-map, execution
sequence). §§1–7 below them are retained as **historical context**: §1 is the pre-reducer Mac
extraction (Option 2's spec, not chosen), §§4/6 the not-chosen rewrite design. §2's swap-boundary
facts and §5's platform-adaptation table remain live references for harvest work.

The Mac mini reference (`ssh omi-mac`, `~/omi` = upstream clone) runs **upstream** code — it is
the live oracle for any "what does the current design actually do" question.

---

## H1. The diff-map — upstream's voice-plane commits since our freeze

**Freeze point (mechanical):** the Windows port's Mac reference was tag **v0.12.72 =
`50d264c94`** (2026-07-12 10:47 UTC; cited in `track2-groundtruth/02b-a5-port-plan.md`). Of the
66 upstream commits touching `VoiceTurn*` / `PushToTalkManager.swift` /
`RealtimeHubController*` / `PTTVoiceOutputCoordinator.swift` since `0455398a27`: **16 are
ancestors of the freeze** (in the port's base) and **50 landed after** — the harvest candidate
set below (grouped by thread, oldest first within each).

Windows-status vocabulary: `absent` = not in our port (verified or by freeze-date), `n/a` =
Mac-only surface, `divergent` = we solved the same class differently, `audit` = presence
unknown, resolve in §H2. Priority: **P0** = fixes a bug class we've hit · **P1** = hardening
we want · **P2** = unrelated evolution / Swift-structural.

### H1.1 Hub admission & warm-route (the "turn dies while socket warms" class) — ALL P0

Harvest as **one coherent set** — `3dc9a88e40` explicitly fixes a regression introduced by
`dbd69e71c5`; cherry-picking individual commits re-creates upstream's own regression.

| SHA | Date | What it does | Win status |
|---|---|---|---|
| `dbd69e71c5` | 07-13 | Separate transport readiness from context-bound input admission (fail closed); persist failed/interrupted turns per continuity key | absent |
| `3dc9a88e40` | 07-14 | Re-bind the hub route at `hubReady` (the dbd69e regression stranded routes in `.hubWarmWait` → every turn during warmup died silently) | absent (we have pre-regression binding; take the *pair* semantics) |
| `711b3a13af` | 07-13 | Typed `hubAdmissionRejected` reducer transition → bounded transcription fallback instead of stuck `finalizing+hubWarmWait`; regression test `testHubAdmissionRejectionAfterTransportReadyFallsBackAfterRelease` | **absent (verified: 0 hits in `voiceTurnMachine.ts`)** — our stuck-Listening/wedge class |
| `a1d45ffdaa` | 07-14 | Preserve context admission during hub warmup (coordinator FIFO admission test) | absent |
| `02cadde476` | 07-13 | Fence failed PTT context before teardown | absent |
| `be24273360` | 07-14 | **Preserve the FIRST PTT turn while the realtime session is warming**; live screenshot supersedes stale warm screen context; Gemini pixels attached to matching function response | absent — our "first-press zero-byte audio → 400" class |

### H1.2 Session handoff / reconnect / barge continuity — P0

| SHA | Date | What it does | Win status |
|---|---|---|---|
| `a4bb0e32ad` | 07-15 | Make PTT session handoff reliable (+422 lines in hub controller, new `RealtimeHubInputAdmission.swift`, reducer changes) — the big handoff overhaul | absent |
| `337ee3da86` | 07-15 | Preserve completed PTT reconnects (session policies + reducer) | absent |
| `d940ca7c2d` | 07-15 | Preserve PTT handoffs across session refresh | absent |
| `6a199477db` | 07-13 | Preserve PTT spawn authority across barges | absent |
| `dafaeaf761` | 07-14 | Reducer fuzz invariants, ledger widen-never-narrow retention, reconnect session fencing contracts — CI nets for the hub/ordering/reconnect/idempotency bug classes | absent (tests worth porting wholesale) |

### H1.3 Failure legibility & escalation — P1

| SHA | Date | What it does | Win status |
|---|---|---|---|
| `4a966a0ebb` | 07-14 | Legible PTT failure and progress UX (phase 3; umbrella PR `9d925226b0`) | audit |
| `30c2d6cd56` | 07-15 | Keep `ask_higher_model` available on a fresh voice session (over-strict kernel-snapshot gate → refusals) | audit |
| `4ee0d9ac46` | 07-15 | Preserve kernel context in PTT escalation | audit |
| `0717a09372` | 07-13 | Rotate expired OpenAI realtime sessions | divergent (our A7c idle re-warm; compare semantics) |
| `7926056803` | 07-13 | Dead-mic recovery on the *buffered* silent-turn exits (warm-wait paths never fed the recovery policy) | audit (our capture stack differs; class applies) |
| `fa0046a322` | 07-13 | Unify PTT listening chrome; **drop the agent-pill voice follow-up path entirely** | divergent — product change; **flag F1 for Chris**: adopt the removal on Windows or keep our follow-up |
| `6737a32ab9` | 07-16 | Keep PTT on native voice after agent spawn; spawn receipts persistence-only (no local-TTS ack) | audit |
| `e1a037b349` | 07-15 | Screenshot report = internal grounding, provider continues the answer (kills robotic visual read-outs); transcript correction restricted to turn-scoped OCR | audit |
| `952fe5eb07` | 07-14 | Unstick realtime PTT screen turns (F2 stuck class) | audit |
| `ef8104a54e` / `0a275ae59f` | 07-13/15 | QA stabilization umbrellas (chrome, pills, PTT flows / lifecycle convergence) | audit — mine for specifics during §H2, don't port blind |

### H1.4 Screen-evidence freshness series — P2 (P1 only if our screen-context lane shows the same staleness bugs)

`0db8494c54` prioritize live screenshots · `6ddc9d36ca` ground replies in live evidence ·
`e46712bce0` truthful evidence receipts · `e4c16959ac` expire stale evidence · `9ac3648a14`
close evidence turns · `fd47fe536e` make it testable (bounded protocol deadline, fail closed on
undrained screenshot tool) · `d8e55bb402` harden contracts. Harvest as a set if at all.

### H1.5 Telemetry truthfulness, tests, Swift-structural — P2

- `19918f3e10` / `6893c9e16b` / `5facd24986` — truthful dead-mic/Bluetooth `capture_rebuild`
  outcomes (+ mint 429 = retryable, worth one line in our mint path).
- `f20b3c059e` (MIC-04 cap behavioral test) · `9ff2492429` (harness seams) — test-only.
- `85a58a29f4` / `8230433849` / `fff4eef248` / `3d5123c215` / `447a891cec` — cross-surface
  agent-contract convergence (Track-1 kernel territory more than voice; coordinate, don't
  double-port).
- `aac4e9b5b6` (07-12, **90 min after our freeze**) — voice-tools/journal convergence. **Flag
  F2: it DELETES `RealtimeVoiceTurnOutbox.swift`**, which our `src/main/ipc/voiceTurnOutbox.ts`
  mirrors 1:1 ("nothing consumes it yet") — do NOT wire our outbox; decide drop vs align with
  upstream's kernel-journal path (`APIClient+KernelJournal.swift`).
- `c7ca348b04` + `37849bc92b` + `f3c864e2f7` — RealtimeHubController god-file split (and the
  capture-boundary regression the split caused, fixed in f3c864e2f7 — cautionary tale for any
  Windows hubController split).
- `ed3ccf62d7` — `VoiceTurnDomain` strict SwiftPM target: reducer/event types made
  target-internal, drivers publish typed facts through the coordinator ("mutation authority was
  convention-based" → enforced). The structural direction our supervisor work rhymes with;
  guidance, not a port item.
- `bb4c1f5547` / `d8c09ae07a` / `c50b60a28c` / `f987e9bcc4` — Swift strict-concurrency
  migration. n/a.

### H1.6 The 16 pre-freeze commits (in the port base)

`6aa0e02651` harden orchestration edges · `d403072dfd` rapid-PTT continuity · `46e930357c`
typed defaults key · `d52f80233f` local agents/yolo dev · `a448fcbcd4` Parakeet routing ·
`4e22b07331` merge · `44c4492028` notch centering/permissions · `ed106449dc` agent control
contracts · `135130e909` state boundaries · `4911018906` merge · `4d711b4dbe` truthful
chat/gateway observability · `e9eb27cdc4` deterministic UI-deadline tests · `eb3a136b1d` +
`8acba156e7` omni final dedup **by item id** · `12c694e0bf` automation/async hardening ·
`09c0a550fe` merge.

Caveat: "in the base" guarantees only that the *reducer/coordinator* port saw them. Commits on
surfaces we built separately (PushToTalkManager-side, e.g. the omni item-id dedup) get a §H2
spot-check, not a presumption of presence.

## H2. Fidelity audit — scope and method

Goal: a **divergence ledger** (one row per semantic difference) between our port and upstream's
CURRENT Swift, not line noise.

1. **Reducer:** diff `voiceTurnMachine.ts` (31 events, 9 phases, 10 deadlines, 16 terminal
   reasons as ported) against upstream `VoiceTurnStateMachine.swift` at `upstream/main` (now
   inside the `VoiceTurnDomain` target post-`ed3ccf62d7`). Enumerate: events added/renamed
   (confirmed: `hubAdmissionRejected` missing on our side), deadline value changes, terminal
   reasons/semantics changes, fence changes (re-verify the nil-identity rule survived their
   refactors), queued-event mechanics changes.
2. **Coordinator:** ours vs upstream `VoiceTurnCoordinator.swift` — admission FIFO, timeline,
   `onTimelineEntry`-equivalent surface.
3. **New upstream modules with no Windows counterpart:** `RealtimeHubInputAdmission.swift`,
   `RealtimeHubSessionPolicies.swift`, `RealtimeHubController+ScreenEvidence.swift`,
   `RealtimeScreenEvidence.swift` — decide map-onto-existing vs port.
4. **Tests as the sync instrument:** upstream's `VoiceTurnReducerTests` grew from the 38 cases
   we ported (e.g. `+510` lines in `aac4e9b5b6` era, admission tests in `711b3a13af`). Port the
   test deltas name-for-name FIRST; every red test is a divergence-ledger row with its fix
   commit attached. This is the mechanical core of the audit.
5. **Behavior questions → Mac mini** (upstream code, non-GUI: named bundle + `omi-ctl` bridge +
   `/private/tmp/omi-dev.log`), per the standing setup. Gemini barge-in live check (old gate
   M-V1) folds in here.

## H3. Tonight's Windows fixes vs upstream

| Windows fix (tonight) | Upstream status | Action |
|---|---|---|
| #195 blind-sampler hold gates (GetAsyncKeyState/UIPI) | n/a — Mac input stack can't have it | Keep; below the turn layer |
| #196 Gemini tool-schema sanitizer | Upstream HAS `additionalProperties` handling in `RealtimeHubTools.swift` (+ contract-fixture tests) | §H2: compare semantics; adopt their catalog-source placement if stronger (ours regressed once in the tool-loop PR precisely because it sat in the wrong layer) |
| #197 amplitude mapper | n/a — Windows render stack | Keep |
| #198 short-press wedge containment (drop-queued-events) | Same *symptom family* fixed differently: `711b3a13af` typed `hubAdmissionRejected` + `3dc9a88e40` route binding | Harvest upstream's mechanism (H1.1); keep our containment until their tests pass on our port, then reassess ours as redundant |
| #199 mute-at-release | Upstream never had the bug (restore-at-release preserved through their refactors — verify in §H2) | Nothing to harvest; our fix realigned us |
| A7c circuit recovery + `setup_rejected` close taxonomy | **Upstream lacks it** (strikes still just stop at max) | Keep — **potential upstream contribution, Chris's manual step only** (pseudonym rule: no agent ever pushes/PRs upstream) |
| `feat/win-voice-plane-supervisor` (dataflow watchdog, flight recorder, runtime invariants, `resetVoicePlane`) | Upstream lacks; their `ed3ccf62d7` mutation-authority isolation is a cousin, not an equivalent | Keep — same contribution note as above |
| `voiceTurnOutbox.ts` (unwired) | Upstream **deleted** its Swift original 90 min after our freeze | Flag F2 (H1.5): drop or realign — decide during H2, do not wire |

## H4. Execution sequence

Direction-neutral prerequisite (unchanged from §6 Phase 1): **the regression harness at the
swap boundary** — tonight's 8-item repro catalog as hermetic tests against the CURRENT
implementation. It gates every harvest wave exactly as it would have gated the rewrite.

- **Wave H0 — fidelity audit (1 session):** run §H2, produce the divergence ledger; port the
  upstream reducer/coordinator test deltas name-for-name (red tests = the ledger). Read the
  full diffs of every H1.1/H1.2 commit while writing the ledger. Output: an ordered,
  test-backed harvest queue replacing this doc's priority guesses.
- **Wave H1 — P0 harvest (2–3 sessions):** the admission/warm-route set (H1.1) as one PR wave,
  then the handoff/reconnect set (H1.2). Verification per item: the ported upstream test(s)
  green + the Phase-1 harness green + the specific live repro (VB-Cable) it maps to.
- **Wave H2 — P1 harvest (1–2 sessions):** escalation availability, buffered dead-mic
  recovery, failure-UX legibility, screen-turn unstick, expired-session rotation — filtered by
  what the H0 ledger confirms applies to our stack.
- **Standing rule (proposed for AGENTS.md/CLAUDE.local.md after this lands):** the port must
  never freeze silently again — each voice-plane work wave starts by re-running the H1 commit
  query against `upstream/main` and triaging anything new.

**Total: 4–6 agent-sessions.** Decision flags for Chris inside the harvest: **F1**
(fa0046a322: adopt upstream's removal of the agent-pill voice follow-up?), **F2**
(voiceTurnOutbox: drop vs realign), and the two upstream-contribution candidates in §H3
(Chris-manual only).

---

## 0. Provenance finding — the premise, corrected (DECISION GATE D0)

### 0.1 What is actually true (git evidence, reproducible)

- **Upstream Mac adopted the reducer design 9 days ago.** Commit `0455398a27`
  ("refactor(desktop): make voice turns reducer-driven", David Zhang, 2026-07-09 20:59 -0400)
  adds `VoiceTurnStateMachine.swift` (848 lines), `VoiceTurnCoordinator.swift` (329),
  `VoiceTurnReducerTests.swift` (688), `VoiceTurnCoordinatorTests.swift` (259) and reworks
  `PTTVoiceOutputCoordinator.swift`. Its message states the motivation: *"Centralize PTT
  lifecycle, deadlines, UI projection, and terminal ownership in a typed reducer/coordinator.
  Fence provider callbacks, persistence, seed refresh, and audible output with turn-scoped
  identities and leases."* — i.e., **upstream hit reliability problems in the two-owner design
  and built the reducer as the fix.** These files are live on `upstream/main` today.
- **The fork diverged hours before that.** `git merge-base origin/main upstream/main` =
  `0d09ede61b` (2026-07-09 22:15 UTC); the reducer commit (2026-07-10 00:59 UTC) is not an
  ancestor. The fork's `desktop/macos` tree — the one searched by the research report and
  extracted in §1 of this doc — is the **pre-reducer** Mac, frozen ~3 h before upstream
  replaced it. `git ls-tree origin/main` confirms zero `VoiceTurn*` files.
- **Windows' provenance headers are accurate.** `voiceTurnMachine.ts` landed 2026-07-14
  (`f9df858602`, "pure VoiceTurn reducer + ported Swift invariant tests [Track 2 A5 PR1]") as a
  genuine port of upstream's then-current Swift, tests kept name-for-name. No invention, no
  fabricated provenance.
- **Upstream is actively stabilizing the same design our port froze at day-5 of.** 66 commits
  touch `VoiceTurn*` / `PushToTalkManager.swift` / `RealtimeHubController.swift` on
  `upstream/main` since 2026-07-09, several rhyming with tonight's Windows wedge catalog:
  `a4bb0e32ad` "make PTT session handoff reliable", `711b3a13af` "recover PTT after rejected
  hub admission", `337ee3da86` "preserve completed PTT reconnects", `4a966a0ebb` "legible PTT
  failure and progress UX".
- How the error happened: the researcher searched the fork checkout, where the Swift files
  genuinely don't exist — the known empty-grep-≠-absence failure mode, at *remote* granularity
  (fork vs upstream), compounded by the repo's history of fork/upstream base confusion.

### 0.2 Decision Gate D0 — **DECIDED: Option 1 (Chris, 2026-07-18)**. Comparison kept for the record.

| | **Option 1 — stay on the reducer; fidelity-audit + harvest upstream fixes** | **Option 2 — adopt the pre-reducer two-owner shape (this doc's §1)** |
|---|---|---|
| Port doctrine | Follows it (upstream Mac's *current* design is the reference) | Violates it (adopts a design upstream explicitly abandoned) |
| Wedge evidence | Tonight's wedges are in OUR 5-day-stale port; upstream's fix stream suggests the design stabilizes; several fixes may be directly harvestable | The two-owner shape structurally lacks the seams the wedges lived in (drop-don't-queue, single owner) — §1.5's structural arguments are real |
| Field evidence | Upstream Mac ships it NOW (the Mac mini reference runs it) | Shipped on Mac for months pre-07-09; but upstream judged it insufficient (their stated reasons mirror OUR supervisor branch's goals) |
| Cost | Diff-map 66 upstream commits, port relevant fixes, align divergences (~3-5 sessions) | Full rewrite per §6 (~5-8 sessions) + permanent divergence from upstream Mac |
| Risk | Stays coupled to a young, still-churning upstream design | Foregoes every future upstream voice fix; we own the design alone |

**Recommendation (mine, for Chris to accept/override):** Option 1 first — run the fidelity
diff-map (§0.3) before committing to either. If the diff shows tonight's wedge classes have
upstream fixes we simply never pulled, Option 1 wins outright and cheaply. If the diff shows
upstream is still fighting the same wedge classes in Swift, that is strong evidence the design
itself is the liability, and Option 2 (this doc's §§1-6) proceeds with its premise *earned*
rather than assumed. Note: upstream's stated reasons for the reducer (deadlines, fencing,
terminal ownership, projection) are exactly what our supervisor branch provides *outside* the
turn layer — so Option 2 + supervisor is not naively reverting to the design upstream outgrew.

### 0.3 Option 1 outline (if D0 = fidelity audit)

1. Diff-map: for each of the 66 upstream voice commits since `0455398a27`, classify —
   already-ported / not-ported-and-relevant (map to tonight's repro catalog) / Mac-only.
2. Port the relevant fixes; re-verify the ported reducer against upstream's current
   `VoiceTurnReducerTests` (names were kept verbatim — the suites should re-sync mechanically).
3. Live-verify the wedge catalog on the Mac mini (upstream code) to confirm the design's
   current behavior — same Gate M-V1 machinery as §6, now serving fidelity instead of port.
4. Keep the supervisor layer regardless (it addresses gaps neither design covers: dataflow
   watchdog, F4 cross-port invariants).

---

## 1. HISTORICAL — the pre-reducer Mac design (fork tree; Option 2's spec, not chosen)

**Provenance (per §0):** this section extracts the Mac design as of the fork's tree
(`origin/main`, = upstream at 2026-07-09 22:15 UTC, hours before upstream adopted the reducer).
It shipped on Mac for months up to that date. It is NOT upstream Mac's current design — read it
as the faithful spec for Option 2, not as "what Mac does today". All file:line citations are
against the fork tree.

This Mac has exactly **two owners**, both `@MainActor` singletons, communicating by direct
method calls: no reducer, no event queue, no coordinator object, no state-machine module
(`VoiceTurnStateMachine.swift` / `VoiceTurnCoordinator.swift` do not exist at this tree state;
the voice plane is `PushToTalkManager.swift` + `RealtimeHub*.swift`, with
`PTTVoiceOutputCoordinator.swift` as a small playback-lease helper that exists in both eras).

### 1.1 Owner 1 — `PushToTalkManager` (gesture + turn lifecycle)

`desktop/macos/Desktop/Sources/FloatingControlBar/PushToTalkManager.swift` (1,826 lines).

**The entire turn state is one enum** (`PushToTalkManager.swift:48-54`):

```swift
enum PTTState {
  case idle
  case listening            // key held, mic capturing
  case pendingLockDecision  // quick tap released; waiting ≤0.4s for a second tap
  case lockedListening      // hands-free capture (double-tap lock)
  case finalizing           // key released; turn being committed/transcribed
}
@Published private(set) var state: PTTState = .idle
```

Everything else is per-turn scratch (buffers, flags, work items) that is reset on entry to
`idle` — not additional states.

#### Transition table (every edge, with trigger and source line)

| From | Event | To | Mechanism |
|---|---|---|---|
| idle | shortcut down (no recent tap) | listening | `handleShortcutDown` → `startListening()` (`:236-238`, `:300`) |
| idle | shortcut down within 0.4 s of last up (+ `doubleTapForLock`) | lockedListening | `enterLockedListening()` (`:232-234`) |
| listening | shortcut up, hold < 0.22 s (`tapToLockMaxHoldDuration`) | pendingLockDecision | `enterPendingLockDecision()` (`:264-266`, `:390`) |
| listening | shortcut up, hold ≥ 0.22 s | finalizing | `finalize()` (`:267-270`) |
| pendingLockDecision | shortcut down (second tap) | lockedListening | `stopListening()` + `enterLockedListening()` (`:244-246`) |
| pendingLockDecision | 0.4 s timer (`finalizeWorkItem`) | finalizing | `DispatchWorkItem` scheduled in `enterPendingLockDecision` (`:397-404`) |
| lockedListening | shortcut down (tap while locked) | finalizing | `finalize()` (`:248-250`) |
| finalizing | transcript sent / hub committed / turn discarded | idle | `sendTranscript()` (`:1076`), hub path sets `.idle` synchronously (`:729`), too-short hint path (`:977`) |
| any non-idle | cancel / error / teardown | idle | `stopListening()` (`:407-443`) |
| listening (shortcut down repeats) | — | listening | explicitly ignored (`:240-242`); key-down repeats are filtered at the monitor (`!event.isARepeat`, `:197`) |
| finalizing (shortcut down) | — | finalizing | ignored (`:252-253`) — no queuing of gestures into a closing turn |

Notes that matter for the port:

- **Events that don't match the current state are dropped, not queued.** There is no event
  queue anywhere. A key press during `finalizing` is simply ignored. This is the exact
  opposite of the Windows reducer's queued-event design that produced #198.
- **`finalizing` is exited synchronously on the hub path** — `finalize()` sets
  `state = .idle` immediately after the silence gate + `commitTurn()` (`:729`, `:1318`);
  the *response* (model speaking) is not a PTT state at all. Response-in-flight lives in
  the hub controller's `responding` boolean. This is why a new press during playback is a
  clean `idle → listening` transition that *becomes* the barge-in (see §1.4), not a special
  state edge.
- **Too-short turns end with a visible hint, not silence**: `finishTooShortPTTTurnWithHint`
  (`:970-994`) sets `state = .idle` immediately (so a rapid follow-up press is never dropped
  — explicitly commented at `:974-977`), shows "Hold longer to record" via `pttHintText`, and
  a generation-tagged 2 s task clears it (`pttHintGeneration`, `:99-101`, `:983-993`).

#### Timers and watchdogs in the PTT owner (complete list)

| Timer | Duration | Purpose | Site |
|---|---|---|---|
| `finalizeWorkItem` | 0.4 s | pendingLockDecision → finalize if no second tap | `:397-404` |
| `liveFinalizationTimeout` | 8 s (omni) / 3 s (live Deepgram) | release watchdog: transcript never arrives → send what we have / fall back to Deepgram | `:868-882`, `:952-960` |
| hub warm-wait | 1.0 s (`hubWarmGraceSeconds`) | buffer mic audio while socket warms; then hub / omni / batch-transcribe | `:120`, `:1243-1246` |
| hint auto-clear | 2 s / 4 s | clears "hold longer" / "too long" hints, generation-fenced | `:985`, `:1031` |

That's all. There is no per-phase deadline table and no independent supervisor on Mac — a
release watchdog per async wait, generation-fenced. (The Windows supervisor layer is our
*addition* and stays; see §2.3 and §4.3.)

#### Audio mute invariant (the F4 lesson, as Mac implements it)

- Mute on capture start only: `SystemAudioMuteController.shared.muteForListening()` inside
  `startListening()` (`:315-317`) and `enterLockedListening()` (`:353-355`), gated by the
  `pttMuteSystemAudio` setting.
- **Restore is the FIRST statement of both exit paths**: `finalize()` restores before any
  async work (`:704`: "Dictation is over — restore any audio we muted so the track resumes
  immediately"), and `stopListening()` restores unconditionally at the top (`:409`: "Always
  restore audio on teardown (cancel, error, cleanup) so we never leave it muted").
- **Defensive re-restore at playback start**: `hubDidReceiveAudio` calls
  `SystemAudioMuteController.shared.restore()` before enqueuing reply PCM
  (`RealtimeHubController.swift:1594-1595`) — "make sure the model's reply is audible even
  if capture teardown restore is delayed by hardware."

The invariant is therefore *mute window ⊆ key-held window*, enforced at three call sites, with
the playback-side restore as a belt-and-suspenders heal. The Windows hub port violated exactly
this (restored after reply playback → mute loop).

#### Silence gate and dead-mic recovery (kept per-mode, all at `finalize()`)

- Hub turns: `hubTurnHasSpeech` — energy + zero-crossing gate first, Silero VAD as a
  quiet-speech fallback only (`:651-697`); thresholds at `:539-553`.
- Omni/batch turns: `voicedAudioSeconds` gate (`:806-843`).
- `PTTSilentMicRecoveryPolicy` (`:7-30`): 2 consecutive dead-mic turns (≥0.25 s audio,
  peak ≤ 5) → CoreAudio capture rebuild (`:738`, `:813`).
- Mic capture is fenced by `micCaptureGeneration` (UInt64, `:95`): incremented on every
  start/stop; stale async capture-start completions self-stop (`:1440-1455`).

#### The cascade (fallback chain), as wired on Mac

`startAudioTranscription()` (`:1158-1196`) picks the lane at capture start:

1. Hub active (`RealtimeHubController.shared.isActive`) → hub mode, stream PCM to hub.
2. Hub not yet warm → `startRealtimeHubWarmWait()` (`:1230`): buffer mic PCM locally,
   `waitUntilActive(timeout: 1.0)`; if ready → flush buffer to hub (`:1198-1228`); if not
   ready and still holding → omni STT reusing the buffer (`:1270-1272`); if not ready and
   already released → batch-transcribe the buffered audio (`:1266-1268`).
3. Hub `commitTurn()` returns `.rejectedNoSession` → re-buffer the audio and batch-transcribe
   (`:776-781`, `:1308-1314`).
4. Omni relay dies mid-turn → Deepgram batch fallback on the retained turn buffer
   (`omniDidError` `:1761-1780`, `fallBackToDeepgram` `:1783-1825`, with
   `recordFallback(area: "ptt_cascade")`).

Key shape: **the raw 16 kHz turn audio is always retained in `batchAudioBuffer`** (bounded at
4.5 min, `:114`) regardless of lane, so every downstream failure can re-transcribe the same
turn. A turn is never lost to a lane failure.

### 1.2 Owner 2 — `RealtimeHubController` (connection + response lifecycle)

`desktop/macos/Desktop/Sources/FloatingControlBar/RealtimeHubController.swift` (2,484 lines).

**No enum here at all.** Connection/response state is a handful of booleans plus epochs:

| Field | Meaning | Site |
|---|---|---|
| `hubConnected` | socket authenticated + ready (set in `hubDidConnect` `:1539`, cleared in `teardownSession` `:964`) | `:347` |
| `responding` | model reply in flight (set in `commitTurn` `:1397`, cleared at turn done / error / cancel) | `:350` |
| `realtimePlaybackActive` | reply PCM audibly playing | `:354` |
| `inputTurnInProgress` | between `beginTurn` and `commitTurn`/`cancelTurn` | `:293` |
| `minting` / `reconnectPending` | in-flight token mint / scheduled re-warm | `:375`, `:332` |

`isActive` (`:471-479`) is **derived**: `hubConnected && provider matches selected-or-failover`.
PTT reads it; nothing else signals "ready".

#### `turnEpoch` — Mac's entire answer to the stale-async/desync bug class

- One integer, `turnEpoch` (`:291`), incremented once per `beginTurn()` (`:1242`).
- Every async continuation that can land late captures the epoch at spawn and checks it at
  landing: screen-context send (`sendVoiceTurnScreenContextIfNeeded`, checked *three times*
  across its await points, `:865`, `:875`, `:879-881`), early language-ID verdict landing
  (`:1373`, `:1382`), and anything else per-turn.
- Sibling fences for other lifetimes:
  - `isCurrentSession(source)` — every `RealtimeHubSessionDelegate` callback starts with an
    object-identity check `source === session` (`:1511-1513`), and `teardownSession()` calls
    `session.detach()` FIRST (`:957-959`) so a dropped socket physically cannot deliver a
    late error/close ("its death-rattle never reaches us").
  - `realtimeToolTurnEpoch` + `pendingRealtimeToolCallIds` — tool results are keyed
    `"\(epoch):\(name):\(callId)"` and dropped if stale (`:1515-1534`, `:2215-2233`);
    `clearRealtimeToolTracking()` bumps the epoch per turn (`:2230-2233`).
  - `realtimePlaybackEpoch` — playback idle callbacks fenced (`:1161-1172`).
  - `turnGeneration` (UInt64) — speculative screenshot landing (`:1224-1225`, `:1322-1328`).
  - PTT side: `micCaptureGeneration`, `pttHintGeneration` (§1.1).

The pattern is uniform: **unmatched-epoch async results are inert no-ops** (log + return).
No cancellation bookkeeping, no queues, no "pending event" reconciliation.

#### API surface the PTT owner consumes (the entire inter-owner seam)

```
ensureWarm()                      // open WS if needed (BYOK direct / managed mint / cascade)
isActive: Bool                    // derived readiness
waitUntilActive(timeout:) async   // 50ms-poll grace for a warming socket   (:483-493)
prefetchVoiceSeedContextIfNeeded() / prefetchVoiceTurnScreenContextIfNeeded()  // on key-down
beginTurn()                       // PTT-down: reset per-turn state, epoch++, barge-in logic
feedAudio(_ pcm16k: Data)         // mic chunk (thread-hopping internally)
commitTurn() -> .accepted | .deferredForReplacement | .rejectedNoSession   (:1394-1434)
cancelTurn()                      // abandon w/o commit; keeps warm socket  (:1487-1507)
```

Plus `setup(barState:)` wiring. That is the whole contract — eight calls, one enum result.

#### Barge-in (press during playback/response) — the exact Mac mechanism

There is **no barge-in event and no barge-in state**. A new press runs `startListening()`
normally, which calls `beginTurn()`; `beginTurn()` *detects* barge-in from live signals
(`:1205-1329`):

```
bargeIn = responding || realtimePlaybackActive || FloatingBarVoicePlaybackService.isSpeaking
```

1. If barging: capture `InterruptedTurnPayload` (heard transcript + partial assistant text +
   the interrupted turn's idempotency key, `:1331-1340`) and record it to the kernel as
   `interrupted: true` (`:1229-1241`) — chat history keeps the cut-off reply.
2. Reset ALL per-turn state, `turnEpoch += 1` (`:1213-1256`).
3. Stop local playback (`pcmPlayer?.stop()`, `:1257-1259`) + interrupt fallback TTS
   (`:1260`) + clear the glow (`:1261`).
4. Provider-specific cancel of the in-flight reply (`:1262-1283`):
   - **OpenAI — `.inSessionCancel`**: `session.cancelActiveResponse()`; warm socket and
     context survive.
   - **Gemini — `.freshSession`**: no reliable in-session cancel exists, so *replace the
     socket*: `prepareBargeInReplacement()` (`:980-993`) detaches+drops the old session and
     opens a `PendingBargeInReplacementTurn { pendingBegin, pendingCommit, audioBuffer }`
     (`:162-166`); mic chunks buffer into it while the replacement mints/connects
     (`feedAudio` `:1351-1357`); `RealtimeHubBargeInContinuity.prepareReplacementSession`
     (`:179-192`) awaits the interrupted-turn kernel write and seed refresh BEFORE starting
     the replacement, then `finishBargeInReplacementAfterSessionStart` replays
     begin→buffered-audio→(deferred) commit (`:1115-1130`). A release before the replacement
     is ready returns `.deferredForReplacement` from `commitTurn()` (`:1410-1419`).
   - Replacement mint failure → `failBargeInReplacement` (`:1132-1143`): if the user had
     already committed, reset `responding`/playback and exit voice UI (turn ends visibly);
     provider failover per credential class.
5. The new turn proceeds as a normal turn.

So the "handoff" that spans three owners on Windows is, on Mac, ~40 straight-line statements
inside one function on one actor, with the only cross-owner effect being kernel recording.

#### Response output ownership (playback lane arbitration)

- `PTTVoiceOutputCoordinator` (`voiceOutputCoordinator`, `:269`) issues per-turn leases over
  two lanes: `.nativeRealtime` (provider PCM → `StreamingPCMPlayer` at 24 kHz) and
  `.selectedVoiceFallback` (no-native-audio → app TTS). `beginTurn()`/`endTurn()` bracket the
  lease scope; acquisition can return `.denied` (other lane active) or `.staleTurn`
  (`acquireVoiceOutput` `:1176-1194`). This is Mac's single-owner answer to "who may make
  sound for this turn".
- `RealtimeResponseGlowGate` (`:198-239`): 0.75 s idle-debounced glow so PCM chunk gaps don't
  strobe the UI. `markPlaybackActive()` on audio; `scheduleIdleClear()` on player idle;
  `clearImmediately()` on barge-in/error.
- Playback visibility: `barState.isThinking` covers release→first-audio (`:788-790`); the
  glow covers audible playback. (Windows' invisible-playback F3 gap is a projection bug Mac
  doesn't have.)

#### Error surfacing and connection resilience (complete)

- `hubDidError` (`:2244-2343`) is the single socket-death path:
  1. Fenced by `isCurrentSession`.
  2. Classify via `RealtimeHubCloseClassifier.category(message:aliveFor:hasActiveTurn:provider:)`
     (`:36-66`): only `1008` closes are classified; quota/auth via
     `CredentialHealthManager.classifyProviderClose`; `!hasActiveTurn && aliveFor ≥ 60 s` →
     `expectedIdleTeardown` (no Sentry, no strike-relevant noise); else
     `providerPolicyCloseFast`.
  3. Stop playback, `voiceOutputCoordinator.endTurn()`, `exitVoiceUI(clearResponseGlow:)`,
     `teardownSession()`.
  4. Failover: auth failure alive <10 s or quota → `failoverToAlternateProvider` (`:402`);
     otherwise same provider.
  5. Strike budget: `hubReconnectStrikes < maxReconnectStrikes (= 5)` (`:341`, `:2335`);
     re-warm after 1.5 s (`:2338-2342`). Strikes reset on a *completed turn*
     (`hubDidFinishTurn` `:2112`) or a socket that lived >60 s (`:2330-2334`).
- A turn that dies mid-response is simply ended (UI exits voice state, hint = none); the
  user re-presses. Mac has **no automatic turn retry** and no circuit-open terminal state —
  strikes just stop the auto-re-warm; the next PTT press's `ensureWarm()`/`waitUntilActive`
  can still try once, and the cascade answers the turn regardless.
- Turn-level errors (tool failures) are typed (`RealtimeHubToolFailureKind`, `:74-148`) and
  *spoken/sent as tool output text* — never a dead turn.

#### How tool calls ride the turn

- `hubDidRequestTool` registers the call id under the current `realtimeToolTurnEpoch`
  (`:1661-1664`); results return only if session identity AND epoch AND pending-id all match
  (`sendToolResultIfCurrent`, `:1515-1534`).
- `hubDidFinishTurn` **defers turn completion while tool results are pending** (`:2107-2110`)
  — the turn "done" only fires when the tool tail has drained.
- Kernel write happens exactly once per turn (`turnRecorded` flag, `:2125-2175`), with
  `turnIdempotencyKey` (UUID per turn, `:1228`) shared between the interrupted-turn write
  and the completed-turn write.

### 1.3 State diagram (faithful)

```
                    ┌───────────────────────────── any non-idle ──────────────┐
                    │                    stopListening() (cancel/error)        │
                    ▼                                                          │
 ┌──────┐  key-down  ┌───────────┐ up <0.22s ┌────────────────────┐            │
 │ idle │───────────▶│ listening │──────────▶│ pendingLockDecision│            │
 └──────┘            └───────────┘           └────────────────────┘            │
    │  ▲  double-tap     │  up ≥0.22s          │ tap-again   │ 0.4s timer      │
    │  │  (<0.4s)        ▼                     ▼             ▼                 │
    │  │             ┌────────────┐      ┌────────────────┐  │                 │
    │  └─────────────│ finalizing │◀─────│ lockedListening│◀─┘                 │
    │   transcript   └────────────┘ tap  └────────────────┘                    │
    │   sent / hub         ▲                                                   │
    │   committed /        └── (hub path exits to idle synchronously at        │
    │   turn discarded          commit; response lives in hub booleans)        │
    └──────────────────────────────────────────────────────────────────────────┘

 Hub controller (parallel, no enum):  hubConnected ─ responding ─ realtimePlaybackActive
 fenced by: turnEpoch • session identity • realtimeToolTurnEpoch • realtimePlaybackEpoch
```

### 1.4 Sequence diagrams

**Normal hub turn**

```
key-down ─ startListening: mute sys-audio, mic on, prefetch seed+screen ctx
         └ hub.beginTurn: epoch++, reset scratch, activityStart (or defer to connect)
hold     ─ feedAudio ──▶ session.sendAudio  (+ local batchAudioBuffer copy, early LID @1.5s)
key-up   ─ finalize: RESTORE sys-audio, mic off, silence-gate (hubTurnHasSpeech)
         └ pass → hub.commitTurn(.accepted): responding=true, lang hint, commitInputTurn
         └ state=.idle; bar shows isThinking
model    ─ hubDidReceiveAudio: restore sys-audio (defensive), lease .nativeRealtime,
           enqueue 24k PCM, glow on          ─ hubDidEmitText accumulates assistantText
tools    ─ hubDidRequestTool (epoch-keyed) … sendToolResultIfCurrent
done     ─ hubDidFinishTurn (deferred until tool tail drains): responding=false,
           strikes=0, kernel write (idempotency key), endTurn lease, exitVoiceUI
playback ─ player idle (epoch-fenced) → release lease → glow idle-clear (0.75s)
```

**Too-short press**

```
key-down ─ startListening (mute, mic, beginTurn)
key-up   ─ finalize: restore audio, mic off; totalSec < 0.35s → hubTurnHasSpeech=false
         └ hub.cancelTurn(): abandonInputTurn (socket stays warm), state=.idle
         └ finishTooShortPTTTurnWithHint: "Hold longer to record", 2s gen-fenced clear
next press within the hint window is a clean idle→listening (state already idle)
```

**Barge-in during playback**

```
(reply playing: responding=false-or-true, realtimePlaybackActive=true)
key-down ─ startListening → hub.beginTurn:
           bargeIn=true → capture InterruptedTurnPayload → kernel write (interrupted)
           epoch++, pcmPlayer.stop, TTS interrupt, glow clearImmediately
           OpenAI: session.cancelActiveResponse (same socket)
           Gemini: replace socket; mic chunks buffer in PendingBargeInReplacementTurn
hold/up  ─ normal turn; on Gemini, commit before replacement-ready → .deferredForReplacement,
           replayed as begin→flush audio→commit when the fresh session connects
```

**Provider failure / socket death mid-turn**

```
mint fails    ─ typed CredentialHealth classes → failoverToAlternateProvider(reason) or
                stay on cascade; PTT's commitTurn → .rejectedNoSession → buffered
                batch-transcription of the SAME retained turn audio (turn never lost)
socket dies   ─ hubDidError (identity-fenced): classify(aliveFor, hasActiveTurn)
  mid-turn      → stop playback, endTurn lease, exitVoiceUI, teardownSession
                → auth<10s / quota → provider failover; else strike++ (max 5),
                  re-warm in 1.5s; aliveFor>60 resets strikes+failover
                → the in-flight turn ENDS (no auto-retry); next press re-enters cascade
idle close    ─ 1008 && !activeTurn && aliveFor≥60 → expectedIdleTeardown: quiet re-warm,
                no strike, no Sentry
```

### 1.5 Soundness audit — is Mac's implementation actually right?

Chris's question, answered per behavior. Verdicts: **PROVEN** (field evidence or a structural
argument), **PLAUSIBLE** (looks right, not independently verified), **QUESTIONABLE** (must be
verified on the Mac mini reference before copying, or known-imperfect).

| Mac behavior | Verdict | Basis |
|---|---|---|
| Enum + drop-unmatched-events (no queue) | **PROVEN** | Structural: an event that can't be queued can't wedge a closing turn (#198's whole class). Matches the statechart consensus ("unmatched events are inert"). Field: shipped on Mac for months with no wedge-class reports; Windows' queued-event reducer produced one tonight. |
| Events ignored during `finalizing` (no press queuing) | **PROVEN** | Same structural argument; the too-short path even returns to `idle` *early* specifically so a rapid re-press is never dropped (`:974-977` comment documents the bug being fixed). |
| Mute window ⊆ key-held window, restore-first ordering | **PROVEN** | Restore is the first synchronous statement of both exit paths — no code path can exit listening with audio muted. Field: Windows' F4 mute loop happened precisely by deviating from this. Defensive restore at playback start (`RealtimeHubController.swift:1594`) covers hardware-delayed restores. |
| `turnEpoch` + per-lifetime fences (session identity, tool epoch, playback epoch, capture generation) | **PROVEN** | Structural: uniform capture-at-spawn/check-at-landing makes stale async results inert; `detach()`-before-drop makes late socket events physically undeliverable. This is Mac's entire desync answer and it is airtight *for the callbacks that are fenced*. |
| Silence gate (energy+ZCR, Silero fallback) + thresholds | **PROVEN** | Dedicated hermetic tests (`PushToTalkSpeechGateTests.swift`: silence, broadband noise, too-short, clear short reply, sustained speech). Threshold values themselves are tuned-not-derived — port them verbatim, don't re-tune. |
| Cascade with always-retained turn audio (turn never lost) | **PROVEN** | Structural: every failure path re-transcribes the same retained buffer; `.rejectedNoSession`/warm-wait/omni-death all verified by code path + `RealtimeHubBargeInContinuityTests.testBeginTurnWaitsForActiveSessionBeforeActivityStart` etc. |
| Too-short hint UX (2 s, generation-fenced) | **PROVEN** | Small, tested by usage; the generation tag exists because the naive version had a real bug (comment `:99-101`). |
| Barge-in detection from live signals (no barge-in state/event) | **PROVEN** (shape) | Structural: deriving barge-in at `beginTurn` from `responding \|\| playbackActive` cannot desync from a separately-tracked flag. The *shape* is sound regardless of provider quirks. |
| Barge-in, OpenAI lane (`cancelActiveResponse`, same socket) | **PLAUSIBLE** | Matches OpenAI Realtime's documented `response.cancel` + truncate semantics. Not live-verified by us on Mac; low complexity. |
| **Barge-in, Gemini lane (fresh-session replacement + deferred commit replay)** | **QUESTIONABLE — verify live before porting** | The earlier wiring audit (`desktop/windows/docs/mac-parity-audit/WIRING-AUDIT.md`) explicitly listed Gemini barge-in as an "is Mac even right?" contract question. It is also the most intricate flow in the file (mint-during-barge, buffered replay, `.deferredForReplacement`) AND the most bug-prone flow in tonight's Windows repro catalog. Mac has hermetic tests for the *ordering* (`RealtimeHubBargeInContinuityTests`) but ordering tests don't prove the provider contract. **Gate M-V1 (§6): live-verify on the Mac mini reference before implementation** — non-GUI: build, drive PTT via the `omi-ctl` bridge, barge into an active Gemini reply, read `/private/tmp/omi-dev.log` for the replacement-session sequence and confirm the successor turn answers correctly. Port the flow only as-verified. |
| Close classification (`RealtimeHubCloseClassifier`) + 5-strike re-warm | **QUESTIONABLE — known-imperfect; keep Windows' improvements** | Only `1008` closes are classified; a fast setup-reject (the Gemini tool-schema class Windows hit in #196) reads as `providerPolicyCloseFast`, drains 5 strikes, then auto-re-warm stops — no circuit *recovery*. The research doc already established Windows' close taxonomy (`setup_rejected`) + circuit recovery are an improvement over Mac. **Do not port Mac's classifier; keep Windows' (§2.3 keep list).** Mac's strike-reset rules (completed turn, aliveFor>60 s) are sound and already mirrored. |
| No dataflow watchdog (no heartbeat/idle-frame observer) | **QUESTIONABLE — known gap (F3)** | Mac simply lacks it; silent midstream stalls would present as a hung "thinking" state until the user re-presses. The Windows supervisor layer (`feat/win-voice-plane-supervisor`) exists to fill exactly this; it stays (§2.3). Do not treat Mac's absence of a watchdog as a design decision to copy. |
| Warm lifecycle (mint/BYOK/failover, seed-stale reconnect) | **PLAUSIBLE** | Shipped and stable, but the research doc notes Mac ignores Gemini `sessionResumption`/`goAway` (hand-rolled continuity instead). Out of scope for the turn-shape port; noted as follow-up, not blindly endorsed. |
| Playback lease coordinator + glow gate | **PLAUSIBLE** | Small, single-owner by construction; no known field defects. Windows already has an output-lease concept to map onto it. |
| Turn-complete deferred on pending tool results | **PROVEN** (shape) | Structural: prevents recording/ending a turn whose tool tail is still speaking. Epoch-keyed result gating is tested (`RealtimeHubToolFailureTypingTests`, `RealtimeHubSpawnAgentTests`). |

Net: the **shape** (two owners, enum, epochs, drop-don't-queue, restore-first) is sound with
field + structural evidence. Two flows must NOT be transliterated blind: **Gemini barge-in**
(live-verify first, Gate M-V1) and **close classification/circuit** (Windows' version is
better — keep it). One Mac gap (no dataflow watchdog) is filled by the Windows supervisor
layer, which survives this rewrite untouched.

**§0 caveat on the whole table:** upstream abandoned this design on 2026-07-09 for stated
reliability reasons (deadlines, fencing, terminal ownership, projection — `0455398a27`). The
structural verdicts above stand on their own merits, but "PROVEN by field evidence" now means
"proven through 2026-07-09"; the strongest counter-evidence to this design is that its own
authors replaced it. Weigh under D0. The Mac-mini reference now runs the REDUCER design, so
Gate M-V1's live verification exercises upstream's current barge-in, not this section's —
which serves Option 1 directly, and serves Option 2 only as a contract oracle (what the
provider tolerates), not as a behavior oracle.

---

## 2. The Windows layers, mapped

**Provenance (per §0):** these files are honest ports of upstream Mac's reducer design
(headers cite `VoiceTurnStateMachine.swift` etc.; tests ported name-for-name in
`f9df858602`, 2026-07-14), frozen at day-5 of a design upstream has since amended 66 times.
Under **Option 1** this section's mapping becomes a fidelity diff against upstream's current
Swift; under **Option 2** it is the demolition survey below.

### 2.1 The swap boundary (verified — identical under both options)

The turn subsystem's external interface is already clean, which is what makes either
direction safe:

- **IN:** gesture events from `usePushToTalk` (three hub-delegate calls: begin / audio /
  release-or-cancel), fed by the main-process #195 gesture layer over IPC; hub socket events
  from the session layer.
- **OUT:** everything else is injected through `VoiceHubTurnDriverDeps` — UI projection,
  kernel turn recording, playback control, telemetry, and tool-execution IPC. No consumer
  reaches into turn-layer internals.
- **Supervisor observation:** one hook — `VoiceTurnCoordinatorOptions.onTimelineEntry`
  (`voiceTurnCoordinator.ts:196-198`, fired per transition inside `contain()` at `:479`),
  payload `VoiceTurnTimelineEntry {sequence, turnID, event, phaseBefore, phaseAfter, route,
  terminalReason, staleEventCount, invalidTransitionCount}`, wired by the driver at
  `voiceHubTurnDriver.ts:242-254`. The driver's own ~10 `flightRecord` call sites key off
  driver-local state and survive any swap that preserves `dispatch()`/`begin()`/`cancel()`
  signatures.
- **Not part of this subsystem (do not touch):** the legacy local PTT pipeline
  (`ptt/machine.ts`) is a separate surface and survives any swap; `voiceController` /
  `sessionMachine` are the ambient Home-surface voice path, NOT the PTT cascade (a prior
  session's misidentification, now corrected).

### 2.2 Layer-by-layer disposition (Option 2)

| Windows layer | Role today | Disposition under Option 2 |
|---|---|---|
| `turn/voiceTurnMachine.ts` (reducer) | Ported upstream reducer: typed events, queued-event mechanics, `DEFAULT_VOICE_TURN_DEADLINES` (`:352`), barge-in `terminate(interruptedByBargeIn)` socket-handoff (`:604`) | **DIES.** Replaced by `pttTurnManager.ts` (§4.1): enum + drop-unmatched. Deadline *coverage* moves to the supervisor watchdog. The #198 class (queued events replayed into a closing turn) is structurally unrepresentable after this. |
| `turn/voiceTurnCoordinator.ts` | Containment wrapper + 256-entry timeline (`:214`) + `onTimelineEntry` | **DIES.** Timeline superseded by the supervisor's plane-wide flight recorder; the new module emits `onTransition` with the same minimum payload (§4.2) so the supervisor plumbing is unaffected. |
| `voiceHubTurnDriver.ts` | Glue: reducer↔hub↔capture↔projection; 45 s release watchdog (`:85`, `fireReleaseWatchdog` `:705`) | **DIES as a layer.** Its hub-facing half folds into `hubTurnController.ts`; its release watchdog becomes Mac's finalization timeouts + the supervisor. Its dep-injection surface (`VoiceHubTurnDriverDeps`) is retained as the new modules' constructor contract so consumers don't change. |
| `hub/hubController.ts` + `hub/hubClose.ts` | Socket lifecycle, warm/strike/circuit, close taxonomy | **CONSOLIDATED, not killed** → `hubTurnController.ts`, keeping the Windows-ahead close taxonomy (`setup_rejected`) + circuit recovery (§1.5), gaining Mac's epoch/identity fencing and detach-before-drop. |
| `turn/voiceOutputCoordinator.ts` | Port of `PTTVoiceOutputCoordinator.swift` (playback-lane leases) | **KEEPS.** This helper exists in BOTH Mac eras — it is not part of the reducer superstructure. |
| `turn/voiceTurnHost.ts` | Host wiring for the turn dir | **DIES with the dir**; replaced by the two-module wiring. |
| `src/main/ipc/voiceTurnOutbox.ts` | Durable kernel-write outbox (main process) | **KEEPS** — it is the INV-CHAT-1 transport, below the swap boundary. |

### 2.3 Kill / keep summary

**Kill (Option 2):** the reducer and its event queue; the per-phase deadline table (coverage →
supervisor); the coordinator object and its private timeline; the driver layer and its
release watchdog; every multi-owner handoff (most importantly the three-owner barge-in
socket handoff at `voiceTurnMachine.ts:604`).

**Keep (both options):** #195 gesture layer (main process) · #197 amplitude mapper · #196
Gemini schema sanitizer · Windows close taxonomy + circuit recovery · supervisor / flight
recorder / `resetVoicePlane` / runtime invariants (`feat/win-voice-plane-supervisor`) ·
`voiceOutputCoordinator` · kernel outbox + INV-CHAT-1 recording discipline ·
`captureLiveStore`→`LiveMirrorHost` projection transport · legacy `ptt/machine.ts` pipeline ·
bar/pill/orb consumers unchanged.

---

## 4. HISTORICAL — Option 2 target design (not chosen)

### 4.1 Shape

Two modules replace the four layers, mirroring Mac's two owners one-to-one, both living in the
**capture renderer** (where mic, hub socket, and playback already live — §5):

**`pttTurnManager.ts`** (new; ports `PushToTalkManager`):

```ts
export type PttState =
  | 'idle' | 'listening' | 'pendingLockDecision' | 'lockedListening' | 'finalizing';

// Gesture events IN (from the main-process #195 gesture layer, over IPC):
handleShortcutDown(): void   // full Mac transition table, §1.1
handleShortcutUp(): void
cancelListening(): void      // teardown/cancel path (always restores system audio first)

// Internal, Mac-shaped:
//  - one `state: PttState`, published to the projection store on every change
//  - per-turn scratch reset on entry to idle (retained turn buffer, hint generation, …)
//  - silence gate + too-short hint (Mac thresholds verbatim)
//  - cascade: hub active → hub; warm-wait 1s buffering → hub/STT-fallback/batch
//  - system-audio mute on capture start; RESTORE as the first statement of
//    finalize() and stopListening()  ← the F4 invariant, ported exactly
```

**`hubTurnController.ts`** (consolidated from today's `hubController.ts` + the driver's
hub-facing half; ports `RealtimeHubController`):

```ts
ensureWarm(); isActive(): boolean; waitUntilActive(timeoutMs): Promise<boolean>
beginTurn(); feedAudio(pcm16k); commitTurn(): 'accepted'|'deferredForReplacement'|'rejectedNoSession'
cancelTurn()

// Internal: turnEpoch (int, ++ per beginTurn), session-identity fencing
// (`source === session` on every socket callback + detach-before-drop),
// toolTurnEpoch-keyed tool results, playbackEpoch-fenced player callbacks,
// barge-in derived at beginTurn from live signals (responding || playbackActive),
// provider strategies: OpenAI in-session cancel / Gemini per Gate M-V1 outcome.
// KEEPS Windows' close taxonomy (setup_rejected) + circuit recovery + strike
// budget — Mac's classifier is NOT ported (§1.5).
```

No reducer, no event queue, no coordinator object, no cross-module "handoff": barge-in is
~40 straight-line statements inside `beginTurn()` on one JS event loop, exactly like Mac's
one `@MainActor`.

### 4.2 Integration contract (what survives around the new core)

| Neighbor | Attachment in the new shape |
|---|---|
| **Supervisor / flight recorder / invariants** (`feat/win-voice-plane-supervisor`) | The new turn module provides the per-transition observation hook the supervisor consumes today via `VoiceTurnCoordinatorOptions.onTimelineEntry` (`voiceTurnCoordinator.ts:196-198`, fired per transition, wired by the driver at `voiceHubTurnDriver.ts:242-254`). Equivalent hook: `onTransition(entry)` with at minimum `{sequence, turnID, event, phaseBefore, phaseAfter, route, terminalReason, staleEventCount, invalidTransitionCount}` — where `turnID` maps to the epoch, and the two counters count epoch-fenced drops (stale async results) and ignored-in-state gestures. Nothing else in the supervisor plumbing reaches turn-layer internals. **The supervisor branch is under active construction (watchdog + renderer-reset consumers landing); re-run the seam check against the MERGED branch before implementation starts (Gate M-V2).** `resetVoicePlane` remains the supervisor's single reset path and calls the new module's `cancelListening()` + `hubTurnController` teardown. |
| **Gesture layer** (#195 main-process sampler, blind-sampler debounce, 220 ms threshold) | Unchanged. It emits down/up over IPC; the turn module consumes them with Mac's transition table. Tap-lock timing already matches Mac (0.22 s / 0.4 s). |
| **Amplitude mapper** (#197) | Unchanged — below the turn layer, feeds the orb only. |
| **Gemini schema sanitizer** (#196) | Unchanged — lives in the session factory, below `hubTurnController`. |
| **Kernel turn recording** (INV-CHAT-1) | Ported at Mac's exact three call sites: interrupted-turn write at barge-in `beginTurn`, completed-turn write at turn-done (deferred past tool tail), both sharing one per-turn idempotency key; `turnRecorded` once-flag. Rides the existing kernel IPC. |
| **UI projection** (bar / pill / orb) | The swap boundary: the new module publishes the SAME projection store shape consumers read today (listening/locked/hint/thinking/responseActive fields), mirrored cross-window via the existing `captureLiveStore` → `LiveMirrorHost` op stream (§5). Consumers do not change. |
| **System-audio mute** (`win-audio-helper`) | Mac's invariant verbatim: mute at capture start, restore-first at both exits, defensive restore at first reply audio. Plus the supervisor's runtime invariant check ("output never muted while reply playing") as the F4 backstop. |

### 4.3 What Mac does NOT have that we deliberately keep (b-list summary)

- Close taxonomy with `setup_rejected` + circuit recovery (Windows-ahead; §1.5).
- The supervisor's dataflow watchdog + plane reset + flight recorder + runtime invariants
  (fills Mac's F3/F4 gaps; sits outside the turn layer).
- Per-phase deadlines: the reducer's deadline table dies with the reducer, but its *coverage*
  moves into the supervisor's watchdog config (phase-appropriate unfed-deadline resets) —
  the turn module itself carries only Mac's release watchdogs (finalization timeout,
  warm-wait grace, hint clears). Recommendation, not a gate: deadlines belong to the
  supervisor that can also observe dataflow, not to the state owner.

---

## 5. Platform-forced adaptations — where Mac's shape cannot port literally

Mac is one process with one `@MainActor`: gesture events, turn state, socket callbacks,
playback callbacks, and UI writes are all serialized on one actor, and `@Published` reaches
SwiftUI directly. Windows is multi-process: the **gesture sampler lives in the main process**
(RegisterHotKey + GetAsyncKeyState, #195), while **mic capture, the hub socket, and playback
live in the capture renderer — a separate BrowserWindow from both the bar window and the main
UI window** (the known capture-vs-UI renderer split: in-memory signals set in capture code
never reach the other windows). Each Mac assumption, and its minimal bridge:

| Mac assumption | Windows reality | Minimal bridging construct (prefer existing patterns) |
|---|---|---|
| One actor serializes everything | Both new modules live in the **capture renderer**; its single JS event loop is the `@MainActor` equivalent. Gesture events arrive over IPC | Electron IPC on one channel is FIFO; the turn module consumes down/up in arrival order. No new coordination invented — this is today's `usePushToTalk` feed, unchanged. |
| `@Published` bar state, written directly | Cross-window UI cannot be set from capture code (renderer-split gotcha) | Projection store written by the turn module, mirrored via the existing `captureLiveStore` `LiveStoreOp` stream → `LiveMirrorHost` in the bar/main windows. Same fields as today's projection (swap boundary). Includes the too-short hint and usage-limit popup signals — both MUST ride the mirror or they are silent no-ops. |
| `SystemAudioMuteController` is synchronous CoreAudio, restore-first ordering is trivially safe | `win-audio-helper` is driven from the main process over async IPC | Preserve *ordering*, not synchrony: the restore IPC is issued as the first statement of finalize/teardown (same site discipline as Mac); reply playback starts later from the same renderer, so restore-before-playback ordering holds per-channel. Belt-and-suspenders: Mac's defensive restore at first reply audio, plus the supervisor's runtime invariant ("never muted while reply playing") as the F4 heal. |
| Screenshot / screen context captured in-process | Capture goes through main-process APIs, async | Epoch-fence the landing exactly like Mac fences its own async capture (`turnGeneration` pattern, §1.2) — the fence, not the transport, is what Mac actually relies on. |
| Kernel writes are in-process async tasks | Kernel store is in the main process | Existing `voiceTurnOutbox` IPC with per-turn idempotency keys — already the durable INV-CHAT-1 transport; no change. |
| `NSEvent` monitors deliver key-up reliably | Elevated/UIPI foreground windows blind `GetAsyncKeyState` (#195 blind-sampler) | Unchanged #195 gesture layer: trust-repeats + 2-sample release debounce stays in the main process, BELOW the turn module. The turn module sees clean down/up only. |

The honest summary: Mac's *serialization* assumption ports cleanly (one renderer, one event
loop); Mac's *direct-write* assumptions all cross a window or process boundary and each one
already has an established transport in the codebase — the adaptations select existing
patterns, they do not invent coordination.
## 6. HISTORICAL — Option 2 migration plan (not chosen)

*(Superseded by §H4. Still live from this section: Phase 1's regression harness (direction-
neutral, gates the harvest too) and Gate M-V2 (supervisor seam re-check), which carries over.)*

Swap boundary (verified in §2/§4.2): gesture events in, projection store + kernel writes +
playback out. Bar/pill/orb consumers and the main-process gesture layer do not change.

### Phase 0 — Contract pin-down (1 agent-session)
- **Gate M-V1 (verification, blocks Phase 2's Gemini lane):** live-verify Mac's Gemini
  barge-in on the Mac mini reference (`ssh omi-mac`, non-GUI: named-bundle build, drive PTT
  via the `omi-ctl` in-process bridge, barge into an active Gemini reply, read
  `/private/tmp/omi-dev.log` for the replacement-session sequence; confirm the successor turn
  answers and the interrupted turn lands in chat history). Outcomes:
  - Mac behaves as designed → port the fresh-session replacement as extracted (§1.2).
  - Mac wedges/misbehaves → **DECISION GATE D2 for Chris**: port Mac's shape anyway and fix
    on top, or adopt the research doc's single locked-interrupt primitive for the Gemini lane
    (deviation from port doctrine, needs sign-off).
- **Gate M-V2:** re-run the supervisor seam check against the merged
  `feat/win-voice-plane-supervisor` (it is still growing); freeze the `onTransition` payload.

### Phase 1 — Regression harness on the OLD implementation (1–2 agent-sessions)
Encode tonight's entire repro catalog as tests that drive the swap boundary (gesture events
in → assert projection/kernel/audio-helper calls out), running against the CURRENT layers:
1. Blind-sampler hold (hold discarded as tap) — #195 class.
2. Short press / too-short turn → hint, next press not dropped — #198 class.
3. Press during `finalizing` → ignored, no queued-event replay wedge — #198 exact.
4. Barge-in during playback → prior reply stopped, interrupted turn recorded, successor
   turn owns the plane (both provider lanes, session-faked).
5. Mute-window invariant: helper `restore` observed before/at reply start; never
   mute-active while playback-active — F4.
6. Provider failure at commit (`rejectedNoSession`) → cascade answers the SAME turn.
7. Socket death mid-turn → turn ends visibly, plane resets, strike/circuit behavior.
8. Stale async results (late tool result, late playback idle, late capture start) → inert.
Tests must pass on old AND new before any flip; they are the port's acceptance criteria, and
they live on as the permanent hermetic suite (Definition of Done #1).

### Phase 2 — Build the new core behind the boundary (2–3 agent-sessions)
- `pttTurnManager.ts` + `hubTurnController.ts` as in §4, flag-gated
  (`voiceTurnMacShape`, default OFF), old layers untouched.
- Wire: gesture IPC → new module; projection store writes; supervisor `onTransition`;
  kernel writes; audio-helper ordering.
- Run the Phase-1 suite against the new implementation until green.

### Phase 3 — Cutover and delete (1–2 agent-sessions)
- Flip the flag ON in dev; live gauntlet: the full repro catalog exercised on a real build
  (VB-Cable deterministic mic input), plus a soak with the supervisor's flight recorder
  reviewed for invariant violations.
- **DECISION GATE D1 for Chris:** ship default-ON. (Recommendation: flag-gated cutover, not
  straight swap — it costs almost nothing since Phase 1 requires both implementations to be
  drivable anyway, it honors the no-regressions rule, and it gives a one-commit revert. But
  the flag must die fast: delete the old reducer/coordinator/driver layers and the flag in
  the same wave once the gauntlet passes — two living implementations is exactly the
  multi-owner disease this port exists to cure.)
- Delete the kill list (§2.3), migrate any remaining imports, update
  `voice-reliability-research.md` and the parity audit docs.

**Total estimate: 5–8 agent-sessions**, dominated by Phase 1 (harness quality is the whole
safety story) and the Phase-2 hub controller consolidation.


---

## 7. SUPERSEDED gates summary — D0 was decided (Option 1); current flags live in §H4 (F1, F2, contribution candidates). M-V1 folds into §H2 item 5; M-V2 still applies before any harvest work that touches the supervisor seam.

### Original gates text (for the record)

**Decision gates (need Chris):**

- **D0 — direction (blocks all implementation).** Option 1: keep the ported reducer design,
  fidelity-audit against upstream and harvest its 66-commit fix stream (§0.2/§0.3). Option 2:
  adopt the pre-reducer two-owner shape (§§1, 4, 6). Recommendation: run Option 1's diff-map
  first — it is cheap (~1 session), and its outcome decides D0 with evidence instead of taste.
- **D1 — cutover default** (Option 2 only, §6 Phase 3): flip `voiceTurnMacShape` default-ON.
  Recommendation: flag-gated cutover with the flag and old code deleted in the same wave.
- **D2 — Gemini barge-in strategy if live verification shows Mac misbehaving** (§6 Phase 0):
  port as-is and fix on top, or adopt the single locked-interrupt primitive.

**Verification gates (agent work, no Chris input needed):**

- **M-V1** — live Gemini barge-in verification on the Mac mini reference (runs upstream's
  current reducer code — serves Option 1 directly; serves Option 2 as a provider-contract
  oracle only, per §1.5).
- **M-V2** — re-run the supervisor seam check against the merged
  `feat/win-voice-plane-supervisor`; freeze the `onTransition` payload.

**Direction-neutral work that can start before D0 is decided:** the §6 Phase-1 regression
harness (tonight's full repro catalog at the swap boundary — required by both options), M-V1,
M-V2, and the §0.3 diff-map. Everything else waits for D0.
