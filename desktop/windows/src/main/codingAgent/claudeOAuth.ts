// Claude Code sign-in — the Windows port of macOS's agent/src/oauth-flow.ts.
// Reimplements the PKCE + loopback flow the Claude Code CLI uses, so a
// fresh-install user can authenticate the built-in Claude Code agent from
// inside Omi (no CLI install, no manual `claude /login`).
//
// This module is deliberately Electron-free (node builtins + global `fetch`
// only) so the URL builder/validator, token-exchange request shape, and the
// credentials-file merge logic are all unit-testable under node Vitest. The
// browser-open + IPC glue lives in ../ipc/codingAgent.ts.
//
// Credential storage: the @anthropic-ai/claude-agent-sdk (pinned in
// node_modules) reads `<CLAUDE_CONFIG_DIR or ~/.claude>/.credentials.json` with
// the shape `{ claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes } }`
// (verified against sdk.mjs) and self-refreshes from the stored refresh token —
// Omi never refreshes. We write that file directly (the SDK-native path, same
// as the Claude Code CLI itself), not macOS's Keychain, and we MERGE so any
// other top-level keys (e.g. `mcpOAuth`) and extra `claudeAiOauth` subkeys the
// SDK maintains (`subscriptionType`, `rateLimitTier`, `refreshTokenExpiresAt`)
// survive a re-sign-in. `expiresAt` is stored as epoch milliseconds (a NUMBER),
// matching the real on-disk file the SDK produces — a deliberate, verified
// deviation from the macOS port, which wrote an ISO string.
//
// ── OAuth endpoints: DO NOT "fix" these back to claude.ai / console.anthropic ──
// Anthropic migrated the Claude-subscription OAuth endpoints. The endpoints
// below are extracted VERBATIM from the exact CLI + SDK this app bundles and
// runs — `@anthropic-ai/claude-agent-sdk` 0.3.205 / `claude.exe` (Claude Code
// 2.1.205, build 4cf2699a, 2026-07-08), the same binary the SDK spawns:
//
//   CLAUDE_AI_AUTHORIZE_URL : https://claude.com/cai/oauth/authorize   (subscription)
//   TOKEN_URL               : https://platform.claude.com/v1/oauth/token
//   CLAUDEAI_SUCCESS_URL    : https://platform.claude.com/oauth/code/success?app=claude-code
//   CLIENT_ID               : 9d1c250a-e61b-44d9-88ed-5944d1962f5e
//   scopes (subscription)   : user:profile user:inference user:sessions:claude_code
//                             user:mcp_servers user:file_upload
//   token headers           : Content-Type: application/json + anthropic-beta: oauth-2025-04-20
//
// The retired `https://claude.ai/oauth/authorize` endpoint still RENDERS a
// consent screen, but its issuance backend now rejects the request with
// "Invalid request format" the moment the user clicks Authorize (no code is
// ever issued, the loopback callback never fires). `CLAUDE_AI_ORIGIN` in the
// SDK is still "https://claude.ai" — building the URL as
// `${origin}/oauth/authorize` is the trap that produced the stale endpoint.
// The real authorize URL is a distinct constant on the claude.com host.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { generateVerifier, challengeFromVerifier, generateState } from '../integrations/oauthPkce'

// --- Constants (extracted from the bundled Claude Code CLI / SDK; see header) ---

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize'
const AUTHORIZE_HOST = 'claude.com'
const AUTHORIZE_PATH = '/cai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const SUCCESS_URL = 'https://platform.claude.com/oauth/code/success?app=claude-code'
// The exact claude.ai subscription scope set the real Claude Code CLI requests
// (SDK constant `A5`, in order). `org:create_api_key` is the Console/API-key
// flow scope and is correctly excluded — it throws "Unknown scope" for a
// Max-subscription consent. A single `user:inference` is accepted for the
// consent screen but rejected at code-issuance, so the full set is required.
const SCOPES =
  'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
// Beta gate the platform.claude.com token endpoint expects (SDK sends this on
// every /v1/oauth/token call, including token refresh).
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const TOKEN_EXPIRY_SECONDS = 31536000 // 1 year
const CALLBACK_TIMEOUT_MS = 2 * 60 * 1000

// --- Credential file location + shape ---

/** The Claude config dir the SDK reads — `CLAUDE_CONFIG_DIR` or `~/.claude`. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

/** Absolute path to the credentials file the SDK reads/writes. */
export function claudeCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDir(env), '.credentials.json')
}

export interface ClaudeAiOauth {
  accessToken: string
  refreshToken?: string | null
  /** Epoch milliseconds (number), matching the SDK-native on-disk format. */
  expiresAt?: number | null
  scopes: string[]
  // The SDK may add subscriptionType / rateLimitTier / refreshTokenExpiresAt;
  // we never drop them (merge preserves unknown keys).
  [extra: string]: unknown
}

/** Parse the whole credentials file (all top-level keys), or null if absent. */
function readCredentialsFile(env: NodeJS.ProcessEnv): Record<string, unknown> | null {
  try {
    const raw = readFileSync(claudeCredentialsPath(env), 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    // Missing file / unreadable / malformed — treat as no credentials.
    return null
  }
}

/** The stored `claudeAiOauth` block, or null when not signed in. */
export function readClaudeOauth(env: NodeJS.ProcessEnv = process.env): ClaudeAiOauth | null {
  const file = readCredentialsFile(env)
  const oauth = file?.claudeAiOauth
  if (!oauth || typeof oauth !== 'object') return null
  const o = oauth as ClaudeAiOauth
  return typeof o.accessToken === 'string' && o.accessToken ? o : null
}

export interface ClaudeAuthStatus {
  connected: boolean
  /** Epoch ms of access-token expiry, when known. */
  expiresAt: number | null
}

/**
 * Whether Claude Code has usable credentials. A stored refresh token counts as
 * connected even past the access token's expiry, because the SDK self-refreshes;
 * we only report disconnected when there is no access token, or the access token
 * is expired with no refresh token to renew it.
 */
export function claudeAuthStatus(env: NodeJS.ProcessEnv = process.env): ClaudeAuthStatus {
  const oauth = readClaudeOauth(env)
  if (!oauth) return { connected: false, expiresAt: null }
  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null
  const hasRefresh = typeof oauth.refreshToken === 'string' && oauth.refreshToken.length > 0
  const unexpired = expiresAt === null || expiresAt > Date.now()
  return { connected: hasRefresh || unexpired, expiresAt }
}

/**
 * Persist a `claudeAiOauth` block, preserving every other top-level key and any
 * extra subkeys the SDK maintains. Never clobbers `mcpOAuth` or other content.
 */
export function writeClaudeCredentials(
  oauth: ClaudeAiOauth,
  env: NodeJS.ProcessEnv = process.env
): void {
  const existing = readCredentialsFile(env) ?? {}
  const priorOauth =
    existing.claudeAiOauth && typeof existing.claudeAiOauth === 'object'
      ? (existing.claudeAiOauth as Record<string, unknown>)
      : {}
  const merged = { ...existing, claudeAiOauth: { ...priorOauth, ...oauth } }
  const path = claudeCredentialsPath(env)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(merged, null, 2), { mode: 0o600 })
}

/**
 * Sign out: drop only the `claudeAiOauth` key, preserving the rest of the file
 * (e.g. `mcpOAuth`). No-op when there is no credentials file.
 */
export function removeClaudeCredentials(env: NodeJS.ProcessEnv = process.env): void {
  const existing = readCredentialsFile(env)
  if (!existing || !('claudeAiOauth' in existing)) return
  const next = { ...existing }
  delete next.claudeAiOauth
  writeFileSync(claudeCredentialsPath(env), JSON.stringify(next, null, 2), { mode: 0o600 })
}

// --- Authorization URL (build + validate) ---

/** Build the Claude subscription authorize URL for a PKCE loopback attempt. */
export function buildClaudeAuthUrl(params: {
  redirectUri: string
  challenge: string
  state: string
}): string {
  const url = new URL(AUTHORIZE_URL)
  // Do NOT set `code=true`. That flag selects the manual/headless copy-paste
  // response format (redirect to platform.claude.com/oauth/code/callback where
  // the user pastes `code#state` back). The loopback flow the CLI runs for a
  // desktop with a browser omits it; sending it WITH a localhost redirect_uri
  // makes the authorize request "Invalid request format".
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.state)
  return url.toString()
}

/**
 * Validate a Claude OAuth authorize URL before opening it in the browser —
 * port of macOS ChatProvider.validatedClaudeOAuthURL. Returns the parsed URL
 * when it is exactly an https://claude.com/cai/oauth/authorize PKCE request with
 * a localhost loopback redirect, else null. Guards against opening an attacker-
 * substituted URL.
 */
export function validateClaudeOAuthUrl(urlString: string | null | undefined): URL | null {
  if (!urlString) return null
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== AUTHORIZE_HOST ||
    url.port !== '' ||
    url.pathname !== AUTHORIZE_PATH ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    return null
  }

  // Exactly one non-empty value for each required query param.
  const singleValue = (name: string): string | null => {
    const all = url.searchParams.getAll(name)
    if (all.length !== 1) return null
    const value = all[0]
    return value && value.length > 0 ? value : null
  }
  if (
    singleValue('response_type') !== 'code' ||
    singleValue('client_id') === null ||
    singleValue('state') === null ||
    singleValue('code_challenge') === null ||
    singleValue('code_challenge_method') !== 'S256'
  ) {
    return null
  }
  const redirect = singleValue('redirect_uri')
  if (!redirect) return null
  let redirectUrl: URL
  try {
    redirectUrl = new URL(redirect)
  } catch {
    return null
  }
  if (
    redirectUrl.protocol !== 'http:' ||
    redirectUrl.hostname.toLowerCase() !== 'localhost' ||
    redirectUrl.port === '' ||
    redirectUrl.pathname !== '/callback'
  ) {
    return null
  }
  return url
}

/**
 * A fresh bridge/flow-issued authorize URL represents a new OAuth attempt (e.g.
 * after the bounded callback timeout), so the one-launch-per-attempt browser
 * latch may reset. Same URL = same in-flight flow = do not relaunch.
 * Port of macOS ChatProvider.isNewClaudeOAuthAttempt.
 */
export function isNewClaudeOAuthAttempt(
  previousAuthUrl: string | null | undefined,
  nextAuthUrl: string | null | undefined
): boolean {
  return previousAuthUrl !== nextAuthUrl
}

// --- Token exchange ---

export interface ClaudeOAuthResult {
  accessToken: string
  refreshToken?: string | null
  /** Epoch milliseconds, when the token response carried an expiry. */
  expiresAt: number | null
  scopes: string[]
}

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

/**
 * Exchange an authorization code for tokens at the Claude token endpoint
 * (`platform.claude.com/v1/oauth/token`). Body + headers mirror the SDK's own
 * proven call to this endpoint: a JSON body carrying the PKCE `code_verifier`
 * and echoed `state`, plus the `anthropic-beta: oauth-2025-04-20` gate. Uses
 * global `fetch` so it can be tested against a local mock.
 */
export async function exchangeClaudeCodeForToken(
  code: string,
  codeVerifier: string,
  state: string,
  redirectUri: string,
  tokenUrl: string = TOKEN_URL
): Promise<ClaudeOAuthResult> {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-beta': OAUTH_BETA_HEADER
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
      state,
      expires_in: TOKEN_EXPIRY_SECONDS
    })
  })
  if (res.status === 401) {
    throw new Error('Authentication failed: invalid authorization code')
  }
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`)
  }
  const data = (await res.json()) as RawTokenResponse
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : null,
    scopes: (data.scope || SCOPES).split(' ')
  }
}

// --- Loopback flow ---

export interface ClaudeOAuthFlowHandle {
  /** URL to validate + open in the browser. */
  authUrl: string
  /** Resolves once the callback is received, code exchanged, and creds written. */
  complete: Promise<ClaudeOAuthResult>
  /** Cancel: close the callback server and reject `complete`. */
  cancel: () => void
}

function startCallbackServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    // localhost (not 127.0.0.1) so the redirect_uri host matches the validator.
    server.listen(0, 'localhost', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get callback server address'))
        return
      }
      resolve({ server, port: addr.port })
    })
  })
}

function waitForCallback(
  server: Server,
  expectedState: string,
  logErr: (msg: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Claude sign-in timed out (2 minutes). Try again.'))
      server.close()
    }, CALLBACK_TIMEOUT_MS)

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const parsed = new URL(req.url || '', 'http://localhost')
      if (parsed.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not Found')
        return
      }
      const code = parsed.searchParams.get('code')
      const state = parsed.searchParams.get('state')
      if (!code) {
        res.writeHead(400)
        res.end('Authorization code not found')
        clearTimeout(timeout)
        reject(new Error('No authorization code received'))
        return
      }
      if (state !== expectedState) {
        res.writeHead(400)
        res.end('Invalid state parameter')
        clearTimeout(timeout)
        reject(new Error('OAuth state mismatch'))
        return
      }
      logErr('Claude OAuth callback received with valid code')
      res.writeHead(302, { Location: SUCCESS_URL })
      res.end()
      clearTimeout(timeout)
      resolve(code)
    })
  })
}

/**
 * Start the loopback OAuth flow. Returns the authorize URL for the caller to
 * validate + open, and a promise that resolves after the callback lands, the
 * code is exchanged, and credentials are written. The caller opens the browser
 * (mirrors macOS: the bridge builds the URL, the UI opens it).
 */
export async function startClaudeOAuthFlow(
  logErr: (msg: string) => void,
  env: NodeJS.ProcessEnv = process.env
): Promise<ClaudeOAuthFlowHandle> {
  const codeVerifier = generateVerifier()
  const codeChallenge = challengeFromVerifier(codeVerifier)
  const state = generateState()

  const { server, port } = await startCallbackServer()
  logErr(`Claude OAuth callback server listening on port ${port}`)
  const redirectUri = `http://localhost:${port}/callback`
  const authUrl = buildClaudeAuthUrl({ redirectUri, challenge: codeChallenge, state })

  let cancelled = false
  let cancelReject: ((err: Error) => void) | null = null

  const complete = new Promise<ClaudeOAuthResult>((resolve, reject) => {
    cancelReject = reject
    waitForCallback(server, state, logErr)
      .then(async (code) => {
        if (cancelled) return
        logErr('Exchanging Claude authorization code for tokens...')
        const tokens = await exchangeClaudeCodeForToken(code, codeVerifier, state, redirectUri)
        writeClaudeCredentials(
          {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? null,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes
          },
          env
        )
        logErr('Claude credentials written')
        resolve(tokens)
      })
      .catch((err) => {
        if (!cancelled) reject(err)
      })
      .finally(() => {
        server.close()
      })
  })

  return {
    authUrl,
    complete,
    cancel: () => {
      cancelled = true
      server.close()
      cancelReject?.(new Error('Claude sign-in cancelled'))
    }
  }
}
