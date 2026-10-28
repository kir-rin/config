import os, subprocess, sys, tempfile, unittest, pathlib

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'task-brief.py')


def run(*args):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True)


class FolderPlan(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        r = pathlib.Path(self.t.name)
        self.plan = r / 'plan'
        (self.plan / 'tasks').mkdir(parents=True)
        (self.plan / 'plan.md').write_text('# plan\nPLANONLY\n')
        (self.plan / 'constraints.md').write_text('CONSTRAINT-LINE\n')
        (self.plan / 'interfaces.md').write_text(
            '# ifaces\n## I-alpha\nALPHA-BODY\n## I-beta\nBETA-BODY\n## I-gamma\nGAMMA-BODY\n')
        (self.plan / 'tasks' / '01-x.md').write_text(
            '---\nid: 01\ntitle: X\nuses: [I-alpha]\nproduces: [I-beta]\ntags: [ui, pii]\n---\nTASKBODY\n## 고칠 파일\n- `src/a.ts`\n')
        (self.plan / 'tasks' / '02-y.md').write_text(
            '---\nid: 02\ntitle: Y\nuses: [I-nope]\nproduces: []\ntags: [ui]\n---\nY\n## 고칠 파일\n- `src/y.ts`\n')
        self.dec = r / 'decisions.md'
        self.dec.write_text('# d\n- 겹침 결정 [tags: pii, ops]\n- 무관 결정 [tags: export]\n'
                            '1. 항상 결정 [tags: always]\n2. 태그 없음\n')

    def tearDown(self):
        self.t.cleanup()

    def test_folder(self):
        r = run(str(self.plan), '1', '--decisions', str(self.dec))
        self.assertEqual(r.returncode, 0, r.stderr)
        o = r.stdout
        self.assertTrue(o.startswith('> 이 파일이 요구사항 정본'))
        self.assertIn('TASKBODY', o)
        self.assertIn('CONSTRAINT-LINE', o)
        self.assertIn('ALPHA-BODY', o)
        self.assertIn('BETA-BODY', o)
        self.assertNotIn('GAMMA-BODY', o)
        self.assertNotIn('PLANONLY', o)
        self.assertIn('겹침 결정', o)
        self.assertIn('항상 결정', o)
        self.assertNotIn('무관 결정', o)
        self.assertNotIn('태그 없음', o)
        self.assertIn('interfaces.md L', o)

    def test_zero_padded_number(self):
        self.assertEqual(run(str(self.plan), '01', '--decisions', str(self.dec)).returncode, 0)

    def test_missing_id_exit2(self):
        r = run(str(self.plan), '02', '--decisions', str(self.dec))
        self.assertEqual(r.returncode, 2)
        self.assertIn('I-nope', r.stderr)


class FixFiles(unittest.TestCase):
    def mk(self, body, front='tags: [ui]'):
        self.t = tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        plan = pathlib.Path(self.t.name) / 'plan'
        (plan / 'tasks').mkdir(parents=True)
        (plan / 'tasks' / '01-x.md').write_text(f'---\nid: 01\n{front}\n---\n{body}\n')
        return str(plan)

    def test_no_section_exit3(self):
        r = run(self.mk('본문만'), '1')
        self.assertEqual(r.returncode, 3)
        self.assertIn('고칠 파일', r.stderr)

    def test_no_path_exit3(self):
        r = run(self.mk('## 고칠 파일\n- 없음\n'), '1')
        self.assertEqual(r.returncode, 3)

    def test_with_path_ok(self):
        r = run(self.mk('## 고칠 파일\n- `src/a.ts:10`\n'), '1')
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_research_skips(self):
        r = run(self.mk('조사만', front='kind: research'), '1')
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_repo_missing_warns_unless_new(self):
        plan = self.mk('## 고칠 파일\n- `src/a.ts`\n- `src/b.ts` (새 파일)\n')
        r = run(plan, '1', '--repo', self.t.name)
        self.assertEqual(r.returncode, 0)
        self.assertIn('src/a.ts', r.stderr)
        self.assertNotIn('src/b.ts', r.stderr)


class SingleFilePlan(unittest.TestCase):
    def test_legacy(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / 'plan.md'
            p.write_text('# P\n\n## Global Constraints\n- 규칙\n\n## Tasks\n\n### Task 1: 하나\n본문 `someHelperName` 사용\n\n### Task 2: 둘\n다른\n')
            r = run(str(p), '1')
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn('### Task 1: 하나', r.stdout)
            self.assertNotIn('### Task 2', r.stdout)
            self.assertEqual(run(str(p), '9').returncode, 1)


if __name__ == '__main__':
    unittest.main()
