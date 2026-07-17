import { useEffect, useState } from 'react'
import { Modal } from '../../ui/Modal'
import {
  onClaudeSignIn,
  dismissClaudeSignIn,
  submitClaudeAuthCode,
  OMI_PRICING_URL,
  type SheetState
} from '../../../lib/claudeSignIn'

// "Upgrade to Omi Pro" sheet — Windows port of macOS ClaudeAuthSheet. Shown by
// beginClaudeSignIn() alongside the Claude OAuth browser launch. The upsell is
// unconditional (macOS parity); completing the manual sign-in (paste the code
// the browser shows) grants Claude with no purchase. Copy/intent match macOS;
// the primary CTA opens omi.me/pricing. Neutral white primary, no purple
// (INV-UI-1). Mounted once at the app root.
export function ClaudeAuthSheet(): React.JSX.Element {
  const [state, setState] = useState<SheetState>({ open: false, phase: 'upsell', error: null })
  const [code, setCode] = useState('')

  useEffect(() => onClaudeSignIn(setState), [])

  const { open, phase, error } = state
  const showPaste = phase === 'awaitingCode' || phase === 'submitting'
  const submitting = phase === 'submitting'

  const onUpgrade = (): void => {
    dismissClaudeSignIn()
    void window.omi.openExternalUrl(OMI_PRICING_URL)
  }

  const onSubmit = (): void => {
    const trimmed = code.trim()
    if (trimmed) submitClaudeAuthCode(trimmed)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) dismissClaudeSignIn()
      }}
      title="Upgrade to Omi Pro"
      size="sm"
      footer={
        <>
          <button
            onClick={dismissClaudeSignIn}
            className="rounded-2xl px-4 py-2 text-sm font-medium text-text-tertiary transition hover:text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onUpgrade}
            className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
          >
            Upgrade to Omi Pro
          </button>
        </>
      }
    >
      <p className="text-text-secondary">Unlock Omi Pro for $199/month</p>
      <p className="mt-2 text-text-tertiary">
        Your browser will open to the Omi Pro checkout. After subscribing, return to omi.
      </p>
      {showPaste ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-xs text-text-tertiary">
            Already have a Claude subscription? After you approve in the browser, paste the code it
            shows to connect Claude — no purchase needed.
          </p>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit()
            }}
            placeholder="Paste code here"
            autoFocus
            spellCheck={false}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-text-primary outline-none focus:border-white/30"
          />
          {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
          <button
            onClick={onSubmit}
            disabled={submitting || code.trim().length === 0}
            className="mt-3 w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Connecting…' : 'Connect Claude'}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-text-tertiary">Complete sign-in in your browser…</p>
      )}
    </Modal>
  )
}
