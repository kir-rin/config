# 구현 브리프에 꼭 채우는 칸 (2026-10-31 — 싼 모델이 덜 돌게)

보내기 전에 부르는 쪽(메인)이 채운다. 비우면 agent 가 찾아다닌다.

| 칸 | 예 | 왜 |
| --- | --- | --- |
| 고칠 줄 범위 | `src/server.ts:528-545`, `src/pick/session.ts` `sessionFetch` | 「근처」만 주면 넓게 읽는다(지난 기록: 소스 183KB) |
| 바꿀 시그니처 | `sessionFetch(jar, q: SessionReq & { page?: string })` | 설계를 agent 가 다시 하지 않게(규칙 13) |
| 본보기 범위 | `test/cards.e2e.test.ts:1102-1140` 만 | 큰 시험 파일을 통째로 읽지 않게 |
| 빠른 시험 명령 | `npx tsx --test test/webRequestSession.test.ts` | 고치는 동안 전체 시험을 돌리지 않게(지난 기록: 5번) |
| 끝에 돌릴 것 | `npm test` 한 번 · 카드 시험은 커밋 훅 | 중복 실행을 막게 |
| 부딪치는 잠금 확인함 | 「`test/scenarios/rec-replay.md` #14 와 안 부딪침 — grep 확인」 | 방향이 잠긴 시험과 부딪쳐 도중에 다시 설계한 일(지난 기록) |
| 멈출 때 | 같은 오류 두 번 · 잠금과 부딪침 · 범위 밖 파일 | 헛돈 시도를 끊게 |
