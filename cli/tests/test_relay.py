"""Unit tests for the pure parts of cli/relay. Run: python3 -m unittest discover -s cli/tests"""

import importlib.machinery
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
