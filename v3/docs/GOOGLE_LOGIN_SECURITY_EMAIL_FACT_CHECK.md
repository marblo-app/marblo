# Google 로그인 “계정 데이터 일부를 공유” 보안 메일 사실확인

조사일: 2026-09-02. 범위는 사용자가 Google 로그인/권한을 승인한 뒤 Google이 계정 소유자에게 보내는 “Google 계정 데이터 일부를 …와 공유하셨습니다”류의 보안 메일이다. Marblo가 보내는 제품 메일이나 Firebase 이메일 템플릿은 대상이 아니다.

## 판정

**개발자가 Google Auth Platform, Firebase Authentication 또는 OAuth 요청 파라미터로 이 Google 보안 메일을 끄는 공식 수단은 찾지 못했다. 따라서 억제 불가로 취급한다.**

근거는 단순한 추측이 아니다.

- Google의 계정 도움말은 사용자가 제3자 앱에 권한을 주면 Google이 공유할 데이터와 권한을 설명하고, 사용자가 연결을 검토·제거하게 하는 Google Account 보호 흐름으로 설명한다. 개발자에게 해당 알림을 제어하는 설정은 제시하지 않는다. [제3자 앱과 Google 계정 데이터 공유](https://support.google.com/accounts/answer/14012355)
- Google의 공식 개발자 문서는 제3자 접근을 부여하면 Google이 **mandatory email notification**을 보낸다고 명시한다. 문서는 Business Profile OAuth 맥락이지만, 메일은 Google이 계정 소유자에게 보내는 보안 알림이며 개발자 콘솔에서 억제하는 옵션을 제시하지 않는다. [Google Business Profile OAuth setup](https://developers.google.com/my-business/content/oauth-setup)
- Google Security Blog도 사용자가 계정 데이터를 앱/사이트와 공유할 때 알림을 확대한다고 밝혔다. 이 알림은 사용자 인지·보호 목적이다. [Google Security Blog: Announcing some security treats to protect you from attackers’ tricks](https://security.googleblog.com/2018/10/announcing-some-security-treats-to.html)

이것은 “Google 쪽 보안 메일”이므로 Firebase Console > Authentication > Templates에서 바꾸거나, 앱 발신 메일을 바꾸는 것으로 억제되지 않는다. 그 Templates 기능은 Firebase가 보내는 인증 이메일용이다.

## 사용자 체감 완화 레버

| 레버 | 효과 | 작업량 | 리스크 / 권고 |
| --- | --- | --- | --- |
| App name 정상화 | 메일·동의화면에 보이는 자동 생성 프로젝트 이름을 `Marblo`로 바꿔 낯섦을 줄인다. 메일 자체는 남는다. | 낮음(콘솔 Branding) | 검증된 브랜드라면 Draft → Verify Branding → Publish branding 절차가 필요할 수 있다. **즉시 권고**. 상세는 `GOOGLE_OAUTH_BRANDING_RUNBOOK.md`. |
| 요청 scope 최소화 | 메일/동의화면에서 “무엇을 공유했는가”의 무게를 최소화한다. 불필요한 Gmail/Drive/Calendar 등 민감·제한 범위 요청을 피한다. | 낮음~중간(기능별 점검) | 필요한 기능을 먼저 넣고 나중에 빼면 재동의/기능 실패가 생길 수 있다. 로그인 scope와 별도 커넥터 scope를 분리한다. **계속 유지**. |
| Publishing status를 In production으로 유지 | Testing의 100명 제한·7일 동의 만료와 테스트 사용자 경고를 피한다. | 낮음(콘솔 상태 확인) | 공개 서비스가 준비되지 않은 상태에서 Production으로 바꾸면 운영/검증 의무가 생긴다. 실제 공개 서비스면 **권고**. |
| Branding/Data Access verification 완료 | 이름·로고·도메인의 신뢰를 높이고 민감/제한 scope의 “unverified app” 경고를 막는다. | 중간~높음(검증 자료/정책/심사) | 보안 메일은 제거하지 못한다. scope 추가·브랜딩 변경은 재검증을 요구할 수 있다. 필요한 scope에만 진행. |
| `firebaseapp.com`을 custom auth domain으로 대체 | OAuth 경로에서 생성 도메인 대신 소유 도메인을 보일 수 있다. | 중간 이상(DNS/Hosting/OAuth URI/config 배포) | 로그인 장애 가능성이 있어 별도 변경으로 다룬다. 메일 억제 수단은 아니다. |

Google은 Testing을 100명의 테스트 사용자로 제한하고, 테스트 사용자의 승인은 7일 후 만료된다고 명시한다. In production은 모든 Google 계정이 사용할 수 있으며, 민감/제한 scope 미검증 시 unverified warning이 표시된다. [Audience / publishing status](https://support.google.com/cloud/answer/15549945) · [Data Access와 scope 검증](https://support.google.com/cloud/answer/15549135)

## 현재 Marblo 로그인 scope: 코드 근거

### 일반 Google 로그인

| 경로 | 확인 결과 |
| --- | --- |
| 패키지 Electron | `v3/electron/google-oauth.ts`의 `runGoogleLoopbackOAuth()`가 명시적으로 `openid email profile`만 요청한다 (해당 파일 351행 부근). |
| 데스크톱 renderer | `v3/src/auth/AuthProvider.tsx`에서 `new GoogleAuthProvider()`를 생성하고 `addScope()`를 호출하지 않는다. |
| 웹 로그인 | `marblo-web/src/app/[locale]/auth/login/page.tsx`에서 `new GoogleAuthProvider()`를 생성하고 `addScope()`를 호출하지 않는다. |

Firebase 공식 문서는 `GoogleAuthProvider`의 추가 OAuth 범위는 개발자가 `addScope()`를 호출할 때 넣는다고 설명한다. 따라서 위 경로는 기본 로그인 범위 외 Google API 범위를 추가하지 않는다. [Firebase Google 로그인](https://firebase.google.com/docs/auth/web/google-signin)

**결론:** 일반 로그인에서 실제 요청 범위는 `openid`, `email`, `profile`이며, 이보다 넓은 Google API scope는 발견하지 못했다. Google Audience 문서도 name/email/profile 기본 identity 범위만 요청하는 경우를 별도 예외로 다룬다. [Audience / publishing status](https://support.google.com/cloud/answer/15549945)

### 별도 기능 동의와 혼동 금지

`v3/electron/google-drive-auth.ts`와 `v3/electron/google-restricted-scopes.ts`에는 Drive/Gmail/Calendar/Contacts/Sheets 범위의 상수·보류 설계가 있다. 하지만 `google-oauth.ts` 주석과 로그인 함수는 이를 일반 로그인에서 요청하지 않고, Google Drive 연결은 별도 incremental authorization 흐름으로 분리한다. 이 티켓의 보안 메일이 **일반 로그인 직후** 온 것이라면 위 기본 identity scope가 원인이다. 사용자가 향후 별도 연동을 승인할 경우에는 그 기능이 요청하는 scope를 다시 확인해야 한다.

## 사장님이 현재 상태를 보는 콘솔 경로

프로젝트 선택기를 먼저 올바른 Firebase/Google Cloud 프로젝트로 맞춘 뒤 다음을 확인한다.

1. **Publishing status / user type**
   - Google Cloud Console > **Google Auth Platform** > **Audience**
   - **Publishing status**가 `Testing`인지 `In production`인지 확인한다.
   - External 앱이라면 Testing에서는 test users와 100명 한도도 확인한다.
2. **Branding verification**
   - Google Cloud Console > **Google Auth Platform** > **Branding**
   - Published/Draft branding과 **Verify Branding**, **Ready to publish**, **Publish branding** 상태를 확인한다.
3. **Data Access(scope) verification**
   - Google Cloud Console > **Google Auth Platform** > **Data Access**에서 실제 등록 scope를 확인한다.
   - **Google Auth Platform** > **Verification Center**에서 Branding status와 Data access status를 각각 확인한다.
4. **Firebase Google provider 활성화 여부**
   - Firebase Console > **Security** > **Authentication** > **Sign-in method** > **Google**.

Google은 Branding과 Data Access를 별도 검증 축으로 관리하며, Verification Center에서 각각 추적한다고 안내한다. [브랜딩과 Data Access 검증](https://support.google.com/cloud/answer/15549049)

## 운영 권고

1. 티켓 1 런북대로 App name을 `Marblo`로 검증·게시한다.
2. 일반 로그인에는 현재의 `openid email profile` 외 scope를 추가하지 않는다.
3. Google Drive 등 연동을 다시 열기 전, 기능마다 scope·검증 비용·사용자 동의 문구를 별도 검토한다.
4. Audience에서 Production/verification 상태를 확인해, 공개 서비스인데 Testing 또는 unverified warning 상태가 남지 않게 한다.
5. 고객 문의에는 “Google 계정이 제3자 로그인 권한 부여를 알리기 위해 직접 보낸 보안 메일이며, Marblo가 보낸 메일이나 비밀번호 공유 알림이 아니다. Marblo 로그인은 기본 프로필(이름/이메일/프로필 사진) 범위만 요청한다.”라고 안내한다. 실제 화면의 scope가 다르면 이 문구보다 콘솔/로그인 화면을 우선한다.

## 검증 한계

이 작업은 소스·공식 문서의 정적 확인이다. 프로젝트 소유자 계정이 필요한 Google Console 상태값(현재 Production/Testing, 현재 브랜드·scope 검증 통과 여부)은 변경하거나 실시간 조회하지 않았다. 또한 사용자 Google 계정에서 실제 메일을 재현하는 GUI/브라우저 검증은 저장소 운영 규칙에 따라 수행하지 않았다.
