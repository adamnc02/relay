// One data interface, two adapters. The UI only ever talks to the object
// returned here, so ?demo and the live app run identical UI code.
//
// Adapter contract:
//   mode, start() -> { state, user?, message?, authNote? }
//   signIn(), signOut(), onAuthChange?(cb)
//   loadAll() -> { projects, tickets, events, sessions, ticket_files, ticket_docs }
//   subscribe(onChange, onStatus) -> unsubscribe
//   insertProject(f), insertTicket(f), updateTicket(id, patch, ctx), insertEvent(f)
//     each resolves to a list of changes: { table, type: INSERT|UPDATE|DELETE, row, old? }

import { createDemoAdapter } from './demo.js';
import { createSupabaseAdapter } from './supabase.js';

export const isDemo = () => new URLSearchParams(location.search).has('demo');

export function createAdapter() {
  return isDemo() ? createDemoAdapter() : createSupabaseAdapter();
}
