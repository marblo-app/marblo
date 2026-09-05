---
title: required check 는 스킵하면 초록이 아니라 영구 미충족이 된다
tags: [domain/operations, topic/ci, topic/github, topic/verification, method/source-link, kind/knowledge]
status: verified
date: 2026-09-05
links: [[ci-empty-steps-is-billing]], [[verify-without-gui]], [[async-lifetime-must-match-test-boundary]]
---

## 지금 무엇이 참인가

required status check 로 지정된 이름은 **"안 돌리기"가 선택지가 아니다.** 트리거 필터(`paths` / `paths-ignore`)나 job-레벨 `if:` 로 건너뛰면 check run 이 만들어지지 않고, 브랜치 보호는 그것을 "실패"가 아니라 **"expected(아직 안 옴)"** 로 영구히 기다린다. 문서 전용 PR 4건(#1375 #1378 #1395 #1396)이 그렇게 머지 불가로 굳었고 `--admin` 우회조차 거부됐다(원인 커밋: #1388 의 `build.yml` `paths-ignore`).

required check 는 "실패하지 않았다"가 아니라 **"그 이름의 check run 이 결론(conclusion)을 보고했다"** 로만 충족된다. 그래서 실패보다 나쁘다 — 실패한 체크는 재실행하거나 우회할 수 있지만, 존재하지 않는 체크는 우회할 대상조차 없다.

**규칙 둘**:

1. **required check 이름을 가진 job 에는 트리거 필터도, job-레벨 `if:` 도 걸지 않는다.** 비용은 스텝-레벨 `if:` 로 깎는다. required 가 아닌 체크(`build`, `release`)는 SKIPPED 로 둬도 된다 — 무엇이 required 인지는 룰셋(`main rules`, id 22175572, required: `lint`, `verify`)에서 확인한다.
2. **새 게이트는 새 job 을 만들지 않고, 이미 required 인 job 의 새 스텝으로 넣는다.** 새 job 은 룰셋에 등록되기 전엔 빨개져도 머지를 막지 못하는 조언일 뿐이고(등록엔 사람이 저장소 설정을 고쳐야 한다), 등록된 뒤엔 이 노트의 함정을 하나 더 만든다. 실측(PR #1432): `bundle` 스텝을 새 job 이 아니라 이미 required 인 `verify` 안에 넣어, 비용 절약은 스텝-레벨 `if: steps.scope.outputs.docs_only != 'true'` 로만 달았다 — `verify`=SUCCESS 6m36s, `lint`=FAILURE, 두 required 이름 모두 결론을 보고.

이 규율은 **같은 job 안에 독립적인 스텝-레벨 플래그를 몇 개를 두든** 그대로 버틴다. `lint` job(이미 required)은 `eslint` 플래그에 이어 두 번째 플래그 `format`(prettier 검사용)을 나란히 갖고, `Install dependencies` 는 `eslint=='true' || format=='true'` 로 켜진다. 실측(PR #1441, run 33954908236 / job 101276341413): 이 PR 은 `format=false` 였고 `Format check` 스텝은 SKIPPED 였는데도 `lint` job 은 1m23s 완주해 **결론(FAILURE)을 보고**했다 — job 이 사라지거나 "expected" 로 멈추지 않았다. 여러 스텝-레벨 플래그가 같은 job 에서 서로 다른 조건으로 켜지고 꺼져도, job 자체가 결론을 보고하는 한 이 노트의 규율은 깨지지 않는다.

**빨간 PR 을 읽는 순서**: `steps` 길이 0 인가([[ci-empty-steps-is-billing]]) → 아니면 체크가 **목록에 있는가** → 그다음이 진짜 실패다.

부재와 스킵을 구별하는 명령 — 빨간불보다 **체크 이름이 목록에 있는지**를 먼저 센다:

```bash
# BLOCKED 인데 빨간 체크가 안 보이면, 없는 체크를 찾는 것이다.
gh pr view <n> --json mergeStateStatus,statusCheckRollup \
  -q '.mergeStateStatus, [.statusCheckRollup[]?|.name // .context]'

# required 목록과 대조. 여기 있는데 위에 없으면 그게 원인이다.
gh api repos/melocream/marblo/rulesets/22175572 \
  -q '.rules[]|select(.type=="required_status_checks").parameters.required_status_checks[].context'
```

★2026-09-05 이 노트가 인용하는 PR #1441 의 `Format check` 스텝(prettier)은 그날 안에 주석("NEW drift 만 막는다")과 구현(변경 파일마다 flat `prettier --check`, 기존 부채 파일 하나만 건드려도 실패)이 갈린 채 머지됐던 것이 드러나 다시 고쳐졌다 — origin/main 베이스라인과 대조해 기존 부채는 건너뛰고 새 드리프트만 막도록. 이 노트가 실측한 것(스텝-레벨 플래그가 늘어도 job 이 결론을 보고한다는 불변식)은 그 정정으로 바뀌지 않는다 — `Format check` 스텝이 "무엇을" 검사하는지가 바뀌었을 뿐, "스텝이 있고 job 이 완주한다"는 사실 자체는 그대로다.

## 왜

required check 는 브랜치 보호 입장에서 "그 이름의 결론이 아직 도착하지 않은 것"과 "실패"를 구분하지 못한다. 트리거 필터에 걸린 워크플로는 실행이 취소되는 게 아니라 **check run 자체가 생성되지 않는다** — 언젠가 올 수도 있는 것에는 타임아웃이 없다. 새 job 을 새 게이트로 쓰지 않는 이유도 같다: 룰셋에 등록되지 않은 job 은 빨개져도 머지를 막지 못해 게이트가 아니고, 등록된 job 은 이 노트의 함정(어떤 이유로든 SKIPPED 되면 영구 미충족)을 하나 더 늘린다.

## 한계 / 정직성

- "문서 전용 PR 에서 `verify` 가 SUCCESS 로 보고된다"는 CI 에서 직접 실측되지 않았다 — 고친 워크플로를 싣는 PR 자체가 `.github/**` 변경이라 문서 전용일 수 없다(#1401 에서 확인하고 닫음). 머지 후 #1375 재실행으로만 잴 수 있다.
- 판정의 핵심(부재 = 영구 미충족)은 막힌 PR 4건과 #1399 로 확인됐다. 미확인은 절약 쪽 절반뿐이다.
- 이 노트는 GitHub Actions + repository ruleset 조합만 다룬다. 외부 CI(Vercel 등)는 별개 앱이 자기 체크를 붙이므로 이 함정이 없다.
- **수치가 갈리면 `gh api` 실측이 옳다.**

## 실제 영향

CI 설정 변경. `.github/workflows/build.yml` 의 `on.pull_request.paths-ignore` 와 `lint.yml` 의 `on.pull_request.paths` 를 제거하고, 절약을 스텝-레벨 `if:` 로 내렸다(PR #1399). `dist-mcp` 번들 게이트를 새 job 이 아니라 `verify` 의 새 스텝으로 넣었다(PR #1432). `lint` job 에 두 번째 독립 플래그(`format`)를 추가했다(PR #1441). 제품 코드 무변경.

## 이력

**#1388 → #1399: 원인과 수정.** `paths-ignore` 를 넣은 커밋 8552a6f5(#1388)가 이 노트가 다루는 함정을 만들었다. #1399 에서 required 두 job(`lint`, `verify`)의 트리거 필터·job-레벨 `if:` 를 제거하고 스텝-레벨로 내려, 고친 뒤 실측(`lint`=FAILURE 11s · `verify`=SUCCESS 5m39s · `build`/`release`=SKIPPED)으로 두 required check 모두 보고됨을 확인했다. 이 이력은 현재 규칙과 경쟁하지 않지만, "왜 트리거 필터를 지웠나"의 재발 방지 근거로 남긴다.

## Evidence

- [.github/workflows/build.yml](../../../.github/workflows/build.yml) — `verify`, 스텝-레벨 docs-only 단락. 2026-09-05 부터 dist-mcp 번들 게이트도 새 job 이 아니라 이 job 의 스텝 (PR #1432)
- [.github/workflows/lint.yml](../../../.github/workflows/lint.yml) — `lint`, 스텝-레벨 ESLint/Format 게이팅. `Format check` 는 2026-09-05 안에 두 번 바뀌었다: 추가(PR #1441) → prettier 로직을 baseline-diff 로 정정(같은 날, 후속 PR)
- PR #1388 (https://github.com/melocream/marblo/pull/1388) — `paths-ignore` 를 넣은 커밋 8552a6f5
- PR #1399 (https://github.com/melocream/marblo/pull/1399) — 이 판정과 수정
- PR #1432 (https://github.com/melocream/marblo/pull/1432) — 같은 규율의 반대 방향(게이트 추가)과 required 둘 다 보고된 실측
- PR #1394 (https://github.com/melocream/marblo/pull/1394) — `.github/` 단일 파일 PR 에 `lint` 체크가 없는 실물
- PR #1441 (https://github.com/melocream/marblo/pull/1441) — `lint` job 에 두 번째 독립 스텝-레벨 플래그(`format`)를 추가해도 job 이 결론을 보고함을 실측(run 33954908236 / job 101276341413). 같은 스텝의 prettier 로직이 주석과 갈렸던 정정 경위는 이 문서의 "지금 무엇이 참인가" 참고

## Backlinks

- [[ci-empty-steps-is-billing]] · [[verify-without-gui]]
- [[async-lifetime-must-match-test-boundary]] — 체크가 보고됐는데도 빨간 네 번째 경우
