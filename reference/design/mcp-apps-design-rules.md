# MCP Apps 카드 디자인 규칙 (일반)

조사 2026-11-02. MCP Apps 카드(대화창 안에 그려지는 작은 화면)를 만들 때 공식 문서에서 뽑은 규칙. 특정 프로젝트 내용은 없다.

## 규칙
| # | 규칙 | 근거 |
|---|---|---|
| 1 | 구조 색(배경·글·테두리)은 호스트 토큰 `--color-*` 만, 색 하드코딩 금지. 다크·라이트 둘 다. 호스트 값이 없을 때를 위해 `:root` 에 폴백을 둔다(`var(--color-background-primary, 기존값)`) | Claude 디자인 가이드(Dark mode · Color) · 명세 |
| 2 | 본문 배경은 `transparent`, `<meta name="color-scheme" content="light dark">`, 리소스 `_meta.ui.prefersBorder` 를 명시 | 투명 테마 문서 |
| 3 | 상태색은 의미 토큰(`*-warning/info/danger/success`)으로. 큰 색 상자 대신 작은 점·칩 | Claude 가이드 Color tokens · 명세 변수 목록 |
| 4 | 인라인 카드: 행동 최대 2개, 카드 아래쪽. 데이터 4~5개. 깊은 이동·메뉴·중첩 스크롤 없음 | Claude 가이드 Inline card · OpenAI UI guidelines |
| 5 | 카드 뒤에 오는 모델 글은 짧게, 카드와 겹치는 내용 금지 | OpenAI UI guidelines(Follow-up) · 15 lessons |
| 6 | 크기는 호스트 폰트 토큰 3단계(제목/본문/설명), 굵기 2종: `var(--font-text-sm-size,13px)` 등 | Claude 가이드 Typography · 명세 |
| 7 | 둥글기·테두리 굵기 토큰, 터치 영역 44pt(최소 36), 안전 영역(`safeAreaInsets`) | Claude 가이드 Borders · Touch targets · Safe areas |
| 8 | 크기 알림은 `ui/notifications/size-changed`(ResizeObserver) | 명세 Auto-resize |
| 9 | 테마 바뀜은 `host-context-changed` 로 다시 적용. 일부 변수만 올 수 있으니 폴백 | 명세 UX guidance |
| 10 | 로딩은 스피너 대신 같은 모양의 스켈레톤. 텍스트 대체(`content`)는 항상 의미 있게 | Claude 가이드 Loading states · 명세 Text fallback |
| 11 | 대화로 보내기(`ui/message`)에 기대지 않는다 — 성공으로 답하고 실제로 안 보내는 호스트가 있다. 카드 안에서 `tools/call` 로 처리 | 명세 "Sending content to the model" |

주 버튼 색: 파란 accent 는 호스트 토큰에 없다. `var(--color-background-inverse)`/`var(--color-text-inverse)`(흑/백)가 Claude 모양.

## 「연결 필요」 카드 패턴
공식 지침에는 「연결 필요·빈 상태·오류」 그림이 없다(OpenAI 가이드가 인증·빈/오류는 다루지 않는다고 명시). 규칙 1~5 에서 이끈 제안이다.
- **안 A — 한 번에 하나씩(버튼 2개)**: 제목 「연결이 필요해요」, 부제에 몇 곳을 연결하면 되는지. 연결 행 목록(이름·용도·`1/2 먼저`·`다음`). 아래에 주 버튼 [다음 연결 하기] + 보조 [가짜 데이터로 보기]. 모델 글은 생략하거나 카드와 안 겹치는 한마디.
- **안 B — 행마다 연결 버튼**: 행마다 [연결] + 아래 「연결 없이 가짜 데이터로 먼저 보기」 글자 링크. 한눈에 보이지만 버튼 3개라 규칙 4 를 어긴다.

## 근거 문서
- Claude MCP Apps 디자인 가이드: https://claude.com/docs/connectors/building/mcp-apps/design-guidelines
- Claude 호스트 테마에 섞기: https://claude.com/docs/connectors/building/mcp-apps/transparent-theming.md
- MCP Apps 명세(SEP-1865): https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- OpenAI Apps SDK UI guidelines: https://developers.openai.com/apps-sdk/concepts/ui-guidelines/
- OpenAI 15 lessons: https://developers.openai.com/blog/15-lessons-building-chatgpt-apps
- ext-apps 레포 examples: https://github.com/modelcontextprotocol/ext-apps
- 못 읽음: https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude , https://claude.com/docs/llms.txt
