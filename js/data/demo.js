// In-memory adapter for ?demo. No network, no sign-in. It reproduces the
// database's triggers and checks (ID assignment, done_at, the parent rollup,
// status events, the waiting-needs-a-need rule, Jira-only-on-Jira-projects)
// so the UI behaves exactly as it does against Supabase.

import { buildSample } from './sample.js';
import { rollup, uuid, JIRA_KEY_RE, PROJECT_KEY_RE } from '../model.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

export function createDemoAdapter() {
  const db = buildSample();
  let nextEventId = db.nextEventId;
  let listener = null;
  const nowIso = () => new Date().toISOString();
  const proj = (id) => db.projects.find((p) => p.id === id);
  const tick = (id) => db.tickets.find((t) => t.id === id);

  const fail = (message, code = 'demo') => {
    const e = new Error(message);
    e.code = code;
    throw e;
  };

  function statusEvent(t, from) {
    const e = { id: nextEventId++, ticket_id: t.id, at: nowIso(), actor: t.updated_by, kind: 'status', body: null, from_status: from, to_status: t.status, seen_at: null };
    db.events.push(e);
    return { table: 'events', type: 'INSERT', row: clone(e) };
  }

  function recomputeParent(pid, changes) {
    const p = pid && tick(pid);
    if (!p) return;
    const kids = db.tickets.filter((k) => k.parent_id === pid);
    if (!kids.length) return;
    const r = rollup(kids);
    if (p.status === r.status && (p.need || null) === (r.need || null)) return;
    const from = p.status;
    p.status = r.status;
    p.need = r.need;
    p.updated_at = nowIso();
    p.done_at = r.status === 'done' ? p.done_at || nowIso() : null;
    changes.push({ table: 'tickets', type: 'UPDATE', row: clone(p) });
    if (from !== p.status) changes.push(statusEvent(p, from));
  }

  function check(t) {
    if (t.status === 'waiting' && !String(t.need || '').trim()) fail('Waiting for me needs a "what I need from you" line.', '23514');
    const p = proj(t.project_id);
    if (!p) fail('Unknown project.');
    if ((t.jira_key || t.jira_url) && p.kind !== 'jira') fail('Jira links are only allowed on tickets in Jira projects.', 'P0001');
    if (t.jira_key && !JIRA_KEY_RE.test(t.jira_key)) fail('That is not a valid Jira key.', 'P0001');
    if (t.parent_id) {
      const par = tick(t.parent_id);
      if (!par) fail('Unknown parent.');
      if (par.id === t.id) fail("A ticket can't be its own parent.", 'P0001');
      if (par.parent_id) fail("A phase can't have phases of its own.", 'P0001');
      if (par.project_id !== t.project_id) fail('The parent must be in the same project.', 'P0001');
      if (db.tickets.some((k) => k.parent_id === t.id)) fail("A parent can't become a phase.", 'P0001');
    }
    // Several tickets may share a jira_key; it still can't be another ticket's auto_key or alias.
    const own = [t.auto_key, ...(t.aliases || [])].filter(Boolean);
    for (const o of db.tickets) {
      if (o.id === t.id) continue;
      const theirs = [o.auto_key, ...(o.aliases || [])];
      const clash = own.find((i) => theirs.includes(i) || i === o.jira_key) || (t.jira_key && theirs.includes(t.jira_key) ? t.jira_key : null);
      if (clash) fail(`${clash} is already used by another ticket.`, '23505');
    }
  }

  // Start the parents at their rolled-up state, as the database would hold them.
  for (const p of db.tickets) {
    const kids = db.tickets.filter((k) => k.parent_id === p.id);
    if (kids.length) {
      const r = rollup(kids);
      p.status = r.status;
      p.need = r.need;
      p.done_at = r.status === 'done' ? p.updated_at : null;
    }
  }

  return {
    mode: 'demo',
    readOnly: false,

    async start() {
      return { state: 'ready', user: { name: 'Demo', email: null, initial: 'D' } };
    },
    async signIn() {},
    async signOut() {},

    async loadAll() {
      const { projects, tickets, events, sessions, ticket_files, ticket_docs } = db;
      return clone({ projects, tickets, events, sessions, ticket_files, ticket_docs });
    },

    subscribe(onChange, onStatus) {
      listener = onChange;
      onStatus?.('live');
      return () => { listener = null; };
    },

    async insertProject(f) {
      if (!PROJECT_KEY_RE.test(f.key)) fail(`${f.key} can't be a project key (2 to 10 capitals and digits).`, '23514');
      if (db.projects.some((p) => p.key === f.key)) fail(`Project ${f.key} already exists.`, '23505');
      const p = { id: uuid(), key: f.key, name: f.name, colour: f.colour, kind: f.kind || 'app', jira_base: f.jira_base || null, paths: [], next_seq: 1, archived: false, sort: db.projects.length, created_at: nowIso(), updated_at: nowIso() };
      db.projects.push(p);
      return [{ table: 'projects', type: 'INSERT', row: clone(p) }];
    },

    async insertTicket(f) {
      const p = proj(f.project_id);
      if (!p) fail('Unknown project.');
      const seq = p.next_seq++;
      const auto = `${p.key}-${p.kind === 'jira' ? 'R' : ''}${seq}`;
      const t = {
        id: uuid(), project_id: p.id, seq, auto_key: auto, jira_key: f.jira_key || null, jira_url: f.jira_url || null,
        display_key: f.jira_key || auto, aliases: [], title: f.title, status: f.status || 'backlog', priority: 0,
        need: f.need || null, brief: f.brief || '', next_step: null, parent_id: f.parent_id || null, phase: f.phase ?? null,
        links: {}, updated_by: f.updated_by || 'adam', session_ids: [], needs_wrapup: false, archived_at: null,
        done_at: f.status === 'done' ? nowIso() : null, created_at: nowIso(), updated_at: nowIso(),
      };
      try { check(t); } catch (e) { p.next_seq--; throw e; }
      db.tickets.push(t);
      const changes = [{ table: 'projects', type: 'UPDATE', row: clone(p) }, { table: 'tickets', type: 'INSERT', row: clone(t) }];
      recomputeParent(t.parent_id, changes);
      return changes;
    },

    async updateTicket(id, patch) {
      const t = tick(id);
      if (!t) fail('Ticket not found.');
      const before = clone(t);
      const next = { ...t, ...patch };
      // Moving project re-keys the ticket in its new project; the old ID becomes an alias.
      let moved = null;
      if (next.project_id !== before.project_id) {
        moved = proj(next.project_id);
        if (!moved) fail('Unknown project.');
        next.seq = moved.next_seq;
        next.auto_key = `${moved.key}-${moved.kind === 'jira' ? 'R' : ''}${next.seq}`;
      }
      if (next.auto_key !== before.auto_key && !(next.aliases || []).includes(before.auto_key)) next.aliases = [...(next.aliases || []), before.auto_key];
      next.aliases = (next.aliases || []).filter((a) => a !== next.auto_key);
      const kidsToMove = moved ? db.tickets.filter((k) => k.parent_id === t.id) : [];

      next.display_key = next.jira_key || next.auto_key;
      check(next);
      if (moved) moved.next_seq++;
      if (next.status === 'done' && before.status !== 'done') next.done_at = nowIso();
      if (next.status !== 'done') next.done_at = null;
      next.updated_at = nowIso();
      Object.assign(t, next);
      const changes = [{ table: 'tickets', type: 'UPDATE', row: clone(t) }];
      if (moved) {
        changes.push({ table: 'projects', type: 'UPDATE', row: clone(moved) });
        for (const k of kidsToMove) {
          const old = k.auto_key;
          k.project_id = moved.id;
          k.seq = moved.next_seq++;
          k.auto_key = `${moved.key}-${moved.kind === 'jira' ? 'R' : ''}${k.seq}`;
          k.aliases = [...(k.aliases || []), old];
          k.display_key = k.jira_key || k.auto_key;
          k.updated_at = nowIso();
          changes.push({ table: 'tickets', type: 'UPDATE', row: clone(k) });
        }
      }
      if (before.status !== t.status) changes.push(statusEvent(t, before.status));
      const touches = before.status !== t.status || before.parent_id !== t.parent_id || before.need !== t.need;
      if (touches) {
        recomputeParent(t.parent_id, changes);
        if (before.parent_id && before.parent_id !== t.parent_id) recomputeParent(before.parent_id, changes);
      }
      return changes;
    },

    async insertEvent(f) {
      const e = { id: nextEventId++, ticket_id: f.ticket_id, at: nowIso(), actor: f.actor || 'adam', kind: f.kind, body: f.body ?? null, from_status: null, to_status: null, seen_at: null };
      db.events.push(e);
      return [{ table: 'events', type: 'INSERT', row: clone(e) }];
    },

    // Push needs an account and a server: the demo has neither. The UI shows
    // the demo state and never calls these.
    async savePushSubscription() { fail("The demo can't turn notifications on."); },
    async hasPushSubscription() { return false; },
    async deletePushSubscription() {},
    async sendTestPush() { fail("The demo can't send notifications."); },

    // Not used by the UI; lets a test simulate a Claude session writing.
    _emit(changes) { listener?.(changes); },
  };
}
