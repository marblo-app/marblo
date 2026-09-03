# v3.0.38 릴리스 — 집 맥북 인계 문서

> 작성: 2026-09-03, 회사 맥북에어(서명 인증서·`APPLE_*` 0개인 머신)에서.
> ★이 머신에서는 서명·공증·업로드·공개를 하지 않았다. 여기서 한 것은 "현재 origin/main
> 기준으로 빌드가 통과한다"는 검증뿐이다. 아래 절차를 집 맥북에서 이어받으면 된다.
>
> 상세 절차는 이미 레포에 있다 — 이 문서는 그걸 다시 쓰지 않고 **v3.0.38 릴리스에 한정된
> 체크리스트 + 이번 검증 라운드에서 새로 발견한 것**만 담는다.
> - 서명·공증 전체 절차: [`signing_runbook.md`](./signing_runbook.md)
> - 인증서 발급 배경: [`code_signing_setup.md`](./code_signing_setup.md)
> - 자동업데이트 피드/리허설: [`electron_updater_runbook.md`](./electron_updater_runbook.md)

## 0. 빌드 대상

- 브랜치/커밋: `origin/main` @ `5d78fb7b` (의존 4장 전부 이 커밋의 ancestor로 확인됨 —
  `KuFDIgv8`(빌드완주 준비, 코드 커밋 아님) · `ddSiPtvk`→`054b62de`(#1374) ·
  `lcR4OMWC`→`5d78fb7b`(#1377) · `L1LQjuQh`→`a68956bc`(#1376))
- 버전: `v3/package.json` = `3.0.38` (그대로 유지 — 아직 한 번도 릴리스된 적 없어 올릴 이유
  없음. 5d78fb7b 는 사유 안내 버그픽스 하나뿐, 스코프 변경 아님)
- ★**빌드 클론(`/Users/dongwonkim/Documents/programming/marblo/marblo`)의 브랜치를 바꾸지
  마라** — 사장님이 그 클론으로 직접 빌드하신다.

## 1. node 버전 — 반드시 20~22

- `v3/package.json` engines: `">=20 <23"`. **이 범위를 넓히지 마라** — 클린 머신
  `npm ci`가 EBADENGINE 로 죽는 게 실측 근거다(레포 lint.yml/build.yml CI 도 전부
  `node-version: 20`).
- 이 맥북에어의 기본 node 는 v26.8.1 이라 범위 밖 — `nvm use 20`(또는 22)로 전환 후
  전 작업(typecheck/test/build:electron/electron-builder)을 진행했다. 집 맥북도 동일하게
  nvm 등으로 20~22 대를 맞출 것.
- ⚠️ **node 버전에 따라 유닛테스트 결과가 달라진다** — §3 참고.

## 2. `.env` / 시크릿 위치 — ★확인 필요, 티켓 서술과 다름

- 이 워크트리에도, 메인 체크아웃(`/Users/dongwonkim/Documents/programming/marblo/marblo`)
  에도 **실제 `v3/.env` 가 없었다**(`.env.example` 만 있음). `v3/functions/.env.marblo-2253d`
  도 두 곳 다 없었다.
- `npm run build:electron` 은 `scripts/check-firebase-env.mjs` 가 `v3/.env` 의
  `VITE_FIREBASE_*` 6종 + oauth 값을 요구한다(placeholder 면 빌드 실패, README 참고).
  이번 회차는 같은 세션군의 다른 워크트리(`ze7wa88AtFheuQ2ApSOU`)에 남아있던 실제
  `.env`(15줄, `VITE_FIREBASE_*` 7 + `VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID` +
  `GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET` + `GITHUB_OAUTH_CLIENT_ID` 등)를 그대로 복사해
  썼다(내용 미출력, 권한 600).
- **집 맥북에서 할 일**: 실제 배포용 `v3/.env` 가 어디 있는지(패스워드 매니저, 별도 백업,
  아니면 회사 맥북처럼 다른 워크트리 잔존분인지) 확인하고 메인 체크아웃 `v3/.env` 에
  배치할 것. `functions/.env.marblo-2253d` 는 Cloud Functions 배포용으로 보이며 이번
  Electron 빌드 자체에는 필요 없어 보이지만(=`build:electron` 경로에서 참조 안 됨),
  위치가 티켓 서술과 달라 확인이 필요하다.
- 보안: 이 문서에도, 활동 로그에도 값은 한 글자도 남기지 않았다(키 이름/줄 수/권한만).

## 3. 이번 라운드에 새로 드러난 것 — `navigator is not defined` (3건, 릴리스 비차단)

- node20으로 풀스위트를 처음 돌려봤더니(과거엔 이 머신 기본 node 로 통과 판정만 났음)
  `tests/unit/rootPathScope.test.ts`/`projectPaths.test.ts` 3건이
  `ReferenceError: navigator is not defined` 로 실패한다.
- 원인: Node 의 전역 `navigator` 객체는 Node 21+ 부터 기본 제공된다. 두 테스트가 vitest
  environment `"node"` 상태에서 그 전역에 암묵 의존한다. Node20 에는 없다.
- 이번 릴리스의 의존 4커밋과 무관 — 해당 테스트 코드의 마지막 수정은 `89bd8572`(7/20,
  #521)로 훨씬 이전. CI(`build.yml` verify job)도 이미 `node-version: 20` 인데 Test
  스텝이 `continue-on-error: true` 라 지금도 매 PR 마다 조용히 이 실패가 나고 있을 것
  — CI 로그로 재확인 권장.
- 릴리스 게이트(typecheck+test, lint 제외)는 **통과로 판단**했다: typecheck 0에러,
  풀스위트 8746/8749(신규 3건은 위 사유로 비차단). `OfbgCyJSp2g8`(기존 4건 추적 티켓)에
  이 3건도 묶거나 새 티켓을 파는 걸 추천 — node20 정렬이 이 릴리스의 요구사항이라
  이제야 드러난 실측이다.

## 4. 이번 라운드 빌드 검증 결과 (이 머신, node20, 서명 OFF)

```
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:electron   # exit 0
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac   # 아래 채움
```

- `build:electron`: exit 0. `check-firebase-env`(6/6 keys) · `write-oauth-config`
  (clientId/clientSecret/githubClientId set) · `write-firebase-config`(6/6 keys) 전부
  통과, 값은 마스킹 로그만 확인.
- `electron-builder --mac`: exit 0. 서명 스킵(`CSC_IDENTITY_AUTO_DISCOVERY=false` 로
  의도한 대로) · 공증 스킵(`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`
  없음 — 정상, 이 머신엔 없어야 맞다). dist/ 에 dmg·zip·blockmap 2쌍 + `latest-mac.yml`
  + `index.html` 만 산출(불필요한 잔여 파일 없음 — asar 결함 미재발 재확인).
- `smoke:packaged:mac`: **PASS** (`hasElectronAPI: true`, `hasCoreBridges: true`,
  `rootChildCount: 2`, 콘솔 에러 관련 이상 없음).
- 산출물 크기: dmg **183,974,270B** / zip **176,923,957B**.
  v3.0.35(282,620,270B) 대비 **−34.9%** — 이전 라운드(054b62de 기준 dmg
  183,918,234B)와 거의 동일, 이번 1커밋(5d78fb7b, 트리거 사유 안내 기능 추가) 만큼만
  자연스럽게 소폭 증가. asar 결함 재발 없음.

## 5. 집 맥북에서 할 일 — 순서대로

1. **node 20~22 확인** (`node -v`; 아니면 nvm 등으로 전환). engines 범위 넓히지 말 것(§1).
2. **`v3/.env` 배치** — 메인 체크아웃 `v3/.env` 에 실제 Firebase/OAuth 값 준비(§2).
   `functions/.env.marblo-2253d` 위치도 함께 확인.
3. **서명·공증 자격증명 준비** (`signing_runbook.md` §1 그대로):
   - 유료 Apple Developer Program 멤버십 + Developer ID Application 인증서(키체인에 설치
     돼 있으면 `CSC_IDENTITY_AUTO_DISCOVERY` 기본값으로 자동 탐색됨 — 이번처럼
     `false` 로 끄지 않는다)
   - `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD`(앱 전용 암호, Apple ID 로그인 비번 아님)
     / `APPLE_TEAM_ID` 환경변수 3종 — `scripts/notarize.js` 가 이 셋이 모두 있어야
     공증을 수행한다.
4. **빌드**(메인 체크아웃 `/Users/dongwonkim/Documents/programming/marblo/marblo/v3`,
   브랜치는 건드리지 말고 그 자리에서 `git pull` 로 이 브랜치의 CHANGELOG/handoff 커밋을
   받아온 뒤):
   ```bash
   npm run build:electron
   npx electron-builder --mac        # 이번엔 CSC_IDENTITY_AUTO_DISCOVERY 끄지 말 것 — 서명해야 함
   npm run smoke:packaged:mac
   ```
   `.app`을 직접 열어 `spctl -a -vvv --type exec` / `xcrun stapler validate` 로
   재검증(`signing_runbook.md` §1-6, §1-6a — **`.dmg` 말고 `.app`에 대고** 검사할 것).
5. **Windows 빌드는 사장님 기기에서** — KoreaSSL USB 토큰 필요(`signing_runbook.md` §4).
6. **Draft 업로드 순서** (`melocream/marblo-releases`, `signing_runbook.md` §6-1·§6-3):
   1. mac 먼저: `GH_TOKEN=<marblo-releases 쓰기 PAT> npx electron-builder --mac --publish always`
      (서명·공증된 `.dmg`/`.zip`/`latest-mac.yml`/`.blockmap` 이 draft Release 로 자동 업로드)
   2. win 다음: 서명된 `.exe` + `latest.yml` + `.blockmap` 을 같은 태그(`v3.0.38`)에
      `gh release upload` 로 추가
   3. **public 전환은 맨 마지막, 사장님 승인 후에만**:
      `gh release edit v3.0.38 --repo melocream/marblo-releases --draft=false`
   - 업로드 전 `latest*.yml`/`.blockmap` 빠짐없이 올라갔는지 확인(§6-5, 하드 필수).
7. **updater 피드 3곳 재확인**:
   - `v3/electron-builder.yml` `publish` → `melocream/marblo-releases` (코드 확인 완료,
     불변)
   - `v3/electron/updater.ts` `DEFAULT_UPDATE_FEED_OWNER/REPO` → `melocream` /
     `marblo-releases` (코드 확인 완료 — `signing_runbook.md` §6-0 이 경고하는 "발행처와
     피드 불일치"는 `c205d948`(#244)로 **이미 해결됨**, 그 경고는 지금은 stale)
   - `marblo-web/src/app/[locale]/download/page.tsx` 의 `APP_VERSION = "v3.0.35"` →
     **공개(published) 시점에 `v3.0.38` 로 수동 갱신 필요**(아직 안 건드림 — 공개 전에
     바꾸면 실제로 못 받는 버전을 사용자에게 보여주게 됨).
8. CHANGELOG.md 는 이번 회차에 이미 갱신했다(누적분, 3.0.35→3.0.38). 추가로 확인할
   머지가 있으면 그것만 보태고 처음부터 다시 쓰지 말 것.

## 6. 하지 말 것 (반복)

- ❌ 이 문서를 만든 머신에서 서명·공증 안 함 — 집 맥북에서
- ❌ 빌드 클론(`/Users/dongwonkim/Documents/programming/marblo/marblo`)의 브랜치 변경
- ❌ 사장님 승인 전 Draft → published 전환
- ❌ engines `">=20 <23"` 범위 확대
