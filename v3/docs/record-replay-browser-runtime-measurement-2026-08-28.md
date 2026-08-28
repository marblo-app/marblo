판정: 1차 구현은 Chromium 번들 대신 `channel: "chrome"` 시스템 Chrome을 전제로 간다. 설치본 증분이 0MB이고 첫 launch가 0.5-1.0s로 작지만, Chrome 미설치/세션만료는 반드시 사람 호출(handoff) 상태로 멈춰야 하며 Edge/Brave 자동 폴백은 하지 않는다.

# 녹화-재생 브라우저 런타임 실측

작성일: 2026-08-28 KST
티켓: `DHkrzbdAWAcBm4thGI4H`
범위: 런타임 탑재 방식 판정 문서. `package.json` dependency 이동, `v3/src` 변경, Electron/GUI 실행 없음.

## 1. 현재 레포 기준선

| 항목 | 실측/근거 | 판정 |
| --- | ---: | --- |
| `@playwright/test` 위치 | `v3/package.json` devDependencies. lockfile에서 `@playwright/test`, `playwright`, `playwright-core` 모두 `dev: true` | 현재 프로덕션 런타임에 Playwright JS API 없음 |
| Playwright JS 패키지 디스크 크기 | `@playwright/test` 60KB, `playwright` 5.0MB, `playwright-core` 12MB, 합계 17.1MB | dependency 이동만 해도 app.asar 후보가 늘어남 |
| Playwright 브라우저 캐시 | 기존 `chromium_headless_shell-1234` 196MB. full `chromium-1208` 캐시는 428KB로 불완전 | stale cache 값은 full Chromium 판단에 쓰지 않음 |
| `BrowserPane.tsx` | `<iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups">`; 주석에 `webviewTag` disabled 명시 | 기존 workspace browser pane은 자동화 대상이 아님 |
| `flow-engine/node-executors.ts` | input/llm/agent/api/human/branch/output/code executor만 있음 | 브라우저 노드 없음 |

## 2. Chromium 번들 vs `channel: "chrome"`

### 숫자 비교

| 선택지 | 설치본/다운로드 증분 | 첫 실행 지연 | 실패 모드 |
| --- | ---: | ---: | --- |
| full Chromium for Testing 번들(mac-arm64, Playwright 1.60, CFT 148.0.7778.96) | zip Content-Length 169.2MiB, 로컬 zip 176M, unzip 후 `.app` 341M | 이미 번들되어 있으면 headless launch 2.096s. 런타임 최초 다운로드라면 이 호스트에서 download 6.95s + unzip 0.83s + launch 2.096s = 9.88s | 번들 경로 누락, quarantine/sign/notarization drift, 플랫폼별 자산 누락, Playwright revision mismatch |
| full Chromium for Testing 다운로드 크로스플랫폼 | linux64 zip 175.4MiB, win64 zip 181.9MiB | 미측정. mac과 같은 순서면 download+unzip+launch | 플랫폼별 triplet 필요. universal/mac x64까지 넣으면 크기 선형 증가 |
| Chrome headless shell | mac-arm64 zip 92.4MiB, 기존 캐시 추출본 196MB. linux64 zip 113.2MiB, win64 zip 112.4MiB | 미측정 | 로그인/확장/사람 handoff에는 부적합. 이 티켓의 반복 로그인 세션 요구와 맞지 않음 |
| `channel: "chrome"` | Marblo 설치본 증분 0MB. 이 호스트의 외부 `/Applications/Google Chrome.app`는 1.4GB | 이 호스트에서 `chromium.launch({ channel: "chrome", headless: true })` 497ms, 반복 950ms | Chrome 미설치 시 즉시 실패. Chrome 자동 업데이트로 버전 drift |
| `channel: "msedge"` 명시 | Marblo 설치본 증분 0MB | Edge 미설치 호스트에서 1ms 실패 | `/Applications/Microsoft Edge.app/...` 없음. 자동 폴백 아님 |

실측 명령 요약:

```bash
export PATH="$HOME/.nvm/versions/node/v22.13.0/bin:$PATH"
cd v3
npx playwright install chromium --dry-run
npx playwright install chrome --dry-run
```

`npx playwright install chromium --dry-run`은 CFT 148.0.7778.96의 mac-arm64 full Chromium URL을 보고했고, `install chrome --dry-run`은 `Install location: <system>`을 보고했다. `chrome`, `chrome-beta`, `msedge`, `msedge-beta` channel installer도 모두 `<system>`이었다.

Playwright 1.60 내부 registry는 branded channel을 고정 경로로 찾는다:

| channel | macOS registry path |
| --- | --- |
| `chrome` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| `chrome-beta` | `/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta` |
| `chrome-dev` | `/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev` |
| `msedge` | `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` |
| `msedge-beta` | `/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta` |

### Chrome 없는 사용자는 어떻게 되는가

`channel: "chrome"`은 Edge/Brave로 자동 폴백하지 않는다. 이 호스트에서 Chrome stable은 설치되어 성공했고, Edge/Beta/Dev channel은 다음처럼 바로 실패했다.

```text
channel=chrome headless: ok 497ms
channel=msedge headless: error 1ms Chromium distribution 'msedge' is not found at /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
channel=chrome-beta: error 7ms Chromium distribution 'chrome-beta' is not found at /Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta
channel=chrome-dev: error 1ms Chromium distribution 'chrome-dev' is not found at /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev
```

따라서 제품 동작은 다음이어야 한다.

1. 시작 전 `channel: "chrome"` probe를 한다.
2. Chrome이 없으면 녹화/재생을 실행하지 않고 `NEEDS_BROWSER_INSTALL`로 멈춘다.
3. UI/티켓/알림에는 "Google Chrome 설치 후 다시 시도"를 표시한다. `npx playwright install chrome` 안내는 개발자용이므로 앱 사용자에게 그대로 노출하지 않는다.
4. Edge 폴백은 사용자가 "Edge로 이 사이트 세션을 쓰겠다"고 명시 선택한 경우에만 `channel: "msedge"`로 별도 probe한다. Brave는 Playwright branded channel이 없으므로 자동 폴백 대상이 아니다. 필요하면 `executablePath` 수동 지원을 별도 설계한다.

자동 폴백을 금지하는 이유는 세션이 브라우저/프로필별로 갈라지기 때문이다. Chrome에 로그인된 사용자를 Edge로 몰래 폴백하면 "브라우저는 떴지만 로그인은 안 된" 상태가 되어 매일 조용히 실패하는 봇이 된다.

## 3. dependency 이동은 이번 티켓에서 실행하지 않는다

이번 조사에서 dependency 이동은 하지 않았다. 이동 시 깨질 수 있는 지점은 다음이다.

| 지점 | 현재 근거 | 이동 시 위험 |
| --- | --- | --- |
| root `npm ci` | `.github/workflows/build.yml`은 `npm ci --ignore-scripts || npm install` fallback을 둔다. 주석에 lock/package drift가 `npm ci -> EUSAGE`를 만든다고 적혀 있다 | `@playwright/test`를 devDependencies에서 dependencies로 옮기면 root package-lock diff가 생긴다. CI가 strict `npm ci` 경로에서 다시 EUSAGE를 만날 수 있다 |
| lint CI | `.github/workflows/lint.yml`도 `npm install`, not `npm ci`를 명시한다. lock이 macOS에서 생성되어 Linux optional subtree가 빠지는 전례 때문 | dependency graph를 건드리면 Linux 재해석 결과가 바뀌어 lint/install gate가 불안정해진다 |
| Cloud Build/functions | `v3/docs/MARKETING_CONTACTS.md`에 "v3/functions에 devDependency 추가 금지 - Cloud Build npm ci EUSAGE" 전례가 명시되어 있다 | 앱 root와 functions가 별도라도, lockfile/CI 습관상 dependency 이동은 Cloud Build 재현성 사고와 같은 부류다. 별도 dry-run 없이 섞으면 안 된다 |
| electron-builder app.asar | `electron-builder.yml` files는 `dist-electron/**/*`, `dist/**/*`, `skills/**/*`, `package.json`이고 electron-builder는 production dependency를 app에 포함한다 | Playwright가 dependencies가 되면 17.1MB JS가 app.asar 후보가 된다. full browser까지 Resources에 넣으면 mac-arm64 기준 +341MB 설치본, +169MiB 배포 압축 증가 |
| extraResources/asars | 같은 yml은 `dist-mcp`, OAuth/Firebase config를 asar 밖 `Resources/`에 둔다. 기존 문서도 `dist-mcp` asar 경로 사고를 기록한다 | 브라우저 바이너리는 asar 안에서 실행하면 안 되고 Resources 밖 경로가 필요하다. 경로 resolver를 잘못 잡으면 packaged app에서만 `ENOENT` |
| mac 서명/공증 순서 | `afterSign: scripts/notarize.js`, `mac.notarize: false`로 단일 afterSign 공증. CI는 `codesign`, `spctl`, `stapler`, `hdiutil`을 검증한다 | 번들 Chromium `.app`/Mach-O가 Resources에 추가되면 signing scope와 hardened runtime 검증 시간이 늘고, 공증 업로드 크기가 증가한다. afterSign 전후 어느 파일을 mutate하면 서명/공증이 깨진다 |

특히 Playwright 패키지 자체에는 `postinstall` script가 없다. 즉 dependency 이동만으로 브라우저가 자동 다운로드되지는 않는다. 반대로 말하면, dependency 이동은 "실행 JS API"만 넣고 "브라우저 바이너리"는 여전히 빠진 반쪽 상태를 만들 수 있다.

## 4. 크레덴셜/storageState 보관

`google-drive-token-store.ts`의 불변식은 쓸 수 있다.

- Electron `safeStorage`로만 암호화한다.
- 암호화 불가 시 평문 fallback 없이 throw한다.
- 파일은 `0600`.
- 계정(`userId`)별 분리 저장.
- UI/IPC/로그 상태 API는 토큰 값을 반환하지 않는다.

하지만 저장물의 성격은 다르다. Google Drive OAuth store는 refresh token, access token, scope, email 같은 명시적 OAuth credential 세트다. 녹화-재생의 `storageState`는 임의 사이트의 cookie/localStorage/sessionStorage 묶음이고, 그 자체로 사용자를 impersonate할 수 있다. OAuth처럼 Marblo가 scope를 해석하거나 refresh revoke UX를 제공할 수 없다.

따라서 구현은 `google-drive-token-store.ts`를 그대로 재사용하지 말고, 같은 safeStorage 원칙을 따른 별도 저장소여야 한다.

권장 디스크 모델:

```text
~/.marblo/browser-sessions.enc.json
version: 1
accounts[userId][siteKey] = base64(safeStorage.encryptString(JSON.stringify({
  storageState,
  origins,
  browserChannel: "chrome",
  profileHint,
  capturedAt,
  lastVerifiedAt,
  expiresAt,
  consentLabel
})))
```

`siteKey`는 eTLD+1 또는 사용자가 승인한 origin set 기준이어야 한다. 한 사이트 세션을 다른 origin에 주입하지 않는다. 평문 반환 함수는 자동화 runner 내부 하나로 제한하고, IPC/UI는 `connected`, `origins`, `capturedAt`, `lastVerifiedAt`, `expiresAt`만 보게 한다.

## 5. 유출 경로

이 티켓의 가장 중요한 안전 항목이다. 저장 세션은 다음 경로로 샐 수 있다.

| 경로 | 위험 | 차단 규칙 |
| --- | --- | --- |
| 앱/runner 로그 | Playwright error, request/response, cookie dump, localStorage dump, URL query가 평문으로 남음 | cookie/storageState 값 로그 금지. domain/count/status만 기록 |
| Marblo activity/task timeline | 에이전트가 "재현 근거"로 cookie/localStorage/headers를 붙일 수 있음 | add_activity에는 세션 값 금지. `NEEDS_HUMAN_AUTH`, origin, masked account만 |
| first-party telemetry/analytics | 이벤트 payload에 URL, selector, form value, account email, auth 상태가 들어갈 수 있음 | browser automation telemetry는 allowlist schema. URL은 origin/path hash까지만 |
| Sentry/Electron crash dump | breadcrumbs, exception message, minidump, renderer console에 credential이 섞일 수 있음 | browser runner는 세션 평문을 Error message에 넣지 않음. Sentry beforeSend scrub에 cookie/header/storage 키 추가 |
| Playwright trace/video/screenshot | 로그인 화면, 계정명, 개인 데이터, 쿠키 포함 network trace가 저장됨 | 기본 OFF. 켜도 user-approved debug bundle로 격리, TTL 삭제, 업로드 금지 |
| 에이전트 프롬프트 | DOM text, network body, console, storage dump가 LLM prompt로 들어감 | `cookies`, `storage`, response body, hidden DOM은 prompt 금지. gstack처럼 untrusted envelope는 보조장치일 뿐 세션 방출 허용이 아님 |
| 브라우저 debug port/CDP | 같은 OS 사용자 프로세스가 CDP port에 붙어 cookie를 읽을 수 있음 | 원칙은 Playwright child pipe. TCP CDP가 필요하면 127.0.0.1, random port, 짧은 TTL, root-token 불가, 실행 후 즉시 close |
| IPC/bridge payload | main에서 renderer로 storageState를 넘기면 DevTools/renderer compromise에 노출 | decrypt/use는 main 또는 격리 runner에서만. renderer는 상태 요약만 |
| 임시 파일 | `storageState.json`, 다운로드, trace가 `/tmp`나 workspace에 남음 | storageState 평문 파일 금지. 필요 시 temp 0600 + finally 삭제 + 경로 비공개 |
| git/PR/docs | 조사 중 캡처 파일이나 세션 JSON이 커밋될 수 있음 | `.gitignore`/preflight secret scan. 문서에는 값 대신 수치/상태만 |
| Chrome profile 재사용 | 실제 Chrome profile을 직접 조작하면 사용자의 전체 브라우저 세션이 노출/손상 | 자동화 전용 persistent profile을 쓰고, import는 origin별 opt-in |

gstack browse가 이미 배운 점도 같다. `sse-session-cookie.ts`는 root token을 URL query에 넣지 않기 위해 HttpOnly/SameSite 단기 cookie로 바꿨고, 주석은 URL이 browser history, referer, server log, crash report로 새는 점을 명시한다. cookie picker도 30초 one-time code와 1시간 session cookie를 쓰며, session cookie를 `/command` scoped token으로 인정하지 않는다. Marblo도 "세션 cookie"와 "명령 권한 token"을 같은 물건으로 취급하면 안 된다.

## 6. 세션 만료와 사람 호출 경로

저장한 세션은 반드시 죽는다. 조용한 재시도는 금지한다.

만료 감지는 적어도 다음을 본다.

- 실행 전 `expiresAt`이 지났거나 `lastVerifiedAt`이 오래됨.
- 첫 페이지가 로그인 URL로 redirect됨.
- 401/403, CSRF token missing, MFA required, captcha required.
- 녹화 당시 anchor selector보다 먼저 account chooser/login form이 보임.
- N회 연속 같은 auth gate에서 실패.

상태 전이는 다음이어야 한다.

```text
READY -> RUNNING -> NEEDS_HUMAN_AUTH -> WAITING_FOR_HUMAN -> RESUMING -> READY
                         \-> EXPIRED_DISABLED
```

`NEEDS_HUMAN_AUTH`가 되면 해당 schedule은 멈춘다. 다음날 다시 돈을 태우지 않는다. owner에게 "이 사이트 세션 갱신 필요" 알림을 만들고, 사용자가 직접 로그인할 수 있는 headed handoff를 제공한다. 사람이 로그인 완료를 누르면 runner가 같은 origin set만 재검증하고 encrypted storageState를 교체한 뒤 resume한다.

gstack browse에서 차용할 패턴:

- `handoff`: headless 상태를 저장하고 headed persistent context를 열어 사람이 이어받는다.
- `resume`: 사람이 끝낸 뒤 refs/frame/failure counter를 리셋하고 현재 페이지를 다시 snapshot한다.
- consecutive failure hint: 3회 연속 실패 시 handoff를 권한다.
- cookie picker: 30초 one-time code, 1시간 session cookie, Bearer/root token 분리.

그대로 쓰면 안 되는 부분:

- gstack은 도구 세션 중심이고 `~/.gstack/chromium-profile` persistent context를 쓴다. Marblo 녹화-재생은 제품 기능이므로 userId/site/origin/consent별 수명주기가 필요하다.
- gstack의 cookie import는 사용자가 고른 브라우저 쿠키를 현재 Playwright context에 가져오는 UX다. Marblo는 반복 실행을 위해 장기 저장하므로 만료, 폐기, 감사 로그, 비활성화가 별도 상태로 있어야 한다.

## 7. 결론

지금 릴리스 경로에서는 Chromium 번들을 싣지 않는다. mac-arm64 하나만으로도 배포 압축 +169MiB, 설치본 +341M이고, mac x64/windows/linux를 더하면 릴리스 자산과 공증/패키징 시간이 커진다. 반면 `channel: "chrome"`은 설치본 +0MB, 이 호스트 launch 497-950ms다.

대신 `channel: "chrome"` 선택은 "Chrome이 없으면 실패"를 제품이 정면으로 받아야 한다. 자동 Edge/Brave 폴백 없이 `NEEDS_BROWSER_INSTALL` 또는 `NEEDS_HUMAN_AUTH`로 멈추고, 사람이 Chrome 설치/로그인/handoff-resume를 완료해야 schedule을 재개한다. 이 조건을 지키지 못하면 숫자상 이득보다 조용한 봇 실패와 세션 유출 위험이 더 크다.
