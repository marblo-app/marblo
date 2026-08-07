# first_run=2 근인 + 신청유저 코호트 조사

- **티켓**: `7u7GMJ0xZVRHLkyiMxMo`
- **작성일**: 2026-08-07
- **데이터 스냅샷**: 2026-08-07 (john.kim ADC REST, read-only)
- **소스**
  - BQ `marblo-2253d.marblo_telemetry.events` / `cost_logs` (location US)
  - BQ `marblo-2253d.analytics_543991508.events_*` GA4 (location asia-northeast3)
  - Firestore `founders` / `marketing_contacts` / `users` / `subscriptions`
  - GitHub API `melocream/marblo-releases` release assets `download_count`
  - 코드: `v3/src/App.tsx` (`markFirstRunIfNeeded`), `v3/src/services/telemetryService.ts` (`flushTelemetry` auth-gate)
- **성격**: 조사·수치 산출 전용. **코드·스키마 무변경.** 어드민 뷰는 후속.

---

## 0. 한 줄 결론

| 질문 | 판정 |
| --- | --- |
| first_run 7일 2건이 "실제 설치 2"인가? | **최근 7일 기준: 예에 가깝다.** admin 제외 후에도 first_run 클라이언트=2, 동기간 외부 활성 clientId=2. |
| 발화/식별 갭인가? | **평생·미로그인 구간에는 갭이 있다.** first_run은 (1) 로그인 후에야 BQ로 flush되고 (2) localStorage `firstRunSent`를 flush 전에 찍어서 큐 유실 시 영구 누락. 다만 **7일 창의 "2" 자체는 갭으로 부풀려진 게 아니라 실제 신규가 그 수준.** |
| 신규 유입은 어디서 죽는가? | **웹 방문·리드까지는 있다 → 다운로드/설치/로그인에서 대부분 소멸 → 첫 프로젝트·완료는 외부 0에 가깝다.** |

---

## 1. first_run 발화 경로 (코드)

### 1-A. 언제 찍히나

`v3/src/App.tsx` — 설치당 1회 마커:

1. 메인 창 최초 마운트 시 `markFirstRunIfNeeded()` 호출
2. `localStorage["marblo.telemetry.firstRunSent"] === "true"` 이면 skip
3. 아니면 키를 **즉시 true로 기록** 후 `telemetry.appFirstRun(platform)` 큐잉
4. pop-out/detach 창은 제외

### 1-B. 언제 서버로 가나 (핵심 한계)

`flushTelemetry()`:

- `auth.currentUser` 가 있을 때만 `logTelemetryBatch` 호출 (anti-abuse)
- 큐는 **인메모리** (`eventQueue`) — 디스크 미저장

따라서:

| 시나리오 | BQ `app:first_run` |
| --- | --- |
| 설치 → 로그인 성공 | 전송됨 (로그인 직후 배치에 포함) |
| 설치 → 로그인 안 함 / 앱 종료 | **미전송**. 그런데 `firstRunSent`는 이미 true → **재발화 없음** |
| 계측 전 빌드 설치 후 업그레이드 | 이론상 다음 부팅에 1회 발화. 실측은 session 대비 first_run 과소 |

first_run 계측 도입: PR `#542` (2026-07-21 전후). BQ 최초 first_run 행 = **2026-07-21**.

### 1-C. 텔레메트리 게이트

- 1st-party 기본 **ON** (`firstPartyTelemetryDefaultEnabled`, 2026-07-17 승인)
- kill-switch `VITE_DISABLE_TELEMETRY=1` 또는 유저 opt-out 시에만 중단
- **opt-in 게이트 때문에 2건으로 줄었다는 가설은 기각** (기본 ON)

### 1-D. 식별자

| 필드 | 의미 | 신청 이메일 조인 |
| --- | --- | --- |
| `events.userId` | 익명 install `clientId` (UUID) | 불가 |
| `metadata.accountUserId` | 서버가 flush 시 붙이는 Firebase uid | 가능(uid 보유 시). **2026-W31(8/4주)부터 본격 적재** — 이전 행 대부분 NULL |
| first_run 행의 accountUserId | 전기간 **전부 NULL** (메타에 platform만) | 신청↔설치 직접 조인 불가 |

---

## 2. first_run=2 수치 검증 (BQ)

스냅샷 기준 `events` 총 181,125행 / distinct clientId 41.

### 2-A. 기간별

| 구간 | first_run 건수 | first_run distinct client | any-event distinct client |
| ---: | ---: | ---: | ---: |
| 7일 | **2** | **2** | 5 |
| 30일 | 15 | 10 | 40 |
| 전기간 | 15 | 10 | 41 |

→ 어드민 KPI "7일 first_run=2"는 BQ 실측과 **일치**.

### 2-B. admin(john.kim) 제외

admin uid `RSALO1…` 를 `metadata.accountUserId` + cost_logs agentId 역참조로 제외 (잡힌 admin clientId **10**개):

| 지표 | 포함 | admin 제외 |
| --- | ---: | ---: |
| first_run clients (7일) | 2 | **2** |
| first_run clients (전기간) | 10 | **5** |
| any clients (7일) | 5 | **2** |
| session clients (7일, ex) | — | **2** |
| spawn clients (전기간, ex) | — | **7** |
| task:completed clients (전기간, ex) | — | **0** |

**판정:** 최근 7일의 first_run=2는 운영자 오염이 아니다. 외부 활성 설치 2와 숫자적으로 같다.

### 2-C. 7일 first_run 2건 실체

| 시각 (UTC) | clientId (축약) | appVersion | 이후 도달 |
| --- | --- | --- | --- |
| 2026-08-01 | `b304e231…` | 3.0.19→3.0.22 | login · folder · orch · spawn · token (소량) · complete **0** |
| 2026-08-04 | `1b733e44…` | 3.0.22 | login · orch · spawn **0** · folder **0** |

둘 다 MacIntel. 로그인까지는 갔고, **작업 완료는 없음**.

### 2-D. clientId 유니크 vs first_run (평생)

| 버킷 | clients | login 이벤트 | folder | spawn | complete |
| --- | ---: | ---: | ---: | ---: | ---: |
| has_first_run | 10 | 6 | 6 | 9 | 2 |
| session_no_fr | 30 | 0 | 0 | 8 | 0 |
| other_no_fr | 1 | 0 | 0 | 0 | 0 |

- **session 있는데 first_run 없는 30** = 대부분 **계측 도입(7/21) 이전 설치** + 일부 업그레이드 미재발화.
- first_run 있는 10 중 complete=2는 **admin client** (`3a7c6019…`, `394952a8…`) — 외부 complete=0과 정합.

### 2-E. 이벤트 퍼널 (distinct client)

| 이벤트 | 7일 | 30일 | 전기간 |
| --- | ---: | ---: | ---: |
| session:started | 4 | 39 | 40 |
| app:first_run | **2** | 10 | 10 |
| auth:login_success | 2 | 6 | 6 |
| onboarding:folder_connected | 2 | 6 | 6 |
| agent:spawned | 4 | 16 | 17 |
| task:completed | 0 | 2 | 2 |

`login_success` 이벤트도 first_run과 같이 계측 이후에만 존재 → "로그인 6"은 전기간 로그인 수의 하한.

---

## 3. 다운로드 추적 가능 범위

### 3-A. GitHub `melocream/marblo-releases` (집계만, per-user 불가)

| 구분 | download_count 합 |
| --- | ---: |
| 전체 asset (yml/blockmap 포함) | 587 |
| **설치 파일만** (dmg/exe/zip) | **82** |
| yml/blockmap (자동업데이트 폴링) | 505 |

버전별 설치 파일 (누적, "최근 N일" 아님):

| tag | published | installer dl |
| --- | --- | ---: |
| v3.0.22 | 2026-08-01 | 6 |
| v3.0.20 | 2026-08-01 | 7 |
| v3.0.19 | 2026-07-29 | 4 |
| v3.0.18 | 2026-07-21 | 8 |
| v3.0.16 | 2026-07-14 | 23 (런칭 피크) |
| … | … | … |
| **합** | | **82** |

공개 릴리스 → **유저별 다운로드 식별 불가**. 같은 사람이 여러 버전을 받으면 중복 카운트.

### 3-B. GA4 marblo.app (`analytics_543991508`)

| 구간 | 전체 visitor | /download 방문자 | 커스텀 `download` | `file_download` | `generate_lead` |
| --- | ---: | ---: | ---: | ---: | ---: |
| 7일 | 102 | 16 | (소수) | 1 user | 12 |
| 30일 | 542 | 141 | 26 users / 39 events | 10 users / 14 | 52 |

- 커스텀 이벤트 `download`는 `/ko/download` 페이지 클릭 집계 (link_url 비어 있는 행 다수).
- `file_download`는 실제 GitHub asset 링크(exe 등) 일부가 잡힘 — **과소** 가능(외부 리다이렉트/크로스도메인).
- 웹 user_pseudo_id ↔ 앱 clientId **개인 조인 불가** (기존 churn 분석과 동일). 규모(magnitude) 비교만.

### 3-C. 다운로드 추적 결론

| 질문 | 답 |
| --- | --- |
| per-user 다운로드? | **불가** (GitHub 공개 + GA4 익명) |
| 집계 추이? | **가능** — GH installer ~82 누적, GA4 download 30일 26 users |
| first_run과 대사? | 7일: GA4 download 페이지 16명 · GH 최신 버전 installer 한 자리 · first_run 2 → **설치 클릭 ≫ 로그인까지 간 설치** 패턴과 맞음 |

---

## 4. 신청유저 코호트

### 4-A. 신청·계정 모수 (Firestore)

| 풀 | 수 | 비고 |
| --- | ---: | --- |
| `founders` (status=selected, 전원 grant) | **61** | 이메일 doc id |
| `marketing_contacts` 전체 | 94 | source: waitlist 35 / founder 27 / auth_signup 32 |
| marketing_contacts with uid | **40** | 이메일→앱 uid 연결 가능 상한 |
| waitlist 소스 + uid | 3 | 신청→로그인 연결 거의 안 됨 |
| `users` 문서 | 70 | lastHeartbeatAt 있는 유저 **19** |
| `subscriptions` (전부 founderGrant, active) | **32** | 그랜트=로그인 이력 proxy |

이메일 plaintext는 founders에만 있고, BQ events에는 이메일이 없음.  
**신청 이메일 → first_run clientId 직접 조인 불가.**  
가능 체인: founders email ⊄ marketing uid ⊂ (users / subscriptions / cost_logs.userId).

### 4-B. 코호트 표 (신청 → 앱 가치)

관리자(john.kim = cost_logs 165,646/165,747행) 포함·제외.

| 단계 | 정의 | 포함 | admin 제외(근사) |
| --- | --- | ---: | ---: |
| ① 신청(선정) | founders selected | **61** | 61 |
| ② 계정/리드 | marketing_contacts | 94 | ~93 |
| ③ 로그인+그랜트 proxy | subscriptions | **32** | ~31 |
| ④ 앱 최근 생존 | users.lastHeartbeatAt | **19** | ~18 |
| ⑤ 설치 마커 | app:first_run distinct client | 10 | **5** |
| ⑥ 로그인 이벤트 | auth:login_success client | 6 | 6 |
| ⑦ 첫 프로젝트 | folder_connected client | 6 | **5** |
| ⑧ 에이전트 스폰 | agent:spawned client | 17 | **7** |
| ⑨ 실 LLM 비용 | cost_logs distinct uid | 4 | **3** |
| ⑩ 작업 완료 | task:completed client | 2 | **0** |

**읽는 법 (핵심):**

1. **신청 61 → 구독/그랜트 32 (~52%)** — 선정 메일은 절반 정도가 계정·그랜트까지.
2. **그랜트 32 → 하트비트 19 (~59%)** — 그랜트 받아도 앱을 최근 켠 사람은 더 적음.
3. **하트비트 19 → first_run 마커 5(외부)** — 설치 마커 과소 + 다수 세션이 계측 전/재설치 전.
4. **외부 실비용 uid 3, 완료 0** — 예전의 "외부 실사용 ≈ 0" 결론 유지.  
   외부 3명 cost 합: ~$47.4 (Y6TG… $47.13 이틀) + $0.11 + $0.19.

### 4-C. cost_logs 외부 3 uid (마스킹)

| uid 축약 | rows | USD | 기간 |
| --- | ---: | ---: | --- |
| `Y6TGxU…` | 94 | 47.13 | 2026-07-30 ~ 07-31 |
| `QxW59C…` | 4 | 0.11 | 2026-07-21 |
| `03BR5d…` | 3 | 0.19 | 2026-08-01 (first_run 클라이언트 b304e231 과 동시간대) |

7일 창 cost_logs distinct uid=2 = admin + `03BR5d…` (first_run 2건 중 1과 연결 가능).

### 4-D. 웹 규모 체인 (magnitude, 개인 조인 아님)

```
30일 GA4 방문 542
  → lead 52
  → /download 방문자 141
  → GA4 download 이벤트 26 users
  → GH installer 누적 82 (전기간 버전 합)
  → BQ first_run 외부 5 (계측 이후)
  → cost_logs 외부 3
  → task:completed 외부 0
```

7일:

```
방문 102 → lead 12 → /download 16 → file_download 1 → first_run 2 → complete 0
```

---

## 5. 종합 판정

### 5-A. "first_run 7일 2건"의 정체

1. **실제 신규 설치·로그인 규모가 2 근처**다.  
   - admin 제외 7일 활성 client = 2 = first_run 2  
   - GA4·GH 도 "주간 설치 클릭 한 자릿수~십수" 수준
2. **동시에 구조적 과소계측**이 있다 (미로그인 설치·큐 유실·계측 전 코호트).  
   → first_run을 "다운로드 수"로 읽으면 안 되고, **"로그인까지 간 신규 설치의 하한"**으로 읽어야 한다.
3. **"신규 유입이 많다"는 말**이 웹 방문/waitlist 신청을 가리킨다면 앱 first_run과 **층이 다르다**.  
   웹 유입 ≠ 앱 설치 ≠ 로그인.

### 5-B. 어디서 새는가 (우선순위)

| 우선 | 구간 | 증거 |
| ---: | --- | --- |
| 1 | 신청/방문 → 다운로드·설치 | 30일 방문 542 vs GA4 download 26 vs GH installer 82 누적 |
| 2 | 설치 → 로그인 | first_run flush가 로그인 필수; 미로그인 설치 비가시 |
| 3 | 로그인 → 첫 프로젝트/스폰 | 외부 spawn 7, folder 5 — 남더라도 얕음 |
| 4 | 스폰 → 완료 | **외부 task:completed = 0** (가치 순간 미도달) |

### 5-C. 후속 권고 (이 티켓 범위 밖)

1. **first_run 신뢰성**: `firstRunSent`를 flush 성공 후에만 기록하거나, 미전송 시 재큐; 가능하면 pre-auth 전송 경로(서명 제한) 검토.
2. **신청 코호트 조인**: founders email → Firebase Auth uid 배치 매핑 테이블(어드민 전용) 없으면 신청→앱 전환율을 티켓 단위로 못 닫음.
3. **다운로드 KPI**: GH installer( dmg/exe/zip only ) + GA4 `download` 를 주간 대시보드에 병기. yml 카운트는 제외.
4. **어드민 뷰**: 위 코호트 표를 `getAdminOnboardingFunnel` 옆에 "신청 코호트(Firestore)" 카드로 — 별도 구현 티켓.

---

## 6. 재현 쿼리 (요약)

```sql
-- first_run 7/30/all
SELECT
  COUNT(DISTINCT IF(event='app:first_run'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY), userId, NULL)) AS fr_7d,
  COUNT(DISTINCT IF(event='app:first_run', userId, NULL)) AS fr_all,
  COUNT(DISTINCT IF(timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY), userId, NULL)) AS clients_7d
FROM `marblo-2253d.marblo_telemetry.events`;

-- cost_logs 외부
SELECT userId, COUNT(1) n, ROUND(SUM(totalCost),4) usd
FROM `marblo-2253d.marblo_telemetry.cost_logs`
WHERE userId != 'RSALO1rljtWBSZ70MoBiaeFORxr1'  -- admin
GROUP BY userId;
```

Firestore: `founders` 61 / `marketing_contacts` 94 / `subscriptions` 32 / `users` heartbeat 19.  
GitHub: installer assets only sum ≈ 82.

---

## 7. 완료 기준 체크

- [x] first_run=2 가 실설치 근사인지 발화갭인지 — **7일은 실설치·로그인 2에 가깝다 + 평생 과소계측 구조 명시**
- [x] 신청→…→완료 코호트 표 (포함/제외)
- [x] 다운로드 추적 범위 (GH 집계 O, per-user X, GA4 집계 O)
- [x] 누수 구간 증거 수치 판정

**날조 없음.** 모든 수치는 위 소스 직접 조회. uid/clientId/이메일은 축약·마스킹만.
