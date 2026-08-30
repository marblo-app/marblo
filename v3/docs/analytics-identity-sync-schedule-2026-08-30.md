# analytics_identity 를 계속 도는 경로로 — 진단·수리·실측 (2026-08-30)

티켓 `EFnVgBSdcjGVRRmNQ1dK`. 선행 `#1321`(`person-axis-ga4-join-verification-2026-08-29.md`)
이 발견한 정지 지점을 고쳤다.

## 0. 프레임

`#1321` 이 "고쳐도 현재 상한은 내부 1명" 이라고 판정했다 — 지금 외부 유입이
사실상 없어서다. **이 티켓은 지금 숫자를 늘리는 일이 아니라 앞으로 들어올
유입이 새는 것을 막는 일이다.**

## 1. 멈춘 원인 — 코드·설정 근거로 확정

`analytics_identity` 로 가는 쓰기 경로는 **`scripts/backfill-analytics-identity.ts`
하나**였고, `package.json` 의 `backfill:analytics-identity` npm script 로만
불렸다 — Cloud Functions 스케줄이 아니라 **사람이 수동으로 돌리는 CLI**였다.

`functions/src/index.ts` 의 `scheduledSyncGa4Bridge`(일 1회 15:00 KST)는
`ga4_first_touch` 만 갱신한다. 소스 전체(`grep -rn "analytics_identity"
src/index.ts`)를 훑어도 이 표로 가는 INSERT/MERGE/UPDATE 는 백필 스크립트가
생기기 전까지 **하나도 없었다.**

판정: ★**셋 중 "애초에 스케줄이 없었다"** 다. 한 번 스케줄이 있었는데 죽은 게
아니다 — 1회성 스크립트로 설계됐고, 그 뒤로 반복 실행 경로가 추가된 적이
없다.

실측(오케 재확인): `analytics_identity.linked_at` 최신이 2026-08-20, 그 뒤
9일 0행. 원장(`install_attribution`)은 그 사이 98행이 늘었다(2026-08-30 재확인
시점 기준 97행 — 오케가 잰 08-29 시점과 하루 차이).

## 2. 멱등 동기화로 재설계

새 파일 `functions/src/analyticsIdentitySync.ts` (순수 로직, `ga4Bridge.ts` 와
같은 규약 — BQ/Firebase 무의존, `node --test` 로 단위검증).

- 매 실행마다 원장(`install_attribution`) + 텔레메트리 최초등장
  (`agent_heartbeats`/`events`)을 **전량 다시 훑어** 후보 행을 재조립한다.
  가명(HMAC)은 결정적이라 같은 입력이면 같은 `install_key`/`ga_key`가 나온다.
- 기존 표와 비교해 **append/upgrade 만** 한다 — DELETE 없음:
  - `existing` 에 없는 `install_key` → INSERT
  - `existing` 에 `unmapped` 로 있는데 이번 후보가 `joined` 로 풀린
    `install_key` → UPDATE (★이게 "미래 유입이 나중에 붙는 경로" 다 — 원장이
    텔레메트리보다 늦게 도착해도 다음 실행에서 자동으로 따라잡는다)
  - 그 외(이미 `joined`, 또는 여전히 `unmapped`) → 손대지 않는다
- UPDATE 문 자체에도 `WHERE link_confidence = 'unmapped'` 를 다시 건다 —
  Node 쪽 계획이 걸러도 DB 쪽에서 한 번 더, 두 겹 멱등.

단위테스트(`analyticsIdentitySync.test.ts`, 18개, `npm run
test:analytics-identity-sync`)가 "같은 candidates + 그 결과가 반영된
existing 으로 다시 계획을 세우면 insert/upgrade 가 둘 다 빈다" 를 직접
검증한다.

### 실측 — 라이브 BQ 에서 두 번 --apply

`john.kim` ADC 로 프로덕션 BQ 를 직접 조회·적재했다(로그·SQL 에 솔트·원시 id
없음, 가명 접두·건수만 출력).

| 실행                   | inserted | upgraded |
| ---------------------- | -------: | -------: |
| 1회차 --apply          |       97 |        1 |
| 2회차 --apply (재실행) |    **0** |    **0** |

1회차의 `upgraded=1` 은 `#1321` §3.1 이 짚었던 바로 그 설치다 — 08-29
12:19Z 에 원장 행이 생겼지만 그때 `analytics_identity` 는 몰랐던 설치.
이번 동기화가 그 설치를 `unmapped → joined` 로 승격시켰다.

결과: `analytics_identity` **593 → 690행**, `ga_key` 보유 647행,
`linked_at` 최신 **2026-08-29 12:19:37Z**(9일 정지가 풀렸다).

## 3. 스케줄 — 어디에·왜

`functions/src/index.ts` 에 `scheduledSyncGa4Bridge` 와 같은 패턴으로
`scheduledSyncAnalyticsIdentity` 를 추가했다.

- **어디**: Cloud Functions v1 `functions.pubsub.schedule(...)` — 이 프로젝트가
  이미 쓰고 있는 유일한 스케줄 메커니즘이고(`scheduledSyncGa4Bridge`,
  `scheduledBuildAnalyticsProfiles`, `scheduledLoadAnalyticsPurchase` 등),
  새 인프라를 도입할 이유가 없다.
- **언제**: 일 1회 15:40 KST — `scheduledSyncGa4Bridge`(15:00 KST)의 40분
  뒤. 이 동기화는 `ga4_first_touch` 를 읽지 않으므로 GA4 브리지에 순서
  의존은 없다 — 40분은 그냥 같은 시간대에 몰아 운영 부담을 줄이는 관례다.
- 실패해도 함수는 던지지 않는다(다음 실행이 재시도) — GA4 브리지와 같은
  실패 격리 규약.
- 수동 트리거 `syncAnalyticsIdentity`(어드민 전용 callable)도 같이 추가했다
  — 최초 캐치업·스케줄 실패 복구용, `syncGa4Bridge` 와 같은 역할.

### ★배포 상태 — 코드는 준비됐지만 아직 안 걸렸다

`firebase deploy --only functions:scheduledSyncAnalyticsIdentity,...` 를
이 워크트리에서 시도했으나 `scripts/check-deploy-env.mjs` 가 구조적으로
막는다:

```
[functions-env-gate] Missing .../functions/.env.marblo-2253d. This file is
gitignored and is not present in isolated Marblo worktrees. Deploy functions
from the main checkout that has functions/.env.marblo-2253d, not from
~/.marblo/worktrees/<project>/<task>.
```

확인 결과 이 워크트리만의 문제가 아니다 — 같은 부모(`GFB8JnJrrX6AgahqmGB3`)
아래 다른 워크트리 전부(전수 확인) 이 파일이 없다. main 체크아웃
(`/Users/dongwonkim/Documents/programming/marblo`)에는 있지만, 지금 무관한
미커밋 작업이 다수 얹혀 있고(스크린샷 zip·문서 등) 브랜치도 이 티켓보다
3커밋 뒤라 거기서 직접 배포하지 않았다 — 다른 진행중 작업과 섞일 위험.

**결론**: 데이터 캐치업(§2)은 배포 없이 ADC 직접 조회로 이미 끝났다.
**스케줄 자체를 켜는 것(Cloud Functions 배포)은 이 티켓 범위에서 코드·테스트
까지 끝냈고, 실제 배포는 main 체크아웃 접근 권한이 있는 다음 단계
(devops/merge 역할 또는 PR 머지 후 배포 파이프라인)가 맡아야 한다.**
오케스트레이터에 질문을 남겼다(`EFnVgBSdcjGVRRmNQ1dK#qmtf74fu2vzlp`).

## 4. `ga_key` NULL 43행의 원인

캐치업 뒤에도 NULL 은 여전히 43행이다(오케가 잰 08-29 시점의 43행과 같은
수 — 캐치업이 넣은 97행 중 `ga_key` NULL 인 신규 설치가 정확히 43행 있었고,
1행은 그 자리에서 곧바로 `unmapped→joined` 로 승격됐기 때문에 순 NULL 수는
그대로다). 실측(`analytics_identity` 라이브, `ga_key IS NULL` 로 그룹화):

| `linked_at`            | `id_scheme` |  개수 |
| ---------------------- | ----------- | ----: |
| NULL(원장 행 없음)     | uuid36      |    40 |
| NULL(원장 행 없음)     | unknown     |     1 |
| NULL(원장 행 없음)     | uid28       |     1 |
| **있음(원장 행 있음)** | uuid36      | **1** |

**42행은 `linked_at IS NULL`** — `install_attribution`(원장)에 그 설치의
행이 **하나도 없다.** 조인 키 형식은 멀쩡하다(전부 `uuid36`/`uid28`/`unknown`
스킴, 앞선 조사에서 형식 OK 확인). 조인이 실패한 게 아니라 **조인할 상대가
없다.**

**나머지 1행은 `linked_at IS NOT NULL`** — 원장 행은 있는데 그 행의
`gaClientId` 가 비어 있다. 이건 앞의 42행과 원인이 다르다.

`buildAnalyticsIdentityCandidates()` 가 이 둘을 코드로도 못박기 위해 카운터를
나눴다(`gaKeyNullNoLedgerRow` vs `gaKeyNullLedgerNoGaClientId`) — 실측이
그대로 42:1 로 나온다. 둘 다 "원천에 값이 없다"이지만 고치는 법이 다르다:

- 원장 행 자체가 없음(42행) — 이 설치들은 `install_attribution` 을 쓰기
  전에(또는 그 경로를 타지 않고) 텔레메트리만 남긴 설치다. **손댈 데가
  없다** — 원장에 없는 걸 만들어 낼 수 없고, 만들면 그게 오히려 데이터
  왜곡이다.
- 원장 행은 있는데 `gaClientId` 없음(1행) — 이건 `gaClientId` 캡처 경로
  (웹뷰/딥링크 파라미터 전달)를 봐야 할 문제이지, 이 티켓(동기화 스케줄)
  범위가 아니다.

## 5. 관측 지점

- `analytics_identity_sync_log` BQ 표(새로 생성, `ga4_bridge_sync_log` 와
  같은 규약) — 매 실행(0건 포함)마다 `syncedAt`·읽은 행 수·inserted·
  upgraded·null 사유별 건수·`ok`·`errorMessage` 한 줄이 남는다. 이번에
  9일을 몰랐던 이유가 정확히 이게 없어서였다.
- 어드민 전용 callable `getAnalyticsIdentitySyncStatus` — 표 통계
  (`rowCount`/`gaKeyPresent`/`unmappedCount`/`maxLinkedAt`) + 마지막 실행
  로그 한 줄을 한 번에 반환한다. BQ 콘솔을 직접 열지 않아도 다음에 또
  멈추면 바로 안다.

## 6. 검증

- `cd v3/functions && npx tsc --noEmit` — clean.
- `npm run test:analytics-identity-sync` — 18/18 통과(멱등 계획 포함).
- `npm run test:analytics-profiles` — 68/68 통과(★`analytics_identity` 를
  `ANONYMOUS_AXIS_TABLES` 에 새로 등재하고 `assertAxisPurity` 가 실제
  스키마를 통과시키는 것 + 계정축 컬럼을 얹으면 던지는 것을 추가 검증).
- `npm run test:ga4-bridge` — 61/61(회귀 없음).
- 라이브 BQ 실측(§2) — 캐치업 97+1행 적용, 재실행 0/0 멱등 확인.

## 7. 축·프라이버시 규율 — 지킨 것

- `assertAxisPurity()` 를 우회하지 않았다 — 오히려 `analytics_identity` 를
  처음으로 `ANONYMOUS_AXIS_TABLES` 에 등재해 가드가 실제로 걸리게 했다(전에는
  `events` 가 한동안 그랬던 것처럼 이 표도 등재가 안 돼 있어 가드를 부를
  수조차 없었다).
- GA4 로 아무것도 보내지 않았다(`#1319` 발신 보류 유지) — 이 동기화는 인바운드
  (원장→identity)뿐이다.
- 솔트를 SQL·로그로 내보내지 않았다 — HMAC 은 전부 Node 안에서, 쿼리에는
  가명만.
- 사람↔설치(`marblo_identity.analytics_user_install`)와 혼동하지 않았다 —
  이 표는 GA4↔설치(익명 축) 단일 자리다.
