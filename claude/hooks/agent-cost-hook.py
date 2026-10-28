#!/usr/bin/env python3
"""SubagentStop hook: 끝난 subagent 하나의 비용 한 줄을 이력에 더한다(표준 라이브러리만).

- 입력(stdin JSON): agent_id · agent_type · agent_transcript_path (공식 문서 SubagentStop input)
- 이력: ~/.claude/agent-cost/history-YYYY-MM.jsonl (환경변수 AGENT_COST_HISTORY 로 바꿀 수 있다)
- 줄 하나 = agent 하나. run 칸은 기록 경로의 workflows/wf_… 폴더 이름, 없으면 agent id.
- 이번 달·지난달 파일에 같은 agent id 가 있으면 건너뛴다.
- 아무것도 출력하지 않고 막지 않는다: 어떤 실패든 exit 0, 2초 넘으면 그만둔다. 큰 기록은 앞 1MB + 뒤쪽만 읽는다.
그림은 메인이 `agent-cost.py --chart --run <id>` 로 띄운다.
"""
import importlib.util
import json
import os
import signal
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
COST = os.path.join(HERE, '..', 'subagent-templates', 'agent-cost.py')
MAX_BYTES = 8 << 20
BUDGET_SEC = 2


def load_cost():
    spec = importlib.util.spec_from_file_location('agent_cost', COST)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def label_for(cost, path, agent_id, agent_type):
    lab = cost.meta_label(path)
    jp = os.path.join(os.path.dirname(path), 'journal.jsonl')
    if os.path.exists(jp):
        with open(jp, encoding='utf-8') as f:
            for l in f:
                if agent_id in l and '"started"' in l:
                    try:
                        lab = json.loads(l).get('label') or lab
                    except json.JSONDecodeError:
                        pass
                    break
    return lab or agent_type or agent_id


def handle(inp, hist=None):
    """이력에 한 줄을 더했으면 True. 건너뛰면 False."""
    hist = os.path.expanduser(hist or os.environ.get('AGENT_COST_HISTORY') or '~/.claude/agent-cost')
    path = os.path.expanduser(inp.get('agent_transcript_path') or '')
    agent_id = inp.get('agent_id') or ''
    if not agent_id or not path or not os.path.isfile(path):
        return False
    if not inp.get('agent_type'):
        return False  # 프롬프트 제안·/btw 같은 내부 agent(문서: agent_type 이 빈 값)
    cost = load_cost()
    r = cost.analyze(path, label_for(cost, path, agent_id, inp.get('agent_type')), max_bytes=MAX_BYTES)
    if not r:
        return False
    return cost.append_row(hist, cost.summarize(r, agent_id))


def main():
    def stop(*_):
        raise TimeoutError
    try:
        signal.signal(signal.SIGALRM, stop)
        signal.alarm(BUDGET_SEC)
        handle(json.load(sys.stdin))
    except BaseException:
        pass
    finally:
        try:
            signal.alarm(0)
        except Exception:
            pass
    sys.exit(0)


if __name__ == '__main__':
    main()
