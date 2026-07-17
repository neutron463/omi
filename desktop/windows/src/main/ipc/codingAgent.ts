// IPC surface for delegated coding-agent tasks. Follows the house pattern:
// invoke-style handlers plus a broadcast channel for streaming task events
// (both the main window and the overlay may render the same task's progress).

import { ipcMain, BrowserWindow, shell } from 'electron'
import {
  ADAPTER_PROFILES,
  adapterActivationError,
  adapterIsActivated,
  type AdapterCommandOverrides
} from '../codingAgent/adapterRegistry'
import { PRODUCTION_ADAPTER_IDS } from '../codingAgent/interface'
import { cancelTask, runCodingAgentTask, testAgentConnection } from '../codingAgent/taskRunner'
import {
  claudeAuthStatus,
  removeClaudeCredentials,
  startClaudeOAuthFlow,
  validateClaudeOAuthUrl,
  type ClaudeOAuthFlowHandle
} from '../codingAgent/claudeOAuth'
import { messageFrom } from '../codingAgent/failures'
import type { ProductionAdapterId } from '../codingAgent/interface'
import type {
  CodingAgentAuthStatus,
  CodingAgentEvent,
  CodingAgentInfo,
  CodingAgentResult,
  CodingAgentRunArgs,
  CodingAgentStartAuthResult,
  CodingAgentSubmitAuthResult
} from '../../shared/types'

function broadcast(event: CodingAgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('codingAgent:event', event)
    }
  }
}

export function registerCodingAgentHandlers(): void {
  ipcMain.handle(
    'codingAgent:list',
    (_e, commandOverrides?: AdapterCommandOverrides): CodingAgentInfo[] => {
      const overrides = commandOverrides ?? {}
      return PRODUCTION_ADAPTER_IDS.map((id) => {
        const connected = adapterIsActivated(id, overrides)
        return {
          id,
          displayName: ADAPTER_PROFILES[id].displayName,
          connected,
          installHint: connected ? undefined : adapterActivationError(id)
        }
      })
    }
  )

  ipcMain.handle(
    'codingAgent:run',
    (_e, args: CodingAgentRunArgs): Promise<CodingAgentResult> =>
      runCodingAgentTask(args, broadcast, (message) => console.log(`[codingAgent] ${message}`))
  )

  ipcMain.handle('codingAgent:cancel', (_e, taskId: string): boolean => cancelTask(taskId))

  ipcMain.handle(
    'codingAgent:test',
    (_e, agentId: ProductionAdapterId, commandOverrides?: AdapterCommandOverrides) =>
      testAgentConnection(agentId, commandOverrides ?? {}, (message) =>
        console.log(`[codingAgent] ${message}`)
      )
  )

  ipcMain.handle('codingAgent:authStatus', (): CodingAgentAuthStatus => claudeAuthStatus())

  ipcMain.handle(
    'codingAgent:startAuth',
    (): Promise<CodingAgentStartAuthResult> => startClaudeAuth()
  )

  ipcMain.handle(
    'codingAgent:submitAuthCode',
    (_e, code: string): Promise<CodingAgentSubmitAuthResult> => submitClaudeAuthCode(code)
  )

  ipcMain.handle('codingAgent:signOut', (): CodingAgentAuthStatus => {
    pendingClaudeAuth?.cancel()
    pendingClaudeAuth = null
    removeClaudeCredentials()
    return claudeAuthStatus()
  })
}

// The manual Claude sign-in is two steps: `startAuth` opens the browser and
// stores the in-flight flow; `submitAuthCode` completes it with the code the
// user copied from the Claude callback page. (The client only supports the
// fixed platform.claude.com redirect, so there is no localhost callback to
// await — see claudeOAuth.ts.)
let pendingClaudeAuth: ClaudeOAuthFlowHandle | null = null
// One start at a time: a duplicate `startAuth` (double-click) joins the running
// start instead of opening a second browser tab.
let activeStart: Promise<CodingAgentStartAuthResult> | null = null

async function startClaudeAuth(): Promise<CodingAgentStartAuthResult> {
  if (activeStart) return activeStart
  activeStart = runClaudeAuthStart().finally(() => {
    activeStart = null
  })
  return activeStart
}

async function runClaudeAuthStart(): Promise<CodingAgentStartAuthResult> {
  const log = (message: string): void => console.log(`[codingAgent] ${message}`)
  try {
    const flow = await startClaudeOAuthFlow(log)
    // Validate before opening: never hand the browser a URL that isn't the exact
    // claude.com/cai PKCE request we built (and never one whose redirect could
    // deliver the code somewhere we don't control).
    const validated = validateClaudeOAuthUrl(flow.authUrl)
    if (!validated) {
      flow.cancel()
      return {
        ok: false,
        error: 'Unable to start Claude sign-in. Try again.',
        status: claudeAuthStatus()
      }
    }
    // Supersede any previous in-flight attempt, then open the browser. Under E2E
    // we skip the real browser (keeps the harness hermetic) but still arm the
    // pending flow so the paste step can be exercised.
    pendingClaudeAuth?.cancel()
    pendingClaudeAuth = flow
    if (!process.env.OMI_E2E) void shell.openExternal(validated.toString())
    return { ok: true, awaitingCode: true, status: claudeAuthStatus() }
  } catch (error) {
    pendingClaudeAuth = null
    return { ok: false, error: messageFrom(error), status: claudeAuthStatus() }
  }
}

async function submitClaudeAuthCode(code: string): Promise<CodingAgentSubmitAuthResult> {
  const flow = pendingClaudeAuth
  if (!flow) {
    return {
      ok: false,
      error: 'Start Claude sign-in first, then paste the code.',
      status: claudeAuthStatus()
    }
  }
  try {
    await flow.submitCode(code)
    pendingClaudeAuth = null
    return { ok: true, status: claudeAuthStatus() }
  } catch (error) {
    // Keep the pending flow armed so a mistyped/partial paste can be retried
    // without reopening the browser.
    return { ok: false, error: messageFrom(error), status: claudeAuthStatus() }
  }
}
