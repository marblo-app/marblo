# Google 로그인 브랜딩 정리 런북

목적: Google 로그인 동의화면의 자동 생성 이름 `마블로 프로젝트-57319`를 `Marblo`로 바꾼다. 이 문서는 2026-09-02 기준 **Google Auth Platform** UI를 따른다. 콘솔 권한이 있는 프로젝트 소유자/편집자가 수행한다.

## 먼저 구분할 세 값

| 값 | 사용자 노출 | 바꿀 수 있는가 | 이 작업의 입력값 |
| --- | --- | --- | --- |
| Firebase 프로젝트 **표시명** | 아니오. Firebase/Google Cloud/CLI 안에서만 구분하는 이름 | 예 | `Marblo` |
| OAuth 동의화면 **App name** | 예. Google 로그인·권한 동의 화면의 앱 이름 | 예 | `Marblo` |
| `PROJECT_ID.firebaseapp.com` Auth handler 도메인 | 예. 로그인 중 `Continue to:` 또는 동의화면 하단 등 OAuth 리디렉션 맥락 | 프로젝트 ID를 바꿔서는 불가; custom auth domain으로 대체 가능 | 현 단계에서는 유지 |

Firebase의 공식 설명대로 프로젝트 이름은 내부 식별용이며 공개 Firebase/Google Cloud 서비스에 표시되지 않는다. 반면 Google Auth Platform의 Branding > App name은 사용자가 인증/동의할 때 보는 브랜드 정보다. 따라서 증상의 직접 수정 대상은 두 번째 값이다. [Firebase 프로젝트 식별자](https://firebase.google.com/docs/projects/learn-more) · [Google OAuth 브랜딩](https://support.google.com/cloud/answer/15549049)

## 사장님 클릭 체크리스트

### 0. 사전 확인

- [ ] Google Cloud Console에서 **기존 Firebase 프로젝트**를 선택한다. 이 저장소의 공개 설정/문서 기준 프로젝트 ID는 `marblo-2253d`다. ID 자체는 영구 식별자이므로 바꾸지 않는다.
- [ ] 변경 중인 Brand verification이 있으면 상태를 확인한다. Google은 검토 중에는 Branding 변경을 막으며, 필요하면 진행 중 검토를 먼저 취소해야 한다.

### 1. Firebase 프로젝트 표시명 (선택: 내부 정리용)

- [ ] [Firebase Console](https://console.firebase.google.com/)에서 해당 프로젝트를 연다.
- [ ] 좌측 상단 톱니바퀴 **Project settings**를 누른다.
- [ ] **General** 탭 상단의 **Project name**에서 편집(연필)을 누른다.
- [ ] 값을 정확히 `Marblo`로 입력하고 저장한다.
- [ ] **Project ID**, **Project number**는 편집하지 않는다.

효과: 콘솔/CLI에서 보이는 프로젝트 이름만 정리된다. Google 로그인 동의화면 문구를 이 단계만으로 바꾸지는 못한다.

### 2. OAuth 동의화면 App name (필수: 실제 증상 수정)

- [ ] [Google Cloud Console](https://console.cloud.google.com/) 상단 프로젝트 선택기에서 같은 프로젝트를 선택한다.
- [ ] 좌측 메뉴에서 **Google Auth Platform** > **Branding**으로 이동한다. 구 UI의 “OAuth consent screen”이 아니라 이 메뉴가 현재 경로다.
- [ ] **App information** > **App name**에 정확히 `Marblo`를 입력한다.
- [ ] User support email은 실제로 모니터링하는 주소인지 함께 확인한다.
- [ ] 페이지의 **Save**를 누른다.
- [ ] Branding 상태를 확인한다.
  - 검증이 필요하다는 버튼이 보이면 **Verify Branding**을 누른다.
  - 상태가 **Ready to publish**가 되면 7일 안에 **Publish branding**을 누른다.
  - 이미 검증된 브랜드를 수정하면 Draft Branding이 생성되고, 변경이 사용자에게 보이기 전에 재검증/게시가 필요할 수 있다.
- [ ] 완료 뒤 Branding의 Published Branding 또는 differences 보기에서 App name이 `Marblo`인지 확인한다.

Google 공식 문서상 App name/logo가 동의화면에 노출되려면 브랜드 검증과 게시가 필요할 수 있다. Draft만 저장하면 사용자에게는 기존 Published Branding이 계속 보인다. [브랜딩 관리 및 게시 흐름](https://support.google.com/cloud/answer/15549049) · [브랜드 검증](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)

### 3. `firebaseapp.com` 표시를 지금 바꾸지 않는 결정

- [ ] 이 단계에서는 `marblo-2253d.firebaseapp.com`을 삭제하거나 프로젝트 ID 변경을 시도하지 않는다.
- [ ] App name이 `Marblo`로 게시된 뒤 새 로그인에서 이름만 먼저 정상화됐는지 확인한다.

## `firebaseapp.com`을 감추고 싶은 경우: 별도 변경안

Firebase가 프로젝트별 `PROJECT_ID.firebaseapp.com`을 OAuth 리디렉션 메커니즘으로 배정하므로, 표시명 변경으로는 이 도메인이 변하지 않는다. Firebase 공식 경로는 Firebase Hosting에 소유한 도메인(예: `auth.marblo.app`)을 연결한 뒤 `authDomain`으로 쓰는 것이다. [Firebase Google 로그인 custom redirect domain](https://firebase.google.com/docs/auth/web/google-signin#customizing_the_redirect_domain_for_google_sign-in) · [redirect authDomain 변경 절차](https://firebase.google.com/docs/auth/web/redirect-best-practices)

필요 작업:

1. Firebase Hosting(동일 Firebase 프로젝트)에 전용 custom domain을 연결하고 DNS 소유권/SSL 발급을 완료한다.
2. Firebase Console > **Security** > **Authentication** > **Settings** > **Authorized domains**에 그 도메인을 추가한다.
3. Google Auth Platform의 OAuth 클라이언트 redirect URI에 `https://auth.marblo.app/__/auth/handler`를 추가한다.
4. 모든 웹 Firebase config의 `authDomain`을 해당 도메인으로 바꾸고, Hosting의 `/__/auth/*` reserved URL이 정상 제공되도록 배포한다.
5. 운영 로그인 회귀를 별도 런북으로 검증한다. Electron 패키징 앱은 현재 시스템 브라우저 + loopback PKCE 로그인도 사용하므로, redirect URI/클라이언트별 영향 분석을 함께 해야 한다.

| 항목 | 평가 |
| --- | --- |
| 효과 | OAuth 화면에 노출되는 Firebase 생성 서브도메인을 자체 도메인으로 대체할 수 있다. |
| 작업량 | 중간 이상: DNS, Hosting, Firebase Auth Authorized domains, Google OAuth redirect URI, 앱 환경설정/배포를 함께 바꿔야 한다. |
| 비용 | Firebase Hosting custom domain 자체는 별도 Hosting 도메인 비용 없이 가능하나, 이미 보유한 도메인·DNS 운영비는 별도다. |
| 리스크 | DNS/SSL 전파 지연, `__/auth/handler` 미구성 시 로그인 실패, 웹·Electron 인증 흐름의 설정 불일치. 롤백을 위해 기존 `firebaseapp.com` 도메인/URI는 새 경로가 검증될 때까지 유지한다. |

권고: 이번 티켓에서는 **App name만 `Marblo`로 게시**한다. `firebaseapp.com`이 실제로 신뢰/전환을 훼손한다는 관측이 생길 때만 별도 변경 티켓으로 custom domain을 도입한다.

## 기존 동의 사용자 영향

App name만 바꾸는 것은 OAuth client ID나 요청 scope를 바꾸지 않는다. Google은 사용자의 scope 승인을 프로젝트 단위 신뢰로 기록하며, `prompt=consent`가 없으면 이미 승인한 권한에 대해 최초 요청 때만 동의가 필요하다. 따라서 **정상적인 기존 승인 사용자에게 재동의를 요구하지 않는 것이 예상 동작**이다. 다만 브랜드가 검증되어야 변경 이름이 Published Branding으로 보이며, 사용자가 권한을 철회했거나 앱이 scope/client를 변경하면 별도 동의가 다시 나올 수 있다. [프로젝트 내 client 간 기존 승인 활용](https://developers.google.com/identity/protocols/oauth2/cross-client-identity) · [OAuth `prompt=consent` 동작](https://developers.google.com/identity/protocols/oauth2/web-server#creatingclient)

## 코드 점검 근거 (2026-09-02)

- 자동 생성 앱 이름 `마블로 프로젝트-57319`/`프로젝트-57319`: `v3`, `marblo-web`의 TypeScript/JavaScript/JSON을 검색했으나 **0건**. 코드 하드코딩이 아니다.
- `v3/src/lib/firebase.ts`: `authDomain`은 `VITE_FIREBASE_AUTH_DOMAIN` 환경변수에서만 읽는다.
- `marblo-web/src/lib/firebase.ts`: 환경변수가 없을 때 `marblo-2253d.firebaseapp.com`을 fallback으로 사용한다. 이는 OAuth auth handler 도메인 설정이며 App name이 아니다.
- `v3/src/auth/AuthProvider.tsx`, `marblo-web/src/app/[locale]/auth/login/page.tsx`: `GoogleAuthProvider`로 로그인하지만 `addScope()` 호출은 없다. 기본 로그인 외 Google API 권한을 코드에서 추가하지 않는다.

이 티켓에서 코드 변경은 하지 않았다. `authDomain` fallback을 무리하게 지우면 로그인 설정을 깨뜨릴 수 있어, custom domain 전환이 승인된 경우에만 관련 환경설정과 함께 변경한다.
