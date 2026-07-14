# 04 — Platform Conventions: Where NOT to Copy Mac

Scope of this section: the charter's default posture is "port Mac verbatim." This section
catalogs the specific places that default is wrong, why, and the Windows-native replacement —
grounded in Fluent 2 guidance, Electron platform behavior, and how other Mac-first apps (Arc,
Raycast, Figma, Slack, Notion Calendar) actually shipped their Windows builds. Each topic:
**Mac idiom → why it fails on Windows → recommended equivalent → exact implementation → sources.**

Where the Omi Windows codebase (`desktop/windows/`) already made the right call, that's called
out explicitly — this doc should reinforce those, not silently re-litigate them.

---

## 1. The canonical "don't copy" list

### 1.1 In-window / top-of-screen menu bar (File, Edit, View...)

**Mac idiom:** SwiftUI apps get a system menu bar for free, docked to the top of the *screen*
(shared across all app windows), populated via `.commands {}`. Menu items double as the
canonical place to declare every keyboard shortcut.

**Why it fails on Windows:** There is no screen-level menu bar on Windows — every app's menu, if
it has one, lives inside its own window, directly under (or merged into) the title bar. A Mac
port that tries to recreate a persistent File/Edit/View bar reads as legacy Win32 (think old
Office 2003), not modern. Fluent 2 and WinUI 3 guidance has moved away from persistent menu bars
entirely in favor of command bars, overflow menus, and in-content affordances.

**Recommended equivalent — drop it, don't relocate it.** The dominant pattern among modern
Mac-first Windows ports (Figma, Arc, Raycast, VS Code's default when not using its legacy menu)
is: no persistent File/Edit/View menu bar at all. Whatever the Mac menu bar exposes gets
distributed to:
- A command palette / search-driven surface (if the app already has one).
- A small overflow ("...") button in the custom title bar for the few items that don't fit
  anywhere else (About, Check for Updates, Settings, Quit).
- Right-click context menus for object-scoped actions.
- The system tray menu for app-lifecycle actions (Open, Pause, Settings, Quit).

Figma's Windows Electron build has no native OS menu; the equivalent of the Mac menu bar is the
"F" logo button at the top-left of the canvas (a custom in-app menu), plus a secondary "..."
overflow menu at the top-right near the caption buttons. This is the shape to imitate, not a
relocated menu bar.

**Exact implementation for Omi Windows:** `desktop/windows/src/main/index.ts` never calls
`Menu.setApplicationMenu(...)` — confirmed via `grep`, and that's correct, keep it that way. Do
not add one during the port. Any Mac `.commands{}` menu item that has no other home becomes: (a)
a tray menu item if it's app-lifecycle scoped (already true for Open/Pause/Settings/Quit in
`src/main/tray.ts`), or (b) a row in the in-app Settings screen, or (c) a keyboard shortcut with
no visible menu entry at all (see §1.5) if it's power-user-only.

**Sources:**
- [Windows app title bar — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design)
- [Windows Controls and patterns — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/)
- [Why does Figma still, in 2025, doesn't use Windows 10/11's native title bars? — Figma Forum](https://forum.figma.com/report-a-problem-6/why-does-figma-still-in-2025-doesnt-use-windows-10-11-s-native-title-bars-39020)
- [Where is the Main top menu in Figma for Windows? — Figma Forum](https://forum.figma.com/t/where-is-the-main-top-menu-in-figma-for-windows/5373)

### 1.2 Traffic-light spacing assumptions in headers

**Mac idiom:** macOS window controls (close/minimize/zoom) live top-left, ~13px circles with
~8px gaps, occupying a well-known ~70px reserved zone. SwiftUI headers routinely design their
left edge with that reservation baked in — brand mark, back button, or tab strip start *after*
the traffic lights, never colliding with them.

**Why it fails on Windows:** Windows caption buttons (minimize/maximize/close) are top-**right**,
not top-left, and there is no equivalent reserved zone on the left. A verbatim port that keeps
left-side padding "for the traffic lights" wastes ~70px of header real estate for nothing, while
simultaneously failing to reserve the ~138px (three ~46×32px buttons) actually needed on the
*right* for Windows caption buttons — causing brand/tab content to collide with or run under
minimize/maximize/close.

**Recommended equivalent:** Mirror the reservation, don't copy the number. Left edge is free for
brand mark / nav / back button starting at the window edge (no artificial left inset). Right edge
must reserve real space for the caption button cluster — Fluent guidance: standard title bar
height 32px (or 48px "tall" for touch-friendly), caption buttons are ~46px wide each at 100%
scale, full-height, full-bleed hit targets with hover/press states matching system theme.

**Exact implementation:** Omi Windows already gets this right structurally —
`desktop/windows/src/renderer/src/components/layout/TitleBar.tsx` uses `titleBarStyle: 'hidden'`
with the **Window Controls Overlay** API, which keeps the OS-native caption buttons (top-right,
correct size, correct hover states, Snap Layouts hover intact) and only claims a drag strip
underneath/around them — it does not hand-draw custom caption buttons. When porting any Mac
header component that assumed a left-side traffic-light gutter: delete that gutter, and if the
header needs a right-side overflow/menu button of its own, place it to the *left* of the WCO
caption-button reserved region (Electron's `titleBarOverlay` config reports the reserved rect via
`overlay-rect-changed`; do not hardcode the offset — read it).

**Sources:**
- [Title bar — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/title-bar)
- [Custom Title Bar — Electron](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [Title bar customization — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/develop/title-bar?tabs=wasdk)

### 1.3 Preferences-window conventions

**Mac idiom:** A dedicated floating `Settings` window (⌘,), often with a toolbar of icon tabs
across the top (General / Audio / Account / ...), non-resizable, appears as its own space-level
window separate from the main window.

**Why it fails on Windows:** Windows has no equivalent "floating utility window" convention tied
to a system-wide shortcut — Ctrl+, is not a recognized Windows accelerator (confirmed: no
Microsoft UX guideline documents it; it is an app-by-app convention some apps like VS Code and
itch.io have adopted, not a platform standard). Windows apps more commonly present settings as an
in-window navigation destination (a "Settings" item in a side nav or overflow menu) rather than a
floating auxiliary window, especially for apps that already have a persistent main window (Fluent
guidance: `NavigationView` + a Settings entry pinned at the bottom of the nav pane is the
canonical WinUI 3 pattern, mirrored by most Store apps).

**Recommended equivalent:** Keep Settings as an in-window destination, not a separate floating
window — which is also simpler to port since Electron multi-window state sync is real overhead.
If Omi Windows currently opens Settings as a modal/child `BrowserWindow`, prefer navigating the
main window to a Settings route instead (check current behavior in
`desktop/windows/src/main/index.ts` `openSettings`/tray wiring before changing — this charter
section only sets policy, it doesn't mandate a rewrite of working navigation).

**Recommended equivalent for the shortcut:** Bind `Ctrl+,` anyway (low cost, doesn't conflict with
anything on Windows, and it is a live cross-app convention among Electron ports — VS Code, Slack,
Discord, itch.io all use it) but do not treat it as something users will discover; always also
expose Settings as a normal clickable menu/nav item, since Windows has no system convention
teaching users to try it.

**Sources:**
- [Guidelines for app settings — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings)
- [Preferences · The itch.io app book](https://itch.io/docs/itch/using/preferences.html)
- [Keyboard shortcuts for Visual Studio Code](https://code.visualstudio.com/docs/configure/keybindings)

### 1.4 About windows

**Mac idiom:** `App Name → About App Name` in the system menu bar opens a small fixed-size
window: icon, name, version, credits — a macOS HIG fixture users know to look for under the app
name menu.

**Why it fails on Windows:** There is no app-name menu to hang it from (see §1.1). Windows users
look for "About" in one of: a Settings page, a Help menu, or an overflow ("...") menu — never a
dedicated top-level window they open reflexively.

**Recommended equivalent:** Fold About into Settings as the last/bottom section (icon, version
string, build number, links) rather than a separate window — this is the dominant pattern in
Electron Windows ports (Slack, Discord, VS Code's Help > About all render inline or as a simple
dialog, not a chrome-less floating panel). If a separate window is kept for parity with Mac,
gate it behind the same overflow menu used for the dropped menu-bar items (§1.1), not a
system-taught location, since none exists on Windows.

**Sources:**
- [Windows app title bar — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design)

### 1.5 Keyboard shortcuts: Cmd→Ctrl mapping edge cases

**Mac idiom:** Cmd is the universal modifier; Cmd+, for Preferences, Cmd+K for a command
palette/quick action, Cmd+Q to quit, media keys handled by the OS and observable via
`MPRemoteCommandCenter`.

**Why it fails verbatim:**
- Cmd → Ctrl is the correct 1:1 mapping for *most* shortcuts, but not all: Ctrl+W closes the
  active browser tab in every browser and most Electron shells; if Omi Windows binds Ctrl+W to
  something Mac-parity would suggest (close window), verify it doesn't fight embedded webview/tab
  expectations if Omi ever embeds one.
- **Cmd+, → Ctrl+,** is not a discoverable Windows convention (see §1.3) — bind it, but back it
  with a visible menu entry.
- **Cmd+K** as a command-palette trigger ports fine 1:1 (Ctrl+K is free on Windows and is itself
  becoming a de facto convention via VS Code/Slack/Linear/Notion), but Ctrl+K is *also* the
  "insert hyperlink" shortcut in virtually every Windows text editor and Office app — if Omi's
  chat/notes surface has any rich-text editing, that's a real collision to test for, not just
  assume away.
- **Cmd+Q (Quit) → Ctrl+Q is not a Windows convention** — Windows has no universal quit
  accelerator; Alt+F4 is the system-level "close window" shortcut and closing the last window is
  the idiomatic "quit" signal for tray-resident apps (with the tray remaining, as Omi's already
  does per `desktop/windows/src/main/tray.ts`'s dedicated "Quit Omi" tray item). Do not bind
  Ctrl+Q to quit-the-app; it has no meaning to a Windows user and risks accidental data loss if a
  Mac-trained finger hits it expecting a "quit" but a Windows-trained finger has never used it for
  anything, so misfires are asymmetric-low-risk either way — the real fix is relying on the tray
  Quit item + window-close-to-tray, not a global accelerator.
- **Media keys (Play/Pause/Next/Prev):** Electron's `globalShortcut` cannot reliably claim
  `MediaPlayPause`/`MediaNextTrack`/etc. on Windows — Windows 10/11 frequently reserve these at
  the OS level for the System Media Transport Controls (SMTC), and registration silently fails or
  is preempted. If Omi's Mac build uses media-key remote-control integration (`MPNowPlayingInfo`
  / `MPRemoteCommandCenter`), the Windows equivalent is **SMTC** (`Windows.Media.SystemMediaTransportControls`
  via a native module, or a userland wrapper), not `globalShortcut` — treat this as a
  platform-specific integration, not a 1:1 API port.

**Recommended equivalent:** Build a single Cmd→Ctrl mapping table reviewed shortcut-by-shortcut
against this list rather than a blanket find/replace of "Cmd" with "Ctrl" in accelerator strings.
Flag Ctrl+K, Ctrl+W, and any Quit binding for explicit human review during port; do not silently
carry over Cmd+Q semantics.

**Sources:**
- [Media keys can't be bound with global-shortcut — electron/electron#5268](https://github.com/electron/electron/issues/5268)
- [GlobalShortcut works with Ctrl+MediaKey but not just MediaKey — electron/electron#3600](https://github.com/electron/electron/issues/3600)
- [Global shortcut, media tracking not working in windows — electron/electron#4702](https://github.com/electron/electron/issues/4702)
- [Keyboard shortcuts for Visual Studio Code](https://code.visualstudio.com/docs/configure/keybindings)
- [Guidelines for Keyboard User Interface Design — Microsoft Learn](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/dnacc/guidelines-for-keyboard-user-interface-design)

### 1.6 Menu-bar-extra vs. system tray interaction patterns

**Mac idiom:** `MenuBarExtra` — click (left or right, both trigger the same thing on macOS since
there's no right-click distinction in the menu bar) opens a dropdown/menu anchored under the
menu-bar icon.

**Why it fails verbatim:** Windows tray icons have a real left-click vs. right-click distinction
that users expect to behave differently — right-click for a context menu is a universal Windows
convention (every system tray icon: network, volume, battery, OneDrive), while left-click
convention varies by app but most commonly **toggles/opens the app's primary window**, not a
menu. An app that pops a dropdown menu on *left*-click (verbatim macOS behavior) reads as
un-Windows-native and surprises users who expect left-click to just open the app.

**Recommended equivalent — and Omi Windows already implements it correctly:**
`desktop/windows/src/main/tray.ts` wires `tray.on('click', ...)` to toggle the main window
visibility (left-click), and `tray.setContextMenu(...)` supplies the right-click menu (Open Omi /
Pause-Resume / Settings / Quit). This is exactly the Windows-idiomatic split — keep it as the
reference pattern for any other tray-adjacent surface. Note Electron caveat confirmed via
research: `setContextMenu()` on Windows can make the menu appear on left-click too unless a
`click` handler is explicitly attached to override it (which Omi's code does) — don't remove that
handler when touching this file, or the left-click toggle silently reverts to opening the context
menu instead.

**Sources:**
- [Tray | Electron](https://www.electronjs.org/docs/latest/api/tray/)
- [Tray context menu should open with a single left click on Windows — electron/electron#1393](https://github.com/electron/electron/issues/1393)
- [How to deal with Electronjs's Tray on Windows? — Medium](https://medium.com/@onuraltuntasbusiness_99398/how-to-deal-with-electronjss-tray-on-windows-f9e5ac8b4c63)
- Codebase: `desktop/windows/src/main/tray.ts` (existing correct implementation, left-click toggle line ~51-55, right-click context menu via `setContextMenu` line ~66-75)

---

## 2. Notifications: native Windows toast vs. custom in-app toast

**Mac idiom:** `UNUserNotificationCenter` posts to Notification Center; macOS renders a
standardized banner (top-right by default) with the app icon, and it's queued/grouped by the OS
even when the app isn't focused or running.

**Windows equivalent surface:** Windows Toast Notifications, which appear in the bottom-right and
are collected in **Action Center** (Win+N) — the OS-owned, theme-matched, accessible surface.
Electron's cross-platform `Notification` API maps to this on Windows automatically for plain
title/body notifications, but has real gaps:

- **Action buttons are not supported through the plain `Notification` API on Windows** — the
  `actions` property historically works on macOS but not Windows through Electron's simple API.
  To get actionable Windows toasts (buttons, inputs) requires building raw **Toast XML**
  (`toastXml` property) or a native helper (`electron-windows-notifications` /
  `@nodert-win10-au/*` wrapping `Windows.UI.Notifications.ToastNotification`).
- **AUMID (Application User Model ID) is required** for Action Center to correctly group,
  persist, and route activation for a Windows toast — `app.setAppUserModelId(...)` must be called
  and must match the value electron-builder's `appId` produces for the installed app, or toasts
  either don't show correctly, don't group under the app's icon, or activation (click →
  bring-to-front) silently fails, especially for unpackaged/dev builds.
- **Protocol activation is the only supported Windows activation type** for toast-XML
  notifications in Electron — clicking a toast (or its action button) launches via a registered
  protocol handler, not a direct in-process callback, which has real implications for how Omi
  would route "clicked a meeting-ended notification" back into an already-running app instance
  (single-instance lock + protocol handler, not a bare event listener).

**When to use native Windows toast vs. custom in-app toast — recommendation:**
- **Use native Windows toast** for anything that must reach the user when Omi is *not* focused
  and ideally even when minimized/backgrounded: meeting-ended summaries, action-required prompts,
  anything the user should be able to act on later from Action Center. This is the category
  Fluent's own toast guidance targets — must be timely, must be dismissible, must not require the
  app to be visible.
- **Keep the existing custom in-app acrylic toast** (`desktop/windows/src/main/insight/toastWindow.ts`)
  for anything that's only meaningful *while Omi is the active/foreground experience* — live
  insight cards, "what's new" — where a frameless, app-styled, hover-pausable window with full
  control over layout/branding is strictly better than the constrained Toast XML template, and
  where OS-level Action Center persistence isn't wanted (these are ephemeral by design, already
  auto-dismiss on a timer).
- **This is a real gap today, not a stylistic nit:** Omi Windows's current toast/notification
  surface (`toastWindow.ts`) is entirely custom-window based — there is no evidence in
  `src/main/` of a native `Notification`/AUMID/Toast-XML path. That's the right call for the
  insight/meeting-toast use case above, but if a future feature needs to notify the user while
  Omi is fully backgrounded (not just window-hidden-but-process-alive) or wants Action-Center
  persistence/history, it needs the native path — don't try to stretch the acrylic toast window
  to cover that case, since a hidden/backgrounded Electron `BrowserWindow` toast has none of
  Action Center's guarantees (it won't survive the app being fully quit, won't appear in Win+N
  history, and won't respect system Do Not Disturb/Focus Assist rules the way a real toast does).

**Exact implementation, if/when native toasts are added:**
1. Call `app.setAppUserModelId(<electron-builder appId>)` early in main-process startup, before
   any notification is posted (and before the app is ready is fine, but must be before use).
2. For plain informational toasts with no buttons, Electron's built-in `Notification` API is
   sufficient on Windows.
3. For actionable toasts (buttons like "Snooze" / "View"), build Toast XML via `toastXml` and
   register a custom protocol (`app.setAsDefaultProtocolClient`) to receive activation, wiring it
   through the existing single-instance-lock `second-instance` handler so activation focuses the
   already-running window rather than spawning a second process.
4. Verify grouping/branding under the installed AUMID with a packaged build — dev/unpackaged
   Electron runs often show toasts attributed to "Electron" rather than "Omi" unless AUMID is set
   correctly, which is a common false-negative during local testing.

**Sources:**
- [Native Windows Notifications with Action Buttons for your Electron App — sipgate](https://www.sipgate.de/blog/how-to-create-native-notifications-with-action-buttons-on-windows-for-your-electron-app)
- [Showing Native Windows Notifications from Electron Using NodeRT — Microsoft ISE Dev Blog](https://devblogs.microsoft.com/ise/showing-native-windows-notifications-from-electron-using-nodert/)
- [Notification | Electron](https://www.electronjs.org/docs/latest/api/notification/)
- [Notifications | Electron](https://www.electronjs.org/docs/latest/tutorial/notifications)
- [toast ux guidance — Microsoft Learn](https://learn.microsoft.com/cs-cz/windows/apps/design/shell/tiles-and-notifications/toast-ux-guidance)
- Codebase: `desktop/windows/src/main/insight/toastWindow.ts` (existing custom acrylic toast, no native path today)

---

## 3. Dialogs / sheets

**Mac idiom:** Sheets slide down attached to the *titlebar* of the parent window, staying
tethered to it, dimming the parent's content but not the whole screen, and communicate "this
belongs to this specific window/document" spatially.

**Why it fails on Windows:** Windows has no titlebar-attached sheet primitive or convention — the
closest system control (Win32/WinUI `ContentDialog`) is a **centered modal with a scrim**, not an
edge-attached sheet, and that's also what Windows users expect from any modern app (Settings app,
Store, virtually every WinUI/Fluent surface). A sheet that visually "hangs" from the top of a
Windows window with a custom-drawn title bar looks like a bug (something rendering off from its
anchor), not an intentional design borrowed from another platform users don't necessarily know.

**Recommended equivalent:** Centered modal dialog with a scrim (semi-opaque dark overlay behind
it) covering the parent window's content area — Fluent 2's `ContentDialog`/`Dialog` pattern:
rounded corners (matching the app's corner radius), a title, body content, and a right-aligned
primary/secondary button pair (primary button visually emphasized, typically accent-colored,
rightmost). This is directly implementable in the existing React/Tailwind stack without a native
dependency — it's a layout pattern (centered flex + backdrop), not an OS API.

**Exact implementation:**
- Center within the *window's client area* (not the physical screen) so it still reads correctly
  in windowed/multi-monitor setups — same containment logic Mac sheets have relative to their
  parent window, just centered instead of top-anchored.
- Scrim: ~40–60% black overlay (validate against both light/dark themes — Fluent recommends the
  scrim respect theme, not a flat hardcoded black), click-outside-to-dismiss only for
  non-destructive dialogs (confirmation/destructive dialogs should require explicit
  button choice, matching both Mac and Windows HIG on this point — no platform divergence here).
- Entrance motion: a subtle scale+fade (e.g. 0.96→1.0 scale, 120–160ms) reads as native-Windows;
  avoid porting a Mac sheet's slide-down-from-top animation verbatim, since without a titlebar
  anchor to slide *from* it will look like it's sliding in from nowhere.
- Corner radius and elevation/shadow should match whatever Fluent-inspired token set the rest of
  the port adopts (see charter design-tokens section, if present) rather than copying macOS's
  sheet corner radius number directly.

**Sources:**
- [React Dialog — Fluent 2 Design System](https://fluent2.microsoft.design/components/web/react/dialog/usage)
- [ContentDialog class — fluent_ui — Dart API](https://pub.dev/documentation/fluent_ui/latest/fluent_ui/ContentDialog-class.html)
- [dialog — Microsoft Learn (Fluent UI Web Components)](https://learn.microsoft.com/en-us/fluent-ui/web-components/components/dialog)

---

## 4. Context menus: styled DOM vs. native Menu

**Mac idiom / cross-platform question, not really a Mac-vs-Windows one:** the choice is really
"custom DOM-rendered context menu" (full visual control, matches app branding exactly) vs.
Electron's native `Menu`/`MenuItem` (OS-drawn, automatically theme/DPI-correct, automatically
accessible).

**Why DOM-only context menus fail on Windows specifically:** research confirms real,
Windows-specific accessibility regressions with custom/DOM context menus versus native ones:
top-level menu items are not announced by screen readers, arrow-key navigation between entries
doesn't work the way native menus do, and keybinding hints get read awkwardly alongside labels
instead of the clean native pattern. Native `Menu`/`MenuItem` also gets Windows-correct
accelerator-key underlines, high-contrast theme support, and DPI-correct rendering for free —
none of which a hand-styled DOM menu gets without significant duplicated effort.

**Recommended equivalent:** Use Electron's native `Menu.buildFromTemplate` /
`webContents.on('context-menu', ...)` → `menu.popup()` pattern for **right-click context menus on
real objects** (text selection, list items, tray — tray already does this correctly, see §1.6).
Reserve custom DOM-rendered menus/popovers for **branded, non-context-menu UI** where visual
fidelity to Omi's design system matters more than native-menu conventions apply anyway (a
dropdown attached to a button that opens a rich picker, not a right-click action list) — those
aren't really "context menus" in the OS sense and users don't bring native-menu expectations to
them.
- For text editing surfaces specifically, prefer specifying Electron's standard `role` values
  (`cut`, `copy`, `paste`, `selectAll`, etc.) over hand-implementing those behaviors — the role
  behavior is the OS-correct implementation already.

**Sources:**
- [Context Menu | Electron](https://www.electronjs.org/docs/latest/tutorial/context-menu)
- [Menu | Electron](https://www.electronjs.org/docs/latest/api/menu)
- [A Universal Method for Displaying Native and Custom Menus — innei.in](https://innei.in/en/posts/tech/a-universal-method-about-show-electron-native-and-web-custom-menus)
- [Windows: Menu bar does not behave like a native menu bar — electron/electron#4330](https://github.com/electron/electron/issues/4330)

---

## 5. DPI: 100/125/150/175% scaling vs. Mac's fixed 2×

**Mac idiom:** macOS Retina displays scale at a clean, fixed 2× (occasionally 1× on older
external panels) — designers can author almost everything as integer point values and trust the
system to render crisply, since fractional in-between scale factors essentially don't exist in
practice.

**Why it fails on Windows:** Windows scaling is **fractional and user-configurable in fine
increments** — 100/125/150/175/200%+ are the common presets, and 125%/150% in particular do not
map to clean integer pixel ratios the way Mac's 2× does. At 125% scaling, e.g., a
1920×1080 physical panel effectively renders logical content at 1536×864 and *upscales*, which is
not an integer ratio — this is the direct mechanical cause of blur that has no Mac equivalent.
Electron/Chromium apps that are not fully Per-Monitor-DPI-v2-aware get bitmap-stretched by the
OS entirely, producing much worse blur (this is a distinct, worse failure mode than the
sub-pixel-rounding blur that even DPI-aware apps see at fractional factors) — confirmed via
research: DPI-unaware apps render at a fixed 96 DPI baseline and get stretched by Windows to fit
the physical display, and Electron's own tracker confirms concrete taskbar-icon pixelation
specifically at 125% scaling that does not reproduce at 100% or 150%.

**Pitfalls specific to a Mac-first design system landing on Windows:**
- Any icon or asset authored as a fixed-size raster (PNG at a single resolution, sized for Mac's
  2×) will look soft or aliased at 125%/150%/175% — these are exactly the scale factors where a
  single-density raster has no clean mapping.
  - Look for currently-exported PNG-per-state assets in the port
    (`desktop/windows/scripts/gen-tray-icons.mjs` + `resources/tray/*.ico` generate
    **per-size tray icons** — this is the right existing pattern to extend, not undo).
- 1px hairlines (a very common Mac-design habit — 1px borders/dividers assumed to render as a
  crisp single device pixel at 2×) can visually vanish or double up at fractional Windows scale
  factors, since 1 CSS/logical px no longer maps to a whole number of device pixels.
- Text/spacing values authored in raw `px` assuming a fixed pixel-to-point Mac relationship should
  instead be authored in relative units (`rem`, or a scale-aware token) so the OS/renderer's own
  scaling pipeline handles the multiplication once, correctly, rather than the app trying to
  pre-compute pixel-perfect output for every possible scale factor.

**Recommended authoring rules for the port:**
1. **Prefer SVG or vector icon sources over fixed-raster PNG** wherever the rendering pipeline
   allows it — SVG re-rasterizes cleanly at any scale factor, sidestepping the 125%/150% problem
   entirely, and is strictly better than adding more discrete raster sizes. Where the existing
   `.ico`-based tray icon pipeline is kept (Windows tray requires `.ico`, not SVG, for OS reasons),
   keep exporting the discrete size set the current script already produces — don't regress to a
   single fixed size.
2. **Use `rem`/relative CSS units for layout and type, not hardcoded `px`,** anywhere Mac's design
   assumed a fixed 2× relationship — this is standard web-authoring hygiene but matters more here
   because Windows' DPI variance is the mechanism that would otherwise expose every hardcoded-px
   assumption.
3. **Avoid 1px hairlines as a hard rule; use ≥1.5px or a token that already accounts for the
   current scale factor**, or better, replace decorative 1px dividers with a subtle background
   color step instead of a stroke, which has no minimum-device-pixel floor to collapse under.
4. **Ensure the Electron app manifest declares Per-Monitor DPI v2 awareness** (Electron does this
   by default on modern versions, but verify `electron-builder` config / app manifest hasn't
   overridden it) — this is the difference between "some blur at fractional factors" (acceptable,
   universal) and "the whole window gets OS-bitmap-stretched" (unacceptable, avoidable).
5. **Test at 125% and 150% explicitly, not just 100%.** These are the scale factors where
   integer-ratio assumptions break, and they're extremely common on real Windows laptops
   (Windows itself recommends 125%/150% presets by default on many high-DPI panels) — 100%-only
   QA will systematically miss this whole class of bug.

**Sources:**
- [Windows DPI Scaling Guide — Windows Forum](https://windowsforum.com/threads/windows-dpi-scaling-guide-quick-ways-to-size-apps-and-text-windows-10-11.384340/)
- [High DPI Desktop Application Development on Windows — Win32 apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows)
- [Taskbar icon looks pixelated in 125% scaling environment on Windows — electron/electron#6396](https://github.com/electron/electron/issues/6396)
- Codebase: `desktop/windows/scripts/gen-tray-icons.mjs`, `desktop/windows/resources/tray/` (existing per-size icon export — the pattern to extend)

---

## 6. Case studies: how Mac-first apps adapted to Windows

| App | Chrome / title bar | Menu | Materials | Tray | Notes |
|---|---|---|---|---|---|
| **Figma** | Custom title bar, not native Windows chrome — loses Snap Layouts as a documented tradeoff. | No OS menu bar; "F" logo button top-left is the in-app main-menu equivalent, plus a secondary overflow menu top-right near caption buttons. | N/A (browser-rendered canvas app). | N/A (browser-tab-like app, not tray-resident). | Electron shell wrapping the web app essentially unmodified — an explicit case of *not* chasing native chrome for engineering-cost reasons; Windows users have filed complaints about the Snap Layouts loss as a direct consequence. |
| **Arc (The Browser Company)** | Custom title bar; explicitly redesigned "to reflect how Windows apps look and work... especially in the title bar, which has to reflect the lack of the system-wide menu found on Mac." | Dropped, redesigned per-platform — not a relocated Mac menu bar. | N/A (browser). | Standard Windows tray presence. | Notable technical choice: built the Windows app in **Swift on Windows** (not a rewrite in a Windows-native language) specifically to keep sharing the Mac codebase and reach feature parity faster — relevant precedent for "share logic, redesign chrome," though Omi's stack is Electron, not Swift. |
| **Raycast** | Native Windows chrome; explicitly marketed as "not a port... designed to feel right at home on the platform, with proper Windows keyboard conventions, installer behavior, and visual styling." | Native per-platform. | Native host app per platform: Swift+AppKit on macOS, **C#+.NET 8+WPF on Windows** — separate native front-ends over a shared TS/Rust/Node core, not one UI layer stretched across both. | Standard Windows tray. | The strongest "don't verbatim-port" precedent found: Raycast built a Windows-native file indexer from scratch rather than reuse Spotlight-equivalent logic, because "Windows doesn't have a system-wide index that meets our standards" — i.e., some subsystems aren't portable at all, only the *concept* ports, the implementation doesn't. |
| **Slack** | Custom title bar; a hamburger/workspace-switcher affordance appears specifically when multiple workspaces are signed in (a Windows/Linux-only chrome addition Mac doesn't need because of the system menu bar's app-switcher role). | No native OS menu bar on Windows. | Standard Fluent-adjacent flat chrome, no Mica/vibrancy noted. | Standard Windows tray with unread-badge overlay. | Multi-workspace UI is the one place Slack's Windows chrome does *more* than Mac's, not less — evidence that "drop the Mac menu bar" sometimes means "replace it with something Windows needs that Mac didn't." |
| **Notion Calendar** | Standard Windows taskbar-pinned app, not menu-bar-extra style. | N/A. | N/A. | **Explicitly different interaction model, not a relocated menu-bar-extra:** Mac's menu-bar-extra (top-right, next to system clock, `cmd`-drag repositionable) becomes a standard Windows taskbar icon on the right side of the taskbar, dragged into place via the taskbar's own "^" overflow-tray UI — same *goal* (glanceable next-meeting access near the system clock), completely different *mechanism*, because Windows has no menu-bar-extra equivalent at all. | Direct precedent for Omi's tray — the right move isn't to approximate a menu-bar-extra with a tray icon, it's to accept the tray's native interaction model (§1.6) and place the glanceable surface there on its own terms. |
| **Spotify** | Custom title bar (community Windhawk mods exist specifically to *force* native frames back on, indicating real user preference against the custom chrome). | No native OS menu bar. | Flat, no Mica/acrylic noted. | Standard Windows tray, minimize-to-tray supported. | Weak signal only — could not find a primary-source engineering post on the Windows-specific chrome decisions; the Windhawk-mod evidence is a useful cautionary data point (users do notice and dislike non-native title bar chrome enough to patch around it) but not a design case study to imitate point-for-point. |
| **Raycast for Windows** *(supplemental — 2026 release)* | See above row; repeated here because it's the most recent and most explicit "we chose not to port" precedent (public beta, May 2026). | — | — | — | — |

**What to take from this table for Omi specifically:** the pattern across every credible primary
source (Arc, Raycast, Notion Calendar) is *share the underlying logic/data layer, redesign the
chrome layer per-platform from the platform's real conventions* — never "reuse the Mac chrome
component and reskin its colors." Omi Windows's existing choices (native WCO caption buttons, no
app menu bar, tray left/right-click split, per-size icon export) already follow this pattern; the
job for the rest of the port is extending that same posture to Settings/About, dialogs, and
notifications rather than reversing it.

**Sources:**
- [Why does Figma still, in 2025, doesn't use Windows 10/11's native title bars? — Figma Forum](https://forum.figma.com/report-a-problem-6/why-does-figma-still-in-2025-doesnt-use-windows-10-11-s-native-title-bars-39020)
- [Where is the Main top menu in Figma for Windows? — Figma Forum](https://forum.figma.com/t/where-is-the-main-top-menu-in-figma-for-windows/5373)
- [The Browser Company Answers Your Questions About Arc for Windows — Thurrott.com](https://www.thurrott.com/cloud/web-browsers/301845/the-browser-company-answers-your-questions-about-arc-for-windows)
- [The Browser Company releases Arc for Windows — TechCrunch](https://techcrunch.com/2024/04/30/the-browser-company-releases-arc-for-windows/)
- [A Technical Deep Dive Into the New Raycast — Raycast Blog](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)
- [Raycast for Windows — Raycast Blog](https://www.raycast.com/blog/raycast-for-windows)
- [Raycast — Windows Changelog](https://www.raycast.com/changelog/windows)
- [Make Slack's design update work for you — Computerworld](https://www.computerworld.com/article/2503287/how-to-use-slacks-new-interface.html)
- [Notion Calendar settings — Notion Help Center](https://www.notion.com/help/notion-calendar-settings)
- [Menu bar settings — Cron Calendar (Notion)](https://cronhq.notion.site/Menu-bar-settings-cb58322a14de49278bc2ecf24309b0ff)
- [CEF/Spotify Tweaks — Windhawk](https://windhawk.net/mods/cef-titlebar-enabler-universal)

---

## 7. Windows 10 vs. Windows 11 divergences + recommended support posture

**Mica material availability:** Mica is Windows-11-only; on Windows 10 it degrades gracefully to
a **solid fallback color**, not a broken/transparent surface — this is Microsoft's documented
fallback, not something the app needs to special-case beyond providing a sane solid color. Mica
also falls back to solid on Windows 11 itself under: transparency disabled in system settings,
Battery Saver active, or low-end/constrained hardware — so even a Windows-11-only mental model
needs a solid-color fallback path regardless.

- Omi Windows already encodes this correctly and precisely:
  `desktop/windows/src/main/windowsVersion.ts` gates Mica behind `MICA_MIN_BUILD = 22621`
  (Windows 11 22H2 — the first build where the DWM attribute Electron's
  `backgroundMaterial: 'mica'` relies on, `DWMWA_SYSTEMBACKDROP_TYPE`, actually exists) rather than
  a coarser "is this Windows 11" check. Keep this build-number-precise gate as the pattern for any
  other Windows-11-only visual feature the port adds — don't downgrade to an OS-major-version
  check.

**Square vs. rounded corners:** Windows 11 introduced system-wide rounded window corners; Windows
10 windows are square. A custom-chrome Electron window (which Omi Windows already uses via
`titleBarStyle: 'hidden'`) draws its own corners regardless of OS version, so this mostly matters
for consistency messaging — round corners on Windows 10 will look *more* modern than the OS's own
chrome, which is fine and arguably desirable (matches the "modern app" positioning), not a
mismatch to avoid.

**Tray behavior differences:** Windows 11 collapsed the tray flyout/overflow ("^") behavior
somewhat versus Windows 10 but the core left-click/right-click contract this doc's §1.6
recommends is stable across both — no version-specific branching needed there.

**Recommended support posture:**
1. **Target both, with Windows 11 as the design reference and Windows 10 as a graceful-degradation
   floor**, not a second design to author for — every Mica/vibrancy/rounded-corner treatment
   should have a solid-color/square-corner fallback that's acceptable, not broken, exactly as
   Microsoft's own Mica fallback behavior models.
2. **Windows 10 reached end of support October 14, 2025**; consumer Extended Security Updates
   (ESU) extend security patching only, through October 2027 for enrolled devices — Windows 10
   is not disappearing from the install base on any near-term horizon and free/no-Microsoft-account
   ESU paths exist (notably in the EEA), so treating Windows 10 as unsupported/droppable in the
   port is premature; keep the graceful-degradation posture rather than gating features/install on
   Windows 11.
3. **Gate every Windows-11-only visual feature behind a precise build-number check** (following
   `windowsVersion.ts`'s existing pattern), never a broad `os.platform()`/major-version check —
   Windows 11 itself shipped multiple DWM/API surfaces incrementally across builds (22000 → 22621
   for the Mica backdrop attribute alone), so "is Windows 11" is not a reliable proxy for "has the
   API this feature needs."

**Sources:**
- [Mica material — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)
- [System backdrops (Mica/Acrylic) — Windows apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops)
- [Windows 11 22H2 is bringing Mica/Acrylic design to more Win32 desktop apps — Windows Latest](https://www.windowslatest.com/2022/06/02/windows-11-22h2-is-bringing-mica-acrylic-design-to-more-win32-desktop-apps/)
- [Windows 10 support has ended on October 14, 2025 — Microsoft Support](https://support.microsoft.com/en-us/windows/windows-10-support-has-ended-on-october-14-2025-2ca8b313-1946-43d3-b55c-2b95b107f281)
- [Windows 10 support has ended: ESU FAQ — Windows Central](https://www.windowscentral.com/microsoft/windows-10/windows-10-eol-esu-faq)
- Codebase: `desktop/windows/src/main/windowsVersion.ts` (existing precise build-gate pattern), `desktop/windows/src/renderer/src/components/layout/TitleBar.tsx` (existing WCO-based custom chrome)

---

## Summary — the mechanical rule

For every Mac UI element being ported, ask: **does this element's shape come from a macOS system
convention (menu bar, sheet-from-titlebar, menu-bar-extra, Notification Center), or is it Omi's
own design (colors, motion language, iconography, copy)?** System-convention-shaped elements get
redesigned around the equivalent Windows convention (Fluent title bar / centered modal / tray /
Action Center toast); Omi's own design elements port with extreme fidelity, per the charter's
default. This section exists to make that first bucket enumerable and checkable rather than a
judgment call made ad hoc per component.
