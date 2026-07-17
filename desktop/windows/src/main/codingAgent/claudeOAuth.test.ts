import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildClaudeAuthUrl,
  validateClaudeOAuthUrl,
  isNewClaudeOAuthAttempt,
  parseClaudeAuthCode,
  exchangeClaudeCodeForToken,
  startClaudeOAuthFlow,
  writeClaudeCredentials,
  removeClaudeCredentials,
  readClaudeOauth,
  claudeAuthStatus,
  claudeCredentialsPath
} from './claudeOAuth'

// The exact scope set + order the real CLI requests (org:create_api_key first).
const EXPECTED_SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
// The single fixed redirect the Claude client accepts (manual flow — not loopback).
const REDIRECT = 'https://platform.claude.com/oauth/code/callback'

const tempDirs: string[] = []
function tempConfigEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'omi-claude-oauth-'))
  tempDirs.push(dir)
  return { CLAUDE_CONFIG_DIR: dir } as NodeJS.ProcessEnv
}

afterEach(() => {
  vi.unstubAllGlobals()
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

// A valid authorize URL on the LIVE endpoint, matching what buildClaudeAuthUrl
// emits (claude.com/cai/oauth/authorize + the fixed platform.claude.com redirect).
const VALID_URL =
  `https://claude.com/cai/oauth/authorize?code=true&response_type=code&client_id=test-client` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=test-state&code_challenge=test-challenge&code_challenge_method=S256`

describe('buildClaudeAuthUrl', () => {
  it('emits the CLI-exact claude.com/cai manual-flow authorize URL', () => {
    const url = buildClaudeAuthUrl({ challenge: 'CHAL', state: 'STATE' })
    const u = new URL(url)
    // Live subscription authorize endpoint — NOT the retired claude.ai host.
    expect(u.origin + u.pathname).toBe('https://claude.com/cai/oauth/authorize')
    // Manual flow markers captured from the real CLI: code=true + the fixed
    // platform.claude.com redirect (NOT a http://localhost loopback).
    expect(u.searchParams.get('code')).toBe('true')
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('code_challenge')).toBe('CHAL')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe('STATE')
    // Full scope set INCLUDING org:create_api_key (the CLI sends it first).
    expect(u.searchParams.get('scope')).toBe(EXPECTED_SCOPES)
    // Scope serialized cleanly (spaces as + or %20, no lone/double-encoded %).
    const rawScope = url
      .split('?')[1]
      .split('&')
      .find((p) => p.startsWith('scope='))!
      .slice('scope='.length)
    expect(rawScope).not.toContain(' ')
    expect(rawScope).not.toMatch(/%(?![0-9A-Fa-f]{2})/)
    expect(rawScope).not.toContain('%25')
    // Round-trips through the validator.
    expect(validateClaudeOAuthUrl(url)).not.toBeNull()
  })
})

describe('validateClaudeOAuthUrl', () => {
  it('accepts the canonical claude.com/cai manual-redirect authorize URL', () => {
    const url = validateClaudeOAuthUrl(VALID_URL)
    expect(url?.host).toBe('claude.com')
    expect(url?.pathname).toBe('/cai/oauth/authorize')
  })

  it('rejects the retired claude.ai host (regression: stale endpoint)', () => {
    const stale =
      `https://claude.ai/oauth/authorize?code=true&response_type=code&client_id=c` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s&code_challenge=c&code_challenge_method=S256`
    expect(validateClaudeOAuthUrl(stale)).toBeNull()
  })

  it('rejects a localhost loopback redirect (regression: the client refuses it)', () => {
    const loopback =
      `https://claude.com/cai/oauth/authorize?code=true&response_type=code&client_id=c` +
      `&redirect_uri=${encodeURIComponent('http://localhost:43123/callback')}&state=s&code_challenge=c&code_challenge_method=S256`
    expect(validateClaudeOAuthUrl(loopback)).toBeNull()
  })

  it('rejects unexpected hosts, paths, missing PKCE params, and foreign redirects', () => {
    const withRedirect = (r: string): string =>
      `redirect_uri=${encodeURIComponent(r)}&state=s&code_challenge=c&code_challenge_method=S256`
    const invalid = [
      null,
      undefined,
      'not a url',
      // wrong host
      `https://evil.example/cai/oauth/authorize?response_type=code&client_id=c&${withRedirect(REDIRECT)}`,
      // right host, wrong path (the retired /oauth/authorize path on claude.com)
      `https://claude.com/oauth/authorize?response_type=code&client_id=c&${withRedirect(REDIRECT)}`,
      // right host, other path
      `https://claude.com/other?response_type=code&client_id=c&${withRedirect(REDIRECT)}`,
      // missing code_challenge_method
      `https://claude.com/cai/oauth/authorize?response_type=code&client_id=c&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s&code_challenge=c`,
      // wrong code_challenge_method
      `https://claude.com/cai/oauth/authorize?response_type=code&client_id=c&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s&code_challenge=c&code_challenge_method=plain`,
      // foreign redirect host
      `https://claude.com/cai/oauth/authorize?response_type=code&client_id=c&${withRedirect('https://evil.example/callback')}`,
      // http (not https) authorize
      `http://claude.com/cai/oauth/authorize?response_type=code&client_id=c&${withRedirect(REDIRECT)}`,
      // explicit port on claude.com
      `https://claude.com:8443/cai/oauth/authorize?response_type=code&client_id=c&${withRedirect(REDIRECT)}`
    ]
    for (const u of invalid) {
      expect(validateClaudeOAuthUrl(u), `expected reject: ${u}`).toBeNull()
    }
  })
})

describe('parseClaudeAuthCode', () => {
  it('splits the code#state string the callback page renders', () => {
    expect(parseClaudeAuthCode('THECODE#THESTATE')).toEqual({ code: 'THECODE', state: 'THESTATE' })
  })

  it('accepts a bare code (no state segment)', () => {
    expect(parseClaudeAuthCode('THECODE')).toEqual({ code: 'THECODE', state: null })
  })

  it('accepts the full callback URL (address-bar paste)', () => {
    expect(parseClaudeAuthCode(`${REDIRECT}?code=abc&state=xyz`)).toEqual({
      code: 'abc',
      state: 'xyz'
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseClaudeAuthCode('  THECODE#THESTATE  ')).toEqual({
      code: 'THECODE',
      state: 'THESTATE'
    })
  })

  it('returns null for empty / missing input', () => {
    expect(parseClaudeAuthCode('')).toBeNull()
    expect(parseClaudeAuthCode('   ')).toBeNull()
    expect(parseClaudeAuthCode(null)).toBeNull()
    expect(parseClaudeAuthCode(`${REDIRECT}?state=xyz`)).toBeNull() // URL with no code
  })
})

describe('isNewClaudeOAuthAttempt (one-launch latch reset)', () => {
  it('same URL is the same in-flight attempt; a different URL is a new attempt', () => {
    expect(
      isNewClaudeOAuthAttempt(
        'https://claude.com/cai/oauth/authorize?state=current',
        'https://claude.com/cai/oauth/authorize?state=current'
      )
    ).toBe(false)
    expect(
      isNewClaudeOAuthAttempt(
        'https://claude.com/cai/oauth/authorize?state=expired',
        'https://claude.com/cai/oauth/authorize?state=retry'
      )
    ).toBe(true)
  })
})

describe('credentials file (SDK-native shape, merge-preserving)', () => {
  it('writes the claudeAiOauth block with a numeric expiresAt', () => {
    const env = tempConfigEnv()
    writeClaudeCredentials(
      { accessToken: 'a1', refreshToken: 'r1', expiresAt: 123456, scopes: ['user:inference'] },
      env
    )
    const onDisk = JSON.parse(readFileSync(claudeCredentialsPath(env), 'utf-8'))
    expect(onDisk.claudeAiOauth.accessToken).toBe('a1')
    expect(typeof onDisk.claudeAiOauth.expiresAt).toBe('number')
    expect(onDisk.claudeAiOauth.expiresAt).toBe(123456)
    expect(readClaudeOauth(env)?.refreshToken).toBe('r1')
  })

  it('preserves other top-level keys and extra claudeAiOauth subkeys on re-write', () => {
    const env = tempConfigEnv()
    writeFileSync(
      claudeCredentialsPath(env),
      JSON.stringify({
        mcpOAuth: { some: 'server-token' },
        claudeAiOauth: {
          accessToken: 'old',
          refreshToken: 'oldR',
          expiresAt: 1,
          scopes: ['user:inference'],
          subscriptionType: 'pro',
          rateLimitTier: 'default'
        }
      })
    )
    writeClaudeCredentials(
      { accessToken: 'new', refreshToken: 'newR', expiresAt: 999, scopes: ['user:inference'] },
      env
    )
    const onDisk = JSON.parse(readFileSync(claudeCredentialsPath(env), 'utf-8'))
    expect(onDisk.mcpOAuth).toEqual({ some: 'server-token' })
    expect(onDisk.claudeAiOauth.accessToken).toBe('new')
    expect(onDisk.claudeAiOauth.expiresAt).toBe(999)
    expect(onDisk.claudeAiOauth.subscriptionType).toBe('pro')
    expect(onDisk.claudeAiOauth.rateLimitTier).toBe('default')
  })

  it('sign-out drops only claudeAiOauth, keeping the rest of the file', () => {
    const env = tempConfigEnv()
    writeFileSync(
      claudeCredentialsPath(env),
      JSON.stringify({ mcpOAuth: { keep: 1 }, claudeAiOauth: { accessToken: 'x', scopes: [] } })
    )
    removeClaudeCredentials(env)
    const onDisk = JSON.parse(readFileSync(claudeCredentialsPath(env), 'utf-8'))
    expect(onDisk.mcpOAuth).toEqual({ keep: 1 })
    expect(onDisk.claudeAiOauth).toBeUndefined()
    expect(readClaudeOauth(env)).toBeNull()
  })
})

describe('claudeAuthStatus', () => {
  it('is disconnected on a fresh machine (no file)', () => {
    const env = tempConfigEnv()
    expect(claudeAuthStatus(env)).toEqual({ connected: false, expiresAt: null })
  })

  it('is connected with a refresh token even past access-token expiry (SDK self-refreshes)', () => {
    const env = tempConfigEnv()
    writeClaudeCredentials(
      { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 10_000, scopes: [] },
      env
    )
    expect(claudeAuthStatus(env).connected).toBe(true)
  })

  it('is disconnected when the access token is expired and there is no refresh token', () => {
    const env = tempConfigEnv()
    writeClaudeCredentials(
      { accessToken: 'a', refreshToken: null, expiresAt: Date.now() - 10_000, scopes: [] },
      env
    )
    expect(claudeAuthStatus(env).connected).toBe(false)
  })
})

/** Stub global fetch to capture the outgoing token request and return `body`. */
function stubTokenFetch(
  body: Record<string, unknown>,
  status = 200
): { seen: () => { url: string; init: RequestInit } | null } {
  let captured: { url: string; init: RequestInit } | null = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    })
  )
  return { seen: () => captured }
}

describe('exchangeClaudeCodeForToken (request shape + response mapping)', () => {
  it('POSTs a JSON body with the anthropic-beta gate + fixed redirect, maps epoch-ms expiresAt', async () => {
    const cap = stubTokenFetch({
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 3600,
      scope: EXPECTED_SCOPES
    })
    const before = Date.now()
    const result = await exchangeClaudeCodeForToken('the-code', 'the-verifier', 'the-state')

    const seen = cap.seen()!
    expect(seen.url).toBe('https://platform.claude.com/v1/oauth/token')
    const headers = seen.init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20')
    expect(JSON.parse(seen.init.body as string)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: REDIRECT,
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      code_verifier: 'the-verifier',
      state: 'the-state',
      expires_in: 31536000
    })
    expect(result.accessToken).toBe('AT')
    expect(result.refreshToken).toBe('RT')
    expect(result.scopes).toEqual(EXPECTED_SCOPES.split(' '))
    expect(typeof result.expiresAt).toBe('number')
    expect(result.expiresAt!).toBeGreaterThanOrEqual(before + 3600 * 1000)
  })

  it('throws on a non-2xx token response', async () => {
    stubTokenFetch({ error: 'invalid_grant' }, 400)
    await expect(exchangeClaudeCodeForToken('c', 'v', 's')).rejects.toThrow(
      /Token exchange failed \(400\)/
    )
  })
})

describe('startClaudeOAuthFlow (manual submitCode path)', () => {
  it('builds a valid authorize URL and, on submitCode, exchanges + writes credentials', async () => {
    const cap = stubTokenFetch({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
    const env = tempConfigEnv()
    const flow = await startClaudeOAuthFlow(() => {}, env)

    const authUrl = validateClaudeOAuthUrl(flow.authUrl)
    expect(authUrl).not.toBeNull()
    const state = authUrl!.searchParams.get('state')!

    const result = await flow.submitCode(`the-code#${state}`)
    expect(result.accessToken).toBe('AT')

    // Hit the real (default) token endpoint with the fixed redirect + our state.
    const seen = cap.seen()!
    expect(seen.url).toBe('https://platform.claude.com/v1/oauth/token')
    expect(JSON.parse(seen.init.body as string)).toMatchObject({
      code: 'the-code',
      redirect_uri: REDIRECT,
      state
    })
    // Credentials landed in the SDK-native file.
    expect(readClaudeOauth(env)?.accessToken).toBe('AT')
    expect(claudeAuthStatus(env).connected).toBe(true)
  })

  it('rejects a pasted code whose state does not match (CSRF guard)', async () => {
    stubTokenFetch({ access_token: 'AT' })
    const flow = await startClaudeOAuthFlow(() => {}, tempConfigEnv())
    await expect(flow.submitCode('the-code#not-the-state')).rejects.toThrow(/state mismatch/)
  })
})
