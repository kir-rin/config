#!/usr/bin/env python3
"""agent-cost-hook.py 시험: python3 test_agent_cost_hook.py"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.realpath(__file__))
HOOK = os.path.join(HERE, 'agent-cost-hook.py')


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


hook = load(HOOK, 'agent_cost_hook')
cost = hook.load_cost()


def make_agent(folder, aid, label, day='2026-10-28', hour=1, ctx=(60000, 90000)):
    os.makedirs(folder, exist_ok=True)
    p = os.path.join(folder, f'agent-{aid}.jsonl')
    t = lambda m: f'{day}T{hour:02d}:{m:02d}:00.000Z'
    recs = [
        {'type': 'user', 'timestamp': t(0), 'message': {'content': 'go'}},
        {'type': 'assistant', 'timestamp': t(1), 'message': {'id': 'm1', 'model': 'claude-sonnet-5-5',
         'usage': {'input_tokens': ctx[0], 'output_tokens': 100},
         'content': [{'type': 'tool_use', 'id': 'u1', 'name': 'Read', 'input': {'file_path': '/x/a.md'}}]}},
        {'type': 'user', 'timestamp': t(2), 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'u1', 'content': 'line\n' * 400}]}},
        {'type': 'assistant', 'timestamp': t(3), 'message': {'id': 'm2', 'model': 'claude-sonnet-5-5',
         'usage': {'input_tokens': ctx[1], 'output_tokens': 50},
         'content': [{'type': 'tool_use', 'id': 'u2', 'name': 'Read', 'input': {'file_path': '/x/big.ts'}}]}},
        {'type': 'user', 'timestamp': t(4), 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'u2',
         'content': 'PreToolUse:Read hook error: 필요한 줄만 읽으세요'}]}},
    ]
    with open(p, 'w') as f:
        f.write('\n'.join(json.dumps(r) for r in recs) + '\n')
    with open(p[:-6] + '.meta.json', 'w') as f:
        json.dump({'description': label}, f)
    return p


def make_signal_agent(folder, aid, label, steps, day='2026-10-28', hour=1):
    """steps = [(name, input, result_text, is_error)] — 호출마다 assistant 턴 하나."""
    os.makedirs(folder, exist_ok=True)
    p = os.path.join(folder, f'agent-{aid}.jsonl')
    t = lambda m: f'{day}T{hour:02d}:{m:02d}:00.000Z'
    recs = [{'type': 'user', 'timestamp': t(0), 'message': {'content': 'go'}}]
    for i, (name, ip, res, err) in enumerate(steps):
        recs.append({'type': 'assistant', 'timestamp': t(1 + i), 'message': {'id': f'm{i}', 'model': 'claude-sonnet-5-5',
                     'usage': {'input_tokens': 1000, 'output_tokens': 10},
                     'content': [{'type': 'tool_use', 'id': f'u{i}', 'name': name, 'input': ip}]}})
        tr = {'type': 'tool_result', 'tool_use_id': f'u{i}', 'content': res}
        if err:
            tr['is_error'] = True
        recs.append({'type': 'user', 'timestamp': t(1 + i), 'message': {'content': [tr]}})
    with open(p, 'w') as f:
        f.write('\n'.join(json.dumps(r) for r in recs) + '\n')
    with open(p[:-6] + '.meta.json', 'w') as f:
        json.dump({'description': label}, f)
    return p


def inp(path, aid):
    return {'hook_event_name': 'SubagentStop', 'agent_id': aid, 'agent_type': 'general-purpose', 'agent_transcript_path': path}


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.hist = os.path.join(self.root, 'hist')
        self.sess = os.path.join(self.root, 'proj', 'sess', 'subagents')

    def tearDown(self):
        self.tmp.cleanup()

    def rows(self):
        return cost.read_rows(cost.hist_files(self.hist, ['2026-09', '2026-10', '2026-11']))

    def test_same_agent_twice_is_one_line(self):
        p = make_agent(self.sess, 'aaa1', 'T1 구현')
        self.assertTrue(hook.handle(inp(p, 'aaa1'), self.hist))
        self.assertFalse(hook.handle(inp(p, 'aaa1'), self.hist))
        self.assertEqual(len(self.rows()), 1)

    def test_workflow_agents_three_lines_one_run(self):
        wf = os.path.join(self.sess, 'workflows', 'wf_test-1')
        for i, lab in enumerate(['T1 구현', 'T1 검토', 'T1 수정 1']):
            p = make_agent(wf, f'w{i}', lab, hour=1 + i)
            hook.handle(inp(p, f'w{i}'), self.hist)
        rows = self.rows()
        self.assertEqual(len(rows), 3)
        self.assertEqual({r['run'] for r in rows}, {'wf_test-1'})
        out = cost.chart(rows, 'wf_test-1')
        self.assertIn('agent 3개', out)
        self.assertIn('T1 수정 1', out)

    def test_standalone_is_separate_run(self):
        wf = os.path.join(self.sess, 'workflows', 'wf_test-1')
        for i in range(3):
            hook.handle(inp(make_agent(wf, f'w{i}', f'T{i} 구현', hour=1 + i), f'w{i}'), self.hist)
        hook.handle(inp(make_agent(self.sess, 'solo9', '단독 조사', hour=6), 'solo9'), self.hist)
        runs = cost.group_runs(self.rows())
        self.assertEqual(set(runs), {'wf_test-1', 'solo9'})
        self.assertEqual(len(runs['wf_test-1']), 3)
        self.assertEqual(len(runs['solo9']), 1)
        self.assertIn('agent 1개', cost.chart(self.rows()))  # 기본 = 가장 최근 run(단독)

    def test_row_fields(self):
        hook.handle(inp(make_agent(self.sess, 'aaa1', 'T1 구현'), 'aaa1'), self.hist)
        r = self.rows()[0]
        self.assertEqual((r['run'], r['role'], r['ctx_first'], r['ctx_end']), ('aaa1', '구현', 60000, 90000))
        self.assertEqual((r['blocked'], r['over300']), (1, 1))
        self.assertGreater(r['md_kb'], 0)
        self.assertTrue(all(len(x['cmd']) <= 60 for x in r['top']))

    def test_monthly_files_and_prev_month_dedupe(self):
        p = make_agent(self.sess, 'm1', 'T 구현', day='2026-10-31', hour=23)
        hook.handle(inp(p, 'm1'), self.hist)
        self.assertTrue(os.path.exists(os.path.join(self.hist, 'history-2026-10.jsonl')))
        p2 = make_agent(os.path.join(self.root, 'other'), 'm1', 'T 구현', day='2026-11-01', hour=0)
        self.assertFalse(hook.handle(inp(p2, 'm1'), self.hist))  # 지난달 파일에 같은 id
        self.assertFalse(os.path.exists(os.path.join(self.hist, 'history-2026-11.jsonl')) and
                         os.path.getsize(os.path.join(self.hist, 'history-2026-11.jsonl')) > 0)

    def test_previous_run_comparison(self):
        for w, ctx in (('wf_a', (60000, 200000)), ('wf_b', (60000, 100000))):
            d = os.path.join(self.sess, 'workflows', w)
            hook.handle(inp(make_agent(d, w + 'x', 'T 구현', hour=1 if w == 'wf_a' else 5, ctx=ctx), w + 'x'), self.hist)
        out = cost.chart(self.rows(), 'wf_b')
        self.assertIn('▼ 마칠 때 대화 길이 −50% (지난 wf_a)', out)

    def test_cli_never_blocks(self):
        for stdin in ('not json', json.dumps({'agent_id': 'x', 'agent_transcript_path': '/nope'}), ''):
            r = subprocess.run([sys.executable, HOOK], input=stdin, capture_output=True, text=True,
                               env=dict(os.environ, AGENT_COST_HISTORY=self.hist), timeout=10)
            self.assertEqual((r.returncode, r.stdout), (0, ''))

    def test_empty_agent_type_skipped(self):
        p = make_agent(self.sess, 'int1', 'x')
        d = inp(p, 'int1')
        d['agent_type'] = ''
        self.assertFalse(hook.handle(d, self.hist))

    def test_new_signals(self):
        wf = os.path.join(self.sess, 'workflows', 'wf_sig')
        impl = make_signal_agent(wf, 'i1', 'T1 구현', [
            ('Read', {'file_path': '/x/a.ts'}, 'ok', False),
            ('Bash', {'command': 'ls'}, 'ok', False),
            ('Bash', {'command': 'mkdir -p /x/y'}, 'ok', False),          # 쓰기가 아님
            ('Edit', {'file_path': '/x/a.ts'}, 'ok', False),              # 첫 쓰기 = 4번째 턴
            ('Bash', {'command': 'npm test'}, 'Exit code 1\nfail', False),  # 실패 + 전체 테스트
            ('Bash', {'command': 'npm test'}, 'ok', False),               # 같은 실패 명령 재실행 = 헛돈
            ('Bash', {'command': 'npm test -- test/a.test.ts'}, 'ok', False),  # 범위 좁힘: 전체 아님
            ('Read', {'file_path': '/nope'}, 'no such file', True),       # is_error
        ])
        rev = make_signal_agent(wf, 'r1', 'T1 검토', [
            ('Bash', {'command': 'cat > /tmp/z <<EOF\nx\nEOF'}, 'ok', False),
            ('StructuredOutput', {'verdict': 'needs_fixes', 'findings': [
                {'severity': 'important'}, {'severity': 'minor'}, {'severity': 'minor'}]}, 'ok', False),
        ], hour=2)
        hook.handle(inp(impl, 'i1'), self.hist)
        hook.handle(inp(rev, 'r1'), self.hist)
        rows = {r['agent_id']: r for r in self.rows()}
        self.assertEqual((rows['i1']['start_turns'], rows['i1']['failed'], rows['i1']['full_tests']), (3, 3, 2))
        self.assertIsNone(rows['r1']['start_turns'])  # 검토 agent 는 뺀다
        self.assertEqual(rows['r1']['find'], [0, 1, 2])
        out = cost.chart(self.rows(), 'wf_sig')
        self.assertIn('착수까지 턴', out)
        self.assertIn('쓴 양 K', out)
        self.assertIn('헛돈 시도', out)
        self.assertIn('전체 테스트 실행 수', out)
        self.assertIn('심각 0 · 중요 1 · 사소 2', out)

    def _commit_agent(self, wf, aid, nfiles, extra=None, outs=10):
        steps = [('Write', {'file_path': '/x/a'}, 'ok', False),
                 ('Bash', {'command': 'git commit -m x'}, f'[main abc] x\n {nfiles} files changed, 9 insertions(+)', False)]
        return make_signal_agent(wf, aid, 'T1 구현', steps + (extra or []))

    def test_files_changed_from_commit_and_todo_priority(self):
        wf = os.path.join(self.sess, 'workflows', 'wf_files')
        hook.handle(inp(self._commit_agent(wf, 'f1', 26), 'f1'), self.hist)
        self.assertEqual(self.rows()[0]['files'], 26)
        out = cost.chart(self.rows(), 'wf_files')
        self.assertIn('바뀐 파일 수', out)
        self.assertIn('화면 부품 하나 = 과업 하나로 쪼개기', out)

    def test_files_beat_big_output_rule(self):
        # 쓴 양 K > 50 이어도 파일이 15 넘으면 쪼개기가 먼저
        rows = [dict(run='wf_x', agent_id='a', label='T1 구현', role='구현', model='m', start='2026-10-28T01:00:00+00:00',
                     end='2026-10-28T01:05:00+00:00', min=5, turns=3, ctx_first=1000, ctx_end=2000, out_tok=60000,
                     dup_kb=0, reread=0, md_kb=0, blocked=0, over300=0, over300_kb=0, result_kb=1, explained_tok=0, top=[],
                     start_turns=2, failed=0, full_tests=0, find=None, files=20)]
        out = cost.chart(rows, 'wf_x')
        self.assertIn('쪼개기', out)
        self.assertNotIn('시그니처', out)
        rows[0]['files'] = 5
        out = cost.chart(rows, 'wf_x')
        self.assertIn('시그니처', out)

    def test_files_from_structured_output(self):
        wf = os.path.join(self.sess, 'workflows', 'wf_so')
        p = make_signal_agent(wf, 'so1', 'T1 구현', [('Write', {'file_path': '/x/a'}, 'ok', False),
                              ('StructuredOutput', {'files_changed': 12}, 'ok', False)])
        hook.handle(inp(p, 'so1'), self.hist)
        self.assertEqual(self.rows()[0]['files'], 12)

    def test_old_rows_show_dash(self):
        hook.handle(inp(make_agent(self.sess, 'old1', 'T 구현'), 'old1'), self.hist)
        row = self.rows()[0]
        for k in ('start_turns', 'failed', 'full_tests', 'find'):
            row.pop(k, None)
        out = cost.chart([row], row['run'])
        self.assertIn('—', out)

    def test_todo_rules(self):
        wf = os.path.join(self.sess, 'workflows', 'wf_todo')
        steps = [('Read', {'file_path': '/x/a'}, 'ok', False)] * 16 + [('Write', {'file_path': '/x/b'}, 'ok', False)]
        hook.handle(inp(make_signal_agent(wf, 's1', 'T1 구현', steps), 's1'), self.hist)
        self.assertIn('고칠 파일·줄 위치를 더 적기', cost.chart(self.rows(), 'wf_todo'))

    def test_read_kind_classification(self):
        k = cost.read_kind
        self.assertEqual(k('git diff abc..def'), 'diff')
        self.assertEqual(k('git show HEAD'), 'diff')
        self.assertEqual(k('cat sdd/x/brief.md'), '시작 문서')
        self.assertEqual(k('/r/docs/MAP.md'), '시작 문서')
        self.assertEqual(k('sed -n 1,50p src/a.ts'), '소스 코드')
        self.assertEqual(k('/r/src/a.tsx'), '소스 코드')
        self.assertEqual(k('npm test -- a.test.ts'), '시험·빌드')
        self.assertEqual(k('npx tsc --noEmit'), '시험·빌드')
        self.assertEqual(k('ls -la'), '기타')

    def test_chart_read_kinds_and_per_agent_top(self):
        wf = os.path.join(self.sess, 'workflows', 'wf_rk')
        steps = [('Bash', {'command': 'git diff a..b'}, 'x\n' * 3000, False),
                 ('Read', {'file_path': '/r/sdd/brief.md'}, 'y\n' * 100, False),
                 ('Bash', {'command': 'sed -n 1,9p src/a.ts'}, 'z\n' * 50, False)]
        hook.handle(inp(make_signal_agent(wf, 'rk1', 'T1 검토', steps), 'rk1'), self.hist)
        row = self.rows()[0]
        self.assertEqual(row['read_kb_by_kind']['diff'][1], 1)
        self.assertGreater(row['read_kb_by_kind']['diff'][0], 5)
        self.assertEqual(row['read_kb_by_kind']['시작 문서'][1], 1)
        out = cost.chart(self.rows(), 'wf_rk')
        self.assertIn('큰 읽기 종류별 합계', out)
        self.assertIn('█', out)
        self.assertIn('agent 별 가장 큰 결과', out)
        self.assertRegex(out, r'T1 검토\s+\d+\.\dKB diff\s+git diff a\.\.b')

    def test_old_rows_without_read_kinds(self):
        hook.handle(inp(make_agent(self.sess, 'ok1', 'T 구현'), 'ok1'), self.hist)
        row = self.rows()[0]
        row.pop('read_kb_by_kind')
        for x in row['top']:
            x.pop('kind', None)
        out = cost.chart([row], row['run'])
        self.assertIn('—', out)

    def test_rebuild_run(self):
        wf = os.path.join(self.sess, 'workflows', 'wf_rb')
        hook.handle(inp(make_agent(wf, 'rb1', 'T 구현'), 'rb1'), self.hist)
        f = os.path.join(self.hist, 'history-2026-10.jsonl')
        row = json.loads(open(f).read())
        row.pop('failed')
        open(f, 'w').write(json.dumps(row) + '\n')
        self.assertEqual(cost.delete_runs(self.hist, {'wf_rb'}), 1)
        self.assertEqual(self.rows(), [])
        hook.handle(inp(os.path.join(wf, 'agent-rb1.jsonl'), 'rb1'), self.hist)
        self.assertIn('failed', self.rows()[0])


if __name__ == '__main__':
    unittest.main()
