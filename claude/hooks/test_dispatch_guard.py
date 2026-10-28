import json, os, subprocess, sys, unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch-guard.py")


def run(raw):
    r = subprocess.run([sys.executable, HOOK], input=raw, capture_output=True, text=True)
    return r.returncode, r.stdout


def call(prompt, typ="worker"):
    return run(json.dumps({"tool_name": "Agent", "tool_input": {"subagent_type": typ, "prompt": prompt}}))


class T(unittest.TestCase):
    def test_deny(self):
        rc, out = call("버그를 고친다. 증상은 ...")
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_with_files_allows(self):
        self.assertEqual(call("버그를 고친다.\n고칠 파일: src/a.ts:10")[1], "")
        self.assertEqual(call("구현한다\n## 고칠 파일\n- src/a.ts")[1], "")

    def test_research_allows(self):
        self.assertEqual(call("조사: 왜 느린지 fix 후보를 찾는다")[1], "")
        self.assertEqual(call("검토: 수정 내용 확인")[1], "")

    def test_other_type_allows(self):
        self.assertEqual(call("버그를 고친다", typ="general-purpose")[1], "")

    def test_not_work_allows(self):
        self.assertEqual(call("로그를 읽고 요약해 줘", typ="worker")[1], "")

    def test_broken_input_allows(self):
        for raw in ("", "not json", "[]", '{"tool_input": null}'):
            rc, out = run(raw)
            self.assertEqual((rc, out), (0, ""))


if __name__ == "__main__":
    unittest.main()
