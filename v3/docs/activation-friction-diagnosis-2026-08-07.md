# 활성화 마찰 진단 + 개선안 — 설치→로그인→첫프로젝트→첫완료

- **티켓**: `4A8ClWvFUMJwR4wGBgo9`
- **작성일**: 2026-08-07
- **선행 근거**: [`docs/first-run-cohort-investigation-2026-08-07.md`](../../docs/first-run-cohort-investigation-2026-08-07.md) (7u7G 코호트 조사)
- **데이터**: BQ `marblo-2253d.marblo_telemetry` (`events` / `task_outcomes` / `cost_logs`) — john.kim ADC REST, read-only 스냅샷 2026-08-07
- **성격**: 진단·설계 문서. **코드 무변경.** 개입안은 §7 후속 티켓 후보로 쪼갠다.

---

## 0. 한 줄 결론 — 코호트 결론 1건을 정정한다

| #   | 종전 판정 (7u7G)                                                                | 이 문서의 판정                                                                                                                                          | 근거  |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | 외부 `task:completed` = **0** → "가치 순간 미도달"                              | **틀렸다(계측 축 착오).** 실제 완료 기록 sink 는 `task_outcomes` 이고, 거기서 외부 클라 **3개가 성공 완료 4건**을 갖고 있다                             | §2    |
| 2   | 최대 누수 = 스폰→완료                                                           | **아니다.** 로그인한 외부 설치 6 중 3(50%)이 첫 완료에 도달했다. 최대 누수는 **①유입→로그인(월 6명)** 과 **②첫날 이후 재방문(6명 중 5명이 활동일 1일)** | §4·§5 |
| 3   | 이탈 원인 후보 = `folder_connect_failed`·`orchestrator_blocked`·`agent:crashed` | **셋 다 최근 외부 코호트에선 0건.** 실제로 관측된 이탈 지문은 **"첫 티켓 전달 성공 후 아무 것도 안 보임"** (8/4 유저의 30초 내 3연타)                   | §5-S4 |

> **왜 이게 중요한가**: 현재 KPI 는 활성화율을 0% 로 보여준다. 실측은 (표본은 작지만) 50% 다.
> 지표를 고치지 않고 개입을 설계하면 **이미 되고 있는 구간을 고치고, 실제로 새는 구간(유입·재방문)을 방치**하게 된다.
> 그래서 이 문서의 P0 는 UI 개선이 아니라 **계측 정정**이다.

---

## 1. 방법

- 코호트 문서가 쓴 것과 같은 소스·같은 프로젝트. 다른 점은 `events` 만이 아니라 **`task_outcomes` 를 함께 읽었다**는 것.
- "외부(admin 제외)" 정의: 코호트 §4-B ⑥행과 동일 — `auth:login_success` 를 발화한 clientId **6개**(포함 6 = admin 제외 6). 이 6개가 이 문서의 외부 코호트다.
- `3f820e30` 은 `metadata.accountUserId = RSALO1…`(john.kim) 으로 admin 확정. `552b1092` 는 로그인 이벤트가 없어(계측 도입 전 설치) 귀속 불명 → **외부 코호트에서 제외**하고 판단 근거로 쓰지 않았다.
- 재현 쿼리는 §9.
- 표본은 6명이다. 비율은 방향 판단용이지 통계가 아니다 — 이 문서 어디에서도 6명을 모집단처럼 쓰지 않는다.

---

## 2. 정정 ① — 완료 이벤트는 "사람이 UI 로 옮긴 완료"만 센다

### 2-A. 코드 근거

`src/services/taskService.ts:254-296` — `updateTaskStatus()` 안에서만 `telemetry.taskCompleted()` 가 불린다. 같은 파일 주석이 그 한계를 명시한다:

> 이 함수는 **렌더러 경로 전용**이다 — 에이전트는 MCP 서버로 상태를 바꾸고 그쪽은 Firestore 를 직접 write 하므로 여기 오지 않는다.

반면 ML 라벨 행(`task_outcomes`)은 **tasks 구독 훅**에서 나간다 — `src/services/taskOutcomeReporter.ts:155-166` `observeTaskSnapshot()` 이 모든 writer(사람·에이전트·MCP)를 한 번씩 잡는다.

즉 같은 "완료"가 두 테이블에 서로 다른 커버리지로 적재된다:

| sink                    | 커버리지                                     | 어디에 쓰이나                                |
| ----------------------- | -------------------------------------------- | -------------------------------------------- |
| `events.task:completed` | 사람이 보드에서 카드를 DONE 으로 옮긴 경우만 | ★어드민 온보딩 퍼널·코호트 조사의 **결승선** |
| `task_outcomes`         | 오케/에이전트/MCP 포함 **모든** 완료         | ML 라벨·비용 롤업                            |

마블로의 정상 사용법은 "오케가 티켓을 만들고 에이전트가 끝낸다"이다. 그래서 **정상적으로 쓸수록 `events.task:completed` 는 안 찍힌다.**

### 2-B. 실측 대조

`task_outcomes` 기준 외부 완료 (admin 3대 제외):

| client     | taskType | role     | model         |       소요 | 비용(USD) | 완료시각(UTC) | 같은 client 의 `events.task:completed` |
| ---------- | -------- | -------- | ------------- | ---------: | --------: | ------------- | -------------------------------------: |
| `ef1bd222` | docs     | frontend | gpt-5.5       |     19.3분 |      3.85 | 07-21 03:57   |                                  **0** |
| `31f19ceb` | infra    | devops   | claude-opus-5 |     17.1분 |     13.90 | 07-30 00:37   |                                  **0** |
| `31f19ceb` | feature  | backend  | claude-opus-5 |      8.5분 |      4.06 | 07-30 14:59   |                                  **0** |
| `b304e231` | bug-fix  | frontend | claude-opus-5 | **11.9분** |     11.20 | 08-01 03:27   |                                  **0** |

`b304e231` 은 코호트 §2-C 가 "7일 first_run 2건" 중 하나로 지목한 바로 그 외부 설치다. 코호트는 이 유저를 "complete 0"으로 적었지만, **그 유저는 설치 당일 버그수정 티켓 하나를 12분 만에 끝냈다.**

### 2-C. 같은 착오가 티켓 축 전체에 있다

외부 6 클라이언트의 `task:created` = **0**, `task:status_changed` = **0** — 완료한 3명도 포함해서 전부 0.
오케가 만든 티켓·에이전트가 옮긴 상태는 `events` 에 아예 없다. `events` 의 티켓 축은 **사람의 UI 조작 로그**이지 제품 사용량이 아니다.

---

## 3. 정정 ② — 이벤트 시각은 "서버가 받은 시각"이다

`functions/src/index.ts:6417` — `logTelemetryBatch` 는 모든 행에 `timestamp: now`(서버 수신 시각)를 박는다. 클라이언트는 발생 시각을 아예 보내지 않는다.

결과:

1. **로그인 전 큐잉된 이벤트는 전부 로그인 순간으로 붕괴한다.** 실제로 `b304e231` 의 `app:first_run`·`login_attempt`·`login_success`·`marketing_consent_*`·`session:started` 6개가 **같은 초(08-01 00:38:33)** 에 찍혔다.
2. 그래서 `first_run → login`, `login → folder` 같은 **단계 지연(time-to-value)을 계산할 수 없다.** 지금 계산하면 전부 0초로 나온다.
3. 로그인 이후에도 최대 `FLUSH_INTERVAL`(10초) 만큼 밀린다 — 초 단위 분석에는 노이즈.

---

## 4. 정정 ③ — 설치했지만 로그인 안 한 유입은 영구 비가시 (티켓 요구사항 ★)

세 겹이다:

| 층         | 코드                                                                                                | 효과                                 |
| ---------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 서버       | `functions/src/index.ts:6352-6356` — `logTelemetryBatch` 는 `context.auth` 없으면 `unauthenticated` | 미로그인 전송 경로 자체가 없음       |
| 클라 flush | `src/services/telemetryService.ts:308-316` — `if (!auth.currentUser) return`                        | 로그인 전엔 절대 안 나감             |
| 클라 큐    | 같은 파일 `const eventQueue: TelemetryPayload[] = []` (인메모리)                                    | 앱 종료 시 큐 **소멸**               |
| 마커       | `src/App.tsx:498-514` — `firstRunSent` 를 **큐잉 전에** true 로 기록                                | 유실돼도 재발화 없음 → **영구** 누락 |

즉 "설치 → 실행 → 로그인 안 하고 종료" 는 우리 데이터에 **존재하지 않는다.** 코호트가 본 GA4 `/download` 30일 141명 vs first_run 10 의 간극 중 얼마가 이 사각인지 지금은 알 수 없다.

---

## 5. 퍼널 실측 (외부 6 + admin 대조)

### 5-A. first_run 클라이언트 전수 (10)

`events` 도달 여부 + `task_outcomes` 완료를 한 표에:

| client     | 첫날  | 마지막 | login | folder | orch | firstTicket | spawn | `events` complete | `task_outcomes` (성공) | 판정              |
| ---------- | ----- | ------ | :---: | :----: | :--: | :---------: | :---: | :---------------: | ---------------------: | ----------------- |
| `394952a8` | 06-13 | 07-29  |   –   |   ✅   |  ✅  |      –      |  ✅   |        ✅         |              173 (163) | admin             |
| `3a7c6019` | 06-13 | 08-07  |   –   |   ✅   |  ✅  |     ✅      |  ✅   |        ✅         |              391 (366) | admin             |
| `3f820e30` | 07-14 | 08-07  |   –   |   –    |  ✅  |      –      |  ✅   |         –         |              296 (292) | admin(uid 확인)   |
| `552b1092` | 07-14 | 08-04  |   –   |   –    |  ✅  |      –      |  ✅   |         –         |                  5 (5) | 귀속불명 → 제외   |
| `ef1bd222` | 07-21 | 07-21  |  ✅   |   –    |  ✅  |      –      |  ✅   |         –         |              **1 (1)** | 외부·완료         |
| `f8a59e9b` | 07-21 | 07-21  |  ✅   |   ✅   |  ✅  |      –      |  ✅   |         –         |                      0 | 외부·스폰까지     |
| `1b2bbad9` | 07-22 | 07-22  |  ✅   |   ✅   |  ✅  |      –      |  ✅   |         –         |                      0 | 외부·스폰까지     |
| `31f19ceb` | 07-29 | 07-31  |  ✅   |   ✅   |  ✅  |     ✅      |  ✅   |         –         |              **2 (2)** | 외부·완료         |
| `b304e231` | 08-01 | 08-01  |  ✅   |   ✅   |  ✅  |     ✅      |  ✅   |         –         |              **1 (1)** | 외부·완료         |
| `1b733e44` | 08-04 | 08-04  |  ✅   |   –    |  ✅  |     ✅      | **–** |         –         |                      0 | 외부·스폰 전 이탈 |

### 5-B. 외부 6 코호트 퍼널

```
설치·로그인 6
  → 폴더연결 4        (1b733e44·ef1bd222 는 folder 이벤트 없음, 그래도 오케는 뜸)
  → 오케 오픈 6       (100%)
  → 첫티켓 전달 3
  → 에이전트 스폰 5
  → ★첫 완료 3        (50%) ← 종전 KPI 로는 0
  → 활동일 2일 이상 1  (17%)
  → 재방문(D3+) 0
```

### 5-C. 재방문(리텐션)

| client     | 활동일 수 | 세션 수 | 기간        |
| ---------- | --------: | ------: | ----------- |
| `f8a59e9b` |         1 |       3 | 07-21       |
| `ef1bd222` |         1 |       1 | 07-21       |
| `1b2bbad9` |         1 |       1 | 07-22       |
| `31f19ceb` |     **3** |       8 | 07-29~07-31 |
| `b304e231` |         1 |       3 | 08-01       |
| `1b733e44` |         1 |       1 | 08-04       |

**6명 중 5명이 하루만 썼다. 첫 완료에 도달한 3명 중 2명도 하루만 썼다.**
활성화(첫 완료)는 절반이 통과하는데 **그 다음 날이 없다** — 이게 현재 가장 큰 절벽이다.

---

## 6. 단계별 진단

### S1. 유입 → 다운로드·설치·로그인 — **최대 누수(규모)**

- 코호트 실측: 30일 GA4 방문 542 → lead 52 → `/download` 141 → GA4 download 26 → GH installer 누적 82 → **로그인까지 간 신규 설치 6**.
- 이 구간이 규모 면에서 압도적이다. 앱 안의 어떤 UI 개선도 여기 숫자를 바꾸지 못한다.
- 단 §4 때문에 "설치는 했는데 로그인 안 함"이 몇 명인지 모른다 → **개입 전에 계측이 먼저**.

### S2. 설치 → 로그인 — 측정 불가 + 이탈 지문 1건

- `b304e231` 트레이스: `00:38:33` 첫 실행·로그인 → `00:38:56` 온보딩 ①install 진입 → **2시간 15분 공백** → `02:54` 재실행(그 사이 3.0.19→3.0.20 자동 업데이트) → `02:58:39` ②auth 성공.
- 즉 이 유저는 첫 세션에서 CLI 설치 단계를 만나 이탈했다가, 몇 시간 뒤 돌아와서야 넘었다. **①install 이 세션을 끊는 지점**이라는 단일 증거.
- `1b733e44` 는 `03:38:06` 에 `auth:login_failed / loopback/no-token` 을 남기고 사라졌다 (기존 티켓 `7qohuvyFNHRJFQP5SubV` 와 같은 축).

### S3. 로그인 → 첫 프로젝트 — **가설 기각**

- 외부 코호트에서 `onboarding:folder_connect_failed` **0건**, `onboarding:orchestrator_blocked` 는 전기간 통틀어 **1건**(cli_auth).
- `onboarding:orchestrator_opened` 는 외부 6/6 발화. 폴더연결·오케기동은 **막히지 않았다.**
- 대신 흥미로운 형태: `1b733e44`·`ef1bd222` 는 `folder_connected` 없이 `orchestrator_opened` 만 있다 → 폴더 픽커를 거치지 않고(기존 프로젝트 문서 복원 등) 오케가 떴다는 뜻. 이 경로는 **③단계 UI 를 건너뛴 채 진행**되므로 온보딩 진행률이 실제와 어긋난다.

### S4. 첫 티켓 → 첫 스폰 — **관측된 유일한 UX dead-end**

`1b733e44` (08-04) 전체 트레이스:

```
03:33:54  first_run · login_success · cli_setup_step(auth,success) · orchestrator_opened   ← 전부 flush 붕괴
03:34:20  cli_setup_step(firstTicket, success)
03:34:34  cli_setup_step(firstTicket, success)   ← +14초
03:34:48  cli_setup_step(firstTicket, success)   ← +14초
03:38:06  auth:login_failed (loopback/no-token)
(끝. 스폰 0, 이후 재방문 없음)
```

30초 안에 "첫 티켓 만들기"를 **3번** 눌렀다. `delivered`(로컬 오케에 실제 주입 성공)로 3번 다 성공했는데도 3번 눌렀다는 것은 — **눌러도 화면에서 아무 일도 일어나지 않았다**는 뜻이다.

코드 근거 (`src/components/onboarding/StartHereTab.tsx:694-722`):

- 성공 시 반환값은 **초록 텍스트 한 줄**(`FirstTicketResultNote`)이 전부다.
- 탭 이동 없음 — 유저는 계속 "시작하기" 탭을 보고 있고, 오케가 일하는 터미널/보드는 화면에 없다.
- 버튼에 **중복 전송 가드가 없다** (`disabled = sendingTicket || !hasProject`). 전달 성공 후에도 계속 눌린다 → 오케 PTY 에 같은 프롬프트가 3번 주입된다(오케 입장에선 중복 지시).
- 오케가 티켓을 만드는 데는 수십 초~수 분이 걸리는데, 그 사이 **진행 중임을 알리는 표면이 없다.**

### S5. 스폰 → 완료 — 절반은 통과, 실패 2건의 지문

- 통과 3 (`ef1bd222`·`31f19ceb`·`b304e231`), 미통과 2 (`f8a59e9b`·`1b2bbad9`).
- `1b2bbad9`: `08:27:47` 스폰 2기 → `08:28:18` `agent:restarted` → 스폰 2기 더 → 침묵. 재시작 후 결과 없이 종료.
- `f8a59e9b`: 3회 스폰, 세션 3회, 결과 0.
- 두 사례 모두 **`agent:crashed` 는 0건**이다. 즉 "죽어서 못 끝낸" 게 아니라 **끝났는지 안 끝났는지 모르는 채 유저가 떠났다**에 가깝다.

### S6. 첫 완료 → 재방문 — **현재 최대 절벽**

- §5-C. 완료까지 간 3명 중 2명이 그날로 끝. 제품이 "한 번 써보고 마는 도구"로 소비되고 있다.
- 첫 완료 직후 다음 행동을 제안하는 표면이 **없다** — 완료는 보드에서 조용히 일어나고, 온보딩 탭은 이미 졸업 처리된다.

### S7. 크래시 사유 — 계측이 죽어 있다

| appVersion | `agent:crashed` 행 | `errorCategory` 채워진 행 |
| ---------- | -----------------: | ------------------------: |
| null       |                471 |                         0 |
| 3.0.0      |                304 |                         0 |
| 3.0.16     |                171 |                         0 |
| 3.0.17     |                 15 |                         4 |
| 3.0.19     |                  1 |                         1 |

962행 중 **5행만** 사유를 갖는다. 사유 계측이 들어간 3.0.17+ 는 표본이 20행뿐 — 사실상 "크래시가 왜 났는지"는 여전히 모른다. 다만 §S5 대로 **최근 외부 코호트의 크래시는 0** 이므로, 이건 활성화 이탈 원인이 아니라 **운영 관측 부채**다.

---

## 7. 개선안 + 우선순위

원칙: **(a) 잘못된 지표를 먼저 고치고 → (b) 관측된 dead-end 를 고치고 → (c) 안 보이는 구간을 보이게 하고 → (d) 그 다음에 유입·재방문을 설계한다.**

### P0 — 지표를 믿을 수 있게 (선행. 이거 없이는 나머지 효과 측정 불가)

**P0-1. 완료 sink 통일 — 활성화 결승선을 실제 완료에 붙인다**

- 문제: §2. 활성화 KPI 가 0% 로 보이지만 실제 50%.
- 개입(택1, A 권장):
  - **A.** `taskOutcomeReporter.observeTaskSnapshot()` 의 terminal 전이 지점에서 `telemetry.taskCompleted()` 도 함께 발화 (한 곳, 모든 writer 커버). 중복 방지는 이미 있는 `claimOutcomeReport` 마커 재사용.
  - B. 어드민 퍼널의 결승선 정의를 `events.task:completed` → `task_outcomes(success)` 로 교체(서버측만 변경, 앱 배포 불필요 — 다만 clientId 축이 달라 조인 주의).
- 기대: 활성화율·TTFV·버전별 비교가 처음으로 실값이 된다. 과거 데이터도 `task_outcomes` 로 소급 재계산 가능.
- 범위: `v3/src/services/taskOutcomeReporter.ts` (+ `functions` 쿼리 1곳) — 소.

**P0-2. `task:created` / `task:status_changed` 도 같은 갭 — 최소한 문서화**

- 개입: 위 A 를 택하면 같은 자리에서 생성/전이도 커버 가능. 당장 안 하면 **어드민 지표 설명에 "렌더러 경로 한정" 주석**만이라도 박아 오독을 막는다.
- 범위: `v3/src/types/adminAnalytics.ts` 주석 + 어드민 카드 설명 — 극소.

**P0-3. `first_run` 신뢰성 — 유실 시 재발화**

- 문제: §4. `firstRunSent` 를 큐잉 전에 기록 → 큐 유실이 영구 누락.
- 개입: ① 이벤트 큐를 localStorage 에 영속화(앱 종료해도 다음 로그인에 flush) ② `firstRunSent` 는 **flush 성공 후에만** 기록.
- 기대: "설치 후 며칠 뒤 로그인" 유저가 first_run 에 들어온다. 끝내 로그인 안 한 유저는 여전히 안 보임(→ P1-1).
- 범위: `v3/src/services/telemetryService.ts`, `v3/src/App.tsx` — 소~중(큐 영속화는 크기 상한·PII scrub 이미 통과분이라 안전).

### P1 — 관측된 dead-end 제거 + 사각 가시화

**P1-1. ★설치-미로그인 가시화 (티켓 요구사항)**
설계 3안 비교:

| 안                                | 방식                                                                                          | 장점                                          | 비용·리스크                                                                                                                | 권고         |
| --------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------ |
| A. 익명 인증                      | 첫 실행에 `signInAnonymously()` → 기존 flush 그대로 동작                                      | 서버 변경 0                                   | 익명 uid 가 `accountUserId` 로 적재돼 유저 카운트 오염, `isHumanAuthUser`/동의 게이트와 상호작용 위험(기존 사고 이력 있음) | ✕            |
| B. **미인증 install-ping 콜러블** | App Check 로 게이트한 `logInstallPing` 신설. payload = clientId·platform·appVersion·locale 뿐 | 진짜 사각을 메움. 인증 축·events 축 오염 없음 | functions 1개 신설 + App Check 배선, 남용 표면                                                                             | **★권장**    |
| C. 업데이터 피드 프록시           | 릴리스 `latest.yml` 다운로드 카운트를 주간 KPI 에 병기                                        | 코드 0                                        | 설치≠실행, per-user 불가, 이미 505건이 섞여 있음                                                                           | 보조지표로만 |

- 기대: `설치 → 로그인` 전환율이 처음으로 산출된다. S1/S2 개입의 효과 측정이 여기 걸린다.
- 범위: `v3/functions/src/index.ts` + `v3/src/services/telemetryService.ts` — 중.

**P1-2. 첫 티켓 이후 "지금 일어나는 일" 표면 (S4 dead-end)**

- 개입 4종(한 티켓으로 묶여도 됨):
  1. `delivered` 후 **버튼 잠금 + 쿨다운**(재전송은 명시적 "다시 보내기"로만) — 중복 주입 방지.
  2. `delivered` 후 **오케 패널/보드로 자동 포커스** 또는 "오케가 일하는 중" 인라인 스트림(오케 PTY 최근 줄 요약).
  3. **대기 상태 UI**: "오케가 요구사항을 읽고 티켓을 만드는 중… (보통 1~3분)" + 티켓 생성 감지 시 ✓.
  4. 90초 내 티켓이 안 생기면 **막힘 안내**(오케 탭 열기 / 프롬프트 다시 보내기 / 로그 보기).
- 기대: 관측된 유일한 실제 UX 이탈 지문의 직접 해소.
- 범위: `v3/src/components/onboarding/StartHereTab.tsx`, `FirstTicketResultNote.tsx`, `lib/firstTicketDelivery.ts` — 중.

**P1-3. 단계 지연 측정 가능하게 (`occurredAt`)**

- 개입: 클라이언트가 이벤트 발생 시각을 실어 보내고(`occurredAt`), 서버는 그대로 컬럼에 적재(기존 `timestamp` 는 수신시각으로 유지).
- 기대: time-to-first-completed, 단계별 체류시간, "①install 에서 세션이 끊긴다" 같은 §S2 가설의 정량화.
- 범위: `telemetryService.ts` + `functions` 스키마 1컬럼 — 소(스키마 추가는 nullable 이라 무회귀).

**P1-4. `9nDmc` — 가이드에 CLI 설치·인증 선행 단계 명시 (기존 티켓 그대로 진행)**

- 중복 아님. 시작하기 탭은 위저드를, 9nDmc 는 **Guide 탭 문서**를 고친다. §S2 의 "①install 에서 2시간 이탈" 이 이 티켓의 실증 근거가 된다.
- 권고: 스코프 유지하되 문구에 **"둘 중 하나만 인증하면 된다"**(#579 규칙)와 **BYOM 대안 경로**(F4)를 반드시 포함.

### P2 — 재방문(현재 최대 절벽)

**P2-1. 첫 완료 직후 다음 행동 제안**

- 개입: 첫 `task_outcomes(success)` 감지 시 **결과 요약 카드** — 무엇이 바뀌었나(파일/라인) + "다음에 시킬 만한 것 3개"(리포 컨텍스트 기반 제안) + diff/PR 로 가는 한 클릭.
- 근거: §S6. 완료한 3명 중 2명이 그날로 이탈.
- 연계: 기존 `DylV5oFCgka8XKmlXhsw`(첫 머지 "무엇을 만드셨나요" + testimonial)와 **같은 트리거**를 쓴다 → 한 표면에 합치는 게 맞다.
- 범위: `v3/src/components/onboarding/` 신규 + 완료 구독 훅 — 중.

**P2-2. 스폰했는데 결과 없는 상태의 구제 (S5)**

- 개입: 첫 에이전트가 N분 이상 결과 없이 idle/재시작이면 "이 에이전트는 지금 뭘 하고 있나 + 멈췄으면 이렇게" 안내(워치독 표면 재사용).
- 근거: `1b2bbad9` 의 재시작 후 침묵.
- 범위: 에이전트 탭/워치독 — 중.

### P3 — 운영 관측 부채

**P3-1. `agent:crashed` 사유 채움 회귀 검증** (§S7) — 현행 릴리스에서 `errorCategory` 가 실제로 실리는지 라이브 확인. 범위 소.
**P3-2. 어드민 코호트 카드** — 7u7G §5-C 권고(신청 코호트 + 설치·로그인 전환) 를 어드민에. **단 P0-1·P1-1 이후에** 붙여야 값이 맞다.
**P3-3. 온보딩 진행 정확도** — §S3 의 "folder 이벤트 없이 오케만 뜨는" 경로에서 진행률이 어긋나는 문제. 범위 소.

### 우선순위 한 장 요약

| 순위 | 항목                      | 무엇이 좋아지나               | 크기  |
| ---: | ------------------------- | ----------------------------- | ----- |
|    1 | P0-1 완료 sink 통일       | 활성화율이 실값(0%→실제)이 됨 | 소    |
|    2 | P0-3 first_run 유실 수리  | 설치 마커 하한이 정확해짐     | 소~중 |
|    3 | P1-2 첫 티켓 이후 가시화  | 관측된 유일한 UX 이탈 해소    | 중    |
|    4 | P1-1 install-ping         | 설치→로그인 전환율 최초 산출  | 중    |
|    5 | P1-3 occurredAt           | TTFV·단계 지연 측정           | 소    |
|    6 | P2-1 첫 완료 후 다음 행동 | 재방문(최대 절벽) 공략        | 중    |
|    7 | P1-4 9nDmc 가이드         | 상단 마찰 인지                | 소    |
|    8 | P2-2 / P3-\*              | 구제·관측 부채                | 소~중 |

---

## 8. 기존 온보딩 티켓과의 연계·중복 맵

| 기존 티켓                                                                | 상태    | 이 문서와의 관계                                                        |
| ------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------- |
| `9nDmcUQfH0llwuPGvAuX` — Guide '시작하기' CLI 선행단계                   | TODO    | **보완**. P1-4 로 그대로 진행. §S2 가 실증 근거 제공                    |
| `DylV5oFCgka8XKmlXhsw` — 첫 머지 testimonial 수집                        | TODO    | **합치기 권장**. P2-1 과 트리거·표면이 같다                             |
| `7qohuvyFNHRJFQP5SubV` — 로그인 성공 ≠ 토큰sync 분리                     | TODO    | **직접 근거 생김**: `1b733e44` 의 `login_failed/loopback-no-token`      |
| `E4w8fveTs4HG1ovd845p` — 텔레메트리 옵트인 토글 + PII                    | TODO    | **선행 의존**. P1-1(install-ping) 은 이 정책 위에 얹혀야 함             |
| `TdlWmESRnuGr7zltvRKM` — 사용패턴 세그먼트 뷰                            | TODO    | **후행**. P0-1 뒤에 붙어야 값이 맞음                                    |
| `Me11Ze8kvI35LvONzU9F` — Playwright 격리 / 클린룸 E2E                    | TODO    | **회귀 가드**. P1-2 의 dead-end 는 클린룸 시나리오로 고정 가능          |
| `b4Iw8qInqACF2Ba0UaYc` — dismissed 프로젝트 재오픈 불가                  | CLAIMED | **인접**. §S3 의 "폴더 없이 오케만 뜨는" 경로와 같은 영역               |
| `DTnNfzHult14Y6whCpoy` — getEnrichedPath nvm edge case                   | TODO    | **인접(설치층)**. §S2 ①install 이탈의 후보 원인 중 하나                 |
| `ir94m9C6`·`ZdgQMxW7`·`qQLGS3NW`·`n9FYu7Zv`(4스텝·시작하기 탭·데모·BYOM) | DONE    | **이미 배송됨**. 이 문서의 개입안은 그 위에 얹히는 것이지 재작업이 아님 |
| 7u7G 코호트 조사 §5-C 후속권고 1·3·4                                     | 문서    | 1(first_run 신뢰성)=P0-3, 3(다운로드 KPI)=P1-1 C안, 4(어드민 뷰)=P3-2   |

---

## 9. 후속 실행 티켓 후보 (쪼갠 목록)

| #   | 제목(안)                                                            | role     | 범위(파일)                                      | 기대효과                | 크기 |
| --- | ------------------------------------------------------------------- | -------- | ----------------------------------------------- | ----------------------- | ---- |
| T1  | [계측·P0] 완료 sink 통일 — 에이전트 완료도 `task:completed` 로 계상 | frontend | `services/taskOutcomeReporter.ts`               | 활성화 KPI 실값화       | S    |
| T2  | [계측·P0] first_run 유실 수리 — 큐 영속화 + flush 성공 후 마커      | frontend | `services/telemetryService.ts`, `App.tsx`       | 설치 마커 하한 정확화   | M    |
| T3  | [활성화·P1] 첫 티켓 전달 후 진행 가시화 + 중복전송 가드             | frontend | `components/onboarding/StartHereTab.tsx` 외     | 관측된 dead-end 해소    | M    |
| T4  | [계측·P1] 미인증 install-ping (App Check) — 설치-미로그인 가시화    | backend  | `functions/src/index.ts`, `telemetryService.ts` | 설치→로그인 전환율 산출 | M    |
| T5  | [계측·P1] `occurredAt` 컬럼 — 단계 지연·TTFV 측정                   | backend  | `functions` 스키마 + 클라                       | TTFV 지표 개설          | S    |
| T6  | [활성화·P2] 첫 완료 직후 결과 요약 + 다음 작업 제안 (DylV 통합)     | frontend | 신규 컴포넌트 + 완료 구독                       | 재방문 절벽 공략        | M    |
| T7  | [활성화·P2] 스폰 후 무응답 에이전트 구제 안내                       | frontend | 에이전트 탭/워치독 표면                         | S5 실패 2건 유형 구제   | M    |
| T8  | [관측·P3] `agent:crashed` errorCategory 라이브 회귀 검증            | test     | —                                               | 크래시 사유 복구        | S    |
| T9  | [어드민·P3] 신청 코호트 + 설치→로그인 카드 (T1·T4 이후)             | backend  | 어드민 analytics                                | 코호트 가시화           | M    |
| T10 | [문서·P0] 어드민 지표 설명에 "렌더러 경로 한정" 주석                | frontend | `types/adminAnalytics.ts` + 어드민 UI           | 오독 방지               | XS   |

---

## 10. 재현 쿼리

```sql
-- ① 완료 sink 대조: events.task:completed vs task_outcomes
WITH fr AS (
  SELECT DISTINCT userId FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'app:first_run'
),
ev AS (
  SELECT userId,
    COUNTIF(event='auth:login_success')  > 0 AS login,
    COUNTIF(event='onboarding:folder_connected') > 0 AS folder,
    COUNTIF(event='agent:spawned') > 0 AS spawn,
    COUNTIF(event='task:completed') > 0 AS ev_complete
  FROM `marblo-2253d.marblo_telemetry.events` GROUP BY userId
),
o AS (
  SELECT userId, COUNT(1) outcomes, COUNTIF(success) ok
  FROM `marblo-2253d.marblo_telemetry.task_outcomes` GROUP BY userId
)
SELECT fr.userId, ev.*, IFNULL(o.outcomes,0) outcomes, IFNULL(o.ok,0) ok
FROM fr JOIN ev USING(userId) LEFT JOIN o ON o.userId = fr.userId;

-- ② 크래시 사유 채움율
SELECT appVersion, COUNT(1) n, COUNTIF(errorCategory IS NOT NULL) with_cat
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event='agent:crashed' GROUP BY 1 ORDER BY n DESC;

-- ③ 단일 유저 활성화 트레이스 (dead-end 지문 확인)
SELECT timestamp, event,
       JSON_VALUE(metadata,'$.step') step, JSON_VALUE(metadata,'$.phase') phase, errorCategory
FROM `marblo-2253d.marblo_telemetry.events`
WHERE STARTS_WITH(userId, '1b733e44') AND event NOT IN ('agent:heartbeat','token:usage')
ORDER BY timestamp;
```

접근법은 [`memory: bq_telemetry_adc_rest_access`] 와 동일 — `gcloud auth application-default print-access-token` + BigQuery REST `POST /queries`.

---

## 11. 한계·정직성

- 외부 코호트 **n=6**. 50%·17% 같은 비율은 방향 판단용이다.
- `552b1092` 는 admin/외부 판별 불가로 제외했다. 포함하면 완료 클라이언트가 하나 늘 수 있다.
- `task_outcomes.userId` 는 clientId(설치 단위)이고 `cost_logs.userId` 는 Firebase uid 라 두 테이블의 "외부 N명"은 **같은 축이 아니다**. 실제로 `b304e231` 의 완료 1건은 `task_outcomes` 상 $11.20 인데 같은 날 `cost_logs` 외부 uid 합은 $0.19 다 — 이 불일치는 별도 조사 대상이며, 이 문서는 어느 쪽도 "정본"으로 주장하지 않는다.
- 단계 지연(TTFV)은 §3 때문에 **계산하지 않았다.** 본문의 시간 간격은 로그인 이후 구간에 한해서만 읽었다.
- 날조 없음. 모든 수치는 위 쿼리로 직접 조회했고, 코드 인용은 파일·행 번호로 확인 가능하다.
