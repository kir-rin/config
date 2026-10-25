#!/bin/sh
# herdr ↔ AgentBot 다리(herdr-bridge.mjs)를 launchd 로 늘 띄운다 — 말풍선 버튼 → 그 세션으로 · 다른 컴퓨터 세션 알림 (로그인하면 시작, 죽으면 다시)
#   sh herdr-bridge-install.sh            설치·다시 시작
#   sh herdr-bridge-install.sh uninstall  내리고 지우기
set -eu
LABEL=yh.agent-bubble-bridge
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT=$(cd "$(dirname "$0")" && pwd)
ID=yh.agent-bubble-notify
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "${1:-}" = uninstall ]; then rm -f "$PLIST"; echo "removed $LABEL"; exit 0; fi

NODE=$(command -v node)
HERDR=$(command -v herdr)
CONFIG_DIR=$("$HERDR" plugin config-dir "$ID" 2>/dev/null || echo "$HOME/.config/herdr/plugins/config/$ID")
STATE_DIR="$HOME/.local/state/herdr/plugins/$ID"
mkdir -p "$STATE_DIR" "$(dirname "$PLIST")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/herdr-bridge.mjs</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$HERDR"):$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HERDR_BIN_PATH</key><string>$HERDR</string>
    <key>HERDR_PLUGIN_CONFIG_DIR</key><string>$CONFIG_DIR</string>
    <key>HERDR_PLUGIN_STATE_DIR</key><string>$STATE_DIR</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>$STATE_DIR/herdr-bridge.err</string>
</dict></plist>
EOF

# 방금 내린 직후엔 bootstrap 이 5 로 실패할 때가 있다 → 한 번 더
launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || { sleep 2; launchctl bootstrap "$DOMAIN" "$PLIST"; }
echo "started $LABEL (log: $STATE_DIR/notify.log)"
