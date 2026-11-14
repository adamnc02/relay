---
name: close
description: Wrap up this session's Relay ticket. Handles "/close" (mark it Done), "/close later" (park it in Up next with the next step) and "/close wait" (move it to Waiting for me with the one-line need). Use when Adam types /close, /close later or /close wait, or asks to close, park or wrap up the ticket.
---

# /close: wrap up the session's ticket in one step

The CLI is `~/.claude/relay/bin/relay`. The argument after `/close` picks the outcome:

| Typed | Run | Ticket ends up |
|---|---|---|
| `/close` | `relay close done` | Done |
| `/close later` | `relay close later --next-step "…"` | Up next, with the brief's next step updated |
| `/close wait [need]` | `relay close wait --need "…"` | Waiting for me, with the need |

## Steps

1. **Which ticket.** The session's current ticket is the last one attached (`relay doctor` shows
   it). If none is attached but the work clearly belongs to one, `relay attach KEY` first. If this
   session did no real work and has no ticket, say so and stop: there's nothing to close.
2. **Bring the brief up to date first** if this session changed the plan or the state
   (`relay brief`), so the next session starts from the truth.
3. **Write the summary**: two lines on what this session finished. Collect this session's commit
   SHAs and PR URLs.
4. **Update the plain summary**: `relay summary "…"`, two to four plain-English sentences on the
   issue, what's been done and what happens next, written for someone non-technical (no file
   names, branches, PRs or jargon). The app drafts email and Teams updates from it.
5. **Run it**, for example:

   ```bash
   relay close done --summary "Merged #12 (cli/ + hooks); installed globally.
   Hooks proved with claude -p." --commit 3f2a1b9 --pr https://github.com/adamnc02/relay/pull/12
   ```

   - **later**: also pass `--next-step "…"`, the first thing the next session should do.
   - **wait**: pass `--need "…"`, one line saying what Adam has to do or decide. If he didn't
     give one after `/close wait`, ask him for it, then run the command.
   - Anything still open goes in `--open-items "…"`.
   - `close` sweeps git for shell-changed files and sends the file queue first, and it clears the
     "closed without wrap-up" flag. For a parent ticket the status is left alone (it rolls up from
     its phases); the session entry is still posted.
6. **Reply** in one or two lines with the ticket ID and where it ended up, for example
   "RLY-5 → Done." **If anything is still open, say so in that reply** rather than marking it Done
   without a word. For later/wait, end with the kickoff: `Continue RLY-5.`

If `relay close` fails because Relay can't be reached, say so plainly and give Adam the exact
command to re-run. Don't claim the ticket was closed.
