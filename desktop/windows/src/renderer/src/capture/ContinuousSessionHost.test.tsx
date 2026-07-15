// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const startLiveMicSession = vi.fn(() => ({ stop: vi.fn() }))

vi.mock('../lib/firebase', () => ({
  auth: { currentUser: { uid: 'signed-in-user' } },
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    callback({ uid: 'signed-in-user' })
    return () => {}
  }
}))

vi.mock('../lib/preferences', () => ({
  getPreferences: () => ({ continuousRecording: true }),
  onPreferencesChange: () => () => {}
}))

vi.mock('../lib/liveConversation', () => ({
  liveConversation: { getStatus: () => 'idle' },
  requestFinalize: vi.fn()
}))

vi.mock('../lib/voice/injectedTranscript', () => ({
  formatAssistantLine: vi.fn(),
  shouldInjectIntoLive: () => false
}))

vi.mock('./liveMicSession', () => ({
  startLiveMicSession: () => startLiveMicSession()
}))

vi.mock('./liveStore', () => ({
  captureLiveStore: { appendLine: vi.fn() }
}))

import { ContinuousSessionHost } from './ContinuousSessionHost'

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { omi: unknown }).omi = {
    gauntlet: true,
    onCaptureCommand: () => () => {}
  }
})

afterEach(() => cleanup())

test('gauntlet mode never starts capture for a signed-in profile with recording enabled', () => {
  render(<ContinuousSessionHost />)

  expect(startLiveMicSession).not.toHaveBeenCalled()
})
