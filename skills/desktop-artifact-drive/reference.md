# desktop-artifact-drive — 상세

## desk.sh 내부
- `snap`: `agent-desktop snapshot --app Claude --compact --max-depth 30` → `$DESK_OUT/s.json`. 트리는 `data.tree`, 노드는 `role`·`name|value|title|description`·`ref_id`·`children`.
- `texts`: 이름 있는 노드를 `[role] 이름 @ref` 줄로. 필터 글이 든 줄만 남길 수 있다.
- `click`: 페이지 표식(「사용자가 생성한 아티팩트 콘텐츠」) 아래에서 `^[(button|link)] <이름> @` 를 찾아 `agent-desktop click @ref`(AXPress). 못 찾으면 `NO_REF`.
- `cont`/`reload`: `list-windows --app Claude` 에서 보이는 `Claude` 창 id 로 `press return|cmd+r --window-id <id> --headed`.
- `wait_done`: 1초마다 snap, `alertdialog` 가 있으면 cont, 진행 글(「읽는 중」·「불러오는」·「쓰는 중」)이 없으면 done. **진행 글은 대상 Artifact 에 맞게 바꾼다.**

## 로그 읽기
```bash
grep -n 'ArtifactHostTools' ~/Library/Logs/Claude/main.log | tail -20
```
`outcome: cancelled` + `durationMs: 0` 이면 클릭 인정 실패(접근성 클릭이었거나 열 때 호출). `server_not_connected` 면 앱 안 임베드 화면이 아니거나 로컬 확장이 아직 안 켜짐.

## 훑기 순서 예 (읽기만)
1. 열기 직후 화면 글 · 로그에 호출 0건인지.
2. 화면 탭(메뉴)을 차례로 → 빈 상태 안내·오류 글.
3. 읽기 버튼 하나(다시 읽기 등) → 띠 → `cont` → outcome ok.
4. 큰 표 열기 → snapshot TIMEOUT 이면 `reload`.
