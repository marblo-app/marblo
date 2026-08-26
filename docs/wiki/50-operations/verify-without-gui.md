---
title: 운영 검증은 창 없이, 러너는 패키지 스크립트로만
tags: [domain/operations, topic/verification, topic/electron, method/vitest, method/source-link]
status: verified
date: 2026-08-26
links: [[no-live-gui-verify]], [[empty-query-first]], [[ci-empty-steps-is-billing]], [[functions-deploy-env-and-bq-views]]
---

# 운영 검증은 창 없이, 러너는 패키지 스크립트로만

> **한 줄 판정**: ★채택 — GUI/Playwright/Electron 실행 검증은 금지다. `v3` 는 `vitest run`, `v3/functions` 는 **vitest 가 아니라 node:test** (`npm run test:<name>`), `marblo-web` 은 `npm test`. `tsx --test` 에 `[locale]` 경로를 직접 넘기면 glob 문자클래스로 파싱돼 **0개 실행**된다.

## 무엇을 물었나

배포·분석·웹 변경을 어떻게 증명하는가. 화면을 띄워도 되는가. functions 테스트를 vitest 로 돌려도 되는가.

## 무엇을 했나

금지 원문과 세 패키지의 test 스크립트를 대조했다. `[locale]` glob 함정은 `marblo-web` 의 경로 문자와 `tsx --test` 의 glob 규칙을 겹쳐 확인했다.

## 결과 (수치)

| 패키지 | 러너 | 명령 | 창 |
| --- | --- | --- | --- |
| `v3` | vitest | `cd v3 && npm test` (`vitest run`) | 없음 |
| `v3/functions` | **node:test** | `cd v3/functions && npm run test:<name>` | 없음 |
| `marblo-web` | tsx + node:test | `cd marblo-web && npm test` | 없음 |
| Playwright / `electron.launch` | 금지 | `npm run test:e2e:pw*` 돌리지 않음 | 띄움 → 금지 |

재현 단위는 **테스트 커맨드 1회**. `[locale]` 함정의 실패 모드는 실행 0건이다.

허용 명령 예:

```bash
cd v3
npm run typecheck
npm test
npx vitest run tests/unit/foo.test.ts

cd v3/functions
npm run test:install-unified
npm run test:github-app
npm run test:portone
npm run test:toss-shutdown
# package.json 의 "test:<name>" 이 tsc 후 node --test 를 묶는다.
# vitest 로 functions/src/*.test.ts 를 직접 돌리지 않는다.

cd marblo-web
npm test
npm run typecheck
```

`marblo-web` 의 `npm test` 는 이미 글롭을 따옴표로 감싼다:

```
tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"
```

아래는 **0개 실행**이 된다. 대괄호가 glob 문자클래스다:

```bash
# 하지 말 것
cd marblo-web
tsx --test src/app/[locale]/legal/refundPolicy.test.ts
```

실화면이 정말로 필요하면 이 세션에서 창을 띄우지 않고 `ask_orchestrator` 로만 잡는다. 기본값은 "지금은 아니다" ([[no-live-gui-verify]]). CI 빨간불은 먼저 [[ci-empty-steps-is-billing]] 분기를 본다.

오케 첫 인사 로케일 변경은 **메인 프로세스**다. 확인하려고 앱을 띄우지 않는다. 재시작은 사람 세션 ([[human-only-ops-backlog]]).

## 왜

사장님이 같은 Electron 앱을 쓰는 동안 검증 창은 제품이 아니라 방해다. functions 는 이미 `node --test` 픽스처로 닫혀 있어 vitest 설정이 없다. `tsx --test` 는 인자 경로를 glob 으로 펼치고, `[locale]` 의 `locale` 은 `l` `o` `c` `a` `e` 문자클래스라 파일이 안 맞는다. 0건을 "테스트가 없다"로 읽으면 [[empty-query-first]] 다.

## 한계 / 정직성

- `v3` 의 `test:e2e:pw` 스크립트는 트리에 남아 있다. 존재는 허가 신호가 아니다.
- emulator 가 필요한 functions 테스트(`test:reject` 등)는 로컬에서 무겁다. 그 이유로 Playwright 를 켜지 않는다.
- **수치가 갈리면 `package.json` 스크립트와 `AGENTS.md` 가 옳다.**

## 실제 영향

문서만. 코드 무변경. 이 폴더의 다른 런북 검증도 위 명령만 쓴다.

## Evidence

- [AGENTS.md](../../../AGENTS.md) — `★GUI 를 띄우는 검증 금지`
- [v3/package.json](../../../v3/package.json) — `"test": "vitest run"`, `test:e2e:pw*`
- [v3/functions/package.json](../../../v3/functions/package.json) — `test:*` → `tsc` + `node --test`
- [marblo-web/package.json](../../../marblo-web/package.json) — `"test": "tsx --test \"src/**/*.test.ts\" ..."`
- [marblo-web/src/app/[locale]/legal/refundPolicy.test.ts](../../../marblo-web/src/app/[locale]/legal/refundPolicy.test.ts) — 경로에 `[locale]`

## Backlinks

- [[no-live-gui-verify]] · [[empty-query-first]] · [[ci-empty-steps-is-billing]] · [[functions-deploy-env-and-bq-views]] · [[release-cut-at-build]] · [[github-app-install-after-deploy]] · [[payment-live-key-pg-env-bundle]] · [[human-only-ops-backlog]]
