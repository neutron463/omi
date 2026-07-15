import { describe, expect, test } from 'vitest'
import { prepareSeedEntries, selectSeedKeys } from './seed-auth-keys.mjs'

const keys = [
  'firebase:authUser:omi',
  'firebase:previous_websocket_failure',
  'omi-windows-prefs-v1'
]

describe('selectSeedKeys', () => {
  test('firebase-only excludes device preferences that can enable recording', () => {
    expect(selectSeedKeys(keys, { firebaseOnly: true })).toEqual([
      'firebase:authUser:omi',
      'firebase:previous_websocket_failure'
    ])
  })

  test('auth-only preserves the existing Firebase plus preferences behavior', () => {
    expect(selectSeedKeys(keys, { authOnly: true })).toEqual(keys)
  })

  test('gauntlet mode preserves onboarding but disables recording and cleanup', () => {
    const data = {
      'firebase:authUser:omi': 'session',
      'omi-windows-prefs-v1': JSON.stringify({
        onboardingCompletedAt: 123,
        continuousRecording: true,
        retentionMode: 'live'
      })
    }
    const entries = prepareSeedEntries(data, { gauntlet: true })
    const preferences = JSON.parse(entries.find(([key]) => key === 'omi-windows-prefs-v1')[1])
    expect(preferences).toEqual({
      onboardingCompletedAt: 123,
      continuousRecording: false,
      retentionMode: 'off'
    })
  })
})
