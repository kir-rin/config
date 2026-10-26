#!/bin/sh
# herdr 서버가 플러그인을 돌릴 때의 PATH 엔 node 가 없을 수 있다(회사 맥: ~/.cargo/bin:/usr/bin:/bin 뿐, node 는 ~/.pixi/bin)
# — PATH 에 없으면 흔한 자리에서 찾아 그 스크립트를 돌린다
NODE=$(command -v node 2>/dev/null)
if [ -z "$NODE" ]; then
  for c in "$HOME/.pixi/bin/node" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.local/bin/node" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1); do
    [ -x "$c" ] && { NODE=$c; break; }
  done
fi
[ -n "$NODE" ] || { echo "agent-bubble-notify: node 를 못 찾았어요(PATH=$PATH)" >&2; exit 127; }
exec "$NODE" "$@"
