<!-- ~/.claude/CLAUDE.md 에서 옮김(2026-10-28). 전역 지침 목차에서 가리킨다. -->
## Git 신원 — 회사 계정으로만 커밋한다

커밋 작성자는 **반드시** 아래여야 한다. 이름이 아니라 **이메일**이 GitHub 계정 연결의
기준이므로 둘 다 맞아야 한다.

```
<회사 계정 — ~/.claude/identity.local.md>
```

- 개인 gmail 과 `kir-rin`(옛 계정, 아래 예외 제외)으로는 절대 커밋하지 않는다.
  이 값이 붙으면 사내 저장소의 기여가 개인 계정으로 귀속된다.
- 커밋 전에 `git var GIT_AUTHOR_IDENT` 로 실제 적용될 값을 확인한다. 전역 설정이
  맞아도 저장소 로컬 설정(`.git/config`)이나 `GIT_AUTHOR_EMAIL`·`EMAIL` 환경변수가
  덮어쓸 수 있다 — 실제로 그렇게 개인 이메일로 나간 적이 있다(2026-09-09 발견).
- 값이 다르면 커밋을 만들기 전에 사용자에게 알리고, 임의로 `--author` 를 붙여
  우회하지 않는다.
- **예외(2026-10-19 사용자 결정, 2026-10-20 `~/oss/herdr-t3` 추가):** 개인 저장소 `~/oss/herdr-bar`(kir-rin/herdr-bar)·`~/oss/herdr-t3`(kir-rin/herdr-t3)만
  `kir-rin <53514545+kir-rin@users.noreply.github.com>` 으로 커밋·push 한다. 저장소 로컬 설정에
  박혀 있다. 개인 gmail 은 여기서도 쓰지 않는다. 다른 저장소로 넓히지 않는다.
  (2026-10-26 추가: `~/Krafton/infra/knowledge-graph` → kir-rin/personal-kb 도 같은 예외. 로컬 설정에 박음.)
  (2026-10-28 추가: `~/config` 도 같은 예외. 로컬 설정 이메일을 gmail 에서 noreply 로 바꿈.)
