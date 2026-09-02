#!/usr/bin/env bash
# side-chat.sh — herdr-native right-pane side chat for Claude Code.
#
# Forks the current Claude Code session (full context, no live link back to
# the main session) into a new pane split to the right of the current pane.
# Subcommands:
#   toggle  (default) — open the side chat if closed, close it if open.
#           Closing keeps the underlying session so a later toggle resumes
#           the same side conversation instead of forking again.
#   clear   — discard the current side conversation and open a fresh one
#             forked from the main session's current state.
#   status  — print the tracked state for the current owner pane (debug).
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$SKILL_DIR/state"
mkdir -p "$STATE_DIR"

cmd="${1:-toggle}"

# herdr 토스트. 키를 누른 직후 "받았다"는 신호를 주기 위한 것이라 실패해도 무시한다.
notify() { herdr notification show "$1" --body "${2:-}" --position top-right >/dev/null 2>&1 || true; }

# herdr 세션 구분자. pane id(wM:p7)는 세션 안에서만 유일해서, 여러 herdr 세션을
# 동시에 띄우면 서로 다른 세션의 같은 pane id가 한 상태 파일을 덮어쓴다.
# herdr가 페인마다 주입하는 HERDR_SOCKET_PATH가 세션마다 다르므로 이걸 키에 섞는다.
# 디렉토리명(읽기용) + 전체 경로 해시(충돌 방지) 조합.
herdr_session_slug() {
  local sock="${HERDR_SOCKET_PATH:-}"
  [ -n "$sock" ] || { echo "nosock"; return; }
  local dir hash
  dir=$(basename "$(dirname "$sock")" | tr -dc 'A-Za-z0-9_-')
  hash=$(printf '%s' "$sock" | shasum | cut -c1-6)
  echo "${dir}-${hash}"
}
SESSION_SLUG=$(herdr_session_slug)

state_file_for() { echo "$STATE_DIR/${SESSION_SLUG}__$(echo "$1" | tr ':' '_').json"; }

# 세션 구분자 도입 전(파일명이 pane id 뿐이던 시절)에 만들어진 상태 파일을 한 번만 옮긴다.
# 이게 없으면 업그레이드 직후 열려 있던 곁가지가 추적에서 끊겨 다시 fork 된다.
migrate_legacy_state() {
  local legacy="$STATE_DIR/$(echo "$1" | tr ':' '_').json"
  local current
  current=$(state_file_for "$1")
  if [ -f "$legacy" ] && [ ! -f "$current" ]; then
    mv "$legacy" "$current"
  fi
}

pane_exists() {
  herdr pane list 2>/dev/null | jq -e --arg id "$1" '.result.panes[] | select(.pane_id==$id)' >/dev/null 2>&1
}

pane_session_id() {
  herdr pane get "$1" 2>/dev/null | jq -r '.result.pane.agent_session.value // empty'
}

cur_pane_json=$(herdr pane current)
cur_pane_id=$(jq -r '.result.pane.pane_id' <<<"$cur_pane_json")
cur_session=$(jq -r '.result.pane.agent_session.value // empty' <<<"$cur_pane_json")
cur_workspace=$(jq -r '.result.pane.workspace_id' <<<"$cur_pane_json")

# If invoked while focused on a tracked side-chat pane itself, operate on its
# owner's state instead of treating this pane as its own owner.
# 역추적은 같은 herdr 세션의 상태 파일만 훑는다. 다른 세션 파일까지 보면
# pane id가 겹칠 때 남의 owner를 집어온다.
owner_pane_id="$cur_pane_id"
for f in "$STATE_DIR"/*.json; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    "${SESSION_SLUG}__"*) ;;   # 이 세션 파일 — 본다
    *__*) continue ;;          # 다른 세션 파일 — 건너뛴다
    *) ;;                      # 세션 구분 이전 파일 — 이관 전이므로 본다
  esac
  sp=$(jq -r '.side_pane_id // empty' "$f")
  if [ -n "$sp" ] && [ "$sp" = "$cur_pane_id" ]; then
    owner_pane_id=$(jq -r '.owner_pane_id' "$f")
    break
  fi
done

migrate_legacy_state "$owner_pane_id"
state_file=$(state_file_for "$owner_pane_id")

side_pane_id=""
side_session_id=""
if [ -f "$state_file" ]; then
  side_pane_id=$(jq -r '.side_pane_id // empty' "$state_file")
  side_session_id=$(jq -r '.side_session_id // empty' "$state_file")
fi

close_side_pane() {
  if [ -n "$side_pane_id" ] && pane_exists "$side_pane_id"; then
    herdr pane close "$side_pane_id" >/dev/null 2>&1 || true
  fi
}

owner_cwd() {
  local j
  if [ "$owner_pane_id" = "$cur_pane_id" ]; then
    j="$cur_pane_json"
  else
    j=$(herdr pane get "$owner_pane_id" 2>/dev/null)
  fi
  jq -r '.result.pane.cwd // empty' <<<"$j"
}

# Claude Code session transcripts live at
# ~/.claude/projects/<cwd with / replaced by ->/<session-id>.jsonl
session_file_exists() {
  local sid="$1" cwd
  [ -n "$sid" ] || return 1
  cwd=$(owner_cwd)
  [ -n "$cwd" ] || return 1
  local proj_dir="$HOME/.claude/projects/$(echo "$cwd" | tr '/' '-')"
  [ -f "$proj_dir/$sid.jsonl" ]
}

open_side_pane() {
  notify "Side chat" "여는 중…"
  local resume_args=()
  if [ -n "$side_session_id" ] && ! session_file_exists "$side_session_id"; then
    # Previous side session was closed before Claude Code persisted a
    # transcript (e.g. closed with zero exchanges) — --resume on it would
    # hang the herdr agent waiting for a state that never arrives. Treat as
    # if there were no prior side session and fork fresh instead.
    side_session_id=""
  fi
  if [ -n "$side_session_id" ]; then
    resume_args=(--resume "$side_session_id")
  else
    local main_session="$cur_session"
    if [ "$owner_pane_id" != "$cur_pane_id" ] || [ -z "$main_session" ]; then
      main_session=$(pane_session_id "$owner_pane_id")
    fi
    if [ -z "$main_session" ]; then
      echo "side-chat: 메인 페인($owner_pane_id)에서 Claude 세션ID를 찾을 수 없습니다." >&2
      exit 1
    fi
    resume_args=(--resume "$main_session" --fork-session)
  fi

  local split_json new_pane_id
  split_json=$(herdr pane split --pane "$owner_pane_id" --direction right --focus)
  new_pane_id=$(jq -r '.result.pane.pane_id' <<<"$split_json")

  # 페인은 ~100ms 만에 뜨지만 Claude 가 화면을 그리기까지 3~4초가 더 걸린다.
  # 그 사이 빈 페인만 보이지 않도록 배너를 먼저 밀어 넣는다. 셸이 아직
  # 없어도 pty 가 입력을 버퍼링하므로 셸이 뜨는 즉시(~0.6s) 출력된다.
  # 셸이 실행하기 전 한순간 이 명령줄 자체가 에코된다. 그래서 색코드 없이
  # 에코된 상태로도 읽히는 문장을 쓴다.
  herdr pane run "$new_pane_id" \
    'clear; echo; echo "  side chat 여는 중 — Claude 세션 포크 중..."' \
    >/dev/null 2>&1 || true

  local agent_name
  agent_name="side-chat-$(echo "${new_pane_id//:/_}" | tr '[:upper:]' '[:lower:]')"
  # 갓 만든 페인은 셸 프롬프트가 잡히기 전까지 agent_pane_busy 를 돌려준다
  # (실측 ~0.6s). 그 오류만 재시도하고 나머지는 바로 올린다 — 예전엔 0.5초씩
  # 블라인드로 자느라 준비된 뒤에도 최대 0.5초를 더 버렸다.
  local tries=0 err=""
  until err=$(herdr agent start "$agent_name" --kind claude --pane "$new_pane_id" -- "${resume_args[@]}" 2>&1 >/dev/null); do
    if [[ "$err" != *agent_pane_busy* ]]; then
      echo "side-chat: agent start 실패: $err" >&2
      exit 1
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge 40 ]; then
      echo "side-chat: 새 셸이 준비되지 않았습니다: $err" >&2
      exit 1
    fi
    sleep 0.15
  done

  # 세션 ID 가 붙는 즉시 진행한다. 고정 sleep 1 은 대개 순수 낭비였다.
  local got_session="" i=0
  while [ "$i" -lt 20 ]; do
    got_session=$(pane_session_id "$new_pane_id")
    [ -n "$got_session" ] && break
    i=$((i + 1))
    sleep 0.1
  done
  [ -n "$got_session" ] && side_session_id="$got_session"

  side_pane_id="$new_pane_id"
  jq -n --arg owner "$owner_pane_id" --arg sp "$side_pane_id" --arg ss "$side_session_id" --arg ws "$cur_workspace" \
    '{owner_pane_id:$owner, side_pane_id:$sp, side_session_id:$ss, workspace_id:$ws}' > "$state_file"

  echo "side-chat: opened pane $side_pane_id (session ${side_session_id:0:8}...)"
}

case "$cmd" in
  toggle)
    if [ -n "$side_pane_id" ] && pane_exists "$side_pane_id"; then
      close_side_pane
      jq --arg ss "$side_session_id" '.side_pane_id=null | .side_session_id=$ss' "$state_file" > "$state_file.tmp" && mv "$state_file.tmp" "$state_file"
      echo "side-chat: closed (resume state kept)"
    else
      open_side_pane
    fi
    ;;
  clear)
    close_side_pane
    side_session_id=""
    side_pane_id=""
    rm -f "$state_file"
    open_side_pane
    ;;
  status)
    if [ -f "$state_file" ]; then cat "$state_file"; else echo "{}"; fi
    ;;
  *)
    echo "usage: side-chat.sh {toggle|clear|status}" >&2
    exit 2
    ;;
esac
