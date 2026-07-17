// Claude Code sign-in — matches the real Claude Code CLI's subscription login.
// A fresh-install user can authenticate the built-in Claude Code agent from
// inside Omi (no CLI install, no manual `claude /login`).
//
// This module is deliberately Electron-free (node builtins + global `fetch`
// only) so the URL builder/validator, code parser, token-exchange request
// shape, and the credentials-file merge logic are all unit-testable under node
// Vitest. The browser-open + IPC glue lives in ../ipc/codingAgent.ts.
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
// matching the real on-disk file the SDK produces.
//
// ── This is the MANUAL flow, not a localhost loopback. Do not "restore" loopback ──
// Every value below was captured VERBATIM from the exact CLI this app bundles
// and spawns — `claude auth login --claudeai` in `@anthropic-ai/claude-agent-sdk`
// 0.3.205 / `claude.exe` 2.1.205 (build 4cf2699a). The captured authorize URL:
//
//   https://claude.com/cai/oauth/authorize
//     ?code=true
//     &client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e
//     &response_type=code
//     &redirect_uri=https://platform.claude.com/oauth/code/callback
//     &scope=org:create_api_key user:profile user:inference
//            user:sessions:claude_code user:mcp_servers user:file_upload
//     &code_challenge=<S256>&code_challenge_method=S256&state=<...>
//
// The Claude OAuth client (9d1c250a) does NOT accept a `http://localhost:PORT/
// callback` redirect — sending one is exactly what makes claude.ai reject the
// request with "Invalid request format" the instant the user clicks Authorize.
// The only redirect it accepts is the fixed `platform.claude.com/oauth/code/
// callback`, which renders the authorization code as a `<code>#<state>` string
// for the user to copy back into the app (the CLI's "Paste code here" step).
// The prior loopback port (and the macOS `agent/src/oauth-flow.ts` it copied)
// were a stale best-effort reimplementation, not the CLI's real flow.

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { generateVerifier, challengeFromVerifier, generateState } from '../integrations/oauthPkce'

// --- Constants (captured from the bundled Claude Code CLI; see header) ---

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize'
const AUTHORIZE_HOST = 'claude.com'
const AUTHORIZE_PATH = '/cai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
// The single fixed redirect the Claude client accepts. Not a loopback — the
// authorization code is shown to the user on this page for copy/paste.
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
// The exact scope set + order the real CLI requests, INCLUDING org:create_api_key
// (the CLI sends it first). Serialized with `+` for spaces, matching the CLI.
const SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
// Beta gate the platform.claude.com token endpoint expects (the SDK sends this
// on every /v1/oauth/token call, including token refresh).
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const TOKEN_EXPIRY_SECONDS = 31536000 // 1 year

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

/**
 * Build the Claude subscription authorize URL — the manual (copy-paste) flow the
 * real CLI uses. `redirect_uri` is the fixed platform.claude.com callback (not a
 * loopback); the user copies the resulting code back into the app.
 */
export function buildClaudeAuthUrl(params: { challenge: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL)
  // `code=true` selects the manual response format the client requires. (The
  // client rejects a localhost redirect, so there is no loopback alternative.)
  url.searchParams.set('code', 'true')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.state)
  return url.toString()
}

/**
 * Validate a Claude OAuth authorize URL before opening it in the browser.
 * Returns the parsed URL when it is exactly our claude.com/cai PKCE request with
 * the fixed platform.claude.com redirect, else null. Guards against opening an
 * attacker-substituted URL (in particular, one that would send the code to a
 * redirect we don't control).
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
  // The redirect must be exactly the fixed platform.claude.com callback — never
  // open a request that could deliver the code anywhere else.
  if (singleValue('redirect_uri') !== REDIRECT_URI) return null
  return url
}

/**
 * A fresh flow-issued authorize URL represents a new OAuth attempt, so the
 * one-launch-per-attempt browser latch may reset. Same URL = same in-flight flow
 * = do not relaunch.
 */
export function isNewClaudeOAuthAttempt(
  previousAuthUrl: string | null | undefined,
  nextAuthUrl: string | null | undefined
): boolean {
  return previousAuthUrl !== nextAuthUrl
}

// --- Pasted-code parsing ---

export interface ParsedClaudeAuthCode {
  code: string
  /** State segment when present (`code#state`), else null. */
  state: string | null
}

/**
 * Parse what the user copied from the platform.claude.com callback page. Accepts
 * the `code#state` string Anthropic renders, a bare code, or the full callback
 * URL (if the user pastes the address bar). Returns null when no code is found.
 */
export function parseClaudeAuthCode(input: string | null | undefined): ParsedClaudeAuthCode | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  // Full callback URL pasted from the address bar: read the query params.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      const code = u.searchParams.get('code')
      if (!code) return null
      return { code, state: u.searchParams.get('state') }
    } catch {
      return null
    }
  }
  // Otherwise it's the "code#state" string shown for manual entry.
  const hashIdx = trimmed.indexOf('#')
  if (hashIdx >= 0) {
    const code = trimmed.slice(0, hashIdx).trim()
    const state = trimmed.slice(hashIdx + 1).trim()
    return code ? { code, state: state || null } : null
  }
  return { code: trimmed, state: null }
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
 * proven call to this endpoint: a JSON body carrying the PKCE `code_verifier`,
 * the fixed `redirect_uri`, and the echoed `state`, plus the
 * `anthropic-beta: oauth-2025-04-20` gate. Uses global `fetch` so it can be
 * tested against a local mock.
 */
export async function exchangeClaudeCodeForToken(
  code: string,
  codeVerifier: string,
  state: string,
  redirectUri: string = REDIRECT_URI,
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

// --- Manual flow ---

export interface ClaudeOAuthFlowHandle {
  /** URL to validate + open in the browser. */
  authUrl: string
  /**
   * Complete the flow with what the user copied from the callback page. Parses
   * the code (+ optional state), verifies state, exchanges it for tokens, and
   * writes credentials. Rejects on a bad code, state mismatch, or exchange error.
   */
  submitCode: (pastedInput: string) => Promise<ClaudeOAuthResult>
  /** Cancel: no-op teardown (no server to close). */
  cancel: () => void
}

/**
 * Start the manual OAuth flow. Returns the authorize URL for the caller to
 * validate + open, plus `submitCode` to finish once the user pastes the code the
 * browser shows. There is no callback server — the Claude client only supports
 * the fixed platform.claude.com redirect, so the code comes back via copy/paste
 * (or, in a future in-app browser, by intercepting that redirect and calling
 * `submitCode` with the URL).
 */
export async function startClaudeOAuthFlow(
  logErr: (msg: string) => void,
  env: NodeJS.ProcessEnv = process.env
): Promise<ClaudeOAuthFlowHandle> {
  const codeVerifier = generateVerifier()
  const codeChallenge = challengeFromVerifier(codeVerifier)
  const state = generateState()
  const authUrl = buildClaudeAuthUrl({ challenge: codeChallenge, state })
  let done = false

  return {
    authUrl,
    submitCode: async (pastedInput: string): Promise<ClaudeOAuthResult> => {
      if (done) throw new Error('Claude sign-in already completed')
      const parsed = parseClaudeAuthCode(pastedInput)
      if (!parsed) {
        throw new Error('Could not read the code. Copy the full code shown after you approve.')
      }
      if (parsed.state && parsed.state !== state) {
        throw new Error('OAuth state mismatch')
      }
      logErr('Exchanging pasted Claude authorization code for tokens...')
      const tokens = await exchangeClaudeCodeForToken(parsed.code, codeVerifier, state)
      writeClaudeCredentials(
        {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          expiresAt: tokens.expiresAt,
          scopes: tokens.scopes
        },
        env
      )
      done = true
      logErr('Claude credentials written')
      return tokens
    },
    cancel: () => {
      done = true
    }
  }
}
