---
title: 릴리스 브랜치는 빌드 직전에 컷한다
tags: [domain/operations, topic/deploy, topic/electron, method/source-link, kind/archive]
status: verified
date: 2026-08-26
links: [[human-only-ops-backlog]], [[ci-empty-steps-is-billing]], [[verify-without-gui]]
---

## 절차

1. 빌드 머신에서 `origin/main`을 최신으로 만든 뒤, 서명·공증 빌드 **직전**에 릴리스
   브랜치를 `origin/main`에서 다시 컷한다.
2. 버전을 올리고 `npm run typecheck`, `npm test`, `npm run build:electron`을 실행한다.
3. 사람만 할 수 있는 서명·공증·피드 공개는 [[human-only-ops-backlog]]에 남긴다. 에이전트가
   빌드 worktree 브랜치를 임의로 바꾸지 않는다.

```bash
git fetch origin main
git checkout -B release/v3.0.36 origin/main
cd v3
npm version patch
npm run typecheck
npm test
npm run build:electron
npx electron-builder --mac --publish never
```

## 배경과 판정

릴리스 브랜치를 미리 컷하면 낡는다. 2026-08-26 저녁 실측
`origin/release/v3.0.36`은 `origin/main`보다 **123커밋** 뒤처져 있었고, 로그인 전 익명
텔레메트리는 새 앱에만 있다. 그러므로 컷 시점은 서명·공증 빌드 직전이다.

2026-09-06에도 같은 교훈이 반복됐다. 사장님은 텔레그램으로 "버전 번호는 그냥 39로 가고"라고
결정했고, `3.0.36`·`3.0.37`·`3.0.38`은 결번 처리한다. 이 결정은 단순한 숫자 올림이
아니라, 버전 라벨과 실제 사용자 도달 범위가 갈라졌을 때 라벨을 재사용하지 않는다는 판정이다.

세 축을 분리해서 본다.

```text
코드에 있나       package.json
빌드가 나갔나     gh release list (Draft 는 안 셈)
사용자가 받나     latest-mac.yml 의 version:  ← 이게 진실
```

B-1 실측에서는 `v3/package.json`이 `3.0.38`이어도 아무것도 증명하지 않았다. published
latest는 `3.0.35`였고, `latest-mac.yml`도 `3.0.35`였다. 즉 사용자가 실제로 받는 것은
`3.0.35`였다. `v3.0.36`은 GitHub에 특정 스코프로 Draft 박제되어 있어 번호를 재사용하면
Draft 설명과 실제 배포물이 어긋난다. `3.0.37`은 release 없이 소비됐고, `3.0.38`은 컷 이후
156커밋이 더 쌓였다. 그 사이 웹탭, @멘션, 탭 순서처럼 사용자가 느끼는 변경도 들어갔으므로
`3.0.38` 라벨은 실제 범위를 더 이상 대변하지 못한다.

그러므로 `v3/package.json`의 `version`은 "나갔다"의 증거가 아니다. 이 저장소에서는
`package.json`·GitHub release·`latest-mac.yml`을 헷갈려 하루에 여러 번 잘못 판정한 적이
있다. 릴리스 컷을 볼 때는 `package.json`을 코드 라벨로만 읽고, published release와 updater
feed를 따로 확인한다.

## 무엇을 했나

오늘 `release/v3.0.36` 과 `origin/main` 의 ahead/behind 를 세고, 기존 릴리스 런북의 빌드 명령을 링크로 묶었다. 서명 시크릿 값은 열지 않았다.

## 결과 (수치)

| 지표                      | 값                                                                        |
| ------------------------- | ------------------------------------------------------------------------- |
| `v3/package.json` version | `3.0.35`                                                                  |
| 미리 컷된 브랜치          | `release/v3.0.36`                                                         |
| `origin/main` 대비 behind | **123커밋** (2026-08-26 저녁, tip `4a9e38ea` vs `origin/main` `4fe1f370`) |
| CI 로 릴리스가 나가는가   | 아니오. GitHub Actions 는 결제 차단 ([[ci-empty-steps-is-billing]])       |
| 실제 빌드 위치            | 로컬 맥 빌드 worktree (`macbuild-latest` / `macbuild-3023`)               |
| 로그인 전 익명 flush      | main 에 있음. **설치된 3.0.35 앱에는 없음** — 컷이 이유다                 |

재현 단위는 **릴리스 브랜치 1개**. 표본은 오늘 behind 실측 1회.

위 절차의 명령(빌드 머신, `origin/main` 최신 확인 후):

```bash
git fetch origin main
git checkout -B release/v3.0.36 origin/main
# 이미 낡은 브랜치가 있으면 -B 로 덮어 최신 main 에 맞춘다.
# 미리 만들어 둔 브랜치에 핫픽스만 쌓지 않는다.

cd v3
node -p "require('./package.json').version"
# 기대: 컷 직후 아직 3.0.35 이면, 빌드 세션에서 npm version patch 로 3.0.36.

npm version patch
npm run typecheck
# typecheck 은 루트/렌더러 · electron/ · electron/mcp-server/ 세 tsconfig 를 돈다.
# dist-mcp 도 앱에 실리므로 컷 전에 셋 다 도는지 확인한다.
npm test
npm run build:electron
npx electron-builder --mac --publish never
```

피드 발행은 소스 repo 가 아니라 **공개** `melocream/marblo-releases` 다. 소스 private 을 피드로 쓰면 익명 사용자 앱이 404 로 업데이트를 못 받는다. 절차 원문은 [v3/docs/electron_updater_runbook.md](../../../v3/docs/electron_updater_runbook.md) §1–§2, 서명·공증은 [v3/docs/signing_runbook.md](../../../v3/docs/signing_runbook.md).

빌드 worktree 의 브랜치를 에이전트가 임의로 바꾸지 않는다. org 이전 계획도 같은 금지를 적었다.

사람만 할 수 있는 컷·공증·피드 공개는 [[human-only-ops-backlog]] 에 남긴다.

## 왜

릴리스 브랜치는 "앞으로 나갈 코드"가 아니라 **지금 빌드하는 코드의 핀**이다. 미리 컷하면 main 이 그 위로 흘러 핀이 거짓이 된다. 오늘 123커밋 갭이 그 거짓의 크기이다. CI 가 죽어 있으므로 이 갭을 자동으로 메울 파이프라인도 없다. 익명 텔레메트리처럼 main 에만 있는 동작은 컷 전까지 사용자 앱에 안 실인다.

## 한계 / 정직성

- 123은 오늘 저녁 `git log origin/release/v3.0.36..origin/main` 줄 수다. main 이 더 가면 커진다. 오전에 적었던 111은 이 스냅샷이 이긴다.
- `macbuild-3023` 은 과거 `release/v3.0.35` 핀이다. 이 노트가 그 worktree 를 바꾸지 않는다.
- 서명 시크릿 이름(`MAC_CSC_LINK` 등)은 org 계획에 이미 있고, 값은 위키에 두지 않는다.
- **수치가 갈리면 원본 런북과 `git` 실측이 옳다.**

## 실제 영향

문서만. 코드 무변경. `release/v3.0.36` 재컷은 사람 할 일 ([[human-only-ops-backlog]]). 에이전트는 그 브랜치를 빌드 소스라고 가정하지 않는다.

## Evidence

- 2026-08-26 `git log origin/release/v3.0.36..origin/main` → 111
- 2026-09-06 B-1 실측 — `package.json` `3.0.38`, published latest `3.0.35`,
  `latest-mac.yml` `3.0.35`; 사장님 결정으로 `3.0.36`·`3.0.37`·`3.0.38` 결번, 다음 컷은
  `3.0.39`.
- [v3/package.json](../../../v3/package.json#json=/version,/scripts/build:electron,/scripts/test,/scripts/typecheck) — version은 코드 라벨이다. 2026-08-26 관측값은 `3.0.35`, 2026-09-06 범프값은 `3.0.39`다. `build:electron`, `test` = vitest,
  `typecheck` = 루트/렌더러 + `electron/` + `electron/mcp-server/` 세 tsconfig. 현재 파일에는
  자체 벤치 진단용 `bench:swe:diagnose` 스크립트도 추가되어 있다. `bench:swe:emit`은 벤치 리포트 생성
  경로이며, 이 노트가 정하는 릴리스 빌드 갈래(`typecheck`·`test`·`build:electron`)에는
  속하지 않는다.
- [v3/docs/electron_updater_runbook.md](../../../v3/docs/electron_updater_runbook.md) — 피드 `melocream/marblo-releases`
- [v3/docs/signing_runbook.md](../../../v3/docs/signing_runbook.md) — 서명·공증 실행 순서
- [v3/docs/github-org-migration-plan.md](../../../v3/docs/github-org-migration-plan.md) — 빌드 worktree 브랜치 금지, CI 정지

## Backlinks

- [[human-only-ops-backlog]] · [[ci-empty-steps-is-billing]] · [[verify-without-gui]]
- [[reach-user-not-merged]] — 사용자 도달 확인의 현재 지식 노트
