// Shared vocabulary and pure rules. Nothing here touches the DOM or the network.

export const STATUSES = [
  { id: 'backlog', name: 'Backlog', c: 'var(--s-backlog)' },
  { id: 'next', name: 'Up next', c: 'var(--s-next)' },
  { id: 'progress', name: 'In progress', c: 'var(--s-prog)' },
  { id: 'waiting', name: 'Waiting for me', c: 'var(--wait)' },
  { id: 'testing', name: 'Testing', c: 'var(--s-uat)' },
  { id: 'done', name: 'Done', c: 'var(--s-done)' },
];
export const SBY = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

// List view group order: what needs attention first.
export const ORDER = ['waiting', 'progress', 'testing', 'next', 'backlog', 'done'];

export const HIDE_AFTER_MS = 14 * 24 * 3600e3;

export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;
export const NEW_JIRA_COLOUR = '#64748B';

export const ts = (v) => (v ? Date.parse(v) : 0);

// Ticket type. A phase has its own; nothing is inherited.
export const TYPES = [{ id: 'dev', name: 'Dev' }, { id: 'bug', name: 'Bug' }];

// A project wherever it shows with its key: "KEY - Name", or just the key when
// the name is empty or is the key itself (a Jira project created from a link).
export function projLabel(p) {
  if (!p) return '';
  const n = String(p.name || '').trim();
  return !n || n.toUpperCase() === String(p.key).toUpperCase() ? p.key : `${p.key} - ${n}`;
}

// The open tickets the rail counts: not done, not archived, not a parent.
export const isOpen = (t) => !t.archived_at && t.status !== 'done';

// Archived tickets leave the board at once; done tickets 14 days after done_at.
export function isHidden(t, now = Date.now()) {
  if (t.archived_at) return true;
  return t.status === 'done' && !!t.done_at && now - ts(t.done_at) > HIDE_AFTER_MS;
}

// Mirrors the database rollup trigger. The real app never writes a parent's
// status; the demo adapter uses this to behave the same way.
export function rollup(kids) {
  const sorted = kids.slice().sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
  const ss = sorted.map((k) => k.status);
  const w = sorted.find((k) => k.status === 'waiting');
  if (w) return { status: 'waiting', need: w.need };
  if (ss.some((s) => s === 'progress' || s === 'testing')) return { status: 'progress', need: null };
  if (ss.length && ss.every((s) => s === 'done')) return { status: 'done', need: null };
  if (ss.some((s) => s === 'next' || s === 'done')) return { status: 'next', need: null };
  return { status: 'backlog', need: null };
}

// Finds a Jira key in a pasted URL (?selectedIssue=, /browse/, or anywhere) or a bare key.
// A bare key gets its link from `base` (the project's jira_base or the last pasted origin).
export function parseJira(raw, base) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const re = '([A-Za-z][A-Za-z0-9_]+-\\d+)';
  const m =
    s.match(new RegExp('[?&]selectedIssue=' + re)) ||
    s.match(new RegExp('/browse/' + re)) ||
    s.match(new RegExp('\\b' + re + '\\b'));
  if (!m) return null;
  const key = m[1].toUpperCase();
  if (/^https?:\/\//i.test(s)) {
    let origin = null;
    try { origin = new URL(s).origin + '/browse/'; } catch { /* not a URL after all */ }
    return { key, url: s, base: origin };
  }
  return { key, url: base ? base + key : null, base: base || null };
}

// A Jira prefix may contain '_' or run past 10 characters; a Relay project key may not.
export function jiraProjectKey(prefix) {
  let k = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (!/^[A-Z]/.test(k)) k = ('J' + k).slice(0, 10);
  if (k.length < 2) k = (k + 'J').slice(0, 10);
  return k;
}

// Turns database errors into sentences. 23505: an ID clash. 23514: a rule.
export function friendlyError(e) {
  const raw = String(e?.message || e || 'Something went wrong.');
  let m = raw.replace(/^relay:\s*/, '');
  if (/tickets_need_when_waiting/.test(raw)) m = 'Waiting for me needs a "what I need from you" line.';
  else if (e?.code === '23505' && /duplicate key/.test(raw)) {
    const d = String(e.details || '').match(/\((\w+)\)=\(([^)]*)\)/);
    m = d ? `${d[2]} is already used${d[1] === 'key' ? ' by another project' : ' by another ticket'}.` : 'That ID is already used by another ticket.';
  } else if (e?.code === '23001' || (e?.code === '23503' && /project_groups/.test(raw))) {
    m = 'That group still has projects. Move them out first.';
  } else if (e?.code === '23514' && /violates check constraint/.test(raw)) {
    const c = (raw.match(/constraint "([^"]+)"/) || [])[1] || '';
    m = /inbox_ungrouped/.test(c) ? "The Inbox can't go in a group." : /type/.test(c) ? 'A ticket is Dev or Bug.' : /key/.test(c) ? "That isn't a valid key." : /colour/.test(c) ? "That isn't a valid colour." : /title|name/.test(c) ? "The title can't be blank." : "That change isn't allowed.";
  }
  m = m.charAt(0).toUpperCase() + m.slice(1);
  return /[.!?]$/.test(m) ? m : m + '.';
}

export const isUrl = (s) => /^https?:\/\//i.test(String(s || '').trim());
export const safeHref = (s) => (/^(https?:|mailto:)/i.test(String(s || '').trim()) ? String(s).trim() : null);

export function actorLabel(a) {
  if (!a || a === 'adam') return 'Adam';
  if (a.startsWith('claude')) return 'Claude · session';
  if (a === 'hook:session-end') return 'SessionEnd hook';
  if (a.startsWith('hook')) return 'Hook';
  return a;
}
export const isAdam = (a) => !a || a === 'adam';

export const CLOSED_BY = {
  close: '/close',
  'close-later': '/close later',
  'close-wait': '/close wait',
  'session-end': 'SessionEnd hook',
};

export function uuid() {
  // crypto.randomUUID needs a secure context; LAN http has none.
  if (globalThis.crypto?.randomUUID) {
    try { return crypto.randomUUID(); } catch { /* fall through */ }
  }
  const b = new Uint8Array(16);
  (globalThis.crypto?.getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = Math.random() * 256)));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- Open in Claude Code (claude-cli:// deep link, this device only) ----

// The device's desktop OS, or null on a phone or tablet (no Claude Code CLI there).
// iPadOS reports a Mac user agent, so a Mac with a touch screen counts as a tablet.
export function clientOS(ua = '', touchPoints = 0) {
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return touchPoints > 1 ? null : 'mac';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return null;
}

// 'windows' for a drive or UNC path, 'posix' for an absolute Unix path, else null.
export function pathKind(p) {
  if (/^[A-Za-z]:[\\/]/.test(p || '') || /^\\\\/.test(p || '')) return 'windows';
  if (/^\//.test(p || '')) return 'posix';
  return null;
}
const osKind = (os) => (os === 'windows' ? 'windows' : 'posix');

// Folders a session can start in but that make no sense to reopen: temp dirs and the
// desktop app's scratch workspaces.
const TRANSIENT = [
  /^\/(private\/)?tmp(\/|$)/,
  /^\/(private\/)?var\/folders\//,
  /\/Library\/Application Support\/Claude\/scratch-workspaces\//,
  /\\AppData\\Local\\Temp(\\|$)/i,
];

function normPath(p, kind) {
  const s = String(p).replace(/[\\/]+$/, '');
  return kind === 'windows' ? s.replace(/\//g, '\\').toLowerCase() : s;
}

// The folder to open a ticket in on a device of kind `os` ('mac', 'windows', 'linux').
// `cwds` are the recorded session folders, best first; `projectPaths` are this project's
// folders; `knownPaths` every project's. A session folder inside a known project path, or
// inside a worktree (<repo>/.claude/worktrees/<name>, often deleted since), opens at that
// root instead. Returns null when no folder fits this OS.
export function launchFolder({ os, cwds = [], projectPaths = [], knownPaths = [] }) {
  const kind = osKind(os);
  const sep = kind === 'windows' ? '\\' : '/';
  const known = knownPaths.filter((p) => pathKind(p) === kind)
    .map((p) => ({ p: String(p).replace(/[\\/]+$/, ''), n: normPath(p, kind) }))
    .sort((a, b) => b.n.length - a.n.length);
  for (const raw of cwds) {
    if (!raw || pathKind(raw) !== kind || TRANSIENT.some((re) => re.test(raw))) continue;
    let c = String(raw).replace(/[\\/]+$/, '');
    const wt = c.search(/[\\/]\.claude[\\/]worktrees([\\/]|$)/);
    if (wt > 0) c = c.slice(0, wt);
    const n = normPath(c, kind);
    const root = known.find((k) => n === k.n || n.startsWith(k.n + (kind === 'windows' ? '\\' : sep)));
    return root ? root.p : c;
  }
  const own = projectPaths.find((p) => pathKind(p) === kind);
  return own ? String(own).replace(/[\\/]+$/, '') : null;
}

export const claudeLink = (folder, prompt) =>
  `claude-cli://open?q=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(folder)}`;

// A command to paste into a terminal: zsh/bash on a Mac or Linux, PowerShell on Windows.
export function claudeCommand(folder, prompt, os) {
  if (os === 'windows') return `cd '${folder.replace(/'/g, "''")}'; claude "${prompt}"`;
  return `cd '${folder.replace(/'/g, `'\\''`)}' && claude "${prompt}"`;
}
