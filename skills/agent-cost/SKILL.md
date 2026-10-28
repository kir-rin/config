---
name: agent-cost
description: subagent·워크플로우의 비용(토큰·시간·낭비 신호)을 그림으로 보여 준다. "비용 보여 줘", "토큰 얼마나 썼어", "이번 워크플로우 비용", "agent 비용", "subagent 얼마나 먹었어", "비용 추세", "agent-cost" 같은 요청이나, 워크플로우·subagent 결과를 받은 직후에 쓴다.
---

# agent-cost

기본(가장 최근 run):

```
python3 ~/config/claude/subagent-templates/agent-cost.py --chart
```

- 특정 실행: `--chart --run <id>` (id = `wf_…` 또는 단독 agent id).
- 아직 이력에 없는 진행 중 워크플로우: `agent-cost.py <워크플로우 transcript 폴더> --chart`.
  폴더는 `~/.claude/projects/<프로젝트>/<세션>/subagents/workflows/wf_*`.
- 신호를 새로 더한 뒤 옛 run 다시 계산: `agent-cost.py <wf 폴더> --rebuild-run <wf id>`.

출력은 대화창에 그대로 보여 주고, 아래에 읽는 법을 2~3줄 붙인다.
- 맨 위 한 줄이 지난 실행 대비 판정이다. 「다음:」 줄이 지금 고칠 한 가지다.
- 신호 표의 「—」는 그 칸이 생기기 전의 옛 기록이다. ▲ 늘었다, ▼ 줄었다(지난 같은 종류 실행 대비).
- 착수까지 턴 15 초과 = 과업 파일에 고칠 위치를 더 적기, 쓴 양 50K 초과 = 계획에 시그니처 박기(규칙 13), 헛돈 시도 5 초과 = 막힌 원인 확인.

「추세」를 물으면 `~/.claude/agent-cost/history-YYYY-MM.jsonl` 들로 실행별(run) 신호를 한 줄씩 뽑아 보여 준다.
아티팩트 대시보드는 사용자가 원할 때만 만든다.

이력은 SubagentStop hook(`~/config/claude/hooks/agent-cost-hook.py`)이 agent 마다 한 줄씩 쌓는다.
