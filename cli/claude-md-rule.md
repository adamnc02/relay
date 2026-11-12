# Relay: every piece of real work has a ticket

Relay is Adam's projects board. The ticket is the handoff, so there are no handoff files. The CLI
is `~/.claude/relay/bin/relay`, and the `relay` skill has the details.

- **Real work gets a ticket as soon as it's clear**, before planning or writing code: anything that
  changes files, publishes or deploys, starts a build or a phase, or will need something from Adam
  later. Find one (`relay find`) or create one (`relay create`), and attach it to the session.
- **Quick questions don't**, unless they grow. Create the ticket when Adam says he'll come back to
  it, when the session is ending with nothing settled (an open question, a fix not yet tried), or
  when it turns into planning or debugging over several turns. Its first note sums up what's been
  covered so far.
- **At each phase end**, update the brief (`relay brief`) and post a session entry
  (`relay session`), then set the status: wait (with the one-line need), later or done. Decisions
  go in the brief and the commit message. Repo docs state facts only.
- **Files outside git**: change them with Write/Edit, or log a shell change with `relay file PATH`.
- **The kickoff is `Continue KEY.`** It loads the ticket's brief, sessions, files and docs.
- When a "closed without wrap-up" ticket for this folder shows up at session start, raise it first.
- Finish a session with `/close`, `/close later` or `/close wait`. If `/close` runs some other skill
  (an organisation one), use `/relay-close`; `/relay-tickets` likewise stands in for `/relay`.
