/**
 * 실사용량(cost_logs / getCostSummary 형태) → 자동선택 핫패스 입력.
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 * 2층 `selectAutoModel` 은 동기 핫패스다. BQ/Callable `getCostSummary` 를
 * dispatch 마다 await 하면 스폰 지연이 생기고, offline도 깨진다. 그래서:
 *
 *   1. **로컬 롤업** (`~/.marblo/usage-weekly.json`) — cost-tracker 가 보는
 *      토큰 델타를 같은 프로세스에서 일·모델별로 누적. cost_logs 로 나가는
 *      그 숫자가 여기에도 쌓인다(같은 관측의 로컬 거울).
 *   2. **getCostSummary 어댑터** — 화면/렌더러가 이미 받아 둔 weeklyByModel
 *      을 같은 스냅샷 형태로 주입할 수 있다(오프라인·교차검증).
 *   3. **순수 점수 함수** — 유닛테스트가 네트워크 없이 하향·한도 압력을 검증.
 *
 * 핫패스 규율: 읽기는 sync mtime 캐시, 없거나 깨지면 null(콜드 = 사용량 항 0).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getModel,
  HARNESS_NATIVE_VENDOR,
  type HarnessId,
} from "./model-registry";
import {
  HARNESS_WEEKLY_TOKEN_SOFT_LIMIT,
  weeklyTokenSoftLimitForHarness,
} from "./model-ladder";

// ─────────────────────────────────────────────────────────────────────────
// 스냅샷 형태 (getCostSummary.weeklyByModel 과 호환)
// ─────────────────────────────────────────────────────────────────────────

export interface UsageByModelRow {
  model: string;
  totalTokens: number;
  cost?: number;
}

export interface UsageRollupSnapshot {
  /** 집계 창 시작(ms). 주간이면 "지금 − 7d". */
  windowStartMs: number;
  windowEndMs: number;
  byModel: readonly UsageByModelRow[];
  source: "local" | "getCostSummary" | "injected";
}

/** getCostSummary 응답의 weekly 절반만 있을 때. */
export interface CostSummaryWeeklyShape {
  weeklyByModel?: readonly { model?: string; totalTokens?: number; cost?: number }[];
  weeklyTotalTokens?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const USAGE_ROLLUP_WINDOW_DAYS = 7;

export const USAGE_WEEKLY_FILE = path.join(
  os.homedir(),
  ".marblo",
  "usage-weekly.json",
);

interface DailyBucket {
  /** YYYY-MM-DD → modelId → tokens */
  days: Record<string, Record<string, number>>;
  /** modelId → cost USD (optional, best-effort) */
  costs?: Record<string, number>;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 순수 집계 / 점수
// ─────────────────────────────────────────────────────────────────────────

/** 모델 id·alias 를 레지스트리 harness 로. 미등록은 문자열 휴리스틱. */
export function harnessOfUsageModel(modelId: string): HarnessId | "unknown" {
  const fromReg = getModel(modelId)?.harness;
  if (fromReg) return fromReg;
  const lower = modelId.toLowerCase();
  if (lower.startsWith("claude") || lower.includes("opus") || lower.includes("sonnet") || lower.includes("fable")) {
    return "claude";
  }
  if (lower.startsWith("gpt") || lower.startsWith("o3") || lower.startsWith("o4") || lower.includes("codex")) {
    return "gpt";
  }
  if (lower.startsWith("grok")) return "grok";
  if (lower.includes("minimax") || lower.startsWith("glm") || lower.startsWith("k3") || lower.includes("kimi")) {
    // env-swap 은 claude 하네스지만 쿼터/한도는 anthropic 이 아님 — 별 버킷.
    return "claude";
  }
  return "unknown";
}

/**
 * env-swap(종량제) 모델은 구독 주간 한도(Claude Max / ChatGPT) 와 무관하다.
 * 한도 압력은 **네이티브 구독 계열**에만 건다.
 */
export function isSubscriptionQuotaModel(modelId: string): boolean {
  const entry = getModel(modelId);
  if (!entry) {
    const h = harnessOfUsageModel(modelId);
    // 미등록 id 휴리스틱: claude/gpt 네이티브 이름만 (MiniMax 등 env-swap 제외)
    if (h !== "claude" && h !== "gpt") return false;
    const lower = modelId.toLowerCase();
    if (
      lower.includes("minimax") ||
      lower.startsWith("glm") ||
      lower.startsWith("k3") ||
      lower.includes("kimi")
    ) {
      return false;
    }
    return true;
  }
  // 하네스 네이티브 벤더만 정액 쿼터를 공유한다(zai/minimax/moonshot 은 API 키).
  const nativeVendor = HARNESS_NATIVE_VENDOR[entry.harness];
  return entry.provider === nativeVendor;
}

export function totalTokens(snapshot: UsageRollupSnapshot | null | undefined): number {
  if (!snapshot) return 0;
  return snapshot.byModel.reduce(
    (sum, row) => sum + (Number.isFinite(row.totalTokens) ? Math.max(0, row.totalTokens) : 0),
    0,
  );
}

/** 한 모델(+ effort 접미 무시) 의 주간 토큰. model@effort 키면 @ 앞. */
export function tokensForModel(
  modelIdOrKey: string,
  snapshot: UsageRollupSnapshot | null | undefined,
): number {
  if (!snapshot) return 0;
  const base = modelIdOrKey.split("@")[0] ?? modelIdOrKey;
  let sum = 0;
  for (const row of snapshot.byModel) {
    const id = row.model.split("@")[0] ?? row.model;
    if (id === base || id === modelIdOrKey || row.model === modelIdOrKey) {
      sum += Number.isFinite(row.totalTokens) ? Math.max(0, row.totalTokens) : 0;
    }
  }
  return sum;
}

/**
 * 하네스(구독 계열) 합산. env-swap 모델은 claude 하네스라도 한도 합산에서
 * 빼려면 `subscriptionOnly=true`.
 */
export function tokensForHarness(
  harness: string,
  snapshot: UsageRollupSnapshot | null | undefined,
  opts: { subscriptionOnly?: boolean } = {},
): number {
  if (!snapshot) return 0;
  let sum = 0;
  for (const row of snapshot.byModel) {
    if (opts.subscriptionOnly && !isSubscriptionQuotaModel(row.model)) continue;
    if (harnessOfUsageModel(row.model) !== harness) continue;
    sum += Number.isFinite(row.totalTokens) ? Math.max(0, row.totalTokens) : 0;
  }
  return sum;
}

/**
 * 사용량 로드밸런싱 점수 — 많이 쓴 모델일수록 음수.
 * share=0 → 0, share=1 → −weight. 콜드(total=0) → 0.
 */
export function usageLoadScore(
  modelTokens: number,
  poolTokens: number,
  weight: number,
): number {
  if (!(weight > 0) || !(poolTokens > 0)) return 0;
  const share = Math.min(1, Math.max(0, modelTokens / poolTokens));
  if (share === 0) return 0;
  return -weight * share;
}

/**
 * 주간 한도 근접 점수. ratio&lt;soft(기본 0.5) 는 0, soft→limit 에서 0→−weight,
 * 한도 초과 시 −weight 아래로 선형(상한 1.5×).
 *
 * 같은 하네스 후보 전부 동일 값을 받으면 **1층 전환**(budget 합성)이 실제
 * fleet 이동을 만들고, 2층에서는 model-level usageLoad 가 칸을 가른다.
 */
export function weeklyLimitScore(
  usedTokens: number,
  limit: number,
  weight: number,
  softRatio = 0.5,
): number {
  if (!(weight > 0) || !(limit > 0)) return 0;
  const ratio = Math.min(1.5, Math.max(0, usedTokens / limit));
  if (ratio <= softRatio) return 0;
  // soft→1.0 maps to 0→−weight; above 1 continues up to −1.5*weight
  const span = 1 - softRatio;
  const t = Math.min(1.5, (ratio - softRatio) / span);
  return -weight * t;
}

/**
 * 주간 토큰을 rate-limit usedPercent(0–100) 스케일로. 없으면 null.
 * bridge 가 계정 쿼터 % 와 max 합성해 budgetSnapshot 에 넣는다.
 */
export function weeklyUsedPercentForHarness(
  harness: string,
  snapshot: UsageRollupSnapshot | null | undefined,
  limits: Partial<Record<string, number>> = HARNESS_WEEKLY_TOKEN_SOFT_LIMIT,
): number | null {
  const limit =
    limits[harness] ?? weeklyTokenSoftLimitForHarness(harness as HarnessId);
  if (!(typeof limit === "number") || !(limit > 0) || !snapshot) return null;
  const used = tokensForHarness(harness, snapshot, { subscriptionOnly: true });
  if (!(used > 0)) return 0;
  return Math.min(100, (used / limit) * 100);
}

/** getCostSummary.weeklyByModel → 핫패스 스냅샷. */
export function usageSnapshotFromCostSummary(
  summary: CostSummaryWeeklyShape | null | undefined,
  nowMs: number = Date.now(),
): UsageRollupSnapshot | null {
  if (!summary || !Array.isArray(summary.weeklyByModel)) return null;
  const byModel: UsageByModelRow[] = summary.weeklyByModel
    .map((row) => ({
      model: String(row?.model ?? ""),
      totalTokens: Number(row?.totalTokens) || 0,
      ...(typeof row?.cost === "number" && Number.isFinite(row.cost)
        ? { cost: row.cost }
        : {}),
    }))
    .filter((row) => row.model.length > 0);
  if (byModel.length === 0) return null;
  return {
    windowStartMs: nowMs - USAGE_ROLLUP_WINDOW_DAYS * DAY_MS,
    windowEndMs: nowMs,
    byModel,
    source: "getCostSummary",
  };
}

export function usageSnapshotFromRows(
  rows: readonly UsageByModelRow[],
  nowMs: number = Date.now(),
  source: UsageRollupSnapshot["source"] = "injected",
): UsageRollupSnapshot {
  return {
    windowStartMs: nowMs - USAGE_ROLLUP_WINDOW_DAYS * DAY_MS,
    windowEndMs: nowMs,
    byModel: rows.map((r) => ({
      model: r.model,
      totalTokens: Math.max(0, Number(r.totalTokens) || 0),
      ...(typeof r.cost === "number" ? { cost: r.cost } : {}),
    })),
    source,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 로컬 파일 롤업 (cost-tracker 델타)
// ─────────────────────────────────────────────────────────────────────────

interface FileCache {
  data: DailyBucket | null;
  mtime: number;
}
let _fileCache: FileCache = { data: null, mtime: -1 };

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function emptyBucket(): DailyBucket {
  return { days: {}, costs: {}, updatedAt: new Date(0).toISOString() };
}

function pruneDays(bucket: DailyBucket, nowMs: number): void {
  const cutoff = dayKey(nowMs - USAGE_ROLLUP_WINDOW_DAYS * DAY_MS);
  for (const d of Object.keys(bucket.days)) {
    if (d < cutoff) delete bucket.days[d];
  }
}

function readBucket(): DailyBucket {
  try {
    if (!fs.existsSync(USAGE_WEEKLY_FILE)) {
      _fileCache = { data: emptyBucket(), mtime: 0 };
      return _fileCache.data!;
    }
    const stat = fs.statSync(USAGE_WEEKLY_FILE);
    if (_fileCache.data && _fileCache.mtime === stat.mtimeMs) {
      return _fileCache.data;
    }
    const parsed = JSON.parse(
      fs.readFileSync(USAGE_WEEKLY_FILE, "utf-8"),
    ) as DailyBucket;
    const data: DailyBucket = {
      days: parsed?.days && typeof parsed.days === "object" ? parsed.days : {},
      costs:
        parsed?.costs && typeof parsed.costs === "object" ? parsed.costs : {},
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
    _fileCache = { data, mtime: stat.mtimeMs };
    return data;
  } catch {
    _fileCache = { data: emptyBucket(), mtime: 0 };
    return _fileCache.data!;
  }
}

function writeBucket(bucket: DailyBucket): void {
  try {
    const dir = path.dirname(USAGE_WEEKLY_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${USAGE_WEEKLY_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(bucket), "utf-8");
    fs.renameSync(tmp, USAGE_WEEKLY_FILE);
    _fileCache = { data: bucket, mtime: -1 }; // force re-stat next read
  } catch {
    // best-effort — 실패해도 스폰을 막지 않는다
  }
}

/**
 * cost-tracker 델타를 로컬 주간 롤업에 누적. 핫패스 밖(폴링 emit)에서 호출.
 */
export function recordUsageDelta(input: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCost?: number;
  atMs?: number;
}): void {
  const model = (input.model ?? "").trim();
  if (!model) return;
  const tokens =
    Math.max(0, input.inputTokens ?? 0) +
    Math.max(0, input.outputTokens ?? 0) +
    Math.max(0, input.cacheReadTokens ?? 0) +
    Math.max(0, input.cacheWriteTokens ?? 0);
  if (tokens <= 0 && !(typeof input.totalCost === "number" && input.totalCost > 0)) {
    return;
  }
  const atMs = input.atMs ?? Date.now();
  const bucket = readBucket();
  pruneDays(bucket, atMs);
  const d = dayKey(atMs);
  if (!bucket.days[d]) bucket.days[d] = {};
  bucket.days[d][model] = (bucket.days[d][model] ?? 0) + tokens;
  if (typeof input.totalCost === "number" && Number.isFinite(input.totalCost)) {
    if (!bucket.costs) bucket.costs = {};
    bucket.costs[model] = (bucket.costs[model] ?? 0) + Math.max(0, input.totalCost);
  }
  bucket.updatedAt = new Date(atMs).toISOString();
  writeBucket(bucket);
}

/** 동기 로드 — dispatch 핫패스. 창 밖 일자는 버린 뒤 model 합산. */
export function loadUsageRollup(nowMs: number = Date.now()): UsageRollupSnapshot | null {
  const bucket = readBucket();
  pruneDays(bucket, nowMs);
  const byModelMap = new Map<string, number>();
  for (const [d, models] of Object.entries(bucket.days)) {
    const cutoff = dayKey(nowMs - USAGE_ROLLUP_WINDOW_DAYS * DAY_MS);
    if (d < cutoff) continue;
    for (const [model, tok] of Object.entries(models)) {
      byModelMap.set(model, (byModelMap.get(model) ?? 0) + (Number(tok) || 0));
    }
  }
  if (byModelMap.size === 0) return null;
  const byModel: UsageByModelRow[] = [...byModelMap.entries()].map(
    ([model, totalTokens]) => ({
      model,
      totalTokens,
      ...(bucket.costs && typeof bucket.costs[model] === "number"
        ? { cost: bucket.costs[model] }
        : {}),
    }),
  );
  return {
    windowStartMs: nowMs - USAGE_ROLLUP_WINDOW_DAYS * DAY_MS,
    windowEndMs: nowMs,
    byModel,
    source: "local",
  };
}

/** 테스트용 — 캐시/파일 상태 리셋. */
export function clearUsageRollupCache(): void {
  _fileCache = { data: null, mtime: -1 };
}

/** 테스트용 — 메모리 스냅샷을 파일에 심지 않고 inject 할 때 캐시 세팅. */
export function __setUsageRollupCacheForTests(bucket: DailyBucket | null): void {
  _fileCache = { data: bucket, mtime: Date.now() };
}
