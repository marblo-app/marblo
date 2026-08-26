---
title: GitHub App 은 함수 배포 다음에 설치한다
tags: [domain/operations, topic/github, topic/deploy, method/source-link]
status: verified
date: 2026-08-26
links: [[functions-deploy-env-and-bq-views]], [[human-only-ops-backlog]], [[verify-without-gui]]
---

# GitHub App 은 함수 배포 다음에 설치한다

> **한 줄 판정**: ★채택 — 등록 직후 바로 설치하면 Setup URL 콜백이 **503** 이라 `installation_id` 를 Firestore 에 못 남긴다. 순서는 **등록 → 키 투입 → 함수 배포 → 설치**. 등록 화면 값은 복사하지 않고 원본만 연다.

## 무엇을 물었나

GitHub App 을 콘솔에서 만들자마자 테스트 저장소에 설치해도 되는가.

## 무엇을 했나

콜백 가드와 등록 런북을 읽었다. 키 값은 열지 않았다. 오늘 운영에서 다시 확인된 순서 함정을 규칙으로 고정한다.

## 결과 (수치)

| 지표 | 값 |
| --- | --- |
| 콜백 함수 | `githubAppSetupCallback` |
| 미설정 시 응답 | **HTTP 503** (`githubAppConfigured() === false`) |
| 콜백이 요구하는 키 | **3** — `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SETUP_STATE_SECRET` |
| 설치 URL 에 추가로 필요한 키 | `GITHUB_APP_SLUG` |
| 이 4키를 deploy 필수 목록에 넣었나 | **아니오** (미설정 = 기능 off, 배포 차단 아님) |
| 등록값 문서 | [v3/docs/github-app-registration-values-2026-08-21.md](../../../v3/docs/github-app-registration-values-2026-08-21.md) — **링크만** |

재현 단위는 **설치 시도 1회**. 503 분기는 코드 가드 1곳이다.

순서:

1. GitHub → Settings → Developer settings → GitHub Apps → New. 넣을 값은 위 등록 문서를 연다. 이 노트에 표를 복제하지 않는다.
2. 받은 값을 **메인 체크아웃** `v3/functions/.env.<projectId>` 에 키 이름으로 넣는다. 워크트리에서 배포하지 않는다 ([[functions-deploy-env-and-bq-views]]).
3. 함수 배포. 콜백 URL 이 살아 있고 `githubAppConfigured()` 가 참이어야 한다.

```bash
cd v3/functions
node scripts/check-deploy-env.mjs --project marblo-2253d
# GitHub App 키는 이 가드의 REQUIRED_KEYS 가 아니다. 존재 여부만 로컬에서 확인한다.
# 값을 cat / 로그하지 말 것.

cd v3
firebase deploy --only functions --project marblo-2253d

cd v3/functions
npm run test:github-app
```

4. **그다음** 오너가 테스트 저장소에 설치한다. GitHub 이 Setup URL 로 `installation_id` 를 넘기고, 서버가 `projects/{id}.githubInstallationId` 에 숫자 문자열을 쓴다.

설치를 3보다 앞에 두면 콜백 HTML 이 "서버 설정이 아직 완료되지 않았습니다" 를 보여주고, GitHub 쪽 설치는 남아 있어도 마블로는 id 를 못 받는다. 그 상태를 코드로 복구할 수 없다 — 사람만 재설치할 수 있다 ([[human-only-ops-backlog]]).

키 이름만 (값 금지):

| GitHub 화면 | env 이름 |
| --- | --- |
| App ID | `GITHUB_APP_ID` |
| public link slug | `GITHUB_APP_SLUG` |
| Generate a private key `.pem` | `GITHUB_APP_PRIVATE_KEY` |
| (우리가 생성) | `GITHUB_APP_SETUP_STATE_SECRET` |

private key 회전: 새 키 생성 → 시크릿 갱신 → **배포 확인 후** 구 키 폐기. 구 키를 먼저 지우면 발급이 끊긴다.

## 왜

Setup URL 은 이미 등록 화면에 박힌다. 그 URL 의 함수가 키 없이 떠 있으면 GitHub 은 설치를 성공으로 치고, 우리 서버는 503 으로 거절한다. 거절 화면은 내부 사유를 안 보여 주고, Firestore 쓰기는 일어나지 않는다. 순서만 지키면 이 창은 안 열린다.

## 한계 / 정직성

- 오늘 라이브 설치를 이 노트가 실행하지 않았다. 503 분기는 소스 가드 + 등록 문서의 미실행 런북이다.
- v2 권한(Contents/PR write) 표는 원본 §1.1 이 정본이다. 여기 복사하지 않는다.
- **수치가 갈리면 원본 등록 문서와 `githubAppConfigured` 가드가 옳다.**

## 실제 영향

문서만. 코드 무변경. 에이전트는 App 을 만들거나 설치하지 않는다. 사람은 등록 문서를 열고 위 4단을 따른다.

## Evidence

- [v3/docs/github-app-registration-values-2026-08-21.md](../../../v3/docs/github-app-registration-values-2026-08-21.md) — 등록값·키 이름·미설정 정책
- [v3/docs/github-app-installation-inheritance-design-2026-08-21.md](../../../v3/docs/github-app-installation-inheritance-design-2026-08-21.md) — 콜백 순서
- [v3/functions/src/index.ts](../../../v3/functions/src/index.ts) — `githubAppConfigured`, `githubAppSetupCallback` 503
- [v3/functions/src/githubApp.ts](../../../v3/functions/src/githubApp.ts) — 인가 판정 단위 테스트 대상

## Backlinks

- [[functions-deploy-env-and-bq-views]] · [[human-only-ops-backlog]] · [[verify-without-gui]]
