// Pure helpers for the overlay's hold-Space push-to-talk. Kept free of React /
// DOM / audio so they can be unit-tested under node Vitest; the effectful parts
// (timers, mic capture, analyser, transcription) live in usePushToTalk.
import type { TranscriptLine } from '../../../../shared/types'

/**
 * How long Space must be held (ms) before it flips from "type a space" to
 * "push-to-talk". Tuned above a normal keypress (~80–150ms) with margin so fast
 * typing never trips it, while a deliberate hold still feels responsive.
 */
export const HOLD_THRESHOLD_MS = 350

/**
 * Release watchdog. While recording, the physically-held Space key emits OS
 * auto-repeat `keydown`s (~every 30–500ms) to the focused overlay. Those repeats
 * are delivered reliably even when the terminating `keyup` is NOT — the summon
 * chord (e.g. Shift+Space) can let Windows consume the Space keyup when Space is
 * lifted while the modifier is still held, which otherwise strands the recording
 * on the visualizer forever. So we treat "auto-repeat stopped" as the release: if
 * no Space keydown arrives for this long AFTER we've seen at least one repeat, the
 * key was released and we finalize as if it had been. Set comfortably above the
 * slowest Windows repeat interval (~500ms) so a still-held key never trips it.
 */
export const RELEASE_WATCHDOG_MS = 900

/**
 * Hard cap on a live recording, independent of any key/focus signal. Backstop for
 * the rare case where the keyup is lost AND no auto-repeat was ever observed (key
 * repeat disabled), so the watchdog never armed. Far above any realistic
 * hold-to-talk so it never truncates legitimate speech; it only exists so the
 * "Listening…" visualizer can never be stuck indefinitely.
 */
export const RECORDING_HARD_CAP_MS = 30_000

/** Injectable timer so the watchdog is deterministic under node Vitest. */
export type WatchdogDeps = {
  /** How long the held key's auto-repeat may go quiet before we call it released. */
  watchdogMs: number
  /** Absolute cap on a live recording, whatever the key/focus signals do. */
  hardCapMs: number
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer: (t: ReturnType<typeof setTimeout>) => void
  /** Invoked once when the recording is judged released (repeats stopped or cap hit). */
  onRelease: () => void
}

export type ReleaseWatchdog = {
  /** A recording started: arm the hard cap. */
  begin: () => void
  /** A Space auto-repeat keydown arrived — the key is still physically held. */
  noteRepeat: () => void
  /** The recording ended (keyup, release, cancel, unmount): disarm everything. */
  stop: () => void
}

/**
 * Guards against a push-to-talk recording that never ends because its terminating
 * Space keyup was swallowed by the global summon chord (release Space while the
 * modifier is still held → Windows eats the keyup, so the overlay's keyup listener
 * never fires and the "Listening…" visualizer sticks forever).
 *
 * Instead of trusting that single keyup edge, we watch the held key's OS auto-repeat
 * keydowns — which ARE delivered reliably to the focused overlay — via noteRepeat(),
 * which re-arms a `watchdogMs` debounce timer. When the repeats stop (key released)
 * the timer fires once and we finalize as if the keyup had arrived. A keyboard with
 * key-repeat disabled simply never calls noteRepeat(), so the debounce timer is never
 * armed and cannot false-cut a genuinely-held key; the `hardCapMs` backstop covers
 * that residual "no keyup and no repeats" case. Pure/injectable so the whole release
 * policy is unit-tested apart from React + DOM plumbing.
 */
export function createReleaseWatchdog(deps: WatchdogDeps): ReleaseWatchdog {
  let active = false
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null
  let capTimer: ReturnType<typeof setTimeout> | null = null

  const clearWatchdog = (): void => {
    if (watchdogTimer !== null) {
      deps.clearTimer(watchdogTimer)
      watchdogTimer = null
    }
  }
  const clearCap = (): void => {
    if (capTimer !== null) {
      deps.clearTimer(capTimer)
      capTimer = null
    }
  }

  const stop = (): void => {
    active = false
    clearWatchdog()
    clearCap()
  }

  const release = (): void => {
    if (!active) return
    stop()
    deps.onRelease()
  }

  return {
    begin: () => {
      active = true
      // Self-contained: clear any stale timers so a fresh recording never inherits
      // a prior session's armed watchdog/cap (callers also stop() first today).
      clearWatchdog()
      clearCap()
      capTimer = deps.setTimer(release, deps.hardCapMs)
    },
    noteRepeat: () => {
      if (!active) return
      // Re-arm the debounce: while repeats keep arriving the key is still held; once
      // they stop for the full window the timer fires once → released. (Only ever
      // armed here, so a keyboard that never repeats can't trip it.)
      clearWatchdog()
      watchdogTimer = deps.setTimer(() => {
        watchdogTimer = null
        release()
      }, deps.watchdogMs)
    },
    stop
  }
}

/** True when a press lasted long enough to count as a hold (vs a quick tap). */
export function isHold(downAt: number, upAt: number, thresholdMs = HOLD_THRESHOLD_MS): boolean {
  return upAt - downAt >= thresholdMs
}

/** Tunables for {@link shouldFinalize}. */
export type FinalizeConfig = {
  /** Hard cap since release — always commit past this, whatever the state. */
  maxMs: number
  /** Nothing captured (no voice, no segment) ⇒ end this quickly (fast tap / silence). */
  noVoiceGraceMs: number
  /** Mic quiet at least this long ⇒ the user has stopped speaking. */
  silenceMs: number
  /** ...and no new segment for at least this long ⇒ the backend has caught up. */
  settleMs: number
  /**
   * Minimum time since release before the silence/settle path may commit. Omi's
   * v4/listen delivers its trailing FINAL segment ~1.8s late with NO interim, so
   * a quick release can otherwise commit in the GAP before the tail lands —
   * dropping the last words. This floor holds the commit open long enough for
   * that trailing segment to arrive (the hard cap `maxMs` still bounds the wait).
   */
  trailingGraceMs: number
}

/** Live inputs to the finalize decision, sampled each poll after Space is released. */
export type FinalizeState = {
  /** Time since the key was released. */
  elapsedMs: number
  /** Whether the mic ever detected speech this hold. */
  everVoiced: boolean
  /** Time since the mic last had speech-level energy. */
  silentForMs: number
  /** Time since the last accepted segment, or null if none has arrived this hold. */
  sinceLastSegmentMs: number | null
}

/**
 * Decide whether to commit the push-to-talk capture. We wait until the user has
 * actually stopped speaking (VAD silence) AND the backend's trailing segment has
 * landed and settled — rather than a fixed delay stacked on top of the ~1.8s
 * backend latency. A capture that produced nothing ends quickly; a hard cap always
 * ends it eventually.
 */
export function shouldFinalize(s: FinalizeState, cfg: FinalizeConfig): boolean {
  if (s.elapsedMs >= cfg.maxMs) return true
  // Nothing captured at all → end fast (e.g. a key drop so quick no audio was caught).
  if (!s.everVoiced && s.sinceLastSegmentMs === null) return s.elapsedMs >= cfg.noVoiceGraceMs
  // Otherwise: hold the commit open until the backend's trailing segment has had
  // time to arrive (trailingGraceMs), THEN require you've stopped talking AND the
  // last segment has settled. Without the grace, a quick release commits in the
  // gap before the ~1.8s-late trailing segment lands and drops the last words.
  return (
    s.elapsedMs >= cfg.trailingGraceMs &&
    s.silentForMs >= cfg.silenceMs &&
    s.sinceLastSegmentMs !== null &&
    s.sinceLastSegmentMs >= cfg.settleMs
  )
}

/**
 * Merge a transcript line into the accumulated list IN PLACE. v4/listen re-sends
 * the same segment (same `id`) as it refines it and re-emits earlier segments
 * around pauses; appending those would duplicate speech, so a line whose `id`
 * matches an existing one REPLACES it. Lines without an id are treated as
 * distinct and appended.
 */
export function upsertLine(lines: TranscriptLine[], line: TranscriptLine): void {
  const idx = line.id != null ? lines.findIndex((x) => x.id === line.id) : -1
  if (idx >= 0) lines[idx] = line
  else lines.push(line)
}

/**
 * Flatten finalized transcript lines + any in-progress interim text into the
 * single string we auto-send as the chat message. Speaker labels are dropped —
 * it's all the user's own speech — and surrounding whitespace is collapsed so an
 * empty/whitespace-only capture yields '' (caller skips sending).
 */
export function assembleTranscript(lines: TranscriptLine[], interim: string): string {
  return [...lines.map((l) => l.text), interim]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}
