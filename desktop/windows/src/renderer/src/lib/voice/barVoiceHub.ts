// The bar's warm-hub bridge (Track 2 / A5 PR-6 wiring).
//
// This is the ONLY module that lights up the dark warm-hub stack on the live PTT
// path. It owns a HubController + VoiceTurnCoordinator + VoiceTurnHost and exposes
// a narrow surface the bar's push-to-talk hook drives:
//
//   warm()        — ensureWarm() at bar boot for a signed-in user (idempotent).
//   beginTurn()   — pick the route (selectPttRoute, the pttHubEnabled kill-switch);
//                   returns false when the route is the shipped cascade (omniSTT),
//                   so the hook runs today's batch STT path byte-for-byte. Returns
//                   true when the hub owns the turn (native audio in, native reply).
//   appendPcm()   — tee one 16 kHz mic frame to the hub (resampled to the provider
//                   rate). No-op unless a hub turn is live.
//   commit()      — release: resolves 'hub' when the turn stays on the warm socket
//                   (native PCM reply plays bar-locally via the session's player),
//                   or 'fallback' when the hub lost the 1 s warm race — the hook
//                   then runs its batch on the retained 16 kHz buffer.
//   cancel()      — abandon a held turn (silent/too-short discard), keep the socket.
//
// Audio is bar-local (Mac's model: mic capture and the spoken reply both live on
// the floating bar). The turn's TEXT — user transcript + assistant reply — is
// projected to the ONE chat engine in the MAIN window via onRecordTurn (INV-CHAT-1:
// the bar owns no chat engine), so a hub turn lands in the same timeline Home and
// typed chat share, without re-running the LLM or re-speaking it.
//
// Fallback telemetry is NOT emitted here: the ported modules already own it —
// HubController.handoffWarmWaitToCascade emits the `degraded` fallback event, and
// VoiceTurnHost emits `exhausted` on a no-path-left terminal. Re-emitting would
// double count.
//
// Everything is injected so the whole bridge is exercised against fakes (no real
// WebSocket, mint, or timers in tests).

import { HubController, type HubControllerEvents } from './hub/hubController'
import { VoiceTurnHost, selectPttRoute } from './turn/voiceTurnHost'
import {
  VoiceTurnCoordinator,
  timeoutVoiceTurnScheduler,
  type VoiceTurnDeadlineScheduling
} from './turn/voiceTurnCoordinator'
import { VoiceOutputCoordinator } from './turn/voiceOutputCoordinator'
import {
  IDLE_PROJECTION,
  type VoiceCaptureID,
  type VoiceLeaseID,
  type VoiceOutputLease,
  type VoiceSessionID,
  type VoiceTurnID,
  type VoiceTurnUIProjection
} from './turn/voiceTurnMachine'
import { getPreferences } from '../preferences'

// MARK: - Public surface

/** What the PTT hook receives — a structural bridge so `usePushToTalk` never
 *  imports the hub stack directly and stays inert when no bridge is supplied. */
export type VoiceHubBridge = {
  /** Claim the turn. true = hub owns it (tee PCM, commit to hub); false = the
   *  shipped cascade owns it (the hook runs today's path unchanged). */
  beginTurn: () => boolean
  /** Tee one 16 kHz Int16 mic frame. Only meaningful while the hub owns the turn. */
  appendPcm: (pcm: Int16Array) => void
  /** Release: 'hub' = native reply (nothing more for the hook to do); 'fallback' =
   *  the hook runs its batch on the retained 16 kHz buffer (today's path). */
  commit: () => Promise<'hub' | 'fallback'>
  /** Abandon the held turn (silent/too-short/cancel), keeping the warm socket. */
  cancel: () => void
}

/** The structural slice of HubController the bridge drives — lets a test pass a
 *  fake that fires the hub events on cue. */
export type BarHubControllerLike = {
  ensureWarm: () => Promise<VoiceSessionID | unknown>
  isWarm: () => boolean
  isAvailable: () => boolean
  requiredInputSampleRate: () => number | null
  beginTurn: (turnID: VoiceTurnID, opts?: { interrupting?: boolean }) => void
  appendAudio: (turnID: VoiceTurnID, pcm: Uint8Array) => void
  commitTurn: (turnID: VoiceTurnID) => void
  cancelTurn: (turnID: VoiceTurnID) => void
  handoffWarmWaitToCascade: (turnID: VoiceTurnID) => void
  voiceTurnDidTerminate: (turnID: VoiceTurnID) => void
}

export type BarVoiceHub = VoiceHubBridge & {
  /** Open (or reuse) the warm socket. Caller guarantees a signed-in user. */
  warm: () => void
  /** Latest reducer projection (drives the bar orb while the hub turn runs). */
  readonly projection: VoiceTurnUIProjection
  /** True while the hub reply is thinking/waiting/speaking — the bar keeps the
   *  pill open and shows the responding orb pose. */
  readonly isResponding: boolean
  /** Subscribe to projection changes; fires immediately with the current value. */
  subscribe: (cb: (p: VoiceTurnUIProjection) => void) => () => void
  /** Tear down the warm socket + timers (bar unmount). */
  dispose: () => void
}

export type BarVoiceHubDeps = {
  /** Build the hub controller with the bridge's events wired in. Default = a real
   *  HubController (real mint + provider resolution + WebSocket sessions). */
  createHub?: (events: HubControllerEvents) => BarHubControllerLike
  /** Deadline scheduler for the coordinator (tests inject a manual clock to drive
   *  the 1 s hubWarm race). */
  scheduler?: VoiceTurnDeadlineScheduling
  /** Read the pttHubEnabled kill-switch (default = live preferences). */
  getPrefs?: () => { pttHubEnabled?: boolean }
  /** Project a completed hub turn's text into the MAIN chat engine (INV-CHAT-1). */
  onRecordTurn?: (userText: string, assistantText: string) => void
  /** Turn/lease id mints (tests pin identities). */
  mintTurnID?: () => VoiceTurnID
  mintLeaseID?: () => VoiceLeaseID
}

// MARK: - PCM helpers

/** View an Int16 buffer as its raw little-endian bytes (Windows x86 is LE, which is
 *  what both providers expect). Zero-copy for a whole-buffer array. */
function int16ToBytes(pcm: Int16Array): Uint8Array {
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
}

/** Linear-resample 16 kHz Int16 mic PCM to the provider's required rate. Identity
 *  (zero-copy) for Gemini's 16 kHz; upsamples to OpenAI's 24 kHz otherwise. */
export function resampleFrom16k(pcm: Int16Array, targetRate: number): Int16Array {
  if (targetRate === 16000 || pcm.length === 0) return pcm
  const ratio = targetRate / 16000
  const outLen = Math.max(1, Math.round(pcm.length * ratio))
  const out = new Int16Array(outLen)
  const lastIn = pcm.length - 1
  for (let i = 0; i < outLen; i += 1) {
    const src = i / ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, lastIn)
    const frac = src - i0
    out[i] = (pcm[i0] * (1 - frac) + pcm[i1] * frac) | 0
  }
  return out
}

// MARK: - Bridge

export function createBarVoiceHub(deps: BarVoiceHubDeps = {}): BarVoiceHub {
  const getPrefs = deps.getPrefs ?? getPreferences
  const mintTurnID = deps.mintTurnID ?? (() => crypto.randomUUID() as VoiceTurnID)

  const coordinator = new VoiceTurnCoordinator({
    scheduler: deps.scheduler ?? timeoutVoiceTurnScheduler,
    mintTurnID
  })
  const outputCoordinator = new VoiceOutputCoordinator(
    deps.mintLeaseID ? { mintLeaseID: deps.mintLeaseID } : {}
  )

  // Per-turn runtime state (the reducer owns turn identity/phase; this owns the
  // side of a turn the reducer can't model: the pending commit promise, the text
  // accumulators, and the live lease we drain on speaking-end).
  let activeTurnID: VoiceTurnID | null = null
  let lastSessionID: VoiceSessionID | null = null
  let activeLease: VoiceOutputLease | null = null
  let commitResolve: ((r: 'hub' | 'fallback') => void) | null = null
  let transcriptText = ''
  let assistantText = ''
  let captureSeq = 0

  let projection: VoiceTurnUIProjection = IDLE_PROJECTION
  const listeners = new Set<(p: VoiceTurnUIProjection) => void>()
  const publish = (p: VoiceTurnUIProjection): void => {
    projection = p
    for (const l of listeners) l(p)
  }

  const nextCaptureID = (): VoiceCaptureID => ++captureSeq as unknown as VoiceCaptureID

  const resolveCommit = (r: 'hub' | 'fallback'): void => {
    if (!commitResolve) return
    const resolve = commitResolve
    commitResolve = null
    resolve(r)
  }

  /** Runs after any send that can drive the turn terminal. Clears per-turn state
   *  and — on a clean success — projects the completed turn's text to MAIN. */
  const settleIfTerminal = (id: VoiceTurnID): void => {
    if (activeTurnID !== id) return
    if (coordinator.activeTurnID !== null) return // still live
    const terminal = coordinator.model.lastTerminal
    if (
      terminal &&
      terminal.turnID === id &&
      terminal.reason === 'success' &&
      transcriptText.trim() &&
      assistantText.trim()
    ) {
      deps.onRecordTurn?.(transcriptText.trim(), assistantText.trim())
    }
    activeTurnID = null
    activeLease = null
    resolveCommit('hub')
  }

  // --- hub events → coordinator events (all turn-ID fenced by activeTurnID) ------
  const events: HubControllerEvents = {
    onConnected: (sessionID) => {
      lastSessionID = sessionID
      const id = activeTurnID
      if (!id) return // warm-at-boot connect (no turn yet) — just remember the id
      // The socket finished connecting mid-turn (cold press). Advance the route and,
      // if the user already released (commit deferred), accept the commit now.
      coordinator.send({ type: 'hubReady', turnID: id, sessionID })
      if (commitResolve) {
        coordinator.send({ type: 'hubCommitAccepted', turnID: id, sessionID, responseID: null })
        resolveCommit('hub')
      }
    },
    onError: () => {
      const id = activeTurnID
      if (!id) return // a warm socket died between turns — next press re-routes
      if (commitResolve) {
        // Errored during the warm-wait: give the user an answer via the cascade.
        resolveCommit('fallback')
        coordinator.send({ type: 'cancel', turnID: id, reason: 'cancelled' })
      } else {
        coordinator.send({ type: 'cancel', turnID: id, reason: 'providerFailed' })
      }
      settleIfTerminal(id)
    },
    onInputTranscript: (text, isFinal) => {
      // Accumulate deltas; a non-empty final replaces with the full string. An
      // EMPTY final is just a completion marker (OpenAI emits one) — keep what we
      // accumulated, or recordVoiceTurn's non-empty guard would drop the turn.
      if (text) transcriptText = isFinal ? text : transcriptText + text
    },
    onAssistantText: (text, isFinal) => {
      if (text) assistantText = isFinal ? text : assistantText + text
    },
    onSpeakingStart: () => {
      const id = activeTurnID
      if (!id) return
      coordinator.send({
        type: 'providerResponseStarted',
        turnID: id,
        sessionID: lastSessionID,
        responseID: null
      })
      const decision = outputCoordinator.acquire('nativeRealtime', id)
      if (decision.kind === 'acquired') {
        activeLease = decision.lease
        coordinator.send({ type: 'playbackStarted', turnID: id, lease: decision.lease })
      }
    },
    onSpeakingEnd: () => {
      const id = activeTurnID
      if (!id || !activeLease) return
      coordinator.send({ type: 'playbackDrained', turnID: id, leaseID: activeLease.id })
      activeLease = null
      settleIfTerminal(id)
    },
    onTurnDone: () => {
      const id = activeTurnID
      if (!id) return
      coordinator.send({
        type: 'providerTurnFinished',
        turnID: id,
        sessionID: lastSessionID,
        responseID: null
      })
      settleIfTerminal(id)
    },
    onCascadeHandoff: () => {
      // The reducer's 1 s hubWarm deadline fired: the host handed our warm-wait PCM
      // to the batch cascade and HubController already emitted the `degraded`
      // fallback event. Resolve the pending commit so the hook runs its batch, and
      // retire the (now cascade-owned) coordinator turn quietly.
      const id = activeTurnID
      resolveCommit('fallback')
      if (id) {
        coordinator.send({ type: 'cancel', turnID: id, reason: 'cancelled' })
        activeTurnID = null
        activeLease = null
      }
    }
  }

  const hub: BarHubControllerLike = deps.createHub
    ? deps.createHub(events)
    : new HubController({ events })

  // --- host (reducer effect handler) --------------------------------------------
  const host = new VoiceTurnHost({
    // The hook owns the mic capture; nothing for the host to dispose.
    disposeCapture: () => {},
    hub: {
      cancelTurn: (id) => hub.cancelTurn(id),
      handoffWarmWaitToCascade: (id) => hub.handoffWarmWaitToCascade(id),
      voiceTurnDidTerminate: (id) => hub.voiceTurnDidTerminate(id)
    },
    // Non-barge-in terminal with live playback → stop the native reply.
    interruptPlayback: () => {
      if (activeTurnID) hub.cancelTurn(activeTurnID)
    },
    outputCoordinator: { endTurn: (id) => outputCoordinator.endTurn(id) },
    applyProjection: (p) => publish(p),
    // System-audio mute lifecycle is owned by usePushToTalk (it owns the capture),
    // so the host must not also restore it.
    restoreSystemAudio: () => {}
  })

  coordinator.configure(host.presenter)
  coordinator.setEffectHandler(host.effectHandler)

  // --- bridge surface -----------------------------------------------------------
  const beginTurn = (): boolean => {
    const route = selectPttRoute(hub, getPrefs())
    if (route.kind === 'omniSTT') return false

    const interrupting = activeTurnID !== null
    const turnID = mintTurnID()
    activeTurnID = turnID
    lastSessionID = interrupting ? lastSessionID : lastSessionID // keep warm session id
    activeLease = null
    transcriptText = ''
    assistantText = ''

    // `begin` supersedes any prior live turn (barge-in: interruptedByBargeIn keeps
    // the warm socket on the hub route). Claim the output turn AFTER, so the old
    // turn's terminal endTurn() runs against the old id first.
    coordinator.begin('hold', turnID)
    outputCoordinator.beginTurn(turnID)
    coordinator.send({ type: 'captureStarted', turnID, captureID: nextCaptureID() })
    coordinator.send({
      type: 'selectRoute',
      turnID,
      route: hub.isWarm() ? { kind: 'hub', sessionID: null } : { kind: 'hubWarmWait' }
    })
    hub.beginTurn(turnID, { interrupting })
    return true
  }

  const appendPcm = (pcm: Int16Array): void => {
    const id = activeTurnID
    if (!id) return
    const target = hub.requiredInputSampleRate() ?? 16000
    hub.appendAudio(id, int16ToBytes(resampleFrom16k(pcm, target)))
  }

  const commit = (): Promise<'hub' | 'fallback'> => {
    const id = activeTurnID
    if (!id) return Promise.resolve('fallback')
    coordinator.send({ type: 'finalize', turnID: id })
    hub.commitTurn(id)
    if (hub.isWarm()) {
      const sessionID = lastSessionID ?? (crypto.randomUUID() as VoiceSessionID)
      lastSessionID = sessionID
      coordinator.send({ type: 'hubCommitAccepted', turnID: id, sessionID, responseID: null })
      return Promise.resolve('hub')
    }
    // Warm-wait: onConnected resolves 'hub', the hubWarm deadline resolves 'fallback'.
    return new Promise<'hub' | 'fallback'>((resolve) => {
      commitResolve = resolve
    })
  }

  const cancel = (): void => {
    const id = activeTurnID
    if (!id) return
    // Terminal → host cancelHub → hub.cancelTurn (single cancel path, socket kept).
    coordinator.send({ type: 'cancel', turnID: id, reason: 'cancelled' })
    activeTurnID = null
    activeLease = null
    resolveCommit('fallback')
  }

  return {
    warm: () => {
      void Promise.resolve(hub.ensureWarm()).catch(() => {})
    },
    beginTurn,
    appendPcm,
    commit,
    cancel,
    get projection() {
      return projection
    },
    get isResponding() {
      return projection.isResponseActive || projection.isResponseWaiting || projection.isThinking
    },
    subscribe: (cb) => {
      listeners.add(cb)
      cb(projection)
      return () => listeners.delete(cb)
    },
    dispose: () => {
      listeners.clear()
      coordinator.reset()
    }
  }
}
