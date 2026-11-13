# Relay

Relay is a single-user projects board: a grouped list and a kanban board of tickets that Claude Code sessions keep up to date. Each ticket carries its own handoff (brief, session log, files touched, reference docs), and a ticket that needs the owner shows as **Waiting for me**.

- Live: https://adamnc02.github.io/relay/
- Demo (sample data, no sign-in, nothing saved): https://adamnc02.github.io/relay/?demo

## Screens

**Sign-in.** Google only. A Google account other than the owner's sees "This Google account isn't Relay's owner". If the database isn't reachable through the API yet, the app shows "Relay isn't set up yet". Offline with no saved copy, it shows "You're offline".

**The rail** (on a phone, behind the menu button) holds the views and the projects, with the current one highlighted. On a phone it stays open while you choose views, so the board changes behind it; close it with the menu button at its top or by tapping outside it. It holds:
- **Waiting for me**: every ticket that needs the owner, each with its one-line need.
- **All tickets**, and **Archived** (archived tickets only).
- **Apps**: one row per app project. **Jira**: one row per Jira project, empty until a Jira issue is pasted.
- **Notifications** (see below) and the account footer with Sign out.
- The running version in small text at the bottom ("Relay v10"), to check a device has the latest release.

**The toolbar** has search, **List** / **Board** and **+ New**.
- Search matches Relay IDs, Jira IDs, old IDs (aliases) and titles. Enter on an exact ID opens that ticket. Pasting a Jira issue URL and pressing Enter opens or creates that ticket in its Jira project.
- **List** groups tickets by status, in collapsible groups, and nests each parent's phases under it with a progress bar.
- **Board** has one column per status: Backlog, Up next, In progress, Waiting for me, Testing, Done. Phases appear as their own cards; a parent has no card of its own. On desktop a card can be dragged between columns. All six columns fit on a 1280px-wide screen.
- **Pull to refresh**: on a touch screen, pull the List or Board down from the top to reload everything and reconnect live updates. In the Home Screen app this is the only way to refresh.
- A ticket whose last session ended without `/close` is flagged "Closed without wrap-up".
- Done tickets leave the board 14 days after they were done. Archived tickets leave it at once.

**The ticket panel** opens from any card or row:
- ID (a Jira ticket's key links to Jira), title (tap to rename), project, and the parent if it's a phase.
- **Project**: move the ticket into another project, or **+ New project…** to make one. A ticket no project fitted lands in the Inbox until you file it. A phase moves only with its parent.
- **Status**, which a parent doesn't have: it shows "Set by its phases". **Parent**: put the ticket under a parent from the same project as one of its phases. **Archive** / **Unarchive**.
- In Waiting for me: **What I need from you**, with **I've done this** (moves the ticket to In progress and logs a note) and **Change**. A waiting parent links to the phase that is waiting.
- Jira projects and the Inbox: the Relay ID, the Jira link or key, and the ID it's shown as. Linking a Jira issue to an Inbox ticket moves it into that Jira project.
- **Pick up in a new session**: the kickoff line (`Continue KEY.`) with **Copy**.
- A parent's **Phases**, with progress and **+ Add phase**.
- **Brief** (a parent's is the **Plan**), rendered markdown. **Next step**, when the brief doesn't already contain it.
- **Sessions**, newest first. **Files touched**, grouped by repo, each with **Copy path** (a parent's include all its phases). **Reference docs** and **Links**.
- **Note to Claude**: a running session on this ticket gets the note at its next step, otherwise the next session to open the ticket reads it first.
- **Activity**: status changes, notes and session events. Each note from the owner shows "Not picked up yet" until a session reads it, then "✓ Seen by session".

Changes made by Claude sessions appear live, without a refresh.

The demo uses the board's real projects with sample tickets.

## Notifications

Relay can notify a device when a ticket moves to **Waiting for me**: the ticket's ID and title, with the need underneath. Tapping it opens the ticket, over anything else that is open. On iPhone, tapping a notification while Relay is already open in front does nothing: iOS doesn't pass that tap on. The ticket is in **Waiting for me**.

Turn it on from **Notifications** in the rail (on a phone, in the menu): **Turn on**, then **Send test**. On iPhone and iPad this works only in Relay installed on the Home Screen (Safari → Share → Add to Home Screen) and opened from its icon. Each device is turned on separately. Signing out turns notifications off for that device. The demo shows the control but can't turn it on.

A link of the form `https://adamnc02.github.io/relay/?t=KEY` opens the board with ticket KEY open.

## Run locally

There is no build step. The files at the repo root are what GitHub Pages serves.

Serve the repo under a `/relay/` path with caching disabled, so the base path is exercised and no stale module is ever served:

```sh
cat > /tmp/relay-serve.py <<'PY'
import http.server, os, sys
ROOT = sys.argv[1]
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.webmanifest': 'application/manifest+json', '.js': 'text/javascript'}
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.startswith('/relay/'): p = p[len('/relay'):]
        return os.path.join(ROOT, p.lstrip('/'))
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
http.server.ThreadingHTTPServer(('0.0.0.0', 8000), H).serve_forever()
PY
python3 /tmp/relay-serve.py "$PWD"
```

Then open:

- http://localhost:8000/relay/?demo for the demo
- http://localhost:8000/relay/ for the real app (Google sign-in returns to this address, which is in the Supabase redirect allow-list)

## Files

| Path | What it is |
|---|---|
| `index.html`, `app.css` | The app shell and all styles |
| `js/` | ES modules: UI, store, model, markdown, icons, data adapters |
| `vendor/supabase-js-2.116.0.umd.js` | Pinned supabase-js browser build |
| `sw.js`, `manifest.webmanifest` | Service worker and PWA manifest |
| `icon.svg`, `favicon.svg`, `*.png` | The Handoff icon and its exports |

See `TECHNICAL.md` for how it works.

## Claude Code integration

`cli/` holds the `relay` command, the Claude Code hooks and skills that keep tickets up to date, and the installer. It runs on macOS and native Windows. See `cli/README.md`.
