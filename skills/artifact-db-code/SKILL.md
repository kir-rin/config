---
name: artifact-db-code
description: "Claude Artifact 를 「작은 껍데기 HTML + Artifact DB 에 둔 앱 코드」로 나눠, 고칠 때 재게시 없이 DB 문서만 바꾸고 새로 고침으로 반영한다. 청크·체크섬·이전 버전 자동 복귀 로더와 올리기 스크립트 포함. \"아티팩트 재게시 없이 고치고 싶어\", \"artifact 코드를 DB 에 두기\", \"매번 끝줄까지 읽어야 게시된대\", \"껍데기 코드\", \"아티팩트 코드만 바꿔 줘\" 요청에 쓴다."
---

# artifact-db-code

큰 Artifact(수천 줄)를 고칠 때마다 재게시하면, 게시 도구가 라이브판을 **끝줄까지 읽은 뒤에만** 덮어쓰기를 받아서 느리고 토큰이 많이 든다.
그래서 **껍데기**(정적 마크업·CSS·로더)는 한 번만 게시하고, **앱 코드**는 Artifact DB(`code/…` 문서)에 둔다. 이후 고침 = DB 문서 쓰기 + 새로 고침.

## 0. 도구 (이 스킬 디렉토리 기준)

```bash
<이 스킬 디렉토리>/scripts/loader.js          # 껍데기 맨 끝 <script> 에 그대로 넣는 로더
<이 스킬 디렉토리>/scripts/code-chunks.mjs    # 160KB 청크 + sha256 + 문서 목록(시험에서도 import)
node <이 스킬 디렉토리>/scripts/push-code.mjs <코드.js> <N> [prev…] [--out code-out] [--note "…"] [--manifest-version <V>]
```

전제: Artifact capabilities 에 `db`·`user` 가 있어야 한다(`artifact-capabilities` 스킬). Node 18+.

## 1. 구조

| 어디 | 무엇 | 바꾸면 |
|---|---|---|
| 껍데기(게시) | 정적 마크업·`<style>`·`<title>`·로더·JSON 설정 `<script type=application/json>` | **재게시** |
| DB `code/v<N>_<i>` | `{js}` — 코드 조각(UTF-8 160,000바이트 이하, 글자 중간 안 자름) | DB 만 |
| DB `code/v<N>` | `{version,chunks,bytes,sha256,at,note}` | DB 만 |
| DB `code/manifest` | 위 칸 + `prev:[최근 3개]` — **batch 의 맨 마지막** | DB 만 |

- 문서 하나 한도 256KiB → 청크 160KB(JSON 이스케이프 여유). batch 는 50건·약 1MiB 안.
- JS 가 넣는 `<style>`·화면 함수·띠·대화상자는 **코드 쪽**이라 DB 만 바꾸면 된다.
- 선언(capabilities)은 HTML 에 없고 **게시할 때 정해지는 서비스 쪽 메타데이터**다 — 바꾸려면 재게시.

## 2. 로더 동작 (`scripts/loader.js`)

1. `claude.use` 없음 → 「Claude 앱의 아티팩트에서 열어 주세요」. 소유자 아님 → 코드를 읽지도 않음.
2. 순서 `[manifest.version, …prev]` 로 청크를 모아 **크기·sha256** 확인 → 안쪽 `<script>` textContent 로 실행(`try{…}` 블록으로 감싸 최상위 `const` 가 전역에 안 남게).
3. 예외·`unhandledrejection`·**8초 안에 `window.__codeBoot.ok=true` 없음** → 화면을 처음 껍데기로 되돌리고 이전 버전으로. 빨간 띠 「새 코드(vN)가 안 떠서 이전 버전(vM)으로 열었어요 [새 코드 다시 시도] [이유 보기]」, 맨 아래 [이전 버전으로 열기].
4. **앱 코드 맨 끝에 `if(window.__codeBoot)window.__codeBoot.ok=true;` 를 꼭 넣는다.** 비동기 부팅이면 `.catch` 로 `__codeBoot.err` 를 채운다.

## 3. 올리는 순서

1. 코드 빌드(템플릿에서 실행 `<script>` 만 빼 한 파일로 잇기) → 시험(§5).
2. `node push-code.mjs dist/app-code.js 1` (처음). 다음부터 `node push-code.mjs dist/app-code.js 3 2 1 --manifest-version <V>`
   — `V` 는 `ArtifactData get code/manifest` 결과의 **db version**(if_version). 틀리면 batch 가 거절된다.
3. `ArtifactData` `batch` 로 `<out>/batch.json` 의 `writes` 를 적용(청크·`v<N>` 먼저, manifest 맨 끝 → 중간에 끊겨도 manifest 는 옛 버전을 가리킨다).
4. 사용자에게 새로 고침(⌘R)을 부탁.
- 껍데기는 처음 한 번 게시. 그 뒤 재게시는 **선언 변경·정적 CSS/마크업 변경 때만**, 그리고 라이브판을 끝까지 읽기 싫어 `force:true` 를 쓰려면 **사용자의 명시 허락**이 있어야 한다.

## 4. 되돌리기

- 그 창만: 맨 아래 [이전 버전으로 열기].
- 모두에게: `get code/v<M>` 을 읽어 `prev` 를 붙여 `code/manifest` 에 `set`(if_version). 옛 청크는 지우지 않으므로 즉시 돌아간다.

## 5. 시험 구조 (가짜 SDK + Playwright)

같은 장면을 **mono**(한 덩어리 HTML) · **shell**(껍데기 + 가짜 DB 의 `code/` 문서) 두 번 돌리고, **loader** 장면을 따로 본다:
정상 부팅(앱 호출 0건) · 깨진 vN → vM + 빨간 띠 · manifest 없음 · 소유자 아님 → 코드 0 실행 · 체크섬 불일치 → 실행 안 함 · 부팅 시간 초과(1초로 줄여) → 이전 버전.
`code-chunks.mjs` 를 시험에서도 import 해 같은 문서를 가짜 DB 에 심는다. 상세 → `reference.md`.

## 알아둘 것 (실제로 밟은 함정)

- **DB 코드 실행은 CSP 에 안 막힌다** — `new Function`·`eval`·안쪽 script textContent·Blob `script src` 넷 다 Desktop 안에서 돌았다. 가장 단순한 textContent 를 쓴다.
- **코드 글 속 `</script`** 는 껍데기에 인라인할 때 태그를 닫는다 → 빌드에서 `<\/script` 로 바꾼다.
- **DB 읽기 어댑터의 id 덮어쓰기**: `{...d.data(), id:d.id}` 순서로 쓰면 문서 이름이 데이터의 `id` 칸(예 시트 id)을 덮어 깨진다 → **`{id:d.id, ...d.data()}`** (데이터 칸이 이긴다).
- 열 때 host MCP 를 부르지 않는다 — 읽기 전용 표시 없는 도구는 「방금 클릭」이 필요해 0ms `cancelled`. host MCP 함정 전체 → `reference.md` §host.
- 실패한 버전이 건 이벤트·타이머·DB 구독은 화면을 되돌려도 남는다 — 깨끗이 하려면 새로 고침.
- `crypto.subtle` 이 없으면 체크섬 없이 실행하고 푸터에 그렇게 적는다.
