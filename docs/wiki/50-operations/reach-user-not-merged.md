---
title: 머지됐다 ≠ 사용자에게 닿았다
tags: [domain/operations, topic/deploy, topic/verification, topic/electron, kind/knowledge]
status: active
date: 2026-09-05
links: [[release-cut-at-build]], [[verify-without-gui]]
---

## 지금 무엇이 참인가

코드가 머지된 것은 사용자 도달의 첫 축일 뿐이다. 데스크톱 앱은 **코드 포함**, **공개
릴리스**, **업데이트 매니페스트** 셋을 각각 확인해야 한다. 웹은 Vercel의 자동 배포 경로를
타므로 앱 릴리스와 독립적으로 이미 사용자에게 닿을 수 있다.

| 대상      | 확인할 축                         | 명령 또는 근거                                     | 통과 의미                          |
| --------- | --------------------------------- | -------------------------------------------------- | ---------------------------------- |
| 앱 코드   | 변경이 대상 브랜치에 있는가       | `git cherry <release-branch> <commit>`             | 빌드 후보에 코드가 있다            |
| 앱 발행   | 공개 릴리스가 있는가              | `gh release list --repo melocream/marblo-releases` | 자산·피드가 공개됐다               |
| 앱 사용자 | 매니페스트 버전이 목표인가        | `latest-mac.yml`의 `version`                       | 설치 앱이 받을 버전을 가리킨다     |
| 웹 사용자 | Vercel Production 배포가 끝났는가 | Vercel 배포 상태                                   | 앱 릴리스와 무관하게 웹에 반영됐다 |

2026-09-05 실측에서 최신 공개 앱 피드는 `latest-mac.yml`의 `version: 3.0.35`였고,
`v3.0.36`은 Draft였다. 따라서 `v3.0.36` 코드는 존재해도 일반 사용자는 아직 받지 않는다.

## 적용 규칙

“머지됐다”, “빌드했다”, “릴리스를 만들었다”는 서로 대체할 수 없는 보고다. 앱 변경은 세
축을 모두 보고하고, 웹 변경은 Vercel Production을 따로 확인한다. 이 구분을 생략하면
오케와 작업자가 각각 한 번씩 겪은 것처럼 코드 존재를 사용자 도달로 오독한다.

## Evidence

- [v3/docs/electron_updater_runbook.md](../../../v3/docs/electron_updater_runbook.md) — 공개 피드와 `latest-mac.yml` 발행 절차
- [[release-cut-at-build]] — 빌드 직전 release branch를 컷하는 절차 (아카이브)
- [[verify-without-gui]] — GUI 없이 확인하는 검증 경로

## Backlinks

- [[release-cut-at-build]]
- [[verify-without-gui]]
