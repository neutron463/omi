// Pure view-model helpers: client-side search filter + date-bucket grouping.
import { describe, expect, it } from 'vitest'
import type { ChatSession } from '../../../shared/chatSessions'
import { filterSessions, groupSessionsByDate, toEpochMs } from './chatSessionsView'

function session(over: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    id: over.id,
    title: over.title ?? 'Untitled',
    preview: over.preview,
    createdAt: over.createdAt ?? '2026-07-14T00:00:00Z',
    updatedAt: over.updatedAt ?? '2026-07-14T00:00:00Z',
    appId: over.appId,
    messageCount: over.messageCount ?? 0,
    starred: over.starred ?? false
  }
}

describe('toEpochMs', () => {
  it('passes finite numbers through and parses ISO strings', () => {
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000)
    expect(toEpochMs('2026-07-14T00:00:00Z')).toBe(Date.parse('2026-07-14T00:00:00Z'))
  })
  it('returns 0 for junk (never NaN)', () => {
    expect(toEpochMs('not-a-date')).toBe(0)
    expect(toEpochMs(undefined)).toBe(0)
    expect(toEpochMs(NaN)).toBe(0)
  })
})

describe('filterSessions', () => {
  const list = [
    session({ id: '1', title: 'Trip to Berlin', preview: 'flights' }),
    session({ id: '2', title: 'Grocery list', preview: 'milk and eggs' }),
    session({ id: '3', title: 'Work notes', preview: 'Berlin office' })
  ]

  it('returns the input unchanged for an empty/whitespace query', () => {
    expect(filterSessions(list, '')).toHaveLength(3)
    expect(filterSessions(list, '   ')).toHaveLength(3)
  })

  it('matches title case-insensitively', () => {
    expect(filterSessions(list, 'GROCERY').map((s) => s.id)).toEqual(['2'])
  })

  it('also matches the preview text', () => {
    // "Berlin" is in #1's title and #3's preview.
    expect(filterSessions(list, 'berlin').map((s) => s.id)).toEqual(['1', '3'])
  })

  it('returns nothing when no session matches', () => {
    expect(filterSessions(list, 'zzz')).toHaveLength(0)
  })
})

describe('groupSessionsByDate', () => {
  // Fixed "now": Tue 2026-07-14 12:00 local.
  const now = new Date(2026, 6, 14, 12, 0, 0).getTime()
  const at = (y: number, m: number, d: number, h = 9): string =>
    new Date(y, m, d, h).toISOString()

  it('buckets by relative day into Today / Yesterday / Previous 7 Days / Previous 30 Days', () => {
    const groups = groupSessionsByDate(
      [
        session({ id: 'today', updatedAt: at(2026, 6, 14) }),
        session({ id: 'yst', updatedAt: at(2026, 6, 13) }),
        session({ id: 'wk', updatedAt: at(2026, 6, 10) }), // 4 days ago
        session({ id: 'mo', updatedAt: at(2026, 6, 1) }) // 13 days ago
      ],
      now
    )
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 Days',
      'Previous 30 Days'
    ])
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['today'])
  })

  it('buckets older same-year sessions by month name, and prior years by year', () => {
    const groups = groupSessionsByDate(
      [
        session({ id: 'may', updatedAt: at(2026, 4, 3) }), // May 2026
        session({ id: 'lastyear', updatedAt: at(2025, 10, 20) }) // Nov 2025
      ],
      now
    )
    expect(groups.map((g) => g.label)).toEqual(['May', '2025'])
  })

  it('preserves input order within a bucket (server sends updated_at DESC)', () => {
    const groups = groupSessionsByDate(
      [
        session({ id: 'a', updatedAt: at(2026, 6, 14, 11) }),
        session({ id: 'b', updatedAt: at(2026, 6, 14, 8) })
      ],
      now
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })
})
