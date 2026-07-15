// Pure view-model helpers for the chat-sessions sidebar: client-side search
// filtering and date-bucket grouping. Kept free of React/DOM so they unit-test
// in the node env and the sidebar just renders their output.

import type { ChatSession } from '../../../shared/chatSessions'

/** Normalize a wire timestamp (epoch-ms number OR ISO-8601 string) to epoch ms.
 *  Returns 0 for unparseable input so a bad row sorts to the bottom, never NaN. */
export function toEpochMs(value: number | string | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : 0
  }
  return 0
}

/**
 * Client-side substring filter (case-insensitive) over already-loaded sessions —
 * matches the Mac sidebar's live `searchQuery` filter, NOT a server query.
 * Matches the title and the preview (so searching for message text works). An
 * empty/whitespace query returns the input unchanged.
 */
export function filterSessions(sessions: ChatSession[], query: string): ChatSession[] {
  const q = query.trim().toLowerCase()
  if (!q) return sessions
  return sessions.filter((s) => {
    const title = (s.title ?? '').toLowerCase()
    const preview = (s.preview ?? '').toLowerCase()
    return title.includes(q) || preview.includes(q)
  })
}

/** A date-bucketed group of sessions, in display order. */
export interface SessionGroup {
  label: string
  sessions: ChatSession[]
}

// Bucket labels (macOS-style relative grouping). Older sessions fall into a
// "Month Year" bucket (current year) or "Year" bucket (prior years).
const TODAY = 'Today'
const YESTERDAY = 'Yesterday'
const PREVIOUS_7 = 'Previous 7 Days'
const PREVIOUS_30 = 'Previous 30 Days'

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

function bucketLabel(sessionMs: number, now: number): string {
  const todayStart = startOfLocalDay(now)
  const dayMs = 86_400_000
  const sessionDayStart = startOfLocalDay(sessionMs)
  const daysAgo = Math.round((todayStart - sessionDayStart) / dayMs)

  if (daysAgo <= 0) return TODAY
  if (daysAgo === 1) return YESTERDAY
  if (daysAgo <= 7) return PREVIOUS_7
  if (daysAgo <= 30) return PREVIOUS_30

  const d = new Date(sessionMs)
  const nowYear = new Date(now).getFullYear()
  if (d.getFullYear() === nowYear) return MONTH_NAMES[d.getMonth()]
  return String(d.getFullYear())
}

/**
 * Group sessions into date buckets by `updatedAt`, preserving the input order
 * within each bucket (the server returns `updated_at DESC`, so newest-first is
 * kept). Buckets appear in first-seen order, which — given DESC input — is
 * already most-recent-first. `now` is injectable for deterministic tests.
 */
export function groupSessionsByDate(
  sessions: ChatSession[],
  now: number = Date.now()
): SessionGroup[] {
  const groups: SessionGroup[] = []
  const byLabel = new Map<string, SessionGroup>()
  for (const s of sessions) {
    const label = bucketLabel(toEpochMs(s.updatedAt), now)
    let group = byLabel.get(label)
    if (!group) {
      group = { label, sessions: [] }
      byLabel.set(label, group)
      groups.push(group)
    }
    group.sessions.push(s)
  }
  return groups
}
