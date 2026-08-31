/**
 * 팀 오버뷰 문구 — ko·en·ja.
 *
 * ★문구를 컴포넌트가 아니라 여기서 조립하는 이유 둘:
 *   1. 이 화면의 규약 절반이 **문구 자체**다. "청구액이라고 쓰지 않는다",
 *      "0 옆에 기준 라벨", "미수집에는 사유". 문구가 데이터면 테스트가 로케일
 *      세 벌을 전부 읽어 규약을 검사할 수 있다(`teamCopy.test.ts`).
 *   2. 프레젠테이션 컴포넌트가 next-intl 훅에 묶이지 않는다 → `renderToStaticMarkup`
 *      으로 그대로 렌더해 **화면 바이트**를 검사할 수 있다(AnalyticsPanel.test 규약).
 *
 * 키가 빠지면 화면이 빈칸이 되는 게 아니라 영어 폴백으로 떨어진다(사이트 기본
 * 로케일이 en 이다). 그리고 로케일 세 벌 전부에 키가 있는지는 테스트가 막는다 —
 * 폴백은 사고 방지책이지 번역 누락을 눈감아 주는 장치가 아니다.
 */

/** 화면이 쓰는 문구 키 전부. ★여기 없는 문자열을 컴포넌트에 하드코딩하지 않는다. */
export const TEAM_COPY_KEYS = [
  "title",
  "subtitle",
  "tabs.usage",
  "tabs.audit",

  // 금액 — ★'청구액' 이 아니다(설계 §1.5)
  "money.label",
  "money.note",

  // 기준 라벨 / 신선도
  "basis.label",
  "basis.missing",
  "freshness.minutes",
  "freshness.justNow",
  "freshness.unknown",
  "cache.hit",
  "cache.miss",
  "today.partialBadge",

  // ★상태 셋 — 0 / 미수집 / 적재 전
  "cell.zeroBadge",
  "cell.zeroNote",
  "cell.notCollectedBadge",
  "cell.notCollectedBody",
  "cell.pendingBadge",
  "cell.pendingBody",
  "cell.pendingSince",
  "cell.partialBadge",
  "cell.partialBody",
  "cell.unwiredBadge",
  "cell.unwiredBody",
  "cell.legacySegment",
  // ★여섯 번째 부재 — 권한으로 가려진 값(#1205 §4.2). 빈칸이 아니라 사유로 그린다.
  "cell.restrictedBadge",
  "cell.restrictedBody",
  "cell.restrictedRequiresOrgAdmin",
  "cell.restrictedRequiresProjectAdmin",

  // 게이트 닫힘
  "disabled.badge",
  "disabled.title",
  "disabled.body",

  // 오케 축
  "orchestrator.title",
  "orchestrator.stake",
  "orchestrator.worker",
  "orchestrator.orchestrator",

  // ★'적재 전' — `empty`(팀이 안 들어옴)와 **원인이 다르다**(계약 §3 규칙 7)
  "notProvisioned.badge",
  "notProvisioned.title",
  "notProvisioned.body",

  // 빈 상태 — ★기본값이다
  "empty.title",
  "empty.body",
  "empty.willShowTitle",
  "empty.invite",

  // 표
  "totals.title",
  "totals.tokens",
  "totals.cacheRead",
  "totals.cacheWrite",
  "members.title",
  "members.name",
  "members.unnamed",
  "members.share",
  "members.optOutNote",
  "members.hostNote",
  "members.noRows",
  "members.noRowsNote",
  "projects.title",
  "projects.unnamed",
  "models.title",
  "byDay.title",

  // 커버리지 — "이 화면은 전부가 아니다"
  "coverage.title",
  "coverage.rowsZero",
  "coverage.rowsWithoutTask",
  "coverage.unattributed",
  "coverage.membersWithNoRows",
  "coverage.unknown",

  // 스코프
  "scope.selfBadge",
  "scope.selfNote",
  "scope.projectsInScope",

  // 상호작용
  "action.refresh",
  "action.retry",
  "action.signIn",
  "state.loading",
  "state.signInRequired",

  // 오류
  "error.unauthenticated",
  "error.permissionDenied",
  "error.notDeployed",
  "error.unknown",

  // 사유 폴백
  "reason.fallback",

  // ── 감사 탭 (설계 §12) ──────────────────────────────────────────────────
  "audit.subtitle",
  // ★이 탭에 금액 칸이 없는 것은 누락이 아니라 결정이다(§12.4)
  "audit.noMoneyNote",
  "audit.unknown",
  "audit.project.label",
  "audit.scope.selfNote",
  "audit.role.owner",
  "audit.role.admin",
  "audit.role.member",
  "audit.disabled.title",
  "audit.disabled.body",
  "audit.empty.title",
  "audit.empty.body",
  "audit.partial.badge",
  "audit.partial.body",
  "audit.actor.label",
  "audit.actor.unknown",
  "audit.actor.redacted",
  "audit.actor.redactedNote",
  "audit.actor.pseudonymNote",
  "audit.kind.task_create",
  "audit.kind.task_transition",
  "audit.kind.merge",
  "audit.kind.agent_spawn",
  "audit.kind.flow_change",
  "audit.summary.title",
  "audit.summary.events",
  "audit.summary.tasksOpen",
  "audit.summary.tasksDone",
  "audit.summary.tasksFailed",
  "audit.summary.merges",
  "audit.summary.agents",
  "audit.summary.missionsActive",
  "audit.summary.critical",
  "audit.attention.title",
  "audit.events.title",
  "audit.events.failed",
  "audit.merge.pr",
  "audit.merge.files",
  "audit.merge.lines",
  "audit.workload.title",
  "audit.workload.agent",
  "audit.workload.model",
  "audit.workload.status",
  "audit.workload.open",
  "audit.workload.done",
  "audit.page.more",
  "audit.page.end",
  "audit.page.loading",
  "audit.notes.title",
  "audit.withheld.title",
  "audit.withheld.body",
  "audit.error.invalidCursor",
] as const;

export type TeamCopyKey = typeof TEAM_COPY_KEYS[number];

export type TeamCopy = {
  text: Readonly<Record<TeamCopyKey, string>>;
  /** 사유 코드 → 문장. 열린 사전이다(`resolveReason` 참고). */
  reasons: Readonly<Record<string, string>>;
  /**
   * `basis` 값 → 사람이 읽는 말. ★열린 사전이다 — 모르는 값은 원문을 그대로
   * 그린다(`BasisBadge`). 라벨이 사라지는 경로를 만들지 않는다.
   */
  basisValues: Readonly<Record<string, string>>;
  /** 팀이 들어오면 무엇이 보이는지. '적재 전' 규약이 요구하는 목록. */
  willShow: readonly string[];
};

/**
 * 영어 폴백. 사이트 기본 로케일이 en 이라(`src/i18n/routing.ts`) 누락 시
 * 영어로 떨어지는 것이 가장 덜 놀랍다.
 */
const FALLBACK_TEXT: Record<TeamCopyKey, string> = {
  title: "Team usage",
  subtitle: "Token usage by member and by actor, from the account ledger.",
  "tabs.usage": "Usage",
  "tabs.audit": "Audit",

  "money.label": "Estimated usage cost",
  "money.note":
    "This is not an invoice amount. There is no per-seat billing ledger, so this screen cannot answer whose invoice a cost lands on — these are token volumes converted at list prices.",

  "basis.label": "Basis",
  "basis.missing":
    "No basis label from the server — numbers are shown small on purpose.",
  "freshness.minutes": "As of {minutes} min ago",
  "freshness.justNow": "As of just now",
  "freshness.unknown": "Server did not report when this was generated",
  "cache.hit": "cached",
  "cache.miss": "fresh query",
  "today.partialBadge": "in progress",

  "cell.zeroBadge": "measured 0",
  "cell.zeroNote": "Actually zero for this window — not a missing number.",
  "cell.notCollectedBadge": "not collected",
  "cell.notCollectedBody":
    "This is not zero. Nothing is being collected for this axis, so no number can be shown here. Drawing 0 would read as “this costs nothing”.",
  "cell.pendingBadge": "not yet ingested",
  "cell.pendingBody":
    "Collection is wired but nothing has landed for this window yet. This is not a measured zero.",
  "cell.pendingSince": "Collecting since {since}",
  "cell.partialBadge": "partial window",
  "cell.partialBody":
    "Only part of this window is collected (from {from}). Do not read this as a full-window total.",
  "cell.unwiredBadge": "not wired",
  "cell.unwiredBody":
    "The server response carried no state for this axis. That is a missing contract, not a measurement — so nothing is drawn here.",
  "cell.legacySegment":
    "Rows exist for {from} – {to}, but they predate the current agent-id convention and are not a usable time series.",
  "cell.restrictedBadge": "no permission",
  "cell.restrictedBody":
    "A value exists here, but your role cannot see it. Do not read this as blank or zero.",
  "cell.restrictedRequiresOrgAdmin":
    "Ask an organization admin if you need this figure.",
  "cell.restrictedRequiresProjectAdmin":
    "Ask a project admin if you need this figure.",

  "disabled.badge": "not opened yet",
  "disabled.title": "Team-wide usage is not open",
  "disabled.body":
    "Nothing is missing from the data. This view is closed until the privacy notice covers it. Do not read this as “not yet ingested”.",

  "orchestrator.title": "Orchestrator vs worker",
  "orchestrator.stake":
    "Orchestrator cost is not collected yet. That is why this shows as “not collected” rather than 0.",
  "orchestrator.worker": "Workers",
  "orchestrator.orchestrator": "Orchestrator",

  "notProvisioned.badge": "not yet ingested",
  "notProvisioned.title": "The data to aggregate is not ready yet",
  "notProvisioned.body":
    "This does not mean usage is zero. There is nowhere to read from yet, so no number is drawn here.",

  "empty.title": "No usage to show yet",
  "empty.body":
    "This is the normal state for a team that has not started yet — not an error and not a zero.",
  "empty.willShowTitle": "Once your team is working, this page answers",
  "empty.invite": "Invite members to the project to start filling this in.",

  "totals.title": "Total",
  "totals.tokens": "Tokens (in + out)",
  "totals.cacheRead": "Cache read tokens",
  "totals.cacheWrite": "Cache write tokens",
  "members.title": "By member",
  "members.name": "Member",
  "members.unnamed": "Unnamed member",
  "members.share": "Share",
  "members.optOutNote":
    "A member at 0 may have opted out of telemetry rather than done no work. This screen cannot tell those apart — do not read this ranking as effort.",
  "members.noRows": "no records",
  "members.noRowsNote":
    "“No records” is not zero — it can mean nothing was sent at all.",
  "members.hostNote":
    "Usage is attributed to the account signed in on the machine that ran the work, not to whoever filed the ticket.",
  "projects.title": "By project",
  "projects.unnamed": "Unnamed project",
  "models.title": "By model",
  "byDay.title": "By day",

  "coverage.title": "What this page does not cover",
  "coverage.rowsZero":
    "Zero-delta rows: {value} of ledger rows carry no usage.",
  "coverage.rowsWithoutTask":
    "Rows with no ticket id: {value} — per-ticket drilldown is partial.",
  "coverage.unattributed":
    "Rows with no project: {value} (counted only; no amounts).",
  "coverage.membersWithNoRows": "Members with no rows at all: {value}.",
  "coverage.unknown": "The server did not report coverage for this window.",

  "scope.selfBadge": "your usage only",
  "scope.selfNote":
    "You are seeing your own usage. Team-wide numbers are shown to project owners and admins only.",
  "scope.projectsInScope": "{count} project(s) in scope",

  "action.refresh": "Refresh",
  "action.retry": "Try again",
  "action.signIn": "Sign in",
  "state.loading": "Loading…",
  "state.signInRequired": "Sign in to see your usage.",

  "error.unauthenticated": "Sign in to see this page.",
  "error.permissionDenied":
    "You do not have access to this project's team usage.",
  "error.notDeployed": "The team usage service is not deployed yet.",
  "error.unknown": "Could not load team usage.",

  "reason.fallback":
    "The server did not say why. Treat this as unknown, not as zero.",

  "audit.subtitle":
    "What happened to the shared work — tickets, merges, agents, flows.",
  "audit.noMoneyNote":
    "This tab carries no cost or token figures, by design. Spend is only ever shown under the usage notice gate — putting it here would route around that gate.",
  "audit.unknown": "unknown",
  "audit.project.label": "Project",
  "audit.scope.selfNote":
    "You are seeing your own events only. Tickets, agents and missions below are project-wide — they are already shared board state.",
  "audit.role.owner": "owner",
  "audit.role.admin": "admin",
  "audit.role.member": "member",
  "audit.disabled.title": "This audit feed is not available to you",
  "audit.disabled.body":
    "Nothing is drawn here on purpose. This says nothing about whether the project exists.",
  "audit.empty.title": "No project events recorded",
  "audit.empty.body":
    "Nothing has happened to the shared work in this window. This is an empty feed, not a zero count.",
  "audit.partial.badge": "not the whole picture",
  "audit.partial.body":
    "Some sources could not be read, so this feed is incomplete. Blank cells mean unknown, not zero.",
  "audit.actor.label": "Who",
  "audit.actor.unknown": "unknown",
  "audit.actor.redacted": "hidden",
  "audit.actor.redactedNote":
    "This name looked like an email address or an account id, so it is hidden. Hidden is not the same as absent.",
  "audit.actor.pseudonymNote":
    "Actors are shown as a team-only pseudonym; this response carries no names. Merge-history rows have no actor field at all, so “unknown” there is expected, not a bug.",
  "audit.kind.task_create": "ticket created",
  "audit.kind.task_transition": "ticket moved",
  "audit.kind.merge": "merged",
  "audit.kind.agent_spawn": "agent started",
  "audit.kind.flow_change": "flow changed",
  "audit.summary.title": "In this window",
  "audit.summary.events": "Events",
  "audit.summary.tasksOpen": "Open tickets",
  "audit.summary.tasksDone": "Done tickets",
  "audit.summary.tasksFailed": "Failed tickets",
  "audit.summary.merges": "Merges",
  "audit.summary.agents": "Agents",
  "audit.summary.missionsActive": "Active missions",
  "audit.summary.critical": "Critical",
  "audit.attention.title": "Needs attention",
  "audit.events.title": "Event feed",
  "audit.events.failed": "failed",
  "audit.merge.pr": "PR #{value}",
  "audit.merge.files": "{value} files",
  "audit.merge.lines": "+{added} / -{deleted}",
  "audit.workload.title": "Agents",
  "audit.workload.agent": "Agent",
  "audit.workload.model": "Model",
  "audit.workload.status": "Status",
  "audit.workload.open": "Open",
  "audit.workload.done": "Done",
  "audit.page.more": "Load more",
  "audit.page.end": "End of feed",
  "audit.page.loading": "Loading…",
  "audit.notes.title": "About this feed",
  "audit.withheld.title": "Deliberately not shown here",
  "audit.withheld.body":
    "The server lists what it leaves out, and this screen prints that list as-is. If it were only in a document, you would never see it.",
  "audit.error.invalidCursor":
    "The feed position expired. Reload to start from the top.",
};

const FALLBACK_WILL_SHOW: readonly string[] = [
  "How much the team spent this month, and against last month",
  "Which member, project and model the spend goes to",
  "Whether the orchestrator costs more than the workers",
];

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
 * `messages/<locale>.json` 의 `team` 블록 → `TeamCopy`.
 * ★신뢰 경계다. 어떤 입력이 와도 던지지 않고, 빠진 자리는 영어로 채운다.
 */
export function buildTeamCopy(raw: unknown): TeamCopy {
  const text = {} as Record<TeamCopyKey, string>;
  for (const key of TEAM_COPY_KEYS) {
    text[key] = pickString(raw, key) ?? FALLBACK_TEXT[key];
  }

  const basisRaw = asRecord(asRecord(raw)?.basisValues);
  const basisValues: Record<string, string> = {};
  if (basisRaw) {
    for (const [key, value] of Object.entries(basisRaw)) {
      if (typeof value === "string" && value !== "") basisValues[key] = value;
    }
  }

  const reasonsRaw = asRecord(asRecord(raw)?.reasons);
  const reasons: Record<string, string> = {};
  if (reasonsRaw) {
    for (const [code, value] of Object.entries(reasonsRaw)) {
      if (typeof value === "string" && value !== "") reasons[code] = value;
    }
  }

  const willShowRaw = asRecord(raw)?.willShow;
  const willShow = Array.isArray(willShowRaw)
    ? willShowRaw.filter((v): v is string => typeof v === "string" && v !== "")
    : [];

  return {
    text,
    reasons,
    basisValues,
    willShow: willShow.length > 0 ? willShow : FALLBACK_WILL_SHOW,
  };
}

/**
 * 폴백으로 떨어진 키 목록. 로케일 세 벌이 전부 완결됐는지 테스트가 이걸로 본다 —
 * 번역 누락이 조용히 영어로 떨어지는 것을 CI 대신 로컬 테스트가 잡는다.
 */
export function missingTeamCopyKeys(raw: unknown): TeamCopyKey[] {
  return TEAM_COPY_KEYS.filter((key) => pickString(raw, key) === null);
}

/** `{name}` 자리표시자 치환. 사전에 없는 자리표시자는 그대로 남긴다. */
export function fill(
  template: string,
  values: Readonly<Record<string, string | number>>
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : whole
  );
}
