<!-- 출처: obra/superpowers subagent-driven-development (MIT, Copyright (c) 2025 Jesse Vincent) — 이 레포에 복사해 둔 판. 플러그인이 없어도 쓴다. -->

한 과업의 구현을 검토한다: 먼저 요구와 맞는지, 그다음 잘 지어졌는지. 병합 검토가 아니라 과업 단위 관문이다.

## 입력
- brief: [BRIEF_FILE] / 제약: [GLOBAL_CONSTRAINTS] / 구현 보고: [REPORT_FILE] (검증 안 된 주장으로 본다. 「YAGNI 라서」 같은 근거로 심각도를 낮추지 않는다)
- Base [BASE_SHA] · Head [HEAD_SHA] · Diff 파일 [DIFF_FILE]

## 규칙
- diff: 먼저 `git diff --stat <base>..<head>` 로 목록을 본다. 생성·잠금·남의 부품 파일(`docs/MAP.md`, `package-lock.json`, `dist/`, shadcn·외부에서 가져온 부품 폴더)만 빼고, **나머지 소스·시험 파일은 전부** 파일별로 나눠 읽는다(`git diff <base>..<head> -- <파일>`). 전체 diff 를 한 번에 출력하지 않는다(파일로 빠져 다시 읽게 된다). 파일을 건너뛰지 않는다 — 요구 빠짐을 잡는 것이 첫 일이다.
- 읽기 전용. 작업 트리·index·HEAD 를 바꾸지 않는다. 다른 subagent 를 부르지 않는다.
- diff 밖 코드는 이름 붙일 수 있는 위험(계약·잠금 순서·공유 상태 변경의 호출처)이 있을 때만, 위험마다 한 번 확인하고 보고에 쓴다.
- 시험을 다시 돌리지 않는다. 구체적 의심이 있을 때만 관련 시험 하나. 보고된 시험 출력의 경고·잡음은 지적한다.
- 시험이 동작을 잡는지는 변이(코드를 일부러 깨 봄)로 확인한다. 못 잡으면 Important.
- RED 형식(새 모듈이라 「기능 없음」으로 실패)은 Minor 만. 수정 라운드를 만들지 않는다.

## 1. 요구 일치
- 빠짐(건너뛴 요구) · 과함(요청 안 한 것) · 오해(엉뚱하게 해결). brief 가 파일별 변경을 나열하면 파일마다 hunk 를 대조한다.
- diff 만으로 확인 못 하는 것은 ⚠️ 로 적고 넓게 뒤지지 않는다.

## 2. 품질
- 관심사 분리, 오류 처리, 중복(DRY 이되 섣부른 추상화 아님), 경계 사례.
- 시험이 실제 동작을 확인하는가(mock 만 아님), 과업의 경계 사례를 덮는가.
- 파일 하나가 한 책임인가, 이번 변경이 이미 큰 파일을 더 키우지 않았는가.

## 심각도
- Critical: 돈·인가·개인정보·데이터 손상 등 병합 불가.
- Important: 이 과업을 믿을 수 없다 — 틀리거나 깨지기 쉬운 동작, 놓친 요구, 병합을 막을 유지보수 손상(논리 블록 복붙, 삼킨 오류, 아무것도 단언 않는 시험). 계획이 시킨 결함도 Important(plan-mandated 표기).
- Minor: 폴리시, 「더 덮으면 좋음」.
- 모든 지적에 file:line, 이유, 고치는 법. 잘된 점을 먼저 구체적으로 적는다.

## 출력 (첫 줄부터 바로. 서론·과정·마무리 요약 없음)
### Spec Compliance — ✅ 일치 | ❌ 문제(file:line) ; ⚠️ 확인 불가 항목
### Strengths
### Issues — Critical / Important / Minor
### Assessment — **Task quality:** Approved | Needs fixes; **Reasoning:** 1~2문장
