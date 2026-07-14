# macOS UI Spec — Tasks & Goals

> **⚠ Product rulings (2026-07-14, Chris) — these override any contrary guidance below:**
> 1. **Purple ports as-is.** Mac's purple (`#8B5CF6` accents, `#7A4DF2` Home glow, purple user bubbles, etc.) is copied faithfully to Windows. Ignore any instruction below to neutralize/substitute it. The INV-UI-1 invariant + guard test get updated in the first purple-introducing PR (owned by the UI Foundation track).
> 2. **Same as Mac, not ahead.** Where this spec rates a Windows surface "ahead" of Mac, the Mac v0.12.72 design still wins for anything user-visible in the main app — exceptions require a decision gate in PARALLEL-PLAN.md, not a judgment call here.
> 3. **The floating bar/orb overlay is exempt** — it keeps its current Windows design; Mac's bar is a functional reference only.
> 4. Authoritative plan: `../mac-parity-audit/PARALLEL-PLAN.md`.

Reference tag: `v0.12.72+12072-macos`. Source root: `desktop/macos/Desktop/Sources/`.
Excludes the notch/floating bar (`FloatingControlBar/`) per scope — one reference
(`ProactiveTaskExecute.swift`) lives there and is out of scope for this doc.

Primary files:

| Area | File |
|---|---|
| Tasks page (list, filters, row, badges, create, undo, keyboard) | `MainWindow/Pages/TasksPage.swift` (6026 lines) |
| Task detail modal + hover tooltip | `MainWindow/Pages/TaskDetailViews.swift` |
| Task chat side panel (durable "Work on this with Omi" thread) | `MainWindow/Components/TaskChatPanel.swift` |
| Dashboard Tasks widget (Home) | `MainWindow/Components/TodaysTasksWidget.swift` |
| Dashboard Goals widget (Home) + edit/insight sheets | `MainWindow/Components/GoalsWidget.swift` |
| Goals history sheet (completed/removed) | `MainWindow/Pages/GoalsHistoryPage.swift` |
| Goal-completion celebration overlay | `MainWindow/Components/GoalCelebrationView.swift` |
| Canonical ("What Matters Now") goals widget + All-Goals sheet | `MainWindow/Dashboard/WhatMattersNowSection.swift` |
| Suggested-tasks quiet-capture card (top of Tasks list) | `MainWindow/Tasks/SuggestedTasksSection.swift`, `SuggestedTasksStore.swift` |
| "Why Omi added this" provenance popover | `MainWindow/Tasks/SuggestedTasksSection.swift` (`AutoAcceptedTaskWhyButton`) |
| Legacy terminal-launched agent UI (largely dead in current row UI) | `ProactiveAssistants/Assistants/TaskAgent/TaskAgentViews.swift` |
| Task chat coordinator / workstream projection | `ProactiveAssistants/Assistants/TaskAgent/TaskChatCoordinator.swift`, `TaskThreadProjection.swift` |
| Task classification enum (tags) | `ProactiveAssistants/Assistants/TaskExtraction/TaskModels.swift` |
| Colors | `Theme/OmiColors.swift` |
| Dead/unused creation sheets | `TaskCreateSheet` (in `TasksPage.swift`), `MainWindow/Components/DailyTaskCreationSheet.swift` |

Windows comparison files: `src/renderer/src/pages/Tasks.tsx`, `src/renderer/src/pages/Goals.tsx`,
`src/renderer/src/components/layout/TasksGoalsToggle.tsx`, `src/renderer/src/components/home/QuickTaskWidget.tsx`,
`src/renderer/src/components/home/QuickGoalsWidget.tsx`.

---

## 0. Navigation structure (important structural fact)

- **Mac has a sidebar "Tasks" entry** (`SidebarView.swift`, `case tasks = 4`, icon `checklist`,
  label "Tasks") that opens the full `TasksPage`. **There is no sidebar "Goals" entry.**
- **Goals are not a standalone page on Mac.** They exist only as:
  1. A `GoalsWidget` card on the Home **Dashboard** (`DashboardPage.swift`), side-by-side in a
     2-column `Grid` with the `TasksWidget` card.
  2. A `GoalsHistoryPage` sheet (completed/removed goals) — **but it is currently unreachable**:
     `GoalsWidget.showingHistory` is declared `@State` and wired to a `.sheet`, but no button in
     `GoalsWidget.swift` ever sets it `true`. Dead UI entry point at this tag.
  3. When `intelligenceStore.accountGeneration != nil` (canonical/newer intelligence flow is
     enabled for the account), the dashboard instead shows a `canonicalGoalsWidget` →
     `FocusedGoalsSection` (goal name pills, "Focused goals") with an **"All goals" button that
     opens `AllGoalsSheet`** (`WhatMattersNowSection.swift`) — a 620×540 sheet with a
     Current/History segmented picker, goal rows, focus/replace flow, and its own "Add goal"
     sheet. This is the closest Mac equivalent to a full Goals page, and it is a **sheet**, not a
     route.
- **Windows built a full `/goals` route** (`pages/Goals.tsx`) with its own header, filter chips
  (Active/Completed/All), AI-suggestion banner, and composer — reached via a `TasksGoalsToggle`
  segmented control shown in both the Tasks and Goals page headers. **This is a structural
  deviation from Mac**: Mac has no dedicated Goals page/route at all in the non-canonical (legacy)
  path Home widget currently renders for most accounts. Decide deliberately whether Windows keeps
  its fuller Goals page (arguably better UX) or the port narrows Goals back to dashboard-only to
  match Mac exactly — flag this to the user/plan, don't silently converge.

---

## 1. Tasks Page (`TasksPage.swift`)

### 1.1 Layout

`TasksPage` renders an `HStack`: left panel = `tasksContent` (`.frame(maxWidth: .infinity)`),
optional right panel = task chat side panel (`chatPanelWidth`, default 400pt, draggable 300–600pt
via a 9pt-wide divider handle, persisted in `@AppStorage("tasksChatPanelWidth")`). Opening the
side panel **resizes the whole app window** wider by `chatPanelWidth + 1` (animated 0.25s
`easeInEaseOut`) rather than shrinking the task list — width is restored on close using a saved
`tasksPreChatWindowWidth`. Windows has no equivalent side-panel/task-chat surface at all today
(missing) — the task-agent/workstream chat concept doesn't exist as UI in `Tasks.tsx`.

`tasksContent` = `VStack`: `headerView` → optional sort-order-sync-failure banner → main content
(loading / error / empty / list) → `.overlay(.bottom)` for `KeyboardHintBar` + `UndoToastView`.

### 1.2 Header (`headerView`)

Horizontal stack, `padding(.horizontal:16, .top:16, .bottom:12)`:
1. **Search field** — magnifying-glass icon (or `ProgressView` spinner while searching/filtering),
   `TextField("Search tasks...")`, clear "x" button. Background `OmiColors.backgroundSecondary`,
   `cornerRadius(8)`. Search hits SQLite directly (`ActionItemStorage`), debounced via `didSet`.
2. **Saved filter view chips** (if any) — pill buttons per `SavedFilterView`, active pill filled
   `backgroundTertiary` with `border` stroke; inactive `backgroundSecondary`. Right-click →
   context menu "Delete". Hidden during multi-select.
3. **Save-filter bookmark button** (🔖 icon) — shown only when `hasNonDefaultFilters` is true;
   opens a native `.alert` text-entry ("Save Filter View") that calls
   `viewModel.saveCurrentFilters(name:)`.
4. **Filter dropdown button** (`line.3.horizontal.decrease` icon) — opens a `.popover` (see §1.3).
   Active-filter state = `textPrimary` fill + `border` stroke; inactive = `textSecondary`, no
   stroke.
5. **Multi-select controls** (replace items 3–4 when `isMultiSelectMode`) — not read in detail
   (`multiSelectControls`, `deleteSelectedButton`, `cancelMultiSelectButton` at lines 3482–3548).
6. **Chat toggle button** — only shown if `chatProvider != nil && TaskAgentSettings.shared.isChatEnabled`.
7. **Add-task button** (`+` icon) — sets `isInlineCreating = true`, `inlineCreateAfterTaskId = nil`.
   Help text: "Add task (⌘N)".
8. **Task settings button** — gear-style entry into task-agent settings (not detailed here).

### 1.3 Filter system — full tag/group model (NOT simplified to a completed toggle)

**Verified against the delta command in the brief** (`git log 0d09ede6..v0.12.72+12072-macos --
desktop/macos/.../TasksPage.swift` etc. — 13 commits touched `TasksPage.swift`, 26 touched the
broader Tasks/Goals surface; none mention filter simplification). **At this tag, macOS still has
the full multi-group filter-tag dropdown — the "recent upstream change simplified filters to a
mobile-parity completed toggle" did NOT land on this macOS tag.** If that simplification exists,
it's on a different platform/branch than what's referenced here; do not port a simplified toggle
assuming it matches current Mac.

Filter model (`TaskFilterTag` enum, `TasksPage.swift:60-312`):
- **Groups** (`TaskFilterGroup`): Status, Date Range, Category, Source, Priority, Origin.
- **Status**: To Do (`todo`), Done (`done`), Removed by AI (`removedByAI`), Removed by me
  (`removedByMe`).
- **Date Range**: Last 7 days (`last7Days`) — the only date-range tag; matches on `dueAt` if
  present else `createdAt`.
- **Category** (10 values, mirrors `TaskClassification`): Personal, Work, Feature, Bug, Code,
  Research, Communication, Finance, Health, Other — each with an SF Symbol icon.
- **Source**: Screen (`screenshot`), OMI (`transcription:omi`), Desktop (`transcription:desktop`),
  Manual (`manual`), OMI Analytics (`omi-analytics`).
- **Priority**: High, Medium, Low.
- **Origin** (source-classification category): Direct Request, Self-Generated, Calendar-Driven,
  Reactive, External System, Other Origin.
- **Dynamic tags**: any `source` or category tag value not in the predefined lists above is
  auto-discovered from loaded tasks (background `DispatchQueue.global` scan) and surfaced as a
  `DynamicFilterTag` with a generic icon, so unknown backend-injected sources/categories still get
  a working filter chip.
- **Default selection**: `[.todo, .last7Days]` ("To Do" label in the dropdown button).
- **Combining logic**: within a group, tags OR together; across groups, AND. Status tags map to
  server-side loading branches (`showCompleted` toggles `loadCompletedTasks()` /
  `loadIncompleteTasks()`; deleted tags trigger `loadDeletedTasks()`); non-status tags trigger a
  direct SQLite query (`loadFilteredTasksFromDatabase()`).
- **Saved Filter Views**: named, persisted combinations of predefined+dynamic tags
  (`UserDefaults` key `TasksSavedFilterViews`), rendered as chips in the header (see §1.2.2).
- **Filter popover** (`filterPopover`, ~line 3263): search field at top, then an "All" row (count
  = todo+done), then each non-empty group as a divider + uppercase header + rows. Each row: icon,
  display name, count badge (`backgroundTertiary` pill), checkmark if selected. Tags within a
  group are sorted by descending count. Multi-select via toggling `pendingSelectedTags` /
  `pendingSelectedDynamicTags`, committed on... (apply/cancel footer exists further in file, not
  captured above — verify footer buttons if precise commit UX is needed).

**Windows delta**: `Tasks.tsx` filter is a **3-state segmented control** (`open` / `done` / `all`)
with no category/source/priority/origin/date filtering, no saved views, no dynamic-tag discovery.
This is a **major drift** (a large feature subset, not a simplification artifact) — confirm with
the user whether Windows should grow toward Mac's full filter system or Mac should be simplified;
do not silently port the full system without a scope decision, given its size (~250 lines of
filter-tag logic alone).

### 1.4 Task grouping / sections

When no status-only filter narrows to "done only" or "deleted only", and not in multi-select mode,
tasks render **grouped by due-date category** (`TaskCategory` enum, `TasksPage.swift:10-33`):

| Category | Icon | Color | Definition |
|---|---|---|---|
| Today | `sun.max.fill` | `textPrimary` | due today |
| Tomorrow | `sunrise.fill` | `textSecondary` | due tomorrow |
| Later | `calendar` | `textSecondary` | due beyond tomorrow |
| No Deadline | `tray.fill` | `textTertiary` | no `dueAt` |

Each non-empty category renders as a `TaskCategorySection`: header row (icon, category name,
`.semibold` 15pt, item-count pill capsule — except "Today" shows an "x" clear-deadlines button
instead of a count), then a top drop-zone (2pt, expands to 4pt + accent-color line when
drag-targeted), then `LazyVStack` of `TaskRow`s with drag reorder.

Otherwise (only "Done" selected, only "Removed" selected, or multi-select mode): **flat list**,
no category grouping, via `ForEach(viewModel.displayTasks)`.

Sort within a category: `sortOrder` (banded per category, band width 100,000, so category N owns
`[N*100000, (N+1)*100000)`) if present → else legacy `UserDefaults` `categoryOrder` → else
`dueAt` ascending / `createdAt` descending fallback. Drag-and-drop reordering writes a new
`sortOrder` immediately (optimistic), debounces 500ms, then persists to SQLite (`ActionItemStorage`)
+ backend (`APIClient.batchUpdateSortOrders`) with a `TaskSortOrderSyncFailure` banner + Retry
button on partial/total failure (distinct messages for "Mac only", "cloud only", "neither",
"unknown").

**Windows delta**: `Tasks.tsx` groups by **due-date bucket** too (`overdue / today / tomorrow /
upcoming / nodate`) but computed differently — Mac has no explicit "Overdue" bucket (overdue tasks
just sort first within "Today" via ascending `dueAt`, or per `TaskFilterTag` are simply included
whenever due). Windows has **no drag-to-reorder, no indent levels, no custom sortOrder** — sorting
is purely by due date then created date. Major drift: reordering/indentation is entirely absent
on Windows.

### 1.5 Task Row (`TaskRow`, `TasksPage.swift:4446-5359`)

**Structure** (leading → trailing):
- Optional **drag handle** (`line.3.horizontal`, 10pt) — visible only on hover, only when grouped
  by category, not multi-select, not deleted. `.onDrag` starts a `TaskDragItemProvider`; end is
  signaled via the provider's `deinit` (chosen deliberately over NSEvent monitors, which don't
  fire inside AppKit's drag modal loop).
- **Indent guide** — vertical 2pt lines (`textQuaternary` @ 0.5 opacity) per indent level, 28pt/level
  (up to level 3), only if `indentLevel > 0`.
- **Leading control** (24×24 hit target):
  - Deleted task → static `trash.slash` icon, `textTertiary`.
  - Multi-select → checkbox: `RoundedRectangle(cornerRadius:4)` stroke `textTertiary`/`textPrimary`
    (20×20), filled `textPrimary` + white checkmark when selected.
  - Normal → completion circle: stroke `textTertiary` idle, or filled `textPrimary` circle + black
    checkmark when completed/completing. Completion animates in 4 timed steps (see §1.5.3).
- **Content column**:
  - Deleted task: strikethrough description (`textTertiary`) + `deletedReason` (`textQuaternary`,
    2-line clamp).
  - Normal task: title (`TextField` when editing/focused, else `Text` with tap-to-edit — no click
    target on empty trailing space, only on the text itself) at 14pt, strikethrough +
    `textTertiary` when completed. Below: a `FlowLayout` badge row —
    recurring icon (`repeat`), `NewBadge` (if created <60s ago — purple, see §7 palette note),
    `AutoAcceptedTaskWhyButton` ("Why" popover explaining provenance for non-manual sources),
    an explicit thread action (**"Open thread"** if `task.workstreamId != nil`, else **"Work on
    this with Omi"** with a sparkles icon — both only when chat is enabled and the task isn't
    already streaming/unread), `ChatSessionStatusIndicator` (spinner+status text while streaming,
    or a solid dot + "New reply" button when unread), and the info-circle `TaskDetailButton`
    (hover popover preview → click opens `TaskDetailView` sheet, §2).
- **Trailing hover-action overlay** (`.overlay(alignment:.trailing)`, only visible on
  hover/priority-picker-open, hidden while editing, hidden in multi-select/deleted): a gradient-
  faded `HStack` of: **Execute** pill (white 18%-opacity fill, sparkles icon, "spawn an agent to
  do this" — only if not completed), add-due-date calendar+ icon (only if no due date and not
  completed), `PriorityBadgeInteractive` (only if not completed), outdent/indent arrows (only when
  applicable), share-link icon (copies a share URL via `APIClient.shareTasks`, shows a toast for
  1.4s), delete (trash) icon.

**Row background**: `backgroundTertiary` on hover/drag; `purplePrimary @ 0.15` for ~60s after
creation ("new" highlight — separate from the `NewBadge` text badge); `purplePrimary @ 0.10` fill +
`0.3` stroke + a 3pt leading accent bar when keyboard-selected; `Color.clear` otherwise. Active-
chat-task rows get a `textPrimary @ 0.08` fill + `0.25` stroke instead. Row opacity drops to 0.4
while being dragged (`.animation(.easeInOut(0.12))`).

#### 1.5.1 Inline editing

Tap the title text → `TextField(axis: .vertical, lineLimit: 1...4)`, focused. Escape or blur
commits (via `commitEdit()`), debounce-autosaves 1s after last keystroke too. A background "ghost"
`Text` renders behind the field so the edit highlight (a `backgroundPrimary`-filled
`RoundedRectangle(cornerRadius:4)`) hugs the actual text width instead of filling the row.

#### 1.5.2 Swipe gestures (trackpad/mouse-drag, not touch)

`DragGesture(minimumDistance: 10)` on the row content:
- Swipe left (negative translation, 0.8x resistance): reveals a **red delete background**
  (`trash.fill` + "Release to delete" past 100pt threshold) if `indentLevel == 0`, or an **orange
  outdent background** (`arrow.left.to.line` + "Release to outdent") if indented.
- Swipe right (positive translation, 0.6x resistance, only if `indentLevel < 3`): reveals a
  **`textSecondary`-filled indent background** (`arrow.right.to.line` + "Release to indent" past
  80pt threshold).
- Release: threshold (distance OR velocity ±500) decides commit; delete animates the row off-
  screen (`swipeOffset: -400`, `rowOpacity: 0`, 0.2s `easeOut`) before calling `onDelete`; indent/
  outdent snap back via `spring(response:0.3, dampingFraction:0.7)`.

**Windows delta — missing entirely.** No swipe gestures, no indent levels, no per-row drag reorder
on Windows's `Tasks.tsx` row (`renderRow`). Windows rows are static list items with a checkbox,
inline-edit-on-click title, inline due-date `<input type=date>` editor, and a hover-reveal trash
icon only — no priority badge, no tags, no source badge, no "Execute"/agent action, no thread/chat
affordance, no share-link, no swipe/drag, no multi-select, no keyboard navigation.

#### 1.5.3 Completion animation (`handleToggle`)

4 chained `DispatchQueue.main.asyncAfter` steps: (0ms) `isCompletingAnimation = true`, checkmark
scale springs to 1.2 → (150ms) springs back to 1.0 → (400ms) row fades to opacity 0 and offsets
+50pt (`easeInOut` 0.3s) → (700ms) actually calls `onToggle(task)`. Uncompleting (already-completed
task) skips all animation and calls `onToggle` immediately.

#### 1.5.4 Newly-created marker

`isNewlyCreated` = `Date().timeIntervalSince(createdAt) < 60` — drives both the row's purple tint
background and the `NewBadge` pill ("New", purple text on `purplePrimary @ 0.15` fill,
`cornerRadius(4)`).

### 1.6 Interactive badges (`TasksPage.swift:5363-5657`)

- **`DueDateBadgeInteractive`** — calendar icon + relative label (Today/Tomorrow/weekday name if
  within a week/`RelativeDateTimeFormatter` if past/absolute date beyond a week), repeat icon if
  recurring, pencil icon on hover. Tap opens the due-date popover (graphical `DatePicker` + Cancel/
  Save). Only rendered elsewhere as part of the hover-action row via the "add date" icon when no
  date is set; when a date exists it's presumably shown inline too (verify exact call site if
  pixel-parity is required — not captured in the excerpt read).
- **`PriorityBadgeInteractive`** — shown if task has a priority, or on row-hover/picker-open for
  tasks without one. Flag icon (filled for high, outline otherwise) + capitalized label + pencil on
  hover. Colors: high = `textPrimary`, medium = `textSecondary`, low/none = `textTertiary` (i.e.
  **grayscale, not red/orange/yellow** — priority is NOT color-coded on Mac). Popover: 3-row list
  (High/Medium/Low) with colored flag icons and a checkmark on the current selection.
- **`TagBadgeInteractive`** — tag icon + up to 2 `TaskClassification.label`s + "+N" overflow, or
  "+ Tag" prompt when empty and hovering. Popover: `LazyVGrid` of all 10 classification pills
  (colored — but see §7, all 10 classification colors are currently the same gray `#9CA3AF`/
  `#6B7280`, so despite per-category `color` fields existing, the badge and popover render
  effectively monochrome at this tag), toggle-select, "Done" button (purple capsule) commits via
  `onUpdateTags`.
- **`SourceBadgeCompact`** — small icon + `sourceLabel`, `.help()` tooltip shows `windowTitle` if
  present. (Call site not located in the excerpted TaskRow body — likely folded into the
  detail popover/tooltip rather than the row itself; the row's badge `FlowLayout` shown above does
  not include it directly.)
- **`NewBadge`** — see §1.5.4.

**Windows delta**: none of these interactive badges exist. Windows shows only a due-date chip
(read/edit via native date input, red-tinted text if overdue) and nothing for priority, tags, or
source. Major drift / missing surface.

### 1.7 Task creation

- **Primary flow — inline creation** (`InlineTaskCreationRow`, `TasksPage.swift:5921-5969`):
  ⌘N or the header `+` button sets `isInlineCreating = true`. Renders a row matching `TaskRow`'s
  shape: unfilled purple-stroked circle placeholder, `TextField("New task...")` (auto-focused),
  Enter commits (`createInlineTask`), Escape cancels. Background `purplePrimary @ 0.05` fill,
  `0.3` stroke, 3pt purple leading accent bar — visually a lighter version of the "new task"
  highlight. Can be inserted either at the top of the list (`inlineCreateAfterTaskId == nil`) or
  directly after a specific task (double-Enter-while-selected also triggers this, inserting below
  the selected task — see keyboard shortcuts).
- **`TaskCreateSheet`** (full modal: description, due-date toggle+graphical picker, 4-way priority
  buttons, tag grid, Cancel/Create footer, 420×500) **exists in source but has no call site** —
  confirmed via `grep` for `TaskCreateSheet(` project-wide: zero matches outside its own
  definition. **Dead code at this tag** — do not treat as the canonical "create task" UI to port.
- **`DailyTaskCreationSheet`** (`MainWindow/Components/DailyTaskCreationSheet.swift`) — a second,
  separate creation sheet themed around recurring daily tasks (repeat icon, "This task will repeat
  every day until completed", 3-priority buttons, 450×320). **Also has zero call sites** — dead
  code at this tag.

**Windows delta**: Windows's composer (`Tasks.tsx`, `composing` state) is an inline expanding card
above the list (description input + native date input + Cancel/"Add task" buttons) — closer in
spirit to Mac's dead `TaskCreateSheet` than to Mac's actual live inline-row flow. **Recommend
porting Mac's live inline-row pattern** (row-shaped, appears in-place in the list, not a separate
card) rather than keeping Windows's current card-composer, since the card composer has no Mac
equivalent still in use.

### 1.8 Delete + Undo

`deleteTaskWithUndo` (viewmodel) pushes onto a max-10 `undoStack` of `{task, timestamp}` and shows
`UndoToastView` — a dark pill toast (trash icon, "Task deleted" + `(N)` count if stacked, "Undo"
button in a translucent white capsule), bottom-anchored, `.transition(.move(edge:.bottom))`,
25s(ish; exact dismiss timer not captured — driven by `showUndoToast`/`undoToastDismissTask`).
Hard delete (swipe, trash icon, or Cmd+D) always goes through the undo path — no separate
"permanent delete" confirmation dialog for a single task. Deleted tasks remain visible under the
"Removed by AI"/"Removed by me" status filters with a trash-slash icon and (if present) a
`deletedReason` string — **soft delete**, distinguishing AI-initiated vs. user-initiated removal.

**Windows delta**: `deleteItem` is a plain optimistic DELETE with a `toast('Could not delete
task', {tone:'error'})` **only on failure** — no success toast, no undo affordance, no soft-delete/
removed-tasks view, no AI-vs-user removal distinction. Major drift.

### 1.9 States

| State | Mac | Windows |
|---|---|---|
| Loading (first load) | Centered `ProgressView` (1.2x scale, `textSecondary` tint) + "Loading tasks..." (`textTertiary`) | Skeleton list: 6 `surface-card` rows with pulsing checkbox/title/subtitle placeholders |
| Error (load failed, no cached tasks) | `exclamationmark.triangle.fill` 48pt (`textTertiary`) + "Failed to load tasks" (18pt semibold) + "Check your connection and try again." + bordered "Try Again" button | Inline `surface-panel` banner with the raw error message; list still attempts to render whatever's cached |
| Empty, no filters active | `tray.fill` 48pt + "All Caught Up!" (24pt semibold) + "You have no tasks yet" | `EmptyState` component: `ListChecks` icon, "No tasks yet", "...Click New to create one." |
| Empty, filters active (tasks exist but filtered out) | `line.3.horizontal.decrease` icon + "No Matching Tasks" + "Try adjusting your filters" + bordered "Clear Filters" button | No distinct filtered-empty state — Windows shows a generic "All caught up." message (`Check` icon) whenever `visible.length === 0` regardless of whether it's filter-driven or genuinely zero tasks |
| Sync conflict (sort-order write failed) | Persistent banner above the list: warning triangle + failure-specific message (local-only / cloud-only / neither / unknown) + "Retry" button (`bordered`, `textSecondary` tint) | No equivalent — Windows has no client-side sort order to conflict on |
| Loading more (pagination) | Small centered `ProgressView` row, or a "Load more tasks" button (`arrow.down.circle` + text, `backgroundTertiary` pill) depending on filtered vs. server-paginated mode | N/A — Windows's `fetchAllActionItems` pages through the *entire* `/v1/action-items` collection up front (up to 100 pages of 100) before first render; no incremental "load more" UI |

### 1.10 Keyboard shortcuts (`KeyboardHintBar`, `TasksViewModel.handleKeyDown`)

Global local `NSEvent` monitor (installed/removed on view appear/disappear), skipped when a text
field/text view is first responder. Behavior varies by mode (hint bar shows the applicable subset,
bottom-center, dark pill with shadow):

- **No selection**: ↑↓ Navigate, ⌘N New, ⌘D Delete, ⇥ Indent, ⇧⇥ Outdent.
- **Has selection**: ↑↓ Navigate, ↵ New below, ↵↵ (double-press <0.4s apart) Edit, Space Done
  (toggle complete, triggers the completion animation), Esc Deselect, ⌘D Delete, ⇥ Indent, ⇧⇥
  Outdent.
- **Inline creating**: ↵ Create, Esc Cancel.
- **Any task editing**: Esc Save & exit.

⌘N always triggers inline-create-at-top regardless of selection. Delete (⌘D) auto-advances
keyboard selection to the next task (or previous if deleting the last one). Space toggle relies on
`animateToggleTaskId` being observed by the specific `TaskRow` via `.onChange`.

**Windows delta — entirely missing.** No keyboard navigation, no shortcuts, no hint bar on
Windows's Tasks page at all. This is the single largest interaction-model gap between the two
platforms for this surface.

---

## 2. Task Detail (`TaskDetailViews.swift`)

Two related surfaces, both driven by `task.parsedMetadata: [String: Any]?` (a loosely-typed bag
the backend attaches per source, e.g. Sentry feedback, omi-analytics, screenshot capture):

### 2.1 Hover tooltip (`TaskDetailButton` → `TaskDetailTooltip`)

Info-circle icon button in the row's badge row. Hover (with a 0.25s linger to allow cursor travel
into the popover itself) shows a `.popover` (max 350×400, scrollable): compact label/value rows
for Status, Category, Tags, Priority, Source(+raw value), App, Window, Created, Due, Goal ID,
Context Summary block, Current Activity block, Agent Status, then **all remaining metadata keys**
not already surfaced as a direct field (each rendered as a row if ≤60 chars and no newline, else
as a stacked block). Click anywhere on the button (not just after hover) dismisses the tooltip and
opens the full sheet instead.

### 2.2 Full detail sheet (`TaskDetailView`)

550×600 modal, `backgroundPrimary`. Header: "Task Details" + a `backgroundSecondary`-pill showing
the raw `source` string + dismiss (X) button. Body sections (conditionally rendered, each a
`backgroundSecondary`-filled `RoundedRectangle(cornerRadius:8)` card with a `sectionHeader`):

1. **Task** — the description text in its own card.
2. **Details** (always) — Category, Tags, Priority, Status, Source(+raw), Source App, Window,
   Created, Due, Completed, Goal, Conversation — each only if present.
3. **Context** — Context Summary, Current Activity, Reasoning (screenshot-capture provenance).
4. **Agent** — Agent Status, Edited Files (newline list), Plan (truncated to 2000 chars, monospace
   implied by section but rendered as regular body text with `detailBlock`).
5. **Sentry** — Issue ID + "Open in Sentry" link button (blue text, external-link icon).
6. **Reporter** — Name, Email, Type (Sentry feedback provenance).
7. **Analysis** (omi-analytics) — Reason, Original Message, Key Findings, Search Summary, Relevant
   Files.
8. **App Info** (Sentry) — Version, Build, OS, Device.
9. **Source** (screenshot) — App, Confidence (%), Deadline, Window.
10. **Other Info** — catch-all for any `parsedMetadata` key not claimed by sections 2–9, sorted by
    key, row vs. block by length/newline heuristic (same as the tooltip).

All text values use `.textSelection(.enabled)` for copy-paste. No edit affordances anywhere in
this sheet — it is **read-only provenance/audit data**, distinct from the row's own inline-edit
fields (description, due date, priority, tags), which are edited directly on the row/its popovers,
not here.

**Windows delta — entirely missing.** Windows has no task-detail modal, no metadata surface, no
Sentry/reporter/analysis/screenshot provenance display, no per-field audit trail. This is a fully
missing surface, not a drift — port priority should be assessed against whether Windows's task
sources (which sources exist on Windows today) actually produce this kind of rich metadata; if
Windows tasks are currently manual-only or conversation-derived without the Sentry/analytics/
screenshot pipelines, this whole surface may be low priority until those pipelines exist on
Windows.

---

## 3. Task chat / workstream side panel (main-window surface, in scope)

`TaskChatPanel.swift` — the right-hand panel described in §1.1. Header: bubble icon, task
description (or thread title) truncated to 1 line, close (X); a secondary row shows the abbreviated
workspace path (`~/...`) when a task is active. Body states:

- **No task selected**: centered `text.bubble` icon (36pt, 40% opacity) + "Open a task thread" +
  helper copy.
- **Opening** (`coordinator.isOpening`): centered `ProgressView` + "Setting up chat...".
- **Active thread**: optional collapsible `TaskThreadOverview` (`DisclosureGroup`, default
  expanded) showing "Ongoing work" — current-state summary, live agent-activity spinner+status
  (only while `runtimeProjection.status.isActive`), recent-changes list with evidence-ref chips
  ("Conversation: id", "Memory: id", etc. via `EvidenceKind.userFacingLabel`), scoped-tasks
  checklist (bold = the currently active task), and artifact-version list (logical key, `v{N}`,
  "Original" tag for the first version, evidence refs, "Open artifact" link). Below that: the
  shared `ChatMessagesView` message list + `ChatInputView` (placeholder "Continue this work..."),
  pinned via `.safeAreaInset(.bottom)` specifically to avoid a measured re-layout loop when the
  input's height changes (documented gotcha in the source comment — do not merge the messages
  view and input into one VStack when porting this pattern).
- **Placeholder variant** (`TaskChatPanelPlaceholder`) — shown when the panel is open but no
  active task state exists yet; near-identical empty state, with error-vs-neutral icon/copy
  depending on `coordinator.errorMessage`.

Threads are created **only** via the explicit "Work on this with Omi" action (never merely by
viewing/selecting a task) — `TaskChatCoordinator.openChat(for:)` vs. `openExistingThread(for:)`
which only resumes. This is a deliberate product invariant in the source comments ("Generic
navigation only resumes an existing thread. Durable work is created solely by the labeled 'Work on
this with Omi' action").

**Windows delta — entirely missing.** No task-chat/workstream concept exists on Windows at all
(no side panel, no "Work on this with Omi" action, no thread/workstream backend wiring visible in
`Tasks.tsx`). This is the single largest missing feature area for this surface, not merely a
drift.

---

## 4. Quiet-capture / Suggested Tasks (`SuggestedTasksSection.swift`)

Rendered at the top of the grouped task list (only when not in "only done"/"only deleted"/multi-
select mode). Two states:
- **Loading** (`store.isLoading && candidates.isEmpty`): small `ProgressView` + "Checking
  Suggested" (`textTertiary`).
- **Has candidates**: a card (`backgroundSecondary @ 0.72` fill, `border @ 0.8` stroke,
  `cornerRadius(12)`) with a header (tray icon, "Suggested" 15pt semibold, count badge, right-
  aligned "Quietly captured for your review" caption), then one `SuggestedCandidateCard` per
  candidate:
  - Editable inline title (`TextField`) if `candidate.isEditableTask`, else static text (3-line
    clamp).
  - Optional detail line (2-line clamp, `textSecondary`).
  - Provenance row: `Label(provenanceLabel, systemImage:"link")` + "N source(s)" if
    `evidenceCount > 0`.
  - Action row: **"Do now"** (borderedProminent, `textPrimary` tint, black foreground — promotes
    the candidate to a real task via `store.doNow`), **"Later"** (bordered, defers), **"Dismiss"**
    (bordered, opens a reason popover: "Already handled" / "Not mine" / "Not useful", or dismisses
    with no reason if the popover is closed without a choice — tracked via `onChange` on
    popover-visibility).
  - `isBusy` disables the row and shows a small spinner.

`AutoAcceptedTaskWhyButton` (also in this file) is the small "Why" popover on auto-accepted task
rows (source ≠ manual, has provenance) explaining why Omi added it, with a source-based canned
sentence (screen-context vs. conversation-derived vs. generic authorized source) + linked-source
count.

**Windows delta — entirely missing.** No quiet-capture/suggested-task review surface, no Do
now/Later/Dismiss triage flow, no provenance "Why" explanation on Windows.

---

## 5. Dashboard Tasks widget (`TodaysTasksWidget.swift` → `TasksWidget`)

Home-dashboard card (`omiPanel(fill: backgroundSecondary)`, 22pt padding). Header: "Tasks" (16pt
semibold). Combines `overdueTasks + todaysTasks` (sorted by due date, overdue first) with
`recentTasks`, shows up to 3 (`TaskRowView`): 18pt checkbox icon (`checkmark.circle.fill` filled
vs. outline `circle`), title (14pt→ shown at 13pt here, strikethrough+dimmed when complete),
recurring badge ("Daily" pill, purple, only for `recurrenceRule == "daily"` specifically — not all
recurrence rules). Row background: `backgroundRaised @ 0.55` if completed else
`backgroundTertiary @ 0.45`, `cornerRadius(14, continuous)`. Footer: "View all tasks →" button
posts `.navigateToTasks` notification (no direct navigation call — decoupled via NotificationCenter).
Empty state: centered `checkmark.circle` (28pt, `textQuaternary`) + "No incomplete tasks", both
vertically centered in the remaining cell height (so a taller Goals sibling card doesn't leave the
Tasks card's content pinned to the top).

Compare Windows `QuickTaskWidget.tsx`: a `Link`-wrapped card, up to 2 tasks (not 3), sorted purely
by due date (no "recent" fallback tier), a due-date chip per row (Today/Tomorrow/Overdue-rose-
tinted/date) rather than a "Daily" recurrence pill, no checkbox/toggle affordance at all (row is
not interactive beyond the whole-card navigation link), hides entirely (`return null`) rather than
showing an empty state when there are zero tasks. **Minor-to-major drift**: Mac's widget lets you
toggle completion inline from the dashboard; Windows's widget is read-only/navigate-only.

---

## 6. Dashboard Goals widget (`GoalsWidget.swift`) + sheets

Same card chrome as the Tasks widget. Header: "Goals" + a `+` button (only if `goals.count < 4` —
**Mac caps visible/addable goals at 4** at the widget level). Empty state: a single centered
"Generate AI Goal" pill button (sparkles icon, purple text on `purplePrimary @ 0.12` fill) calling
`GoalGenerationService.shared.generateNow()`. Non-empty: up to... (no explicit cap on the
populated list beyond the 4-goal add-gate) `GoalRowView`s, vertically centered in the remaining
cell height.

### 6.1 `GoalRowView`

36×36 rounded-square emoji icon (auto-picked from ~35 keyword-matching rules against the goal
title — money→💰, growth→🚀, workout→💪, running→🏃, reading→📚, coding→💻, etc., default 🎯) that
opens the edit sheet on tap. Title (13pt medium, 1-line clamp, tap opens edit sheet). Row-hover
reveals: an expand/collapse chevron (if the goal has a description or linked tasks) and a
lightbulb "Get insight" button (yellow). Trailing: `current/target` value text (turns `textPrimary`
while actively dragging the progress bar). **Progress bar is directly draggable**
(`DragGesture(minimumDistance:0)` over a `GeometryReader`): a white circular thumb + colored fill
track (`backgroundColor.opacity(0.12)` track, thickens 6→8pt while dragging), committing on
release via `onUpdateProgress` with the value rounded to the nearest integer between `minValue`
and `targetValue`. **Progress-bar fill color is a 5-stop traffic-light gradient by percentage**
(this is a genuinely colorful, non-monochrome UI element, unlike task priority):

| Progress | Color | Hex |
|---|---|---|
| ≥80% | Green | `#22C55E` |
| ≥60% | Lime | `#84CC16` |
| ≥40% | Yellow | `#FBBF24` |
| ≥20% | Orange | `#F97316` |
| <20% | `textTertiary` (gray) | — |

Expanded state (chevron toggled) reveals: description text (3-line clamp) and a "Linked Tasks"
list (fetched lazily via `APIClient.getActionItems` filtered client-side by `goalId == goal.id`,
each with its own checkmark/circle icon colored green-when-complete vs. gray).

### 6.2 `GoalEditSheet` (create/edit, 400×~320-420)

Title field, Current/Target numeric fields (both plain `TextField`s over `backgroundTertiary @ 0.5`
pills — no stepper, no unit field despite the model supporting `unit`). Footer: Delete (only for
existing goals, red text) / Cancel / "Add Goal" or "Save" (purple-filled pill). No emoji picker is
actually wired up in the sheet body despite `availableEmojis`/`selectedEmoji` state existing —
emoji is auto-derived from title everywhere it's displayed (row, history, celebration), not
user-chosen.

### 6.3 `GoalInsightSheet` (AI advice, 400×380)

Lightbulb-icon header. Goal summary row (title, `current/target (pct%)`) + a small circular
progress ring (3pt stroke, purple). Body: loading spinner+copy → error (orange triangle) →
`insight` text block ("This week's action:" + AI-generated text via `GoalsAIService`). Footer:
Refresh (regenerates) / Done.

### 6.4 `GoalsHistoryPage` (completed/removed goals list, sheet — see §0 for reachability caveat)

Back-button header + "Goals History" title. States: loading spinner, error, empty (`trophy` icon +
"No goals history yet"), or a `LazyVStack` of `CompletedGoalRow`s (36×36 emoji square, title,
type badge — "Yes/No"/"Scale"/"Numeric" purple pill — + final value, and a trailing status column:
green checkmark + relative completion date if actually completed, or dimmed X + "Removed" if not).

### 6.5 Goal-completion celebration (`GoalCelebrationView.swift`)

Fullscreen overlay, triggered by `.goalCompleted` NotificationCenter post. 4-phase timeline:
dim (0ms, 0.4→0.5 opacity black scrim) → confetti burst (300ms, 40 particles — mixed
circles/rects, random colors incl. gold/green/blue/pink/orange/cyan/mint/purple, radiate out
80–300pt with random rotation up to 1080°, `easeOut` 0.8s) → text reveal (800ms, spring
0.5/0.7: "Goal Completed!" 32pt bold with a yellow→orange→yellow gradient + yellow glow shadow,
goal title, "{target} {unit} reached") → fade out (3000ms→3500ms, then fully resets state). Not
interactive (`allowsHitTesting(false)` throughout).

**Windows delta**: **entirely missing** — no completion celebration/confetti animation anywhere on
Windows. Windows's goal completion is a plain `toast('Goal complete 🎉', {tone:'success'})`
one-line toast. This is the most visually distinctive Mac-only moment in this whole surface and
currently has zero Windows equivalent — good candidate for a dedicated follow-up if the team wants
delight-parity.

### 6.6 Canonical goals path (`WhatMattersNowSection.swift`)

When `accountGeneration != nil`: dashboard shows `canonicalGoalsWidget` (plain "Goals" header +
"All goals" text button + `FocusedGoalsSection`) instead of the legacy `GoalsWidget`.
`FocusedGoalsSection` renders up to 5 goal-title pill buttons ("Focused goals" label) or, if none
focused, "No focused goals" + "Add goal"/"Choose focus" button. "All goals" opens `AllGoalsSheet`
(620×540): Current/History segmented picker, goal rows, a focus/replace flow (`GoalFocusTarget`),
its own "Add goal" sheet, and a `Done` button. This is a **separate, newer implementation** of much
of what `GoalsWidget`/`GoalsHistoryPage` do — the two paths are not unified at this tag. A
"What Matters Now" recommendations card also lives in this file (headline/why-now/context/evidence
+ primary/Later/Dismiss actions) — task-adjacent AI recommendations, not goals, included here only
because it shares the file; treat as out of scope for this Tasks/Goals doc unless the port needs
the dashboard recommendation surface too.

**Windows delta**: Windows's `Goals.tsx` page (Active/Completed/All filter, AI-suggest banner via
`/v1/goals/suggest`, progress-bar-with-editable-number rows) most closely resembles a flattened
merge of Mac's legacy `GoalsWidget` + `AllGoalsSheet`/canonical path, but as a full page rather
than a sheet, and without: the emoji auto-icon, the traffic-light progress color, the linked-tasks
expand section, the insight/advice sheet, the completion celebration, or the "focused goals"
concept. Windows's progress bar fill is flat white (`bg-white/45`) — no color grading by
percentage.

---

## 7. Colors, typography, spacing

Palette (`Theme/OmiColors.swift`, dark-only — Mac has no light theme):

| Token | Hex | Used for |
|---|---|---|
| `backgroundPrimary` | `#0F0F0F` | Sheet/panel base backgrounds |
| `backgroundSecondary` | `#1A1A1A` | Search field, badges, cards |
| `backgroundTertiary` | `#252525` | Row hover, pills, popovers |
| `backgroundQuaternary` | `#35343B` | (not observed directly in this surface) |
| `backgroundRaised` | `#1F1F25` | Completed-task widget row |
| `border` | `#3A3940` | Card/chip strokes |
| `purplePrimary` | `#8B5CF6` | New-task/new-badge highlight, save/create CTAs, progress ring, "Generate AI Goal", goal type badges, `AllGoalsSheet` accents |
| `purpleSecondary` | `#A855F7` | (gradient partner, not directly seen here) |
| `purpleAccent` | `#7C3AED` | Gradient endpoint |
| `textPrimary` | `#FFFFFF` | Primary text, high-priority flag, filled checkboxes |
| `textSecondary` | `#E5E5E5` | Secondary labels, medium priority |
| `textTertiary` | `#B0B0B0` | Tertiary/help text, low priority, empty-state copy |
| `textQuaternary` | `#888888` | Deleted-task reason text, indent guide lines |
| `success` | `#10B981` | (not directly used in Tasks/Goals rows — goal progress uses its own 5-stop scale instead) |
| `warning` | `#F59E0B` | Chat-panel error banner icon |

**Important brand-guideline conflict**: `AGENTS.md` / `PRODUCT.md` state *"Never use purple —
enforced as a no-increase ratchet (`INV-UI-1`)"*, but at this tag `purplePrimary` (`#8B5CF6`) is
actively used throughout this surface: the "New" task badge, the inline-create row's stroke/fill/
accent-bar, the keyboard-selected row highlight, `TaskCreateSheet`'s tag-picker "Done" button
(dead code, see §1.7, but still purple), the goal-edit "Save"/"Add Goal" button, the goal-type
badges in history, the "Generate AI Goal" empty-state button, and the goal-insight progress ring.
**This is legacy debt grandfathered by the ratchet (no-*increase*, not no-existing-use) — do not
treat it as license to add new purple on Windows**, but also do not "fix" Mac's existing purple as
part of a faithful-port pass; port it as-is (matching Mac) and flag the ratchet question to the
user if asked to reconcile the two.

Typography: all text uses `.scaledFont(size:weight:)` (a Dynamic-Type-aware wrapper, not raw
SwiftUI `.font`), sizes observed range from 9pt (icon-adjacent micro-labels) to 32pt (celebration
headline). No custom font family is set in this surface (system font). Corner radii cluster at
4/6/8/10/12/14/16pt depending on element size (small pills=4-6, cards=8-16). Row vertical padding
is consistently 6-12pt; horizontal 12-16pt for page-level containers, 20pt for sheets.

Animation curves observed: `.easeInOut` (row/panel transitions, 0.12-0.3s), `.spring(response:
0.2-0.5, dampingFraction:0.5-0.9)` (checkbox scale-pop, swipe snap-back, celebration text), plain
`.easeOut`/`.easeIn` for one-directional reveals (confetti, row-delete-offscreen), and one
`CAMediaTimingFunction(.easeInEaseOut)` for the AppKit-level window-resize animation (chat panel
open/close) — that one is NSAnimationContext-driven, not SwiftUI `withAnimation`, since it animates
`NSWindow.frame` directly.

---

## 8. Data / wiring (Swift managers + backend endpoints)

- **`TasksStore` (singleton, `Stores/TasksStore.swift`)** — single source of truth for
  `incompleteTasks` / `completedTasks` / `deletedTasks`, backing `TasksViewModel`. Loads via
  `APIClient.getActionItems(...)` (paginated, offset-based) into these three arrays depending on
  filter mode; also owns `migrateStagedTasks()` / `migrateConversationItemsToStaged()` one-time
  migrations and `batchUpdateScores` (task-prioritization scoring, see
  `Services/TaskPrioritizationService` — referenced but not read in this pass).
- **`ActionItemStorage`** — local SQLite cache; used directly for search (`viewModel.performSearch`)
  and filtered-tag queries (bypassing the network for instant filtering), and for `sortOrder`/
  `indentLevel` writes (`updateSortOrders`).
- **Backend REST surface** (via `APIClient`, base path `v1/action-items`):
  `GET v1/action-items` (list, paginated), `GET v1/action-items/{id}`, `POST v1/action-items`
  (create), `PATCH v1/action-items/{id}` (update — description/dueAt/priority/recurrenceRule/tags/
  completed), `DELETE v1/action-items/{id}` (soft-delete-with-undo semantics live client-side; the
  DELETE call is the same either way), `PATCH v1/action-items/batch-scores`
  (`batchUpdateScores`), `PATCH v1/action-items/batch` (`batchUpdateSortOrders`), `POST
  v1/action-items/share` (`shareTasks` → share link). **These match the Windows `Tasks.tsx`
  endpoints exactly** (`GET/POST/PATCH/DELETE /v1/action-items`) — the REST contract itself is not
  a source of drift; the UI built on top of it is.
- **Goals backend surface**: `GET v1/goals/all` (`?include_ended=`), `GET v1/goals/{id}/detail`,
  `POST v1/goals`, `PATCH v1/goals/{id}`, `PATCH v1/goals/{id}/progress?current_value=N`, `DELETE
  v1/goals/{id}`, and — **`GET v1/goals/completed`** is defined in Mac's `APIClient.swift`
  (`getCompletedGoals()`, backs `GoalsHistoryPage`). **Discrepancy worth verifying**: Windows's
  `Goals.tsx` has an explicit code comment claiming *"There is no `/v1/goals/completed` GET
  endpoint"* and works around it by filtering `/v1/goals/all` client-side by `is_active`. Since
  Mac's client code calls `v1/goals/completed` directly, either (a) the endpoint exists and
  Windows's assumption is stale/wrong, or (b) it exists in the API surface but 404s/is unused in
  practice and Mac's `GoalsHistoryPage` is untested dead-ish code (plausible given §0's finding
  that its only trigger button is also dead). **Recommend a live check against the reference Mac
  mini or backend source before relying on either claim.**
- **Canonical goals surface** (`accountGeneration != nil` path): `POST v1/goals/canonical`, `GET/
  POST v1/goals/{id}/focus`, `v1/goals/{id}/lifecycle` — powers `WhatMattersNowSection`/
  `AllGoalsSheet`/`DashboardIntelligenceStore`. Not used by the legacy `GoalsWidget` path at all.
- **`TaskChatCoordinator`** (`ProactiveAssistants/Assistants/TaskAgent/TaskChatCoordinator.swift`)
  — owns workstream/thread identity per task (`taskToWorkstream`, `taskIdsByWorkstream`), projects
  a `TaskThreadProjection` for the side panel, tracks `streamingTaskIds`/`unreadTaskIds` (persisted
  to `UserDefaults` key `taskChat.unreadTaskIds`), and talks to a `TaskWorkstreamAPI` protocol
  (live impl `LiveTaskWorkstreamAPI`) plus `AgentRuntimeStatusStore` for live agent-activity
  projections. Explicit-creation invariant noted in §3.
- **`SuggestedTasksStore`** (`MainWindow/Tasks/SuggestedTasksStore.swift`) — quiet-capture
  candidate queue; `doNow`/`later`/`dismiss`/`presented` actions, likely backed by a task-
  intelligence feedback endpoint (`OmiAPI.TaskIntelligenceFeedbackReason` enum referenced) — not
  traced to a specific URL in this pass.
- **`GoalGenerationService` / `GoalsAIService`** — AI goal suggestion + per-goal insight text
  generation (singletons, `.shared.generateNow()` / `.getGoalInsight(goal:)`).
- **Legacy terminal-agent path** (`TaskAgentManager`, `TaskAgentViews.swift`) — launches a Claude
  Code CLI session in Terminal.app per task, tracks `AgentSession` status (pending/processing/
  editing/completed/failed) via `@Published activeSessions`. **Confirmed dead in the live row UI**:
  `Desktop/Tests/TaskChatLegacyAcpMigrationTests.swift` explicitly asserts `TasksPage.swift` no
  longer contains `AgentStatusIndicator(task: task)` — this whole file is a superseded predecessor
  to the `TaskChatCoordinator`/"Work on this with Omi" flow (§3) and should not be treated as a
  porting target unless the plan specifically wants the old terminal-launch model back.

---

## 9. Windows comparison — element-by-element rating

| Mac element | Windows equivalent | Rating |
|---|---|---|
| Sidebar "Tasks" entry, full-page list | `pages/Tasks.tsx` via router | Identical (both exist as a dedicated page) |
| Due-date category grouping (Today/Tomorrow/Later/No Deadline) | Bucket grouping (Overdue/Today/Tomorrow/Upcoming/No due date) | Minor drift (different bucket set/labels, same concept) |
| Multi-group filter-tag dropdown (status/date/category/source/priority/origin + dynamic + saved views) | 3-way open/done/all toggle | Major drift (large feature subset missing) |
| Drag-and-drop reorder + indent levels + persisted `sortOrder` | None | Missing |
| Swipe-to-delete/indent/outdent gestures | None | Missing |
| Inline row edit (title, debounced autosave) | Inline row edit (title, click-to-edit, blur/Enter commit) | Minor drift (Mac autosaves on a timer + blur; Windows commits on blur/Enter only — functionally similar) |
| Due-date inline popover (`DatePicker`, graphical) | Native `<input type="date">` inline | Minor drift (different picker chrome, same affordance) |
| Priority badge (grayscale, popover picker) | None | Missing |
| Tag/category badges + picker | None | Missing |
| Source badge / provenance ("Why" popover) | None | Missing |
| "Execute" / "Work on this with Omi" / "Open thread" agent actions | None | Missing |
| Task chat side panel + workstream threads | None | Missing |
| Task detail sheet (rich metadata by source) | None | Missing |
| Suggested-tasks quiet-capture card (Do now/Later/Dismiss) | None | Missing |
| Delete + Undo toast + soft-delete "Removed" filter | Delete with error-only toast, no undo, hard removal from list | Major drift |
| Keyboard navigation + shortcuts + hint bar | None | Missing |
| Completion-toggle animation (4-phase) | Instant toggle, no animation | Minor drift (functional parity, no polish) |
| Empty/loading/error states | Present, different copy/iconography | Minor drift |
| Filtered-empty vs. truly-empty distinction | Not distinguished | Minor drift |
| Dashboard Tasks widget (3 items, toggle-able, "Daily" pill) | Dashboard widget (2 items, read-only, due chip) | Minor-to-major drift (no inline toggle) |
| Sidebar "Goals" entry | `/goals` route + `TasksGoalsToggle` in both page headers | **Structural deviation** — Mac has no equivalent nav surface; see §0 |
| Dashboard Goals widget (emoji auto-icon, draggable progress bar, 5-color grading, expand/linked tasks) | `/goals` page cards (title, editable progress number, flat-color bar) | Major drift |
| Goal edit sheet | Inline composer (title/target/unit) on the Goals page | Minor-to-major drift (Mac is a modal sheet; Windows is inline; feature set close otherwise) |
| Goal insight/advice AI sheet | None | Missing |
| Goal completion celebration (confetti overlay) | Toast only | Missing (high-visibility gap) |
| Goals history (completed/removed) | `completed`/`all` filter tabs on the same page | Minor drift (Windows folds history into the main list via filter; Mac uses a separate, currently-unreachable sheet — Windows's approach may actually be *more* usable here, worth a product call rather than a straight port) |
| AI goal suggestion flow | `GET /v1/goals/suggest` banner with Accept/Another/Dismiss | Identical in spirit to Mac's canonical-path suggestion service, though Mac's legacy `GoalsWidget` path only has a single "Generate AI Goal" button with no preview/accept step |
| Canonical/"What Matters Now" focused-goals + All-Goals sheet | No equivalent | Missing (but this is a newer, gated Mac surface not universally live — lower port priority) |

---

## Open questions to flag before implementing

1. **Goals navigation model**: should Windows keep its dedicated `/goals` route (currently ahead
   of Mac's legacy dashboard-only widget), or should the port narrow it to match Mac's
   sheet-only/dashboard-only approach? Mac itself is mid-migration (legacy `GoalsWidget` vs.
   canonical `WhatMattersNowSection` path) — there is no single stable Mac target to copy exactly.
2. **`v1/goals/completed` endpoint reality** — resolve the Mac-client-vs-Windows-comment
   discrepancy (§8) against actual backend behavior before building/porting a goals-history view
   that depends on it.
3. **Task-chat/workstream surface (§3)** is the largest missing feature area and depends on
   backend workstream/thread APIs that may not be wired for Windows yet at all — likely a
   separate, larger project rather than a straightforward "match the pixels" port.
4. **Purple usage** (§7) — this surface is full of legacy purple that predates `INV-UI-1`. Decide
   explicitly whether the Windows port should carry it over 1:1 (faithful-port default) or take
   the opportunity to de-purple during the port (would then diverge from Mac).
