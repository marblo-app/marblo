# 첫 10분 테스트 2/5 — 첫 로그인 진단 (3.0.18)

- **티켓**: ETv4iYReqbEeK0vAzd4Y
- **범위**: 진단만 (수정 금지, git 조작 금지)
- **관점**: 신규 설치 = 패키지 3.0.18
- **방법**: 코드 트레이스 + `~/Desktop/marblo-3.0.18-release/Marblo-3.0.18-arm64.dmg` 정적 검증 (asar 추출/grep). ★라이브 오케·라이브 앱 미부착 (Playwright/Electron attach 금지 준수).
- **판정**: **PASS** — 로그인에서 반복적으로 터졌던 4종 회귀가 3.0.18 에 모두 해소됨. 코드 버그 없음. 단, 계측에 **구조적 맹점 1건**(버그 아님, 아래 §6).

---

## 1. 검증한 것

로그인은 이 프로젝트에서 여러 번 터진 지점이라, 각 회귀가 **실제 배포된 3.0.18 번들**에 반영됐는지를 소스 트레이스와 dmg 번들 문자열 대조 양쪽으로 확인했다.

| #   | 과거 회귀                                                      | 3.0.18 상태 | 근거                                                                      |
| --- | -------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| 1   | `signInWithRedirect` 가 Electron 서 조용히 실패 (loopback fix) | ✅ 해소     | `electronAPI.auth.googleLoopback` 존재 시 loopback 우선 (dev+패키지 공통) |
| 2   | 패키징 heartbeat IndexedDB hang (fetch 전 open)                | ✅ 해소     | firebase init **前** `window.indexedDB` 중화                              |
| 3   | 새 창마다 랜덤포트 origin → auth 미공유                        | ✅ 해소     | 단일 shared static server + 포트 영속                                     |
| 4   | 로그인 성공 ≠ 토큰 sync 성공 (직접 로그인서 sync 실패 회귀)    | ✅ 해소     | 익명 폴백 제거, 거부 시 `ok:false` 정직 반환 + 재시도                     |

---

## 2. 회귀별 상세 (코드 근거)

### 2-1. signInWithRedirect 조용실패 → loopback 우선 (회귀 1)

- `src/auth/AuthProvider.tsx:319` — `loginWithGoogle()` 단일 진입점에서 `typeof window.electronAPI?.auth?.googleLoopback === "function"` 이면 **무조건 loopback 경로**로 분기 (패키지 + Vite dev-in-Electron 공통). 예전엔 dev 가 in-window `signInWithRedirect` 로 게이트돼 계정 선택창에 도달조차 못 했음(3rd-party storage partitioning). Web(no electronAPI)만 redirect 폴백.
- 패키지에선 `getRedirectResult` 도 스킵 (`AuthProvider.tsx:175`, `isPackagedLoopbackAuth`) — authDomain iframe hang(티켓 KVId8CCsu8pXYGhRGtz3) 회피.
- 시스템 브라우저 loopback OAuth 는 `electron/google-oauth.ts` — RFC 8252 + PKCE(S256) + `state` CSRF + 127.0.0.1 loopback 전용. id_token 을 렌더러로 반환 → `signInWithCredential`.
- **번들 확인**: 렌더러 `isPackagedLoopbackAuth`, `loopback signInWithCredential`, `google-login=redirect-v3-idb-heartbeat-fix`(AUTH_BUILD_TAG) / main `runGoogleLoopbackOAuth`,`auth:googleLoopback` 모두 present.

### 2-2. heartbeat IndexedDB hang → IndexedDB 중화 (회귀 2)

- `src/lib/firebase.ts:74` — `isPackagedLoopbackAuth` 일 때 firebase `initializeApp` **前** `Object.defineProperty(window,"indexedDB",{value:undefined})`.
- 근본원인(주석 39–73행 명시): 패키지 로그인 마지막 단계 `signInWithCredential` 이 ≈30s 뒤 `auth/network-request-failed`. 진범은 네트워크가 아니라 `@firebase/app` HeartbeatServiceImpl 이 헤더 준비 시 `indexedDB.open()` 을 호출하는데 127.0.0.1 static-server origin 에선 이게 success/error 를 영영 발화 안 하고 hang → 헤더 pending → 실제 fetch 미발사 → 30s NetworkTimeout. IndexedDB 를 없애면 firebase 가드가 즉시 false 반환 → heartbeat `''` 즉시 → fetch 정상 발사.
- 안전성(주석): 이 앱에 IndexedDB 소비자 없음 (auth=localStorage-first, Firestore=memory cache). dev/웹은 미변경 → 회귀 없음.
- **번들 확인**: 렌더러에 `IndexedDB neutralized` 문자열 present.

### 2-3. 새 창 랜덤포트 origin → 단일 static server (회귀 3)

- `electron/main.ts:1020~1139` — 예전엔 `createWindow` 안에서 창마다 `http.createServer(listen(0))` 를 새로 띄워 창마다 origin(포트)이 달라짐 → 새 창이 첫 창의 persisted 세션을 못 봄 → 로그인 화면 재노출. 지금은 **단일 shared static server**(`startStaticServer`, 멱등 Promise)를 모든 창이 공유.
- `staticServerPort` 를 appState 에 영속(`main.ts:387`, `writeAppState`)해 **다음 실행에서도 같은 origin 재사용** → 재시작 후 재로그인 불필요. 포트 점유 시 랜덤 폴백(그 실행만 persistence reset).
- **번들 확인**: main 에 `staticServerPort` present (2회).

### 2-4. 로그인 성공 ≠ 토큰 sync (회귀 4) — 가장 중요

- `electron/firebase-auth-sync.ts:45` `syncAgentCustomToken` — 렌더러가 Cloud Function `issueAgentCustomToken` 에서 받은 custom token 을 IPC 로 전달하면 main 의 mission app 을 실사용자 uid 로 `signInWithCustomToken`. **거부 시 익명 폴백을 하지 않고 `ok:false` 로 정직 반환**(티켓 etTRzsjqSr3S60xS5Wva/7qohuvyFNHRJFQP5SubV). 예전엔 거부돼도 `signInAnonymously` 후 `ok:true` 를 반환해 렌더러가 sync 성공으로 오인 → '로그인 성공했는데 에이전트는 미인증' 회귀의 뿌리였음.
- 죽은 토큰이 spawn 에이전트에 상속되지 않도록 실패 시 `MARBLO_FIREBASE_CUSTOM_TOKEN` env 삭제.
- `src/services/agentAuthService.ts:65` — 3회 재시도(0/500/1500ms), 최종 실패 시 `clearAgentCustomToken` + throw → 렌더러에서 에러 표면화.
- `AuthProvider` 는 모든 성공 경로(loopback/redirect-result/email/signup/github) 및 `onIdTokenChanged` 옵저버(`:222`)에서 `syncAgentFirebaseAuthForUser` 호출 → 토큰 갱신 자동 재sync.
- **번들 확인**: main 에 `no anonymous fallback`, `MARBLO_FIREBASE_CUSTOM_TOKEN` present.

---

## 3. custom-token 이 메인 프로세스에 실제 도달하는가 (핵심 질문)

경로 전 구간 배선 확인:

```
렌더러: user.getIdToken() → issueAgentCustomToken() [Cloud Fn, us-central1]
      → electronAPI.auth.syncAgentCustomToken(customToken)   [preload.ts:79]
      → ipcRenderer.invoke("auth:syncAgentCustomToken")       [preload]
메인:  ipcMain.handle("auth:syncAgentCustomToken")            [main.ts:3669]
      → syncAgentCustomToken()  → signInWithCustomToken(missionApp) [firebase-auth-sync.ts:55]
      → process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = token       [spawn 에이전트/MCP 상속]
```

- preload 표면(`electron/preload.ts:72`): `auth.googleLoopback / syncAgentCustomToken / clearAgentCustomToken` 전부 노출.
- main IPC 핸들러(`main.ts:3664/3669/3683`): 3개 모두 등록. `runGoogleLoopbackOAuth` import(`main.ts:67`).
- 판정: custom-token 이 메인 프로세스 mission app 로그인까지 도달하는 경로가 코드·배선·번들 모두에서 성립. 과거 #406/#428 계열의 "메인 프로세스 미인증" 회귀는 이 경로로 차단됨.

---

## 4. 배포된 3.0.18 런타임 config 실재 여부 (make-or-break)

로그인은 config 없으면 그냥 죽으므로 dmg 내 실파일을 존재/키만 확인(★값 미출력, 마스킹).

| 파일                                                  | 용도                                            | 3.0.18 상태                                                                            |
| ----------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Resources/oauth-config.json`                         | main loopback OAuth (`clientId`,`clientSecret`) | ✅ clientId present(`…usercontent.com`), secret present                                |
| `Resources/dist-mcp/firebase-config.json`             | main custom-token용 firebase config             | ✅ 6키(apiKey/authDomain/projectId/storageBucket/messagingSenderId/appId) 전부 present |
| 렌더러 `dist/assets/*.js` (build-time baked VITE\_\*) | 렌더러 firebase                                 | ✅ apiKey(AIza…) + authDomain(`*.firebaseapp.com`) baked                               |

- main 은 `electron/main.ts:189` 에서 패키지 시 `oauth-config.json` 을 `process.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID/GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET` 로 주입, `electron/firebase-config-env.ts` 로 `firebase-config.json` → `(VITE_)FIREBASE_*` 주입. 패키지엔 `.env` 없으므로 이 두 경로가 실질 config 소스.

### 4-1. 오탐 주의 — 렌더러에 client id 문자열 0개는 버그 아님 (DCE)

- 렌더러 JS 에 `googleusercontent` 문자열이 **0개**라 처음엔 "`loginWithGoogleLoopback` 의 렌더러 pre-check(`import.meta.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID`)가 빈값→로그인 차단" 회귀를 의심했음.
- 그러나 컴파일된 번들 확인 결과: "loopback path" 로그 직후 **곧바로** `try{const g=await window.electronAPI.auth.googleLoopback()` 로 이어지고, 소스의 pre-check 블록(AuthProvider.tsx:251–257)과 "…CLIENT_ID is empty" 문자열이 **통째로 사라져 있음**.
- 이는 Vite 가 빌드타임에 `import.meta.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID` 를 **truthy 문자열로 인라인** → `if(!truthy)` = `if(false)` → esbuild 가 죽은 분기(및 그 유일한 client-id 문자열 참조)를 제거한 결과. 즉 client id 가 **빌드에 실제로 baked** 됐다는 증거이지 누락이 아님. (빈값이었다면 `if(true)` 라 pre-check 블록과 "is empty" 문자열이 남았어야 함 — 실제로는 없음.)
- 결론: 렌더러 pre-check 는 통과(제거)되고, main loopback 이 `oauth-config.json` 의 실 client id 로 동작. Google 로그인 미차단.

---

## 5. 계측(#542) 이 이 경로에서 발화하는가

- `src/services/telemetryService.ts:496~517` — `loginAttempt(method)` / `loginSuccess(method,isNewUser?)` / `loginFailed(method,code)` → `auth:login_attempt/success/failed`.
- `AuthProvider` 발화 지점:
  - `loginAttempt`: google(`:309`) / github(`:399`) / email(`:416`) / signup(`:437`) 각 진입점 1회.
  - `loginSuccess`: loopback(`:288`), redirect-result(`:183`), github(`:403`), email(`:424`), signup(`:445`).
  - `loginFailed`: loopback/no-token(`:264`), loopback catch(`:301`), redirect-result catch(`:201`), no-auth-domain(`:339`), redirect-stuck(`:374`), redirect catch(`:393`), github/email/signup catch. code 는 Firebase 에러**코드만**(이메일 유출 방지, `authErrorCode`).
- **번들 확인**: 렌더러에 `auth:login_attempt/success/failed` 문자열 present → 배포본에 계측 코드 실재.

---

## 6. ★유일한 발견 — 계측 구조적 맹점 (버그 아님, 상위 활성화퍼널 관련)

`telemetryService.ts:481~487` 주석에 명시된 정직성 한계:

- `logTelemetry` 는 `flushTelemetry` 에서 **`auth.currentUser` 가 있을 때만** 서버(BQ)로 전송(anti-abuse gate).
- 따라서 로그인-**이전** 이벤트(`app:first_run` / `auth:login_attempt` / `auth:login_failed`)는 로컬 큐에 쌓였다가 **"다음 성공적 로그인"** 시점에 함께 flush 됨.
- 귀결:
  - 실패 후 재시도해 **결국 성공한** 유저의 초기 마찰(실패→성공)은 잡힘. ✅
  - **끝내 로그인에 성공 못 한** 유저의 실패는 **영영 전송 안 됨**. ❌
- 이는 auth-gated 싱크의 구조적 한계로, 베타 이탈 근본원인 리포트 §5-2("로그인/설치 미계측이 최대맹점")를 **완전히는 못 메운다**. 상위 에픽("첫 10분 활성화 퍼널")의 "첫 로그인 실패" 지표가 신규 미가입/이탈 유저에 대해선 구조적으로 불완전함을 의사결정에 반영해야 함.
- **수정 대상 아님**(진단 티켓). 별도 티켓 후보: 로그인-이전 실패 이벤트의 비인증 전송 경로(예: 익명/디바이스 스코프 엔드포인트) 검토.

---

## 7. 한계 (정직성)

- 라이브 앱 부착·실제 클릭 로그인 왕복은 규칙상 금지(Me11Ze8kvI35LvONzU9F). 본 진단은 **코드 트레이스 + 배포 번들 정적 문자열 대조**로, "코드/설정이 옳게 배포됨"을 입증한다. 실토큰 왕복(로그인 버튼 클릭→계정선택→signInWithCredential→custom-token 메인 도달)의 **런타임 성공 자체는 실측 아님** — 과거 교훈("코드게이트 PASS ≠ 라이브 토큰 왕복", PR#428/#430)을 재확인해 둔다.
- 이 왕복 실측은 사용자만 가능(스크린샷/라이브 관측). 필요 시 오케를 통해 사장님 실기기 로그인 1회 확인 권장.

---

## 8. 결과 요약

```
## 테스트 결과 (정적 검증)
- 검증 대상: 4종 로그인 회귀 + custom-token 메인 도달 + #542 계측 + 런타임 config
- 회귀 해소: 4/4 (코드+번들 확인)
- config 실재: oauth-config.json / firebase-config.json / 렌더러 baked 전부 OK
- 계측 발화: attempt/success/failed 전 경로 OK
- 버그: 0

## 발견된 이슈
1. [info/구조적] 로그인-이전 계측(login_attempt/failed)이 auth-gated flush 라
   끝내 로그인 못 한 유저의 실패는 BQ 미전송 — telemetryService.ts:481.
   버그 아님(설계상 한계, 주석 명시). 상위 활성화퍼널 지표 해석에 반영 필요.
```
