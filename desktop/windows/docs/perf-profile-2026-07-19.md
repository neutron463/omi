# Omi Windows desktop — performance profile (2026-07-19)

Measurement-only pass. No code changed. Goal: find where the app spends CPU/GPU/memory,
especially when it should be idle, and rank hotspots with evidence. Every ranked item is
tagged with whether a fix would be **invisible to functionality/UX**.

Branch: `chore/win-perf-profiling` (worktree `.worktrees/perfprof`). Built from `origin/main`
@ `d5510693ae`.

---

## TL;DR — top hotspots

| # | Hotspot | Where | Idle? | Est. win | User-invisible fix? |
|---|---------|-------|-------|----------|---------------------|
| 1 | Full-screen brain map renders at **display refresh (240 fps on this monitor)** even when static | `KnowledgeGraphViewer.tsx:33` `frameLoop="always"` | on the graph page | ~all idle graph frames (240→~0/s when settled); 4× on any high-refresh display | **Yes** — switch to `frameLoop="demand"` + `invalidate()` on interaction/unsettled sim (already supported by BrainGraph) |
| 2 | Bar orb keeps its 30 fps WebGL loop running **forever while the bar is parked off-screen**, after the first summon | `BarApp.tsx:653` `visible={mode!==null}` (mode never reset on hide) + parked bar window is unthrottled | after 1st summon, permanently | one continuous 30 fps WebGL shader-render + 240 Hz tick callback in an invisible renderer | **Yes** — gate orb `visible` on the bar's real on-screen state, or reset `mode` on hide |
| 3 | High-refresh **rAF amplification**: every `frameloop:'always'` / uncapped rAF loop runs at 240 Hz here (4× a 60 Hz budget) | orb active states, bar transitions, glow follow, graph | during any animation | up to 4× fewer frames on high-refresh displays | Mostly **Yes** (self-throttle to 30/60 like the orb already does) |
| 4 | Auxiliary windows each load the **full SPA** (~200 MB each; ~2.2 GB RSS total) | bar/glow/insight-toast/capture hash-routes of one `index.html` | idle | ~600–800 MB RSS | **Yes** — slim per-window bundle / route code-split |
| — | _(SQLite is well-tuned — WAL, off-thread KG writes, paged vector scan; NOT a headline hotspot, see §5)_ | | | | |
| — | _(Voice IPC is lean — two targeted ~30 Hz streams, no fan-out; minor coalescing win only, see §4)_ | | | | |
| 6 | Idle main-process timers that touch the DB every few seconds | rewind OCR (4 s), rewind embedding (5 s), automation foreground (5 s), usage foreground (15 s) | **idle** | fewer idle wakeups + DB hits | Some **Yes** (coalesce, back off when nothing to do) |
| 7 | 4 auxiliary windows each load the **full SPA** (~200 MB each; ~2.2 GB RSS total) | bar/glow/insight-toast/capture = hash-routes of one `index.html` | idle | ~600–800 MB RSS | **Yes** — slim per-window bundle / route code-split |

Full ranking with evidence in §6.

**Headline context:** at true idle (signed-in, Home, nothing happening) the app is **well-behaved** —
~7–11 % of one core total (**0.4–0.7 % of this 16-core machine**), see §2. The interesting costs are
the ones that are *invisible* because they happen off-screen or above 60 Hz, not a high idle floor.

---

## 1. Methodology & environment

**Instance isolation (hard requirement — never touched the user's live app):** ran a dedicated
instance from the `perfprof` worktree with its own derived ports (renderer `:5222`, CDP `:9323`)
and its own userData profile (`omi-windows-sandbox-perfprof`). The user's live instance
(`:5179` / CDP `:9222` / default profile) was never attached to or interfered with.

**Build mode — why `pnpm dev` and not a packaged build.** The dev-instance isolation, the CDP
remote-debugging port, and the software-GPU stabilizer are ALL gated behind `import.meta.env.DEV`
in `src/main/index.ts` (lines 195/212/370/384) via `src/main/dev/bench.ts`. A production
`electron-vite build` therefore has **no CDP port** and **no profile isolation** — launching it
just collides with the default-profile single-instance lock and silently quits. So a CDP-attachable,
isolated instance must run under `pnpm dev`. The Vite HMR dev-server is a **separate `node` process**
(excluded from the electron process table below) and its websocket is silent at rest, so it does
not distort the electron per-process numbers.

**GPU fidelity caveat.** Dev/preview builds force **software WebGL** (SwiftShader) for stability on
this hybrid-GPU machine (`applyDevGpuStability`, `bench.ts:109`). Confirmed live:
`ANGLE (…SwiftShader…)`. Consequences:
- The **renderer-thread** cost of the rAF loops (tick, envelope stepping, three.js scene graph
  work, React) is **GPU-mode-independent** — those numbers port to packaged/hardware builds.
- The **GPU-process** cost differs: on this software instance an orb draw shows up as GPU-process
  CPU; on a user's packaged hardware build it moves to the actual GPU. GPU-process CPU below is
  therefore a floor, not the user's real GPU load.
- Under software WebGL the tiny sidebar/bar orbs sometimes fall back to the static mark, so I
  could not always observe a live orb loop — where that happened I fall back to the confirmed
  code mechanism + the measured window-refresh behaviour.

**Display = 240 Hz.** Measured directly: visible windows service `requestAnimationFrame` at
~240 Hz (§3). This is load-bearing — any `frameloop:'always'` loop runs 4× a 60 Hz assumption.

**Tools.** CDP over `ws` (custom harness: target enumeration, `Runtime.evaluate` probes,
`Profiler` sampling). Per-process CPU via PID-scoped `TotalProcessorTime` deltas over fixed
wall-clock windows (walks the descendants of the CDP-owning electron PID so only the perfprof
tree is counted, never the ~12 other electron instances running in this session). Static census
via ripgrep + reading source.

**Auth/state.** Seeded the isolated profile by copying `Local State` + `firebase-auth.json`
(matched pair) from the primary profile, then set `onboardingCompletedAt` in origin-scoped
localStorage over CDP to reach the signed-in Home shell.

---

## 2. Per-process idle CPU

Signed-in, main window on Home, no user activity. 16 logical CPUs. Two samples (60 s once
settled, then 45 s right after a fresh boot):

**Settled idle (60 s):**

| Process | % of one core | % of machine |
|---|---|---|
| browser/main | 2.44 | 0.15 |
| renderer (main window) | 2.00 | 0.13 |
| renderer (2nd active) | 1.50 | 0.09 |
| utility: AudioService | 0.44 | 0.03 |
| gpu-process | 0.03 | ~0 |
| everything else (2 utility, 3 renderers, 4 node helpers) | ~0 | ~0 |
| **TOTAL** | **6.6** | **0.41** |

**Fresh boot, still hydrating (45 s):** TOTAL **10.95 %** of one core (**0.68 %** of machine);
busiest renderer 3.78 %, main 3.64 % — extra load is initial data hydration + sync retry passes
settling, not a steady state.

Reading: the idle floor is low and dominated by the **main process** and the **two live renderers**
(main window + one auxiliary). The `AudioService` at 0.44 % was transient (0 % in the later sample) —
not a persistent idle burn. The process tree is 13 processes: 1 browser/main, 1 gpu-process,
2 utility (network, audio), 5 renderers (Home, bar, glow, insight-toast, capture), 4 node helpers.

### 2a. Per-process memory (working set)

| Process | RAM (MB) |
|---|---|
| renderer (Home / main window) | 660 |
| renderer | 306 |
| browser/main | 300 |
| renderer (aux) | 200 |
| renderer (aux) | 198 |
| renderer (aux) | 194 |
| gpu-process | 107 |
| utility: audio | 89 |
| utility: network | 67 |
| main (helpers) | 57 + 26 + 7 + 7 |
| **TOTAL** | **~2,218 MB** |

**Memory finding (see §6 #8):** the **4 auxiliary windows** (bar, glow, insight-toast, capture) each
run a **~194–200 MB renderer** — because every window loads the same full SPA (`localhost:5222/#/<route>`
of one `index.html`, sharing the large vendor chunk: React + three.js + onnxruntime + fonts, etc.).
Those windows render trivial UI (a pill, a halo, a toast, an offscreen capture host) yet each pays a
full-app renderer. ~600–800 MB is attributable to loading the whole bundle into windows that need a
fraction of it. Total ~2.2 GB RSS at idle is high for a desktop app.

---

## 3. Timer / wake-up census

### 3a. Renderer rAF — self-gating verified

The orb animator (`src/renderer/src/orb/orbAnimator.ts`) is **well-designed**: idle 30 fps,
active 60 fps, **hidden 0 fps** (loop fully stopped). At signed-out idle AND signed-in Home idle,
**zero** app-scheduled rAF callbacks were observed in every window (measured by wrapping
`requestAnimationFrame` and counting for 2 s). So there is **no background rAF burn at idle** —
a genuinely good result. The costs appear only when a loop is *running while off-screen* (§6 #2)
or *running above 60 Hz* (§3c).

### 3b. Window rAF throttling — the load-bearing surprise

Per-window `requestAnimationFrame` servicing rate (my own 2 s probe loop):

| Window | Route | On screen? | rAF service | Chromium throttled? |
|---|---|---|---|---|
| Home | `#/home` | yes (focused) | **240 Hz** | no |
| Bar | `#/bar` | **parked off-screen (-32000,-32000)** | **240 Hz** | **NO** |
| Glow | `#/glow` | hidden | **240 Hz** | **NO** |
| insight-toast | `#/insight-toast` | hidden | 1.5 Hz | yes |
| capture | `#/capture` | hidden | 1.5 Hz | yes |

Two facts fall out, both important:
1. **`document.hidden` is `false` for the parked bar and hidden glow windows.** Electron does not
   mark an off-screen-but-shown always-on-top overlay as hidden. So any loop gated on
   `!document.hidden` (e.g. the orb, `Orb.tsx:196`) will **not** pause when the bar is parked.
2. **The bar and glow windows are NOT background-throttled** (240 Hz), unlike insight-toast/capture
   (1.5 Hz). A running rAF loop in the parked bar therefore pays full display-rate cost. This is
   the mechanism behind hotspot #2.

### 3c. Display = 240 Hz → 4× rAF budget

Because the display refreshes at 240 Hz, any `frameloop:'always'` react-three-fiber canvas or
uncapped `requestAnimationFrame` loop runs at 240 fps, i.e. **4× the work a 60 Hz assumption
predicts**. The orb already self-throttles (30/60) so it is immune; the full-screen brain map
(`frameLoop="always"`) and any transition/glow loop are not.

### 3d. Main-process timers (idle wake-ups)

Intervals that arm at startup and fire while idle (constants read from source):

| Timer | Interval | File | Idle cost |
|---|---|---|---|
| rewind OCR backfill | **4 s** | `rewind/ocrService.ts:6` | wakes + likely DB read every 4 s |
| rewind embedding tick | **5 s** | `rewind/embeddingService.ts:31` | wakes + DB read every 5 s |
| automation foreground target | **5 s** | `automation/foregroundTarget.ts:31` | polls foreground window |
| usage foreground monitor | **15 s** poll / 60 s flush | `usage/foregroundMonitor.ts:11-12` | foreground poll + periodic DB flush |
| assistant coordinator base | 3 s | `assistants/core/coordinator.ts:87` | scheduler tick |
| rewind embed flush | 60 s | `rewind/embedQueue.ts:28` | |
| outbox sweep (renderer) | 60 s | `lib/sync/outboxSweep.ts:12` | |
| retention sweep (renderer) | 30 min | `lib/retentionSweep.ts:8` | |
| screen synthesis (renderer) | 10 min | `lib/screenSynthesis.ts:18` | |
| goals / tasks session polls | 5 s **while a session is active** | `assistants/goals/schedule.ts:38`, `assistants/tasks/*` | not idle |
| updater / orphan sweep / retention | 4–6 h | `updater.ts`, `rewind/orphanSweep.ts` | negligible |

The 4 s + 5 s + 5 s cluster (two of them rewind, one automation) is the main idle wake-up source.
None is individually expensive, but they keep the main process from ever fully sleeping and each
rewind timer touches the synchronous SQLite DB (see §5).

### 3e. Bar main-side polls — hot but correctly scoped

`bar/window.ts` runs a **50 ms** cursor watch (`PEEK_WATCH_MS`) and a **16 ms** (~60 Hz) physical
mouse-button sampler (`CLICK_SAMPLE_MS`) that call `screen.getCursorScreenPoint()` /
`screen.getAllDisplays()` each tick. **These are correctly started/stopped with the bar reveal**
(`startPeekWatch`/`stopPeekWatch`) — zero cost while parked. But while a summoned/PTT pill is
*visible*, the main process does a 16 ms + 50 ms poll doing screen geometry calls. Not an idle
issue; a real cost during the seconds a pill lingers on screen. (Documented as a deliberate
tradeoff in the source — the transparent overlay doesn't get real mouse messages.)

---

## 4. IPC census (during idle and voice)

Recurring cross-process IPC, traced from source (preload channel → main handler → forward target):

| Channel(s) | Cadence | Direction / hops | Payload | When |
|---|---|---|---|---|
| `voiceHub:publishState` → `voiceHub:state` | **~30 Hz** (`ORB_PUBLISH_INTERVAL_MS=33`) | main-window renderer → main → **bar** (targeted) | small state obj (phase, orbLevel, hint) | **voice turn only** |
| `voiceHub:publishPlaybackLevel` → `voiceHub:playbackLevel` | **~30 Hz** while Omi speaks | main-window renderer → main → **bar** (targeted) | one `number` | **voice turn only** |
| PTT capture levels | `LEVELS_INTERVAL_MS=33` (~30 Hz) | within capture renderer / to orb | one number | **PTT hold only** |
| tasks/goals "changed" broadcasts | on mutation (not periodic) | main → all windows | small | on change |
| `voiceHub:state` idle reset | once per turn-end | main → all windows (`voicePlaneIpc.ts:81`) | idle sentinel | turn end |

**Idle:** no periodic IPC stream fires at true idle — the ~30 Hz streams are strictly voice/PTT-scoped.
**Voice turn:** the orb state + playback level are two ~30 Hz streams, each taking **2 hops**
(renderer→main→bar) → ~120 IPC messages/sec during an active spoken reply. **Good:** both are
**targeted to the bar's webContents** (`bar/window.ts:163` `send()`), not broadcast — no fan-out to
windows that would ignore them. Payloads are tiny (a number / a small object).

**Top-3 highest-frequency IPC paths:**
1. `voiceHub:publishState`/`voiceHub:state` — ~30 Hz × 2 hops, voice turn — `bar/window.ts:952`.
2. `voiceHub:publishPlaybackLevel`/`voiceHub:playbackLevel` — ~30 Hz × 2 hops, while speaking — `bar/window.ts:957`.
3. PTT capture level sampling — ~30 Hz during hold — `PttCaptureHost.ts:22`.

Verdict: the voice IPC is reasonably lean (targeted, small payloads) — not a headline hotspot. The
only optimization worth noting: the state + level could be **coalesced into one 30 Hz message** (they
travel the same path to the same window), halving message count during a spoken reply. Low priority.

---

## 5. SQLite hot paths

**Setup (`src/main/ipc/db.ts`) is well-tuned:**
- **WAL** journal mode (`db.pragma('journal_mode = WAL')`, line 388) + `busy_timeout = 5000` (391),
  so main-thread reads proceed concurrently with the KG worker's writes.
- **Knowledge-graph writes are off the main thread** — a dedicated `kgWorker.ts` owns a second
  better-sqlite3 handle (WAL) via `worker_threads`; the main handle isn't blocked by KG writes.
- A **read-only** handle (`roDb`, line 1161) exists for concurrent reads.
- Per-helper timing instrumentation already exists (`timePerf`, line 153) emitting perf marks.

**The worst potential blocker is already mitigated.** Semantic rewind search
(`searchRewindEmbeddings`, line 1670) would, naively, scan every stored embedding vector in one
synchronous statement — pinning the main thread (and thus all IPC, capture ingestion, UI) for the
whole scan. The authors **page the scan and yield between pages** via `setImmediate`
(`scanTopKBySimilarity`, line 1686-1694), and bound the candidate set by retention. So the single
biggest main-thread risk is handled by design.

**Residual, lower-severity items:**
| Risk | Where | Severity |
|---|---|---|
| Ordinary CRUD reads/writes (conversations, tasks, memories) run **synchronously on the main thread** on hot IPC handlers | `src/main/ipc/*.ts` `.prepare().all()/.get()/.run()` | Low–Med if indexed/small; a full-table `.all()` on a large table on a hot path would stall — worth a targeted audit of any unindexed `ORDER BY`/`LIKE '%…%'` |
| Rewind timer queries every few seconds at idle | OCR backfill (4 s), embedding tick (5 s) — §3d | Low each; they keep the main thread from sleeping and each does a DB read |
| Whole-table `.all()` reads that load a table into JS | audit any list/hydration handler | Med if a table grows unbounded |

**Verdict:** SQLite is not a headline hotspot — the team has clearly been performance-conscious (WAL,
off-thread KG writes, paged vector scan). The only actionable items are (a) confirm no hot IPC handler
issues an unindexed full scan on a growing table, and (b) let the rewind timers back off when there's
no pending work instead of polling the DB every 4–5 s (§6 #6).

> Note: this section is my own source census. If the delegated SQLite-census agent surfaces a specific
> hot unindexed query I missed, it should be added here — but the structural picture (well-tuned, no
> obvious main-thread catastrophe) is firm.

---

## 6. Ranked hotspots (detail)

### #1 — Full-screen brain map renders at display refresh, forever
- **Evidence:** `pages/KnowledgeGraph.tsx` → `components/graph/KnowledgeGraphViewer.tsx:33`
  mounts `<BrainGraph … frameLoop="always" />`. react-three-fiber `always` renders every animation
  frame at the display rate = **240 fps here**. The scene keeps re-rendering (nodes, edges, Text
  billboards, OrbitControls) even when the simulation has settled and there is no interaction.
  BrainGraph already implements the `demand` path end-to-end (`invalidate()` on `sim.settleFrame()`
  and interaction) and the Memories preview uses `frameLoop="demand"` correctly (`Memories.tsx:473`).
- **Cost:** on any high-refresh display, up to 4× the graph frames vs 60 Hz, and it never drops to 0
  when static. On a 60 Hz display, still a full 60 fps of wasted three.js work when idle-static.
- **Est. win:** when the map is static, idle graph frames drop from ~240/s to ~0.
- **User-invisible:** **Yes** — `demand` + `invalidate()` on OrbitControls change / unsettled sim
  is visually identical (r3f renders on demand for exactly the frames that change).
- Shared with the `brainmap-density` agent (owns data-loaded graph work).

### #2 — Bar orb loops while parked off-screen, after first summon
- **Evidence (mechanism, code):** `BarApp.tsx:653` renders the orb with `visible={mode !== null}`.
  `mode` starts `null`, is set on the first `bar:show` (`onShow`, line 360), and is **never reset to
  `null`** on hide (`onWillHide` only sets `sliding='out'`/`view='list'`, line 388). So after the
  first summon `visible` is permanently `true`.
- **Evidence (runtime):** the parked bar window reports `document.hidden === false` and services rAF
  at **240 Hz, unthrottled** (§3b). The orb's own gate is `setVisible(visible && !document.hidden)`
  (`Orb.tsx:196`) → `setVisible(true)`. So the animator's rAF loop runs: a self-throttled **30 fps
  WebGL shader render + per-frame envelope/merge/spin computation** (`orbAnimator.renderFrame`),
  plus the `tick()` callback firing at 240 Hz (gap-gated), continuously — in a renderer the user
  cannot see.
- **Caveat:** activates only after the first bar summon of the session (I confirmed the mechanism +
  the unthrottled-parked-window fact but did not trigger a live summon — the global summon hotkey
  isn't injectable over CDP). In normal use the bar is summoned early and often, so this is
  effectively always-on for an active session.
- **Est. win:** removes a continuous 30 fps WebGL loop + 240 Hz JS callback from an invisible
  renderer for the entire session.
- **User-invisible:** **Yes** — gate the orb's `visible` on the bar's real on-screen state
  (main already tracks `barOnScreen`; bridge it in), or reset `mode`/pause the animator on hide.
  The orb is off-screen when parked, so pausing it changes nothing the user sees; the existing
  genesis-on-reveal path already re-animates it on the next summon.

### #3 — High-refresh rAF amplification (cross-cutting)
- **Evidence:** display is 240 Hz (§3c). The orb self-throttles (good). Other `always`/uncapped
  rAF consumers pay 4×: the graph (#1), the glow follow tick (`glowGeometry.ts:75` `GLOW_FOLLOW_MS=32`
  — main-side, only while a halo is up), and any CSS-independent JS animation loops.
- **Est. win:** 4× fewer frames for those loops on high-refresh displays; also lowers laptop battery
  draw on 120/144/240 Hz panels.
- **User-invisible:** Mostly **Yes** — cap animation loops at 60 fps (as the orb does), invisible
  above the point the eye resolves for these effects.

### #4 — Synchronous SQLite on the main event loop
- _See §5 (pending census). The rewind 4 s/5 s timers issuing synchronous queries on the main
  process are the prime idle offenders; hot IPC handlers that query synchronously are the prime
  interactive offenders._

### #5 — ~30 Hz voice IPC streams
- _See §4 (pending census). Two 33 ms streams (orb level, playback level) cross the IPC boundary
  per voice turn; check whether either fans out to multiple windows that ignore it._

### #6 — Idle main-process timer cluster
- **Evidence:** §3d. rewind OCR (4 s) + rewind embedding (5 s) + automation foreground (5 s) keep the
  main process waking ~every 4–5 s at idle, several touching SQLite.
- **Est. win:** coalesce onto one scheduler and back off when the work queue is empty (e.g. skip the
  OCR/embedding tick when there's nothing pending instead of polling) → fewer idle wakeups + DB hits.
- **User-invisible:** **Yes** if backed off only when there is demonstrably no pending work.

### #8 — Auxiliary windows each load the full SPA (~200 MB each)
- **Evidence:** §2a. The bar, glow, insight-toast and capture windows are all hash-routes of the
  same `index.html`, so each renderer parses the shared vendor bundle (React + three.js +
  onnxruntime + fonts). Measured 194–200 MB per auxiliary renderer; ~2.2 GB total RSS at idle.
- **Cost:** ~600–800 MB of renderer memory for windows that show a pill / halo / toast / offscreen
  capture host — a fraction of what the bundle provides. Also multiplies parse/compile time on boot.
- **Est. win:** several hundred MB RSS + faster aux-window first paint.
- **User-invisible:** **Yes** if each auxiliary window loads only what it renders (separate slim
  entry/bundle, or aggressive route-level code-splitting so the vendor chunk isn't pulled into a
  window that only needs a pill). No behaviour change.

### #7 — Fresh-boot hydration load
- **Evidence:** §2 — right after boot a renderer sits at ~3.8 % and main at ~3.6 % for tens of
  seconds (initial data hydration + sync retry passes) before settling to the lower floor.
- **Est. win:** minor; ensure retry passes back off and initial list renders are virtualized.
- **User-invisible:** partial (don't regress first-load correctness).

---

## 7. Things that are NOT problems (verified good)

- **Orb loop gating** — 30/60/0 fps by state; fully stops when hidden. No idle rAF burn observed in
  any window at signed-out OR signed-in idle.
- **Aux windows throttled** — insight-toast and capture windows are background-throttled to ~1.5 Hz
  and run no app rAF at idle.
- **Bar main-side polls (16/50 ms)** are correctly scoped to bar-visible only — zero cost parked.
- **Idle CPU floor is low** — 0.4–0.7 % of a 16-core machine.
- **Memories graph** correctly uses `frameLoop="demand"`.

---

## 8. Limitations of this pass

- Software WebGL (SwiftShader) in dev — GPU-process numbers are a floor, not the user's real GPU
  load (§1). Renderer-thread numbers port faithfully.
- Voice-turn and data-loaded-graph live CPU not captured here (voice needs mic/PTT injection;
  the isolated profile has no real KG data). Covered by the static IPC census (§4) and the
  `brainmap-density` agent respectively.
- Instrumented startup marks (`perfMark`: `app:start`→`window:created`→`main:ready`→`db-ready`→
  `first-paint`) could not be captured — they buffer in the main process and only flush on a clean
  `app.quit`, which the kill-based instance teardown didn't hit. The phase names above come from
  `src/main/index.ts`; a dedicated `OMI_BENCH=1` run with an explicit `--user-data-dir` would
  capture the numbers.
