// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ChatSession } from '../../../../shared/chatSessions'
import type { UseChatSessions } from '../../hooks/useChatSessions'
import { groupSessionsByDate, filterSessions } from '../../lib/chatSessionsView'
import { ChatSessionsSidebar } from './ChatSessionsSidebar'

function session(over: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    id: over.id,
    title: over.title ?? 'New Chat',
    preview: over.preview,
    createdAt: over.createdAt ?? Date.now(),
    updatedAt: over.updatedAt ?? Date.now(),
    appId: over.appId,
    messageCount: over.messageCount ?? 0,
    starred: over.starred ?? false
  }
}

function makeState(over: Partial<UseChatSessions> = {}): UseChatSessions {
  const sessions = over.sessions ?? []
  const filtered = over.filteredSessions ?? filterSessions(sessions, over.searchQuery ?? '')
  return {
    sessions,
    filteredSessions: filtered,
    groupedSessions: over.groupedSessions ?? groupSessionsByDate(filtered),
    currentSessionId: over.currentSessionId ?? null,
    loading: over.loading ?? false,
    error: over.error ?? null,
    searchQuery: over.searchQuery ?? '',
    showStarredOnly: over.showStarredOnly ?? false,
    setSearchQuery: over.setSearchQuery ?? vi.fn(),
    toggleStarredFilter: over.toggleStarredFilter ?? vi.fn(),
    retryLoad: over.retryLoad ?? vi.fn(),
    selectSession: over.selectSession ?? vi.fn(),
    createNewSession: over.createNewSession ?? vi.fn(async () => null),
    renameSession: over.renameSession ?? vi.fn(async () => {}),
    toggleStar: over.toggleStar ?? vi.fn(async () => {}),
    removeSession: over.removeSession ?? vi.fn(async () => {})
  }
}

afterEach(() => cleanup())

describe('ChatSessionsSidebar — states', () => {
  it('renders the loading state', () => {
    render(<ChatSessionsSidebar state={makeState({ loading: true })} />)
    expect(screen.getByText('Loading chats…')).toBeTruthy()
  })

  it('renders the error state and retries on "Try Again"', () => {
    const retryLoad = vi.fn()
    render(<ChatSessionsSidebar state={makeState({ error: 'network down', retryLoad })} />)
    expect(screen.getByText('Failed to load chats')).toBeTruthy()
    expect(screen.getByText('network down')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(retryLoad).toHaveBeenCalledTimes(1)
  })

  it('renders "No chats yet" on a true-empty list', () => {
    render(<ChatSessionsSidebar state={makeState({ sessions: [] })} />)
    expect(screen.getByText('No chats yet')).toBeTruthy()
  })

  it('renders "No results" when a search matches nothing', () => {
    render(
      <ChatSessionsSidebar
        state={makeState({ sessions: [session({ id: '1', title: 'A' })], searchQuery: 'zzz' })}
      />
    )
    expect(screen.getByText('No results')).toBeTruthy()
  })

  it('renders "No starred chats" when the starred filter is on and empty', () => {
    render(<ChatSessionsSidebar state={makeState({ sessions: [], showStarredOnly: true })} />)
    expect(screen.getByText('No starred chats')).toBeTruthy()
  })
})

describe('ChatSessionsSidebar — list & interactions', () => {
  const two = [
    session({ id: '1', title: 'Berlin trip', starred: true }),
    session({ id: '2', title: 'Groceries' })
  ]

  it('lists sessions under a date-group header', () => {
    render(<ChatSessionsSidebar state={makeState({ sessions: two, currentSessionId: '1' })} />)
    expect(screen.getByText('Berlin trip')).toBeTruthy()
    expect(screen.getByText('Groceries')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
    // Selected row is aria-pressed.
    expect(screen.getByRole('button', { name: /Berlin trip/ }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('selects a session on row click', () => {
    const selectSession = vi.fn()
    render(<ChatSessionsSidebar state={makeState({ sessions: two, selectSession })} />)
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }))
    expect(selectSession).toHaveBeenCalledWith('2')
  })

  it('creates a new chat from the header button', () => {
    const createNewSession = vi.fn(async () => null)
    render(<ChatSessionsSidebar state={makeState({ sessions: two, createNewSession })} />)
    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }))
    expect(createNewSession).toHaveBeenCalledTimes(1)
  })

  it('toggles the starred filter from the header', () => {
    const toggleStarredFilter = vi.fn()
    render(<ChatSessionsSidebar state={makeState({ sessions: two, toggleStarredFilter })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show starred chats only' }))
    expect(toggleStarredFilter).toHaveBeenCalledTimes(1)
  })

  it('stars a session from its row action', () => {
    const toggleStar = vi.fn(async () => {})
    render(<ChatSessionsSidebar state={makeState({ sessions: two, toggleStar })} />)
    // Row 2 ("Groceries") is unstarred → its action is labelled "Star".
    fireEvent.click(screen.getByRole('button', { name: 'Star' }))
    expect(toggleStar).toHaveBeenCalledWith('2')
  })

  it('renames via double-click → type → Enter', () => {
    const renameSession = vi.fn(async () => {})
    render(<ChatSessionsSidebar state={makeState({ sessions: two, renameSession })} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: /Groceries/ }))
    const input = screen.getByLabelText('Rename chat') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Shopping' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameSession).toHaveBeenCalledWith('2', 'Shopping')
  })

  it('confirms via modal before deleting', async () => {
    const removeSession = vi.fn(async () => {})
    render(<ChatSessionsSidebar state={makeState({ sessions: two, removeSession })} />)
    // Open the confirm on row 1's delete action.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    expect(screen.getByText('Delete Chat?')).toBeTruthy()
    expect(
      screen.getByText('This will permanently delete this chat and all its messages.')
    ).toBeTruthy()
    // The modal's own "Delete" confirm button.
    const confirm = screen
      .getAllByRole('button', { name: 'Delete' })
      .find((b) => b.textContent === 'Delete')!
    fireEvent.click(confirm)
    await waitFor(() => expect(removeSession).toHaveBeenCalledWith('1'))
  })
})
