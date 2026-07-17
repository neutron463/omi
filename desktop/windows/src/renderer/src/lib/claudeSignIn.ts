// Global Claude Code sign-in / upsell channel — Windows port of macOS's
// ChatProvider.handleClaudeAuthRequired + ClaudeAuthSheet semantics.
//
// The real Claude subscription OAuth is a MANUAL flow (see main/codingAgent/
// claudeOAuth.ts): the app opens the browser, the user approves, Anthropic shows
// a one-time code on platform.claude.com, and the user pastes it back. So the
// sheet has phases:
//  - 'upsell' — shown immediately by beginClaudeSignIn(): the "Upgrade to Omi
//    Pro" upsell (unconditional, macOS parity) while the browser opens.
//  - 'awaitingCode' — once the browser is open, a paste box collects the code;
//    submitClaudeAuthCode() completes sign-in with no purchase (Mac's
//    auth_success bypass — kept deliberately).
//  - 'submitting' — the pasted code is being exchanged.
//
// "Upgrade to Omi Pro" opens omi.me/pricing and dismisses; "Cancel" (and
// Esc/outside-click) just dismisses. A completed sign-in (via paste, or because
// the account was already connected) auto-closes the sheet and fires onResult.
// Fail-closed: if the flow can't start, the sheet closes and the caller surfaces
// a generic error. The sheet is a global modal mounted once at the app root.

import { createSignal } from './signal'
import type {
  CodingAgentAuthStatus,
  CodingAgentStartAuthResult,
  CodingAgentSubmitAuthResult
} from '../../../shared/types'

/** The pricing page the "Upgrade to Omi Pro" CTA opens (matches macOS). */
export const OMI_PRICING_URL = 'https://omi.me/pricing'

/** Shown when the sign-in flow can't even start (macOS parity copy). */
export const CLAUDE_SIGN_IN_FAILED = 'Unable to start Claude sign-in. Try again.'

/** Shown when a pasted code is rejected — the user can approve again and retry. */
export const CLAUDE_CODE_REJECTED =
  'That code did not work. Approve again in your browser, then paste the new code.'

export type ClaudeSignInPhase = 'upsell' | 'awaitingCode' | 'submitting'
export type SheetState = { open: boolean; phase: ClaudeSignInPhase; error: string | null }

/** Terminal outcome handed to the caller (AgentsTab reflects status/error). */
export type ClaudeAuthOutcome = { ok: boolean; error?: string; status: CodingAgentAuthStatus }

const CLOSED: SheetState = { open: false, phase: 'upsell', error: null }

const signal = createSignal<SheetState>(CLOSED)
// True from the first launch until the flow reaches a terminal state — a second
// trigger (e.g. an auth_required event while Settings already opened the sheet)
// rejoins the in-flight flow instead of launching a second browser tab.
let inFlight = false
// Set when the user dismisses so a late resolution does not re-drive the (now
// closed) sheet or fire a stale caller callback.
let dismissed = false
let pendingOnResult: ((result: ClaudeAuthOutcome) => void) | null = null

export function onClaudeSignIn(cb: (state: SheetState) => void): () => void {
  return signal.subscribe(cb)
}

/** Cancel/Upgrade/Esc — close the sheet. Reverts to the default chat path. */
export function dismissClaudeSignIn(): void {
  dismissed = true
  inFlight = false
  pendingOnResult = null
  signal.set(CLOSED)
}

/** Reach a terminal state: close the sheet and fire onResult (unless dismissed). */
function finish(result: ClaudeAuthOutcome): void {
  const cb = pendingOnResult
  inFlight = false
  pendingOnResult = null
  signal.set(CLOSED)
  if (!dismissed) cb?.(result)
}

/**
 * Show the upsell sheet and launch the Claude OAuth. `onResult` (used by
 * Settings → Agents to reflect the new status / surface an error) fires once the
 * flow reaches a terminal state, unless the user already dismissed the sheet.
 */
export function beginClaudeSignIn(onResult?: (result: ClaudeAuthOutcome) => void): void {
  dismissed = false
  if (inFlight) {
    // Rejoin the running flow — re-open the sheet, preserving its phase (e.g. a
    // paste box already awaiting a code), without opening a second browser tab.
    signal.set({ ...signal.get(), open: true })
    return
  }
  inFlight = true
  pendingOnResult = onResult ?? null
  signal.set({ open: true, phase: 'upsell', error: null })
  void window.omi
    .codingAgentStartAuth()
    .then((result: CodingAgentStartAuthResult) => {
      if (dismissed) return
      if (result.ok && result.awaitingCode) {
        // Browser opened — collect the code the user copies from the callback.
        signal.set({ open: true, phase: 'awaitingCode', error: null })
        return
      }
      // Already connected (ok, no awaitingCode) or failed to start — terminal.
      finish(result)
    })
    .catch(() => {
      if (dismissed) return
      finish({
        ok: false,
        error: CLAUDE_SIGN_IN_FAILED,
        status: { connected: false, expiresAt: null }
      })
    })
}

/**
 * Complete sign-in with the code the user copied from the browser. On success
 * the sheet closes and onResult fires; on failure the sheet stays open on the
 * paste step with an error so the user can approve again and retry.
 */
export function submitClaudeAuthCode(code: string): void {
  if (!inFlight) return
  signal.set({ open: true, phase: 'submitting', error: null })
  void window.omi
    .codingAgentSubmitAuthCode(code)
    .then((result: CodingAgentSubmitAuthResult) => {
      if (dismissed) return
      if (result.ok) {
        finish(result)
        return
      }
      signal.set({ open: true, phase: 'awaitingCode', error: result.error ?? CLAUDE_CODE_REJECTED })
    })
    .catch(() => {
      if (dismissed) return
      signal.set({ open: true, phase: 'awaitingCode', error: CLAUDE_CODE_REJECTED })
    })
}

/** Test-only: reset module state between cases. */
export function __resetClaudeSignIn(): void {
  inFlight = false
  dismissed = false
  pendingOnResult = null
  signal.set(CLOSED)
}
