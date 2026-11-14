// One data interface, two adapters. The UI only ever talks to the object
// returned here, so ?demo and the live app run identical UI code.
//
// Adapter contract:
//   mode, start() -> { state, user?, message?, authNote? }
//   signIn(), signOut(), onAuthChange?(cb)
//   loadAll() -> { project_groups, projects, tickets, events, sessions, ticket_files, ticket_docs }
//   subscribe(onChange, onStatus) -> unsubscribe
//   insertProject(f), updateProject(id, patch), insertGroup(f), updateGroup(id, patch), deleteGroup(id),
//   insertTicket(f), updateTicket(id, patch, ctx), insertEvent(f)
//     each resolves to a list of changes: { table, type: INSERT|UPDATE|DELETE, row, old? }
//   savePushSubscription(row), hasPushSubscription(endpoint), deletePushSubscription(endpoint),
//   sendTestPush(endpoint) -> { devices, sent, gone, failed }

import { createDemoAdapter } from './demo.js';
import { createSupabaseAdapter } from './supabase.js';

export const isDemo = () => new URLSearchParams(location.search).has('demo');

export function createAdapter() {
  return isDemo() ? createDemoAdapter() : createSupabaseAdapter();
}
