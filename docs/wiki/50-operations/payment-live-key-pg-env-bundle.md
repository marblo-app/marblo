---
title: 포트원 라이브는 실거래 키와 PORTONE_PG_ENV 를 한 묶음으로 바꾼다
tags: [domain/operations, topic/payments, topic/deploy, method/source-link]
status: verified
date: 2026-08-31
links: [[functions-deploy-env-and-bq-views]], [[human-only-ops-backlog]], [[verify-without-gui]]
---

# 포트원 라이브는 실거래 키와 PORTONE_PG_ENV 를 한 묶음으로 바꾼다

> **한 줄 판정**: ★채택 — 포트원 라이브는 실거래 키와 `PORTONE_PG_ENV` 를 한 배포에서 같이 바꾼다. 2026-08-26 코드 구성은 국내 **PortOne**(이니시스 카드 단건·정기 + 카카오페이 단건·정기 배선 완료) + 해외 **Paddle**(en/ja, USD/JPY 라우팅 완료). 토스페이먼츠 PG 계약은 취소, 신규 진입은 이중 게이트.

## 무엇을 물었나

포트원 승인 후 라이브 키를 먼저 넣고, 라벨 env 는 나중에 바꿔도 되는가.

## 무엇을 했나

서버가 `PORTONE_PG_ENV` 를 파생 enum 으로 저장하는 경로와 토스 이중 게이트를 읽었다. 키 값은 열지 않았다.

## 결과 (수치)

| 지표 | 값 |
| --- | --- |
| pg env 허용값 | `test` \| `live` 만. 그 외는 `null` |
| 폴백 | `PORTONE_PG_ENV` → `PAYMENT_PG_ENV` |
| 라이브로 같이 바꿔야 하는 키 묶음 | 아래 표 **최소 7이름** |
| 토스 신규 진입 기본 | 차단. 서버는 `TOSS_ENTRY_ENABLED==="true"` 일 때만 연다 |
| 클라 게이트 | `TOSS_ENTRY_DISABLED = true` (`billingService.ts`) |
| 토스 PG 계약 | 취소. 코드 경로만 이중 게이트로 닫힘 |
| 국내 기본 PG | PortOne (`resolveCheckoutProvider`, KRW) |
| 해외 기본 PG | Paddle (locale 통화가 KRW 가 아니면) |
| 카카오페이 배선 | 단건·정기 채널키 맵 **코드 완료** |
| Paddle 배선 | 해외 체크아웃 라우팅 **코드 완료**. 셀러 신청은 사람 |

재현 단위는 **env 교체 1회 + 함수 배포 1회**.

라이브 전환 때 **한 파일** `v3/functions/.env.<projectId>` 에서 같이 바꾼다. 값 금지, 이름만:

| 키 이름 | 역할 |
| --- | --- |
| `PORTONE_PG_ENV` | 분석·화면에 찍히는 test/live 라벨 |
| `PAYMENT_PG_ENV` | 위 값이 없을 때 폴백. 같이 `live` 로 |
| `PORTONE_API_SECRET` | V2 REST |
| `PORTONE_STORE_ID` | 스토어 |
| `PORTONE_INICIS_ONETIME_CHANNEL_KEY` | 이니시스 카드 단건 |
| `PORTONE_INICIS_BILLING_CHANNEL_KEY` | 이니시스 카드 정기 |
| `PORTONE_KAKAOPAY_ONETIME_CHANNEL_KEY` | 카카오페이 단건 |
| `PORTONE_KAKAOPAY_BILLING_CHANNEL_KEY` | 카카오페이 정기 |

카카오페이 **배선**은 끝났다. 라이브 채널키 투입은 포트원 승인 뒤 위 묶음에 넣는다. Paddle 셀러 신청은 별도 사람 할 일이다 ([[human-only-ops-backlog]]). 값 금지.

```bash
# 값은 출력하지 않는다. 키 존재만 확인.
cd v3/functions
node scripts/check-deploy-env.mjs --project marblo-2253d
cd v3
firebase deploy --only functions --project marblo-2253d

cd v3/functions
npm run test:portone
npm run test:portone-easypay
npm run test:toss-shutdown
```

토스 이중 게이트를 되돌리는 스위치는 서버 `TOSS_ENTRY_ENABLED=true` **그리고** 클라 `TOSS_ENTRY_DISABLED` 를 false 로. 하나만 열면 화면과 서버가 갈린다. 기본값은 둘 다 닫힘.

웹 체크아웃 클라 선택 키 이름: `NEXT_PUBLIC_PAYMENT_PROVIDER`. 기본 분기는 locale 통화 — KRW 는 portone, 그 외는 paddle. URL `?provider=toss` 로는 토스가 안 열린다. 값 금지.

## 왜

`PORTONE_PG_ENV` 는 크레덴셜이 아니라 **라벨**이다. 실거래 키로 돈이 움직이는데 라벨이 `test` 이면 원장·어드민이 테스트로 보이고, 라벨만 `live` 인데 키가 테스트면 화면은 실거래라고 말하고 결제는 테스트 MID 로 간다. 둘 다 운영 사고다.

## 한계 / 정직성

- 이 노트는 포트원 승인·Paddle 신청을 실행하지 않는다. 묶음 규칙과 지금 배선 상태만 고정한다.
- Paddle 가격 ID 키 이름(`PADDLE_PRICE_ID_*`, `NEXT_PUBLIC_PADDLE_*`)은 이 포트원 묶음과 따로 간다. 값을 위키에 적지 않는다.
- `TOSS_SECRET_KEY` 는 신규 진입이 닫혀도 과거 원장·웹훅 재조회에 남긴다. 지우면 조용히 깨진다.
- **수치가 갈리면 원본 체크리스트와 `parsePaymentPgEnv` 가 옳다.**

## 실제 영향

문서만. 코드 무변경. 포트원 승인 후 사람은 위 이름을 한 배포에서 같이 바꾼다.

## Evidence

- [v3/functions/src/index.ts](../../../v3/functions/src/index.ts) — `parsePaymentPgEnv`, `PORTONE_PG_ENV`, 채널키 맵, `assertTossEntryEnabled`
- [v3/functions/src/billing.ts](../../../v3/functions/src/billing.ts) — `isTossEntryEnabled`, 토스 진입 차단 주석
- [v3/src/services/billingService.ts](../../../v3/src/services/billingService.ts) — 클라 `TOSS_ENTRY_DISABLED`
- [marblo-web/src/lib/paymentProvider.ts](../../../marblo-web/src/lib/paymentProvider.ts) — KRW=portone, 비 KRW=paddle
- [docs/payment/portone-v2-phase1-checklist.md](../../../docs/payment/portone-v2-phase1-checklist.md) — 키 이름 (테스트 MID 이름 포함, 값 없음)

## Backlinks

- [[functions-deploy-env-and-bq-views]] · [[human-only-ops-backlog]] · [[verify-without-gui]] · [[paddle-support-check-before-pg-screening]] · [[jpy-anchors-to-competitors-not-krw]] · [[payment-routes-live-gated-absent]]
