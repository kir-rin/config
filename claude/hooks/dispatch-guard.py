#!/usr/bin/env python3
"""PreToolUse hook (matcher Agent): worker 에게 구현·수정을 시키면서 `고칠 파일:` 이 없는 dispatch 를 막는다.

막는 조건: subagent_type == worker, 프롬프트에 구현·수정 말(구현한다·고친다·수정·만든다·추가한다·바꾼다·implement·fix)이 있고,
첫 줄이 `조사:`/`검토:` 가 아니며, `고칠 파일:` 또는 `## 고칠 파일` 줄이 없을 때.
하나 더: 새 능력·모듈을 만들라는 지시(`능력 `x.y` … 만들`, `새 능력`)면 `추상화:` 줄이 필요하다
— 능력은 원본·업무 이름이 아니라 일반 동작으로 만들고 바뀌는 것은 레시피 설정으로 뺀다
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


# 새 능력·모듈을 만들라는 지시에 `추상화:` 줄을 요구한다(2026-10-30 사용자 결정 — 「능력 `hub.board` 를 만들라」고
# 원본 이름을 박아 시키자 subagent 가 기존 범용 능력을 찾지 않고 원본마다 새 능력을 만들었다).
# 목표는 「새 능력 이름을 박지 마라」가 아니라 「능력을 만들 때 추상화된 것(일반 동작)으로 남겨라」다.
# viewkit-mcp 레포(`docs/caps.md` 또는 `src/recipe/` 가 있는 레포)에서만 돈다 — 다른 레포 dispatch 에는 영향 없음.
CAP_ID = r"`[a-z][\w.-]*\.[\w.-]+`"
MAKE = r"만들|만든|구현|추가|신설"  # 「만든다」는 ㄹ 이 떨어져 `만들` 로는 안 잡힌다
NEW_CAP = re.compile(
    rf"새\s*(?:로운\s*)?(?:능력|모듈)(?![ \t]*(?:은|는|을|를)?[ \t]*(?:만들지|만든지|추가하지|안[ \t]*만들|안[ \t]*만든))"
    rf"|능력[ \t]*{CAP_ID}[ \t]*(?:를|을|라는|이란)?[ \t]*(?:새로[ \t]*)?(?:{MAKE})"
    rf"|(?:{MAKE}|추가할|구현할|신설할)[ \t]*(?:새[ \t]*)?능력[ \t]*[:：]?[ \t]*{CAP_ID}",
    re.I)
ABSTRACT_OK = re.compile(r"^\s*(?:#+\s*)?(?:추상화|재사용 확인)\s*:", re.M)  # 옛 이름 `재사용 확인:` 도 같은 뜻
ABSTRACT_REASON = ("새 능력은 원본·업무 이름이 아니라 일반 동작으로 만들고, 바뀌는 것은 레시피 설정으로 빼세요. "
                   "지시에 `추상화: <일반 동작> — <설정으로 뺄 것>` 줄을 넣으세요"
                   "(기존 일반 능력으로 되면 그걸 쓰라고 적어도 됩니다).")
# 원본 이름이 앞에 박힌 id(`hub.board`·`sono.usage`)는 막지 않고 경고만 한다 — 판단은 사람·AI 몫.
# 앞부분이 아래 일반 낱말이면 통과, 아니면 원본·업무 이름으로 본다(단순한 어림).
CAP_ANY = re.compile(r"`([a-z][\w-]*)\.([\w.-]+)`", re.I)
GENERIC = frozenset("""api rows row cells cell table tab tabs card cards ui list text num date time
file sheet excel json http csv grid form data db sql events event span join classify between sum
schedule get post read write fetch split merge sort filter group map calc compute render print
export import notify mail slack""".split())
NAME_NOTE = "이름이 원본에 묶여 있어요 — 동작 이름을 고려하세요."
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


def name_bound(prompt):
    """원본·업무 이름이 앞에 박힌 능력 id 가 프롬프트에 있나(`hub.board`·`sono.usage`)."""
    return any(m.group(1).lower() not in GENERIC for m in CAP_ANY.finditer(prompt))


def abstract_check(data, prompt):
    """-> ("deny"|"warn", 문구) 또는 None."""
    if not NEW_CAP.search(prompt) or not in_viewkit_repo(data, prompt):
        return None
    note = (" " + NAME_NOTE) if name_bound(prompt) else ""
    if ABSTRACT_OK.search(prompt):
        return ("warn", f"dispatch-guard: {NAME_NOTE} (막지는 않았습니다 — `추상화:` 줄 확인됨)") if note else None
    return ("deny", ABSTRACT_REASON + note)


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
    """-> ("deny"|"warn", 문구) 또는 None."""
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
        return ("deny", REASON)
    size = size_reason(prompt)
    if size:
        return ("deny", size)
    return abstract_check(data, prompt)


def main():
    try:
        out = decide(json.loads(sys.stdin.read()))
    except Exception:
        return
    if not out:
        return
    kind, msg = out
    if kind == "deny":
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                                  "permissionDecision": "deny",
                                                  "permissionDecisionReason": msg}}, ensure_ascii=False))
    else:
        print(json.dumps({"systemMessage": msg}, ensure_ascii=False))  # 막지 않고 알리기만


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
