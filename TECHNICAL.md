# Relay: technical notes

## Structure

No build step. GitHub Pages serves `main` at the repo root under `/relay/`, so every URL in the app is relative (`./js/app.js`, `./sw.js`) and the manifest's `start_url`, `scope` and `id` are `/relay/`. `.nojekyll` stops Pages from running Jekyll.

```
index.html            shell: rail, bars, list/board outlet, gate, drawer/modal/toast hosts
app.css               tokens (light + dark), layout and components
js/app.js             UI: render, ticket panel, actions, auth gate, boot, sync
js/store.js           in-memory tables + the offline snapshot
js/model.js           statuses, rollup rule, 14-day rule, Jira parsing, labels
js/markdown.js        safe markdown subset for briefs
js/icons.js           Handoff mark, status icons
js/config.js          Supabase URL + publishable key (public), schema, redirect target
js/push.js            push seam (not active)
js/data/index.js      picks the adapter: ?demo → demo, otherwise supabase
js/data/demo.js       in-memory adapter that mimics the database triggers
js/data/sample.js     sample data for ?demo
js/data/supabase.js   PostgREST + Realtime adapter for the relay schema
vendor/               supabase-js 2.116.0 UMD build (exposes window.supabase)
sw.js                 service worker
```

## Data layer

The UI talks to one adapter object. Both adapters implement:

- `start()` → `{ state, user?, message?, authNote? }`
- `signIn()`, `signOut()`, `onAuthChange?(cb)`
- `loadAll()` → rows of `projects`, `tickets`, `events`, `sessions`, `ticket_files`, `ticket_docs`
- `subscribe(onChange, onStatus)` → unsubscribe
- `insertProject`, `insertTicket`, `updateTicket(id, patch, { prevParentId })`, `insertEvent`

Every write resolves to a list of changes `{ table, type, row, old? }`, which the store applies by primary key. Realtime delivers the same shape, so a change that arrives twice (once from the write's response, once from Realtime) lands once.

Rows keep their database shape everywhere: the UI reads `auto_key`, `display_key`, `parent_id`, `phase`, `need`, `brief`, `links`, `archived_at`, `done_at` and so on directly.

### What the database owns

The UI never writes these; the database computes them and the adapter returns the result:

- `seq`, `auto_key` (`KEY-n`, or `KEY-Rn` in a Jira project), `display_key`
- `done_at` (set on entering done, cleared on leaving it)
- a parent's `status` and `need` (rolled up from its children)
- `status` events in `events`
- `updated_by` (forced to `adam` for the signed-in user)
- moving a ticket to another project re-keys it there, keeps the old ID in `aliases`, and moves its children with it

The UI writes `note`, `parent`, `archive` and `id` events itself.

Write errors are shown through `friendlyError()` in `js/model.js`: the `relay:` prefix of trigger messages is dropped, a 23505 ID clash and a 23514 rule violation (including the waiting-needs-a-need check) become plain sentences, and a network failure says nothing was saved.

The supabase adapter strips `id`, `seq`, `auto_key`, `display_key`, `created_at`, `updated_at` and `done_at` from every update, and after each write refetches the ticket, its parent (old and new), their children and their recent events, so the rollup is visible even if Realtime is down.

### Demo adapter

`?demo` uses `js/data/demo.js`: no network, no sign-in, no storage of edits. It reproduces the database rules: ID assignment, re-keying on a project move, `done_at`, the parent rollup, status events, the waiting-needs-a-need check, Jira fields only in Jira projects, the parent rules (same project, one level, not itself) and ID uniqueness across `auto_key`, `jira_key` and `aliases`. The rollup itself is `rollup()` in `js/model.js`:

waiting if any child waits (need = the first waiting child's need, by phase) → progress if any child is in progress or testing → done if all are done → next if any is next or done → backlog.

## Auth and app states

🚨 **The session is Relay's own.** The client sets `auth.storageKey: 'relay.auth'`. Every app on `adamnc02.github.io` shares one origin and this Supabase project, so the default key (`sb-<ref>-auth-token`) would make Relay read and refresh Listly's session. Refresh-token rotation then invalidates the other app's copy. Sign-out uses `scope: 'local'`, because the default `global` scope revokes every session of the account in every app on every device.

Google sign-in with `signInWithOAuth({ provider: 'google', options: { redirectTo } })`. `redirectTo` is derived from the page: origin plus the page's directory, never the query or fragment (`https://adamnc02.github.io/relay/` live, `http://localhost:8000/relay/` locally). Each target must be in Supabase → Authentication → URL Configuration → Redirect URLs, or Supabase silently falls back to the project's Site URL. Before redirecting, the attempt is recorded in `sessionStorage` (`relay:auth:attempt`); landing back without a session shows which address to check. A leftover `#access_token` fragment is cleared from the address bar.

`start()` resolves to one of these states, each with its own screen:

| State | Cause | Screen |
|---|---|---|
| `signed-out` | no session | Google button, link to the demo |
| `not-exposed` | PGRST106 on the smoke test | add `relay` in Project Settings → API → Exposed schemas |
| `not-setup` | PGRST205 / PGRST202 / 42P01 / 42883 / 3F000 | the schema or its tables are missing |
| `not-owner` | `relay.is_owner()` is false, or no projects visible | "This Google account isn't Relay's owner", with sign out |
| `offline` | network failure | the saved copy, read-only |
| `ready` | owner, schema reachable | the board |

The smoke test is a real `select id from projects limit 1` through the client (`db.schema = 'relay'`), followed by `rpc('is_owner')`.

## Realtime

One channel, `relay-board`, with a `postgres_changes` listener per table (`schema: 'relay'`, `event: '*'`). Each payload is applied to the store and the screen re-renders; an open ticket panel keeps the note being typed, the Jira field, focus and scroll position. When the channel recovers from `CHANNEL_ERROR` / `TIMED_OUT` the app reloads everything once. It also reloads when the page becomes visible again.

## View defaults

- The app opens on **Board**. A List/Board choice is remembered in `localStorage` `relay-view-2`. The key changed when the default became Board, so a List choice saved under the earlier key `relay-view` is ignored.
- The rail lists Waiting for me, All tickets and Archived, then **Jira**, then **Apps**. Both headings fold. Apps starts folded and Jira starts open. The state is kept in `relay-rail-fold`. A folded section still lists the project currently being viewed, and shows its open-ticket total beside the heading.

## Phone layout (max-width 760px)

- The rail becomes a slide-in drawer opened from the menu button. A centred **brand row** (the Handoff mark and "Relay") sits above the toolbar, because the rail's own brand isn't visible.
- 🚨 **The document scrolls, not an inner panel.** The brand row, toolbar and search form one sticky header (`.phead`, padded by the top safe-area inset). iOS draws its blur under the status bar according to the page's own scroll position, so it only appears once content moves beneath it. With an inner scroller (the desktop layout) the page never scrolls, and iOS showed the blur over the header at rest.
- The header gains a soft shadow (`.phead.scrolled`) only once the content has scrolled. This uses the window scroll on a phone and `#out` on desktop.
- The **board stacks its six columns** in one vertical scroll, with no sideways scrolling. An empty column shrinks to its heading. Drag and drop is for desktop; on a phone, status changes from the ticket panel.

## Offline

After every load and change the store is saved to `localStorage` (`relay:snapshot:v1`, debounced, wrapped in try/catch). If the network is down at start, the app loads that copy, shows an "Offline" strip with the copy's age, and disables every write. The `online` event retries. Sign-out clears the copy.

## Service worker

`sw.js`, scope `/relay/`.

- Cache name `relay-shell-<VERSION>`; bump `VERSION` when the shell file list changes. Old `relay-shell-*` caches are deleted on activate.
- Install precaches the shell (HTML, CSS, every module, the vendored client, icons).
- Same-origin GETs are network-first with `cache: 'no-cache'`, so a new deploy is picked up on the next load; the cache answers only when the network fails. Navigations fall back to the cached `index.html`, which also serves `?demo` offline.
- Cross-origin requests (the Supabase API, Realtime, Google Fonts) are never intercepted or cached. The only row data on the device is the app's own snapshot.

Push (`push` / `notificationclick` handlers and `js/push.js`) is not active.

## Markdown

Briefs are rendered by `js/markdown.js`. All text is HTML-escaped first; the renderer then produces only headings, paragraphs, bullet and numbered lists, fenced code, inline code, bold, italic and links. Links are kept only for `http:`, `https:` and `mailto:`, and open in a new tab with `rel="noopener noreferrer"`. Link URLs in `links` jsonb follow the same rule.

## Jira

- Jira fields exist only on tickets in projects with `kind = 'jira'`; app tickets never show them.
- A pasted URL's key is found in `?selectedIssue=KEY-1`, `/browse/KEY-1` or anywhere in the URL. A bare key gets its link from the project's `jira_base` or the last pasted Jira origin (`localStorage` `relay:jira-base`).
- Pasting a Jira issue URL into search and pressing Enter opens the ticket with that key, or creates one in that Jira project, creating the project (`kind 'jira'`, colour `#64748B`, `jira_base` from the URL) if it doesn't exist. A key whose prefix is an app project is refused.
- A Relay project key must match `^[A-Z][A-Z0-9]{1,9}$`, but a Jira prefix may contain `_` or be longer. `jiraProjectKey()` maps it (drop non-alphanumerics, cut to 10), so `DATA_PLATFORM_X-7` lands in project `DATAPLATFO`, named `DATA_PLATFORM_X`. The ticket's `jira_key` keeps the `_`.
- Linking a key from another Jira project moves the ticket there (and its phases with it). A phase can't move on its own.

## Icons

`icon.svg` is the master (Handoff: `#2A5BD7` tile, white chevron, `#FFAD5C` chevron, rx 112 on 512). `favicon.svg` is the same mark full-bleed. PNGs are rendered from the SVG in headless Chromium: `icon-192.png` (rounded, transparent corners), `icon-512.png` (full-bleed square, `any maskable`, mark inside the 80% safe zone), `apple-touch-icon.png` (180, full-bleed, opaque), `favicon-32.png` (full-bleed, opaque).

## Traps

- **Enter that opens the panel also closes it.** The panel focuses its close button on open; without `preventDefault()` on the keydown, Chromium delivers the same Enter to that button. Both Enter handlers (search, focused row) prevent the default.
- **Board columns sized to their text.** `min-width: max-content` on the board grid makes every `minmax(232px, 1fr)` column as wide as its longest unwrapped title (over 500px). The board's min-width is the six 232px minimums plus gaps instead.
- **Duplicate element IDs in dialogs.** A modal field with id `m-title` collided with the modal heading; the heading is `m-heading`.
- **`crypto.randomUUID` needs a secure context.** It is missing on LAN http, so `uuid()` in `js/model.js` falls back to `getRandomValues`.
- **Stale modules.** Serve locally with `Cache-Control: no-store`; the service worker itself fetches with `cache: 'no-cache'`.
- **Headless drag and drop.** Playwright's one-shot `dragTo` can start the drag on the wrong card; driving the mouse in steps works. Columns off-screen at 1280px need a wider viewport in tests.
