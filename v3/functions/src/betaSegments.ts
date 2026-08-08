// 베타 사용자 세그먼트 사용패턴 — 순수 로직(BQ/Firestore 무의존).
// adminAnalytics.ts 와 동일 규약: index.ts 의 onCall 핸들러는 쿼리/IO 만 하고
// 분류·집계·억제(suppression) 판정은 전부 여기로 내려 node --test 로 검증한다.
//
// ── 왜 별도 모듈인가 ────────────────────────────────────────────────────────
// 기존 어드민 분석(getAdminActiveUserMetrics / getAdminRetentionCohorts)은 "전체
// 계정" 모수를 본다. 본 모듈은 거기에 **grant 보유자(파운더/베타) 세그먼트 축**을
// 얹는다. 지표 정의·쿼리는 기존 계정 identity 규약을 그대로 재사용하고(중복설계
// 금지), 새로 더하는 것은 (a) uid→세그먼트 분류와 (b) 최소 코호트 가드뿐이다.
//
// ── 계정 identity 규약(index.ts 와 동일) ────────────────────────────────────
//   - events.userId 는 익명 clientId 라 계정 귀속에 쓰지 않는다.
//   - 계정 활동 = events.metadata.accountUserId ∪ cost_logs.userId.
//   - UUID 형태(agent/client 오염) 와 ADMIN_UID 는 배제.
//
// ── 프라이버시 ──────────────────────────────────────────────────────────────
// 베타 모수는 수십 명 규모라 세그먼트를 잘게 쪼개면 행동지표가 개인 지목으로
// 퇴화한다. 그래서 **관측 사용자 수가 MIN_COHORT_SIZE 미만인 세그먼트는 행동지표를
// 통째로 억제**한다(카운트만 남긴다). uid·이메일 등 식별자는 어떤 경로로도 응답에
// 넣지 않는다 — 이 모듈의 입력 타입에도 uid 는 들어오지만 출력 타입에는 없다.

import { coerceNumber, safeRate } from "./adminAnalytics";

// ── 세그먼트 정의 ────────────────────────────────────────────────────────────
// subscriptions.founderGrantReason 이 권위 마커다(paymentProvider 아님 —
// founder_grant stomp 이슈). 실측(2026-08-08, 32건): founder_backfill 13 /
// beta_selected 14 / beta_signup 5. 미지의 reason 은 "other" 로 접어 모수에서
// 누락되지 않게 한다.
export const BETA_SEGMENT_KEYS = [
  "founder_backfill",
  "beta_selected",
  "beta_signup",
  "other",
] as const;

export type BetaSegmentKey = (typeof BETA_SEGMENT_KEYS)[number];

export const BETA_SEGMENT_LABELS: Record<BetaSegmentKey, string> = {
  founder_backfill: "파운더",
  beta_selected: "베타 선정",
  beta_signup: "베타 신청",
  other: "기타 grant",
};

// 최소 코호트 크기(k-익명성). 관측 사용자가 이 값 미만인 세그먼트는 행동지표를
// 억제한다. 5 는 소규모 베타에서 흔히 쓰는 보수적 임계.
export const MIN_COHORT_SIZE = 5;

// ── 입력 타입 ────────────────────────────────────────────────────────────────

/** Firestore subscriptions 에서 뽑은 grant 보유자 1명. uid 는 분류에만 쓰고 출력하지 않는다. */
export interface GrantHolderRow {
  uid: string;
  founderGrantReason?: unknown;
  status?: unknown;
}

/** BQ: 계정별 활동일 요약(events.accountUserId ∪ cost_logs.userId). */
export interface SegmentActivityRow {
  userId?: unknown;
  activeDays?: unknown;
  firstActiveDate?: unknown;
  lastActiveDate?: unknown;
  events?: unknown;
}

/** BQ: 계정 × 이벤트종류 카운트. */
export interface SegmentEventRow {
  userId?: unknown;
  event?: unknown;
  n?: unknown;
}

/** BQ: 계정별 세션(session:ended) 요약. */
export interface SegmentSessionRow {
  userId?: unknown;
  sessions?: unknown;
  totalMs?: unknown;
  medianMs?: unknown;
}

// ── 출력 타입 ────────────────────────────────────────────────────────────────

export interface FeatureUsageEntry {
  event: string;
  users: number;
  count: number;
}

export interface SegmentSessionStats {
  sessions: number;
  sessionsPerUser: number | null;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
}

export interface SegmentRhythmStats {
  avgActiveDays: number | null;
  /** 활동일이 2일 이상인 = 최소 1회 재방문한 사용자 수. */
  returningUsers: number;
  returningRate: number | null;
  /** 첫 활동 ~ 마지막 활동 간격의 평균(일). 관측창 내 잔존 폭. */
  avgSpanDays: number | null;
}

/** 기능 채택 — 오케/스폰/티켓. 각 값은 해당 기능을 1회 이상 쓴 사용자 수. */
export interface SegmentAdoptionStats {
  orchestratorUsers: number;
  spawnUsers: number;
  ticketUsers: number;
  orchestratorRate: number | null;
  spawnRate: number | null;
  ticketRate: number | null;
}

export interface BetaSegmentSummary {
  key: BetaSegmentKey | "all";
  label: string;
  /** Firestore grant 보유자 수 — 텔레메트리와 무관하게 항상 정확. */
  cohortSize: number;
  /** 그중 관측창 안에서 텔레메트리가 1건이라도 잡힌 계정 수. */
  observedUsers: number;
  /** observedUsers / cohortSize — "grant 를 줬는데 실제로 쓰는가". */
  observedRate: number | null;
  /** 최소 코호트 가드에 걸려 행동지표를 숨겼는가. */
  suppressed: boolean;
  suppressionReason: string | null;
  // 아래는 suppressed=true 면 전부 null/빈 배열.
  featureUsage: FeatureUsageEntry[];
  sessions: SegmentSessionStats | null;
  rhythm: SegmentRhythmStats | null;
  adoption: SegmentAdoptionStats | null;
}

export interface BetaSegmentUsage {
  minCohortSize: number;
  /** grant 보유자 총원(Firestore). */
  grantCohortSize: number;
  /** 그중 관측된 계정 총원. */
  observedUsers: number;
  /**
   * 계정 귀속 가능한 이벤트가 실제로 적재되고 있는가. false 면 이벤트 기반
   * 지표(기능사용·세션·채택)는 구조만 있고 값이 비어 있다 = 텔레메트리 ON 선행.
   */
  accountAttributionAvailable: boolean;
  segments: BetaSegmentSummary[];
  all: BetaSegmentSummary;
}

// ── 분류 ─────────────────────────────────────────────────────────────────────

export function classifyGrantReason(reason: unknown): BetaSegmentKey {
  const s = typeof reason === "string" ? reason.trim() : "";
  return (BETA_SEGMENT_KEYS as readonly string[]).includes(s) && s !== "other"
    ? (s as BetaSegmentKey)
    : "other";
}

/**
 * grant 보유자 목록 → uid→세그먼트 맵 + 세그먼트별 코호트 크기.
 * status 가 active 가 아닌 문서도 코호트에는 넣는다 — "grant 를 받은 적 있는
 * 사람"이 베타 세그먼트의 모수이고, 만료/해지는 그 자체가 관찰 대상이다.
 */
export function buildGrantRoster(rows: GrantHolderRow[]): {
  segmentOf: Map<string, BetaSegmentKey>;
  cohortSizes: Record<BetaSegmentKey, number>;
  total: number;
} {
  const segmentOf = new Map<string, BetaSegmentKey>();
  const cohortSizes = {
    founder_backfill: 0,
    beta_selected: 0,
    beta_signup: 0,
    other: 0,
  } as Record<BetaSegmentKey, number>;
  for (const row of rows) {
    const uid = typeof row.uid === "string" ? row.uid.trim() : "";
    if (!uid || segmentOf.has(uid)) continue;
    const key = classifyGrantReason(row.founderGrantReason);
    segmentOf.set(uid, key);
    cohortSizes[key] += 1;
  }
  return { segmentOf, cohortSizes, total: segmentOf.size };
}

// ── 집계 ─────────────────────────────────────────────────────────────────────

/** 기능 채택 판정에 쓰는 이벤트 집합. 오케/스폰/티켓 3축(티켓의 요구사항). */
export const ADOPTION_EVENTS = {
  orchestrator: ["onboarding:orchestrator_opened", "dispatch:decision"],
  spawn: ["agent:spawned"],
  ticket: ["task:created", "task:completed", "task:status_changed"],
} as const;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function daysBetween(a: string, b: string): number | null {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.round((t2 - t1) / 86400000);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 세그먼트 하나 분량의 계정 집합을 받아 요약 1건을 만든다. */
function summarizeSegment(
  key: BetaSegmentKey | "all",
  label: string,
  cohortSize: number,
  uids: Set<string>,
  activityByUid: Map<string, SegmentActivityRow>,
  eventsByUid: Map<string, Map<string, number>>,
  sessionsByUid: Map<string, SegmentSessionRow>,
): BetaSegmentSummary {
  const observed = [...uids].filter(
    (u) => activityByUid.has(u) || eventsByUid.has(u),
  );
  const observedUsers = observed.length;
  const observedRate = safeRate(observedUsers, cohortSize);

  // ★최소 코호트 가드 — 관측 사용자가 임계 미만이면 행동지표를 통째로 억제한다.
  // 카운트(코호트 크기·관측 수)는 이미 사업지표로 공개되는 값이라 남긴다.
  if (observedUsers < MIN_COHORT_SIZE) {
    return {
      key,
      label,
      cohortSize,
      observedUsers,
      observedRate,
      suppressed: true,
      suppressionReason:
        observedUsers === 0
          ? "관측된 계정 없음"
          : `최소 코호트 ${MIN_COHORT_SIZE}명 미만 — 개인 식별 방지를 위해 행동지표 비공개`,
      featureUsage: [],
      sessions: null,
      rhythm: null,
      adoption: null,
    };
  }

  // 기능별 사용 — 이벤트 종류별 (사용자 수, 발생 수).
  const featureAgg = new Map<string, { users: number; count: number }>();
  for (const uid of observed) {
    const perEvent = eventsByUid.get(uid);
    if (!perEvent) continue;
    for (const [event, n] of perEvent) {
      const cur = featureAgg.get(event) || { users: 0, count: 0 };
      cur.users += 1;
      cur.count += n;
      featureAgg.set(event, cur);
    }
  }
  const featureUsage: FeatureUsageEntry[] = [...featureAgg.entries()]
    .map(([event, v]) => ({ event, users: v.users, count: v.count }))
    .sort((a, b) => b.users - a.users || b.count - a.count);

  // 세션 빈도·길이.
  let sessionCount = 0;
  let sessionTotalMs = 0;
  const medians: number[] = [];
  for (const uid of observed) {
    const row = sessionsByUid.get(uid);
    if (!row) continue;
    const n = coerceNumber(row.sessions);
    if (n <= 0) continue;
    sessionCount += n;
    sessionTotalMs += coerceNumber(row.totalMs);
    const m = coerceNumber(row.medianMs);
    if (m > 0) medians.push(m);
  }
  medians.sort((a, b) => a - b);
  const sessions: SegmentSessionStats = {
    sessions: sessionCount,
    sessionsPerUser: safeRate(sessionCount, observedUsers),
    avgDurationMs: sessionCount > 0 ? sessionTotalMs / sessionCount : null,
    medianDurationMs:
      medians.length > 0 ? medians[Math.floor((medians.length - 1) / 2)] : null,
  };

  // 재방문 리듬.
  const activeDaysList: number[] = [];
  const spanList: number[] = [];
  let returningUsers = 0;
  for (const uid of observed) {
    const row = activityByUid.get(uid);
    if (!row) continue;
    const days = coerceNumber(row.activeDays);
    activeDaysList.push(days);
    if (days >= 2) returningUsers += 1;
    const first = str(row.firstActiveDate);
    const last = str(row.lastActiveDate);
    if (first && last) {
      const span = daysBetween(first, last);
      if (span != null && span >= 0) spanList.push(span);
    }
  }
  const rhythm: SegmentRhythmStats = {
    avgActiveDays: mean(activeDaysList),
    returningUsers,
    returningRate: safeRate(returningUsers, observedUsers),
    avgSpanDays: mean(spanList),
  };

  // 기능 채택(오케/스폰/티켓).
  const countUsersWith = (events: readonly string[]): number => {
    let n = 0;
    for (const uid of observed) {
      const perEvent = eventsByUid.get(uid);
      if (!perEvent) continue;
      if (events.some((e) => (perEvent.get(e) ?? 0) > 0)) n += 1;
    }
    return n;
  };
  const orchestratorUsers = countUsersWith(ADOPTION_EVENTS.orchestrator);
  const spawnUsers = countUsersWith(ADOPTION_EVENTS.spawn);
  const ticketUsers = countUsersWith(ADOPTION_EVENTS.ticket);
  const adoption: SegmentAdoptionStats = {
    orchestratorUsers,
    spawnUsers,
    ticketUsers,
    orchestratorRate: safeRate(orchestratorUsers, observedUsers),
    spawnRate: safeRate(spawnUsers, observedUsers),
    ticketRate: safeRate(ticketUsers, observedUsers),
  };

  return {
    key,
    label,
    cohortSize,
    observedUsers,
    observedRate,
    suppressed: false,
    suppressionReason: null,
    featureUsage,
    sessions,
    rhythm,
    adoption,
  };
}

/**
 * 베타 세그먼트 사용패턴 전체 조립.
 *
 * 중요: BQ 행에 grant 보유자가 아닌 계정이 섞여 들어와도 roster 에 없으면 전부
 * 무시한다 — 세그먼트 뷰의 모수는 언제나 Firestore grant 명단이다.
 */
export function buildBetaSegmentUsage(input: {
  grantHolders: GrantHolderRow[];
  activityRows: SegmentActivityRow[];
  eventRows: SegmentEventRow[];
  sessionRows: SegmentSessionRow[];
}): BetaSegmentUsage {
  const roster = buildGrantRoster(input.grantHolders);

  const activityByUid = new Map<string, SegmentActivityRow>();
  for (const row of input.activityRows) {
    const uid = str(row.userId);
    if (uid && roster.segmentOf.has(uid)) activityByUid.set(uid, row);
  }

  const eventsByUid = new Map<string, Map<string, number>>();
  for (const row of input.eventRows) {
    const uid = str(row.userId);
    const event = str(row.event);
    if (!uid || !event || !roster.segmentOf.has(uid)) continue;
    const perEvent = eventsByUid.get(uid) || new Map<string, number>();
    perEvent.set(event, (perEvent.get(event) ?? 0) + coerceNumber(row.n));
    eventsByUid.set(uid, perEvent);
  }

  const sessionsByUid = new Map<string, SegmentSessionRow>();
  for (const row of input.sessionRows) {
    const uid = str(row.userId);
    if (uid && roster.segmentOf.has(uid)) sessionsByUid.set(uid, row);
  }

  const uidsBySegment = new Map<BetaSegmentKey, Set<string>>();
  for (const key of BETA_SEGMENT_KEYS) uidsBySegment.set(key, new Set());
  for (const [uid, key] of roster.segmentOf) uidsBySegment.get(key)?.add(uid);

  const segments = BETA_SEGMENT_KEYS.map((key) =>
    summarizeSegment(
      key,
      BETA_SEGMENT_LABELS[key],
      roster.cohortSizes[key],
      uidsBySegment.get(key) ?? new Set(),
      activityByUid,
      eventsByUid,
      sessionsByUid,
    ),
  ).filter((s) => s.cohortSize > 0);

  const all = summarizeSegment(
    "all",
    "베타 전체",
    roster.total,
    new Set(roster.segmentOf.keys()),
    activityByUid,
    eventsByUid,
    sessionsByUid,
  );

  return {
    minCohortSize: MIN_COHORT_SIZE,
    grantCohortSize: roster.total,
    observedUsers: all.observedUsers,
    accountAttributionAvailable: eventsByUid.size > 0,
    segments,
    all,
  };
}
