#!/usr/bin/env python3
"""메인 세션(T3 대화)에서 긴 시험·빌드를 막는다 — 메인은 늘 대화를 받는다(사용자 2026-11-09).
허용: subagent(hook 입력에 agent_id), T3 delegate_task 자식(스레드 id 가 thread:delegated-task), T3 밖 세션(herdr worker 등은 구분 못 해 막지 않는다).
파일 하나만 도는 tsx --test 는 짧으므로 막지 않는다."""
import json, os, re, sys

LONG = re.compile(r"^(npm|pnpm|yarn)\s+(run\s+)?(-s\s+|--silent\s+)?(test|test:cards|e2e:chat|build|plugin:pack)(\s|$)")
PREFIX = re.compile(r"^(\w+=\S*\s+|timeout\s+\d+\s+|env\s+)+")

def is_long(cmd):
    for part in re.split(r"&&|\|\||[;|\n]", cmd):
        if LONG.match(PREFIX.sub("", part.strip())):
            return True
    return False

def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        return 0
    thread = os.environ.get("T3CODE_THREAD_ID", "")
    if not thread or thread.startswith("thread:delegated-task") or d.get("agent_id"):
        return 0
    if d.get("tool_name") == "Bash" and is_long(str(d.get("tool_input", {}).get("command", ""))):
        print("메인 세션은 대화를 받아야 해요 — 전체 시험·e2e·빌드는 delegate_task(백그라운드)로 맡기세요. 끝 조건(명령과 exit 0)을 적어 넘기고 턴을 끝냅니다.", file=sys.stderr)
        return 2
    return 0

if __name__ == "__main__":
    sys.exit(main())
