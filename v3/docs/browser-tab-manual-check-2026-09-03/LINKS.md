# 앱 안 웹 탭 — 손으로 눌러보는 링크 모음

데모 띄우기(터미널에서 한 줄):

```
cd v3/docs/browser-tab-manual-check-2026-09-03 && python3 -m http.server 8791
```

뜨면 `http://localhost:8791/demo.html` 을 아래 ①에 써넣고 앱 안에서 열어본다. 멈추려면 그 터미널에서 `Ctrl+C`.

> ⚠️ 이 문서·데모는 **프로덕션 코드가 아니다.** `BrowserPane`/`paneStore`/main 링크 라우팅은 `kqFkuqsy3Cp9YcAwtTQ5` 티켓이 고치는 중이므로 여기서는 건드리지 않았다.
>
> ★이 문서는 `origin/main@8552a6f5` 기준으로 예측을 다시 검증했다. 처음 작성 시점(`f3b6e52c`) 이후 `be8c8469`(#1389 "route local demos into browser tabs") 가 정확히 이 문서가 다루는 라우팅 코드를 바꿔서, 예측을 전부 다시 코드로 확인했다 — 아래 각 행에 무엇이 바뀌었는지 적어뒀다.

---

## 이 문서를 여는 법

②(레포 안 다른 문서) 항목이 작동하려면 이 파일을 **앱의 Code 탭에서 열어야 한다** (Finder 로 그냥 더블클릭하면 상대경로 링크가 브라우저 확장자 연결 프로그램으로 열려서 의미가 없다). 파일 트리에서
`v3/docs/browser-tab-manual-check-2026-09-03/LINKS.md` 를 찾아 열고, Preview 모드에서 아래 링크를 누른다.

①'을 확인하려면 데모 서버를 먼저 띄운 뒤 이 파일을 Code 탭에서 열고 [로컬 데모 링크](http://localhost:8791/demo.html) 를 클릭한다.

---

## 링크 종류별 — 기대 결과

| # | 종류 | 링크 | 기대 결과 |
|---|---|---|---|
| ① | 로컬 데모 — **Browser 탭 주소창에 직접 입력** | `http://localhost:8791/demo.html` (위 명령으로 띄운 것) | 앱 안 Browser 탭에서 열림. 시계가 매초 갱신되고 버튼을 누르면 카운터가 오른다 |
| ①' | 로컬 데모 — **다른 화면(Code 미리보기)에서 링크 클릭** | [`http://localhost:8791/demo.html`](http://localhost:8791/demo.html) | 새 Browser 탭이 자동으로 열리며 데모가 뜬다(#1389 가 추가한 동작 — 이전엔 이 경로가 별도의 빈 네이티브 창을 띄우는 버그였다) |
| ② | 레포 안 다른 문서(상대경로) | [`./sample-doc.md`](./sample-doc.md) | Browser 탭이 아니라 **Code 탭**에서 `sample-doc.md` 가 새로 열림(파일 링크는 Browser 탭과 무관한 별도 경로) |
| ③ | 프레이밍 허용 외부 — 주소창에 직접 입력 | `https://example.com` | 앱 안 Browser 탭에서 그대로 열림 |
| ④ | GitHub — 주소창에 직접 입력 | `https://github.com` | 코드상 GitHub 을 별도 취급하는 규칙이 없어 ③과 동일하게 **앱 안에서 열려야 정상**(BrowserPane 은 WebContentsView 라 X-Frame-Options 의 영향을 받지 않음) |
| ⑤ | GitHub — **다른 화면에서 링크 클릭** | 이 문서의 [GitHub 링크](https://github.com) 를 Code 탭 미리보기에서 클릭 | ★`pmpcvaEsswlsOLJDwer6` 로 기대값이 바뀌었다: 이제 **앱 안 「웹」 탭**에서 열려야 한다(①' 과 같은 경로·같은 결과). 밖으로 나가는 건 로그인/결제/비-http 스킴뿐이고, 그때는 반드시 안내 알림이 뜬다. 사양은 `docs/link-routing-spec.md` |

②는 Code 탭 파일 링크, ①③④는 Browser 탭 주소창 입력, ①'⑤는 Browser 탭이 아닌 다른 화면(Code 미리보기)에서의 링크 클릭이다. ①'와 ⑤는 **같은 코드 경로(`routeAppExternalLink`)** 를 타지만 로컬이냐 아니냐에 따라 결과가 완전히 갈리는 것이 이 문서의 핵심 확인 대상이다.

---

## 기준선 — 예측(코드 근거) vs 실측(사장님이 채움)

사장님 dev 세션(PID 74888, `--remote-debugging-port=9222`)은 지금 실제로 쓰고 계신 라이브 세션이다. 그래서 **클릭하지 않았고, 아래 "예측" 칸도 CDP 로 대신 확인하지 않았다** — 이 문서의 목적 자체가 사장님이 직접 눌러 확인하시는 것이라, 미리 다 눌러버리면 그 확인을 대신하는 셈이 된다. "예측" 칸은 라우팅 코드(와 그 코드를 검증하는 유닛 테스트)를 직접 추적해 나온 것일 뿐 실측이 아니다 — 단, ⑤ 행은 예측이 아니라 **유닛 테스트로 이미 확인된 코드 동작**이라 별도로 표시했다. ★예측과 실측이 어긋나면 그 자체가 발견이다 — 코드를 잘못 읽었거나, 예측에 없던 다른 경로가 끼어든 것이다.

| # | 종류 | 예측(코드 근거) | 실측(사장님이 채워주세요) |
|---|---|---|---|
| ① | 로컬 데모, 주소창 직접 입력 | 정상 로드 — `#1389` 이후에도 변화 없는 경로. `browserPane:navigate`/`attach` 는 `routeAppExternalLink` 를 거치지 않고 `classifyInAppBrowserNavigation` 이 `allow` 면 바로 `loadURL` (`in-app-browser-policy.ts:67-96`, `main.ts:9779-9816`(`attach`), `main.ts:9816-9853`(`navigate`)) | ⬜ 뭐가 보였나: 앱 탭에서 열림 / 빈 창 / 아무 반응 없음 — 시계·카운터가 움직였나? |
| ①' | 로컬 데모, 다른 화면에서 링크 클릭 | **`#1389`로 바뀐 경로 — 이제 새 Browser 탭이 자동으로 열릴 것으로 예측.** 예전엔 `isInternalNavigationUrl` 이 포트 상관없이 모든 `localhost`/`127.0.0.1` 을 "내부"로 봐서 `setWindowOpenHandler` 가 `allow` 를 주고 라우트 없는 빈 네이티브 창이 떴다(그 버그가 `#1389` 의 수정 대상). 지금은 `currentAppOrigin()` 으로 앱 자신의 origin(dev 5173 / prod 정적서버)만 "내부"로 보고, 그 외 loopback 포트는 `routeAppExternalLink` 로 가서 `isLocalBrowserPaneUrl` 이 `true` → `shouldOpenInTab=true` → `hasOpenTarget` 이 true(워크스페이스가 떠 있으면 `WorkspaceShell.tsx:183` 에서 항상 등록됨)면 `open-in-tab` → 렌더러 `onOpenUrl` 이 `addPane("browser", {url})` 로 새 탭을 만든다 (`in-app-browser-policy.ts:47-65,189-207`, `main.ts:5492-5541,5693-5696`, `WorkspaceShell.tsx:180-192`) | ⬜ 새 Browser 탭이 자동으로 열렸나 / 빈 창이 떴나 / 아무 반응 없었나? |
| ② | 레포 안 다른 문서(상대경로) | 정상 열림 — `#1389`가 이 파일들을 건드리지 않아 변화 없음. `resolveMarkdownLinkTarget` 이 저장소 안 상대경로를 `kind:"file"` 로 분류, `openFile()` 로 Code 탭에서 염. 이 문서를 Code 탭으로 열었을 때만 `rootPath`/`filePath` 컨텍스트가 있어 작동(Finder 로 열면 `no-context` 로 무시) (`markdownLinks.ts:93-143`, `MarkdownPreview.tsx:73-113`) | ⬜ 뭐가 보였나: Code 탭에 새로 열림 / 아무 반응 없음 / 다른 곳(브라우저 등)으로 열림 |
| ③ | 프레이밍 허용 외부, 주소창 직접 입력 | 정상 로드 — `#1389` 이후에도 변화 없는 경로(①과 동일한 이유). google-auth/auth/payment 하드코딩 목록에 없는 모든 http(s) 는 `allow` (`in-app-browser-policy.ts:88-95`, 목록 밖) | ⬜ 뭐가 보였나: 앱 탭에서 열림 / 빈 창 / 외부 브라우저 |
| ④ | GitHub, 주소창 직접 입력 | 정상 로드 — `#1389` 이후에도 변화 없는 경로. `isKnownAuthUrl` 은 `github.com` 을 `/login/oauth` 경로일 때만 `external` 로 본다. 일반 페이지는 `allow` → `browserPane:navigate`/`attach` 가 그대로 `loadURL` 호출 | ⬜ 뭐가 보였나: 앱 탭에서 열림 / 빈 창 / 외부 브라우저로 튕김 |
| ⑤ | GitHub, 다른 화면(Code 미리보기)에서 링크 클릭 | **`pmpcvaEsswlsOLJDwer6` 이후: 「웹」 탭에 새 탭으로 열림.** 라우팅에서 `shouldOpenInTab`(=로컬 데모인가) 인자를 없애 일반 http(s) 도 `open-in-tab` 이 되고, 「웹」 탭이 실제로 마운트됐다 — 그 전엔 pane 트리(`LayoutView`)를 **아무 컴포넌트도 import 하지 않아** ①' 조차 보이는 탭을 만든 적이 없다. 밖으로 나갈 수밖에 없는 경우(창이 없거나 ack 실패)에도 이제 안내가 뜬다. `tests/unit/route-app-external-link.test.ts` · `tests/unit/web-tab-link-open.test.ts` 가 동작으로 못박는다 | ⬜ 「웹」 탭에 GitHub 이 떴나? ⬜ 그 탭이 앞으로 나왔나? ⬜ (밖으로 나갔다면) 안내 알림이 떴고 뭐라고 적혀 있었나? |

> ★**2026-09-04 갱신 — 위 표의 기대값이 `pmpcvaEsswlsOLJDwer6` 로 바뀌었다.** 일반 외부
> 링크(⑤)도 이제 앱 안 「웹」 탭에서 열린다. 그리고 그 전까지는 pane 표면
> (`LayoutView`)을 **아무 컴포넌트도 import 하지 않아** 어떤 링크도 보이는 탭을 만든
> 적이 없다 — ①' 포함. 아래 "핵심 발견" 은 그 이전 상태의 기록이다. 현재 사양은
> `docs/link-routing-spec.md`.

**핵심 발견 (2026-09-03 시점 기록 — 위 갱신 이후로는 과거형이다)**:
1. `#1389` 는 로컬 데모를 링크로 클릭했을 때의 "빈 네이티브 창" 버그(①')를 고쳤다 — 의도한 대로 동작하는지가 이번 재확인의 핵심.
2. `#1389` 가 `notice:null` 버그(⑤)를 고치지는 않았다. 오히려 그 조건을 "Browser 탭이 열렸는지" 에서 "로컬 데모 URL 인지" 로 못박았다 — **github.com 뿐 아니라 example.com 같은 임의의 외부 사이트도, 다른 화면에서 클릭하면 이제 항상(탭이 열려 있어도) 안내 없이 조용히 외부로 열린다.** 이건 유닛 테스트로 재현되는 확정된 동작이라 "예측"이 아니라 "확인된 결함"으로 적어뒀다.
3. `kqFkuqsy3Cp9YcAwtTQ5` 가 고칠 지점은 여전히 `resolveExternalLinkRouting` 의 `decision.action==="allow" && !shouldOpenInTab` 분기(`notice:null`)로 보인다 — 참고로 전달만 하고 그쪽 코드는 건드리지 않았다.

---

## 재확인 (고친 뒤 같은 문서로 비교)

위 표의 "실측" 칸을 그대로 채우면 전/후 비교가 된다. 별도 문서를 새로 만들 필요 없이 이 파일 위에 실측 결과를 덧써서 `kqFkuqsy3Cp9YcAwtTQ5` 전/후를 비교하면 된다.
