# artifact-db-code — 상세

## 빌드 요령

- 원래 한 덩어리 HTML 에서 **실행 `<script>`** 만 빼 원래 순서대로 이어 `{ … }` 블록으로 감싸고 `//# sourceURL=app-code.js` 를 붙인다 → `dist/app-code.js`.
- 남은 것(마크업·`<style>`·`<script type="application/json">` 데이터) + `loader.js` → `dist/shell.html`.
- 시험용으로 한 덩어리 판(`dist/mono.html`)도 계속 만든다 — 같은 장면이 두 판에서 다 통과해야 한다.
- 인라인할 때 `s.replace(/<\/script/gi,'<\\/script')`. 껍데기에 앱 스크립트가 남지 않았는지 빌드에서 단언한다.

## 껍데기 vs 코드

| 껍데기 — 재게시 필요 | 코드 — DB 만 |
|---|---|
| 템플릿 `<style>`, 정적 마크업(사이드바 틀·머리·빈 `#view`) | 화면 그리는 함수 전부, JS 가 넣는 `<style id=…>` |
| `<title>`, 로더 자신 | 런타임(연결·호출 큐·확인 상자), 부팅 |
| capabilities 선언(게시 인자 — HTML 에 없음) | 테마 토글 등 작은 스크립트 |

CSS 를 자주 고칠 거면 처음부터 JS 가 `<style id="appCss">` 로 넣게 해 코드 쪽에 둔다(body 끝에 두면 템플릿 style 보다 뒤라 이긴다).

## batch.json 모양

```json
{"writes":[
 {"op":"set","collection":"code","doc_id":"v3_0","file_path":".../v3_0.json"},
 {"op":"set","collection":"code","doc_id":"v3","file_path":".../v3.json"},
 {"op":"set","collection":"code","doc_id":"manifest","file_path":".../manifest.json","if_version":7}
]}
```
`ArtifactData` `batch` 에 `writes` 를 그대로 넘긴다. 처음 올릴 땐 `if_version` 없음.

## host MCP 를 페이지에서 부를 때 (`host:<이름>`)

- 이름: 로컬 MCP 확장 **표시 이름**에서 `[A-Za-z0-9_-]` 밖 글자를 `_` 로 (예 `<로컬 MCP 확장 표시 이름>` → `host:<표시_이름>`).
- **Claude 앱 안의 임베드 Artifact 화면에서만** 응답한다. 브라우저 탭·공유 화면에서는 `server_not_connected`.
  Desktop 이 확장 서버를 늦게 켜서 첫 호출만 `server_not_connected` 일 수 있다 → 읽기 호출만 2초 뒤 한 번 재시도.
- `annotations.readOnlyHint!==true` 인 도구(범용 `invoke`, 흐름 실행 등)는 호출 시점에 **창 포커스 + 방금 이 Artifact 를 클릭(transient activation, 약 5초)** 이어야 한다. 아니면 즉시 `cancelled`. 「항상 허용」을 골라도 클릭 조건은 남는다.
  대응: 호출 **직렬 큐** + 차례마다 `navigator.userActivation?.isActive` 확인 → 아니면 「한 번 눌러 주세요 — 다음: 서비스.도구 [계속] [취소]」 띠, [계속] 클릭 핸들러 안에서 호출. **열 때 호출 금지**.
- 앱 제한(조사값): Artifact 당 분당 약 30회·동시 8개 → 60초 창에 25회에서 띠가 기다리게 했다. `rate_limited` 는 자동 재시도하지 않는다.
- 오류 코드별 사람 말: `not_in_manifest`(선언 밖/없는 도구) · `blocked_by_policy`(설정에서 끔) · `capability_disabled`(창 안 보임) · `cancelled`(클릭 직후가 아니었거나 앱 확인에서 거절 — 「허락 안 함」과 구분).
- 모든 호출 오류 앞에 `서비스.도구: ` 를 붙여야 화면·로그에서 원인을 바로 찾는다.

## 시험 (verify) 뼈대

- 가짜 SDK: `window.claude.use('db'|'user'|'mcp')` 를 메모리로 흉내(`isOwner`, `doc().get/set`, `collection().get`, 호출 기록 배열).
- 껍데기 판은 열기 전에 `codeDocs(code,{version:1})` 결과를 가짜 DB 에 심는다.
- 로더 장면 6개(SKILL.md §5)와 「앱 호출 0건」, 콘솔 오류 0 을 단언. 깨진 버전은 코드 끝에 `throw` 를 넣어 만든다.
- 한 덩어리 판은 같은 창에 다시 그리면 최상위 `const` 가 겹친다(실제 새로 고침과 다름) — 다시 열기 장면은 껍데기 판에서만.
