# 유입국가·채널 퍼널 — 익명 GA4 어트리뷰션 구현 (2026-08-10)

> 티켓 `rPVkmOKGz9hVwbip2AQU` · 선행 설계 `v3/docs/web-app-join-attribution-design-2026-08-09.md`(#901).
> 짝 티켓 `woXp2c70`(앱 uid 제거)와 같은 축 — **이 문서의 어느 경로에도 Firebase uid 는 없다.**

---

## 0. 무엇이 달라졌나 (한 줄)

`유입국가·채널 → 방문 → 다운로드 → 설치 → 모델연결 → 10분 첫 multi-agent 성공` 을
**익명 GA4 수도아이디 하나로** 잇고, marblo.app/admin 에서 국가별·채널별로 렌더한다.

---

## 1. #901 과 달라진 판단 두 개 (그리고 왜)

#901 은 옵션 A′(웨이트리스트 email → Firebase uid 조인)를 권고하고 옵션 B(다운로드
어트리뷰션)는 "지금 하지 말 것"으로 판정했다. 이 티켓은 **사장님 지시로 그 판단을
뒤집었다**: "uid 떼고 GA4 수도아이디로 익명 조인, betaSegments 계정축 포기 확정."

그래서 두 가지가 바뀐다.

### 1-1. 조인키: `email→uid` → **GA4 client_id**

GA4 웹 스트림에서 BigQuery export 의 `user_pseudo_id` 값은 브라우저 `_ga` 쿠키의
client_id 와 **같은 값**이다. 앱이 그 값을 익명으로 넘겨받으면 계정 없이도
"이 방문자 = 이 설치"가 성립한다. #901 §3 표의 `user_pseudo_id` 행이 "✗ 영원히 불가"
였던 이유는 *앱이 그 값을 알 방법이 없다*는 전제였는데, 이 티켓이 그 전제를 깬다.

### 1-2. 핸드오프 방향: 다운로드 토큰 → **앱 first_run 이 웹에 통지**

#901 §6-2 가 옵션 B 를 비싸다고 본 이유는 셋 다 웹→앱 방향이었기 때문이다
(바이너리 임베드 = 서명·공증 불가, 프록시 = 앱이 못 받음, 클립보드 = 조용히 실패).

방향을 뒤집으면 그 비용이 사라진다:

```
[웹] 방문(utm/referrer 를 first-touch 로 브라우저에 1회 저장)
      ↓  GA4 는 같은 브라우저에 _ga 쿠키(client_id)를 이미 심어 뒀다
[웹] 다운로드 클릭 → GitHub 릴리스 직링크 (그대로. 프록시 없음)
      ↓
[앱] 최초 실행 → 언어·개인정보 동의 통과 →
     기본 브라우저로 https://marblo.app/<locale>/link?i=<익명 설치 ID> 열기
      ↓  ★그 브라우저는 보통 다운로드했던 그 브라우저다
[웹] /link 페이지가 자기 _ga 쿠키에서 client_id 를 읽고,
     저장해 둔 first-touch utm 과 함께 설치 ID 를 콜러블로 보고
      ↓
[BQ] marblo_telemetry.install_attribution  (installId ⋈ gaClientId)
```

바이너리를 건드리지 않고, 배포 토폴로지를 그대로 두고, **조용히 실패하지 않는다** —
링크백 성공/실패가 환영 페이지에 그대로 표시된다.

**한계는 정직하게**: 기본 브라우저 ≠ 다운로드 브라우저면 client_id 가 안 맞는다.
그 설치는 국가 `(unknown)` 으로 떨어지고, 채널은 링크백이 실어 온 utm 폴백으로만
잡힌다. 어드민 화면이 그 매칭률(`링크백 매칭 N/M`)을 항상 같이 보여 준다.

---

## 2. ★리전 블로커를 어떻게 넘겼나 (#901 §2)

문제는 그대로다: GA4 export = `asia-northeast3`, `marblo_telemetry` = `US`,
그리고 BigQuery 는 **한 쿼리에서** 리전이 다른 데이터셋을 조인하지 못한다.

#901 은 Scheduled Query + Dataset Copy(Data Transfer Service)로 넘자고 했다.
이 구현은 더 싼 길을 택했다:

> **조인을 SQL 이 아니라 애플리케이션 층에서 한다.**
> 콜러블이 두 리전에 각각 쿼리를 던지고(`Promise.allSettled`), 결과를 메모리에서
> 합친다(`v3/functions/src/countryFunnel.ts`).

|                  | Dataset Copy (#901 R1)                 | 메모리 조인 (이 구현)                         |
| ---------------- | -------------------------------------- | --------------------------------------------- |
| 사장님 콘솔 액션 | 필요 (API 활성화·스케줄쿼리·전송 설정) | **불필요**                                    |
| 신선도           | D+2                                    | D+1 (GA4 export 자체 지연만)                  |
| 비용             | 전송 + 중복 저장                       | 쿼리 2회                                      |
| 상한             | 사실상 없음                            | GA4 방문자 20만 행/조회 (`WEB_VISITOR_LIMIT`) |

현 볼륨(31일 방문자 554, 다운로드 39)에서 상한까지 **360배** 여유가 있다.
상한에 닿으면 응답 `notes` 가 "잘렸다 + 승급할 시점" 이라고 말하고, 그때
#901 §2-3 절차로 승급한다. 조용히 잘린 표를 만들지 않는 게 핵심이다.

---

## 3. 구현 지도

| 계층   | 파일                                               | 역할                                                                                        |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 웹     | `marblo-web/src/lib/attribution.ts`                | `_ga` 쿠키 파싱, first-touch 캡처(덮어쓰기 금지), 페이로드 조립. **순수 함수 + 단위테스트** |
| 웹     | `marblo-web/src/components/AttributionCapture.tsx` | 최초 랜딩에서 first-touch 1회 기록. 전송 없음                                               |
| 웹     | `marblo-web/src/app/[locale]/link/`                | 설치 환영 페이지 = 링크백 지점. `noindex`                                                   |
| 앱     | `v3/src/lib/attributionLink.ts`                    | 링크백 URL 조립(의존성 0, 테스트 진입점)                                                    |
| 앱     | `v3/src/services/installAttribution.ts`            | 설치당 1회 · 텔레메트리 게이트 · 브라우저 열기                                              |
| 앱     | `v3/src/App.tsx`                                   | `FirstRunFlow onComplete` 에서 1회 호출                                                     |
| 서버   | `v3/functions/src/installAttribution.ts`           | 입력 검증 + BQ 행/스키마 (순수)                                                             |
| 서버   | `v3/functions/src/countryFunnel.ts`                | 두 리전 결과의 메모리 조인 (순수)                                                           |
| 서버   | `v3/functions/src/index.ts`                        | `linkInstallAttribution`(미인증) · `getAdminCountryFunnel`(어드민)                          |
| 어드민 | `marblo-web/.../admin/AnalyticsPanel.tsx`          | "유입국가·채널 퍼널" 섹션                                                                   |

### 3-1. 새 BigQuery 테이블

`marblo-2253d.marblo_telemetry.install_attribution` (US) — 첫 호출 때 코드가
자동 생성한다(수동 마이그레이션 없음, `trainingCapture` 와 같은 패턴).
`linkedAt` 일 파티션 + `gaClientId` 클러스터.

컬럼: `installId, gaClientId, utmSource, utmMedium, utmCampaign, referrerHost, landingPath, platform, appVersion, linkedAt, linkSource`.

**여기 없는 것**: uid, 이메일, 이름, IP, 국가. (국가는 GA4 가 정본이라 조인 시점에
붙는다 — 클라가 보낸 국가는 위조 가능하다. IP 는 레이트리밋 키로만 쓰고 저장하지
않는다.) 단위 테스트가 "행 키 == 스키마" 를 강제해 회귀를 막는다.

### 3-2. 미인증 콜러블을 쓰는 이유와 방어

`linkInstallAttribution` 은 로그인을 요구하지 않는다. 요구하면 측정하려는 대상
(설치 완주)을 측정 행위가 파괴한다 — 다운로드 26명 표본에서 게이팅은 확실히
전환을 깎는다(#901 §4-5). 대신:

- IP 레이트리밋 (분당 10 / 10분당 40, `ATTRIBUTION_RULES_IP`)
- `installId` 는 UUID 형식만 통과. `"anon"` 폴백은 **거부**(모든 설치가 공유하는
  값이라 조인키가 못 된다)
- `gaClientId` 는 `<int>.<int>` 형식만 통과 — "없음"은 허용하되 "틀림"은 거부
- Firestore `installAttributions/{installId}` `create` 로 **설치당 1회** 고정
  (재방문 시 채널이 덮이지 않음 = first-touch 보존)
- BQ 적재 실패 시 Firestore 마커를 되돌린다 → 다음 시도에 재적재(조용한 영구 유실 방지)

### 3-3. 부수 효과 하나 — flush 사각의 부분 보정

#901 §1-2 가 지적한 한계: `app:first_run` 은 `auth.currentUser` 가 있어야 flush 되므로
**끝내 로그인하지 않은 설치는 BigQuery 에 존재하지 않는다.**

링크백은 로그인과 무관하게 웹에서 도달한다. 그래서 `getAdminCountryFunnel` 의 설치
모집단은 `app:first_run ∪ 링크백 도달` 로 잡는다 — 로그인 실패자의 설치가 일부 보인다.

---

## 4. 퍼널 정의 (칸마다 어디서 오는가)

| 칸        | 소스                                                                                     | 리전 | 비고                            |
| --------- | ---------------------------------------------------------------------------------------- | ---- | ------------------------------- |
| 방문      | GA4 distinct `user_pseudo_id`                                                            | 서울 | 조인 불필요                     |
| 다운로드  | GA4 `download` 이벤트 수                                                                 | 서울 | 조인 불필요                     |
| 설치      | `app:first_run` ∪ 링크백                                                                 | US   |                                 |
| 연결      | `MODEL_CONNECT_ANCHOR_EVENTS` (adminAnalytics 와 **같은 술어**)                          | US   | 하위호환 신호 포함              |
| 10분 성공 | `onboarding:first_multi_agent_success` + `metadata.withinTargetWindowFromConnect='true'` | US   | 앵커 = 모델 연결(#905/Tw6m14gR) |

규칙 두 개:

- **분모 0 → 전환율은 `null`("—")이지 0% 가 아니다.** "아무도 안 넘어갔다"와
  "셀 수 없다"를 화면에서 섞지 않는다.
- **설치 > 다운로드 버킷은 깎지 않고 `⚠` 로 표시한다.** 조회창 밖 다운로드이거나
  조인이 안 된 설치가 섞였다는 뜻이며, 조용히 클램프하면 채널 성과가 왜곡된다.

어드민 화면 상단에 "방문은 있는데 다운로드 0인 국가" 배너가 뜬다 — **해외 130명 /
다운로드 0** 같은 그림이 계산 없이 바로 보이는 자리다.

---

## 5. 검증

### 5-1. 자동 (이 PR)

| 대상                    | 명령                                                                | 결과       |
| ----------------------- | ------------------------------------------------------------------- | ---------- |
| 웹 순수 로직 14케이스   | `cd marblo-web && npm test`                                         | 73/73 pass |
| 웹 타입/린트            | `npm run typecheck` / `npx eslint`                                  | 0          |
| 서버 검증 로직 9케이스  | `cd v3/functions && npm run test:install-attribution`               | 9/9 pass   |
| 서버 조인 로직 10케이스 | `npm run test:country-funnel`                                       | 10/10 pass |
| 서버 타입               | `npx tsc --noEmit -p tsconfig.json`                                 | 0          |
| 앱 URL 계약 6케이스     | `cd v3 && npx vitest run tests/services/installAttribution.test.ts` | 6/6 pass   |
| 앱 타입                 | `cd v3 && npm run typecheck`                                        | 0          |

### 5-2. 수동 엔드투엔드 (배포 후, 오너 1건)

1. 시크릿 창에서 `https://marblo.app/?utm_source=test&utm_medium=verify&utm_campaign=join-poc` 접속 → `/ko/download` 로 이동해 다운로드 클릭
2. 앱 설치 후 최초 실행 → 언어·동의 통과 → **브라우저에 `/ko/link?i=...` 탭이 뜨는지**
3. 그 페이지가 "설치 완료" 를 보이고 실패 문구가 없는지
4. BigQuery (US):
   ```sql
   SELECT installId, gaClientId, utmSource, utmMedium, linkedAt
   FROM `marblo-2253d.marblo_telemetry.install_attribution`
   ORDER BY linkedAt DESC LIMIT 5;
   ```
   `gaClientId` 가 `<int>.<int>` 로 채워져 있어야 한다. NULL 이면 그 브라우저에
   GA4 쿠키가 없었다는 뜻(광고차단/시크릿) — 버그가 아니라 커버리지다.
5. D+1 에 어드민 → "유입국가·채널 퍼널" 에서 그 설치가 해당 국가 행에 잡히는지

---

## 6. ★사장님 콘솔 액션

**필수는 0건이다.** 이 구현은 GA4 설정을 바꾸지 않고, BigQuery 전송을 새로 만들지
않으며, 배포 즉시 동작한다. 아래는 **권장/확인** 항목이다.

| #   | 항목                                                                         | 왜                                                                                                        | 급한가                    |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | GA4 BQ 링크에서 **이벤트 제외 필터 없음** 확인 (관리 → 제품 링크 → BigQuery) | `download` 가 제외돼 있으면 다운로드 칸이 통째로 0 이 된다                                                | 확인만, 5분               |
| 2   | **export 지연 점검** — #901 §9 시점에 최신 테이블이 `20260807`(D+2)이었다    | 지연이 상시면 퍼널이 항상 하루 이상 늦는다                                                                | 중                        |
| 3   | 유튜브·스레드 링크에 **utm 컨벤션** 적용 (#901 §7-3)                         | `(direct)` 64% 는 조인 문제가 아니라 링크 위생 문제다. 이걸 안 고치면 채널 표의 절반이 (direct) 로 뭉친다 | **높음** — 코드로 못 고침 |
| 4   | 개인정보처리방침에 GA4 명시 + 수집항목에 utm/referrer 반영                   | #901 §8-1 이 미완료로 지목                                                                                | 중                        |
| 5   | 보고 ID(Reporting identity) = 블렌딩됨                                       | 이 구현엔 **불필요**(user_id 를 안 쓴다). 나중에 옵션 A 로 갈 때만                                        | 낮음                      |

★ GA4 export 리전 변경은 **필요 없다** — §2 가 그 이유다. 링크 재생성은 31일치
이력을 끊으므로 하지 말 것.

---

## 7. 프라이버시 (PIPA) 관점

- 이 경로에 흐르는 식별자는 **익명 수도아이디 둘**뿐이다: GA4 client_id, 앱 설치 UUID.
  둘 다 계정·사람에 직접 연결되지 않는다.
- 링크백은 앱의 **개인정보 동의 화면을 통과한 뒤에만** 열리고, 텔레메트리를
  옵트아웃하면 아예 열리지 않는다(`isTelemetryEnabled()` 게이트).
- 환영 페이지가 무엇을 기록하는지 화면에 적는다 — 숨기지 않는다.
- #901 §8-2 의 지적(“events 를 완전 비식별이라 부르는 서술 vs `accountUserId` 실태”)은
  이 티켓 범위 밖이지만, **이 퍼널은 `accountUserId` 를 쓰지 않는다** — 행 키는
  익명 설치 ID 다. `woXp2c70` 이 uid 주입 자체를 걷어내면 이 퍼널은 무변경으로 정합.

---

## 8. 다음(하지 않은 것)

- **Dataset Copy 승급** — 상한(§2)에 닿으면. 지금은 과투자.
- **옵션 A(GA4 user_id = uid)** — 사장님 결정으로 계정축을 포기했으므로 보류.
- **웹 로그인 계측(`trackLogin`/`trackSignUp` 배선)** — #901 §1-4 가 지적한 공백은
  여전히 열려 있다. 이 퍼널은 그것 없이 동작하지만, "웹 로그인" 이라는 사건이
  GA4 에 없다는 사실 자체는 남는다.
- **다운로드 대비 링크백 커버리지 목표치** — 실측 한 달 뒤에 정한다. 지금 숫자를
  지어내지 않는다.
