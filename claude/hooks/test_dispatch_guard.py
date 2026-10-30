import json, os, subprocess, sys, tempfile, unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch-guard.py")


def run(raw):
    r = subprocess.run([sys.executable, HOOK], input=raw, capture_output=True, text=True)
    return r.returncode, r.stdout


def call(prompt, typ="worker", cwd=None):
    data = {"tool_name": "Agent", "tool_input": {"subagent_type": typ, "prompt": prompt}}
    if cwd:
        data["cwd"] = cwd
    return run(json.dumps(data))


class ViewkitRepo(unittest.TestCase):
    """추상화 검사 — 능력을 만들라는 지시에 `추상화:` 줄을 요구한다. viewkit-mcp 레포(`src/recipe/` 있음)에서만 돈다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = os.path.join(self.tmp.name, "viewkit-mcp")
        os.makedirs(os.path.join(self.repo, "src", "recipe"))
        self.other = os.path.join(self.tmp.name, "other-repo")
        os.makedirs(self.other)

    def reason(self, out):
        return json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"]

    def test_named_new_capability_denies(self):
        p = "능력 `hub.board` 를 만든다.\n고칠 파일: src/caps/hub-board.ts"
        r = self.reason(call(p, cwd=self.repo)[1])
        self.assertIn("추상화: <일반 동작>", r)
        self.assertIn("레시피 설정", r)
        self.assertIn("이름이 원본에 묶여", r)  # 원본 이름이 박힌 id — 막는 이유에 덧붙인다

    def test_generic_new_capability_denies_without_name_note(self):
        p = "새 능력 `rows.span` 을 만든다.\n고칠 파일: src/recipe/caps.ts"
        r = self.reason(call(p, cwd=self.repo)[1])
        self.assertIn("추상화: <일반 동작>", r)
        self.assertNotIn("이름이 원본에 묶여", r)  # 일반 낱말이 앞에 온 id 는 이름 경고 없음

    def test_new_capability_word_denies(self):
        p = "새 능력을 하나 추가한다.\n고칠 파일: src/caps/x.ts"
        self.assertIn("추상화: <일반 동작>", self.reason(call(p, cwd=self.repo)[1]))

    def test_prompt_path_in_viewkit_denies(self):
        p = (f"{self.repo}/src/caps/hub-board.ts 에 새 능력을 만든다.\n"
             f"고칠 파일: {self.repo}/src/caps/hub-board.ts")
        self.assertIn("추상화: <일반 동작>", self.reason(call(p, cwd=self.other)[1]))

    def test_abstract_line_allows(self):
        p = ("능력 `rows.span` 를 만든다.\n추상화: events.span — 원본 주소·키·날짜 칸은 레시피 설정으로\n"
             "고칠 파일: src/recipe/caps.ts")
        self.assertEqual(call(p, cwd=self.repo)[1], "")

    def test_reuse_line_still_allows(self):
        p = ("능력 `rows.span` 를 만든다.\n재사용 확인: 범용 api.get 은 기간 계산을 못 한다\n"
             "고칠 파일: src/recipe/caps.ts")
        self.assertEqual(call(p, cwd=self.repo)[1], "")

    def test_name_bound_id_with_abstract_line_warns_only(self):
        p = ("능력 `hub.board` 를 만든다.\n추상화: api.get — 원본 주소·키는 레시피 설정으로\n"
             "고칠 파일: src/caps/hub-board.ts")
        rc, out = call(p, cwd=self.repo)
        self.assertEqual(rc, 0)
        msg = json.loads(out)["systemMessage"]  # 막지 않고 알리기만
        self.assertIn("이름이 원본에 묶여", msg)
        self.assertNotIn("permissionDecision", out)

    def test_no_new_capability_allows(self):
        p = "능력 `rows.join` 에 `reuse` 칸을 추가한다.\n고칠 파일: src/recipe/caps.ts"
        self.assertEqual(call(p, cwd=self.repo)[1], "")

    def test_other_repo_allows(self):
        p = "능력 `hub.board` 를 만든다.\n고칠 파일: src/caps/hub-board.ts"
        self.assertEqual(call(p, cwd=self.other)[1], "")

    def test_research_allows(self):
        self.assertEqual(call("조사: 새 능력이 필요한지 본다", cwd=self.repo)[1], "")

    def test_negated_new_capability_allows(self):
        p = "능력 `rows.classify` 를 고친다. 새 능력은 만들지 않는다.\n고칠 파일: src/recipe/caps.ts"
        self.assertEqual(call(p, cwd=self.repo)[1], "")


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

    def test_too_many_items_denies(self):
        p = "구현한다\n고칠 파일: src/a.ts\n만들 것:\n1. a\n2. b\n3. c\n4. d\n5. e\n"
        self.assertIn("규칙 16", json.loads(call(p)[1])["hookSpecificOutput"]["permissionDecisionReason"])

    def test_too_many_files_denies(self):
        files = "\n".join(f"- src/f{i}.ts" for i in range(11))
        self.assertIn("고칠 파일 11개", json.loads(call("구현한다\n고칠 파일:\n" + files)[1])["hookSpecificOutput"]["permissionDecisionReason"])

    def test_size_ok_line_allows(self):
        p = "구현한다\n크기 확인: 같은 파일 하나를 고치는 기계적 작업\n고칠 파일: src/a.ts\n만들 것:\n1. a\n2. b\n3. c\n4. d\n5. e\n"
        self.assertEqual(call(p)[1], "")

    def test_small_allows(self):
        self.assertEqual(call("구현한다\n고칠 파일: src/a.ts, src/b.ts\n만들 것:\n1. a\n2. b\n")[1], "")

    def test_company_worker_checked(self):
        self.assertEqual(json.loads(call("버그를 고친다", typ="company-worker")[1])["hookSpecificOutput"]["permissionDecision"], "deny")

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
