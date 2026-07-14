# Refresh v0.12.72 — Memory/Persona/Profile, Brain Graph, Conversations Lifecycle, Rewind, Audio/Opus Storage

> Domain: memories/persona/profile, brain graph data layer, conversations lifecycle (creation,
> sync, processing), Rewind (capture/indexing/retention/rebuild), screen-capture-driven memory
> extraction, local storage/DB schema, audio storage/Opus handling.
> Baseline: `0d09ede61b76dc4a144d05809432bf220394ee3a` (2026-07-09).
> New reference: `v0.12.72+12072-macos` (2026-07-12), 288 `desktop/macos`-touching commits later.
> Checked out read-only at `C:\Users\chris\projects\omi\.worktrees\mac-ref`.

---

## Headline finding

`0d09ede..v0.12.72` includes **`a4c50bcb4` (`fix(memory): preserve cross-platform device
provenance`)** — a fully-built, tested Windows-side implementation of the "This device" memory
filter (new `desktop/windows/src/renderer/src/lib/clientDevice.ts`, `omiListen.ts` header wiring,
backend `X-App-Platform: windows` recognition). **It is upstream, not in our fork's `main`.**
This directly answers a gap the existing audit (`03-memory-persona-profile.md:164`) lists as
"Absent." Recommend porting/cherry-picking this commit instead of re-implementing from scratch —
see full detail below.

Second headline: the backend resolved the exact "is Mac even right?" ambiguity WIRING-AUDIT.md
flagged for memory edit/visibility (C9) — the endpoint now accepts Mac's JSON-body form as
canonical, with the old query-param form kept only as deprecated compat. **Use the body form
going forward**, not the query-param form the old audit note recommended as a hedge.

Third: conversation mutation endpoints (`title`/`starred`/`folder`) changed response shape
(`ConversationMutationResponse{status, conversation}` replacing bare `{status}`), and the
canonical revision model changed (Firestore `update_time` is now the authoritative conversation
revision, decoupled from `started_at`/`finished_at` heuristics). Windows's generated client at
`desktop/windows/src/renderer/src/lib/omiApi.generated.ts` (current fork `main`) is **stale**
against this — it still types these endpoints as returning the old bare-status shape.

---

## NEW features/behaviors since baseline

1. **Windows device-provenance wiring (upstream, unmerged)** — `a4c50bcb4` (part of merge
   `9ff4420f8`, "Fix cross-platform This device memory filtering (#9364)"):
   - `desktop/windows/src/renderer/src/lib/clientDevice.ts` (new file): `getWindowsInstallId()`
     persists a UUID to `localStorage['omi-windows-install-id']`; `getWindowsDeviceIdHash()`
     SHA-256-hashes it and takes the first 8 hex chars — same contract as macOS's
     Keychain-UUID-based hash.
   - `desktop/windows/src/main/ipc/omiListen.ts`: new `buildListenHeaders(token, deviceIdHash)`
     sends `X-App-Platform: 'windows'` + `X-Device-Id-Hash` on the `/v4/listen` WS upgrade.
   - `desktop/windows/src/renderer/src/lib/apiClient.ts`, `desktop/windows/src/shared/types.ts`:
     plumb the hash through.
   - Backend (`backend/utils/client_device.py`, `docs/memory/domain_model.md`): `X-App-Platform`
     enum now explicitly includes `windows` (previously only `macos`/`ios`/`android`); added
     `resolve_client_device_from_websocket_auth_message()` for browser `/v4/web/listen` (device
     hash carried in the first auth message body, since browsers can't set upgrade headers).
   - **Status: NOT in `neutron463/omi` main.** `git merge-base --is-ancestor a4c50bcb4 HEAD` →
     not an ancestor; `git branch --contains a4c50bcb4` shows it only on `upstream/main` and a
     couple of stale worktree branches. Verified: `grep -r clientDevice desktop/windows/src`
     on current fork `main` returns nothing.

2. **Conversation cache reconciliation rewrite** — `cb7cea49e` + squash-merge `6803d2849`
   ("make conversation cache reconciliation authoritative", closes upstream #8197):
   - New `desktop/macos/Desktop/Sources/MainWindow/Conversations/ConversationRepository.swift`
     (417 lines) — single cache-first repository all list/detail/search/mutation/delete calls
     route through, replacing ad-hoc reconciliation spread across `AppState+DataLoading.swift`
     (which shrank from verbose merge-heuristic code to 363→~120 lines net).
   - `TranscriptionModels.swift`: new `ConversationCacheCompleteness` enum (`.list`/`.detail`) and
     `serverUpdatedAt: Date?` field, replacing the old scheme where `updatedAt` doubled as both
     "local cache write time" and "server freshness signal" inferred from
     `finishedAt ?? startedAt ?? createdAt`. `updateFrom()` no longer takes a
     `preservingNewerLocalFields:` bool + last-writer-wins timestamp race; there's now a separate
     `hydrateMissingFields(from:)` for enriching an older/unversioned local row without
     regressing it against a newer canonical snapshot.
   - Backend (`backend/models/conversation.py`, `backend/routers/conversations.py`,
     `backend/routers/folders.py`): `Conversation.updated_at` is now a first-class field
     "attached by the database read layer" from Firestore's document `update_time` — explicitly
     documented as "deliberately not derived from started_at/finished_at." User-owned fields
     (title/starred/folder/visibility) are now preserved in the **same transaction** as
     processing-result writes (closes a race where async post-processing could clobber a
     concurrent user edit).
   - New `ConversationMutationResponse{status, conversation}` model returned by
     `PATCH /v1/conversations/{id}/title`, `/starred`, `/folder` (previously bare
     `{status: "Ok"}` / `FolderMutationResponse`). Callers now get the exact post-write canonical
     conversation instead of re-deriving it locally.

3. **`ConversationAudio` — server-merged conversation playback artifact** — `4948dc589`
   ("backend: ConversationAudio + span models on the conversation doc") + wire-type regen
   `80e91b97e`:
   - New `backend/models/conversation.py` models: `ConversationAudioSpan{file_id, wall_offset,
     artifact_offset, len}` and `ConversationAudio{audio_files_fingerprint, duration,
     captured_duration, spans[], content_type='audio/mpeg', built_at}` on
     `Conversation.conversation_audio`.
   - Describes a backend-built dense MP3 at `playback/{uid}/{conv}/conversation.mp3` that
     collapses >90s inter-part gaps between raw `audio_files` parts into one seekable artifact;
     `audio_files_fingerprint` detects staleness (rebuild needed when the underlying
     `audio_files` list changes) — mirrors the "audio-merge" Cloud Tasks job already documented
     in `AGENTS.md`'s backend service map (`/v1/sync/audio/*`, queue `audio-merge`).
   - Wire types regenerated for dart/swift/ts (`app/lib/backend/schema/gen/audio_wire.g.dart`,
     `OmiApi.generated.swift`, and **`desktop/windows/src/renderer/src/lib/omiApi.generated.ts`**
     all got the new types) — so the Windows generated client already has the shape, just no
     caller uses it yet. This is new backend surface, not yet consumed by any desktop client
     (mobile-first per the commit's docs note, `docs/doc/developer/backend/listen_pusher_pipeline.mdx`).
   - Relevant to any future Windows "play back this whole conversation as one audio file"
     feature — the manifest-based seek math is spelled out in the model docstring.

4. **Rewind DB pool-epoch invalidation across all storage actors** — `b59bfc7c5` + `50dfcd421` +
   `bd72e551d` + `522b9e851`: ten storage actors (`ActionItemStorage`, `MemoryStorage`,
   `TranscriptionStorage`, `ProactiveStorage`, `GoalStorage`, `StagedTaskStorage`,
   `TaskChatMessageStorage`, `NoteStorage`, `KnowledgeGraphStorage`, `AIUserProfileService`)
   previously cached `RewindDatabase`'s `DatabasePool` forever (`_dbQueue`). On runtime
   corruption recovery, `RewindDatabase` deletes/recreates `omi.db` and opens a new pool, but the
   actors kept using stale file descriptors pointing at the unlinked inode — silent stale reads,
   ghost writes, or repeated `IOERR`, defeating the recovery. Fixed with a monotonic
   `poolEpoch` each actor revalidates on every access (one extra actor hop, no IO). This is new
   architecture since baseline — the existing audit's Rewind DB-recovery description
   (`05-rewind.md:119`) predates it.

## CHANGED behaviors invalidating specific existing-audit claims

- **`03-memory-persona-profile.md:164`** ("Memory data model richness"): *"No tier/layer field
  … no confidence/reasoning/extraction-provenance fields … no per-device capture provenance or
  'this device' filter, no read/dismissed status."* — Still true of current Windows `main`, **but**
  a complete, tested implementation of the per-device-provenance piece already exists upstream
  (see NEW #1 above) and just needs porting, not building. Update the framing from "build from
  scratch" to "cherry-pick `a4c50bcb4` + verify."

- **`WIRING-AUDIT.md` C9** (Memories): *"Mac sends `{value}` as a JSON body, but the backend
  binds `value` as a required query param — Mac's own edit/visibility may 422 in production …
  if Windows builds this, use the query-param form, don't copy Mac."* — **Resolved.** Backend
  commit `f630e8cfd` (`fix(backend): preserve released desktop contracts`, paired with
  `f0e7078e3`) changed `PATCH /v3/memories/{id}` and `/v3/memories/{id}/visibility` to accept a
  new `MemoryValueRequest{value}` **JSON body** as the canonical form, keeping the old `value`
  query param only as `Optional[str] = Query(default=None, description="Deprecated; send JSON
  body {'value': ...} instead")`. Verified in `backend/routers/memories.py` diff (now under
  `backend/routers/v3_memories/`? — see `ee88995a5 Refactor V3 memory modules into package`,
  confirm current file path before wiring). **New guidance: if/when Windows builds memory
  edit/visibility (C9), send the JSON body — that's now the backend-documented canonical path,
  and it matches Mac.** The generated client
  (`desktop/windows/src/renderer/src/lib/omiApi.generated.ts` at the tag) already reflects this;
  our fork's current client is stale (still query-param-only) — confirm after regen.

- **Conversation mutation response shape** (implicit assumption throughout `05-rewind.md` and any
  future Stream 4 work on `ConversationDetail.tsx`): current fork `main`'s
  `desktop/windows/src/renderer/src/lib/omiApi.generated.ts` types
  `set_conversation_starred_v1_conversations__conversation_id__starred_patch` and
  `patch_conversation_title_v1_conversations__conversation_id__title_patch` as returning
  `ConversationStatusResponse` (bare `{status}`), and `move_conversation_to_folder_...patch` as
  `FolderMutationResponse`. At the v0.12.72 tag these all return `ConversationMutationResponse
  {status, conversation}` (verified present in `.worktrees/mac-ref/desktop/windows/.../omiApi.generated.ts`,
  3 call sites). **Windows's own generated client needs a regen pass to pick this up** before any
  Stream 4 work builds optimistic title/star/folder mutations against the old shape.

- **`05-rewind.md:119`** ("Database corruption recovery … 'Rebuild Index' … re-scans all video
  chunk files on disk and reconstructs the database from them") — accurate as a feature
  description, but worth knowing it was **broken end-to-end at points in this window and just
  fixed**: `2efd54dc2` found `rebuildFromVideoFiles` scanning for `pathExtension == "hevc"` (zero
  matches — the encoder actually writes `<yyyy-MM-dd>/chunk_HHmmss.mp4`) and a timestamp parser
  that required a flat legacy filename that never matched either post-restructure, so the rebuild
  silently found 0 chunks, reported 100% progress, and dismissed the recovery banner while the
  user's on-disk video history stayed invisible. Also `02f0b41da` → `334277d0f`: a frame-offset
  bookkeeping bug (fixed, then regressed, then re-fixed) caused **every chunk's second frame to
  be rejected** by `AVAssetWriter`'s strictly-increasing-timestamp requirement, discarding the
  whole in-progress `.mp4` after 5 failures — i.e. **Rewind capture produced a permanently empty
  timeline** for a period in this window (`02516d90f`'s bug-sweep title literally says "Fix macOS
  Rewind blank capture"). Both are fixed as of the tag. Takeaway for whoever eventually ports
  rebuild-from-video semantics to Windows: chunk paths are day-directory + `chunk_HHmmss.mp4`
  (local time zone), not flat `chunk_YYYYMMDD_HHMMSS.hevc`; legacy `.hevc` is still accepted as a
  fallback.

- **`05-rewind.md:25`** ("Retention cleanup granularity … Present-equivalent [Windows], simpler,
  but correct for JPEG-per-frame model") — Mac's chunk-orphan-aware retention (the reference this
  row is comparing against) had a **severe active bug in this window**: `314e5e0ff` found that
  video-backed screenshot rows persist `imagePath` as `""` (NOT NULL coalesce), which
  `deleteScreenshotsOlderThan`'s `WHERE imagePath IS NOT NULL` matches, and
  `RewindStorage.deleteScreenshot(relativePath: "")` resolved to the Screenshots directory
  **itself** — `removeItem` then recursively deleted the user's entire on-disk screenshot store on
  the first 6-hourly cleanup, for any user with legacy JPEGs plus video-backed rows older than the
  retention window. A follow-up (`bbfc32c26`) hardened the same guard against `../` path
  traversal (Copilot review catch: the original fix only checked `candidate != root`, not
  "strictly inside root"). Net: Windows's simpler JPEG-per-frame retention model was never
  exposed to this bug *class* (no empty-string-path special case exists in its schema), which is
  a point in favor of the "keep JPEGs" Gate-2 decision, not against it — but if Stream 4 ever
  writes a path-based deletion helper for anything Rewind-adjacent, port the "trimmed value +
  strictly-inside-root, not just not-equal-to-root" guard pattern from `RewindStorage.swift`
  (`screenshotDeletionURL`) as defensive practice regardless of storage format.

- **Embedding index correctness** (relevant to `03-memory-persona-profile.md`'s "Embeddings /
  semantic similarity" section, which Stream 3 item 7 plans to port): `2446444a9` fixed two
  latent bugs worth knowing before porting `EmbeddingService`: (1) `action_items` and
  `staged_tasks` are separate SQLite tables whose autoincrement rowids both start at 1 — the
  in-memory similarity index was keyed on raw `Int64` id, so a same-id action-item/staged-task
  pair silently overwrote each other's embedding, and the two consumers even guessed which table
  a hit belonged to in *opposite* orders. Fixed by keying on `(TaskEmbeddingSource, id)`. (2)
  `embedBatch` dropped malformed entries via `compactMap`, but callers zipped results back to
  input texts by position — one dropped entry shifted every later embedding onto the wrong item.
  Now requires `embeddings.count == texts.count` or throws. **Port note: if Windows builds the
  embedding/semantic-search layer, source-namespace the index key from day one** — don't
  reproduce the collision.

## REMOVED / reworked things the plan assumes

- The old conversation-sync merge heuristic (`preservingNewerLocalFields:` + `max(localUpdatedAt,
  serverUpdatedAt)` last-writer-wins comparison in `AppState+DataLoading.swift`) is **gone**,
  replaced by the `ConversationRepository` + explicit `cacheCompleteness`/`serverUpdatedAt` model
  described above. Any Stream 4 design note that references "Mac does timestamp-heuristic
  merging for conversation sync" is describing the pre-refresh architecture.
- `MemoriesPage.swift`'s local SQLite pagination went through **four separate bug fixes** in this
  window (`08f67e56e` optimistic-delete cursor drift, `b955e3b0a` cursor-advance-by-raw-count,
  `6de00cbf4` hasMoreMemories computed from filtered not raw count, plus the underlying
  `935fda5be` AgentSync compound-cursor pattern) — the net result is a documented rule: **cache
  pagination cursors must always advance/gate off the raw DB row count, never the
  tier/filter-narrowed visible count.** If Stream 3 ports any local-SQLite-cache pagination for
  Windows Memories (per `03-memory-persona-profile.md`'s "flat model, no local SQLite cache"
  gap), apply this rule from the start rather than rediscovering it.

## Backend contract changes (summary table)

| Endpoint / contract | Old | New | Commit |
|---|---|---|---|
| `PATCH /v3/memories/{id}`, `/v3/memories/{id}/visibility` | `value` required query param only | `MemoryValueRequest{value}` JSON body (canonical); query param now optional/deprecated | `f630e8cfd`, `abf16b97b` |
| `PATCH /v1/conversations/{id}/title`, `/starred` | returns `{status}` | returns `ConversationMutationResponse{status, conversation}` | `cb7cea49e` |
| `PATCH /v1/conversations/{id}/folder` | returns `FolderMutationResponse{status}` | returns `ConversationMutationResponse{status, conversation}` | `cb7cea49e` |
| `Conversation.updated_at` | not a stable field / derived client-side from started/finished | canonical, server-attached from Firestore `update_time` | `cb7cea49e` |
| `Conversation.conversation_audio` | absent | new `ConversationAudio` (merged MP3 + spans manifest) field | `4948dc589` |
| `X-App-Platform` header enum | `macos`/`ios`/`android` | adds `windows`, `web` | `a4c50bcb4` |
| `/v4/web/listen` device provenance | not specified | device hash carried in first WS auth message (browsers can't set upgrade headers); platform hard-fixed to `web` server-side | `a4c50bcb4` |
| Conversation processing → memory extraction | in-place replace (LLM failure could wipe memories) | extract-first, atomic replace; cascade-delete order fixed (memories + action items before conversation doc) | `a8b76b903` |
| `PATCH /v1/conversations/{id}/segments/{idx}/assign` | `IndexError`→500 on out-of-range/negative idx | bounds-checked, 404 on out-of-range | `97ab8c97f` |

## Post-beta (v0.12.72..upstream/main) — track, don't port yet

- `69aa41043` / `5e9aef6ec` — Opus decoder TOC read hardened against non-zero-based `Data`
  slices; Apple Notes "exec" over-filter fix bundled in the same PR (#9635).
- `4b7d870b4` / `1b1b6c96a` / `1f7a90868` — "make WAL and Rewind recovery retry-safe" +
  "make Rewind rebuild idempotent" (#9592) — further hardening on top of the pool-epoch work
  above; re-check before porting rebuild-from-video since this changes the same code path again.
- `a76f93678` / `8e3aa087d` / `e29f416ee` — bound `RealtimeOmni` pre-connect audio buffer (#9602).
- `29e893cfc` / `d4252a673` — "retain failed audio and surface live STT errors" (#9616) —
  sounds relevant to audio-storage durability; worth a follow-up look once this stabilizes past
  beta.

## Impact on the 4 Windows parity streams

- **Stream 3 (proactive intelligence & memory):**
  - Item "AI User Profile" (#1) — no contract changes found in this window; `abf16b97b`'s
    `docs(api): refresh app-client memory contracts` did not touch `AIUserProfileResponse`/
    `UpdateAIUserProfileRequest` shapes. Proceed as planned.
  - "Continuous AI memory extraction" (#5) and "Memory data model richness" gap — **port
    `a4c50bcb4` (device provenance) directly** rather than re-deriving `clientDevice.ts`; it's
    already Windows-shaped code sitting in upstream history, tested, small (< 60 lines across 2
    files), and it unblocks the "This device" filter row without waiting on the full extraction
    pipeline.
  - "Semantic embeddings" (#7) — apply the source-namespaced-key + count-mismatch-throws pattern
    from `2446444a9` when designing the index, not after finding the same bug independently.
  - If/when memory edit/visibility ships on Windows (currently C9, unowned but Stream-3-adjacent
    via `hooks/useMemories.ts` ownership) — **use the JSON body, not the query param**; the
    WIRING-AUDIT.md hedge toward the query param is now the wrong answer.
  - MemoriesPage-equivalent pagination — apply the raw-count-not-filtered-count cursor rule
    (see REMOVED/reworked section) if a local cache layer gets built.

- **Stream 4 (Rewind, conversations & shell):**
  - Rewind storage-architecture Gate 2 ("keep JPEGs for now") — **still valid, no format change
    at the tag**: Mac is still H.265 `.mp4` chunks via `VideoChunkEncoder.swift`/`AVAssetWriter`.
    But the encoder had a real capture-breaking regression in this window (blank timeline) and a
    real "Rebuild Index never worked" bug, both just fixed — a useful data point for the
    complexity-vs-benefit tradeoff behind Gate 2, and exact chunk-naming/timestamp-parsing details
    to reuse if the H.265 path is ever revisited later.
  - Conversation pages (`ConversationDetail.tsx`, `Conversations.tsx`) — **the generated API
    client needs a regen before building title/star/folder mutation UI**; current fork `main`'s
    client still expects the old bare-`{status}` response shape, not the new
    `ConversationMutationResponse{status, conversation}` the backend actually returns at the tag.
    This affects any "optimistic update, settle from server response" pattern Stream 4 designs.
  - DB corruption recovery item — if ported, the pool-epoch invalidation pattern
    (`b59bfc7c5`/`50dfcd421`) is the actual current Mac architecture, not the simpler
    single-actor recovery the original `05-rewind.md` write-up implies; Windows's `db.ts` doesn't
    have the multi-actor-cache problem (single process, no actor-scoped pool caches per
    subsystem) so this may not port 1:1 — flag as an architecture note, not a checklist item.
  - LiveNotes / speaker naming — **no commits touched these in this window** (grepped for
    "Speaker"/"LiveNote"/"transcript" across all 288 commits; only hit was an unrelated
    transcription-retry DB-lock-contention fix, `456dbe6b6`). No staleness to report here; the
    existing audit's description should still hold.
  - File index / KG — `3bf5a27e4` fixed a fail-open deletion bug (FileIndexer purged the whole
    index on a transient directory-read error, indistinguishable from real deletion). Relevant if
    Stream 4 ports FileIndexer-adjacent incremental-rescan logic: exclude subtrees whose
    enumeration failed from the delete-diff, don't treat "couldn't read" as "was deleted."
  - `7ec620423` (MemoryGraph render-tick race) and `b6010a194`/`01e536e6a` (MemoryGraph revisit
    perf: skip redundant force-sim rebuild on unchanged data, reuse prepared view-model, restore
    settled layout) are relevant prior art for the "BrainGraph interactivity flip" quick win —
    Mac's revisit-caching approach (compare graph data, skip resim if unchanged) is a reasonable
    model for the standalone-viewer-route work.

- **Stream 1 / Stream 2:** nothing found in this window's `desktop/macos` domain-relevant commits
  that changes their scope; the `abf16b97b`/`cd2fcada1` "worker memory relay" commit is
  agent-control-plane (Stream 1's `desktop/macos/agent/src/index.ts`), flagging for their
  awareness but out of my domain to assess in depth.

---

## PARALLEL-PLAN.md corrections

Checked every Stream 3 and Stream 4 line item plus the relevant decision gates against the
v0.12.72 tag. Findings:

1. **Gate 2 — "Rewind storage architecture — DECIDED: keep JPEGs + retention tuning for now; H.265
   revisit after Stream 4's other work lands."** (`PARALLEL-PLAN.md:234-236`) — **Still accurate,
   no correction needed.** Mac has not changed its storage format at the tag (still H.265 `.mp4`
   chunks). Add as a footnote for whoever revisits H.265 later: Mac's own encoder had a
   capture-breaking bug (blank Rewind timeline) and a completely non-functional "Rebuild Index"
   in this exact window (`334277d0f`, `02f0b41da`, `2efd54dc2`, all fixed before the tag) — the
   H.265 approach is not obviously more reliable in practice than the JPEG approach the plan
   chose; this is a mild reinforcement of the existing decision, not a reversal.

2. **Stream 3, item 1** ("AI User Profile … `get/update_ai_profile` endpoints already in the
   generated client with zero callers") (`PARALLEL-PLAN.md:131-133`) — **Still accurate.** No
   `AIUserProfileService`/`AIUserProfileResponse` contract changes found between baseline and the
   tag.

3. **Stream 3, item 5** ("Continuous AI memory extraction … and screen-based AI task extraction")
   (`PARALLEL-PLAN.md:142-144`) — **Needs a new bullet.** The plan doesn't mention that a
   ready-to-port device-provenance implementation (`a4c50bcb4`) already exists upstream for the
   adjacent "This device" filter gap in the same area (`03-memory-persona-profile.md`'s memory
   data-model-richness row). Recommend inserting: *"Before building memory device-provenance
   support, check whether upstream commit `a4c50bcb4` (cross-platform device provenance) can be
   cherry-picked directly — it already contains `clientDevice.ts` + `omiListen.ts` wiring in
   Windows-native TypeScript."*

4. **Stream 3, item 7** ("Semantic embeddings service … Windows is lexical-only")
   (`PARALLEL-PLAN.md:149`) — **No architectural correction, but add an implementation-detail
   warning.** Mac's own `EmbeddingService` had two data-integrity bugs fixed in this window
   (rowid collision across tables; batch-embed misalignment on partial failures — `2446444a9`).
   If Stream 3 is porting Mac's design 1:1, port the fixed version's namespacing, not the
   pre-fix version (there's no way to tell which version a given piece of Mac source-reading
   documentation reflects without checking commit dates — flagging so Stream 3 doesn't
   reintroduce a bug Mac already fixed).

5. **Stream 4, first bullet** ("Rewind search UI un-gating … then OCR-embedding semantic search
   … FTS5, OCR bounding boxes") (`PARALLEL-PLAN.md:172-174`) — **No correction**; nothing in this
   window touched `RewindOCRService.swift`, `OCREmbeddingService.swift`, or FTS5 schema.

6. **Stream 4 bullet, "DB corruption recovery"** (`PARALLEL-PLAN.md:179-180`) — **Needs an
   architecture-accuracy correction.** The plan (and the underlying `05-rewind.md:119`) describes
   this as a roughly single-component feature ("`RewindDatabase.swift` — unclean-shutdown
   detection, WAL cleanup, `.recover`, rebuild-from-video"). As of the tag, corruption recovery is
   now a **cross-cutting concern touching 10 separate storage actors** (pool-epoch invalidation,
   `b59bfc7c5`/`50dfcd421`/`bd72e551d`) — recovering the DB file alone is not sufficient on Mac
   anymore; every actor with its own cached pool handle has to detect and drop staleness too. This
   doesn't necessarily transfer 1:1 to Windows's `db.ts` (single shared connection, not
   actor-scoped pools per subsystem) but the plan should note the Mac reference implementation is
   now more architecturally involved than the one-file description suggests, so time-boxing this
   item as "small" would be wrong if a faithful port is attempted.

7. **Stream 4 bullet, "Speaker naming"** (`PARALLEL-PLAN.md:182-183`) — **No correction; confirmed
   zero relevant commits in this window.**

8. **Stream 4, "conversations" ownership** (`pages/{Conversations,ConversationDetail,
   LiveConversation}.tsx`, `PARALLEL-PLAN.md:198-199`) — **Needs a new bullet.** Add: *"Before
   building any conversation title/star/folder mutation UI, regenerate
   `omiApi.generated.ts` — the backend now returns the canonical conversation object
   (`ConversationMutationResponse`) from these PATCH endpoints instead of a bare status, and the
   current fork's generated client hasn't picked this up."*

9. **Cross-cutting corrections section** (`PARALLEL-PLAN.md:286-296`) — recommend adding: *"The
   WIRING-AUDIT.md C9 hedge ('if Windows builds memory edit/visibility, use the query-param form,
   don't copy Mac') is now stale — the backend added the JSON-body form as the documented
   canonical path (`f630e8cfd`); Mac was right, use the body form."*

No other Stream 3 / Stream 4 line items or decision gates in `PARALLEL-PLAN.md` were contradicted
by commits in the `0d09ede..v0.12.72` range for this domain.

---

## Spotted outside my domain (flagging, not assessed)

- `83a83138b`/`f21596b23`/`d1a3d9c9a`/`a97cfc61e` ("Tier-2 qualification deterministic" /
  "qualification-facing client contracts") — despite the "Tier" name, this is the **desktop QA
  harness's** Tier-2 test-qualification level (`omi-harness`, `qualify-desktop-beta.sh`), **not**
  the memory ST/LT tier system. False-positive keyword match; excluded from this report after
  verification.
- `cd2fcada1` (`fix(agent): preserve direct worker memory relay`) — despite "memory" in the title,
  this is the background-agent worker protocol relay (`desktop/macos/agent/src/index.ts`,
  agent-control-plane), Stream 1's domain, not memory storage. Flagged, not assessed.
- `f0e7078e3` (`fix(memory): enforce INV-MEM-1 admission processing`) and `ee88995a5` (`Refactor
  V3 memory modules into package`) — deep backend canonical-memory-pipeline internals (admission,
  consolidation, KG promotion). Server-side only; `MEMORY_MODE=off` in prod until Gate 3 per
  `AGENTS.md`. Not client-facing, so not expanded here, but worth a dedicated look if/when the
  memory-tier rollout gates open — the `V3 memory modules into package` refactor in particular
  means file paths under `backend/routers/memories.py` may have moved; re-verify exact paths
  before citing them in future work.
- Audio pipeline bug fixes bundled in `02516d90f` (system-audio mono/6dB attenuation,
  AAC/ADTS decoder crash guard, `RawWebSocket` keepalive timer leak) — audio-capture-level, not
  audio-storage/Opus-level; Stream 2's territory. Noted for awareness only.
