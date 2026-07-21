# 첫 10분 테스트 3/5 — 폴더 연결 → 오케 자동오픈 (진단 전용)

- 티켓: `thennLyi1CtlXPFKBOOz`
- 범위: 코드 트레이스 + 3.0.18 패키지 정적 검사. **수정/커밋 없음.**
- 라이브 오케 세션 미접촉. Playwright/Electron 라이브 부착 안 함(규칙 준수).
- 대상 버전: worktree HEAD = `v3/package.json` 3.0.17, 검사한 릴리스 dmg/zip = 3.0.18(빌드가 HEAD 한 칸 앞섬).

## 요약 판정

| 항목                                       | 판정                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| 폴더연결→오케 자동오픈 경로                | ✅ 배선 정상. 무클릭 등록→currentProject 갱신→auto-launch 트리거                 |
| `cli_auth` 로 멈추는 지점(#542)            | ✅ 정확히 계측됨. `orchestratorBlocked("cli_auth")` + 게이트 오픈 + 재개 래치    |
| 첫인사(티켓/스폰 제안)까지 도달            | ⚠️ 부트 프롬프트로 지시는 됨(신규 claude 세션 한정). **도달 여부는 미계측**      |
| 3.0.18 패키지 메인프로세스 firebase config | ✅ 정상. config 파일 존재·6키 전부(과거 회귀 재현 안 됨)                         |
| onboarding 4개 이벤트 발화                 | ✅ 코드상 4개 모두 배선(folder_connected/\_failed/orchestrator_opened/\_blocked) |

---

## 1. 경로 트레이스 (folder → project → orchestrator)

1. **폴더 선택 → 프로젝트 등록** — `src/hooks/useProjectSetup.ts`
   - `handleSelectDirectory()` (Layout.tsx:199 에서 마운트, `marblo:select-folder` 로도 진입)
   - `fs.selectDirectory()` → `findByPathOrRemote` 중복가드
     - 기존 프로젝트: `setCurrentProject(refreshed)` + `telemetry.folderConnected("existing", …)` (`useProjectSetup.ts:202`)
     - 신규: `autoRegisterProject()` **무클릭 등록** → `setCurrentProject(...)` + `telemetry.folderConnected("new", …)` (`:139`)
     - 미로그인/쓰기실패 폴백: 인라인 이름배너 → `folderConnected("inline")` (`:291`) / 쓰기실패 `folderConnectFailed("write_error")` (`:153`, `:298`)

2. **currentProject 갱신 → 오케 자동오픈** — `src/hooks/useOrchestratorAutoLaunch.ts` (Layout.tsx:199 마운트)
   - `fixedRoot = currentProject.folderPath` 를 키로 사용(rootPath 아님 — 워크트리 브라우징에 오케가 안 죽도록. 파일 헤더 주석 근거)
   - `tryAutoConnect()`: `resolvePrevious(fixedRoot, projectId)` → `orchestratorSession.launch(projectId, fixedRoot, resumeId)` (`:69-81`)

3. **메인 프로세스 launch** — `electron/main.ts:5514` `orchestratorSession:launch`
   - `checkSpawnAuthGate(orchestratorModel)` (`:5536`) — CLI 미설치/미인증이면 `{status:"blocked", needsAuth:{...}}` 반환(로그인 프롬프트로 스폰하지 않음)

## 2. `cli_auth` 로 멈추는 지점 (#542 계측 위치) — ✅ 정확

`useOrchestratorAutoLaunch.ts:86-95`:

```
if (result?.needsAuth) {
  telemetry.orchestratorBlocked("cli_auth");   // "시도했으나 CLI 미설치/미인증"
  setStatus("stopped");
  autoConnectRef.current = false;              // 래치 해제(재개용)
  window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));  // 게이트 오픈
  return;
}
```

- 이게 근본원인분석 22→6(−73%)에서 **"시도조차 안 함" vs "시도했으나 CLI 막힘"** 을 가르는 지점. 정상 배선.
- 인증 완료 시 `CliSetupGate` 가 `marblo:cli-auth-ready` 발사(`CliSetupGate.tsx:383`) → `useOrchestratorAutoLaunch.ts:130-139` 가 **재시작 없이** launch 재개. 오케-우선 온보딩(folder→project→auth→orchestrator) 폐루프 완결.
- 예외 경로: launch 자체가 throw → `orchestratorBlocked("launch_error")` (`:115`) — cli_auth 와 구분됨.
- 성공: `orchestratorOpened(!!priorId)` (`:98`), resumed 여부 메타 동봉.

## 3. 첫인사(티켓/스폰 제안) 도달 여부 — ⚠️ 부트러는 있으나 도달 미계측

- **부트러 존재**: `electron/orchestrator-manager.ts:85` `BOARD_ORCHESTRATOR_ONBOARDING` —
  "greet the user first … mention /tf-add, /tf-start, /tf-status … 작업 요청하시면 보드에 티켓 생성하고 에이전트 스폰해드릴게요."
  → `launch()` 의 initialPrompt 로 `writeAndSubmit` (`orchestrator-manager.ts:993-1021`).
- **조건**: (a) claude 모델만(gpt 제외, `:997`), (b) **신규 세션만**(resumed 는 부트 프롬프트 미전송 `:948`).
- **판정**: 신규 유저(무클릭 등록 직후 = 신규 세션 + claude)는 첫인사 경로에 있음. **단 아래 사각지대 존재.**

### 발견 사각지대 (수정 아님, 다음 티켓 후보)

- **[중] 첫인사 도달 미계측** — `orchestrator_opened` 는 PTY launch 가 non-blocked 로 리턴되는 **순간** 발화(`useOrchestratorAutoLaunch.ts:98`). 그러나 첫인사가 실제로 유저에게 전달됐는지는 별도 이벤트가 없다.
  - 재현 시나리오: IPC 게이트(`checkSpawnAuthGate`)는 통과했는데 그 직후 PTY 가 `claude login` 으로 부팅(게이트-스폰 사이 토큰 만료) → 로그인 백스톱이 부트 프롬프트를 **suppress**(`orchestrator-manager.ts:1050-1058`). 결과: telemetry 는 `orchestrator_opened=success` 인데 유저 화면엔 인사 없는 터미널. "떴다"와 "떴지만 침묵"을 구분 불가.
  - 권장: greeting 전송/미전송을 별도 계측(예: `onboarding:orchestrator_greeted` 또는 opened 메타에 `greetingSent` 플래그).
- **[낮] resumed 세션 무인사(설계상)** — 복귀 유저는 첫인사 안 봄(`:948`). 의도된 동작이나, 첫인사는 오직 진짜 신규 세션에만 유효함을 명시.
- **[중, 상류·#542 기지식] 로그인/설치 자체 미계측** — 퍼널이 `folder_connected` 에서 시작. "앱은 켰으나 폴더 픽 전 이탈", "로그인 성공" 이벤트가 없어 folder_connected **이전** 드롭오프 귀속 불가. (메모리 `beta_churn_activation_not_value_2026_07` 의 최대 맹점과 일치.)

## 4. onboarding 4개 이벤트 발화 — ✅ 배선 확인

`src/services/telemetryService.ts:39-42, 519-555` 에 4개 정의·발화:

| 이벤트                             | 발화 지점                                                    | success |
| ---------------------------------- | ------------------------------------------------------------ | ------- |
| `onboarding:folder_connected`      | useProjectSetup `:139/:202/:291`                             | true    |
| `onboarding:folder_connect_failed` | useProjectSetup `:153/:298`                                  | false   |
| `onboarding:orchestrator_opened`   | useOrchestratorAutoLaunch `:98`                              | true    |
| `onboarding:orchestrator_blocked`  | useOrchestratorAutoLaunch `:90(cli_auth)/:115(launch_error)` | false   |

(실제 BQ 적재 발화는 라이브 관측 필요 — 본 진단은 코드상 배선까지. 텔레메트리 프로덕션 ON 은 메모리 `telemetry_production_on_2026_07_17` 로 기확인.)

## 5. 3.0.18 패키지 메인프로세스 firebase config — ✅ 회귀 없음

과거 이력(메모리 `packaged_mainproc_firebase_config_orch_switch`): 패키지 메인프로세스 Firebase config 부재 → apiKey="" → invalid-api-key → 오케전환 무반응(dev 정상, 패키지만).

3.0.18 정적 검사 결과 **재현 안 됨**:

- 로더 존재: `electron/main.ts:166` `loadPackagedMainFirebaseConfigEnv({ resourcesPath })` → `electron/firebase-config-env.ts` 가 `Resources/dist-mcp/firebase-config.json` 읽어 FIREBASE*\*/VITE_FIREBASE*\* 주입.
- 파일 존재: `Marblo-3.0.18-arm64-mac.zip` 내 `Marblo.app/Contents/Resources/dist-mcp/firebase-config.json` (287B) 확인.
- 키 완비: apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId **6키 전부 존재**, apiKeyPresent=true, projectId=marblo-2253d. (값 원문 미출력 — 보안 가드레일 준수.)

→ 3.0.18 에서 오케 자동오픈이 firebase config 부재로 무반응할 경로는 닫혀 있음.

## 결론

폴더연결→오케 자동오픈 배선과 #542 `cli_auth` 계측은 정상. 3.0.18 firebase config 회귀도 없음.
남는 리스크는 **첫인사 "도달" 미계측**(게이트통과-후-로그인 suppress 시 opened=성공인데 침묵) — 활성화 퍼널의 마지막 한 칸이 관측 사각. 상류의 로그인/설치 미계측(#542 기지식)과 함께 다음 계측 티켓 후보.
