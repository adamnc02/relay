"""Unit tests for the pure parts of cli/relay. Run: python3 -m unittest discover -s cli/tests"""

import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "relay")


def load():
    loader = importlib.machinery.SourceFileLoader("relay_cli", SCRIPT)
    spec = importlib.util.spec_from_loader("relay_cli", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


relay = load()

PROJECTS = [
    {"key": "RLY", "paths": ["/Users/a/GitHub/relay", "/Users/a/Track/relay"]},
    {"key": "SUP", "paths": ["/Users/a/GitHub/silver"]},
    {"key": "DEEP", "paths": ["/Users/a/GitHub/relay/cli"]},
    {"key": "OLD", "paths": ["/Users/a/GitHub/old"], "archived": True},
    {"key": "INB", "paths": []},
]


class TempHome(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.environ["RELAY_HOME"] = os.path.join(self.tmp, "home")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        os.environ.pop("RELAY_HOME", None)


class PathMatching(unittest.TestCase):
    def test_exact_and_below(self):
        self.assertEqual(relay.match_project("/Users/a/GitHub/relay", PROJECTS)["key"], "RLY")
        self.assertEqual(relay.match_project("/Users/a/GitHub/relay/js/app", PROJECTS)["key"], "RLY")

    def test_whole_components_only(self):
        self.assertIsNone(relay.match_project("/Users/a/GitHub/relay-cli", PROJECTS))
        self.assertIsNone(relay.match_project("/Users/a/GitHub/silverware", PROJECTS))

    def test_longest_prefix_wins(self):
        self.assertEqual(relay.match_project("/Users/a/GitHub/relay/cli/tests", PROJECTS)["key"], "DEEP")

    def test_trailing_slash_and_dots(self):
        self.assertEqual(relay.match_project("/Users/a/GitHub/silver/./x/", PROJECTS)["key"], "SUP")

    def test_archived_ignored_and_inbox_fallback(self):
        self.assertIsNone(relay.match_project("/Users/a/GitHub/old", PROJECTS))
        p, matched = relay.project_for("/nowhere/at/all", PROJECTS)
        self.assertEqual((p["key"], matched), ("INB", False))

    def test_paths_with_spaces(self):
        projects = [{"key": "SUP", "paths": ["/Users/a/App Development & Bug Tracking/Supabase Migration"]}]
        self.assertEqual(relay.match_project(
            "/Users/a/App Development & Bug Tracking/Supabase Migration/x.md", projects)["key"], "SUP")


class Queue(TempHome):
    def test_enqueue_order_and_ack(self):
        names = [relay.enqueue({"type": "file", "path": "/p%d" % i}) for i in range(5)]
        jobs = relay.queue_jobs()
        self.assertEqual([j["path"] for _, j in jobs], ["/p0", "/p1", "/p2", "/p3", "/p4"])
        relay.ack(names[:2])
        self.assertEqual(len(relay.queue_jobs()), 3)

    def test_corrupt_file_removed(self):
        qdir = relay.sdir("queue")
        with open(os.path.join(qdir, "000-bad.json"), "w") as f:
            f.write("{nope")
        relay.enqueue({"type": "file", "path": "/ok"})
        self.assertEqual([j["path"] for _, j in relay.queue_jobs()], ["/ok"])
        self.assertFalse(os.path.exists(os.path.join(qdir, "000-bad.json")))

    def test_no_temp_files_visible(self):
        relay.enqueue({"type": "file"})
        self.assertFalse([n for n in os.listdir(relay.sdir("queue")) if n.startswith(".tmp")])

    def test_plan_flush(self):
        now = time.time()
        jobs = [
            ("1", {"type": "file", "session": "a", "path": "/x", "queued_at": now}),
            ("2", {"type": "file", "session": "b", "path": "/y", "queued_at": now}),
            ("3", {"type": "file", "session": "b", "path": "/z", "queued_at": now - 3 * 86400}),
            ("4", {"type": "file", "session": "c", "path": "/w", "queued_at": now}),
            ("5", {"type": "session_end", "session": "a"}),
            ("6", {"type": "session_end", "session": "d"}),
            ("7", {"type": "session_end", "session": "b"}),
            ("8", {"type": "file", "session": "b", "path": "/v", "ticket_id": "T9", "queued_at": now}),
            ("9", {"type": "mystery"}),
        ]
        states = {"a": {"tickets": [{"id": "T1", "key": "RLY-1"}, {"id": "T2", "key": "RLY-2"}]},
                  "b": {}, "c": {"ended": True},
                  "d": {"tickets": [{"id": "T3", "key": "X-1"}], "closed": True}}
        files, ends, drop = relay.plan_flush(jobs, states, now)
        self.assertEqual([(n, t) for n, t, _ in files], [("1", "T2"), ("8", "T9")])
        self.assertEqual([n for n, _, _ in ends], ["5"])
        self.assertEqual(sorted(drop), ["3", "4", "6", "7", "9"])  # "2" stays queued

    def test_queue_lock_is_exclusive(self):
        with relay.QueueLock() as a:
            self.assertTrue(a.acquired)
            r = subprocess.run([sys.executable, "-c",
                                "import fcntl,os,sys; fd=os.open(sys.argv[1], os.O_RDWR)\n"
                                "try:\n fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB); print('got')\n"
                                "except OSError: print('busy')", a.path], capture_output=True, text=True)
            self.assertEqual(r.stdout.strip(), "busy")

    def test_state_roundtrip_and_current(self):
        relay.update_state("s1", lambda s: s.update({"tickets": [{"id": "A", "key": "K-1"}]}))
        relay.remember("s1", {"id": "B", "key": "K-2"})
        relay.remember("s1", {"id": "A", "key": "K-1"})
        st = relay.load_state("s1")
        self.assertEqual([t["key"] for t in st["tickets"]], ["K-2", "K-1"])
        self.assertEqual(relay.current_ticket(st)["key"], "K-1")

    def test_attach_after_close_reopens_session(self):
        # /close on one ticket, then attach another: the window closing without
        # /close must still flag the new ticket.
        relay.remember("s2", {"id": "A", "key": "K-1"})
        relay.update_state("s2", lambda s: s.update({"closed": True, "closed_at": 1.0}))
        jobs = [("1", {"type": "session_end", "session": "s2"})]
        self.assertEqual(relay.plan_flush(jobs, {"s2": relay.load_state("s2")})[1], [])
        relay.remember("s2", {"id": "B", "key": "K-2"})
        st = relay.load_state("s2")
        self.assertNotIn("closed", st)
        self.assertNotIn("closed_at", st)
        ends = relay.plan_flush(jobs, {"s2": st})[1]
        self.assertEqual([(n, relay.current_ticket(s)["key"]) for n, s, _ in ends], [("1", "K-2")])


def sh(cwd, *cmd):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True)


class GitSweep(TempHome):
    def setUp(self):
        TempHome.setUp(self)
        self.repo = os.path.realpath(os.path.join(self.tmp, "repo"))
        os.makedirs(self.repo)
        sh(self.repo, "git", "init", "-q")
        sh(self.repo, "git", "config", "user.email", "t@example.invalid")
        sh(self.repo, "git", "config", "user.name", "t")
        for n in ("a.txt", "b.txt", "keep.txt"):
            with open(os.path.join(self.repo, n), "w") as f:
                f.write(n)
        with open(os.path.join(self.repo, "dirty.txt"), "w") as f:
            f.write("x")
        sh(self.repo, "git", "add", "a.txt", "b.txt", "keep.txt", "dirty.txt")
        sh(self.repo, "git", "commit", "-q", "-m", "init")
        with open(os.path.join(self.repo, "dirty.txt"), "a") as f:
            f.write("already dirty before the session")

    def p(self, n):
        return os.path.join(self.repo, n)

    def test_parse_porcelain_rename(self):
        out = "R  new.txt\0old.txt\0 M a.txt\0?? u v.txt\0"
        self.assertEqual(relay.parse_porcelain_z(out), {"new.txt": "R ", "a.txt": " M", "u v.txt": "??"})

    def test_repo_root(self):
        os.makedirs(self.p("sub/deeper"))
        self.assertEqual(relay.repo_root(self.p("sub/deeper")), self.repo)
        self.assertEqual(relay.repo_root(self.p("sub/deeper/missing.txt")), self.repo)
        self.assertIsNone(relay.repo_root(self.tmp))

    def test_sweep_finds_shell_edits_only(self):
        sid = "sess"
        relay.add_snapshots(sid, [self.repo])
        time.sleep(0.02)
        with open(self.p("a.txt"), "a") as f:           # shell edit
            f.write("sed")
        with open(self.p("new dir.txt"), "w") as f:      # shell-created file, with a space
            f.write("n")
        os.unlink(self.p("b.txt"))                        # shell delete
        with open(self.p("keep.txt"), "a") as f:        # changed by Write: excluded
            f.write("w")
        with open(relay.paths_file(sid), "a") as f:
            f.write(self.p("keep.txt") + "\n")
        found = relay.do_sweep(sid)
        self.assertEqual(sorted(found), sorted([self.p("a.txt"), self.p("b.txt"), self.p("new dir.txt")]))
        jobs = [j for _, j in relay.queue_jobs()]
        self.assertTrue(all(j["kind"] == "shell" and j["session"] == sid for j in jobs))
        # re-baselined: a second sweep finds nothing new
        self.assertEqual(relay.do_sweep(sid), [])

    def test_sweep_sees_change_to_already_dirty_file_and_commits(self):
        sid = "sess2"
        relay.add_snapshots(sid, [self.repo])
        time.sleep(0.02)
        self.assertEqual(relay.do_sweep(sid), [])         # untouched dirty file is not swept
        with open(self.p("dirty.txt"), "a") as f:
            f.write("more")
        with open(self.p("a.txt"), "a") as f:
            f.write("c")
        sh(self.repo, "git", "commit", "-q", "-am", "shell commit")
        found = relay.do_sweep(sid)
        self.assertEqual(sorted(found), [self.p("a.txt"), self.p("dirty.txt")])

    def test_snapshot_targets_dedupes(self):
        os.makedirs(self.p("sub"))
        roots = relay.snapshot_targets(self.p("sub"), project={"paths": [self.repo, "/does/not/exist"]})
        self.assertEqual(roots, [self.repo])

    def test_worktree_main_folder(self):
        wt = os.path.join(self.tmp, "repo-wt")
        sh(self.repo, "git", "worktree", "add", "-q", wt, "-b", "wtb")
        self.assertEqual(os.path.realpath(relay.main_worktree(wt)), self.repo)
        p, matched = relay.project_for(wt, [{"key": "X", "paths": [self.repo]}, {"key": "INB", "paths": []}])
        self.assertEqual((p["key"], matched), ("X", True))


class Transcript(unittest.TestCase):
    def write(self, rows, tail=""):
        fd, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(fd, "w") as f:
            for r in rows:
                f.write((r if isinstance(r, str) else json.dumps(r)) + "\n")
            f.write(tail)
        self.addCleanup(os.unlink, path)
        return path

    def test_last_text_skips_tools_thinking_and_sidechains(self):
        path = self.write([
            {"type": "user", "message": {"content": "hi"}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "First answer"}]}},
            {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "hmm"},
                                                           {"type": "text", "text": "Final answer"}]}},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash"}]}},
            {"type": "assistant", "isSidechain": True, "message": {"content": [{"type": "text", "text": "sub"}]}},
            {"type": "user", "message": {"content": [{"type": "tool_result"}]}},
            "not json at all",
        ], tail='{"type": "assistant", "message": {"content": [{"type": "text", "text": "trunc')
        self.assertEqual(relay.last_assistant_text(path), "Final answer")

    def test_string_content_and_tail_window(self):
        rows = [{"type": "assistant", "message": {"content": "old " + "x" * 5000}}] + \
               [{"type": "assistant", "message": {"content": "newest"}}]
        path = self.write(rows)
        self.assertEqual(relay.last_assistant_text(path, max_bytes=200), "newest")

    def test_missing_file(self):
        self.assertIsNone(relay.last_assistant_text("/no/such/file.jsonl"))
        self.assertIsNone(relay.last_assistant_text(None))


class Formatting(unittest.TestCase):
    def test_context_lists_wrapup_first_and_waiting(self):
        data = {"projects": [{"id": "p1", "key": "RLY", "name": "Relay", "paths": ["/r"]},
                             {"id": "p2", "key": "INB", "name": "Inbox", "paths": []}],
                "tickets": [
                    {"id": "1", "key": "RLY-1", "title": "Build", "status": "progress", "project": "RLY",
                     "children": 2, "children_done": 1},
                    {"id": "2", "key": "RLY-3", "title": "Phase", "status": "progress", "project": "RLY",
                     "parent_id": "1"},
                    {"id": "3", "key": "RLY-9", "title": "Stale", "status": "progress", "project": "RLY",
                     "needs_wrapup": True, "ended": "2026-11-12 10:00"},
                    {"id": "4", "key": "INB-2", "title": "Other", "status": "waiting", "need": "Approve",
                     "project": "INB"}]}
        text = relay.format_context(data, "/r/sub")
        self.assertIn("project RLY (Relay)", text)
        self.assertLess(text.index("RLY-9 was closed without wrap-up"), text.index("## Open tickets in RLY"))
        self.assertIn("  - RLY-3 [In progress] Phase", text)
        self.assertIn("INB-2 Other · need: Approve", text)
        self.assertIn("## The ticket rule", text)

    def test_context_cap(self):
        data = {"projects": [{"id": "p", "key": "INB", "name": "Inbox", "paths": []}],
                "tickets": [{"id": str(i), "key": "INB-%d" % i, "title": "t" * 400, "status": "waiting",
                             "need": "n" * 300, "project": "X"} for i in range(40)]}
        self.assertLessEqual(len(relay.format_context(data, "/x", cap=2000)), 2000)

    def test_hook_json_shape(self):
        out = json.loads(relay.hook_json("PostToolUse", "hello"))
        self.assertEqual(out, {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "hello"}})

    def test_merge_files_for_parent(self):
        rows = [{"path": "/r/a", "kinds": ["write"], "times": 1, "last": "1", "last_at": "2026-01-01"},
                {"path": "/r/a", "kinds": ["edit"], "times": 2, "last": "2", "last_at": "2026-01-02"}]
        m = relay.merge_files(rows)
        self.assertEqual((m[0]["kinds"], m[0]["times"], m[0]["last"]), (["write", "edit"], 3, "2"))

    def test_kickoff_regex(self):
        self.assertEqual(relay.KICKOFF_RE.match("Continue RLY-5.").group(1), "RLY-5")
        self.assertEqual(relay.KICKOFF_RE.match("  continue web-r12 please").group(1), "web-r12")
        self.assertIsNone(relay.KICKOFF_RE.match("Can you continue RLY-5?"))
        self.assertEqual(relay.norm_key("rly-5."), "RLY-5")
        with self.assertRaises(relay.RelayError):
            relay.norm_key("RLY 5")


class Setup(unittest.TestCase):
    BIN = "/Users/a/.claude/relay/bin/relay"

    def test_merge_keeps_other_keys_and_hooks_and_is_idempotent(self):
        settings = {"model": "opus", "hooks": {"PostToolUse": [
            {"matcher": "Bash", "hooks": [{"type": "command", "command": "other.sh"}]}]}}
        once = relay.merge_hooks(settings, self.BIN)
        twice = relay.merge_hooks(once, self.BIN)
        self.assertEqual(once, twice)
        self.assertEqual(once["model"], "opus")
        ptu = once["hooks"]["PostToolUse"]
        self.assertEqual(ptu[0]["hooks"][0]["command"], "other.sh")
        self.assertEqual([g.get("matcher") for g in ptu], ["Bash", "Write|Edit|NotebookEdit", "*"])
        for ev in ("SessionStart", "UserPromptSubmit", "SessionEnd"):
            self.assertEqual(len(once["hooks"][ev]), 1)
        self.assertEqual(once["hooks"]["SessionEnd"][0]["hooks"][0]["command"], self.BIN + " hook session-end")
        self.assertEqual(settings["hooks"]["PostToolUse"][0]["matcher"], "Bash")  # input not mutated
        self.assertEqual(len(settings["hooks"]["PostToolUse"]), 1)

    def test_bin_with_space_is_quoted(self):
        s = relay.merge_hooks({}, "/Users/a b/.claude/relay/bin/relay")
        self.assertEqual(s["hooks"]["SessionStart"][0]["hooks"][0]["command"],
                         "'/Users/a b/.claude/relay/bin/relay' hook session-start")

    def test_claude_md_block(self):
        a = relay.merge_block("", "rule v1")
        self.assertIn("rule v1", a)
        b = relay.merge_block("# Mine\n\nkeep me\n", "rule v1")
        self.assertTrue(b.startswith("# Mine\n\nkeep me\n\n"))
        c = relay.merge_block(b, "rule v2")
        self.assertIn("keep me", c)
        self.assertIn("rule v2", c)
        self.assertNotIn("rule v1", c)
        self.assertEqual(c.count(relay.BLOCK_BEGIN), 1)


class HookSafety(TempHome):
    """Hooks print nothing and exit 0 when the database is unreachable."""

    def run_hook(self, event, payload, env_extra=None):
        env = dict(os.environ, RELAY_CONNINFO="host=127.0.0.1 port=9 dbname=x user=x sslmode=disable")
        env.update(env_extra or {})
        t0 = time.time()
        r = subprocess.run([sys.executable, SCRIPT, "hook", event], input=json.dumps(payload),
                           capture_output=True, text=True, env=env, timeout=20)
        return r, time.time() - t0

    def test_offline_hooks_are_silent(self):
        relay.remember("s", {"id": "00000000-0000-0000-0000-000000000000", "key": "INB-1"})
        for event, payload in [
            ("session-start", {"session_id": "s", "cwd": self.tmp, "source": "startup"}),
            ("post-tool", {"session_id": "s", "tool_name": "Bash"}),
            ("prompt", {"session_id": "s", "prompt": "Continue INB-1."}),
            ("file", {"session_id": "s", "tool_name": "Write", "tool_input": {"file_path": "/x/y"}}),
            ("session-end", {"session_id": "s", "reason": "other"}),
            ("nonsense", {}),
        ]:
            r, took = self.run_hook(event, payload)
            self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""), event)
            self.assertLess(took, 7, event)

    def test_garbage_stdin(self):
        r = subprocess.run([sys.executable, SCRIPT, "hook", "post-tool"], input="{{{", capture_output=True,
                           text=True, timeout=10)
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))

    def test_hung_database_is_cut_off_by_the_time_box(self):
        fake = os.path.join(self.tmp, "psql")
        with open(fake, "w") as f:
            f.write("#!/bin/sh\nsleep 30\n")
        os.chmod(fake, 0o755)
        r, took = self.run_hook("session-start", {"session_id": "s2", "cwd": self.tmp},
                                {"RELAY_PSQL": fake})
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        self.assertLess(took, 6)

    def test_file_hook_queues_and_skips_scratchpad(self):
        r, took = self.run_hook("file", {"session_id": "s3", "tool_name": "Edit", "cwd": "/w",
                                         "tool_input": {"file_path": "rel/f.txt"}})
        self.run_hook("file", {"session_id": "s3", "tool_name": "Write", "scratchpad_dir": "/tmp/sp",
                               "tool_input": {"file_path": "/tmp/sp/x"}})
        self.run_hook("file", {"session_id": "s3", "tool_name": "NotebookEdit",
                               "tool_input": {"notebook_path": "/w/n.ipynb"}})
        jobs = [j for _, j in relay.queue_jobs()]
        self.assertEqual([(j["path"], j["kind"]) for j in jobs], [("/w/rel/f.txt", "edit"), ("/w/n.ipynb", "edit")])
        self.assertEqual(relay.logged_paths("s3"), {"/w/rel/f.txt", "/w/n.ipynb"})
        self.assertLess(took, 1.0)

    def test_post_tool_throttle(self):
        relay.mark_checked("s4")
        self.assertTrue(relay.throttled("s4"))
        relay.mark_checked("s4", backoff=-31)
        self.assertFalse(relay.throttled("s4"))


class LocalPaths(TempHome):
    def test_override_beats_db_and_unknown_keys_ignored(self):
        with open(os.path.join(relay.sdir(), "paths.json"), "w") as f:
            json.dump({"/work/code/relay": "rly", "/work/code/other": "NOPE", "/Users/a/GitHub/relay/js": "SUP"}, f)
        ov = relay.local_paths()
        self.assertEqual(ov["/work/code/relay"], "RLY")
        self.assertEqual(relay.project_for("/work/code/relay/cli", PROJECTS, ov)[0]["key"], "RLY")
        self.assertEqual(relay.project_for("/work/code/other", PROJECTS, ov)[0]["key"], "INB")
        self.assertEqual(relay.project_for("/Users/a/GitHub/relay/js/x", PROJECTS, ov)[0]["key"], "SUP")
        self.assertEqual(relay.project_for("/Users/a/GitHub/relay", PROJECTS, ov)[0]["key"], "RLY")
        self.assertIn("/work/code/relay", relay.project_paths(PROJECTS[0], ov))

    def test_missing_or_bad_file(self):
        self.assertEqual(relay.local_paths(), {})
        with open(os.path.join(relay.sdir(), "paths.json"), "w") as f:
            f.write("[1, 2]")
        self.assertEqual(relay.local_paths(), {})


class ManagedSettings(unittest.TestCase):
    def test_policy_problems(self):
        P = relay.policy_problems
        self.assertEqual(P({"model": "x", "allowManagedHooksOnly": False}), [])
        self.assertEqual(len(P({"allowManagedHooksOnly": True})), 1)
        self.assertEqual(len(P({"disableAllHooks": True})), 1)
        self.assertIn("hooks and skills", P({"strictPluginOnlyCustomization": True})[0])
        self.assertIn("allows skills only", P({"strictPluginOnlyCustomization": ["skills", "agents"]})[0])
        self.assertEqual(P({"strictPluginOnlyCustomization": ["agents"]}), [])
        self.assertEqual(P({"strictPluginOnlyCustomization": "true"}), [])  # only a real true counts
        # in the user's own settings only disableAllHooks matters
        self.assertEqual(P({"allowManagedHooksOnly": True}, managed=False), [])
        self.assertIn("remove it", P({"disableAllHooks": True}, managed=False)[0])

    def test_managed_sources_file_and_dropins(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        self.assertEqual(relay.managed_sources(d), [])
        os.makedirs(os.path.join(d, "managed-settings.d"))
        with open(os.path.join(d, "managed-settings.json"), "w") as f:
            json.dump({"allowManagedHooksOnly": True}, f)
        with open(os.path.join(d, "managed-settings.d", "10-team.json"), "w") as f:
            f.write("{bad json")
        src = relay.managed_sources(d)
        self.assertEqual([os.path.basename(s[0]) for s in src], ["managed-settings.json", "10-team.json"])
        self.assertTrue(relay.policy_problems(src[0][1]))
        self.assertIsNotNone(src[1][2])


class Kit(unittest.TestCase):
    def test_hooks_json_matches_builtin_spec(self):
        self.assertEqual(relay.load_hook_spec(os.path.dirname(SCRIPT)), relay.HOOK_SPEC)

    def test_pgpass_entry(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        p = os.path.join(d, "pgpass")
        with open(p, "w") as f:
            f.write("other:5432:postgres:claude_ro.x:pw\n*:5432:postgres:claude_relay.x:secret\n")
        os.chmod(p, 0o600)
        self.assertTrue(relay.pgpass_entry(p, "h", "5432", "postgres", "claude_relay.x")[0])
        self.assertFalse(relay.pgpass_entry(p, "h", "5432", "postgres", "nobody")[0])
        os.chmod(p, 0o644)
        ok, detail = relay.pgpass_entry(p, "h", "5432", "postgres", "claude_relay.x")
        self.assertFalse(ok)
        self.assertIn("chmod 600", detail)

    def test_install_into_a_fresh_home_twice_is_idempotent(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        claude = os.path.join(d, ".claude")
        os.makedirs(claude)
        with open(os.path.join(claude, "settings.json"), "w") as f:
            json.dump({"model": "opus", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "mine.sh"}]}]}}, f)
        with open(os.path.join(claude, "CLAUDE.md"), "w") as f:
            f.write("# My own rules\n")
        env = dict(os.environ, HOME=d, RELAY_CONNINFO="host=127.0.0.1 port=9 dbname=x user=x sslmode=disable",
                   RELAY_MANAGED_DIR=os.path.join(d, "managed"))
        env.pop("RELAY_HOME", None)
        env.pop("CLAUDE_DIR", None)
        env.pop("PGPASSFILE", None)
        install = os.path.join(os.path.dirname(SCRIPT), "install.sh")
        outs = []
        for _ in range(2):
            time.sleep(1.1)  # backup names carry a seconds timestamp
            r = subprocess.run(["sh", install], env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(os.path.join(claude, "settings.json")) as f:
                outs.append(f.read())
        self.assertEqual(outs[0], outs[1])
        s = json.loads(outs[1])
        self.assertEqual(s["model"], "opus")
        self.assertEqual(s["hooks"]["Stop"][0]["hooks"][0]["command"], "mine.sh")
        self.assertEqual(s["hooks"]["SessionStart"][0]["hooks"][0]["command"],
                         os.path.join(d, ".claude/relay/bin/relay") + " hook session-start")
        with open(os.path.join(claude, "CLAUDE.md")) as f:
            md = f.read()
        self.assertTrue(md.startswith("# My own rules\n"))
        self.assertEqual(md.count(relay.BLOCK_BEGIN), 1)
        backups = sorted(os.listdir(os.path.join(claude, "backups")))
        self.assertEqual([b.split("-2")[0] for b in backups],
                         ["settings.json.pre-relay", "settings.json.relay-reinstall"])
        self.assertTrue(os.path.exists(os.path.join(claude, "skills/close/SKILL.md")))
        self.assertIn("MISSING  the Relay line", r.stdout)   # no ~/.pgpass in the fresh home
        self.assertNotIn("<password>:", "")                  # the kit only ever prints the placeholder
        self.assertIn("FAIL  network", r.stdout)             # unreachable DB reported plainly
        self.assertIn("PASS  hooks", r.stdout)
        self.assertIn("PASS  skills", r.stdout)

    def test_install_py_matches_install_sh(self):
        # install.py (the Windows installer) produces the same result as install.sh here.
        results = []
        for runner in (["sh", "install.sh"], [sys.executable, "install.py"]):
            d = tempfile.mkdtemp()
            self.addCleanup(shutil.rmtree, d)
            os.makedirs(os.path.join(d, ".claude"))
            env = dict(os.environ, HOME=d, RELAY_CONNINFO="host=127.0.0.1 port=9 dbname=x user=x sslmode=disable",
                       RELAY_MANAGED_DIR=os.path.join(d, "managed"))
            for k in ("RELAY_HOME", "CLAUDE_DIR", "PGPASSFILE"):
                env.pop(k, None)
            r = subprocess.run(runner[:1] + [os.path.join(os.path.dirname(SCRIPT), runner[1])], env=env,
                               capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("PASS  hooks", r.stdout)
            with open(os.path.join(d, ".claude", "settings.json")) as f:
                results.append(f.read().replace(d, "<HOME>"))
        self.assertEqual(results[0], results[1])


class Windows(unittest.TestCase):
    """The Windows code paths that can be checked from any OS."""

    def test_path_under_ntpath(self):
        import ntpath
        pu = lambda a, b: relay.path_under(a, b, ntpath)
        self.assertTrue(pu(r"C:\Users\Me\Code\relay\cli", r"C:\Users\Me\Code\relay"))
        self.assertTrue(pu(r"c:\users\me\code\RELAY", "C:/Users/Me/Code/relay/"))  # case and / insensitive
        self.assertFalse(pu(r"C:\Users\Me\Code\relay-test", r"C:\Users\Me\Code\relay"))
        self.assertFalse(pu(r"D:\Code\relay", r"C:\Code\relay"))
        self.assertTrue(pu(r"C:\anything", "C:\\"))

    def test_path_under_posix_unchanged(self):
        import posixpath
        pu = lambda a, b: relay.path_under(a, b, posixpath)
        self.assertTrue(pu("/a/b/c", "/a/b"))
        self.assertFalse(pu("/a/bc", "/a/b"))
        self.assertFalse(pu("/a/B", "/a/b"))  # case-sensitive off Windows
        self.assertTrue(pu("/x", "/"))

    def test_exec_form_hook_entry(self):
        h = relay.hook_entry(r"C:\Users\Me\.claude\relay\bin\relay.py", "prompt", 10, win=True,
                             python=r"C:\Python311\python.exe")
        self.assertEqual(h, {"type": "command", "command": "C:/Python311/python.exe",
                             "args": ["-X", "utf8", "C:/Users/Me/.claude/relay/bin/relay.py", "hook", "prompt"],
                             "timeout": 10})
        self.assertTrue(relay.is_relay_hook(h, None))  # recognised by RELAY_MARK in args, for re-installs
        self.assertFalse(relay.is_relay_hook({"type": "command", "command": "C:/x/mine.exe", "args": ["go"]}, None))

    def test_hook_matches_win(self):
        bin_path = r"C:\Users\Me\.claude\relay\bin\relay.py"
        h = relay.hook_entry(bin_path, "file", 5, win=True, python=sys.executable)
        self.assertTrue(relay.hook_matches(h, bin_path, "file", win=True))
        self.assertFalse(relay.hook_matches(h, bin_path, "prompt", win=True))
        gone = dict(h, command="/no/such/python.exe")
        self.assertFalse(relay.hook_matches(gone, bin_path, "file", win=True))

    def test_repo_root_stops_at_filesystem_root(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        self.assertIsNone(relay.repo_root(d))


class CreateProject(TempHome):
    """A new ticket goes to --project, else the folder's project, else the Inbox."""

    def run_create(self, project=None, cwd="/Users/a/GitHub/relay", dry_run=False):
        calls = []
        projects = [{"id": "p-rly", "key": "RLY", "name": "Relay", "paths": ["/Users/a/GitHub/relay"]},
                    {"id": "p-inb", "key": "INB", "name": "Inbox", "paths": []}]

        def fake_q(sql, v=None, timeout=None, dry_run=False):
            if sql == relay.SQL_PROJECTS:
                return projects
            calls.append(dict(v, _dry=dry_run))
            return {"id": "t1", "key": "X-1"}
        saved = (relay.q, relay.norm, relay.common_vars, relay.actor)
        relay.q = fake_q
        real_norm = relay.norm
        relay.norm = lambda p, *a, **k: cwd if p == os.getcwd() else real_norm(p, *a, **k)
        relay.common_vars = lambda sid=None, cwd=None: {}
        relay.actor = lambda sid: "claude:test"
        try:
            args = type("A", (), dict(session=None, status=None, need=None, parent=None, project=project,
                                      no_attach=True, brief=None, title="T", next_step=None, phase=None,
                                      dry_run=dry_run))()
            relay.cmd_create(args)
        finally:
            relay.q, relay.norm, relay.common_vars, relay.actor = saved
        self.last = calls[-1]
        return calls[-1]["project_id"]

    def test_mapped_folder_uses_its_project(self):
        self.assertEqual(self.run_create(), "p-rly")

    def test_unmapped_folder_goes_to_inbox(self):
        self.assertEqual(self.run_create(cwd="/Users/a/Elsewhere"), "p-inb")

    def test_named_project_beats_the_inbox(self):
        self.assertEqual(self.run_create(project="RLY", cwd="/Users/a/Elsewhere"), "p-rly")

    def test_named_project_wins(self):
        self.assertEqual(self.run_create(project="rly"), "p-rly")

    def test_dry_run_reaches_the_database_without_saving(self):
        self.run_create(dry_run=True)
        self.assertTrue(self.last["_dry"])


class Rly18(unittest.TestCase):
    """RLY-18: Jira parsing, shared Jira keys, value checks, dry runs."""

    def test_parse_jira_matches_the_app(self):
        j = relay.parse_jira("https://acme.atlassian.net/jira/software/projects/WEB/boards/1?selectedIssue=WEB-500")
        self.assertEqual((j["key"], j["base"]), ("WEB-500", "https://acme.atlassian.net/browse/"))
        j = relay.parse_jira("https://acme.atlassian.net/browse/data_x-7")
        self.assertEqual(j["key"], "DATA_X-7")
        self.assertEqual(relay.parse_jira("web-12", "https://a/browse/")["url"], "https://a/browse/WEB-12")
        self.assertIsNone(relay.parse_jira("web-12")["url"])
        self.assertIsNone(relay.parse_jira("no key here"))

    def test_jira_project_key(self):
        self.assertEqual(relay.jira_project_key("DATA_PLATFORM_X"), "DATAPLATFO")
        self.assertEqual(relay.jira_project_key("9X"), "J9X")
        self.assertEqual(relay.jira_project_key("A"), "AJ")

    def test_shared_jira_key_is_refused_unless_own_id(self):
        a = {"auto_key": "WEB-R1", "title": "One", "own": False}
        b = {"auto_key": "WEB-R2", "title": "Two", "own": False}
        with self.assertRaises(relay.RelayError) as cm:
            relay.pick_ticket("WEB-500", [a, b])
        self.assertIn("WEB-R1", str(cm.exception))
        self.assertIn("WEB-R2", str(cm.exception))
        self.assertIs(relay.pick_ticket("WEB-500", [a]), a)
        own = dict(b, own=True)
        self.assertIs(relay.pick_ticket("WEB-R2", [own, a]), own)
        self.assertRaises(relay.RelayError, relay.pick_ticket, "WEB-9", [])

    def test_long_jira_prefix_is_a_key(self):
        self.assertEqual(relay.norm_key("data_platform_x-7"), "DATA_PLATFORM_X-7")

    def test_check_value_names_field_line_and_byte(self):
        bad = b"line one\nrange 1\x965".decode("utf-8", "surrogateescape")
        with self.assertRaises(relay.DBError) as cm:
            relay.check_value("brief", bad)
        msg = str(cm.exception)
        self.assertEqual(cm.exception.sqlstate, "22021")
        for part in ("the brief", "0x96", "line 2", "column 8"):
            self.assertIn(part, msg)
        self.assertRaises(relay.DBError, relay.check_value, "need", "a\0b")
        relay.check_value("brief", "fine \u2013 \u2014 \u2026 \u2192 \U0001F600")

    def test_dry_run_wraps_in_a_rolled_back_transaction(self):
        seen = {}

        class R:
            returncode, stdout, stderr = 0, "", ""

        def fake_run(cmd, input=None, **kw):
            seen["cmd"], seen["input"] = cmd, input
            return R()
        saved = relay.subprocess.run, relay.find_psql
        relay.subprocess.run, relay.find_psql = fake_run, lambda: "psql"
        try:
            relay.psql("insert into x values (:'v');", {"v": "1"}, timeout=5, dry_run=True)
        finally:
            relay.subprocess.run, relay.find_psql = saved
        self.assertNotIn("-1", seen["cmd"])
        self.assertEqual(seen["input"], "\\set v '1'\nbegin;\ninsert into x values (:'v');\nrollback;\n")

    def test_new_commands_parse(self):
        p = relay.build_parser()
        a = p.parse_args(["project", "create", "PAT", "--name", "PBI AI Toolkit", "--path", "/x", "--path", "/y"])
        self.assertEqual((a.pkey, a.name, a.paths_, a.kind), ("PAT", "PBI AI Toolkit", ["/x", "/y"], "app"))
        a = p.parse_args(["project", "path", "PAT", "/z", "--remove"])
        self.assertEqual((a.pkey, a.path, a.remove), ("PAT", "/z", True))
        a = p.parse_args(["jira", "https://a/browse/WEB-1", "--key", "INB-5", "--dry-run"])
        self.assertEqual((a.link, a.key, a.dry_run), ("https://a/browse/WEB-1", "INB-5", True))
        a = p.parse_args(["delete", "INB-6"])
        self.assertFalse(a.yes)
        self.assertEqual(p.parse_args(["move", "PAT", "--key", "INB-5"]).project, "PAT")

    def test_project_create_refuses_a_bad_key_before_writing(self):
        saved = relay.q
        relay.q = lambda sql, v=None, timeout=None, dry_run=False: [] if sql == relay.SQL_PROJECTS else self.fail("wrote")
        try:
            args = relay.build_parser().parse_args(["project", "create", "pbi-ai", "--name", "X"])
            self.assertRaises(relay.RelayError, relay.cmd_project, args)
        finally:
            relay.q = saved


class Rly20(unittest.TestCase):
    """RLY-20: ticket type and the plain-English summary."""

    def run_cmd(self, argv, results):
        calls = []

        def fake_q(sql, v=None, timeout=None, dry_run=False):
            calls.append((sql, dict(v or {})))
            return results.get(sql)
        saved = relay.q, relay.target, relay.session_id
        relay.q = fake_q
        relay.target = lambda args, sid: {"id": "00000000-0000-0000-0000-000000000001", "key": "RLY-20"}
        relay.session_id = lambda args: "s1"
        try:
            args = relay.build_parser().parse_args(argv)
            args.fn(args)
        finally:
            relay.q, relay.target, relay.session_id = saved
        return calls

    def test_parse(self):
        p = relay.build_parser()
        self.assertEqual(p.parse_args(["create", "x"]).type, "dev")
        self.assertEqual(p.parse_args(["create", "x", "--type", "bug"]).type, "bug")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertRaises(SystemExit, p.parse_args, ["create", "x", "--type", "feature"])
            self.assertRaises(SystemExit, p.parse_args, ["type", "chore"])
        a = p.parse_args(["type", "bug", "--key", "LST-7"])
        self.assertEqual((a.type, a.key), ("bug", "LST-7"))
        a = p.parse_args(["summary", "The", "list", "works.", "--key", "LST-7"])
        self.assertEqual((a.text, a.key), (["The", "list", "works."], "LST-7"))

    def test_type_sends_the_type(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            calls = self.run_cmd(["type", "bug"], {relay.SQL_TYPE: {"key": "RLY-20", "type": "bug"}})
        self.assertEqual(calls[-1][0], relay.SQL_TYPE)
        self.assertEqual(calls[-1][1]["type"], "bug")
        self.assertIn("RLY-20 is now a bug", out.getvalue())

    def test_summary_writes_the_text_and_refuses_empty(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            calls = self.run_cmd(["summary", "The", "invite", "now", "works."], {relay.SQL_SUMMARY: {"key": "RLY-20", "length": 21}})
        self.assertEqual(calls[-1][1]["text"], "The invite now works.")
        self.assertIn("Plain summary of RLY-20 updated", out.getvalue())
        self.assertRaises(relay.RelayError, self.run_cmd, ["summary", " "], {})

    def test_create_and_get_carry_type(self):
        self.assertIn("type)", relay.SQL_CREATE)
        self.assertIn(":'type'", relay.SQL_CREATE)
        self.assertIn("'summary_plain', t.summary_plain", relay.SQL_GET)


class PsqlVariables(unittest.TestCase):
    """Values reach psql as \\set lines on stdin, never argv (RLY-18: on Windows
    argv is in the ANSI code page, so en dashes broke every :'name')."""

    def run_psql(self, variables):
        seen = {}

        class R:
            returncode, stdout, stderr = 0, "", ""

        def fake_run(cmd, input=None, **kw):
            seen["cmd"], seen["input"] = cmd, input
            return R()
        saved = relay.subprocess.run, relay.find_psql
        relay.subprocess.run, relay.find_psql = fake_run, lambda: "psql"
        try:
            relay.psql("select :'x';", variables, timeout=5)
        finally:
            relay.subprocess.run, relay.find_psql = saved
        return seen

    def test_values_not_in_argv(self):
        seen = self.run_psql({"x": "1–5 — …"})
        self.assertFalse(any("–" in a for a in seen["cmd"]))
        self.assertEqual(seen["input"], "\\set x '1–5 — …'\nselect :'x';")

    def test_quoting(self):
        self.assertEqual(relay.psql_quote("it's a\\b\nc\r\td"), "'it\\'s a\\\\b\\nc\\r\\td'")
        self.assertEqual(relay.psql_quote(""), "''")
        self.assertNotIn("\n", relay.psql_quote("a\nb"))
        self.assertRaises(ValueError, relay.psql_quote, "a\0b")

    def test_none_is_empty_and_names_checked(self):
        self.assertIn("\\set b ''\n", self.run_psql({"b": None})["input"])
        self.assertRaises(ValueError, self.run_psql, {"Bad-Name": "x"})


if __name__ == "__main__":
    unittest.main()
