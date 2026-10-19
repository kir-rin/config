## AFFiNE — 집 맥 셀프호스팅 + MCP

사용자가 "affine"을 말하거나 AFFiNE 문서·워크스페이스·MCP(`affine-home`)를 다루면, 답하거나 고치기 전에
`~/affine-selfhost/README.md` 를 먼저 읽는다. 서버 구성·접속 URL·인덱서·자격 증명 정책의 정본이다.
- 서버는 집 맥(macbookpro-1)의 docker(colima) 스택이고 tailnet 에서만 열린다(`tailscale serve`, funnel 아님).
- 문서 검색·읽기는 MCP `affine-home`(doc_search·read_document, 읽기 전용)으로 한다.
- 진행 기록은 집 맥 `~/affine-selfhost/_state/progress.md`. 토큰 파일(`_state/mcp-credential.*`)은 출력하지 않는다.
- 회사 맥의 `~/affine-selfhost/README.md` 는 사본이다. 서버 구성을 바꾸면 집 맥 정본을 다시 복사한다.

각 기기의 `~/.claude/CLAUDE.md` 에서 `@~/config/claude/affine.md` 로 불러온다.
