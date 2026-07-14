# Mac UI Port Spec — Memories, Conversations, Rewind (main window)

Reference: macOS Omi desktop app, tag `v0.12.72+12072-macos` (latest beta). Source root for all Swift citations: `desktop/macos/Desktop/Sources/...` (read from the `mac-ref` worktree). Windows comparison source: `desktop/windows/src/renderer/src/...` (read from the `mac-ui-refresh` worktree).

**Scope**: Memories list + Brain Graph, Conversations list/detail, Rewind (screenshot timeline/search) as shown in the **main app window**. The notch bar / floating bar is explicitly excluded per brief.

**Headline finding for the port**: at this tag, Mac's own UI **violates `AGENTS.md`'s "never use purple" rule (`INV-UI-1`)** pervasively across all three surfaces — it is legacy/ratcheted usage, not something to newly introduce. Windows has already made a deliberate, documented decision to de-purple everything (`nodeColor.ts`, `globals.css` — "same ramp, neutral hues, NO purple family"). This doc flags every purple usage as a **known, intentional divergence point**, not a bug to fix by copying Mac exactly. See §6.

---

## 1. Memories List

Source: `Desktop/Sources/MainWindow/Pages/MemoriesPage.swift` (3171 lines — `MemoriesViewModel` + `MemoriesPage` + `MemoryCardView` + sheets).

### 1.1 Header (`MemoriesPage.header`, lines 1649–1826)

Single `HStack(spacing: 12)`, `.padding(.horizontal 28, .top 24, .bottom 20)`:

1. **Search field** — magnifying-glass icon (or a spinner while `isSearching`/`isLoadingFiltered`) + `TextField("Search memories...")` + clear `xmark.circle.fill` when non-empty. `.omiControlSurface(fill: backgroundTertiary, radius: 18)`, `.horizontal 14, .vertical 12`, `minHeight: 46`.
2. **Layer filter dropdown** (`Menu`, only shown `if canonicalLifecycleExposed`) — options: Default / Short-term / Long-term / Archive (`MemoryLayerFilter`, lines 53–91). Icon toggles `archivebox` (Archive) vs `clock.badge.checkmark` (others). Non-default selection gets `backgroundRaised` fill + `border.opacity(0.6)` stroke instead of the plain `backgroundTertiary`.
3. **"This device" toggle** — `desktopcomputer` icon pill; active state = `backgroundRaised` fill + stroke, `textPrimary`; inactive = `backgroundTertiary`, `textSecondary`. Filters via `ClientDeviceService.shared.memoryMatchesThisDevice(_:)` when the backend's `device_scope=current` capability is unsupported (see §1.4).
4. **Category filter** (`line.3.horizontal.decrease` icon) — opens a 280pt-wide popover (`categoryFilterPopover`, lines 1855–2014): search field, "All" row with total count badge, then one row per `MemoryTag` (Manual/About You/Insights/Workflow — see §1.2) sorted by count descending, each with a count badge and checkmark when selected. Multi-select (`Set<MemoryTag>`). Footer: Clear / Apply buttons (Apply = white bg, black text).
5. **Add Memory button** — icon-only `plus`, 42×42, black icon on `OmiColors.textPrimary` (white) fill, 16pt corner radius.
6. **Management menu** — icon-only `chevron.down`, same 42×42 white-fill style. Opens `managementMenuPopover` (200pt wide, lines 2018–2102): "Make Default Memories Private" / "Make Default Memories Public" (both **disabled** — `areBulkServerMutationsAvailable` is hardcoded `false` at line 365, with tooltip "disabled until the backend supports layer-scoped operations"), divider, "Delete Default Memories" (destructive, `OmiColors.error`, also disabled by the same flag) → confirmation `.alert`.

### 1.2 Category taxonomy (`MemoryTag`, lines 9–51)

Four fixed categories, mirroring mobile exactly (no tag-derived pseudo-categories):
| Tag | Display name | Icon |
|---|---|---|
| `manual` | Manual | `square.and.pencil` |
| `system` | About You | `person` |
| `interesting` | Insights | `lightbulb` |
| `workflow` | Workflow | `arrow.triangle.branch` |

All tag colors resolve to `OmiColors.textSecondary` (no per-category color coding).

### 1.3 Memory card (`MemoryCardView`, lines 2381–2485)

`VStack(spacing: 10)` inside a `Button`:
- Row 1: content text (13.5pt, `textPrimary`, 2-line clamp, tail-truncated; `[Protected...]`/`[Encrypted...]`-prefixed content renders as italic "Protected memory" placeholder instead) + a `NewBadge()` (see §6 — purple) if `createdAt` is < 60s old.
- Row 2 (metadata, `HStack(spacing: 10)`): relative+absolute date (`formatDate`, e.g. "2h ago · Jul 14, 3:20 PM"), device-provenance label (`ClientDeviceService.deviceProvenanceLabel`), `MemoryLayerBadge` (only if `memory.tierIsExplicit` — canonical-cohort users only), `"From {sourceName}"`, spacer, `MemoryDetailButton` (info-circle hover tooltip, see below), and an `arrow.up.right` affordance shown only on hover.
- Card background: 4-way conditional — hovered → `backgroundRaised`; else newly-created → **`OmiColors.userBubble.opacity(0.24)`** (purple-family tint); else `backgroundSecondary`. `cornerRadius(18, continuous)`. Shadow deepens on hover (`0.08→0.14` opacity, `8→12` radius, `5→8` y).
- `onHover` pushes `NSCursor.pointingHand`.

**`MemoryLayerBadge`** (lines 2340–2379): capsule, icon + tier display name (Default/Short-term/Long-term/Archive), tappable to open an info popover explaining the tier. Archive = `textPrimary` on `backgroundRaised`; others = `textSecondary` on `backgroundTertiary`.

**`MemoryDetailButton`/`MemoryDetailTooltip`** (lines 2491–2648): hover-triggered `info.circle` icon (250ms debounced show/hide via `DispatchWorkItem`) opens a popover showing: Layer + expiry (if short-term), Category/Subcategory (Tips), Tags (filtered to exclude redundant category/tips/has-message tags), App/Source/Window, Context Summary, Current Activity, Confidence, Reasoning, Created timestamp — all as label:value rows (11pt).

### 1.4 View model behavior (`MemoriesViewModel`, lines 98–1504)

Local-first pattern throughout: SQLite cache (`MemoryStorage.shared`) painted instantly, then background API sync (`APIClient.shared.getMemoriesPage`) reconciles. Key mechanics:
- **Scope tokens** (`MemoryScopeToken`, lines 258–331): every async load captures a generation+filter snapshot so a stale response from a superseded filter/search never clobbers a newer one.
- **Device scope**: `filterThisDeviceOnly` tries `device_scope=current` server-side; a 400 response (legacy/non-canonical users) triggers a silent unscoped retry + `DesktopDiagnosticsManager.recordFallback(area: "other", from: "device_scoped", to: "unscoped", reason: "capability_mismatch", outcome: .degraded)` (lines 759–778) — this IS the fallback-telemetry pattern `AGENTS.md` mandates.
- **Pagination**: `pageSize = 100`. Two independent cursors — `currentOffset` (visible/SQLite cursor, tier-filtered) and `rawBackendOffset` (raw API cursor) — kept separate because a raw API page can contain fewer tier-matching rows than `pageSize` while later raw pages still hold matches (extensively commented, lines 213–219, 889–898, 1090–1097). Filtered/search mode paginates differently — `loadMoreFiltered()` just expands an in-memory `allFilteredResults` array (already fully queried), not another SQLite/API round-trip.
- **Delete with undo**: optimistic remove + 4-second countdown toast (`pendingDeleteMemory`, `undoTimeRemaining`, 100ms tick), `.easeInOut(duration: 0.2)` for insert/remove animations. Undo restores locally; timeout confirms via `APIClient.shared.deleteMemory`.
- **One-time background jobs**: `performFullSyncIfNeeded()` (full default-scope SQLite sync, gated by a per-user `UserDefaults` flag `memoriesDefaultScopeSyncCompleted_v3_{userId}`) and `reconcileCacheIfNeeded()` (orphan-row reconciliation, gated by `memoriesCacheReconcile_v2_defaultScopeNoPrune_{userId}`) — both run once per user session, fired from `loadMemories()`.
- **Automation actions** registered for the desktop bridge: `memories_search`, `memories_set_tag_filter`, `toggle_memory_visibility` (lines 1381–1487).

### 1.5 Memory detail sheet, add/edit sheets (`MemoryDetailSheet`/`AddMemorySheet`/`EditMemorySheet`, lines 2652–3171)

`MemoryDetailSheet` (450×≤600pt): header (category/tips tag badge, Public/Private `Toggle(.switch)`, delete trash icon, dismiss X) → content (click-to-edit inline `TextEditor`) → conditional "Why this tip?" reasoning card → conditional Context card (activity + summary) → Metadata card (Confidence/Source App/Device/Microphone/Created/Tags via `FlowLayout`) → "View Source Conversation" action row (only if `conversationId` present — navigates to `ConversationDetailView` in-place, replacing the Memories page body, `MemoriesPage.body` lines 1516–1529). `AddMemorySheet`/`EditMemorySheet` are near-identical 400pt sheets: title, 150pt `TextEditor`, Cancel/Save (Save = white pill when non-empty, disabled+dim when empty).

### 1.6 Empty / loading / error / no-results states (lines 2221–2332)

| State | Icon | Title | Body | CTA |
|---|---|---|---|---|
| Empty (no memories) | `brain.head.profile` 48pt | "No Memories Yet" | "Your memories and tips will appear here.\nMemories are extracted from your conversations." | "Add Your First Memory" — **white text on `OmiColors.purplePrimary`** fill, 8pt radius |
| No results (search/filter with 0 hits) | `magnifyingglass` 36pt | "No Results" | "Try a different search or filter" | "Clear Filters" (only if tags active) |
| Loading | `ProgressView` 1.2x | — | "Loading memories..." | — |
| Error | `exclamationmark.triangle` 36pt, `OmiColors.error` | "Failed to Load Memories" | "Check your connection and try again." | "Retry" — **white text on `OmiColors.purplePrimary`** fill |

---

## 2. Brain Graph (Memory Graph)

Source: `Desktop/Sources/MainWindow/Pages/MemoryGraph/MemoryGraphPage.swift` (SceneKit-based, 1023 lines).

### 2.1 Canvas treatment

Two hosts of the same `MemoryGraphSceneView` (`NSViewRepresentable` wrapping `SCNView`):
- **`MemoryGraphInlineCard`** (lines 73–140) — embedded at the top of the Memories list (`MemoriesPage.memoryList`, line 2109), fixed **350pt height**, `cornerRadius(20, continuous)`, wrapped in `.omiPanel(fill: backgroundSecondary, radius: 24, stroke: border.opacity(0.14), shadowOpacity: 0.14, shadowRadius: 12, shadowY: 8)`. Header row: "Brain Map" title (15pt semibold) + rebuild button (`arrow.clockwise`, 32×32 `omiControlSurface`) or spinner while rebuilding.
- **`MemoryGraphPage`** (lines 8–71) — full-bleed standalone page (`OmiColors.backgroundSecondary.ignoresSafeArea()`), minimal floating chrome only: top-left `xmark` dismiss (28×28, `white.opacity(0.5)`), top-right rebuild `arrow.clockwise` or spinner — **no boxes, no backgrounds**, deliberately chromeless per in-code comment.

`SCNView` config (lines 147–162): `allowsCameraControl = true` (native trackpad orbit/zoom/pan), `autoenablesDefaultLighting = false` (custom lighting), background `NSColor(0x1A1A1A)` (matches `backgroundSecondary`), `antialiasingMode = .multisampling2X`, **`preferredFramesPerSecond = 30`** (capped).

### 2.2 Node/edge styling

**Node radius** (`nodeRadius(for:)`, lines 682–687): fixed user/"you" node = **35pt**; others = `14 + min(connectionCount, 10) × 2.5` (i.e. connection-count-scaled, capped).

**Per-node visual** (`createSceneNodes`/`addNewSceneNodes`, lines 622–815): three concentric spheres per node —
1. Core sphere (16 segments, 24 for fixed node) — `diffuse`/`emissive` = node-type color (`emissive` at 0.5 opacity), `lightingModel = .constant` (unlit/flat shading).
2. Glow halo — `radius × 2.5`, 24–48 segments, same color at 0.03/0.025 diffuse/emissive opacity, `blendMode = .add`, double-sided.
3. (Fixed/"you" node only, implicitly via white override) — user node renders solid white core + white emissive instead of a type color.

**Node colors** (`KnowledgeGraphNodeType.nsColor`, lines 998–1006):
| Type | Color | Hex/value |
|---|---|---|
| Person | cyan | `NSColor.cyan` |
| Place | mint | `NSColor(0, 1, 0.62)` |
| Organization | orange | `NSColor.orange` |
| **Thing** | **purple** | `NSColor.purple` |
| Concept | blue | `NSColor.systemBlue` |
| Fixed/user | white | `NSColor.white` |

**Edges**: cylinders (`SCNCylinder(radius: 0.8)`, 6 radial segments) connecting node centers, colored by blending the two endpoint node-type colors at 0.25 alpha (`blendColors`, lines 855–864), `emission` at 0.15 alpha, unlit.

**Labels**: `SCNText`, billboard-constrained (always faces camera, `freeAxes: [.X, .Y]`), truncated to 16 chars + "..." past 18, font size 16pt (22pt for fixed/user node), `.medium` weight (`.bold` for fixed), white with 0.9-alpha white emissive, positioned below the node (`-(nodeRadius + textHeight + 12)`).

Materials/geometry are **cached by visual identity** (per node-type/segment-count/radius key) rather than built per-node — a documented performance fix (comment at lines 697–704) to avoid ~1200 unique GPU objects on a mid-size graph.

### 2.3 Clustering / layout

`ForceDirectedSimulation` (referenced, not included in provided files) — a custom force-directed layout run **off-main** via `Task.detached`. No explicit "clustering" UI (no cluster labels/boundaries) — layout emerges purely from the physics simulation with the user node fixed at origin (`fx=0, fy=0`).

### 2.4 Selection / interaction

`allowsCameraControl = true` gives native SceneKit orbit/pan/zoom (trackpad two-finger pan = orbit, pinch = zoom). `selectedNodeId: String?` exists on the view model but **no click-to-select handler was found wired into either `MemoryGraphPage` or `MemoryGraphInlineCard`** — selection state appears unused/vestigial in this surface at this tag.

### 2.5 Camera auto-fit

`autoFitCamera(animated:)` (lines 867–890): computes the max node distance from origin, derives camera Z from FOV (60°) with 30% padding (`× 1.3`), floors at `1200` for very small graphs. Animated variant uses `SCNTransaction` with **`animationDuration = 0.8`**.

### 2.6 Assemble-in animation choreography — exact timings

This is the one section Chris explicitly wants preserved precisely for the Windows port.

**Initial full load** (`loadGraph`, lines 294–380):
1. Fetch graph (`KnowledgeGraphStorage`/`APIClient.getKnowledgeGraph`), compute a stable FNV-1a **graph signature** (lines 443–467) over sorted node/edge ids+labels+types — used to skip re-simulation entirely when the graph is unchanged from the last visit (no "reload" flash on revisit).
2. If a cached on-disk layout exists for this exact signature (`~/Library/.../memory-graph-layout.json`) → `simulation.applyLayout(...)`, **zero physics**, scene renders instantly at rest.
3. Otherwise: freeze render-driven ticking (`isAnimating = false` to prevent a data race between the main-thread SceneKit delegate and the detached physics run), run **800 synchronous physics ticks** off-main (`Task.detached(priority: .userInitiated) { simulation.runSync(ticks: 800) }`), then persist the settled layout to the on-disk cache.
4. `createSceneNodes()` builds the scene (no per-node entrance animation on first full build — nodes appear already-positioned).
5. If freshly simulated (not cache-restored): **`isAnimating = true` for exactly 3 seconds** (`Task.sleep(nanoseconds: 3_000_000_000)`) of live per-frame settle animation, then stops. If cache-restored: `isAnimating = false` immediately (static).

**Incremental add** (`addGraphFromStorage`, lines 534–565 — used during onboarding, not the Memories page): 200 sync physics ticks off-main, then `addNewSceneNodes()` which **does** animate new entries in — each new node's `SCNTransaction` scale-in is **`animationDuration = 0.5`** (starts at `scale(0.01,0.01,0.01)`, animates to `(1,1,1)`), each new edge fades in with **`animationDuration = 0.5`** (`opacity: 0 → 1`). Then `autoFitCamera(animated: true)` (0.8s camera reframe, see §2.5), then another 3-second `isAnimating = true` settle window.

**Per-frame settle physics** (`updateSimulation`, lines 919–941): throttled to **~30fps** via the SceneKit delegate (`guard time - lastUpdateTime > 0.033`), runs `simulation.tick()` while `isAnimating && !simulation.isStable`, batches position writes in an `SCNTransaction` with `disableActions = true` (no implicit animation on the raw position set — motion comes purely from repeated small position deltas across frames, i.e. Euler-integrated physics, not an eased tween).

**Revisit-freshness guard**: `PollingConfig.shouldAllowActivationRefresh(lastRefresh:)` — a rendered scene within a cooldown window is served as-is on page revisit; no refetch, no re-layout, no camera reset.

### 2.7 Empty / loading states (`MemoryGraphInlineCard`, lines 104–127; `MemoryGraphPage`, lines 60–65)

| State | Treatment |
|---|---|
| Loading (`isLoading` or empty-and-not-rebuilding) | Centered `ProgressView`, 1.1–1.2x scale, `white.opacity(0.4–0.45)` tint. No label text. |
| Empty (inline card only) | `brain` icon (18pt, `textTertiary`) + "Brain map will appear once enough linked memories are available." (12.5pt, `textSecondary`, centered) |
| Rebuilding | Spinner replaces the rebuild button (both hosts) |

`prepareGraph()` bootstraps an empty graph **once per session**: triggers `rebuildGraph()` then polls `loadGraph()` every 3s up to 10 times waiting for the backend to populate.

---

## 3. Conversations (list + detail)

Sources: `Desktop/Sources/MainWindow/Pages/ConversationsPage.swift`, `Components/ConversationListView.swift`, `Components/ConversationRowView.swift`, `Pages/ConversationDetailView.swift`, `Components/RecentConversationsWidget.swift`, `MainWindow/Conversations/ConversationRepository.swift`.

### 3.1 List page header & controls (`ConversationsPage.swift`)

- Header (lines 190–213): "Conversations" title (18pt semibold) + "Quick Note" pill (`note.text`, posts `.navigateToRewindNotes`) + "Start Recording" pill (`mic.fill`, black-on-white, only shown `if !appState.isTranscribing`).
- Search (lines 239–277): 250ms-debounced (`SearchDebouncer`), `omiControlSurface(fill: backgroundSecondary, radius: 18, stroke: border.opacity(0.18))`, min height 46.
- Filters (lines 469–571): "Starred" toggle (star/star.fill, amber when active) + "Date" popover (`DatePicker(.graphical)`, 300pt) + combined "clear all" affordance when any filter active.
- `FolderTabsStrip` (`Components/FolderManagementViews.swift`): horizontal chip row — All / Starred / one per `Folder` / "+" create. Selected chip = `textPrimary.opacity(0.12)` fill + `textPrimary.opacity(0.3)` stroke; folder chips have an Edit/Delete context menu.
- **Multi-select + merge**: `isMultiSelectMode` toggles a checkbox per row; a floating `mergeActionBar` (bottom-anchored, `.move(edge:.bottom).combined(with:.opacity)` transition) shows selection count, Select All/Deselect All, and a "Merge" button (enabled at ≥2 selected) that calls `APIClient.mergeConversations(ids:)` behind a destructive confirmation alert ("combine them into a single conversation and delete the originals. This action cannot be undone.").

### 3.2 List body & row (`ConversationListView.swift` + `ConversationRowView.swift`)

**Date grouping** (`flatListItems`, lines 47–92 of `ConversationListView.swift`): a single flat list (deliberately not nested `ForEach`, to dodge a documented SwiftUI layout-hang bug) grouped into "Today" / "Yesterday" / `"MMM d, yyyy"` sections, sorted Today → Yesterday → date-descending. `LazyVStack(spacing: 12)` in a `ScrollView` with `.refreshable`.

**Row — two size variants** (`ConversationRowView.swift`), controlled by `@AppStorage("conversationsCompactView")` (default `true`, **no UI toggle exists anywhere in the reviewed code to flip it** — the expanded variant is effectively dead code at this tag):
- Compact (default, lines 251–334): optional multi-select checkbox → 36×36 emoji tile (`structured.emoji` or 💬 fallback, `backgroundRaised`, 12pt radius) → title (14pt medium) + `NewBadge()` if <60s old + hover-revealed inline actions (edit-title pencil, copy-link, folder menu, delete) → metadata line (`formattedTimestamp · formattedDuration`, 12pt `textTertiary`) → trailing star toggle.
- Card fill: selected → **`purplePrimary.opacity(0.22)`**; hovering → `backgroundRaised`; newly-created → **`userBubble.opacity(0.18)`**; else `backgroundSecondary`. Corner radius 18 (20 expanded). Stroke: selected → `purplePrimary.opacity(0.4)`, else `border.opacity(0.14)`.
- **Timestamp format** (lines 42–79): today → `"h:mm a"`; yesterday → `"'Yesterday,' h:mm a"`; same year → `"MMM d, h:mm a"`; other year → adds `, yyyy`.
- **Duration format**: `"{m}m {s}s"` or `"{s}s"` alone if under a minute, from `finishedAt - startedAt` (falls back to last transcript segment end time).
- **Row shows no per-item source icon** — `sourceLabel` is computed but only ever rendered in the detail view's metadata chip, not the list row.
- Context menu: Copy Transcript, Copy Link, Edit Title, Move to Folder (submenu with checkmark + Remove), Delete (destructive).

**`RecentConversationsWidget`** (dashboard-embedded): "Recent Conversations" header + "View All" purple-text link; every row's tap navigates to the full page (not the item directly); card = `backgroundTertiary.opacity(0.5)` / `backgroundQuaternary.opacity(0.5)` stroke, 16pt radius.

### 3.3 Detail view (`ConversationDetailView.swift`)

**No tabs.** One always-visible summary body + a slide-in transcript **drawer** (not a tab switch).

**Header** (lines 284–362): Back button (`chevron.left` + "Back", purple) → 28pt emoji (💬 fallback) → title (18pt semibold, 1-line) + inline edit-title pencil (opens a `TextField` alert) → subtitle time-range (`"MMM d, yyyy from h:mm a to h:mm a"` or `"...at h:mm a"` if not finished) → status badge (only if `status != .completed`, capsule at `statusColor.opacity(0.2)`: completed=success/green (never shown, guarded out), processing/merging=info/blue, **inProgress=warning/amber**, failed=error/red) → "View/Hide Transcript" pill (purple fill + white text when open, `backgroundTertiary`/`textSecondary` closed; toggle animates `.easeInOut(duration: 0.25)`) → inline actions (copy link with spin-while-working icon, copy transcript, move-to-folder menu, delete).

**Body — "Conversation Details" card** (lines 114–178): single card, `cornerRadius 16`, `backgroundSecondary.opacity(0.6)` fill, `backgroundTertiary.opacity(0.3)` stroke, `shadow(black.opacity(0.1), radius: 20, y: 8)`. Entry animation: fade+offset(`y: 20→0`), `.easeOut(duration: 0.5)`. Ordered sections (each conditional):
1. Deferred-processing banner (spinner + "Processing conversation… / Generating summary and action items") — only while `isEnrichingDeferred`.
2. **Summary/overview** — gold star icon + `SelectableMarkdown` body, dark-color-scheme forced.
3. **Metadata chips** (always shown) — source (`dot.radiowaves.left.and.right`), duration (`hourglass`), category (`tag`, only if not empty/"other") — each a `Capsule().fill(backgroundTertiary)`.
4. **App Insights** (`appResultsSection`) — only if apps produced results; per-result card with app icon/name, expand/collapse (auto-expand under 200 chars), "Generated by {app}" footer.
5. **Try with Apps** (`suggestedAppsSection`) — always rendered, horizontal scroll of up to 4 app cards (56×56 icon) for memory-capable apps not already run; empty-state copy when none available.
6. **Action Items** — only if any exist (soft-deleted filtered out). Checkmark-circle (success green)/empty-circle icon + description (strikethrough+dim when completed). **Read-only** — no tap-to-toggle handler exists in this view; completion is display-only of backend state. Count badge = purple capsule.

**Transcript drawer** (lines 601–712): slides from the right (`.move(edge: .trailing)`), fixed **450pt** width, 1pt `border` divider from the main content. Header: `text.quote` icon + "Transcript" (15pt semibold) + segment-count badge (purple capsule) + Copy + Close (`.easeInOut(duration: 0.25)`). States: locked (`lock` icon, "Transcript locked" — when `transcriptPresenceState == .lockedOrRedacted`), empty (`text.quote`, "No transcript available"), loading (`ProgressView` + "Loading transcript..."), else speaker bubbles.

**Speaker bubbles** (`SpeakerBubbleView`): 32×32 avatar (purple for the user, purple-at-0.3 for a named speaker, `backgroundQuaternary` for anonymous), opposite-side placement (leading=other, trailing=user). Bubble fill: **user = `OmiColors.userBubble`**; others cycle through the 6 `speakerColors` (dark blue-gray/navy/dark teal/dark brown/**dark purple**/dark amber) by `speakerId % 6`. Unnamed speaker labels are tappable (opens `NameSpeakerSheet` to assign a `Person`). No `.textSelection` per-bubble (documented perf fix — 2+s hang at 400 segments; copy goes through the header Copy button instead). Per-bubble `mm:ss` timestamp.

### 3.4 In-progress / live conversation treatment

**No dedicated "recording" badge in the list row.** The only in-list signal for a very-recent conversation is the generic <60s "newly created" styling (`NewBadge()` + `userBubble.opacity(0.18)` tint) shared with every other freshly-created row — not specific to in-progress status. The **detail view** does distinguish `.inProgress` via the amber status badge (§3.3). `ConversationReconciliationPolicy.shouldPreserveLocalOnly` keeps an in-progress local session pinned in the merged list even if the server's list response temporarily omits it. Live transcript display itself (waveform, streaming text) belongs to the floating/notch bar (`LiveTranscriptPanel`, out of scope) — the Conversations tab shows only post-recording rows.

### 3.5 States (consolidated)

| Surface | Empty | Loading | Error |
|---|---|---|---|
| List | `bubble.left.and.bubble.right` 48pt + "No Conversations" / "Start recording to capture your first conversation" | Purple-tinted spinner + "Loading conversations..." | `exclamationmark.triangle` (warning/amber) + "Failed to load conversations" / "Check your connection and try again." + "Try Again" (`omiControlSurface(fill: userBubble)` — purple) |
| Search results | `magnifyingglass` @0.5 opacity + "No conversations found" / "Try a different search term" | "Searching..." | "Couldn't search conversations. Check your connection and try again." |
| Transcript drawer | `text.quote` @0.5 opacity + "No transcript available" | "Loading transcript..." | (locked state substitutes) |
| No permission-missing state found in this surface — permission handling lives in `PermissionsPage.swift`, not inline here. | | | |

### 3.6 Data / wiring

- **Repository** (`ConversationRepository.swift`) is the sole cache/network owner; `AppState` is a thin presentation adapter. Cache-first load (`TranscriptionStorage` SQLite) always revalidated against server, merged via `ConversationReconciliationPolicy.mergeList`, emitted as tagged snapshots (`.cache`/`.server`/`.optimistic`/`.rollback`).
- **Optimistic mutations** (star, title, folder) go through `mutate(id:operation:remotely:)` — stage overlay immediately, call remote, replace-on-success or roll-back-on-failure, serialized per-conversation-id via an async mutation-slot queue.
- **No infinite-scroll pagination** — list fetch is hardcoded `limit: 50, offset: 0` (`APIClient.getConversations`); search is fixed `perPage: 50`.
- **Endpoints** (`APIClient.swift`): `GET v1/conversations` (list), `GET v1/conversations/{id}` (detail), `DELETE v1/conversations/{id}?cascade=true`, `PATCH .../starred`, `PATCH .../visibility` (also builds the `h.omi.me` share link), `PATCH .../title`, `POST v1/conversations/search`, `GET v1/conversations/count` (5s-cached), `POST v1/conversations/merge`, folder CRUD (`v1/folders*`), `PATCH .../folder`, `POST .../reprocess`.
- **`ConversationFinalizationService`**: turns a finished local recording into a backend conversation, either by uploading merged local segments (500-segment compaction) or polling/reconciling against the backend's own STT output (5 retries, exponential backoff, falls back to local-segments upload if cloud reconciliation is exhausted).

---

## 4. Rewind (main window)

Sources: `Desktop/Sources/Rewind/UI/RewindPage.swift` (primary, wired-in surface), `RewindTimelineView.swift`/`RewindTimelinePlayerView.swift`/`RewindSearchBar.swift` (secondary/reference components — see caveat below), `Core/{MemoryModels,MemoryStorage,RewindDatabase,RewindModels,RewindOCRService,RewindStorage}.swift`, `Services/RewindIndexer.swift`, `MainWindow/RewindOnlyView.swift`, `MainWindow/Pages/Settings/Sections/SettingsContentView+Rewind.swift`.

**Important caveat**: `RewindSearchBar.swift` and the richer `RewindTimelineView.swift`/`RewindTimelinePlayerView.swift` are **not wired into the live `RewindPage`** — `RewindPage` implements its own inline search field, its own timeline data feed (delegated to a separate `InteractiveTimelineBar` type not in this file set), and its own static frame viewer (no VCR transport). Treat the unused files as **design reference only** (they show the richer intended pattern — per-app color-hashed activity markers, hover-preview tooltips, a full play/pause/speed transport) — the Windows port should match what `RewindPage` actually does, not the unused components, unless deliberately upgrading.

### 4.1 Timeline UI — overall layout (`RewindPage`)

`ZStack` on `Color.black`, `VStack(spacing: 0)`: optional recovery banner → `unifiedTopBar` (persistent) → mode-dependent content (`emptyState`/`timelineContentBody` in browse mode; `noSearchResultsView`/`timelineWithSearch`/`fullScreenResultsView` in search mode).

**Unified top bar** (lines 392–500): `backgroundTertiary.opacity(0.8)` background, `.horizontal 16, .vertical 10`. Left: back-chevron (search mode) or "Rewind" title + `⌘⌥R` hotkey pill. Center: search field + date-picker pill (`"MMM d, yyyy"`, opens a `.graphical` calendar popover). Right (search mode only): list/timeline view-mode segmented toggle (black-on-white active pill). Far right: gear (opens Settings → Rewind) + `rewindToggle` monitoring switch.

**`rewindToggle`** (lines 322–348): 36×20 capsule, filled **`OmiColors.purplePrimary`** when on / `Color.red` when off, white 16×16 knob sliding between `x:-8`/`x:8` with **`.easeInOut(duration: 0.15)`**. Shows a `ProgressView` + 0.5 opacity while toggling.

**Timeline scrubber**: the actual scrub bar in the live page is `InteractiveTimelineBar` (not in the provided file set — implementation elsewhere). `RewindPage` feeds it `screenshots`, `currentIndex`, and `searchResultIndices` (highlighted matches when searching). No explicit zoom control; horizontal scale is implicitly count-of-samples across bar width. Samples are capped at **500 screenshots/day** (`getScreenshotsSampled(..., targetCount: 500)`).

**Bottom info row** (lines 777–836): match-count legend (yellow swatch, only while searching with results) — spacer — `"{index+1}/{count}"` + compact date (10pt monospaced) — "scroll or drag to navigate" hint (9pt, 0.3 opacity). Sits over a top-clear-to-`black.opacity(0.7)` gradient.

**Navigation input**: left/right arrow keys, global scroll-wheel monitor (sensitivity 0.5), direct drag/click on the scrub bar.

### 4.2 Thumbnail grid / activity markers

There is no separate "thumbnail grid" page in the live `RewindPage` — thumbnails surface only inside search results (§4.3, 120×80 lazily-loaded) and the reference `HoverPreviewTooltip` (160×100, unused component). The reference `RewindTimelineView` (unused) shows the intended richer pattern: `Canvas`-drawn per-frame activity markers colored by a **deterministic per-app hue hash** (`Color(hue: hash(appName)%360/360, saturation: 0.6, brightness: 0.8)`), current-position indicator = **`OmiColors.purplePrimary`** 2pt rect, hover = 1pt white line + floating preview tooltip.

### 4.3 Search

**Search bar** (`RewindPage.searchField`, inline in the top bar, not the standalone `RewindSearchBar` component): magnifying-glass (purple when focused) → `TextField("Search your screen history...")` → spinner while searching, else a results-count label, else a clear button. `.frame(maxWidth: 400)`, `white.opacity(0.1)` background, 8pt radius, focus stroke = **`purplePrimary.opacity(0.5)`**. Debounced **300ms**.

**What it searches**: FTS5 full-text over OCR text + window title + app name (`screenshots_fts` virtual table, BM25-ranked, query-expanded for camelCase/number boundaries), **plus** a parallel semantic/vector search (`OCREmbeddingService.searchSimilar`, topK 50, similarity > 0.5) merged in (FTS hits first, then vector-only). Always scoped to the currently-selected day.

**Results presentation** — two modes (segmented toggle):
1. **List** (`fullScreenResultsView`) — Google-style vertical list, grouped by `(appName, windowTitle)` + a rolling 30-second session window (`groupedByContext`). Each row: app icon + name (purple) + window title → time range → highlighted snippet (matched substring **bold white**, rest at 0.6 opacity) → group-count badge (purple pill, if >1) + "Result N of M" → 120×80 thumbnail. Selected row = `purplePrimary.opacity(0.15)` fill + `purplePrimary.opacity(0.4)` stroke.
2. **Timeline** (`timelineWithSearch`) — normal frame-viewer + scrub-bar layout, scoped to the current match group, with matched indices highlighted yellow on the timeline.

**Bounding-box highlight overlay**: for every OCR text block matching the query, `SearchHighlightOverlay` draws a `purplePrimary`-stroked (2pt) + `purplePrimary.opacity(0.2)`-filled rectangle at the block's normalized bounding box (Vision coordinates flipped to top-left origin), directly composited on the frame image.

### 4.4 Playback / preview

**Live surface** (`RewindPage.frameDisplay`, lines 705–773) — **static frame viewer driven by scrubbing, not an auto-play video.** No play/pause transport in the live page. Aspect-fit letterboxed image, 4pt corner radius, `shadow(black.opacity(0.3), radius: 8)`. Loading spinner shown only when there's no stale frame to hold onto during a scrub (old frame persists to avoid flicker). Every navigation cancels the in-flight load and stamps a new request id so a fast scrub can never let a stale async result clobber a newer selection; a failed frame load (e.g. mid-encode video chunk) leaves the last valid image on screen rather than showing an error.

**No crossfade/dissolve between frames anywhere** — frame changes are instantaneous swaps. Explicit animation timings in this surface: toggle-knob slide `easeInOut(0.15)`, search-focus color `easeInOut(0.15)`, transcript-expand `easeInOut(0.2)`, finish-conversation pulse `easeInOut(0.8)` repeat-forever autoreverse.

**Unused richer player reference** (`RewindTimelinePlayerView`, for design intent only): full VCR transport — skip-to-start/prev-frame/play-pause (64×64 white circle)/next-frame/skip-to-end, speed picker (0.5/1/2/4/8×), color-coded activity strip above a purple-tinted native `Slider`, `Timer`-driven playback at `1/speed` seconds/frame.

**`ScreenshotPreviewView`** (unused, detail-inspect reference): header with match-count badge, image + highlight overlay + edge nav arrows, bottom "Extracted Text" panel with Copy button and search highlighting.

### 4.5 Retention / settings surfaces

**Inline in `RewindPage` itself**: only the `rewindToggle` monitoring switch and (conditionally) a recovery banner after DB-corruption recovery (orange, "Database Recovered" + conditional "Rebuild Index" button that re-scans on-disk video chunks). **No storage-usage or retention-days control is shown inline** — those live only in Settings.

**Settings → Rewind** (`SettingsContentView+Rewind.swift`) — four cards, all icons tinted **`purplePrimary`**:
1. **Storage** — frame count + formatted byte size (`RewindIndexer.getStats()`).
2. **Excluded Apps** — capture pauses automatically while these are frontmost; "Reset to Defaults"; empty-state or a list of removable app rows; an add-app text field seeded from `TaskAssistantSettings.builtInExcludedApps`.
3. **Battery Optimization** — informational only, no user control ("Automatic" label); actual behavior = **3× capture interval** on battery (`batteryCaptureIntervalMultiplier = 3.0`).
4. **Data Retention** — menu picker, **3 / 7 / 14 / 30 days** (default 7).

**`RewindOnlyView`/`RewindSettingsWindow`** — a second, standalone settings surface used only in a chromeless `--mode=rewind` launch: duplicates a subset with different copy/options — retention picker offers **1 / 3 / 7 / 14 / 30 days** (note the extra 1-day option not present in the main Settings card), plus a Screen Capture on/off `.switch`, a Storage info card showing the literal on-disk path with "Show in Finder", and a Permissions row for Screen Recording.

Retention enforcement: `RewindIndexer.runCleanup()` — `cutoffDate = today - retentionDays` → delete rows/files/orphaned day-directories, throttled to at most once per 6 hours.

### 4.6 States

| State | Icon | Title | Body | CTA |
|---|---|---|---|---|
| Loading (first load only) | `ProgressView` 1.2x | — | "Loading screenshots..." | — |
| Error | 80×80 `error.opacity(0.1)` circle + `exclamationmark.triangle` 36pt | "Failed to Load Screenshots" | "Try again. If this continues, restart Omi." | white "Retry" pill |
| **ScreenCaptureKit broken** (highest priority) | 80×80 red circle + `rectangle.on.rectangle.slash` 36pt | "Screen Recording Needs Reset" | "macOS granted permission but ScreenCaptureKit is stuck.\nResetting fixes this — the app will restart automatically." | "Reset & Restart" (red pill) |
| **Permission missing** | 80×80 orange circle + `lock.rectangle` 36pt | "Screen Recording Permission Required" | "Rewind needs Screen Recording permission to capture your screen." | "Grant Permission" (orange pill) |
| Empty (no captures, permission fine) | 80×80 **purple-tint** circle + `clock.arrow.circlepath` 36pt | "No Screenshots Yet" | "Screenshots will appear here as you use your Mac.\nRewind captures your screen every second." | none — a tip callout below: "Tip: Use search to find anything you've seen on screen" |
| No search results | `magnifyingglass` 48pt @0.3 | — | "Searching..." (while loading) or "No results found" / "Try a different search term" | — |
| No frame at current index (list non-empty) | `photo` 24pt | — | "No frame" | — |

### 4.7 Data / wiring — entirely local, no backend calls

`RewindPage` (View) → `RewindViewModel` (`@MainActor`) → `RewindDatabase` (actor, GRDB/SQLite, WAL) + `RewindStorage` (actor, file I/O) + `RewindIndexer` (actor, capture pipeline) + `RewindOCRService` (actor, Apple Vision OCR).

- **`RewindViewModel`**: debounced (300ms) search pipeline; a throttled (2s) stat-update on `.rewindFrameCaptured`; a **silent** 3-second repeating auto-refresh (`refreshTimelineIfViewingToday`) that only commits when the screenshot-id set actually changed, specifically to avoid destroying SwiftUI state (e.g. an in-progress typed note) during background polling.
- **`RewindDatabase`**: per-user SQLite (`~/Library/Application Support/Omi/users/{userId}/omi.db`), WAL mode. Heavily defended lifecycle — unclean-shutdown flag file, stale-WAL cleanup, multi-tier corruption recovery (`sqlite3 .recover` → direct-table salvage → fresh DB, with the corrupted file backed up), legacy shared-path migration, IO-error-counter-triggered pool force-close, generation/epoch counters guarding concurrent init/close/user-switch races.
- **`RewindStorage`**: two on-disk trees per user — `Screenshots/` (legacy per-day JPEGs) and `Videos/` (H.264/H.265 MP4 chunks). `loadScreenshotImage` tries `AVAssetReader` frame extraction first, falls back to an `ffmpeg` subprocess, caches in an `NSCache` (100 items/~100MB).
- **`RewindIndexer`**: capture entry point — perceptual-hash (dHash) dedup → hand off to video encoding → every-3rd-frame OCR gating (plus a second dHash check) → Apple Vision OCR → DB insert → fire-and-forget embedding for semantic search. Also owns retention cleanup, battery→AC OCR backfill, and the corruption-recovery "Rebuild Index" flow.
- **`RewindOCRService`**: `VNRecognizeTextRequest` at `.accurate` level, `en-US` only, language correction on; also owns the dHash perceptual-fingerprint dedup shared with the indexer.
- **Backend calls: none.** Rewind is entirely local (SQLite + on-disk media). The only backend-adjacent surface is optional syncing of *extracted memories* (a different feature, `MemoryStorage`/`MemoryModels`) fed partly by Rewind's OCR pipeline — out of scope for this timeline/search/playback UI.

---

## 5. Delta since baseline (`0d09ede61b76dc4a144d05809432bf220394ee3a..v0.12.72+12072-macos`)

`git log` filtered to the Memories/Conversations/Rewind Swift paths across that range returns **~40 commits, all bug fixes / reliability / performance hardening — zero UI redesign commits** in this window. Representative entries:

- `7ec620423` "stop MemoryGraph render tick from racing the off-main layout run" — the exact `isAnimating` guard documented in §2.6 was a fix, not original design.
- `08f67e56e` / `6de00cbf4` / `b955e3b0a` — the dual-cursor (`currentOffset`/`rawBackendOffset`) pagination fixes described in §1.4.
- `b6010a194` / `01e536e6a` "Improve desktop memory graph revisit performance" — the graph-signature cache-skip mechanism in §2.6 point 2.
- `eb583109a` "restore This device filtering" — the device-scope fallback in §1.4.
- `6803d2849` "make conversation cache reconciliation authoritative" — repository merge-policy behavior in §3.6.
- `02516d90f` / `334277d0f` / `bd72e551d` / `a06afa74e` / `a98c4e2d7` / `2efd54dc2` / `02f0b41da` — the RewindDB/WAL corruption-recovery and video-frame-offset hardening described in §4.7.
- `314e5e0ff` "stop Rewind retention cleanup from wiping the screenshot store" — §4.5 retention enforcement.

**Conclusion**: any "recent UI overhaul" for these three surfaces predates the `0d09ede` baseline commit — within this range the changes are exclusively correctness/performance/reliability, meaning **the design documented above is stable and safe to treat as current-state truth** for the Windows port (not mid-flux).

---

## 6. Design tokens — colors, typography, spacing, animation

### 6.1 Color tokens (`Theme/OmiColors.swift`)

| Token | Hex | Windows equivalent (`globals.css`) |
|---|---|---|
| `backgroundPrimary` | `#0F0F0F` | `--bg-primary` ✓ identical |
| `backgroundSecondary` | `#1A1A1A` | `--bg-secondary` ✓ identical |
| `backgroundTertiary` | `#252525` | `--bg-tertiary` ✓ identical |
| `backgroundQuaternary` | `#35343B` | `--bg-quaternary` (`#34343 8`, ~identical) |
| `backgroundRaised` | `#1F1F25` | `--bg-raised` (`#1f1f22`, ~identical) |
| `border` | `#3A3940` | `--border: rgba(255,255,255,.09)` / `--border-strong: rgba(255,255,255,.16)` (translated to alpha-over-dark equivalents, not a literal hex) |
| `textPrimary`/`Secondary`/`Tertiary`/`Quaternary` | `#FFFFFF`/`#E5E5E5`/`#B0B0B0`/`#888888` | `--text-primary/secondary/tertiary/quaternary` ✓ identical |
| `success`/`warning`/`error`/`info` | `#10B981`/`#F59E0B`/`#EF4444`/`#3B82F6` | `--success/warning/error/info` ✓ identical |
| **`purplePrimary`** | **`#8B5CF6`** | **Deliberately NOT ported** — Windows uses `--accent: #ffffff` / `--accent-contrast: #0f0f0f` instead (INV-UI-1, "never purple") |
| `purpleSecondary`/`purpleAccent`/`purpleLight` | `#A855F7`/`#7C3AED`/`#D946EF` | not ported |
| `userBubble` | `#43389F` (also purple-family) | needs a Windows-side neutral/white-accent substitute — not yet confirmed present |
| `speakerColors[0..5]` | `#2D3748 #1E3A5F #2D4A3E #4A3728 #3D2E4A #4A3A2D` (index 4 = "dark purple") | needs confirmation on Windows transcript rendering |

### 6.2 Radius scale (`Theme/OmiChrome.swift`) — Windows ports this exactly

| Token | Value | Windows (`globals.css`) |
|---|---|---|
| `windowRadius` | 26 | `--radius-window: 26px` ✓ |
| `cardRadius` | 24 | `--radius-card: 24px` ✓ |
| `sectionRadius` | 20 | `--radius-section: 20px` ✓ |
| `controlRadius` | 16 | `--radius-control: 16px` ✓ |
| `chipRadius` | 14 | `--radius-chip: 14px` ✓ |

`omiPanel()` default shadow: `black.opacity(0.14), radius 18, y 10`. `omiControlSurface()` default shadow: `black.opacity(0.08), radius 8, y 4`.

### 6.3 Typography

Mac: `scaledFont(size:weight:design:)` — `.system(size:, weight:, design:)` scaled by a user-adjustable `FontScaleSettings.shared.scale` (persisted, default 1.0). No custom font family — pure SF (system). Common sizes observed across these three surfaces: page titles 18/semibold, card/section headers 13–16/semibold-medium, body/row text 13–15, metadata/captions 10–12, badges 10–11/semibold.

Windows: `Inter Variable` (SF Pro analog) via `--font-app`, with a Segoe UI Variable fallback stack and an A/B `data-font="segoe"` escape hatch — no direct Mac equivalent (Mac has no font-family choice, only a scale factor). Note this as a platform-appropriate divergence, not a gap.

### 6.4 Animation durations/curves observed in these three surfaces

| Interaction | Mac duration/curve | Windows equivalent (`globals.css`) |
|---|---|---|
| Memory card delete/undo | `.easeInOut(duration: 0.2)` | — |
| Memory graph new-node scale-in / edge fade-in | `SCNTransaction`, `0.5`s | — |
| Memory graph camera auto-fit reframe | `SCNTransaction`, `0.8`s | — |
| Memory graph settle-after-load window | live physics for `3.0`s, then stop | — |
| Memory graph per-frame tick throttle | ~30fps (`0.033`s guard) | — |
| Rewind toggle knob slide | `.easeInOut(duration: 0.15)` | — |
| Rewind search-focus color | `.easeInOut(duration: 0.15)` | — |
| Conversation transcript drawer open/close | `.easeInOut(duration: 0.25)` | — |
| Conversation detail entry (fade+rise) | `.easeOut(duration: 0.5)` | close analog: `.page-enter` `360ms cubic-bezier(0.22,1,0.36,1)` |
| Conversation merge-bar / detail transitions | `.move(edge:.bottom/.trailing).combined(with:.opacity)`, default curve | close analog: `--ease-out: cubic-bezier(0.22,1,0.36,1)` general-purpose easing token |
| — | — | Windows brain-graph node lerp: `0.045` per-frame factor (continuous glide, not a fixed-duration tween) — a **different animation model** than Mac's SCNTransaction tweens; see §7 BrainGraph row |

Windows' general motion tokens (`--ease-out`, `--ease-morph`, `--dur-fast 120ms`/`--dur-med 180ms`/`--dur-slow 320ms`) are a systemized approximation of Mac's per-interaction ad-hoc durations — none of the Mac-specific durations above (0.15/0.2/0.25/0.5/0.8/3.0s) map 1:1 onto the fast/med/slow scale, so a literal-value port (not just curve-family matching) is needed anywhere this doc calls out an exact number.

---

## 7. Windows comparison — component ratings

| Mac component | Windows component | Rating | Notes |
|---|---|---|---|
| `MemoriesPage` header (search + layer filter + device filter + category filter + add + management menu) | `pages/Memories.tsx` header (title/count + Select/New only) | **Major drift** | Windows has no layer filter (Short-term/Long-term/Archive), no category/tag filter dropdown, no "This device" toggle, no management-menu bulk-visibility actions. Windows' "Select" mode (multi-select delete) has no Mac list-view equivalent (Mac's multi-select-and-bulk-delete only exists on Conversations, not Memories). |
| `MemoryCardView` (2-line preview, device/source/layer badges, hover info tooltip, "New" badge, arrow-on-hover) | Memories.tsx list item (headline/content, category badge, tags, hover edit/visibility icons) | **Major drift** | Windows shows category text badge + raw tags inline (Mac hides tags from the card, exposes them only in the hover tooltip). Windows has inline visibility toggle + edit pencil always-available on hover (Mac visibility toggle only lives in the detail sheet). Neither exposes a hover metadata tooltip on the other side; Mac has no inline edit-on-card (edit is click-into-sheet or in Windows' case inline textarea). |
| `MemoryDetailSheet` (tags/source/context/confidence/reasoning/conversation-link, undo-delete toast) | *(none — no detail sheet component found)* | **Missing** | Windows has no equivalent detail/metadata sheet, no "View Source Conversation" link-out, no undo-delete toast (Windows just calls delete directly per row in manage mode with a paced-delete + Stop control instead — a different but comparable safety mechanism for bulk ops only). |
| `MemoryGraphInlineCard`/`MemoryGraphPage` (SceneKit, 30fps cap, purple "Thing" node type, no click-select) | `LazyBrainGraph`/`BrainGraph.tsx` (react-three-fiber + d3-force-3d, pauseWhenHidden GPU-saving, onboarding-driven reshuffle) | **Minor drift (by design)** | Functionally superior/more sophisticated on Windows (documented WebGL-recovery, off-screen unmount, cache-keyed settled layouts, reduced-motion path) — but node coloring deliberately deviates (`thing` = pink `#ff375f`, not purple) per `nodeColor.ts`'s explicit INV-UI-1 comment, and the animation model is fundamentally different (continuous per-frame lerp glide vs. Mac's fixed-duration `SCNTransaction` tweens for entrance/camera). Windows also lacks Mac's on-disk layout cache (`~/Library/.../memory-graph-layout.json` equivalent) — confirm whether `layoutCache` (module-scope Map) survives an app restart the way Mac's disk cache does, or only a component remount within one session. |
| Brain graph camera: fixed 60° FOV, `× 1.3` padding, auto-fit on load/incremental-add only | Camera: 28° FOV, constant analytic `fullGraphRadius()`, per-node clamping so nodes/labels never leave frame | **Major drift (deliberate engineering upgrade)** | Windows' approach (worst-case analytic framing, per-node radius clamp) is more robust against long labels/variable graph sizes than Mac's simulation-bounds-based auto-fit — worth preserving, not reconciling toward Mac. |
| `ConversationsPage` (folder tabs, date-range filter, starred filter, multi-select merge) | `pages/Conversations.tsx` (all/chat/recording filter, select+delete+share, local/cloud sync-status badges) | **Major drift** | Windows has no folders (no Folder CRUD/tabs), no date-range filter, no starred filter/toggle, no merge feature. Windows instead has concepts Mac's Conversations page doesn't need: local-vs-cloud sync state badges (pending/failed/not-synced), a backfill banner for pre-sync legacy local recordings, and a Chat-vs-Recording type filter (Mac's Conversations list is recordings-only; Windows unifies chat history and recordings in one list). |
| `ConversationRowView` (emoji tile, star, hover inline actions, purple selected-tint, no source icon) | Conversations.tsx row (emoji + title, sync badge, preview text, no star) | **Major drift** | Windows shows a content preview snippet inline (Mac doesn't — Mac's row has no body-text preview, only title+metadata). Windows has no starring, no per-row context menu (copy transcript/link, move-to-folder), no hover-reveal action icons — selection is a full alternate row mode instead of inline controls. |
| `ConversationDetailView` (single scrollable "Conversation Details" card + separate 450pt slide-in transcript drawer, App Insights/Try-with-Apps sections, read-only action items) | `pages/ConversationDetail.tsx` (Summary/Action-items/Transcript stacked as separate cards, no drawer) | **Minor/Major mixed drift** | Structurally similar (summary → action items → transcript, source/status chips) but Windows inlines the transcript directly under the summary (no drawer/toggle) and Windows' action items ARE interactively toggleable (checkbox click → `PATCH .../completed`) — the **opposite** of Mac's read-only action items. Windows has no App Insights / Try-with-Apps sections at all (no per-app reprocessing UI), no folder/move-to-folder, no merge, no copy-link/share link generation viewable here. Windows does have a reprocess (Sparkles) button, roughly analogous to Mac's per-app reprocess but simpler (single global reprocess call, not an app picker). |
| Speaker bubbles (fixed purple user bubble, 6-color speaker cycle incl. "dark purple", avatar circles, tap-to-name) | ConversationDetail.tsx transcript rows (speaker chip with hashed pastel-glass palette, no avatars, no tap-to-name) | **Major drift** | Windows uses flat labeled chips (`SPEAKER_00`→"S00" etc.) with a 6-color glass-tint hash palette (emerald/sky/teal/amber/rose/neutral — **no purple**, consistent with INV-UI-1) rather than Mac's chat-bubble-with-avatar layout. No speaker renaming/`NameSpeakerSheet` equivalent found. |
| `RewindPage` (date-scoped browse, app-filter, list/timeline search toggle, OCR bounding-box overlay, purple accents throughout, recovery banner) | `pages/Rewind.tsx` + `RewindPlayer`/`RewindTimelineBar`/`RewindThumbnailStrip`/`RewindSearchBar` | **Major drift** | Windows' timeline bar is a genuinely different (and in some ways more advanced) design: a continuous horizontal pannable timeline with collapsed "break" zigzag marks for long gaps and fixed px/hour activity scale, vs. Mac's day-scoped, sampled-to-500 bar. Windows has no date picker (implicitly shows all loaded frames across days via the break-collapsing timeline instead of Mac's single-selected-day model), no app-exclusion-aware activity coloring, no OCR bounding-box search-highlight overlay on the image itself, no list/timeline result-view toggle (Windows search always shows a filmstrip), no recovery-banner/corruption-UI (may not need one if Windows' storage layer differs), and accent color is **`var(--accent)`** (white) everywhere Mac uses purple — already correctly de-purpled. |
| Rewind empty/permission states (ScreenCaptureKit-broken / permission-missing / no-captures, each with a distinct icon+color+CTA) | `RewindPlayer.tsx` inline "No frames yet — enable Rewind capture in Settings." | **Missing** | Windows collapses all these to one generic message inside the player pane; no distinct permission-missing state, no reset/repair CTA, no "no results at this moment vs. never captured anything" distinction visible in the reviewed files. Needs its own permission-state design pass if Windows screen-capture permission failure modes are similarly multi-way (a generic "recording paused" state won't cover a stuck-capture-API case the way Mac's does). |
| Rewind Settings (Storage / Excluded Apps / Battery Optimization / Data Retention cards, purple icons, 3/7/14/30-day picker) | `components/settings/tabs/RewindTab.tsx` | **Not yet compared in this pass** | File exists on Windows (confirmed via file listing) but was not read in this research session — flag for a follow-up pass before treating Rewind settings parity as assessed. |

---

## 8. File index (for the porting engineer)

**Mac (read-only reference, do not modify)** — all under `desktop/macos/Desktop/Sources/`:
- `MainWindow/Pages/MemoriesPage.swift` — Memories list, cards, sheets, view model (3171 lines)
- `MainWindow/Pages/MemoryGraph/MemoryGraphPage.swift` — Brain graph, SceneKit scene, force simulation glue (1023 lines)
- `MainWindow/Pages/ConversationsPage.swift`, `Components/ConversationListView.swift`, `Components/ConversationRowView.swift`, `Components/RecentConversationsWidget.swift`, `Pages/ConversationDetailView.swift`, `MainWindow/ConversationDetailAutomationState.swift`, `MainWindow/Conversations/ConversationRepository.swift`, `ConversationFinalizationService.swift`, `ConversationReconciliationPolicy.swift`, `AppState/MeetingConversationBoundaryPolicy.swift`
- `Rewind/UI/{RewindPage,RewindSearchBar,RewindTimelinePlayerView,RewindTimelineView,RewindViewModel}.swift`, `Rewind/Core/{MemoryModels,MemoryStorage,RewindDatabase,RewindModels,RewindOCRService,RewindStorage}.swift`, `Rewind/Services/RewindIndexer.swift`, `MainWindow/RewindOnlyView.swift`, `MainWindow/Pages/Settings/Sections/SettingsContentView+Rewind.swift`
- Shared tokens: `Theme/OmiColors.swift`, `Theme/OmiChrome.swift`, `Theme/OmiFont.swift`

**Windows (current implementation)** — all under `desktop/windows/src/renderer/src/`:
- `pages/Memories.tsx`, `components/graph/{BrainGraph,LazyBrainGraph,nodeColor}.tsx/.ts`, `lib/useGraphSimulation.ts`, `hooks/useMemoryGraph.ts`, `hooks/useMemories.ts`
- `pages/Conversations.tsx`, `pages/ConversationDetail.tsx`, `lib/pageCache.ts`, `lib/sync/{conversationsReconcile,conversationSync}.ts`
- `pages/Rewind.tsx`, `components/rewind/{RewindPlayer,RewindTimelineBar,RewindThumbnailStrip,RewindSearchBar}.tsx`, `hooks/useRewind.ts`, `components/settings/tabs/RewindTab.tsx` (not yet reviewed)
- Shared tokens: `styles/globals.css` (`:root` design-token block)
