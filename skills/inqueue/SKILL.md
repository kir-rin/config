---
name: inqueue
description: "레포마다 Claude Artifact 한 장을 정본으로 쓰는 티켓 대기열(ai / me / done)을 만들고, 예약 작업이 ai 티켓만 가져가 조사·구현한 뒤 me 로 돌려놓게 한다. Git 에 티켓 파일을 두지 않아 worktree 마다 갈라지지 않고 배포도 안 돈다. \"이 레포에 inqueue 만들어 줘\", \"티켓 보드 만들어 줘\", \"inqueue 붙여 줘\", \"티켓 대기열\", \"AI 가 티켓 가져가게\", \"inqueue 디자인 고쳐 줘\", \"inqueue 예약 바꿔 줘\" 요청에 쓴다."
---

# inqueue

사람은 Artifact 페이지에서 티켓을 쓰고 판단만 한다. 예약 작업이 `ai` 티켓을 가져가 처리하고 `me` 로 돌려놓는다. 맥락은 대화나 Git 이 아니라 그 페이지의 공유 DB 한 곳에 둔다.

전제: Claude Code 의 `Artifact`·`ArtifactData` 도구, T3 Code 의 `schedule_task`(T3 도구는 ToolSearch 로 불러온다). 없으면 만들지 말고 무엇이 없는지 알린다.

## 상태는 셋뿐이다 — 「다음에 누구 차례인가」

| 상태 | 뜻 | 바뀌는 때 |
|---|---|---|
| `ai` | 조사·구현이 남음 | 사람이 티켓을 쓰거나 판단을 적었을 때 |
| `me` | 판단·결과 확인이 필요함 | AI 가 질문·결과를 올렸을 때 |
| `done` | 할 일 없음 | 사람이 닫을 때 |

5단계(new·researched·building·review·done)로 시작했다가 줄였다. 다시 늘리지 않는다. 구현 허락은 상태가 아니라 `safe` 칸이다.

## 1. 이미 있는지 먼저 본다

`Artifact` 의 `action: "list"` 로 `<레포 이름> Inqueue` 를 찾는다. 있으면 새로 만들지 말고 그 URL 을 쓴다(레포 하나에 페이지 하나). 예약도 `list_scheduled_tasks` 로 확인해 같은 이름이 있으면 고친다.

## 2. 페이지 만들기

1. `<이 스킬 디렉토리>/assets/inqueue.html` 을 스크래치패드로 복사하고 `__INQUEUE_TITLE__` 을 `<레포 이름> Inqueue` 로 바꾼다.
2. 폰트를 받는다(레포에 2MB 를 넣지 않으려고 스킬에 두지 않았다). 받은 파일은 빈 폴더 하나에 둔다.
   `curl -fsSL -o <폴더>/PretendardVariable.woff2 https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/woff2/PretendardVariable.woff2`
3. 발행한다: `Artifact` 에 `file_path`, `icon: "list"`, `capabilities: {"db": {}}`, `files: {"PretendardVariable.woff2": "<폴더>/PretendardVariable.woff2"}`.
4. `ArtifactData` 로 `tickets` 컬렉션에 예시 티켓 하나를 넣는다. 예시임을 적고, 업무 내용은 넣지 않는다. 칸: `title`, `status`, `safe`, `why`, `done`, `research`, `decide`, `judgment`, `createdAt`.
5. `ArtifactData list` 로 읽어 들어갔는지 본다.

수정 전에는 `references/design.md` 를 읽는다. 사용자가 지적해 맞춘 기준이다.

## 3. 예약 등록

`references/schedule-prompt.md` 의 글에서 `__ARTIFACT_URL__`·`__REPO__` 를 채워 `schedule_task` 로 등록한다.

- `schedule: {type:"interval", everyMs:900000}`(15분), `bindToCurrentThread:false`, `freshSession:true`
- 등록은 **그 레포의 프로젝트에서** 한다(`projectId`). 다른 프로젝트 스레드는 찾지 못할 수 있다.
- 등록 뒤 예시 티켓을 `ai` 로 바꾸고 `run_scheduled_task_now` 로 한 번 돌린다. 그 호출의 성공은 「시작됨」일 뿐이다. 티켓이 `me` 로 돌아오는 것까지 봐야 끝이다.

## 다른 스레드로 넘기기

티켓의 사람 칸(`why`·`done`·`judgment`)에 「이 스레드를 써」와 스레드 링크를 적으면 예약이 그 스레드에 넘긴다. 적지 않았는데 같은 일이 진행 중으로 보이면 건드리지 않고 `me` 로 돌려 묻는다.

## 알아둘 것(실제로 밟은 것)

- **티켓 파일을 Git 에 두면 갈라진다.** worktree 마다 상태가 달라지고, 번호가 겹치고, 판단을 main 에 올리면 자동 배포가 돌 수 있다. 그래서 파일 방식을 버렸다.
- **페이지 저장은 바뀐 칸만 쓴다.** 전체를 쓰면 열어 둔 사이 AI 가 적은 기록을 지운다.
- **예약 세션에서 티켓 일을 하지 않는다.** 하면 그 작업이 끝날 때까지 다음 확인이 밀린다. 예약은 집고 티켓마다 새 스레드를 띄운 뒤 바로 끝내고, 일은 스레드가 한다.
- **티켓 하나에 스레드 하나를 끝까지 쓴다(`threadId`).** 판단 뒤 새 스레드를 띄우면 조사한 맥락이 사라진다. 스레드 하나가 모든 티켓을 맡으면 앞 티켓에 뒤 티켓이 밀린다.
- **넘길 때 질문과 답을 `history` 에 쌓고 두 칸을 비운다.** 칸에 옛 판단이 남으면 `safe` 티켓이 그 판단으로 구현을 시작할 수 있고, 왜 그렇게 정했는지도 사라진다.
- **`claimedAt` 없으면 다음 예약이 같은 티켓을 또 집는다.** `if_version` 으로 집고, 1시간 지나면 만료. 세션이 죽어도 티켓이 복구된다.
- **Claude 칸은 읽기 전용이다.** 입력칸으로 두면 사람이 쓸 일도 없는데 혼란만 준다.
- **시간대 제한을 넣지 않는다.** 빈 실행도 세션은 똑같이 떠서 아낄 게 없고, 첫 실행 확인만 막는다.
- **티켓에 비밀번호·키를 적지 않는다.** claude.ai 저장소에 남고 넘기는 스레드로도 간다. 사용자가 적었으면 지우라고 알린다.
- **Artifact 는 외부 스타일시트를 Google Fonts 에서만 받는다.** Pretendard 는 CDN 스타일시트로 못 올리니 `files` 로 같이 발행한다. 스크립트는 cdnjs 가 된다(marked·DOMPurify).
- **마크다운을 손으로 짜지 않는다.** 번호 목록·표가 빠져 결국 라이브러리로 바꿨다. 경로 자동 코드 표시만 페이지 코드다.
- 페이지가 잘 그려지는지는 AI 가 볼 수 없는 경우가 많다. 렌더링을 봤다고 말하지 말고 사용자에게 봐 달라고 한다.
- 다른 스레드로 넘기는 길은 한 번도 끝까지 확인하지 못했다. 처음 쓸 때 그 스레드가 티켓을 `me` 로 돌리는지 본다.
