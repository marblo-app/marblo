# Sentry 런북 — DSN 설정 · 배선 · 검증 · 어드민 연동

크래시/에러 리포팅(@sentry/electron v7)의 설정·동작·검증 절차.
**실제 DSN 값은 이 문서에 절대 적지 않는다.**

---

## 0. TL;DR — 2026-07-24 에 고친 것

`initMainSentry` 가 **모든 빌드(dev·prod)에서 항상 실패**하고 있었다. DSN 은 처음부터
정상이었다.

`@sentry/electron` 의 `ipcMode` 기본값은 `Both`(= `Classic | Protocol`)이고, `Protocol`
쪽이 `protocol.registerSchemesAsPrivileged` 를 호출한다. 이건 Electron 이 **`app`
'ready' 이벤트 이전에만** 허용하므로, 그 뒤에 호출하면 SDK 가 이렇게 던진다:

```
Error: Sentry SDK should be initialized before the Electron app 'ready' event is fired
    at configureProtocol (@sentry/electron/main/ipc.js:175)
```

그런데 우리 설계는 **의도적으로 consent 이후에 렌더러가 IPC 로 늦게 구동**한다(PIPA
옵트인: 동의 전엔 네이티브 크래시 핸들러조차 설치하지 않음). 즉 init 은 구조적으로
**항상 post-ready** → 매번 throw → `initMainSentry` 가 `false` 반환 → 렌더러
`maybeInitSentry` 도 `!res.ok` 로 조기 return → **메인·렌더러 양쪽 다 init 안 됨.**

**수정:** `electron/sentry-main.ts` 의 `Sentry.init` 에 `ipcMode: IPCMode.Classic` 추가.
Classic 은 protocol 등록 없이 평범한 `ipcMain`/`ipcRenderer` 채널만 쓰고, 그 채널은
`electron/preload.ts` 의 `require("@sentry/electron/preload")` 가 이미 깔아준다 →
기능 손실 없음.

> ⚠️ `ipcMode: Classic` 과 preload 의 `@sentry/electron/preload` require 는 **한 쌍**이다.
> 둘 중 하나만 지우면 렌더러 이벤트가 메인에 도달하지 못한다.
> 회귀 방지: `tests/unit/sentry-main-init.test.ts`.

---

## 1. DSN 발급 · 설정

1. sentry.io → 조직 → **Projects → Create Project** → 플랫폼 `Electron`.
2. 생성 후 **Settings → Client Keys (DSN)** 에서 DSN 복사.
   형식: `https://<publicKey>@<org>.ingest.<region>.sentry.io/<projectId>`
   (publicKey 는 공개값이지만, 그래도 커밋·로그에 남기지 않는다.)
3. 아래 파일에 넣는다. **둘 다 `.gitignore` 대상**이다.

   | 파일                 | 용도                          | `VITE_SENTRY_ENVIRONMENT` |
   | -------------------- | ----------------------------- | ------------------------- |
   | `v3/.env`            | `npm run dev`                 | `development`             |
   | `v3/.env.production` | `npm run build:mac` 등 릴리스 | `production`              |

   ```
   VITE_SENTRY_DSN=<발급받은 DSN>
   VITE_SENTRY_ENVIRONMENT=production
   ```

### ★ 함정: 격리 워크트리에는 `.env` 가 없다

`.env*` 는 gitignore 라 `git worktree` 로 만든 에이전트 작업 트리에는 **존재하지 않는다.**
그 트리에서 `vite build` 하면 DSN 이 안 구워진 앱이 나온다.
**릴리스 빌드는 반드시 메인 체크아웃(`~/Documents/programming/marblo/v3`)에서** 한다.

CI 는 `.env.production` 이 없으므로 CI 산출물엔 DSN 이 없다. 현재 맥 릴리스는 로컬
빌드라 문제 없음(사장님 결정). CI 빌드를 릴리스에 쓰게 되면 그때
`VITE_SENTRY_DSN` 을 GitHub Secret 으로 주입해야 한다.

---

## 2. 배선 (읽는 순서)

```
src/components/legal/PrivacyConsentGate.tsx:44   consent 변화 → maybeInitSentry(consent.sentry)
src/components/settings/PrivacySettings.tsx:64   설정 토글 → 같은 함수
        │
src/lib/telemetry/sentry.ts  maybeInitSentry(consented)
        │   게이트 3중: ① consented ② VITE_SENTRY_DSN ③ window.electronAPI.sentry.initMain 존재
        ▼
electron/preload.ts:478      sentry.initMain → ipcRenderer.invoke("sentry:init-main")
        ▼
electron/main.ts:6247        ipcMain.handle("sentry:init-main") → initMainSentry(opts)
        ▼
electron/sentry-main.ts      @sentry/electron/main init (ipcMode Classic, beforeSend 스크럽)
        ▼ ok:true 여야
src/lib/telemetry/sentry.ts  @sentry/electron/renderer init (dsn 없이 — IPC 로 상속)
```

- DSN/release/environment 의 **단일 소스는 렌더러**(빌드시 `import.meta.env` 인라인).
  메인은 IPC 로 전달받는다 — 메인에 별도 env 배선 없음.
- 타입은 `electron/sentry-electron.d.ts` 의 **수기 스텁**이 패키지 타입을 가린다.
  새 SDK 옵션을 쓰려면 여기 먼저 선언해야 한다. (이 스텁에 `ipcMode` 가 없던 것이
  위 장애가 컴파일 단계에서 안 잡힌 이유다.)

---

## 3. 동작 검증

### 3-1. 앱에서 (dev 포함 — PROD 게이트 없음)

1. 설정 → 개인정보 → **Sentry 크래시 리포트 동의 ON**.
2. devtools 콘솔에서 아래 두 줄을 확인:
   - 메인 프로세스(터미널): `[Sentry:main] initialized (env=..., release=..., ipcMode=Classic)`
   - 렌더러(devtools): `[Sentry] initialized (env=..., release=...)`
3. 실패 시 콘솔이 원인을 그대로 알려준다:
   - `[Sentry] VITE_SENTRY_DSN not set — skipping init.` → `.env` 문제
   - `[Sentry] main-process bridge unavailable — skipping init.` → preload 미반영(앱 재시작 필요)
   - `[Sentry:main] init failed: ...` → SDK 레벨 실패(위 ipcMode 이슈 등)
4. 테스트 이벤트: devtools 콘솔에서 `setTimeout(() => { throw new Error("sentry test") })`
   → sentry.io Issues 에 뜨는지 확인.

> ⚠️ `electron/` 하위(main·preload·sentry-main)를 고치면 **앱 full 재시작**이 필요하다.
> `tsc --watch` 재컴파일만으론 실행 중인 메인 프로세스가 갱신되지 않는다(렌더러만 HMR).

### 3-2. 앱 없이 (헤드리스 probe)

앱을 재시작하지 않고 메인 경로만 확인하고 싶을 때 — 실제 컴파일된 모듈을 그대로 호출:

```js
// probe.js — electron ./probe.js 로 실행
const { app } = require("electron");
app.whenReady().then(async () => {
  const m = require("<v3>/dist-electron/sentry-main.js");
  console.log(
    "init:",
    await m.initMainSentry({
      dsn: process.env.PROBE_DSN,
      environment: "development",
    }),
  );
  const S = require("@sentry/electron/main");
  S.captureException(new Error("probe"));
  console.log("flush:", await S.flush(10000));
  app.exit(0);
});
```

`app.isReady() === true` 상태에서 `init: true` 가 나와야 정상이다(수정 전엔 `false`).

DSN 자체의 생존 여부만 보려면 ingest 에 envelope 를 직접 POST 해도 된다
(`POST https://<host>/api/<projectId>/envelope/?sentry_key=<publicKey>&sentry_version=7`,
`Content-Type: application/x-sentry-envelope`) → `200` + `{"id": ...}` 이면 DSN 정상.

---

## 4. 프라이버시 불변식 (건드리기 전에 읽을 것)

- **동의 전 무동작.** 동의 없이는 메인 SDK 조차 로드하지 않는다(네이티브 크래시
  핸들러도 미설치). 이 lazy-init 설계가 위 ipcMode 제약의 원인이므로, "boot 때 미리
  init 하자" 는 해법은 **PIPA 옵트인을 깨므로 금지**.
- **DSN 없으면 완전 no-op.** 회귀 가드.
- **항상 스크럽.** 동의 여부와 무관하게 모든 이벤트가 `beforeSend` 를 통과한다
  (파일경로/이메일/전화/API 키 마스킹, `user`·`server_name` 제거, `prompt`·`message` 등
  자유서술 필드 통째 drop). 렌더러는 `src/lib/telemetry/scrub.ts`, 메인은
  `electron/sentry-main.ts` 에 **의도적으로 중복** 구현 — tsconfig rootDir 가 갈려
  cross-import 가 불가능하다. **수정 시 반드시 양쪽을 함께 고칠 것.**
- `sendDefaultPii: false` 고정.

---

## 5. 알려진 갭 (후속)

1. **`captureException`/`captureMessage` 호출부가 없다.** export 만 되어 있고 앱
   어디서도 부르지 않는다 → 현재 수집되는 건 SDK 전역 핸들러가 잡는
   uncaught error / unhandled rejection / 네이티브 크래시뿐이다. React
   ErrorBoundary·주요 catch 블록 연동은 별도 티켓.
2. **어드민 안정성 패널이 정적 플레이스홀더다.** 아래 6절.

---

## 6. 어드민 실데이터 연동 스케치 (미구현 — 설계만)

대상: `marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx` 의 "안정성·에러율" 섹션.
지금은 하드코딩된 안내 문구이고 Sentry 를 조회하는 코드가 **아예 없다.**

### 필요한 것 (사장님 승인 필요)

| 항목               | 값                                                          |
| ------------------ | ----------------------------------------------------------- |
| Sentry Auth Token  | Organization Auth Token, 스코프 `org:read` + `project:read` |
| 보관 위치          | Firebase Functions secret (`SENTRY_AUTH_TOKEN`)             |
| org / project slug | `.env` 에 이미 있는 DSN 의 projectId 로 조회 가능           |

> 토큰은 **브라우저에 절대 노출 금지** → 어드민 프론트가 Sentry API 를 직접 부르면 안 된다.
> onCall Function 이 프록시하고, 프론트는 그 Function 만 호출한다.

### 경로

```
AnalyticsPanel (admin UI)
   └─ httpsCallable("getSentryStability")   ← 어드민 uid 검증
        └─ Cloud Function (SENTRY_AUTH_TOKEN secret)
             └─ Sentry Web API
```

### 쓸 API (Sentry v0 REST)

| KPI                           | 엔드포인트                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| 릴리스별 crash-free 세션/유저 | `GET /api/0/organizations/{org}/sessions/?field=crash_free_rate(session)&groupBy=release` |
| 에러 발생량 추이              | `GET /api/0/organizations/{org}/events-stats/?field=count()&query=event.type:error`       |
| 상위 이슈                     | `GET /api/0/projects/{org}/{proj}/issues/?query=is:unresolved&sort=freq`                  |

### 구현 노트

- **캐시 필수.** Sentry API 는 org 단위 rate limit 이 있다 → Function 에서 5~15분
  TTL 캐시(Firestore 문서 한 개면 충분).
- 릴리스 태그는 이미 `marblo@<version>` 으로 나가므로 앱 버전별 안정성 비교가 바로 된다.
- **표시 규칙:** 데이터가 없으면 0 이 아니라 "데이터 없음"으로 표시할 것.
  (텔레메트리 공백 구간을 0% 로 그리면 거짓 신호가 된다.)
- 규모상 별도 티켓으로 분리 권장 — Function 신설 + secret + 캐시 + UI 4파트.
