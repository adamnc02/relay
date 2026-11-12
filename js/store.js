// The in-memory copy of the relay tables, patched by adapter results and by
// Realtime. Every apply is idempotent (keyed by primary key), so a change that
// arrives both from a write's response and from Realtime lands once.

export const TABLES = ['projects', 'tickets', 'events', 'sessions', 'ticket_files', 'ticket_docs'];
const keyOf = (table, row) => (table === 'ticket_files' || table === 'ticket_docs' ? `${row.ticket_id}|${row.path}` : String(row.id));

export function createStore() {
  const maps = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
  let version = 0;
  return {
    maps,
    get version() { return version; },
    load(data) {
      for (const t of TABLES) {
        maps[t].clear();
        for (const row of data[t] || []) maps[t].set(keyOf(t, row), row);
      }
      version++;
    },
    apply(changes) {
      for (const c of changes || []) {
        const m = maps[c.table];
        if (!m) continue;
        if (c.type === 'DELETE') {
          const old = c.old || c.row;
          if (old) m.delete(keyOf(c.table, old));
        } else if (c.row) {
          const k = keyOf(c.table, c.row);
          m.set(k, { ...(m.get(k) || {}), ...c.row });
        }
      }
      version++;
    },
    rows(t) { return [...maps[t].values()]; },
    toJSON() { return Object.fromEntries(TABLES.map((t) => [t, [...maps[t].values()]])); },
  };
}

// Offline snapshot: the last loaded data, for read-only use without a network.
// Supabase API responses are never cached by the service worker; this is the
// only copy of row data kept on the device.
const SNAP_KEY = 'relay:snapshot:v1';

export function saveSnapshot(store, userId) {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify({ at: new Date().toISOString(), userId: userId || null, data: store.toJSON() }));
  } catch (e) {
    console.warn('[relay] could not save the offline copy:', e?.message);
  }
}
export function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function clearSnapshot() {
  try { localStorage.removeItem(SNAP_KEY); } catch { /* storage blocked */ }
}
