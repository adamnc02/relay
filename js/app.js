// Relay UI. Renders the store; every write goes through the adapter, whose
// returned changes are applied to the store. The same code runs in ?demo and live.

import { STATUSES, SBY, ORDER, TYPES, isHidden, isOpen, parseJira, ts, actorLabel, isAdam, CLOSED_BY, safeHref, PROJECT_KEY_RE, JIRA_KEY_RE, NEW_JIRA_COLOUR, jiraProjectKey, friendlyError, projLabel } from './model.js';
import { esc, renderMarkdown } from './markdown.js';
import {
  handoff, sicon, parentIcon, bugMark, I_ALL, I_ARCH, I_SKILLS, I_BELL, I_COLLAPSE, I_EXPAND, I_SEARCH, I_PLUS, I_COPY, I_LINK,
  I_UP, I_DOWN, I_CARET, CHEV, I_MORE, I_CLOSE, I_SEND, I_SUN, I_MOON, I_MONITOR, I_GRID, I_SIGNOUT, I_LISTV, I_BOARDV, I_MENU,
  I_MAIL, I_CHAT, I_GRIP, I_PENCIL, I_TRASH, I_CODE, I_BUG, I_GOOGLE,
} from './icons.js';
import { createAdapter, isDemo } from './data/index.js';
import { createStore, saveSnapshot, readSnapshot, clearSnapshot } from './store.js';
import { isNetworkError } from './data/supabase.js';
import { pushState, turnOn, turnOff, sendTest, forgetThisDevice } from './push.js';
import { SKILL_GROUPS, SKILLS_FOOT, EXAMPLE_NEED } from './skills.js';

const adapter = createAdapter();
const store = createStore();
const $ = (id) => document.getElementById(id);
const phone = () => matchMedia('(max-width:760px)').matches;
const wide = () => matchMedia('(min-width:1101px)').matches;

// Every localStorage read and write is wrapped: storage can be blocked, or empty in a private window.
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

const st = {
  view: 'list', nav: 'open', collapsed: { done: true }, folded: {}, sideOpen: false,
  openId: null, readOnly: false, live: 'connecting', user: null, offlineAt: null, booted: false,
  // This device's notification state, from pushState(); null until checked.
  push: null,
  // Rail sections, by group id. Unset: the Apps group starts folded, the rest open.
  railFold: {},
  rail: false, // collapsed to the 64px icon rail (desktop only)
  tab: 'brief', // the ticket panel's tab
  theme: 'system',
  version: '',
  order: [], // the current view's tickets, in screen order, for Previous / Next
};
{
  // 'relay-view-3': the default is List, so a choice saved under an earlier key ('relay-view',
  // 'relay-view-2', from when Board was the default) doesn't apply.
  const v = load('relay-view-3');
  if (v === 'board' || v === 'list') st.view = v;
  try {
    const f = JSON.parse(load('relay-rail-fold') || 'null');
    if (f && typeof f === 'object') st.railFold = f;
  } catch { /* bad JSON */ }
  st.rail = load('relay-rail-collapsed') === '1';
  const tab = load('relay-ticket-tab');
  if (['brief', 'sessions', 'files', 'links', 'activity'].includes(tab)) st.tab = tab;
  const th = load('relay-theme');
  if (th === 'light' || th === 'dark') st.theme = th;
}

/* ---------- derived data ---------- */

let D = null;
function derive() {
  const now = Date.now();
  const groups = store.rows('project_groups').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || ts(a.created_at) - ts(b.created_at));
  const gby = new Map(groups.map((g) => [g.id, g]));
  const allProjects = store.rows('projects');
  const pby = new Map(allProjects.map((p) => [p.id, p]));
  const gsort = (p) => (p.group_id && gby.has(p.group_id) ? gby.get(p.group_id).sort ?? 0 : Infinity);
  // Rail order: by group, then each project's sort. The Inbox and any ungrouped project come last.
  const projects = allProjects.filter((p) => !p.archived)
    .sort((a, b) => (a.key === 'INB') - (b.key === 'INB') || gsort(a) - gsort(b) || (a.sort ?? 999) - (b.sort ?? 999) || a.name.localeCompare(b.name));
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
  D = { now, groups, gby, pby, projects, tickets, tby, kids, events, sessions, files, docs };
}
const kidsOf = (t) => D.kids.get(t.id) || [];
const isParent = (t) => D.kids.has(t.id);
const proj = (t) => D.pby.get(t.project_id) || { key: '?', name: 'Unknown project', colour: '#7a8794', kind: 'app' };
const disp = (t) => t.display_key || t.jira_key || t.auto_key;
const hidden = (t) => isHidden(t, D.now);
const when = (t) => Math.max(ts(t.updated_at), ...kidsOf(t).map((k) => ts(k.updated_at)));
const filesOf = (t) => D.files.get(t.id) || [];
// The rail's counts: open tickets only (not done, not archived), never a parent.
const openCount = (list) => list.filter((t) => !isParent(t) && isOpen(t) && !hidden(t)).length;
function ago(v, short = false) {
  const t = typeof v === 'number' ? v : ts(v);
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 6e4));
  const h = Math.round(m / 60);
  const d = Math.round(h / 24);
  const s = m < 60 ? m + 'm' : h < 24 ? h + 'h' : d < 14 ? d + 'd' : Math.round(d / 7) + 'w';
  return short ? s : s + ' ago';
}
const initials = (name) => {
  const w = String(name || '').trim().split(/[\s@.]+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};
// A session counts as live when it hasn't ended and started in the last 12 hours
// (a session that crashed without its end hook never gets an ended_at).
const liveSession = (t) => (D.sessions.get(t.id) || []).some((s) => !s.ended_at && D.now - ts(s.started_at) < 12 * 3600e3);

/* ---------- small renderers ---------- */

const sq = (colour, cls = '') => `<i class="sq ${cls}" style="--pc:${esc(colour)}"></i>`;
const chip = (p) => `<span class="chip">${sq(p.colour)}${esc(p.name || p.key)}</span>`;
const titleHtml = (t) => (t.type === 'bug' ? bugMark() : '') + esc(t.title);
function avatar(t) {
  const you = isAdam(t.updated_by);
  return `<span class="av ${you ? 'a' : 'c'}" title="Last update by ${you ? 'Adam' : 'Claude'}">${you ? esc(initials(st.user?.name || 'A').slice(0, 1)) : 'C'}</span>`;
}
// The PR if there is one, else the branch.
function refOf(t) {
  const l = t.links || {};
  if (l.pr) {
    const s = String(l.pr);
    const m = s.match(/\/pull\/(\d+)/);
    return 'PR ' + (m ? '#' + m[1] : s.replace(/^PR\s*/i, ''));
  }
  return l.branch ? String(l.branch) : '';
}

function inNav(t) {
  const n = st.nav;
  if (n === 'archived') return hidden(t);
  if (hidden(t)) return false;
  if (n === 'waiting') return t.status === 'waiting';
  if (n.startsWith('p:')) return proj(t).key === n.slice(2);
  return true;
}
function searchMatches(t, q) {
  const raw = q.trim();
  if (!raw) return false;
  const jk = /^https?:\/\//i.test(raw) ? parseJira(raw)?.key || null : null;
  if (jk) return t.jira_key === jk;
  const s = raw.toLowerCase();
  return [t.auto_key, t.jira_key, t.title, ...(t.aliases || [])].some((v) => v && v.toLowerCase().includes(s));
}

/* ---------- the rail ---------- */

const PUSH_LABEL = { on: 'On', off: 'Off', blocked: 'Blocked', demo: 'Demo' };
function folded(g) {
  if (g.id in st.railFold) return !!st.railFold[g.id];
  return g.default_kind === 'app';
}
function railSections() {
  const grouped = D.groups.map((g) => ({ g, list: D.projects.filter((p) => p.group_id === g.id && p.key !== 'INB') }));
  const rest = D.projects.filter((p) => p.key === 'INB' || !p.group_id || !D.gby.has(p.group_id));
  return { grouped, rest };
}
function renderRail() {
  const side = $('side');
  const all = D.tickets;
  const waitN = openCount(all.filter((t) => t.status === 'waiting'));
  const archN = all.filter((t) => hidden(t) && !isParent(t)).length;
  const per = (p) => openCount(all.filter((t) => t.project_id === p.id));
  const cur = (id) => `aria-current="${st.nav === id}"`;
  const push = st.push?.state || '';
  const u = st.user || { name: isDemo() ? 'Demo' : '' };
  const { grouped, rest } = railSections();
  const skillsOpen = !!document.querySelector('.pop.skills');

  if (st.rail && !phone()) {
    const pbtn = (p) => `<button class="ri" data-nav="p:${esc(p.key)}" ${cur('p:' + p.key)} aria-label="${esc(p.name)}" title="${esc(p.name)}">${sq(p.colour)}</button>`;
    side.innerHTML = `<span class="rmark">${handoff(26)}</span>
      <button class="ri" id="railtoggle" aria-label="Expand navigation" title="Expand navigation  [">${I_EXPAND}</button>
      <button class="ri" id="railsearch" aria-label="Search" title="Search  /">${I_SEARCH}</button>
      <button class="ri" data-nav="waiting" ${cur('waiting')} aria-label="Waiting for me, ${waitN}" title="Waiting for me">${sicon('waiting', 18)}${waitN ? `<span class="b">${waitN}</span>` : ''}</button>
      <button class="ri" data-nav="open" ${cur('open')} aria-label="All tickets" title="All tickets">${I_ALL}</button>
      <button class="ri" data-nav="archived" ${cur('archived')} aria-label="Archived" title="Archived">${I_ARCH}</button>
      <span class="rdiv"></span>
      ${grouped.flatMap((x) => x.list).concat(rest).map(pbtn).join('')}
      <span class="spacer"></span>
      <button class="ri ${skillsOpen ? 'open' : ''}" id="skillsbtn" aria-label="Skills you can call (?)" title="Skills  ?" aria-haspopup="dialog" aria-expanded="${skillsOpen}">${I_SKILLS}</button>
      <button class="ri notif" id="notifbtn" data-push="${esc(push)}" aria-label="Notifications${PUSH_LABEL[push] ? ': ' + PUSH_LABEL[push] : ''}" title="Notifications" aria-haspopup="dialog">${I_BELL}</button>
      <button class="ri avb" id="acctbtn" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false"><span class="av">${esc(initials(u.name))}</span></button>`;
    return;
  }

  const it = (id, label, count, lead, extra = '') => `<button class="nav" data-nav="${esc(id)}" ${cur(id)}>${lead}<span class="nl">${esc(label)}</span>${extra || `<span class="n">${count}</span>`}</button>`;
  const item = (p) => it('p:' + p.key, p.name, per(p), sq(p.colour));
  // A folded section still lists the project you're viewing, so the current view never disappears from the rail.
  const sec = ({ g, list }) => {
    const f = folded(g);
    const n = list.reduce((a, p) => a + per(p), 0);
    const shown = f ? list.filter((p) => st.nav === 'p:' + p.key) : list;
    return `<div class="sec"><button class="sec-b" data-railsec="${esc(g.id)}" aria-expanded="${!f}">${CHEV}<span>${esc(g.name)}</span></button>${f || !list.length ? `<span class="n">${n}</span>` : ''}<button class="ib" data-editgroups aria-label="Edit projects and groups" title="Projects and groups">${I_PENCIL}</button></div>${shown.map(item).join('')}${!f && !list.length && g.default_kind === 'jira' ? '<p class="nav-empty">Paste a Jira issue link into search to add your first Jira ticket.</p>' : ''}`;
  };
  side.innerHTML = `<div class="brand">${handoff(24)}<b>Relay</b>${phone()
    ? `<button class="ib" id="railclose" aria-label="Close navigation">${I_MENU}</button>`
    : `<button class="ib" id="railtoggle" aria-label="Collapse navigation" title="Collapse navigation  [">${I_COLLAPSE}</button>`}</div>
    <button class="rsearch" id="railsearch">${I_SEARCH}<span>Search or jump to…</span><kbd>⌘K</kbd></button>
    ${it('waiting', 'Waiting for me', waitN, sicon('waiting'), waitN ? `<span class="n badge">${waitN}</span>` : '<span class="n">0</span>')}
    ${it('open', 'All tickets', openCount(all), I_ALL)}
    ${it('archived', 'Archived', archN, I_ARCH)}
    ${grouped.map(sec).join('')}
    ${rest.length ? `<div style="height:10px"></div>${rest.map(item).join('')}` : ''}
    <div class="rfoot">
      <button class="nav ${skillsOpen ? 'open' : ''}" id="skillsbtn" aria-haspopup="dialog" aria-expanded="${skillsOpen}">${I_SKILLS}<span class="nl">Skills</span><span class="n">?</span></button>
      <button class="nav notif" id="notifbtn" data-push="${esc(push)}" aria-haspopup="dialog">${I_BELL}<span class="nl">Notifications</span><span class="n">${esc(PUSH_LABEL[push] || '')}</span></button>
      <div class="acct"><span class="av">${esc(initials(u.name))}</span><div class="who"><div>${esc(u.name || 'Signed in')}</div><div class="mono" id="sidever">${esc(st.version)}</div></div><button class="ib" id="acctbtn" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false">${I_MORE}</button></div>
    </div>`;
}
function renderNotif() { if (D) renderRail(); }
function navTitle() {
  const n = st.nav;
  if (n === 'waiting') return 'Waiting for me';
  if (n === 'archived') return 'Archived';
  if (n.startsWith('p:')) {
    const p = D.projects.find((x) => x.key === n.slice(2));
    return p ? p.name : 'All tickets';
  }
  return 'All tickets';
}
function renderOffline() {
  const el = $('offbar');
  el.hidden = !st.readOnly;
  if (st.readOnly) el.innerHTML = `<b>Offline.</b> <span>Showing the copy saved ${esc(ago(st.offlineAt) || 'earlier')}. Read-only until the connection is back.</span> <button class="btn" id="retry">Retry</button>`;
}

/* ---------- list ---------- */

function row(t, o = {}) {
  const p = proj(t);
  const inP = st.nav === 'p:' + p.key;
  const ref = refOf(t);
  const sel = st.openId === t.id ? ' sel' : '';
  const meta = [
    ref ? `<span class="ref mono">${esc(ref)}</span>` : '',
    t.jira_key ? `<span class="ref mono" title="Relay ID">${esc(t.auto_key)}</span>` : '',
    t.needs_wrapup ? '<span class="flag">Closed without wrap-up</span>' : '',
    hidden(t) ? `<span class="flag muted">${t.archived_at ? 'Archived' : 'Hidden after 14 days'}</span>` : '',
    o.dimStatus ? `<span>${esc(SBY[t.status].name)}</span>` : '',
    !inP && !o.phase ? chip(p) : '',
    `<span class="r-when">${ago(when(t), true)}</span>`,
    avatar(t),
  ].join('');
  const par = o.showParent && t.parent_id ? D.tby.get(t.parent_id) : null;
  return `<div class="row${sel}" data-open="${t.id}" tabindex="0" role="button" aria-label="${esc(disp(t) + ' ' + t.title)}">
    ${sicon(t.status)}<span class="r-id">${esc(disp(t))}</span>
    <span class="r-t${o.dimStatus ? ' dim' : ''}">${titleHtml(t)}<span class="r-sub"><span class="mono">${esc(disp(t))}</span>${inP && !par ? '' : par ? `<span>Phase of ${esc(disp(par))}</span>` : `${sq(p.colour)}<span>${esc(p.name)}</span>`}</span></span>
    <span class="meta">${meta}</span></div>`;
}
function rowsHtml(list, o) { return list.map((t) => row(t, o)).join('<div class="hair"></div>'); }
function parentBlock(t, kids) {
  const p = proj(t);
  const all = kidsOf(t);
  const done = all.filter((c) => c.status === 'done').length;
  const inP = st.nav === 'p:' + p.key;
  const open = !st.folded[t.id];
  st.order.push(t.id);
  const body = open ? `<div class="phases">${kids.map((k) => { st.order.push(k.id); return row(k, { phase: true, dimStatus: k.status !== t.status }); }).join('')}</div>` : '';
  return `<div class="prow${st.openId === t.id ? ' sel' : ''}" data-open="${t.id}" tabindex="0" role="button" aria-label="${esc(disp(t) + ' ' + t.title)}">
    ${parentIcon(p.colour)}<span class="r-id mono">${esc(disp(t))}</span>
    <span class="r-t">${titleHtml(t)} <span class="pc">· ${all.length} phase${all.length === 1 ? '' : 's'}</span><span class="r-sub"><span class="mono">${esc(disp(t))}</span>${inP ? '' : `${sq(p.colour)}<span>${esc(p.name)}</span>`}</span></span>
    <span class="meta"><button class="ib" data-expand="${t.id}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} phases" style="width:24px;height:24px">${open ? I_DOWN : CHEV}</button><span class="prog"><span class="bar4"><i style="width:${Math.round((done / all.length) * 100)}%"></i></span><span class="mono">${done}/${all.length}</span></span>${inP ? '' : chip(p)}</span></div>${body}`;
}
function waitingSection(list) {
  if (!list.length) return '';
  const asRows = !!st.openId && wide();
  const card = (t) => {
    const p = proj(t);
    const par = t.parent_id ? D.tby.get(t.parent_id) : null;
    const ref = refOf(t);
    return `<article class="wcard" data-open="${t.id}" tabindex="0" role="button" aria-label="${esc(disp(t) + ' ' + t.title)}">
      <div class="top">${chip(p)}<span class="id">${esc(disp(t))}</span><span class="w">${ago(t.updated_at)}</span></div>
      <div class="t">${titleHtml(t)}</div>
      <p class="need">${esc(t.need)}</p>
      <div class="wact"><button class="btn ink" data-did="${t.id}" ${st.readOnly ? 'disabled' : ''}>I've done this</button><button class="btn ghost" data-chg="${t.id}" ${st.readOnly ? 'disabled' : ''}>Change</button><span class="ref ${par ? '' : 'mono'}">${par ? 'Phase of ' + esc(disp(par)) : esc(ref)}</span></div>
    </article>`;
  };
  list.forEach((t) => st.order.push(t.id));
  return `<section aria-labelledby="w-h"><div class="gh wait" id="w-h">${sicon('waiting')}Waiting for me<span class="c">${list.length}</span></div>
    ${asRows ? `<div class="rows">${rowsHtml(list, {})}</div>` : `<div class="wgrid" id="wgrid">${list.map(card).join('')}</div>${list.length > 1 ? `<div class="wdots" aria-hidden="true">${list.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}`}</section>`;
}
function renderList(rows) {
  st.order = [];
  if (!rows.length) {
    const msg = st.booted && !D.tickets.length ? 'No tickets yet. Create one with New ticket.' : st.nav === 'waiting' ? 'Nothing is waiting for you.' : 'No tickets here.';
    return `<div class="empty">${msg}</div>`;
  }
  const flat = st.nav === 'archived';
  const waiting = flat ? [] : rows.filter((t) => t.status === 'waiting' && !isParent(t)).sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  let out = waitingSection(waiting);
  // Top-level entries: a phase sits under its parent, unless the parent itself is waiting
  // (then its phases show in their own groups, and the waiting one as a card).
  const top = new Map();
  for (const t of rows) {
    if (waiting.includes(t)) continue;
    const par = !flat && t.parent_id ? D.tby.get(t.parent_id) : null;
    if (par && par.status !== 'waiting') {
      if (!top.has(par.id)) top.set(par.id, { t: par, kids: [] });
      top.get(par.id).kids.push(t);
    } else if (isParent(t) && !flat) {
      if (t.status === 'waiting') continue;
      if (!top.has(t.id)) top.set(t.id, { t, kids: [] });
    } else top.set(t.id, { t, kids: null });
  }
  out += ORDER.filter((s) => s !== 'waiting' || flat).map((s) => {
    const g = [...top.values()].filter((x) => x.t.status === s).sort((a, b) => when(b.t) - when(a.t));
    if (!g.length) return '';
    const closed = !!st.collapsed[s] && !flat;
    const n = g.reduce((a, x) => a + (x.kids ? x.kids.length || 1 : 1), 0);
    let body = '';
    if (!closed) {
      body = '<div class="rows">' + g.map((x, i) => {
        const sep = i ? '<div class="hair"></div>' : '';
        if (x.kids) return sep + parentBlock(x.t, x.kids.length ? kidsOf(x.t).filter((k) => x.kids.includes(k) || inNav(k)) : kidsOf(x.t).filter(inNav));
        st.order.push(x.t.id);
        return sep + row(x.t, { showParent: !!x.t.parent_id });
      }).join('') + '</div>';
    }
    return `<section><button class="gh" data-collapse="${s}" aria-expanded="${!closed}">${sicon(s)}<span>${SBY[s].name}</span><span class="c">${n}</span>${CHEV}</button>${body}</section>`;
  }).join('');
  return `<div class="lv">${out}</div>`;
}

/* ---------- board ---------- */

function renderBoard(rows) {
  st.order = [];
  const ro = st.readOnly;
  return `<div class="boardwrap"><div class="board">` + STATUSES.map((s) => {
    const c = rows.filter((t) => t.status === s.id && !isParent(t)).sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
    c.forEach((t) => st.order.push(t.id));
    const add = ['backlog', 'next', 'progress', 'testing'].includes(s.id) && !ro ? `<button class="add" data-newin="${s.id}" aria-label="New ticket in ${s.name}" title="New ticket in ${s.name}">${I_PLUS}</button>` : '';
    return `<section class="col" data-s="${s.id}" data-col="${s.id}" aria-label="${s.name}"><div class="ch">${sicon(s.id, 14)}<span>${s.name}</span><span class="c">${c.length}</span>${add}</div>` +
      c.map((t) => {
        const par = t.parent_id ? D.tby.get(t.parent_id) : null;
        const p = proj(t);
        const inP = st.nav === 'p:' + p.key;
        const ref = refOf(t);
        const live = t.status !== 'waiting' && liveSession(t);
        const lead = t.needs_wrapup ? '<span class="flag">Closed without wrap-up</span>' : par ? esc(par.title) : ref ? `<span class="mono">${esc(ref)}</span>` : inP ? '' : `${sq(p.colour)} ${esc(p.name)}`;
        return `<article class="card${st.openId === t.id ? ' sel' : ''}" draggable="${!ro && !phone()}" data-open="${t.id}" data-drag="${t.id}" tabindex="0" role="button" aria-label="${esc(disp(t) + ' ' + t.title)}">
          <div class="top"><span class="mono">${esc(disp(t))}</span>${t.phase ? `<span>· Phase ${t.phase}</span>` : ''}${live ? '<span class="live"><i></i>Session live</span>' : ''}${t.status === 'waiting' ? `<span style="margin-left:auto">${ago(t.updated_at, true)}</span>` : ''}</div>
          <div class="t">${titleHtml(t)}</div>
          ${t.status === 'waiting' ? `<p class="need">${esc(t.need)}</p>` : `<div class="ft"><span class="lead">${lead}</span><span class="w">${ago(t.updated_at, true)}</span>${isAdam(t.updated_by) ? '' : avatar(t)}</div>`}
        </article>`;
      }).join('') + `</section>`;
  }).join('') + `</div></div>`;
}

function render() {
  derive();
  renderRail();
  renderOffline();
  const app = $('app');
  app.classList.toggle('collapsed', st.rail && !phone());
  app.classList.toggle('docked', !!st.openId);
  app.classList.toggle('nav-open', st.sideOpen);
  $('sidescrim').hidden = !st.sideOpen;
  $('menubtn').setAttribute('aria-expanded', st.sideOpen);
  $('v-list').setAttribute('aria-pressed', st.view === 'list');
  $('v-board').setAttribute('aria-pressed', st.view === 'board');
  const rows = D.tickets.filter(inNav);
  $('vtitle').textContent = navTitle();
  const p = st.nav.startsWith('p:') ? D.projects.find((x) => x.key === st.nav.slice(2)) : null;
  $('vsq').innerHTML = p ? sq(p.colour) : '';
  $('vcount').textContent = st.nav === 'archived' ? rows.filter((t) => !isParent(t)).length : openCount(rows);
  const keepX = $('wgrid')?.scrollLeft || 0;
  $('out').innerHTML = st.view === 'list' ? renderList(rows) : renderBoard(rows);
  if ($('wgrid') && keepX) $('wgrid').scrollLeft = keepX;
  bindCarousel();
  $('newbtn').disabled = st.readOnly;
  $('fab').disabled = st.readOnly;
  $('mavatar').innerHTML = `<span class="av">${esc(initials((st.user || {}).name || (isDemo() ? 'Demo' : '')))}</span>`;
  if (st.openId) renderDrawer();
}
// The phone's waiting carousel: the active dot follows the card in view.
function bindCarousel() {
  const g = $('wgrid');
  const dots = document.querySelectorAll('.wdots i');
  if (!g || !dots.length) return;
  g.onscroll = () => {
    const w = g.firstElementChild?.getBoundingClientRect().width || 300;
    const i = Math.min(dots.length - 1, Math.round(g.scrollLeft / (w + 10)));
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
  };
}

/* ---------- toast + dialogs ---------- */

function toast(msg, action) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.setAttribute('role', 'status');
  d.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { d.remove(); action.run(); };
    d.append(b);
  }
  $('toasthost').replaceChildren(d);
  setTimeout(() => d.remove(), action ? 7000 : 2600);
}

// A small modal form. fields: [{ id, label, type: 'text'|'textarea'|'select'|'seg', value, options, placeholder }]
function ask({ title, fields, ok = 'Save' }) {
  return new Promise((resolve) => {
    const host = $('modalhost');
    const back = document.activeElement;
    host.innerHTML = `<div class="scrim" data-cancel style="z-index:40"></div><form class="modal" role="dialog" aria-modal="true" aria-labelledby="m-heading">
      <h2 id="m-heading">${esc(title)}</h2>
      ${fields.map((f) => `<div class="field">${f.type === 'seg' ? `<span class="lbl" id="m-${f.id}-l">${esc(f.label)}</span>` : `<label class="lbl" for="m-${f.id}">${esc(f.label)}</label>`}${
        f.type === 'select' ? `<select id="m-${f.id}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : f.type === 'seg' ? `<div class="seg" role="radiogroup" aria-labelledby="m-${f.id}-l" id="m-${f.id}" data-value="${esc(f.value)}">${f.options.map((o) => `<button type="button" role="radio" aria-checked="${o.value === f.value}" data-v="${esc(o.value)}">${o.icon || ''}${esc(o.label)}</button>`).join('')}</div>`
        : f.type === 'textarea' ? `<textarea id="m-${f.id}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
        : `<input id="m-${f.id}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`}${f.hint ? `<p class="hint">${f.hint}</p>` : ''}</div>`).join('')}
      <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancel</button><button type="submit" class="btn primary">${esc(ok)}</button></div>
    </form>`;
    const form = host.querySelector('form');
    host.querySelectorAll('.seg[role="radiogroup"]').forEach((g) => g.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      g.dataset.value = b.dataset.v;
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', x === b));
    })));
    const done = (v) => { host.innerHTML = ''; back?.focus?.({ preventScroll: true }); resolve(v); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = Object.fromEntries(fields.map((f) => [f.id, f.type === 'seg' ? $('m-' + f.id).dataset.value : $('m-' + f.id).value.trim()]));
      if (fields.some((f) => f.required && !v[f.id])) { toast(`${fields.find((f) => f.required && !v[f.id]).label} is required.`); return; }
      done(v);
    };
    host.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => done(null)));
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    const first = $('m-' + fields[0].id);
    (first.querySelector?.('button') || first).focus();
  });
}

/* ---------- popovers and menus ---------- */

// One popover at a time, in #pophost. Escape or an outside click closes it, and
// focus returns to the control that opened it.
let popBack = null;
let popOnClose = null;
function closePop() {
  const host = $('pophost');
  if (!host.innerHTML) return false;
  host.innerHTML = '';
  let back = popBack;
  const after = popOnClose;
  popBack = null;
  popOnClose = null;
  after?.();
  // A re-render may have replaced the control that opened it: find it again by id.
  if (back && !back.isConnected && back.id) back = $(back.id);
  back?.focus?.({ preventScroll: true });
  return true;
}
function place(pop, anchor, how = 'below') {
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const vw = innerWidth;
  const vh = innerHeight;
  let left;
  let top;
  if (how === 'right') { left = r.right + 4; top = r.bottom - ph; }
  else if (how === 'above') { left = r.left; top = r.top - ph - 6; }
  else { left = r.left; top = r.bottom + 6; if (top + ph > vh - 8) top = r.top - ph - 6; }
  if (how === 'below-end') { left = r.right - pw; top = r.bottom + 6; if (top + ph > vh - 8) top = r.top - ph - 6; }
  left = Math.max(8, Math.min(left, vw - pw - 8));
  top = Math.max(8, Math.min(top, vh - ph - 8));
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}
function openPop(anchor, html, { cls = '', role = 'menu', label = '', how = 'below', onClose, dim = false } = {}) {
  closePop();
  const host = $('pophost');
  host.innerHTML = `<div class="popscrim${dim ? ' dim' : ''}"></div><div class="pop ${cls}" role="${role}" ${label ? `aria-label="${esc(label)}"` : ''} tabindex="-1">${html}</div>`;
  const pop = host.querySelector('.pop');
  popBack = anchor;
  popOnClose = onClose || null;
  anchor?.setAttribute?.('aria-expanded', 'true');
  const prevClose = popOnClose;
  popOnClose = () => { anchor?.setAttribute?.('aria-expanded', 'false'); prevClose?.(); };
  if (anchor && !(phone() && /acmenu|sheet/.test(cls))) place(pop, anchor, how);
  host.querySelector('.popscrim').onclick = closePop;
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closePop(); return; }
    const items = [...pop.querySelectorAll('.mi:not(:disabled), [role="radio"]')];
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
    if (e.key === 'Tab' && role === 'menu') closePop();
  });
  return pop;
}
// items: [{ label, icon, run, checked, cls, disabled }] | 'sep' | { heading }
function openMenu(anchor, items, opts = {}) {
  const html = items.map((x, i) => {
    if (x === 'sep') return '<div class="msep" role="separator"></div>';
    if (x.heading) return `<div class="mlab">${esc(x.heading)}</div>`;
    const checked = x.checked != null ? ` role="menuitemradio" aria-checked="${!!x.checked}"` : ' role="menuitem"';
    return `<button class="mi ${x.cls || ''}" data-i="${i}"${checked} ${x.disabled ? 'disabled' : ''}>${x.icon || ''}<span>${esc(x.label)}</span>${x.checked ? `<span class="tick">✓</span>` : ''}</button>`;
  }).join('');
  const pop = openPop(anchor, html, { ...opts, role: 'menu' });
  pop.querySelectorAll('.mi[data-i]').forEach((b) => (b.onclick = () => {
    const x = items[+b.dataset.i];
    closePop();
    x.run?.();
  }));
  (pop.querySelector('.mi[aria-checked="true"]:not(:disabled)') || pop.querySelector('.mi:not(:disabled)'))?.focus();
  return pop;
}

/* ---------- appearance ---------- */

// 'light' and 'dark' set data-theme; 'system' removes it, so prefers-color-scheme applies.
function setTheme(v) {
  st.theme = v;
  save('relay-theme', v);
  const root = document.documentElement;
  if (v === 'system') delete root.dataset.theme; else root.dataset.theme = v;
  syncThemeColour();
}
function syncThemeColour() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim() || '#F1F2F4';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => (m.content = c));
}

function openAccount(anchor) {
  const opt = (v, icon, label) => `<button role="radio" aria-checked="${st.theme === v}" data-theme-v="${v}">${icon}${label}</button>`;
  const pop = openPop(anchor, `
    <div class="mlab" id="ap-l">Appearance</div>
    <div class="seg" role="radiogroup" aria-labelledby="ap-l">${opt('light', I_SUN, 'Light')}${opt('dark', I_MOON, 'Dark')}${opt('system', I_MONITOR, 'System')}</div>
    <div class="msep" role="separator"></div>
    <button class="mi" role="menuitem" id="am-projects">${I_GRID}<span>Projects and groups</span></button>
    <button class="mi" role="menuitem" id="am-notif">${I_BELL}<span>Notifications</span></button>
    ${isDemo() ? '' : `<div class="msep" role="separator"></div><button class="mi" role="menuitem" id="am-signout">${I_SIGNOUT}<span>Sign out</span></button>`}`,
  { cls: 'acmenu', role: 'menu', label: 'Account', how: 'above' });
  pop.querySelectorAll('[data-theme-v]').forEach((b) => (b.onclick = () => {
    setTheme(b.dataset.themeV);
    pop.querySelectorAll('[data-theme-v]').forEach((x) => x.setAttribute('aria-checked', x === b));
  }));
  $('am-projects').onclick = () => { closePop(); st.sideOpen = false; render(); openProjects(); };
  $('am-notif').onclick = () => { closePop(); st.sideOpen = false; render(); openNotifications(); };
  if ($('am-signout')) $('am-signout').onclick = () => { closePop(); signOut(); };
  pop.querySelector('[aria-checked="true"]')?.focus();
}

/* ---------- skills ---------- */

function skillExample() {
  const open = st.openId ? D.tby.get(st.openId) : null;
  const src = open?.need ? open : D.tickets.filter((t) => t.need).sort((a, b) => ts(b.updated_at) - ts(a.updated_at))[0];
  return '/close wait ' + (src?.need || EXAMPLE_NEED);
}
function openSkills() {
  const anchor = $('skillsbtn');
  const ex = skillExample();
  const rows = (g) => `<div class="mlab">${esc(g.title)}</div>` + g.rows.map((r) => `<div class="skr"><div><code>${esc(r.cmd)}</code><div class="d">${esc(r.desc)}</div>${r.example ? `<div class="ex">Ready to send <code>${esc(ex)}</code></div>` : ''}</div><button class="ib" data-skcopy="${esc(r.example ? ex : r.cmd)}" aria-label="Copy ${esc(r.example ? 'the /close wait example' : r.cmd)}">${I_COPY}</button></div>`).join('');
  const pop = openPop(anchor, `<div class="sh"><b id="sk-h">Skills you can call</b><span>in Claude Code</span><button class="ib" id="sk-x" aria-label="Close">${I_CLOSE}</button></div>
    ${SKILL_GROUPS.map(rows).join('<div class="msep"></div>')}<div class="skfoot">${SKILLS_FOOT}</div>`,
  { cls: `skills${phone() ? ' sheet' : ''}`, role: 'dialog', label: 'Skills you can call', how: 'right', onClose: () => renderRail() });
  renderRail();
  pop.querySelectorAll('[data-skcopy]').forEach((b) => (b.onclick = () => copy(b.dataset.skcopy, 'Copied ' + b.dataset.skcopy.split(' ').slice(0, 2).join(' '))));
  $('sk-x').onclick = closePop;
  popBack = $('skillsbtn');
  pop.focus();
}

/* ---------- search ---------- */

let searchSel = 0;
function openSearch() {
  closePop();
  st.sideOpen = false;
  render();
  const host = $('pophost');
  popBack = document.activeElement;
  host.innerHTML = `<div class="popscrim dim"></div><div class="srch" role="dialog" aria-label="Search">
    <label class="in">${I_SEARCH}<span class="sr">Search tickets</span><input id="q" type="search" placeholder="Search IDs or titles: LST-7, BLC-52, or paste a Jira link" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="q-res"><kbd>Esc</kbd></label>
    <div class="res" id="q-res" role="listbox"></div></div>`;
  host.querySelector('.popscrim').onclick = closePop;
  const q = $('q');
  const draw = () => {
    const raw = q.value;
    const res = $('q-res');
    if (!raw.trim()) { res.innerHTML = '<div class="msg">Type an ID, a title, or paste a Jira issue link. Enter on an exact ID opens it.</div>'; return []; }
    const list = D.tickets.filter((t) => searchMatches(t, raw)).sort((a, b) => hidden(a) - hidden(b) || when(b) - when(a)).slice(0, 30);
    if (!list.length) {
      const j = /^https?:\/\//i.test(raw.trim()) ? parseJira(raw.trim()) : null;
      res.innerHTML = `<div class="msg">${j && JIRA_KEY_RE.test(j.key) ? `No ticket is linked to ${esc(j.key)} yet. Press Enter to create one in Jira project ${esc(jiraProjectKey(j.key.replace(/-\d+$/, '')))}.` : 'No tickets match. Search covers Relay IDs, Jira IDs, old IDs and titles.'}</div>`;
      return [];
    }
    searchSel = Math.min(searchSel, list.length - 1);
    res.innerHTML = list.map((t, i) => row(t, {}).replace('class="row', `id="q-o${i}" role="option" aria-selected="${i === searchSel}" class="row`)).join('');
    q.setAttribute('aria-activedescendant', 'q-o' + searchSel);
    res.querySelectorAll('[data-open]').forEach((r) => (r.onclick = () => { closePop(); openTicket(r.dataset.open); }));
    return list;
  };
  let list = draw();
  q.oninput = () => { searchSel = 0; list = draw(); };
  q.onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closePop(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.length) {
      e.preventDefault();
      searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      draw();
      $('q-o' + searchSel)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key !== 'Enter') return;
    // The panel takes focus on open; without this the same keypress clicks its close button.
    e.preventDefault();
    const raw = q.value.trim();
    if (!raw) return;
    const k = raw.toUpperCase();
    const j = /^https?:\/\//i.test(raw) ? parseJira(raw) : null;
    const go = (id) => { closePop(); openTicket(id); };
    const own = D.tickets.find((t) => t.auto_key === k || (t.aliases || []).includes(k));
    if (own) return go(own.id);
    // A Jira issue can be linked to several tickets: open the one, or leave the results showing them all.
    const jk = j ? j.key : k;
    const linked = D.tickets.filter((t) => t.jira_key === jk);
    if (linked.length === 1) return go(linked[0].id);
    if (linked.length > 1) return;
    if (j && JIRA_KEY_RE.test(j.key)) { closePop(); createFromJira(j); return; }
    if (list[searchSel]) go(list[searchSel].id);
  };
  q.focus();
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
      <button type="button" class="btn ghost" data-cancel>Close</button>
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
// Closes whatever is in #modalhost (the Notifications panel, a form) and any
// popover. Its cancel control is clicked so a pending ask() resolves with null.
function closeModal() {
  closePop();
  const host = $('modalhost');
  if (!host.innerHTML) return;
  host.querySelector('[data-cancel]')?.click();
  host.innerHTML = '';
}
function openByKey(key) {
  if (!key) return;
  if (!st.booted || !D) { pendingKey = key; return; }
  const k = key.trim().toUpperCase();
  // A ticket's own IDs first: a Jira key may be shared by several tickets.
  const t = D.tickets.find((x) => x.auto_key === k || (x.aliases || []).includes(k)) ||
    D.tickets.find((x) => x.jira_key === k || x.display_key === k);
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
// On the iPhone Home Screen app the banner doesn't show (cause not found).
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
    + `<button class="ib" id="pb-x" aria-label="Dismiss">${I_CLOSE}</button>`;
  el.hidden = false;
  const hide = () => { el.hidden = true; el.innerHTML = ''; };
  $('pb-x').onclick = hide;
  if (key) $('pb-open').onclick = () => { hide(); openByKey(key); };
}

// The rail shows the running service worker's VERSION, so a UAT can confirm a
// device picked up the latest release.
async function showVersion() {
  if (!('serviceWorker' in navigator)) return;
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
  st.version = v || '';
  const el = $('sidever');
  if (el) el.textContent = st.version;
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
    if (okMsg) {
      const m = typeof okMsg === 'function' ? okMsg(changes) : okMsg;
      if (m) toast(m, changes?.toastAction);
    }
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
async function setType(t, type) {
  if (t.type === type) return;
  await run(() => adapter.updateTicket(t.id, { type }), `${disp(t)} is now ${type === 'bug' ? 'a bug' : 'dev work'}`);
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

// Tickets land in the Inbox unless a project is named; from there Adam files
// them into a project or links them to Jira.
const INBOX = 'INB';
const APP_COLOURS = ['#0EA5E9', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];
async function newProject() {
  const v = await ask({
    title: 'New project', ok: 'Create',
    fields: [
      { id: 'name', label: 'Name', placeholder: 'Stock Report', required: true },
      { id: 'key', label: 'Key (2 to 10 capitals or digits, starting with a letter)', placeholder: 'Leave blank to make one from the name' },
    ],
  });
  if (!v) return null;
  const words = v.name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const auto = words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : (words[0] || '').slice(0, 3);
  const key = (v.key || auto).toUpperCase();
  if (!PROJECT_KEY_RE.test(key)) { toast(`${key || 'That'} can't be a project key: use 2 to 10 capitals or digits, starting with a letter.`); return null; }
  if (store.rows('projects').some((o) => o.key === key)) { toast(`Project ${key} already exists. Pick it from the list, or choose another key.`); return null; }
  const used = new Set(store.rows('projects').map((o) => String(o.colour).toUpperCase()));
  const colour = APP_COLOURS.find((c) => !used.has(c)) || APP_COLOURS[store.rows('projects').length % APP_COLOURS.length];
  const ch = await run(() => adapter.insertProject({ key, name: v.name, colour, kind: 'app' }), 'Created project ' + key);
  return ch ? ch.find((c) => c.table === 'projects' && c.type === 'INSERT').row : null;
}
async function renameProject(p) {
  const v = await ask({ title: `Rename ${p.key}`, ok: 'Rename', fields: [{ id: 'name', label: 'Name', value: p.name === p.key ? '' : p.name, placeholder: 'Rebound', required: true, hint: `Shows as <b>${esc(p.key)} - Name</b>.` }] });
  if (v && v.name !== p.name) await run(() => adapter.updateProject(p.id, { name: v.name }), `Shows as ${projLabel({ ...p, name: v.name })}`);
}
async function moveProject(t, pid) {
  if (pid === '__new') {
    const p = await newProject();
    if (!p) { render(); return; }
    pid = p.id;
  }
  const to = store.rows('projects').find((o) => o.id === pid);
  if (!to || pid === t.project_id) { render(); return; }
  if (t.jira_key && to.kind !== 'jira') { toast(`${disp(t)} is linked to Jira, so it can only go into a Jira project. Remove the link first.`); render(); return; }
  const from = proj(t);
  const old = disp(t);
  await run(async () => {
    const ch = await adapter.updateTicket(t.id, { project_id: pid });
    const row = ch.find((c) => c.table === 'tickets' && c.row.id === t.id)?.row;
    const now = row ? row.display_key || row.auto_key : to.key;
    const all = ch.concat(await note(t, 'id', `Moved from ${from.key} to ${to.key}${isParent(t) ? ' with its phases' : ''}. ${old} is now ${now}.`));
    all.moved = now;
    return all;
  }, (c) => `Moved to ${to.key}: now ${c.moved}`);
}

function jiraBaseFor(p) {
  if (p?.jira_base) return p.jira_base;
  return load('relay:jira-base');
}
function rememberJiraBase(base) {
  if (base) save('relay:jira-base', base);
}
// Returns the Jira project for a key prefix, creating it when it doesn't exist.
// A new one is named after its key; the toast offers to rename it.
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
  const row = ch[0].row;
  changes.toastAction = { label: 'Rename', run: () => renameProject(D.pby.get(row.id) || row) };
  return row;
}
async function linkJira(t, raw) {
  if (!raw) {
    await run(async () => (await adapter.updateTicket(t.id, { jira_key: null, jira_url: null })).concat(await note(t, 'id', 'Removed Jira link.')), 'Jira link removed');
    return;
  }
  const j = parseJira(raw, jiraBaseFor(proj(t)));
  if (!j || !JIRA_KEY_RE.test(j.key)) { toast('No Jira key found. Paste the issue URL or a key like WEB-500.'); return; }
  // Several tickets may link the same Jira issue; the key just can't be another ticket's own ID.
  if (D.tickets.some((o) => o.id !== t.id && (o.auto_key === j.key || (o.aliases || []).includes(j.key)))) { toast(j.key + ' is already used by another ticket'); return; }
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
    const created = changes.length > 0;
    const c = await adapter.insertTicket({ project_id: p.id, title: 'New ticket for ' + j.key, jira_key: j.key, jira_url: j.url });
    const t = c.find((x) => x.table === 'tickets' && x.type === 'INSERT').row;
    const out = changes.concat(c, await note(t, 'id', 'Created from a pasted Jira link.'));
    out.toastAction = changes.toastAction;
    out.created = created ? p.key : null;
    return out;
  }, (c) => (c.created ? `Created Jira project ${c.created} and a ticket for ${j.key}.` : 'Created a ticket for ' + j.key));
  if (ch) openTicket(ch.find((x) => x.table === 'tickets' && x.type === 'INSERT').row.id);
}
async function newTicket(status = null) {
  if (!guard()) return;
  const cur = st.nav.startsWith('p:') ? st.nav.slice(2) : null;
  const def = D.projects.find((p) => p.key === cur) || D.projects.find((p) => p.key === 'INB') || D.projects.find((p) => p.key === 'RLY') || D.projects[0];
  if (!def) { toast('There are no projects yet.'); return; }
  const v = await ask({
    title: status ? `New ticket in ${SBY[status].name}` : 'New ticket', ok: 'Create',
    fields: [
      { id: 'title', label: 'Title', placeholder: 'What needs doing?', required: true },
      { id: 'project', label: 'Project', type: 'select', value: def.id, options: D.projects.map((p) => ({ value: p.id, label: projLabel(p) })) },
      { id: 'type', label: 'Type', type: 'seg', value: 'dev', options: [{ value: 'dev', label: 'Dev', icon: I_CODE }, { value: 'bug', label: 'Bug', icon: I_BUG }] },
    ],
  });
  if (!v) return;
  const f = { project_id: v.project, title: v.title, type: v.type === 'bug' ? 'bug' : 'dev' };
  if (status) f.status = status;
  const ch = await run(() => adapter.insertTicket(f), (c) => 'Created ' + c.find((x) => x.table === 'tickets' && x.type === 'INSERT').row.auto_key);
  if (ch) openTicket(ch.find((x) => x.table === 'tickets' && x.type === 'INSERT').row.id);
}

/* ---------- ticket panel ---------- */

function kickoff(t) { return `Continue ${disp(t)}.`; }
function ticketUrl(t) {
  return location.origin + location.pathname + '?' + (isDemo() ? 'demo&' : '') + 't=' + encodeURIComponent(disp(t));
}
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
const LINK_LABEL = { branch: 'Branch', pr: 'PR', live: 'Live', test: 'Test' };
function linkEntries(t) { return Object.entries(t.links || {}).filter(([, v]) => v != null && v !== ''); }
function linkValue(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const href = safeHref(s);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"><code>${esc(s)}</code></a>` : `<code>${esc(s)}</code>`;
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
  const was = st.openId;
  st.openId = id;
  st.sideOpen = false;
  if (!was || wide()) render();
  renderDrawer(true);
}
function closeDrawer() {
  const id = st.openId;
  st.openId = null;
  $('drawerhost').innerHTML = '';
  render();
  // Focus goes back to the row or card the ticket was opened from.
  if (id) document.querySelector(`#out [data-open="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
function stepTicket(d) {
  const i = st.order.indexOf(st.openId);
  if (i < 0) return;
  const n = st.order[i + d];
  if (n) { openTicket(n); document.querySelector(`#out [data-open="${CSS.escape(n)}"]`)?.scrollIntoView({ block: 'nearest' }); }
}
function renderDrawer(fresh = false) {
  const x = D.tby.get(st.openId);
  const host = $('drawerhost');
  if (!x) { st.openId = null; host.innerHTML = ''; return; }
  // Keep what's being typed when a live update re-renders the panel.
  const keep = fresh ? null : { note: $('d-note')?.value, focus: document.activeElement?.id, scroll: host.querySelector('.db')?.scrollTop };
  const p = proj(x);
  const par = x.parent_id ? D.tby.get(x.parent_id) : null;
  const kids = kidsOf(x);
  const isP = kids.length > 0;
  const kdone = kids.filter((c) => c.status === 'done').length;
  const allFiles = isP ? [...filesOf(x), ...kids.flatMap(filesOf)] : filesOf(x);
  const wk = isP ? kids.find((c) => c.status === 'waiting') : null;
  const sessions = D.sessions.get(x.id) || [];
  const docs = D.docs.get(x.id) || [];
  const links = linkEntries(x);
  const log = D.events.get(x.id) || [];
  const jiraHref = safeHref(x.jira_url);
  const ro = st.readOnly ? 'disabled' : '';
  const jiraish = p.kind === 'jira' || p.key === INBOX;
  const i = st.order.indexOf(x.id);
  const prPr = x.links?.pr ? String(x.links.pr) : '';
  const prHref = safeHref(prPr);
  const prText = prPr ? (prPr.match(/\/pull\/(\d+)/) ? '#' + prPr.match(/\/pull\/(\d+)/)[1] : prPr.replace(/^PR\s*/i, '')) : '';
  const tab = st.tab;
  const tabs = [['brief', isP ? 'Plan' : 'Brief', null], ['sessions', 'Sessions', sessions.length], ['files', 'Files', allFiles.length], ['links', 'Links', docs.length + links.length], ['activity', 'Activity', null]];
  const panel = (id, html) => `<div class="tp" role="tabpanel" id="tp-${id}" aria-labelledby="tab-${id}" ${tab === id ? '' : 'hidden'}><div class="tp-h">${esc(tabs.find((t) => t[0] === id)[1])}</div>${html}</div>`;
  const nextStep = x.next_step && !(x.brief || '').includes(x.next_step) ? `<div class="nextstep"><div class="k">Next step</div><div class="mdl"><p>${esc(x.next_step)}</p></div></div>` : '';
  const updatedBy = isAdam(x.updated_by) ? 'you' : /^hook/.test(x.updated_by || '') ? 'a hook' : 'Claude';

  host.innerHTML = `<div class="scrim" data-close></div><section class="drawer" role="dialog" aria-labelledby="dtitle">
   <div class="grabber" aria-hidden="true"></div>
   <div class="dh">${sq(p.colour)}<span class="pn">${esc(p.name)}</span><span class="slash">/</span><span class="did">${x.jira_key && jiraHref ? `<a href="${esc(jiraHref)}" target="_blank" rel="noopener noreferrer" title="Open in Jira">${esc(x.jira_key)}</a>` : esc(disp(x))}</span>
     <button class="ib sm" id="d-link-copy" aria-label="Copy ticket link" title="Copy link">${I_LINK}</button>
     <span class="spacer"></span>
     <button class="btn draft" id="d-draft" aria-haspopup="dialog">${I_MAIL}Draft update</button>
     <button class="ib nav2" id="d-prev" aria-label="Previous ticket" ${i > 0 ? '' : 'disabled'}>${I_UP}</button>
     <button class="ib nav2" id="d-next" aria-label="Next ticket" ${i >= 0 && i < st.order.length - 1 ? '' : 'disabled'}>${I_DOWN}</button>
     <button class="ib" id="d-more" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">${I_MORE}</button>
     <button class="ib x" data-close aria-label="Close ticket (Esc)">${I_CLOSE}</button></div>
   <div class="db">
    <h2 id="dtitle" class="dtitle" ${st.readOnly ? '' : 'tabindex="0" title="Rename"'}>${x.type === 'bug' ? bugMark() : ''}${esc(x.title)}</h2>
    ${x.needs_wrapup ? '<div><span class="flag">Closed without wrap-up</span></div>' : ''}
    ${x.status === 'waiting' ? `<section class="wbox"><div style="flex:1;min-width:0"><div class="l">${sicon('waiting', 14)}What I need from you</div><p>${esc(x.need)}</p></div><div class="acts">${wk ? `<button class="btn ink" data-goto="${wk.id}">Open ${esc(disp(wk))}</button>` : `<button class="btn ink" id="d-did" ${ro}>I've done this</button><button class="btn chg" id="d-need" ${ro}>Change</button>`}</div></section>` : ''}
    <div class="props">
      <dl>
        <div class="prop"><dt>Status</dt><dd>${isP ? `${sicon(x.status)}<span>${SBY[x.status].name}</span> <span class="sub">· set by its phases</span>` : `<button class="pbtn" id="d-status" ${ro} aria-haspopup="menu">${sicon(x.status)}<span>${SBY[x.status].name}</span><span class="car">${I_CARET}</span></button>`}</dd></div>
        <div class="prop"><dt>Type</dt><dd><button class="pbtn ${x.type === 'bug' ? 'bugc' : 'devc'}" id="d-type" ${ro} aria-haspopup="menu">${x.type === 'bug' ? I_BUG : I_CODE}<span>${x.type === 'bug' ? 'Bug' : 'Dev'}</span><span class="car">${I_CARET}</span></button></dd></div>
        <div class="prop"><dt>Project</dt><dd>${x.parent_id ? `${sq(p.colour)}<span>${esc(p.name)}</span> <span class="sub">· moves with its parent</span>` : `<button class="pbtn" id="d-proj" ${ro} aria-haspopup="menu">${sq(p.colour)}<span>${esc(p.name)}</span><span class="car">${I_CARET}</span></button>`}</dd></div>
        ${isP ? '' : `<div class="prop"><dt>Parent</dt><dd><button class="pbtn ${par ? '' : 'none'}" id="d-parent" ${ro} aria-haspopup="menu"><span>${par ? esc(disp(par) + ' · ' + par.title) : 'None'}</span><span class="car">${I_CARET}</span></button></dd></div>`}
      </dl>
      <dl>
        <div class="prop"><dt>Branch</dt>${x.links?.branch ? `<dd class="mono" title="${esc(x.links.branch)}">${esc(x.links.branch)}</dd>` : '<dd class="sub">None</dd>'}</div>
        <div class="prop"><dt>PR</dt><dd>${prPr ? (prHref ? `<a class="mono" href="${esc(prHref)}" target="_blank" rel="noopener noreferrer" style="font-size:12.5px;text-decoration:none">${esc(prText)}</a>` : `<span class="mono" style="font-size:12.5px">${esc(prText)}</span>`) : '<span class="sub">None</span>'}</dd></div>
        <div class="prop"><dt>Updated</dt><dd style="color:var(--fg-3)">${esc(ago(when(x)))} by ${updatedBy}</dd></div>
        ${jiraish ? `<div class="prop"><dt>Jira</dt><dd>${x.jira_key ? (jiraHref ? `<a class="mono" href="${esc(jiraHref)}" target="_blank" rel="noopener noreferrer" style="font-size:12.5px">${esc(x.jira_key)} ↗</a>` : `<span class="mono">${esc(x.jira_key)}</span>`) : `<button class="pbtn none" id="d-jira-add" ${ro}><span>${p.key === INBOX ? 'Link an issue' : 'None'}</span></button>`}</dd></div>
        <div class="prop"><dt>Relay ID</dt><dd class="mono">${esc(x.auto_key)}${(x.aliases || []).length ? ` · was ${esc(x.aliases.join(', '))}` : ''}</dd></div>` : ''}
      </dl>
    </div>
    <div class="kick"><span class="l">Pick up in a new session</span><code id="d-kick">${esc(kickoff(x))}</code><button class="btn" id="d-copy">${I_COPY}Copy</button></div>
    ${isP ? `<div class="phl"><div class="ph-h">Phases<span class="prog"><span class="bar4"><i style="width:${Math.round((kdone / kids.length) * 100)}%"></i></span><span class="mono">${kdone}/${kids.length}</span></span></div><div class="rows">${kids.map((c) => row(c, { phase: true })).join('')}</div><button class="btn ghost add" id="d-addphase" ${ro}>${I_PLUS}Add phase</button></div>` : ''}
    <div>
      <div class="tabs" role="tablist" aria-label="Ticket detail">${tabs.map(([id, label, n]) => `<button class="tab" role="tab" id="tab-${id}" aria-controls="tp-${id}" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}" data-tab="${id}">${label}${n ? `<span class="c">${n}</span>` : ''}</button>`).join('')}</div>
      ${panel('brief', (x.brief && x.brief.trim() ? `<div class="mdl">${renderMarkdown(x.brief)}</div>` : `<div class="empty-t">No ${isP ? 'plan' : 'brief'} yet. Claude writes it when a session picks this ticket up.</div>`) + nextStep)}
      ${panel('sessions', isP && !sessions.length ? '<div class="empty-t">Sessions are logged on each phase.</div>' : sessions.length ? `<ol class="sess">${sessions.slice().reverse().map((s) => `<li><div class="h"><span>${ago(s.ended_at || s.started_at)} · ${esc(s.machine || 'Session')}</span><span>${esc(CLOSED_BY[s.closed_by] || (s.ended_at ? '' : 'In progress'))}</span></div>${s.summary ? `<div>${esc(s.summary)}</div>` : ''}${s.open_items ? `<div class="open">Left open: ${esc(s.open_items)}</div>` : ''}${(s.prs || []).length || (s.commits || []).length ? `<div class="open mono" style="font-size:11.5px">${esc([...(s.prs || []).map((v) => 'PR ' + v), ...(s.commits || []).map((c) => c.slice(0, 7))].join(' · '))}</div>` : ''}</li>`).join('')}</ol>` : '<div class="empty-t">No sessions yet.</div>')}
      ${panel('files', allFiles.length ? `<div class="files">${isP ? '<p class="hint" style="margin-top:8px">Across all phases.</p>' : ''}${fileGroups(allFiles)}</div>` : '<div class="empty-t">No files changed yet.</div>')}
      ${panel('links', docs.length || links.length ? `<div class="lk">${docs.map((d) => `<div class="frow"><code>${esc(d.path)}</code><span class="kind">${esc(d.label || 'Reference doc')}</span><button class="cp" data-copy="${esc(d.path)}">Copy path</button></div>`).join('')}${links.map(([k, v]) => `<div class="frow"><span>${linkValue(v)}</span><span class="k">${esc(LINK_LABEL[k] || k)}</span><span></span></div>`).join('')}</div>` : '<div class="empty-t">No reference docs or links yet.</div>')}
      ${panel('activity', log.length ? `<ul class="log">${log.map((l) => `<li><span class="d ${isAdam(l.actor) ? 'you' : ''}">${isAdam(l.actor) ? esc(initials(st.user?.name || 'A').slice(0, 1)) : /^hook/.test(l.actor) ? 'H' : 'C'}</span><div><div class="who">${esc(actorLabel(l.actor))} · ${ago(l.at)}</div><div class="b">${logBody(l)}</div>${l.kind === 'note' && isAdam(l.actor) ? `<div class="dlv ${l.seen_at ? 'seen' : ''}">${l.seen_at ? '✓ Seen by session' : 'Not picked up yet'}</div>` : ''}</div></li>`).join('')}</ul>` : '<div class="empty-t">Nothing yet.</div>')}
    </div>
   </div>
   <div class="dnote"><label><span class="sr">Note to Claude</span><textarea id="d-note" rows="1" placeholder="Note to Claude — the next session reads it first" ${ro}></textarea><button class="send" id="d-addnote" aria-label="Send note" ${ro}>${I_SEND}</button></label></div>
  </section>`;

  const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
  on('d-did', 'onclick', () => didThis(x));
  on('d-need', 'onclick', () => changeNeed(x));
  on('d-addphase', 'onclick', () => addPhase(x));
  on('d-status', 'onclick', (e) => openMenu(e.currentTarget, STATUSES.map((s) => ({ label: s.name, icon: sicon(s.id), checked: s.id === x.status, run: () => setStatus(x, s.id) }))));
  on('d-type', 'onclick', (e) => openMenu(e.currentTarget, TYPES.map((ty) => ({ label: ty.name, icon: ty.id === 'bug' ? I_BUG : I_CODE, cls: ty.id === 'bug' ? 'bugc' : '', checked: ty.id === (x.type || 'dev'), run: () => setType(x, ty.id) }))));
  on('d-proj', 'onclick', (e) => projectMenu(e.currentTarget, x));
  on('d-parent', 'onclick', (e) => parentMenu(e.currentTarget, x));
  on('d-jira-add', 'onclick', () => askJira(x));
  on('d-more', 'onclick', (e) => moreMenu(e.currentTarget, x));
  on('d-prev', 'onclick', () => stepTicket(-1));
  on('d-next', 'onclick', () => stepTicket(1));
  on('d-draft', 'onclick', () => openDraft(x));
  on('d-link-copy', 'onclick', () => copy(ticketUrl(x), 'Link copied'));
  on('d-addnote', 'onclick', () => sendNote(x, $('d-note').value.trim()));
  on('d-note', 'onkeydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendNote(x, $('d-note').value.trim()); } });
  on('d-copy', 'onclick', () => copy($('d-kick').textContent, 'Kickoff copied', $('d-kick')));
  host.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, 'Path copied')));
  host.querySelectorAll('.drawer [data-open], .drawer [data-goto]').forEach((b) => (b.onclick = () => openTicket(b.dataset.open || b.dataset.goto)));
  host.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeDrawer));
  const tabBtns = [...host.querySelectorAll('[data-tab]')];
  const pick = (b) => {
    st.tab = b.dataset.tab;
    save('relay-ticket-tab', st.tab);
    tabBtns.forEach((o) => { o.setAttribute('aria-selected', o === b); o.tabIndex = o === b ? 0 : -1; });
    host.querySelectorAll('.tp').forEach((pn) => (pn.hidden = pn.id !== 'tp-' + st.tab));
  };
  tabBtns.forEach((b, k) => {
    b.onclick = () => pick(b);
    b.onkeydown = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabBtns[(k + (e.key === 'ArrowRight' ? 1 : -1) + tabBtns.length) % tabBtns.length];
      pick(n);
      n.focus();
    };
  });
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
      const save2 = () => { if (gone) return; gone = true; rename(x, inp.value.trim()); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') save2(); if (e.key === 'Escape') { e.stopPropagation(); gone = true; renderDrawer(); } };
      inp.onblur = save2;
    };
    h2.onclick = edit;
    h2.onkeydown = (e) => { if (e.key === 'Enter') edit(); };
  }

  if (keep) {
    if (keep.note && $('d-note')) $('d-note').value = keep.note;
    if (keep.scroll) host.querySelector('.db').scrollTop = keep.scroll;
    if (keep.focus && $(keep.focus) && !$('pophost').innerHTML) $(keep.focus).focus({ preventScroll: true });
  } else {
    host.querySelector('.x').focus({ preventScroll: true });
  }
}
function projectMenu(anchor, x) {
  const items = D.projects.filter((o) => !o.archived || o.id === x.project_id)
    .map((o) => ({ label: projLabel(o) + (o.kind === 'jira' ? ' (Jira)' : ''), icon: sq(o.colour), checked: o.id === x.project_id, run: () => moveProject(x, o.id) }));
  openMenu(anchor, [{ heading: `Move ${disp(x)} to` }, ...items, 'sep', { label: 'New project…', icon: I_PLUS, run: () => moveProject(x, '__new') }]);
}
function parentMenu(anchor, x) {
  const parents = D.tickets.filter((o) => o.project_id === x.project_id && o.id !== x.id && !o.parent_id && (!hidden(o) || o.id === x.parent_id)).sort((a, b) => a.seq - b.seq);
  openMenu(anchor, [{ heading: 'Parent (same project)' }, { label: 'None', checked: !x.parent_id, run: () => x.parent_id && setParent(x, null) },
    ...parents.map((o) => ({ label: `${disp(o)} · ${o.title}`, checked: o.id === x.parent_id, run: () => o.id !== x.parent_id && setParent(x, o.id) }))]);
}
async function askJira(x) {
  const v = await ask({ title: `${disp(x)}: Jira issue`, ok: x.jira_key ? 'Update' : 'Link', fields: [{ id: 'jira', label: 'Jira link or key', value: x.jira_url || x.jira_key || '', placeholder: 'Paste the issue URL or a key like WEB-500', required: true,
    hint: proj(x).key === INBOX ? 'Linking moves this ticket into that Jira project, and the Jira ID becomes its display ID.' : '' }] });
  if (v) linkJira(x, v.jira);
}
function moreMenu(anchor, x) {
  const p = proj(x);
  const ro = st.readOnly;
  const items = [
    { label: 'Rename', icon: I_PENCIL, disabled: ro, run: () => $('dtitle')?.click() },
    ...(x.parent_id ? [] : [{ label: 'Move to project…', icon: I_GRID, disabled: ro, run: () => projectMenu(anchor, x) }]),
    ...(isParent(x) ? [] : [{ label: 'Set parent…', icon: I_ALL, disabled: ro, run: () => parentMenu(anchor, x) }]),
    { label: x.archived_at ? 'Unarchive' : 'Archive', icon: I_ARCH, disabled: ro, run: () => toggleArchive(x) },
  ];
  if (p.kind === 'jira' || p.key === INBOX) {
    items.push('sep', { label: x.jira_key ? 'Change Jira link…' : 'Link Jira issue…', icon: I_LINK, disabled: ro, run: () => askJira(x) });
    if (x.jira_key) items.push({ label: 'Remove Jira link', icon: I_CLOSE, cls: 'danger', disabled: ro, run: () => linkJira(x, '') });
  }
  if (phone()) items.unshift({ label: 'Draft update', icon: I_MAIL, run: () => openDraft(x) }, { label: 'Copy link', icon: I_LINK, run: () => copy(ticketUrl(x), 'Link copied') }, 'sep');
  openMenu(anchor, items, { how: 'below-end' });
}

/* ---------- draft update ---------- */

// Relay calls no AI, so the words come from the ticket's plain-English summary,
// which Claude sessions keep up to date (`relay summary`, /close). The status
// adds a plain line on what happens next. Nothing is saved or sent.
const NEXT_LINE = {
  backlog: "It's on the list, but work on it hasn't started yet.",
  next: "It's next in line, and work on it starts soon.",
  progress: 'Work on it is under way.',
  waiting: "It's with me for one last check before it goes any further.",
  testing: "It's being tested now, and it goes live once that passes.",
  done: 'This is now finished.',
};
function draftText(t, kind) {
  const sum = String(t.summary_plain || '').trim();
  const next = NEXT_LINE[t.status] || '';
  if (kind === 'teams') return `${t.title}: ${sum}\n\n${next}`;
  const closing = t.status === 'done' ? "Let me know if you notice anything else." : "I'll let you know as soon as it's done.";
  return `Hi [NAME],\n\n${sum}\n\nWhat happens next: ${next}\n\n${closing}\n\nThanks,\nAdam`;
}
function openDraft(t) {
  closePop();
  const host = $('modalhost');
  const back = document.activeElement;
  const has = !!String(t.summary_plain || '').trim();
  let kind = 'email';
  const text = { email: draftText(t, 'email'), teams: draftText(t, 'teams') };
  let subject = `Update: ${t.title}`;
  const close = () => { host.innerHTML = ''; back?.focus?.({ preventScroll: true }); };
  const draw = () => {
    host.innerHTML = `<div class="scrim" data-cancel style="z-index:40"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dr-h">
      <div class="dlg-h"><div><h2 id="dr-h">Draft an update</h2><div class="sub"><span class="mono">${esc(disp(t))}</span> · ${esc(t.title)}</div></div><button class="ib x" data-cancel aria-label="Close">${I_CLOSE}</button></div>
      <div class="dlg-b">
        <div class="dtabs"><div class="seg" role="group" aria-label="Format"><button aria-pressed="${kind === 'email'}" data-kind="email">${I_MAIL}Email</button><button aria-pressed="${kind === 'teams'}" data-kind="teams">${I_CHAT}Teams message</button></div><span class="hint">Plain English, no technical detail</span></div>
        ${has ? `${kind === 'email' ? `<div class="field"><label class="lbl" for="dr-subj">Subject</label><div class="subj"><input id="dr-subj" value="${esc(subject)}"><button class="btn" id="dr-subj-copy">${I_COPY}Copy</button></div></div>` : ''}
        <div class="field"><label class="lbl" for="dr-msg">Message</label><textarea id="dr-msg">${esc(text[kind])}</textarea></div>
        <p class="note">Written from the ticket's plain-English summary, which Claude keeps up to date at each <code>/close</code>. Edit freely before copying; nothing is saved or sent.</p>`
        : `<div class="nosum">No plain-English summary yet. Ask Claude to run <code>relay summary ${esc(t.auto_key)}</code> or <code>/close</code> on this ticket.</div>`}
      </div>
      <div class="dlg-f"><span class="spacer"></span><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" id="dr-copy" ${has ? '' : 'disabled'}>${I_COPY}Copy message</button></div>
    </div>`;
    host.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = close));
    host.querySelector('.dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    host.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { keepEdits(); kind = b.dataset.kind; draw(); host.querySelector(`[data-kind="${kind}"]`).focus(); }));
    if ($('dr-subj-copy')) $('dr-subj-copy').onclick = () => copy($('dr-subj').value, 'Subject copied');
    $('dr-copy').onclick = () => { keepEdits(); copy(text[kind], kind === 'email' ? 'Email copied' : 'Teams message copied'); };
  };
  const keepEdits = () => {
    if ($('dr-msg')) text[kind] = $('dr-msg').value;
    if ($('dr-subj')) subject = $('dr-subj').value;
  };
  draw();
  host.querySelector('[data-kind="email"]').focus();
}

/* ---------- projects and groups ---------- */

let pgEdit = null; // { kind: 'project'|'group', id }
function openProjects() {
  closePop();
  const back = document.activeElement;
  const host = $('modalhost');
  const close = () => { host.innerHTML = ''; pgEdit = null; back?.focus?.({ preventScroll: true }); };
  const draw = () => {
    derive();
    const projects = store.rows('projects').filter((p) => !p.archived);
    const groupOpts = (p) => D.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === p.group_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
    const prow = (p) => {
      const editing = pgEdit?.kind === 'project' && pgEdit.id === p.id;
      return `<div class="prj${p.key === INBOX ? ' inbox' : ''}" data-pid="${esc(p.id)}" draggable="${!editing && p.key !== INBOX}">
        <span class="grip" aria-hidden="true">${p.key === INBOX ? '' : I_GRIP}</span>
        <label class="sw" style="--pc:${esc(p.colour)}" title="Colour"><span class="sr">Colour for ${esc(p.key)}</span><input type="color" data-colour="${esc(p.id)}" value="${esc(/^#[0-9a-f]{6}$/i.test(p.colour) ? p.colour : '#64748B')}"></label>
        <span class="key">${esc(p.key)}</span>
        ${editing ? `<div class="nmw"><input id="pg-name" value="${esc(p.name === p.key ? '' : p.name)}" placeholder="${esc(p.key)}" aria-label="Name for ${esc(p.key)}"><div class="prev" id="pg-prev">Shows as <b>${esc(projLabel(p))}</b></div></div>`
          : `<button class="nm" data-rename="${esc(p.id)}" title="Rename">${esc(p.name)}</button>`}
        ${p.key === INBOX ? '<span class="last">Always last</span>' : `<select data-group="${esc(p.id)}" aria-label="Group for ${esc(p.key)}">${groupOpts(p)}</select>`}
      </div>`;
    };
    const gsec = (g) => {
      const list = projects.filter((p) => p.group_id === g.id && p.key !== INBOX).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
      const editing = pgEdit?.kind === 'group' && pgEdit.id === g.id;
      return `<section class="pg" data-gid="${esc(g.id)}">
        <div class="pgh" draggable="${!editing}" data-gdrag="${esc(g.id)}"><span class="grip" aria-hidden="true">${I_GRIP}</span>${editing ? `<input id="pg-gname" value="${esc(g.name)}" aria-label="Group name">` : `<span>${esc(g.name)}</span><span class="c">${list.length}</span>`}<span class="spacer"></span>
          <button class="ib" data-grename="${esc(g.id)}" aria-label="Rename group ${esc(g.name)}">${I_PENCIL}</button>
          ${!list.length || !g.default_kind ? `<button class="ib" data-gdel="${esc(g.id)}" aria-label="Delete group ${esc(g.name)}">${I_TRASH}</button>` : ''}</div>
        ${list.map(prow).join('') || '<p class="hint" style="padding:4px 30px 8px">No projects. Drag one here, or pick this group in a project\'s Group menu.</p>'}
      </section>`;
    };
    const rest = projects.filter((p) => p.key === INBOX || !p.group_id || !D.gby.has(p.group_id));
    host.innerHTML = `<div class="scrim" data-cancel style="z-index:40"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="pg-h">
      <div class="dlg-h"><div><h2 id="pg-h">Projects and groups</h2><div class="sub">Drag to reorder. Groups are how the rail is arranged; a project's kind (Jira or app) doesn't change.</div></div><button class="ib x" data-cancel aria-label="Close">${I_CLOSE}</button></div>
      <div class="dlg-b" id="pg-body">${D.groups.map(gsec).join('')}${rest.length ? `<section class="pg">${rest.map(prow).join('')}</section>` : ''}
        <button class="newgrp" id="pg-newgrp" ${st.readOnly ? 'disabled' : ''}>${I_PLUS}New group</button></div>
      <div class="dlg-f"><button class="linkbtn" id="pg-newproj" ${st.readOnly ? 'disabled' : ''}>+ New project</button><span class="spacer"></span><button class="btn ink" data-cancel>Done</button></div>
    </div>`;
    host.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = close));
    const dlg = host.querySelector('.dlg');
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pgEdit) { e.stopPropagation(); close(); } });
    const write = async (fn) => { const ch = await run(fn); draw(); return ch; };
    host.querySelectorAll('[data-colour]').forEach((inp) => (inp.onchange = () => write(() => adapter.updateProject(inp.dataset.colour, { colour: inp.value.toUpperCase() }))));
    host.querySelectorAll('[data-group]').forEach((sel) => (sel.onchange = () => {
      const max = Math.max(0, ...store.rows('projects').filter((p) => p.group_id === sel.value).map((p) => p.sort ?? 0));
      write(() => adapter.updateProject(sel.dataset.group, { group_id: sel.value, sort: max + 10 }));
    }));
    host.querySelectorAll('[data-rename]').forEach((b) => (b.onclick = () => { if (st.readOnly) return; pgEdit = { kind: 'project', id: b.dataset.rename }; draw(); $('pg-name').focus(); }));
    host.querySelectorAll('[data-grename]').forEach((b) => (b.onclick = () => { if (st.readOnly) return; pgEdit = { kind: 'group', id: b.dataset.grename }; draw(); $('pg-gname').focus(); $('pg-gname').select(); }));
    host.querySelectorAll('[data-gdel]').forEach((b) => (b.onclick = () => deleteGroup(b.dataset.gdel, draw)));
    const nameIn = $('pg-name');
    if (nameIn) {
      const p = D.pby.get(pgEdit.id);
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        const v = nameIn.value.trim() || p.key;
        pgEdit = null;
        if (ok && v !== p.name) write(() => adapter.updateProject(p.id, { name: v })); else draw();
      };
      nameIn.oninput = () => { $('pg-prev').innerHTML = `Shows as <b>${esc(projLabel({ ...p, name: nameIn.value.trim() || p.key }))}</b>`; };
      nameIn.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
      nameIn.onblur = () => finish(true);
    }
    const gIn = $('pg-gname');
    if (gIn) {
      const g = D.gby.get(pgEdit.id);
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        const v = gIn.value.trim();
        pgEdit = null;
        if (ok && v && v !== g.name) write(() => adapter.updateGroup(g.id, { name: v })); else draw();
      };
      gIn.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
      gIn.onblur = () => finish(true);
    }
    $('pg-newgrp').onclick = async () => {
      const ch = await run(() => adapter.insertGroup({ name: 'New group', sort: Math.max(0, ...D.groups.map((g) => g.sort ?? 0)) + 10 }));
      const g = ch?.find((c) => c.table === 'project_groups')?.row;
      if (g) pgEdit = { kind: 'group', id: g.id };
      draw();
      if ($('pg-gname')) { $('pg-gname').focus(); $('pg-gname').select(); }
    };
    $('pg-newproj').onclick = async () => { host.innerHTML = ''; await newProject(); draw(); };
    bindProjectDrag(host, write);
  };
  draw();
  host.querySelector('.dlg .x').focus();
}
async function deleteGroup(gid, redraw) {
  const g = D.gby.get(gid);
  const list = store.rows('projects').filter((p) => p.group_id === gid);
  const others = D.groups.filter((o) => o.id !== gid);
  if (list.length) {
    if (!others.length) { toast('Make another group first, so its projects have somewhere to go.'); return; }
    const host = $('modalhost');
    const saved = host.innerHTML;
    const v = await ask({ title: `Delete ${g.name}`, ok: 'Move and delete', fields: [{ id: 'to', label: `Move its ${list.length} project${list.length > 1 ? 's' : ''} to`, type: 'select', value: others[0].id, options: others.map((o) => ({ value: o.id, label: o.name })) }] });
    if (saved) { /* ask() replaced the dialog; redraw puts it back */ }
    if (!v) { redraw(); return; }
    const max = Math.max(0, ...store.rows('projects').filter((p) => p.group_id === v.to).map((p) => p.sort ?? 0));
    await run(async () => {
      const ch = [];
      for (const [k, p] of list.entries()) ch.push(...(await adapter.updateProject(p.id, { group_id: v.to, sort: max + 10 * (k + 1) })));
      return ch.concat(await adapter.deleteGroup(gid));
    }, `Deleted ${g.name}`);
  } else {
    await run(() => adapter.deleteGroup(gid), `Deleted ${g.name}`);
  }
  redraw();
}
// Drag a project within or between groups (drop on a project: before it; on a
// group's heading: to the end), or a group by its handle. Each move rewrites the
// sort of the rows it changed, in steps of 10.
function bindProjectDrag(host, write) {
  let drag = null;
  host.querySelectorAll('.prj[data-pid]').forEach((el) => {
    el.ondragstart = (e) => { drag = { kind: 'p', id: el.dataset.pid }; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', el.dataset.pid); } catch { /* some browsers */ } };
    el.ondragend = () => { drag = null; host.querySelectorAll('.dragging,.drop,.drop-g').forEach((n) => n.classList.remove('dragging', 'drop', 'drop-g')); };
  });
  host.querySelectorAll('[data-gdrag]').forEach((el) => {
    el.ondragstart = (e) => { if (drag) return; drag = { kind: 'g', id: el.dataset.gdrag }; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', el.dataset.gdrag); } catch { /* some browsers */ } };
    el.ondragend = () => { drag = null; host.querySelectorAll('.drop,.drop-g').forEach((n) => n.classList.remove('drop', 'drop-g')); };
  });
  const body = $('pg-body');
  body.ondragover = (e) => {
    if (!drag) return;
    const pr = e.target.closest('.prj[data-pid]');
    const sec = e.target.closest('.pg[data-gid]');
    host.querySelectorAll('.drop,.drop-g').forEach((n) => n.classList.remove('drop', 'drop-g'));
    if (drag.kind === 'p' && pr && pr.dataset.pid !== drag.id && D.pby.get(pr.dataset.pid)?.key !== INBOX) { e.preventDefault(); pr.classList.add('drop'); }
    else if (sec) { e.preventDefault(); sec.classList.add('drop-g'); }
  };
  body.ondrop = async (e) => {
    if (!drag) return;
    e.preventDefault();
    const d = drag;
    drag = null;
    const pr = e.target.closest('.prj[data-pid]');
    const sec = e.target.closest('.pg[data-gid]');
    if (d.kind === 'g') {
      if (!sec || sec.dataset.gid === d.id) return;
      const order = D.groups.map((g) => g.id).filter((id) => id !== d.id);
      order.splice(order.indexOf(sec.dataset.gid), 0, d.id);
      await write(async () => {
        const ch = [];
        for (const [k, id] of order.entries()) if ((D.gby.get(id).sort ?? 0) !== (k + 1) * 10) ch.push(...(await adapter.updateGroup(id, { sort: (k + 1) * 10 })));
        return ch;
      });
      return;
    }
    const gid = pr ? D.pby.get(pr.dataset.pid)?.group_id : sec?.dataset.gid;
    if (!gid) return;
    const list = store.rows('projects').filter((p) => p.group_id === gid && p.id !== d.id && p.key !== INBOX).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const at = pr ? list.findIndex((p) => p.id === pr.dataset.pid) : list.length;
    list.splice(at < 0 ? list.length : at, 0, D.pby.get(d.id));
    await write(async () => {
      const ch = [];
      for (const [k, p] of list.entries()) {
        const patch = {};
        if ((p.sort ?? 0) !== (k + 1) * 10) patch.sort = (k + 1) * 10;
        if (p.group_id !== gid) patch.group_id = gid;
        if (Object.keys(patch).length) ch.push(...(await adapter.updateProject(p.id, patch)));
      }
      return ch;
    });
  };
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

const typing = (el) => /INPUT|TEXTAREA|SELECT/.test(el?.tagName || '') || el?.isContentEditable;
function setRail(collapsed) {
  st.rail = collapsed;
  save('relay-rail-collapsed', collapsed ? '1' : '0');
  closePop();
  render();
  $('railtoggle')?.focus({ preventScroll: true });
}
function bindShell() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (closePop()) return;
      if ($('notifpanel')) { $('modalhost').innerHTML = ''; return; }
      if ($('modalhost').innerHTML) return;
      if (st.openId) { closeDrawer(); return; }
      if (st.sideOpen) { st.sideOpen = false; render(); $('menubtn').focus(); }
      return;
    }
    const busy = typing(document.activeElement) || $('modalhost').innerHTML || !st.booted;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('modalhost').innerHTML && st.booted) { e.preventDefault(); openSearch(); return; }
    if (busy || e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key === 'Enter' && e.target.dataset?.open && !e.target.closest('.drawer')) { e.preventDefault(); openTicket(e.target.dataset.open); }
      return;
    }
    if (e.key === '/') { e.preventDefault(); openSearch(); return; }
    if (e.key === '[' && !phone()) { e.preventDefault(); setRail(!st.rail); return; }
    if (e.key === '?') { e.preventDefault(); if (document.querySelector('.pop.skills')) closePop(); else openSkills(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.open && !e.target.closest('.drawer') && !e.target.closest('.srch')) { e.preventDefault(); openTicket(e.target.dataset.open); }
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#retry')) { boot(); return; }
    if (t.closest('#signin')) { signIn(); return; }
    if (t.closest('#gate #signout')) { signOut(); return; }
    if (t.closest('#modalhost') || t.closest('#gate') || t.closest('#pophost')) return;
    if (t.closest('#notifbtn')) { st.sideOpen = false; render(); openNotifications(); return; }
    if (t.closest('#skillsbtn')) { if (document.querySelector('.pop.skills')) closePop(); else openSkills(); return; }
    if (t.closest('#acctbtn')) { openAccount($('acctbtn')); return; }
    if (t.closest('#mavatar')) { openAccount($('mavatar')); return; }
    if (t.closest('#railsearch') || t.closest('#msearch')) { openSearch(); return; }
    if (t.closest('#railtoggle')) { setRail(!st.rail); return; }
    if (t.closest('[data-editgroups]')) { st.sideOpen = false; render(); openProjects(); return; }
    const did = t.closest('[data-did]');
    if (did) { const x = D.tby.get(did.dataset.did); if (x) didThis(x); return; }
    const chg = t.closest('[data-chg]');
    if (chg) { const x = D.tby.get(chg.dataset.chg); if (x) changeNeed(x); return; }
    const ni = t.closest('[data-newin]');
    if (ni) { newTicket(ni.dataset.newin); return; }
    if (t.closest('.drawer')) return;
    const xp = t.closest('[data-expand]');
    if (xp) { const k = xp.dataset.expand; st.folded[k] = !st.folded[k]; render(); return; }
    const cl = t.closest('[data-collapse]');
    if (cl) { const s = cl.dataset.collapse; st.collapsed[s] = !st.collapsed[s]; render(); return; }
    const rs = t.closest('[data-railsec]');
    if (rs) {
      const g = D.gby.get(rs.dataset.railsec);
      if (g) st.railFold[g.id] = !folded(g);
      save('relay-rail-fold', JSON.stringify(st.railFold));
      renderRail();
      document.querySelector(`[data-railsec="${CSS.escape(rs.dataset.railsec)}"]`)?.focus();
      return;
    }
    // Choosing a view leaves the phone rail open: the highlight moves and the board behind it updates.
    const nv = t.closest('[data-nav]');
    if (nv) {
      const id = nv.dataset.nav;
      st.nav = id;
      render();
      $('out').scrollTop = 0;
      window.scrollTo(0, 0);
      document.querySelector(`#side [data-nav="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (t.closest('#menubtn')) { st.sideOpen = !st.sideOpen; render(); if (st.sideOpen) $('railclose')?.focus(); return; }
    if (t.closest('#railclose')) { st.sideOpen = false; render(); $('menubtn').focus(); return; }
    if (t.closest('#sidescrim')) { st.sideOpen = false; render(); return; }
    const o = t.closest('[data-open]');
    if (o) openTicket(o.dataset.open);
  });
  const setView = (v) => { st.view = v; save('relay-view-3', v); render(); };
  $('v-list').onclick = () => setView('list');
  $('v-board').onclick = () => setView('board');
  $('newbtn').onclick = () => newTicket();
  $('fab').onclick = () => newTicket();
  // Layout changes with the width: the rail's form, the docked panel, the waiting cards.
  for (const q of ['(max-width:760px)', '(min-width:1101px)']) matchMedia(q).addEventListener?.('change', () => { if (st.booted) { closePop(); render(); } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeColour);

  // Board drag and drop (desktop). Phones change status from the ticket panel.
  let dragId = null;
  const ghost = document.createElement('div');
  ghost.className = 'ghostslot';
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
    ghost.remove();
    document.querySelectorAll('.card.dragging').forEach((n) => n.classList.remove('dragging'));
  });
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('[data-col]');
    if (!col || !dragId) return;
    e.preventDefault();
    if (D.tby.get(dragId)?.status === col.dataset.col) { ghost.remove(); return; }
    if (ghost.parentNode !== col) col.append(ghost);
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest?.('[data-col]');
    if (!col || !dragId) return;
    e.preventDefault();
    ghost.remove();
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
    },
  );
}

/* ---------- pull to refresh ---------- */

// Touch only, so desktop mouse drag and drop never sees it. A pull arms only when it starts in
// the main pane with the page scrolled to the top and no ticket panel, modal or phone rail open.
// A sideways move first (scrolling the board or the waiting cards) or an upward one disarms it.
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
    if (ptrBusy || e.touches.length !== 1 || !st.booted || $('app').hidden || st.openId || st.sideOpen || $('modalhost').innerHTML || $('pophost').innerHTML) return;
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
  $('fab').hidden = true;
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
  $('fab').hidden = false;
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
  $('msearch').innerHTML = I_SEARCH.replace(/width="15" height="15"/, 'width="21" height="21"');
  $('v-list').innerHTML = I_LISTV + '<span class="lbl-t">List</span>';
  $('v-board').innerHTML = I_BOARDV + '<span class="lbl-t">Board</span>';
  $('newbtn').innerHTML = I_PLUS + '<span class="lbl-t">New ticket</span>';
  $('fab').innerHTML = I_PLUS.replace(/width="14" height="14"/, 'width="18" height="18"') + 'New ticket';
  if (isDemo()) {
    $('sampletag').hidden = false;
    document.title = 'Relay · Demo';
  }
  syncThemeColour();
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
