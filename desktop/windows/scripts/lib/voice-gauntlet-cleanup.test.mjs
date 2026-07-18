import { describe, it, expect } from 'vitest'
import { computeCleanupDeletions } from './voice-gauntlet-cleanup.mjs'

const TOKEN = /zebra|penguin/i

// Seven genuine user tasks — the exact class of data the harness wiped.
const REAL_TASKS = [
  { id: 'r1', description: 'Email the accountant' },
  { id: 'r2', description: 'Book dentist appointment' },
  { id: 'r3', description: 'Renew car insurance' },
  { id: 'r4', description: 'Reply to landlord' },
  { id: 'r5', description: 'Pick up prescription' },
  { id: 'r6', description: 'Submit expense report' },
  { id: 'r7', description: 'Call mom' }
]

/**
 * The ORIGINAL buggy cleanup decision, reproduced verbatim to lock in the
 * regression: it deleted every item whose id was absent from the (possibly-empty)
 * baseline OR matched a token. On a FAILED baseline the id set is empty, so every
 * real task is "absent" → all deleted. This helper exists ONLY to prove the new
 * guarded logic no longer behaves this way.
 */
function legacyBuggyDeletions({ initialItemIds, tokenRe, afterItems }) {
  const del = new Set()
  for (const it of afterItems) {
    if (it.id && (!initialItemIds.has(it.id) || tokenRe.test(it.description || ''))) del.add(it.id)
  }
  return [...del]
}

describe('computeCleanupDeletions — data-loss guard', () => {
  it('REGRESSION: a FAILED baseline wiped 7 real tasks under the old logic; the guard deletes none', () => {
    // The exact incident: a subset run that created ZERO items, whose baseline fetch
    // transiently failed (empty baseline).
    const initialItemIds = new Set() // failed fetch ⇒ empty (the trigger)

    // Proof the OLD logic was catastrophic: all 7 real tasks classified as run-created.
    const legacy = legacyBuggyDeletions({ initialItemIds, tokenRe: TOKEN, afterItems: REAL_TASKS })
    expect(legacy).toHaveLength(7)

    // The GUARDED logic: baseline failed ⇒ id-diff disabled; nothing token-matches ⇒
    // it deletes NOTHING and does not abort (there was simply nothing to clean).
    const d = computeCleanupDeletions({
      baselineOk: false,
      initialItemIds,
      observedCreatedIds: new Set(),
      tokenMatchedIds: new Set(),
      tokenRe: TOKEN,
      afterItems: REAL_TASKS,
      afterOk: true,
      plannedCreateCount: 0
    })
    expect(d.ids).toEqual([])
    expect(d.aborted).toBe(false)
  })

  it('a FAILED baseline still cleans the run OWN token-matched items, never real tasks', () => {
    // Full run whose baseline fetch failed. The run still created & token-matched its
    // own items mid-run; positive-match cleanup must remove ONLY those.
    const afterItems = [...REAL_TASKS, { id: 'p1', description: 'feed the penguin' }]
    const d = computeCleanupDeletions({
      baselineOk: false,
      initialItemIds: new Set(), // untrusted (failed) — must be ignored
      observedCreatedIds: new Set(['p1']), // ignored because baselineOk === false
      tokenMatchedIds: new Set(['z1', 'p1']), // z1 (zebra) already deleted mid-run; p1 remains
      tokenRe: TOKEN,
      afterItems,
      afterOk: true,
      plannedCreateCount: 2
    })
    expect(new Set(d.ids)).toEqual(new Set(['z1', 'p1']))
    expect(d.aborted).toBe(false)
    // No real task id is ever selected.
    for (const r of REAL_TASKS) expect(d.ids).not.toContain(r.id)
  })

  it('successful baseline + one token-matched created item deletes ONLY that item', () => {
    const initialItemIds = new Set(REAL_TASKS.map((t) => t.id))
    const afterItems = [...REAL_TASKS, { id: 'z1', description: 'buy zebra milk' }]
    const d = computeCleanupDeletions({
      baselineOk: true,
      initialItemIds,
      observedCreatedIds: new Set(['z1']),
      tokenMatchedIds: new Set(),
      tokenRe: TOKEN,
      afterItems,
      afterOk: true,
      plannedCreateCount: 1
    })
    expect(d.ids).toEqual(['z1'])
    expect(d.aborted).toBe(false)
  })

  it('SECONDARY diff: an STT-mangled created item (no token) is cleaned only when baseline is trusted', () => {
    const initialItemIds = new Set(REAL_TASKS.map((t) => t.id))
    // STT mangled "quokka" → "quaka": it does NOT match the token regex, but it was
    // observed appearing during a create turn against a trusted baseline.
    const afterItems = [...REAL_TASKS, { id: 'q1', description: 'feed the quaka' }]
    const trusted = computeCleanupDeletions({
      baselineOk: true,
      initialItemIds,
      observedCreatedIds: new Set(['q1']),
      tokenMatchedIds: new Set(),
      tokenRe: TOKEN,
      afterItems,
      afterOk: true,
      plannedCreateCount: 1
    })
    expect(trusted.ids).toEqual(['q1'])

    // Same input but with a FAILED baseline: the diff is disabled, so the mangled item
    // is left alone rather than risk touching real data.
    const untrusted = computeCleanupDeletions({
      baselineOk: false,
      initialItemIds: new Set(),
      observedCreatedIds: new Set(['q1']),
      tokenMatchedIds: new Set(),
      tokenRe: TOKEN,
      afterItems,
      afterOk: true,
      plannedCreateCount: 1
    })
    expect(untrusted.ids).toEqual([])
  })

  it('the guarded diff NEVER deletes a pre-existing item merely absent from the baseline', () => {
    // A real task exists that is somehow NOT in the baseline set (e.g. it was created
    // on another device after the snapshot) but was never observed created by the run.
    const initialItemIds = new Set(['r1', 'r2']) // r3 deliberately absent
    const afterItems = [
      { id: 'r1', description: 'Email the accountant' },
      { id: 'r2', description: 'Book dentist appointment' },
      { id: 'r3', description: 'A real task not in the baseline' }
    ]
    const d = computeCleanupDeletions({
      baselineOk: true,
      initialItemIds,
      observedCreatedIds: new Set(), // r3 was NOT observed created by the run
      tokenMatchedIds: new Set(),
      tokenRe: TOKEN,
      afterItems,
      afterOk: true,
      plannedCreateCount: 0
    })
    expect(d.ids).toEqual([])
  })

  it('CAP: a candidate set larger than the create count aborts and deletes nothing', () => {
    // Contrived: three token matches but the run only performed 1 create — the extra
    // matches can only be real data that happens to contain a token, so refuse.
    const afterItems = [
      { id: 'z1', description: 'buy zebra milk' },
      { id: 'x2', description: 'zebra crossing repaint' }, // pre-existing real task
      { id: 'x3', description: 'penguin exhibit tickets' } // pre-existing real task
    ]
    const d = computeCleanupDeletions({
      baselineOk: true,
      initialItemIds: new Set(['x2', 'x3']),
      observedCreatedIds: new Set(['z1']),
      tokenMatchedIds: new Set(),
      tokenRe: TOKEN,
      afterItems,
      afterOk: true,
      plannedCreateCount: 1
    })
    expect(d.aborted).toBe(true)
    expect(d.ids).toEqual([])
    expect(d.reason).toMatch(/bulk delete/i)
  })

  it('a FAILED final listing aborts (delete nothing) even with a good baseline', () => {
    const d = computeCleanupDeletions({
      baselineOk: true,
      initialItemIds: new Set(REAL_TASKS.map((t) => t.id)),
      observedCreatedIds: new Set(['z1']),
      tokenMatchedIds: new Set(['z1']),
      tokenRe: TOKEN,
      afterItems: [],
      afterOk: false, // final listing failed
      plannedCreateCount: 1
    })
    expect(d.aborted).toBe(true)
    expect(d.ids).toEqual([])
  })

  it('a genuinely empty account with a successful baseline deletes nothing (no false abort)', () => {
    const d = computeCleanupDeletions({
      baselineOk: true,
      initialItemIds: new Set(),
      observedCreatedIds: new Set(),
      tokenMatchedIds: new Set(),
      tokenRe: TOKEN,
      afterItems: [],
      afterOk: true,
      plannedCreateCount: 2
    })
    expect(d.ids).toEqual([])
    expect(d.aborted).toBe(false)
  })
})
