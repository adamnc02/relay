---
name: relay
description: Relay is Adam's projects board, and every piece of real work in any folder is tracked there as a ticket. Use this at the START of any real work, in any folder or repo, before planning or writing code - whenever a session will change files, publish or deploy something, start a build, a phase, a bug fix or a UAT round, or need something from Adam later. Also use it when a message says "Continue KEY." (like "Continue RLY-5."), when a quick question grows into real work (Adam says he'll come back to it, the session ends with nothing settled, or it turns into multi-turn planning or debugging), at the end of each phase, and whenever Relay, a ticket ID, the handoff or the brief comes up. Not for a quick question answered and finished in the same session.
---

# Relay: the ticket is the handoff

Every real piece of work has a Relay ticket. The ticket holds the handoff: a **brief** (rewritten
as things change), an append-only **session log**, every **file touched**, **reference docs** and
**links**. A later session picks the work up from `Continue KEY.` alone, with no handoff file.

The CLI is `~/.claude/relay/bin/relay` (below, `relay`). Run it through Bash. It knows this
session's ID from the environment, so `attach`, `close`, `notes`, `session` and `sweep` work with
no extra flags. `relay help` and `relay <command> -h` list every option.

## 1. Get a ticket as soon as the work is clear

The SessionStart hook has already put the open tickets for this folder's project, everything
Waiting for Adam, and any ticket **closed without wrap-up** into your context.

1. **Raise any "closed without wrap-up" ticket for this folder first**: "DSK-21 was closed
   without wrap-up. Mark it done, or carry on?"
2. **Kickoff `Continue KEY.`**: the prompt hook normally attaches the ticket and injects its
   handoff with your prompt. If you don't see a "Relay: this session is now attached" block, run
   `relay attach KEY` and `relay get KEY` yourself. Read the whole handoff before acting: brief,
   last sessions, files, docs and new notes. For a phase, the parent's plan comes with it.
3. **New work**: look for an existing ticket first (`relay find WORDS`). If there's none:

   ```bash
   relay create "Short title" --brief - <<'EOF'
   ## Goal
   …
   ## Decisions
   …
   ## Next step
   …
   EOF
   ```

   `create` attaches the new ticket to this session and puts it **In progress**. **A bug fix is
   `--type bug`** (the board marks bugs with a bug icon); everything else is the default, dev.
   `relay type bug|dev` changes it later. **File it in the
   right project whenever you know it**: the app chosen in app-session, or a project Adam names or
   that is clear from the chat or the board (`relay find`). Pass `--project KEY` for it. Without
   `--project`, the working folder's project is used (folder or repo, worktrees included). Only
   when no project fits does the ticket go to the Inbox (`INB`), where Adam files it in the app:
   into a project, a new project, or a Jira project by linking the Jira issue. **Only when Adam
   asks**, do it from the CLI instead: `relay project create KEY --name "…" [--path DIR]`,
   `relay move KEY --key TICKET`, `relay jira URL --key TICKET`. Add `--dry-run` first when unsure.
4. **Phased work** is a parent with one child per phase: `relay create "Phase 2: …" --parent RLY-1`
   (the phase number defaults to the next one). A phase can't have phases, and it lives in its
   parent's project. **Never set a parent's status**: the database rolls it up from its phases.
5. **A quick question that grows**: create the ticket at the moment it grows. Its first note
   (`relay note "…"`) sums up what's been covered so far.

## 2. While working

- **Decisions go in the brief and the commit message**, not in repo docs (those state facts only).
  Rewrite the brief whenever the plan changes: `relay brief < file` or `relay brief <<'EOF' … EOF`
  (it replaces the whole brief, so start from the current one).
- **Notes from Adam** arrive on their own: a hook adds them to your context after a tool call (at
  most every 30 s) or with his next message. When one arrives, act on it, and say so if it changes
  the plan. `relay notes` checks by hand.
- **Files** are recorded automatically: Write, Edit and NotebookEdit by a hook, and shell changes
  inside git repos by a sweep at `/close` and at session end. A file **outside git** changed by a
  shell command (sed, a heredoc, a script) is invisible to both: prefer Write/Edit for those, or
  log them with `relay file PATH…`.
- **Links and docs**: `relay link pr https://github.com/…/pull/12`, `relay link branch feature/x`,
  `relay doc /abs/path/SPEC.md --label "spec"`.
- `relay note "…"` adds to the activity log (your notes are marked as Claude's).

## 3. At the end of every phase (the handoff)

The end-of-phase handoff is four writes, then a status:

1. **Session entry**: what closed, with commits and PRs:
   `relay session --summary "…" --open-items "…" --commit <sha> --pr <url>`
2. **Brief update**: the brief says where things stand now and what the next phase starts from.
3. **Plain summary**: `relay summary "…"`, two to four sentences in plain English on the issue,
   what's been done and what happens next, for someone non-technical. No file names, branches,
   PRs, commands or jargon. The app's **Draft update** turns it into an email or Teams message.
   It replaces the last one, so write it as where things stand now.
4. **Status**: `relay wait "the one-line need from Adam"` when something needs him (UAT, a
   dashboard step, a decision); `relay later --next-step "…"` when it's parked; `relay done`
   when finished. At the end of the session `/close`, `/close later` or `/close wait` does the
   session entry and the status in one step.

Then tell Adam the kickoff for the next session: **`Continue KEY.`** (the phase's own key).

## Commands

| Command | What it does |
|---|---|
| `relay context` | What the SessionStart hook injects, for this folder |
| `relay find TEXT [--all] [--project KEY]` | Search IDs, aliases, Jira keys, titles and briefs |
| `relay get KEY [--all] [--peek]` | The handoff: brief, last 3 sessions (`--all`: every one), files by repo, docs, links, phases, the parent's plan, recent activity. Marks Adam's new notes seen unless `--peek` |
| `relay create TITLE [--project K] [--parent K] [--phase N] [--status S] [--need N] [--brief TEXT\|-] [--next-step S] [--type dev\|bug] [--no-attach]` | New ticket; the database assigns the ID |
| `relay type dev\|bug [--key K]` | Set the ticket's type |
| `relay summary TEXT…\|- [--key K]` | Replace the plain-English summary the app's Draft update reads |
| `relay attach KEY` | Attach this session to a ticket (the last one attached is the current one) |
| `relay brief [--key K] [--next-step S]` | Replace the brief with stdin |
| `relay session [--key K] --summary S [--open-items O] [--commit SHA]… [--pr URL]…` | Add to this session's entry |
| `relay note TEXT…\|-` | Add a note |
| `relay status S [--need N]`, `relay wait NEED…`, `relay later [--next-step S]`, `relay done` | Set the status (not on a parent) |
| `relay close done\|later\|wait [--summary S] [--need N] [--next-step S] [--open-items O] [--commit]… [--pr]…` | What /close runs: sweep, flush, session entry with closed_by, status |
| `relay archive [--undo]` | Hide the ticket now (or bring it back) |
| `relay delete KEY [--yes]` | Delete a ticket you created by mistake (no phases, under 24 hours old); otherwise archive |
| `relay project list`, `relay project create KEY --name N [--kind app\|jira] [--path DIR]…`, `relay project path KEY DIR [--remove]` | Projects (create and change only when Adam asks) |
| `relay move PROJECT`, `relay jira URL\|KEY`, `relay jira --remove` | File the ticket into a project or link it to a Jira issue (only when Adam asks). Several tickets may share one Jira issue |
| `relay link NAME [URL]`, `relay doc PATH [--label L]` | Links (empty URL removes one) and reference docs |
| `relay file PATH… [--kind shell]` | Log files changed outside Write/Edit and outside git |
| `relay notes` | Adam's unseen notes on the attached tickets (marks them seen) |
| `relay sweep`, `relay flush` | Log git-changed files now; send the local queue |
| `relay doctor` | psql, the database, this session's tickets and the queue |

Every command takes `--key KEY` to act on a ticket other than the current one, and `--session ID`
outside Claude Code. `create`, `project create`, `move`, `jira` and `delete` take `--dry-run`: every
check runs, nothing is saved. Use it to find out why a write fails, never a throwaway ticket.
Any text works in briefs, needs and notes, en dashes included.

## Rules the database enforces

A waiting ticket must have a need. A phase's parent has no parent and is in the same project. Jira
fields exist only on tickets in Jira projects, and Adam's apps never go into Jira. IDs are unique
across auto keys, Jira keys and aliases, except that several tickets may share one Jira key. `relay` reports these as "Relay refused this (rule)" or
"(that ID is taken)": fix the input rather than working around the rule.
