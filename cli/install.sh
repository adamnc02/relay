#!/bin/sh
# Install Relay's Claude Code kit from this folder (works from any clone, on any Mac):
#   the CLI       -> ~/.claude/relay/bin/relay   (plus hooks.json beside it)
#   the skills    -> ~/.claude/skills/relay/, ~/.claude/skills/close/
#   the hooks     -> merged into ~/.claude/settings.json (backed up first; other keys kept)
#   the rule      -> ~/.claude/CLAUDE.md, between relay:begin / relay:end markers
#
#   cli/install.sh             install or update (re-running is safe and idempotent)
#   cli/install.sh --dry-run   print the merged settings.json and CLAUDE.md; change nothing
#
# It never writes a password. It reports what's missing (psql, the ~/.pgpass line) instead.
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
RELAY_HOME=${RELAY_HOME:-"$HOME/.claude/relay"}
CLAUDE_DIR=${CLAUDE_DIR:-"$HOME/.claude"}
BIN="$RELAY_HOME/bin/relay"
PY=/usr/bin/python3
[ -x "$PY" ] || PY=$(command -v python3)

if [ "${1:-}" = "--dry-run" ]; then
  exec "$PY" "$SRC/relay" setup --src "$SRC" --claude-dir "$CLAUDE_DIR" --bin "$BIN" --dry-run
fi

echo "== Prerequisites"
PSQL=$(command -v psql 2>/dev/null || true)
for p in /opt/homebrew/bin/psql /usr/local/bin/psql /opt/homebrew/opt/libpq/bin/psql /usr/local/opt/libpq/bin/psql; do
  [ -n "$PSQL" ] && break
  [ -x "$p" ] && PSQL=$p
done
if [ -n "$PSQL" ]; then
  echo "ok       psql: $PSQL"
else
  echo "MISSING  psql. Install it with:"
  echo "           brew install libpq && brew link --force libpq"
fi
PGPASS=${PGPASSFILE:-"$HOME/.pgpass"}
if [ -f "$PGPASS" ] && grep -q 'claude_relay\.nxekrfdagkdwhjuunsrl' "$PGPASS"; then
  echo "ok       $PGPASS has a claude_relay.nxekrfdagkdwhjuunsrl line"
else
  echo "MISSING  the Relay line in $PGPASS. Add this line, with the claude_relay password in place of <password>:"
  echo "           aws-0-eu-central-1.pooler.supabase.com:5432:postgres:claude_relay.nxekrfdagkdwhjuunsrl:<password>"
  echo "         then run: chmod 600 $PGPASS"
fi
if [ -f "$PGPASS" ] && [ -n "$(find "$PGPASS" -perm +077 2>/dev/null)" ]; then
  echo "MISSING  $PGPASS is readable by others, so psql ignores it. Run: chmod 600 $PGPASS"
fi

echo "== Installing"
mkdir -p "$RELAY_HOME/bin" "$RELAY_HOME/sessions" "$RELAY_HOME/queue" "$RELAY_HOME/log"
# The binary goes in first (atomic rename), so a hook never points at a missing file.
cp "$SRC/relay" "$RELAY_HOME/bin/.relay.new.$$"
chmod 755 "$RELAY_HOME/bin/.relay.new.$$"
mv -f "$RELAY_HOME/bin/.relay.new.$$" "$BIN"
"$BIN" --version
# Skills, hooks.json, the CLAUDE.md block, then settings.json last (backed up, one atomic replace).
"$BIN" setup --src "$SRC" --claude-dir "$CLAUDE_DIR" --bin "$BIN"

echo "== relay doctor"
if CLAUDE_DIR="$CLAUDE_DIR" RELAY_HOME="$RELAY_HOME" "$BIN" doctor; then
  echo "Relay is installed. New Claude Code sessions pick up the hooks and skills."
else
  echo "Installed, but the checks above marked FAIL need fixing. Re-run: $BIN doctor"
  echo "(Until then the hooks stay silent and sessions are unaffected.)"
fi
