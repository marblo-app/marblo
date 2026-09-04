---
title: 릴리스 브랜치는 빌드 직전에 컷한다
tags: [domain/operations, topic/deploy, topic/electron, method/source-link]
status: verified
date: 2026-08-26
links: [[human-only-ops-backlog]], [[ci-empty-steps-is-billing]], [[verify-without-gui]]
---

# 릴리스 브랜치는 빌드 직전에 컷한다

> **한 줄 판정**: ★채택 — 릴리스 브랜치를 미리 컷하면 낡는다. 2026-08-26 저녁 실측 `origin/release/v3.0.36` 은 `origin/main` 보다 **123커밋** 뒤처져 있다. 오늘 연 로그인 전 익명 텔레메트리는 **새 앱에서만** 나간다. 컷은 서명·공증 빌드 직전에 `origin/main` 에서 한다.

## 무엇을 물었나

다음 버전 브랜치를 미리 만들어 두면 빌드가 빨라지는가, 아니면 독이 되는가.

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

컷 명령 (빌드 머신, `origin/main` 최신 확인 후):

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
- [v3/package.json](../../../v3/package.json) — version `3.0.35`, `build:electron`, `test` = vitest,
  `typecheck` = 루트/렌더러 + `electron/` + `electron/mcp-server/` 세 tsconfig
- [v3/docs/electron_updater_runbook.md](../../../v3/docs/electron_updater_runbook.md) — 피드 `melocream/marblo-releases`
- [v3/docs/signing_runbook.md](../../../v3/docs/signing_runbook.md) — 서명·공증 실행 순서
- [v3/docs/github-org-migration-plan.md](../../../v3/docs/github-org-migration-plan.md) — 빌드 worktree 브랜치 금지, CI 정지

## Backlinks

- [[human-only-ops-backlog]] · [[ci-empty-steps-is-billing]] · [[verify-without-gui]]
