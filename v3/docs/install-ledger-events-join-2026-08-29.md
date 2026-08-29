# 설치 원장 ↔ 이벤트 조인 — 조사와 수리 (2026-08-29)

조사 티켓 `ZLbWocCSYAd6IVVuXmeT` · 수리 티켓 `VfWJtnAlBZxprLt8dYA0`

## ★한 줄

키 문제가 아니었다. **`install_attribution` 647행 안에 실사용자가 0명이다.**
646 = 브라우저 5대에서 나온 내부 개발 재실행, 1 = 2026-08-24 자체 검증용 합성
설치. 조인된 1건조차 그 내부 dev 1대다. 원장은 지금까지 실사용자 설치를 단 한
건도 담은 적이 없다.

## 1. 모수 분해 (조사 실측)

| buildChannel | 행 | 고유 installId | 고유 gaClientId(브라우저) | utmSource | gaKeyHmac | 기간 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| (null, #1071 태그 이전) | 551 | 551 | **3** | 0 | 0 | 08-10 ~ 08-23 |
| `dev` | 95 | 95 | **5** | 0 | 15 | 08-22 ~ 08-28 |
| `prod` | **1** | 1 | 0 | **1** | 0 | 08-24 11:23 |

- ★null 채널 551행의 브라우저 3개가 `dev` 행 브라우저 5개에 **완전히 포함**된다
  (교집합 3 = null 쪽 전부). 즉 551행도 dev 이고, `buildChannel` 태그(#1071,
  2026-08-21) 이전이라 표식만 없다.
- 유일한 `prod` 1행의 utm 은 `utm_campaign=utm_live_verify_q7kw_20260824` —
  티켓 `q7KwGBw28fOjerryL7ue` 의 자체 검증 트래픽이다
  (`docs/utm-live-verification-2026-08-24.md`).
- 발급기는 하나다: `installId` 와 `events.userId` 둘 다
  `telemetryService.getClientId()` 의 같은 localStorage 값(36자 원시 UUID)이고
  `userId` 는 `ANALYTICS_ID_FIELDS` 에 없어 가명화되지 않는다 — **키공간 분리
  함정은 없다.**

## 2. 조인이 1건인 원인 — 세 층

| 층 | 수치 | 내용 |
| --- | ---: | --- |
| ① 이벤트 축이 링크백보다 먼저 존재 | 42 중 **39** | 첫 이벤트가 링크백 배포(#906, 2026-08-10) **이전**. 원장에 행이 있을 수 없다 |
| ② 링크백 배포 이후 신규 이벤트 설치 | **3** (그중 조인 1) | 나머지 2는 원장 행 없음 — 원인 미확인 |
| ③ 원장 쪽 | 647 중 **1** | 조인된 1건은 `dev` 채널. `prod` 1행은 이벤트 0건 |

★①의 원인은 **영구적 코드 결함**이었다. `notifyInstallAttribution()` 의 호출
지점이 `v3/src/App.tsx` 의 `FirstRunFlow.onComplete` 하나뿐인데,
`v3/src/lib/firstRunFlow.ts` 의 `isFirstRunFlowPending()` 은 주석 그대로
*"False for every existing install — deliberately"* 다. → 2026-08-10 이전에 첫
실행을 마친 설치는 링크백을 **영원히** 못 보냈다.

## 3. 이번에 한 수리

### D — 대시보드가 647 을 유입으로 읽는 것을 멈춘다 (쿼리·뷰 레벨)

★**원본 행은 한 줄도 지우거나 고치지 않았다.** 바뀐 것은 **해석**뿐이다.

`v_install_unified` 의 외부성 사다리(`v3/functions/src/installUnified.ts`)에 칸
둘을 끼우고 값 하나를 늘렸다.

| 순서 | 사유 | 판정 | 조건 |
| ---: | --- | --- | --- |
| 1 | `dev_build_channel` | `internal` | 원장 또는 프로필의 채널이 `dev` |
| 2 | **`self_verification_utm`** (신규) | **`synthetic`** (신규 값) | `STARTS_WITH(LOWER(utmCampaign), 'utm_live_verify_')` |
| 3 | `no_ledger_row` | `unknown` | 원장 행이 없다 |
| 4 | **`pre_tag_dev_browser`** (신규) | `internal` | 채널 칸이 비었고 **그 브라우저가 dev 링크백을 남긴 적이 있다** |
| 5 | `no_build_channel` | `unknown` | 채널 칸이 비었고 브라우저도 모른다 |
| — | `non_dev_build_channel` | `external` | 위를 다 통과 |

결과: 551 + 95 = **internal 646**, **synthetic 1**, **external 0**, unknown 0.

- 4번 칸의 근거는 새 CTE `dev_browsers`(= `buildChannel='dev'` 행의 DISTINCT
  `gaClientId`)와의 `IN` 판정이고, 뷰는 그 결과를 불리언 `ledgerDevBrowser`
  컬럼으로 내보낸다 — 판정을 다음 사람이 검산할 수 있어야 하기 때문이다.
  ★원시 `gaClientId` 는 CTE 밖으로 나가지 않는다(뷰의 "PII 없음" 약속 유지).
- ★가명 `gaKeyHmac` 이 아니라 원시 `gaClientId` 를 쓴 이유: `gaKeyHmac` 은
  #1195 배포(2026-08-28) 이후 행에만 있어 647 중 15행뿐이다. 이 판정의 목적이
  **#1071 이전 행을 가르는 것**이라 가명 키로는 구조적으로 불가능하다.
- ★날짜로 자르지 않았다. `buildChannel IS NULL` + 브라우저 일치는 **관측**이고,
  "2026-08-21 이전" 은 정황이다.
- 흩어져 있던 `externality != 'internal'` 여섯 곳을 `sqlNotOurOwnTraffic()` 한
  벌로 모았다 — 한 곳만 빠뜨려도 검증 1행이 채널표에 "광고 유입 1건" 으로
  되살아난다.
- 화면(`marblo-web` 획득 탭)은 `설치 (외부·하한) 0 / 647`,
  `내부 646 제외 · 검증 1 제외` 를 같이 적고, 서버 note 가
  **"외부 0 이고 미상도 0 — 아직 실사용자 유입이 한 건도 없다"** 를 문장으로
  쓴다. ★미상이 남아 있으면 그 문장을 쓰지 않는다(그건 '없다' 가 아니라
  '모른다' 다).

### A — 링크백이 기존 설치에서도 1회 발화한다

`v3/src/services/installAttribution.ts` 에
`notifyInstallAttributionOnLaunch()` 를 추가하고 `App.tsx` 의 mount 효과에서
부른다. 판정은 순수 함수 `decideLaunchLinkback()`
(`v3/src/lib/attributionLink.ts`)이 내린다.

★**소급 백필이 아니다.** 과거 행을 우리가 만드는 것이 아니라, 발화 조건을
넓히면 그 설치들이 **다음 실행 때 스스로** 보낸다. 안 켜는 설치는 영원히 안
보낸다 — 그것도 사실 그대로다. 백필이면 "우리가 만든 숫자" 이고 이것은 "설치가
보고한 사실" 이다. 전자는 지표로 쓸 수 없다.

발화 조건(하나라도 어긋나면 안 연다):

| 순서 | 접는 사유 | 왜 |
| ---: | --- | --- |
| 1 | `detached_window` | 팝아웃은 첫 실행이 아니라 본창 세션에 얹혀 있다 |
| 2 | `telemetry_declined` | ★미동의 설치에는 어떤 경우에도 열지 않는다 |
| 3 | `already_sent` | 설치당 1회 마커(`marblo.attribution.linkOpened`) |
| 4 | `first_run_flow_pending` | 그때는 동의 화면 통과 뒤 `onComplete` 가 연다 |

★**마커는 여는 시도 직전에 쓰고, 던지면 되돌린다.**

- "전송 성공 후" 로 하지 않은 이유: 성공을 관측할 방법이 없다. `window.open` 은
  main 의 `setWindowOpenHandler` 가 `shell.openExternal` 로 넘기며 보통 `null`
  을 돌려주므로 반환값이 성공/실패 신호가 아니다. 관측 가능한 실패는 **던진
  예외 하나뿐**이다.
- 쓰기를 먼저 하는 이유: 스토리지가 망가진 설치에서 열기를 먼저 하면 마커를 못
  남긴 채 창만 열려 **매 실행마다 브라우저가 튄다.** 쓰기가 먼저면 그런 설치는
  아예 발화하지 않는다.
- 되돌리기는 그 안전성을 잃지 않고 재시도를 되찾는 유일한 순서다.

기대 효과: `installId ↔ events.userId` 조인 **1 → 최대 42**(이벤트 축 설치
전량). 상한이지 약속이 아니다 — 그 설치들이 실제로 켜져야 회수된다.

## 4. 일부러 하지 않은 것

- **C(`gaKeyHmac` 소급 백필)**: 조인 행은 631까지 오르지만 브라우저는 5대뿐이라
  분석 가치가 0이고, 지금 하면 **"631건 조인" 이라는 더 그럴듯한 거짓말**이
  된다. `analytics_identity` 에서 이미 확인됐다(550행 / 3브라우저).
- **B(첫 실행 이벤트 도달)**: 별건이다. #1249 배포 후에도 `app:first_run` 이
  0인 이유가 미확정이다(10초 flush 창 유실 / 익명 콜러블 최초 배포 시각).

## 5. 무엇이 배포되어야 사는가

| 조각 | 필요한 배포 |
| --- | --- |
| D — 뷰 재정의 | `cd v3/functions && npm run provision:install-unified -- --apply --replace-views` (BigQuery `CREATE OR REPLACE VIEW`. 원본 표는 안 건드린다) |
| D — 집계 콜러블 | **함수 배포** (`getAdminInstallUnified` 가 새 `installsSynthetic` 과 새 필터를 낸다) |
| D — 화면 | `marblo-web` 배포 (Vercel) |
| A — 링크백 발화 | ★**앱 배포.** 렌더러 변경이라 사용자가 새 빌드를 받아 실행해야 발화한다 |

★A 는 앱 배포 전에는 한 건도 늘지 않는다. D 는 함수·웹 배포만으로 오늘 즉시
효력이 있다.

## 6. 남은 미확인 (추측으로 덮지 않는다)

- #1249 배포 후에도 `app:first_run` 이 0인 이유.
- 이벤트는 있는데 원장 행이 없는 2건의 원인.
- 42개 설치 중 내부 계정 비율 — `events` 에 `userKey` 컬럼이 아직 없다.
- 다운로드 브라우저 ≠ 기본 브라우저 비율 — 실사용자 표본이 0이라 측정 불가.
