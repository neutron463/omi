// ═══════════════════════════════════════════════════════════════════════════════
// Cleanup-decision logic for the voice tool gauntlet — extracted as a PURE,
// unit-testable function so the harness can NEVER again mass-delete real data.
//
// WHY THIS EXISTS (a real data-loss incident):
//   The gauntlet used to identify "run-created" action items by DIFFING against a
//   pre-run snapshot and deleting everything whose id was NOT in it. The baseline
//   fetch was wrapped in `.catch(() => [])`, so a transient fetch FAILURE (rate
//   limit / load) produced an EMPTY baseline — indistinguishable from "there were
//   genuinely 0 items". With an empty baseline every pre-existing task counts as
//   "run-created", and cleanup deleted all of them: a user lost 7 real tasks on a
//   subset run that created ZERO items.
//
//   This mirrors the app's OWN guard in src/main/tasks/taskSyncEngine.ts (~:299,
//   `hardDeleteAbsentTasksOn`): "an empty or failed listing never wipes local data."
//   The harness lacked that guard; this module is it.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Decide which action-item ids the run is allowed to delete during cleanup.
 * Defense in depth — a delete only happens through one of two channels, and any
 * suspicious bulk delete is refused outright:
 *
 *   PRIMARY   · positive token match — an item whose description contains one of the
 *               run's deliberately-nonsense test tokens (zebra/penguin/…). Safe: it
 *               can only ever name data THIS run authored.
 *   SECONDARY · guarded id-diff — an item that is NEW since the run started AND was
 *               positively observed appearing during a create turn. Catches an item
 *               whose token STT mangled (quokka → "quaka") without ever touching a
 *               pre-existing task. DISABLED entirely when the baseline fetch failed —
 *               an untrusted baseline must never drive a diff (that was the bug).
 *   CAP       · never delete more items than the run could plausibly have created;
 *               a candidate set larger than the create count means the logic
 *               mis-classified real data → abort and delete NOTHING.
 *
 * @param {object}   a
 * @param {boolean}  a.baselineOk           did the pre-run listing succeed? (false ⇒ diff disabled)
 * @param {Set<string>|Iterable<string>} a.initialItemIds  ids present before the run (trusted only if baselineOk)
 * @param {Set<string>|Iterable<string>} a.observedCreatedIds ids seen appearing during create turns
 * @param {Set<string>|Iterable<string>} a.tokenMatchedIds  ids already matched to a test token mid-run
 * @param {RegExp}   a.tokenRe              the run's test-token regex
 * @param {Array<{id?: string, description?: string}>} a.afterItems current backend items
 * @param {boolean}  a.afterOk             did the final listing succeed? (false ⇒ delete NOTHING)
 * @param {number}   a.plannedCreateCount  how many create mutations the run performed (the cap)
 * @returns {{ ids: string[], aborted: boolean, reason: string }}
 */
export function computeCleanupDeletions({
  baselineOk,
  initialItemIds,
  observedCreatedIds,
  tokenMatchedIds,
  tokenRe,
  afterItems,
  afterOk,
  plannedCreateCount
}) {
  // A failed final listing is as dangerous as a failed baseline — without a
  // trustworthy "current" view there is nothing safe to diff or match. Delete
  // nothing (taskSyncEngine.ts:299 spirit).
  if (!afterOk) {
    return { ids: [], aborted: true, reason: 'final listing failed — deleting nothing' }
  }

  const initial = toSet(initialItemIds)
  const observed = toSet(observedCreatedIds)
  const priorTokenMatched = toSet(tokenMatchedIds)
  const items = Array.isArray(afterItems) ? afterItems : []

  const del = new Set()

  // PRIMARY — positive token match on the CURRENT backend items, plus any ids we
  // already token-matched mid-run (covers an item a final eventual-consistency read
  // happens to miss). Both channels only ever name this run's nonsense tokens, so
  // they can never select a pre-existing real task.
  for (const it of items) {
    if (it?.id && tokenRe.test(it.description || '')) del.add(it.id)
  }
  for (const id of priorTokenMatched) if (id) del.add(id)

  // SECONDARY — guarded id-diff. Only when the baseline is TRUSTED, and only for ids
  // we positively watched appear during a create turn. Never runs off a bare
  // "not in baseline" test — that conflation is exactly the mass-delete bug.
  if (baselineOk) {
    for (const it of items) {
      if (it?.id && !initial.has(it.id) && observed.has(it.id)) del.add(it.id)
    }
  }

  // CAP — the run creates at most `plannedCreateCount` distinct items (create then
  // update/complete keep the SAME id; delete removes one). A candidate set larger
  // than that means the diff mis-classified genuine data → refuse the whole delete.
  const cap = Math.max(0, Number.isFinite(plannedCreateCount) ? Math.trunc(plannedCreateCount) : 0)
  if (del.size > cap) {
    return {
      ids: [],
      aborted: true,
      reason: `refusing bulk delete: ${del.size} candidate(s) > plausible-create cap ${cap}`
    }
  }

  return { ids: [...del], aborted: false, reason: '' }
}

/** Coerce a Set | iterable | nullish into a Set (defensive — callers pass Sets). */
function toSet(v) {
  if (v instanceof Set) return v
  return new Set(v || [])
}
