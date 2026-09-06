---
title: CI job 의 steps 가 0 이면 코드가 아니라 GitHub 결제다
tags: [domain/operations, topic/ci, topic/verification, method/source-link, kind/knowledge]
status: verified
date: 2026-09-05
links: [[verify-without-gui]], [[release-cut-at-build]], [[empty-query-first]], [[human-only-ops-backlog]], [[required-check-must-report]], [[async-lifetime-must-match-test-boundary]]
---

## 지금 무엇이 참인가

**빨간 PR 을 읽는 순서는 다섯이다** — 순서대로 배제해 나간다:

1. `steps` 길이가 **0** 인가 → GitHub 결제 차단이다. 러너가 한 스텝도 안 붙는다. 사람에게 넘긴다([[human-only-ops-backlog]]).
2. 체크 이름이 rollup **목록에 있는가** → 없으면 트리거 필터·job-레벨 `if:` 로 건너뛴 것이다. required check 라면 [[required-check-must-report]].
3. **job 안 어느 스텝이 exit 1 냈는가** → job 이름을 도구 이름으로 읽지 마라. `lint` 라고 ESLint 를 고치러 가면 고칠 게 없을 수 있다(실측: PR #1432, 원인은 4번째 스텝인 위키 신선도 체크였다).
4. 그 스텝이 테스트 스텝이면 **실패한 테스트가 있는가** → `Tests ... passed` 인데 exit 1 이면 원인은 테스트 본문이 아니라 `Errors` 줄(워커 teardown 과 경합하는 비동기 수명 어긋남, [[async-lifetime-must-match-test-boundary]]).
5. 그다음이 진짜 테스트 실패다.

**결제 차단인지 판별하는 명령**:

```bash
gh run list --repo melocream/marblo --limit 10
gh run view <run_id> --repo melocream/marblo --json jobs \
  --jq '.jobs[] | {name, conclusion, startedAt, completedAt, steps:(.steps|length)}'
# steps == 0 이고 conclusion 이 failure 이면 코드 문제로 단정하지 않는다.
# annotation 원문 키워드: "recent account payments have failed"
#   또는 "spending limit needs to be increased"
```

**부재와 스킵을 구별하는 명령** (순서 ②):

```bash
gh pr view <n> --json mergeStateStatus,statusCheckRollup \
  -q '.mergeStateStatus, [.statusCheckRollup[]?|.name // .context]'
```

**어느 스텝이 죽었는지 지목하는 명령** (순서 ③):

```bash
gh pr checks <n>
gh run view --job <job_id> --log-failed | grep -n '##\[group\]Run\|##\[error\]'
```

로컬 통과는 사전점검일 뿐 CI 대체 증거가 아니다 — CI 체크 통과가 정본이다. GUI/Playwright 로 "CI 대신 화면"을 보지 않는다([[verify-without-gui]]). 워크플로 파일은 루트 `.github/workflows/` 만 GitHub 이 읽는다; `v3/.github/workflows/` 는 죽은 경로다.

**`lint` job 에 스텝-레벨 `if:` 조건을 몇 개를 늘려도 `steps==0` 신호는 죽지 않는다.** 실측(PR #1441, run 33954908236 / job 101276341413): `Setup Node.js`·`Install dependencies` 가 `eslint=='true'` 단독에서 `eslint=='true' || format=='true'` 로 넓어지고, `Format check` 스텝(prettier)이 `format=='true'` 로 추가된 뒤에도 — 이 PR 은 `format=false` 였음에도 — `steps` 배열 길이는 **14**. 스텝-레벨 `if:` 는 스텝을 배열에서 지우지 않고 `skipped` 로 표시할 뿐이다. `Checkout`·`Wiki convention lint`·`Wiki freshness tests`·`Wiki freshness check` 넷은 어떤 스텝-레벨 `if:` 에도 안 걸려 항상 실행되므로, 이 job 이 `steps==0` 이 될 경로는 없다 — 오염되는 경로는 job 자체를 트리거 필터나 job-레벨 `if:` 로 건너뛰는 것뿐이고, 그건 [[required-check-must-report]] 가 이미 막는다.

★2026-09-06(PR #1484, 티켓 `d8tUu9oXxZNrnaM6ZEmQ`): `Wiki convention lint` 스텝 안에 `pull_request`/`push`/그 외로 나뉘는 셸 `case` 를 넣고(모든 분기가 결국 `lint_wiki.py` 를 실행하지, 스텝 자체를 건너뛰지 않는다) `Wiki lint tests` 스텝을 새로 추가했다 — 둘 다 `if:` 없이 무조건 실행이라 "항상 실행되는 스텝" 목록에 `Wiki lint tests` 가 하나 늘었을 뿐, 위 불변식은 그대로다. **다만 이 PR 로 인한 새 `steps` 배열 길이(기존 14 + 1)는 이 PR 이 실제로 CI 에서 한 번 돌기 전까지는 실측이 아니다** — `gh run view --json jobs` 로 재확인 후 숫자를 갱신한다. 지금은 "실측 안 됨"으로 정직하게 남긴다.

★2026-09-05 이 노트가 근거로 인용하는 `Format check` 스텝(PR #1441)은 그 뒤(같은 날) 구현이 주석과 갈린 채 머지됐던 것이 드러나 다시 고쳐졌다 — 이 노트가 다루는 것은 그 스텝이 **있다/skipped 로 남는다는 steps-길이 불변식**뿐이고, 그 스텝이 무엇을 검사하는지(prettier 로직)는 이 노트의 판정과 무관하다. prettier 로직 자체의 정정 경위는 [[required-check-must-report]] 의 Evidence 를 따라간다.

## 왜

결제 차단은 러너를 한 스텝도 안 붙인다. 그래서 체크는 빨강인데 로그에 테스트 실패가 없고, `steps` 가 0 이다. 그 빨강을 테스트 실패로 읽으면 없는 회귀를 고치러 간다 — [[empty-query-first]] 와 같은 "빈 결과를 대상으로 읽는" 오진이다. 스텝-레벨 `if:` 가 배열에서 스텝을 지우지 않고 `skipped` 로 남기는 것도 같은 이유로 중요하다 — 그래야 `steps==0` 이 여전히 "결제"만을 가리키는 신뢰할 수 있는 신호로 남는다.

## 한계 / 정직성

- 787/100/2200 숫자는 2026-08-21 스냅샷이다. 이후 재집계하지 않았다.
- `steps==0` 이 아닌 진짜 테스트 실패도 있다. 로그에 npm/vitest 스택이 있으면 이 노트의 분기가 아니다.
- 다섯 번째 상태(대표 도구는 0 error 인데 job 이 다른 스텝에서 빨강)의 표본은 **PR #1432 한 건**, `lint` job 에서만 관측했다. `verify` 에서 같은 형태의 실물은 아직 없다.
- **수치가 갈리면 원본 §5 와 `gh run view` 실측이 옳다.**

## 실제 영향

문서만. 코드 무변경. 빨간 PR 을 보면 먼저 `steps` 길이를 센다. 0 이면 결제 문제로 사람에게 넘긴다. 0 이 아니면(=job 이 끝까지 돌았으면) **CI 체크 결과가 정본**이다 — 로컬 exit 0 을 근거로 CI 빨강을 무시하지 않는다.

## 이력

**2026-08-21~26 → 2026-09-03: "코드 판단은 로컬로"는 그 시절에만 맞았다.** 이 노트가 태어난 2026-08-21~26 은 결제 차단으로 `Build & Release` 성공 이력이 0건, 최소 5주 정지 상태였다 — CI 가 죽어 있었으니 "로컬 우선"이 유일한 우회로였다. 2026-09-03 그 전제가 PR #1384 에서 같은 날 두 번 반증됐다: (1) 로컬 `npm run lint` exit 0 이 CI 의 `lint` 빨강(4스텝짜리 워크플로 중 ESLint 1스텝만 로컬이 돈다)을 못 잡았다, (2) `tests/unit/rootPathScope.test.ts` 등의 `navigator is not defined` 3건이 CI node20 전용이라 로컬(node v26)에서는 재현조차 안 됐다. 같은 PR 에서 `verify` job 의 `continue-on-error: true` 도 제거되어(그 전에는 테스트 실패도 verify 를 초록으로 위장시켰다), 결제 차단 해소와 맞물려 지금은 **CI 체크 통과가 정본**으로 결론이 바뀌었다. 분기 진단(`steps==0`=결제) 자체는 철회되지 않았고, 위 "지금 무엇이 참인가"에 그대로 반영돼 있다.

## Evidence

- [v3/docs/github-org-migration-plan.md](../../../v3/docs/github-org-migration-plan.md) — §5 annotation 원문, 787/성공 0
- [.github/workflows/lint.yml](../../../.github/workflows/lint.yml) — 루트 워크플로, 스텝-레벨 ESLint/Format 게이팅 (PR #1399, #1441)
- [.github/workflows/build.yml](../../../.github/workflows/build.yml) — Build & Release, `continue-on-error` 제거 (PR #1384), 스텝-레벨 docs-only 단락 (PR #1399), `verify` 의 dist-mcp 번들 스텝 (PR #1432)
- [AGENTS.md](../../../AGENTS.md) — GUI 검증 금지
- PR #1384 (https://github.com/melocream/marblo/pull/1384) — 로컬 lint exit 0 vs CI lint 빨강, node20 전용 `navigator` 3건 재현 불가 사례
- PR #1432 (https://github.com/melocream/marblo/pull/1432) — `lint` 빨강인데 ESLint 는 0 error, 4번째 스텝(위키 신선도)이 원인인 다섯 번째 상태
- PR #1441 (https://github.com/melocream/marblo/pull/1441) — `lint` job 에 조건부 스텝을 하나 더 늘려도 `steps` 길이가 0 에 가까워지지 않음을 실측(run 33954908236 / job 101276341413, steps=14)
- PR #1484 (https://github.com/melocream/marblo/pull/1484) — `lint` job 에 무조건 실행 스텝(`Wiki lint tests`)을 하나 더 추가. run 실측은 아직 없음(위 "지금 무엇이 참인가" 참조)

## Backlinks

- [[verify-without-gui]] · [[release-cut-at-build]] · [[empty-query-first]] · [[human-only-ops-backlog]] · [[functions-deploy-env-and-bq-views]]
- [[required-check-must-report]] — 이 노트가 못 잡던 세 번째 상태(체크 부재)
- [[async-lifetime-must-match-test-boundary]] — 네 번째 상태(테스트 전부 통과, `Errors` 로 exit 1)
- [[enterprise-control-plane-positioning]] — CI pass 가 성공 신호 목록에서 "없다" 인 이유가 이 노트
