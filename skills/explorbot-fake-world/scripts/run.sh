#!/usr/bin/env bash
# 가짜 세계(serve-fake.mjs)에만 Explorbot 을 돌린다. 키는 환경변수로만 다루고 출력하지 않는다.
# 쓰는 법: GATEWAY_BASE_URL=<gateway-base-url> GATEWAY_KEY_ENV=<키가 든 환경변수 이름> [SECRETS_ENV=<키 파일>] run.sh <explorbot 인자…>
#   예: run.sh explore      /  run.sh rerun
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${SECRETS_ENV:-}" ]; then set -a; . "$SECRETS_ENV" >/dev/null 2>&1; set +a; fi
: "${GATEWAY_BASE_URL:?게이트웨이 주소(…/v1 앞까지)를 GATEWAY_BASE_URL 로}"
: "${GATEWAY_KEY_ENV:?키가 든 환경변수 이름을 GATEWAY_KEY_ENV 로}"
key="${!GATEWAY_KEY_ENV:-}"; [ -n "$key" ] || { echo "환경변수 $GATEWAY_KEY_ENV 가 비어 있어요" >&2; exit 2; }
export EXPLORBOT_HOME="${EXPLORBOT_HOME:-$PWD/home}"
# explorbot 의 연결 확인은 설정 파일이 아니라 ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL 을 직접 읽는다 — 같은 값을 그 이름으로도 넘긴다
export ANTHROPIC_API_KEY="$key" ANTHROPIC_BASE_URL="${GATEWAY_BASE_URL%/}/v1"
export EXPLORBOT_ANTHROPIC_SDK="${EXPLORBOT_ANTHROPIC_SDK:-$(npm root -g)/explorbot/node_modules/@ai-sdk/anthropic/dist/index.js}"
[ -f explorbot.config.js ] || cp "$HERE/explorbot.config.js" .
exec explorbot "$@"
