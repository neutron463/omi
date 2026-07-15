// @vitest-environment jsdom
// Flag gate: multiChatEnabled (default OFF) controls whether the chat stage
// shows the sessions sidebar. OFF → behaves like today (no sidebar); ON → the
// sidebar is present. The container is stubbed so this stays hermetic (its hook
// + the sidebar have their own suites).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setPreferences } from '../../../lib/preferences'

let chat: {
  history: { id?: string; role: 'user' | 'assistant'; content: string }[]
  sending: boolean
  send: ReturnType<typeof vi.fn>
}
vi.mock('../../../state/appState', () => ({ useAppState: () => ({ chat }) }))
vi.mock('../../../hooks/useMemories', () => ({
  useMemories: () => ({ memories: [], loading: false })
}))
vi.mock('../../../lib/actionItems', () => ({ fetchAllActionItems: () => Promise.resolve([]) }))
vi.mock('../QuickTaskWidget', () => ({ QuickTaskWidget: () => <div /> }))
vi.mock('../QuickGoalsWidget', () => ({ QuickGoalsWidget: () => <div /> }))
// Stub the container: rendering it is the gate's observable effect.
vi.mock('../../chat/ChatSessionsSidebarContainer', () => ({
  ChatSessionsSidebarContainer: () => <div data-testid="chat-sessions-sidebar" />
}))

/* eslint-disable @typescript-eslint/no-empty-function -- no-op stub */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
/* eslint-enable @typescript-eslint/no-empty-function */
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub

import { HomeHub } from './HomeHub'

const enterChat = (): void => {
  render(
    <MemoryRouter>
      <HomeHub />
    </MemoryRouter>
  )
  // Focusing the ask bar opens the chat stage.
  fireEvent.focus(screen.getByLabelText('Ask omi anything'))
}

beforeEach(() => {
  chat = { history: [], sending: false, send: vi.fn() }
  ;(window as unknown as { omi: unknown }).omi = {
    rewindGetSettings: vi.fn().mockResolvedValue({ captureEnabled: false }),
    onRewindSettings: vi.fn().mockReturnValue(() => {}),
    rewindFrameCount: vi.fn().mockResolvedValue(0),
    openExternalUrl: vi.fn()
  }
})
afterEach(() => {
  cleanup()
  setPreferences({ multiChatEnabled: undefined })
})

describe('HomeHub — multiChatEnabled gate', () => {
  it('does NOT render the sessions sidebar when the flag is OFF (default)', () => {
    setPreferences({ multiChatEnabled: undefined })
    enterChat()
    expect(screen.getByTestId('hub-stage').getAttribute('data-mode')).toBe('chat')
    expect(screen.queryByTestId('chat-sessions-sidebar')).toBeNull()
  })

  it('renders the sessions sidebar in the chat stage when the flag is ON', () => {
    setPreferences({ multiChatEnabled: true })
    enterChat()
    expect(screen.getByTestId('hub-stage').getAttribute('data-mode')).toBe('chat')
    expect(screen.getByTestId('chat-sessions-sidebar')).toBeTruthy()
  })
})
