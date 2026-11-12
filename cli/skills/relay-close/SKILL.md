---
name: relay-close
description: Same as /close, under a name no other skill uses. Wraps up this session's Relay ticket - "/relay-close" (Done), "/relay-close later" (Up next) or "/relay-close wait" (Waiting for me). Type it when /close runs some other skill.
disable-model-invocation: true
argument-hint: "[later | wait <need>]"
---

# /relay-close

This is the Relay `close` skill under a name that can't collide with an organisation's or another
plugin's `close`. Read `~/.claude/skills/close/SKILL.md` and follow it exactly, with the argument
typed after `/relay-close` in place of the one after `/close`:

- nothing → `relay close done`
- `later` → `relay close later --next-step "…"`
- `wait [need]` → `relay close wait --need "…"`

The CLI is `~/.claude/relay/bin/relay`. If that skill file is missing, run the command above with a
two-line `--summary`, then reply with the ticket ID and where it ended up.
