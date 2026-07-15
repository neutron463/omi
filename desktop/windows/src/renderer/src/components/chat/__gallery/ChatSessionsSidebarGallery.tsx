import { useState } from 'react'
import type { ChatSession } from '../../../../../shared/chatSessions'
import type { UseChatSessions } from '../../../hooks/useChatSessions'
import { filterSessions, groupSessionsByDate } from '../../../lib/chatSessionsView'
import { ChatSessionsSidebar } from '../ChatSessionsSidebar'

// Dev-only visual harness (mounted at #/__chat-sessions-gallery, DEV-gated in
// App.tsx). Renders the chat-sessions sidebar across its canonical states so a
// skeptical reviewer can screenshot each one against the Hub-adjacent chrome.
// Not a shipped surface.

const day = 86_400_000
const now = Date.now()

function s(over: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    id: over.id,
    title: over.title ?? 'New Chat',
    preview: over.preview,
    createdAt: over.createdAt ?? now,
    updatedAt: over.updatedAt ?? now,
    appId: over.appId,
    messageCount: over.messageCount ?? 0,
    starred: over.starred ?? false
  }
}

// A representative multi-bucket list.
const SESSIONS: ChatSession[] = [
  s({
    id: 'a',
    title: 'Weekend trip to Berlin',
    preview: 'Flights and hotels',
    updatedAt: now,
    starred: true
  }),
  s({
    id: 'b',
    title: 'Refactor the sync pipeline',
    preview: 'Cloud Tasks vs inline',
    updatedAt: now - 2 * 3_600_000
  }),
  s({ id: 'c', title: 'Grocery list', updatedAt: now - day, messageCount: 3 }),
  s({
    id: 'd',
    title: 'Q3 planning notes',
    preview: 'OKRs draft',
    updatedAt: now - 4 * day,
    starred: true
  }),
  s({ id: 'e', title: 'Interview prep', updatedAt: now - 12 * day }),
  s({ id: 'f', title: 'Old brainstorm', updatedAt: now - 90 * day })
]

function state(over: Partial<UseChatSessions>): UseChatSessions {
  const sessions = over.sessions ?? []
  const filtered = over.filteredSessions ?? filterSessions(sessions, over.searchQuery ?? '')
  const noop = (): void => {}
  const anoop = async (): Promise<void> => {}
  return {
    sessions,
    filteredSessions: filtered,
    groupedSessions: over.groupedSessions ?? groupSessionsByDate(filtered, now),
    currentSessionId: over.currentSessionId ?? null,
    loading: over.loading ?? false,
    error: over.error ?? null,
    searchQuery: over.searchQuery ?? '',
    showStarredOnly: over.showStarredOnly ?? false,
    setSearchQuery: over.setSearchQuery ?? noop,
    toggleStarredFilter: over.toggleStarredFilter ?? noop,
    retryLoad: over.retryLoad ?? noop,
    selectSession: over.selectSession ?? noop,
    createNewSession: over.createNewSession ?? (async () => null),
    renameSession: over.renameSession ?? anoop,
    toggleStar: over.toggleStar ?? anoop,
    removeSession: over.removeSession ?? anoop
  }
}

/** A fixed-size dark frame that mimics the sidebar's Hub-adjacent panel chrome. */
function Frame({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
        {title}
      </span>
      <div
        className="h-[440px] w-[280px] overflow-hidden rounded-[20px] border"
        style={{
          borderColor: 'rgb(var(--home-stage-glow-rgb) / 0.14)',
          backgroundImage:
            'linear-gradient(to bottom, rgb(255 255 255 / 0.03), rgb(var(--home-stage-glow-rgb) / 0.05))'
        }}
      >
        {children}
      </div>
    </div>
  )
}

export function ChatSessionsSidebarGallery(): React.JSX.Element {
  // One interactive instance so rename/delete/select can be exercised live.
  const [live, setLive] = useState<UseChatSessions>(() =>
    state({ sessions: SESSIONS, currentSessionId: 'a' })
  )
  const interactive = state({
    sessions: live.sessions,
    currentSessionId: live.currentSessionId,
    searchQuery: live.searchQuery,
    showStarredOnly: live.showStarredOnly,
    setSearchQuery: (q) => setLive((p) => ({ ...p, searchQuery: q })),
    toggleStarredFilter: () => setLive((p) => ({ ...p, showStarredOnly: !p.showStarredOnly })),
    selectSession: (id) => setLive((p) => ({ ...p, currentSessionId: id })),
    toggleStar: async (id) =>
      setLive((p) => ({
        ...p,
        sessions: p.sessions.map((x) => (x.id === id ? { ...x, starred: !x.starred } : x))
      })),
    renameSession: async (id, title) =>
      setLive((p) => ({
        ...p,
        sessions: p.sessions.map((x) => (x.id === id ? { ...x, title } : x))
      })),
    removeSession: async (id) =>
      setLive((p) => ({ ...p, sessions: p.sessions.filter((x) => x.id !== id) }))
  })

  return (
    <div className="min-h-screen w-full overflow-y-auto bg-[var(--bg-primary)] px-8 py-10 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Chat Sessions Sidebar</h1>
          <p className="text-sm text-white/45">
            components/chat/ChatSessionsSidebar · macOS parity · multiChatEnabled gate
          </p>
        </header>
        <div className="flex flex-wrap gap-8">
          <Frame title="Loaded + selected">
            <ChatSessionsSidebar state={state({ sessions: SESSIONS, currentSessionId: 'a' })} />
          </Frame>
          <Frame title="Interactive (select / rename / delete)">
            <ChatSessionsSidebar state={interactive} />
          </Frame>
          <Frame title="Starred filter active">
            <ChatSessionsSidebar
              state={state({
                sessions: SESSIONS.filter((x) => x.starred),
                showStarredOnly: true,
                currentSessionId: 'd'
              })}
            />
          </Frame>
          <Frame title="Loading">
            <ChatSessionsSidebar state={state({ loading: true })} />
          </Frame>
          <Frame title="Error">
            <ChatSessionsSidebar state={state({ error: 'Network request failed' })} />
          </Frame>
          <Frame title="Empty — no chats yet">
            <ChatSessionsSidebar state={state({ sessions: [] })} />
          </Frame>
          <Frame title="Empty — no results (search)">
            <ChatSessionsSidebar state={state({ sessions: SESSIONS, searchQuery: 'zzzzz' })} />
          </Frame>
          <Frame title="Empty — no starred">
            <ChatSessionsSidebar state={state({ sessions: [], showStarredOnly: true })} />
          </Frame>
        </div>
      </div>
    </div>
  )
}
