import { omiApi } from '../apiClient'

// Raw import-evidence write path. Uploads evidence items (one per email/event/
// post) to the canonical ingest route `POST /v3/memory-imports/batch`; on a
// canonical-unavailable trigger (403/404/canonical-not-ready) either falls back
// to plain memories (`POST /v3/memories/batch`) or reports back so the caller
// runs its own synthesis. Port of macOS `OnboardingImportEvidenceService.save`
// (raw-evidence half only). Wire format is snake_case.
//
// Backend contracts (verified in backend source):
//  - /v3/memory-imports/batch: MemoryImportBatchRequest, items hard-capped at 100
//    (pydantic max_length) — >100 is a 422, so we chunk. Each item needs at least
//    one of external_id / content_hash / textual (content|snippet|title) or the
//    server 422s it, so we drop invalid items before sending.
//  - Fallback triggers: 404 (route absent), 403 detail 'memory_import_requires_
//    canonical', 503 detail 'memory_import_canonical_not_ready'. A generic 503
//    ('Service temporarily unavailable') is transient — omiApi retries it and it
//    is NOT a fallback trigger.
//  - /v3/memories/batch: BatchMemoriesRequest{memories: Memory[]}, also chunked
//    at 100.

export interface EvidenceItem {
  externalId?: string
  occurredAt?: string | Date
  title?: string
  snippet?: string
  content?: string
  contentHash?: string
  metadata?: Record<string, unknown>
}

export type ImportResult =
  | { status: 'ok'; runId: string; received: number; created: number; deduped: number }
  | { status: 'fallback'; created: number } // canonical unavailable → wrote plain memories
  | { status: 'canonical_unavailable' } // canonical unavailable → wrote NOTHING (caller handles)
  | { status: 'error'; error: string }

export interface UploadOpts {
  importRunId?: string // else generated: `desktop-<normalizedSource>-<uuid>`
  sourceAccountHash?: string
  fallbackTags?: string[] // tags for plain memories in the fallback path (default [`${sourceType}/import`])
  fallbackCategory?: string // default 'interesting'
  // What to do when the canonical import route is unavailable (403/404/not-ready):
  //  'writeMemories' (DEFAULT) — write the evidence items as plain memories via
  //    /v3/memories/batch (returns 'fallback').
  //  'reportOnly' — write NOTHING, return { status:'canonical_unavailable' } so
  //    the caller runs its own synthesis instead (Gmail/Calendar adapters, D7).
  onCanonicalUnavailable?: 'writeMemories' | 'reportOnly'
}

const IMPORT_BATCH_URL = '/v3/memory-imports/batch'
const MEMORIES_BATCH_URL = '/v3/memories/batch'
const BATCH_MAX = 100
const DEVICE_ID_KEY = 'omi.connectors.deviceId'

/**
 * Uploads raw evidence, chunking at 100. On success returns `ok` with summed
 * server counts. On a canonical-unavailable trigger, either falls back to plain
 * memories (`writeMemories`, default) or returns `canonical_unavailable`
 * (`reportOnly`). Any other hard failure returns `error`.
 */
export async function uploadImportEvidence(
  sourceType: string,
  items: EvidenceItem[],
  opts: UploadOpts = {}
): Promise<ImportResult> {
  const deviceId = getClientDeviceId()
  const importRunId =
    opts.importRunId ?? `desktop-${normalizeSource(sourceType)}-${crypto.randomUUID()}`
  const mode = opts.onCanonicalUnavailable ?? 'writeMemories'

  // Drop items the server would 422 anyway (no id/hash/text).
  const valid = items.filter(isValidItem)
  if (valid.length === 0) {
    return { status: 'ok', runId: importRunId, received: 0, created: 0, deduped: 0 }
  }

  try {
    let received = 0
    let created = 0
    let deduped = 0
    for (const group of chunk(valid, BATCH_MAX)) {
      const body: Record<string, unknown> = {
        source_type: sourceType,
        import_run_id: importRunId,
        importer_version: 'v1',
        items: group.map((it) => toBatchItem(it, deviceId))
      }
      if (opts.sourceAccountHash !== undefined) body.source_account_hash = opts.sourceAccountHash

      const r = await omiApi.post(IMPORT_BATCH_URL, body)
      const data = (r.data ?? {}) as Record<string, unknown>
      received += num(data.artifacts_received)
      created += num(data.artifacts_created)
      deduped += num(data.artifacts_deduped)
    }
    return { status: 'ok', runId: importRunId, received, created, deduped }
  } catch (e) {
    if (isCanonicalUnavailable(e)) {
      // The whole upload takes the canonical-unavailable branch (canonical
      // availability is a per-user/deployment property, consistent across chunks
      // — the trigger surfaces on the first request before anything else lands).
      if (mode === 'reportOnly') return { status: 'canonical_unavailable' }
      return writeFallbackMemories(sourceType, valid, opts)
    }
    return { status: 'error', error: errorMessage(e) }
  }
}

// Legacy fallback: map each valid item to a plain Memory (content||snippet||
// title, empties skipped), chunk at 100, POST /v3/memories/batch.
async function writeFallbackMemories(
  sourceType: string,
  valid: EvidenceItem[],
  opts: UploadOpts
): Promise<ImportResult> {
  const tags = opts.fallbackTags ?? [`${sourceType}/import`]
  const category = opts.fallbackCategory ?? 'interesting'

  const memories = valid
    .map((it) => (it.content || it.snippet || it.title || '').trim())
    .filter((content) => content.length > 0)
    .map((content) => ({ content, tags, category }))

  if (memories.length === 0) return { status: 'fallback', created: 0 }

  try {
    let created = 0
    for (const group of chunk(memories, BATCH_MAX)) {
      const r = await omiApi.post(MEMORIES_BATCH_URL, { memories: group })
      const data = (r.data ?? {}) as Record<string, unknown>
      // created_count is authoritative; fall back to the sent size if absent.
      created += data.created_count === undefined ? group.length : num(data.created_count)
    }
    return { status: 'fallback', created }
  } catch (e) {
    return { status: 'error', error: errorMessage(e) }
  }
}

// A stable per-install id stamped on every item for provenance. Persisted in
// localStorage; ephemeral (fresh each call) in a non-browser context.
function getClientDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}

function normalizeSource(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

// Mirror the server validator: keep only items with an external_id, content_hash,
// or a non-empty textual field.
function isValidItem(it: EvidenceItem): boolean {
  return Boolean(
    it.externalId || it.contentHash || it.content?.trim() || it.snippet?.trim() || it.title?.trim()
  )
}

// Snake_case wire item; undefined keys omitted (metadata defaults to {}).
function toBatchItem(it: EvidenceItem, deviceId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    metadata: it.metadata ?? {},
    client_device_id: deviceId
  }
  if (it.externalId !== undefined) out.external_id = it.externalId
  const iso = toIso(it.occurredAt)
  if (iso !== undefined) out.occurred_at = iso
  if (it.title !== undefined) out.title = it.title
  if (it.snippet !== undefined) out.snippet = it.snippet
  if (it.content !== undefined) out.content = it.content
  if (it.contentHash !== undefined) out.content_hash = it.contentHash
  return out
}

function toIso(v: string | Date | undefined): string | undefined {
  if (v === undefined) return undefined
  return v instanceof Date ? v.toISOString() : v
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function isCanonicalUnavailable(e: unknown): boolean {
  const err = e as { response?: { status?: number; data?: { detail?: string } } }
  const status = err.response?.status
  const detail = err.response?.data?.detail
  if (status === 404) return true
  if (status === 403 && detail === 'memory_import_requires_canonical') return true
  if (status === 503 && detail === 'memory_import_canonical_not_ready') return true
  return false
}

function errorMessage(e: unknown): string {
  const err = e as { response?: { data?: { detail?: string } }; message?: string }
  return err.response?.data?.detail ?? err.message ?? String(e)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
