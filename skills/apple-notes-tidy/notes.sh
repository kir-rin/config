#!/bin/zsh
# apple-notes-tidy 헬퍼 — AppleScript로 애플 메모를 안전하게 훑고 정리한다.
# 인덱스 참조는 본문 수정·삭제 직후 무효화되므로, 조회 이후의 모든 조작은 note id로만 한다.
set -u
cmd="${1:-help}"; shift 2>/dev/null || true

SECRET_RE='비번|비밀번호|password|passwd|token|secret|접속 정보|계정'

case "$cmd" in
folders)
  osascript <<'EOF'
set out to ""
tell application "Notes"
  repeat with f in folders
    set out to out & (name of f) & tab & (count of notes of f) & linefeed
  end repeat
end tell
return out
EOF
  ;;

recent)
  days="${1:-14}"; max="${2:-400}"
  osascript - "$days" "$max" "$SECRET_RE" <<'EOF'
on run argv
  set d to (item 1 of argv) as integer
  set maxlen to (item 2 of argv) as integer
  set cutoff to (current date) - (d * days)
  set out to ""
  tell application "Notes"
    repeat with f in folders
      set fn to name of f
      if fn is not "Recently Deleted" then
        try
          repeat with n in (notes of f whose modification date > cutoff)
            set t to name of n
            set b to ""
            try
              set b to plaintext of n
            end try
            if (count of b) > maxlen then set b to (text 1 thru maxlen of b) & " …(생략)"
            set out to out & "@@@ " & fn & " | " & t & " | " & (modification date of n as string) & " | 첨부" & (count of attachments of n) & " | " & (id of n) & linefeed & b & linefeed
          end repeat
        end try
      end if
    end repeat
  end tell
  return out
end run
EOF
  ;;

body)
  osascript -e "tell application \"Notes\" to get plaintext of note id \"$1\""
  ;;

trash)
  osascript <<'EOF'
set out to ""
tell application "Notes"
  repeat with n in notes of folder "Recently Deleted"
    set out to out & (name of n) & " | " & (modification date of n as string) & " | " & (id of n) & linefeed
  end repeat
end tell
return out
EOF
  ;;

delete)
  # 노트 삭제는 휴지통으로 간다(30일 복구 가능). 폴더 삭제와 다르다 — SKILL.md 경고 참조.
  for i in "$@"; do
    nm=$(osascript -e "tell application \"Notes\" to get name of note id \"$i\"" 2>&1)
    r=$(osascript -e "tell application \"Notes\" to delete note id \"$i\"" 2>&1)
    if [ -z "$r" ]; then echo "✓ 삭제 $nm"; else echo "✗ $i — $r"; fi
  done
  ;;

restore)
  for i in "$@"; do
    r=$(osascript -e "tell application \"Notes\" to move note id \"$i\" to folder \"Notes\"" 2>&1)
    echo "복구 $i ${r:+— $r}"
  done
  ;;

move)
  # move <folderName> <id>...
  dest="$1"; shift
  for i in "$@"; do
    nm=$(osascript -e "tell application \"Notes\" to get name of note id \"$i\"" 2>&1)
    r=$(osascript -e "tell application \"Notes\" to move note id \"$i\" to folder \"$dest\"" 2>&1)
    if [ -z "$r" ]; then echo "✓ $nm → $dest"; else echo "✗ $nm — $r"; fi
  done
  ;;

merge)
  # merge <targetId> <sourceId> [구분선문구]  — body(HTML)를 이어붙여 첨부까지 보존한다
  tgt="$1"; src="$2"; label="${3:-병합}"
  before=$(osascript -e "tell application \"Notes\" to get count of attachments of note id \"$tgt\"")
  osascript -e "tell application \"Notes\" to set body of note id \"$tgt\" to (body of note id \"$tgt\") & \"<div><br></div><div>--- $label ---</div>\" & (body of note id \"$src\")"
  after=$(osascript -e "tell application \"Notes\" to get count of attachments of note id \"$tgt\"")
  echo "첨부 $before → $after (원본 것이 넘어왔는지 확인)"
  echo "원본은 자동 삭제하지 않음 — 확인 후 delete 서브커맨드로 지울 것"
  ;;

*)
  cat <<'USAGE'
notes.sh <subcommand>
  folders                     폴더별 메모 수
  recent [일수=14] [본문길이=400]   최근 수정 메모 덤프 (폴더·제목·날짜·첨부·id·본문)
  body <id>                   노트 전문
  trash                       휴지통 목록 (id 포함)
  delete <id>...              노트 삭제 → 휴지통 (30일 복구 가능)
  restore <id>...             휴지통 → 미분류 Notes
  move <폴더명> <id>...        폴더로 이동
  merge <대상id> <원본id> [문구]  본문 이어붙이기 (첨부 보존, 원본은 안 지움)
USAGE
  ;;
esac
