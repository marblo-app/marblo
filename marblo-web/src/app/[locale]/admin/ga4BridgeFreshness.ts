/**
 * GA4 브리지 신선도 카피. 빈 표가 '유입 0' 인지 '미적재' 인지 화면이 가른다.
 * 숫자 조립은 functions/ga4Bridge.ts 가 하고, 여기는 표시 문장만 맡는다.
 */

export type Ga4BridgeFreshnessStatus =
  | "not_ingested"
  | "loaded"
  | "stale"
  | "unknown";

export type Ga4BridgeFreshness = {
  lastSyncedAt: string | null;
  rowCount: number;
  distinctGaKeys: number;
  minFirstVisitDate: string | null;
  maxFirstVisitDate: string | null;
  visitLagDays: number | null;
  lastSyncLagDays: number | null;
  status: Ga4BridgeFreshnessStatus;
  rangeDays: number | null;
  scanned: number | null;
  inserted: number | null;
  skippedExisting: number | null;
  reason: string | null;
  ok: boolean | null;
  errorMessage: string | null;
};

export type Ga4BridgeFreshnessCopy = {
  headline: string;
  detail: string;
  tone: "ok" | "warn" | "missing";
};

export function formatBridgeSyncKst(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (t: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === t)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")} KST`;
}

export function describeGa4BridgeFreshness(
  b: Ga4BridgeFreshness | null | undefined
): Ga4BridgeFreshnessCopy | null {
  if (!b) return null;
  if (b.status === "unknown") {
    return {
      headline: "브리지 동기 시각을 읽지 못했습니다",
      detail:
        b.errorMessage ??
        "조회가 실패했습니다. 빈 표를 유입 0으로 읽지 마세요.",
      tone: "warn",
    };
  }
  if (b.status === "not_ingested") {
    return {
      headline: "브리지 미적재",
      detail:
        "표가 비어 있는 것은 유입 0이 아니라 아직 안 실렸습니다. 마지막 동기 기록이 없습니다.",
      tone: "missing",
    };
  }
  const when = b.lastSyncedAt
    ? formatBridgeSyncKst(b.lastSyncedAt)
    : "시각 없음";
  const n = b.rowCount.toLocaleString("ko-KR");
  const visit = b.maxFirstVisitDate ?? "없음";
  const inserted =
    b.inserted == null ? "" : ` · 이번 적재 ${b.inserted.toLocaleString("ko-KR")}명`;
  if (b.status === "stale") {
    return {
      headline: `브리지 마지막 동기 ${when} — 일 단위 적재가 멈춘 것으로 보입니다`,
      detail: `적재 ${n}명 · 최신 방문일 ${visit}. 빈 표는 유입 0이 아니라 적재 공백일 수 있습니다.`,
      tone: "warn",
    };
  }
  const zeroNote =
    b.rowCount === 0
      ? " 동기 기록이 있으므로 빈 표는 유입 0입니다."
      : " 이 시각이 있으면 표가 비어도 미적재가 아닙니다.";
  return {
    headline: `브리지 마지막 동기 ${when}`,
    detail: `적재 ${n}명 · 최신 방문일 ${visit}${inserted}.${zeroNote}`,
    tone: "ok",
  };
}
