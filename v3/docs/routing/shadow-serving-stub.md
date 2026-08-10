# 클라우드 라우팅 shadow 서빙 스텁

> 티켓 `6LH4Y1GC7xeWA94pW3Ar`. 짝 문서: [`label-capture-audit-2026-08-10.md`](./label-capture-audit-2026-08-10.md).

## 0. ★비목표 — 이 스텁이 하지 **않는** 것

1. **학습하지 않는다.** 서버에 모델도, 가중치도, 학습 코드도 없다. 추천은 로컬
   `model-autoselect` 의 정책 상수(`FIT_PENALTY`/`COST_WEIGHT`/`costPressureForHeadroom`)를
   손으로 옮겨 적은 **2성분 휴리스틱**이다.
2. **실반영하지 않는다.** 스폰은 언제나 로컬 결정 그대로다. 클라우드 응답이 메인 프로세스로
   돌아가는 배선 자체가 없다 — 있으려면 새 IPC 를 파야 한다.
3. **개인화하지 않는다.** 계정별 분기가 없고, 서버는 uid 를 어디에도 적지 않는다.

왜 그런데도 지금 짓는가: 학습형 라우팅의 baseline("클라우드 추천과 로컬 결정이 얼마나
같았나")은 **소급되지 않는다**. 모델을 끼우는 날 "좋아졌다" 를 말하려면 그 전에 일치율
시계열이 존재해야 한다.

## 1. 불변식

| 불변식                    | 어떻게 보장되나                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **행동 변경 0**           | 발신 지점이 스폰·`emitDispatchDecision` **뒤**다. 반환값 없음. `tests/unit/routing-shadow.test.ts` 가 "shadow 를 만들어도 plan 이 동일" 을 검증                          |
| **fail-safe**             | 3중: env 킬스위치 → `buildShadowRequest` null → `try/catch` 전량 흡수. 렌더러 쪽도 전 구간 `try/catch` 후 조용한 실패                                                    |
| **추천이 정답을 안 본다** | `recommendRouting(features)` 의 타입에 로컬 결정 필드가 없다. 비교는 별도 함수가 나중에 한다. `functions/src/routingShadow.test.ts` 가 "정답을 심어도 결과 동일" 을 검증 |
| **동의·PII 계약 불변**    | 클라우드 왕복을 **렌더러**가 한다 → 기존 게이트(`isTelemetryEnabled`) + scrub + 서버 가명화를 그대로 탄다. 새 적재 경로·새 테이블 없음                                   |
| **자유입력 미전송**       | 태그는 **개수**만. 파서(`parseShadowFeatures`)가 화이트리스트라 서버는 그 밖의 키를 보지도 않는다                                                                        |

## 2. 데이터 경로

```
[main] dispatchSingle
   │  ① 로컬 결정(변경 없음) → 스폰 → emitDispatchDecision
   │
   └─ ② emitRoutingShadow()                              electron/bridge-server.ts
         └ buildShadowRequest()                          electron/routing-shadow.ts
             · features: tier·harness·entryIndex·rungs[{modelKey,index,costIndex}]
                         ·budgetUsedPercent·weeklyTokenShare·활성수·role·taskType·tagCount
             · localModelKey / localMode / localDecidedBy / localColdStart   ← features 바깥
         └ mainTelemetry.routingShadowRequest()          electron/telemetry.ts
               ↓ IPC "telemetry:event"  event="routing:shadow_request"
[renderer] App.tsx 가 그 이름만 가로챈다(로그로 흘리지 않는다)
   └ recordRoutingShadow()                               src/services/routingShadowService.ts
       ├ ★게이트: isTelemetryEnabled() && auth.currentUser        (아니면 여기서 끝)
       ├ callable getRoutingRecommendation({features, localModelKey})
       │      ↓
       │  [cloud] functions/src/index.ts  (읽기 전용 — BigQuery 를 건드리지 않는다)
       │     · parseShadowFeatures(화이트리스트)
       │     · recommendRouting(features)         ← ★로컬 결정을 못 본다
       │     · compareShadowRouting(features, rec, localModelKey)
       └ logTelemetry({event:"routing:shadow", success: agree, metadata:{...}})
             ↓ 기존 경로 그대로: scrub → logTelemetryBatch → 가명화 → BQ events
```

**왜 서버가 직접 BQ 에 안 쓰나**: 기존 텔레메트리 경로에는 이미 (a) 동의 게이트,
(b) PII scrub, (c) 조인키 HMAC 가명화가 붙어 있다. 서버에서 따로 insert 하면 그 셋을
우회하는 **두 번째 쓰기 경로**가 생긴다 — 새 테이블·새 IAM·새 프라이버시 표면을 만들
이유가 없다.

## 3. 휴리스틱 v0 (`heuristic-v0-cost-fit`)

로컬 8성분 중 **2개만** 쓴다. 나머지 6개는 클라우드에 **없는 사실**이기 때문이다:

| 성분                    | 클라우드 | 왜                                                 |
| ----------------------- | :------: | -------------------------------------------------- |
| `fit`(진입칸 거리)      |    ✅    | `entryIndex`+`rungs[].index` 를 클라가 실어 보낸다 |
| `cost`(log2 배수)       |    ✅    | `costIndex` 스냅샷 + 잔여쿼터 압력                 |
| `bench` / `capability`  |    ❌    | SWE 참조표가 앱 안(레지스트리 파생)                |
| `kg`                    |    ❌    | 라우팅 그래프가 **기기 로컬 파일**(audit G2)       |
| `diversity`             |    ❌    | 같은 그래프의 관측 수                              |
| `usage` / `weeklyLimit` |    ❌    | 사용량 롤업이 기기 로컬 거울                       |

**★이 부분집합성이 설계다.** 그래서 불일치가 랜덤 노이즈가 아니라 **"클라우드가 못 보는
신호가 결정을 움직인 순간"** 을 정확히 가리킨다. 아래 §5 쿼리 (2)가 그 목록을 뽑는다 —
그게 곧 다음 단계에서 클라우드로 올려야 할 특징의 우선순위다(audit G10).

동률 처리도 일부러 다르다: 클라우드는 상태가 없으므로 **사다리 낮은(싼) 칸이 이긴다**.
로컬의 `tie-rotate`(회전)와 갈리는 것은 의도이며, 그 차이도 세는 값이다.

## 4. 검증

```bash
# 클라우드 순수 로직 (node:test — vitest 아님)
cd v3/functions && npm run test:routing-shadow

# 클라이언트 절반 + ★행동 변경 0 (vitest)
cd v3 && npx vitest run tests/unit/routing-shadow.test.ts

# 회귀 없음(자동선택·그래프·라벨 스크럽)
cd v3 && npx vitest run tests/unit/model-autoselect.test.ts \
  tests/unit/model-autoselect-diversity.test.ts \
  tests/unit/bridge-dispatch-autoselect.test.ts \
  tests/unit/routing-label-scrub.test.ts

# 타입
cd v3 && npx tsc --noEmit
cd v3/functions && npx tsc --noEmit
```

**shadow 로그 1건이 실제로 나는 경로**(라이브 확인 순서):

1. `getRoutingRecommendation` 배포(§6) — **배포 전에는 콜러블이 없어 왕복이 실패**하고,
   설계대로 조용히 아무 이벤트도 남지 않는다(행동 변경 0은 그대로).
2. 앱 실행 → 로그인 → 텔레메트리 동의 ON(기본값).
3. 보드/오케에서 **모델 미지정** dispatch 1건(명시 핀은 자동선택을 안 타므로 shadow 도 없다).
4. BigQuery: `SELECT * FROM events WHERE event='routing:shadow' ORDER BY timestamp DESC LIMIT 1`.

**끄는 법**: `MARBLO_ROUTING_SHADOW=0` (메인 프로세스 env). 미설정은 **켜짐**이다
(`Number("")===0` 함정 회피 — `resolveEpsilon` 과 같은 규약).

## 5. 쿼리

```sql
-- (1) 일치율 시계열 — 이 스텁의 헤드라인 지표
SELECT DATE(SAFE_CAST(timestamp AS TIMESTAMP)) AS d,
       COUNT(*) AS n,
       COUNTIF(success) AS agreed,
       ROUND(COUNTIF(success) / COUNT(*), 3) AS agree_rate
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'routing:shadow'
GROUP BY d ORDER BY d DESC;
```

```sql
-- (2) ★불일치의 귀책 — 로컬의 어느 성분이 클라우드가 못 보는 것이었나
--     상위에 오는 decidedBy 가 곧 "다음에 클라우드로 올려야 할 특징"이다.
SELECT JSON_VALUE(metadata,'$.localDecidedBy') AS local_decided_by,
       JSON_VALUE(metadata,'$.localMode')      AS local_mode,
       COUNT(*) n,
       COUNTIF(success) agreed
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'routing:shadow'
GROUP BY 1,2 ORDER BY n - agreed DESC;
```

```sql
-- (3) 차이의 방향·크기 — 클라우드가 체계적으로 싸게/비싸게 미는가
SELECT JSON_VALUE(metadata,'$.tier') AS tier,
       AVG(SAFE_CAST(JSON_VALUE(metadata,'$.rungDelta') AS FLOAT64)) AS avg_rung_delta,
       AVG(SAFE_CAST(JSON_VALUE(metadata,'$.costDelta') AS FLOAT64)) AS avg_cost_delta,
       COUNT(*) n
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'routing:shadow'
GROUP BY tier ORDER BY n DESC;
```

```sql
-- (4) 콜드 스타트에서의 일치율 — KG 가 비었을 때는 두 쪽 조건이 가장 비슷하다.
--     여기서도 안 맞으면 그건 신호 부족이 아니라 **정책 드리프트**다(상수가 갈렸다).
SELECT JSON_VALUE(metadata,'$.heuristicVersion') AS heuristic,
       JSON_VALUE(metadata,'$.localColdStart')   AS cold,
       COUNT(*) n, COUNTIF(success) agreed
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'routing:shadow'
GROUP BY 1,2 ORDER BY 1,2;
```

## 6. 배포

`getRoutingRecommendation` 는 **새 콜러블**이라 배포해야 동작한다.

```bash
cd v3/functions
npm run check:deploy-env      # 게이트(ANALYTICS_ID_SALT 등) 통과 확인
npm run deploy                # firebase deploy --only functions --project marblo-2253d
```

- ★배포는 **메인 체크아웃**에서 한다(워크트리에는 env 가 없다 — gitignored).
- 새 BigQuery 테이블·스키마 변경·IAM 변경 **없음**. 이 콜러블은 읽기 전용이다.
- 미배포 상태의 영향: 렌더러 왕복이 실패 → 조용히 shadow 이벤트 0건. 로컬 라우팅은 정상.

## 7. 한계

- **추천 품질을 주장하지 않는다.** v0 는 fit+cost 2성분이다. 일치율이 낮게 나오는 것이
  정상이고, 그 낮음 자체가 측정하려던 값이다.
- **정책 상수가 두 곳에 복제돼 있다**(`electron/model-autoselect.ts` ↔
  `functions/src/routingShadow.ts`). functions 는 electron 모듈을 import 할 수 없어서다.
  갈리는 것 자체는 사고가 아니지만(그 차이를 재는 게 목적) **의도여야 하고 방치여선
  안 된다** — 로컬 상수를 튜닝하면 이 문서와 서버 모듈을 같이 본다.
- **reuse/restart 경로에는 shadow 가 없다.** 그 경로엔 2층 자동선택이 안 돌아 비교할 로컬
  결정이 없다(`buildShadowRequest` → null).
- **명시 모델 핀 경로에도 없다.** 같은 이유.
- 앱이 꺼져 있거나 미로그인이면 왕복이 없다 — audit G6 와 같은 결측 성격이다.
