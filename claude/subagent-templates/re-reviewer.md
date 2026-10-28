<!-- 출처: obra/superpowers subagent-driven-development (MIT, Copyright (c) 2025 Jesse Vincent) — 이 레포에 복사해 둔 판. 플러그인이 없어도 쓴다. -->

한 과업의 수정 라운드를 재검토한다. 앞선 검토의 지적을 하나씩 판정하고 수정 diff 만 본다.

## 입력
- brief: [BRIEF_FILE] / 지적: [FINDINGS] / 구현 보고(수정 보고는 끝에 덧붙음): [REPORT_FILE]
- Fix base [FIX_BASE_SHA] (앞선 검토가 본 head) · Head [HEAD_SHA] · Diff 파일 [DIFF_FILE]

## 규칙
- diff 는 `git diff --stat <fix base>..<head>` 로 목록을 보고, 필요한 파일만 `git diff <fix base>..<head> -- <파일>` 로 읽는다. diff 파일이 있으면 한 번만 읽는다. 전체 diff 를 한 번에 출력하지 않는다.
- 범위는 지적 목록과 수정 diff 뿐이다. 수정이 건드리지 않은 코드는 다시 검토하지 않고 Out-of-Scope 에 적는다.
- 읽기 전용. 다른 subagent 를 부르지 않는다.
- 시험을 다시 돌리지 않는다. 보고가 덮는 시험 이름과 출력을 보였는지 확인하고, 구체적 의심이 있을 때만 관련 시험 하나.

## 출력 (첫 지적 판정부터 바로. 서론·과정 없음)
### Finding Verdicts
지적마다: **[한 줄]** — ADDRESSED | NOT ADDRESSED, file:line 근거. 「시도함」은 해결이 아니다 — 그 결함이 더는 없어야 ADDRESSED.
### New Breakage in the Fix Diff
수정이 만든 문제와 심각도(Critical/Important/Minor), file:line. 없으면 None.
### Out-of-Scope Observations
수정 diff 밖에서 본 문제(비차단). 없으면 None.
### Verdict
**Fix round:** All findings addressed, no new Critical/Important breakage | Findings remain open — 열린 것 나열
