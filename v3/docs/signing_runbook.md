# 데스크톱 앱 서명·공증 실전 런북 (직접 해보기)

> 대상: Marblo Electron 앱(`v3/`)의 배포 빌드를 **처음부터 직접 서명·공증**하려는 사람.
> 작성: 2026-06-22. 파이프라인 = `.github/workflows/build.yml`(Build & Release), 패키징 = `v3/electron-builder.yml`, 공증 훅 = `v3/scripts/notarize.js`.
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

> `MARBLO_REQUIRE_MAC_NOTARIZATION`: 비-PR mac 빌드에서 `true`로 세팅(`build.yml` L274). 자격증명이 빠지면 `notarize.js`가 조용히 넘어가지 않고 **에러를 던져 빌드를 빨갛게** 만든다 → "서명/공증 빼먹고 통과"를 구조적으로 차단.

---

## 4. Windows 수동 서명 (KoreaSSL USB 토큰 — A안)

CI는 Windows를 **무서명 nsis `.exe`**로 산출한다(`build.yml`에 `WIN_CSC_*` 미배선, L276~278). EV 인증서는 개인키가 USB 토큰 밖으로 안 나와 파일형 base64 서명이 불가능하기 때문.

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

---

## 부록 — 빠른 체크리스트

- [ ] 유료 Apple Developer Program 멤버십 active
- [ ] Developer ID Application 인증서 → .p12 → base64 ([code_signing_setup.md A-1~A-4](./code_signing_setup.md))
- [ ] 앱 전용 암호 16자리 발급(§1-2, ≠ Apple ID 로그인 비번)
- [ ] repo Secrets 5종 등록: `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (§1-3)
- [ ] Actions → Build & Release → Run workflow → platform=mac (§1-4)
- [ ] `Verify macOS notarization smoke` 스텝 초록 확인 (§1-5)
- [ ] 로컬 `spctl --assess` / `stapler validate` 재검증 (§1-6)
- [ ] Windows: 무서명 .exe 다운 → USB 토큰 signtool 수동 서명 (§4)
- [ ] PR 초록만 믿지 말고 push/dispatch로 서명경로 실검증 (§5)
