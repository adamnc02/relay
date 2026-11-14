// The skills a Claude Code session answers to, as the Skills popover lists
// them. The source is cli/skills/*/SKILL.md: add a row here when the CLI gains
// a skill.
//   cmd:     what is shown and copied
//   example: true when the row copies a ready-to-send example built from a need

export const SKILL_GROUPS = [
  {
    title: 'Start or pick up',
    rows: [
      { cmd: 'Continue KEY.', desc: 'Attach a ticket and load its handoff' },
      { cmd: '/relay', desc: 'Load how tickets work: find, create, attach, hand off' },
    ],
  },
  {
    title: "Wrap up the session's ticket",
    rows: [
      { cmd: '/close', desc: 'Mark it Done, with a two-line summary' },
      { cmd: '/close later', desc: 'Park it in Up next; Claude writes the next step' },
      { cmd: '/close wait <need>', desc: 'Move it to Waiting for me with the one-line need', example: true },
    ],
  },
];

export const SKILLS_FOOT = 'If another skill answers to <code>/relay</code> or <code>/close</code>, use <code>/relay-tickets</code> or <code>/relay-close</code> (same arguments).';

export const EXAMPLE_NEED = 'Run UAT on your phone: open the invite link as the second account and confirm the list appears.';
