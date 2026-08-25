# 스폰 이후 계측이 샌다 — 종료 1,570 / 스폰 5,840, 결과 있는 사람 7/17

- 티켓: `GCNpqvDYRrLhyLghPCF9`
- 측정일: 2026-08-25
- 데이터: BigQuery `marblo-2253d.marblo_telemetry`, john.kim ADC REST, 리전 US
- 성격: 조사 + 재발 방지 검사. 종료 IPC 폴백과 렌더러 flush 는 같은 변경에 포함.

사람 수는 퍼센트로 쓰지 않는다. 이벤트 단위(스폰 vs 종료)만 비율이다.

## 0. 한 줄

**종료가 스폰의 27%인 것은 제품이 아니라 계측이다.** 하트비트는 남은 에이전트
1,518개가 `agent:stopped`/`agent:crashed`/`agent:restarted` 없이 사라졌다.
스폰한 17명 중 결과가 없는 10명은 대부분 보드 작업을 완료하지 않았고, 그중
디스패치까지 간 6명(특히 크래시 루프 2명)은 태스크가 터미널 상태로 안 바뀌어
`task_outcomes` 가 쓸 것이 없었다.

## 1. 축부터 — `userId` 는 표마다 다른 공간이다

| 표 | 컬럼 | 축 | 2026-08-25 길이별 사람 수 |
| --- | --- | --- | --- |
| `events` | `userId` | install clientId | 36자 **42** · 28자 1 · 14자 1 |
| `task_outcomes` | `userId` | install clientId | 36자 **7** |
| `agent_heartbeats` | `userId` | install clientId | 36자 **14** · 28자 1 |
| `cost_logs` | `userId` | Firebase uid | 28자 **5** |

개명 안: `installClientId` vs `firebaseUid`. 코드 정본은
`v3/functions/src/telemetryIdentityAxis.ts`. 이 표를 `userId` 로 가로지르면
반드시 틀린다.

아래 모든 비교는 **36자 clientId** 축이다. 티켓이 인용한 spawned 6,934 vs
stopped 1,800 은 28자 행(spawned 1,101)이 섞인 숫자다. 36자만 보면 5,840 vs
1,570. 비율은 둘 다 ~27% 라 결론은 같다.

## 2. 종료가 안 찍히는 이유 — 코드 근거

이벤트 (전체 표, 참고): spawned 6,938 · stopped 1,800 · restarted 1,179 ·
crashed 975.

36자 + agentId 있는 행:

| 항목 | 값 |
| --- | ---: |
| unique agentId | 3,526 |
| spawned | 5,839 |
| stopped | 1,570 |
| crashed | 879 |
| restarted | 993 |
| 스폰 있고 종료·크래시 없음 | 1,522 |
| 그중 재시작도 없음 | 1,518 |
| 그 1,518 중 하트비트가 있는 것 | **1,518** |
| 하트비트도 없는 것 | 1 |

살아 있던 에이전트 1,518개의 종료가 안 남았다. 코드 경로:

1. **종료가 앱 종료 순간에만 나간다.** `agent-manager.stopAll()` 은
   `before-quit` 에서 각 에이전트에 `agent:stopped` 를 IPC 로 보낸다
   (`v3/electron/main.ts`, `v3/electron/agent-manager.ts`). 렌더러 큐는 10초
   타이머(`FLUSH_INTERVAL`)고, 창 숨김/종료 flush 가 없었다.
2. **죽은 창이면 IPC 자체가 버려진다.** `sendTelemetry` 는
   `if (!win \|\| win.isDestroyed()) return`. `getMainWindow` 는 첫 창
   폴백이다. 그 창이 닫히면 하트비트·종료가 전부 침묵한다.
3. **재시작은 스폰을 늘리고 종료를 안 남긴다.** 크래시 자동재시작과
   `restart()` 는 새 `launch()` → `agent:spawned` 를 찍고, 옛 PTY `onExit` 는
   인스턴스 불일치로 return 한다. `agent:restarted` 는 별도 이벤트다. 이 몫은
   이벤트 분모(5,840)를 키우지만, 위 1,518 은 재시작 0이라 **이 항목으로
   설명되지 않는다.**
4. **크래시 최종은 `agent:crashed` 이지 `agent:stopped` 가 아니다.** 879건.
   티켓의 26% 비교는 stopped 만 센다. crashed 를 더해도
   (1,570+879)/5,840 = 42% 이고, 1,518 하트비트 유실이 남는다.

이번 변경: 살아 있는 다른 창으로 IPC 폴백, `pagehide`/`visibilitychange=hidden`
에서 즉시 flush. 재시작을 stopped 로 바꾸지는 않는다 — 스폰은 프로세스
런치 횟수다.

## 3. 결과 없는 10명 — 안 했는가, 기록이 안 남았는가

36자 스폰 17명.

| 묶음 | 사람 | 판정 |
| --- | ---: | --- |
| `task_outcomes` 있음 | **7** | 기록이 남음 (1,463행, 디스패치 taskId 2,061) |
| 디스패치 있음 · 결과 0 · 크래시 루프 | **2** | 일을 했다(하트비트 227,136, 디스패치 391, 크래시 376). 태스크가 DONE/FAILED 로 안 바뀌면 아웃컴 작성기가 쓸 것이 없다. 완료 행이 사라진 증거가 아니다 |
| 디스패치 있음 · 결과 0 · 하루·소량 | **3** | 시작했고 완료하지 않음 |
| 디스패치 없음 | **4** | 보드 작업을 완료하지 않음 |

디스패치 후 결과 0인 사람 **6명**, 고유 taskId 142 vs 결과 있는 7명의
taskId 2,061 / 결과 1,463. `task:completed` 이벤트는 MCP 가 렌더러를 우회해
거의 안 찍히므로(코드 주석, 실측 2명) 그 부재를 '완료 안 함'의 증거가 아니라
그 이벤트의 한계로 읽는다.

아웃컴 작성기(`taskOutcomeReporter.ts`)는 Firestore 터미널 전이만 본다. 에이전트
크래시는 태스크 상태를 안 바꾼다. 그래서 2명의 0행은 **완료 기록이 샌 것**이
아니라 **완료 상태로 안 간 것**에 가깝다.

## 4. 비용 — 로그인 안 한 사용자는 `cost_logs` 에 안 쌓인다

`logCostBatch` 는 `context.auth` 가 없으면 `unauthenticated` 를 던지고,
적재하는 `userId` 는 `context.auth.uid` 다 (`v3/functions/src/index.ts`).
렌더러 `useCostWriter` 도 같은 콜러블이다.

실측: `cost_logs` 사람 **5명**(전부 28자 uid). 행 390,287 중 한 계정이
390,144행($113,292). 나머지 4명은 94+71+5+4행. 기업용 비용 대시보드가
`cost_logs` 를 축으로 삼으면 (1) 미인증 사용은 0, (2) 17명 스폰 축과 조인
불가, (3) 거의 한 계정이다.

## 5. 재발 방지

`v3/functions/src/postSpawnTelemetryGuard.ts` — 오늘 실측을 넣으면 RED.
통과하면 그 검사는 죽은 것이다. 실행: `cd v3/functions && npm run test:post-spawn-guard`.
