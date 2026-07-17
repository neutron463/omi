// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  beginClaudeSignIn,
  submitClaudeAuthCode,
  dismissClaudeSignIn,
  onClaudeSignIn,
  __resetClaudeSignIn,
  OMI_PRICING_URL,
  CLAUDE_SIGN_IN_FAILED,
  CLAUDE_CODE_REJECTED,
  type SheetState
} from './claudeSignIn'
import type { CodingAgentStartAuthResult, CodingAgentSubmitAuthResult } from '../../../shared/types'

const codingAgentStartAuth = vi.fn<() => Promise<CodingAgentStartAuthResult>>()
const codingAgentSubmitAuthCode = vi.fn<(code: string) => Promise<CodingAgentSubmitAuthResult>>()

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

/** Latest sheet state from the store. */
function sheet(): SheetState {
  let state!: SheetState
  const unsub = onClaudeSignIn((s) => (state = s))
  unsub()
  return state
}

const AWAITING: CodingAgentStartAuthResult = {
  ok: true,
  awaitingCode: true,
  status: { connected: false, expiresAt: null }
}

beforeEach(() => {
  codingAgentStartAuth.mockReset()
  codingAgentSubmitAuthCode.mockReset()
  ;(globalThis as unknown as { window: { omi: unknown } }).window.omi = {
    codingAgentStartAuth,
    codingAgentSubmitAuthCode
  }
  __resetClaudeSignIn()
})

afterEach(() => __resetClaudeSignIn())

describe('beginClaudeSignIn', () => {
  it('opens the sheet on the upsell phase AND launches the OAuth in parallel', () => {
    codingAgentStartAuth.mockReturnValue(deferred<CodingAgentStartAuthResult>().promise)
    beginClaudeSignIn()
    expect(sheet()).toMatchObject({ open: true, phase: 'upsell' })
    expect(codingAgentStartAuth).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — a second trigger rejoins the in-flight flow (one browser launch)', () => {
    codingAgentStartAuth.mockReturnValue(deferred<CodingAgentStartAuthResult>().promise)
    beginClaudeSignIn()
    beginClaudeSignIn()
    expect(codingAgentStartAuth).toHaveBeenCalledTimes(1)
    expect(sheet().open).toBe(true)
  })

  it('shows the paste box once the browser opens (awaitingCode), without resolving yet', async () => {
    const d = deferred<CodingAgentStartAuthResult>()
    codingAgentStartAuth.mockReturnValue(d.promise)
    const onResult = vi.fn()
    beginClaudeSignIn(onResult)

    d.resolve(AWAITING)
    await d.promise

    expect(sheet()).toMatchObject({ open: true, phase: 'awaitingCode', error: null })
    expect(onResult).not.toHaveBeenCalled()
  })

  it('grants immediately when the account is already connected (ok, no awaitingCode)', async () => {
    const d = deferred<CodingAgentStartAuthResult>()
    codingAgentStartAuth.mockReturnValue(d.promise)
    const onResult = vi.fn()
    beginClaudeSignIn(onResult)

    d.resolve({ ok: true, status: { connected: true, expiresAt: 123 } })
    await d.promise

    expect(sheet().open).toBe(false)
    expect(onResult).toHaveBeenCalledWith({ ok: true, status: { connected: true, expiresAt: 123 } })
  })

  it('fail-closed: closes and reports the error when the flow cannot start', async () => {
    const d = deferred<CodingAgentStartAuthResult>()
    codingAgentStartAuth.mockReturnValue(d.promise)
    const onResult = vi.fn()
    beginClaudeSignIn(onResult)

    const failure: CodingAgentStartAuthResult = {
      ok: false,
      error: 'Unable to start Claude sign-in. Try again.',
      status: { connected: false, expiresAt: null }
    }
    d.resolve(failure)
    await d.promise

    expect(sheet().open).toBe(false)
    expect(onResult).toHaveBeenCalledWith(failure)
  })

  it('reports a generic failure when the IPC itself rejects', async () => {
    codingAgentStartAuth.mockRejectedValue(new Error('ipc down'))
    const onResult = vi.fn()
    beginClaudeSignIn(onResult)
    await Promise.resolve()
    await Promise.resolve()
    expect(sheet().open).toBe(false)
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: CLAUDE_SIGN_IN_FAILED })
    )
  })

  it('dismiss closes the sheet and suppresses a late start result', async () => {
    const d = deferred<CodingAgentStartAuthResult>()
    codingAgentStartAuth.mockReturnValue(d.promise)
    const onResult = vi.fn()
    beginClaudeSignIn(onResult)

    dismissClaudeSignIn()
    expect(sheet().open).toBe(false)

    d.resolve(AWAITING)
    await d.promise
    expect(onResult).not.toHaveBeenCalled()
    expect(sheet().open).toBe(false)
  })
})

describe('submitClaudeAuthCode', () => {
  async function reachAwaitingCode(onResult?: (r: unknown) => void): Promise<void> {
    codingAgentStartAuth.mockResolvedValue(AWAITING)
    beginClaudeSignIn(onResult as never)
    await Promise.resolve()
    await Promise.resolve()
    expect(sheet().phase).toBe('awaitingCode')
  }

  it('grants and closes on a successful code submit (no purchase)', async () => {
    const onResult = vi.fn()
    await reachAwaitingCode(onResult)

    const d = deferred<CodingAgentSubmitAuthResult>()
    codingAgentSubmitAuthCode.mockReturnValue(d.promise)
    submitClaudeAuthCode('the-code#state')
    expect(sheet().phase).toBe('submitting')
    expect(codingAgentSubmitAuthCode).toHaveBeenCalledWith('the-code#state')

    d.resolve({ ok: true, status: { connected: true, expiresAt: 42 } })
    await d.promise

    expect(sheet().open).toBe(false)
    expect(onResult).toHaveBeenCalledWith({ ok: true, status: { connected: true, expiresAt: 42 } })
  })

  it('keeps the paste step open with an error on a rejected code (retryable)', async () => {
    const onResult = vi.fn()
    await reachAwaitingCode(onResult)

    const d = deferred<CodingAgentSubmitAuthResult>()
    codingAgentSubmitAuthCode.mockReturnValue(d.promise)
    submitClaudeAuthCode('bad')

    d.resolve({
      ok: false,
      error: 'Authentication failed: invalid authorization code',
      status: { connected: false, expiresAt: null }
    })
    await d.promise

    expect(sheet()).toMatchObject({
      open: true,
      phase: 'awaitingCode',
      error: 'Authentication failed: invalid authorization code'
    })
    expect(onResult).not.toHaveBeenCalled()
  })

  it('falls back to a generic error when the submit IPC rejects', async () => {
    await reachAwaitingCode()
    codingAgentSubmitAuthCode.mockRejectedValue(new Error('ipc down'))
    submitClaudeAuthCode('x')
    await Promise.resolve()
    await Promise.resolve()
    expect(sheet()).toMatchObject({ phase: 'awaitingCode', error: CLAUDE_CODE_REJECTED })
  })

  it('is a no-op when no sign-in is in flight', () => {
    submitClaudeAuthCode('x')
    expect(codingAgentSubmitAuthCode).not.toHaveBeenCalled()
  })
})

describe('constants', () => {
  it('exposes the omi.me pricing URL for the Upgrade CTA', () => {
    expect(OMI_PRICING_URL).toBe('https://omi.me/pricing')
  })
})
