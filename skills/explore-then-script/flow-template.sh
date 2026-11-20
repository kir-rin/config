#!/usr/bin/env bash
# 고정 대본 뼈대 — explore-then-script. 복사해서 test/flows/<화면>.flow.sh 로 쓴다.
# 사용: SESSION=<agent-browser 세션> URL=<주소> ./<화면>.flow.sh
# 걸음마다 기대 글을 확인하고, 실패한 걸음만 스크린샷을 남긴다. AI 판단 없음.
set -u
SESSION="${SESSION:?SESSION 을 주세요}"; URL="${URL:?URL 을 주세요}"
OUT="${OUT:-./flow-out}"; mkdir -p "$OUT"
MAX_SEC="${MAX_SEC:-15}"          # 걸음당 시간 상한
BAN="${BAN:-run_script|undefined|NaN|[0-9]+ms\)|\bTRUE\b|\bFALSE\b}"   # 화면에 보이면 안 되는 글(정규식)
ok=0; bad=0; cur=""
ab() { agent-browser --session "$SESSION" "$@" 2>/dev/null; }
snap() { ab snapshot -c; }
fail() { bad=$((bad+1)); echo "✗ $cur — $*"; ab screenshot "$OUT/$(printf %02d $((ok+bad)))-fail.png" >/dev/null; }
step() { cur="$1"; shift; local t0=$SECONDS; ab "$@" >/dev/null || { fail "명령 실패: $*"; return; }; (( SECONDS - t0 > MAX_SEC )) && fail "느림 $((SECONDS-t0))초"; }
expect_text() { snap | grep -qF -- "$1" && ok=$((ok+1)) || fail "안 보임: $1"; }
expect_no_text() { snap | grep -qE -- "$1" && fail "보이면 안 됨: $1" || ok=$((ok+1)); }
expect_clean() { expect_no_text "$BAN"; local e; e=$(ab errors | grep -v '^\s*$' | grep -vi 'no errors'); [[ -z "$e" ]] && ok=$((ok+1)) || fail "페이지 에러: ${e:0:200}"; }

# ── 흐름 (탐색에서 실제로 밟은 순서대로 적는다) ──
step "열기" open "$URL"
step "새로 고침" reload
expect_clean
# step "섹션 고르기" click "text=…"
# expect_text "…"
# step "다크" eval "document.documentElement.dataset.theme='dark'"
# step "좁은 폭" set viewport 390 844 ; expect_clean ; step "넓은 폭" set viewport 1440 900

echo "통과 $ok / 실패 $bad (캡처: $OUT)"; (( bad == 0 ))
