#!/usr/bin/env bash
# Claude Desktop 안의 Artifact 를 접근성 도구(agent-desktop)로 몰아 보는 작은 도우미. 쓰는 법: desk.sh <snap|texts [필터…]|click "정확한 이름" [all]|cont|wait_done [초]|reload>
# 읽기 전용 시나리오만 — 가져오기·저장·보내기·삭제·켜기/끄기·추가·권한 버튼은 누르지 않는다(실제 서비스에 쓴다).
AD=${AGENT_DESKTOP:-$(command -v agent-desktop || echo "$(npm prefix -g)/bin/agent-desktop")}
OUT=${DESK_OUT:-${TMPDIR:-/tmp}/desk-drive}; mkdir -p "$OUT"
win(){ $AD list-windows --app Claude | python3 -c "import json,sys;d=json.load(sys.stdin)['data'];w=[x for x in d if x['visible'] and x['title']=='Claude'];print(w[0]['id'] if w else '')"; }
snap(){ $AD snapshot --app Claude --compact --max-depth 30 > "$OUT/s.json" 2>&1; }
# texts [필터…]  — 화면 글(ref 포함). 필터가 있으면 그 글이 든 줄만
texts(){ python3 - "$OUT/s.json" "$@" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]));keys=sys.argv[2:];out=[]
def walk(n):
    if not isinstance(n,dict):return
    nm=n.get('name') or n.get('value') or n.get('title') or n.get('description')
    if nm or n.get('role')=='alertdialog': out.append(f"[{n.get('role')}] {str(nm)[:240]} {n.get('ref_id','')}")
    for c in n.get('children',[]) or []: walk(c)
walk(d['data']['tree'])
for l in out:
    if '다시 묻지 않기]를 체크' in l: continue
    if not keys or any(k in l for k in keys): print(l)
PY
}
# click "정확한 이름" [all] — 페이지(「사용자가 생성한 아티팩트 콘텐츠」 아래)의 button·link 중 이름이 정확히 같은 첫 것을 AXPress. all 을 주면 사이드바까지 찾는다.
#  (옛 버전은 부분 일치라 사이드바 다른 Artifact 이름을 눌러 다른 Artifact 로 가 버렸다 — 이름은 정확히, 페이지 안에서만)
click(){ snap; if [ "$2" = all ]; then lines=$(texts); else lines=$(texts | sed -n '/사용자가 생성한 아티팩트 콘텐츠/,$p'); fi
  ref=$(echo "$lines" | grep -E "^\[(button|link)\] $1 @" | head -1 | grep -o '@[a-z0-9]*:e[0-9]*'); [ -z "$ref" ] && { echo "NO_REF: $1"; return 1; }
  $AD click "$ref" >/dev/null 2>&1; echo "clicked $ref"; }
# cont — 「한 번 눌러 주세요」 띠(alertdialog)가 떠 있으면 실제 키 입력(Return)으로 계속. AXPress 는 클릭 인정이 안 되고 CGEvent 키 입력은 인정된다(실측)
cont(){ w=$(win); $AD press return --window-id "$w" --headed >/dev/null 2>&1; echo "return → window $w"; }
# wait_done [초] — 띠가 사라지고 「읽는 중」이 없어질 때까지 띠가 뜨면 cont 하며 기다린다(앱 확인 창은 사람이 누를 수 있음)
wait_done(){ for i in $(seq 1 ${1:-60}); do sleep 1; snap; g=$(texts alertdialog | head -1); if [ -n "$g" ]; then cont; continue; fi; texts 읽는\ 중 불러오는 쓰는\ 중 | grep -q . || { echo done; return 0; }; done; echo timeout; return 1; }
# reload — 페이지 새로 고침(⌘R, 실제 키 입력). 코드 새 버전은 새로 고침해야 뜬다
reload(){ w=$(win); $AD press cmd+r --window-id "$w" --headed >/dev/null 2>&1; sleep 4; echo reloaded; }
"$@"
