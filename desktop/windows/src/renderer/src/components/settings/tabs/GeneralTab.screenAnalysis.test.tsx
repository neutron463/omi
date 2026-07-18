// @vitest-environment jsdom
// The General tab's "Screen Analysis" row: reflects the current screenAnalysisEnabled
// value, writes the flag through the scoped assistant bridge on toggle, and stays in
// lock-step with the tray checkbox via the settings broadcast.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent, screen, waitFor } from '@testing-library/react'
import { ScreenAnalysisRow } from './GeneralTab'
import { SettingsSearchProvider } from '../SettingsSearchProvider'
import type { AssistantSettingsView } from '../../../../../shared/types'

const VIEW: AssistantSettingsView = {
  notificationsEnabled: true,
  notificationFrequency: 0,
  focusNotificationsEnabled: true,
  memoryEnabled: false,
  glowOverlayEnabled: false,
  screenAnalysisEnabled: true
}

let store: AssistantSettingsView
let setSettings: ReturnType<typeof vi.fn>
let changeCb: ((v: AssistantSettingsView) => void) | null

beforeEach(() => {
  store = { ...VIEW }
  changeCb = null
  setSettings = vi.fn(async (patch: Partial<AssistantSettingsView>) => {
    store = { ...store, ...patch }
    return store
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).omi = {
    assistantsGetSettings: vi.fn(async () => store),
    assistantsSetSettings: setSettings,
    onAssistantSettingsChanged: (cb: (v: AssistantSettingsView) => void) => {
      changeCb = cb
      return () => {
        changeCb = null
      }
    }
  }
})
afterEach(cleanup)

const renderRow = (): void => {
  render(
    <SettingsSearchProvider>
      <ScreenAnalysisRow />
    </SettingsSearchProvider>
  )
}
const sw = (): HTMLButtonElement =>
  screen.getByRole('switch', { name: 'Screen Analysis' }) as HTMLButtonElement

describe('GeneralTab ScreenAnalysisRow', () => {
  // The row's checked state comes from an async assistantsGetSettings() load, so
  // findByText('Screen Analysis') (the static label, present on the first render)
  // can resolve BEFORE that load applies. Assert on the switch state via waitFor so
  // the load has landed — a bare expect right after findByText reads the pre-load
  // default and flakes under parallel-test CPU load.
  it('reflects the current screenAnalysisEnabled value once loaded', async () => {
    renderRow()
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('true'))
  })

  it('reflects an OFF value', async () => {
    store = { ...VIEW, screenAnalysisEnabled: false }
    renderRow()
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('false'))
  })

  it('writes screenAnalysisEnabled when toggled', async () => {
    renderRow()
    // Wait for the loaded ON state before toggling, so the click flips true→false.
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('true'))
    act(() => {
      fireEvent.click(sw())
    })
    expect(setSettings).toHaveBeenCalledWith({ screenAnalysisEnabled: false })
    expect(sw().getAttribute('aria-checked')).toBe('false')
  })

  it('re-renders from a broadcast (tray checkbox wrote the flag in another window)', async () => {
    renderRow()
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('true'))
    act(() => {
      changeCb?.({ ...VIEW, screenAnalysisEnabled: false })
    })
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('false'))
  })
})
