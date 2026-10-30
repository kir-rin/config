#!/usr/bin/env python3
"""PreToolUse hook (matcher Agent): worker 에게 구현·수정을 시키면서 `고칠 파일:` 이 없는 dispatch 를 막는다.

막는 조건: subagent_type == worker, 프롬프트에 구현·수정 말(구현한다·고친다·수정·만든다·추가한다·바꾼다·implement·fix)이 있고,
첫 줄이 `조사:`/`검토:` 가 아니며, `고칠 파일:` 또는 `## 고칠 파일` 줄이 없을 때.
하나 더: 새 능력·모듈을 이름 박아 만들라는 지시(`능력 `x.y` … 만들`, `새 능력`)면 `재사용 확인:` 줄이 필요하다
(viewkit-mcp 레포에서만 — 2026-10-30 사용자 결정).
어떤 예외든 허용(exit 0)으로 빠진다. 표준 라이브러리만.
"""
import json
import os
import re
import sys

WORK = re.compile(r"구현한다|고친다|수정|만든다|추가한다|바꾼다|implement|\bfix", re.I)
HAS_FILES = re.compile(r"^\s*(?:#+\s*)?고칠 파일\s*:?", re.M)
REASON = ("구현·수정 지시에는 `고칠 파일:` 목록(path, 가능하면 :줄)을 넣으세요. "
          "컨트롤러가 먼저 `grep -n <이름> docs/MAP.md` 로 찾아 적습니다. "
          "조사·검토만이면 프롬프트 첫 줄을 `조사:` 또는 `검토:` 로 시작하세요.")


# 크기 경고(subagent-plans.md 규칙 16 — 구현 agent 하나는 출력 40K 안쪽): 만들 것 번호 항목 > 4 또는 고칠 파일 > 10 이면 막는다.
# 정말 한 agent 가 맞으면 프롬프트에 `크기 확인:` 줄로 이유를 적어 통과시킨다.
MAX_ITEMS, MAX_FILES = 4, 10
PATH = re.compile(r"[\w.-]+(?:/[\w.\[\]-]+)+\.(?:tsx?|mjs|cjs|jsx?|html|ya?ml|json|md|py|sql|prisma|css)\b")
SIZE_OK = re.compile(r"^\s*크기 확인\s*:", re.M)


# 새 능력·모듈을 이름 박아 만들라는 지시를 막는다(2026-10-30 사용자 결정 — 「능력 `hub.board` 를 만들라」고 이름을 박아
# 시키자 subagent 가 기존 범용 능력을 찾지 않고 원본마다 새 능력을 만들었다). `재사용 확인: <이유>` 줄이 있으면 통과.
# viewkit-mcp 레포(`docs/caps.md` 또는 `src/recipe/` 가 있는 레포)에서만 돈다 — 다른 레포 dispatch 에는 영향 없음.
CAP_ID = r"`[a-z][\w.-]*\.[\w.-]+`"
MAKE = r"만들|만든|구현|추가|신설"  # 「만든다」는 ㄹ 이 떨어져 `만들` 로는 안 잡힌다
NEW_CAP = re.compile(
    rf"새\s*(?:로운\s*)?(?:능력|모듈)(?![ \t]*(?:은|는|을|를)?[ \t]*(?:만들지|만든지|추가하지|안[ \t]*만들|안[ \t]*만든))"
    rf"|능력[ \t]*{CAP_ID}[ \t]*(?:를|을|라는|이란)?[ \t]*(?:새로[ \t]*)?(?:{MAKE})"
    rf"|(?:{MAKE}|추가할|구현할|신설할)[ \t]*(?:새[ \t]*)?능력[ \t]*[:：]?[ \t]*{CAP_ID}",
    re.I)
REUSE_OK = re.compile(r"^\s*(?:#+\s*)?재사용 확인\s*:", re.M)
REUSE_REASON = ("새 능력 이름을 지시에 박지 마세요 — subagent 가 기존 범용 능력을 찾지 않고 원본마다 새 능력을 만듭니다. "
                "「기존 능력(범용 api.get·rows.* 등)으로 먼저 찾아 쓰고, 정말 새 능력이 필요하면 이유를 보고」로 쓰거나, "
                "`재사용 확인: <기존 것으로 왜 안 되는지 한 줄>` 줄을 넣으세요.")
REPO_MARKS = ("docs/caps.md", "src/recipe")
ABS_PATH = re.compile(r"(?:~|/)[\w.@+-]*(?:/[\w.@+-]+)+")


def is_viewkit(path):
    """path(파일이면 그 폴더)부터 위로 올라가며 viewkit-mcp 레포인지 본다."""
    d = os.path.abspath(os.path.expanduser(path))
    if os.path.isfile(d):
        d = os.path.dirname(d)
    while True:
        if any(os.path.exists(os.path.join(d, m)) for m in REPO_MARKS):
            return True
        up = os.path.dirname(d)
        if up == d:
            return False
        d = up


def in_viewkit_repo(data, prompt):
    """hook 입력의 cwd 또는 프롬프트 속 경로가 viewkit-mcp 레포일 때만 True."""
    cands = [data.get("cwd")] + ABS_PATH.findall(prompt)[:20]
    return any(c and is_viewkit(c) for c in cands)


def reuse_reason(data, prompt):
    if REUSE_OK.search(prompt) or not NEW_CAP.search(prompt):
        return None
    return REUSE_REASON if in_viewkit_repo(data, prompt) else None


def section(prompt, head):
    """`<head>` 줄 다음부터, 들여쓰기·목록·번호가 아닌 새 문단 머리가 나올 때까지의 줄들."""
    lines = prompt.splitlines()
    out, on = [], False
    for l in lines:
        if not on:
            if re.match(rf"^\s*(?:#+\s*)?{head}\s*(?:\(.*?\))?\s*:?", l):
                on = True
                rest = re.sub(rf"^\s*(?:#+\s*)?{head}\s*(?:\(.*?\))?\s*:?", "", l)
                if rest.strip():
                    out.append(rest)
            continue
        if l.strip() and not re.match(r"^\s|^-|^\d+\.|^\*", l):
            break
        out.append(l)
    return out


def size_reason(prompt):
    if SIZE_OK.search(prompt):
        return None
    items = sum(1 for l in section(prompt, "만들 것") if re.match(r"^\s*\d+\.\s", l))
    files = {m.group(0) for l in section(prompt, "고칠 파일") for m in PATH.finditer(l)}
    if items > MAX_ITEMS or len(files) > MAX_FILES:
        return (f"dispatch 가 커요(만들 것 {items}개 · 고칠 파일 {len(files)}개 — 상한 {MAX_ITEMS}·{MAX_FILES}). "
                "subagent-plans.md 규칙 16: 기능별로 나눠 차례로 띄우세요. "
                "정말 한 agent 가 맞으면 프롬프트에 `크기 확인: <이유>` 줄을 넣으세요.")
    return None


def decide(data):
    """-> deny 이유 문자열 또는 None."""
    ti = data.get("tool_input") or {}
    if ti.get("subagent_type") not in ("worker", "company-worker"):
        return None
    prompt = ti.get("prompt")
    if not isinstance(prompt, str):
        return None
    first = next((l.strip() for l in prompt.splitlines() if l.strip()), "")
    if re.match(r"^(조사|검토)\s*:", first):
        return None
    if not WORK.search(prompt):
        return None
    if not HAS_FILES.search(prompt):
        return REASON
    return size_reason(prompt) or reuse_reason(data, prompt)


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
