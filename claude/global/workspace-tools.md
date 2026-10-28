<!-- ~/.claude/CLAUDE.md 에서 옮김(2026-10-28). -->
터미널 워크스페이스는 **herdr**다. 탭·pane·세션 fork 요청은 `herdr-orchestration` 스킬로 처리한다.
**작업 위임은 native subagent(백그라운드)가 기본이다** — 사용자가 tab·pane을 말하거나 계획·진행을 직접 보고 싶어 할 때만
herdr tab worker를 쓴다(2026-10-23 사용자 결정). 기준은 스킬의「실행 경로 선택」.
Orca는 사용자가 이름을 말할 때만 쓴다.

**브라우저** 작업(사용자가 「브라우저」라고 하거나 화면 확인·클릭·업로드가 필요할 때)은 `agent-browser` CLI 로 하고,
**떠 있는 브라우저 세션에 먼저 붙는다**(`--auto-connect`). 순서·금지는 `~/config/claude/browser-automation.md` 를 읽고 따른다.

과제 그림·기능목록은 Obsidian vault `~/Krafton/project-canvas/` 에 둔다. 놓는 자리와 규칙은 그 vault 의 `README.md` 가 정본이니 쓰기 전에 읽는다.
