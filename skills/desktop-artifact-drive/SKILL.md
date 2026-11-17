---
name: desktop-artifact-drive
description: "실제 Claude Desktop(macOS) 앱 안에 열린 Artifact 를 접근성 도구 agent-desktop 으로 읽기 전용으로 눌러 보며 오류·불편을 모아 단계 표로 보고한다. \"Desktop 에서 직접 눌러 봐\", \"agent-desktop 으로 아티팩트 시험\", \"실제 앱에서 확인해 줘\", \"Claude 앱에서 아티팩트 돌려 봐\" 요청에 쓴다."
---

# desktop-artifact-drive

가짜 SDK 시험이 못 보는 것(앱 확인 창, host MCP 연결, 클릭 인정, 실제 창 크기)을 **실제 Claude Desktop 안의 Artifact** 에서 본다.
**읽기 전용만** 한다 — 실제 서비스에 쓰는 버튼은 누르지 않는다.

> 사람이 1~2분 눌러 보면 끝나는 확인이면 먼저 사람에게 「누를 것·볼 것」을 주고 권한다. 사용자가 맡기면 이 스킬로 한다.

## 0. 준비

```bash
npm i -g --allow-scripts=agent-desktop agent-desktop    # 전역 bin 이 PATH 에 없을 수 있다 → AGENT_DESKTOP=<전체 경로>
<이 스킬 디렉토리>/scripts/desk.sh snap                  # 접근성 트리 → $DESK_OUT/s.json (기본 $TMPDIR/desk-drive)
<이 스킬 디렉토리>/scripts/desk.sh texts [필터…]         # 화면 글 + ref
<이 스킬 디렉토리>/scripts/desk.sh click "정확한 이름"    # 페이지 영역의 button/link 중 이름이 정확히 같은 첫 것 (all: 사이드바까지)
<이 스킬 디렉토리>/scripts/desk.sh cont                  # 「한 번 눌러 주세요」 띠 → 실제 Return 키로 계속
<이 스킬 디렉토리>/scripts/desk.sh wait_done [초]        # 진행 글이 사라질 때까지, 띠가 뜨면 cont
<이 스킬 디렉토리>/scripts/desk.sh reload                # ⌘R (새 코드 반영·snapshot TIMEOUT 풀기)
```

전제: macOS, 터미널(또는 실행 앱)에 **손쉬운 사용** 권한, Claude Desktop 에 대상 Artifact 가 열린 상태, `python3`.
Claude 앱 창 제목이 `Claude` 이고 페이지 영역 표식이 「사용자가 생성한 아티팩트 콘텐츠」(한국어 UI)라고 가정한다 — 다르면 `desk.sh` 의 두 글자를 고친다.

## 1. 절차

1. `snap` → `texts` 로 지금 화면 글을 읽는다. 버튼 이름을 **그대로** 복사해 쓴다.
2. 아래 「누르면 안 되는 버튼」이 아닌지 확인한 뒤 `click "이름"`.
3. 호출이 나가는 버튼이면 `wait_done 60`. 띠가 뜨면 `cont`(Return)로 넘긴다. 앱 확인 창(Allow)은 사람이 누르게 둘 수 있다.
4. 결과는 `texts` 와 로그로 본다:
   `grep ArtifactHostTools ~/Library/Logs/Claude/main.log | tail` → `call {tool, outcome, durationMs}` (ok / cancelled / …).
5. 단계마다 표에 한 줄: 누른 것 · 화면에 나온 글 · 로그 outcome · 헷갈린 점.

## 2. 누르면 안 되는 버튼 (실제로 쓴다)

가져오기 · 저장 · 보내기(Slack·메일) · 삭제 · 켜기/끄기 · 추가(+ 블록·+ 알림 등 — 누르면 실제로 생긴다) · 권한(허용 범위 바꾸기) · 템플릿 저장.
애매하면 누르지 말고 보고서 「못 누른 것」에 적는다. 이런 버튼까지 다 눌러 보려면 `explorbot-fake-world`(가짜 세계)로 간다.

## 3. 보고 양식

```
| # | 누른 것 | 화면 결과(글) | 로그 outcome | 메모 |
클릭 수: 사람 기준 N번 (띠 [계속] 포함)
헷갈린 곳: …
버그: …            불편: …
못 누른 것(쓰기 버튼): …
```

## 알아둘 것 (실제로 밟은 함정)

- **접근성 클릭(AXPress, `agent-desktop click @ref`)은 「방금 눌렀음」(user activation)으로 안 쳐진다** → 읽기 전용 표시 없는 host 도구가 `cancelled`, 페이지 「한 번 눌러 주세요」 띠가 뜬다. **실제 키 입력 `press return --window-id <id> --headed`(CGEvent)는 인정**된다 — 그래서 `cont` 가 Return 을 보낸다.
- ref 는 노드의 **`ref_id`** 칸(`ref` 아님).
- **부분 일치 클릭이 사이드바의 다른 Artifact 로 간 사고**가 있었다 → 정확한 이름 + 페이지 영역(표식 아래)만. 사이드바는 `all` 을 줄 때만.
- 큰 표가 열려 있으면 `snapshot` 이 **TIMEOUT**(「Accessibility deadline exhausted」) → `reload`(⌘R) 로 풀린다. `--max-depth 30` 이 필요하다(얕으면 페이지 안이 안 보인다).
- **화면 기록 권한이 없으면 스크린샷 불가** — 글(AX 트리)로만 본다. 그림이 필요하면 사람에게 캡처를 부탁.
- 새 코드(DB 에 둔 코드 등)는 새로 고침해야 뜬다.
- 앱 확인 창은 「다시 묻지 않기」를 골라 둔 상태면 안 뜬다 — 처음 보는 흐름은 사람이 옆에 있어야 한다.
