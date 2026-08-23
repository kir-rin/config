---
name: herdr-orchestration
description: Herdr worker로 작업을 위임할 때의 routing·layout·권한·격리·결과 회수 규칙. 병렬 agent 실행, 다른 terminal에서 worker 띄우기, 장기 실행 작업 위임, worker 상태 확인과 blocked 처리, 병렬 write와 worktree 판단이 필요할 때 사용한다. "herdr", "worker 띄워줘", "병렬로 돌려줘", "다른 탭에서 실행", "agent 위임" 요청에 적용.
---

# Herdr 에이전트 오케스트레이션

Source of truth: <https://socra-tutor-frontend-wiki.vercel.app/common/guides/herdr-orchestration>
(문서가 갱신되면 이 SKILL.md도 함께 갱신한다.)

Claude Code / Codex / OpenCode가 Herdr에서 별도 worker를 실행할 때 지키는 규칙이다.
Parent agent는 coordinator로서 작업을 나누고 worker 상태와 결과를 관리한다.

## 운영 모델

| 역할 | 책임 |
|------|------|
| Coordinator | 작업 분할, runtime 선택, write scope 할당, 상태 확인, 질문 판단, 결과 통합, 최종 검증 |
| Worker | 할당된 task 수행, scope 준수, 가정 기록, 검증 실행, 구조화된 결과 반환 |
| Herdr | workspace와 terminal 유지, agent 상태 표시, 입력 전달, output 회수 |
| 사용자 | dashboard 관찰, 제품 결정과 외부 부작용처럼 coordinator가 판단할 수 없는 선택 |

하나의 worker는 하나의 stable task identity를 유지한다. 같은 task의 보완·재검증은 기존 worker를 이어 쓰고, 목적이나 write scope가 달라지면 새 worker를 만든다.

## 실행 경로 선택

Native subagent가 기본이다. **Parent가 결과를 즉시 소비해야 하는지**가 첫 번째 판단 기준, **독립 실행과 관찰의 가치**가 두 번째다. 예상 소요 시간은 보조 신호일 뿐 단독 기준으로 쓰지 않는다.

결과가 즉시 필요하지 않고 아래 중 하나라도 해당하면 Herdr worker를 쓴다.

- Parent의 다음 추론과 독립적으로 진행할 수 있다.
- 장시간 실행되거나 parent session보다 오래 유지될 수 있다.
- 사용자가 진행 상황을 관찰하거나 중간에 개입할 가치가 있다.
- 여러 agent 또는 model의 결과를 병렬로 비교한다.
- Test, build, server, log처럼 지속적인 terminal output이 중요하다.
- 여러 단계로 진행되며 `blocked`, timeout, 재시도 상태를 따로 추적해야 한다.

다음은 native subagent를 유지한다.

- 파일이나 symbol 위치처럼 범위가 명확한 단일 질문
- 짧은 구조화 응답 하나로 충분한 작업
- Herdr session 생성과 결과 회수 비용이 실제 작업보다 큰 경우

## 런타임 선택

명시적 요청이 없으면 **parent와 같은 runtime**을 worker 기본값으로 쓴다. Claude Code parent → Claude Code worker, OpenCode parent → OpenCode worker. Model 비교, 독립 review, runtime별 capability 차이가 있을 때만 다른 runtime을 고른다. 한 tab에서 runtime을 섞으면 pane label에 runtime을 표시한다.

## Workspace와 pane 배치

Worker는 parent가 실행 중인 Herdr workspace에 둔다. Delegation loop마다 새 worker tab을 만들고, 이전 loop의 tab·pane은 자동으로 정리하지 않는다.

```
parent workspace
├── parent tab
├── auth-review-01 tab
│   ├── worker pane 1..5
│   └── utility pane
├── auth-review-02 tab
│   └── next delegation loop
└── ...
```

- Worker tab은 최대 2행 3열.
- Agent worker는 최대 5개 pane. 여섯 번째 pane은 test·build·dev server·log·integration shell용.
- 새 delegation loop는 완료된 pane을 재배치하지 않고 새 tab에서 시작한다.
- 같은 task의 follow-up은 기존 pane을 재사용한다.
- 같은 task를 다른 runtime/process config로 다시 시작하면 기존 task tab에 pane을 추가한다.
- 기존 task tab에 agent pane이 5개이거나 전체 pane이 6개이면 `<task>-retry-<N>` tab을 만든다.
- Coordinator가 자동으로 시작하는 attempt는 최초 실행 포함 2회까지. 세 번째는 사용자에게 원인과 이전 결과를 알리고 명시적 승인을 받은 뒤 진행한다.
- 완료된 tab·pane은 사용자가 과정을 다시 볼 수 있도록 유지한다.
- 별도 worktree worker는 worktree의 `cwd`를 가진 별도 workspace에 둘 수 있다.

Tab label은 `workers-04`처럼 순번만 쓰지 말고 task 목적을 드러낸다. 같은 parent task에서 파생된 tab은 공통 prefix + 증가하는 loop 번호를 쓴다. 결과를 회수한 뒤 worker label에 `[done]`, `[blocked]`, `[failed]` 중 하나를 붙인다.

## 동시 실행과 대기열

사용자 확인 없이 시작할 수 있는 in-flight worker는 **최대 5개**. Task report를 회수해 attempt 종료를 확정하지 못한 worker는 lifecycle status와 무관하게 상한에 포함한다. 회수해 종료를 확정한 worker는 상한에서 제외하되 session은 닫지 않는다.

여섯 번째 task는 queue에 둔다. 새 worker를 만들기 전에 기존 worker가 같은 task를 이어서 처리할 수 있는지 먼저 확인한다. Worker 수보다 coordinator가 검토·통합할 수 있는 범위를 우선한다.

## 작업 계약

Worker 시작 전 다음 contract를 전달한다.

```
Task:
Attempt ID:
Goal:
Scope:
Write scope:
Non-goals:
Constraints:
Allowed side effects:
Forbidden side effects:
Deliverable:
Verification:
Completion criteria:
```

Worker는 routine confirmation이나 구현 취향을 묻지 않는다. 되돌릴 수 있는 선택은 저장소 convention과 최소 변경 원칙으로 판단하고 가정을 최종 결과에 기록한다.

Worker가 멈추고 `blocked`로 보고하는 경우는 다음뿐이다.

- 되돌릴 수 없는 외부 부작용이 필요하다.
- 필수 credential이 없다.
- 요구사항이 서로 충돌한다.
- 할당된 write scope를 넘어야 한다.
- 제품 또는 설계 결정권이 필요하다.

## 권한과 외부 부작용

| Task 유형 | Permission mode |
|-----------|-----------------|
| Read-only 조사와 review | File read·search tool만 허용한 mode |
| 로컬 write | 외부 안전 경계를 확인한 경우에만 auto 또는 bypass |
| Test와 build | 제한된 environment나 sandbox에서만 auto 또는 bypass |
| Deploy와 remote mutation | Herdr 자동 worker 사용 금지 |

Read-only worker는 auto/bypass option을 쓰지 않고 검증된 read-only tool allowlist만 노출한다. File read·search 외의 edit, write, shell, subagent, web, mutable MCP, custom tool은 기본 차단한다. Read-only shell command가 꼭 필요하면 exact rule로 따로 허용하고 최종 tool input을 검증한다. Runtime이 이 제한을 강제하지 못하면 native read-only subagent를 쓴다. Coordinator session에는 자동 승인 정책을 적용하지 않는다.

Auto/bypass mode는 다음을 **모두** 충족할 때만 쓴다.

- Coordinator가 신뢰하는 local repository에서 실행한다.
- Task contract가 remote 변경과 production 작업을 금지한다.
- Worker가 production credential과 deploy capability를 쓸 수 없다.
- 실수로 생긴 local 변경을 사용자 작업 손실 없이 검토·복구할 수 있다.

확인할 수 없으면 permission을 제한한 Herdr worker, native subagent, coordinator 중 하나가 작업한다.

격리된 worker의 launch option은 Claude Code `--dangerously-skip-permissions`, OpenCode `--auto`다. 이 option만 붙인 command를 일반 repository에서 복사 가능한 예제로 제공하지 않는다.

- OpenCode `--auto`는 `ask` permission을 자동 승인하고 명시적 `deny`는 유지한다. Top-level `permission.*: deny`는 tool 자체를 숨길 수 있고 `permission.bash.*: deny`는 Bash command의 catch-all rule로 동작하므로 두 계층을 같은 규칙으로 취급하지 않는다. OpenCode worker는 remote 변경·destructive command를 막는 explicit `deny`가 최종 permission config에 적용됐는지 확인한 뒤 시작한다.
- Claude Code `--dangerously-skip-permissions`는 permission check를 우회하므로 agent 내부 approval을 안전 경계로 보지 않는다.

다음은 자동 worker에 위임하지 않는다.

- `git push`와 remote branch 변경
- Deploy와 production mutation
- 실제 환경에 적용하는 migration
- Destructive git 또는 filesystem operation
- Task 수행에 필요하지 않은 secret 접근

Prompt의 금지 문구와 command pattern만으로 외부 부작용을 다 막을 수 없다. Hook이나 command adapter가 tool input에 prefix를 붙이면 agent가 요청한 command와 permission engine이 평가하는 command가 달라진다. Command pattern은 최종 tool input으로 검증하고 단독 안전 경계로 쓰지 않는다. Credential 격리·network 제한·sandbox 같은 agent 밖 경계를 마련할 수 없으면 어떤 runtime에서도 auto/bypass를 쓰지 않는다.

## 상태 확인과 `blocked` 처리

세 상태는 서로 다르다.

| 상태 | 의미 |
|------|------|
| Herdr lifecycle status | Terminal이 `working`, `blocked`, `done`, `idle`, `unknown` 중 어느 상태인지 |
| Herdr command outcome | Prompt 제출의 `stalled`, wait timeout, agent process 종료 등 command 실행 결과 |
| Task status | Worker 결과가 `done`, `blocked`, `failed` 중 무엇인지. `blocked`는 재개 가능, `failed`는 attempt 종료 |

Lifecycle과 task status는 독립적이다. **Herdr lifecycle status만으로 task 성공을 판단하지 않는다.**

`done`만 기다리지 말고 `idle`, `done`, `blocked`를 settled state로 관찰하며 bounded timeout으로 재확인한다.

Follow-up 전에 기존 worker가 settled state인지 확인하고 이전 결과를 회수한다. 같은 실행의 follow-up과 wait 재개는 기존 `Attempt ID`를 유지한다. 종료된 attempt를 다시 실행하거나 process·runtime·config를 바꾸면 새 `Attempt ID`를 발급한다. 결과의 `Attempt ID`가 현재 prompt와 일치할 때만 완료 처리한다.

```bash
herdr agent prompt <worker> "<task-contract>" \
  --wait \
  --until idle \
  --until done \
  --until blocked \
  --timeout 120000
```

Timeout은 worker 종료 조건이 아니다. Timeout 뒤에 상태와 output을 읽고 다시 기다리거나 개입한다. `agent_prompt_stalled`가 나도 prompt를 바로 재전송하지 않고 상태·output을 먼저 확인한다. `blocked`가 되면 coordinator가 contract 안의 가역적 구현 선택을 대신 판단하고 worker를 재개한다.

Interactive selector(OpenCode `Question` tool 등)가 열리면 output과 현재 선택을 읽은 뒤 key를 보낸다.

```bash
herdr agent read <worker> --source recent-unwrapped --lines 100
herdr agent send-keys <worker> enter
herdr agent wait <worker> --until idle --until done --until blocked --timeout 120000
```

- 먼저 구현 질문 / permission prompt / credential 요청 / 외부 부작용 확인 중 무엇인지 식별한다.
- **가역적인 구현 질문에만** 자동으로 답한다.
- 종류를 확정할 수 없거나 permission·credential·외부 부작용과 관련되면 key를 보내지 않고 사용자에게 올린다.
- single-select에서 default option이 의도와 맞는지 확인하지 않고 `enter`를 보내지 않는다. 다른 option을 고를 땐 방향 key를 보낸 뒤 output을 다시 확인한다.
- Free-text와 multi-select는 선택값을 명시적으로 구성하고 제출 전에 output을 다시 읽는다.

요구사항 변경, 외부 부작용, credential, destructive operation, 충돌하는 사용자 의도는 사용자에게 올린다.

## 결과 회수와 세션 유지

Worker는 terminal에 다음 형식의 최종 결과를 남긴다.

```
Status: done | blocked | failed
Attempt ID:
Summary:
Changed:
Verification:
Assumptions:
Risks:
Follow-up:
```

Coordinator는 `herdr agent read`로 결과를 회수하고 verification evidence를 확인한다. Worker가 heading·문장 형식을 정확히 따르지 않았어도 필수 정보가 있으면 coordinator가 표준 형식으로 정규화한다. **형식 차이만으로 재시도하지 않는다.** 필수 필드가 빠졌거나 결과가 task contract·completion criteria와 맞지 않을 때만 후속 질문을 보낸다.

Output이 길거나 machine-readable 결과가 필요할 때만 workspace 밖의 임시 Markdown/JSON 파일을 쓴다. Worker는 임시 파일의 절대 경로를 최종 결과에 포함하고 repository에 orchestration report를 추가하지 않는다.

정상 완료, 실패, timeout, blocked session은 자동으로 닫지 않는다. Lifecycle status는 task 성공을 증명하지 않으므로 task report를 회수한 뒤 결과 label을 남긴다.

## 병렬 수정과 worktree

모든 write worker에 worktree를 만들지 않는다. 판단 기준은 수정 크기가 아니라 동시 write 관계와 변경 범위다.

| 상황 | 실행 방식 |
|------|----------|
| 작은 수정이고 writer가 하나임 | 현재 worktree에서 수정 |
| 여러 writer의 write scope가 명확히 분리됨 | 현재 worktree 공유 가능 |
| Write scope가 겹침 | 병렬화하지 않고 한 writer가 순서대로 수정 |
| 탐색 중 scope가 커질 가능성이 높음 | 별도 worktree 사용 |
| Lockfile, schema, generated file을 수정함 | 별도 worktree 또는 단일 writer |
| Repo-wide formatter나 generator를 실행함 | 별도 worktree 또는 단일 writer |
| 장시간 독립 보존이 필요함 | 별도 worktree 사용 |

겹치는 작업을 별도 worktree에서 병렬 실행하면 충돌을 merge 시점으로 미룰 뿐이다. Overlap이 큰 작업은 하나의 writer에 맡기거나 선행/후속 작업으로 나눈다.

같은 worktree의 병렬 writer에는 path ownership을 할당한다.

```
Write scope: apps/web/src/features/auth/**

Do not edit files outside the assigned write scope.
Do not run git commands.
Do not run repo-wide formatters or generators.
If an out-of-scope change becomes necessary, stop and report it.
```

Worker는 repository 전체를 읽을 수 있지만 할당된 scope 밖을 수정하지 않는다. 필요하면 coordinator에게 보고한다. 작업 중 overlap이 발견되면 한 worker를 멈추고 범위를 다시 나눈다.

Worktree 배치·carry·cleanup은 [Worktree 운영](https://socra-tutor-frontend-wiki.vercel.app/common/guides/worktrees)을 따른다.

## Herdr 실패 시 폴백

| Task | Fallback |
|------|----------|
| Read-only 조사와 review | Native subagent로 자동 전환 |
| Test와 검증 | Native subagent 또는 coordinator가 실행 |
| Write 작업 | 자동 전환하지 않고 coordinator가 직접 수행하거나 사용자에게 보고 |

Write worker를 조용히 native subagent로 바꾸면 dashboard 가시성, path ownership, permission, session 유지 계약이 달라진다. **write runtime 변경을 숨기지 않는다.**

Prompt `stalled`, wait timeout, `unknown` lifecycle은 곧바로 fallback 조건이 아니다. 상태와 output을 읽고 같은 attempt를 한 번만 재개한다. Attempt가 종료됐거나 두 번째 시도도 실패하면 위 표를 적용한다.

## 검증 체크리스트

정책이나 skill adapter를 바꿀 때 확인한다.

- [ ] Claude Code / Codex / OpenCode skill이 같은 source-of-truth 문서를 가리킨다.
- [ ] Worker tab이 최대 2행 3열이며 agent pane이 5개를 넘지 않는다.
- [ ] 여섯 번째 task가 queue에 남는다.
- [ ] Read-only worker에 검증된 file read·search tool만 노출되고 mutation·delegation·external tool이 거부된다.
- [ ] OpenCode의 explicit `deny`가 금지된 command를 prompt 없이 차단한다.
- [ ] Hook·adapter가 command를 바꾸면 permission rule을 최종 tool input으로 다시 검증한다.
- [ ] Herdr lifecycle status와 task report status를 따로 확인한다.
- [ ] `blocked`가 settled state로 반환되고 interactive question을 coordinator가 처리한다.
- [ ] Follow-up과 결과가 같은 `Attempt ID`를 사용한다.
- [ ] 결과 형식이 달라도 필수 정보가 있으면 coordinator가 정규화한다.
- [ ] Path ownership을 넘는 수정이 발생하지 않는다.
- [ ] Herdr 실패 시 read-only task만 자동 fallback한다.
- [ ] 완료된 tab과 pane이 유지되고 결과 label이 남는다.
