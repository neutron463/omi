import { describe, it, expect, vi } from 'vitest'
import { createBarVoiceHub, resampleFrom16k, type BarHubControllerLike } from './barVoiceHub'
import type { HubControllerEvents } from './hub/hubController'
import type { VoiceSessionID, VoiceTurnDeadline, VoiceTurnID } from './turn/voiceTurnMachine'
import type { VoiceTurnDeadlineScheduling } from './turn/voiceTurnCoordinator'

// A manual deadline scheduler so tests drive the reducer's timers (the 1 s hubWarm
// race in particular) deterministically — nothing fires until we say so.
function manualScheduler(): {
  scheduler: VoiceTurnDeadlineScheduling
  fire: (deadline: VoiceTurnDeadline) => boolean
  pending: () => VoiceTurnDeadline[]
} {
  const timers = new Map<number, { deadline: VoiceTurnDeadline; fire: () => void }>()
  let seq = 0
  return {
    scheduler: {
      schedule(deadline, _afterSeconds, fire) {
        const key = seq++
        timers.set(key, { deadline, fire })
        return { cancel: () => timers.delete(key) }
      }
    },
    fire(deadline) {
      for (const [key, t] of timers) {
        if (t.deadline === deadline) {
          timers.delete(key)
          t.fire()
          return true
        }
      }
      return false
    },
    pending: () => [...timers.values()].map((t) => t.deadline)
  }
}

// A fake hub controller that records what the bridge asked of it and hands back the
// events the bridge wired in, so a test can fire provider callbacks on cue. It does
// NOT reimplement hub behavior (that stays in HubController + its own tests).
class FakeHub implements BarHubControllerLike {
  readonly events: HubControllerEvents
  warm = false
  available = false
  sampleRate: number | null = 16000
  ensureWarmCalls = 0
  begun: { turnID: VoiceTurnID; interrupting?: boolean }[] = []
  appended: { turnID: VoiceTurnID; bytes: Uint8Array }[] = []
  committed: VoiceTurnID[] = []
  cancelled: VoiceTurnID[] = []
  handedOff: VoiceTurnID[] = []
  terminated: VoiceTurnID[] = []
  tornDown = 0

  constructor(events: HubControllerEvents) {
    this.events = events
  }
  ensureWarm(): Promise<VoiceSessionID> {
    this.ensureWarmCalls += 1
    return Promise.resolve('warm-session' as VoiceSessionID)
  }
  isWarm(): boolean {
    return this.warm
  }
  isAvailable(): boolean {
    return this.available
  }
  requiredInputSampleRate(): number | null {
    return this.sampleRate
  }
  beginTurn(turnID: VoiceTurnID, opts?: { interrupting?: boolean }): void {
    this.begun.push({ turnID, interrupting: opts?.interrupting })
  }
  appendAudio(turnID: VoiceTurnID, bytes: Uint8Array): void {
    this.appended.push({ turnID, bytes })
  }
  commitTurn(turnID: VoiceTurnID): void {
    this.committed.push(turnID)
  }
  cancelTurn(turnID: VoiceTurnID): void {
    this.cancelled.push(turnID)
  }
  handoffWarmWaitToCascade(turnID: VoiceTurnID): void {
    this.handedOff.push(turnID)
  }
  voiceTurnDidTerminate(turnID: VoiceTurnID): void {
    this.terminated.push(turnID)
  }
  teardownSession(): void {
    this.tornDown += 1
  }
}

function makeBridge(
  hub: FakeHub | null,
  opts: { pttHubEnabled?: boolean; onRecordTurn?: (u: string, a: string) => void } = {}
): {
  bridge: ReturnType<typeof createBarVoiceHub>
  hub: FakeHub
  fire: (d: VoiceTurnDeadline) => boolean
} {
  const sched = manualScheduler()
  let captured!: FakeHub
  const bridge = createBarVoiceHub({
    createHub: (events) => {
      captured = hub ?? new FakeHub(events)
      // If a hub instance was supplied, rebind its events to this bridge's.
      return captured
    },
    scheduler: sched.scheduler,
    getPrefs: () => ({ pttHubEnabled: opts.pttHubEnabled ?? true }),
    onRecordTurn: opts.onRecordTurn,
    mintTurnID: (() => {
      let n = 0
      return () => `turn-${n++}` as VoiceTurnID
    })()
  })
  return { bridge, hub: captured, fire: sched.fire }
}

describe('resampleFrom16k', () => {
  it('is identity at 16 kHz', () => {
    const pcm = Int16Array.from([1, 2, 3, 4])
    expect(resampleFrom16k(pcm, 16000)).toBe(pcm)
  })
  it('upsamples length ~1.5x to 24 kHz', () => {
    const pcm = new Int16Array(100)
    expect(resampleFrom16k(pcm, 24000).length).toBe(150)
  })
})

describe('barVoiceHub teardown (kill-switch off / sign-out / unmount)', () => {
  it('drops the warm socket but stays reusable (a later warm reconnects)', () => {
    const { bridge, hub } = makeBridge(null, { pttHubEnabled: true })
    bridge.warm()
    expect(hub.ensureWarmCalls).toBe(1)
    bridge.teardown()
    expect(hub.tornDown).toBe(1)
    bridge.warm() // reusable after teardown
    expect(hub.ensureWarmCalls).toBe(2)
  })

  it('dispose also drops the socket (no leak past bar unmount)', () => {
    const { bridge, hub } = makeBridge(null, { pttHubEnabled: true })
    bridge.warm()
    bridge.dispose()
    expect(hub.tornDown).toBe(1)
  })
})

describe('barVoiceHub route gate (selectPttRoute kill-switch)', () => {
  it('declines the turn when pttHubEnabled is off (→ legacy cascade)', () => {
    const { bridge, hub } = makeBridge(null, { pttHubEnabled: false })
    hub.warm = true
    hub.available = true
    expect(bridge.beginTurn()).toBe(false)
    expect(hub.begun).toHaveLength(0)
  })

  it('declines the turn when the hub is unavailable', () => {
    const { bridge, hub } = makeBridge(null, { pttHubEnabled: true })
    hub.available = false
    expect(bridge.beginTurn()).toBe(false)
    expect(hub.begun).toHaveLength(0)
  })

  it('takes the hub route when enabled + warm, and begins the hub turn', () => {
    const { bridge, hub } = makeBridge(null, { pttHubEnabled: true })
    hub.warm = true
    hub.available = true
    expect(bridge.beginTurn()).toBe(true)
    expect(hub.begun).toHaveLength(1)
    expect(hub.begun[0].interrupting).toBe(false)
  })
})

describe('barVoiceHub warm-at-boot', () => {
  it('warm() calls ensureWarm on the controller', () => {
    const { bridge, hub } = makeBridge(null)
    bridge.warm()
    expect(hub.ensureWarmCalls).toBe(1)
  })
})

describe('barVoiceHub warm hub turn', () => {
  it('commits to the hub, tees PCM, and records the completed turn text to MAIN', async () => {
    const recorded: [string, string][] = []
    const { bridge, hub } = makeBridge(null, {
      onRecordTurn: (u, a) => recorded.push([u, a])
    })
    hub.warm = true
    hub.available = true

    expect(bridge.beginTurn()).toBe(true)
    const turnID = hub.begun[0].turnID
    bridge.appendPcm(Int16Array.from([1, 2, 3]))
    expect(hub.appended).toHaveLength(1)
    expect(hub.appended[0].turnID).toBe(turnID)

    await expect(bridge.commit()).resolves.toBe('hub')
    expect(hub.committed).toEqual([turnID])

    // Drive the native reply lifecycle to a clean success.
    hub.events.onInputTranscript?.('what time is it', true, null)
    hub.events.onAssistantText?.("it's noon", true, null)
    hub.events.onSpeakingStart?.()
    hub.events.onSpeakingEnd?.()
    hub.events.onTurnDone?.(null)

    expect(recorded).toEqual([['what time is it', "it's noon"]])
    expect(hub.terminated).toEqual([turnID]) // socket kept, per-turn state released
  })

  it('cancel() abandons a held turn (keeps the socket) — the hook path for a silent discard', () => {
    const { bridge, hub } = makeBridge(null)
    hub.warm = true
    hub.available = true
    bridge.beginTurn()
    const turnID = hub.begun[0].turnID
    bridge.cancel()
    // Terminal → host cancelHub → hub.cancelTurn (single cancel path).
    expect(hub.cancelled).toContain(turnID)
  })
})

// The mid-turn hub death path uses the REAL HubController so the `degraded`
// fallback telemetry it emits on handoff is exercised end-to-end (not restated
// here). We mock only the analytics sink.
vi.mock('../analytics', async (importActual) => {
  const actual = await importActual<typeof import('../analytics')>()
  return { ...actual, trackEvent: vi.fn() }
})

describe('barVoiceHub warm-race fallback (real HubController)', () => {
  it('resolves commit → fallback and emits the degraded fallback event when the 1s warm deadline fires', async () => {
    const { HubController } = await import('./hub/hubController')
    const { trackEvent } = await import('../analytics')
    ;(trackEvent as unknown as ReturnType<typeof vi.fn>).mockClear()

    // A provider session that never becomes warm — so the press lands in warm-wait
    // and the reducer's hubWarm deadline (fired manually below) wins the race.
    const neverWarm = {
      provider: 'gemini' as const,
      requiredInputSampleRate: 16000,
      bargeInStrategy: 'freshSession' as const,
      ensureWarm: () => new Promise<void>(() => {}),
      isWarm: () => false,
      beginTurn: () => {},
      appendAudio: () => {},
      commitTurn: () => {},
      cancelTurn: () => {},
      sendToolResult: () => {},
      teardown: () => {}
    }

    const sched = manualScheduler()
    const bridge = createBarVoiceHub({
      createHub: (events) =>
        new HubController({
          events,
          resolveProvider: () => 'gemini',
          buildInstructions: () => '',
          mintToken: async () => 'tok',
          createSession: () => neverWarm
        }),
      scheduler: sched.scheduler,
      getPrefs: () => ({ pttHubEnabled: true })
    })

    // Warm so a session object exists (isAvailable true) but stays connecting.
    bridge.warm()
    await new Promise((r) => setTimeout(r, 0)) // let mintToken resolve + session mount

    expect(bridge.beginTurn()).toBe(true) // hubWarmWait route
    const commit = bridge.commit()

    expect(sched.pending()).toContain('hubWarm')
    sched.fire('hubWarm') // the hub lost the race

    await expect(commit).resolves.toBe('fallback')
    expect(trackEvent).toHaveBeenCalledWith(
      'fallback_triggered',
      expect.objectContaining({
        component: 'ptt_cascade',
        from: 'hub',
        to: 'omni_stt',
        reason: 'hub_warm_timeout',
        outcome: 'degraded'
      })
    )
  })
})
