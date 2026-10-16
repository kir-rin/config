---
name: e2e-capture
description: 구현한 기능을 브라우저에서 사용자처럼 끝까지 밟아 보며(E2E) 단계마다 번호 매긴 스크린샷을 찍고, 클릭 지점에 빨간 박스·번호 주석을 넣고, expect 판정과 페이지 에러까지 기록해 report.md와 자체포함 report.html로 남긴다. agent-browser CLI를 격리 세션으로 돌린다. "구현한 거 E2E 테스트하고 캡처해줘", "화면 찍어서 동작 확인해줘", "시나리오대로 눌러보고 스크린샷 남겨줘", "기능 검증 리포트 만들어줘", "PR에 붙일 캡처", "e2e-capture"류 요청에 사용. 사용법 "e2e-capture {앱 URL 또는 프로젝트, 확인할 시나리오}".
---

# e2e-capture

"구현했다"를 **사용자가 보는 화면으로 증명**한다. 시나리오를 정하고, 브라우저를 실제로 조작하고,
단계마다 캡처를 남기고, 기대 텍스트가 떴는지 판정하고, 마지막에 리포트 한 장을 만든다.

## `run` 스킬과의 관계

| | `run` (Claude Code 내장) | `e2e-capture` (이 스킬) |
|---|---|---|
| 목적 | 앱이 **뜨는지** 확인 — 한 번의 대표 조작 | 기능이 **시나리오대로 동작하는지** 확인 — 여러 단계 |
| 산출물 | 없음 (스크린샷은 보고 버림) | `shots/NN_*.png` · `steps.jsonl` · `report.md` · `report.html` |
| 주석 | 없음 | 빨간 박스 + 번호 배지 (`--mark`) |
| 판정 | 사람이 본다 | `--expect` pass/fail + `check`(페이지 에러) 자동 기록 |
| 앱 실행법 | 프로젝트 스킬 탐색 → 유형별 패턴 | **`run`에 맡긴다** (0단계) |

즉 `run`은 "앱 띄우기", 이 스킬은 "띄운 앱을 시나리오로 검증하고 기록하기"다. 둘은 겹치지 않고 이어진다.

## 0. 도구

```bash
<이 스킬 디렉토리>/e2e.sh init <출력디렉터리> [--name "제목"] [--viewport 1280x800]
<이 스킬 디렉토리>/e2e.sh scenario "<시나리오 제목>"
<이 스킬 디렉토리>/e2e.sh ab <agent-browser 명령…>        # open · snapshot -i · click @e3 · fill · press · wait --text …
<이 스킬 디렉토리>/e2e.sh shot "<라벨>" [--mark '<json>'] [--expect "<텍스트>"] [--full]
<이 스킬 디렉토리>/e2e.sh note "<관찰>"
<이 스킬 디렉토리>/e2e.sh check                            # uncaught 에러 + console.error → 있으면 exit 1
<이 스킬 디렉토리>/e2e.sh report                           # report.md + report.html
<이 스킬 디렉토리>/e2e.sh status | done
```

전제: `agent-browser` CLI(`npm i -g agent-browser && agent-browser install`), `python3`.
브라우저 지식은 `agent-browser skills get core`에 다 있다 — 셀렉터·대기·탭·인증은 그 문서가 기준이다.

## 1. 앱을 띄운다 — `run`에 맡긴다

로컬 앱이면 `run` 스킬 절차대로 띄우고 포트를 확인한다(`curl -sf`로 폴링, `sleep`으로 때우지 않는다).
이미 떠 있는 URL(스테이징 등)이면 이 단계는 없다.

## 2. 시나리오를 정한다 — 구현 범위에서 뽑는다

diff·plan·이슈에서 **사용자가 겪는 흐름** 단위로 2~5개. 시나리오마다 "어떤 화면이 보이면 성공인가"를
텍스트 하나로 적어 둔다 — 그게 `--expect`가 된다. "버튼이 있다"가 아니라 "저장되었습니다가 뜬다"처럼
**결과**로 쓴다. 시나리오 목록은 실행 전에 사용자에게 한 번 보여 준다.

## 3. 돌린다

```bash
E=<이 스킬 디렉토리>/e2e.sh
$E init docs/e2e/2026-01-01 --name "할 일 추가 기능"
$E scenario "할 일 추가"
$E ab open http://localhost:3000/
$E shot "초기 화면" --mark '[{"placeholder":"할 일 입력","n":"1"},{"text":"추가","n":"2"}]'
$E ab snapshot -i                       # @eN 참조를 본다
$E ab fill @e3 "우유 사기"
$E ab find text "추가" click
$E ab wait --text "1개"
$E shot "추가 후" --expect "1개"
$E check
$E scenario "완료 토글"
…
$E report && $E done
```

- **`shot`은 사용자가 결과를 보는 순간마다.** 액션마다 찍지 않는다 — 상태가 바뀐 뒤 한 장.
- **`--mark`는 "여기를 눌렀다/누른다"를 보여 줄 때만.** 한 컷에 박스 1~3개. 키: `text` · `placeholder` ·
  `selector` · `pairWith`(두 텍스트의 공통 조상) · `up`(부모로 N칸) · `n`(배지) · `pad`.
  출력의 `ANNOT drawn=… missing=[]`를 **반드시 본다.** `missing`이 비어 있지 않으면 그 박스는 안 그려졌다.
- **`--expect`는 `document.body.innerText` 부분 일치**다. 숫자·상태 문구처럼 바뀌는 텍스트를 넣는다.
  실패하면 exit 2 — 멈추지 말고 `note`로 원인 관찰을 적고 다음 시나리오로 간다.
- **`check`는 시나리오 끝마다.** 화면이 멀쩡해도 데이터 fetch가 전부 500일 수 있다.

## 4. 결과를 눈으로 본다 — 리포트 전에

`shots/`의 PNG를 **직접 열어서** 본다(Read 도구). 확인할 것: 빈 화면(렌더 실패)·엉뚱한 박스·
민감정보(토큰·이메일·실데이터). 리포트에 넣고 나서 발견하면 늦다.

## 5. 리포트

`report.md`는 저장소에 두기 좋고(이미지 상대경로), `report.html`은 **이미지를 base64로 내장한 한 파일**이라
공유 링크·Slack 첨부·아티팩트 허브에 그대로 올라간다. 판정 열: ✅ 통과(expect 또는 check가 있고 다 통과) ·
❌ 실패 · 👁 수동 확인(판정 근거 없이 캡처만).

## 로그인이 필요한 화면

- **로컬·스테이징 앱**: 로그인 단계를 시나리오 맨 앞에 넣는다. 비밀번호는 명령줄에 쓰지 않는다 —
  `agent-browser auth save <name> --password-stdin` 로 저장해 두고 `e2e.sh ab auth login <name>`.
- **SSO 뒤의 사내 페이지**: 헤드리스 프로필은 빈 상태라 SSO를 못 넘는다. 사람이 이미 로그인한 브라우저를
  쓰는 `web-capture` 스킬(Aside)로 캡처만 하거나, 원격 디버깅을 켠 실제 Chrome에 `--cdp <port>`로 붙인다.
- 2FA·캡차는 사람이 한다. 스킬은 넘어간 뒤부터다.

## 알아둘 것 (실측으로 밟은 것)

- **`click text=추가`는 안 된다.** agent-browser는 Playwright식 `text=` 셀렉터를 모른다 → `find text "추가" click`
  또는 `snapshot -i` 후 `@eN`. CSS(`#id`, `button.primary`)는 된다.
- **Bash 호출마다 셸이 새로 뜬다.** 그래서 세션·출력 경로를 env가 아니라 포인터 파일
  (`$TMPDIR/e2e-capture.current`)로 넘긴다. `e2e.sh ab …`를 거치지 않고 `agent-browser`를 직접 부르면
  **공용 기본 세션**을 건드린다 — 다른 에이전트·사람이 열어 둔 탭을 뺏는다.
- **JS는 `eval --stdin`.** 따옴표가 섞인 inline eval은 깨진다. `--mark`가 그렇게 주입된다.
- **주석은 DOM 오버레이다.** 캡처 뒤 지우므로 다음 조작에 영향 없고, `--full`(전체 높이)에서도 위치가 맞는다.
  단, 스크롤 컨테이너 안 요소는 `getBoundingClientRect + scrollY` 기준이라 컨테이너 스크롤이 있으면 어긋날 수 있다.
- **뷰포트는 `open` 직후에 적용된다**(1280×800 기본, 1x). 레티나 2x가 필요하면 `ab set device`를 따로 쓴다.
- `shot`의 `--expect` 실패는 exit 2, `check`의 에러는 exit 1 — `&&` 체인에 넣으면 거기서 끊긴다. 의도한 것.
- `find text "X" click`은 같은 텍스트가 여러 개면 첫 번째를 누른다. 목록 항목은 `snapshot -i`로 `@eN`을 집는다.
- 끝나면 `done`으로 세션을 닫는다. 안 닫아도 1시간 뒤 자동 종료되지만, 그동안 Chrome이 남는다.

## 하지 못하는 것

- 브라우저 밖(데스크톱 앱·터미널·OS 대화상자) — `run`의 tmux/Electron 패턴이나 macOS `screencapture`.
- 시각 회귀(픽셀 비교) — `agent-browser diff screenshot --baseline`가 있지만 이 스킬의 범위 밖. 레퍼런스
  이미지와 비교 판정이 필요하면 `visual-verdict`류를 따로 쓴다.
