// Relay UI. Renders the store; every write goes through the adapter, whose
// returned changes are applied to the store. The same code runs in ?demo and live.

import { STATUSES, SBY, ORDER, isHidden, parseJira, ts, actorLabel, isAdam, CLOSED_BY, safeHref, PROJECT_KEY_RE, JIRA_KEY_RE, NEW_JIRA_COLOUR, jiraProjectKey, friendlyError } from './model.js';
import { esc, renderMarkdown } from './markdown.js';
import { handoff, sicon, I_ALL, I_ARCH, CHEV, I_MENU, I_SEARCH, I_GOOGLE, I_BELL } from './icons.js';
import { createAdapter, isDemo } from './data/index.js';
import { createStore, saveSnapshot, readSnapshot, clearSnapshot } from './store.js';
import { isNetworkError } from './data/supabase.js';
import { pushState, turnOn, turnOff, sendTest, forgetThisDevice } from './push.js';

const adapter = createAdapter();
const store = createStore();
const $ = (id) => document.getElementById(id);

const st = {
  view: 'board', nav: 'open', q: '', collapsed: { done: true }, folded: {}, sideOpen: false,
  openId: null, readOnly: false, live: 'connecting', user: null, offlineAt: null, booted: false,
  // This device's notification state, from pushState(); null until checked.
  push: null,
  // Rail sections: Apps starts collapsed, Jira open.
  railFold: { apps: true, jira: false },
};
try {
  // 'relay-view-2': the default became Board, so a List choice saved under the old key doesn't apply.
  const v = localStorage.getItem('relay-view-2');
  if (v === 'board' || v === 'list') st.view = v;
  const f = JSON.parse(localStorage.getItem('relay-rail-fold') || 'null');
  if (f && typeof f === 'object') st.railFold = { ...st.railFold, ...f };
} catch { /* storage blocked or bad JSON */ }

/* ---------- derived data ---------- */

let D = null;
function derive() {
  const now = Date.now();
  const allProjects = store.rows('projects');
  const pby = new Map(allProjects.map((p) => [p.id, p]));
  const projects = allProjects.filter((p) => !p.archived).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.name.localeCompare(b.name));
  const tickets = store.rows('tickets');
  const tby = new Map(tickets.map((t) => [t.id, t]));
  const kids = new Map();
  for (const t of tickets) if (t.parent_id) (kids.get(t.parent_id) || kids.set(t.parent_id, []).get(t.parent_id)).push(t);
  for (const k of kids.values()) k.sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0) || a.seq - b.seq);
  const group = (rows, by) => {
    const m = new Map();
    for (const r of rows) (m.get(r[by]) || m.set(r[by], []).get(r[by])).push(r);
    return m;
  };
  const events = group(store.rows('events').sort((a, b) => ts(b.at) - ts(a.at) || b.id - a.id), 'ticket_id');
  const sessions = group(store.rows('sessions').sort((a, b) => ts(a.started_at) - ts(b.started_at)), 'ticket_id');
  const files = group(store.rows('ticket_files').sort((a, b) => ts(b.last_at) - ts(a.last_at)), 'ticket_id');
  const docs = group(store.rows('ticket_docs').sort((a, b) => ts(a.added_at) - ts(b.added_at)), 'ticket_id');
  D = { now, pby, projects, tickets, tby, kids, events, sessions, files, docs };
}
const kidsOf = (t) => D.kids.get(t.id) || [];
const isParent = (t) => D.kids.has(t.id);
const proj = (t) => D.pby.get(t.project_id) || { key: '?', name: 'Unknown project', colour: '#7a8794', kind: 'app' };
const disp = (t) => t.display_key || t.jira_key || t.auto_key;
const hidden = (t) => isHidden(t, D.now);
const when = (t) => Math.max(ts(t.updated_at), ...kidsOf(t).map((k) => ts(k.updated_at)));
const filesOf = (t) => D.files.get(t.id) || [];
const ago = (v) => {
  const t = typeof v === 'number' ? v : ts(v);
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 6e4));
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
};

/* ---------- small renderers ---------- */

const pill = (s) => `<span class="pill" data-s="${s}" style="${s === 'waiting' ? '' : 'color:' + SBY[s].c}"><i class="dot"></i>${SBY[s].name}</span>`;
const projTag = (t) => {
  const p = proj(t);
  return `<span class="proj"><i class="dot" style="background:${esc(p.colour)}"></i>${esc(p.name)}</span>`;
};
const idHtml = (t) => `<span class="dispid">${esc(disp(t))}</span>${t.jira_key ? `<span class="altid" style="display:inline;margin-left:6px">${esc(t.auto_key)}</span>` : ''}`;
const kidRow = (c) => `<div class="kid" data-s="${c.status}" data-open="${c.id}" tabindex="0" role="button">${sicon(c.status)}<span class="idchip">${esc(disp(c))}</span><span class="kt">${esc(c.title)}</span><span class="ks">${SBY[c.status].name}</span><span class="r-when">${ago(c.updated_at)}</span></div>`;

function inNav(t) {
  const n = st.nav;
  if (n === 'archived') return hidden(t);
  if (hidden(t)) return false;
  if (n === 'waiting') return t.status === 'waiting';
  if (n.startsWith('p:')) return proj(t).key === n.slice(2);
  return true;
}
function queryKey() {
  const raw = st.q.trim();
  return /^https?:\/\//i.test(raw) ? parseJira(raw)?.key || null : null;
}
function matches(t) {
  if (!inNav(t)) return false;
  const q = st.q.trim().toLowerCase();
  if (!q) return true;
  const jk = queryKey();
  if (jk) return t.jira_key === jk;
  return [t.auto_key, t.jira_key, t.title, ...(t.aliases || [])].some((v) => v && v.toLowerCase().includes(q));
}

/* ---------- shell ---------- */

function renderNav() {
  const live = D.tickets.filter((t) => !hidden(t) && !isParent(t));
  const it = (id, label, count, lead, cls = '') => `<button class="nav-i ${cls}" data-nav="${esc(id)}" aria-current="${st.nav === id}">${lead}<span class="nl">${esc(label)}</span><span class="n">${count}</span></button>`;
  const item = (p) => it('p:' + p.key, p.name, live.filter((t) => t.project_id === p.id).length, `<i class="dot" style="background:${esc(p.colour)}"></i>`);
  // A collapsed section still shows the project you're viewing, so the current view never disappears from the rail.
  const sec = (id, title, list, empty) => {
    const folded = !!st.railFold[id];
    const n = live.filter((t) => list.some((p) => p.id === t.project_id)).length;
    const shown = folded ? list.filter((p) => st.nav === 'p:' + p.key) : list;
    const body = list.length ? shown.map(item).join('') : (folded ? '' : empty);
    return `<button class="nav-h nav-sec" data-railsec="${id}" aria-expanded="${!folded}">${CHEV}<span>${title}</span>${folded && n ? `<span class="n">${n}</span>` : ''}</button>${body}`;
  };
  const apps = D.projects.filter((p) => p.kind !== 'jira');
  const jira = D.projects.filter((p) => p.kind === 'jira');
  $('nav').innerHTML =
    it('waiting', 'Waiting for me', live.filter((t) => t.status === 'waiting').length, sicon('waiting'), 'wait') +
    it('open', 'All tickets', live.length, I_ALL) +
    it('archived', 'Archived', D.tickets.filter((t) => hidden(t) && !isParent(t)).length, I_ARCH) +
    sec('jira', 'Jira', jira, `<p class="nav-empty">Paste a Jira issue link into search to add your first Jira ticket.</p>`) +
    (apps.length ? sec('apps', 'Apps', apps, '') : '');
}
function navTitle() {
  const n = st.nav;
  if (n === 'waiting') return 'Waiting for me';
  if (n === 'archived') return 'Archived';
  if (n.startsWith('p:')) {
    const p = D.projects.find((x) => x.key === n.slice(2));
    return p ? p.name + (p.kind === 'jira' ? ' · Jira' : '') : 'All tickets';
  }
  return 'All tickets';
}
function renderWait() {
  const w = D.tickets.filter((t) => t.status === 'waiting' && !hidden(t) && !isParent(t)).sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  const el = $('waitbar');
  el.hidden = !(st.nav === 'open' && w.length);
  el.innerHTML = `<span><b>${w.length} waiting for you</b></span>` + w.map((t) => `<button data-open="${t.id}" class="mono">${esc(disp(t))}</button>`).join('');
}
function renderOffline() {
  const el = $('offbar');
  el.hidden = !st.readOnly;
  if (st.readOnly) el.innerHTML = `<b>Offline.</b> <span>Showing the copy saved ${esc(ago(st.offlineAt) || 'earlier')}. Read-only until the connection is back.</span> <button class="xbtn" id="retry">Retry</button>`;
}
const PUSH_LABEL = { on: 'On', off: 'Off', blocked: 'Blocked', demo: 'Demo' };
function renderNotif() {
  const el = $('sidenotif');
  if (!el) return;
  const label = PUSH_LABEL[st.push?.state] || '';
  el.innerHTML = `<button class="nav-i" id="notifbtn" aria-haspopup="dialog">${I_BELL}<span class="nl">Notifications</span><span class="n" data-push="${esc(st.push?.state || '')}">${esc(label)}</span></button>`;
}
function renderFoot() {
  renderNotif();
  const u = st.user || { name: '', initial: '?' };
  const liveText = isDemo() ? 'Sample data · edits not saved' : st.readOnly ? 'Offline · read-only' : st.live === 'live' ? 'Signed in with Google · live' : st.live === 'paused' ? 'Signed in · live updates paused' : 'Signed in with Google';
  $('sidefoot').innerHTML = `<span class="av a">${esc(u.initial)}</span><span class="foot-who">${esc(isDemo() ? 'Demo' : u.name)}<br><small>${esc(liveText)}</small></span>${isDemo() ? '' : `<button class="xbtn" id="signout">Sign out</button>`}`;
}

function avatar(t) {
  const you = isAdam(t.updated_by);
  return `<span class="av ${you ? 'a' : 'c'}" title="Last update by ${you ? 'Adam' : 'Claude'}">${you ? 'A' : 'C'}</span>`;
}

let VIS = new Set();
function row(t) {
  const kids = kidsOf(t);
  const isP = kids.length > 0;
  const shown = kids.filter((c) => !st.q || VIS.has(c.id));
  const done = kids.filter((c) => c.status === 'done').length;
  const open = isP && !st.folded[t.id];
  const fc = filesOf(t).length + kids.reduce((a, c) => a + filesOf(c).length, 0);
  const branch = t.links?.branch;
  return `<div class="r${isP ? ' parent' : ''}" data-open="${t.id}" tabindex="0" role="button">
    <span class="r-s">${sicon(t.status)}</span>
    <div class="r-main">
      <div class="r-t">${esc(t.title)}</div>
      <div class="r-meta"><span class="idchip">${esc(disp(t))}</span>${t.jira_key ? `<span class="alt">${esc(t.auto_key)}</span>` : ''}${projTag(t)}${isP ? `<span class="pmeta"><span class="prog"><i style="width:${Math.round((done / kids.length) * 100)}%"></i></span>${done} of ${kids.length} phases done</span>` : ''}${branch ? `<span class="br">⎇ ${esc(branch)}</span>` : ''}${fc ? `<span>${fc} file${fc > 1 ? 's' : ''}</span>` : ''}${t.needs_wrapup ? `<span class="flag">Closed without wrap-up</span>` : ''}${hidden(t) ? `<span class="flag muted">${t.archived_at ? 'Archived' : 'Hidden after 14 days'}</span>` : ''}</div>
      ${t.status === 'waiting' ? `<div class="r-need"><b>Needs you</b><span>${esc(t.need)}</span></div>` : ''}
      ${open ? `<div class="kids">${shown.map(kidRow).join('')}</div>` : ''}
    </div>
    <div class="r-side">${isP ? `<button class="xbtn" data-expand="${t.id}" aria-expanded="${open}">${open ? 'Hide phases' : 'Show phases'}</button>` : ''}${avatar(t)}<span class="r-when">${ago(when(t))}</span></div>
  </div>`;
}
function renderList(rows) {
  if (!rows.length) {
    const jk = queryKey();
    const msg = jk
      ? `No ticket is linked to ${esc(jk)} yet. Press Enter to create one in Jira project ${esc(jiraProjectKey(jk.replace(/-\d+$/, '')))}.`
      : st.q ? 'No tickets match. Search covers auto IDs, Jira IDs, aliases and titles.' : st.booted && !D.tickets.length ? 'No tickets yet. Create one with + New.' : 'No tickets here.';
    return `<div class="empty">${msg}</div>`;
  }
  VIS = new Set(rows.map((t) => t.id));
  const top = [];
  const seen = new Set();
  const flat = st.nav === 'archived';
  rows.forEach((t) => {
    const p = !flat && t.parent_id ? D.tby.get(t.parent_id) : t;
    const x = p || t;
    if (!seen.has(x.id)) { seen.add(x.id); top.push(x); }
  });
  return `<div class="groups">` + ORDER.map((s) => {
    const g = top.filter((t) => t.status === s).sort((a, b) => when(b) - when(a));
    if (!g.length) return '';
    const closed = !!st.collapsed[s] && !st.q && st.nav !== 'archived';
    return `<section class="grp" data-s="${s}"><button class="grp-h" data-collapse="${s}" aria-expanded="${!closed}">${sicon(s)}<span>${SBY[s].name}</span><span class="cnt">${g.length}</span>${CHEV}</button>${closed ? '' : `<div class="list">${g.map(row).join('')}</div>`}</section>`;
  }).join('') + `</div>`;
}
function renderBoard(rows) {
  return `<div class="boardwrap"><div class="board">` + STATUSES.map((s) => {
    const c = rows.filter((t) => t.status === s.id && !isParent(t)).sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
    return `<section class="col" data-s="${s.id}" data-col="${s.id}"><div class="colhead"><i class="dot" style="background:${s.c}"></i>${s.name}<span class="n">${c.length}</span></div>` +
      c.map((t) => {
        const par = t.parent_id ? D.tby.get(t.parent_id) : null;
        return `<article class="card" draggable="${!st.readOnly}" data-open="${t.id}" data-drag="${t.id}" tabindex="0"><div class="row"><span>${idHtml(t)}</span>${t.needs_wrapup ? '<span class="flag">Closed without wrap-up</span>' : ''}</div><div class="ttl">${esc(t.title)}</div>${par ? `<div class="ptag">↳ ${esc(disp(par))} · ${esc(par.title)}</div>` : ''}${t.status === 'waiting' ? `<p class="need">${esc(t.need)}</p>` : ''}<div class="meta">${projTag(t)}<span>${ago(t.updated_at)}</span></div></article>`;
      }).join('') + `</section>`;
  }).join('') + `</div></div>`;
}

function render() {
  derive();
  renderNav();
  renderWait();
  renderOffline();
  renderFoot();
  $('v-list').setAttribute('aria-pressed', st.view === 'list');
  $('v-board').setAttribute('aria-pressed', st.view === 'board');
  const rows = D.tickets.filter(matches);
  $('vtitle').textContent = navTitle();
  $('vcount').textContent = rows.filter((t) => !isParent(t)).length;
  $('out').innerHTML = st.view === 'list' ? renderList(rows) : renderBoard(rows);
  $('app').classList.toggle('nav-open', st.sideOpen);
  $('sidescrim').hidden = !st.sideOpen;
  $('menubtn').setAttribute('aria-expanded', st.sideOpen);
  $('newbtn').disabled = st.readOnly;
  if (st.openId) renderDrawer();
}

/* ---------- toast + dialogs ---------- */

function toast(msg) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.setAttribute('role', 'status');
  d.textContent = msg;
  $('toasthost').replaceChildren(d);
  setTimeout(() => d.remove(), 2600);
}

// A small modal form. fields: [{ id, label, type: 'text'|'textarea'|'select', value, options, placeholder }]
function ask({ title, fields, ok = 'Save' }) {
  return new Promise((resolve) => {
    const host = $('modalhost');
    host.innerHTML = `<div class="scrim" data-cancel style="z-index:40"></div><form class="modal" role="dialog" aria-modal="true" aria-labelledby="m-heading">
      <h2 id="m-heading">${esc(title)}</h2>
      ${fields.map((f) => `<div class="field"><label class="lbl" for="m-${f.id}">${esc(f.label)}</label>${
        f.type === 'select' ? `<select id="m-${f.id}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : f.type === 'textarea' ? `<textarea id="m-${f.id}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
        : `<input id="m-${f.id}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`}</div>`).join('')}
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">${esc(ok)}</button></div>
    </form>`;
    const form = host.querySelector('form');
    const done = (v) => { host.innerHTML = ''; resolve(v); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = Object.fromEntries(fields.map((f) => [f.id, $('m-' + f.id).value.trim()]));
      if (fields.some((f) => f.required && !v[f.id])) { toast(`${fields.find((f) => f.required && !v[f.id]).label} is required.`); return; }
      done(v);
    };
    host.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => done(null)));
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    $('m-' + fields[0].id).focus();
  });
}

/* ---------- notifications ---------- */

const PUSH_TEXT = {
  on: 'On for this device.',
  off: 'Off for this device.',
  blocked: "Blocked. Relay can't ask again: turn notifications on in Settings → Notifications → Relay on an iPhone, or in this browser's site settings, then reopen this panel.",
  unsupported: "This browser can't receive notifications.",
  'needs-home-screen': 'Not available in a Safari tab. Add Relay to the Home Screen and open it from there.',
  unknown: "Couldn't check whether this device is registered. Check the connection and reopen this panel.",
  demo: "The demo can't turn notifications on: it has no account and saves nothing. Sign in on the live app to turn them on.",
};

async function refreshPush() {
  try { st.push = await pushState(adapter); } catch (e) { st.push = { state: 'unknown', message: e?.message }; }
  renderNotif();
  return st.push;
}

let notifBusy = false;
function renderNotifPanel() {
  const host = $('modalhost');
  const s = st.push?.state || 'unknown';
  const canToggle = !st.readOnly && ['on', 'off'].includes(s);
  host.innerHTML = `<div class="scrim" data-cancel style="z-index:40"></div><div class="modal" id="notifpanel" role="dialog" aria-modal="true" aria-labelledby="n-heading">
    <h2 id="n-heading">Notifications</h2>
    <p class="nstate" data-state="${esc(s)}" role="status">${esc(st.readOnly && ['on', 'off'].includes(s) ? PUSH_TEXT[s] + ' Offline: changes wait for the connection.' : PUSH_TEXT[s])}</p>
    <p class="hint">Relay notifies this device when a ticket moves to <b>Waiting for me</b>. Tapping the notification opens the ticket.</p>
    <p class="hint"><b>iPhone and iPad:</b> notifications only work when Relay is installed on the Home Screen and opened from there. That is an iOS rule. In Safari, tap Share, then <b>Add to Home Screen</b>, then open Relay from its icon and turn notifications on here.</p>
    <div class="modal-actions">
      ${s === 'on' ? `<button type="button" class="btn" id="n-test" ${notifBusy || st.readOnly ? 'disabled' : ''}>Send test</button>` : ''}
      ${s === 'on' ? `<button type="button" class="btn" id="n-off" ${notifBusy || !canToggle ? 'disabled' : ''}>Turn off</button>`
        : `<button type="button" class="btn primary" id="n-on" ${notifBusy || !canToggle ? 'disabled' : ''}>Turn on</button>`}
      <button type="button" class="btn" data-cancel>Close</button>
    </div>
  </div>`;
  const close = () => { host.innerHTML = ''; };
  host.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = close));
  host.querySelector('#notifpanel').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  const act = (id, fn, okMsg) => {
    const b = $(id);
    if (!b) return;
    b.onclick = async () => {
      notifBusy = true;
      renderNotifPanel();
      try {
        const r = await fn();
        const msg = typeof okMsg === 'function' ? okMsg(r) : okMsg;
        if (msg) toast(msg);
      } catch (e) {
        console.warn('[relay] notifications:', e);
        toast(isNetworkError(e) ? "Couldn't reach Relay. Nothing changed." : friendlyError(e));
      }
      notifBusy = false;
      await refreshPush();
      if ($('notifpanel')) renderNotifPanel();
    };
  };
  act('n-on', () => turnOn(adapter), 'Notifications are on for this device.');
  act('n-off', () => turnOff(adapter), 'Notifications are off for this device.');
  act('n-test', () => sendTest(adapter), (r) =>
    r?.sent ? 'Test sent. It should arrive in a few seconds.'
      : r?.gone ? 'This device\'s registration has expired. Turn notifications off, then on again.'
        : r?.devices === 0 ? "This device isn't registered. Turn notifications on first."
          : "The push service didn't accept the test. Try again shortly.");
  host.querySelector('#notifpanel .modal-actions .btn:not([disabled])')?.focus();
}
async function openNotifications() {
  if (!st.push) st.push = { state: 'unknown' };
  renderNotifPanel();
  await refreshPush();
  if ($('notifpanel') && !notifBusy) renderNotifPanel();
}

/* ---------- opening a ticket from a link or a notification ---------- */

// ?t=KEY opens that ticket (a notification's URL carries it). KEY is matched
// against auto_key, jira_key, display_key and aliases.
const ticketParam = (url) => { try { return new URL(url, location.href).searchParams.get('t'); } catch { return null; } };
let pendingKey = ticketParam(location.href);
function stripTicketParam() {
  if (!new URLSearchParams(location.search).has('t')) return;
  const q = location.search.slice(1).split('&').filter((p) => p && !/^t(=|$)/.test(p)).join('&');
  history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
}
// Closes whatever is in #modalhost (the Notifications panel, a form). Its cancel
// control is clicked so a pending ask() resolves with null.
function closeModal() {
  const host = $('modalhost');
  if (!host.innerHTML) return;
  host.querySelector('[data-cancel]')?.click();
  host.innerHTML = '';
}
function openByKey(key) {
  if (!key) return;
  if (!st.booted || !D) { pendingKey = key; return; }
  const k = key.trim().toUpperCase();
  const t = D.tickets.find((x) => x.auto_key === k || x.jira_key === k || x.display_key === k || (x.aliases || []).includes(k));
  if (!t) { toast(`${key} isn't on this board.`); return; }
  // A modal sits above the ticket panel, so it would hide the ticket.
  closeModal();
  openTicket(t.id);
}
function openPending() {
  const k = pendingKey;
  pendingKey = null;
  stripTicketParam();
  openByKey(k);
  checkOpenNote();
}
// The service worker also writes a tapped notification's URL to Cache Storage,
// because on iOS a tap can reach the page without the URL or the message. Read
// on start, whenever the page comes to the front, and every 1.5 s while it is
// visible, then deleted. (A tap on iOS while Relay is already in front reaches
// the worker not at all. The push banner below was built for that case but
// doesn't show on the iPhone; see TECHNICAL.md.)
const OPEN_NOTE_CACHE = 'relay-open-intent';
let checkingNote = false;
async function checkOpenNote() {
  if (!st.booted || typeof caches === 'undefined' || checkingNote) return;
  checkingNote = true;
  try {
    const c = await caches.open(OPEN_NOTE_CACHE);
    const key = new URL('./__open-intent', location.href).href;
    const r = await c.match(key);
    if (!r) return;
    await c.delete(key);
    const n = await r.json();
    if (Date.now() - (n.at || 0) < 10 * 60e3) openByKey(ticketParam(n.url));
  } catch { /* storage blocked */ } finally { checkingNote = false; }
}

// Every push is handed to the page by the worker: a Cache Storage note (read on
// the same schedule as the open-intent note) and a message. iOS doesn't report
// a tap on the notification while Relay is in front, so the page shows a banner
// for a push that arrived while it was in front: one stamped after the page
// last came to the front (a few seconds' grace, in case iOS briefly hides the
// page as the notification drops down). Anything older is dropped.
// On the iPhone Home Screen app the banner doesn't show (UAT 2026-11-13; cause
// not found).
const PUSH_NOTE_CACHE = 'relay-push-note';
const pushNoteKey = () => new URL('./__push-note', location.href).href;
let frontSince = document.visibilityState === 'visible' ? Date.now() : Infinity;
document.addEventListener('visibilitychange', () => {
  frontSince = document.visibilityState === 'visible' ? Date.now() : Infinity;
});
const arrivedInFront = (n) => document.visibilityState === 'visible'
  && (n.at || 0) >= frontSince - 4000 && Date.now() - (n.at || 0) < 2 * 60e3;
let checkingPush = false;
async function checkPushNote() {
  if (!st.booted || typeof caches === 'undefined' || checkingPush) return;
  checkingPush = true;
  try {
    const c = await caches.open(PUSH_NOTE_CACHE);
    const r = await c.match(pushNoteKey());
    if (!r) return;
    await c.delete(pushNoteKey());
    const n = await r.json();
    if (arrivedInFront(n)) showPushBanner(n);
  } catch { /* storage blocked */ } finally { checkingPush = false; }
}
function showPushBanner(n) {
  if (!st.booted) return;
  const el = $('pushbar');
  const key = ticketParam(n.url);
  el.innerHTML = `<span class="pb-t"><b>${esc(n.title || 'Relay')}</b>${n.body ? ` <span>${esc(n.body)}</span>` : ''}</span>`
    + (key ? `<button class="btn primary" id="pb-open">Open</button>` : '')
    + `<button class="iconbtn" id="pb-x" aria-label="Dismiss">×</button>`;
  el.hidden = false;
  const hide = () => { el.hidden = true; el.innerHTML = ''; };
  $('pb-x').onclick = hide;
  if (key) $('pb-open').onclick = () => { hide(); openByKey(key); };
}

// The rail shows the running service worker's VERSION, so a UAT can confirm a
// device picked up the latest release.
async function showVersion() {
  const el = $('sidever');
  if (!el || !('serviceWorker' in navigator)) return;
  let v = null;
  try {
    // ready never settles when no worker is registered.
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]);
    const sw = navigator.serviceWorker.controller || reg?.active;
    if (sw) {
      v = await new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data?.version || null);
        sw.postMessage({ type: 'relay:version' }, [ch.port2]);
        setTimeout(() => resolve(null), 2000);
      });
    }
  } catch { /* no worker */ }
  // A worker from before the version reply: read it from the shell cache's name.
  if (!v && typeof caches !== 'undefined') {
    try {
      const num = (s) => parseInt(s.replace(/\D/g, ''), 10) || 0;
      v = (await caches.keys()).filter((k) => k.startsWith('relay-shell-')).map((k) => k.slice(12)).sort((a, b) => num(a) - num(b)).pop() || null;
    } catch { /* storage blocked */ }
  }
  el.textContent = v ? `Relay ${v}` : '';
}

/* ---------- writes ---------- */

function guard() {
  if (st.readOnly) { toast('Offline: Relay is read-only until the connection is back.'); return false; }
  return true;
}
async function run(fn, okMsg) {
  if (!guard()) return null;
  try {
    const changes = await fn();
    applyChanges(changes);
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(changes) : okMsg);
    return changes;
  } catch (e) {
    console.warn('[relay] write failed:', e);
    if (isNetworkError(e)) toast("Couldn't reach Relay. Nothing was saved.");
    else toast(friendlyError(e));
    render();
    return null;
  }
}
function applyChanges(changes) {
  store.apply(changes);
  render();
  scheduleSnapshot();
}
const note = (t, kind, body) => adapter.insertEvent({ ticket_id: t.id, kind, body, actor: 'adam' });

async function askNeed(t) {
  const v = await ask({ title: `${disp(t)} → Waiting for me`, ok: 'Set waiting', fields: [{ id: 'need', label: 'What I need from you', type: 'textarea', value: t.need || '', placeholder: 'Run UAT on the phone, then say done.', required: true }] });
  return v ? v.need : null;
}
async function setStatus(t, s) {
  if (isParent(t) || t.status === s) { render(); return; }
  const patch = { status: s };
  if (s === 'waiting') {
    const need = await askNeed(t);
    if (!need) { render(); return; }
    patch.need = need;
  }
  await run(() => adapter.updateTicket(t.id, patch, { prevParentId: t.parent_id }), `${disp(t)} → ${SBY[s].name}`);
}
async function setParent(t, pid) {
  const prev = t.parent_id ? D.tby.get(t.parent_id) : null;
  const phase = pid ? Math.max(0, ...(D.kids.get(pid) || []).filter((c) => c.id !== t.id).map((c) => c.phase || 0)) + 1 : null;
  const par = pid ? D.tby.get(pid) : null;
  await run(async () => {
    const ch = await adapter.updateTicket(t.id, { parent_id: pid || null, phase }, { prevParentId: t.parent_id });
    return ch.concat(await note(t, 'parent', par ? `Added under ${disp(par)} as phase ${phase}.` : `Removed from ${prev ? disp(prev) : 'its parent'}.`));
  }, par ? `Now a phase of ${disp(par)}` : 'No parent');
}
async function addPhase(parent) {
  const ph = Math.max(0, ...kidsOf(parent).map((c) => c.phase || 0)) + 1;
  const v = await ask({ title: `New phase of ${disp(parent)}`, ok: 'Add phase', fields: [{ id: 'title', label: 'Title', value: `Phase ${ph}: `, required: true }] });
  if (!v) return;
  const ch = await run(async () => {
    const c = await adapter.insertTicket({ project_id: parent.project_id, parent_id: parent.id, phase: ph, title: v.title });
    const kid = c.find((x) => x.table === 'tickets' && x.type === 'INSERT').row;
    return c.concat(await note(kid, 'parent', `Added as phase ${ph} of ${disp(parent)}.`));
  }, (c) => `Added ${c.find((x) => x.table === 'tickets' && x.type === 'INSERT').row.auto_key}`);
  if (ch) openTicket(parent.id);
}
async function toggleArchive(t) {
  const arch = !t.archived_at;
  await run(async () => {
    const ch = await adapter.updateTicket(t.id, { archived_at: arch ? new Date().toISOString() : null });
    return ch.concat(await note(t, 'archive', arch ? 'Archived.' : 'Unarchived.'));
  }, arch ? 'Archived. It is in the Archived view.' : 'Unarchived');
}
async function rename(t, title) {
  if (!title || title === t.title) { render(); return; }
  await run(() => adapter.updateTicket(t.id, { title }), 'Renamed');
}
async function changeNeed(t) {
  const need = await askNeed(t);
  if (need && need !== t.need) await run(() => adapter.updateTicket(t.id, { need }), 'Need updated');
}
async function sendNote(t, body) {
  if (!body) return;
  const ch = await run(() => note(t, 'note', body), 'Sent. A running session picks it up at its next step.');
  if (ch) { const n = $('d-note'); if (n) n.value = ''; }
}
async function didThis(t) {
  await run(async () => {
    const ch = await note(t, 'note', "I've done this: " + (t.need || ''));
    return ch.concat(await adapter.updateTicket(t.id, { status: 'progress', need: null }, { prevParentId: t.parent_id }));
  }, 'Sent. A running session picks it up at its next step.');
}

function jiraBaseFor(p) {
  if (p?.jira_base) return p.jira_base;
  try { return localStorage.getItem('relay:jira-base'); } catch { return null; }
}
function rememberJiraBase(base) {
  if (!base) return;
  try { localStorage.setItem('relay:jira-base', base); } catch { /* storage blocked */ }
}
// Returns the Jira project for a key prefix, creating it when it doesn't exist.
async function ensureJiraProject(prefix, base, changes) {
  const key = jiraProjectKey(prefix);
  const p = store.rows('projects').find((x) => x.key === key);
  if (p) {
    if (p.kind !== 'jira') throw new Error(`${key} is an app project, so it can't take a Jira link.`);
    return p;
  }
  if (!PROJECT_KEY_RE.test(key)) throw new Error(`${prefix} can't be used as a Relay project key.`);
  const ch = await adapter.insertProject({ key, name: prefix, colour: NEW_JIRA_COLOUR, kind: 'jira', jira_base: base });
  changes.push(...ch);
  store.apply(ch);
  derive();
  return ch[0].row;
}
async function linkJira(t, raw) {
  if (!raw) {
    await run(async () => (await adapter.updateTicket(t.id, { jira_key: null, jira_url: null })).concat(await note(t, 'id', 'Removed Jira link.')), 'Jira link removed');
    return;
  }
  const j = parseJira(raw, jiraBaseFor(proj(t)));
  if (!j || !JIRA_KEY_RE.test(j.key)) { toast('No Jira key found. Paste the issue URL or a key like WEB-500.'); return; }
  if (D.tickets.some((o) => o.id !== t.id && (o.jira_key === j.key || o.auto_key === j.key || (o.aliases || []).includes(j.key)))) { toast(j.key + ' is already used by another ticket'); return; }
  rememberJiraBase(j.base);
  const prefix = j.key.split('-')[0];
  await run(async () => {
    const changes = [];
    let moved = '';
    const target = await ensureJiraProject(prefix, j.base, changes);
    if (changes.length) moved += ` Created Jira project ${target.key}.`;
    const patch = { jira_key: j.key, jira_url: j.url };
    if (target.id !== t.project_id) {
      if (t.parent_id) throw new Error(`${j.key} belongs to project ${target.key}, and a phase can't move project without its parent.`);
      patch.project_id = target.id;
      moved += ` Moved to ${target.key}${isParent(t) ? ' with its phases' : ''}.`;
    }
    changes.push(...(await adapter.updateTicket(t.id, patch)));
    changes.push(...(await note(t, 'id', `Linked Jira ${j.key}. Display ID is now ${j.key}.${moved}`)));
    changes.moved = moved;
    return changes;
  }, (c) => 'Linked ' + j.key + (c.moved || ''));
}
async function createFromJira(j) {
  rememberJiraBase(j.base);
  const prefix = j.key.split('-')[0];
  const ch = await run(async () => {
    const changes = [];
    const p = await ensureJiraProject(prefix, j.base, changes);
    const c = await adapter.insertTicket({ project_id: p.id, title: 'New ticket for ' + j.key, jira_key: j.key, jira_url: j.url });
    const t = c.find((x) => x.table === 'tickets' && x.type === 'INSERT').row;
    return changes.concat(c, await note(t, 'id', 'Created from a pasted Jira link.'));
  }, 'Created a ticket for ' + j.key);
  if (ch) {
    const t = ch.find((x) => x.table === 'tickets' && x.type === 'INSERT').row;
    $('q').value = '';
    st.q = '';
    render();
    openTicket(t.id);
  }
}
async function newTicket() {
  if (!guard()) return;
  const cur = st.nav.startsWith('p:') ? st.nav.slice(2) : null;
  const def = D.projects.find((p) => p.key === cur) || D.projects.find((p) => p.key === 'INB') || D.projects.find((p) => p.key === 'RLY') || D.projects[0];
  if (!def) { toast('There are no projects yet.'); return; }
  const v = await ask({
    title: 'New ticket', ok: 'Create',
    fields: [
      { id: 'title', label: 'Title', placeholder: 'What needs doing?', required: true },
      { id: 'project', label: 'Project', type: 'select', value: def.id, options: D.projects.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` })) },
    ],
  });
  if (!v) return;
  const ch = await run(() => adapter.insertTicket({ project_id: v.project, title: v.title }), (c) => 'Created ' + c.find((x) => x.table === 'tickets' && x.type === 'INSERT').row.auto_key);
  if (ch) openTicket(ch.find((x) => x.table === 'tickets' && x.type === 'INSERT').row.id);
}

/* ---------- ticket panel ---------- */

function kickoff(t) { return `Continue ${disp(t)}.`; }
function fileKinds(f) {
  const k = f.kinds || [];
  return k.includes('shell') && k.length === 1 ? 'shell · logged' : k.join(' + ') || 'edit';
}
function fileGroups(files) {
  const g = {};
  files.forEach((f) => {
    const m = f.path.match(/^(.*\/Documents\/GitHub\/[^/]+)\/(.*)$/);
    const i = f.path.lastIndexOf('/');
    const root = m ? m[1] : f.path.slice(0, i);
    const rel = m ? m[2] : f.path.slice(i + 1);
    (g[root] = g[root] || []).push({ ...f, rel });
  });
  return Object.entries(g).map(([root, list]) => `<div class="froot">${esc(root)}</div>` + list.map((f) => `<div class="frow"><code>${esc(f.rel)}</code><span class="kind ${(f.kinds || []).includes('shell') ? 'shell' : ''}">${esc(fileKinds(f))} · ${f.times}× · ${ago(f.last_at)}</span><button class="cp" data-copy="${esc(f.path)}">Copy path</button></div>`).join('')).join('');
}
function linksHtml(links) {
  const e = Object.entries(links || {}).filter(([, v]) => v != null && v !== '');
  if (!e.length) return '';
  const label = { branch: 'Branch', pr: 'PR', live: 'Live', test: 'Test' };
  return `<div class="field"><span class="lbl">Links</span><div class="links">${e.map(([k, v]) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    const href = safeHref(s);
    return `<span>${esc(label[k] || k)} ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"><code>${esc(s)}</code></a>` : `<code>${esc(s)}</code>`}</span>`;
  }).join('')}</div></div>`;
}
function logBody(l) {
  if (l.kind === 'status') {
    const from = SBY[l.from_status]?.name;
    const to = SBY[l.to_status]?.name || l.to_status;
    return esc(from ? `Moved ${from} → ${to}` : `Moved to ${to}`) + (l.body ? `. ${esc(l.body)}` : '');
  }
  return esc(l.body || '');
}

function openTicket(id) {
  if (!D.tby.get(id)) return;
  st.openId = id;
  renderDrawer(true);
}
function closeDrawer() {
  st.openId = null;
  $('drawerhost').innerHTML = '';
}
function renderDrawer(fresh = false) {
  const x = D.tby.get(st.openId);
  const host = $('drawerhost');
  if (!x) { closeDrawer(); return; }
  // Keep what's being typed when a live update re-renders the panel.
  const keep = fresh ? null : { note: $('d-note')?.value, jira: $('d-jira')?.value, focus: document.activeElement?.id, scroll: host.querySelector('.dbody')?.scrollTop };
  const p = proj(x);
  const par = x.parent_id ? D.tby.get(x.parent_id) : null;
  const kids = kidsOf(x);
  const isP = kids.length > 0;
  const kdone = kids.filter((c) => c.status === 'done').length;
  const allFiles = isP ? [...filesOf(x), ...kids.flatMap(filesOf)] : filesOf(x);
  const wk = isP ? kids.find((c) => c.status === 'waiting') : null;
  const sessions = D.sessions.get(x.id) || [];
  const docs = D.docs.get(x.id) || [];
  const log = D.events.get(x.id) || [];
  const jiraHref = safeHref(x.jira_url);
  const ro = st.readOnly ? 'disabled' : '';
  const parents = D.tickets.filter((o) => o.project_id === x.project_id && o.id !== x.id && !o.parent_id && (!hidden(o) || o.id === x.parent_id)).sort((a, b) => a.seq - b.seq);

  host.innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dtitle">
   <div class="dhead"><div style="min-width:0;flex:1"><div class="bigid">${x.jira_key ? (jiraHref ? `<a href="${esc(jiraHref)}" target="_blank" rel="noopener noreferrer">${esc(x.jira_key)} ↗</a>` : esc(x.jira_key)) : esc(x.auto_key)}</div><h2 id="dtitle" class="dtitle" ${st.readOnly ? '' : 'tabindex="0" title="Rename"'}>${esc(x.title)}</h2><div class="dmeta">${projTag(x)}${par ? `<button class="partof" data-goto="${par.id}">Part of ${esc(disp(par))} · ${esc(par.title)}</button>` : ''}${x.needs_wrapup ? '<span class="flag">Closed without wrap-up</span>' : ''}</div></div><button class="x" data-close aria-label="Close">×</button></div>
   <div class="dbody">
    ${isP ? `<div class="field"><span class="lbl">Status</span><div>${pill(x.status)} <span class="hint">Set by its phases</span></div></div>` : `<div class="field"><label class="lbl" for="d-status">Status</label><select id="d-status" ${ro}>${STATUSES.map((s) => `<option value="${s.id}" ${s.id === x.status ? 'selected' : ''}>${s.name}</option>`).join('')}</select></div>`}
    ${!isP ? `<div class="field"><label class="lbl" for="d-parent">Parent</label><select id="d-parent" ${ro}><option value="">None</option>${parents.map((o) => `<option value="${o.id}" ${x.parent_id === o.id ? 'selected' : ''}>${esc(disp(o))} · ${esc(o.title)}</option>`).join('')}</select><p class="hint">Put this ticket under a parent as one of its phases. Parents come from the same project.</p></div>` : ''}
    <div><button class="btn" id="d-arch" ${ro}>${x.archived_at ? 'Unarchive' : 'Archive'}</button></div>
    ${x.status === 'waiting' ? `<div class="waitbox field"><span class="lbl">What I need from you</span><div>${esc(x.need)}</div>${wk ? `<div><button class="btn" data-goto="${wk.id}">Open ${esc(disp(wk))}</button></div>` : `<div class="btnrow"><button class="btn" id="d-did" ${ro}>I've done this</button><button class="xbtn" id="d-need" ${ro}>Change</button></div>`}</div>` : ''}
    ${p.kind === 'jira' ? `<div class="field"><span class="lbl">IDs</span><div class="idbox">
      <span class="k">Relay ID</span><span class="mono">${esc(x.auto_key)}</span>
      <span class="k">Jira</span><div class="idrow"><input id="d-jira" placeholder="Paste Jira link or key" value="${esc(x.jira_url || x.jira_key || '')}" aria-label="Jira link or key" ${ro}><button class="btn" id="d-link" ${ro}>${x.jira_key ? 'Update' : 'Link'}</button></div>
      <span class="k">Shown as</span><span class="mono" style="font-weight:600">${esc(disp(x))}</span>
      ${x.jira_url ? `<span class="k">Opens</span><span class="mono" style="font-size:11px;word-break:break-all">${esc(x.jira_url)}</span>` : ''}
      ${(x.aliases || []).length ? `<span class="k">Also</span><span class="mono" style="font-size:12px">${esc(x.aliases.join(', '))}</span>` : ''}
    </div></div>` : ''}
    <div class="field"><span class="lbl">Pick up in a new session</span><div class="kickrow"><pre class="kick" id="d-kick">${esc(kickoff(x))}</pre><button class="btn" id="d-copy">Copy</button></div><p class="hint">The new session runs <code>relay get ${esc(x.auto_key)}</code>, which loads the brief, the last three sessions, the files and the reference docs.</p></div>
    ${isP ? `<div class="field"><span class="lbl">Phases · ${kdone} of ${kids.length} done</span><span class="prog wide"><i style="width:${Math.round((kdone / kids.length) * 100)}%"></i></span><div class="kids in-drawer">${kids.map(kidRow).join('')}</div><div><button class="btn" id="d-addphase" ${ro}>+ Add phase</button></div></div>` : ''}
    <div class="field"><span class="lbl">${isP ? 'Plan' : 'Brief'}</span>${x.brief && x.brief.trim() ? `<div class="brief md">${renderMarkdown(x.brief)}</div>` : `<div class="hint">No brief yet. Claude writes it when a session picks this ticket up.</div>`}</div>
    ${x.next_step && !(x.brief || '').includes(x.next_step) ? `<div class="field"><span class="lbl">Next step</span><div>${esc(x.next_step)}</div></div>` : ''}
    ${isP && !sessions.length ? `<div class="field"><span class="lbl">Sessions</span><div class="hint">Sessions are logged on each phase.</div></div>` : `<div class="field"><span class="lbl">Sessions · ${sessions.length}</span>${sessions.length ? `<ol class="sess">${sessions.slice().reverse().map((s) => `<li><div class="h"><span>${ago(s.ended_at || s.started_at)} · ${esc(s.machine || 'Session')}</span><span>${esc(CLOSED_BY[s.closed_by] || (s.ended_at ? '' : 'In progress'))}</span></div>${s.summary ? `<div>${esc(s.summary)}</div>` : ''}${s.open_items ? `<div class="open">Left open: ${esc(s.open_items)}</div>` : ''}${(s.prs || []).length || (s.commits || []).length ? `<div class="open mono" style="font-size:11.5px">${esc([...(s.prs || []).map((x) => 'PR ' + x), ...(s.commits || []).map((c) => c.slice(0, 7))].join(' · '))}</div>` : ''}</li>`).join('')}</ol>` : `<div class="hint">No sessions yet.</div>`}</div>`}
    <div class="field"><span class="lbl">${isP ? 'Files touched across all phases' : 'Files touched'} · ${allFiles.length}</span>${allFiles.length ? `<div class="files">${fileGroups(allFiles)}</div>` : `<div class="hint">No files changed yet.</div>`}</div>
    ${docs.length ? `<div class="field"><span class="lbl">Reference docs</span><div class="files">${docs.map((d) => `<div class="frow"><code>${esc(d.path)}</code><span class="kind">${esc(d.label || '')}</span><button class="cp" data-copy="${esc(d.path)}">Copy path</button></div>`).join('')}</div></div>` : ''}
    ${linksHtml(x.links)}
    <div class="field"><label class="lbl" for="d-note">Note to Claude</label><textarea id="d-note" placeholder="UAT passed on the iPad." ${ro}></textarea><p class="hint">A session working on this ticket gets the note at its next step. Otherwise the next session to open the ticket reads it first.</p><div><button class="btn primary" id="d-addnote" ${ro}>Send note</button></div></div>
    <div class="field"><span class="lbl">Activity</span>${log.length ? `<ul class="log">${log.map((l) => `<li><span class="pip ${isAdam(l.actor) ? 'you' : ''}"></span><div><div class="who">${esc(actorLabel(l.actor))} · ${ago(l.at)}</div><div>${logBody(l)}</div>${l.kind === 'note' && isAdam(l.actor) ? `<div class="dlv ${l.seen_at ? 'seen' : ''}">${l.seen_at ? '✓ Seen by session' : 'Not picked up yet'}</div>` : ''}</div></li>`).join('')}</ul>` : '<div class="hint">Nothing yet.</div>'}</div>
   </div></aside>`;

  const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
  on('d-did', 'onclick', () => didThis(x));
  on('d-need', 'onclick', () => changeNeed(x));
  on('d-addphase', 'onclick', () => addPhase(x));
  on('d-status', 'onchange', (e) => setStatus(x, e.target.value));
  on('d-parent', 'onchange', (e) => setParent(x, e.target.value || null));
  on('d-arch', 'onclick', () => toggleArchive(x));
  on('d-link', 'onclick', () => linkJira(x, $('d-jira').value.trim()));
  on('d-jira', 'onkeydown', (e) => { if (e.key === 'Enter') linkJira(x, e.target.value.trim()); });
  on('d-addnote', 'onclick', () => sendNote(x, $('d-note').value.trim()));
  on('d-copy', 'onclick', () => copy($('d-kick').textContent, 'Kickoff copied', $('d-kick')));
  host.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, 'Path copied')));
  host.querySelectorAll('.drawer [data-open], .drawer [data-goto]').forEach((b) => (b.onclick = () => openTicket(b.dataset.open || b.dataset.goto)));
  host.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeDrawer));
  const h2 = $('dtitle');
  if (!st.readOnly) {
    const edit = () => {
      const inp = document.createElement('input');
      inp.className = 'dtitle-in';
      inp.id = 'd-title';
      inp.value = x.title;
      inp.setAttribute('aria-label', 'Title');
      h2.replaceWith(inp);
      inp.focus();
      inp.select();
      let gone = false;
      const save = () => { if (gone) return; gone = true; rename(x, inp.value.trim()); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); gone = true; renderDrawer(); } };
      inp.onblur = save;
    };
    h2.onclick = edit;
    h2.onkeydown = (e) => { if (e.key === 'Enter') edit(); };
  }

  if (keep) {
    if (keep.note && $('d-note')) $('d-note').value = keep.note;
    if (keep.jira != null && $('d-jira')) $('d-jira').value = keep.jira;
    if (keep.scroll) host.querySelector('.dbody').scrollTop = keep.scroll;
    if (keep.focus && $(keep.focus)) $(keep.focus).focus();
  } else {
    host.querySelector('.x').focus();
  }
}

function copy(text, msg, selectEl) {
  const fallback = () => {
    if (selectEl) {
      const r = document.createRange();
      r.selectNodeContents(selectEl);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      toast('Selected. Press Cmd+C to copy.');
    } else toast(text);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(msg), fallback);
  else fallback();
}

/* ---------- events ---------- */

function bindShell() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('notifpanel')) { $('modalhost').innerHTML = ''; return; }
      if ($('modalhost').innerHTML) return;
      if (st.openId) closeDrawer();
      if (st.sideOpen) { st.sideOpen = false; render(); }
    }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !st.openId) { e.preventDefault(); $('q').focus(); }
    if (e.key === 'Enter' && e.target.dataset?.open && !e.target.closest('.drawer')) { e.preventDefault(); openTicket(e.target.dataset.open); }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#signout')) { signOut(); return; }
    if (e.target.closest('#retry')) { boot(); return; }
    if (e.target.closest('#signin')) { signIn(); return; }
    if (e.target.closest('#notifbtn')) { st.sideOpen = false; render(); openNotifications(); return; }
    if (e.target.closest('.drawer') || e.target.closest('#modalhost') || e.target.closest('#gate')) return;
    const xp = e.target.closest('[data-expand]');
    if (xp) { const k = xp.dataset.expand; st.folded[k] = !st.folded[k]; render(); return; }
    const cl = e.target.closest('[data-collapse]');
    if (cl) { const s = cl.dataset.collapse; st.collapsed[s] = !st.collapsed[s]; render(); return; }
    const rs = e.target.closest('[data-railsec]');
    if (rs) {
      const k = rs.dataset.railsec; st.railFold[k] = !st.railFold[k];
      try { localStorage.setItem('relay-rail-fold', JSON.stringify(st.railFold)); } catch { /* blocked */ }
      renderNav(); return;
    }
    // Choosing a view leaves the phone rail open: the highlight moves and the board behind it updates.
    const nv = e.target.closest('[data-nav]');
    if (nv) {
      const id = nv.dataset.nav;
      st.nav = id;
      render();
      $('out').scrollTop = 0;
      window.scrollTo(0, 0);
      document.querySelector(`#nav [data-nav="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('#menubtn')) { st.sideOpen = !st.sideOpen; render(); return; }
    if (e.target.closest('#railclose')) { st.sideOpen = false; render(); $('menubtn').focus(); return; }
    if (e.target.closest('#sidescrim')) { st.sideOpen = false; render(); return; }
    const o = e.target.closest('[data-open]');
    if (o) openTicket(o.dataset.open);
  });
  $('q').addEventListener('input', (e) => { st.q = e.target.value; render(); });
  $('q').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // The panel takes focus on open; without this the same keypress clicks its close button.
    e.preventDefault();
    const raw = st.q.trim();
    if (!raw) return;
    const q = raw.toUpperCase();
    const j = /^https?:\/\//i.test(raw) ? parseJira(raw) : null;
    const hit = D.tickets.find((t) => t.auto_key === q || t.jira_key === q || (t.aliases || []).includes(q) || (j && t.jira_key === j.key));
    if (hit) { openTicket(hit.id); return; }
    if (j && JIRA_KEY_RE.test(j.key)) createFromJira(j);
  });
  const setView = (v) => { st.view = v; try { localStorage.setItem('relay-view-2', v); } catch { /* blocked */ } render(); };
  $('v-list').onclick = () => setView('list');
  $('v-board').onclick = () => setView('board');
  $('newbtn').onclick = () => newTicket();

  // Board drag and drop (desktop). Phones change status from the ticket panel.
  let dragId = null;
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('[data-drag]');
    if (!c || st.readOnly) return;
    dragId = c.dataset.drag;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch { /* some browsers */ }
  });
  document.addEventListener('dragend', () => {
    dragId = null;
    document.querySelectorAll('.dragging,.drop').forEach((n) => n.classList.remove('dragging', 'drop'));
  });
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('[data-col]');
    if (!col || !dragId) return;
    e.preventDefault();
    document.querySelectorAll('.drop').forEach((n) => n !== col && n.classList.remove('drop'));
    col.classList.add('drop');
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest?.('[data-col]');
    if (!col || !dragId) return;
    e.preventDefault();
    const t = D.tby.get(dragId);
    dragId = null;
    if (t) setStatus(t, col.dataset.col);
  });

  addEventListener('online', () => { if (st.readOnly) boot(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    checkOpenNote();
    checkPushNote();
    if (st.booted && !isDemo() && !st.readOnly) refresh();
  });
  addEventListener('focus', () => checkOpenNote());
  addEventListener('pageshow', () => checkOpenNote());
  setInterval(() => { if (document.visibilityState === 'visible') { checkOpenNote(); checkPushNote(); } }, 1500);
  // A notification tapped while Relay is open: the service worker focuses this
  // window and posts the URL.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type !== 'relay:open') return;
    if (typeof caches !== 'undefined') caches.open(OPEN_NOTE_CACHE).then((c) => c.delete(new URL('./__open-intent', location.href).href)).catch(() => {});
    openByKey(ticketParam(e.data.url));
  });
  // A push, posted by the worker (see checkPushNote).
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type !== 'relay:push') return;
    if (typeof caches !== 'undefined') caches.open(PUSH_NOTE_CACHE).then((c) => c.delete(pushNoteKey())).catch(() => {});
    if (arrivedInFront(e.data)) showPushBanner(e.data);
  });
  // A new worker took over (a release): show its version.
  navigator.serviceWorker?.addEventListener('controllerchange', () => showVersion());
}

/* ---------- boot, auth states, sync ---------- */

let snapTimer = null;
function scheduleSnapshot() {
  if (isDemo() || st.readOnly) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => saveSnapshot(store, st.user?.id), 800);
}
async function refresh() {
  try {
    store.load(await adapter.loadAll());
    render();
    scheduleSnapshot();
    return true;
  } catch (e) {
    console.warn('[relay] refresh failed:', e?.message);
    return false;
  }
}

// Realtime. Each call replaces the channel; status reports from a replaced one are ignored.
let unsub = null;
let liveGen = 0;
function startLive() {
  const gen = ++liveGen;
  unsub?.();
  unsub = adapter.subscribe(
    (changes) => { store.apply(changes); render(); scheduleSnapshot(); },
    (status) => {
      if (gen !== liveGen) return;
      const was = st.live;
      st.live = status;
      if (status === 'live' && was === 'paused') refresh();
      renderFoot();
    },
  );
}

/* ---------- pull to refresh ---------- */

// Touch only, so desktop mouse drag and drop never sees it. A pull arms only when it starts in
// the main pane with the page scrolled to the top and no ticket panel, modal or phone rail open.
// A sideways move first (scrolling the board) or an upward one disarms it.
const PTR_TRIGGER = 64; // px of indicator height (after resistance) that triggers a refresh
const PTR_BUSY = 44;
let ptrBusy = false;
function bindPullToRefresh() {
  const el = $('ptr');
  const label = $('ptrtext');
  let y0 = null, x0 = 0, pulling = false, dist = 0;
  const atTop = () => window.scrollY <= 0 && $('out').scrollTop <= 0;
  const show = (h, state, text) => {
    el.style.height = h + 'px';
    el.dataset.state = state;
    el.style.setProperty('--ptr-turn', Math.round(h * 4) + 'deg');
    label.textContent = text;
  };
  const reset = () => { y0 = null; pulling = false; dist = 0; el.classList.remove('pulling'); };
  document.addEventListener('touchstart', (e) => {
    reset();
    if (ptrBusy || e.touches.length !== 1 || !st.booted || $('app').hidden || st.openId || st.sideOpen || $('modalhost').innerHTML) return;
    if (!e.target.closest('.pane') || !atTop()) return;
    y0 = e.touches[0].clientY;
    x0 = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const t = e.touches[0];
    const dy = t.clientY - y0;
    const dx = t.clientX - x0;
    if (!pulling) {
      if (Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy)) { reset(); return; }
      if (dy < -4 || !atTop()) { reset(); return; }
      if (dy < 10) return;
      pulling = true;
      y0 = t.clientY;
      el.classList.add('pulling');
    }
    const d = t.clientY - y0;
    dist = Math.min(110, Math.max(0, d) * 0.5);
    if (d > 0 && e.cancelable) e.preventDefault();
    show(dist, dist >= PTR_TRIGGER ? 'ready' : 'pull', dist >= PTR_TRIGGER ? 'Release to refresh' : 'Pull to refresh');
  }, { passive: false });
  const end = (e) => {
    if (y0 == null) return;
    const fire = pulling && dist >= PTR_TRIGGER && e.type === 'touchend';
    reset();
    if (fire) pullRefresh();
    else show(0, '', '');
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });

  async function pullRefresh() {
    ptrBusy = true;
    show(PTR_BUSY, 'busy', 'Refreshing…');
    const t0 = Date.now();
    let ok = true;
    if (isDemo()) render();
    else if (st.readOnly) await boot(); // the offline strip's Retry
    else {
      startLive(); // a stalled Realtime channel is replaced, not only the data reloaded
      ok = await refresh();
    }
    // Long enough to see that something happened.
    await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - t0))));
    ptrBusy = false;
    show(0, '', '');
    if (!ok) toast("Couldn't reach Relay. Showing what was already loaded.");
  }
}

function showGate(kind, opts = {}) {
  $('app').hidden = true;
  const g = $('gate');
  g.hidden = false;
  const who = opts.user?.email ? `<p class="hint">Signed in as <b>${esc(opts.user.email)}</b>.</p>` : '';
  const signout = `<button class="btn" id="signout">Sign out</button>`;
  const body = {
    'signed-out': `<h1>Sign in to Relay</h1><p>Relay is a single-owner board. Sign in with the owner's Google account.</p>
      <button class="btn oauth" id="signin">${I_GOOGLE}Continue with Google</button>
      <p class="hint">Or open <a href="?demo">the demo</a> with sample data.</p>
      ${opts.authNote ? `<p class="err" role="alert">${esc(opts.authNote)}</p>` : ''}`,
    'offline-signed-out': `<h1>You're offline</h1><p>Relay needs a connection to sign in. There's no saved copy on this device yet.</p><button class="btn" id="retry">Try again</button>`,
    'not-owner': `<h1>This Google account isn't Relay's owner</h1>${who}<p>Relay shows its board only to the account recorded as its owner. Sign out and sign in with that account.</p>${opts.message ? `<p class="hint">${esc(opts.message)}</p>` : ''}${signout}`,
    'not-exposed': `<h1>Relay isn't set up yet</h1>${who}<p>The <code>relay</code> schema isn't exposed to the Data API. Add <code>relay</code> in Supabase → Project Settings → API → Exposed schemas (keep every existing entry), then reload.</p><div class="btnrow"><button class="btn primary" id="retry">Reload</button>${signout}</div><p class="hint">Error PGRST106.</p>`,
    'not-setup': `<h1>Relay isn't set up yet</h1>${who}<p>The <code>relay</code> schema or its tables aren't in the database yet. Once the migration has run and <code>relay</code> is in Exposed schemas, reload.</p>${opts.message ? `<p class="hint mono">${esc(opts.message)}</p>` : ''}<div class="btnrow"><button class="btn primary" id="retry">Reload</button>${signout}</div>`,
    error: `<h1>Relay couldn't load</h1>${who}<p class="err">${esc(opts.message || 'Unknown error.')}</p><div class="btnrow"><button class="btn primary" id="retry">Try again</button>${signout}</div>`,
  }[kind];
  g.innerHTML = `<div class="gate-card"><div class="gate-mark">${handoff(48)}<span>Relay</span></div>${body}</div>`;
}
function showApp() {
  $('gate').hidden = true;
  $('app').hidden = false;
}

async function signIn() {
  try { await adapter.signIn(); } catch (e) { toast(e.message || String(e)); }
}
async function signOut() {
  // This device stops getting notifications once nobody is signed in here.
  await forgetThisDevice(adapter);
  await adapter.signOut();
  clearSnapshot();
  location.replace(location.pathname);
}

function goOffline(snap) {
  st.readOnly = true;
  st.offlineAt = snap.at;
  store.load(snap.data);
  st.booted = true;
  showApp();
  render();
  openPending();
  checkPushNote();
  refreshPush();
}

async function boot() {
  let res;
  try {
    res = await adapter.start();
  } catch (e) {
    res = isNetworkError(e) ? { state: 'offline' } : { state: 'error', message: e.message };
  }
  st.user = res.user || st.user;
  const snap = isDemo() ? null : readSnapshot();
  if (res.state === 'offline' || res.state === 'offline-signed-out') {
    if (snap) return goOffline(snap);
    return showGate('offline-signed-out');
  }
  if (res.state !== 'ready') return showGate(res.state, res);

  try {
    store.load(await adapter.loadAll());
  } catch (e) {
    if (isNetworkError(e) && snap) return goOffline(snap);
    return showGate('error', { message: e.message, user: res.user });
  }
  st.readOnly = false;
  st.booted = true;
  showApp();
  render();
  scheduleSnapshot();
  openPending();
  checkPushNote();
  refreshPush();
  startLive();
  adapter.onAuthChange?.((event) => { if (event === 'SIGNED_OUT') location.replace(location.pathname); });
}

/* ---------- start ---------- */

function mountShell() {
  $('menubtn').innerHTML = I_MENU;
  $('railclose').innerHTML = I_MENU;
  $('searchicon').outerHTML = I_SEARCH;
  document.querySelectorAll('[data-mark]').forEach((el) => (el.innerHTML = handoff(+el.dataset.mark)));
  if (isDemo()) {
    $('sampletag').hidden = false;
    document.title = 'Relay · Demo';
  }
  // The header's shadow appears only once the content has scrolled. On a phone the page scrolls; on
  // desktop the inner #out panel does.
  const edge = () => $('phead').classList.toggle('scrolled', window.scrollY > 2 || $('out').scrollTop > 2);
  window.addEventListener('scroll', edge, { passive: true });
  $('out').addEventListener('scroll', edge, { passive: true });
}

mountShell();
showVersion();
bindShell();
bindPullToRefresh();
boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('[relay] service worker not registered:', e?.message));
}

if (isDemo()) window.__relay = { store, adapter, st, render };
