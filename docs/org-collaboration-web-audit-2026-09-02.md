# 조직·팀 협업 웹 감사 (2026-09-02)

대상: marblo-web 조직·초대 경로. GUI, Playwright, Electron 실행 없이 정적 독해와 실행 가능한 CLI 검증만 수행했다.

## 결론

- 전체 경로는 대부분 이어진다: `/org/new` 생성 성공 → `/org/<orgId>` → 관리자 초대 폼 → `/join/<token>` → 수락 성공 → `/org/<orgId>` 버튼.
- 단절 1건: `resolveOrgInvitation`이 `already_accepted`에서 `orgId`를 반환하지만 프론트 파서가 버려서, 이미 수락한 사용자가 `/join/<token>`을 다시 열면 조직 홈 버튼이 사라진다.
- 리스크 1건: 초대 복사 URL이 `window.location.origin` 기반이라 로컬/프리뷰에서 생성하면 `localhost` 또는 프리뷰 host가 절대 URL로 복사된다. `/ko`는 붙지 않지만 프로덕션 canonical origin과 섞일 수 있다.
- 별도 수정 티켓 생성은 요청했다. 현재 세션에는 `create_tasks_bulk`/`create_task` 도구가 노출되지 않아 `ask_orchestrator` open question으로 남겼다: `ZLkzTsYriHdY5y2pUi81#qmtk4i8g7a7pp`.

## 한 바퀴 추적

1. `/org/new` 조직 생성
   - 클라이언트가 `createOrganization` 콜러블을 호출한다: `marblo-web/src/app/[locale]/org/new/page.tsx:74`.
   - 성공 응답은 `parseCreateOrganizationData`가 `orgId`와 `displayName`을 요구한다: `marblo-web/src/lib/orgOnboarding.ts:387`.
   - 생성 후 성공 화면의 조직 홈 링크는 `/org/<orgId>`다: `marblo-web/src/app/[locale]/org/new/page.tsx:112`.
   - 서버 콜러블은 존재하고, 조직 문서와 오너 멤버십을 한 트랜잭션으로 쓰며 `{ orgId, displayName, reused }`를 반환한다: `v3/functions/src/index.ts:18453`, `v3/functions/src/index.ts:18536`, `v3/functions/src/index.ts:18544`.
   - 판정: 이어진다.

2. 초대 링크 발급
   - 비개인 조직의 `org_admin` 이상에게만 초대 폼을 꽂는다: `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx:278`.
   - 폼은 `createOrgInvitation`을 호출하고 `orgId`, 이메일, 조직 역할, 선택 프로젝트를 보낸다: `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx:601`.
   - 서버는 `token`과 `/join/<token>` 형태의 `joinPath`를 반환한다: `v3/functions/src/index.ts:19314`.
   - 프론트는 서버 `joinPath` 문자열 대신 `token`으로 `joinPath(token)`을 재조립한다: `marblo-web/src/lib/orgOnboarding.ts:301`, `marblo-web/src/lib/orgOnboarding.ts:428`.
   - 판정: 이어진다.

3. 링크 조립과 복사
   - 한국어 기본 로케일은 `localeHref("ko", "/join/<token>")` 결과가 `/join/<token>`이므로 `/ko`가 붙지 않는다: `marblo-web/src/i18n/routing.ts:123`.
   - 초대 폼은 이 상대 경로에 `window.location.origin`을 붙여 절대 URL을 복사한다: `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx:641`.
   - canonical origin 상수와 절대 URL 헬퍼는 이미 있다: `marblo-web/src/lib/seo.ts:9`, `marblo-web/src/lib/seo.ts:25`.
   - 판정: `/ko` 문제는 없다. 다만 로컬/프리뷰 origin이 그대로 복사되는 리스크가 있다.

4. `/join/<token>` 수락
   - 페이지는 토큰을 decode하고 겉모양을 검사한 뒤 `resolveOrgInvitation`을 호출한다: `marblo-web/src/app/[locale]/join/[token]/page.tsx:55`, `marblo-web/src/app/[locale]/join/[token]/page.tsx:86`.
   - 비로그인 유효 토큰은 로그인/가입 링크로 이어지고, redirect는 같은 토큰 경로로 돌아오게 만든다: `marblo-web/src/app/[locale]/join/[token]/page.tsx:153`.
   - 로그인 상태에서 수락 버튼은 `acceptOrgInvitation`을 호출한다: `marblo-web/src/app/[locale]/join/[token]/page.tsx:117`.
   - 서버 수락은 `org_members`와 프로젝트 grant를 한 트랜잭션으로 처리하고 성공 시 `orgId`를 반환한다: `v3/functions/src/index.ts:19629`, `v3/functions/src/index.ts:19724`, `v3/functions/src/index.ts:19811`.
   - 수락 성공 화면은 `accepted.orgId`가 있으면 `/org/<orgId>` 버튼을 그린다: `marblo-web/src/app/[locale]/join/[token]/page.tsx:186`.
   - 판정: 새 수락은 이어진다.

5. `/org`에 구성원으로 착지
   - `/org/<orgId>`는 `getOrganizations({ orgId })`로 서버 멤버십과 교집합인 상세만 받는다: `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx:91`.
   - 상세가 있으면 마지막 본 조직을 저장하고 조직 홈을 그린다: `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx:162`, `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx:245`.
   - `/org` 루트는 서버 목록과 lastSeen으로 `resolveOrgLanding`을 적용한다: `marblo-web/src/app/[locale]/org/OrgLandingClient.tsx:98`, `marblo-web/src/app/[locale]/org/orgContract.ts:199`.
   - 판정: `/org/<orgId>` 경유 시 이어진다.

## 끊기는 지점

### 이미 수락한 토큰 재진입에서 조직 홈 버튼이 사라짐

- 서버는 본인이 이미 수락한 토큰에 대해 `orgId`를 내려준다: `v3/functions/src/index.ts:19546`.
- 프론트 `parseResolveInviteData`는 `already_accepted` 상태를 `{ kind: "already_accepted", invite }`로만 보존하고 `orgId` 필드가 없다: `marblo-web/src/lib/orgOnboarding.ts:177`.
- `JoinPage`는 `outcome.kind === "already_accepted"`일 때 `orgHomeHref={null}`로 고정한다: `marblo-web/src/app/[locale]/join/[token]/page.tsx:231`.
- 사용자가 보는 것: "이미 수락함" 완료 화면, 다운로드/가이드 진입점은 보이지만 조직 홈으로 가는 버튼은 없다.
- 권장 후속: resolve outcome에 `orgId`를 보존하고 `already_accepted` 화면에서도 `/org/<orgId>`를 제공하는 프론트 티켓.

## 상태 누락 점검

| 상태 | 판정 | 사용자가 보는 것 |
| --- | --- | --- |
| 비로그인 | 그려져 있다 | `/org`, `/org/new`는 로그인 안내와 로그인 링크. `/join/<token>` 유효 토큰은 초대 정보와 로그인/가입 CTA. |
| 로그인했지만 조직 없음 | 그려져 있다 | 서버 계약상 개인 조직이 항상 포함된다. `/org`는 `/org/me`로 보내고 개인 조직 화면에 조직 생성 안내를 보인다. |
| 이미 다른 조직 소속 | 그려져 있다 | 수락 후 `/org/<acceptedOrgId>` 버튼이 생긴다. 이후 `/org`는 lastSeen 또는 조직 선택 규칙으로 이동한다. |
| 만료된 토큰 | 그려져 있다 | 만료 안내 카드. 서버가 시각을 주면 만료일도 표시한다. |
| 이미 쓴 토큰 | 그려져 있으나 단절 있음 | 본인 재진입은 이미 수락 완료 화면을 보지만 조직 홈 버튼이 없다. 타인이 쓴 토큰은 invalid 계열 안내로 접힌다. |
| 권한 없음(viewer) | 그려져 있다 | 조직 롤업은 `org_member`에게 restricted 셀을 보인다. 초대 폼은 `org_admin` 이상에게만 노출되고 서버 permission 오류 문구도 있다. 조직 역할에 `viewer`는 없다. |
| 로딩 | 그려져 있다 | auth 준비, 조직 착지, 초대 해석, 롤업 로딩에 스피너/로딩 문구가 있다. |
| 에러 | 그려져 있다 | 조직 목록/상세 오류는 오류 박스와 재시도. 초대 판정 불가와 초대 생성 실패는 링크 탓을 하지 않는 안내/재시도 또는 폼 오류 문구. |

## `/ko` 및 URL 점검

- 조직·초대 경로의 링크 조립은 `localeHref`를 사용한다. 기본 한국어 로케일에서는 `/ko`가 붙지 않는다: `marblo-web/src/i18n/routing.ts:123`.
- 초대 토큰 경로는 `/join/${encodeURIComponent(token)}`로 조립된다: `marblo-web/src/lib/orgOnboarding.ts:428`.
- `/ko` 검색 결과 중 조직·초대 런타임 링크 조립에 `/ko` 하드코딩은 발견하지 못했다.
- `src/proxy.ts`는 stale `/ko/*`를 301로 처리한다: `marblo-web/src/proxy.ts:37`. 초대 링크 자체가 `/ko/join/...`으로 만들어지는 경로는 확인되지 않았다.
- 리스크: 초대 복사 URL은 canonical `SITE_URL`이 아니라 `window.location.origin` 기반이다. 로컬 또는 프리뷰에서 관리자가 링크를 만들면 그 origin이 공유된다: `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx:644`.

## i18n 점검

- `org`와 `orgOnboarding` 문구는 `messages/ko.json`, `messages/en.json`, `messages/ja.json`에 있다.
- `OrgViews`, `OrgHomeClient`, `JoinViews`, `JoinPage`, `OrgIntakeViews`의 사용자 표시 문구는 copy 객체를 통해 렌더된다.
- 사용자 노출 한국어 하드코딩은 조직·초대 컴포넌트에서 발견하지 못했다.
- 주의: 조직 롤업은 서버가 주는 `disabledReason`, `basisLabel`, `projectsTruncatedNote`, `costNotBillingNote`를 그대로 표시하는 경로가 있다: `marblo-web/src/app/[locale]/org/OrgUsageView.tsx:131`, `marblo-web/src/app/[locale]/org/OrgUsageView.tsx:313`. 서버가 코드 없이 한국어 산문만 보내면 en/ja에 한국어가 노출될 수 있다.

## 테스트 기준선

- `npm test` 실행 결과: 실패. 스위트까지 도달하지 못하고 `tsx: command not found`로 종료.
- `npm run typecheck` 실행 결과: 실패. `next`, `next-intl`, `firebase-admin`, React 타입 등 패키지/타입을 찾지 못하는 오류가 대량 발생.
- `npm run lint` 실행 결과: 실패. `eslint` 패키지를 찾지 못함.
- 원인: `marblo-web/node_modules`가 없고 `npm install` 금지 조건 때문에 의존성을 설치하지 않았다.
- 조직·초대 관련 기존 테스트 파일은 존재한다: `marblo-web/src/lib/orgOnboarding.test.ts`, `marblo-web/src/app/[locale]/join/[token]/JoinViews.test.tsx`, `marblo-web/src/app/[locale]/org/orgContract.test.ts`, `marblo-web/src/app/[locale]/org/OrgViews.test.tsx`.
- 분리 판단: 이번 실행에서 조직·초대 테스트 자체의 빨간불은 확인되지 않았다. 현재 기준선 실패는 의존성 부재로 인한 실행 환경 실패다.

## 후속 티켓 필요

1. `/join` already_accepted 응답의 `orgId`를 프론트 상태에 보존하고 조직 홈 CTA를 복구.
2. 초대 복사 URL의 origin 정책 결정. 프로덕션 공유 링크는 `localeUrl`/`SITE_URL` 기반으로 만들지, 프리뷰 origin을 허용할지 제품 정책이 필요하다.
3. 조직 롤업 서버 산문 필드가 en/ja에 한국어로 노출되지 않도록 code-first 표시를 강제하거나 서버 응답을 로케일 키로 제한.
