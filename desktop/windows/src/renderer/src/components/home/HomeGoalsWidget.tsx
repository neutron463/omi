import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { omiApi } from '../../lib/apiClient'
import { auth, onAuthStateChanged } from '../../lib/firebase'
import { cn } from '../../lib/utils'
import { goalEmoji } from '../../lib/goalEmoji'
import { isCompleted, progressColor, progressLabel, progressPct } from '../../lib/goalVisuals'
import { GenerateGoalsButton } from '../ui/GenerateGoalsButton'
import { GoalCelebration } from '../goals/GoalCelebration'

// Home dashboard goals widget — the Windows port of the macOS legacy
// `GoalsWidget` (`Components/GoalsWidget.swift`), the goals surface real Mac
// users actually see (the "canonical" FocusedGoalsSection is gated dead on
// ordinary accounts — no backend). Reads the same active-goals feed the Goals
// page uses (`/v1/goals/all`, is_active only, capped ~4 by the backend) and
// renders each goal as Mac's `GoalRowView`: a 36x36 rounded emoji tile, the
// title, and a 5-stage threshold progress bar. The emoji, progress color, and
// completion overlay come from the shared goal primitives so Home and the Goals
// page render identically.
//
// Self-contained + droppable: it owns its own data fetching and takes only
// navigation callbacks (it never decides routes). The mount into the Home hub
// is a separate Track-5 step; this component is not mounted anywhere yet.
//
// Deviations from Mac's GoalRowView, by design: no drag-to-update progress thumb
// (updating progress is the Goals page's job — this widget is read + navigate
// only) and no inline "+"/edit/insight affordances (same reason).

export interface HomeGoal {
  id: string
  title: string
  target_value?: number | null
  current_value?: number | null
  // Done when is_active === false (matches the live backend Goal model).
  is_active?: boolean | null
  unit?: string | null
}

export interface HomeGoalsWidgetProps {
  // Open the full Goals page (header affordance). Omitted → header shows no
  // "All goals" link.
  onShowAll?: () => void
  // Open a specific goal (row tap). Omitted → rows are non-interactive.
  onOpenGoal?: (id: string) => void
  // Kick off AI goal generation from the empty state. Omitted → the empty state
  // shows a plain message instead of the generate button (this widget never
  // owns generation itself).
  onGenerate?: () => void
}

// Mac's legacy GoalsWidget shows the "+" only while there are fewer than 4
// goals, i.e. it tops out at 4 active goals; the backend caps `/v1/goals/all`
// similarly. Slice as a belt so the widget never grows unbounded.
const MAX_SHOWN = 4

export function HomeGoalsWidget({
  onShowAll,
  onOpenGoal,
  onGenerate
}: HomeGoalsWidgetProps): React.JSX.Element {
  // null = not loaded yet; [] = loaded, no active goals.
  const [goals, setGoals] = useState<HomeGoal[] | null>(null)
  const [error, setError] = useState(false)
  const [celebrating, setCelebrating] = useState<HomeGoal | null>(null)

  // Track the signed-in user so the fetch waits for (and re-runs on) auth being
  // ready. On a cold start the Home panel can mount before Firebase restores the
  // user, so an ungated fetch would go out unauthenticated, fail, and never
  // retry — the same trap `QuickGoalsWidget` documents.
  const [userId, setUserId] = useState<string | null>(auth.currentUser?.uid ?? null)
  useEffect(() => onAuthStateChanged(auth, (u) => setUserId(u?.uid ?? null)), [])

  // Goal ids we've already celebrated, so a re-render / refetch never re-fires
  // the overlay. Seeded on the first successful load with whatever is already
  // complete, so opening Home doesn't throw a party for a goal finished earlier
  // — the celebration only fires when a goal crosses the finish line while the
  // widget is mounted (an external progress update + refetch).
  const firedRef = useRef<Set<string>>(new Set())
  const seededRef = useRef(false)

  const applyGoals = useCallback((list: HomeGoal[]): void => {
    const active = list.slice(0, MAX_SHOWN)
    const completed = active.filter(isCompleted)
    if (!seededRef.current) {
      seededRef.current = true
      completed.forEach((g) => firedRef.current.add(g.id))
    } else {
      const fresh = completed.find((g) => !firedRef.current.has(g.id))
      // Mark every newly-complete goal as fired so we celebrate at most once and
      // never queue a backlog; show the first one.
      completed.forEach((g) => firedRef.current.add(g.id))
      if (fresh) setCelebrating(fresh)
    }
    setError(false)
    setGoals(active)
  }, [])

  const fetchGoals = useCallback((): (() => void) => {
    let cancelled = false
    omiApi
      .get('/v1/goals/all')
      .then((res) => {
        const data = res.data as HomeGoal[] | { goals?: HomeGoal[] }
        const list = Array.isArray(data) ? data : (data.goals ?? [])
        if (!cancelled) applyGoals(list)
      })
      .catch(() => {
        // Keep any previously-loaded goals on a transient failure; only surface
        // the error state if we have never loaded (seededRef flips on the first
        // successful load).
        if (!cancelled && !seededRef.current) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [applyGoals])

  // Primary fetch: once auth is ready (and again if the user changes).
  useEffect(() => {
    if (!userId) return
    return fetchGoals()
  }, [userId, fetchGoals])

  // Refetch when the window regains focus, so a goal added or completed
  // elsewhere (Goals page, another window) shows up — and celebrates — without
  // navigating away.
  useEffect(() => {
    const onFocus = (): void => {
      if (auth.currentUser) fetchGoals()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchGoals])

  return (
    <section className="flex w-full flex-col gap-4 rounded-[20px] border border-[color:var(--border)] bg-[color:var(--surface)] p-[22px]">
      <header className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-[color:var(--text-primary)]">Goals</h2>
        {goals && goals.length > 0 && (
          <span className="text-sm text-[color:var(--text-quaternary)]">{goals.length}</span>
        )}
        <span className="flex-1" />
        {onShowAll && (
          <button
            type="button"
            onClick={onShowAll}
            className="group inline-flex items-center gap-0.5 text-[13px] font-medium text-[color:var(--text-tertiary)] transition-colors hover:text-[color:var(--text-primary)]"
          >
            All goals
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </header>

      {goals === null ? (
        error ? (
          <ErrorState onRetry={fetchGoals} />
        ) : (
          <LoadingState />
        )
      ) : goals.length === 0 ? (
        <EmptyState onGenerate={onGenerate} />
      ) : (
        <div className="flex flex-col gap-3.5">
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} onOpen={onOpenGoal} />
          ))}
        </div>
      )}

      {celebrating && (
        <GoalCelebration
          goal={{
            title: celebrating.title,
            target_value: celebrating.target_value,
            unit: celebrating.unit
          }}
          onDone={() => setCelebrating(null)}
        />
      )}
    </section>
  )
}

// A single goal row — Mac's `GoalRowView`: emoji tile + title + progress label +
// threshold-colored bar. Tapping opens the goal (navigation only).
function GoalRow({
  goal,
  onOpen
}: {
  goal: HomeGoal
  onOpen?: (id: string) => void
}): React.JSX.Element {
  const pct = progressPct(goal)
  const interactive = !!onOpen
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={interactive ? () => onOpen(goal.id) : undefined}
      className={cn(
        'flex items-center gap-3.5 rounded-2xl bg-[color:var(--bg-tertiary)] px-3.5 py-3 text-left transition-colors',
        interactive && 'hover:bg-[color:var(--bg-quaternary)]'
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:var(--bg-raised)] text-base leading-none"
      >
        {goalEmoji(goal.title)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--text-primary)]">
            {goal.title}
          </span>
          <span className="shrink-0 text-[11px] text-[color:var(--text-tertiary)]">
            {progressLabel(goal)}
          </span>
        </span>
        <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <span
            className="block h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: progressColor(pct / 100) }}
          />
        </span>
      </span>
    </button>
  )
}

function LoadingState(): React.JSX.Element {
  return (
    <div role="status" aria-label="Loading goals" className="flex flex-col gap-3.5">
      {[0, 1].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex items-center gap-3.5 rounded-2xl bg-[color:var(--bg-tertiary)] px-3.5 py-3"
        >
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-white/10" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
            <span className="h-1.5 w-full animate-pulse rounded-full bg-white/10" />
          </span>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ onGenerate }: { onGenerate?: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      {onGenerate ? (
        <GenerateGoalsButton onClick={onGenerate} label="Generate AI Goal" />
      ) : (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">No goals yet.</p>
      )}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <p className="text-[13px] text-[color:var(--text-tertiary)]">Couldn&apos;t load goals.</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-[13px] font-medium text-[color:var(--text-primary)] underline-offset-2 hover:underline"
      >
        Try again
      </button>
    </div>
  )
}
