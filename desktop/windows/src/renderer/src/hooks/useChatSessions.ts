import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSession } from '../../../shared/chatSessions'
import {
  createSession as createSessionApi,
  deleteSession as deleteSessionApi,
  listSessions as listSessionsApi,
  updateSession as updateSessionApi
} from '../lib/chatSessionsClient'
import { filterSessions, groupSessionsByDate, type SessionGroup } from '../lib/chatSessionsView'

// The subset of the data-layer client the hook uses. Injectable so the hook
// unit-tests against a fake without mocking the module graph (which pulls in
// axios + Firebase).
export interface SessionsClientLike {
  listSessions: typeof listSessionsApi
  createSession: typeof createSessionApi
  updateSession: typeof updateSessionApi
  deleteSession: typeof deleteSessionApi
}

const realClient: SessionsClientLike = {
  listSessions: listSessionsApi,
  createSession: createSessionApi,
  updateSession: updateSessionApi,
  deleteSession: deleteSessionApi
}

function errorMessage(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (e instanceof Error && e.message) return e.message
  return 'Something went wrong'
}

export interface UseChatSessions {
  /** All loaded sessions (server order: `updated_at DESC`). */
  sessions: ChatSession[]
  /** `sessions` after the client-side search filter. */
  filteredSessions: ChatSession[]
  /** `filteredSessions` grouped into date buckets for the list. */
  groupedSessions: SessionGroup[]
  /** The selected session id, or `null` for the default shared thread. The
   *  default thread is NEVER a session id — that is the continuity invariant. */
  currentSessionId: string | null
  loading: boolean
  error: string | null
  searchQuery: string
  showStarredOnly: boolean
  setSearchQuery: (q: string) => void
  /** Toggle the header "Starred" filter; re-queries the server with starred=true. */
  toggleStarredFilter: () => void
  /** Retry after a load error. */
  retryLoad: () => void
  /** Select a session, or `null` to return to the default shared thread. */
  selectSession: (id: string | null) => void
  /** Create a new desktop-local session and select it. */
  createNewSession: () => Promise<ChatSession | null>
  /** Rename; silently no-ops on an empty or unchanged title. */
  renameSession: (id: string, title: string) => Promise<void>
  /** Toggle a session's starred flag. */
  toggleStar: (id: string) => Promise<void>
  /** Delete a session (server cascades its messages). No undo. */
  removeSession: (id: string) => Promise<void>
}

/**
 * State + data orchestration for the chat-sessions sidebar. Owns the sessions
 * list, the selected session, the search text, and the starred filter, and
 * drives the data-layer client for CRUD.
 *
 * NOTE: this hook manages sidebar/session state only. Actually re-threading the
 * live chat engine (`useChat`) onto a selected session is deferred to the
 * Track 1 kernel-runtime PR — selecting a session here sets `currentSessionId`
 * and the highlight; it does not yet swap `useChat`'s thread.
 */
export function useChatSessions(options?: { client?: SessionsClientLike }): UseChatSessions {
  const client = options?.client ?? realClient

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showStarredOnly, setShowStarredOnly] = useState(false)

  // Generation guard: an in-flight load that a newer load supersedes must not
  // clobber the fresher result (e.g. rapid Starred-filter toggling).
  const loadGen = useRef(0)

  const load = useCallback(
    async (starredOnly: boolean) => {
      const gen = ++loadGen.current
      setLoading(true)
      setError(null)
      try {
        const rows = await client.listSessions(starredOnly ? { starred: true } : {})
        if (loadGen.current !== gen) return
        setSessions(rows)
      } catch (e) {
        if (loadGen.current !== gen) return
        setError(errorMessage(e))
      } finally {
        if (loadGen.current === gen) setLoading(false)
      }
    },
    [client]
  )

  useEffect(() => {
    void load(showStarredOnly)
  }, [load, showStarredOnly])

  const toggleStarredFilter = useCallback(() => setShowStarredOnly((v) => !v), [])
  const retryLoad = useCallback(() => void load(showStarredOnly), [load, showStarredOnly])
  const selectSession = useCallback((id: string | null) => setCurrentSessionId(id), [])

  const createNewSession = useCallback(async (): Promise<ChatSession | null> => {
    try {
      const created = await client.createSession()
      setSessions((prev) => [created, ...prev])
      setCurrentSessionId(created.id)
      return created
    } catch (e) {
      setError(errorMessage(e))
      return null
    }
  }, [client])

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim()
      const target = sessions.find((s) => s.id === id)
      // Silent no-op on empty or unchanged title (Mac guard).
      if (!trimmed || (target && trimmed === target.title)) return
      const updated = await client.updateSession(id, { title: trimmed })
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: updated.title } : s)))
    },
    [client, sessions]
  )

  const toggleStar = useCallback(
    async (id: string) => {
      const target = sessions.find((s) => s.id === id)
      if (!target) return
      const next = !target.starred
      await client.updateSession(id, { starred: next })
      if (showStarredOnly) {
        // The starred filter is a server query; re-run it so an unstarred row
        // drops out of (or a starred row is reflected in) the filtered view.
        void load(true)
      } else {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, starred: next } : s)))
      }
    },
    [client, sessions, showStarredOnly, load]
  )

  const removeSession = useCallback(
    async (id: string) => {
      await client.deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      // Deleting the open session returns to the default shared thread.
      setCurrentSessionId((cur) => (cur === id ? null : cur))
    },
    [client]
  )

  const filteredSessions = useMemo(
    () => filterSessions(sessions, searchQuery),
    [sessions, searchQuery]
  )
  const groupedSessions = useMemo(() => groupSessionsByDate(filteredSessions), [filteredSessions])

  return {
    sessions,
    filteredSessions,
    groupedSessions,
    currentSessionId,
    loading,
    error,
    searchQuery,
    showStarredOnly,
    setSearchQuery,
    toggleStarredFilter,
    retryLoad,
    selectSession,
    createNewSession,
    renameSession,
    toggleStar,
    removeSession
  }
}
