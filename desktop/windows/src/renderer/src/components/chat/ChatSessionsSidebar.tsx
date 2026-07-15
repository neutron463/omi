import { useState } from 'react'
import {
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Search,
  Star,
  TriangleAlert,
  Trash2
} from 'lucide-react'
import type { ChatSession } from '../../../../shared/chatSessions'
import type { UseChatSessions } from '../../hooks/useChatSessions'
import { macPurple } from '../../lib/macPalette'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'

// The chat-sessions sidebar (macOS `ChatSessionsSidebar` port). Gated by the
// `multiChatEnabled` flag at its mount site — when the flag is off this whole
// surface is absent and Windows behaves like today (one shared thread).
//
// State/data live in `useChatSessions`; this component is the view. It accepts
// the hook value as a prop so it renders in tests and the gallery without a live
// backend.
//
// Selected-row tint ports Mac's purple VERBATIM via `macPurple` (the sanctioned
// containment helper — see lib/macPalette.ts), matching the Track 4 conversation
// list. Not a design token, not `--accent` (which Track 5 set to neutral white).
const SELECTED_TINT: React.CSSProperties = {
  backgroundColor: macPurple('0.22'),
  borderColor: macPurple('0.55')
}

/** One session row: title (inline-renamable), hover actions (rename/star/delete),
 *  selected-row tint. */
function SessionRow({
  session,
  selected,
  onSelect,
  onRename,
  onToggleStar,
  onRequestDelete
}: {
  session: ChatSession
  selected: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onToggleStar: () => void
  onRequestDelete: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title ?? '')

  // --- Inline rename: replaces the row button so a click doesn't select. The
  //     empty/unchanged guard also lives in the hook, so a stray commit is a
  //     harmless double no-op. ---
  if (editing) {
    const commit = (): void => {
      onRename(draft)
      setEditing(false)
    }
    return (
      <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
        <input
          autoFocus
          value={draft}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(session.title ?? '')
              setEditing(false)
            }
          }}
          maxLength={120}
          aria-label="Rename chat"
          className="input-field flex-1 py-1 text-sm"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.preventDefault()
        setDraft(session.title ?? '')
        setEditing(true)
      }}
      aria-pressed={selected}
      style={selected ? SELECTED_TINT : undefined}
      className={`group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
        selected ? 'border' : 'border-transparent hover:bg-white/[0.06]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm ${selected ? 'font-semibold text-white' : 'font-medium text-white/85'}`}
        >
          {session.title || 'New Chat'}
        </div>
        {session.preview && (
          <div className="mt-0.5 truncate text-xs text-white/40">{session.preview}</div>
        )}
      </div>

      {/* Hover-revealed actions. The trailing star stays visible when starred
          (a persistent state), the rest reveal on hover/focus. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              setDraft(session.title ?? '')
              setEditing(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                setDraft(session.title ?? '')
                setEditing(true)
              }
            }}
            aria-label="Rename"
            className="rounded-md p-1 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Pencil className="h-3.5 w-3.5" />
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onRequestDelete()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onRequestDelete()
              }
            }}
            aria-label="Delete"
            className="rounded-md p-1 text-white/45 transition-colors hover:bg-white/10 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </span>
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              onToggleStar()
            }
          }}
          aria-label={session.starred ? 'Unstar' : 'Star'}
          className={`rounded-md p-1 transition-colors hover:bg-white/10 ${
            session.starred ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
          }`}
        >
          <Star
            className={`h-3.5 w-3.5 ${session.starred ? 'text-amber-400' : 'text-white/45 hover:text-white/80'}`}
            fill={session.starred ? 'currentColor' : 'none'}
          />
        </span>
      </div>
    </button>
  )
}

/** Compact centered notice for the loading / error / empty states (the shared
 *  page-scale EmptyState is too tall for this narrow column). */
function SidebarNotice({
  icon: Icon,
  title,
  detail,
  action
}: {
  icon: typeof MessageSquare
  title: string
  detail?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <Icon className="h-6 w-6 text-white/35" strokeWidth={1.5} aria-hidden />
      <p className="text-sm font-medium text-white/70">{title}</p>
      {detail && <p className="max-w-[220px] text-xs text-white/40">{detail}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ChatSessionsSidebar({ state }: { state: UseChatSessions }): React.JSX.Element {
  const {
    groupedSessions,
    filteredSessions,
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
  } = state

  // The session pending a delete confirm (Modal is open iff non-null).
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await removeSession(pendingDelete.id)
      setPendingDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const body = (): React.JSX.Element => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner label="Loading chats…" />
        </div>
      )
    }
    if (error) {
      return (
        <SidebarNotice
          icon={TriangleAlert}
          title="Failed to load chats"
          detail={error}
          action={
            <Button size="sm" variant="secondary" onClick={retryLoad}>
              Try Again
            </Button>
          }
        />
      )
    }
    if (filteredSessions.length === 0) {
      if (searchQuery.trim()) {
        return <SidebarNotice icon={Search} title="No results" />
      }
      if (showStarredOnly) {
        return <SidebarNotice icon={Star} title="No starred chats" />
      }
      return (
        <SidebarNotice
          icon={MessageSquare}
          title="No chats yet"
          detail="Start a new chat to see it here."
        />
      )
    }
    return (
      <div className="flex flex-col gap-4">
        {groupedSessions.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/35">
              {group.label}
            </div>
            {group.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                selected={session.id === currentSessionId}
                onSelect={() => selectSession(session.id)}
                onRename={(title) => void renameSession(session.id, title)}
                onToggleStar={() => void toggleStar(session.id)}
                onRequestDelete={() => setPendingDelete(session)}
              />
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col" data-testid="chat-sessions-sidebar">
      {/* Header: New Chat + search + Starred filter. */}
      <div className="flex flex-col gap-2.5 p-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void createNewSession()}
          className="w-full justify-start"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </Button>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35"
              aria-hidden
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="input-field w-full py-1.5 pl-8 pr-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={toggleStarredFilter}
            aria-pressed={showStarredOnly}
            aria-label={showStarredOnly ? 'Show all chats' : 'Show starred chats only'}
            title="Starred"
            className={`focus-ring shrink-0 rounded-[var(--radius-control)] border p-2 transition-colors ${
              showStarredOnly
                ? 'border-amber-400/40 bg-amber-400/10'
                : 'border-white/10 bg-transparent hover:bg-white/5'
            }`}
          >
            <Star
              className={`h-4 w-4 ${showStarredOnly ? 'text-amber-400' : 'text-white/50'}`}
              fill={showStarredOnly ? 'currentColor' : 'none'}
            />
          </button>
        </div>
      </div>

      {/* Scrollable session list. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">{body()}</div>

      {/* Destructive delete confirm (no undo). */}
      <Modal
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete Chat?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
              Delete
            </Button>
          </>
        }
      >
        This will permanently delete this chat and all its messages.
      </Modal>
    </div>
  )
}
