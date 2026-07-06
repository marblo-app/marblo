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

## ★B안 — 시스템 브라우저 OAuth loopback (redirect 가 근본 불가로 확정될 때)

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
5. main → renderer 로 `id_token` 을 IPC 전달(`electronAPI.auth.googleLoopback()`).
6. renderer: `signInWithCredential(auth, GoogleAuthProvider.credential(id_token))`.

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
- 클라이언트 ID(+ Desktop 용 non-confidential secret)를 아래 env 로 주입.

### env (`.env.example` 에 문서화)

```
# B안(loopback) 활성화 시에만 필요. 비어있으면 A안 redirect flow 로 폴백.
GOOGLE_OAUTH_CLIENT_ID=<desktop-client-id>.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=<desktop-client-secret>   # RFC 8252: 데스크톱 앱에선 비밀 아님
```

main 프로세스가 소유(process.env) — 렌더러엔 client_id/secret 노출 안 하고 최종
`id_token` 만 전달한다.

### 안전한 점진 전환

`GOOGLE_OAUTH_CLIENT_ID` 가 설정돼 있으면 `loginWithGoogle` 이 loopback 경로를,
없으면 기존 redirect 경로(A안)를 쓰도록 게이트 → 콘솔 준비 완료 전까지 현행 동작
무손상. 게이트 + IPC + 토큰교환 코드는 이 PR 범위 밖(콘솔 준비·실검증과 함께 후속
PR 에서), 본 문서를 스펙으로 사용.
