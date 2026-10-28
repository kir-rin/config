#!/usr/bin/env python3
"""PreToolUse hook (matcher Agent): worker 에게 구현·수정을 시키면서 `고칠 파일:` 이 없는 dispatch 를 막는다.

막는 조건: subagent_type == worker, 프롬프트에 구현·수정 말(구현한다·고친다·수정·만든다·추가한다·바꾼다·implement·fix)이 있고,
첫 줄이 `조사:`/`검토:` 가 아니며, `고칠 파일:` 또는 `## 고칠 파일` 줄이 없을 때.
어떤 예외든 허용(exit 0)으로 빠진다. 표준 라이브러리만.
"""
import json
import re
import sys

WORK = re.compile(r"구현한다|고친다|수정|만든다|추가한다|바꾼다|implement|\bfix", re.I)
HAS_FILES = re.compile(r"^\s*(?:#+\s*)?고칠 파일\s*:?", re.M)
REASON = ("구현·수정 지시에는 `고칠 파일:` 목록(path, 가능하면 :줄)을 넣으세요. "
          "컨트롤러가 먼저 `grep -n <이름> docs/MAP.md` 로 찾아 적습니다. "
          "조사·검토만이면 프롬프트 첫 줄을 `조사:` 또는 `검토:` 로 시작하세요.")


def decide(data):
    """-> deny 이유 문자열 또는 None."""
    ti = data.get("tool_input") or {}
    if ti.get("subagent_type") != "worker":
        return None
    prompt = ti.get("prompt")
    if not isinstance(prompt, str):
        return None
    first = next((l.strip() for l in prompt.splitlines() if l.strip()), "")
    if re.match(r"^(조사|검토)\s*:", first):
        return None
    if not WORK.search(prompt) or HAS_FILES.search(prompt):
        return None
    return REASON


def main():
    try:
        reason = decide(json.loads(sys.stdin.read()))
    except Exception:
        return
    if reason:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                                  "permissionDecision": "deny",
                                                  "permissionDecisionReason": reason}}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
