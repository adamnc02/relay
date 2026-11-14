# Relay

Relay is a single-user projects board: a grouped list and a kanban board of tickets that Claude Code sessions keep up to date. Each ticket carries its own handoff (brief, session log, files touched, reference docs), and a ticket that needs the owner shows as **Waiting for me**.

- Live: https://adamnc02.github.io/relay/
- Demo (sample data, no sign-in, nothing saved): https://adamnc02.github.io/relay/?demo

## Screens

**Sign-in.** Google only. A Google account other than the owner's sees "This Google account isn't Relay's owner". If the database isn't reachable through the API yet, the app shows "Relay isn't set up yet". Offline with no saved copy, it shows "You're offline".

**Layout.** On a computer the rail sits on a soft background beside one white panel holding the list or board. An open ticket docks as a second panel beside it on screens wider than 1100px, slides over the list between 761px and 1100px, and opens as a bottom sheet on a phone.

**The rail** (on a phone, behind the menu button) holds, top to bottom:
- The Relay mark and a **collapse** button. Collapsed, the rail is a column of icons: Waiting for me (with its count as a badge), All tickets, Archived, one coloured square per project (its name on hover), Skills, Notifications and your avatar. The expand button, or the `[` key, brings it back. The choice is remembered.
- **Search or jump to…** (also `/` or `Cmd`/`Ctrl`+`K`): a search box over the page. It matches Relay IDs, Jira IDs, old IDs (aliases) and titles; arrow keys move through the results and Enter opens one. Enter on an exact ID opens that ticket. Pasting a Jira issue URL and pressing Enter opens or creates that ticket in its Jira project.
- **Waiting for me**, **All tickets** and **Archived**. Every count in the rail is of open tickets (not Done, not archived), except Archived, which counts what that view shows.
- The projects, in sections you arrange yourself (**Projects and groups**, below). Each section folds; a folded section still shows the project you're viewing. The pencil beside a section's heading opens Projects and groups. The **Inbox** is always last, on its own.
- **Skills** (also the `?` key): the commands a Claude Code session answers to (`Continue KEY.`, `/relay`, `/close`, `/close later`, `/close wait`), each with a Copy button. The `/close wait` row shows a ready-to-send example built from the open ticket's need (or the latest one), and its Copy button copies that.
- **Notifications** (see below), then your name, the running version ("v15") and a **…** menu: **Appearance** (Light, Dark or System, remembered on the device), **Projects and groups**, **Notifications** and **Sign out**.

On a phone the rail stays open while you choose views, so the screen changes behind it; close it with the menu button at its top or by tapping outside it.

**The header** has the view's title and count, **List** / **Board**, and **New ticket** (on a phone, a floating **New ticket** button). The app opens on **List**; a List or Board choice is remembered.
- **List**: the tickets **Waiting for me** come first, as cards with the need, **I've done this** (moves the ticket to In progress and logs a note) and **Change**; on a phone the cards scroll sideways. Then the other tickets in collapsible groups by status (In progress, Testing, Up next, Backlog, Done). A parent shows its phases nested under it, with a progress bar. A bug has a bug icon before its title.
- **Board** has one column per status: Backlog, Up next, In progress, Waiting for me, Testing, Done. Each column but Waiting and Done has a **+** that makes a ticket already in that status. Phases appear as their own cards; a parent has no card of its own. A card whose ticket has a Claude session running shows "Session live". On a computer a card can be dragged between columns. All six columns fit on a 1280px-wide screen with the rail open. On a phone the columns stack.
- **Pull to refresh**: on a touch screen, pull the List or Board down from the top to reload everything and reconnect live updates. In the Home Screen app this is the only way to refresh.
- A ticket whose last session ended without `/close` is flagged "Closed without wrap-up".
- Done tickets leave the board 14 days after they were done. Archived tickets leave it at once.

**The ticket panel** opens from any card, row or search result:
- The header: project, ID (a Jira ticket's key links to Jira), **Copy link** (copies a `?t=KEY` link to the ticket), **Draft update**, **Previous** / **Next** (through the tickets in the order the list or board shows them), **…** and **Close**. The **…** menu has Rename, Move to project, Set parent, Archive / Unarchive and, for Jira projects and the Inbox, Link Jira issue and Remove Jira link.
- The title (tap to rename). In Waiting for me: **What I need from you**, with **I've done this** and **Change**. A waiting parent links to the phase that is waiting.
- **Status** (a parent's is set by its phases), **Type** (Dev or Bug), **Project** (move the ticket into another project, or **New project…**; a phase moves only with its parent), **Parent** (put the ticket under a parent from the same project as one of its phases), **Branch**, **PR**, **Updated**, and for Jira projects and the Inbox the **Jira** link and the **Relay ID**. Linking a Jira issue to an Inbox ticket moves it into that Jira project.
- **Pick up in a new session**: the kickoff line (`Continue KEY.`) with **Copy**.
- A parent's **Phases**, with progress and **Add phase**.
- Tabs (on a phone, sections one under another): **Brief** (a parent's is the **Plan**, with **Next step** when the brief doesn't already contain it), **Sessions** (newest first), **Files** (grouped by repo, each with **Copy path**; a parent's include all its phases), **Links** (reference docs and links) and **Activity** (status changes, notes and session events; each note from the owner shows "Not picked up yet" until a session reads it, then "✓ Seen by session"). The last tab you chose is remembered.
- **Note to Claude**, at the bottom: a running session on this ticket gets the note at its next step, otherwise the next session to open the ticket reads it first.

**Draft update** writes an email or a Teams message about the ticket in plain English, from the ticket's plain-English summary, which Claude sessions keep up to date. The email has a subject and a greeting; the Teams message is shorter, with neither. Edit the text, then **Copy**: nothing is saved or sent. A ticket with no summary yet says so, and names the command that writes one.

**Projects and groups** (from the account menu, or the pencil beside a rail section) arranges the rail. Each group is a section of the rail, in order; drag a group by its handle, or a project within or between groups, to reorder. Click a project's name to rename it (it shows as `KEY - Name` in pickers and search), click its colour square to change the colour, and pick its group from the menu. **New group** adds one; deleting a group that has projects asks where they go. A project's kind (Jira or app) doesn't change with its group. A Jira project created from a pasted link takes its key as its name, and its toast offers **Rename**.

Changes made by Claude sessions appear live, without a refresh.

The demo uses the board's real projects, a sample Jira project and sample tickets.

## Notifications

Relay can notify a device when a ticket moves to **Waiting for me**: the ticket's ID and title, with the need underneath. Tapping it opens the ticket, over anything else that is open. On iPhone, tapping a notification while Relay is already open in front does nothing: iOS doesn't pass that tap on. The ticket is in **Waiting for me**.

Turn it on from **Notifications** in the rail or the account menu (on a phone, in the menu): **Turn on**, then **Send test**. On iPhone and iPad this works only in Relay installed on the Home Screen (Safari → Share → Add to Home Screen) and opened from its icon. Each device is turned on separately. Signing out turns notifications off for that device. The demo shows the control but can't turn it on.

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
| `index.html`, `app.css` | The app shell (with the theme bootstrap) and all styles |
| `js/` | ES modules: UI, store, model, markdown, icons, data adapters |
| `vendor/supabase-js-2.116.0.umd.js` | Pinned supabase-js browser build |
| `sw.js`, `manifest.webmanifest` | Service worker and PWA manifest |
| `icon.svg`, `favicon.svg`, `*.png` | The Handoff icon and its exports |

See `TECHNICAL.md` for how it works.

## Claude Code integration

`cli/` holds the `relay` command, the Claude Code hooks and skills that keep tickets up to date, and the installer. It runs on macOS and native Windows. See `cli/README.md`.
