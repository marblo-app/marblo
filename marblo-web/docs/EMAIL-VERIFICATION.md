# 이메일 인증 플로우 (email/password 파운더)

## 왜 있나

`submitFounderFeedback`(v3/functions/src/index.ts)는 호출자 ID 토큰의
`email_verified !== true` 면 `failed-precondition` 으로 거절한다. 무료 Pro 를
남의 주소로 타가는 걸 막는 경계라 **게이트는 유지**한다.

문제는 통과 경로가 없었다는 것. Google 로그인은 `email_verified` 를 공짜로
받지만, email/password 가입은 제품 어디에서도 `sendEmailVerification` 을
호출한 적이 없었다(변경 전 레포 전체 참조 0건). 즉 email/pw 파운더는 설문을
**영구히** 제출할 수 없었다. 이 플로우는 그 빠진 경로를 채운다.

## 코드 지도

| 파일                                          | 역할                                                           |
| --------------------------------------------- | -------------------------------------------------------------- |
| `src/lib/emailVerification.ts`                | continueUrl 조립·재발송 쿨다운·에러 매핑(순수) + Firebase 래퍼 |
| `src/lib/emailVerification.test.ts`           | 위 순수 로직 단위 테스트 (`npx tsx --test`)                    |
| `src/components/EmailVerificationActions.tsx` | 재발송 / "다시 확인" 버튼 (두 화면 공용)                       |
| `src/app/[locale]/auth/verify/page.tsx`       | 인증 안내 화면 = 메일 링크의 착지점(continueUrl)               |
| `src/app/[locale]/auth/signup/page.tsx`       | 가입 직후 1차 발송                                             |
| `src/app/[locale]/beta-survey/page.tsx`       | 미인증 배너 + 제출 잠금                                        |

## 흐름

```
가입(email/pw) → sendEmailVerification → /auth/verify?sent=1
   → (메일의 링크 클릭) → Firebase가 계정 인증 → continueUrl 로 복귀
   → /auth/verify 가 reload + getIdToken(true) → 성공 화면 → Continue
```

설문 화면에서 미인증이면 같은 버튼 묶음이 배너로 뜨고, 인증되는 순간
**그 자리에서** 잠금이 풀린다(작성 중인 답변 유지).

## ★ getIdToken(true) 가 핵심

게이트는 `emailVerified` 플래그가 아니라 **토큰 클레임**을 읽는다. 링크를
눌러도 캐시된 ID 토큰은 최대 1시간 동안 `email_verified: false` 를 들고 있어,
강제 토큰 갱신 없이는 인증하고도 계속 거절당한다. 에뮬레이터 검증에서 이
경계를 명시적으로 확인했다(`refreshEmailVerified` 참고).

## 콘솔 쪽 선행조건 (코드로 못 함)

1. **Authorized domains** — Authentication → Settings → Authorized domains 에
   `marblo.app` 이 있어야 continueUrl 이 통과한다. 없으면 Firebase 가
   `auth/unauthorized-continue-uri` 로 거절한다. (Google 팝업 로그인이 이미
   동작 중이므로 등록돼 있을 것으로 보이나, 배포 전 확인 권장.)
   — 미등록이어도 인증 자체는 살아있다: 코드가 continueUrl 없이 1회 재시도해
   Firebase 기본 확인 페이지로 폴백한다(복귀 홉만 사라짐).
2. **템플릿·발신자** — Authentication → Templates → Email address verification.
   Firebase 내장 발신 주소는 `noreply@<project>.firebaseapp.com` 이며 커스텀
   SMTP 없이는 바꿀 수 없다. 사내 방침(모든 아웃바운드 = team@marblo.app)에
   맞추려면 **reply-to 를 team@marblo.app 으로** 설정할 것. 이 때문에 앱 카피는
   구체 주소 대신 "Marblo 에서 발송"으로 적었다 — 실제 From 헤더와 어긋나는
   문구는 오히려 피싱처럼 보인다.
3. **템플릿 현지화** — 콘솔 템플릿은 언어별로 따로 저장된다. 해외 대상이므로
   최소 en/ko 두 벌 확인.

## 에뮬레이터로 검증하기

프로덕션 write 는 비가역이라 검증은 Auth 에뮬레이터로 한다.

```bash
npx firebase emulators:start --only auth --project marblo-2253d
```

에뮬레이터는 메일을 보내지 않고 oobCode 를 REST 로 노출한다:
`GET http://127.0.0.1:9099/emulator/v1/projects/marblo-2253d/oobCodes`.
그 `oobLink` 를 fetch 하면 "링크 클릭"과 동치이고, 이후
`getIdToken(true)` 로 받은 JWT 의 `email_verified` 를 디코드해 게이트 통과를
확인할 수 있다.
