# Infra / Auth / Settings / Updates / Billing — staleness refresh (v0.12.72)

Domain: auth/Keychain/session, settings/preferences plumbing, app updates/update policy,
desktop Rust backend (`desktop/macos/Backend-Rust`), plans/billing/subscription surfaces,
and shared Python backend (`backend/`) changes affecting desktop clients (platform gating,
chat, memories).

Baseline: `0d09ede61b76dc4a144d05809432bf220394ee3a` (2026-07-09).
Frozen Mac reference: tag `v0.12.72+12072-macos` (2026-07-12 10:47 UTC), checkout at
`C:\Users\chris\projects\omi\.worktrees\mac-ref` (read-only).
Backend (`backend/`) audited against current `upstream/main` (not tag-bounded — the Python
backend deploys independently of the Mac app version).

---

## 1. NEW / CHANGED — backend Python contract changes affecting desktop clients

### 1a. Windows platform gating — the known incident is now FIXED (critical finding)

Commit `e2556479a` "fix(backend): recognize 'windows' as a first-class desktop platform"
(authored 2026-07-13, **on `upstream/main` today**, landed via branch
`origin/upstream-pr/windows-platform-gates` — post-dates the v0.12.72 tag by about a day).

This is exactly the incident class the brief flagged ("Windows was historically
unrecognized"). It is now resolved upstream. Evidence — `backend/utils/subscription.py`:

- New SSOT: `DESKTOP_PLATFORMS = {'macos', 'windows'}`. Every desktop-vs-mobile gate
  (`_platform_hidden_plans`, `should_show_new_plans`, trial-paywall desktop tokens,
  `database/users.py` platform aliases) now reads from this set instead of scattered
  `'macos'` string literals.
- `should_show_new_plans(platform, app_version)`: **windows now recognized**, mirrors
  macOS semantics — fails **open** on missing/unparseable version (permissive, since
  Windows builds are pre-release). New env `NEW_PLANS_MIN_WINDOWS_VERSION` (default
  `'0.0.0'`, i.e. every current Windows build qualifies for the new Operator/Architect
  catalog).
- `_platform_hidden_plans`: Neo (`unlimited`) is now hidden from the Windows purchase
  catalog too, same as macOS (Windows sells Operator + Architect).
- Confirmed pre-fix bug (per commit message): `should_show_new_plans` was returning the
  **legacy plan catalog** to Windows — Operator hidden entirely, Architect retitled "Omi
  Pro", Unlimited retitled "Unlimited Plan" — and Windows would have been **offered a
  legacy Neo plan that does not desktop-entitle** post-cutoff.
- Deliberately unchanged per the commit: app-store reviewer IAP gating (not-in-set was
  already correct), server-side fixed desktop tokens, `backend/routers/desktop_updates.py`
  and the transcribe paths — these **already** recognized `'windows'` before this fix
  (confirmed: `backend/tests/unit/test_desktop_updates.py` and `backend/database/users.py`
  both already grep for `'windows'`).

**What this means for the parity plan:** the "X-App-Platform: windows falls through to
legacy/mobile" incident class referenced in WIRING-AUDIT.md's framing is resolved at the
plan-catalog and paywall level. **Re-verify current Windows behavior against this fix**
(pull it or a `git cherry-pick` isn't needed since it's already on `upstream/main` — a
fresh `backend` deploy picks it up) rather than assuming the old bug is still live.

### 1b. Desktop entitlement floor restructured (Neo/basic no longer zero-access)

Commit `c14a27a78` "fix(desktop): keep Neo above free-tier desktop floor" (2026-07-10,
pre-tag, already in the baseline..tag window) rewrote the desktop-entitlement model in the
same file:

- `DESKTOP_ENTITLED_PLAN_TYPES = {operator, architect}` (Neo dropped) now means "full
  desktop access," **not** "any desktop access." New `effective_desktop_access_tier()`
  returns one of `desktop_free` / `desktop_full` / `desktop_architect` — Free is now a
  valid floor for every plan including Neo and basic, instead of Neo mapping to zero
  desktop capability.
- `desktop_trial_paywall_eligible()` replaces the old `plan_grants_desktop` check for the
  3-day trial paywall: only the `desktop_free` tier is paywall-eligible, and paid plans
  (Neo included) are explicitly excluded even when they're on the free tier — "must never
  be converted into zero audio/chat/realtime access."
  - `desktop/macos/Desktop/Sources/.../FloatingBarUsageLimiter.swift` and
    `DefaultsKey.swift` picked up matching client-side changes in the same commit.
- Trial-paywall cache revalidation: a cached "expired" decision is now revalidated against
  current entitlement before being trusted, specifically to avoid stranding a paid Neo user
  on a stale zero-access decision; calls `record_fallback` (component=other,
  from=trial_paywall, reason=local_heal) per the repo's fallback-telemetry contract.

**Impact:** any Windows usage-limiter / Plan & Usage work modeling "Neo = no desktop" is
now wrong — Neo is `desktop_free` (usable, cost-deferred processing) not blocked. This
lands one day before the platform-gating fix (1a) and both touch the same file; treat them
as one combined contract, not two independent facts.

### 1c. Rate-limiter and usage-reporting hardening (Backend-Rust, desktop-backend)

Both pre-tag, in the baseline..tag window:

- `77da434c0` "clamp client-reported realtime usage tokens to non-negative" — Rust
  `report_usage` previously summed fully client-supplied i64 token counts straight into the
  Firestore `llm_usage` ledger; a negative value could drive recorded cost negative/zero.
  Fixed with `.max(0)` clamping in both `usage_cost` and `report_usage`.
- `361085352` "guard rate-limiter Instant math against underflow panic" (title only
  captured; not deep-dived — flag for Stream 4/billing owner to check if porting rate-limit
  logic).

### 1d. OAuth / auth security hardening (Backend-Rust `routes/auth.rs`)

Both pre-tag:

- `e8b2e335d` "escape OAuth callback values to close XSS class."
- `2687e09ae` + follow-up `c00f5d4dd` "allowlist OAuth redirect_uri to close the
  open-redirect" — `/v1/auth/authorize` previously accepted **any** `redirect_uri`, stored
  it, and the callback page delivered the freshly minted auth code to it (open redirect →
  code theft: attacker sends victim a crafted authorize URL with
  `redirect_uri=https://evil.example/cb`). Fix adds `is_allowed_redirect_uri()`: only
  loopback HTTP (`127.0.0.1`/`localhost`, any port) or a custom app-scheme deep link
  (`omi-computer://…`, named-bundle schemes) are accepted; any `https://` or non-loopback
  `http://` is rejected outright, including subdomain tricks like
  `127.0.0.1.evil.com`.

**Impact:** if Windows' auth flow (or a future BYOK/DPAPI standalone PR) talks to
`/v1/auth/authorize`, its `redirect_uri` **must** be one of these two forms or the backend
will now reject it with `invalid_redirect_uri`. Verify Windows' loopback callback server and
any custom protocol scheme it registers match this allowlist shape before assuming the
existing desktop OAuth flow "just works" against current backend.

### 1e. Memory endpoint contract changes (`backend/routers/memories.py`)

Two commits reshape `/v3/memories` write paths (pre-tag `f0e7078e3` "enforce INV-MEM-1
admission processing", and `f630e8cfd` "preserve released desktop contracts"):

- `create_memory` / `create_memories_batch` now route through
  `memory_service.create_external_memory(...)` (structured `source_type` /
  `source_signal` / `extractor_id` fields) instead of the old
  `memory_service.write()` + `required_promotion_payload()` path.
- `get_memories` now passes `include_pending_processing=True`.
- `f630e8cfd` (title: "preserve released desktop contracts") explicitly touches
  `backend/routers/memories.py` to "support canonical memory mutation bodies with legacy
  query compatibility" — i.e. it's a compatibility shim for exactly the kind of
  body-vs-query-param mismatch WIRING-AUDIT.md documents for goal-completion (C10). Worth a
  direct read by whichever stream owns memory-edit wiring (Stream 3) to check whether it
  also resolves the memory-edit 422 contract question flagged as a decision gate.
- This is nominally Stream 3's file, but flagging here because it's a backend-contract
  change in the window your brief asked me to cover ("memories endpoints").

### 1f. Chat / transcription backend fixes (lower priority, noted for completeness)

- `a6d4b98ec` "fix(chat): return 404 not 500 when reporting a non-existent message" —
  `POST /v2/messages/{id}/report` and `/v1/messages/{id}/report` unpacked
  `database.chat.get_message`'s `None` result unconditionally, raising `TypeError` → 500
  instead of the intended 404. Fixed with a guard before unpacking.
- `d4252a673` "fix(transcription): retain failed audio and surface live STT errors" — large
  cross-platform commit (also touches `app/lib/...`) unifying transcription outcomes across
  uploads/sync/live listen, retaining retry material for failed/partial sync jobs, gated
  behind a "known-audio candidate probe" + "recoverable ledger-fence cutover." Out of my
  domain's core scope but touches shared transcription contract — flag for whoever owns
  Windows PTT/transcription reconnect work (Stream 2) since WIRING-AUDIT.md already
  documents Windows' missing `/v4/listen` reconnect/`client_conversation_id` gap; this
  backend change may shift what "correct" reconnect behavior looks like.

---

## 2. NEW — Mac desktop app changes in-window (baseline → tag), infra domain

### 2a. Desktop update system overhaul (`0c7b08540`, pre-tag, 2026-07-09)

"Make desktop updates explicit, qualified, and recoverable" — this is a full rework of how
Mac ships updates, replacing whatever simpler mechanism the original audit files assumed:

- Immutable desktop release manifests + explicit `stable`/`beta` channel pointers (replacing
  ad-hoc GitHub release lookup), with live cache, validated 30-day last-known-good (LKG)
  recovery, exact-channel legacy fallback, reconciliation metrics, and a legacy kill switch
  (`DESKTOP_UPDATE_POINTERS_MODE=legacy`).
- Automatic beta publication replaced by candidate builds that must pass exact-tag "T2
  qualification" before an atomic beta promotion; stable promotion is separately gated.
- Install success is now reported only after the relaunched app verifies the target build
  (correlated start/success/failure telemetry).
- Backend must contain the manifest/pointer endpoints before first beta promotion — this is
  a **backend-and-client coupled contract**, not client-only.

### 2b. Sparkle/Keychain smoke canary now mandatory for release

Per `desktop/macos/AGENTS.md` (read from the mac-ref worktree): every signed release now
requires a mandatory in-app synthetic Keychain write/read/delete canary
(`scripts/smoke-signed-desktop-artifact.sh --auth-storage-canary`) before beta publication.
Not directly portable to Windows but signals Mac's update pipeline now treats Keychain
health as a release gate — worth knowing if Windows ever adds an equivalent DPAPI health
check to its own update/release pipeline.

---

## 3. NEW — post-beta Mac changes (v0.12.72 → upstream/main today), infra domain

**Track, do not port yet** — these are ahead of the frozen reference tag streams are pinned
to, but they change the ground truth streams will eventually need to catch up to.

### 3a. Onboarding Keychain fix — matches the brief exactly

`c9fc403ef` "Fix persistent browser Keychain access in desktop onboarding (#9427)"
(2026-07-13, post-tag). This is the fix your brief pre-flagged. Full detail:

- **What it actually is:** NOT the primary Firebase-session Keychain (that's
  `AuthSessionCoordinator` / `INV-AUTH-1`, unaffected). This is the **browser-integration**
  Keychain path (`BrowserGoogleSession` — reading Chrome/Safari/etc.'s "Safe Storage" key
  during onboarding's Google-connector step, used for Gmail/Calendar import).
- **Root cause:** the old code shelled out to `/usr/bin/security` to read the browser's
  Keychain-stored Safe Storage key. Because the prompt was attributed to `/usr/bin/security`
  rather than the signed Omi app, macOS's "Always Allow" grant didn't persist across app
  relaunches — the user was re-prompted every time.
- **Fix:** exact in-process Security framework lookup (no shell-out), so the Keychain
  prompt and "Always Allow" grant are owned by the signed Omi app bundle and persist.
  Unsupported versioned cookie blobs now fail closed. Verified: built/signed
  `omi-keychain-fix.app`, first prompt was owned by the app, and after "Always Allow" +
  full relaunch, `gmail_read_probe` connected without a second prompt.
- **Relevance to Windows:** the parked "Firebase-token → DPAPI migration" item
  (PARALLEL-PLAN.md "Parked tasks") is about the *primary* auth token, unaffected by this.
  But if/when Windows builds a browser-Keychain-equivalent for its own Google-connector
  onboarding step (Windows Credential Manager / DPAPI-backed), this fix is the reference
  for the "persist the Always Allow grant against the right process identity" pattern —
  same class of bug is possible on Windows if a similar helper-process shell-out pattern is
  used instead of an in-process credential-store call.

### 3b. Update policy control-plane hardening (`deefbf1ff`/`c3378725c`, #9647, post-tag)

"Harden desktop update policy recovery" — extends 2a's update system:

- Backend now **fails open** (returns an inactive safe default) when the update-policy
  control plane (Firestore-backed) is unavailable, instead of leaving desktop clients stuck
  with a stale blocking prompt or an unusable download target.
- Both backend and macOS client now reject malformed policy URLs; malformed policy payloads
  are non-blocking.
- A previously displayed **required** update prompt is now cleared if a subsequent policy
  refresh fails, with recovery telemetry.
- PR explicitly notes `INV-AUTH-1` is path-glob-matched only (`APIClient.swift` touched) —
  no session/401/credential behavior changed.

### 3c. Settings structure changed — invalidates the "11 sections" audit claim's target shape

`891c26de2` "Desktop: neutral design system, smooth notch, settings declutter (#9584)"
(2026-07-12, ~11h post-tag). **This directly changes what Stream 4's "Notifications tab"
target should look like.** Details:

- **Sidebar nav merged 11 → 9 items at the presentation layer only**: Account+Plan merged
  into one row, Notifications+Privacy merged into one row. The underlying
  `SettingsSection` enum's 11 raw values (`general, rewind, transcription, notifications,
  privacy, account, planUsage, aiChat, floatingBar, shortcuts, advanced, about`) are
  **unchanged** — this is presentation-only, and old deep links alias to the merged rows
  (locked by a new test), so automation/`omi-ctl navigate settings <section>` contracts
  still work by the old names.
- Confirmed directly by reading the code **at the tag** (pre-declutter, since this commit
  landed ~11h after the tag): `SettingsSidebar.swift`'s `visibleSections` array at the tag
  still lists all 11 rows separately (`.notifications`, `.privacy`, `.account`, `.planUsage`
  each their own row) — i.e. **the "11 sections" figure in
  `12-app-shell-pages-system.md:28` is accurate AS OF THE TAG**, but is already stale
  relative to current Mac (which shows 9 merged rows).
- One button format + one dropdown format across every settings section; decorative accents
  thinned to state-only; Notifications switched from a button to a toggle; "Notifications"
  row moved above "System Audio" in General.
- Neutral design system (`OmiTheme`): single white accent replaces the purple accent system
  (INV-UI-1) — 301 token refs + 5 raw `.purple` sites → zero in Swift sources. Not
  infra-domain but worth flagging since Stream 4 owns visual/settings files: this
  reconfirms `--accent: #ffffff` is the current Mac target, matching what
  PARALLEL-PLAN.md's pre-work step 1 already assumed for Windows.

**Stale claim to correct:** `12-app-shell-pages-system.md` line 28 —
> "Settings sections | 11 sections (General, Rewind, Transcription, Notifications, Privacy,
> Account, Plan&Usage, AI Chat, Floating Bar, Shortcuts, Advanced, About) | 6 tabs..."

New truth: 11 sections is accurate for the **model** (and the frozen v0.12.72 reference
tag's presentation), but current Mac (post-`891c26de2`) **presents** those as 9 merged
sidebar rows (Account+Plan combined, Notifications+Privacy combined) while keeping all 11
raw section identities for deep-linking. A Windows "Notifications tab" built as a
standalone item (as PARALLEL-PLAN.md Stream 4 currently scopes it) will diverge from where
Mac's presentation has already moved — worth a product call on whether Windows should match
the pre-declutter (separate Notifications) or post-declutter (merged Notifications+Privacy)
shape before building it.

### 3d. Other post-tag desktop commits touched, not deep-dived (lower confidence, listed for tracking)

- `0ac622c27`, `d3c8eccb9`, `a815f5481`, `db6598722`, `55e822f8d` — further settings-polish
  commits in the same PR chain as 3c (button primitives, Font Size card scale revert,
  notifications-above-system-audio, thinner accents, merged nav) — all part of the same
  `891c26de2` PR, not independent changes.
- No commit in the post-tag window matched keywords for launch-at-login default migration,
  crash/clean-exit detection, or Crisp/Help changes — those Mac subsystems appear
  **unchanged** since the tag (confirmed present and structurally the same at the tag via
  direct file read: `SingleInstanceGuard.swift` still owns `.omi_running` crash-flag +
  `lastSessionCleanExit`; `CrispManager.swift`/`HelpPage.swift` still present, no commits
  touched them in the audited window). Treat WIRING-AUDIT.md's claims about these two items
  as still accurate.

---

## 4. PARALLEL-PLAN.md corrections

Verified against the v0.12.72 tag and the backend window above. Line references are to
`desktop/windows/docs/mac-parity-audit/PARALLEL-PLAN.md`.

1. **Decision gate 1 (Trial/paywall + usage limiter) needs a footnote, not a reopen.**
   Line 232-233 says "RESOLVED... residual scope is product policy only." That's still true
   for the Windows-side UI work, but the **backend entitlement model it targets has since
   moved twice** (§1a, §1b above): Neo is no longer zero-desktop-access (it's
   `desktop_free`), and Windows platform gating for the new plan catalog is now live on
   `upstream/main`. Whatever Plan & Usage / usage-limiter UI Stream 4/settings-parity built
   should be re-verified against the current `should_show_new_plans` /
   `effective_desktop_access_tier` contract, not the pre-`c14a27a78`/`e2556479a` one it may
   have been designed against.

2. **Stream 4 "Notifications tab" scope is stale relative to current Mac** (§3c above). The
   plan (line 184-189) treats "Notifications tab" as a standalone settings section separate
   from Privacy — that was correct at the tag, but current Mac (post-`891c26de2`, landed
   ~11h after the tag) has already merged Notifications+Privacy into one presentation row
   (keeping the 11 raw section identities underneath for deep-link compatibility). Building
   Windows' Notifications tab as a standalone section will immediately diverge from the Mac
   shape it's meant to reach parity with. Recommend: read `891c26de2`'s actual Settings SwiftUI
   changes (not just this summary) before wiring the Windows tab, or explicitly decide to
   target the pre-merge (tag) shape and accept the divergence.

3. **`main/billing/**`, `lib/billing.ts`, `lib/usageLimit.ts` collision-table entry (line
   227) should account for the entitlement-tier restructuring.** The plan says
   "Stream 2 CONSUMES for the bar usage-limiter (reuse, don't rebuild)" — whoever builds
   `main/billing/**` on `feat/windows-settings-parity` should build against
   `effective_desktop_access_tier()` (`desktop_free`/`desktop_full`/`desktop_architect`),
   not a binary entitled/not-entitled check, or Stream 2's consumer will inherit a
   pre-`c14a27a78` model.

4. **No change needed / confirmed still accurate:** launch-at-login migration, crash/clean-exit
   detection, and Help/Crisp items in Stream 4's scope (line 187-189) — nothing in the
   audited window (baseline through today, both pre- and post-tag) touched these Mac
   subsystems. WIRING-AUDIT.md's characterization of them stands.

5. **Auth/session settled-files list (line 224: `lib/authSession.ts`, `lib/authTeardown.ts`,
   `lib/apiClient.ts` — "settled (auth), standalone-PR changes only") is a Windows-side
   claim, not a Mac one** — I did not find anything in the Mac-side auth commits (§1d, §3a)
   that requires reopening those Windows files; the OAuth redirect_uri allowlist (§1d) is a
   **backend** contract Windows' existing loopback-callback flow should already satisfy
   (loopback HTTP matches the allowlist), but it's worth a quick confirmation pass rather
   than an assumption, since a rejected `redirect_uri` would surface as a silent
   `invalid_redirect_uri` failure at `/v1/auth/authorize`.

6. **BYOK / Firebase-token→DPAPI parked items (line 281-284): no new Mac information.**
   Nothing in the audited window changed Mac's BYOK key-store shape or its Keychain storage
   of the primary Firebase token in a way that affects the Windows DPAPI migration decision.
   The only related change is the *browser*-Keychain onboarding fix (§3a), which is a
   different credential path.

---

## 5. Impact on the 4 Windows parity streams

- **Stream 1 (agent/chat):** no infra-domain findings change Stream 1's scope. The backend
  memory-endpoint contract change (§1e) may be relevant if Stream 1's tool surface calls
  memory-write endpoints, but ownership is Stream 3's.
- **Stream 2 (voice/bar):** the usage-limiter item in Stream 2's Phase A ("Usage limiter for
  the bar, pending product decision") should be built against the restructured entitlement
  model (§1b, §3-corrections item 3) once Chris unblocks it — the underlying backend
  semantics changed since the plan's product-decision framing was written.
- **Stream 3 (proactive/memory):** the memories router contract change (§1e) is a real
  backend shift on files Stream 3 owns (`hooks/useMemories.ts` consumers); worth a direct
  read of `f0e7078e3`/`f630e8cfd` before finalizing memory-edit wiring, since one of them is
  explicitly framed as a desktop-contract-preservation fix and may bear on the "is Mac even
  right?" memory-edit 422 question WIRING-AUDIT.md raised.
- **Stream 4 (rewind/shell) — primary domain overlap:**
  - Settings section structure changed post-tag (§3c) — re-scope "Notifications tab" per
    correction #2 above before building it.
  - Update system is far more elaborate than a simple GitHub-release check (§2a, §3b) —
    if Stream 4's "updater" item means porting Mac's *behavior* (not just "check for
    updates"), the real target is: immutable manifests, stable/beta pointers, T2
    qualification, LKG recovery, fail-open policy-control-plane. Confirm with Chris whether
    Windows' updater needs this level of sophistication or a simpler policy is acceptable
    given Windows has no equivalent backend manifest/pointer infrastructure yet.
  - Launch-at-login, crash/clean-exit detection, Help/Crisp: unchanged, existing audit
    claims stand, proceed as planned.
  - Billing/Plan & Usage surfaces (owned by `feat/windows-settings-parity`, not strictly
    Stream 4, but cross-cutting per your instruction): must target the restructured
    entitlement tiers (§1b) and the now-fixed Windows platform gate (§1a) — both landed
    since the original audit was written and change what "correct" Plan & Usage / paywall
    behavior looks like for Windows specifically.

---

## Commits referenced (for follow-up `git show`)

Pre-tag (baseline..v0.12.72), in-window:
`0c7b08540` (updates overhaul), `c14a27a78` (Neo desktop floor), `77da434c0` (usage clamp),
`361085352` (rate-limiter underflow — not deep-dived), `e8b2e335d` (OAuth XSS escape),
`2687e09ae`+`c00f5d4dd` (OAuth redirect_uri allowlist), `f0e7078e3` (INV-MEM-1 admission),
`f630e8cfd` (preserve released desktop contracts), `a6d4b98ec` (chat 404 fix).

Post-tag (v0.12.72..upstream/main), track-don't-port:
`c9fc403ef` (browser Keychain onboarding fix), `deefbf1ff`/`c3378725c` (update policy
recovery hardening #9647), `891c26de2` (settings declutter / neutral design #9584) +
`0ac622c27`/`d3c8eccb9`/`a815f5481`/`db6598722`/`55e822f8d` (same PR chain).

Backend, current `upstream/main` (post-tag, already live):
`e2556479a` (Windows platform gating fix — critical, resolves the known incident class),
`d4252a673` (transcription retain-failed-audio, cross-platform).
