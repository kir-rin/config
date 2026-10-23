#!/bin/bash
# macOS 앱의 화면 기록(TCC) 권한이 "켜져 보이는데 안 먹는" 원인을 진단한다.
# 사용: diagnose.sh "/Applications/My App.app"
# 읽기 전용이다 — TCC 상태를 바꾸지 않는다(tccutil 은 실행하지 않는다).
set -u
app="${1:?앱 번들 경로를 넘겨라 (예: /Applications/My App.app)}"
[ -d "$app" ] || { echo "번들이 없음: $app"; exit 1; }

plist="$app/Contents/Info.plist"
bid=$(plutil -extract CFBundleIdentifier raw "$plist" 2>/dev/null)
ver=$(plutil -extract CFBundleShortVersionString raw "$plist" 2>/dev/null)
echo "번들 ID   : ${bid:-?}"
echo "버전      : ${ver:-?}"
echo "설치 시각 : $(stat -f '%Sm' "$app")"

sig=$(codesign -dvv "$app" 2>&1)
echo "서명      : $(echo "$sig" | sed -n 's/^Signature=//p' | head -1)"
echo "팀 ID     : $(echo "$sig" | sed -n 's/^TeamIdentifier=//p' | head -1)"
echo "코드 ID   : $(echo "$sig" | sed -n 's/^Identifier=//p' | head -1)"
echo "플래그    : $(echo "$sig" | sed -n 's/.*flags=\([^ ]*\).*/\1/p' | head -1)"
echo "지정 요건 : $(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p' | head -1)"
echo "Gatekeeper: $(spctl -a -vv "$app" 2>&1 | head -1)"

echo
if echo "$sig" | grep -q 'Signature=adhoc'; then
  cat <<'EOF'
판정: ad-hoc 서명이다. TCC 허용은 이 빌드의 코드 해시(cdhash)에 묶인다.
  → 업데이트·재빌드마다 시스템 설정 목록엔 "켜짐"으로 남지만 새 빌드엔 적용되지 않는다.
  → 권한 없는 앱이 화면을 찍으면 다른 앱 창이 빠진 배경화면만 나온다.
  즉시 해결: tccutil reset ScreenCapture <번들 ID>  → 앱 재실행 → 허용 → 앱 재시작
  근본 해결: Developer ID 서명(+공증), 최소한 매 빌드 같은 인증서로 서명
EOF
elif echo "$sig" | grep -q 'not signed'; then
  echo "판정: 서명 없음 — ad-hoc 과 같은 문제가 생긴다."
else
  echo "판정: 인증서 서명이다. 업데이트로 권한이 풀리진 않아야 한다 — 허용 뒤 앱을 재시작했는지 먼저 본다."
fi
