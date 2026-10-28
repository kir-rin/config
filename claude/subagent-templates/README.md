# subagent 계획 실행 틀

`~/config/claude/subagent-plans.md` 의 규칙을 실제로 돌릴 때 쓰는 틀. superpowers 플러그인이 없어도 이것만으로 돈다.

| 파일 | 쓰임 |
|---|---|
| implementer.md | 구현 agent 공통 규칙(프로젝트마다 복사해 채움) |
| reviewer.md | 과업 검토 기준(자리표시자: BRIEF·REPORT·DIFF·BASE/HEAD) — 출처: superpowers subagent-driven-development task-reviewer 를 한국어로 다듬은 것(MIT) |
| re-reviewer.md | 수정 라운드 재검토 기준(FINDINGS·FIX_BASE·HEAD·DIFF) — 같은 출처 |
| task-brief.py | 폴더 형식 계획(plan.md·constraints.md·interfaces.md·tasks/NN-slug.md)에서 과업 brief 를 추측 없이 이어 붙인다(`<계획 폴더> <번호> [--decisions] [--out]`) — 과업 파일 + constraints + uses/produces 의 `## I-<id>` 절 + 태그 맞는/always 결정, 없는 id 면 exit 2. 폴더가 아닌 단일 `.md` 계획은 예전처럼 추측으로 뽑는다. 시험: `python3 test_task_brief.py` |
| agent-cost.py | 워크플로우 transcript 의 agent 별 시간·맥락·도구 종류·큰 결과·중복 읽기를 표로(`<폴더> [--top N] [--md]`) |

작업 폴더(계획마다 하나): 계획 문서를 둔 곳 옆 `sdd/<계획 이름>/` — progress.md(장부), recurring-findings.md(반복 지적 15줄 이내), 과업별 report·review 파일. 레포 안에 두지 않는다.
