---
name: explorbot-fake-world
description: "Artifact·웹 화면을 가짜 SDK·가짜 데이터로 채운 로컬 페이지(가짜 세계)에 띄우고 Explorbot(AI 브라우저 탐색기)을 붙여, 실제 서비스에 닿지 않고 화면 탐색·회귀 시험을 돌린다. \"explorbot 돌려 줘\", \"가짜 데이터로 화면 탐색\", \"회귀 시험 돌려\", \"화면 다 눌러 봐(가짜로)\" 요청에 쓴다."
---

# explorbot-fake-world

보내기·저장 버튼이 있는 화면을 AI 가 **전부 눌러 봐도 안전하게**, 가짜 SDK 로 채운 로컬 페이지에서만 Explorbot 을 돌린다.
처음 탐색보다 **같은 시나리오 다시 돌리기(`explorbot rerun`)** 회귀 시험에 맞다.

## 0. 도구

```bash
npm i -g --allow-scripts=explorbot explorbot
node <이 스킬 디렉토리>/scripts/serve-fake.mjs <target.html> <fake-sdk.js> [8899]   # 가짜 세계 서버 (?v=seeded 로 시드 변형)
GATEWAY_BASE_URL=<gateway-base-url> GATEWAY_KEY_ENV=<GATEWAY_KEY_ENV> \
  <이 스킬 디렉토리>/scripts/run.sh explore            # 또는 rerun. 현재 폴더에 explorbot.config.js 가 없으면 복사
```

- `fake-sdk.js`: 브라우저에서 도는 평범한 스크립트. `window.claude.use('db'|'user'|'mcp'…)` 를 메모리로 흉내 내고 시드 데이터를 넣는다. 호출 제한·클릭 게이트 같은 대기는 가짜 세계에서 끈다(가짜 호출이 빨라 분당 제한에 걸린다).
- **`seeded` 변형**을 만들어 「이미 쓰던」 상태(시트·카드·이력이 있는)도 탐색한다 — 빈 상태만 보면 놓치는 게 많다.
- 전제: Node 18+, Playwright chromium, Anthropic 호환 LLM 게이트웨이와 그 키(환경변수).

## 1. 절차

1. 대상 화면을 빌드해 `target.html` 로 복사 → `serve-fake.mjs` 띄우기 → 브라우저로 한 번 열어 화면이 그려지는지 본다.
2. 키 확인(값 출력 금지 — **상태 코드만**):
   `curl -s -o /dev/null -w '%{http_code}\n' "$GATEWAY_BASE_URL/v1/messages" -H "x-api-key: ${!GATEWAY_KEY_ENV}" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d '{"model":"claude-sonnet-5-5","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'`
   키 이름이 여럿이면 각 이름으로 돌려 200 나오는 것을 `GATEWAY_KEY_ENV` 로.
3. `run.sh explore` → 결과 `output/`·`experience/`. 시나리오가 굳으면 `run.sh rerun` 으로 회귀.
4. 보고: 버그 / 가독성 / UX 흐름 표(항목·어디서·문제·심각도·방향) + 그림 경로.

## 2. 비용·한계 (실측)

- 4건 시험에 **약 4분 · 토큰 약 80만 개**. 넓게 훑는 탐색은 Playwright 스크립트(폭 3개×테마 2개 전 화면 투어)가 더 넓고 싸다.
- Explorbot 은 탐색 폭이 좁다 → **회귀 시험용**으로 쓰고, 처음 훑기는 Playwright 직접 탐색과 같이.

## 알아둘 것 (실제로 밟은 함정)

- **연결 확인이 `ANTHROPIC_API_KEY`·`ANTHROPIC_BASE_URL` 환경변수를 직접 읽는다** — 설정 파일의 `createAnthropic({baseURL, apiKey})` 만으로는 시작 단계에서 실패한다. `run.sh` 가 같은 값을 그 이름으로도 넘긴다.
- **haiku 계열은 게이트웨이에서 ThrottlingException(429)이 잦아 연결 확인이 실패** → `model`·`visionModel`·`agenticModel` 전부 sonnet.
- 설정의 `createAnthropic` 은 explorbot 이 품은 `@ai-sdk/anthropic` 을 써야 버전이 맞는다 → `$(npm root -g)/explorbot/node_modules/@ai-sdk/anthropic` (run.sh 가 `EXPLORBOT_ANTHROPIC_SDK` 로 넘김).
- **시드 글 속 `</script>` 가 script 태그를 닫아 SDK 가 안 뜬다** → `serve-fake.mjs` 가 `<\/script` 로 바꾼다. 화면에 「Claude 앱의 아티팩트에서 열어 주세요」(로더의 SDK 없음 안내)만 보이면 이것부터 의심.
- **실제 Artifact·실제 서비스 주소에는 절대 붙이지 않는다** — Explorbot 은 보내기·저장·삭제까지 다 누른다. 실제 앱 확인은 `desktop-artifact-drive`(읽기 전용).
- 키 값은 `echo`·로그·설정 파일에 싣지 않는다. 설정 파일엔 환경변수 이름만.
