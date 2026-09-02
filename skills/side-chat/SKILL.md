---
name: side-chat
description: "herdr에서 현재 Claude Code 세션의 전체 맥락을 물려받은 임시 곁가지 대화를 오른쪽 페인에 띄운다. 토글로 열고 닫고, clear로 새로 시작한다. \"side chat 켜줘/꺼줘/토글\", \"side chat clear\" 요청 시 사용."
---

# Side Chat

herdr 페인 안에서 현재 Claude Code 세션을 `--fork-session`으로 갈래쳐, 오른쪽에 새 페인으로 띄우는 스킬. 원본 세션은 전혀 건드리지 않는다 — 곁가지 대화가 끝나면 그냥 닫으면 된다.

구현은 `side-chat.sh`(같은 디렉토리) 하나가 전부 담당한다. Claude는 사용자 요청에 맞는 서브커맨드로 이 스크립트를 Bash로 실행하기만 하면 된다 — herdr pane/agent 명령을 직접 조합하려 하지 말 것(상태 추적이 스크립트 안에 있음).

## 사용법

```bash
bash ~/.claude/skills/side-chat/side-chat.sh toggle   # 닫혀있으면 열고, 열려있으면 닫기
bash ~/.claude/skills/side-chat/side-chat.sh clear    # 기존 곁가지 대화 버리고 현재 맥락으로 새로 열기
bash ~/.claude/skills/side-chat/side-chat.sh status   # 현재 상태 확인 (디버그용)
```

- "side chat 켜줘/꺼줘/토글해줘" → `toggle`
- "side chat clear해줘/새로 시작해줘" → `clear`
- 사용자가 side chat 안(오른쪽 페인)에서 명령해도 자동으로 원본(owner) 페인을 찾아 동작한다.

## 동작 방식

1. `herdr pane current`로 지금 포커스된 페인과 그 Claude 세션ID를 읽는다.
2. **최초 열기**: 그 세션ID를 `claude --resume <id> --fork-session`으로 갈래쳐 새 세션을 만들고, `herdr pane split --direction right`로 만든 페인에 `herdr agent start`로 띄운다.
3. **다시 열기(재토글)**: 이전에 만든 곁가지 세션ID가 있으면 `--fork-session` 없이 그 세션을 그대로 `--resume`한다 — 대화가 이어진다.
4. **닫기**: `herdr pane close`로 페인만 닫는다. 세션ID는 상태 파일에 남겨서 다음 toggle에서 이어 쓴다.
5. **clear**: 페인을 닫고 세션ID 기록을 버린 뒤, 현재 시점의 메인 세션에서 다시 갈래쳐 새로 연다.

상태는 `state/<herdr세션슬러그>__<owner-pane-id>.json`에 `{owner_pane_id, side_pane_id, side_session_id, workspace_id}` 형태로 저장된다. 페인 하나(owner)당 곁가지 세션 하나만 추적한다 — 동시에 여러 개가 필요하면 이 스킬을 확장해야 한다.

세션 슬러그는 `HERDR_SOCKET_PATH`에서 뽑는다(디렉토리명 + 경로 해시 6자). pane id(`wM:p7`)는 herdr 세션 안에서만 유일해서, `herdr --session <name>`으로 여러 세션을 동시에 띄우면 슬러그 없이는 서로 다른 세션의 같은 pane id가 한 파일을 덮어쓴다. 세션 구분 도입 전에 만들어진 파일은 첫 실행 때 자동으로 새 이름으로 옮겨진다.

## 한계 (알고 시작할 것)

- **Claude Code 세션에서만 동작한다.** `claude --resume --fork-session`에 의존하므로 Codex·OpenCode 페인에서는 쓸 수 없다. 확장하려면 설계가 먼저 필요하다 — [`DESIGN-multi-agent.md`](./DESIGN-multi-agent.md) 참고.
- **herdr 페인 밖에서는 동작하지 않는다.** `herdr pane current`로 시작해 페인 분할까지 herdr에 의존한다. 일반 터미널에는 "오른쪽 페인" 개념 자체가 없다.

- **응답의 특정 구간에 앵커되지 않는다.** 세션 전체를 갈래치는 것이지, "이 답변의 이 부분에서"처럼 텍스트 선택에 반응하지 않는다.
- 첫 오픈 시 herdr가 새 페인에서 Claude를 완전히 띄우기까지 약 1초 대기한다(`sleep 1`) — 느린 환경에서는 세션ID를 못 읽어올 수 있다. 그럴 땐 `status`로 확인 후 재시도.
- 곁가지 세션에서 파일을 편집하면 실제로 반영된다 — 메인 세션과 컨텍스트만 공유할 뿐 도구 권한은 별개다. 읽기 전용 용도로 쓰고 싶다면 사용자가 직접 그 세션에서 권한을 조율해야 한다(스크립트가 강제하지 않음).
