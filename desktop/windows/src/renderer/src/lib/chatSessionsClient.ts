// Data-layer client for v2 chat sessions + desktop message persistence.
//
// Wraps the backend contract in `backend/routers/chat_sessions.py`
// (`/v2/chat-sessions[/{id}]` and the persistence-only `/v2/desktop/messages`)
// and owns the snake_case↔camelCase translation that `src/shared/chatSessions.ts`
// documents as deferred to this layer. Built on the shared `omiApi` axios
// instance (VITE_OMI_API_BASE — the same Python backend `useChat` streams
// `/v2/messages` from), so auth, platform headers, and 401/429 retry come for
// free.
//
// SHARED-THREAD CONTINUITY (do not break): the default shared thread — the one
// mobile/web read via `/v2/messages` — is the `plugin_id == None` / no-session
// thread. `saveMessage` OMITS `session_id` (and `app_id`) from the request body
// unless the caller explicitly targets a desktop-local session. A non-null
// `session_id` writes to a desktop-local sidebar thread that mobile's
// `/v2/messages` does NOT see. See `chatSessions.test.ts` for the guard.

import { omiApi } from './apiClient'
import type {
  ChatSession,
  CreateChatSessionRequest,
  SaveDesktopMessageRequest,
  SaveDesktopMessageResponse,
  UpdateChatSessionRequest
} from '../../../shared/chatSessions'

// ---------------------------------------------------------------------------
// Wire shapes (snake_case, exactly as the backend serializes them). Kept local:
// the rest of the app consumes only the camelCase `ChatSession` etc.
// ---------------------------------------------------------------------------

interface ChatSessionWire {
  id: string
  title: string
  preview?: string | null
  created_at: string
  updated_at: string
  app_id?: string | null
  // Backend also echoes `plugin_id` (mirror of app_id) — redundant, ignored.
  plugin_id?: string | null
  message_count: number
  starred: boolean
}

interface SaveMessageResponseWire {
  id: string
  created_at: string
  session_id?: string | null
  created: boolean
}

interface DeleteMessagesResponseWire {
  status: string
  deleted_count: number
}

interface MessageWire {
  id: string
  text: string
  created_at: string
  sender: string
  app_id?: string | null
  chat_session_id?: string | null
  rating?: number | null
}

// ---------------------------------------------------------------------------
// Translators (wire → camelCase). The only place snake_case leaks in.
// ---------------------------------------------------------------------------

function toChatSession(w: ChatSessionWire): ChatSession {
  return {
    id: w.id,
    title: w.title,
    preview: w.preview ?? undefined,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    appId: w.app_id ?? undefined,
    messageCount: w.message_count,
    starred: w.starred
  }
}

/** A persisted chat message (camelCase projection of the backend `Message`). */
export interface DesktopMessage {
  id: string
  text: string
  createdAt: string
  sender: string
  appId?: string
  sessionId?: string
  rating?: number
}

function toDesktopMessage(w: MessageWire): DesktopMessage {
  return {
    id: w.id,
    text: w.text,
    createdAt: w.created_at,
    sender: w.sender,
    appId: w.app_id ?? undefined,
    sessionId: w.chat_session_id ?? undefined,
    rating: w.rating ?? undefined
  }
}

// ---------------------------------------------------------------------------
// Chat-session endpoints
// ---------------------------------------------------------------------------

/** Filters for `GET /v2/chat-sessions`. Omit `appId` for main-chat sessions
 *  (backend filters `plugin_id == app_id`, so `app_id=None` → main chat only).
 *  Results are always ordered `updated_at DESC` server-side. */
export interface ListSessionsParams {
  appId?: string
  starred?: boolean
  limit?: number
  offset?: number
}

/** `POST /v2/chat-sessions`. Backend defaults title→"New Chat", starred→false,
 *  messageCount→0. `appId` is omitted from the body when absent (main chat). */
export async function createSession(req: CreateChatSessionRequest = {}): Promise<ChatSession> {
  const body: Record<string, unknown> = {}
  if (req.title !== undefined) body.title = req.title
  if (req.appId !== undefined) body.app_id = req.appId
  const res = await omiApi.post<ChatSessionWire>('/v2/chat-sessions', body)
  return toChatSession(res.data)
}

/** `GET /v2/chat-sessions` — ordered `updated_at DESC`. Only sends the query
 *  params the caller set, so the default call fetches main-chat sessions. */
export async function listSessions(params: ListSessionsParams = {}): Promise<ChatSession[]> {
  const query: Record<string, string | number | boolean> = {}
  if (params.appId !== undefined) query.app_id = params.appId
  if (params.starred !== undefined) query.starred = params.starred
  if (params.limit !== undefined) query.limit = params.limit
  if (params.offset !== undefined) query.offset = params.offset
  const res = await omiApi.get<ChatSessionWire[]>('/v2/chat-sessions', { params: query })
  return res.data.map(toChatSession)
}

/** `GET /v2/chat-sessions/{id}`. */
export async function getSession(id: string): Promise<ChatSession> {
  const res = await omiApi.get<ChatSessionWire>(`/v2/chat-sessions/${encodeURIComponent(id)}`)
  return toChatSession(res.data)
}

/** `PATCH /v2/chat-sessions/{id}` — rename (`title`) or star toggle (`starred`).
 *  Only the fields present in `patch` are sent. */
export async function updateSession(
  id: string,
  patch: UpdateChatSessionRequest
): Promise<ChatSession> {
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.starred !== undefined) body.starred = patch.starred
  const res = await omiApi.patch<ChatSessionWire>(
    `/v2/chat-sessions/${encodeURIComponent(id)}`,
    body
  )
  return toChatSession(res.data)
}

/** `DELETE /v2/chat-sessions/{id}` — server cascades `cascade_messages=true`
 *  (deletes every message in the session). Destructive, no undo. */
export async function deleteSession(id: string): Promise<void> {
  await omiApi.delete(`/v2/chat-sessions/${encodeURIComponent(id)}`)
}

// ---------------------------------------------------------------------------
// Desktop message-persistence endpoints (persistence only — no LLM streaming;
// that lives in `useChat`'s `/v2/messages`).
// ---------------------------------------------------------------------------

/**
 * `POST /v2/desktop/messages` — persist one message.
 *
 * CONTINUITY GUARD: `sessionId`/`appId` are included in the body ONLY when the
 * caller sets them. Omitting them writes to the default shared thread that
 * mobile/web see; a non-null `sessionId` targets a desktop-local session.
 */
export async function saveMessage(
  req: SaveDesktopMessageRequest
): Promise<SaveDesktopMessageResponse> {
  const body: Record<string, unknown> = { text: req.text, sender: req.sender }
  if (req.appId !== undefined) body.app_id = req.appId
  if (req.sessionId !== undefined) body.session_id = req.sessionId
  if (req.clientMessageId !== undefined) body.client_message_id = req.clientMessageId
  if (req.messageSource !== undefined) body.message_source = req.messageSource
  // `metadata` is a JSON-serialized STRING on the wire (see the shared type).
  if (req.metadata !== undefined) body.metadata = req.metadata
  const res = await omiApi.post<SaveMessageResponseWire>('/v2/desktop/messages', body)
  return {
    id: res.data.id,
    createdAt: res.data.created_at,
    sessionId: res.data.session_id ?? undefined,
    created: res.data.created
  }
}

/** Filters for `GET`/`DELETE /v2/desktop/messages`. Omit `sessionId` for the
 *  default shared thread. */
export interface MessageQuery {
  appId?: string
  sessionId?: string
  limit?: number
  offset?: number
}

/** `GET /v2/desktop/messages` — the session's persisted messages. */
export async function getMessages(query: MessageQuery = {}): Promise<DesktopMessage[]> {
  const params: Record<string, string | number> = {}
  if (query.appId !== undefined) params.app_id = query.appId
  if (query.sessionId !== undefined) params.session_id = query.sessionId
  if (query.limit !== undefined) params.limit = query.limit
  if (query.offset !== undefined) params.offset = query.offset
  const res = await omiApi.get<MessageWire[]>('/v2/desktop/messages', { params })
  return res.data.map(toDesktopMessage)
}

/** `DELETE /v2/desktop/messages` — bulk-delete a thread's messages; returns the
 *  deleted count. */
export async function deleteMessages(query: MessageQuery = {}): Promise<number> {
  const params: Record<string, string> = {}
  if (query.appId !== undefined) params.app_id = query.appId
  if (query.sessionId !== undefined) params.session_id = query.sessionId
  const res = await omiApi.delete<DeleteMessagesResponseWire>('/v2/desktop/messages', { params })
  return res.data.deleted_count
}
