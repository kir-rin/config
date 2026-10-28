# 저장된 Workflow

`~/config/claude/subagent-plans.md` 11번(계획 과업을 구현 → 검토로 돌리기)을 매번 손으로 쓰지 않게 고정한 틀.

| 파일 | 이름 | 쓰임 |
|---|---|---|
| plan-task.js | `/plan-task` | 과업을 갈래(lane)별로 구현 → 검토 → 수정(최대 2) → (필요하면) 재검토. 갈래 안은 차례로, 갈래끼리는 동시에. 끝나면 합치기 · 시나리오 체크포인트 · 비용 기록 |

## 설치

`bash ~/config/claude/install.sh` 가 `~/.claude/workflows/plan-task.js` → 이 폴더로 링크를 건다(개인 위치 = 모든 프로젝트).
Claude Code 는 프로젝트 `.claude/workflows/` 와 홈 `~/.claude/workflows/` 둘 다 읽는다. 이름이 같으면 프로젝트 쪽이 이긴다.
이미 켜진 세션에서는 `/reload-skills` 뒤에 보인다.

## 부르기 전에 (컨트롤러)

1. 과업마다 brief 를 먼저 만든다: `python3 ~/config/claude/subagent-templates/task-brief.py <계획> <번호> --out <sdd>/T<번호>-brief.md`.
2. brief 맨 위 front matter 의 `model`·`review` 를 읽어 `args.models` 를 채운다 — 스크립트는 파일을 못 읽는다. 없으면 sonnet/opus 로 돈다(로그에 남는다).
3. `<sdd>/implementer.md`(레포·신원 채운 틀), `<sdd>/reviewer.md`, `<sdd>/re-reviewer.md`, `<sdd>/recurring-findings.md` 가 있어야 한다.
4. 사람 결정은 미리 받아 decisions.md 에 적는다 — 실행 중에는 묻지 못한다.

부르기: 「`/plan-task` 를 아래 args 로 돌려」 또는 Workflow 도구에 `name: "plan-task"`, `args: {…}`.

## args

| 키 | 필수 | 뜻 |
|---|---|---|
| repo · docs · sdd | 예 | 레포 · docs 레포 · sdd 작업 폴더 절대 경로 |
| identity | 예 | 커밋 신원(`이름 <이메일>`). agent 가 `git var GIT_AUTHOR_IDENT` 와 대조 |
| lanes | 예 | `[{ tasks: [...], worktree?, branch? }]`. worktree 가 있으면 `<repo>-<worktree>` 에 `branch`(기본 `lane/<worktree>`) 로 main 에서 분기 |
| models | 권장 | `{ "03": ["구현 모델", "검토 모델"] }` |
| merge | | true 면 끝까지 승인된 worktree 갈래를 main 에 `--no-ff` 로 합치고 worktree 를 지운다(브랜치는 남김) |
| checkpoint | | 마지막에 main 에서 돌릴 시나리오 명령 |
| verify | | 전체 시험 명령(커밋 직전·합친 뒤). 없으면 implementer.md 를 따른다 |
| title | | 지시문 머리에 붙일 계획 이름 |
| session | | 세션 폴더(`~/.claude/projects/<proj>/<session>`). 비용 기록이 워크플로우 폴더를 찾을 자리. 없으면 모든 프로젝트에서 가장 최근 |

파일 이름 규칙(sdd 폴더 안): `T<번호>-brief.md` · `T<번호>-report.md` · `T<번호>-review.md` · `progress.md`.

### 예: 과업 03·04·08 을 세 갈래로 동시에, 시나리오 체크포인트 포함

```json
{
  "repo": "/Users/me/work/app",
  "docs": "/Users/me/work/app-docs",
  "sdd": "/Users/me/work/app-docs/sdd/2026-10-28-plan-04",
  "identity": "me <me@example.com>",
  "title": "계획 04",
  "lanes": [
    { "tasks": ["03"] },
    { "tasks": ["04"], "worktree": "t04" },
    { "tasks": ["08"], "worktree": "t08", "branch": "feat/t08-export" }
  ],
  "models": { "03": ["sonnet", "opus"], "04": ["sonnet", "sonnet"], "08": ["haiku", "sonnet"] },
  "merge": true,
  "verify": "npm test && npx tsc --noEmit && npm run build",
  "checkpoint": "npm run test:e2e"
}
```

## 고정한 규칙

- 모든 agent 는 `agentType: 'worker'`. 갈래 안에서 과업이 승인되지 않으면 그 갈래의 남은 과업은 멈춘다.
- **구현:** 첫 줄 `고칠 파일: brief 의 「## 고칠 파일」 그대로`(dispatch-guard 용). brief · implementer.md · recurring-findings.md 경로를 준다. 「이름을 알면 LSP, 모를 때만 FLOW.md」「명령은 묶어서」「크기 상한은 경고 — 깎지 말고 보고」. 전체 시험은 커밋 직전에만.
- **검토:** 첫 줄 `검토:`. reviewer.md 기준. `git diff --stat` 먼저, 생성·잠금·남의 부품만 빼고 파일별로 읽는다.
- **수정:** brief 전체를 다시 읽히지 않는다. 지적 JSON + brief 의 고칠 파일 절(grep 으로 찾아 sed -n) + 보고서의 해당 절만. minor 는 고치지 않는다.
- **컨트롤러 결정:** summary 에 「컨트롤러」「결정」「편차」「decisions」가 있는 지적은 수정 agent 를 띄우지 않고 결과 `needs_controller` 로 올린다(그 과업은 승인 안 됨 → 갈래 멈춤). 나머지 지적은 고친다.
- **재검토 생략:** critical 없음 · 지적 1개 · 바뀐 파일 2개 이하.
- **수정 라운드 최대 2번**, 2번째는 opus.
- **합치기**(merge): 첫 줄 `고칠 파일: 충돌 난 파일만`, sonnet. 체크포인트는 main 쪽 갈래가 모두 승인되고 합치기가 막히지 않았을 때만(합치지 못한 갈래는 `unmerged` 로).
- **비용 기록**(늘 마지막): 첫 줄 `조사:`, haiku. 가장 최근 `subagents/workflows/wf_*` 에 `agent-cost.py --chart` 를 돌려 출력 전문을 `cost.output` 으로 반환.

반환: `{ lanes, needs_controller, merge, unmerged, checkpoint, cost }`.

## 고칠 때

- `export const meta` 는 첫 문장, 순수 리터럴(변수·함수 호출·spread 금지 — 있으면 `/plan-task` 가 자동완성에서 빠진다). 본문에서 `meta` 를 참조하지 않는다.
- `Date.now()`·`Math.random()`·인자 없는 `new Date()` 는 스크립트 안에서 throw 한다. 시각이 필요하면 args 로.
- 문법 확인(최상위 `await`·`return` 이 있어 그냥은 안 된다): `export` 를 떼고 `(async () => { … })()` 로 감싼 사본에 `node --check`.
