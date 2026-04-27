# BUGS.md — entuned-0.3

Bug log from the 2026-04-27 end-to-end QA pass on `dash.entuned.co` (Lululemon → Park Meadows → Mindful Mover ICP → references → hooks → song seed → Suno bundle → schedule → Oscar).

The happy path *does* work end-to-end. These are the issues found along the way, in priority order.

## Status (2026-04-27)

| ID  | Status     | Note                                                                       |
| --- | ---------- | -------------------------------------------------------------------------- |
| B1  | ✅ false alarm | Server-side login confirmed working                                     |
| B2  | ✅ false alarm | Client + server both correct; was a B6 (MCP) symptom                    |
| B3  | ✅ fixed   | Bulk-decompose serializes calls now (no more parallel-burst rate-limit)    |
| B4  | ✅ fixed   | `<ToastProvider>` + `useToast()`; wired to OperatorManager / IcpEditor / ClientDetail / StoreEditor |
| B5  | ✅ fixed   | Hook drafter shows `drafting… mm:ss` + "typically 1–3 min"                 |
| B7  | ✅ fixed   | `useStoreSelection()` persists store across all 7 panels via localStorage  |
| B8  | ✅ fixed   | "approve all" + "decompose all" bulk buttons on reference-tracks header   |
| B9  | ✅ fixed   | ICP prose fields now use 2-column subgrid (label-left); no scroll-fold ambiguity |
| B10 | ✅ fixed   | Oscar header popover lists other accessible stores; click switches + reloads |
| B11 | ✅ fixed   | Operator-Manager Stores column shows `Lululemon — Park Meadows`            |
| B12 | ✅ fixed   | Schedule "+ new row" has Mon–Sun multi-select + all/none; creates N rows  |
| B13 | ✅ fixed   | ICP form labels have hint text and `title=` tooltips                       |
| B14 | ⏳ deferred | Default-outcome help text on new-store form                                |
| B15 | ⏳ deferred | Sub-tab state in URL (no router by design — needs intentional design)      |
| B16 | ✅ fixed   | "fired N exclusion rule(s)" now expands to show triggerField/Value + note  |
| B17 | ⏳ deferred | New-client form contact-field hints                                        |
| B18 | ⏳ deferred | Network-tracker observability                                              |
| B19 | ✅ fixed   | Server lowercases + trims emails on operator create/update + login lookup |

---

## P0 — agent-blockers and silent data loss

### B1. ~~New-operator password not persisted on create~~ — RESOLVED, FALSE ALARM
**Update 2026-04-27:** Direct `curl POST /auth/login` against Railway returns HTTP 200 with a valid JWT for `lulu-pm@entuned.co` / `lulu1234`. Server-side persistence and bcrypt comparison both work. The original symptom ("login failed in UI") was a UI-side issue — likely a typo, a stale cached error, or the player not transmitting what was typed. **Re-test scope is the player login form**, not the server.

**Why this matters anyway:** the symptom-confusion turned a 30-second test into 30 minutes of fruitless fixes. See B4 (no save toast confirming what was saved) and the case-mismatch latent bug in B19 below.

---

### B2. ~~"approve immediately" checkbox is non-functional~~ — RESOLVED, FALSE ALARM
**Update 2026-04-27:** Client passes `approve: approveOnCreate` correctly (`HookQueue.tsx:194,206,229`); server honors it correctly (`admin.ts:1155-1157`). The button label even flips to `(approved)` when checked. My QA failure was a manifestation of B6 — the MCP `form_input` set the checkbox visually but React's onChange didn't fire, so component state stayed `false`. Real users clicking with a mouse get the correct behavior.

---

### B3. Decompose calls fired in rapid succession silently no-op
**Symptom:** Kicked off all 16 reference Decompose buttons via JS in <500ms apart. Only ~9 produced L2 output after 60s, the remaining 7 needed a second pass. No error, no toast, nothing in console.

**Where to look:** Either client-side debouncing kills concurrent calls, or server-side concurrency / rate limit silently 4xx's. Check the L2 decompose endpoint and the client mutation — if the server returns 429 or 409 it should at least surface a toast.

**Why P0:** fire-and-forget pattern with silent loss.

---

### B4. ICP `save profile` and most "save" buttons give zero feedback
**Symptom:** Clicked save → nothing. No toast, no button-state change, no "saved" pill. Only confirmation is the tiny `updated <timestamp>` text in the section header. Easy to assume the save failed and click again, or assume it succeeded when it didn't.

**Where to look:** every `<button onClick={save}>` in admin. Add a unified mutation-status toast.

**Why P0:** indistinguishable success from failure on the most common action in the app.

---

### B5. Hook drafter blocks ~2.5 min on a single "drafting…" label
**Symptom:** Click `draft hooks`, button → `drafting…`, no progress / ETA / streaming for ~150 s. An automation that doesn't know typical duration will time out or kill it.

**Where to look:** `HookQueue` drafter — stream the stages (voiceNotes → sonic anchor → Bernie draft) or at minimum show elapsed seconds + expected range.

**Why P0:** hangs the perception of an entire flow.

---

### B6. Form-input controlled components ignore programmatic value sets
**Symptom:** `form_input(ref, value)` from the MCP/devtools sets the DOM `.value` but React's controlled-input state doesn't update — so the form submits with the empty/initial value. Saw this on:
- new-operator password (`B1`)
- ICP psychographic save (the pre-fill looked right but the network payload was empty until a manual click + retype)
- "approve immediately" checkbox (`B2`)
- Operator-Manager "Lululemon — Park Meadows" checkbox (had to mouse-click; programmatic check did not stick)

**Why P0:** prevents safe automation. Even Daniel's workflows (paste-and-go) likely lose data in browsers that auto-fill.

**Fix direction:** all controlled inputs must dispatch `input`/`change` via the React-aware setter, OR the form should read from refs/DOM at submit time, OR submit handler should treat empty-string passwords as "no change" defensively.

---

## P1 — workflow friction

### B7. Store dropdown does not persist across sub-tabs
**Symptom:** Pick `Lululemon — Park Meadows` in Store Editor → switch to ICP Editor / Hook Queue / Creation / Schedule → each resets to `— pick a store —`. Forces re-picking 4× per session.

**Where to look:** lift the selected store into a context/URL param.

---

### B8. ICP, Hook, Reference all need bulk approve / bulk decompose
**Symptom:** 16× Approve clicks for ref suggestions, 16× Decompose, 8× approve for hooks. The hook-draft view *has* `all`/`none` selection toggles but they aren't wired to a single approve action.

---

### B9. "Fears" label clipped at scroll fold of ICP psychographic form
**Symptom:** Filling top-to-bottom, every field shifts by one because `Fears` sits exactly at the scroll boundary between the upper grid and the lower textarea stack. Burned ten minutes; agent re-aligned by reading the DOM labels.

**Where to look:** `ICPEditor` — taller container, sticky labels, or auto-scroll on tab/click.

---

### B10. No store switcher inside Oscar
**Symptom:** Operator session is bound to one store at sign-in time. Switching = full logout/login round-trip. For an admin running QA across multiple Park Meadows stores this is meaningful friction.

**Where to look:** `apps/player` header — if operator has access to >1 store, render a picker.

---

### B11. Operator Manager "Stores" column conflates clients
**Symptom:** Daniel's row shows `Park Meadows, Park Meadows` — two different stores under different clients become visually identical.

**Where to look:** include the client prefix: `Lululemon — Park Meadows, Untuckit — Park Meadows`.

---

### B12. Schedule rows are per-day; no "every day" or multi-day picker
**Symptom:** To cover Mon–Sun with one outcome you have to create 7 rows.

---

## P2 — comprehension and discoverability

### B13. ICP form labels are tiny, lowercase, no help text
`openness`, `fears`, `unexpressed desires`, `turn-offs` — meaningful only if you already know the system. Add tooltips or one-line examples.

### B14. New-store form's "Default Outcome" dropdown has no explanation
First-time setup doesn't tell you what selecting it does or how it propagates.

### B15. Sub-tab state isn't reflected in URL
Reload from Hook Queue → land on Client Detail. No deep-linking; can't share a screen with a teammate.

### B16. "fired N exclusion rule(s)" appears with no link to which rules fired
Operators reviewing the Suno output can't audit the safety pass.

### B17. New-client form has no POS-provider / contact required-field hints
Submits succeed with empty contact. Probably correct, but unclear.

---

### B19. Latent: email case mismatch between create and login
**Symptom:** Player calls `api.login(email.trim().toLowerCase(), password)` (`apps/player/src/screens/LoginScreen.tsx:22`). Admin's `CreateForm` does NOT lowercase on create — sends `email` from state verbatim. Postgres `email` column is plain text (not `citext`). Anyone who creates `Operator@store.com` cannot log in via the player.

**Fix:** lowercase + trim on the server in `OperatorCreateBody` and `OperatorUpdateBody` parsers, so storage is canonical regardless of client behavior.

**Why P1:** silent onboarding failure with confusing UX (the symptom that ate 30 minutes today).

---

## P3 — observability

### B18. Network tracker shows only OPTIONS preflights
`/admin/icps/.../hook-writer/run` — actual POST not visible end-to-end. Likely fetch+CORS+streaming combo confusing the tracker, but it makes long-running calls feel like hangs. A "last run took Xs" badge on the calling button would help.

---

## Out-of-scope environmental

### E1. Phantom wallet extension breaks Oscar's window context
Chrome MCP automation gets `Cannot access a chrome-extension:// URL of different extension` on every action against `music.entuned.co` when Phantom is installed. Not Entuned's bug, but worth a defensive iframe / CSP isolation for the player surface, and a documented recommendation that Oscar runs in a clean kiosk Chrome profile.

---

## What worked well (kept for context)

- Reference-track suggestion → 16 well-rationalized picks, each tied to specific psychographic fields.
- L2 decompose (when it ran) produced rich `vibe pitch / era production signature / instrumentation palette / standout element`.
- Final Suno bundle (style + negative + vocal_gender + lyrics + title) was usable as-is. The Mindful-Mover hooks correctly avoided motivational cliché.
- Catalogue → 2 LineageRows landed `ACTIVE` after pasting Suno R2-rehosted URLs.
- Schedule → outcome row created cleanly.
