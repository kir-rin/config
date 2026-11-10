#!/usr/bin/env python3
"""inqueue 배분 판단 — 예약이 매번 python 을 새로 짜지 않게 정해진 판단만 한다.

쓰는 법: python3 triage.py <사본 폴더> [지금 ms] [최대 동시 수]
  사본 폴더 = ArtifactData list 의 out_dir (그 아래 tickets/<doc_id>.json)
출력: 할 일 목록(JSON 한 줄씩). 스레드 상태 보기·티켓 쓰기는 모델이 도구로 한다.
version 은 사본에 없으니 list 결과에서 가져온다.
"""
import json
import os
import re
import sys
import time

H = 3600_000
M = 60_000

def load(folder):
    d = os.path.join(folder, 'tickets')
    out = []
    for f in sorted(os.listdir(d)):
        if not f.endswith('.json'):
            continue
        with open(os.path.join(d, f), encoding='utf-8') as fh:
            t = json.load(fh)
        t = t.get('data', t) if isinstance(t, dict) else {}
        t['_id'] = f[:-5]
        out.append(t)
    return out

def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0

def waits(t):
    w = t.get('waiting')
    return [x for x in w if isinstance(x, dict)] if isinstance(w, list) else []

THREAD_HINT = re.compile(r'(t3-thread://|mcp:launch:|thread:[a-z]|스레드)')

def human_text(t):
    parts = [t.get('why') or '', t.get('done') or '', t.get('judgment') or '']
    for h in t.get('history') or []:
        if isinstance(h, dict):
            parts.append(h.get('judgment') or '')
    return '\n'.join(p for p in parts if isinstance(p, str))

def main():
    folder = sys.argv[1]
    now = num(sys.argv[2]) if len(sys.argv) > 2 else int(time.time() * 1000)
    cap = num(sys.argv[3]) if len(sys.argv) > 3 else 10
    ts = load(folder)
    acts = []

    # 0. done 인데 스레드를 아직 settle 안 함 (최대 5)
    for t in [t for t in ts if t.get('status') == 'done' and t.get('threadId') and not t.get('settledAt')][:5]:
        acts.append({'do': 'settle', 'id': t['_id'], 'threadId': t['threadId']})

    # 0.5. 집힌 ai 티켓: 기다리는 중이면 건너뛰고, 아니면 스레드를 봐야 한다
    for t in ts:
        if t.get('status') != 'ai' or not t.get('claimedAt') or not t.get('threadId'):
            continue
        claimed = num(t.get('claimedAt'))
        w = waits(t)
        if w:
            etas = [num(x.get('eta')) for x in w if num(x.get('eta'))]
            deadline = (max(etas) + 15 * M) if etas else claimed + H
            if now < deadline:
                continue  # 백그라운드 기다리는 중
            acts.append({'do': 'recover', 'id': t['_id'], 'threadId': t['threadId'], 'why': 'waiting 시각 지남', 'clearWaiting': True})
            continue
        acts.append({'do': 'check_thread', 'id': t['_id'], 'threadId': t['threadId'],
                     'claimedMin': round((now - claimed) / M, 1),
                     'rule': '스레드가 돌면 둔다. 쉬는데 claimedAt 뒤 마지막 답이 「티켓 못 씀」이거나 claimedMin>10 이면 recover'})

    # 0.7. 미룸을 스레드에 맞춘다
    for t in ts:
        if not t.get('threadId'):
            continue
        su, tsu = num(t.get('snoozeUntil')), num(t.get('threadSnoozedUntil'))
        want = t.get('status') == 'me' and su > now
        if want and tsu != su:
            acts.append({'do': 'snooze', 'id': t['_id'], 'threadId': t['threadId'], 'snoozeUntil': su,
                         'iso': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(su / 1000))})
        elif not want and tsu:
            acts.append({'do': 'unsnooze', 'id': t['_id'], 'threadId': t['threadId']})

    # 1. 집을 티켓
    def busy(t):
        return t.get('status') == 'ai' and (num(t.get('claimedAt')) > now - H or bool(waits(t)))
    running = sum(1 for t in ts if busy(t))
    todo = [t for t in ts if t.get('status') == 'ai' and not waits(t) and num(t.get('claimedAt')) <= now - H]
    todo.sort(key=lambda t: num(t.get('createdAt')))
    for t in todo[:max(0, cap - running)]:
        a = {'do': 'claim', 'id': t['_id'], 'title': t.get('title') or '', 'threadId': t.get('threadId') or None,
             'settledAt': bool(t.get('settledAt'))}
        if THREAD_HINT.search(human_text(t)):
            a['humanThreadHint'] = True  # 사람 칸에 스레드 지시가 있을 수 있다 → 3a 를 본다
        acts.append(a)

    print(json.dumps({'now': now, 'running': running, 'todo': len(todo), 'cap': cap}, ensure_ascii=False))
    for a in acts:
        print(json.dumps(a, ensure_ascii=False))
    if not acts:
        print('할 일 없음')

if __name__ == '__main__':
    main()
