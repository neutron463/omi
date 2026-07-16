import { useSyncExternalStore } from 'react'

// Shared import-run state store. Port of macOS `ConnectorImportRunner`
// (`desktop/macos/Desktop/Sources/MainWindow/Pages/ConnectorImportRunner.swift`).
//
// Purpose: a single import (Gmail, Calendar, X, ...) is keyed globally by
// connector id so that starting it from one entry point (Memories page) and
// later opening another (onboarding data-sources step, Apps hub) shows the SAME
// in-flight / failed / succeeded state — not a second concurrent run. In-memory,
// cross-entry-point, dies with the process (matches Mac's intent — no
// persistence). Follows the module-cache + Set<subscriber> + hook pattern of
// `hooks/useMemories.ts`; no zustand.

export type RunPhase = 'running' | 'succeeded' | 'failed'

export interface RunState {
  phase: RunPhase
  progressTitle: string
  progressDetail: string
  statusMessage?: string // set on success
  errorMessage?: string // set on failure
}

export interface Outcome {
  ok: boolean
  message?: string
  error?: string
}

// Handed to the operation so it can push live progress text. `update` is a
// no-op once a newer start for the same connector has superseded this run (its
// captured token no longer matches) — matches Mac's stale-runToken guard.
export interface ProgressSink {
  update(title: string, detail: string): void
}

// connectorId -> current state.
const runs: Record<string, RunState> = {}
// connectorId -> current run token; a fresh crypto.randomUUID() per start
// invalidates any progress update captured by an older run.
const tokens = new Map<string, string>()
// Every mounted useConnectorRuns subscribes here (via useSyncExternalStore) so a
// start/transition from any entry point re-renders all of them.
const subscribers = new Set<() => void>()
// A cached immutable snapshot: getSnapshot must return a stable reference while
// nothing changes (else useSyncExternalStore loops), so we recompute it only on
// publish, not per read.
let snapshot: Record<string, RunState> = {}

function publish(): void {
  snapshot = { ...runs }
  subscribers.forEach((fn) => fn())
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange)
  return () => {
    subscribers.delete(onChange)
  }
}

/**
 * Start a run keyed by connectorId. Returns false and does nothing if a run for
 * that id is already `running` (de-dupes concurrent starts). Otherwise sets the
 * run to `running`, mints a fresh token, and kicks off `operation(sink)`; its
 * resolution transitions the run to `succeeded` (with statusMessage) or `failed`
 * (with errorMessage). A throw is treated as failure.
 */
export function startRun(
  connectorId: string,
  progressTitle: string,
  progressDetail: string,
  operation: (sink: ProgressSink) => Promise<Outcome>
): boolean {
  if (runs[connectorId]?.phase === 'running') return false

  const token = crypto.randomUUID()
  tokens.set(connectorId, token)
  runs[connectorId] = { phase: 'running', progressTitle, progressDetail }
  publish()

  const sink: ProgressSink = {
    update(title, detail) {
      if (tokens.get(connectorId) !== token) return // superseded by a newer start
      const cur = runs[connectorId]
      if (!cur || cur.phase !== 'running') return
      runs[connectorId] = { ...cur, progressTitle: title, progressDetail: detail }
      publish()
    }
  }

  const settle = (next: RunState): void => {
    if (tokens.get(connectorId) !== token) return // a newer start owns this id now
    runs[connectorId] = next
    publish()
  }

  void (async () => {
    const base = runs[connectorId]
    const progressTitleAtStart = base?.progressTitle ?? progressTitle
    const progressDetailAtStart = base?.progressDetail ?? progressDetail
    try {
      const outcome = await operation(sink)
      const cur = runs[connectorId]
      const keptTitle = cur?.progressTitle ?? progressTitleAtStart
      const keptDetail = cur?.progressDetail ?? progressDetailAtStart
      if (outcome.ok) {
        settle({
          phase: 'succeeded',
          progressTitle: keptTitle,
          progressDetail: keptDetail,
          statusMessage: outcome.message
        })
      } else {
        settle({
          phase: 'failed',
          progressTitle: keptTitle,
          progressDetail: keptDetail,
          errorMessage: outcome.error ?? outcome.message
        })
      }
    } catch (e) {
      const cur = runs[connectorId]
      settle({
        phase: 'failed',
        progressTitle: cur?.progressTitle ?? progressTitleAtStart,
        progressDetail: cur?.progressDetail ?? progressDetailAtStart,
        errorMessage: e instanceof Error ? e.message : String(e)
      })
    }
  })()

  return true
}

export function isRunning(connectorId: string): boolean {
  return runs[connectorId]?.phase === 'running'
}

export function getRunState(connectorId: string): RunState | undefined {
  return runs[connectorId]
}

/**
 * Clear a SUCCEEDED run once it has been shown + dismissed. FAILED runs persist
 * (so the error stays visible) until the next startRun replaces them.
 */
export function acknowledgeSuccess(connectorId: string): void {
  if (runs[connectorId]?.phase === 'succeeded') {
    delete runs[connectorId]
    tokens.delete(connectorId)
    publish()
  }
}

/** React hook: subscribe to the whole runs map (re-renders on any change). */
export function useConnectorRuns(): Record<string, RunState> {
  return useSyncExternalStore(subscribe, getSnapshot)
}

function getSnapshot(): Record<string, RunState> {
  return snapshot
}

/** Test-only: wipe all run state + subscribers so suites don't leak into each
 *  other (the store is module-global and dies only with the process). */
export function __resetConnectorRunsForTest(): void {
  for (const id of Object.keys(runs)) delete runs[id]
  tokens.clear()
  subscribers.clear()
  snapshot = {}
}
