// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Fake the shared axios client: only `post` is exercised. Mirrors how
// apiClient.test.ts stands in a fake client — no Firebase/network here.
const h = vi.hoisted(() => ({
  post: vi.fn<(url: string, body?: unknown) => Promise<unknown>>()
}))
vi.mock('../apiClient', () => ({ omiApi: { post: h.post } }))

import { uploadImportEvidence, type EvidenceItem } from './importEvidence'

// Shapes we assert against (calls are typed `unknown` — cast, never `any`).
interface ImportBody {
  source_type: string
  import_run_id: string
  importer_version: string
  source_account_hash?: string
  items: Array<Record<string, unknown>>
}
interface MemoriesBody {
  memories: Array<{ content: string; tags: string[]; category: string }>
}

function importBatchResponse(received: number, created: number, deduped: number): unknown {
  return {
    data: {
      run_id: 'server-run',
      artifacts_received: received,
      artifacts_created: created,
      artifacts_deduped: deduped,
      status: 'completed'
    }
  }
}
function httpError(status: number, detail?: string): unknown {
  return {
    response: { status, data: detail === undefined ? {} : { detail } },
    message: `Request failed with status code ${status}`
  }
}
function bodyAt(i: number): unknown {
  return h.post.mock.calls[i][1]
}
function urlAt(i: number): string {
  return h.post.mock.calls[i][0]
}

beforeEach(() => {
  h.post.mockReset()
  localStorage.clear()
})

describe('uploadImportEvidence — canonical path', () => {
  it('chunks 250 items into 3 POSTs of 100/100/50 to the import route', async () => {
    h.post.mockResolvedValue(importBatchResponse(0, 0, 0))
    const items: EvidenceItem[] = Array.from({ length: 250 }, (_, i) => ({
      externalId: `gmail:${i}`,
      content: `body ${i}`
    }))

    const res = await uploadImportEvidence('gmail', items)

    expect(res.status).toBe('ok')
    expect(h.post).toHaveBeenCalledTimes(3)
    expect(urlAt(0)).toBe('/v3/memory-imports/batch')
    expect((bodyAt(0) as ImportBody).items).toHaveLength(100)
    expect((bodyAt(1) as ImportBody).items).toHaveLength(100)
    expect((bodyAt(2) as ImportBody).items).toHaveLength(50)
  })

  it('sends a snake_case body with client_device_id and a generated import_run_id', async () => {
    h.post.mockResolvedValue(importBatchResponse(1, 1, 0))

    const res = await uploadImportEvidence('google_calendar', [
      {
        externalId: 'google_calendar:1',
        occurredAt: new Date('2026-01-02T03:04:05.000Z'),
        title: 'Standup',
        snippet: 'Daily standup',
        content: 'Daily standup with the team',
        metadata: { import_kind: 'event' }
      }
    ])

    const body = bodyAt(0) as ImportBody
    expect(body.source_type).toBe('google_calendar')
    expect(body.importer_version).toBe('v1')
    expect(body.import_run_id).toMatch(/^desktop-google-calendar-[0-9a-f-]{36}$/)
    expect('source_account_hash' in body).toBe(false)

    const item = body.items[0]
    expect(item.external_id).toBe('google_calendar:1')
    expect(item.occurred_at).toBe('2026-01-02T03:04:05.000Z')
    expect(item.title).toBe('Standup')
    expect(item.snippet).toBe('Daily standup')
    expect(item.content).toBe('Daily standup with the team')
    expect(item.content_hash).toBeUndefined()
    expect(item.metadata).toEqual({ import_kind: 'event' })
    expect(typeof item.client_device_id).toBe('string')
    expect((item.client_device_id as string).length).toBeGreaterThan(0)

    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    expect(res.runId).toBe(body.import_run_id)
  })

  it('reuses a supplied importRunId verbatim and stamps a stable device id', async () => {
    h.post.mockResolvedValue(importBatchResponse(1, 1, 0))

    await uploadImportEvidence('gmail', [{ content: 'one' }], { importRunId: 'my-run-123' })
    const first = bodyAt(0) as ImportBody
    expect(first.import_run_id).toBe('my-run-123')
    const deviceId = first.items[0].client_device_id

    h.post.mockClear()
    await uploadImportEvidence('gmail', [{ content: 'two' }])
    // Same install → same persisted device id across calls.
    expect((bodyAt(0) as ImportBody).items[0].client_device_id).toBe(deviceId)
  })

  it('includes source_account_hash only when provided', async () => {
    h.post.mockResolvedValue(importBatchResponse(1, 1, 0))
    await uploadImportEvidence('gmail', [{ content: 'x' }], { sourceAccountHash: 'acct-hash' })
    expect((bodyAt(0) as ImportBody).source_account_hash).toBe('acct-hash')
  })

  it('sums received/created/deduped across chunks on success', async () => {
    h.post
      .mockResolvedValueOnce(importBatchResponse(100, 90, 10))
      .mockResolvedValueOnce(importBatchResponse(50, 40, 10))
    const items: EvidenceItem[] = Array.from({ length: 150 }, (_, i) => ({
      externalId: `e${i}`,
      content: `c${i}`
    }))

    const res = await uploadImportEvidence('gmail', items)
    expect(res).toEqual({
      status: 'ok',
      runId: expect.any(String),
      received: 150,
      created: 130,
      deduped: 20
    })
  })

  it('drops invalid items (no id/hash/text) before sending', async () => {
    h.post.mockResolvedValue(importBatchResponse(2, 2, 0))
    const res = await uploadImportEvidence('gmail', [
      { content: 'keep me' },
      { metadata: { a: 1 } }, // invalid: no id/hash/text
      { title: '   ' }, // invalid: whitespace-only text
      { externalId: 'gmail:9' } // valid: has an id
    ])
    expect(res.status).toBe('ok')
    expect((bodyAt(0) as ImportBody).items).toHaveLength(2)
  })

  it('all-invalid input → ok with zero counts and no POST', async () => {
    const res = await uploadImportEvidence('gmail', [{ metadata: {} }, { title: '' }])
    expect(res).toMatchObject({ status: 'ok', received: 0, created: 0, deduped: 0 })
    expect(h.post).not.toHaveBeenCalled()
  })
})

describe('uploadImportEvidence — canonical-unavailable fallback (writeMemories, default)', () => {
  it('404 → falls back to /v3/memories/batch', async () => {
    h.post
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce({ data: { created_count: 2 } })

    const res = await uploadImportEvidence('gmail', [
      { externalId: 'gmail:1', content: 'alpha' },
      { externalId: 'gmail:2', snippet: 'beta' }
    ])

    expect(res).toEqual({ status: 'fallback', created: 2 })
    expect(h.post).toHaveBeenCalledTimes(2)
    expect(urlAt(0)).toBe('/v3/memory-imports/batch')
    expect(urlAt(1)).toBe('/v3/memories/batch')

    const mem = bodyAt(1) as MemoriesBody
    expect(mem.memories).toHaveLength(2)
    expect(mem.memories[0]).toMatchObject({
      content: 'alpha',
      category: 'interesting',
      tags: ['gmail/import']
    })
    expect(mem.memories[1].content).toBe('beta') // snippet used when content absent
  })

  it('403 memory_import_requires_canonical → fallback', async () => {
    h.post
      .mockRejectedValueOnce(httpError(403, 'memory_import_requires_canonical'))
      .mockResolvedValueOnce({ data: { created_count: 1 } })
    const res = await uploadImportEvidence('gmail', [{ content: 'x' }])
    expect(res.status).toBe('fallback')
    expect(urlAt(1)).toBe('/v3/memories/batch')
  })

  it('503 memory_import_canonical_not_ready → fallback', async () => {
    h.post
      .mockRejectedValueOnce(httpError(503, 'memory_import_canonical_not_ready'))
      .mockResolvedValueOnce({ data: { created_count: 1 } })
    const res = await uploadImportEvidence('gmail', [{ content: 'x' }])
    expect(res.status).toBe('fallback')
  })

  it('maps content||snippet||title, skips empty-content items, honors fallbackTags/Category', async () => {
    h.post
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce({ data: { created_count: 2 } })

    const res = await uploadImportEvidence(
      'gmail',
      [
        { externalId: 'gmail:1', content: '', snippet: '', title: 'from title' }, // → title
        { externalId: 'gmail:2', snippet: 'from snippet' }, // → snippet
        { externalId: 'gmail:3' } // valid item, but no text → skipped in fallback
      ],
      { fallbackTags: ['custom/tag'], fallbackCategory: 'personal' }
    )

    expect(res.status).toBe('fallback')
    const mem = bodyAt(1) as MemoriesBody
    expect(mem.memories.map((m) => m.content)).toEqual(['from title', 'from snippet'])
    expect(mem.memories[0]).toMatchObject({ tags: ['custom/tag'], category: 'personal' })
  })
})

describe('uploadImportEvidence — reportOnly writes nothing', () => {
  it('returns canonical_unavailable and makes NO second POST on any trigger', async () => {
    const triggers: unknown[] = [
      httpError(404),
      httpError(403, 'memory_import_requires_canonical'),
      httpError(503, 'memory_import_canonical_not_ready')
    ]
    for (const trigger of triggers) {
      h.post.mockReset()
      h.post.mockRejectedValueOnce(trigger)

      const res = await uploadImportEvidence('gmail', [{ content: 'x' }], {
        onCanonicalUnavailable: 'reportOnly'
      })

      expect(res).toEqual({ status: 'canonical_unavailable' })
      expect(h.post).toHaveBeenCalledTimes(1)
      expect(urlAt(0)).toBe('/v3/memory-imports/batch')
    }
  })
})

describe('uploadImportEvidence — hard errors', () => {
  it('a generic 503 (not a canonical trigger) → status error, no fallback POST', async () => {
    h.post.mockRejectedValue(httpError(503, 'Service temporarily unavailable'))
    const res = await uploadImportEvidence('gmail', [{ content: 'x' }])
    expect(res.status).toBe('error')
    expect(h.post).toHaveBeenCalledTimes(1)
  })

  it('a 500 error → status error carrying the detail', async () => {
    h.post.mockRejectedValue(httpError(500, 'boom'))
    const res = await uploadImportEvidence('gmail', [{ content: 'x' }])
    if (res.status !== 'error') throw new Error(`expected error, got ${res.status}`)
    expect(res.error).toBe('boom')
  })

  it('a fallback POST that itself fails → status error', async () => {
    h.post
      .mockRejectedValueOnce(httpError(404)) // canonical unavailable → fallback
      .mockRejectedValueOnce(httpError(400, 'bad memories')) // fallback write fails
    const res = await uploadImportEvidence('gmail', [{ content: 'x' }])
    expect(res.status).toBe('error')
  })
})
