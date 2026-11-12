#!/bin/sh
# Install the relay CLI, its Claude Code hooks, the relay and close skills and the CLAUDE.md rule.
#   cli/install.sh             install or update
#   cli/install.sh --dry-run   print the merged settings.json and CLAUDE.md, change nothing
# Re-running is safe: earlier Relay hooks and the earlier CLAUDE.md block are replaced.
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
RELAY_HOME=${RELAY_HOME:-"$HOME/.claude/relay"}
CLAUDE_DIR=${CLAUDE_DIR:-"$HOME/.claude"}
BIN="$RELAY_HOME/bin/relay"

if [ "${1:-}" = "--dry-run" ]; then
  exec /usr/bin/python3 "$SRC/relay" setup --src "$SRC" --claude-dir "$CLAUDE_DIR" --bin "$BIN" --dry-run
fi

command -v psql >/dev/null 2>&1 || [ -x /opt/homebrew/bin/psql ] || echo "warning: psql not found; Relay calls will fail until it is installed" >&2

mkdir -p "$RELAY_HOME/bin" "$RELAY_HOME/sessions" "$RELAY_HOME/queue" "$RELAY_HOME/log"
# The binary goes in first (atomic rename), so the hooks never point at a missing file.
cp "$SRC/relay" "$RELAY_HOME/bin/.relay.new.$$"
chmod 755 "$RELAY_HOME/bin/.relay.new.$$"
mv -f "$RELAY_HOME/bin/.relay.new.$$" "$BIN"
"$BIN" --version

# Skills, CLAUDE.md block, then settings.json last (backed up, one atomic replace).
"$BIN" setup --src "$SRC" --claude-dir "$CLAUDE_DIR" --bin "$BIN"
"$BIN" doctor
