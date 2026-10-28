#!/usr/bin/env python3
"""PreToolUse hook (matcher Read|Bash): payroll-desk 안의 300줄 넘는 파일 통째 읽기를 막는다.

- Read: limit 없이 300줄 넘는 파일
- Bash: `cat 파일...` 이 300줄 넘는 파일을 통째로 출력 (파이프·리다이렉트가 붙으면 허용)
범위: ~/Krafton/payroll-desk 와 형제 worktree(~/Krafton/payroll-desk-*) 안의 파일만.
(payroll-desk-docs 는 worktree 가 아니라 결정 문서 저장소라 제외.)
어떤 예외든 허용(exit 0)으로 빠진다.
"""
import json
import os
import re
import shlex
import sys

LIMIT = 300
BASE = os.path.realpath(os.path.expanduser("~/Krafton"))
SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".ipynb", ".xlsx", ".db", ".ico", ".woff", ".woff2", ".zip", ".lock"}


def in_scope(path):
    real = os.path.realpath(path)
    if not real.startswith(BASE + os.sep):
        return False
    top = real[len(BASE) + 1:].split(os.sep)[0]
    if top == "payroll-desk-docs":
        return False
    return top == "payroll-desk" or top.startswith("payroll-desk-")


def line_count(path):
    """텍스트 파일 줄 수. 없음/디렉터리/바이너리/너무 큼이면 None."""
    if not os.path.isfile(path) or os.path.splitext(path)[1].lower() in SKIP_EXT:
        return None
    if os.path.getsize(path) > 20_000_000:
        return None
    with open(path, "rb") as f:
        data = f.read()
    if b"\0" in data[:8192]:
        return None
    n = data.count(b"\n")
    if data and not data.endswith(b"\n"):
        n += 1
    return n


def deny(n, path):
    if os.path.basename(path) == "MAP.md":
        reason = (f"지도는 통째로 읽지 말고 `grep -n <이름이나 파일 경로> docs/MAP.md` 로 찾으세요 "
                  f"(파일 {n}줄: MAP.md)")
    else:
        reason = (f"`grep -n <이름> docs/MAP.md` 로 자리를 찾고 `sed -n A,Bp` 나 Read offset/limit 로 필요한 줄만 읽으세요 "
                  f"(파일 {n}줄: {os.path.basename(path)})")
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason}}, ensure_ascii=False))


def check_read(inp, cwd):
    if inp.get("limit") not in (None, 0):
        return None
    p = inp.get("file_path") or ""
    if not p:
        return None
    p = os.path.join(cwd, os.path.expanduser(p))
    if not in_scope(p):
        return None
    n = line_count(p)
    return (n, p) if n is not None and n > LIMIT else None


def check_bash(inp, cwd):
    cmd = inp.get("command") or ""
    if not re.search(r"\bcat\b", cmd):
        return None
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    toks = list(lex)
    # 명령 단위로 나눈다. `|` 가 낀 단위(앞뒤 모두)는 허용, `;` `&&` `||` 개행은 경계.
    segs, cur, ops = [], [], []
    for t in toks:
        if t and set(t) <= set(";&|()"):
            segs.append(cur); ops.append(t); cur = []
        else:
            cur.append(t)
    segs.append(cur)
    for i, seg in enumerate(segs):
        piped = (i > 0 and ops[i - 1] == "|") or (i < len(ops) and ops[i] == "|")
        if piped or not seg or os.path.basename(seg[0]) != "cat":
            continue
        args = seg[1:]
        if any(set(a) <= set("<>") or a.startswith((">", "<")) or re.match(r"^\d*[<>]", a) for a in args):
            continue
        files = [a for a in args if not a.startswith("-") and a != "-"]
        for f in files:
            p = os.path.join(cwd, os.path.expanduser(f))
            if not in_scope(p):
                continue
            n = line_count(p)
            if n is not None and n > LIMIT:
                return (n, p)
    return None


def main():
    try:
        data = json.load(sys.stdin)
        tool = data.get("tool_name")
        inp = data.get("tool_input") or {}
        cwd = data.get("cwd") or os.getcwd()
        hit = check_read(inp, cwd) if tool == "Read" else check_bash(inp, cwd) if tool == "Bash" else None
        if hit:
            deny(*hit)
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
