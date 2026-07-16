// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import {
  startRun,
  isRunning,
  getRunState,
  acknowledgeSuccess,
  useConnectorRuns,
  __resetConnectorRunsForTest,
  type Outcome,
  type ProgressSink
} from './runStore'

// A hand-resolvable promise so a test controls exactly when an operation settles.
function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Let the async IIFE inside startRun observe a just-resolved operation.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => __resetConnectorRunsForTest())
afterEach(() => cleanup())

describe('startRun de-dupe', () => {
  it('rejects a concurrent start for the same id and does not spawn a second op', async () => {
    const d = deferred<Outcome>()
    let op2Ran = false

    const first = startRun('gmail', 'Importing', 'Starting', () => d.promise)
    const second = startRun('gmail', 'Again', 'x', async () => {
      op2Ran = true
      return { ok: true }
    })

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(op2Ran).toBe(false)
    expect(isRunning('gmail')).toBe(true)
    expect(getRunState('gmail')?.progressTitle).toBe('Importing') // first run untouched

    d.resolve({ ok: true })
    await flush()
  })

  it('allows a new run once the previous one is no longer running', async () => {
    const d1 = deferred<Outcome>()
    startRun('gmail', 'Run1', '', () => d1.promise)
    d1.resolve({ ok: true })
    await flush()
    expect(isRunning('gmail')).toBe(false)

    const d2 = deferred<Outcome>()
    const started = startRun('gmail', 'Run2', '', () => d2.promise)
    expect(started).toBe(true)
    expect(getRunState('gmail')?.progressTitle).toBe('Run2')
    d2.resolve({ ok: true })
    await flush()
  })
})

describe('ProgressSink token guard', () => {
  it('a live sink.update mutates the running state', async () => {
    const d = deferred<Outcome>()
    let sink: ProgressSink | undefined
    startRun('gmail', 'Importing', 'Starting', (s) => {
      sink = s
      return d.promise
    })

    sink!.update('Importing', 'Fetched 120 emails')
    expect(getRunState('gmail')?.progressDetail).toBe('Fetched 120 emails')

    d.resolve({ ok: true })
    await flush()
  })

  it('a stale sink.update (after a newer start superseded it) does not mutate state', async () => {
    const d1 = deferred<Outcome>()
    let staleSink: ProgressSink | undefined
    startRun('gmail', 'Run1', 'detail1', (s) => {
      staleSink = s
      return d1.promise
    })
    d1.resolve({ ok: true, message: 'done1' })
    await flush()
    expect(getRunState('gmail')?.phase).toBe('succeeded')

    // A new run supersedes (allowed: phase left 'running'); mints a new token.
    const d2 = deferred<Outcome>()
    startRun('gmail', 'Run2', 'detail2', () => d2.promise)
    expect(getRunState('gmail')?.progressTitle).toBe('Run2')

    // The captured sink from Run1 is now stale — its update must be a no-op.
    staleSink!.update('HIJACK', 'nope')
    expect(getRunState('gmail')?.progressTitle).toBe('Run2')
    expect(getRunState('gmail')?.progressDetail).toBe('detail2')

    d2.resolve({ ok: true })
    await flush()
  })
})

describe('terminal transitions + acknowledge', () => {
  it('success sets succeeded + statusMessage; acknowledgeSuccess clears it', async () => {
    const d = deferred<Outcome>()
    startRun('calendar', 'Importing', '', () => d.promise)
    d.resolve({ ok: true, message: 'Imported 12 events' })
    await flush()

    const s = getRunState('calendar')
    expect(s?.phase).toBe('succeeded')
    expect(s?.statusMessage).toBe('Imported 12 events')

    acknowledgeSuccess('calendar')
    expect(getRunState('calendar')).toBeUndefined()
  })

  it('failure sets failed + errorMessage; acknowledgeSuccess does NOT clear a failed run', async () => {
    const d = deferred<Outcome>()
    startRun('x', 'Connecting', '', () => d.promise)
    d.resolve({ ok: false, error: 'not signed in' })
    await flush()

    expect(getRunState('x')?.phase).toBe('failed')
    expect(getRunState('x')?.errorMessage).toBe('not signed in')

    acknowledgeSuccess('x') // no-op on a failed run
    expect(getRunState('x')?.phase).toBe('failed')
  })

  it('a thrown operation becomes a failed run carrying the error message', async () => {
    startRun('gmail', 'Importing', '', async () => {
      throw new Error('boom')
    })
    await flush()
    expect(getRunState('gmail')?.phase).toBe('failed')
    expect(getRunState('gmail')?.errorMessage).toBe('boom')
  })
})

describe('useConnectorRuns subscription', () => {
  it('re-renders subscribers on every transition (start → succeed)', async () => {
    const d = deferred<Outcome>()
    const { result } = renderHook(() => useConnectorRuns())
    expect(result.current.gmail).toBeUndefined()

    act(() => {
      startRun('gmail', 'Importing', 'Starting', () => d.promise)
    })
    expect(result.current.gmail?.phase).toBe('running')

    await act(async () => {
      d.resolve({ ok: true, message: 'Imported 40 memories' })
      await flush()
    })
    expect(result.current.gmail?.phase).toBe('succeeded')
    expect(result.current.gmail?.statusMessage).toBe('Imported 40 memories')
  })
})
