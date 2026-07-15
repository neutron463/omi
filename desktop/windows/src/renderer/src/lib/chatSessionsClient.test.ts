// Data-layer client: request shape + snake↔camel round-trip, and the
// shared-thread continuity guard (the default thread is never sent a
// session_id). `./apiClient` is mocked so no real axios/Firebase loads.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn()
}))

vi.mock('./apiClient', () => ({ omiApi: api }))

import {
  createSession,
  deleteMessages,
  deleteSession,
  getMessages,
  getSession,
  listSessions,
  saveMessage,
  updateSession
} from './chatSessionsClient'

// A representative wire (snake_case) session, as the backend serializes it.
const wireSession = {
  id: 'sess-1',
  title: 'My chat',
  preview: 'last message',
  created_at: '2026-07-14T10:00:00Z',
  updated_at: '2026-07-14T12:00:00Z',
  app_id: null,
  plugin_id: null,
  message_count: 4,
  starred: true
}

beforeEach(() => {
  api.post.mockReset()
  api.get.mockReset()
  api.patch.mockReset()
  api.delete.mockReset()
})

describe('createSession', () => {
  it('POSTs an empty body by default and maps the wire response to camelCase', async () => {
    api.post.mockResolvedValue({ data: wireSession })

    const session = await createSession()

    expect(api.post).toHaveBeenCalledWith('/v2/chat-sessions', {})
    expect(session).toEqual({
      id: 'sess-1',
      title: 'My chat',
      preview: 'last message',
      createdAt: '2026-07-14T10:00:00Z',
      updatedAt: '2026-07-14T12:00:00Z',
      appId: undefined,
      messageCount: 4,
      starred: true
    })
  })

  it('translates camelCase title/appId into the snake_case body', async () => {
    api.post.mockResolvedValue({ data: { ...wireSession, app_id: 'app-x', plugin_id: 'app-x' } })

    const session = await createSession({ title: 'Docs', appId: 'app-x' })

    expect(api.post).toHaveBeenCalledWith('/v2/chat-sessions', { title: 'Docs', app_id: 'app-x' })
    expect(session.appId).toBe('app-x')
  })
})

describe('listSessions', () => {
  it('sends NO query params by default (→ main-chat sessions only)', async () => {
    api.get.mockResolvedValue({ data: [wireSession] })

    const sessions = await listSessions()

    expect(api.get).toHaveBeenCalledWith('/v2/chat-sessions', { params: {} })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('sess-1')
  })

  it('forwards starred/appId/limit/offset filters as snake_case query params', async () => {
    api.get.mockResolvedValue({ data: [] })

    await listSessions({ appId: 'app-x', starred: true, limit: 20, offset: 40 })

    expect(api.get).toHaveBeenCalledWith('/v2/chat-sessions', {
      params: { app_id: 'app-x', starred: true, limit: 20, offset: 40 }
    })
  })
})

describe('getSession', () => {
  it('GETs by id and maps the response', async () => {
    api.get.mockResolvedValue({ data: wireSession })
    const s = await getSession('sess-1')
    expect(api.get).toHaveBeenCalledWith('/v2/chat-sessions/sess-1')
    expect(s.starred).toBe(true)
  })
})

describe('updateSession', () => {
  it('PATCHes only the title on a rename', async () => {
    api.patch.mockResolvedValue({ data: { ...wireSession, title: 'Renamed' } })

    const s = await updateSession('sess-1', { title: 'Renamed' })

    expect(api.patch).toHaveBeenCalledWith('/v2/chat-sessions/sess-1', { title: 'Renamed' })
    expect(s.title).toBe('Renamed')
  })

  it('PATCHes only starred on a star toggle', async () => {
    api.patch.mockResolvedValue({ data: { ...wireSession, starred: false } })

    await updateSession('sess-1', { starred: false })

    expect(api.patch).toHaveBeenCalledWith('/v2/chat-sessions/sess-1', { starred: false })
  })
})

describe('deleteSession', () => {
  it('DELETEs by id (server cascades messages)', async () => {
    api.delete.mockResolvedValue({ data: { status: 'ok' } })
    await deleteSession('sess-1')
    expect(api.delete).toHaveBeenCalledWith('/v2/chat-sessions/sess-1')
  })
})

describe('saveMessage — shared-thread continuity guard', () => {
  const ack = {
    data: { id: 'msg-1', created_at: '2026-07-14T12:00:00Z', session_id: null, created: true }
  }

  it('OMITS session_id and app_id when writing to the default shared thread', async () => {
    api.post.mockResolvedValue(ack)

    const res = await saveMessage({ text: 'hello', sender: 'human' })

    const [, body] = api.post.mock.calls[0]
    expect(api.post).toHaveBeenCalledWith('/v2/desktop/messages', { text: 'hello', sender: 'human' })
    // The guard: no session/app key at all on the default-thread write.
    expect('session_id' in body).toBe(false)
    expect('app_id' in body).toBe(false)
    expect(res).toEqual({
      id: 'msg-1',
      createdAt: '2026-07-14T12:00:00Z',
      sessionId: undefined,
      created: true
    })
  })

  it('INCLUDES session_id only when the caller explicitly targets a desktop-local session', async () => {
    api.post.mockResolvedValue({ ...ack, data: { ...ack.data, session_id: 'sess-9' } })

    await saveMessage({
      text: 'hi',
      sender: 'human',
      sessionId: 'sess-9',
      clientMessageId: 'cid-1',
      messageSource: 'desktop_chat',
      metadata: '{"resources":[]}'
    })

    expect(api.post).toHaveBeenCalledWith('/v2/desktop/messages', {
      text: 'hi',
      sender: 'human',
      session_id: 'sess-9',
      client_message_id: 'cid-1',
      message_source: 'desktop_chat',
      metadata: '{"resources":[]}'
    })
  })
})

describe('getMessages / deleteMessages', () => {
  it('GETs the default thread with no session param and maps chat_session_id → sessionId', async () => {
    api.get.mockResolvedValue({
      data: [
        {
          id: 'm1',
          text: 'hey',
          created_at: '2026-07-14T12:00:00Z',
          sender: 'human',
          app_id: null,
          chat_session_id: null,
          rating: null
        }
      ]
    })

    const msgs = await getMessages()

    expect(api.get).toHaveBeenCalledWith('/v2/desktop/messages', { params: {} })
    expect(msgs[0]).toEqual({
      id: 'm1',
      text: 'hey',
      createdAt: '2026-07-14T12:00:00Z',
      sender: 'human',
      appId: undefined,
      sessionId: undefined,
      rating: undefined
    })
  })

  it('DELETEs a session thread and returns the deleted count', async () => {
    api.delete.mockResolvedValue({ data: { status: 'ok', deleted_count: 7 } })

    const count = await deleteMessages({ sessionId: 'sess-9' })

    expect(api.delete).toHaveBeenCalledWith('/v2/desktop/messages', {
      params: { session_id: 'sess-9' }
    })
    expect(count).toBe(7)
  })
})
