---
name: grill-with-docs-auto
description: 계획·설계를 한 번에 한 질문씩 집요하게 캐물어 공통 이해에 도달하고, 그 과정에서 용어집(CONTEXT.md)과 ADR을 남긴다. superpowers:brainstorming의 "Ask clarifying questions" 단계를 대신할 때, 또는 사용자가 "grill" 류 표현으로 계획을 검증해 달라고 할 때 사용.
---

<!--
왜 이 스킬이 있나 (2026-10-11)
- superpowers:brainstorming의 질문 단계보다 grill-with-docs의 질문 품질이 좋아서, brainstorming의
  "Ask clarifying questions" 단계를 이 스킬로 갈아끼운다. superpowers에는 단계 교체 기능이 없어서
  ~/.claude/CLAUDE.md 규칙("사용자 지침이 스킬보다 우선")으로 연결한다.
- 원본 grill-with-docs(조직 워크스페이스 _shared/plugins/authoring, 원출처 mattpocock/skills)는
  `disable-model-invocation: true`라 brainstorming이 Skill 도구로 부를 수 없고, 그 레포 안에서만 보인다.
  그래서 모델이 호출할 수 있는 전역 사본을 이름을 바꿔(-auto) 둔다 — 같은 이름이면 그 레포에서
  프로젝트 스킬이 가려 다시 호출 불가가 된다.
- 문서 분담: 이 스킬은 CONTEXT.md(용어집)·ADR만 쓴다. spec은 brainstorming이 계속 쓴다.
-->

# grill-with-docs-auto

[domain-modeling](./domain-modeling.md) 규율을 적용하면서 아래 grilling 세션을 진행한다.

## grilling

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase instead.

## brainstorming에서 불렸을 때

공통 이해에 도달하면 질문을 멈추고, 결정된 내용을 짧게 요약해 brainstorming으로 돌아간다
(접근안 제시 → 설계 → spec → 승인 게이트는 brainstorming 절차 그대로).
