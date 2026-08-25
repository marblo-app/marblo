# 자동설치 no_cli 74건 진단

- 티켓: `9DEvfpJvBIfs8gefyJVe`
- 작성일: 2026-08-25
- 성격: 조사 문서. 코드 변경 없음.
- 데이터: BigQuery `marblo-2253d.marblo_telemetry.events`, john.kim ADC REST
- 기간: 관측된 `onboarding:spawn_blocked` 전체, 2026-08-13 13:13:21 ~ 2026-08-24 11:20:39 KST

## 0. 결론

**74건은 사람 수가 아니다. 이벤트 74건이고 고유 사용자는 3명이다. 표본 부족이다.**

그리고 더 중요하다. 이 74건 대부분은 사용자에게 실제로 막힌 설치 실패가 아니라
`orchestrator_auto_select`의 후보 프로브가 만든 이벤트다. 자동 선택은
Claude, Codex, Grok 후보를 순회하며 각 후보마다 `checkSpawnAuthGate()`를 호출한다.
그 과정에서 한 후보가 미설치이면 `onboarding:spawn_blocked`가 찍힌다. 하지만 다른
후보가 준비돼 있으면 전체 오케스트레이터 선택은 계속될 수 있다.

실측에서도 그랬다.

| 구분 | 이벤트 | 고유 사용자 | 해석 |
| --- | ---: | ---: | --- |
| `no_cli` 전체 | 74 | 3 | 표본 부족. 이것만으로 사용자 차단이라고 말할 수 없음 |
| `surface=orchestrator_auto_select` | 66 | 3 | 후보 프로브 노이즈가 섞임 |
| `surface=orchestrator_launch` | 8 | 1 | 실제 launch 게이트 차단으로 읽을 수 있는 쪽 |

고유 사용자 3명 중 U1과 U3은 이후 `agent:spawned`가 있었고, U2도
`orchestrator_opened`와 `session:started`가 있었다. 따라서 74건 전체를
"사용자가 CLI 설치를 못 해서 첫 스폰에 실패했다"로 읽으면 틀린다.

이번 조사에서 답은 둘이다.

1. 먼저 계측을 고쳐야 한다. `spawn_blocked` 안에 user-facing block과 후보 probe가 섞여 있다.
2. 실제 설치 실패 원인, 예를 들어 PATH 미등록, curl 실패, 사내망/프록시, 권한 문제는 현재 BQ 이벤트만으로는 분해할 수 없다. 설치 IPC의 시도/결과/실패 분류가 구조화되어 찍히지 않는다.

## 1. BQ 기준선

`onboarding:spawn_blocked` 전체:

| reason | raw errorCategory | surface | model | 이벤트 | 고유 사용자 |
| --- | --- | --- | --- | ---: | ---: |
| `no_cli` | `not-installed` | `orchestrator_auto_select` | `codex` | 30 | 2 |
| `no_cli` | `not-installed` | `orchestrator_auto_select` | `grok` | 22 | 2 |
| `no_cli` | `not-installed` | `orchestrator_auto_select` | `claude` | 14 | 1 |
| `no_cli` | `not-installed` | `orchestrator_launch` | `claude` | 7 | 1 |
| `no_cli` | `not-installed` | `orchestrator_launch` | `gpt` | 1 | 1 |
| `needs_auth` | `not-authenticated` | `orchestrator_auto_select` | `grok` | 5 | 1 |
| `needs_auth` | `not-authenticated` | `orchestrator_launch` | `gpt` | 1 | 1 |

사용자별 `no_cli`:

| 사용자 | no_cli 이벤트 | 모델 | surface | install enter | auth enter | auth success | install fail |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |
| U1 | 39 | claude, codex, gpt | auto_select, launch | 18 | 12 | 45 | 0 |
| U2 | 9 | grok | auto_select | 0 | 0 | 9 | 0 |
| U3 | 26 | codex, grok | auto_select | 0 | 0 | 8 | 0 |

여기서 사람 수로 정직하게 말할 수 있는 것은 이 정도다.

- 실제 launch 게이트에서 `no_cli`로 막힌 사용자는 1명이다.
- `no_cli` 사용자 3명 중 2명은 `install enter`가 한 번도 없다.
- `install fail`은 0명이다. 설치 실패 원인이 없다는 뜻이 아니라, 설치 실패가 이 이벤트로 안 찍혔다는 뜻이다.
- `survey_cli_fail`은 조회 결과가 없었다.

## 2. 계측 일관성 검증

티켓 본문이 지적한 `auth enter`보다 `auth success`가 많은 문제는 재현된다.

| step | enter 사용자 | success 사용자 | enter 없는 success 사용자 | success가 enter보다 앞선 사용자 | enter 이벤트 | success 이벤트 | fail 이벤트 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| auth | 4 | 10 | 6 | 3 | 30 | 625 | 0 |
| install | 2 | 0 | 0 | 0 | 41 | 0 | 0 |
| prd | 2 | 3 | 1 | 0 | 22 | 18 | 0 |
| firstTicket | 2 | 4 | 2 | 0 | 14 | 12 | 0 |
| connect | 0 | 1 | 1 | 0 | 0 | 22 | 0 |
| project | 1 | 1 | 0 | 0 | 22 | 22 | 0 |

원인은 코드와 맞다.

- `v3/src/hooks/useCliSetupEngine.ts:235`의 ready false -> true edge가 `auth success`를 찍는다.
- 같은 파일 `:244-247` 주석도 이 edge가 이미 인증된 사용자의 cold start에서도 뜬다고 말한다.
- 즉 `auth success`는 "사용자가 auth step에 들어와 인증을 완료했다"가 아니라 "이 window mount에서 probe 결과 ready가 true로 바뀌었다"에 가깝다.
- 그래서 `auth success`를 퍼널 단계 완료로 쓰면 안 된다. 특히 `enter` 없이 `success`가 있는 사용자를 정상 단계 통과자로 세면 분석이 깨진다.

## 3. 자동설치 코드와 실제 계측 사이의 간극

자동설치 기능 자체는 있다.

- Claude/Codex/Grok은 `shell` 설치 전략이다. `v3/electron/harness-catalog.ts:123-183`
- shell 설치는 macOS/Linux에서 `curl -fsSL <url> | bash`, Windows에서 PowerShell `irm | iex`를 실행한다. `v3/electron/harness-manager.ts:360-419`
- `npm-global` 전략에는 npm 존재 검사와 prefix 쓰기 권한 검사, `~/.npm-global` fallback이 있다. `v3/electron/harness-manager.ts:447-548`
- 설치 실행 dispatcher는 `installPackage()`다. `v3/electron/harness-manager.ts:596-619`

하지만 첫 진입 배경 자동설치는 현재 꺼져 있다.

- `v3/src/hooks/useCliSetupEngine.ts:135-145`가 "Do not auto-install on first entry"라고 적고, 실제로 `AUTO_INSTALL_KEY`만 `1`로 저장한다.
- 해당 줄의 blame은 `aae4c092`이며 2026-08-13 18:08:23 KST 변경이다.
- 실제 설치는 사용자가 원클릭/행 버튼을 누를 때 `runInstall()` 또는 `runInstallAll()`로 간다. `v3/src/stores/cliSetupStore.ts:288-377`

그리고 설치 결과는 BQ에서 원인별로 읽을 수 없다.

- `runInstall()`은 IPC 결과를 `installErrors` 상태에 넣고 finally에서 재프로브한다. `v3/src/stores/cliSetupStore.ts:288-316`
- `runInstallAll()`은 최종적으로 `failedIds`만 로컬 상태에 남긴다. `v3/src/stores/cliSetupStore.ts:334-377`
- 이 경로에서 `telemetry.cliSetupStep("install", "success" | "fail", reason)`가 호출되지 않는다.
- `BeginnerOneClickModal`은 선택 확정 시 `install enter`와 `auth enter`를 바로 찍는다. `v3/src/components/beginner/BeginnerOneClickModal.tsx:301-333`
- 따라서 `install enter`는 설치 시도 시작과 비슷하지만, 설치 성공/실패/실패 원인은 남지 않는다.

## 4. 설치 실패 원인 후보 대조

| 후보 | 코드상 가능성 | 현재 계측으로 확인되는가 | 이번 데이터에서 읽을 수 있는 것 |
| --- | --- | --- | --- |
| npm prefix 권한 | `npm-global`은 prefix 쓰기 권한을 보고 `~/.npm-global`로 fallback한다 | 아니오 | Claude/Codex/Grok은 shell 전략이라 no_cli 74의 주 원인으로 볼 근거가 없다 |
| Node/npm 미설치 | `npm-global`에서는 npm이 없으면 명시 에러 | 아니오 | 이번 no_cli 모델은 Claude/Codex/Grok/gpt라 npm 부재로 설명하기 어렵다 |
| PATH 미등록 | 설치 후 probe는 PATH에서 binary를 찾는다. 설치는 성공했지만 PATH에 안 잡히면 계속 `not-installed`가 된다 | 아니오 | U1은 install enter 뒤에도 no_cli가 반복되어 가능성은 있지만 증거는 없다 |
| 사내망/프록시/방화벽 | shell 설치의 `curl` 또는 vendor installer가 실패할 수 있다 | 아니오 | stderr tail은 UI 상태에만 들어가며 BQ 분류가 없다 |
| 권한 팝업 미응답 | CLI 설치보다는 OAuth/브라우저 승인 문제에 가깝다 | 아니오 | 이것은 보통 no_cli가 아니라 needs_auth 쪽이어야 한다 |
| 설치 단계 진입 전 이탈 | 사용자가 설치 화면/버튼에 도달하지 않으면 install result가 없다 | 부분 확인 | no_cli 사용자 3명 중 2명은 install enter가 없다. 다만 그들의 no_cli는 auto_select probe라 실제 차단으로 단정하면 안 된다 |
| auto_select 후보 프로브 노이즈 | 후보별 `checkSpawnAuthGate()`가 `spawn_blocked`를 찍는다 | 예 | no_cli 74건 중 66건이 이 표면이다 |

## 5. 고칠 것 목록

### P0. `spawn_blocked`에서 후보 프로브와 실제 사용자 차단을 분리

대상: `probePreferredOrchestratorHarness()`와 `checkSpawnAuthGate()` 사용부.

무엇을 바꾸나:

- `surface=orchestrator_auto_select`에서는 `onboarding:spawn_blocked`를 찍지 않거나, 별도 이벤트 `onboarding:orchestrator_candidate_probe`로 보낸다.
- 최소 수정이면 `metadata.userFacing=false` 같은 불리언을 추가하고 대시보드/분석 쿼리는 기본으로 제외한다.
- 실제 launch/switch/agent launch 차단만 "사용자가 막혔다"로 센다.

기대 효과:

- 이번 표본의 no_cli 이벤트 74건 중 66건이 분석 모집단에서 빠진다.
- 실제 설치 실패 개선 모집단은 현재 관측 기준 1명으로 줄어든다.
- 전환 개선 자체가 아니라, 잘못된 우선순위 결정을 막는 수정이다.

### P0. `auth success`를 cold-start readiness와 사용자 단계 완료로 분리

대상: `v3/src/hooks/useCliSetupEngine.ts:235-238`, `v3/src/services/telemetryService.ts:900-923`.

무엇을 바꾸나:

- 현재 `auth success`는 ready edge다. 이것을 단계 퍼널 성공으로 쓰지 않는다.
- `metadata.source`를 `cold_start_probe` / `manual_recheck` / `one_click_login` / `install_flow`처럼 분리한다.
- 사용자 단계 완료로 세려면 직전 `auth enter` 또는 `setupInitiated`가 있는 경우만 별도 이벤트로 찍는다.

기대 효과:

- 이번 표본의 `auth success` 10명 중 enter 없는 6명이 단계 완료자로 잘못 세어지는 일을 막는다.
- no_cli 사용자 3명 전원이 `auth success`를 갖고 있어도, 이들을 설치/인증 퍼널 완료자로 오독하지 않게 된다.

### P0. 설치 시도/결과/실패 분류를 구조화해서 찍기

대상: `runInstall()`, `runInstallAll()`, `installPackage()`, `installShell()`, `installNpmGlobal()`.

무엇을 바꾸나:

- 설치 시도 이벤트: rowId, model, strategy, platform, sourceHost, startedBy.
- 설치 결과 이벤트: success/fail, exitCode, postProbeInstalled, durationMs.
- 실패 분류: `missing_prereq:bash`, `missing_prereq:curl`, `missing_prereq:powershell`, `network_or_proxy`, `installer_exit`, `path_not_detected_after_success`, `npm_missing`, `npm_prefix_fallback`, `npm_exit`, `post_install_exec_failed`.
- stderr 원문은 싣지 않는다. 분류와 tail hash 정도만 허용한다.

기대 효과:

- 이번 표본에서는 설치 실패 원인별 통과 가능 인원을 산정할 수 없다. 이 계측 없이는 PATH/프록시/권한 후보를 고칠 순서를 데이터로 못 정한다.
- 다음 표본에서 `install enter`가 있는 사용자 1명 같은 케이스가 실제 PATH 문제인지 네트워크 문제인지 바로 갈라진다.

### P1. 첫 진입 배경 자동설치가 꺼진 상태를 제품 결정으로 확정하거나 되돌리기

대상: `v3/src/hooks/useCliSetupEngine.ts:135-145`, 비기너 원클릭 흐름.

무엇을 바꾸나:

- 현재 코드는 첫 진입 때 자동설치를 하지 않고 `AUTO_INSTALL_KEY`만 저장한다.
- 이 결정이 맞다면 용어를 "자동설치"가 아니라 "원클릭 설치"로 정리하고 계측도 그 이름으로 바꾼다.
- 진짜 자동설치가 목표라면, 사용자가 구독/CLI 선택을 마친 직후에는 별도 버튼 없이 설치가 실제로 시작되어야 한다.

기대 효과:

- 이번 no_cli 사용자 3명 중 2명은 install enter가 없어, "설치 버튼까지 오지 않음" 후보에 해당한다. 단 둘 다 auto_select probe 노이즈라 통과 개선 인원으로 단정할 수는 없다.
- 실제 개선 규모는 P0 계측 분리 후 다시 재야 한다.

### P1. auto_select는 후보별 실패 이벤트가 아니라 최종 선택 결과를 남기기

대상: `probePreferredOrchestratorHarness()`.

무엇을 바꾸나:

- 후보별 raw probe 결과는 내부 진단 이벤트로 남기되, 제품 퍼널 이벤트는 최종 결과 한 건만 남긴다.
- 예: `selected=claude`, `missingCandidates=[codex,grok]`, `readyCandidates=[claude]`, `blocked=false`.

기대 효과:

- 이번 U2/U3처럼 오케스트레이터가 열렸는데도 no_cli가 여러 건 쌓이는 오염을 없앤다.
- 이벤트 건수와 사용자 차단 횟수가 같은 방향으로 움직이게 된다.

### P2. survey_cli_fail 도달 경로를 넓히기

대상: 설치 실패 UI, 비기너 원클릭 blocked 화면, split shell banner.

무엇을 바꾸나:

- 현재 `survey_cli_fail`은 조회 결과가 없었다.
- 설치 실패 로컬 상태(`installErrors`, `bulkInstall.failedIds`)가 생겼을 때도 짧은 선택형 이유 수집을 붙인다.
- 선택지는 사용자 언어용이고 BQ에는 정규 코드만 넣는다.

기대 효과:

- 정량 계측이 놓친 사내망/권한 팝업/설치 안내 이해 실패를 보완한다.
- 단독으로는 통과 인원을 늘리지 않는다. 원인 판별 비용을 낮춘다.

## 6. 지금 당장 제품 수정 우선순위

지금 데이터로 "PATH를 고치면 몇 명, 프록시를 고치면 몇 명"은 말할 수 없다. 말하면 지어내는 것이다.

정직한 우선순위는 이렇다.

1. **계측 P0**: `orchestrator_auto_select`를 사용자 차단에서 제외한다. 이번 74건 중 66건이 여기다.
2. **계측 P0**: `auth success`를 cold-start readiness와 사용자 단계 완료로 분리한다. 현재 `auth success`는 enter 없이 찍힌다.
3. **계측 P0**: 설치 시도/결과/실패 분류를 남긴다. 그래야 PATH, 네트워크, 권한, 전제 도구 부재를 분해할 수 있다.
4. **제품 P1**: "자동설치"의 정의를 결정한다. 지금 코드는 첫 진입 배경 설치가 아니라 사용자가 누르는 원클릭 설치다.
5. **제품 P1 이후**: 계측이 분리된 뒤 실제 user-facing `not-installed` 사용자가 2명 이상 같은 원인으로 막히면 그 원인을 고친다.

## 7. 재현 쿼리

`events`에는 `installId`가 없으므로 `userId`만 썼다. 쿼리가 비면 대상보다 쿼리를 먼저 의심했다.

```sql
WITH b AS (
  SELECT
    event,
    userId,
    timestamp,
    appVersion,
    model,
    errorCategory,
    JSON_VALUE(metadata, '$.reason') AS reason,
    JSON_VALUE(metadata, '$.surface') AS surface
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'onboarding:spawn_blocked'
)
SELECT
  reason,
  errorCategory,
  surface,
  model,
  COUNT(*) AS events,
  COUNT(DISTINCT userId) AS users,
  MIN(timestamp) AS first_ts,
  MAX(timestamp) AS last_ts
FROM b
GROUP BY reason, errorCategory, surface, model
ORDER BY reason, users DESC, events DESC;
```

```sql
WITH se AS (
  SELECT
    userId,
    timestamp,
    JSON_VALUE(metadata, '$.step') AS step,
    JSON_VALUE(metadata, '$.phase') AS phase
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'onboarding:cli_setup_step'
),
per_user_step AS (
  SELECT
    userId,
    step,
    MIN(IF(phase = 'enter', timestamp, NULL)) AS first_enter,
    MIN(IF(phase = 'success', timestamp, NULL)) AS first_success,
    COUNTIF(phase = 'enter') AS enter_events,
    COUNTIF(phase = 'success') AS success_events,
    COUNTIF(phase = 'fail') AS fail_events
  FROM se
  GROUP BY userId, step
)
SELECT
  step,
  COUNTIF(first_enter IS NOT NULL) AS users_with_enter,
  COUNTIF(first_success IS NOT NULL) AS users_with_success,
  COUNTIF(first_success IS NOT NULL AND first_enter IS NULL)
    AS success_without_enter_users,
  COUNTIF(first_success IS NOT NULL AND first_enter IS NOT NULL
    AND first_success < first_enter) AS success_before_enter_users,
  SUM(enter_events) AS enter_events,
  SUM(success_events) AS success_events,
  SUM(fail_events) AS fail_events
FROM per_user_step
GROUP BY step
ORDER BY step;
```

## 8. 한계

- 고유 사용자가 3명이라 표본 부족이다.
- 퍼센트는 쓰지 않았다.
- `survey_cli_fail`은 결과가 없었다.
- 설치 stderr/stdout 원문은 BQ에 없고, 있어도 원문을 문서에 싣지 않는 것이 맞다.
- 지금 BQ로는 자동설치 실패 원인을 원인별 인원으로 분해할 수 없다.
- 따라서 이 문서의 고칠 것 목록은 "실패 원인 1위 수정"이 아니라 "먼저 잘못 세는 계측을 고치고, 설치 결과 원인 계측을 추가하라"가 핵심이다.
