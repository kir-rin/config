#!/bin/sh
# 글을 동물의 숲 말투로 읽고 끝날 때까지 기다린다(PyAnimalese 소리 + animalese.py).
# 사용: animalese-speak.sh [--high] [글…]   글이 없으면 stdin.
# 다른 곳에서도 쓴다 — 예: herdr Announcer(nhclink16.announcer)의 speak_command = ["…/animalese-speak.sh", "{text}"]
# 처음 한 번 PyAnimalese(MIT)를 받아 둔다: $ANIMALESE_SRC(기본 ~/.local/share/pyanimalese), 커밋 고정
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
SRC="${ANIMALESE_SRC:-${XDG_DATA_HOME:-$HOME/.local/share}/pyanimalese}"
REV=01c214590895899c6a78780408c8d75f7ec82934

HIGH=""
if [ "${1:-}" = "--high" ]; then HIGH="--high"; shift; fi
if [ $# -gt 0 ]; then TEXT="$*"; else TEXT=$(cat); fi
[ -n "$TEXT" ] || exit 0

if [ ! -f "$SRC/sources/01.padata" ]; then
  mkdir -p "$(dirname "$SRC")"
  TMP="$SRC.tmp.$$"
  if git clone -q https://github.com/hwi-middle/PyAnimalese "$TMP" && git -C "$TMP" checkout -q "$REV"; then
    rm -rf "$SRC" && mv "$TMP" "$SRC"
  else
    rm -rf "$TMP"
    echo "PyAnimalese 를 받지 못했어요" >&2
    exit 1
  fi
fi

UV=$(command -v uv || true)
[ -n "$UV" ] || for c in /opt/homebrew/bin/uv /usr/local/bin/uv "$HOME/.local/bin/uv"; do [ -x "$c" ] && UV=$c && break; done
[ -n "$UV" ] || { echo "uv 가 없어요(brew install uv)" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
# pydub 은 audioop(3.13 에서 빠짐)을 쓰므로 3.12. ffmpeg 가 mp3 를 읽는다
PYTHONWARNINGS=ignore "$UV" run -q --no-project --python 3.12 --with pydub==0.25.1 \
  python "$DIR/animalese.py" --src "$SRC" --out "$WORK/a.wav" $HIGH "$TEXT" || exit 0  # 읽을 글자가 없으면 조용히
afplay "$WORK/a.wav"
