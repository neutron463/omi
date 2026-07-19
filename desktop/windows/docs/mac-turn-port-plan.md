# Mac-shape voice turn port plan (Windows)

**Status: implementation-ready design doc — no code changes in this branch.**
2026-07-18. Directive (Chris): *"why the hell did we invent this system, why didn't we just copy
what worked on mac. we need to do that immediately."*

Scope: replace the Windows app's invented 4-layer voice-turn machinery
(reducer / coordinator / driver / hubController seams) with the Mac app's proven two-owner shape.
Implementation starts after `feat/win-voice-plane-supervisor` (supervisor + `resetVoicePlane` +
flight recorder + invariant checks) merges — that harness sits OUTSIDE the turn layer and is the
safety net for this rewrite.

Companion research: `desktop/windows/docs/voice-reliability-research.md` (uncommitted, primary
checkout) — establishes that every wedge bug from 2026-07-18 (#198 drop-queued-events, the
barge-in seams, the desync class) lived in seams between invented layers that Mac does not have.

---

## 1. Mac's actual design (extracted from source, not inferred)

Mac has exactly **two owners**, both `@MainActor` singletons, communicating by direct method
calls. There is no reducer, no event queue, no coordinator object, no state-machine module.
`VoiceTurnStateMachine.swift` / `VoiceTurnCoordinator.swift` — the files the Windows port claims
to mirror — **do not exist in the Mac source tree** (verified: `git ls-files | grep -i voiceturn`
returns only Windows-side artifacts; the Mac voice plane is `PushToTalkManager.swift` +
`RealtimeHub*.swift`).

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
*addition* and stays; see §3.)

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

---

*Sections 2–5 (Windows mapping, kill/keep lists, target design, migration plan) follow.*
