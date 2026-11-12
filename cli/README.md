# relay CLI

The command line and Claude Code hooks that keep Relay tickets up to date from Claude Code
sessions. One Python 3 file (`relay`), standard library only. Every database call runs `psql` as
the `claude_relay` role.

```
cli/
  relay                  the CLI and every hook entry point
  install.sh             installs into ~/.claude (re-runnable)
  skills/relay/SKILL.md  installed to ~/.claude/skills/relay/
  skills/close/SKILL.md  installed to ~/.claude/skills/close/  (/close, /close later, /close wait)
  claude-md-rule.md      the ticket rule, installed as a marked block in ~/.claude/CLAUDE.md
  hooks.json             the hooks merged into ~/.claude/settings.json (event, matcher, entry, timeout)
  tests/test_relay.py    unit tests (stdlib unittest)
```

## Install

```bash
cli/install.sh            # install or update
cli/install.sh --dry-run  # print the merged settings.json and CLAUDE.md; change nothing
```

`install.sh`:

1. reports what's missing: psql (with `brew install libpq && brew link --force libpq`) and the
   `~/.pgpass` line (with its format and `chmod 600`). It never writes a password;
2. copies `relay` to `~/.claude/relay/bin/relay` (temp file + rename), so nothing installed depends
   on a git checkout, and writes the skills and `hooks.json` beside the binary;
3. writes the ticket rule into `~/.claude/CLAUDE.md` between `<!-- relay:begin … -->` and
   `<!-- relay:end -->`, replacing an earlier block and keeping everything else;
4. copies `~/.claude/settings.json` to `~/.claude/backups/settings.json.pre-relay-<timestamp>`
   (`settings.json.relay-reinstall-<timestamp>` when Relay hooks are already in it),
   then merges the hooks in with one atomic replace. Other keys and other hooks are kept. Any
   earlier Relay hook (a command containing `/.claude/relay/bin/relay`) is replaced, so re-running
   doesn't duplicate them;
5. runs `relay doctor`. A FAIL there doesn't undo the install: the hooks stay silent until it's fixed.

Every path is resolved from `$HOME` at install time, so the same kit installs on any Mac. Running it
twice leaves `settings.json` and `CLAUDE.md` byte-identical.

## Install on another Mac

1. **psql.** `command -v psql`. If it's missing: `brew install libpq && brew link --force libpq`.
2. **The password line.** Add this line to `~/.pgpass`, with the `claude_relay` password in place of
   `<password>`, then `chmod 600 ~/.pgpass` (psql ignores a file others can read):

   ```
   aws-0-eu-central-1.pooler.supabase.com:5432:postgres:claude_relay.nxekrfdagkdwhjuunsrl:<password>
   ```

3. **The kit.** `git clone https://github.com/adamnc02/relay` anywhere, then run
   `relay/cli/install.sh`. The clone can be deleted afterwards: nothing installed points into it.
4. **Check.** `~/.claude/relay/bin/relay doctor` prints one PASS/FAIL line each for psql, the pgpass
   entry, a TCP connection to the pooler on 5432 (3 s timeout), the login, a read of
   `relay.projects`, the binary, the hooks in `settings.json`, the two skills and the CLAUDE.md
   block, and exits 1 if any fails. **`FAIL network`** usually means the network blocks outbound
   port 5432, which corporate networks often do. Try another network, such as a phone hotspot.
   Until it passes, every hook stays silent and sessions carry on normally.
5. **Folders.** `projects.paths` holds this Mac's folders, so on another machine sessions land in
   Inbox unless the folder matches. Map the local folders in `~/.claude/relay/paths.json`:

   ```json
   {
     "~/Code/relay": "RLY",
     "~/Code/data-sketch": "DSK"
   }
   ```

   Keys are folder prefixes (`~` allowed, matched on whole path components, longest wins) and values
   are project keys. This file is checked before `projects.paths`, for the folder and then for a
   worktree's main checkout. An entry naming an unknown or archived project is ignored. Its folders
   also count as the project's repos for the git snapshot.
6. **Start a new Claude Code session.** Running sessions keep the settings they started with.


The binary is in place before the settings file names it, so a session that reloads settings
half-way through an install never runs a hook that isn't there.

`RELAY_HOME` (default `~/.claude/relay`) and `CLAUDE_DIR` (default `~/.claude`) override the
locations.

## Connection

`host=aws-0-eu-central-1.pooler.supabase.com port=5432 dbname=postgres
user=claude_relay.nxekrfdagkdwhjuunsrl sslmode=require`, with the password from `~/.pgpass`
(`-w`: psql never prompts). `RELAY_CONNINFO` replaces the connection string and `RELAY_PSQL` the
psql binary. psql is found on `PATH`, then in the Homebrew and Postgres.app locations, because hooks
can run with a short `PATH`.

Every value is passed as a psql variable (`-v name=value`, used as `:'name'` in SQL read from
stdin). No value is ever put into SQL text. Calls run with `ON_ERROR_STOP`, in one transaction, and
with `VERBOSITY=verbose`, so the SQLSTATE comes back: `23514` (a rule, such as a waiting ticket with
no need or a phase in another project) is reported as "Relay refused this (rule)", and `23505` as
"(that ID is taken)".

What the CLI never writes: `events.id` (identity), `tickets.seq`/`auto_key` (assigned by the
database), or a parent ticket's `status`/`need` (rolled up from its children by a trigger;
`status`, `wait`, `done` and `later` refuse a parent). Its ticket writes set
`updated_by = 'claude:<session-id>'`; the SessionEnd hook's write sets `'hook:session-end'`.

## Commands

| Command | What it does |
|---|---|
| `context [--cwd DIR]` | The text the SessionStart hook injects (below) |
| `find TEXT… [--all] [--project KEY]` | IDs, aliases and Jira keys exactly; title and brief by substring. Board tickets only unless `--all` |
| `get KEY [--all] [--peek]` | Brief; the last 3 sessions (`--all`: every one); files grouped by repo or folder; docs; links; recent activity. A parent shows its plan and every phase's status, and a phase shows its parent's plan and its siblings. Inside a session it marks Adam's unseen notes on the ticket (and its parent) as seen and prints them first, unless `--peek` |
| `create TITLE [--project K] [--parent K] [--phase N] [--status S] [--need N] [--brief TEXT\|-] [--next-step S] [--no-attach]` | Inserts a ticket (status `progress` by default). The project is `--project`, else the parent's, else the working folder's, else `INB`. `--parent` without `--phase` takes the parent's next phase number. Attaches it to the session unless `--no-attach` |
| `attach KEY` | Records session → ticket locally, appends the session ID to `tickets.session_ids`, inserts the `sessions` row, clears `needs_wrapup`, snapshots the ticket's project repos, and flushes the queue |
| `brief [--key K] [--next-step S]` | Replaces the brief with stdin |
| `session [--key K] --summary S [--open-items O] [--commit SHA]… [--pr URL]…` | Upserts this session's row: the summary is appended, open items replaced, commits and PRs merged |
| `note TEXT…\|-` | Inserts an `events` note with actor `claude:<session-id>` |
| `status S [--need N] [--next-step S]`, `wait NEED…`, `later [--next-step S]`, `done` | Sets the status. Leaving `waiting` clears `need` |
| `close done\|later\|wait [--summary S] [--need N] [--next-step S] [--open-items O] [--commit]… [--pr]…` | Sweeps, flushes, upserts the session row with `ended_at` and `closed_by` (`close`, `close-later`, `close-wait`), sets the status (not on a parent), clears `needs_wrapup`, and marks the session closed locally |
| `archive [--undo]` | Sets or clears `archived_at` and logs an `archive` event |
| `link NAME [URL]` | Sets `links[NAME]` (an empty URL removes it) and logs a `link` event |
| `doc PATH [--label L]` | Upserts `ticket_docs` |
| `file PATH… [--kind shell\|write\|edit]` | Logs files now through `relay.log_file` (default kind `shell`) |
| `notes [--key K]` | Adam's unseen notes (actor `adam`, kind `note`, `seen_at` null) on the attached tickets: sets `seen_at` and prints them |
| `sweep` | Logs git-changed files since the snapshot (below) |
| `flush` | Sends the local queue |
| `doctor` | PASS/FAIL per check: psql, the pgpass entry, TCP to the pooler, login, a read of `relay.projects`, the binary, the hooks, the skills, the CLAUDE.md block. Then the paths.json overrides, session, tickets and queue length. Exits 1 on any FAIL |
| `setup --src DIR [--claude-dir D] [--bin PATH] [--dry-run]` | What `install.sh` runs |

Commands that act on a ticket default to the session's current ticket (the last one attached) and
take `--key KEY`. The session ID comes from `--session`, else `RELAY_SESSION_ID` (written by the
SessionStart hook to `CLAUDE_ENV_FILE`), else `CLAUDE_CODE_SESSION_ID` (set by Claude Code in the
Bash tool's environment).

## Hooks

Installed into `~/.claude/settings.json` as shell-form commands
(`/Users/…/.claude/relay/bin/relay hook <event>`).

| Event | Matcher | Entry | Time box (settings timeout) | Network | What it does |
|---|---|---|---|---|---|
| SessionStart | all | `hook session-start` | 4.5 s (10 s) | 1 query | Prints `additionalContext`: the context below. Writes `RELAY_SESSION_ID` to `CLAUDE_ENV_FILE`. Starts the background worker to snapshot the repos and flush the queue |
| PostToolUse | `Write\|Edit\|NotebookEdit` | `hook file` | 1.5 s (5 s) | none | Appends one job to the queue (path, `write` for Write, `edit` for Edit/NotebookEdit, session, time) and the path to the session's `.paths` file. Skips files under the session's scratchpad |
| PostToolUse | `*` | `hook post-tool` | 4 s (10 s) | ≤ 2 queries, at most every 30 s | If the session has a ticket: unseen notes as `additionalContext` (shown to Claude next to the tool result), then snapshots any new repo the session edited and flushes the queue |
| UserPromptSubmit | — | `hook prompt` | 6 s (10 s) | ≤ 3 queries | Unseen notes as `additionalContext`. A prompt starting `Continue KEY` also attaches KEY and injects its `get` output (marking its notes seen) |
| SessionEnd | all | `hook session-end` | 1 s (10 s) | none | If the session has a ticket and wasn't closed with `relay close`: queues a session-end job holding the last assistant message from the transcript. Starts the background worker to sweep and flush |

The background worker (`hook bg`) runs fully detached (`start_new_session`), with a 60 s time box,
so it outlives the hook and the session, including `claude -p`.

The session-end job sets `needs_wrapup = true` (`updated_by = 'hook:session-end'`), adds a note
with actor `hook:session-end` ("Session … ended without /close (reason). Last message: …", up to
4,000 characters), and upserts the session row with `ended_at` and `closed_by = 'session-end'`. It
never changes the status.

**Context** (SessionStart, `relay context`): the project the working folder matches (an entry in
`~/.claude/relay/paths.json`, else the longest `projects.paths` prefix on whole path components; a linked git worktree also matches through its
main checkout's folder; else Inbox), then any **closed-without-wrap-up** tickets for that project
or last worked from that folder, then the project's open tickets (parents with their phases), then
everything **Waiting for me** in other projects, then the ticket rule. It is cut to 9,500
characters (Claude Code's limit is 10,000).

### Failure behaviour

- Every hook runs under a `SIGALRM` time box well inside its settings timeout, and psql gets
  `connect_timeout` and a subprocess timeout from what's left.
- Hook output is buffered and written only when the hook finishes cleanly. On any error or timeout
  it prints nothing, writes nothing to stderr, and exits 0. Errors go to `~/.claude/relay/log/relay.log`.
- File jobs and session-end jobs wait in the queue until Relay is reachable. Any later hook or
  command flushes them.
- After a failed note check, PostToolUse backs off for 120 s instead of 30 s.
- Sessions with no ticket cost no network calls: post-tool, prompt and session-end return straight
  away.
- Measured cost of the local-only paths (file, post-tool when throttled, prompt with no ticket,
  session-end): about 35 ms each. SessionStart: about 0.35 s.

## Local state (`~/.claude/relay/`)

| Path | What |
|---|---|
| `bin/relay` | The installed CLI |
| `bin/hooks.json` | The installed hook list (`relay doctor` checks settings.json against it) |
| `paths.json` | Optional: this machine's folder prefix → project key overrides |
| `sessions/<id>.json` | Session → tickets (the last is current), cwd, `closed`, `ended`, and the git snapshot per repo |
| `sessions/<id>.paths` | Paths the session changed with Write/Edit/NotebookEdit (the sweep skips them) |
| `sessions/<id>.check` | mtime = the last note check (set in the future while backing off) |
| `sessions/<id>.lock` | flock for read-modify-write of the state file |
| `queue/*.json` | One job per file, written with temp file + rename and sent oldest first. `queue/.lock` lets only one flusher run at a time |
| `log/relay.log` | Hook and flush errors (rotated at 1 MB) |

Queued file jobs of a session that has not attached a ticket are attributed to the first ticket it
attaches. They are dropped when that session ends with no ticket, or after 2 days. Session files
are pruned after 30 days. A job the database rejects (a SQLSTATE) is dropped and logged. A network
failure keeps it.

## The git sweep

The snapshot records, per repo, `HEAD` and every `git status --porcelain -uall` entry with its
mtime. It covers the session's working-folder repo and the repos in the matched project's paths
(SessionStart), the attached ticket's project repos (`attach`), and any repo the session edits with
Write/Edit (post-tool). The sweep (`relay sweep`, `relay close`, SessionEnd) logs, as `shell`,
every file that is newly dirty or whose status or mtime changed, that went from dirty to clean, or
that appears in a non-merge commit made since the snapshot. It skips files the session already
logged as write/edit, and repos with more than 300 changed files (a checkout or pull, not edits).
Each sweep re-baselines the snapshot, so a file isn't logged twice.

## Traps

- **Concurrent sessions in one repo**: the sweep can't tell whose shell edit a dirty file was, so
  each session's sweep logs files the other changed with shell commands. Write/Edit attribution is
  exact.
- **Files outside git changed by a shell command** are invisible to both mechanisms: use Write/Edit,
  or `relay file PATH`.
- **SessionEnd's default budget is 1.5 s.** The per-hook `timeout` of 10 raises it, but the hook does
  no network work anyway: the detached worker does.
- **A note reaches an idle session only with its next prompt.** Mid-task, it arrives with the next
  tool result at most 30 s after the last check.
- **Untyped psql literals**: `text[] || :'v'` parses the value as an array literal, and a cast
  like `:'v'::smallint` in an unreached `CASE` branch is still constant-folded. Write
  `:'v'::text` and `nullif(:'v', '')::type`.
- In `claude -p`, the Bash tool refuses a bare `sleep N`; the hook tests use a Python sleep.

## Tests

```bash
python3 -m unittest discover -s cli/tests -v
```

They cover path matching (whole components, longest prefix, archived, spaces, worktrees), the
queue (order, atomic writes, corrupt files, the flush plan, the lock), the git sweep (shell edits,
creates and deletes, a file that was dirty before, commits, re-baselining, Write/Edit exclusion),
transcript parsing, context formatting and its cap, the settings and CLAUDE.md merges
(idempotent, other keys kept), and that every hook exits 0 silently, within its time box, with the
database unreachable or hung.
