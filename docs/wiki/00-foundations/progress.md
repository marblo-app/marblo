---
title: 보드는 정본이고 여기는 큰 축만 적는다
tags: [domain/foundations, topic/wiki, method/source-link]
status: active
date: 2026-08-26
links: [[overview]], [[architecture]], [[glossary]], [[do-not-retry]], [[no-live-gui-verify]]
---

# 진행상황

> **한 줄 판정**: ★스냅샷 — 2026-08-26. 런타임·PortOne 결제·식별자 가드·위키 방법론은 돌고, control plane 4기둥의 끝(머지/배포·decision log)과 라이브 GUI 검증은 막혀 있다. **티켓 목록은 보드가 정본**이다.

## 무엇을 물었나

지금 무엇이 돌고, 무엇이 대기이고, 무엇이 막혔는가. 보드를 복사하지 않고 큰 축만.

## 무엇을 했나

포지셔닝 갭, 결제 진입, 식별자 가드, 위키 1판, 기각 원장을 축으로 묶었다. 개별 티켓 ID·담당·상태는 적지 않았다.

## 결과 (수치)

| 축 | 상태 | 막힌 이유 (있을 때만) |
| --- | --- | --- |
| 데스크톱 런타임 | 돌고 있음 | 보드·오케·에이전트·워크트리. [[architecture]] |
| 결제 신규 | 돌고 있음 | 체크아웃 기본 **PortOne**. 토스페이먼츠 진입 닫힘 |
| 식별자 | 돌고 있음 | `events.userId` ≠ `cost_logs.userId`. 조인 가드 |
| 위키 방법론·제약 | 돌고 있음 | 조회·단위·결정문·GUI 금지 |
| 위키 입구 | 이번 스냅샷에서 채움 | 오버뷰·아키텍처·글로서리·이 장 |
| 위키 주력·운영 실물 | 대기 | `10-offerings` · `50-operations` 는 슬롯만. 다른 노트가 채우는 중 |
| control plane 끝단 | 대기 | 머지/배포는 앱 밖. 사람 결정은 채팅 휘발. inline diff+CI 약함 |
| Toss PG 잔여 | 대기 | 진입은 닫음. 원장 읽기·3단계 삭제는 선행조건 문서. **해지 완료는 확인 못 했다** |
| 라이브 GUI 검증 | 막힘 | 사장님 세션 간섭. [[no-live-gui-verify]] · DNR-02/03 |
| userId 가로지르기 | 막힘 | 사람 축 우회. [[do-not-retry]] M2 |
| 클립보드 핸드오프·IP 지문·다운로드 프록시 | 막힘 | [[do-not-retry]] DNR-01/06/07 |

표본: 원본 4종 + 위키 원장, 날짜 2026-08-26. 재현 단위는 축이지 칸반 카드가 아니다. 카드 수·WIP 는 **여기 없음**.

## 왜

보드를 복사하면 위키가 두 번째 칸반이 되고 즉시 낡는다. 에이전트가 필요한 것은 "지금 이 축이 왜 안 움직이나"다. 막힌 이유는 기각 코드(M1/M2/M3)나 제품 갭 한 줄이면 충분하다.

## 한계 / 정직성

- 스냅샷이다. 같은 날 보드가 바뀌면 보드가 이긴다.
- "대기"는 안 해서가 아니라 이 노트가 티켓을 복제하지 않기 때문이다. 담당·ETA 는 적지 않는다.
- **갈리면 보드와 링크된 원본이 옳다.**

## 실제 영향

무변경. 진행을 물으면 이 표를 읽고, 실행 순서는 보드에서 가져온다.

## Evidence

- [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) — §4 갭
- [marblo-web/src/lib/paymentProvider.ts](../../../marblo-web/src/lib/paymentProvider.ts)
- [docs/payment/toss-teardown-prerequisites.md](../../payment/toss-teardown-prerequisites.md)
- [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts)
- [docs/wiki/_meta/do-not-retry.md](../_meta/do-not-retry.md)
- [AGENTS.md](../../../AGENTS.md) — GUI 검증 금지
- [docs/wiki/README.md](../README.md) — 슬롯 상태

## Backlinks

- [[overview]] · [[architecture]] · [[glossary]] · [[no-live-gui-verify]]
