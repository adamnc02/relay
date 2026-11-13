#!/usr/bin/env python3
"""Install Relay's Claude Code kit from this folder. Runs on Windows and macOS
(macOS can also use install.sh, which does the same).

    python install.py              install or update (re-running is safe and idempotent)
    python install.py --dry-run    print the merged settings.json and CLAUDE.md; change nothing

What goes where (~ is %USERPROFILE% on Windows):
    the CLI     -> ~/.claude/relay/bin/relay        (macOS: the script itself)
                   ~/.claude/relay/bin/relay.py     (Windows: the script; relay = a Git Bash
                   ~/.claude/relay/bin/relay.cmd     wrapper, relay.cmd = a PowerShell/cmd one)
    the skills  -> ~/.claude/skills/relay/, close/, relay-close/, relay-tickets/
    the hooks   -> merged into ~/.claude/settings.json (backed up first; other keys kept)
    the rule    -> ~/.claude/CLAUDE.md, between relay:begin / relay:end markers

It never writes a password. It reports what's missing (psql, the ~/.pgpass line) instead.
The python running this script is the one the hooks and wrappers use.
"""

import importlib.machinery
import importlib.util
import os
import shutil
import subprocess
import sys

SRC = os.path.dirname(os.path.abspath(__file__))
IS_WIN = os.name == "nt"
RELAY_HOME = os.environ.get("RELAY_HOME") or os.path.join(os.path.expanduser("~"), ".claude", "relay")
CLAUDE_DIR = os.environ.get("CLAUDE_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
BIN_DIR = os.path.join(RELAY_HOME, "bin")
BIN = os.path.join(BIN_DIR, "relay.py" if IS_WIN else "relay")
PY = sys.executable


def load_relay():
    loader = importlib.machinery.SourceFileLoader("relay_cli", os.path.join(SRC, "relay"))
    spec = importlib.util.spec_from_loader("relay_cli", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def run_cli(*args):
    cmd = [PY] + (["-X", "utf8"] if IS_WIN else []) + [BIN] + list(args)
    env = dict(os.environ, RELAY_HOME=RELAY_HOME, CLAUDE_DIR=CLAUDE_DIR, RELAY_NO_REEXEC="1")
    return subprocess.run(cmd, env=env).returncode


def atomic_copy(src, dst, mode=None):
    tmp = dst + ".new.%d" % os.getpid()
    shutil.copyfile(src, tmp)
    if mode is not None:
        os.chmod(tmp, mode)
    os.replace(tmp, dst)


def atomic_text(dst, text, mode=None, newline="\n"):
    tmp = dst + ".new.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8", newline=newline) as f:
        f.write(text)
    if mode is not None:
        os.chmod(tmp, mode)
    os.replace(tmp, dst)


def prerequisites(relay):
    print("== Prerequisites")
    if sys.version_info < (3, 8):
        print("MISSING  Python 3.8 or newer (this is %s)" % sys.version.split()[0])
    try:
        print("ok       psql: %s" % relay.find_psql())
    except Exception:
        print("MISSING  psql. To " + relay.PSQL_HINT)
    pgpass = os.environ.get("PGPASSFILE") or os.path.join(os.path.expanduser("~"), ".pgpass")
    ci = relay.conninfo_fields()
    ok, detail = relay.pgpass_entry(pgpass, ci.get("host", ""), ci.get("port", "5432"),
                                    ci.get("dbname", ""), ci.get("user", ""))
    if ok:
        print("ok       " + detail)
    else:
        print("MISSING  %s. Add this line, with the claude_relay password in place of <password>:" % detail)
        print("           " + relay.PGPASS_LINE)


def install():
    print("== Installing")
    for d in ("bin", "sessions", "queue", "log"):
        os.makedirs(os.path.join(RELAY_HOME, d), exist_ok=True)
    # The CLI goes in first (atomic rename), so a hook never points at a missing file.
    if IS_WIN:
        atomic_copy(os.path.join(SRC, "relay"), BIN)
        py = PY.replace("\\", "/")
        # Git Bash (Claude Code's Bash tool on Windows) runs ~/.claude/relay/bin/relay.
        atomic_text(os.path.join(BIN_DIR, "relay"),
                    '#!/bin/sh\nexec "%s" -X utf8 "$(dirname "$0")/relay.py" "$@"\n' % py, 0o755)
        # PowerShell and cmd run relay.cmd.
        atomic_text(os.path.join(BIN_DIR, "relay.cmd"),
                    '@echo off\r\n"%s" -X utf8 "%%~dp0relay.py" %%*\r\n' % PY, newline="")
    else:
        atomic_copy(os.path.join(SRC, "relay"), BIN, 0o755)
    run_cli("--version")
    # Skills, hooks.json, the CLAUDE.md block, then settings.json last (backed up, one atomic replace).
    rc = run_cli("setup", "--src", SRC, "--claude-dir", CLAUDE_DIR, "--bin", BIN)
    if rc:
        sys.exit(rc)


def main():
    relay = load_relay()
    if "--dry-run" in sys.argv[1:]:
        cmd = [PY] + (["-X", "utf8"] if IS_WIN else []) + [os.path.join(SRC, "relay"), "setup", "--src", SRC,
                                                           "--claude-dir", CLAUDE_DIR, "--bin", BIN, "--dry-run"]
        sys.exit(subprocess.run(cmd, env=dict(os.environ, RELAY_NO_REEXEC="1")).returncode)
    prerequisites(relay)
    install()
    print("== relay doctor")
    if run_cli("doctor") == 0:
        print("Relay is installed. New Claude Code sessions pick up the hooks and skills.")
    else:
        print("Installed, but the checks above marked FAIL need fixing. Re-run: %s doctor"
              % (os.path.join(BIN_DIR, "relay.cmd") if IS_WIN else BIN))
        print("(Until then the hooks stay silent and sessions are unaffected.)")


if __name__ == "__main__":
    main()
