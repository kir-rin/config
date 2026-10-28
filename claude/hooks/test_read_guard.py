#!/usr/bin/env python3
"""read-guard.py 단위 시험. python3 test_read_guard.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "read-guard.py")
KRAFTON = os.path.realpath(os.path.expanduser("~/Krafton"))


def run(payload, raw=None):
    p = subprocess.run([sys.executable, HOOK], input=raw if raw is not None else json.dumps(payload),
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout) if p.stdout.strip() else None


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 범위 안 임시 폴더: ~/Krafton/payroll-desk-guardtest-XXXX (형제 worktree 이름 규칙)
        cls.inside = tempfile.mkdtemp(prefix="payroll-desk-guardtest-", dir=KRAFTON)
        cls.outside = tempfile.mkdtemp()
        for d in (cls.inside, cls.outside):
            open(os.path.join(d, "big.ts"), "w").write("x\n" * 301)
            open(os.path.join(d, "small.ts"), "w").write("x\n" * 300)
        cls.docs = os.path.join(KRAFTON, "payroll-desk-docs")

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls.inside, ignore_errors=True)
        shutil.rmtree(cls.outside, ignore_errors=True)

    def read(self, path, **kw):
        return run({"tool_name": "Read", "cwd": "/", "tool_input": {"file_path": path, **kw}})

    def bash(self, cmd, cwd=None):
        return run({"tool_name": "Bash", "cwd": cwd or self.inside, "tool_input": {"command": cmd}})

    def assertDenied(self, out):
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertIn("docs/MAP.md", out["hookSpecificOutput"]["permissionDecisionReason"])

    # 막아야 할 것
    def test_read_big_without_limit(self):
        self.assertDenied(self.read(self.inside + "/big.ts"))

    def test_cat_big(self):
        self.assertDenied(self.bash("cat big.ts"))

    def test_cat_multiple(self):
        self.assertDenied(self.bash("cat small.ts big.ts"))

    def test_cat_after_and(self):
        self.assertDenied(self.bash("cd x && cat big.ts"))

    # 허용
    def test_read_with_limit(self):
        self.assertIsNone(self.read(self.inside + "/big.ts", limit=50, offset=10))

    def test_read_300_lines(self):
        self.assertIsNone(self.read(self.inside + "/small.ts"))

    def test_cat_piped(self):
        for c in ("cat big.ts | wc -l", "cat big.ts | head -20", "cat big.ts | grep x", "cat big.ts | sed -n 1,5p", "cat big.ts | tail -3"):
            self.assertIsNone(self.bash(c), c)

    def test_cat_small_and_redirect(self):
        self.assertIsNone(self.bash("cat small.ts"))
        self.assertIsNone(self.bash("cat > big.ts <<'EOF'\nhi\nEOF"))
        self.assertIsNone(self.bash("sed -n 1,5p big.ts"))

    def test_missing_file(self):
        self.assertIsNone(self.bash("cat nothere.ts"))
        self.assertIsNone(self.read(self.inside + "/nothere.ts"))

    # 범위 밖
    def test_outside_scope(self):
        self.assertIsNone(self.read(self.outside + "/big.ts"))
        self.assertIsNone(self.bash("cat big.ts", cwd=self.outside))
        self.assertIsNone(self.bash("cat /etc/hosts"))

    def test_docs_repo_excluded(self):
        if os.path.isdir(self.docs):
            for f in os.listdir(self.docs):
                self.assertIsNone(self.read(os.path.join(self.docs, f)))

    # 깨진 입력
    def test_broken_input(self):
        for raw in ("", "not json", "[]", "null", '{"tool_name":"Read"}', '{"tool_name":"Bash","tool_input":{"command":"cat \'unclosed"}}',
                    '{"tool_name":"Read","tool_input":{"file_path":123}}', '{"tool_name":"Other"}'):
            self.assertIsNone(run(None, raw=raw), raw)


if __name__ == "__main__":
    unittest.main()
