#!/usr/bin/env python3
"""SubagentStop hook — subagent 가 띄우고 닫지 않은 프로세스가 남았으면 끝내지 못하게 돌려보낸다.

왜(2026-10-31): 시험이 띄운 headless 크롬이 남아 파이프를 쥐고 88초 시험이 10분을 기다렸다.
worker 규칙에 「띄운 건 닫고 pgrep 확인」을 넣었지만 haiku·sonnet 둘 다 함정 시험에서 지키지 않았다.

찾는 것: 그 agent 가 일한 동안 새로 생겼고 부모가 사라진(ppid 1) 내 프로세스 중
         node·tsx·npm·python·deno·bun 이나 headless/자동화 크롬.
하는 것: 있으면 직접 닫고(SIGTERM → 1초 뒤 남으면 SIGKILL) 로그(~/.claude/agent-cost/leftover-guard.log)와 stderr 에 남긴다.
         처음엔 block 으로 agent 에게 닫게 했지만 SubagentStop 의 block 이 이 환경에서 무시돼 바꿨다.
         대상이 좁다: 그 agent 가 일한 동안 생겼고 · 부모가 사라졌고(ppid 1) · 내 것이고 · 시험류 명령이고 · 그 agent 가 일한 폴더(cd·파일 경로) 아래에서 돈 것만.
입력(stdin JSON): agent_id · agent_transcript_path · stop_hook_active
"""
import json, os, re, subprocess, sys, time
from datetime import datetime

PAT = re.compile(r'(^|/)(node|tsx|npm|npx|python3?|deno|bun)(\s|$)|Google Chrome.*(--headless|--disable-field-trial-config|--remote-debugging)|chrome-headless|Chromium.*--headless')
SKIP = re.compile(r'herdr|Claude\.app|claude-code|/\.orca/|leftover-guard|agent-cost-hook|Visual Studio Code|Cursor\.app')


def agent_start(path):
    try:
        with open(os.path.expanduser(path)) as f:
            for line in f:
                t = json.loads(line).get('timestamp')
                if t:
                    return datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp()
    except Exception:
        pass
    return None


def agent_dirs(path):
    """그 agent 가 일한 폴더들 — Bash 의 cd 대상·파일 도구의 경로. 다른 agent 의 프로세스를 잘못 닫지 않게(2026-10-31: 나란히 돈 agent 것까지 닫음)."""
    dirs = set()
    try:
        for line in open(os.path.expanduser(path)):
            for b in ((json.loads(line).get('message') or {}).get('content') or []):
                if not isinstance(b, dict) or b.get('type') != 'tool_use':
                    continue
                inp = b.get('input') or {}
                for m in re.finditer(r'\bcd\s+([^\s;&|]+)', str(inp.get('command') or '')):
                    dirs.add(os.path.expanduser(m.group(1)).rstrip('/'))
                fp = inp.get('file_path') or inp.get('path')
                if fp:
                    dirs.add(os.path.dirname(os.path.expanduser(str(fp))).rstrip('/'))
    except Exception:
        pass
    home = os.path.realpath(os.path.expanduser('~'))
    return {os.path.realpath(d) for d in dirs if d.startswith('/')} - {'', '/', home}  # /tmp → /private/tmp 처럼 실제 경로로


def cwd_of(pid):
    try:
        out = subprocess.run(['lsof', '-a', '-p', pid, '-d', 'cwd', '-Fn'], capture_output=True, text=True, timeout=3).stdout
        return next((l[1:] for l in out.splitlines() if l.startswith('n')), '')
    except Exception:
        return ''


def etime_s(e):
    d, _, rest = e.partition('-') if '-' in e else ('0', '', e)
    p = [int(x) for x in rest.split(':')]
    while len(p) < 3:
        p.insert(0, 0)
    return int(d) * 86400 + p[0] * 3600 + p[1] * 60 + p[2]


def leftovers(since):
    out = subprocess.run(['ps', '-axo', 'pid=,ppid=,uid=,etime=,command='], capture_output=True, text=True).stdout
    now, me, found = time.time(), os.getuid(), []
    for line in out.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        pid, ppid, uid, et, cmd = parts
        if ppid != '1' or int(uid) != me or SKIP.search(cmd) or not PAT.search(cmd):
            continue
        if now - etime_s(et) < since - 5:
            continue
        found.append((pid, cmd[:110]))
    return found


def main():
    try:
        inp = json.load(sys.stdin)
    except Exception:
        return
    log = os.path.expanduser('~/.claude/agent-cost/leftover-guard.log')
    def note(msg):
        try:
            with open(log, 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {inp.get('agent_id','?')} active={inp.get('stop_hook_active')} {msg}\n")
        except Exception: pass
    since = agent_start(inp.get('agent_transcript_path') or '')
    if since is None:
        note('transcript 없음'); return
    left = leftovers(since)
    dirs = agent_dirs(inp.get('agent_transcript_path') or '')
    if dirs:  # 일한 폴더를 알면 그 폴더 아래에서 돈 것만(나란히 도는 다른 agent 것은 건드리지 않음)
        left = [(p, c) for p, c in left if any((os.path.realpath(cwd_of(p) or '/nowhere') + '/').startswith(d + '/') for d in dirs)]
    note(f'남은 {len(left)}개 · 폴더 {len(dirs)}개')
    if not left:
        return
    # SubagentStop 의 block 은 이 환경에서 무시된다(2026-10-31 확인: 불렸고 남은 1개를 찾았지만 agent 는 그대로 끝남).
    # 그래서 찾은 것(그 agent 가 일한 동안 생기고 부모가 사라진 시험 찌꺼기)을 여기서 직접 닫고 기록·알림만 한다.
    import signal
    closed = []
    for p, c in left:
        try:
            os.kill(int(p), signal.SIGTERM); closed.append((p, c))
        except Exception:
            pass
    time.sleep(1)
    for p, _ in closed:
        try:
            os.kill(int(p), 0); os.kill(int(p), signal.SIGKILL)
        except Exception:
            pass
    note('닫음 ' + ', '.join(f'{p} {c[:60]}' for p, c in closed))
    print(f'leftover-guard: subagent 가 남긴 프로세스 {len(closed)}개를 닫았다 — ' + '; '.join(c[:80] for _, c in closed), file=sys.stderr)


if __name__ == '__main__':
    main()
