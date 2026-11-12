// Sample data for ?demo, ported from the approved mockup. Shaped exactly like
// rows from the relay schema so the UI cannot tell the two adapters apart.
// Every project and ticket here is fictional sample content.

import { uuid } from '../model.js';

const TRK = '/Users/adamcox/Downloads/App Development & Bug Tracking';
const GH = '/Users/adamcox/Documents/GitHub';
const MEM = '/Users/adamcox/.claude/projects/-Users-adamcox-Downloads-App-Development---Bug-Tracking/memory';

const PROJECTS = [
  ['BLC', 'BLOC', '#D2453B'],
  ['LDG', 'Ledgers', '#3F8A3A'],
  ['RLY', 'Relay', '#2A5BD7'],
  ['LST', 'Listly', '#A16207'],
  ['PCH', 'Pinch', '#C2410C'],
  ['DSK', 'DataSketch', '#7C3AED'],
  ['MDC', 'My Dream Clean', '#0F7A72'],
];

// [auto_key, status, title, hoursAgo, extra]
const TICKETS = [
  ['RLY-1', 'backlog', 'Build Relay', 0.1, {}],
  ['RLY-2', 'waiting', 'Scope, mockup and branding', 0.1, { parent: 'RLY-1', phase: 0, need: 'Approve the scope so Phase 1 can start.', next: 'Phase 1: new relay schema, RLS, ID trigger and the claude_relay role.' }],
  ['RLY-3', 'next', 'Phase 1: relay schema, RLS, IDs and the claude_relay role', 0.2, { parent: 'RLY-1', phase: 1, next: 'Write the migration and the verify SQL file.' }],
  ['RLY-4', 'backlog', 'Phase 2: the PWA', 0.2, { parent: 'RLY-1', phase: 2 }],
  ['RLY-5', 'backlog', 'Phase 3: skills, hooks and the handoff import', 0.2, { parent: 'RLY-1', phase: 3 }],
  ['RLY-6', 'backlog', 'Phase 4: push when something needs you', 0.2, { parent: 'RLY-1', phase: 4 }],
  ['LST-7', 'waiting', 'Shared list invite fails on second device', 1.2, { need: 'Run UAT on phone: open invite link signed in as the second account, confirm the list appears.', next: 'Merge PR #41 once UAT passes.', links: { branch: 'fix/invite-second-device', pr: '#41' } }],
  ['LDG-14', 'waiting', 'Recurring transfers double-post on month end', 5, { need: "Run the cleanup block in SQL editor (claude_ro can't drop its own UAT policy), then say done.", next: 'Verify 0 rows, then open live PR.', links: { branch: 'fix/month-end-recurring', pr: '#88 (test)' } }],
  ['PCH-9', 'progress', 'Seed demo data for meal-plan export', 0.3, { next: 'Add three demo recipes with export enabled; UAT on ?demo.', links: { branch: 'feat/mealplan-export' } }],
  ['DSK-21', 'progress', 'BYOR: map column picker to SOW fields', 2, { wrapup: true, next: 'Finish field mapping for rate and duration.', links: { branch: 'main' } }],
  ['BLC-50', 'backlog', 'Coach cycle rework (PROMPT-03)', 20, {}],
  ['BLC-56', 'done', "Phase 1: Store cycle dates in the coach's time zone", 6 * 24, { parent: 'BLC-50', phase: 1, links: { pr: '#198' } }],
  ['BLC-57', 'done', 'Phase 2: Migrate existing cycles', 3 * 24, { parent: 'BLC-50', phase: 2, links: { pr: '#201' } }],
  ['BLC-58', 'next', "Phase 4: Coach dashboard shows the new cycle dates", 20, { parent: 'BLC-50', phase: 4, next: 'Start after Phase 3 UAT passes.' }],
  ['BLC-52', 'testing', "Phase 3: Fix Casey's cycle starting a day late", 20, { parent: 'BLC-50', phase: 3, next: 'UAT on test coach (Hotmail) at cycle 3.', links: { branch: 'fix/cycle-tz', pr: '#203' } }],
  ['MDC-4', 'testing', 'Disable snapshot upload on UAT copy', 50, { next: 'Confirm UAT copy has no upload calls in network tab.', links: { branch: 'chore/uat-no-snapshot', pr: '#12' } }],
  ['LST-8', 'next', 'Offline add-item queue', 72, { next: 'Design the queue; start in finance-style test copy.' }],
  ['BLC-53', 'backlog', 'Retire 2025-09-26/bloc-brand folder', 120, { next: 'Move items to BACKLOG.md first.' }],
  ['DSK-19', 'backlog', 'Native chart export to PNG', 200, {}],
  ['LDG-12', 'done', 'Category totals ignore split transactions', 96, { links: { pr: '#80' } }],
  ['PCH-7', 'done', 'Recipe import drops fractions', 48, { archived: true, links: { pr: '#31' } }],
  ['MDC-3', 'done', 'Booking form zooms on focus in iOS Safari', 18 * 24, { links: { pr: '#9' } }],
];

const BRIEFS = {
  'RLY-1': `## Goal
One board where every Claude session records its work, replacing handoff and PROMPT files.

## Where it stands
The scope is waiting for your approval. Four build phases follow, one ticket each.

## Decisions
- **Adam · 12 Nov** Build in phases: scope, then schema, PWA, skills and hooks, then push.
- **Adam · 12 Nov** Own \`relay\` schema in the shared Supabase project. No Claude API.

## Next
RLY-3, Phase 1, once the scope is approved.`,
  'BLC-50': `## Goal
Coaches see every client's cycle in the coach's own time zone.

## Where it stands
Phases 1 and 2 are merged. Phase 3 is in UAT.

## Gotchas
- Test as the test coach (Hotmail) with Casey, never the live BLOC account.

## Next
Finish Phase 3 UAT, then start Phase 4.`,
  'RLY-2': `## Goal
One board where every Claude session records its work, replacing handoff and PROMPT files.

## Where it stands
Scope, mockup and branding are done. Waiting for your approval before Phase 1.

## Decisions
- **Adam · 12 Nov** Own relay schema in the shared Supabase project, separate from every app's schema.
- **Adam · 12 Nov** Google sign-in with Gmail. Name Relay, current colours, Handoff icon.
- **Adam · 12 Nov** Each Jira project is its own filter. Jira linked by pasting the issue URL.
- **Adam · 12 Nov** \`/close\` wraps up. A SessionEnd hook flags sessions closed without it.
- **Adam · 12 Nov** The handoff lives in the ticket. Built in Claude Code; no Claude API.

## Gotchas
- \`claude_ro\` can't see row data. \`claude_relay\` needs its own RLS policy, on relay tables only.

## Next
Phase 1: relay schema, RLS, ID trigger, \`claude_relay\` role and a verify SQL file.`,
  'LST-7': `## Goal
An invite to a shared list works when the second person opens it on another device.

## Where it stands
The fix is on the branch and in [PR #41](https://github.com/adamnc02/listly/pull/41). Waiting for your phone UAT.

## Decisions
- **Claude · 10 Nov** Re-read the invite token after the Google redirect finishes, not before.

## Gotchas
- LAN http has no \`randomUUID\`, so test the invite on the live https URL.

## Next
Merge PR #41 once UAT passes.`,
};

const SESSIONS = {
  'RLY-2': [[0.1, 'Scoped Relay, built the clickable mockup and Brand tab, and settled the ticket, Jira, close and file-tracking rules.', 'Scope approval.', null]],
  'LST-7': [
    [30, 'Reproduced the bug: the invite token was read before the Google redirect finished.', 'Write the fix.', 'close-later'],
    [1.2, 'Fixed the token timing, opened PR #41 and posted UAT steps.', 'Phone UAT.', 'close-wait'],
  ],
  'DSK-21': [
    [50, 'Added the column picker and the SOW field list.', 'Map the fields.', 'close-later'],
    [2, 'Mapped rate and duration. The currency column is still to do.', 'Currency mapping.', 'session-end'],
  ],
  'RLY-1': [],
  'BLC-50': [],
};

// [path, kinds, times, hoursAgo]
const FILES = {
  'RLY-2': [
    [TRK + '/relay/relay-mockup.html', ['write', 'edit'], 74, 0.05],
    [MEM + '/relay-board-app.md', ['write'], 2, 0.4],
    [MEM + '/MEMORY.md', ['shell'], 1, 1.5],
  ],
  'LST-7': [
    [GH + '/listly/src/context/AuthContext.tsx', ['edit'], 6, 1.3],
    [GH + '/listly/src/components/AuthGate.tsx', ['edit'], 3, 1.3],
    [GH + '/listly/TECHNICAL.md', ['edit'], 1, 1.2],
  ],
  'DSK-21': [
    [GH + '/data-sketch/src/byor/columnPicker.js', ['edit'], 9, 2],
    [GH + '/data-sketch/src/byor/sowFields.js', ['write'], 1, 50],
  ],
};

const DOCS = {
  'DSK-21': [[TRK + '/data-sketch/PROPOSAL-BYOR-2026-11-06.md', 'BYOR proposal']],
  'PCH-9': [[TRK + '/pinch/PINCH-INFO.md', 'Pinch info']],
};

export function buildSample(now = Date.now()) {
  const H = 3600e3;
  const iso = (hAgo) => new Date(now - hAgo * H).toISOString();
  const projects = PROJECTS.map(([key, name, colour], i) => ({
    id: uuid(), key, name, colour, kind: 'app', jira_base: null, paths: [], next_seq: 1, archived: false, sort: i,
    created_at: iso(500), updated_at: iso(500),
  }));
  const pby = Object.fromEntries(projects.map((p) => [p.key, p]));
  const tickets = [];
  const byKey = {};
  for (const [auto, status, title, hAgo, x] of TICKETS) {
    const [pk, n] = auto.split('-');
    const p = pby[pk];
    const seq = +n;
    p.next_seq = Math.max(p.next_seq, seq + 1);
    const t = {
      id: uuid(), project_id: p.id, seq, auto_key: auto, jira_key: null, jira_url: null, display_key: auto,
      aliases: [], title, status, priority: 0, need: x.need || null, brief: BRIEFS[auto] || '',
      next_step: x.next || null, parent_id: null, phase: x.phase ?? null, links: x.links || {},
      updated_by: 'claude:sample', session_ids: [], needs_wrapup: !!x.wrapup,
      archived_at: x.archived ? iso(hAgo - 1) : null, done_at: status === 'done' ? iso(hAgo) : null,
      created_at: iso(hAgo + 8), updated_at: iso(hAgo), _parentKey: x.parent || null,
    };
    if (!t.brief) {
      const S = { backlog: 'Backlog', next: 'Up next', progress: 'In progress', waiting: 'Waiting for me', testing: 'Testing', done: 'Done' };
      t.brief = `## Goal\n${title}.\n\n## Where it stands\n${S[status]}.${t.need ? ' Waiting on you: ' + t.need : ''}\n\n## Next\n${t.next_step || 'Not set yet.'}`;
    }
    tickets.push(t);
    byKey[auto] = t;
  }
  for (const t of tickets) {
    if (t._parentKey) t.parent_id = byKey[t._parentKey].id;
    delete t._parentKey;
  }

  let eid = 1;
  const events = [];
  const sessions = [];
  for (const t of tickets) {
    const h = (now - Date.parse(t.updated_at)) / H;
    events.push({ id: eid++, ticket_id: t.id, at: iso(h + 8), actor: 'claude:sample', kind: 'note', body: 'Created from handoff. ' + (t.next_step || 'No next step yet.'), from_status: null, to_status: null, seen_at: iso(h + 8) });
    events.push({ id: eid++, ticket_id: t.id, at: t.updated_at, actor: 'claude:sample', kind: 'status', body: t.need ? 'Needs: ' + t.need : null, from_status: 'backlog', to_status: t.status, seen_at: null });
    const ss = SESSIONS[t.auto_key] ?? [[h, 'Worked on: ' + t.title + '.', t.next_step || '', t.status === 'done' ? 'close' : 'close-later']];
    ss.forEach(([sh, summary, open, by], i) => {
      sessions.push({ id: uuid(), ticket_id: t.id, session_id: `sample-${t.auto_key}-${i}`, machine: 'Mac', cwd: null, started_at: iso(sh + 1), ended_at: by ? iso(sh) : null, summary, open_items: open || null, commits: [], prs: [], closed_by: by });
    });
  }
  const dsk = byKey['DSK-21'];
  events.push({ id: eid++, ticket_id: dsk.id, at: dsk.updated_at, actor: 'hook:session-end', kind: 'note', body: 'Session closed without /close. Last message: "Mapped rate and duration. The currency column is still to do."', from_status: null, to_status: null, seen_at: null });
  const lst = byKey['LST-7'];
  events.push({ id: eid++, ticket_id: lst.id, at: iso(0.6), actor: 'adam', kind: 'note', body: "Invite opened fine on the iPad. Haven't tried the iPhone yet.", from_status: null, to_status: null, seen_at: iso(0.5) });

  const ticket_files = [];
  for (const [k, list] of Object.entries(FILES)) {
    for (const [path, kinds, times, hAgo] of list) {
      ticket_files.push({ ticket_id: byKey[k].id, path, kinds, times, first_at: iso(hAgo + 5), last_at: iso(hAgo), session_ids: [] });
    }
  }
  const ticket_docs = [];
  for (const [k, list] of Object.entries(DOCS)) {
    for (const [path, label] of list) ticket_docs.push({ ticket_id: byKey[k].id, path, label, added_at: iso(10) });
  }
  return { projects, tickets, events, sessions, ticket_files, ticket_docs, nextEventId: eid };
}
