# Relay

Relay is a single-user projects board: a grouped list and a kanban board of tickets that Claude Code sessions keep up to date. Each ticket carries its own handoff (brief, session log, files touched, reference docs), and a ticket that needs the owner shows as **Waiting for me**.

- Live: https://adamnc02.github.io/relay/
- Demo (sample data, no sign-in, nothing saved): https://adamnc02.github.io/relay/?demo

## Notifications

Relay can notify a device when a ticket moves to **Waiting for me**: the ticket's ID and title, with the need underneath. Tapping it opens the ticket.

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
