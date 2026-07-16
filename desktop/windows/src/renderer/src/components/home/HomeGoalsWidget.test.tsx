// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { HomeGoalsWidget, type HomeGoal } from './HomeGoalsWidget'

// Drive the shared axios `omiApi` (same client the Goals page + QuickGoalsWidget
// use). goalsGet is re-scriptable per test via mockResolvedValueOnce.
const goalsGet = vi.fn()
vi.mock('../../lib/apiClient', () => ({
  omiApi: {
    get: (...args: unknown[]) => goalsGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  },
  desktopApi: { get: vi.fn(), post: vi.fn() }
}))

// Auth is ready with a signed-in user so the widget's auth-gated fetch runs on
// mount (and the focus refetch proceeds).
vi.mock('../../lib/firebase', () => ({
  auth: { currentUser: { uid: 'u1' } },
  onAuthStateChanged: (_auth: unknown, cb: (u: { uid: string }) => void) => {
    cb({ uid: 'u1' })
    return () => {}
  }
}))

// Stub the celebration overlay with an identifiable marker so the test verifies
// the widget's fire-once logic, not GoalCelebration's timed internals (covered
// by its own test).
vi.mock('../goals/GoalCelebration', () => ({
  GoalCelebration: ({ goal }: { goal: { title: string } }) => (
    <div data-testid="celebration">{goal.title}</div>
  )
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const goal = (over: Partial<HomeGoal> & Pick<HomeGoal, 'id' | 'title'>): HomeGoal => ({
  target_value: 24,
  current_value: 6,
  is_active: true,
  ...over
})

// Flush the pending fetch microtasks (real timers) so state settles.
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('HomeGoalsWidget', () => {
  it('shows the loading state before the fetch resolves', () => {
    goalsGet.mockReturnValue(new Promise(() => {})) // never resolves
    render(<HomeGoalsWidget />)
    expect(screen.getByRole('status', { name: 'Loading goals' })).toBeTruthy()
  })

  it('renders active goals with their emoji and progress', async () => {
    goalsGet.mockResolvedValueOnce({
      data: [goal({ id: 'g1', title: 'Run a marathon', current_value: 6, target_value: 24 })]
    })
    const { container } = render(<HomeGoalsWidget onOpenGoal={vi.fn()} />)
    await flush()

    // Title, the shared goalEmoji glyph (🏃 for "run"/"marathon"), and the
    // shared progressLabel (current / target) all render.
    expect(screen.getByText('Run a marathon')).toBeTruthy()
    expect(container.textContent).toContain('🏃')
    expect(screen.getByText('6 / 24')).toBeTruthy()

    // The progress fill is sized from progressPct (6/24 = 25%) with an inline
    // color from progressColor (never empty).
    const fill = container.querySelector('span[style*="25%"]') as HTMLElement | null
    expect(fill).toBeTruthy()
    expect(fill?.style.backgroundColor).toBeTruthy()
  })

  it('opens a goal when a row is tapped', async () => {
    const onOpenGoal = vi.fn()
    goalsGet.mockResolvedValueOnce({ data: [goal({ id: 'g1', title: 'Read 24 books' })] })
    render(<HomeGoalsWidget onOpenGoal={onOpenGoal} />)
    await flush()

    fireEvent.click(screen.getByText('Read 24 books'))
    expect(onOpenGoal).toHaveBeenCalledWith('g1')
  })

  it('shows the Generate AI Goal button in the empty state and fires onGenerate', async () => {
    const onGenerate = vi.fn()
    goalsGet.mockResolvedValueOnce({ data: [] })
    render(<HomeGoalsWidget onGenerate={onGenerate} />)
    await flush()

    const btn = screen.getByRole('button', { name: /Generate AI Goal/i })
    fireEvent.click(btn)
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error state with a retry when the first load fails', async () => {
    goalsGet.mockRejectedValueOnce({ response: { status: 500 } })
    render(<HomeGoalsWidget />)
    expect(await screen.findByText("Couldn't load goals.")).toBeTruthy()

    // Retry refetches and recovers.
    goalsGet.mockResolvedValueOnce({ data: [goal({ id: 'g1', title: 'Ship the app' })] })
    fireEvent.click(screen.getByText('Try again'))
    await flush()
    expect(screen.getByText('Ship the app')).toBeTruthy()
  })

  it('celebrates a goal that crosses the finish line while mounted', async () => {
    // First load: in progress → no celebration (and seeds the fired set).
    goalsGet.mockResolvedValueOnce({
      data: [goal({ id: 'g1', title: 'Run a marathon', current_value: 6, target_value: 24 })]
    })
    render(<HomeGoalsWidget />)
    await flush()
    expect(screen.queryByTestId('celebration')).toBeNull()

    // Refetch (window focus) with the same goal now complete → celebrate once.
    goalsGet.mockResolvedValueOnce({
      data: [goal({ id: 'g1', title: 'Run a marathon', current_value: 24, target_value: 24 })]
    })
    fireEvent.focus(window)
    await flush()
    expect(screen.getByTestId('celebration').textContent).toBe('Run a marathon')
  })

  it('does not celebrate a goal that is already complete on first load', async () => {
    goalsGet.mockResolvedValueOnce({
      data: [goal({ id: 'g1', title: 'Ship it', current_value: 1, target_value: 1 })]
    })
    render(<HomeGoalsWidget />)
    await flush()
    expect(screen.queryByTestId('celebration')).toBeNull()
  })
})
