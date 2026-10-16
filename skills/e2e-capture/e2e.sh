#!/usr/bin/env bash
# e2e-capture — 브라우저 E2E 실행을 기록하고, 단계마다 번호 매긴(주석 가능한) 스크린샷을 남기고, 리포트를 만든다.
# 드라이버는 agent-browser CLI. 이 스크립트는 "어디에 무엇을 남길지"만 맡는다.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUR="${E2E_CURRENT:-${TMPDIR:-/tmp}/e2e-capture.current}"   # 현재 실행 디렉터리 포인터 (Bash 호출마다 셸이 새로 떠서 env로는 못 넘긴다)

die() { echo "e2e: $*" >&2; exit 1; }
need_run() { [ -f "$CUR" ] || die "진행 중인 실행이 없다. 먼저: e2e.sh init <출력디렉터리>"; RUN="$(cat "$CUR")"; [ -d "$RUN" ] || die "실행 디렉터리가 사라졌다: $RUN"; SESSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["session"])' "$RUN/run.json")"; }
jlog() { python3 - "$RUN/steps.jsonl" "$@" <<'PY'
import json,sys,time
path=sys.argv[1]; kv=sys.argv[2:]
rec={"t":time.strftime("%H:%M:%S")}
for i in range(0,len(kv),2):
    k,v=kv[i],kv[i+1]
    if v.startswith("json:"): v=json.loads(v[5:])
    rec[k]=v
open(path,"a").write(json.dumps(rec,ensure_ascii=False)+"\n")
PY
}
ab() { agent-browser --session "$SESSION" "$@"; }
slug() { python3 -c 'import re,sys;s=re.sub(r"[^\w가-힣-]+","-",sys.argv[1]).strip("-");print(s[:40] or "shot")' "$1"; }

cmd="${1:-help}"; shift || true
case "$cmd" in
init)
  out="${1:?출력 디렉터리를 넘겨라}"; shift || true
  name="E2E"; viewport="1280x800"
  while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --viewport) viewport="$2"; shift 2;; *) die "모르는 옵션 $1";; esac; done
  mkdir -p "$out/shots"; out="$(cd "$out" && pwd)"
  session="e2e-$(date +%s)-$$"
  python3 - "$out/run.json" "$name" "$session" "$viewport" <<'PY'
import json,sys,time
p,name,session,vp=sys.argv[1:]
json.dump({"name":name,"session":session,"viewport":vp,"started":time.strftime("%Y-%m-%d %H:%M:%S"),"n":0},open(p,"w"),ensure_ascii=False,indent=1)
PY
  : > "$out/steps.jsonl"
  echo "$out" > "$CUR"
  echo "실행 디렉터리: $out"
  echo "브라우저 세션: $session (격리됨 — 공용 기본 세션을 건드리지 않는다)"
  echo "다음: e2e.sh scenario \"<시나리오 제목>\" → e2e.sh ab open <url> → … → e2e.sh shot \"<라벨>\""
  ;;

scenario)
  need_run; title="${1:?시나리오 제목}"
  jlog type scenario title "$title"
  echo "▶ 시나리오: $title"
  ;;

ab)   # agent-browser 명령을 세션 고정해서 실행하고, 액션으로 기록한다
  need_run
  [ $# -gt 0 ] || die "agent-browser 명령을 넘겨라 (예: e2e.sh ab open http://localhost:3000)"
  first="$1"
  set +e; out="$(ab "$@" 2>&1)"; rc=$?; set -e
  printf '%s\n' "$out"
  case "$first" in
    snapshot|get|read|is|console|errors|wait|tab|session|screenshot) ;;   # 읽기·대기류는 기록하지 않는다 (소음)
    find) case "${4:-}" in text|count|html|value|attr|"") ;; *) jlog type action cmd "$*" ok "json:$([ $rc -eq 0 ] && echo true || echo false)";; esac ;;  # find … click/fill 만 액션
    *) jlog type action cmd "$*" ok "json:$([ $rc -eq 0 ] && echo true || echo false)" ;;
  esac
  if [ "$first" = "open" ] && [ $rc -eq 0 ]; then
    vp="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["viewport"])' "$RUN/run.json")"
    ab set viewport "${vp%x*}" "${vp#*x}" >/dev/null 2>&1 || true
  fi
  exit $rc
  ;;

shot)  # 번호 매긴 스크린샷. --mark '<targets json>' 로 빨간 박스+번호, --expect "<텍스트>" 로 pass/fail 판정
  need_run; label="${1:?라벨}"; shift || true
  mark=""; expect=""; full=""
  while [ $# -gt 0 ]; do case "$1" in --mark) mark="$2"; shift 2;; --expect) expect="$2"; shift 2;; --full) full="--full"; shift;; *) die "모르는 옵션 $1";; esac; done
  n="$(python3 -c 'import json,sys;p=sys.argv[1];d=json.load(open(p));d["n"]+=1;json.dump(d,open(p,"w"),ensure_ascii=False,indent=1);print(d["n"])' "$RUN/run.json")"
  file="shots/$(printf '%02d' "$n")_$(slug "$label").png"
  url="$(ab get url 2>/dev/null || echo '?')"
  drawn="null"; missing="[]"
  if [ -n "$mark" ]; then
    res="$( { cat "$HERE/mark.js"; printf '\n__e2eMark(%s);\n' "$mark"; } | ab eval --stdin 2>&1 | tail -1)"
    # eval은 결과를 JSON 문자열로 돌려준다. 파싱 실패하면 그대로 보존.
    drawn="$(python3 -c 'import json,sys
s=sys.argv[1]
try:
  v=json.loads(s)
  if isinstance(v,str): v=json.loads(v)
  print(v.get("drawn","?"))
except Exception: print("?")' "$res")"
    missing="$(python3 -c 'import json,sys
s=sys.argv[1]
try:
  v=json.loads(s)
  if isinstance(v,str): v=json.loads(v)
  print(json.dumps(v.get("missing",[]),ensure_ascii=False))
except Exception: print("[]")' "$res")"
  fi
  ab screenshot $full "$RUN/$file" >/dev/null
  [ -n "$mark" ] && ab eval "__e2eUnmark && __e2eUnmark()" >/dev/null 2>&1 || true
  ok="null"
  if [ -n "$expect" ]; then
    r="$(printf 'document.body && document.body.innerText.includes(%s)\n' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1],ensure_ascii=False))' "$expect")" | ab eval --stdin 2>/dev/null | tail -1 | tr -d '"')"
    [ "$r" = "true" ] && ok=true || ok=false
  fi
  jlog type shot n "json:$n" label "$label" file "$file" url "$url" expect "$expect" ok "json:$ok" drawn "json:$drawn" missing "json:$missing"
  status=""; [ "$ok" = true ] && status=" ✅ expect 통과"; [ "$ok" = false ] && status=" ❌ expect 실패: \"$expect\" 없음"
  echo "📸 #$n $file$status"
  [ -n "$mark" ] && echo "   ANNOT drawn=$drawn missing=$missing"
  [ "$missing" != "[]" ] && echo "   ⚠ 안 그려진 박스가 있다 — 타깃을 고쳐 다시 찍어라" >&2
  [ "$ok" = false ] && exit 2 || exit 0
  ;;

note)  # 스크린샷 없는 메모 (관찰·판단)
  need_run; jlog type note text "${1:?메모}"; echo "📝 $1" ;;

check)  # 페이지 에러(uncaught exception·console.error)를 기록. 있으면 종료코드 1
  need_run
  errs="$(python3 - "$(ab errors --json 2>/dev/null || echo '{}')" "$(ab console --json 2>/dev/null || echo '{}')" <<'PY'
import json,sys
out=[]
def load(s):
    try: return json.loads(s).get("data") or {}
    except Exception: return {}
for e in load(sys.argv[1]).get("errors",[]): out.append("uncaught: "+(e.get("text") or "").split("\n")[0])
for m in load(sys.argv[2]).get("messages",[]):
    if m.get("type")=="error": out.append("console.error: "+(m.get("text") or ""))
print(json.dumps(out[:50],ensure_ascii=False))
PY
)"
  jlog type check errors "json:$errs"
  if [ "$errs" = "[]" ]; then echo "✅ 페이지 에러 없음"
  else echo "❌ 페이지 에러:"; python3 -c 'import json,sys;[print("  -",e) for e in json.loads(sys.argv[1])]' "$errs"; exit 1; fi
  ;;

report)
  need_run; python3 "$HERE/report.py" "$RUN"; echo "리포트: $RUN/report.md · $RUN/report.html" ;;

done)
  need_run; ab close >/dev/null 2>&1 || true; echo "브라우저 세션 종료: $SESSION"; echo "실행 디렉터리는 남겨 둔다: $RUN" ;;

status)
  need_run; echo "실행: $RUN"; echo "세션: $SESSION"; echo "단계:"; python3 - "$RUN/steps.jsonl" <<'PY'
import json,sys
for l in open(sys.argv[1]):
    r=json.loads(l); t=r["type"]
    if t=="scenario": print(f"▶ {r['title']}")
    elif t=="shot": print(f"  📸 #{r['n']} {r['label']}" + ("" if r.get("ok") is None else (" ✅" if r["ok"] else " ❌")))
    elif t=="action": print(f"  · {r['cmd']}" + ("" if r["ok"] else " (실패)"))
    elif t=="check": print("  ✅ 에러 없음" if not r["errors"] else f"  ❌ 에러 {len(r['errors'])}건")
    elif t=="note": print(f"  📝 {r['text']}")
PY
  ;;

*)
  cat <<'USAGE'
e2e.sh <subcommand>
  init <outdir> [--name "제목"] [--viewport 1280x800]   실행 시작. 격리된 브라우저 세션을 하나 잡는다
  scenario "<제목>"                                     시나리오 경계 (리포트에서 묶인다)
  ab <agent-browser 명령…>                              세션 고정 실행 + 액션 기록 (open/click/fill/press/wait/snapshot …)
  shot "<라벨>" [--mark '<json>'] [--expect "<텍스트>"] [--full]
                                                        번호 매긴 스크린샷. --mark 는 빨간 박스+번호, --expect 는 pass/fail
  note "<메모>"                                         관찰·판단 기록
  check                                                 페이지 에러 확인·기록 (있으면 exit 1)
  report                                                report.md + report.html(자체포함) 생성
  status                                                지금까지의 단계 목록
  done                                                  브라우저 세션 닫기
--mark JSON 예: [{"text":"저장","n":"1"},{"placeholder":"이름","n":"2","pad":6},{"selector":"#list li:first-child","n":"3"}]
USAGE
  ;;
esac
