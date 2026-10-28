#!/usr/bin/env bash
# 다른 기기에 Claude Code 개인 설정을 깐다(2026-10-28).
#  - 전역 지침 목차: config/claude/global/CLAUDE.md → ~/.claude/CLAUDE.md (기존 파일은 .bak 으로 남김)
#  - subagent 타입: config/claude/agents/*.md → ~/.claude/agents/ 링크
#  - agent-cost hook(SubagentStop) 은 전역 ~/.claude/settings.json 에 등록한다(이미 있으면 건너뜀)
#  - dispatch-guard hook(PreToolUse, matcher Agent) 도 전역 ~/.claude/settings.json 에 등록한다(이미 있으면 건너뜀)
#  - read-guard hook 은 프로젝트별(.claude/settings.local.json)로 등록한다 — 인자로 프로젝트 경로를 주면 등록
# 사용: bash ~/config/claude/install.sh [hook 을 걸 프로젝트 경로 ...]
set -euo pipefail
C="$(cd "$(dirname "$0")" && pwd)"

mkdir -p ~/.claude/agents
if [ -f ~/.claude/CLAUDE.md ] && ! cmp -s ~/.claude/CLAUDE.md "$C/global/CLAUDE.md"; then
  cp ~/.claude/CLAUDE.md ~/.claude/CLAUDE.md.bak
  echo "기존 ~/.claude/CLAUDE.md → ~/.claude/CLAUDE.md.bak"
fi
cp "$C/global/CLAUDE.md" ~/.claude/CLAUDE.md

for a in "$C"/agents/*.md; do
  ln -sf "$a" ~/.claude/agents/"$(basename "$a")"
done

python3 - ~/.claude/settings.json "$C/hooks/agent-cost-hook.py" <<'PY'
import json, os, sys
f, hook = sys.argv[1], sys.argv[2]
s = json.load(open(f)) if os.path.exists(f) else {}
cmd = f"python3 {hook}"
lst = s.setdefault("hooks", {}).setdefault("SubagentStop", [])
if any(h.get("command") == cmd for e in lst for h in e.get("hooks", [])):
    print("agent-cost hook: 이미 등록됨")
else:
    lst.append({"hooks": [{"type": "command", "command": cmd, "timeout": 5}]})
    tmp = f + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(s, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, f)
    print("agent-cost hook 등록:", f)
PY

python3 - ~/.claude/settings.json "$C/hooks/dispatch-guard.py" <<'PY'
import json, os, sys
f, hook = sys.argv[1], sys.argv[2]
s = json.load(open(f)) if os.path.exists(f) else {}
cmd = f"python3 {hook}"
lst = s.setdefault("hooks", {}).setdefault("PreToolUse", [])
if any(h.get("command") == cmd for e in lst for h in e.get("hooks", [])):
    print("dispatch-guard hook: 이미 등록됨")
else:
    lst.append({"matcher": "Agent", "hooks": [{"type": "command", "command": cmd, "timeout": 1}]})
    tmp = f + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(s, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, f)
    print("dispatch-guard hook 등록:", f)
PY

for p in "$@"; do
  f="$p/.claude/settings.local.json"
  mkdir -p "$p/.claude"
  python3 - "$f" "$C/hooks/read-guard.py" <<'PY'
import json, os, sys
f, hook = sys.argv[1], sys.argv[2]
s = json.load(open(f)) if os.path.exists(f) else {}
cmd = f"python3 {hook}"
pre = s.setdefault("hooks", {}).setdefault("PreToolUse", [])
if not any(h.get("command") == cmd for e in pre for h in e.get("hooks", [])):
    pre.append({"matcher": "Read|Bash", "hooks": [{"type": "command", "command": cmd}]})
json.dump(s, open(f, "w"), ensure_ascii=False, indent=2)
print("hook 등록:", f)
PY
done
echo "끝. 새 세션부터 적용된다."
