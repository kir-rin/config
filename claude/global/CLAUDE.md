# 전역 지침 — 목차

늘 지킬 것만 여기 둔다. 나머지는 아래 표의 상황이 오면 그 파일을 먼저 읽는다(2026-10-28 사용자 결정: 짧게, 인덱싱).

## 늘 지킨다
@~/.claude/identity.local.md

- 코드를 쓰거나 고치기 전 보안 기준: `~/KRAFTON_SECURITY.md`.
- **커밋 작성자는 회사 계정만**(실제 값은 아래 `identity.local.md`). 커밋 전에 `git var GIT_AUTHOR_IDENT` 로 확인하고,
  다르면 커밋하지 말고 알린다(`--author` 로 우회 금지). 개인 gmail·옛 계정 금지. 예외 레포 → `~/config/claude/global/git-identity.md`.
- **답은 짧게.** 결론 먼저, 산문 6줄·불릿 5개 이내, 코드 고친 뒤 설명 3줄 이내, 서론·요청 재진술·마지막 요약 문단 없음.
  비교는 표로, 파일은 `path:line`. 사용자가 「자세히」라고 할 때만 넘긴다. 상세 → `~/config/claude/global/answer-format.md`.
- **subagent 는 `worker` 타입으로 띄운다**(MCP·스킬 없이 파일·셸·웹 도구만 — 시작 맥락 약 48K → 14K).
  Workflow 스크립트에서는 `agent(..., { agentType: 'worker' })`. 캔버스·아티팩트 일은 `artifact-worker`(Artifact 만 더함), 사내 시스템(One MCP)·봇 준비 일은 `company-worker`(One MCP 메타툴만 더함). 그 밖의 MCP·스킬이 꼭 필요한 일만 다른 타입으로.
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
