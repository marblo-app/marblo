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

  // 팀 라벨(비개인 조직 전용)
  "teams.title",
  "teams.empty",

  // 결합된 프로젝트
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

  // 상호작용·상태
  "action.refresh",
  "action.retry",
  "action.signIn",
  "state.loading",
  "state.landing",
  "state.signInRequired",

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

  "teams.title": "Team labels",
  "teams.empty":
    "No team labels yet. You can create one while attaching a project.",

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
    "A valid invite already existed, so the same link was returned — links you already sent keep working.",
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

  "action.refresh": "Refresh",
  "action.retry": "Try again",
  "action.signIn": "Sign in",
  "state.loading": "Loading…",
  "state.landing": "Finding your organization…",
  "state.signInRequired": "Sign in to see your organizations.",

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
