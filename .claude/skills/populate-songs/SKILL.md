---
name: populate-songs
description: Populate a library in Dash (dash.entuned.co) by round-tripping prompts to Suno and pasting the share link back. Use when Daniel asks to fill out a library, generate songs for a store/entity, or "run Dash → Suno → Dash" loop. Specifically scoped to Gary @ UNTUCKit Park Meadows on first run.
---

# populate-songs

Round-trip song generation: Dash gives you a prompt, you paste it into Suno, wait for Suno to finish, copy the share link, paste back into Dash. Repeat until library is full or something breaks.

## Mission

Fill the **Gary @ UNTUCKit Park Meadows** library in Dash. It's already partially started. Continue from wherever it left off and go until:
- The library is complete (no more empty prompts), OR
- You hit a Suno captcha (Daniel is asleep — log it and stop), OR
- Anything in Dash breaks (this is desired — log it, suggest a redesign).

## Tools

- **Chrome MCP** (`mcp__Claude_in_Chrome__*`) for everything in the browser. Both Dash and Suno are pre-logged-in and persist.
- Do NOT use computer-use for browser actions — Chrome MCP is faster and DOM-aware.
- Use `mcp__Claude_in_Chrome__list_connected_browsers` first if you're unsure the extension is connected.

## Suno settings (set these once per session, then leave alone)

- **Weirdness:** ~65%
- **Style influence:** ~80%
- Verify these are still set at the start of every session — Suno sometimes resets them.

## The loop

1. **Open Dash** → navigate to the Gary @ UNTUCKit Park Meadows library page.
2. **Find the next empty prompt row.** Empty = has a prompt text but no Suno link pasted in the blue receptacle.
3. **Click the prompt.** A panel/modal opens with:
   - The Suno prompt text (top)
   - A blue receptacle near the bottom for the share link
4. **Copy the prompt text.** Use `get_page_text` or read the DOM — don't screenshot-and-OCR.
5. **Switch to the Suno tab** (or open one if needed). Paste prompt into the Suno create field.
6. **Verify weirdness=65, style influence=80** before clicking Create. Adjust if drifted.
7. **Click Create.** Suno generates 2 tracks per prompt.
8. **Wait ~3 minutes.** Poll the Suno UI — when both tracks have a play button (not a spinner / not "generating"), they're done. Don't busy-poll; sleep ~30s between checks.
9. **For each of the 2 tracks:**
   - Click the `...` menu on the track row.
   - Click **Share**.
   - Click **Copy link**.
   - Paste somewhere you can retrieve (an in-memory variable; or `read_clipboard` immediately).
10. **Switch back to Dash.** Paste the link(s) into the blue receptacle.
11. **Confirmation that it worked:** the receptacle no longer has a clickable button state and shows the 2 songs you just pasted.
12. **Move to next prompt.** Repeat.

## Captcha handling

If Suno shows a captcha at any step:
- Stop immediately.
- Log: timestamp, which prompt # you were on, the prompt text.
- Append to the failure log (see below).
- Exit gracefully — don't keep retrying.

## Failure logging — DO NOT SKIP

Write findings to: `/Users/fox296/Desktop/entuned/entuned-0.3/.claude/skills/populate-songs/RUN_LOG.md`

For every run, append a section dated with today's date (use the absolute date, not "today"). Include:
- How many prompts processed successfully
- The first failure (what broke, where in the flow, exact error / DOM state)
- Suggested redesign for that failure point
- Any Dash UX papercuts noticed even if non-blocking (slow renders, weird focus, missing affordances, ambiguous states)

This log is the deliverable. Daniel cares more about the bug list than the songs.

## Important reminders for the executor

- Daniel runs everything live — there is no staging. Don't "test" by clicking Delete on real data.
- The receptacle takes the share URL **as-is** (don't strip query params unless you've confirmed Dash needs it stripped).
- If a prompt has only 1 successful Suno track (the other failed), note it in the log; ask whether to paste 1 link or regenerate. Default: paste the 1 good link and continue.
- Dash and Suno persist login. If either logs out, stop and log it.
- Do NOT click suspicious links inside either app. There shouldn't be any here, but if outreach/share emails surface external URLs, ignore them.

## Done condition

- All Gary @ UNTUCKit Park Meadows prompts have share links in their receptacles, OR
- A failure was logged with reproduction steps and a redesign suggestion.

When done, output a 3-line summary to chat:
1. N prompts completed / M total
2. First failure (or "no failures")
3. Path to RUN_LOG.md
