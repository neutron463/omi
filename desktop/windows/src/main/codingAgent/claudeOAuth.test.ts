import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { once } from 'events'
import {
  buildClaudeAuthUrl,
  validateClaudeOAuthUrl,
  isNewClaudeOAuthAttempt,
  exchangeClaudeCodeForToken,
  writeClaudeCredentials,
  removeClaudeCredentials,
  readClaudeOauth,
  claudeAuthStatus,
  claudeCredentialsPath
} from './claudeOAuth'

const tempDirs: string[] = []
function tempConfigEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'omi-claude-oauth-'))
  tempDirs.push(dir)
  return { CLAUDE_CONFIG_DIR: dir } as NodeJS.ProcessEnv
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

// The full subscription scope set the bundled Claude Code CLI requests, in order.
const EXPECTED_SCOPES =
  'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'

// A valid loopback authorize URL on the LIVE endpoint, matching what
// buildClaudeAuthUrl emits (claude.com/cai/oauth/authorize, not the retired
// claude.ai/oauth/authorize).
const VALID_URL =
  'https://claude.com/cai/oauth/authorize?response_type=code&client_id=test-client&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=test-state&code_challenge=test-challenge&code_challenge_method=S256'

describe('buildClaudeAuthUrl', () => {
  it('emits a claude.com/cai PKCE authorize URL its own validator accepts', () => {
    const url = buildClaudeAuthUrl({
      redirectUri: 'http://localhost:51000/callback',
      challenge: 'CHAL',
      state: 'STATE'
    })
    const u = new URL(url)
    // Live subscription authorize endpoint — NOT the retired claude.ai host.
    expect(u.origin + u.pathname).toBe('https://claude.com/cai/oauth/authorize')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('code_challenge')).toBe('CHAL')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe('STATE')
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:51000/callback')
    // Regression guard: `code=true` selects the manual copy-paste format and,
    // with a loopback redirect_uri, makes the request "Invalid request format".
    // The loopback flow must NOT send it.
    expect(u.searchParams.has('code')).toBe(false)
    // The full Claude Code subscription scope set (incl. user:file_upload; minus
    // org:create_api_key, which throws "Unknown scope" for Max accounts).
    expect(u.searchParams.get('scope')).toBe(EXPECTED_SCOPES)
    // Spaces must be encoded (as + or %20), never left raw, and no trailing/
    // double-encoding artifacts in the serialized query string.
    const rawQuery = url.split('?')[1]
    const scopeParam = rawQuery.split('&').find((p) => p.startsWith('scope='))
    const rawScope = scopeParam!.slice('scope='.length)
    expect(rawScope).not.toContain(' ')
    expect(rawScope).not.toMatch(/%(?![0-9A-Fa-f]{2})/) // no lone/trailing %
    expect(rawScope).not.toContain('%25') // scope was not double-encoded
    // Round-trips through the validator.
    expect(validateClaudeOAuthUrl(url)).not.toBeNull()
  })
})

describe('validateClaudeOAuthUrl', () => {
  it('accepts the canonical claude.com/cai loopback authorize URL', () => {
    const url = validateClaudeOAuthUrl(VALID_URL)
    expect(url?.host).toBe('claude.com')
    expect(url?.pathname).toBe('/cai/oauth/authorize')
  })

  it('rejects the retired claude.ai authorize host (regression: stale endpoint)', () => {
    const stale =
      'https://claude.ai/oauth/authorize?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256'
    expect(validateClaudeOAuthUrl(stale)).toBeNull()
  })

  it('rejects unexpected hosts, paths, missing PKCE params, and non-loopback redirects', () => {
    const invalid = [
      null,
      undefined,
      'not a url',
      // wrong host
      'https://evil.example/cai/oauth/authorize?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256',
      // right host, wrong path (the retired /oauth/authorize path on claude.com)
      'https://claude.com/oauth/authorize?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256',
      // right host, other path
      'https://claude.com/other?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256',
      // missing code_challenge_method
      'https://claude.com/cai/oauth/authorize?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=s&code_challenge=c',
      // wrong code_challenge_method
      'https://claude.com/cai/oauth/authorize?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=s&code_challenge=c&code_challenge_method=plain',
      // non-loopback redirect host
      'https://claude.com/cai/oauth/authorize?response_type=code&client_id=c&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256',
      // http (not https) authorize
      'http://claude.com/cai/oauth/authorize?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256',
      // explicit port on claude.com
      'https://claude.com:8443/cai/oauth/authorize?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256'
    ]
    for (const u of invalid) {
      expect(validateClaudeOAuthUrl(u), `expected reject: ${u}`).toBeNull()
    }
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
    // Pre-seed a file the SDK/CLI might have written, with extra content.
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
    // Untouched sibling key survives.
    expect(onDisk.mcpOAuth).toEqual({ some: 'server-token' })
    // New token fields applied.
    expect(onDisk.claudeAiOauth.accessToken).toBe('new')
    expect(onDisk.claudeAiOauth.expiresAt).toBe(999)
    // Extra SDK-maintained subkeys survive the merge.
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

describe('exchangeClaudeCodeForToken (request shape + response mapping)', () => {
  let server: Server | null = null
  afterEach(async () => {
    if (server) {
      server.close()
      await once(server, 'close').catch(() => {})
      server = null
    }
  })

  it('POSTs a JSON body with the anthropic-beta gate and maps the response to epoch-ms expiresAt', async () => {
    let seen: { headers: Record<string, unknown>; body: Record<string, unknown> } | null = null
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        // The platform.claude.com token endpoint expects a JSON body (the same
        // shape the SDK sends on refresh) — parse as JSON to prove we don't send
        // form encoding.
        seen = { headers: req.headers, body: JSON.parse(raw) }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            access_token: 'AT',
            refresh_token: 'RT',
            expires_in: 3600,
            scope: EXPECTED_SCOPES
          })
        )
      })
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const before = Date.now()

    const result = await exchangeClaudeCodeForToken(
      'the-code',
      'the-verifier',
      'the-state',
      'http://localhost:43123/callback',
      `http://127.0.0.1:${port}/token`
    )

    expect(seen).not.toBeNull()
    expect(seen!.headers['content-type']).toContain('application/json')
    // Beta gate the token endpoint requires (matches the SDK's own refresh call).
    expect(seen!.headers['anthropic-beta']).toBe('oauth-2025-04-20')
    expect(seen!.body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://localhost:43123/callback',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      code_verifier: 'the-verifier',
      state: 'the-state',
      expires_in: 31536000
    })
    expect(result.accessToken).toBe('AT')
    expect(result.refreshToken).toBe('RT')
    expect(result.scopes).toEqual([
      'user:profile',
      'user:inference',
      'user:sessions:claude_code',
      'user:mcp_servers',
      'user:file_upload'
    ])
    expect(typeof result.expiresAt).toBe('number')
    expect(result.expiresAt!).toBeGreaterThanOrEqual(before + 3600 * 1000)
  })

  it('throws on a non-2xx token response', async () => {
    server = createServer((_req, res) => {
      res.writeHead(400)
      res.end('invalid_grant')
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    await expect(
      exchangeClaudeCodeForToken(
        'c',
        'v',
        's',
        'http://localhost:1/callback',
        `http://127.0.0.1:${port}/token`
      )
    ).rejects.toThrow(/Token exchange failed \(400\)/)
  })
})
