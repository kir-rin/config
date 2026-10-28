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


if __name__ == '__main__':
    unittest.main()
