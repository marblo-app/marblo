/**
 * 조직 화면 문구 — ko·en·ja. `teamCopy.ts` 와 같은 규약:
 *   1. 문구가 데이터라 테스트가 로케일 세 벌을 전부 읽어 규약을 검사한다.
 *   2. 프레젠테이션 컴포넌트가 next-intl 훅에 묶이지 않아 `renderToStaticMarkup`
 *      으로 화면 바이트를 검사할 수 있다.
 *
 * 키가 빠지면 영어 폴백으로 떨어진다(사고 방지책). 세 벌 완결성은 테스트가 막는다.
 */

/** 화면이 쓰는 문구 키 전부. ★여기 없는 문자열을 컴포넌트에 하드코딩하지 않는다. */
export const ORG_COPY_KEYS = [
  "title",

  // 조직 선택 화면(§3.3 규칙 3) — 여러 조직 소속자만 도달한다
  "choose.title",
  "choose.body",

  // 이름 폴백 — 화면에 식별자를 뿌리지 않는다
  "org.personalName",
  "org.personalNote",
  "org.unnamed",

  // 역할 배지
  "role.org_owner",
  "role.org_admin",
  "role.org_member",

  // 스위처 — ★조직이 하나뿐이면 아예 그리지 않는다
  "switcher.label",

  // 개인 조직(/org/me) — ★팀 개념을 그리지 않는다(#1336 §4.1)
  "personal.subtitle",
  // ★빈 상태 규약(#1333 §7): 조직 0건이 기본값 — 왜 비었고 언제 차는지 말한다
  "personal.createHint",
  "personal.createCta",

  // 조직 전체 사용량(L0) 칸 — Phase 2 롤업(getOrgUsageSummary)
  "usage.title",
  "usage.loading",
  "usage.error",
  "usage.disabledFallback",
  "usage.notProvisionedFallback",
  // ★빈 상태가 기본이다(#1333 §7) — 왜 비었고 언제 차는지를 화면이 말한다
  "usage.empty.title",
  "usage.empty.why",
  "usage.empty.when",
  // ★집계 기준 명시 — 미인증 사용량은 기록 자체가 없다(logCostBatch 가 로그인 요구)
  "usage.loginBasis",
  "usage.truncatedFallback",
  "usage.effectiveFrom",
  // ★조회 창의 실제 시작일·끝날(티켓 EmHUecXSgXSyrF2XgJ8b) — `usage.effectiveFrom`
  //   (게이트 발효일)과 다른 사실이다. 이 문구가 없으면 발효일 옆의 숫자가
  //   "발효일부터의 합계" 로 읽힌다.
  "usage.window",
  // ★조회 기간 선택자(티켓 jNWaeaazqJYNImWs4BXO, 사장님 지시) — 오른쪽 위.
  "usage.range.label",
  "usage.range.days",
  "usage.range.custom",
  "usage.range.customLabel",
  // ★고른 기간보다 실제로 짧게 나올 때(게이트가 시작일을 올렸을 때) 그
  //   격차를 말한다 — `usage.window` 가 "실제로 몇 일인지" 를 이미 말하니
  //   여기서는 "그게 고른 것보다 짧다" 는 사실 하나만 더한다.
  "usage.range.clamped",
  "usage.freshness",
  "usage.projectsInScope",
  "usage.costTitle",
  "usage.tokensTitle",
  "usage.realZero",
  "usage.table.team",
  "usage.table.cost",
  "usage.table.tokens",
  "usage.table.projectsCount",
  "usage.table.unassigned",
  "usage.table.unknownTeam",
  "usage.table.total",
  "usage.table.unassignedHint",
  "usage.byDay.title",
  "usage.byDay.partial",

  // 조직 작업 성과(완료·실패) 롤업 — `getTeamProjectAudit` 를 프로젝트마다 모은
  // 표현일 뿐, 새 콜러블이 아니다(`orgOutcomesContract.ts` 참고).
  "outcomes.title",
  "outcomes.loading",
  "outcomes.error",
  "outcomes.basisNote",
  "outcomes.noBindings.title",
  "outcomes.noBindings.body",
  "outcomes.noAccess.title",
  "outcomes.noAccess.body",
  "outcomes.doneLabel",
  "outcomes.failedLabel",
  "outcomes.openLabel",
  "outcomes.rate.label",
  "outcomes.rate.denominator",
  "outcomes.rate.none",
  "outcomes.table.team",
  "outcomes.table.done",
  "outcomes.table.failed",
  "outcomes.table.open",
  "outcomes.table.total",
  "outcomes.excludedNote",
  "outcomes.partialNote",
  "outcomes.includedNote",

  // 팀 라벨(비개인 조직 전용)
  "teams.title",
  "teams.empty",

  // 결합된 프로젝트
  // ★"없습니다" 4연타를 설명으로 바꾸는 시작 카드(감사 #1495 P1-1). 결합 0인
  //   비개인 조직에서만 뜬다 — 아래 빈 칸들이 증상이 아니라 다음 단계로 읽히게.
  "start.title",
  "start.body",
  "start.step1",
  "start.step2",
  "start.step3",

  "bindings.title",
  "bindings.empty",
  "bindings.restricted",
  "bindings.project",
  "bindings.team",
  "bindings.noTeam",
  "bindings.teamUnknown",

  // 결합 폼
  "bind.open",
  "bind.title",
  "bind.projectLabel",
  "bind.projectLoading",
  "bind.projectEmpty",
  "bind.teamLabel",
  "bind.teamNone",
  "bind.teamNew",
  "bind.teamNewPlaceholder",
  "bind.submit",
  "bind.submitting",
  "bind.success",
  "bind.cancel",
  "bind.error.permission",
  "bind.error.invalid",
  "bind.error.unknown",

  // 초대 폼(#1338 §3.1 (d) v0) — ★메일 발송 없음, 링크 복사가 전달 수단이다
  "invite.title",
  "invite.subtitle",
  "invite.open",
  "invite.emailLabel",
  "invite.roleLabel",
  "invite.roleNote",
  "invite.projectsLabel",
  "invite.projectsHint",
  "invite.projectsLoading",
  "invite.projectsEmpty",
  "invite.submit",
  "invite.submitting",
  "invite.linkTitle",
  "invite.linkBody",
  "invite.reusedNote",
  "invite.expires",
  "invite.copy",
  "invite.copied",
  "invite.copyFailed",
  "invite.another",
  "invite.cancel",
  "invite.error.permission",
  "invite.error.already_member",
  "invite.error.seat_limit",
  "invite.error.plan_required",
  "invite.error.invalid",
  "invite.error.unavailable",
  // ★재초대 = 토큰 회전(티켓 3PRpIVJdyE5dUWQWwy6Y). 화면이 그 사실을 말하지
  //   않으면 관리자는 옛 링크가 아직 산다고 믿고 그대로 둔다.
  "invite.rotatedNote",

  // 대기 중인 초대 + 철회(F4) — 취소 버튼이 가리킬 목록이 있어야 경로가 성립한다
  "pending.title",
  "pending.subtitle",
  "pending.loading",
  "pending.empty",
  "pending.loadError",
  "pending.expiredBadge",
  "pending.expires",
  "pending.projects",
  "pending.revoke",
  "pending.revoking",
  "pending.revokeConfirm",
  "pending.error.permission",
  "pending.error.already_accepted",
  "pending.error.unknown",

  // 상호작용·상태
  "action.refresh",
  "action.retry",
  "action.signIn",
  "state.loading",
  "state.landing",
  "state.signInRequired",

  // ★5단 드릴다운(사람 › 에이전트·모델) — Phase 3. `orgDrilldownContract.ts` 참고.
  //   위 세 단(조직›팀›프로젝트)은 Phase 2 가 냈고, 여기는 그 아래 두 단이다.
  "drill.title",
  "drill.subtitle",
  "drill.expand",
  "drill.collapse",
  "drill.loading",
  "drill.error",
  "drill.empty",
  // ★권한으로 가려진 칸 — 0 으로 접지 않는다(#1205 §4.2 여섯 번째 부재)
  "drill.restricted.title",
  "drill.restricted.body",
  // ★결측을 0 으로 그리지 않는다 — 세 부재를 셋으로 그린다
  "drill.cell.noRecords",
  "drill.cell.noRecordsHint",
  "drill.cell.unknown",
  "drill.cell.unknownHint",
  "drill.cell.unwired",
  "drill.cell.unwiredHint",
  "drill.cell.realZero",
  // 사람 단
  "drill.person.title",
  "drill.person.unknownName",
  "drill.person.cost",
  "drill.person.tokens",
  "drill.person.single",
  "drill.person.basis",
  "drill.person.gap",
  // 에이전트·모델 단
  "drill.model.title",
  "drill.model.harnessOnly",
  "drill.model.harnessNote",
  "drill.model.unknown",
  "drill.actor.worker",
  "drill.actor.orchestrator",
  "drill.agents.title",
  "drill.agents.role",
  "drill.agents.open",
  "drill.agents.done",
  "drill.agents.redacted",
  "drill.agents.absent",
  // 성공·실패·병합 (계정 축)
  "drill.ledger.title",
  "drill.ledger.tasks",
  "drill.ledger.successes",
  "drill.ledger.failures",
  "drill.ledger.merges",
  "drill.ledger.unattributedMerges",
  "drill.ledger.truncated",
  // 익명 설치 축 성과 — T0 경계
  "drill.outcome.title",
  "drill.outcome.unwired",
  "drill.outcome.boundary",
  "drill.outcome.pending",
  "drill.outcome.sample",
  // ★안 보여주는 것을 화면이 스스로 말한다(#1333 §2.2)
  "drill.withheld",

  // ★실행 원장(Mission→Ticket→Agent→Model→Cost→Result) — `/admin` 의
  //   `ExecutionLedgerSection` 재사용. `drill.ledger.*`(계정 축 성공/실패/병합
  //   카운트)와 **다른 축**이라 접두어를 분리한다(티켓 uYcCq9DRPLT8ZEh0rlkh).
  "drill.executionLedger.title",
  // 서버가 사유 문장을 못 주면(드묾) 쓰는 폴백 — `drill.restricted.body` 와
  // 같은 구조.
  "drill.executionLedger.restricted",
  "drill.executionLedger.empty",

  // 오류
  "error.unauthenticated",
  "error.notDeployed",
  "error.unknown",
] as const;

export type OrgCopyKey = typeof ORG_COPY_KEYS[number];

export type OrgCopy = {
  text: Readonly<Record<OrgCopyKey, string>>;
};

/**
 * 영어 폴백. 사이트 기본 로케일이 en 폴백 규약(`teamCopy.ts` 참고)과 같다.
 */
const FALLBACK_TEXT: Record<OrgCopyKey, string> = {
  title: "Organization",

  "choose.title": "Choose an organization",
  "choose.body":
    "You belong to more than one organization, so nothing is opened automatically — pick the one you mean to look at.",

  "org.personalName": "Personal organization",
  "org.personalNote": "Your own projects",
  "org.unnamed": "Unnamed organization",

  "role.org_owner": "owner",
  "role.org_admin": "admin",
  "role.org_member": "member",

  "switcher.label": "Organization",

  "personal.subtitle":
    "Your own projects, in one place. This is the same picture as the team page — there are no teams to group by here.",
  "personal.createHint":
    "Only your personal organization exists so far — organizations appear here once one is created on a team plan.",
  "personal.createCta": "Create an organization",

  "usage.title": "Organization-wide usage",
  "usage.loading": "Loading organization usage…",
  "usage.error": "Could not load organization usage.",
  "usage.disabledFallback":
    "Team usage is not open yet — numbers are not drawn until the policy gate is open.",
  "usage.notProvisionedFallback":
    "Not loaded yet — the usage view is not provisioned. This is not a zero.",
  "usage.empty.title": "No usage to aggregate yet",
  "usage.empty.why":
    "Either no project is attached to this organization, or nothing was recorded in the selected window. This is 'no records', not zero.",
  "usage.empty.when":
    "Once projects are attached and members work in the app while signed in, daily numbers start accruing from the next day.",
  "usage.loginBasis":
    "Aggregated by signed-in account — usage without sign-in leaves no record at all.",
  "usage.truncatedFallback":
    "Too many projects — only part of them is aggregated. The totals below are not the sum of all projects.",
  "usage.effectiveFrom": "since {date}",
  "usage.window": "figures shown are for {from} – {to}",
  "usage.range.label": "Range",
  "usage.range.days": "{n} days",
  "usage.range.custom": "Custom start date",
  "usage.range.customLabel": "From date",
  "usage.range.clamped":
    "Shorter than the range you picked — no records before {date}",
  "usage.freshness": "as of {minutes} min ago",
  "usage.projectsInScope": "{n} projects aggregated",
  "usage.costTitle": "Estimated usage cost",
  "usage.tokensTitle": "Tokens (input + output)",
  "usage.realZero":
    "Measured zero — rows exist in the window but the total is zero.",
  "usage.table.team": "Team › project",
  "usage.table.cost": "Cost (est.)",
  "usage.table.tokens": "Tokens",
  "usage.table.projectsCount": "{n} projects",
  "usage.table.unassigned": "Unassigned",
  "usage.table.unknownTeam": "Unrecognized team",
  "usage.table.total": "Total",
  "usage.table.unassignedHint":
    "Assign a team by re-attaching the project below with a team selected.",
  "usage.byDay.title": "By day",
  "usage.byDay.partial": "today (incomplete)",

  "outcomes.title": "Task success & failure",
  "outcomes.loading": "Loading task outcomes…",
  "outcomes.error": "Could not load task outcomes.",
  "outcomes.basisNote":
    "Done/failed counts come from each project's ticket status — a different tally from the usage numbers above.",
  "outcomes.noBindings.title": "No projects to aggregate yet",
  "outcomes.noBindings.body":
    "No project is attached to this organization yet. Once a project is attached, its task successes and failures start accruing here.",
  "outcomes.noAccess.title": "Cannot aggregate with this account",
  "outcomes.noAccess.body":
    "Checked {n} attached projects, but this account is not an owner or admin on any of them, so it has no permission to see their task records.",
  "outcomes.doneLabel": "Done",
  "outcomes.failedLabel": "Failed",
  "outcomes.openLabel": "In progress",
  "outcomes.rate.label": "Success rate",
  "outcomes.rate.denominator": "of {done} done, {failed} failed",
  "outcomes.rate.none":
    "No task has finished as done or failed yet — only tasks still in progress.",
  "outcomes.table.team": "Team",
  "outcomes.table.done": "Done",
  "outcomes.table.failed": "Failed",
  "outcomes.table.open": "In progress",
  "outcomes.table.total": "Total",
  "outcomes.excludedNote":
    "{n} projects were outside this account's permission and left out of the totals — the totals may not cover the whole organization.",
  "outcomes.partialNote":
    "Some projects hit the scan limit and were only partially counted — the totals may be lower than the real numbers.",
  "outcomes.includedNote": "Aggregated across {n} projects.",

  "teams.title": "Team labels",
  "teams.empty":
    "No team labels yet. You can create one while attaching a project.",

  "start.title": "Get started",
  "start.body":
    "Nothing is missing \u2014 this organization just has no attached projects yet. The panels below fill in once these three steps are done.",
  "start.step1": "Attach a project to this organization.",
  "start.step2": "Have a teammate work in the app while signed in.",
  "start.step3": "Daily usage and outcomes appear here from the next day.",
  "bindings.title": "Attached projects",
  "bindings.empty": "No projects are attached to this organization yet.",
  "bindings.restricted":
    "The list of attached projects is visible to organization admins only.",
  "bindings.project": "Project",
  "bindings.team": "Team",
  "bindings.noTeam": "no team",
  "bindings.teamUnknown": "unrecognized team",

  "bind.open": "Attach a project",
  "bind.title": "Attach a project to this organization",
  "bind.projectLabel": "Project",
  "bind.projectLoading": "Looking up your projects…",
  "bind.projectEmpty":
    "No projects to attach — you can only attach a project you belong to.",
  "bind.teamLabel": "Team",
  "bind.teamNone": "No team — fine as-is for a small organization",
  "bind.teamNew": "＋ Create a new team",
  "bind.teamNewPlaceholder": "New team name",
  "bind.submit": "Attach",
  "bind.submitting": "Attaching…",
  "bind.success": "The project is now attached.",
  "bind.cancel": "Cancel",
  "bind.error.permission":
    "You cannot attach this project — that needs an organization admin, or a project owner or admin who is also an organization member.",
  "bind.error.invalid": "That request could not be applied as given.",
  "bind.error.unknown": "Could not attach the project.",

  "invite.title": "Invite members",
  "invite.subtitle":
    "Creates an invite link you hand over yourself — nothing is emailed automatically.",
  "invite.open": "Invite a member",
  "invite.emailLabel": "Email of the person to invite",
  "invite.roleLabel": "Organization role",
  "invite.roleNote":
    "The owner role cannot be granted by invitation — it belongs to the organization's creator.",
  "invite.projectsLabel": "Also invite to projects (optional)",
  "invite.projectsHint":
    "Only projects you own or admin are listed. Checked projects are joined as a member on acceptance.",
  "invite.projectsLoading": "Looking up your projects…",
  "invite.projectsEmpty":
    "No projects to add — you can send the organization invite alone and add projects later.",
  "invite.submit": "Create invite link",
  "invite.submitting": "Creating…",
  "invite.linkTitle": "The invite link is ready",
  "invite.linkBody":
    "Copy this link and send it to the person yourself — it is not emailed automatically.",
  "invite.reusedNote":
    "You just created this invite, so the same link came back — the link you already shared still works.",
  "invite.expires": "Valid until {date}.",
  "invite.copy": "Copy link",
  "invite.copied": "Copied.",
  "invite.copyFailed":
    "Could not copy — select the link text and copy it yourself.",
  "invite.another": "Invite another member",
  "invite.cancel": "Cancel",
  "invite.error.permission":
    "You cannot create this invite — it needs an organization admin, and only projects you manage can be checked.",
  "invite.error.already_member":
    "They are already a member of this organization — no invite was created.",
  "invite.error.seat_limit":
    "The seat limit is reached — free a seat or upgrade the plan, then try again.",
  "invite.error.plan_required":
    "A team plan is required to invite members to the checked projects.",
  "invite.error.invalid":
    "That request could not be applied as given — check the email address.",
  "invite.error.unavailable": "Could not create the invite. Try again.",
  "invite.rotatedNote":
    "Creating an invite for the same person again kills the previous link — only the link below works now.",

  "pending.title": "Pending invites",
  "pending.subtitle":
    "Invites nobody has accepted yet. Each link stays live until it is revoked — revoke one here if it went to the wrong place.",
  "pending.loading": "Looking up pending invites…",
  "pending.empty": "No pending invites.",
  "pending.loadError": "Could not load pending invites.",
  "pending.expiredBadge": "expired",
  "pending.expires": "until {date}",
  "pending.projects": "{n} projects",
  "pending.revoke": "Revoke",
  "pending.revoking": "Revoking…",
  "pending.revokeConfirm":
    "Revoking this invite kills the link you already sent — it stops working immediately. Revoke it?",
  "pending.error.permission":
    "You cannot revoke invites — only organization admins can.",
  "pending.error.already_accepted":
    "This invite was already accepted — remove the member instead.",
  "pending.error.unknown": "Could not revoke the invite. Try again.",

  "action.refresh": "Refresh",
  "action.retry": "Try again",
  "action.signIn": "Sign in",
  "state.loading": "Loading…",
  "state.landing": "Finding your organization…",
  "state.signInRequired": "Sign in to see your organizations.",

  "drill.title": "People · agents and models",
  "drill.subtitle":
    "Open a project to see who worked in it, and which models that work ran on.",
  "drill.expand": "Open",
  "drill.collapse": "Close",
  "drill.loading": "Loading the breakdown…",
  "drill.error": "Could not load the breakdown for this project.",
  "drill.empty":
    "Nothing was recorded in this project during the selected window. This is 'no records', not zero.",
  "drill.restricted.title": "You cannot open this project's people",
  "drill.restricted.body":
    "Being an organization admin does not open a project's contents. You need to be an owner or admin of this project itself.",
  "drill.cell.noRecords": "No records",
  "drill.cell.noRecordsHint":
    "This does not mean nobody worked — it can also mean nothing was sent.",
  "drill.cell.unknown": "Not determined",
  "drill.cell.unknownHint":
    "Only part of the window was aggregated, so this was left undecided rather than guessed.",
  "drill.cell.unwired": "Not measured",
  "drill.cell.unwiredHint":
    "This breakdown is not being sent yet. It is not a zero.",
  "drill.cell.realZero": "Measured zero",
  "drill.person.title": "By person",
  "drill.person.unknownName": "Name unknown",
  "drill.person.cost": "Cost (est.)",
  "drill.person.tokens": "Tokens",
  "drill.person.single":
    "Only one person has records in this project. That means the axis has not split yet — not that others did no work.",
  "drill.person.basis":
    "Cost is counted per signed-in account that ran the work. One person on several machines shows up as one row.",
  "drill.person.gap":
    "The per-person figures add up to {amount} less than this project's total — some records are not tied to anyone.",
  "drill.model.title": "By model",
  "drill.model.harnessOnly": "Actual model unknown",
  "drill.model.harnessNote":
    "{amount} of this was recorded under the runner's name rather than a model, so the actual model cannot be told apart.",
  "drill.model.unknown": "No model recorded",
  "drill.actor.worker": "Worker",
  "drill.actor.orchestrator": "Orchestrator",
  "drill.agents.title": "By agent",
  "drill.agents.role": "Role",
  "drill.agents.open": "Open",
  "drill.agents.done": "Done",
  "drill.agents.redacted": "Hidden",
  "drill.agents.absent": "None",
  "drill.ledger.title": "Finished and failed work",
  "drill.ledger.tasks": "Tickets",
  "drill.ledger.successes": "Succeeded",
  "drill.ledger.failures": "Failed",
  "drill.ledger.merges": "Merges",
  "drill.ledger.unattributedMerges":
    "{n} merge records carry no actor, so merge request numbers are counted for the project and not for a person.",
  "drill.ledger.truncated":
    "Only part of the records was scanned — these counts are not the whole window.",
  "drill.outcome.title": "Success rate by model, per person",
  "drill.outcome.unwired":
    "Not measured yet. Work results are recorded without a person on them, and the part that ties them to a person is not open yet.",
  "drill.outcome.boundary":
    "Even once it opens, only work from the day that tie began will carry a person. Everything before that stays unlinked for good.",
  "drill.outcome.pending": "Accruing since {date}.",
  "drill.outcome.sample":
    "{n} of {min} decided — too few to draw a percentage yet.",
  "drill.withheld":
    "This page never shows what was typed to an agent or what it answered, which commands ran, or which files were touched. Only tickets, merges, models and amounts.",

  "drill.executionLedger.title": "Execution ledger",
  "drill.executionLedger.restricted":
    "This project's execution ledger is only visible to that project's owner or admin.",
  "drill.executionLedger.empty":
    "No executions have left a trace on this project in this window.",

  "error.unauthenticated": "Sign in to see this page.",
  "error.notDeployed": "The organization service is not available yet.",
  "error.unknown": "Could not load organizations.",
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 점 경로로 문자열 하나를 꺼낸다. 없거나 빈 문자열이면 null. */
function pickString(root: unknown, path: string): string | null {
  let node: unknown = root;
  for (const segment of path.split(".")) {
    const rec = asRecord(node);
    if (!rec) return null;
    node = rec[segment];
  }
  return typeof node === "string" && node !== "" ? node : null;
}

/**
 * `messages/<locale>.json` 의 `org` 블록 → `OrgCopy`.
 * ★신뢰 경계다. 어떤 입력이 와도 던지지 않고, 빠진 자리는 영어로 채운다.
 */
export function buildOrgCopy(raw: unknown): OrgCopy {
  const text = {} as Record<OrgCopyKey, string>;
  for (const key of ORG_COPY_KEYS) {
    text[key] = pickString(raw, key) ?? FALLBACK_TEXT[key];
  }
  return { text };
}

/** 폴백으로 떨어진 키 목록 — 로케일 세 벌 완결성 검사용(`teamCopy` 와 동일 규약). */
export function missingOrgCopyKeys(raw: unknown): OrgCopyKey[] {
  return ORG_COPY_KEYS.filter((key) => pickString(raw, key) === null);
}
