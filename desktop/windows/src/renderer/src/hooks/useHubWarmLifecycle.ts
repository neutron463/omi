import { useEffect } from 'react'

/** The warm-hub opt-out contract (the `pttHubEnabled` kill-switch, default ON).
 *
 *  Warms the hub ONLY for a signed-in user with the flag on; in every other case it
 *  tears the socket down. So a user who sets `pttHubEnabled=false` gets NO token
 *  mint and NO provider WebSocket, flipping the pref off at runtime drops a live
 *  socket with no restart, and signing out drops it too. Extracted from BarApp so
 *  this contract is unit-testable against a fake hub (BarApp itself has no harness).
 *
 *  The mint the warm path runs is `__sessionPreserving`, so a dead-session 401 while
 *  warming refreshes+retries once but never forces the user to the sign-in screen. */
export function useHubWarmLifecycle(
  hub: { warm: () => void; teardown: () => void },
  gate: { ready: boolean; signedIn: boolean; hubEnabled: boolean }
): void {
  const { ready, signedIn, hubEnabled } = gate
  useEffect(() => {
    if (ready && signedIn && hubEnabled) hub.warm()
    else hub.teardown()
  }, [ready, signedIn, hubEnabled, hub])
}
