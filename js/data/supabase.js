// Supabase adapter: the relay schema over PostgREST, plus Realtime.
// The database owns IDs (auto_key), done_at, the parent rollup and status
// events, so this adapter never writes a parent's status and never sends
// seq, auto_key or display_key.

import { SUPABASE_URL, SUPABASE_ANON_KEY, SCHEMA, redirectTo, SUPABASE_JS_VERSION } from '../config.js';

const TABLES = ['project_groups', 'projects', 'tickets', 'events', 'sessions', 'ticket_files', 'ticket_docs'];
const ATTEMPT_KEY = 'relay:auth:attempt';
const PAGE = 1000;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.supabase?.createClient) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

export function isNetworkError(err) {
  if (!err) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = String(err.message || err);
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|ERR_INTERNET/i.test(m) && !err.code;
}

// Classifies a PostgREST error from the smoke test into an app state.
function classify(error) {
  if (!error) return null;
  if (error.code === 'PGRST106') return { state: 'not-exposed' };
  if (['PGRST205', 'PGRST202', '42P01', '42883', '3F000'].includes(error.code)) return { state: 'not-setup', message: `${error.code}: ${error.message}` };
  if (isNetworkError(error)) return { state: 'offline' };
  if (error.code === '42501') return { state: 'not-owner', message: error.message };
  return { state: 'error', message: `${error.code || 'error'}: ${error.message}` };
}

export function createSupabaseAdapter() {
  let client = null;
  let channel = null;
  let user = null;

  const toUser = (u) => {
    if (!u) return null;
    const name = u.user_metadata?.full_name || u.user_metadata?.name || u.email || 'Signed in';
    return { id: u.id, name, email: u.email || null, initial: (name || '?').trim().charAt(0).toUpperCase() };
  };

  async function fetchAll(table) {
    const order = { events: 'id', ticket_files: 'last_at', ticket_docs: 'added_at', sessions: 'started_at' }[table] || 'created_at';
    let rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client.from(table).select('*').order(order, { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      rows = rows.concat(data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  const one = (table, type) => ({ data, error }) => {
    if (error) throw error;
    return [{ table, type, row: data }];
  };

  async function refetch(ticketIds) {
    const ids = [...new Set(ticketIds.filter(Boolean))];
    if (!ids.length) return [];
    const [t, e, k] = await Promise.all([
      client.from('tickets').select('*').in('id', ids),
      client.from('events').select('*').in('ticket_id', ids).order('id', { ascending: false }).limit(50),
      // Children move (and are re-keyed) with a parent that changes project.
      client.from('tickets').select('*').in('parent_id', ids),
    ]);
    const out = [];
    if (!t.error) t.data.forEach((row) => out.push({ table: 'tickets', type: 'UPDATE', row }));
    if (!e.error) e.data.forEach((row) => out.push({ table: 'events', type: 'INSERT', row }));
    if (!k.error) k.data.forEach((row) => out.push({ table: 'tickets', type: 'UPDATE', row }));
    return out;
  }

  return {
    mode: 'supabase',
    readOnly: false,

    async start() {
      try {
        await loadScript(`./vendor/supabase-js-${SUPABASE_JS_VERSION}.umd.js`);
      } catch (e) {
        return { state: 'offline', message: e.message };
      }
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        db: { schema: SCHEMA },
        // 🚨 Relay's own storageKey. Every app on adamnc02.github.io shares one origin and this Supabase
        // project, so the default key would share Listly's session. One app refreshing the shared token
        // then invalidates the other's copy.
        auth: { storageKey: 'relay.auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });

      const { data, error } = await client.auth.getSession();
      if (error) console.warn('[auth] session check failed:', error.message);
      const session = data?.session || null;
      if (!session) {
        return { state: navigator.onLine === false ? 'offline-signed-out' : 'signed-out', authNote: readAttempt() };
      }
      try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* private mode */ }
      user = toUser(session.user);

      // Smoke test: a real call against the relay schema. PGRST106 means
      // relay is missing from Exposed schemas, which nothing else reports.
      const smoke = await client.from('projects').select('id').limit(1);
      const bad = classify(smoke.error);
      if (bad) return { ...bad, user };

      const own = await client.rpc('is_owner');
      const badOwn = classify(own.error);
      if (badOwn) return { ...badOwn, user };
      if (own.data !== true) return { state: 'not-owner', user };
      if (!smoke.data.length) return { state: 'not-owner', user, message: 'The owner check passed but no projects are visible.' };
      return { state: 'ready', user };
    },

    onAuthChange(cb) {
      client?.auth.onAuthStateChange((event, session) => cb(event, toUser(session?.user)));
    },

    async signIn() {
      // Record the attempt before the page is torn down by the redirect, so a
      // silent failure can be reported when we land back here without a session.
      try {
        sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ at: new Date().toISOString(), redirectTo: redirectTo() }));
      } catch { /* private mode */ }
      const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
      if (error) throw error;
      console.info('[auth] redirecting to Google:', data?.url ? new URL(data.url).origin : '');
      setTimeout(() => {
        if (!document.hidden) console.warn('[auth] still on the page after signInWithOAuth; the redirect did not happen.');
      }, 2500);
    },

    async signOut() {
      channel && client.removeChannel(channel);
      channel = null;
      // scope 'local': the default ('global') revokes every session of the account, signing the same
      // Google user out of Listly, Pinch and the ledger on every device.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) console.warn('[auth] sign-out failed:', error.message);
    },

    async loadAll() {
      const res = await Promise.all(TABLES.map(fetchAll));
      return Object.fromEntries(TABLES.map((t, i) => [t, res[i]]));
    },

    subscribe(onChange, onStatus) {
      if (channel) client.removeChannel(channel);
      channel = client.channel('relay-board');
      for (const table of TABLES) {
        channel.on('postgres_changes', { event: '*', schema: SCHEMA, table }, (p) => {
          onChange([{ table, type: p.eventType, row: p.new && Object.keys(p.new).length ? p.new : null, old: p.old }]);
        });
      }
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') onStatus?.('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('paused');
        else if (status === 'CLOSED') onStatus?.('closed');
      });
      return () => { channel && client.removeChannel(channel); channel = null; };
    },

    async insertProject(f) {
      return one('projects', 'INSERT')(
        await client.from('projects').insert({ key: f.key, name: f.name, colour: f.colour, kind: f.kind, jira_base: f.jira_base || null }).select().single(),
      );
    },

    // name, colour, group_id, sort. kind and key never change from the app.
    async updateProject(id, patch) {
      const clean = {};
      for (const k of ['name', 'colour', 'group_id', 'sort']) if (k in patch) clean[k] = patch[k];
      return one('projects', 'UPDATE')(await client.from('projects').update(clean).eq('id', id).select().single());
    },

    async insertGroup(f) {
      return one('project_groups', 'INSERT')(await client.from('project_groups').insert({ name: f.name, sort: f.sort ?? 0 }).select().single());
    },
    async updateGroup(id, patch) {
      const clean = {};
      for (const k of ['name', 'sort']) if (k in patch) clean[k] = patch[k];
      return one('project_groups', 'UPDATE')(await client.from('project_groups').update(clean).eq('id', id).select().single());
    },
    // The database refuses a group that still has projects (on delete restrict).
    async deleteGroup(id) {
      const { error } = await client.from('project_groups').delete().eq('id', id);
      if (error) throw error;
      return [{ table: 'project_groups', type: 'DELETE', row: null, old: { id } }];
    },

    async insertTicket(f) {
      const row = { project_id: f.project_id, title: f.title, updated_by: 'adam' };
      for (const k of ['status', 'need', 'brief', 'parent_id', 'phase', 'jira_key', 'jira_url', 'type']) if (f[k] != null) row[k] = f[k];
      const changes = one('tickets', 'INSERT')(await client.from('tickets').insert(row).select().single());
      const t = changes[0].row;
      const p = await client.from('projects').select('*').eq('id', t.project_id).single();
      if (!p.error) changes.push({ table: 'projects', type: 'UPDATE', row: p.data });
      return changes.concat(await refetch([t.parent_id]));
    },

    async updateTicket(id, patch, ctx = {}) {
      const clean = { ...patch, updated_by: 'adam' };
      for (const k of ['id', 'seq', 'auto_key', 'display_key', 'created_at', 'updated_at', 'done_at']) delete clean[k];
      const changes = one('tickets', 'UPDATE')(await client.from('tickets').update(clean).eq('id', id).select().single());
      const t = changes[0].row;
      return changes.concat(await refetch([t.id, t.parent_id, ctx.prevParentId]));
    },

    async insertEvent(f) {
      return one('events', 'INSERT')(
        await client.from('events').insert({ ticket_id: f.ticket_id, kind: f.kind, body: f.body ?? null, actor: f.actor || 'adam' }).select().single(),
      );
    },

    // Push: this device's row in relay.push_subscriptions, keyed on the endpoint.
    async savePushSubscription(row) {
      const { error } = await client.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
      if (error) throw error;
    },
    async hasPushSubscription(endpoint) {
      const { data, error } = await client.from('push_subscriptions').select('id').eq('endpoint', endpoint).limit(1);
      if (error) throw error;
      return data.length > 0;
    },
    async deletePushSubscription(endpoint) {
      const { error } = await client.from('push_subscriptions').delete().eq('endpoint', endpoint);
      if (error) throw error;
    },
    // The relay-push function checks the session's JWT and that it is the owner's,
    // then sends a fixed message to this one registered device.
    async sendTestPush(endpoint) {
      const { data, error } = await client.functions.invoke('relay-push', { body: { mode: 'test', endpoint } });
      if (error) {
        let detail = '';
        try { detail = (await error.context?.json())?.error || ''; } catch { /* not JSON */ }
        throw new Error(detail || error.message);
      }
      return data;
    },
  };
}

function readAttempt() {
  try {
    const p = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.search);
    const oauthError = p.get('error_description') || p.get('error');
    if (location.hash.includes('access_token') || oauthError) history.replaceState({}, '', location.pathname);
    if (oauthError) {
      sessionStorage.removeItem(ATTEMPT_KEY);
      return `Sign-in was refused: ${oauthError}`;
    }
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(ATTEMPT_KEY);
    const target = JSON.parse(raw).redirectTo || 'this address';
    return `Sign-in came back without creating a session. Check that ${target}** is in Supabase → Authentication → URL Configuration → Redirect URLs, and that the Google provider is enabled.`;
  } catch {
    return null;
  }
}
