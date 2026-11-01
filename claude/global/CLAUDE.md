# 전역 지침 — 목차

늘 지킬 것만 여기 둔다. 나머지는 아래 표의 상황이 오면 그 파일을 먼저 읽는다(2026-10-28 사용자 결정: 짧게, 인덱싱).

## 늘 지킨다
@~/.claude/identity.local.md

- 코드를 쓰거나 고치기 전 보안 기준: `~/KRAFTON_SECURITY.md`.
- **커밋 작성자는 회사 계정만**(실제 값은 아래 `identity.local.md`). 커밋 전에 `git var GIT_AUTHOR_IDENT` 로 확인하고,
  다르면 커밋하지 말고 알린다(`--author` 로 우회 금지). 개인 gmail·옛 계정 금지. 예외 레포 → `~/config/claude/global/git-identity.md`.
- **답은 짧게.** 결론 먼저, 산문 6줄·불릿 5개 이내, 코드 고친 뒤 설명 3줄 이내, 서론·요청 재진술·마지막 요약 문단 없음.
  비교는 표로, 파일은 `path:line`. 사용자가 「자세히」라고 할 때만 넘긴다. 상세 → `~/config/claude/global/answer-format.md`.
- **ADR·지난 결정은 그때의 판단이다.** 새 요청이 어긋나면 그쪽으로 끌지 말고 「ADR n 전제 X 와 어긋남」 한 줄 알린 뒤 새 요청 기준으로 설계, ADR 에 대체됨을 단다(2026-10-31).
- **상태·알림·예외를 늘리기 전에 「덜기 후보」 표로 묻는다**(남길 것은 안전선뿐 — `~/config/claude/subagent-plans.md` 22번, 2026-11-01).
- **필수만 넣고 편의는 기록만 하고 뺀다** — 빼도 사용자가 말한 일을 끝까지 할 수 있고 안전선도 안 깨지면 편의(같은 파일 24번, 2026-11-01).
- **안전선 아닌 대비책은 실제 운영 기록에 신호가 남은 뒤에 만든다** — 그 전엔 「보류 + 되살릴 신호」(같은 파일 23번, 2026-11-01).
- **subagent 는 `worker` 타입으로 띄운다**(MCP·스킬 없이 파일·셸·웹 도구만 — 시작 맥락 약 48K → 14K).
  Workflow 스크립트에서는 `agent(..., { agentType: 'worker' })`. 캔버스·아티팩트 일은 `artifact-worker`(Artifact 만 더함), 사내 시스템(One MCP)·봇 준비 일은 `company-worker`(One MCP 메타툴만 더함). 그 밖의 MCP·스킬이 꼭 필요한 일만 다른 타입으로.
- **subagent·워크플로우 결과는 보고만 보고 받지 않는다.** 받기 전에 실제 결과물(diff·파일·명령 출력) 하나는 직접 본다 — 보고는 검증 안 된 주장(pstack prove-it-works, 2026-10-31).
  분석·조사 보고면 추천·결정을 바꾸는 주장(원인·숫자·「있다/없다」)마다 원본을 한 번씩 확인하고, 확인 못 한 것은 「확인 안 됨」을 붙여 전한다 — 인용 표본만으로 주장을 받지 않는다(2026-11-02).
- 워크플로우·subagent 결과를 받으면 `agent-cost.py --chart --run <id>` 그림을 짧게 함께 보여 준다(`agent-cost` 스킬).

## 이럴 때 이 파일을 먼저 읽는다
| 상황 | 읽을 것 |
| --- | --- |
| herdr tab·pane·세션 fork, 작업 위임 경로, Orca, 브라우저 작업, 과제 그림(Obsidian) | `~/config/claude/global/workspace-tools.md` |
| 한 세션에 안 끝날 긴 작업 | `~/config/claude/global/long-tasks.md` |
| 외부 요청자 요건·피드백 정리, 회신·확인 요청 | `~/config/claude/global/source-grounding.md` |
| 사내 과거 논의·결정·회의를 물을 때, 에이전트 펫 브리핑 | `~/config/claude/global/kg.md` (로컬 전용, 공개 레포 제외) |
| brainstorming 의 질문 단계 | `~/config/claude/global/brainstorming.md` |
| AFFiNE | `~/config/claude/affine.md` |
| 회의 내용을 기능목록·코드에 반영 | `~/config/claude/meeting-intake.md` |
| 계획(과업 여러 개)을 subagent 로 실행 | `~/config/claude/subagent-plans.md` |
| 리뷰어를 돌리고 지적을 받을 때(1층 찾기 → 2층 덜기 `subtract-review` → 3층 사용자) | `~/config/claude/subagent-plans.md` 23번 |
