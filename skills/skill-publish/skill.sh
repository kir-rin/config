#!/bin/zsh
# skill-publish — 스킬을 만들고 모든 에이전트 런타임에 배선하고, 공개 커밋 전에 비밀값을 훑는다.
set -u
REPO="${SKILL_REPO:-$HOME/config/skills}"
PATTERNS_LOCAL="${SKILL_PATTERNS:-$HOME/.config/skill-publish/patterns.local}"
cmd="${1:-help}"; shift 2>/dev/null || true

# 공개해도 안전한 일반 패턴만 여기 둔다. 조직 고유 표현(회사명·내부 도메인·프로젝트명)은
# 저장소 밖 PATTERNS_LOCAL 에 두어 스캐너 자체가 정보를 흘리지 않게 한다.
GENERIC='xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{20,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|/Users/[a-z0-9._-]+/|[0-9a-z-]+\.ts\.net|\.(internal|corp|intra)\b'
# 값이 ${ENV} 참조면 비밀이 아니다
ASSIGN='(password|passwd|secret|api[_-]?key|access[_-]?key|token)[[:space:]]*[:=][[:space:]]*["'"'"']?[^[:space:]"'"'"'$][^[:space:]"'"'"']{7,}'

case "$cmd" in
new)
  name="${1:?스킬 이름을 넘겨라}"
  dir="$REPO/$name"
  [ -e "$dir" ] && { echo "이미 있음: $dir"; exit 1; }
  mkdir -p "$dir/agents"
  cat > "$dir/SKILL.md" <<EOF
---
name: $name
description: "무엇을 하는지 한 문장. 그리고 자동 발동을 위해 사용자가 실제로 칠 법한 트리거 문구를 사용자의 언어로 넣는다 — \"○○ 해줘\", \"○○ 정리해줘\" 처럼."
---

# $name

이 스킬이 무엇을 하는지, 어떤 순서로 하는지 한두 문단.

## 0. 도구

\`\`\`bash
<이 스킬 디렉토리>/...   # 헬퍼가 있으면 여기에. 절대경로 하드코딩 금지
\`\`\`

## 1. …

## 알아둘 것

- 실제로 밟은 함정을 적는다. happy path만 적으면 다음 실행에서 같은 데를 또 밟는다
- 전제조건(OS·권한·필요한 MCP 서버)을 명시한다
EOF
  cat > "$dir/agents/openai.yaml" <<EOF
interface:
  display_name: "$name"
  short_description: ""
  default_prompt: "\$$name 를 사용해 …"
EOF
  echo "생성: $dir"
  echo "다음: SKILL.md를 채우고 → skill.sh link → skill.sh scan $name → skill.sh publish $name"
  ;;

link)
  bash "$REPO/install.sh"
  ;;

scan)
  target="${1:-}"
  tgtdir="$REPO/${target}"
  [ -z "$target" ] && tgtdir="$REPO"
  [ -e "$tgtdir" ] || { echo "없는 경로: $tgtdir"; exit 1; }
  echo "=== 스캔 대상: $tgtdir ==="
  hit=0
  echo "--- 일반 비밀/개인정보 패턴 ---"
  if grep -rInE "$GENERIC" "$tgtdir" 2>/dev/null | grep -v '\${' ; then hit=1; else echo "(없음)"; fi
  echo "--- 대입식 비밀값 (환경변수 참조는 제외) ---"
  if grep -rInE "$ASSIGN" "$tgtdir" 2>/dev/null | grep -v '\${'; then hit=1; else echo "(없음)"; fi
  echo "--- 조직 고유 패턴 (로컬 파일) ---"
  if [ -f "$PATTERNS_LOCAL" ]; then
    pat=$(grep -vE '^\s*(#|$)' "$PATTERNS_LOCAL" | paste -sd'|' -)
    if [ -n "$pat" ] && grep -rInE "$pat" "$tgtdir" 2>/dev/null; then hit=1; else echo "(없음)"; fi
  else
    echo "⚠ $PATTERNS_LOCAL 없음 — 조직 고유 표현은 검사되지 않았다."
    echo "  회사명·내부 도메인·프로젝트명·동료 이름을 한 줄에 하나씩 적어 두면 이후 자동 검사된다."
  fi
  echo "=== 결과: $([ $hit -eq 0 ] && echo '깨끗함 ✓' || echo '⚠ 위 항목을 확인하고 일반화할 것') ==="
  [ $hit -eq 0 ]
  ;;

publish)
  name="${1:?스킬 이름을 넘겨라}"
  "$0" scan "$name" || { echo "스캔에서 걸린 게 있다. 일반화한 뒤 다시 실행하라."; exit 1; }
  cd "$(dirname "$REPO")" || exit 1
  git add "skills/$name"
  echo "--- 스테이징된 것 (이것만 커밋된다) ---"
  git diff --cached --name-only
  echo "커밋 메시지를 정한 뒤 git commit 하라. 다른 미커밋 변경은 건드리지 말 것."
  ;;

status)
  echo "=== $REPO ==="
  for d in "$REPO"/*/; do [ -f "$d/SKILL.md" ] && basename "$d"; done
  echo "=== 링크 상태 ==="
  for t in "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.config/opencode/skills"; do
    n=$(ls -1 "$t" 2>/dev/null | wc -l | tr -d ' ')
    echo "  $t — ${n}개"
  done
  ;;

*)
  cat <<'USAGE'
skill.sh <subcommand>
  new <이름>       ~/config/skills/<이름> 에 SKILL.md 뼈대 생성
  link             install.sh 실행 — Claude Code/Codex/OpenCode 전역 경로에 심볼릭 링크
  scan [이름]      비밀값·개인정보 스캔 (인자 없으면 전체)
  publish <이름>   스캔 통과 시 해당 스킬만 스테이징
  status           스킬 목록과 런타임별 링크 수
환경변수: SKILL_REPO(기본 ~/config/skills) · SKILL_PATTERNS(기본 ~/.config/skill-publish/patterns.local)
USAGE
  ;;
esac
