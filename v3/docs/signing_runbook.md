# 데스크톱 앱 서명·공증 실전 런북 (직접 해보기)

> 대상: Marblo Electron 앱(`v3/`)의 배포 빌드를 **처음부터 직접 서명·공증**하려는 사람.
> 작성: 2026-06-22 (개정: 2026-06-26 — 발행처 marblo-releases 반영, win 서명 훅 추가 / 2026-07-14 — 3.0.14~3.0.15 라운드 교훈 반영: dmg 공증 오판(§1-6a), dev↔패키지 env 갭(§5-2), 구버전 실행 함정(§5-3)). 파이프라인 = `.github/workflows/build.yml`(Build & Release), 패키징 = `v3/electron-builder.yml`, mac 공증 훅 = `v3/scripts/notarize.js`, win 서명 훅 = `v3/scripts/win-sign.js`.
>
> **이 문서와 [`code_signing_setup.md`](./code_signing_setup.md)의 역할 분담**
>
> - `code_signing_setup.md` = **준비/배경** (왜 필요한가, 인증서 종류, Windows EV 옵션 비교, Part A/B 레퍼런스).
> - **이 문서** = **실행 런북** — 키보드 앞에 앉아 따라치는 절차 + 실제로 터진 에러의 증상→원인→해결.
>   인증서 발급의 세부(키체인 CSR, .p12 export 등)는 중복 작성하지 않고 `code_signing_setup.md` Part A를 링크한다.
>
> ⚠️ **이 문서에 인증서/암호/시크릿 실값을 절대 넣지 말 것.** 전부 자리표시자(`<...>`)로만 표기한다.

---

## 0. 큰 그림 — 서명·공증은 언제 어디서 일어나나

| 트리거                             | 코드 서명 | 공증(notarize) | 용도                                |
| ---------------------------------- | --------- | -------------- | ----------------------------------- |
| `pull_request` → main              | ❌ 스킵   | ❌ 스킵        | 빌드 깨짐만 검증 (서명경로 검증 X)  |
| `push` → main / `v*` 태그          | ✅        | ✅             | 실제 서명·공증 빌드                 |
| `workflow_dispatch` (Actions 수동) | ✅        | ✅             | **증빙용 권장 경로** (원할 때 실행) |

핵심: **PR CI는 서명 시크릿을 주입하지 않으므로 서명·공증을 건너뛴다.** PR이 초록불이어도 서명경로가 멀쩡하다는 증명이 **아니다**(§5 가짜통과 함정). 서명을 실제로 검증하려면 `push` 또는 `workflow_dispatch`로 돌려야 한다.

macOS는 `build.yml`의 배선만으로 서명+공증이 자동 수행된다. Windows는 CI에서 **무서명** `.exe`만 산출하고, 실제 서명은 KoreaSSL USB 토큰으로 **수동**(§4)으로 한다.

### 0-1. ★ 빌드 전제 — Pyodide 자산(코드탭 노트북 실행)

`build:electron`은 `vite build` **직전에** `npm run assets:pyodide`를 돌린다(`scripts/fetch-pyodide-assets.mjs`). 코드탭의 `.ipynb` 셀 실행 런타임(Pyodide + numpy/pandas/matplotlib 휠, 약 31MB)을 `v3/src/public/pyodide/`에 받아두는 단계다. 이 자산은 `dist/`로 복사돼 asar에 들어가고, 앱은 **런타임에 외부 CDN을 절대 호출하지 않는다**(오프라인·CDN 장애 무관).

**mac/Windows/Linux 어느 머신에서 빌드하든 동일하게 적용된다** — `build:mac` / `build:win` / `build:linux`가 전부 `build:electron`을 거치기 때문에 별도 조치가 필요 없다. Windows 서명 머신(§4, §6-6)도 마찬가지다.

| 상황                   | 동작                                                      |
| ---------------------- | --------------------------------------------------------- |
| 첫 빌드 (자산 없음)    | jsdelivr에서 13개 휠 다운로드. **네트워크 필요**, 약 31MB |
| 이후 빌드 (자산 있음)  | sha256 재검증 후 **스킵 — 네트워크 호출 0회**, 0.2초 내외 |
| 파일이 깨졌거나 변조됨 | 해당 파일만 자동 재다운로드 (sha256 불일치 감지)          |

- 무결성: 모든 바이트를 `pyodide-lock.json`의 sha256과 대조하고, 불일치하면 **쓰지 않고 빌드를 실패시킨다**. 손상된 런타임이 릴리스에 들어갈 경로가 없다.
- `src/public/pyodide/`는 gitignore다(재생성 가능한 바이너리). 그래서 **새로 클론한 머신의 첫 빌드에는 네트워크가 필요**하다 — 오프라인 빌드 머신이라면 이 디렉터리를 미리 복사해두면 그대로 스킵된다.
- 수동 실행/강제 재다운로드: `npm run assets:pyodide` / `node scripts/fetch-pyodide-assets.mjs --force`.
- 자산이 빠진 앱은 크래시하지 않는다. 노트북 **렌더는 정상**이고 Run만 "자산 없음" 안내로 degrade한다 — 즉 **릴리스에서 이 단계가 조용히 빠져도 티가 잘 안 난다.** 릴리스 후 `.ipynb`에서 셀 실행을 한 번 눌러보는 것이 유일한 확실한 확인법이다.

---

## 1. macOS 서명·공증 따라하기

### 1-1. 사전 준비물 (한 번만)

1. **유료 Apple Developer Program**($99/년) 멤버십 — "Developer ID Application" 인증서는 유료 멤버십에서만 발급. ([code_signing_setup.md A-0](./code_signing_setup.md))
2. **Developer ID Application 인증서 → .p12 export → base64** — 절차는 [code_signing_setup.md A-1~A-4](./code_signing_setup.md)를 그대로 따른다. 결과물:
   - base64 문자열 (→ 시크릿 `MAC_CSC_LINK`)
   - .p12 export 암호 (→ 시크릿 `MAC_CSC_KEY_PASSWORD`)
3. **Team ID** — [developer.apple.com/account](https://developer.apple.com/account) → Membership details의 10자리 영숫자 (→ 시크릿 `APPLE_TEAM_ID`).
4. **앱 전용 암호(App-Specific Password)** — 아래 1-2에서 생성.

### 1-2. 앱 전용 암호 생성 (공증용)

공증(notarytool)은 Apple ID 본 비밀번호가 아니라 **앱 전용 암호**로 인증한다.

1. [appleid.apple.com](https://appleid.apple.com) 접속 → Apple ID로 로그인
2. **로그인 및 보안(Sign-In and Security)** → **앱 암호(App-Specific Passwords)**
3. **＋ (앱 암호 생성)** → 이름 입력(예: `marblo-notarize`) → 생성
4. 화면에 뜨는 **16자리** 암호(`xxxx-xxxx-xxxx-xxxx`)를 복사 → 시크릿 `APPLE_APP_SPECIFIC_PASSWORD`
   - ⚠️ 이 창을 닫으면 다시 못 본다. 바로 시크릿에 등록할 것.
   - ⚠️ 이건 **Apple ID 로그인 비밀번호와 다르다.** 로그인 비번을 넣으면 공증이 `HTTP 401`로 실패한다(§3).
   - 2단계 인증이 켜진 Apple ID에서만 앱 암호 메뉴가 보인다.

### 1-3. GitHub repo Secrets 등록 (5종)

repo **Settings → Secrets and variables → Actions → New repository secret**.
(릴리스 호스트 repo = `github.com/melocream/marblo`. origin에 등록.)

| 시크릿 이름                   | 값                                | electron-builder가 읽는 환경변수 |
| ----------------------------- | --------------------------------- | -------------------------------- |
| `MAC_CSC_LINK`                | Developer ID .p12의 base64 문자열 | `CSC_LINK`                       |
| `MAC_CSC_KEY_PASSWORD`        | .p12 export 암호                  | `CSC_KEY_PASSWORD`               |
| `APPLE_ID`                    | Apple 개발자 계정 **이메일**      | `notarize.js` (notarytool)       |
| `APPLE_APP_SPECIFIC_PASSWORD` | 1-2의 16자리 앱 전용 암호         | `notarize.js` (notarytool)       |
| `APPLE_TEAM_ID`               | 10자리 Team ID                    | `notarize.js` (notarytool)       |

> 시크릿 이름이 `MAC_` 접두어인 것(`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`)과 접두어 없는 것(`APPLE_*`)이 섞여 있다. `build.yml`이 `CSC_LINK: ${{ secrets.MAC_CSC_LINK }}` 식으로 매핑하므로 **이름을 정확히 위 표대로** 등록해야 한다. (`build.yml` L266~270 참조)

### 1-4. workflow_dispatch로 서명 빌드 돌리기

가장 빠른 증빙 경로(태그/푸시 없이 원할 때 실행):

1. GitHub repo → **Actions** 탭 → 좌측 **Build & Release** 워크플로 선택
2. 우측 **Run workflow** 드롭다운
3. **platform = `mac`** 선택 (mac만 빠르게 검증; `all`은 win/linux까지 같이 돈다)
4. **Run workflow** 클릭

실행되면 mac 레그는 다음 순서로 진행된다(`build.yml`):

- `Verify macOS signing inputs` — 5개 시크릿이 비어있지 않은지 **선검사**. 하나라도 비면 `::error::<NAME> is required ...`로 즉시 실패(L215~236).
- `Build Electron (mac-arm64 / mac-x64)` — electron-builder가 `CSC_LINK`로 서명 → `afterSign: notarize.js`가 notarytool 업로드 → Apple 서버 공증 대기. (스텝 timeout = mac 55분, L244)
- `Verify macOS notarization smoke` — 산출물에 대해 `codesign --verify` / `spctl --assess` / `stapler validate` / `hdiutil verify`를 CI 안에서 직접 재검증(L291~312).

> ⏱️ **공증은 느리다.** notarytool 업로드 후 Apple 서버 처리 대기가 22분을 넘기는 일이 흔하다 — 이건 hang이 아니라 정상이다. 그래서 mac만 job timeout 70분 / Build 스텝 timeout 55분으로 올려놨다(#186). win/linux는 ~6분이라 tight 30/22분 유지.

### 1-5. 결과 확인

- Actions 실행 화면에서 `Verify macOS notarization smoke` 스텝이 **초록**이면 서명+공증이 CI에서 이미 자동 검증된 것이다.
- 산출물: `Upload artifacts` 스텝 → 실행 페이지 하단 **Artifacts**에서 `marblo-mac-arm64` / `marblo-mac-x64` 다운로드(`.dmg`, `.zip`).

### 1-6. 로컬에서 다시 검증 (다운받은 .app/.dmg)

CI 스모크와 동일한 검증을 손으로 재현:

```bash
# .dmg를 마운트해 .app을 꺼내거나, .zip을 푼 뒤:
codesign --verify --deep --strict --verbose=2 "/path/to/Marblo.app"
codesign -dv --verbose=4 "/path/to/Marblo.app"      # Authority=Developer ID Application 확인
spctl --assess --type execute --verbose=4 "/path/to/Marblo.app"   # → accepted, source=Notarized Developer ID
xcrun stapler validate "/path/to/Marblo.app"        # → The validate action worked!
```

기대 출력:

- `codesign -dv`의 `Authority=Developer ID Application: <팀 이름> (<TEAMID>)`
- `spctl --assess` → `accepted` + `source=Notarized Developer ID`
- `stapler validate` → `The validate action worked!` (티켓이 .app에 스테이플됨)

`spctl`이 `rejected`거나 `source=Unnotarized`면 공증이 안 붙은 것 → §3 트러블슈팅.

### 1-6a. ★ 공증 검증 오판 — `.dmg`를 검사하지 마라 (3.0.14 라운드)

위 명령들의 대상은 전부 **`.app`**이다. **`.dmg`에 대고 돌리면 "실패처럼 보이는 정상"이 나온다** — 실제로 3.0.14 라운드에서 이걸 공증 실패로 오판해 멀쩡한 빌드를 재빌드했다.

| 명령                           | `.dmg` 대상 출력                   | 판정                                                                                               |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `codesign -dv <dmg>`           | `code object is not signed at all` | ✅ **정상** — dmg는 코드서명 대상이 아니다. 서명·공증·스테이플은 **안에 들어있는 `.app`**에 붙는다 |
| `xcrun stapler validate <dmg>` | 실패                               | ✅ **정상** — 같은 이유. 티켓은 `.app`에 스테이플된다                                              |

**진짜 검증은 dmg를 마운트해 `.app`을 꺼낸 뒤 `.app`에 대고** 한다:

```bash
hdiutil attach "Marblo-<버전>-arm64.dmg"
spctl -a -vvv --type exec "/Volumes/Marblo <버전>/Marblo.app"   # → accepted / source=Notarized Developer ID
xcrun stapler validate "/Volumes/Marblo <버전>/Marblo.app"      # → The validate action worked!
hdiutil detach "/Volumes/Marblo <버전>"
```

이 둘이 통과하면 공증은 **정상**이다. dmg 자체의 `codesign`/`stapler` 결과는 무시한다.

---

## 2. (참고) electron-updater 릴리스

`v*` 태그를 push하면 위 빌드 + `release` job이 돌아 GitHub Release(draft)를 만든다. 자동 업데이트 호스트/리허설은 [`electron_updater_runbook.md`](./electron_updater_runbook.md) 참조.

---

## 3. ★ 실전 트러블슈팅표 (실제로 터진 사례)

| 증상 (CI 로그/로컬)                                                                                    | 원인                                                                                                                                                                   | 해결                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V8 fatal `invalid size 188720663`, exit code 133** (서명 빌드 중 크래시)                             | `package-lock.json`에 nested PIN된 `@electron/osx-sign > isbinaryfile@4`. npm10은 nested lock 항목을 `package.json`의 `overrides`보다 **우선** 적용 → 깨진 버전이 박힘 | lock에서 해당 nested 블록을 surgical 제거(전체 재생성 X — win32 optional dep 누락 유발). [#183](https://github.com/melocream/marblo/pull/183). 메모리 [npm_override_needs_lock_regen] 참조 |
| 공증 `HTTP status code: 401. Invalid credentials` (notarytool)                                         | `APPLE_APP_SPECIFIC_PASSWORD`가 무효/만료, 또는 Apple ID 로그인 비번을 잘못 넣음                                                                                       | [appleid.apple.com](https://appleid.apple.com)에서 앱 전용 암호 **재발급**(§1-2) → 시크릿 `APPLE_APP_SPECIFIC_PASSWORD` 갱신 → 재실행. 메모리 [marblo_mac_signing_two_paths]               |
| `The job running on runner ... has exceeded the maximum execution time` / `timed out after 22 minutes` | 공증(notarytool) Apple 서버 대기가 기존 22분 스텝 제한을 초과. **hang이 아님** — 정상적으로 느린 것                                                                    | mac만 timeout 상향: job 70분 / Build 스텝 55분. win/linux는 30/22 유지. [#186](https://github.com/melocream/marblo/pull/186) (`build.yml` L56, L244)                                       |
| `The job was not started because ... payment ... failed` / `spending limit`                            | GitHub Actions 과금 한도 초과. **macOS 러너는 분당 과금이 Linux의 10배** → 한도 빨리 소진. 잡이 아예 0개로 안 뜸                                                       | repo/조직 **Settings → Billing & plans** → 결제수단 확인 + **spending limit 상향**. 한도 회복 후 재실행                                                                                    |
| `spctl --assess` → `rejected` / `source=Unnotarized` (로컬)                                            | 공증 스텝이 스킵됐거나(자격증명 누락) PR 빌드 산출물을 검증 중                                                                                                         | push/`workflow_dispatch` 산출물인지 확인. 자격증명 누락이면 §1-3 시크릿 점검. PR 산출물은 애초에 무서명·무공증(§5)                                                                         |
| `notarize.js`: `Skipping notarization: missing APPLE_ID, ...`                                          | 자격증명 시크릿 일부 누락. 비-PR mac 빌드에서는 `MARBLO_REQUIRE_MAC_NOTARIZATION=true`라 스킵이 아니라 **빌드 실패**로 전환됨                                          | §1-3의 5개 시크릿 전부 등록됐는지 확인. (PR 빌드에서는 의도적으로 스킵 — 정상)                                                                                                             |
| `codesign -dv <dmg>` → `code object is not signed at all` / `stapler validate <dmg>` 실패 (로컬)       | **오판이다 — 정상 출력.** dmg는 코드서명 대상이 아니며, 서명·공증·스테이플은 안에 든 `.app`에 붙는다. 3.0.14 라운드에서 이걸 공증 실패로 읽고 멀쩡한 빌드를 재빌드함   | dmg를 마운트해 `.app`을 꺼낸 뒤 `.app`에 대고 검증: `spctl -a -vvv --type exec <app>` → accepted/Notarized Developer ID + `stapler validate <app>` (§1-6a)                                 |
| **새 빌드인데 UI/기능이 없다** (설치 후 실행했는데 이번 변경이 안 보임)                                | 90%는 **구버전이 실행 중**. macOS는 dmg 재설치 시 기존 `/Applications/Marblo.app`을 지우지 않는다. "빌드 실패"가 아님                                                  | 빌드 번들 grep으로 빌드 정상부터 확정 → About 버전 확인 → Cmd+Q 완전종료 + `/Applications/Marblo.app` 삭제 + dmg 재설치 (§5-3)                                                             |
| 패키지 앱에서만 `auth/invalid-api-key` / MCP `-32000` (dev·에뮬·유닛은 초록)                           | 메인 프로세스에 env가 없다. Vite `import.meta.env`는 **렌더러만** 빌드타임 인라인 → 메인이 `process.env.*`로 읽는 config(Firebase apiKey·OAuth·MCP)가 패키지에서만 빔  | 번들 `firebase-config.json`(`Resources/dist-mcp/`)을 메인 부팅 시 `process.env`에 주입. 검증은 반드시 실 `.app` + DevTools 콘솔로 (§5-2)                                                   |

> `MARBLO_REQUIRE_MAC_NOTARIZATION`: 비-PR mac 빌드에서 `true`로 세팅(`build.yml` L274). 자격증명이 빠지면 `notarize.js`가 조용히 넘어가지 않고 **에러를 던져 빌드를 빨갛게** 만든다 → "서명/공증 빼먹고 통과"를 구조적으로 차단.

---

## 4. Windows 수동 서명 (KoreaSSL USB 토큰 — A안)

CI는 Windows를 **무서명 nsis `.exe`**로 산출한다(`build.yml`에 `WIN_CSC_*` 미배선, L276~278). EV 인증서는 개인키가 USB 토큰 밖으로 안 나와 파일형 base64 서명이 불가능하기 때문.

> ✅ **권장 경로는 §6-2의 `win.sign` 빌드-도중-서명 훅**(구현됨, `scripts/win-sign.js`)이다 — 자동업데이트 메타(`latest.yml`/`.blockmap`)가 서명된 exe 기준으로 생성돼 깨지지 않는다. 아래 §4의 "빌드 후 별도 서명"은 **이미 만들어진 무서명 exe만 손에 있을 때의 차선**이며, 그 경우 `latest.yml` 재계산이 필요하다(§6-2 차선 항목).

**수동 서명 절차 요약(A안 = 물리 토큰 로컬 서명):**

1. CI Artifacts에서 무서명 `Marblo-Setup-<버전>.exe` 다운로드 (`marblo-win-x64`)
2. KoreaSSL EV USB 토큰을 서명용 Windows 머신에 연결, 토큰 드라이버/SafeNet 설치
3. `signtool`로 서명 (타임스탬프 필수):

   ```cmd
   signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a "Marblo-Setup-<버전>.exe"
   ```

   - 서명 중 토큰 **PIN 입력 프롬프트**가 뜬다(자동화 불가 → 수동 경로인 이유).

4. 서명 검증:
   ```cmd
   signtool verify /pa /v "Marblo-Setup-<버전>.exe"
   ```
   또는 `.exe` 우클릭 → 속성 → **디지털 서명** 탭에서 게시자/타임스탬프 확인.
5. 서명된 `.exe`를 GitHub Release에 교체 업로드.

> 클라우드 서명(Azure Trusted Signing 등)으로 CI 자동 서명을 원하면 [code_signing_setup.md Part B](./code_signing_setup.md) 옵션 비교 참조 — 그 경우 `build.yml`의 win 서명 단계를 별도 티켓으로 교체.

---

## 5. ★ 검증 함정 — "가짜 통과"를 조심하라

> **PR(pull_request) CI가 초록불 ≠ 서명·공증이 동작한다.**

- PR 빌드는 서명 시크릿을 **주입하지 않는다**. `notarize.js`는 `GITHUB_EVENT_NAME === "pull_request"`면 공증을 **스킵**하고(L30~35), electron-builder도 PR에선 ad-hoc 서명만 한다.
- 따라서 서명·공증 로직에 버그가 있어도 **PR CI에서는 절대 안 걸린다.** 무서명으로 통과해버린다 = **가짜 통과**.
- 서명경로를 실제로 증명하려면 **`push` to main** 또는 **`workflow_dispatch`(§1-4)** 로만 검증한다. 이 경로에서만 `Verify macOS signing inputs` + `Verify macOS notarization smoke` 스텝이 실행된다(둘 다 `github.event_name != 'pull_request'` 게이트).

**실무 규칙:** 서명/공증/notarize.js/electron-builder.yml의 mac 서명 관련을 건드린 PR은, 머지 전 또는 직후 **반드시 `workflow_dispatch platform=mac`을 한 번 돌려** 실서명 경로가 초록인지 확인한다. PR 초록만 믿지 말 것.

### 5-1. ★ preload 변경 PR 검증 — 패키지 `.app` 실기동 필수

`v3/electron/preload.ts`를 건드린 PR은 Vite 렌더러 경로만으로 검증하지 않는다. preload는 패키지 앱의 sandboxed preload 컨텍스트에서 별도 실행되므로, top-level `require`/`import`가 throw하면 `contextBridge.exposeInMainWorld`까지 도달하지 못해 `window.electronAPI`가 통째로 사라지고 앱이 화이트스크린으로 보일 수 있다.

필수 체크:

- [ ] electron-builder가 만든 패키지 `.app`을 실제 실행한다. 개발 서버/Vite 렌더러 테스트만으로 대체 금지.
- [ ] 부팅 후 빈/흰 화면이 아니다.
- [ ] DevTools 또는 자동 스모크에서 `window.electronAPI`가 object로 노출되는지 확인한다.
- [ ] 최소 핵심 bridge(`electronAPI.pty.create`, `electronAPI.agent.launch`, `electronAPI.window.isNewWindow`)가 함수로 존재하는지 확인한다.

자동 경로:

```bash
cd v3
npm run build:electron
npx electron-builder --mac --arm64 --publish never
npm run smoke:packaged:mac
```

CI의 mac 빌드도 electron-builder 직후 `npm run smoke:packaged:mac`을 실행한다. 이 스모크는 패키지 `.app`을 직접 띄운 뒤 렌더러가 비어 있지 않은지, 그리고 `window.electronAPI`/핵심 bridge가 노출됐는지 assert한다.

### 5-2. ★★ dev↔패키지 env 갭 — 메인 프로세스엔 `.env`가 없다 (가장 잘 터지는 함정)

> **dev·워크트리에서 잘 되는 것은 패키지 앱이 동작한다는 증거가 아니다.** 이 갭이 3.0.14~3.0.15 라운드에서만 두 번 터졌다.

**원인 구조:**

- dev/워크트리에는 `v3/.env`가 있어 메인 프로세스가 `process.env.*`를 읽으면 값이 나온다.
- **패키지 앱에는 `.env`가 동봉되지 않는다.** Vite의 `import.meta.env`는 **렌더러 번들에만** 빌드타임 인라인되므로 렌더러는 멀쩡하다.
- 결과: **메인 프로세스가 `process.env.*`로 config를 읽는 경로만 패키지에서 조용히 빈값이 된다** — Firebase apiKey, OAuth, MCP config 등.

**실사례 2건:**

| 증상                       | 진짜 원인                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| 오케스트레이터 전환 무반응 | 메인 프로세스 Firebase config 부재 → `buildSwitchHandoffSnapshot`이 `auth/invalid-api-key`로 실패 |
| 패키지 MCP `-32000`        | 같은 뿌리 — firebase env 부재 ([#353](https://github.com/melocream/marblo/pull/353))              |

**fix 패턴:** env 파일이 아니라 **번들 리소스**를 config 단일 출처로 삼는다 — 빌드 때 `build-resources/`에 config를 굽고(`scripts/write-*-config.mjs`), 런타임에 `process.resourcesPath`에서 읽는다.

레포의 현재 배선 상태를 구분해서 알아둘 것 (`electron-builder.yml` `extraResources`):

| config                 | 번들 위치                     | 읽는 주체                                                                  | 상태                                                                 |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `oauth-config.json`    | `Resources/oauth-config.json` | **메인** (`main.ts`)                                                       | ✅ 배선됨 — `process.resourcesPath`에서 부팅 시 로드                 |
| `firebase-config.json` | `Resources/dist-mcp/`         | **MCP child** (번들 `index.js`가 `import.meta.url` 기준 sibling self-load) | ✅ 배선됨 ([#353](https://github.com/melocream/marblo/pull/353) fix) |
| `firebase-config.json` | 〃 (같은 파일 재사용)         | **메인 프로세스**                                                          | ⚠️ **미배선** — 오케 전환 무반응의 진짜 원인                         |

즉 **MCP child는 이미 해결됐지만 메인 프로세스는 아직 Firebase config를 안 읽는다.** 권장 fix는 `oauth-config.json`의 선례를 그대로 따라 **메인 부팅 시 `Resources/dist-mcp/firebase-config.json`을 읽어 `process.env`에 주입**하는 것이다(코드 변경 필요 — 이 문서 시점 기준 미구현).

**★ 검증 규칙 (이게 핵심):**

- 패키지 이슈는 **dev·에뮬레이터·유닛테스트로 확증 금지.** 실제로 PR #454가 에뮬 검증을 통과했지만 **오진**이었다 — 에뮬엔 env가 있어서 재현 자체가 안 됐다.
- 반드시 **실 `.app` 마운트 + DevTools 콘솔**로 확인한다. 실 콘솔만이 결정적 증거다.
- 배포 전 최소 게이트:
  - [ ] **클린 env**(`.env` 없는 셸)에서 메인 config 스모크 통과
  - [ ] **실 `.app`**에서 핵심 흐름 — 로그인 / 오케 전환 / MCP / 스폰 — **콘솔 에러 0**

관련 메모리: [packaged_mainproc_firebase_config_orch_switch], [packaged_mcp_minus32000_two_layers].

### 5-3. ★ 설치 검증 함정 — "새 빌드인데 기능이 없다"의 90%는 구버전 실행

macOS는 dmg를 재설치해도 **기존 `/Applications/Marblo.app`을 지우지 않는다.** 그래서 새 빌드를 설치한 것 같은데 이번 변경이 안 보이는 일이 생긴다. **여기서 "빌드 실패"로 단정하지 말 것** — 대개 설치/런타임 문제지 빌드 문제가 아니다.

**진단 순서 (이 순서대로):**

1. **빌드 번들 grep으로 빌드 정상부터 확정** — 나오면 빌드는 정상이고 설치/런타임 문제로 범위가 좁혀진다.
   ```bash
   grep -rl '<UI 고유문자열>' v3/dist/assets/*.js
   ```
2. **About 버전 확인** — 실행 중인 앱이 몇 버전인지.
3. **완전 재설치** — Cmd+Q로 **완전 종료** → `/Applications/Marblo.app` **삭제** → dmg 재설치.

> ⚠️ **`git show` 경로 함정:** `git show <커밋>:v3/src/...` 처럼 **repo 루트 기준 경로**를 써야 한다. `v3/` 서브디렉토리에서 실행해도 마찬가지다 — `v3/`를 빼면 빈 결과가 나오고, 이걸 "코드가 없다"로 오판하기 쉽다.

---

## 6. ★ GitHub Release 발행 — 서명 빌드를 자동업데이트 피드로 싣기

§1~4에서 만든 **서명·공증된 산출물**을 실제로 사용자에게 흘려보내는 단계다. 여기서의 관심사는 "서명물을 **올바른 메타데이터와 함께** Release에 싣기" 한 가지다. 릴리스 생애주기(일반/핫픽스/롤백/리허설 절차)는 [`electron_updater_runbook.md`](./electron_updater_runbook.md)에 있고 중복하지 않는다. **이 절은 그 앞단 — 서명 빌드를 자동업데이트가 깨지지 않게 피드에 올리는 메커니즘**을 다룬다.

### 6-0. 개념 — 빌드물은 커밋이 아니라 Release 에셋이다

- `.dmg` / `.zip` / `.exe`는 **git 커밋에 넣지 않는다.** repo 비대화·LFS를 피하려고 GitHub **Release 에셋**으로 올린다.
- electron-updater는 런타임에 Release의 **`latest*.yml`** 메타파일을 폴링해 새 버전을 감지하고, yml이 가리키는 본체(.zip/.exe)를 **sha512 무결성 검증** 후 내려받아 설치한다. → yml의 해시와 실제 에셋이 어긋나면 업데이트가 깨진다(§6-2의 Windows 함정 핵심).
- **발행처(publish) = `github.com/melocream/marblo-releases`** (공개 레포). 소스 레포 `melocream/marblo`는 **private**라 릴리스 자산을 익명 다운로드할 수 없어, 공개 배포는 별도 public 레포로 발행한다. `electron-builder.yml`의 `publish`가 `owner: melocream` / `repo: marblo-releases`로 **명시**돼 있다(`package.json`의 `repository.url`에서 도출하지 **않는다** — L79~80).
- **런타임 수신 피드 = `v3/electron/updater.ts`의 `DEFAULT_UPDATE_FEED_OWNER`/`REPO`** (현재 기본값 `melocream` / `marblo`, L32~33). `MARBLO_UPDATER_OWNER`/`REPO` env로 override 가능하나 이는 **리허설 전용**이며 평소 빌드엔 주입되지 않는다.
- ⚠️ **현재 발행처(`marblo-releases`)와 런타임 피드 기본값(`marblo`)이 불일치한다.** 그대로 배포하면 앱이 잘못된(게다가 private라 익명 접근 불가) 레포를 폴링해 **자동업데이트가 동작하지 않는다.** 반드시 둘을 일치시킬 것 — `updater.ts`의 `DEFAULT_UPDATE_FEED_REPO`를 `marblo-releases`로 바꾸거나, 패키징 시 `MARBLO_UPDATER_REPO=marblo-releases`를 굽는다. (메모리 [release_host_melocream_decision]는 marblo-releases 분리 이전 기준이라 갱신 필요.)
- **CI Actions 시크릿은 소스 레포(`melocream/marblo`)에 등록한다** — Actions가 거기서 돌기 때문(§1-3). 반면 로컬 발행용 PAT(`GH_TOKEN`)은 **`marblo-releases` 쓰기 권한**이 필요하다(§6-1).

### 6-1. macOS — `--publish always`로 한 번에 업로드

mac은 §1의 서명·공증이 빌드에 배선돼 있어, 로컬에서 `--publish always`로 Release 업로드까지 한 방에 된다:

```bash
cd v3
export GH_TOKEN=<melocream/marblo-releases Release 쓰기 권한 PAT>   # 실값 금지, env로만
npm run build:electron                                     # tsc(electron) + vite build
npx electron-builder --mac --arm64 --publish always
```

- 결과: 서명+공증된 **`.dmg` / `.zip` + `latest-mac.yml` + `.blockmap`** 이 `melocream/marblo-releases`의 **draft Release**(태그 = `v<package.json version>`)에 자동 업로드된다(발행처는 `electron-builder.yml`의 `publish` 블록 기준).
- `GH_TOKEN`: **`marblo-releases` 쓰기** PAT(classic의 `repo` scope 또는 fine-grained의 Contents: write). **시크릿 실값을 문서·코드에 넣지 말 것** — 셸 env로만 주입한다.
- CI는 `--publish never`로 돌리고 별도 release job이 처리한다(§6-4). `--publish always`는 **로컬 수동 발행**일 때만.
- 로컬 풀 빌드 시 `extraResources`가 `dist-mcp/`를 복사하므로 그 디렉터리가 있어야 한다. 없으면 `npm run build:mcp`를 먼저 돌린다.

### 6-2. ★ Windows 함정 (핵심) — "빌드 후 서명"은 자동업데이트를 깬다

CI(그리고 로컬 electron-builder)는 Windows를 **무서명 `.exe`**로 산출한다(§4, `WIN_CSC_*` 미배선). 문제는 순서다:

1. electron-builder가 **무서명 exe**를 만들고, **그 순간** `latest.yml`의 `sha512`/`size`와 `.blockmap`을 계산한다.
2. 그 뒤 USB 토큰 `signtool`로 서명하면 **exe 바이트가 바뀐다.**
3. 이제 `latest.yml`(무서명 기준 해시)과 실제 서명된 exe가 **불일치** → electron-updater가 다운로드 후 sha512 검증에서 실패 → **자동업데이트가 깨진다.** `.blockmap`도 무서명 exe 기준이라 함께 stale.

#### (권장) `win.sign` 커스텀 훅 — 빌드 _도중_ 서명

electron-builder의 `win.sign`에 커스텀 서명 모듈 경로를 주면, electron-builder가 **`latest.yml`/`.blockmap`을 만들기 전 서명 단계에서** 그 훅을 호출한다. → 메타데이터가 **서명된 exe 기준**으로 생성되어 해시가 처음부터 일치한다.

> ✅ **이미 구현됨 (PR #242).** `v3/scripts/win-sign.js` + `electron-builder.yml`의 `win.sign` 배선이 레포에 있다. 아래는 설정 형태 참고용이며, **실제 구현은 `scripts/win-sign.js`가 단일 출처**다. 훅은 `WIN_SIGN=1`일 때만 서명하고(토큰 연결한 서명 머신), 그 외엔 no-op라 CI/일반 로컬 빌드는 기존처럼 무서명으로 안전하게 통과한다. signtool은 Windows SDK에서 자동 탐색(`SIGNTOOL_PATH`로 override).

`v3/electron-builder.yml`의 `win` 블록 (적용된 형태):

```yaml
win:
  target:
    - nsis
  icon: resources/icon.png
  signingHashAlgorithms:
    - sha256
  sign: ./scripts/win-sign.js # ← 빌드 도중 서명 훅 (아래 파일)
```

`v3/scripts/win-sign.js` (훅 예시):

```js
// electron-builder가 서명 대상 파일마다 이 함수를 호출한다(configuration.path = 대상 exe).
// 전제: SafeNet/KoreaSSL USB 토큰이 꽂혀 있어야 하고, signtool 실행 중 토큰 PIN 입력
// 프롬프트가 콘솔에 뜬다(stdio:'inherit'로 노출). PIN 입력만 사람이 한다.
const { execFileSync } = require("node:child_process");

exports.default = async function (configuration) {
  execFileSync(
    "signtool",
    [
      "sign",
      "/fd",
      "sha256",
      "/tr",
      "http://timestamp.digicert.com", // RFC3161 타임스탬프(만료 후에도 서명 유효)
      "/td",
      "sha256",
      "/a", // 토큰의 적합한 인증서 자동 선택
      configuration.path,
    ],
    { stdio: "inherit" },
  );
};
```

이러면 `npx electron-builder --win --x64 --publish never`(또는 `always`) 한 번으로 **서명된 exe + 일치하는 `latest.yml` + `.blockmap`**이 함께 나온다.

> ⚠️ 훅 자체는 구현됐지만(PR #242) **실제 토큰 서명은 아직 검증 전**이다. EV USB 토큰을 서명 머신에 연결한 뒤 로컬 서명 빌드(`WIN_SIGN=1`, `npx electron-builder --win --x64`)를 1회 돌려 서명+해시 일치를 직접 확인할 것. CI(`workflow_dispatch`)는 토큰이 없어 win 서명을 검증하지 못하므로 PR 초록만 믿지 말 것(가짜통과, §5).
>
> **실서명 빌드 (PowerShell, 토큰 연결 상태):**
>
> ```powershell
> npm run build:electron
> $env:WIN_SIGN = "1"          # 없으면 무서명 no-op
> npx electron-builder --win --x64 --publish never
> # → 빌드 도중 signtool 이 토큰 PIN 입력을 콘솔에서 요구. PIN 입력 시 서명됨.
> ```
>
> 검증: `signtool verify /pa /v "dist\Marblo-Setup-<버전>.exe"` (signtool 풀경로는 Windows SDK `...\bin\<ver>\x64\signtool.exe`).

#### (차선) 수동 서명 후 `latest.yml` 재계산

빌드-후-서명을 피할 수 없을 때(§4 절차로 이미 서명한 exe만 있을 때). 서명된 exe 기준으로 `latest.yml`의 해시·크기를 다시 써야 한다:

```bash
# 서명된 exe의 sha512 (electron-updater는 base64 인코딩된 sha512를 본다)
openssl dgst -sha512 -binary "Marblo-Setup-3.0.0.exe" | openssl base64 -A; echo
# 크기(bytes)
stat -f%z "Marblo-Setup-3.0.0.exe"   # macOS/BSD  (Git Bash on Windows/Linux: stat -c%s)
```

위 값으로 `latest.yml`의 `files[].sha512` / `files[].size` 와 최하단 `path` / `sha512`를 교체한다.

> ⚠️ **한계:** `.blockmap`도 무서명 exe 기준이라 stale 상태로 남는다 → 차등(delta) 업데이트가 깨져 매번 전체 재다운로드로 폴백한다. blockmap을 서명된 exe에 맞게 정확히 재생성하려면 결국 빌드 파이프라인이 필요하다. **그래서 (권장) 훅 방식이 정답이고, 차선은 임시방편으로만.**

### 6-3. `gh release` CLI 절차 (mac + win을 한 태그에 모으기)

```bash
REPO=melocream/marblo-releases   # 발행처 = 공개 레포 (소스 marblo 는 private)
TAG="v$(node -p "require('./v3/package.json').version")"   # 예: v3.0.0

# 1) draft Release 생성 (--publish always가 이미 draft를 만들었으면 이 단계는 건너뛴다)
gh release create "$TAG" --repo "$REPO" --draft --title "$TAG" --notes "...changelog..."

# 2) 에셋 업로드 — 산출물 + 메타파일을 전부 (빠지면 §6-5대로 자동업데이트가 안 됨)
gh release upload "$TAG" --repo "$REPO" \
  v3/dist/*.dmg v3/dist/*.zip v3/dist/latest-mac.yml \
  v3/dist/*.exe v3/dist/latest.yml \
  v3/dist/*.blockmap

# 3) 피드 검증(electron_updater_runbook §1) 후 공개
gh release edit "$TAG" --repo "$REPO" --draft=false
```

- mac 빌드(맥)와 win 수동서명(윈도우 머신)은 보통 **다른 머신**에서 나온다. **같은 `$TAG` draft**에 각 머신에서 `gh release upload`로 추가하면 한 Release에 mac/win이 모인다.
- 공개(`--draft=false`)는 `latest*.yml`까지 다 올라가고 피드 검증을 통과한 뒤에만. draft 상태에서는 electron-updater가 피드를 못 본다.

### 6-4. CI 자동 경로와의 관계 (반드시 알아야 할 갭)

- `v*` 태그를 push하면 `build.yml`의 `release` job(`softprops/action-gh-release@v2`, `draft: true`, `if: startsWith(github.ref, 'refs/tags/v')`)이 아티팩트로 draft Release를 만든다.
- ★ **그러나** CI의 `Upload artifacts` 스텝 glob은 `*.dmg / *.zip / *.exe / *.AppImage / *.deb` 뿐 — **`latest*.yml`과 `.blockmap`을 아티팩트로 올리지 않는다**(`build.yml` L319~324). 따라서 **태그-자동 Release만으로는 자동업데이트 메타가 빠져 업데이트가 동작하지 않는다.**
- 게다가 Windows는 CI 산출물이 **무서명 exe**다(§4). → 현재 신뢰 경로는 **6-1(mac `--publish always`) + 6-2(win 서명 훅) + 6-3(`gh release upload`)** 으로 **메타파일·서명까지 완비된 Release를 직접 만드는 것**이다. (CI 메타파일 누락을 build.yml에서 메울지는 별도 티켓.)

### 6-5. 필수 메타파일 — 빠지면 자동업데이트 동작 안 함

| 플랫폼 | 파일                     | 필수도        | 역할 / 없으면                                                     |
| ------ | ------------------------ | ------------- | ----------------------------------------------------------------- |
| mac    | `latest-mac.yml`         | **하드 필수** | 버전·zip URL·sha512. 없으면 **새 버전 감지 자체 불가**            |
| mac    | `<app>-<ver>-*.zip`      | **하드 필수** | mac 업데이트 적용 본체(`.dmg`는 신규 설치용일 뿐, 업데이트엔 zip) |
| mac    | `*.zip.blockmap`         | 권장          | 차등 다운로드용. 없으면 전체 재다운로드로 폴백(동작은 함)         |
| win    | `latest.yml`             | **하드 필수** | 버전·exe URL·sha512. 없으면 **새 버전 감지 자체 불가**            |
| win    | `Marblo-Setup-<ver>.exe` | **하드 필수** | 업데이트 본체                                                     |
| win    | `*.exe.blockmap`         | 권장          | 차등 다운로드용. 없으면 전체 재다운로드로 폴백                    |

정리: **`latest*.yml`은 하드 필수** — 없으면 자동업데이트가 아예 안 뜬다. **`.blockmap`은 차등 다운로드용** — 빠지면 매번 전체 파일을 다시 받느라 대역폭을 낭비할 뿐 업데이트 자체는 된다. 둘 다 올리는 것을 **기본값으로** 삼아 6-3 upload 목록에 항상 포함시킨다.

### 6-6. Windows에서 Claude Code로 빌드·서명·업로드

서명용 Windows 머신에 **Claude Code(CLI)**를 띄워 전 과정을 시킬 수 있다:

```
npm run build:electron → npx electron-builder --win --x64 (win.sign 훅) → gh release upload
```

**사람이 직접 해야 하는 건 단 둘뿐**이다:

1. SafeNet/KoreaSSL **USB 토큰을 물리적으로 꽂기**
2. `signtool` 서명 중 뜨는 **토큰 PIN 입력**

나머지(빌드·서명 호출·업로드)는 전부 자동화 가능하다. PIN 실값은 어디에도 저장하지 말고 프롬프트에 그때만 입력한다.

### 6-7. P0-12b 리허설과의 연결

이렇게 **메타파일·서명까지 완비**해 발행한 Release라야 **구버전 → 핫픽스 자동수신 리허설**(P0-12b, 티켓 `nzDieNhedP5sWnagJY3e`)이 의미가 있다. `latest*.yml`이 빠졌거나 win exe가 무서명/해시 불일치면 리허설은 통과할 수 없다. 리허설 절차는 [`electron_updater_runbook.md`](./electron_updater_runbook.md) §4를 따른다.

---

## 부록 — 빠른 체크리스트

- [ ] 유료 Apple Developer Program 멤버십 active
- [ ] Developer ID Application 인증서 → .p12 → base64 ([code_signing_setup.md A-1~A-4](./code_signing_setup.md))
- [ ] 앱 전용 암호 16자리 발급(§1-2, ≠ Apple ID 로그인 비번)
- [ ] repo Secrets 5종 등록: `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (§1-3)
- [ ] Actions → Build & Release → Run workflow → platform=mac (§1-4)
- [ ] `Verify macOS notarization smoke` 스텝 초록 확인 (§1-5)
- [ ] 로컬 `spctl --assess` / `stapler validate` 재검증 — **`.dmg` 아니라 `.app`에 대고** (§1-6, §1-6a)
- [ ] Windows: 무서명 .exe 다운 → USB 토큰 signtool 수동 서명 (§4)
- [ ] PR 초록만 믿지 말고 push/dispatch로 서명경로 실검증 (§5)
- [ ] **클린 env에서 메인 config 스모크** + **실 `.app`에서 로그인·오케전환·MCP·스폰 콘솔에러 0** — dev/에뮬 통과는 증거 아님 (§5-2)
- [ ] "기능이 없다" 싶으면 빌드 실패 단정 전 — 번들 grep → About 버전 → 완전종료+`/Applications/Marblo.app` 삭제 후 재설치 (§5-3)
- [ ] 발행처 = `melocream/marblo-releases` (공개) 확인 + ⚠️ updater.ts 기본 피드(`marblo`)와 불일치 해소 (§6-0)
- [ ] mac: `GH_TOKEN`(env) 설정 후 `electron-builder --mac --arm64 --publish always` (§6-1)
- [ ] win: 빌드-후-서명 함정 회피 — `win.sign` 훅으로 빌드 도중 서명(권장) / 차선은 latest.yml 재계산 (§6-2)
- [ ] `gh release upload`에 `latest*.yml` + `.blockmap` 포함 (mac/win 같은 태그에 모으기, §6-3)
- [ ] CI 태그-자동 Release는 `latest*.yml`/`.blockmap` 미포함 갭 인지 — 수동 보완 (§6-4)
- [ ] 메타파일 점검: `latest-mac.yml`/`latest.yml`(하드 필수) + `.blockmap`(권장) 다 올렸는지 (§6-5)
- [ ] 공개 전 draft 상태에서 피드 검증, 이후 `gh release edit --draft=false` (§6-3)
- [ ] P0-12b(`nzDieNhedP5sWnagJY3e`) 구버전→핫픽스 수신 리허설 연결 (§6-7)
