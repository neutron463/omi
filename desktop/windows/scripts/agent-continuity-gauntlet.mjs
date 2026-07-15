// Windows port of desktop/macos/scripts/agent-continuity-gauntlet.sh.
//
// The macOS driver talks to DesktopAutomationBridge over loopback HTTP. Windows
// has no equivalent bridge, but its dev app already exposes CDP and OMI_E2E
// renderer hooks. This driver attaches to that isolated dev instance and drives
// the single ChatBridgeHost/useChat engine used by Home and the floating bar.
//
// Live prerequisites:
//   1. Start an isolated Windows dev instance with OMI_E2E=1.
//   2. Seed auth into that instance with `pnpm seed:auth` if desired.
//   3. Run `pnpm test:agent-gauntlet -- --cdp-port <instance port>`.
//
// `--self-check` is hermetic and is the CI-safe wiring check.

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultEvidenceRoot = path.join(root, '.harness', 'agent-continuity-gauntlet')

function parseArgs(argv) {
  const out = {
    selfCheck: false,
    cdpPort: process.env.OMI_GAUNTLET_CDP_PORT ? Number(process.env.OMI_GAUNTLET_CDP_PORT) : null,
    suite: 'core',
    runId: null,
    runDir: null,
    turnTimeoutMs: 180_000,
    allowLegacy: false,
    agentProvider: process.env.OMI_GAUNTLET_AGENT_PROVIDER ?? null,
    screenshot: true
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--self-check') out.selfCheck = true
    else if (arg === '--cdp-port') out.cdpPort = Number(argv[++i])
    else if (arg === '--suite') out.suite = argv[++i]
    else if (arg === '--run-id') out.runId = argv[++i]
    else if (arg === '--run-dir') out.runDir = argv[++i]
    else if (arg === '--turn-timeout-ms') out.turnTimeoutMs = Number(argv[++i])
    else if (arg === '--allow-legacy') out.allowLegacy = true
    else if (arg === '--agent-provider') out.agentProvider = argv[++i]
    else if (arg === '--no-screenshot') out.screenshot = false
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!out.selfCheck && !out.help && (!Number.isInteger(out.cdpPort) || out.cdpPort <= 0))
    throw new Error('live runs require an explicit --cdp-port for an isolated dev instance')
  if (!out.selfCheck && !out.help && out.cdpPort === 9222)
    throw new Error('the gauntlet refuses the canonical primary dev CDP port 9222')
  if (out.agentProvider && !['openclaw', 'hermes'].includes(out.agentProvider))
    throw new Error('--agent-provider must be openclaw or hermes')
  if (!Number.isInteger(out.turnTimeoutMs) || out.turnTimeoutMs <= 0)
    throw new Error('invalid --turn-timeout-ms')
  return out
}

function help() {
  console.log(`Windows agent continuity gauntlet (INV-CHAT-1)

Usage:
  node scripts/agent-continuity-gauntlet.mjs --self-check
  node scripts/agent-continuity-gauntlet.mjs --cdp-port <isolated-port> [--suite core]

Suites:
  continuity   typed -> synthetic PTT text -> blind typed recall
  agents       spawn_agent -> list/status visibility
  core         continuity + agents (default)

Options:
  --allow-legacy       run continuity only on legacy_sse (not agents/kernel proof)
  --agent-provider P   local spawn provider: openclaw or hermes
  --run-dir <path>     evidence directory
  --turn-timeout-ms N  per-turn timeout (default 180000)
  --no-screenshot      skip the main-window screenshot

The macOS owner, prompt-regression, resilience-race, real forced-transcript PTT,
QueryTracer, and runtime-SQLite evidence probes do not yet have Windows seams.`)
}

function expandSuites(raw) {
  const aliases = { core: ['continuity', 'agents'], all: ['continuity', 'agents'] }
  const supported = new Set(['continuity', 'agents'])
  const requested = new Set()
  for (const part of raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)) {
    if (aliases[part]) aliases[part].forEach((x) => requested.add(x))
    else if (supported.has(part)) requested.add(part)
    else {
      throw new Error(
        `suite '${part}' is not available on Windows; supported: continuity, agents, core`
      )
    }
  }
  return [...(requested.size ? requested : aliases.core)]
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

function selfCheck() {
  const bridgeHost = read('src/renderer/src/components/chat/ChatBridgeHost.tsx')
  const appStateProvider = read('src/renderer/src/state/AppStateProvider.tsx')
  const mainChat = read('src/main/ipc/mainChat.ts')
  const controlTools = read('src/main/agentKernel/controlTools.ts')
  const checks = [
    {
      name: 'test-only renderer hook is gated by OMI_E2E',
      ok: bridgeHost.includes('window.omi?.e2e !== true')
    },
    {
      name: 'typed input and bar PTT IPC feed the shared chat engine',
      ok:
        bridgeHost.includes('sendTyped') &&
        bridgeHost.includes('onBarChatSend') &&
        bridgeHost.includes('sendRef.current(text, { fromVoice })')
    },
    {
      name: 'Home owns exactly one useChat instance',
      ok: (appStateProvider.match(/\buseChat\(\)/g) ?? []).length === 1
    },
    {
      name: 'floating-bar sends feed ChatBridgeHost instead of a second transcript',
      ok: bridgeHost.includes('onBarChatSend')
    },
    {
      name: 'pi_mono main chat records clean surface turns in the kernel',
      ok:
        mainChat.includes('kernel.recordSurfaceTurn') &&
        mainChat.includes("surfaceKind: 'main_chat'")
    },
    {
      name: 'agent control plane exposes spawn and session inspection',
      ok:
        controlTools.includes("case 'spawn_agent'") &&
        controlTools.includes("case 'list_agent_sessions'")
    }
  ]

  const failures = checks.filter((check) => !check.ok)
  for (const check of checks)
    console.log(`[agent-gauntlet] ${check.ok ? 'PASS' : 'FAIL'} ${check.name}`)

  console.log(
    '[agent-gauntlet] KNOWN GAP real PTT forced transcript is unavailable; live step uses synthetic PTT text after STT'
  )
  console.log(
    '[agent-gauntlet] KNOWN GAP chatEngine defaults to legacy_sse; kernel continuity requires an isolated pi_mono profile'
  )
  console.log(
    '[agent-gauntlet] KNOWN GAP owner isolation cannot be exercised because Windows auth does not set the main-side control-plane owner'
  )
  console.log(
    '[agent-gauntlet] KNOWN GAP no Windows QueryTracer/runtime-SQLite/HTTP automation-bridge evidence seam'
  )

  if (failures.length) {
    console.error(`[agent-gauntlet] SELF-CHECK FAIL (${failures.length} wiring check(s))`)
    return 1
  }
  console.log('[agent-gauntlet] SELF-CHECK PASS')
  return 0
}

function nowId() {
  return new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
}

function marker(runId, suffix) {
  return `GAUNTLET-${runId}-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${suffix}`
}

function gitSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

function gitWorktreeState() {
  const status = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root, encoding: 'buffer' })
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'buffer'
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort()
  const completeHash = crypto.createHash('sha256').update(diff)
  for (const relativePath of untracked) {
    completeHash.update('\0untracked\0').update(relativePath).update('\0')
    completeHash.update(fs.readFileSync(path.join(root, relativePath)))
  }
  return {
    dirty: status.trim().length > 0,
    status: status.trim().split(/\r?\n/).filter(Boolean),
    tracked_diff_sha256: crypto.createHash('sha256').update(diff).digest('hex'),
    untracked_source_files: untracked,
    complete_worktree_sha256: completeHash.digest('hex')
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function mainPage(pages) {
  return (
    pages.find(
      (page) =>
        page.url() !== 'about:blank' &&
        !/#\/(bar|capture|insight-toast|meeting-toast|glow)/.test(page.url())
    ) ?? null
  )
}

function barPage(pages) {
  return pages.find((page) => /#\/bar(?:$|[/?])/.test(page.url())) ?? null
}

function assistantFor(snapshot, query) {
  const messages = snapshot?.messages ?? []
  let userIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i]?.content === query) {
      userIndex = i
      break
    }
  }
  if (userIndex < 0) return ''
  return messages
    .slice(userIndex + 1)
    .filter((message) => message?.role === 'assistant')
    .map((message) => String(message.content ?? ''))
    .join('\n')
}

const ACTIVE_RUN_STATUSES = new Set(['queued', 'starting', 'running', 'cancelling'])
const FAILED_RUN_STATUSES = new Set(['failed', 'cancelled'])
const TERMINAL_RUN_STATUSES = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'orphaned',
  'completed'
])

function listedSessions(payload) {
  return Array.isArray(payload?.sessions) ? payload.sessions : []
}

function currentRun(summary) {
  return summary?.activeRun ?? summary?.latestRun ?? null
}

function activeListedSessions(payload) {
  return listedSessions(payload).filter((summary) => {
    const run = currentRun(summary)
    return !!summary?.activeRun || ACTIVE_RUN_STATUSES.has(run?.status)
  })
}

function findSpawnedSession(before, after, markerText, provider) {
  const beforeIds = new Set(
    listedSessions(before)
      .map((summary) => summary?.session?.sessionId)
      .filter(Boolean)
  )
  return (
    listedSessions(after).find((summary) => {
      const session = summary?.session ?? {}
      const run = currentRun(summary)
      const bindingProviders = (summary?.adapterBindings ?? []).map((binding) => binding?.adapterId)
      return (
        session.sessionId &&
        !beforeIds.has(session.sessionId) &&
        session.surfaceKind === 'floating_bar' &&
        run?.input?.prompt?.includes(markerText) &&
        !FAILED_RUN_STATUSES.has(run?.status) &&
        (session.metadata?.provider === provider ||
          session.defaultAdapterId === provider ||
          session.providerBoundary === provider ||
          bindingProviders.includes(provider))
      )
    }) ?? null
  )
}

class Runner {
  constructor(options) {
    this.options = options
    this.runId = options.runId ?? nowId()
    this.runDir = path.resolve(options.runDir ?? path.join(defaultEvidenceRoot, this.runId))
    this.suites = expandSuites(options.suite)
    this.markers = {
      typed: marker(this.runId, 'TYPED'),
      ptt: marker(this.runId, 'PTT'),
      spawn: marker(this.runId, 'SPAWN')
    }
    this.failures = []
    this.warnings = []
    this.steps = []
    this.browser = null
    this.page = null
    this.barPage = null
    this.spawnedRunId = null
    this.manifest = {
      platform: 'windows',
      run_id: this.runId,
      started_at: new Date().toISOString(),
      git: gitSha(),
      worktree: gitWorktreeState(),
      cdp_port: options.cdpPort,
      agent_provider: options.agentProvider,
      suites: this.suites,
      markers: this.markers,
      ptt_config: {
        mode: 'synthetic_post_stt_via_bar_ipc',
        real_realtime_hub_exercised: false,
        limitation: 'Windows has no deterministic forced-transcript PTT E2E action.'
      }
    }
  }

  fail(message) {
    this.failures.push(message)
    console.error(`[agent-gauntlet] FAIL ${message}`)
  }

  warn(message) {
    this.warnings.push(message)
    console.warn(`[agent-gauntlet] WARN ${message}`)
  }

  save() {
    writeJson(path.join(this.runDir, 'manifest.json'), {
      ...this.manifest,
      steps: this.steps,
      failures: this.failures,
      warnings: this.warnings,
      passed: this.failures.length === 0
    })
  }

  async connect() {
    try {
      this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.options.cdpPort}`, {
        timeout: 8_000
      })
    } catch {
      throw new Error(
        `no Windows dev CDP endpoint on port ${this.options.cdpPort}; start an isolated app with OMI_E2E=1`
      )
    }
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && (!this.page || !this.barPage)) {
      const pages = this.browser.contexts().flatMap((context) => context.pages())
      this.page = mainPage(pages)
      this.barPage = barPage(pages)
      if (!this.page || !this.barPage) await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!this.page) throw new Error('no main Omi renderer window found')
    if (!this.barPage) throw new Error('no floating-bar renderer window found')
    await this.page.waitForFunction(
      () => typeof globalThis.__omiAgentGauntlet?.snapshot === 'function',
      null,
      { timeout: 15_000 }
    )
    await this.barPage.waitForFunction(() => typeof window.omiBar?.sendChat === 'function', null, {
      timeout: 15_000
    })
    this.manifest.target = {
      main_url: this.page.url(),
      bar_url: this.barPage.url()
    }
  }

  async preflight() {
    const state = await this.page.evaluate(async () => {
      const hook = globalThis.__omiAgentGauntlet
      return {
        engine: await hook.engine(),
        gauntletMode: window.omi.gauntlet === true,
        signedIn: Object.keys(localStorage).some((key) => key.startsWith('firebase:authUser:')),
        snapshot: hook.snapshot()
      }
    })
    this.manifest.preflight = state
    if (!state.gauntletMode) {
      this.fail('target was not started with OMI_GAUNTLET=1; refusing live mutations')
      return true
    }
    if (!state.signedIn) {
      this.fail('isolated dev instance is not signed in; seed auth before live suites')
      return true
    }
    if (state.snapshot?.sending || state.snapshot?.agentsActive) {
      this.fail('isolated dev instance is busy; refusing to reset active chat or agent work')
      return true
    }
    const sessions = await this.page.evaluate(async () =>
      JSON.parse(await window.omi.agentControlCall('list_agent_sessions', {}))
    )
    state.agentSessions = sessions
    if (!sessions?.ok) {
      this.fail('could not inspect kernel agent sessions before the run')
      return true
    }
    if (activeListedSessions(sessions).length > 0) {
      this.fail('isolated dev instance has active kernel agent work; refusing to continue')
      return true
    }
    if (this.suites.includes('agents') && !this.options.agentProvider) {
      this.fail('the agents suite requires --agent-provider openclaw or hermes')
      return true
    }
    if (state.engine !== 'pi_mono') {
      const message =
        'current chat engine is legacy_sse; this can test shared UI history but not Mac-equivalent kernel continuity'
      if (this.suites.includes('agents')) {
        this.fail(`${message}; the agents suite requires pi_mono`)
        return true
      } else if (this.options.allowLegacy) this.warn(message)
      else {
        this.fail(`${message}; rerun an isolated profile with pi_mono or pass --allow-legacy`)
        return true
      }
    }
    this.warn(
      'kernel-history hygiene is unavailable on Windows; use a fresh isolated profile for each live run'
    )
    this.save()
    return false
  }

  async call(method, text) {
    if (method === 'sendPttText') {
      try {
        await this.barPage.evaluate((query) => window.omiBar.sendChat(query, true), text)
        await this.page.waitForFunction(
          (query) => {
            const state = globalThis.__omiAgentGauntlet.snapshot()
            const messages = state.messages ?? []
            const userIndex = messages.findLastIndex(
              (message) => message?.role === 'user' && message?.content === query
            )
            return (
              userIndex >= 0 &&
              !state.sending &&
              messages.slice(userIndex + 1).some((message) => message?.role === 'assistant')
            )
          },
          text,
          { timeout: this.options.turnTimeoutMs }
        )
      } catch (cause) {
        await this.page.evaluate(() => globalThis.__omiAgentGauntlet.reset())
        throw cause
      }
      return this.page.evaluate(() => globalThis.__omiAgentGauntlet.snapshot())
    }
    return this.page.evaluate(
      async ({ method, text, timeoutMs }) => {
        const hook = globalThis.__omiAgentGauntlet
        let timeoutId
        const timeout = new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`${method} timed out after ${timeoutMs}ms`)),
            timeoutMs
          )
        })
        try {
          await Promise.race([hook[method](text), timeout])
        } catch (cause) {
          hook.reset()
          throw cause
        } finally {
          clearTimeout(timeoutId)
        }
        return hook.snapshot()
      },
      { method, text, timeoutMs: this.options.turnTimeoutMs }
    )
  }

  async record(id, name, query, method = 'sendTyped', extra = {}) {
    const before = await this.page.evaluate(() => globalThis.__omiAgentGauntlet.snapshot())
    let snapshot
    let error = null
    try {
      snapshot = await this.call(method, query)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      snapshot = await this.page.evaluate(() => globalThis.__omiAgentGauntlet.snapshot())
      this.fail(`${name}: ${error}`)
    }
    const assistant = assistantFor(snapshot, query)
    const step = {
      id,
      name,
      method,
      user_text: query,
      assistant_text: assistant,
      message_count_before: before.messages?.length ?? 0,
      message_count_after: snapshot.messages?.length ?? 0,
      snapshot,
      error,
      ...extra
    }
    this.steps.push(step)
    writeJson(path.join(this.runDir, id, 'step.json'), step)
    this.save()
    return { assistant, snapshot, step }
  }

  async continuity() {
    const typedQuery = `Remember this continuity marker exactly: ${this.markers.typed}. Reply with it.`
    const typed = await this.record('01-typed-turn', 'typed turn', typedQuery)
    if (!typed.assistant.includes(this.markers.typed))
      this.fail(`typed reply did not acknowledge ${this.markers.typed}`)

    const pttQuery = `In this push-to-talk exchange, remember this marker exactly: ${this.markers.ptt}. Reply with it.`
    const ptt = await this.record(
      '02-ptt-turn',
      'synthetic post-STT PTT turn through bar IPC',
      pttQuery,
      'sendPttText',
      {
        real_realtime_hub_exercised: false
      }
    )
    if (!JSON.stringify(ptt.snapshot).includes(this.markers.ptt))
      this.fail('synthetic PTT marker was not projected into the shared main-chat transcript')

    const followup =
      'In the earlier push-to-talk turn I gave you a marker starting with GAUNTLET- and ending in -PTT. Reply with only that exact marker.'
    if (followup.includes(this.markers.ptt)) this.fail('blind-recall probe leaked the PTT marker')
    const recalled = await this.record(
      '03-typed-followup',
      'blind typed recall after PTT',
      followup
    )
    if (!recalled.assistant.includes(this.markers.ptt))
      this.fail(`typed follow-up could not recall PTT marker ${this.markers.ptt}`)
  }

  async agents() {
    const beforeSessions = await this.page.evaluate(async () =>
      JSON.parse(await window.omi.agentControlCall('list_agent_sessions', {}))
    )
    const spawnQuery = `Use spawn_agent now with provider '${this.options.agentProvider}' and visible true. Objective: track marker ${this.markers.spawn} and wait silently. Do not ask follow-up questions.`
    const spawn = await this.record('04-spawn-agent', 'background agent spawn', spawnQuery)
    let sessions = null
    try {
      sessions = await this.page.evaluate(async () =>
        JSON.parse(await window.omi.agentControlCall('list_agent_sessions', {}))
      )
    } catch (cause) {
      this.fail(
        `list_agent_sessions inspection failed: ${cause instanceof Error ? cause.message : cause}`
      )
    }
    const beforeEvidence = JSON.stringify(beforeSessions)
    const spawnedSession = findSpawnedSession(
      beforeSessions,
      sessions,
      this.markers.spawn,
      this.options.agentProvider
    )
    if (!sessions?.ok || beforeEvidence.includes(this.markers.spawn) || !spawnedSession) {
      this.fail('spawn_agent did not create a visible session carrying the objective marker')
    } else {
      this.spawnedRunId = currentRun(spawnedSession)?.runId ?? null
    }
    spawn.step.agent_sessions_before = beforeSessions
    spawn.step.agent_sessions = sessions
    spawn.step.spawned_session = spawnedSession
    writeJson(path.join(this.runDir, spawn.step.id, 'step.json'), spawn.step)
    this.save()

    const statusQuery =
      'What is the status of the background agent you just started? Use list_agent_sessions and include its exact objective marker.'
    const status = await this.record('05-status-query', 'background agent status', statusQuery)
    const statusSessions = await this.page.evaluate(async () =>
      JSON.parse(await window.omi.agentControlCall('list_agent_sessions', {}))
    )
    const statusSession = findSpawnedSession(
      beforeSessions,
      statusSessions,
      this.markers.spawn,
      this.options.agentProvider
    )
    status.step.agent_sessions = statusSessions
    status.step.spawned_session = statusSession
    writeJson(path.join(this.runDir, status.step.id, 'step.json'), status.step)
    if (!statusSession || !status.assistant.includes(this.markers.spawn))
      this.fail('status reply did not surface the spawned agent objective marker')
  }

  async cleanupSpawnedRun() {
    if (!this.spawnedRunId || !this.page) return
    try {
      const result = await this.page.evaluate(
        async (runId) =>
          JSON.parse(await window.omi.agentControlCall('cancel_agent_run', { runId })),
        this.spawnedRunId
      )
      this.manifest.agent_cleanup = result
      if (!result?.ok) {
        this.fail(`spawned run ${this.spawnedRunId} could not be cancelled`)
        return
      }

      let run = result.run ?? null
      const deadline = Date.now() + 10_000
      while (!TERMINAL_RUN_STATUSES.has(run?.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        const details = await this.page.evaluate(
          async (runId) =>
            JSON.parse(await window.omi.agentControlCall('get_agent_run', { runId })),
          this.spawnedRunId
        )
        if (!details?.ok) break
        run = details.run
      }
      this.manifest.agent_cleanup = { ...result, finalRun: run }
      const alreadyTerminal = TERMINAL_RUN_STATUSES.has(result.run?.status)
      if (!result.cancellation?.accepted && !alreadyTerminal) {
        this.fail(`spawned run ${this.spawnedRunId} rejected cancellation while active`)
      } else if (!TERMINAL_RUN_STATUSES.has(run?.status)) {
        this.fail(`spawned run ${this.spawnedRunId} did not reach a terminal state after cleanup`)
      }
    } catch (cause) {
      this.fail(
        `spawned run cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }

  async run() {
    fs.mkdirSync(this.runDir, { recursive: true })
    this.save()
    try {
      await this.connect()
      if (!(await this.preflight())) {
        await this.page.evaluate(() => globalThis.__omiAgentGauntlet.reset())
        if (this.suites.includes('continuity')) await this.continuity()
        if (this.suites.includes('agents')) await this.agents()
        if (this.options.screenshot) {
          await this.page.screenshot({ path: path.join(this.runDir, 'main-window.png') })
        }
      }
    } catch (cause) {
      this.fail(cause instanceof Error ? cause.message : String(cause))
    } finally {
      await this.cleanupSpawnedRun()
      if (this.browser) await this.browser.close()
    }
    return this.finish()
  }

  finish() {
    this.manifest.finished_at = new Date().toISOString()
    this.manifest.worktree_final = gitWorktreeState()
    this.manifest.worktree_unchanged_during_run =
      this.manifest.worktree.complete_worktree_sha256 ===
      this.manifest.worktree_final.complete_worktree_sha256
    this.save()
    console.log(`[agent-gauntlet] evidence: ${this.runDir}`)
    console.log(
      `[agent-gauntlet] ${this.failures.length ? `FAIL (${this.failures.length})` : 'PASS'}`
    )
    return this.failures.length ? 1 : 0
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    help()
    return 0
  }
  if (options.selfCheck) return selfCheck()
  return new Runner(options).run()
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(`[agent-gauntlet] ${error?.stack ?? error}`)
    process.exitCode = 1
  })
