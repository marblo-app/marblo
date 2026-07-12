# 텔레메트리 BigQuery 적재 중단 조사 (marblo_telemetry, 2026-06-22 이후)

- **작성**: 2026-07-12, backend 에이전트 (읽기전용 진단, systematic-debugging)
- **티켓**: 149YsO1XTUfLMfjIxCTi
- **결론 한 줄**: 적재는 **실제로 중단**됐고(6/22 14:54 UTC 하드 컷오프), 끊긴 레이어는 **클라이언트**다. 근본원인은 **PR #137(6/17)이 first-party 텔레메트리를 PIPA 대응으로 기본 OFF 로 전환**했으나 이를 다시 켜는 빌드플래그·동의 UI 가 어디에도 없어서, 해당 빌드가 도그푸드 플릿에 적용된 시점부터 앱이 적재 함수를 **호출 자체를 멈췄기** 때문이다. 서버(함수/BQ) 고장이 아니다.

---

## 1. 결정적 확인 — 진짜 중단 vs last_modified 허위

`bq query`(project=marblo-2253d, location=US)로 실제 최신 row 타임스탬프 측정:

| 테이블           | MIN(timestamp)      | **MAX(timestamp)**      | 총 row  |
| ---------------- | ------------------- | ----------------------- | ------- |
| agent_heartbeats | 2026-04-19 05:06:01 | **2026-06-22 14:54:17** | 753,928 |
| events           | 2026-04-18 14:12:23 | **2026-06-22 14:20:10** | 49,551  |
| cost_logs        | 2026-04-18 14:12:13 | **2026-06-22 14:20:00** | 45,691  |

→ 3개 테이블 모두 실제 row 가 **2026-06-22 에서 멈춤**. 스트리밍 버퍼 last_modified 허위 가능성 **배제**(실 row 타임스탬프 기준). 약 3주(6/22→7/12) 신규 적재 0 확정.

### 중단 형태 — 절벽(cliff), 점진 감소 아님

agent_heartbeats 일별 카운트 (6/15~6/22):

| 날짜      | 건수       | 마지막 row 시각(UTC)       |
| --------- | ---------- | -------------------------- |
| 06-15     | 108,894    | 23:59:51                   |
| 06-16     | 105,139    | 23:59:51                   |
| 06-17     | 91,523     | 23:59:53                   |
| 06-18     | 23,685     | 23:59:58                   |
| 06-19     | 20,788     | 23:59:50                   |
| 06-20     | 42,925     | 23:59:56                   |
| 06-21     | 43,180     | 23:59:58                   |
| **06-22** | **91,747** | **14:54:17 ← 하드 컷오프** |

6/22 당일 정상 적재(91,747건)되다 **14:54:17 UTC(= 23:54 KST)에 한 순간 완전 정지**. 이후 07/12 까지 0건. 하루 중 급정지 = 다수 클라이언트가 서로 다른 시각에 빠지는 점진 감소가 아니라, **소수(도그푸드 플릿) 소스가 한 번에 꺼진 형태**.

## 2. 어느 레이어에서 끊겼나 — Cloud Logging 증거

적재 경로: `electron main → renderer IPC(telemetry:event) → renderer logTelemetry choke point(opt-in 게이트 + PII scrub) → Firebase callable(logHeartbeat/logTelemetryBatch/logCostBatch) → BigQuery insert`.

Cloud Logging(marblo-2253d) 실측:

- **컷오프 순간(6/22 14:54:17~18Z)**: `logHeartbeat` 가 `status code: 200` 으로 정상 실행·완료. 에러/권한/스키마/쿼타 오류 **없음**.
- **컷오프 이후**: 실 텔레메트리 호출 **0건**. 유일한 흔적은 6/23 05:30·05:36Z 의 `GET` 요청 2건인데 `"Request has invalid method. GET" → status 400` = 스캐너/헬스프로브성 프로브이지 앱의 callable(POST) 호출이 아님.
- **함수 배포 상태**: logHeartbeat/logTelemetryBatch/logCostBatch/logTaskOutcome 모두 **2026-06-29 재배포**(PR #254 BQ location=US pin). 즉 **중단 이후 함수가 다시 배포됐는데도 데이터는 여전히 0** → 함수(서버) 결함이면 재배포로 회복됐어야 함. 회복 안 됨 = 서버 아님.

**⟹ 끊긴 레이어 = 클라이언트.** 함수는 컷오프 시점 정상(200)이었고 지금도 정상 배포 상태다. 앱이 함수를 **호출하는 것을 멈췄다.**

## 3. 근본원인 — first-party 게이트 기본 OFF + 활성 경로 부재

### PR #137 (커밋 5b41c55, 2026-06-17 머지)

"fix(v3): first-party telemetry OFF by default — local-only 6/23 build (PIPA)".
PIPA(제15조, 침묵≠동의) 대응으로 first-party 분석 송신을 **기본 OFF** 로 전환. 단일 진실원 `v3/src/lib/telemetry/firstPartyGate.ts`:

```ts
export function firstPartyTelemetryDefaultEnabled(): boolean {
  const env = import.meta.env;
  if (env?.VITE_DISABLE_TELEMETRY === "1") return false; // 하드 kill-switch
  return env?.VITE_FIRST_PARTY_TELEMETRY === "1"; // ← 기본 OFF, 이 플래그로만 ON
}
```

`telemetryService.ts:58` 이 이 게이트로 초기 상태를 잡는다: `let telemetryEnabled = firstPartyTelemetryDefaultEnabled();`. OFF 면 renderer choke point 에서 걸려 `logHeartbeat`/`logTelemetryBatch`/`logCostBatch` callable 이 **아예 발사되지 않는다**.

### 활성화 경로가 실제로 존재하지 않음 (실측)

게이트를 켤 수 있는 두 경로 모두 실환경에서 닫혀 있음:

1. **빌드플래그 `VITE_FIRST_PARTY_TELEMETRY=1`** — repo 전체 grep 결과 **유닛테스트(`telemetry-local-only.test.ts`)에만 존재**. CI(`.github`), `electron-builder.yml`, `package.json`, 어떤 `.env` 에도 **미설정**. 즉 도그푸드/내부 빌드조차 이 플래그를 켜지 않는다.
2. **런타임 동의(dev8, `setTelemetryEnabled(true)`)** — 코드에 `setTelemetryEnabled(true)` **호출부 0건**(주석의 계획 언급뿐, 동의 UI 미구현). `App.tsx:26` 은 오히려 kill-switch 시 `setTelemetryEnabled(false)` 만 호출.

**⟹ #137 이후 모든 실빌드에서 first-party 텔레메트리는 100% OFF.** #137 을 포함한 앱 빌드("6/23 local-only 빌드")가 도그푸드 플릿에 적용된 시점(6/22 23:54 KST 부근, 6/22→6/23 KST 경계와 일치)부터 적재가 완전 정지했다.

### 정직한 공백(추론 vs 증거)

- **증거로 확정**: 실제 중단 시각, 끊긴 레이어(클라이언트), 게이트 기본 OFF, 활성 플래그·동의 UI 부재.
- **강한 정황(직접 로그 없음)**: "6/22 14:54 정확히 그 시각에 플릿이 #137 빌드로 갱신됐다"는 배포/갱신 이벤트 자체는 직접 로깅되지 않음. 다만 (a)단일 하드 컷오프, (b)6/22→6/23 KST 경계, (c)#137 의 "6/23 build" 문구가 일관되게 이 해석을 가리킴. 6/22 당일 머지된 #178(dispatch:decision)은 텔레메트리를 **추가**만 하지 heartbeat 를 끄지 않으므로 원인 아님.

## 4. 영향

- 관리자 대시보드(티켓 AfhbDvRP)의 BigQuery 기반 지표가 6/22 이후 데이터 공백.
- 비용/사용량·에이전트 성과·dispatch 결정 분석 등 모든 1차 분석 파이프라인 정지(단, ~/.claude 로컬 JSONL 온디바이스 경로는 무관하게 유지).
- **데이터 유실 아님**: 클라이언트가 큐만 비활성이라 과거 적재분은 온전. 재개 시점부터 다시 쌓임.

## 5. 수정안 (제안만 — 배포는 사용자 승인 후)

이건 버그가 아니라 **PIPA 컴플라이언스 결정의 의도된 부작용**이다. "적재 재개"와 "PIPA 준수"는 트레이드오프이므로 사장님 결정이 필요.

**옵션 A — 내부 도그푸드 빌드에서만 플래그 ON (권장, 최소·안전).**
내부/도그푸드 빌드 프로파일에서만 `VITE_FIRST_PARTY_TELEMETRY=1` 주입(예: CI 의 내부빌드 job env 또는 `.env.dogfood`). 외부 배포 빌드는 기본 OFF 유지 → PIPA 그대로 준수하면서 내부 관측 회복. 비식별(anonymous clientId) 이라 내부 동의 범위와 정합.

- 변경 지점: 빌드 파이프라인 env 1곳. 앱 코드 무변경. 게이트 로직 그대로.
- 검증: 내부빌드 실행 후 `logHeartbeat` 호출 재개 + BQ 신규 row 확인.

**옵션 B — 런타임 동의 UI(dev8) 구현 후 옵트인.**
설정 화면에 명시적 동의 토글 추가 → 사용자가 켜면 `setTelemetryEnabled(true)`. 외부 사용자 대상 정식 경로(GA/PIPA 정합). 구현 비용 큼, 별도 티켓.

**옵션 C — 현행 유지(공백 수용).** 대시보드는 옵트인 사용자/내부만 반영됨을 명시.

> ⚠️ 파괴적 조작(삭제/재적재/함수 재배포)은 이 조사 범위에서 **하지 않음**. 함수는 이미 정상 배포 상태라 재배포 불필요. 수정은 승인 후 별도 티켓에서.

## 6. 재현·검증 명령 (읽기전용)

```bash
# 실 최신 타임스탬프
bq --project_id=marblo-2253d query --use_legacy_sql=false --location=US \
 'SELECT MAX(timestamp) FROM marblo_telemetry.agent_heartbeats'
# 컷오프 순간 함수 상태(200) 및 이후 실호출 부재
gcloud logging read 'resource.type="cloud_function" AND resource.labels.function_name="logHeartbeat" AND timestamp>="2026-06-22T14:50:00Z"' --project=marblo-2253d --limit=20
# 활성 플래그 미설정 확인
grep -rn "VITE_FIRST_PARTY_TELEMETRY" v3/ --include=*.ts --include=*.yml --include=*.json | grep -v node_modules
```
