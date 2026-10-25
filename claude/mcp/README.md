# MCP — mcp-proxy 로 stdio 서버 공유

Claude Code 는 세션마다 stdio MCP 서버를 새로 띄운다. herdr pane 이 여럿이면 같은 서버가 pane 수만큼 뜬다.
[mcp-proxy](https://github.com/sparfenyuk/mcp-proxy) 를 launchd 로 상시 띄워(`127.0.0.1:8096`) 서버를 한 벌만 돌리고,
Claude 는 `http://127.0.0.1:8096/servers/<이름>/mcp` 로 붙는다.

| 파일 | 내용 |
|---|---|
| `servers.home.json` | 집 맥이 proxy 로 묶는 서버 |
| `servers.company.json` | 회사 맥이 proxy 로 묶는 서버 |
| `apply.sh` | mcp-proxy 설치(uv tool, 버전 고정) → `~/.config/mcp-proxy/servers.json` 렌더 → launchd `local.mcp-proxy` 기동 → `claude mcp add -s user` 등록 |

## 새 기기 / 서버 목록을 바꾼 뒤

```sh
~/config/claude/mcp/apply.sh          # 호스트 이름으로 home/company 를 고른다
~/config/claude/mcp/apply.sh home     # 직접 지정
claude mcp list                       # 연결 확인
```

여러 번 돌려도 된다. 바뀐 게 없으면 아무것도 하지 않는다. 로그는 `~/Library/Logs/mcp-proxy/`.

## 규칙

- 이 저장소는 공개다. 토큰·키는 넣지 않는다. 비밀이 필요한 서버는 proxy 에 넣지 말고 각 기기 `~/.claude.json` 에 둔다.
- 경로는 `${HOME}` 으로 쓴다. `apply.sh` 가 치환한다.
- 세션마다 따로 있어야 하는 서버(예: `chrome-devtools` — 세션마다 자기 브라우저)는 proxy 에 넣지 않는다.
- proxy 를 거치는 서버는 launchd 환경에서 돈다. 로그인 셸 환경변수는 오지 않으니 필요한 값은 `env` 에 적는다.
