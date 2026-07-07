# Packaged-app Google 로그인 (runbook)

티켓 `XscLxYM75DR9ou52o7Za` — v3.0.4 패키징 앱에서 **Google 로그인 버튼 무반응**
(signInWithRedirect 네비게이션 미발생 + 에러 표시 없음) 회귀의 근본원인·수정·검증·
후속 fallback(B안) 정리.

## 환경 특수성

패키징 앱은 `file://` 대신 electron main 의 `http.createServer` 로 뜬
`http://127.0.0.1:<랜덤포트>` static server 에서 로드된다 (`electron/main.ts` 의
`createWindow`). Firebase Auth redirect 가 authorized origin(`127.0.0.1`)으로 돌아올
수 있게 하려는 의도지만, 이 origin 에는 두 가지 제약이 있다:

1. **IndexedDB persistence 가 조용히 hang** — 네트워크 요청 이전 단계에서 멈춘다
   (티켓 `Oq63rrnxMYv6fdeNeani`). `onAuthStateChanged` 미발화의 원인이었고,
   같은 hang 이 `signInWithRedirect` 의 pending-redirect 상태 write 까지 멈춰서
   이번 "버튼 무반응" 회귀를 만들었다. redirect 는 resolve 도 reject 도 안 하고
   멈추므로 navigation 도 없고 catch 도 안 걸려 **완전 silent** 였다.
2. **랜덤 포트** — cross-launch 로 origin 이 매번 바뀌어 persistence 가 유지되지
   않고, OAuth redirect_uri 를 고정 등록하기 어렵다 (B안에서 중요).

과거 시도(전부 실패): #309 persistence, #311 popupRedirectResolver, #312/#314 COOP
헤더 strip(팝업 방식), #317 popup→redirect 전환(→ 이번 무반응 회귀).

## A안 — 이 PR 에서 적용한 수정 (외부 콘솔 변경 불필요)

### 1) persistence 순서 재정렬 — `src/lib/firebase.ts`

```
persistence: [browserLocalPersistence, indexedDBLocalPersistence, inMemoryPersistence]
```

IndexedDB-first → **localStorage-first**. localStorage 는 이 127.0.0.1 origin 에서
안정적으로 동작하므로 init hang 과 redirect pending-write hang 을 **동시에** 근본
제거한다. 랜덤포트라 cross-launch persistence 는 어차피 유지 안 되어 UX 손실 미미.

### 2) 진단 + 하드닝 + hang 가시화 — `src/auth/AuthProvider.tsx`

- **빌드 마커**: 부팅 시 `[auth] AuthProvider init (google-login=redirect-v2,
authDomain=…)` 를 찍는다. 패키징 콘솔에서 어떤 auth 빌드가 도는지 / authDomain
  이 실려있는지 즉시 확인 가능(스테일 빌드 판별).
- **단계별 로그**: `loginWithGoogle` enter → persistence set → signInWithRedirect
  → resolved/caught(code 포함). `getRedirectResult` 결과/에러도 로그.
- **resolver 명시**: `signInWithRedirect(auth, provider, browserPopupRedirectResolver)`.
- **redirect 전 setPersistence(browserLocalPersistence)**: pending-redirect write 가
  확실히 안정 store 로 가도록 강제(3s race 로 setPersistence 자체 hang 방어).
- **hang 워치독**: 8s 내 navigation 이 없으면(=stuck) **가시적 에러**를 띄운다.
  다시는 silent 무반응이 될 수 없다.

### 패키징 모드 검증

```
cd v3
npm run build            # tsc(electron) + check-firebase-env + vite build
grep -c 'google-login=redirect-v2' dist/assets/index-*.js   # ⇒ 1 (마커가 번들에 포함)
```

실기 확인: 패키징 빌드(또는 `MARBLO_FORCE_PROD=1`) 로 앱을 띄우고 DevTools 콘솔에서
`[auth]` 로그 관찰 —

- `AuthProvider init (google-login=redirect-v2, authDomain=marblo-2253d.firebaseapp.com)`
  가 보이면 최신 빌드 + authDomain 정상.
- Google 클릭 시 `enter → persistence set → signInWithRedirect` 후 accounts.google.com
  으로 navigation 되면 성공. 만약 여전히 멈추면 8s 뒤 에러 배너 + `no navigation
within 8000ms` 로그 → 아래 B안으로 전환.

## ★B안 — 시스템 브라우저 OAuth loopback (v3.0.5 로 redirect 근본 불가 확정 → **구현 완료**)

> **상태(2026-07-07, 티켓 `QvaYPAjAW822I0IDiwwZ`): 코드 구현 완료.**
> v3.0.5 콘솔 로그가 `persistence set → signInWithRedirect` 직후
> `no navigation within 8000ms — redirect appears stuck` 을 찍어, A안(#321 로
> persistence hang 은 해결됨)에서도 `signInWithRedirect` 가 top-level navigation
> 을 **시작조차 못함**을 확정했다. 커스텀 오리진(`http://127.0.0.1:PORT`)에서의
> Firebase JS SDK storage 파티셔닝 한계로 코드 우회가 불가하여 아래 B안을 실제
> 구현·머지한다. **남은 것은 GCP 콘솔 준비 + env 주입 + 실로그인 검증(사용자 몫)**.

in-window 웹 OAuth 를 완전히 버리고, 데스크톱 앱 표준 방식(Google "OAuth 2.0 for
Mobile & Desktop Apps", RFC 8252)으로 전환한다. 앱 창을 떠나지 않아 렌더러 상태
(터미널/에이전트)도 보존된다.

### 흐름

1. main 프로세스가 `127.0.0.1` 임시 http 서버 기동(loopback redirect 수신용).
2. Google authorize URL 을 `shell.openExternal` 로 **시스템 브라우저**에서 연다.
   PKCE(S256) 사용 → confidential secret 불필요.
   `https://accounts.google.com/o/oauth2/v2/auth?client_id=<CLIENT_ID>&redirect_uri=http://127.0.0.1:<port>&response_type=code&scope=openid%20email%20profile&code_challenge=<S256>&code_challenge_method=S256&state=<csrf>`
3. 사용자 인증 후 브라우저가 `http://127.0.0.1:<port>/?code=…&state=…` 로 리다이렉트.
4. main 이 `state` 검증 → `https://oauth2.googleapis.com/token` 에 code+code_verifier
   교환 → `id_token` 획득.
5. main → renderer 로 `id_token`(+`access_token`)을 IPC 반환(`electronAPI.auth.googleLoopback()`).
6. renderer: `signInWithCredential(auth, GoogleAuthProvider.credential(id_token, access_token))`.

### 구현된 파일 (이 PR)

| 파일                              | 역할                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/google-oauth.ts` (신규) | `runGoogleLoopbackOAuth()` — 127.0.0.1 loopback 서버 + PKCE(S256) + `state`(CSRF, timing-safe 비교) + `shell.openExternal` + 토큰 교환. ok/error 로만 resolve(절대 reject 안 함), 서버는 항상 close. 5분 타임아웃.                             |
| `electron/main.ts`                | `ipcMain.handle("auth:googleLoopback", …)` 등록.                                                                                                                                                                                               |
| `electron/preload.ts`             | `electronAPI.auth.googleLoopback()` contextBridge 노출.                                                                                                                                                                                        |
| `src/vite-env.d.ts`               | `AuthAPI` 타입 + `ElectronAPI.auth`.                                                                                                                                                                                                           |
| `src/auth/AuthProvider.tsx`       | `loginWithGoogle` 게이트: **패키징(`!import.meta.env.DEV` && IPC 브리지 존재)** 이면 loopback→`signInWithCredential`, **dev(vite)** 는 기존 redirect/popup 유지(회귀 없음). client id 미설정 시 명확한 에러(`auth.error.googleClientMissing`). |
| `src/locales/{ko,en}/auth.ts`     | `auth.error.googleClientMissing` 키.                                                                                                                                                                                                           |
| `.env.example`                    | 아래 env 문서화.                                                                                                                                                                                                                               |

### Google Cloud Console 준비 (사용자 1회 작업)

- **OAuth 클라이언트 타입 = "Desktop app"** 를 프로젝트 `marblo-2253d` 에 생성.
  - 랜덤 포트 때문에 loopback(`http://127.0.0.1:<any>`)을 포트 무관하게 받으려면
    Web 타입(정확 포트 매칭 필요)이 아니라 **Desktop 타입**이어야 한다.
  - Firebase `signInWithCredential` 은 동일 GCP 프로젝트에 속한 OAuth 클라이언트가
    발급한 Google id_token(`aud`)을 신뢰한다 → 같은 프로젝트의 Desktop 클라이언트면
    통과. (⚠️ 실검증 포인트: 최초 1회 `signInWithCredential` 에서 `aud` 거부가
    나오면, Firebase Auth → Google provider 의 "Web SDK configuration" Web client ID
    를 client_id 로 쓰고 loopback 을 **고정 포트**로 바꿔 그 Web 클라이언트에
    redirect_uri 등록하는 경로로 대체.)
- 또한 **Firebase Console → Authentication → Sign-in method → Google** provider 를
  **사용(enable)** 하고, 이 Desktop client ID 를 Google provider 의 허용 클라이언트로
  등록한다. (Firebase 는 동일 GCP 프로젝트의 OAuth 클라이언트가 발급한 id_token 의
  `aud` 를 신뢰하지만, provider 자체가 비활성이면 `signInWithCredential` 이
  `auth/operation-not-allowed` 로 거부된다.)
- 클라이언트 ID(+ Desktop 용 non-confidential secret)를 아래 env 로 주입.

### env (`.env.example` 에 문서화 — 실제 값은 `.env`, 커밋 금지)

```
# B안(loopback) 활성화 시에만 필요. CLIENT_ID 미설정 시 loopback 이 명확한
# 사용자향 에러("Desktop OAuth client 미설정")를 반환한다.
# CLIENT_ID 는 VITE_ 프리픽스 → 렌더러(게이팅·에러 메시지)도 읽는다. 공개 식별자라
# 노출 무방. main 프로세스는 dotenv 로 같은 값을 process.env 에서 읽는다.
VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID=<desktop-client-id>.apps.googleusercontent.com
# CLIENT_SECRET 은 VITE_ 프리픽스 아님 → 렌더러 번들에 인라인 안 됨, main(토큰
# 교환)만 사용. RFC 8252 상 데스크톱 앱에선 비밀 아니지만 Google "Desktop app"
# 클라이언트는 토큰 엔드포인트에서 이 값을 요구한다.
GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET=<desktop-client-secret>
```

client_secret 은 main 프로세스만 소유 — 렌더러엔 client_secret 노출 안 하고 최종
`id_token`/`access_token` 만 전달한다.

### 게이트 (안전한 점진 전환)

`loginWithGoogle` 이 **패키징 앱**(`!import.meta.env.DEV` && `electronAPI.auth.googleLoopback`
브리지 존재)에서만 loopback 경로를 타고, **dev(vite 서버)** 는 기존 redirect/popup
경로를 그대로 쓴다 → dev 로그인 회귀 없음. 패키징인데 `VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID`
가 비어 있으면 dead 버튼 대신 명확한 설정 에러를 띄운다.

### 검증 절차 (사용자 — GCP 클라이언트 생성 후)

코드/빌드 완결성은 이 PR 에서 보장(typecheck·`build:electron` 통과). 실로그인은 GCP
클라이언트가 있어야 하므로 아래를 사용자가 1회 수행:

1. 위 "Google Cloud Console 준비" 대로 **Desktop app** OAuth 클라이언트 생성 +
   Firebase Google provider enable.
2. `v3/.env` 에 `VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID`(+ `GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET`) 주입.
3. 패키징 빌드로 앱 실행(또는 `MARBLO_FORCE_PROD=1` 로 packaged 경로 강제). DevTools
   콘솔에서 Google 클릭 시:
   - `[auth] loginWithGoogle: loopback path` → 게이트가 loopback 을 선택.
   - **시스템 브라우저**가 `accounts.google.com` 계정 선택 화면으로 열림.
   - 로그인 완료 시 브라우저에 "로그인 완료, 창을 닫으세요" 페이지 표시.
   - 앱 콘솔: `loopback tokens received → signInWithCredential` →
     `loopback signInWithCredential ok` → `onAuthStateChanged` 가 로그인 사용자 픽업.
4. 실패 시 콘솔 에러 메시지로 분기:
   - `Desktop OAuth client 미설정` → env 누락.
   - `토큰 교환 실패: …` → client_secret 누락/오류 또는 redirect_uri 미스매치.
   - `signInWithCredential` 의 `auth/operation-not-allowed` → Firebase Google
     provider 비활성.
   - `aud` 거부가 나면(드묾), Firebase Google provider 의 "Web SDK configuration"
     Web client ID 를 `VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID` 로 쓰고 loopback 을 고정
     포트로 바꿔 그 Web 클라이언트에 redirect_uri 를 등록하는 경로로 대체.
