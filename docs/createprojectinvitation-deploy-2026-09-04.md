# createProjectInvitation 프로덕션 배포 기록 (2026-09-04)

- 티켓: `vzAInYirhRcTyZPG0r7G` — [배포·P0] 앱 팀원 초대가 죽어 있던 건
- 승인: 사장님 직접 승인 (2026-09-03)
- 배포자: devops 에이전트 / Firebase 계정 `john.kim@hypemarc.com`
- 프로젝트: `marblo-2253d`
- 배포 소스 커밋: `eccc545c` (= 배포 시점 `origin/main`)
- 코드 변경: **없음**. 이 문서는 순수 배포 기록이다.

## 1. 무엇이 문제였나

`createProjectInvitation` 콜러블이 #1356 으로 2026-09-01 15:04 KST 에 머지됐으나
**프로덕션에 배포되지 않았다.**

같은 PR 에서 클라이언트의 `invitations` 컬렉션 직접 쓰기가 제거되고
`teamService.createInvitation` 이 이 콜러블만 호출하도록 바뀌었다
(`v3/src/services/teamService.ts:208`). 즉 호출 대상이 프로덕션에 없는 상태 →
**앱에서 팀원 초대가 실패**하는 구간이 열려 있었다.

감사 PR #1378 (`docs/org-team-authz-audit-2026-09-02.md`) 이 먼저 이 사실을
지적했고, 배포 전에 아래와 같이 **독립적으로 재확인**했다.

## 2. 배포 전 부재 재확인 (감사 결과를 그대로 믿지 않음)

조회 도구: `firebase functions:list --project marblo-2253d`
(Cloud Functions API 를 전 리전·전 세대로 조회한다).
※ `gcloud` CLI 는 토큰 만료(`Reauthentication failed`)로 사용 불가하여
Firebase CLI 자격증명으로 조회했다.

| 항목 | 결과 |
| --- | --- |
| 배포된 함수 총수 | **127개** |
| 리전 분포 | `us-central1` 127건 (uniq=1) |
| 세대 분포 | `v1`(gen1) 127건 (uniq=1) |
| `createProjectInvitation` | **없음** (이름 검색 0건) |

리전·세대 uniq 가 각각 1이므로 "다른 리전이나 gen2 에 숨어 있다"는 가능성은
배제된다. 초대 관련으로 존재하던 것은 `acceptOrgInvitation`,
`createOrgInvitation`, `resolveOrgInvitation` 3개뿐이며 전부 **org 축**이고
**project 축 초대는 하나도 없었다.**

소스에는 존재했다: `v3/functions/src/index.ts:19358`
`export const createProjectInvitation = functions.https.onCall(`.

→ 감사 결론 재현 완료. 배포 사유 확인.

## 3. 같은 배치에서 누락된 다른 콜러블 — 전수 확인

`index.ts` 의 최상위 `export const` **128개** 전체를 프로덕션 127개와 diff 했다.

- 소스에 있고 프로덕션에 없음: **`createProjectInvitation` 1건뿐**
- 프로덕션에 있고 소스에 없음: **0건** (고아 함수 없음)

→ #1356 배치에서 함께 누락된 다른 콜러블은 **없다.** 배포 대상은 정확히 1개.

## 4. 배포처 선정 — 메인 체크아웃을 쓰지 않은 이유

메인 체크아웃(`/Users/dongwonkim/Documents/programming/marblo`)은 `3154fc15`
로 **`origin/main` 보다 17 커밋 뒤처져** 있었고, 사장님 dev 세션이 물려 있었다.
그 워킹트리에서 배포하면 구버전 소스가 올라간다.

→ 이 워크트리(`HEAD=eccc545c`, clean, `HEAD..origin/main`=0)에서 배포했다.
메인 체크아웃의 프로세스는 건드리지 않았다.

functions env 단일 소스(`v3/functions/.env.marblo-2253d`)는 메인 체크아웃에만
있으므로 배포 직전 `cp -p` 로 반입하고 **배포 직후 삭제**했다.

- 키 26개, 모드 `600` 유지, 값은 **일절 출력하지 않음**
- `v3/.gitignore:26` 에 의해 커밋 불가함을 `git check-ignore` 로 확인
- 배포 후 워크트리에서 삭제 확인, 메인 원본 무결(6716 bytes) 확인
- `v3/functions` 에 devDependency 추가 **없음** (Cloud Build `npm ci` 영향 없음)

## 5. 배포

**단일 `--only` 준수** (멀티 `--only` 가 조용히 일부를 누락시킨 전례 때문):

```
firebase deploy --only functions:createProjectInvitation --project marblo-2253d
```

로그 핵심:

```
i  functions: creating Node.js 20 (1st Gen) function createProjectInvitation(us-central1)...
✔  functions[createProjectInvitation(us-central1)] Successful create operation.
✔  Deploy complete!
```

`source-unchanged` 로 조용히 스킵된 것이 아니라 **실제 create** 였음을 로그
문자열로 확인했다.

## 6. 배포 후 검증 — "명령이 성공했다"는 확인이 아니다

### 6-1. 재조회로 존재·리전·세대 확정

`firebase functions:list` 재실행 결과:

| 함수 | 세대 | 트리거 | 리전 | 메모리 | 런타임 |
| --- | --- | --- | --- | --- | --- |
| `createProjectInvitation` | **v1 (gen1)** | callable | **us-central1** | 256MB | nodejs20 |

총 함수 수 **127 → 128**.

### 6-2. 반쪽 생성(allUsers invoker 누락) 전례 배제

과거 함수가 반쪽만 생성되어(invoker IAM 없음) 실패로 남은 전례가 있어,
미인증 콜러블 프로브로 직접 확인했다.

```
POST https://us-central1-marblo-2253d.cloudfunctions.net/createProjectInvitation
(인증 토큰 없음)
→ HTTP 401
  {"error":{"message":"Login required","status":"UNAUTHENTICATED"}}
```

**판정 근거 두 가지를 이 응답 하나가 동시에 증명한다:**

1. `"Login required"` 는 배포된 **함수 코드 자신의 문자열**이다
   (`index.ts:19361`). 이 문자열이 돌아왔다는 것은 컨테이너가 빌드·기동되어
   코드가 **실제로 실행**됐다는 뜻 — 즉 ACTIVE.
2. invoker IAM 이 빠진 반쪽 상태였다면 플랫폼이 코드 실행 **전에** 403 을
   돌려줬을 것이다. 401 이 왔다는 것은 **`allUsers` invoker 가 정상
   부여됐다**는 뜻이다.

**초대는 발송되지 않았다.** 이 콜러블은
`if (!context.auth) throw new HttpsError("unauthenticated", ...)` 가 함수 본문
**첫 문장**이라, Firestore 읽기/쓰기와 메일 발송 이전 단계에서 차단된다
(프로브 실행 전에 소스로 확인했다). 사람에게 메일이 나가지 않았다.

## 7. 앱 내 팀원 초대 경로 배선 판정 — 살아남

| 확인 항목 | 값 | 판정 |
| --- | --- | --- |
| 클라 호출 함수명 | `httpsCallable(functions, "createProjectInvitation")` (`teamService.ts:208`) | 배포된 이름과 일치 |
| 클라 functions 리전 | `FIREBASE_FUNCTIONS_REGION = "us-central1"` (`lib/firebase.ts:13`) | 배포 리전과 일치 |
| 클라 직접 쓰기 우회 경로 | #1356 에서 제거된 상태 유지 | 우회 없음 |

→ 초대 실패의 원인(콜러블 부재)이 제거되어 **배선상 초대 경로가 복구**됐다.
지시에 따라 **실제 초대는 발송하지 않았다** — 최종 확인은 사람이 앱에서
1건 시도해 보는 것으로 마무리하면 된다.

## 8. 범위 준수

- 배포한 것은 `createProjectInvitation` **1개뿐**이다.
- `firestore.rules` 는 이미 배포돼 있고(감사가 배포본 원문 diff 로 확인) 이번에
  **건드리지 않았다.**
- 코드 변경 0건. 롤백이 필요하면
  `firebase functions:delete createProjectInvitation --region us-central1`
  로 배포 전 상태(127개)로 되돌릴 수 있다. 단 되돌리면 앱 초대가 다시
  실패하므로, 롤백은 이 함수 자체에 문제가 확인된 경우에만 의미가 있다.

## 9. 남은 관찰 사항 (이번 범위 밖, 조치 안 함)

배포 로그가 함께 남긴 경고들 — 이번 티켓 범위가 아니라 기록만 한다.

- **Node.js 20 런타임이 2026-10-30 에 decommission 된다.** 그 전에
  런타임 업그레이드가 필요하다 (전 함수 128개 공통, 별도 티켓 권장).
- `firebase-functions` 패키지가 outdated 이며 업그레이드 시 breaking change 예고.
- 트리거 리전과 함수 리전이 어긋난 함수 8개
  (`sendApplyConfirmOnWaitlist`, `enforceProjectLimit`,
  `notifyAdminOnWaitlistApply`, `notifyAdminOnFounderFeedback`,
  `syncMarketingConsentOnUserWrite`, `syncMarketingContactOnWaitlistCreate`,
  `syncMarketingContactOnFounderWrite`,
  `syncMarketingContactOnSubscriptionWrite`) — 함수는 `us-central1`,
  트리거는 `asia-northeast3`. 불필요한 크로스리전 홉.
- 감사 문서 `docs/org-team-authz-audit-2026-09-02.md` (PR #1378) 는 이 배포
  시점에 **아직 main 에 머지되지 않았다** (커밋 `599ce56c` 는 별도 브랜치).
