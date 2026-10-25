#!/usr/bin/env bash
# mcp-proxy 를 이 기기에 맞춰 설치·기동하고, 묶인 서버를 Claude Code(user scope)에 http 로 등록한다.
# 여러 번 돌려도 결과가 같다. 사용: ./apply.sh [home|company]  (생략하면 호스트 이름으로 고른다)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROXY_VERSION="0.13.0"
PORT=8096
LABEL="local.mcp-proxy"
CONF_DIR="$HOME/.config/mcp-proxy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/mcp-proxy"

profile="${1:-}"
if [[ -z "$profile" ]]; then
  case "$(scutil --get LocalHostName)" in
    chaeyunghuui-MacBookPro) profile=home ;;
    Yunhuiui-MacBookPro) profile=company ;;
    *) echo "프로필을 알 수 없다: ./apply.sh home|company" >&2; exit 1 ;;
  esac
fi
src="$HERE/servers.$profile.json"
[[ -f "$src" ]] || { echo "없음: $src" >&2; exit 1; }
echo "profile: $profile"

# 1) mcp-proxy 설치 (uv tool, 버전 고정)
command -v uv >/dev/null || { echo "uv 가 필요하다 (brew install uv)" >&2; exit 1; }
if ! uv tool list 2>/dev/null | grep -q "^mcp-proxy v$PROXY_VERSION$"; then
  uv tool install --force "mcp-proxy==$PROXY_VERSION"
fi
PROXY_BIN="$(uv tool dir --bin)/mcp-proxy"

# 2) 서버 목록 렌더 (${HOME} 치환). 바뀐 경우만 덮어쓰고 이전 것은 .bak 으로 남긴다
mkdir -p "$CONF_DIR" "$LOG_DIR"
rendered="$(sed "s|\${HOME}|$HOME|g" "$src")"
conf="$CONF_DIR/servers.json"
changed=0
if [[ ! -f "$conf" ]] || [[ "$(cat "$conf")" != "$rendered" ]]; then
  [[ -f "$conf" ]] && cp "$conf" "$conf.bak-$(date +%Y%m%d%H%M%S)"
  printf '%s\n' "$rendered" > "$conf"
  changed=1
fi

# 3) launchd 에이전트. launchd 는 로그인 셸 PATH 를 모르므로 uv·npx 가 있는 곳을 넣어 준다
path="$(dirname "$PROXY_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
if npx_bin="$(command -v npx 2>/dev/null)"; then path="$(dirname "$npx_bin"):$path"; fi
plist_new="$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PROXY_BIN</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>$PORT</string>
    <string>--pass-environment</string>
    <string>--named-server-config</string><string>$conf</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$path</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/err.log</string>
</dict>
</plist>
EOF
)"
if [[ ! -f "$PLIST" ]] || [[ "$(cat "$PLIST")" != "$plist_new" ]]; then
  printf '%s\n' "$plist_new" > "$PLIST"
  changed=1
fi
if [[ $changed == 1 ]] || ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "mcp-proxy 재기동"
fi

# 4) Claude Code 등록: 같은 이름의 기존 항목(stdio 등)을 proxy 주소로 바꾼다
command -v claude >/dev/null || { echo "claude CLI 가 없어 등록은 건너뛴다"; exit 0; }
names="$(python3 -I -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["mcpServers"]))' "$conf")"
while IFS= read -r name; do
  url="http://127.0.0.1:$PORT/servers/$name/mcp"
  current="$(python3 -I -c '
import json,sys,os
d=json.load(open(os.path.expanduser("~/.claude.json")))
print(d.get("mcpServers",{}).get(sys.argv[1],{}).get("url",""))' "$name")"
  [[ "$current" == "$url" ]] && continue
  claude mcp remove -s user "$name" >/dev/null 2>&1 || true
  claude mcp add -s user --transport http "$name" "$url" >/dev/null
  echo "등록: $name → $url"
done <<< "$names"
echo "완료. 확인: claude mcp list"
