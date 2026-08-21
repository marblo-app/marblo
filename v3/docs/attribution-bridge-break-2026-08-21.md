# 어트리뷰션 브리지 — 무엇이 끊겼고 무엇을 고쳐야 하나 (2026-08-21)

티켓 `a4if1QJ6KRVLRs2EY1HP`. 출발점은 리텐션 분석 `9Ns5DYu2hTXlGimIUI8N` 이
실측으로 잡아낸 별건: **`install_attribution.installId` 와 텔레메트리 `userId`
의 교집합이 0** 인데 코드상 `installId: getClientId()` 로 같은 값이어야 한다.

## 0. 한 줄 결론

**조인키는 멀쩡하다. 끊긴 건 값이 아니라 모집단이다.**
`install_attribution` 은 **로그인하지 않은 첫 실행**만 적고, `events` /
`agent_heartbeats` 는 **로그인한 실행**만 적는다. 두 조건을 동시에 만족한 설치가
지금까지 하나도 없다 — 그래서 교집합이 0 이다. **그 결과 이 테이블에는 실사용자가
단 1명도 기록된 적이 없다.**

조인키를 고치는 작업은 **하면 안 된다.** 고칠 게 없고, 고쳐도 아무것도 안 붙는다.

## 1. 계층 판정 (BQ 읽기 전용 SELECT + 코드 실측)

### ① 값이 다른가 → 아니다 (기각)

변환이 개입할 지점이 경로 전체에 없다.

| 지점 | 파일 | 사실 |
| --- | --- | --- |
| 발신 | `v3/src/services/installAttribution.ts` | `installId: getClientId()` |
| 정의 | `v3/src/services/telemetryService.ts:326` | `localStorage["marblo.telemetry.clientId"]`, `crypto.randomUUID()` |
| 텔레메트리 | `telemetryService.ts:573` (`flushTelemetry`) | **같은** `getClientId()` 를 flush 시점에 찍는다 |
| URL | `v3/src/lib/attributionLink.ts` | `?i=<uuid>` 소문자 정규화 후 그대로 |
| 웹 | `marblo-web/.../link/LinkClient.tsx` | `params.get("i")` **원값 통과** |
| 서버 | `v3/functions/src/installAttribution.ts` | 같은 소문자 UUID 정규식으로 검증 |

- `v3/src` · `v3/electron` 전체에 `localStorage.clear()` / `clearStorageData`
  **0건** → 로그아웃이 clientId 를 갈아치우지 않는다.
- 로케일도 같은 localStorage(`lib/i18n.ts:52`) → "게이트와 ID 가 다른 저장소에
  산다" 가설도 기각.

→ **한 설치 안에서 두 값이 달라질 수 있는 코드 경로가 존재하지 않는다.**

### ② 시점이 다른가 → 그렇다. 그리고 구조적이다

- 어트리뷰션: **미인증** 콜러블(`functions/src/index.ts` `linkInstallAttribution`).
  로그인 전에 써진다.
- 텔레메트리: `flushTelemetry` / `flushHeartbeats` 둘 다 첫 줄이
  `if (!auth.currentUser) return`. 큐는 **인메모리** → 로그인 없이 종료하면
  영구 유실이다(`docs/first-run-cohort-investigation-2026-08-07.md` 가 이미 지적).
- ★그리고 더 나쁜 쪽: 어트리뷰션 발신은 `App.tsx` 의 **FirstRunFlow 완료 콜백
  안에만** 있는데, `isFirstRunFlowPending()` 은 로케일이 이미 저장된 **기존 설치
  전부에 대해 false** 다(`lib/firstRunFlow.ts`). 즉 **이미 설치돼 있던 사용자는
  앞으로 영원히 어트리뷰션 행을 만들 수 없다.**

→ 두 테이블이 겹칠 수 있는 구간 = (스토리지가 새것인 **그 세션**) ∩ (**그 세션
안에** 로그인) 뿐이다. 좁다.

### ③ 프로덕션에서 채워지는가 → 아니다. 550행 전부 개발 재실행이다

- 550행 / installId 550개 / **gaClientId 3개** / platform 전부 MacIntel /
  utmSource 전부 null.
- `linkedAt` 간격이 **10~30초** 버스트(08-17 새벽에만 122건). 사람 유입의 모양이
  아니다.
- 결정적: **appVersion 이 그날의 `package.json` HEAD 를 그대로 추종한다.** 08-15
  하루에 3.0.28 과 3.0.29 가 둘 다 찍혔는데 그날 저장소에서 그 범프가 있었다.
  릴리스를 받아 깐 사용자에게선 나올 수 없는 패턴 = **소스에서 띄운 개발 루프**.
- 반대편: 어트리뷰션이 붙은 뒤(3.0.23 / 2026-08-10 / `a18e6a2f`) 텔레메트리에
  **새로 등장한 설치는 딱 2개**(08-17, 08-18)이고 둘 다 `app:first_run` 을 쐈다 —
  진짜 신규 설치다. **그런데 둘 다 appVersion 3.0.22**, 어트리뷰션 코드가 들어가기
  **직전 버전**이다. 코드가 없어서 행을 못 남긴다.
- 나머지 텔레메트리 설치(3.0.23~3.0.34)는 전부 **업데이트된 기존 설치**라 ②의
  FirstRunFlow 게이트가 이미 닫혀 있다.

## 2. 그래서 진짜 구멍은 둘이다

- **(A) 어트리뷰션이 신규 설치의 1세션에만 열린다.** 그 세션에 로그인까지 해야
  텔레메트리와 이어진다.
- **(B) 텔레메트리가 로그인 뒤에만 존재한다.** `docs/beta-churn-root-cause-analysis-2026-07-21.md`
  의 최대 이탈 구간인 **앱 실행 → 첫 스폰(−73%)** 이 통째로 사각지대다. 마케팅
  비용을 얼마를 태워도 효과를 못 잰다.

(B) 가 본체다. (A) 는 (B) 를 고치면 대부분 따라온다.

## 3. 이번 변경 — 개발 재실행 표식 (구현 완료)

행 자체에 `buildChannel` 을 싣는다. `"dev"` = 개발/테스트 재실행,
`"prod"` = 배포된 앱의 첫 실행, `null` = 표식 이전(2026-08-21 이전) 행.

- 판정: `resolveBuildChannel()` (`v3/src/lib/attributionLink.ts`, 순수 함수)
  `import.meta.env.DEV` **또는** 렌더러 origin 이 `file:` 이 아님 → `dev`.
  패키징된 앱만 `file:` 에서 뜬다.
- 전달: 앱 `?c=` → `LinkClient` → 콜러블 `parseBuildChannel` → BQ 컬럼.
- 구버전 앱은 `c` 를 안 보낸다 → **거부하지 않고 null 로 접는다.** 표식 하나
  때문에 어트리뷰션 행을 잃는 게 더 손해다.
- BQ: `ensureAttributionTable` 이 **이미 있는 테이블에도 NULLABLE 컬럼만 덧붙인다.**
  코드에만 컬럼을 추가하고 BQ 를 두면 insert 가 `no such field` 로 통째로 죽는다.
  기존 컬럼의 삭제·타입변경·데이터 수정은 하지 않는다.

**한계는 그대로 적어 둔다:** 로컬에서 **패키징해 설치한 뒤** 돌린 재실행은
`prod` 로 잡힌다. 관측된 550행은 전부 소스 실행이라 이 판정으로 갈리지만, 완전한
분리는 아니다. 그리고 클라이언트가 보내는 값이라 **위조 가능**하다 — 집계 위생용
표식이지 보안 통제가 아니다.

### 소급 분류 (기존 550행)

`buildChannel IS NULL` 인 행은 표식 이전이다. 이 구간은 아래로 나눈다.

```sql
-- 유입 집계는 이 뷰만 쓴다. 표식 이전 구간은 gaClientId 반복도로 가른다.
SELECT
  installId,
  linkedAt,
  CASE
    WHEN buildChannel IS NOT NULL THEN buildChannel          -- 표식 이후
    WHEN gaClientId IS NULL THEN 'unknown'                   -- 판단 근거 없음
    WHEN COUNT(*) OVER (PARTITION BY gaClientId) > 5 THEN 'dev'  -- 한 브라우저 6회+
    ELSE 'unknown'
  END AS channel
FROM `marblo-2253d.marblo_telemetry.install_attribution`
```

★위 쿼리의 `buildChannel` 가지는 **배포 후**(첫 링크백이 `ensureAttributionTable`
의 컬럼 추가를 태운 뒤)에 돈다. 오늘 시점에서는 아래 구간만 실행 가능하고, 실제로
돌려 확인했다 — **550행 전부 `dev`, `prod`/`unknown` 0개**:

```sql
SELECT CASE
         WHEN gaClientId IS NULL THEN 'unknown'
         WHEN COUNT(*) OVER (PARTITION BY gaClientId) > 5 THEN 'dev'
         ELSE 'unknown' END AS channel,
       COUNT(*) n
FROM `marblo-2253d.marblo_telemetry.install_attribution`
GROUP BY channel          -- → dev 550
```

즉 **지금까지 실유입으로 셀 수 있는 행은 0개다.**

## 4. 브리지 복구안 — 제안 (구현하지 않았다)

### R1. 로그인 이전 익명 이벤트 경로 ★본체

미인증 콜러블 `logAnonymousEvents` 를 `linkInstallAttribution` 과 **같은 방어
규약**으로 연다.

- 신원: **익명 설치 UUID 하나.** 계정 식별자 없음 — 어트리뷰션 행과 같은 조인키라
  브리지가 자동으로 이어진다.
- 이벤트 **허용목록만**: `app:first_run`, `onboarding:*`, 모델 연결, 첫 스폰
  시도/차단. 나머지는 서버가 버린다. (허용목록 밖 이벤트는 지금처럼 로그인 후 flush)
- 방어: IP 레이트리밋(`ATTRIBUTION_RULES_IP` 재사용) + 설치당 이벤트 상한 +
  기존 `telemetryMetadata` 불변식(서버가 uid 를 붙이지 않음) 유지.
- ★**발신 게이트는 로그인이 아니라 동의다.** 지금 `app:first_run` 은 App mount 에서
  큐잉되고(동의 화면 **이전**) 로그인 후에야 나간다 — 결과적으로 동의가 전송을
  앞선다. 이 성질을 잃으면 안 된다. 로그인 게이트를 걷어내는 대신
  `readPendingConsent()`(`privacyConsentService.ts`, 로그인 전 동의 답을 담아 두는
  기존 저장소)를 게이트로 쓴다. **동의 전에는 큐에만 있고 절대 나가지 않는다.**

### R2. 큐를 디스크로 (R1 과 독립적으로 유효)

인메모리 큐를 localStorage 로 내려 앱을 닫아도 안 잃게 한다. R1 없이 R2 만 해도
"첫 실행 → 나중 세션에 로그인" 하는 사용자의 앞단이 살아난다.

### R3. 기존 설치의 어트리뷰션 — 권장하지 않는다

`isFirstRunFlowPending()` 게이트를 풀어 기존 설치도 링크백을 열게 할 수 있지만,
(a) 업데이트할 때마다 브라우저 창이 튀고 (b) 그들의 다운로드는 이미 오래전이라
GA4 조인 가치가 낮다. **기존 설치는 어트리뷰션 불가로 두고 신규 유입만 정확히
재는 쪽을 권한다.**

### R4. 텔레메트리 쪽 `buildChannel`

`events` 도 개발 재실행에 오염된다(관측된 43개 설치 상당수가 개발 프로필로 보인다).
같은 표식을 텔레메트리 행에도 싣는 게 맞다. **이번 티켓 범위 밖이라 하지 않았다.**

## 5. 처리방침 경계 — 확인 결과

R1 을 기준으로 `v3/src/components/legal/privacyContent.tsx` 를 대조했다.

**넘지 않는 것**
- 수집 항목이 늘지 않는다. 방침이 고지한 그대로 — "익명 설치 ID(계정 UID 아님),
  이벤트 종류, 토큰/지속시간 등 집계 지표".
- **새 식별자를 붙이지 않는다.** 2026-08-10 에 걷어낸 `accountUserId` 부착을
  되살리지 않는다. R1 의 상관키는 익명 설치 ID 하나뿐이다.
- 동의보다 앞서 전송하지 않는다(§4 R1 의 동의 게이트).
- 방침의 자체 규칙 — "수집 항목 자체가 늘어나면 그때는 반드시 버전을 올린다" —
  에 따르면 **정책 버전 범프는 불필요**하다. 항목이 늘지 않는다.

**★그러나 방침 본문 한 줄이 사실이 아니게 된다 (보고 대상, 임의로 고치지 않았다)**

> "제품 사용 분석에는 계정 UID가 **없습니다** — 앱도 보내지 않고, 수신 함수도
> **로그인 여부만 확인하고**(도용 방지) uid는 저장하지 않습니다"

R1 은 그 "로그인 여부 확인" 을 **일부 이벤트에 한해** IP 레이트리밋 + 허용목록 +
설치당 상한으로 **대체**한다. uid 를 안 보내고 안 저장한다는 앞 절은 그대로 참이지만,
뒤 절의 **도용 방지 수단 서술이 달라진다.** 문구 정정이 필요하다.

→ **방침 문구 수정은 이 티켓의 권한 밖이다.** R1 구현 전에 사장님/오케 판단이
먼저다. 계측을 위해 방침을 넘는 건 하지 않는다.

**판단이 필요한 것 2건**
1. 미인증 쓰기 엔드포인트를 하나 더 여는 것에 대한 보안 수용 여부(어트리뷰션이
   이미 같은 성격의 엔드포인트다 — 선례는 있다).
2. 위 문구 정정을 "표현 정정"(버전 유지)으로 처리할지, 정책 버전을 올릴지.

## 6. 검증

| 항목 | 명령 | 결과 |
| --- | --- | --- |
| 앱 URL 계약 + 채널 판정 | `npx vitest run tests/services/installAttribution.test.ts` | 11/11 pass |
| 서버 파싱/스키마 | `cd functions && npm run test:install-attribution` | 13/13 pass |
| 웹 페이로드 | `cd marblo-web && tsx --test src/lib/attribution.test.ts` | 16/16 pass |
| 타입 | `npm run typecheck` · `functions tsc --noEmit` | 통과 |
| 전체 회귀 | `npm test` | 6933 pass / 4 fail — **전부 이 변경과 무관한 기존 실패**(`model-autoselect`, `onboarding-demo-script`; 각각 electron 모델 사다리와 온보딩 컴포넌트를 읽는다) |

BigQuery 는 **읽기 전용 SELECT 만** 사용했다. 데이터 삭제·수정 없음.
