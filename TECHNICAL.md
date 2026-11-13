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
js/config.js          Supabase URL + publishable key (public), schema, redirect target, VAPID public key
js/push.js            Web Push: state, turn on/off, send test, forget on sign-out
js/data/index.js      picks the adapter: ?demo → demo, otherwise supabase
js/data/demo.js       in-memory adapter that mimics the database triggers
js/data/sample.js     sample data for ?demo (the real projects, fictional tickets)
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
- `savePushSubscription(row)`, `hasPushSubscription(endpoint)`, `deletePushSubscription(endpoint)`, `sendTestPush(endpoint)` (the demo adapter refuses the writes and reports no subscription)

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

`startLive()` opens the channel; each call replaces the previous one, and status reports from a replaced channel are ignored.

## Pull to refresh

Pulling down on the List or Board (touch only) shows a strip under the header (`#ptr`) that opens with the pull: "Pull to refresh", then "Release to refresh" once it is 64px tall (half the finger's travel, capped at 110px). Releasing past that shows "Refreshing…" for at least 450ms while the app replaces the Realtime channel (`startLive()`) and reloads everything (`refresh()`). Offline (read-only) it retries the connection like the offline strip's Retry. On `?demo` it re-renders.

- It arms only when the touch starts in the main pane with the page at the top (`window.scrollY` and `#out.scrollTop` both 0), and with no ticket panel, modal or phone rail open.
- A sideways move before the pull starts (scrolling the board on a tablet) or an upward one disarms it, so it never takes a horizontal scroll.
- It listens to touch events only, so desktop mouse drag and drop is never affected.
- Once pulling, `touchmove` is `preventDefault`ed (a non-passive listener), which stops the browser's own overscroll and its native pull to refresh.

## View defaults

- The app opens on **Board**. A List/Board choice is remembered in `localStorage` `relay-view-2`. The key changed when the default became Board, so a List choice saved under the earlier key `relay-view` is ignored.
- Exactly one rail item (the current view: Waiting for me, All tickets, Archived or a project) is marked `aria-current="true"` and filled with `--rail-sel`: a light, near-white pill in both themes. In dark mode its text and count switch to dark ink (`--rail-sel-ink`, `--rail-sel-muted`) so they stay readable on the light fill.
- The rail lists Waiting for me, All tickets and Archived, then **Jira**, then **Apps**. Both headings fold. Apps starts folded and Jira starts open. The state is kept in `relay-rail-fold`. A folded section still lists the project currently being viewed, and shows its open-ticket total beside the heading.
- **Version.** The rail's last line (`#sidever`) reads "Relay <VERSION>", the running service worker's `VERSION`, asked for with a `{ type: 'relay:version' }` message on a `MessageChannel`. A worker without that reply is read from the newest `relay-shell-*` cache name. It refreshes on `controllerchange`. It waits at most 3 s for `serviceWorker.ready` (which never settles when no worker is registered) and 2 s for the reply; the cache fallback sorts by the number in the name. No version found: the line is hidden.

## Phone layout (max-width 760px)

- The rail becomes a slide-in drawer opened from the menu button. Choosing a view in it leaves it open: the highlight moves and the board behind it updates. It closes with the menu button at the top of the drawer (`#railclose`; the toolbar's own is under the drawer), a tap on the scrim, or Escape. **Notifications** closes it, because it opens a panel.
- A centred **brand row** (the Handoff mark and "Relay") sits above the toolbar, because the rail's own brand isn't visible.
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
- **Fonts.** IBM Plex comes from Google Fonts and is kept in its own cache, `relay-fonts`, which isn't versioned and survives a `VERSION` bump. The stylesheet (`fonts.googleapis.com`) is network-first; the font files (`fonts.gstatic.com`, versioned URLs) are cache-first. Both are requested with CORS (the stylesheet `<link>` and its preconnect carry `crossorigin`), and only `cors` responses are stored, never opaque ones.
- Every other cross-origin request (the Supabase API, Realtime) is never intercepted or cached. The only row data on the device is the app's own snapshot.

- `push` shows the notification the `relay-push` Edge Function sent (`{ title, body, tag, url }`). It always shows one, even for an unreadable payload (title "Relay"), because iOS penalises a push that shows nothing. It also hands every push to the page for an in-app banner (see "A push while Relay is in front"; it doesn't show on the iPhone).
- `message` `{ type: 'relay:version' }` replies on the message's port with `{ version: VERSION }`.
- `notificationclick` closes the notification, writes `{ url, at }` to Cache Storage (`relay-open-intent`, key `__open-intent`), then focuses an open Relay window and posts `{ type: 'relay:open', url }` to it, or opens a new window at the URL. A URL outside the worker's scope is replaced by the scope.

## Push notifications

A notification arrives when a ticket enters **Waiting for me**. The server side is in `silver-octo-invention`: migration `20261112220000_relay_push.sql` (a trigger on `relay.tickets` queues the push in `relay.push_outbox`; never for a parent, whose status is rolled up) and the Edge Function `relay-push`, called every minute by pg_cron while something is queued. See that repo's `docs/relay-SUPABASE.md` → Push.

- **Notification.** Title `<display key> <title>`, body the ticket's need, URL `https://adamnc02.github.io/relay/?t=<display key>`, tag `relay:<ticket id>` (a later entry of the same ticket replaces the earlier notification).
- **The control.** The rail's **Notifications** row (above the account footer; in the phone drawer) shows On, Off, Blocked or Demo, and opens a panel with Turn on / Turn off, Send test (when on) and the iPhone rule. States from `pushState()`: `demo`, `needs-home-screen` (iOS outside a Home Screen app), `unsupported`, `blocked` (permission denied), `on` (a subscription in this browser **and** its row on the server), `off`, `unknown` (the server check failed).
- **Turn on** asks for permission first (iOS shows the prompt only from a tap), subscribes with `VAPID_PUBLIC_KEY` from `js/config.js` (the project's key pair; the function signs with the matching private key), and upserts `{ endpoint, p256dh, auth_key, user_agent, failed_count: 0 }` into `relay.push_subscriptions` on `endpoint`. A subscription made with a different key is replaced.
- **Turn off** deletes this device's row by endpoint and unsubscribes. **Sign out** does the same first (time-boxed to 3 s, never blocking the sign-out), so a signed-out device gets no ticket titles.
- **Send test** calls `relay-push` with `{ mode: 'test', endpoint }` and the session's JWT; the function sends a fixed message to that one device if the caller is the owner. The toast reports sent, expired (gone), not registered or refused.
- **Demo.** The control and panel render; the panel says the demo can't subscribe and Turn on is disabled.

### Opening a ticket from a notification

Three routes, because on iOS a tap can reach the page by any one of them or none:

1. **`?t=KEY`** on load. After the board loads, the key (case-insensitive) is matched against `auto_key`, `jira_key`, `display_key` and `aliases`, the ticket panel opens, and `t` is removed from the address (other parameters, such as `demo`, stay). An unknown key shows "KEY isn't on this board."
2. **`postMessage`** `{ type: 'relay:open', url }` from the worker to an open window.
3. **The Cache Storage note**, read on start, `focus`, `pageshow` and `visibilitychange` (visible), and every 1.5 s while the page is visible, then deleted. A note older than 10 minutes is ignored.

On the iPhone Home Screen app, a tap on a notification while Relay is already in front reaches none of these: iOS doesn't deliver `notificationclick` to the worker then, so no note is written and no message is sent. The ticket is still in Waiting for me. The in-app banner below was built for this case but doesn't show on the iPhone.

If none arrives, the ticket is still in Waiting for me.

All three go through `openByKey()`. When the ticket is found it first closes whatever is in `#modalhost` (the Notifications panel, a form) by clicking its cancel control, so a pending `ask()` resolves as cancelled, and then opens the ticket panel. A modal sits above the ticket panel, so leaving it open would hide the ticket.

### A push while Relay is in front

On every `push` the worker also:

- writes `{ type: 'relay:push', title, body, url, at }` to Cache Storage (`relay-push-note`, key `__push-note`), and
- posts the same object to every window inside its scope.

The page, not the worker, decides whether it was in front when the push arrived. The page keeps `frontSince`, the time it last became visible (`Infinity` while hidden). It shows the push only if the page is visible, `at` is no earlier than `frontSince` minus 4 s (grace, in case iOS briefly hides the page as the notification drops down), and `at` is under 2 minutes old. Anything else is dropped, so a page brought to the front by a tap, or coming back later, shows no banner for an earlier push.

The banner (`#pushbar`) shows the notification's title and body, **Open** (when the URL carries `?t=KEY`) and ×. **Open** hides the banner and goes through `openByKey()`, so it opens the ticket over any open panel. The note is read on start, on `visibilitychange` (visible) and every 1.5 s while the page is visible, then deleted. The message deletes the note, so one push shows one banner.

**On the iPhone the banner doesn't show.** In the live test on the Home Screen app with Relay in front (2026-11-13), the notification arrived but no banner appeared. That held with both versions: the worker filtering on `visibilityState` (v9), and the worker handing over every push with the page deciding (v10). The cause hasn't been found: either the worker's note or message doesn't reach the page, or the page doesn't pick up the note. On `?demo`, a note written by hand shows the banner. It hasn't been tested with a real push on desktop or Android.

## Markdown

Briefs are rendered by `js/markdown.js`. All text is HTML-escaped first; the renderer then produces only headings, paragraphs, bullet and numbered lists, fenced code, inline code, bold, italic and links. Links are kept only for `http:`, `https:` and `mailto:`, and open in a new tab with `rel="noopener noreferrer"`. Link URLs in `links` jsonb follow the same rule.

## Filing a ticket

A session files a new ticket in its project when it knows it; one with no fitting project lands in the Inbox (`INB`). The ticket panel's **Project** picker moves a ticket into any project, or into a new one (**+ New project…**). A new project is `kind 'app'`; its key is the one typed, or one made from the name (the initials of several words, or the first three letters of one), and must match `^[A-Z][A-Z0-9]{1,9}$` and be unused. Its colour is the first of `APP_COLOURS` not already used by a project. A move re-keys the ticket in the new project, keeps the old ID in `aliases`, takes a parent's phases with it, and logs an `id` event. A phase shows its project as text: it moves only with its parent. A Jira-linked ticket can't move into an app project until the link is removed.

## Jira

- The Jira box shows on tickets in Jira projects and in the Inbox (`INB`); app tickets never show it. Linking a Jira issue to an Inbox ticket moves it into that Jira project.
- A pasted URL's key is found in `?selectedIssue=KEY-1`, `/browse/KEY-1` or anywhere in the URL. A bare key gets its link from the project's `jira_base` or the last pasted Jira origin (`localStorage` `relay:jira-base`).
- Pasting a Jira issue URL into search and pressing Enter opens the ticket with that key, or creates one in that Jira project, creating the project (`kind 'jira'`, colour `#64748B`, `jira_base` from the URL) if it doesn't exist. A key whose prefix is an app project is refused.
- A Relay project key must match `^[A-Z][A-Z0-9]{1,9}$`, but a Jira prefix may contain `_` or be longer. `jiraProjectKey()` maps it (drop non-alphanumerics, cut to 10), so `DATA_PLATFORM_X-7` lands in project `DATAPLATFO`, named `DATA_PLATFORM_X`. The ticket's `jira_key` keeps the `_`.
- Linking a key from another Jira project moves the ticket there (and its phases with it). A phase can't move on its own.
- Several tickets may link to one Jira issue (silver-octo-invention migration `20261113160000_relay_shared_jira_delete.sql`); a Jira key still can't be another ticket's `auto_key` or alias. They share a display ID, so the list shows each one's auto key beside it. Search, Enter on that key opens the ticket when only one links it and otherwise leaves the filtered list showing them all; `?t=KEY` prefers a ticket's own ID, then the first linked one.

## Icons

`icon.svg` is the master (Handoff: `#2A5BD7` tile, white chevron, `#FFAD5C` chevron, rx 112 on 512). `favicon.svg` is the same mark full-bleed. PNGs are rendered from the SVG in headless Chromium: `icon-192.png` (rounded, transparent corners), `icon-512.png` (full-bleed square, `any maskable`, mark inside the 80% safe zone), `apple-touch-icon.png` (180, full-bleed, opaque), `favicon-32.png` (full-bleed, opaque).

## Traps

- **Notification permission is per origin, the subscription per service worker scope.** Every app on `adamnc02.github.io` shares the permission: a phone that allowed Listly shows no prompt for Relay, and turning notifications off for the site in iOS Settings turns them off for every app there. Relay's subscription and its rows are its own.
- **A changed `sw.js` can disturb an iPhone's push subscription.** After a worker change, if notifications stop or taps stop opening tickets, turn notifications off and on in the panel and send a test.
- **One Home Screen icon per app when testing push.** Each icon is its own app, with its own worker, storage and subscription.

- **Enter that opens the panel also closes it.** The panel focuses its close button on open; without `preventDefault()` on the keydown, Chromium delivers the same Enter to that button. Both Enter handlers (search, focused row) prevent the default.
- **Board columns sized to their text.** `min-width: max-content` on the board grid makes every `minmax(150px, 1fr)` column as wide as its longest unwrapped title (over 500px). The board's min-width is the six 150px minimums plus gaps instead, so all six columns fit beside the rail at 1280px; card rows and titles wrap inside a narrow column.
- **Duplicate element IDs in dialogs.** A modal field with id `m-title` collided with the modal heading; the heading is `m-heading`.
- **`crypto.randomUUID` needs a secure context.** It is missing on LAN http, so `uuid()` in `js/model.js` falls back to `getRandomValues`.
- **Stale modules.** Serve locally with `Cache-Control: no-store`; the service worker itself fetches with `cache: 'no-cache'`.
- **Headless drag and drop.** Playwright's one-shot `dragTo` can start the drag on the wrong card; driving the mouse in steps works.
- **Simulating pull to refresh.** Playwright's `touchscreen` only taps. Send `Input.dispatchTouchEvent` (touchStart, several touchMove, touchEnd) through a CDP session, in a context with `hasTouch`.
