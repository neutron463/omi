// Global Testing Library setup for the jsdom (.tsx) suites.
//
// Testing Library's async utilities (waitFor / findBy*) default to a 1000ms poll
// window. That is fine when a suite runs alone, but the Windows test run uses the
// default forks pool (one worker per CPU) and several agents commonly run `pnpm
// test` on the same machine at once. Under that contention a plain synchronous
// React state update + re-render can take longer than 1000ms to be observable, so
// a waitFor times out and the suite flakes even though the product code is correct
// (verified: the keyboard-nav selection tests fail only under concurrent CPU load
// and pass in isolation — the state setter has no timer/rAF/race).
//
// Widen the poll window so these async utilities tolerate scheduling latency. This
// only changes HOW LONG a poll is allowed to run, never the outcome: a passing
// assertion still resolves the instant it is true (typically <100ms), and a
// genuinely failing one still fails — just after a longer, load-proof window.
//
// Import `configure` from @testing-library/dom (the shared config singleton that
// @testing-library/react's waitFor reads) rather than from @testing-library/react:
// the react entrypoint registers a global afterEach(cleanup) on import, which this
// setup file — loaded into EVERY suite, including the node-environment ones — must
// not do. The dom entrypoint's `configure` is a pure config write.
import { configure } from '@testing-library/dom'

configure({ asyncUtilTimeout: 5000 })
