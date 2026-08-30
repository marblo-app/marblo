---
title: 기각 원장 — 재시도하지 말 것
tags: [meta/ledger, status/living]
status: active
date: 2026-08-24
links: [[empty-query-first]], [[no-live-gui-verify]], [[telemetry-identity-axes]], [[post-spawn-telemetry-gap]], [[telemetry-data-model-map]]
---

# 기각 원장

> **새 아이디어가 나오면 가장 먼저 여기를 검색한다.** 여기 있으면 재시도하지 않는다. 이 노트는 라이브 원장이다.

아래 메타 교훈은 모든 행에 선적용한다.

1. 조회가 비면 대상이 아니라 조회를 먼저 의심하라 ([[empty-query-first]]).
2. 사장님이 앱을 쓰는 동안 창을 띄우는 검증은 제품 기능이 아니라 방해다 ([[no-live-gui-verify]]).
3. 식별자 축을 합치면 사람 축 게이트를 우회한 것이다.
4. 조용히 실패하는 귀속은 틀린 숫자보다 위험하다.
5. 위키가 원본을 복사하면 같은 수치가 세 군데서 갈린다.

## 사유코드 (해금 조건 = 재검정 자격)

| 코드 | 패턴 | 재시도 해금 조건 |
| --- | --- | --- |
| `C1` | 관측 편의 | 편의 없는 표본 + 진단 클린 |
| `C3` | 현실 비용에서 사망 | 실측 비용 포함 재검 |
| `C7` | 기준선에 열위 | 기준선을 이기는 증거 |
| `C8` | 구조적 부적합 | 시스템 구조 자체가 바뀜 |
| `M1` | 라이브 사용자 간섭 | 사장님이 안 쓰는 전용 검증기, 또는 `ask_orchestrator` 로 잡은 실화면 |
| `M2` | 식별자/프라이버시 축 위반 | 축 순도 가드가 통과하는 설계 + 원본 무변경 측정 |
| `M3` | 조용히 실패하는 귀속 | 유실이 관측되는 경로(자기보고 등)로 대체 |

## 원장

| ID | 무엇 | 왜 죽었나 | 원본 | 코드 |
| --- | --- | --- | --- | --- |
| DNR-01 | 클립보드 핸드오프 (clipboard handoff, 다운로드→앱 first_run 토큰) | 구현은 가능하나 유실률이 높고 **조용히 실패**한다. 다운로드와 설치 사이에 클립보드를 쓰면 끝. OS 권한/프라이버시. 덮어쓰므로 사용자 작업을 깨기도 한다. 월 다운로드 26건 규모에서 비용이 A′ 웹 귀속보다 크다. | [web-app-join-attribution-design §6-2(c)](../../../v3/docs/web-app-join-attribution-design-2026-08-09.md) · [install-attribution-utm-rate.md](../../../v3/docs/install-attribution-utm-rate.md) | `M3` |
| DNR-02 | WebContentsView 로 격리 브라우저 표면 | 2026-08-24 기각. 트리에 구현 없음. 라이브 Electron 창을 띄우는 검증·미리보기와 같은 간섭 축([[no-live-gui-verify]]). 전용 검증기 없이 재시도하지 않는다. | 당일 오케/사장님 기각 (코드 검색 0건이 근거) | `M1` |
| DNR-03 | `webviewTag` 재활성화 | 2026-08-24 기각. Electron `webview` 는 보안 표면이 넓고, 사장님 사용 중 창 수명과 겹친다. 태그 재활성화는 구조 변경이다. | 당일 오케/사장님 기각 · [[no-live-gui-verify]] | `C8` |
| DNR-04 | 소급 가명화 (과거 원시 uid 덮어쓰기) | 실측은 끝: 앞문(2026-08-10~)은 100% 가명, 과거는 2026-04-01~2026-08-10, 다리가 **5개**(티켓 전제 1개가 아님). `#4` 는 가명이 아니라 계정 UID 원본. 프로덕션 `UPDATE` 0건 — 집행은 승인 없이 못 한다. 측정 문서를 실행 허가로 읽지 마라. | [pseudonym-retro-measurement-2026-08-21.md](../../../v3/docs/pseudonym-retro-measurement-2026-08-21.md) | `M2` |
| DNR-05 | `ga_key` 만으로 `joined` | `analytics_identity.link_confidence` 는 어트리뷰션↔텔레메트리 **쌍** 축이다. 사람 축은 `analytics_user_install`. 술어는 `tel !== null && att !== null`. `ga_key` 있는 550행이 `unmapped` 인 것은 설계대로 정직하다. | [analyticsIdScheme.test.ts](../../../v3/functions/src/analyticsIdScheme.test.ts) | `M2` |
| DNR-06 | 다운로드 프록시 (우리 서버 경유 → GitHub 리다이렉트) | GitHub 직링크·서명·공증 토폴로지와 충돌. 토큰은 바이너리 밖에 남아 **앱이 어떻게 받느냐**가 미해결. 월 26건에 A′ 보다 비싸다. 재검토: 월 300건 또는 유료 광고 또는 A′ 커버리지 <30%. | [web-app-join-attribution-design §6-2(b)](../../../v3/docs/web-app-join-attribution-design-2026-08-09.md) | `C3` |
| DNR-07 | IP 지문 | 원시 식별자를 만들지 않는다. `ANALYTICS_ID_SALT` 를 바꾸지 않는다. IP 지문은 그 두 금지를 우회하는 세 번째 길이다. | [install-attribution-utm-rate.md](../../../v3/docs/install-attribution-utm-rate.md) · [installAttribution.ts](../../../v3/functions/src/installAttribution.ts) | `M2` |

판정 분포: no-go **7** / adopt **5** / observe 0 / undecidable 0. 기각이 채택보다 많은 것이 정상이다.

## Backlinks

- [[empty-query-first]] · [[no-live-gui-verify]] · [[telemetry-identity-axes]] · [[post-spawn-telemetry-gap]]
- [[telemetry-data-model-map]] — DNR-04·05 가 걸리는 표와 키의 지도
