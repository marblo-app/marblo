---
title: required check 는 스킵하면 초록이 아니라 영구 미충족이 된다
tags: [domain/operations, topic/ci, topic/github, topic/verification, method/source-link]
status: verified
date: 2026-09-05
links: [[ci-empty-steps-is-billing]], [[verify-without-gui]], [[async-lifetime-must-match-test-boundary]]
---

# required check 는 스킵하면 초록이 아니라 영구 미충족이 된다

> **한 줄 판정**: ★채택 — required status check 로 지정된 이름은 **"안 돌리기"가 선택지가 아니다.** 트리거 필터(`paths` / `paths-ignore`)나 job-레벨 `if:` 로 건너뛰면 check run 이 만들어지지 않고, 브랜치 보호는 그것을 "실패"가 아니라 **"expected(아직 안 옴)"** 로 영구히 기다린다. 문서 전용 PR **4건**(#1375 #1378 #1395 #1396)이 그렇게 머지 불가로 굳었고 `--admin` 우회조차 거부됐다. CI 비용을 아끼려면 job 을 끄는 게 아니라 **job 은 돌리고 안의 무거운 스텝만 스텝-레벨 `if:` 로 끈다.**

## 무엇을 물었나

문서만 고친 PR 에서 CI 비용을 안 쓰려면 무엇을 꺼야 하나. 그리고 껐을 때 머지는 왜 막히나.

## 무엇을 했나

`main rules` 룰셋(id 22175572)의 required check 목록과, 막힌 PR 4건의 `statusCheckRollup` 을 대조했다.

```bash
gh api repos/melocream/marblo/rulesets/22175572 \
  -q '.rules[] | select(.type=="required_status_checks")'
# → required: lint, verify

gh pr view 1375 --json mergeStateStatus,statusCheckRollup \
  -q '.mergeStateStatus, [.statusCheckRollup[]?|"\(.name // .context)=\(.conclusion // .state)"]'
```

## 결과 (수치)

| 지표                    | 값                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| required check          | `lint`, `verify` (둘 다 `integration_id` 15368 = GitHub Actions)                                                                                            |
| 막힌 PR                 | **4건** — #1375 #1378 #1395 #1396, 전부 `mergeStateStatus=BLOCKED`                                                                                          |
| 막힌 PR 의 `verify`     | 체크 목록에 **부재**. FAILURE 도 SKIPPED 도 아니다                                                                                                          |
| `--admin` 우회          | 거부 — `Required status check "verify" is expected`                                                                                                         |
| 원인 커밋               | #1388 (8552a6f5) 이 `build.yml` 의 `on.pull_request` 에 붙인 `paths-ignore`                                                                                 |
| 같은 구조의 미발화 지뢰 | `lint.yml` 의 `on.pull_request.paths`. #1394(`.github/` 단일 파일)의 체크 목록에도 `lint` 가 **없다** — 룰셋 생성(2026-09-03 16:33) 전 머지라 살아남았을 뿐 |
| 고친 뒤 실측 (#1399)    | `lint`=FAILURE(11s) · `verify`=SUCCESS(5m39s) · `build`/`release`=SKIPPED. **두 required check 모두 보고됨**                                                |

재현 단위는 **PR 1건**. 표본은 막힌 PR 4건 전수 + 고친 뒤 PR 1건.

부재와 스킵을 구별하는 명령 — 빨간불보다 **체크 이름이 목록에 있는지**를 먼저 센다:

```bash
# BLOCKED 인데 빨간 체크가 안 보이면, 없는 체크를 찾는 것이다.
gh pr view <n> --json mergeStateStatus,statusCheckRollup \
  -q '.mergeStateStatus, [.statusCheckRollup[]?|.name // .context]'

# required 목록과 대조. 여기 있는데 위에 없으면 그게 원인이다.
gh api repos/melocream/marblo/rulesets/22175572 \
  -q '.rules[]|select(.type=="required_status_checks").parameters.required_status_checks[].context'
```

## 왜

required check 는 "실패하지 않았다"가 아니라 **"그 이름의 check run 이 결론(conclusion)을 보고했다"** 로만 충족된다. 트리거 필터에 걸린 워크플로는 실행이 취소되는 게 아니라 **check run 자체가 생성되지 않는다**. 브랜치 보호 입장에서 그 체크는 아직 도착하지 않은 것이고, 언젠가 올 수도 있는 것에는 타임아웃이 없다. 그래서 실패보다 나쁘다 — **실패한 체크는 재실행하거나 우회할 수 있지만, 존재하지 않는 체크는 우회할 대상조차 없다.**

## 한계 / 정직성

- "문서 전용 PR 에서 `verify` 가 SUCCESS 로 보고된다"는 아직 **CI 에서 실측되지 않았다.** 고친 워크플로를 싣는 PR 은 그 자체가 `.github/**` 변경이라 문서 전용일 수 없고, 그 브랜치 위에 문서를 얹어도 diff 에 워크플로가 남는다(#1401 에서 확인하고 닫음). 머지 후 #1375 재실행으로만 잴 수 있다.
- 지금까지의 근거는 두 가지다: (1) 워크플로의 `run:` 스크립트를 YAML 에서 그대로 추출해 `gh` 를 스텁으로 갈아끼우고 실제 PR 파일 목록으로 돌린 로컬 실행 — 옛 `paths-ignore` 판정과 전 케이스 일치, (2) #1399 에서 두 required check 가 모두 **보고되었다는** 실측.
- 판정의 핵심(부재 = 영구 미충족)은 #1375 4건과 #1399 로 확인됐다. 미확인은 절약 쪽 절반뿐이다.
- 이 노트는 GitHub Actions + repository ruleset 조합만 다룬다. 외부 CI(Vercel 등)는 별개 앱이 자기 체크를 붙이므로 이 함정이 없다.
- **수치가 갈리면 `gh api` 실측이 옳다.**

## 실제 영향

CI 설정 변경. `.github/workflows/build.yml` 의 `on.pull_request.paths-ignore` 와 `lint.yml` 의 `on.pull_request.paths` 를 제거하고, 절약을 스텝-레벨 `if:` 로 내렸다(PR #1399). 제품 코드 무변경.

앞으로의 규칙:

- **required check 이름을 가진 job 에는 트리거 필터도, job-레벨 `if:` 도 걸지 않는다.** 비용은 스텝-레벨 `if:` 로 깎는다.
- required 가 아닌 체크(`build`, `release`)는 지금처럼 SKIPPED 로 둬도 된다. 무엇이 required 인지는 룰셋에서 확인하고 손댄다.
- 스킵 판정 로직의 모든 실패 경로는 **"전체 게이트 실행"** 으로 폴백한다. 목록을 못 읽어 몇 분 더 쓰는 건 괜찮지만, 게이트를 조용히 건너뛰는 건 안 된다.
- 빨간 PR 을 볼 때의 순서: `steps` 길이 0 인가([[ci-empty-steps-is-billing]]) → 아니면 체크가 **목록에 있는가** → 그다음이 진짜 실패다.

## 2026-09-05 갱신 — 이 규율은 "빼지 마라"만이 아니다: **새 게이트도 새 job 으로 만들지 않는다**

여기까지 이 노트는 **비용을 깎는 방향**에서만 적용됐다 — job 을 끄지 말고 안의 무거운 스텝만 꺼라. 2026-09-05 에 같은 규율이 **반대 방향**에서 걸렸다: 게이트를 **새로 더할 때** 그것을 어디에 두느냐.

PR #1432 는 `npm run build:mcp` 의 esbuild 번들 단계가 pull_request 에서 **아무 데서도 안 돌던** 구멍을 막아야 했다(`build` job 이 `if: github.event_name != 'pull_request'` 라 그 경로에 도달하지 않는다). 가장 자연스러운 설계는 `bundle` 이라는 **새 job** 이다. 그런데 이 노트의 판정을 그대로 뒤집어 읽으면 그게 왜 안 되는지가 나온다:

|                              | 새 `bundle` job                                                           | `verify` 안의 새 스텝                      |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| 룰셋(22175572) required 목록 | **없다** → 빨개져도 머지를 못 막는다. 게이트라고 부르지만 게이트가 아니다 | 이미 `verify` 로 등록돼 있다               |
| required 로 만들려면         | 저장소 설정에서 **사람이** 룰셋을 고쳐야 한다 — 에이전트 권한 밖          | 아무것도 안 해도 된다                      |
| required 가 된 뒤            | 이 노트의 함정(어떤 이유로든 SKIPPED → 영구 미충족)이 **하나 더** 생긴다  | 스텝은 SKIPPED 돼도 job 은 결론을 보고한다 |

→ 새 스텝을 이미 required 인 `verify` **안에** 넣고, 비용 절약은 이 노트가 정한 그대로 스텝-레벨 `if: steps.scope.outputs.docs_only != 'true'` 로만 달았다.

**실측 (PR #1432, run 33948547949 / 33948547948):** `verify`=SUCCESS **6m36s**(새 번들 스텝 포함) · `build`·`release`=SKIPPED · `lint`=FAILURE. required 두 이름이 **모두 결론을 보고**했고, 빨간 쪽은 존재하는 체크의 진짜 실패라 재실행·수정으로 풀 수 있었다 — 이 노트가 막으려던 "우회할 대상조차 없는" 상태가 아니다.

**규칙 한 줄 추가**: required check 목록을 늘리는 것은 사람만 할 수 있는 조작이다. 그러니 **새 게이트는 이미 required 인 job 의 스텝으로 들어간다.** 새 job 은 룰셋에 등록되기 전엔 조언일 뿐이고, 등록된 뒤엔 스킵 함정을 하나 더 만든다.

이 규율은 **같은 job 안에 독립적인 스텝-레벨 플래그를 몇 개를 두든** 그대로 버틴다. PR #1441 은 `lint` job(이미 required)에 두 번째 스텝-레벨 플래그(`format`, prettier 검사용)를 `eslint` 플래그와 나란히 추가했다 — 서로 다른 조건(`eslint=='true'`, `format=='true'`, 그리고 `Install dependencies` 는 `eslint=='true' || format=='true'`)으로 켜지는 세 스텝이 한 job 에 공존한다. **실측 (PR #1441, run 33954908236 / job 101276341413):** 이 PR 의 변경 파일(`lint.yml`, `CLAUDE.md`, `v3/.prettierrc`)은 `format` 조건에 안 걸려 `format=false` — `Format check` 스텝은 SKIPPED. 그런데도 `lint` job 은 **1m23s 완주해 FAILURE 를 보고**했다(원인은 스텝 4, 아래 [[ci-empty-steps-is-billing]] 참고 — prettier 와 무관). job 이 사라지거나 "expected" 로 멈추지 않았다: 이 노트가 막으려는 "우회할 대상조차 없는" 상태가 아니라, 평범히 재실행·수정 가능한 진짜 결론이다. → **여러 스텝-레벨 플래그가 같은 job 에서 서로 다른 조건으로 켜지고 꺼져도, job 자체가 결론을 보고하는 한 이 노트의 규율은 깨지지 않는다.**

## Evidence

- [.github/workflows/build.yml](../../../.github/workflows/build.yml) — `verify`, 스텝-레벨 docs-only 단락. 2026-09-05 부터 dist-mcp 번들 게이트도 **새 job 이 아니라 이 job 의 스텝**으로 들어가 있다 (PR #1432)
- [.github/workflows/lint.yml](../../../.github/workflows/lint.yml) — `lint`, 스텝-레벨 ESLint 게이팅
- PR #1388 (https://github.com/melocream/marblo/pull/1388) — `paths-ignore` 를 넣은 커밋 8552a6f5
- PR #1399 (https://github.com/melocream/marblo/pull/1399) — 이 판정과 수정
- PR #1432 (https://github.com/melocream/marblo/pull/1432) — 같은 규율의 반대 방향(게이트 추가)과 required 둘 다 보고된 실측
- PR #1394 (https://github.com/melocream/marblo/pull/1394) — `.github/` 단일 파일 PR 에 `lint` 체크가 없는 실물
- PR #1441 (https://github.com/melocream/marblo/pull/1441) — `lint` job 에 두 번째 독립 스텝-레벨 플래그(`format`)를 추가해도 job 이 결론을 보고함을 실측(run 33954908236 / job 101276341413)

## Backlinks

- [[ci-empty-steps-is-billing]] · [[verify-without-gui]]
- [[async-lifetime-must-match-test-boundary]] — 체크가 보고됐는데도 빨간 네 번째 경우
