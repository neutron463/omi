import { beforeEach, expect, test, vi } from 'vitest'

const startAiProfileHost = vi.fn()
const startRewindEmbedHost = vi.fn()
const startPiMonoAuthHost = vi.fn()

vi.mock('./aiProfileHost', () => ({ startAiProfileHost }))
vi.mock('./rewindEmbedHost', () => ({ startRewindEmbedHost }))
vi.mock('./piMonoAuthHost', () => ({ startPiMonoAuthHost }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

test('gauntlet mode starts only the pi-mono chat auth relay', async () => {
  ;(globalThis as unknown as { window: { omi: { gauntlet: boolean } } }).window = {
    omi: { gauntlet: true }
  }
  const { maybeStartInsightEngine } = await import('./insightEngine')
  maybeStartInsightEngine()
  expect(startPiMonoAuthHost).toHaveBeenCalledOnce()
  expect(startAiProfileHost).not.toHaveBeenCalled()
  expect(startRewindEmbedHost).not.toHaveBeenCalled()
})
