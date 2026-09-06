# 하이프마크 조직·분석 시연 — 숫자가 뜨는지 실측 (2026-09-06)

티켓 `Y4wcieyXuaxHGBsV84gW` · 역할 backend · 판정 시각 2026-09-06 (코드 읽기 + 배포된 콜러블에 대한 무인증 HTTP 존재확인만, Firestore 프로덕션 데이터는 쿼리하지 않음)

①②③(조직 생성/멤버 초대/초대 목록 콜러블 라이브)은 오케가 직접 실측 완료 — 재검증하지 않음. 이 문서는 ④~⑦만 다룬다.

## ④ 조직 생성 직후 대시보드 — 숫자 뜸 / 빈 상태?

**빈 상태(`empty`)가 뜬다. 정상 설계다.**

- `getOrgUsageSummary`(`v3/functions/src/index.ts:18684` 부근)는 결합된 프로젝트(`org_project_bindings`)가 0건이면 **BQ 질의를 아예 하지 않고** `buildTeamUsageEnvelope({..., folded: null})`을 반환한다(주석: "★빈 상태가 기본이다: 결합 0건이면 질의 없이 empty 봉투").
- `buildTeamUsageEnvelope`(`v3/functions/src/teamUsage.ts:1447`)의 상태 판정: `folded == null` → **`state: "empty"`**. `not_provisioned`도 `disabled`도 아니다.
- 즉 조직을 막 만들고 프로젝트를 하나도 안 붙인 시점엔 `usage.empty.*` 문구(왜 비었는지·언제 차는지)가 뜬다 — 화면 깨짐이나 로딩 무한대기가 아니다.

**★그런데 더 중요한 발견 — 프로젝트를 붙여도 오늘(09-06)은 여전히 비어 보인다:**

- 배포된 게이트 값 `TEAM_USAGE_EFFECTIVE_FROM=2026-09-07`(`docs/team-usage-phase0-rollout-2026-08-31.md` 실측 인용, 재조회 안 함).
- `resolveTeamUsageGate`의 `open`은 "값이 유효한 날짜냐"만 보고 **미래 날짜여도 `open:true`**다(`v3/functions/src/teamUsage.ts:131-160`).
- 그다음 `clampWindowToGate`(`teamUsage.ts:673-687`): 오늘(`todayUtc=2026-09-06`)의 조회 창은 `toDayExclusive=2026-09-07`. `effectiveFrom("2026-09-07") >= toDayExclusive("2026-09-07")`이 **참**이라 `window.empty=true`로 잘린다.
- 결과: **2026-09-06(오늘)에는 프로젝트를 붙여도 조회 창 자체가 비어서 `state: "empty"`로 뜬다.** `2026-09-07`부터 창이 열려 그날 이후의 실제 활동이 잡히기 시작한다(그 이전 활동은 이 게이트 안에서는 영구히 안 잡힘 — 설계된 컷오프).

## ⑤ 프로젝트↔조직 결속 경로 — UI 있음 / 없음?

**있다.** `bindProjectToOrg` 콜러블(`v3/functions/src/index.ts:18285`)이 `org_project_bindings` 컬렉션에 결합 행을 쓰고, `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx`의 **`BindProjectForm`**(같은 파일 359행 부근, `/org/[orgId]` 조직 홈 화면, "프로젝트 결합하기" — 팀 콤보는 기존 팀 선택/새 팀 만들기 상호배타)이 그걸 부른다. 무인증 HTTP 존재확인(POST, 인증 없음): `401 {"error":{"message":"Login required"}}` — **배포돼 있음** 확인.

★선행 티켓(`HsTx9ZrKuLFQ8xkcf5JL`) 실측 시연 절차에 이미 이 단계가 있다: "조직 홈 → '프로젝트 결합하기' → 프로젝트 선택 → 팀 콤보 '＋ 새 팀 만들기' → 이름 입력 → 결합".

## ⑥ 사람별 브레이크다운 — datagadapida/melocream이 행으로 나오나?

**나온다 — 코드로 다리까지 확인. 단, 새로 병합된 조각 하나는 아직 배포 전이다.**

- 다리: `getTeamUsageSummary(projectId)`(비용·토큰·모델, `byMember[]`)와 `getTeamProjectAudit(projectId)`(성공/실패 티켓 카운트)가 **둘 다** 서버에서 `pseudonymizeAnalyticsId("teamMember", uid, readAnalyticsIdSalt())`를 지난다 — `teamUsage.ts:788`(`teamMemberKey`)과 `index.ts:16341` 양쪽에서 확인. 같은 salt·같은 kind(`"teamMember"`)라 같은 가명 공간 → **비용과 성공/실패가 같은 사람 행으로 조인된다.** 이 다리 자체는 2026-08-22(#1106)부터 존재해 이미 라이브.
- 사람 집합은 `projects.members`(배열)에서 나온다. `acceptOrgInvitation`(`index.ts:20136`)이 초대 수락 시 **단일 트랜잭션**으로 `projects.members` arrayUnion + `memberRoles/{projectId}_{uid}` + 조직 멤버 문서를 같이 쓴다(`index.ts:20123` 부근 주석: "가입은 됐는데 소속 없음 반쪽 상태가 만들어질 수 없다"). 즉 초대 폼에서 "데이터팀 프로젝트" 체크박스를 체크해 초대하면, 수락 즉시 그 프로젝트의 `members`에 실제로 들어간다 — datagadapida/melocream이 그 프로젝트에서 활동하면 `byMember`에 각자 행으로 뜬다.
- **표시되는 화면**: `/org/[orgId]`에 조직>팀>프로젝트 3단(Phase 2, 이미 배포됨) 아래 사람>에이전트·모델 2단을 더 얹은 **5단 드릴다운**(`OrgDrilldownView.tsx`/`orgDrilldownContract.ts`, #1497, `origin/main` 커밋 `d5592059`, 2026-09-06 22:24 KST 머지)이 `OrgHomeClient.tsx`/`OrgViews.tsx`에 배선돼 있음을 확인.
- ★**성공/실패는 계정 축(티켓 상태)만.** 익명 설치 축(`task_outcomes`)의 모델별 성공률은 사람에게 아직 안 붙는다 — 커밋 주석: "Phase 4a가 각인까지는 했지만 그 축을 읽는 뷰·콜러블이 아직 없다". 화면은 이걸 `0%`가 아니라 "미배선"으로 구분해서 보여준다(설계 규율 준수).
- ★**배포 갭 발견(새로 발견, 이전 티켓엔 없던 사실)**: 이 5단 드릴다운 커밋(`d5592059`)이 `v3/functions/src/teamUsage.ts`의 순수 집계 함수 `foldTeamUsage`에 **사람별 `byModel`/`byActorKind`**(모델·에이전트종류 분해) 필드를 새로 추가했다. 이 커밋은 마지막 확인된 functions 배포(`9db13739`, 2026-09-05 19:42 KST, devops 티켓 `nHsOwE1IPk8nfEUMyPBu`가 배포 완료 처리)**보다 나중**(2026-09-06 22:24 KST)이다 → **`git merge-base --is-ancestor d5592059 9db13739`가 false, 즉 이 사람별 모델/에이전트 분해 로직은 아직 배포된 Cloud Functions에 없을 가능성이 높다.** marblo-web(프론트)이 Vercel로 별도 배포되면 화면(OrgDrilldownView)은 먼저 뜰 수 있는데, 그 화면이 기대하는 `byModel`/`byActorKind` 필드를 서버가 아직 안 주면 그 칸만 빈 배열로 접힐 것(코드 방어 패턴상 크래시는 아닐 것으로 보이나, **필드 부재 시 정확히 어떻게 접히는지까지는 확인 못 했다** — 정직하게 "확인 못 함"으로 남긴다). ★**functions 재배포 필요 여부를 발표 전에 확인해야 한다.**

## ⑦ 사장님이 시연 전에 손으로 해두셔야 할 일

순서대로:

1. **(발표가 09-06 당일이면) 타이밍부터 인지**: `TEAM_USAGE_EFFECTIVE_FROM=2026-09-07` 게이트 때문에 **09-06에는 프로젝트를 붙이고 멤버가 활동해도 숫자가 안 뜬다.** 09-07 이후로 발표를 잡거나, "09-07부터 데이터가 쌓이기 시작한다"고 발표 중 설명할 준비가 필요하다. ★이건 사장님이 손으로 해결할 수 있는 일이 아니라 **일정 조정 또는 기대치 설정**의 문제다.
2. `/ko/org/new`로 직접 이동(헤더에 `/org` 진입 링크가 아직 없음 — 선행 티켓이 이미 잔여 갭으로 남김) → 조직 이름(예: "하이프마크") 입력 → 만들기.
3. 조직 홈에서 **"프로젝트 결합하기"** → 기존 프로젝트 선택 → 팀 콤보에서 "＋ 새 팀 만들기"(예: "데이터팀") → 결합.
4. **"멤버 초대하기"** → datagadapida 이메일 입력 → 역할 지정 → **데이터팀 프로젝트 체크박스를 반드시 체크**(이걸 안 하면 프로젝트 멤버가 안 되고, 사람별 브레이크다운에도 안 뜬다) → 링크 생성·복사 → 전달. melocream도 동일 반복.
5. 상대가 링크(`/join/<token>`)로 로그인/가입 후 수락.
6. (선택, 발표 임팩트용) 09-07 이후, datagadapida/melocream이 실제로 로그인해 프로젝트에서 에이전트를 한 번 이상 돌려 `cost_logs` 행을 만든다 — 그래야 사람별 행에 진짜 숫자가 붙는다. 안 돌리면 여전히 "행은 있는데 0/미수집"으로 뜬다(이게 배선 문제가 아니라 데이터 없음인 걸 화면이 구분해서 보여줌).
7. **발표 직전 확인**: `listOrgInvitations`/`revokeOrgInvitation`/`updateProjectMembership`/`bindProjectToOrg`/`getOrgUsageSummary` 5개 전부 무인증 POST 시 `401 Login required`로 응답하는지 재확인(존재=배포됨의 신호) — 오늘(09-06) 재확인 결과 **5개 전부 라이브**. 단 5단 드릴다운의 사람별 모델 분해(⑥의 배포 갭)는 별도 확인 필요.

## 배포 상태 재확인 (오케 지시 — "9/5 이후 다시 재라")

무인증 HTTP POST(데이터 미전송, 존재만 확인 — Firestore 미접근)로 5개 콜러블 전부 `401 {"error":{"message":"Login required","status":"UNAUTHENTICATED"}}` 확인:

| 콜러블                    | 2026-09-05 09:23 상태(선행 티켓) | 2026-09-06 재확인 |
| ------------------------- | -------------------------------- | ----------------- |
| `listOrgInvitations`      | ❌ 배포 대기                     | ✅ 라이브         |
| `revokeOrgInvitation`     | ❌ 배포 대기                     | ✅ 라이브         |
| `updateProjectMembership` | ❌ 배포 대기                     | ✅ 라이브         |
| `bindProjectToOrg`        | (기존 라이브)                    | ✅ 라이브         |
| `getOrgUsageSummary`      | (기존 라이브)                    | ✅ 라이브         |

근거: 세 "보안 성격" 커밋(`669e4e52`/`91b09408`/`f3b6e52c`, listOrgInvitations·revokeOrgInvitation·updateProjectMembership 도입분)이 `git merge-base --is-ancestor`로 확인 시 마지막 배포 빌드 커밋 `9db13739`(devops 티켓 `nHsOwE1IPk8nfEUMyPBu`, 132/132 함수 성공)의 조상임을 확인 — 즉 재배포에 포함됐고, HTTP 401 응답으로 실측 교차검증됨. **선행 티켓의 "초대 목록이 안 뜬다" 경고는 이제 해소된 것으로 보인다.**

## 확인 못 한 것 (정당한 답)

- `byModel`/`byActorKind` 필드가 서버에서 실제로 배포됐는지는 콜러블 존재확인(401)만으로는 알 수 없다(존재와 버전은 다른 것). 인증 세션이 없어 실제 응답 바디를 못 봤다 — **확인 못 함.**
- 5단 드릴다운 화면이 그 필드 부재를 실제로 어떻게 접는지(빈 배열 vs 에러)는 코드 방어 패턴 추정이고 직접 실행 확인은 못 했다.
- 09-06 현재 사장님 프로젝트에 실제로 얼마나 되는 `cost_logs`가 있는지는 조회하지 않았다(전역 SUM 금지 원칙 + 라이브 Firestore 쿼리 사전 보고 원칙에 따라 스킵, 필요하면 별도 요청).
