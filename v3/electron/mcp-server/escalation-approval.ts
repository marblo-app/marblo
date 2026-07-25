/**
 * 고비용 모델 칸의 사용자 승인 레코드 (P3-1 승인 게이트).
 *
 * 사장님 결정(2026-07-25): 5.6 계열의 `max`/`ultra` effort 는 "구독형이면
 * 포함하되 자주 쓰지 말고, 오케가 사용자 승인을 받고 쓸 것". 그래서 그 칸들은
 * 사다리에 존재하지만 잠겨 있고, 이 파일이 그 자물쇠의 **순수 로직**이다
 * (레코드 복원·예산·1회용 소진 판정).
 *
 * ── 왜 electron/ 이 아니라 여기(mcp-server/)에 있나 ──────────────────────
 * 승인 왕복은 MCP 툴(`request_model_escalation` / `resolve_model_escalation`)이
 * 하고, 게이트 집행은 스폰 경로(`electron/model-ladder.ts` + `agent-config.ts`)가
 * 한다. 그런데 `electron/mcp-server/tsconfig.json` 은 `rootDir: "."` 이라
 * MCP 번들은 상위 디렉터리 파일을 import 할 수 없다(dist-mcp 산출물 배치가
 * 깨진다). 반대 방향(electron/ → mcp-server/)은 이미 열려 있다
 * (`agent-config.ts` → `mcp-server/tool-surface.ts` 선례).
 *
 * 그래서 **양쪽이 함께 쓰는 순수 로직은 이쪽에 둔다.** 모델의 "사실"이 필요한
 * 부분(사다리 순서·강등 대상·단가)은 레지스트리를 읽을 수 있는
 * `electron/model-ladder.ts` 에 남고, 그 파일이 아래 상수들이 사다리와
 * 일치하는지 **모듈 로드시 검증**한다 — 여기 목록이 사다리와 갈라지면 앱이
 * 부팅하다 죽는다(조용한 불일치 금지).
 */

/** effort 축 전체(낮음 → 높음). `model-registry.EFFORT_LADDER` 와 같아야 한다. */
export const EFFORT_NAMES: readonly string[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

/**
 * 사용자 승인 없이는 쓸 수 없는 effort.
 *
 * `xhigh` 를 잠그지 않은 이유: 설계문서 §1.2 실측에서 xhigh 는 5.5 계열에도
 * 있던 기존 칸(오늘도 env 로 열 수 있는 범위)이고, 사장님이 지목한 "고비용
 * 상단" 은 5.6 계열에만 새로 생긴 max/ultra 두 칸이다.
 */
export const APPROVAL_GATED_EFFORTS: readonly string[] = [
  "max",
  "ultra",
] as const;

export function isApprovalGatedEffort(effort: string | undefined): boolean {
  if (!effort) return false;
  return APPROVAL_GATED_EFFORTS.includes(effort.trim().toLowerCase());
}

/**
 * 승인 왕복으로 열 수 있는 칸의 **전체 목록**(`model@effort`).
 *
 * MCP 쪽은 레지스트리를 읽을 수 없으므로 여기 적힌 것만 승인 대상으로 받는다.
 * 이 목록은 `electron/model-ladder.ts` 의 사다리에 실제로 존재하는 게이트 칸과
 * **정확히 같아야** 하며, 그 파일이 양방향으로 검증한다. 즉 사다리에 새 고비용
 * 칸을 넣으면 여기도 넣어야 앱이 뜬다.
 */
export const GATED_LADDER_RUNGS: readonly string[] = [
  "gpt-5.6-sol@max",
  "gpt-5.6-sol@ultra",
] as const;

/**
 * 티켓 1건이 받을 수 있는 고비용 승인 건수.
 *
 * 1 인 근거는 설계문서 §4 넷-뉴 2 — "상향은 티켓당 1회로 제한(무한
 * 에스컬레이션은 비용 폭주)". 고비용 칸 승인도 상향이므로 같은 계정에서
 * 차감한다. 새 숫자를 발명한 것이 아니라 이미 정해진 규칙을 재사용한 것이다.
 * (거부는 예산을 쓰지 않는다 — 거부가 예산을 태우면 사장님이 "안 됨" 이라고
 * 답한 순간 그 티켓은 상향 자체가 영구 불가능해진다.)
 */
export const MAX_GATED_APPROVALS_PER_TASK = 1;

/** 고비용 칸 승인 레코드. `tasks/{taskId}.modelEscalations` 배열에 보관. */
export interface EscalationApprovalRecord {
  /** 승인 왕복이 오간 질문 id — 누가 무엇을 근거로 허락했는지 되짚는 열쇠. */
  questionId: string;
  model: string;
  effort: string;
  /** pending = 요청됨(아직 사용자 답 없음). */
  decision: "pending" | "approved" | "denied";
  /** 요청한 에이전트 id. */
  requestedBy: string;
  requestedAt: number;
  /** 승인/거부를 기록한 주체(오케 id). */
  decidedBy?: string;
  /** 실제로 판단한 사람(사장님 등). 오케가 대리 기록하므로 분리해 남긴다. */
  decidedFor?: string;
  decidedAt?: number;
  /** ★1회용 — 한 번 쓰이면 소진된다(승인 한 건이 무한 사용이 되지 않게). */
  consumedAt?: number;
  /** 요청 사유 / 결정 메모. */
  note?: string;
}

/** `model@effort` 라벨. 그래프 cell key(P2-2 예정)와 같은 모양. */
export function rungSpecLabel(model: string, effort?: string): string {
  return effort ? `${model}@${effort}` : model;
}

export type GatedRungSpec =
  | { ok: true; model: string; effort: string; label: string }
  | { ok: false; error: string; needsNoApproval?: boolean };

/**
 * `"gpt-5.6-sol@max"` 같은 승인 대상 칸 표기를 검증한다.
 *
 * 승인이 **필요 없는** 칸을 넘긴 경우를 따로 알려준다(`needsNoApproval`) —
 * "승인 왕복이 필요 없는데 승인 질문을 만들어 사장님을 깨우는" 알림 피로를
 * 도구 단계에서 막는다.
 */
export function parseGatedRungSpec(
  model: string,
  effort: string,
): GatedRungSpec {
  const m = model.trim();
  const e = effort.trim().toLowerCase();
  if (!m) return { ok: false, error: "model 이 비어 있습니다." };
  if (!EFFORT_NAMES.includes(e)) {
    return {
      ok: false,
      error: `effort "${effort}" 는 유효하지 않습니다(${EFFORT_NAMES.join(", ")}).`,
    };
  }
  if (!isApprovalGatedEffort(e)) {
    return {
      ok: false,
      needsNoApproval: true,
      error: `effort "${e}" 는 승인 게이트 대상이 아닙니다(게이트: ${APPROVAL_GATED_EFFORTS.join(
        "/",
      )}). 승인 왕복 없이 그대로 쓰세요.`,
    };
  }
  const label = rungSpecLabel(m, e);
  if (!GATED_LADDER_RUNGS.includes(label)) {
    return {
      ok: false,
      error: `"${label}" 는 사다리에 없는 칸입니다. 승인 가능한 고비용 칸: ${GATED_LADDER_RUNGS.join(
        ", ",
      )}.`,
    };
  }
  return { ok: true, model: m, effort: e, label };
}

// ─────────────────────────────────────────────────────────────────────────
// dispatch 인자 해석 (게이트 집행용)
//
// `dispatch_task(model, effort)` 는 두 가지 표기를 받는다(#601 model-selection):
// `model="gpt-5.6-sol@max"` 와 `model="gpt-5.6-sol", effort="max"`. 게이트가 한쪽만
// 보면 다른 쪽으로 고비용 칸이 그대로 새어 나간다.
// ─────────────────────────────────────────────────────────────────────────

/** 요청된 effort — model 문자열의 `@effort` 가 effort 인자보다 우선(#601 계약). */
export function effortFromDispatchArgs(
  model: string | undefined,
  effort: string | undefined,
): string | undefined {
  const at = (model ?? "").indexOf("@");
  if (at >= 0) {
    const suffix = model!.slice(at + 1).trim();
    if (suffix) return suffix.toLowerCase();
  }
  const e = (effort ?? "").trim().toLowerCase();
  return e || undefined;
}

/** `"gpt-5.6-sol@max"` → `"gpt-5.6-sol"`. 게이트가 effort 를 떼어낼 때 쓴다. */
export function stripEffortSuffix(
  model: string | undefined,
): string | undefined {
  if (!model) return model;
  const at = model.indexOf("@");
  return at >= 0 ? model.slice(0, at).trim() || undefined : model;
}

/**
 * 느슨한 모델 표기 비교. 사람은 `opus 4.8`·`opus4.8`·`claude-opus-4-8` 를 같은
 * 뜻으로 쓴다(#601 model-selection 의 정규화와 같은 발상). MCP 층은 레지스트리를
 * import 할 수 없어 alias 해석까지는 못 하므로, **해석되지 않으면 게이트가 막는
 * 쪽**으로 떨어진다 — 승인을 못 찾아 강등되는 것이 잘못 통과시키는 것보다 안전하다.
 */
export function normalizeModelKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 느슨한 모델 표기로 미소진 승인을 찾는다. */
export function usableApprovalLoose(
  records: readonly EscalationApprovalRecord[],
  requestedModel: string | undefined,
  effort: string,
): EscalationApprovalRecord | undefined {
  const key = normalizeModelKey(stripEffortSuffix(requestedModel ?? "") ?? "");
  if (!key) return undefined;
  return records.find(
    (r) =>
      r.decision === "approved" &&
      r.consumedAt === undefined &&
      r.effort === effort &&
      normalizeModelKey(r.model) === key,
  );
}

/** Firestore 에서 읽은 임의 값에서 승인 레코드를 안전하게 복원한다. */
export function readEscalationApprovals(
  value: unknown,
): EscalationApprovalRecord[] {
  if (!Array.isArray(value)) return [];
  const out: EscalationApprovalRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.questionId !== "string" || typeof r.model !== "string")
      continue;
    if (typeof r.effort !== "string" || !EFFORT_NAMES.includes(r.effort))
      continue;
    const decision =
      r.decision === "approved"
        ? "approved"
        : r.decision === "denied"
          ? "denied"
          : "pending";
    const rec: EscalationApprovalRecord = {
      questionId: r.questionId,
      model: r.model,
      effort: r.effort,
      decision,
      requestedBy: typeof r.requestedBy === "string" ? r.requestedBy : "",
      requestedAt: typeof r.requestedAt === "number" ? r.requestedAt : 0,
    };
    if (typeof r.decidedBy === "string") rec.decidedBy = r.decidedBy;
    if (typeof r.decidedFor === "string") rec.decidedFor = r.decidedFor;
    if (typeof r.decidedAt === "number") rec.decidedAt = r.decidedAt;
    if (typeof r.consumedAt === "number") rec.consumedAt = r.consumedAt;
    if (typeof r.note === "string") rec.note = r.note;
    out.push(rec);
  }
  return out;
}

/** 승인 예산 사용량 = approved 레코드 수(거부는 차감하지 않는다). */
export function approvalBudgetSpent(
  records: readonly EscalationApprovalRecord[],
): number {
  return records.filter((r) => r.decision === "approved").length;
}

/** 이 칸에 쓸 수 있는 **미소진 승인**(정확히 같은 model+effort 만 인정). */
export function usableApproval(
  records: readonly EscalationApprovalRecord[],
  model: string,
  effort: string | undefined,
): EscalationApprovalRecord | undefined {
  if (!effort) return undefined;
  return records.find(
    (r) =>
      r.decision === "approved" &&
      r.consumedAt === undefined &&
      r.model === model &&
      r.effort === effort,
  );
}

/** 같은 칸에 대한 미결(pending) 요청 — 중복 요청으로 사장님을 두 번 깨우지 않게. */
export function pendingRequestFor(
  records: readonly EscalationApprovalRecord[],
  model: string,
  effort: string,
): EscalationApprovalRecord | undefined {
  return records.find(
    (r) => r.decision === "pending" && r.model === model && r.effort === effort,
  );
}

/** 이 칸이 거부된 기록. */
export function deniedRecordFor(
  records: readonly EscalationApprovalRecord[],
  model: string,
  effort: string | undefined,
): EscalationApprovalRecord | undefined {
  if (!effort) return undefined;
  return records.find(
    (r) => r.decision === "denied" && r.model === model && r.effort === effort,
  );
}

/** 승인 레코드를 소진 처리(1회용 계약 집행). */
export function consumeApproval(
  records: readonly EscalationApprovalRecord[],
  questionId: string,
  at: number,
): EscalationApprovalRecord[] {
  return records.map((r) =>
    r.questionId === questionId && r.consumedAt === undefined
      ? { ...r, consumedAt: at }
      : r,
  );
}

/** 요청 레코드를 승인/거부로 확정한다. 이미 결정된 건은 덮어쓰지 않는다. */
export type DecideOutcome =
  | {
      ok: true;
      records: EscalationApprovalRecord[];
      record: EscalationApprovalRecord;
    }
  | {
      ok: false;
      reason: "not-found" | "already-decided" | "budget-exhausted";
      record?: EscalationApprovalRecord;
    };

export function decideApproval(
  records: readonly EscalationApprovalRecord[],
  questionId: string,
  decision: "approved" | "denied",
  decidedBy: string,
  decidedFor: string,
  at: number,
  note?: string,
): DecideOutcome {
  const idx = records.findIndex((r) => r.questionId === questionId);
  if (idx < 0) return { ok: false, reason: "not-found" };
  const found = records[idx];
  if (found.decision !== "pending") {
    return { ok: false, reason: "already-decided", record: found };
  }
  if (
    decision === "approved" &&
    approvalBudgetSpent(records) >= MAX_GATED_APPROVALS_PER_TASK
  ) {
    return { ok: false, reason: "budget-exhausted", record: found };
  }
  const updated: EscalationApprovalRecord = {
    ...found,
    decision,
    decidedBy,
    decidedAt: at,
    ...(decidedFor ? { decidedFor } : {}),
    ...(note ? { note } : {}),
  };
  const next = [...records];
  next[idx] = updated;
  return { ok: true, records: next, record: updated };
}

/** 승인 요청 알림 본문(오케 PTY). 승인/거부 방법을 그대로 실어 준다. */
export function formatApprovalRequest(input: {
  questionId: string;
  taskId: string;
  taskTitle: string;
  requestedBy: string;
  label: string;
  reason: string;
  budgetSpent: number;
}): string {
  return [
    `[Question] ★고비용 모델 승인 요청 — "${input.taskTitle}" (task=${input.taskId}, agent=${input.requestedBy})`,
    `question_id=${input.questionId}`,
    `요청 칸: ${input.label} (승인 없이는 자동으로 쓰이지 않는다)`,
    `티켓 승인 예산: ${input.budgetSpent}/${MAX_GATED_APPROVALS_PER_TASK} 사용`,
    "",
    `사유: ${input.reason}`,
    "",
    "★이 칸은 사용자(사장님) 승인 없이 쓸 수 없다. 오케가 임의로 승인하지 말고,",
    "  사장님께 물어 그 답을 그대로 기록하라:",
    `  - 사장님께 전달: escalate_to_owner(question_id="${input.questionId}")`,
    `  - 답을 받은 뒤: resolve_model_escalation(question_id="${input.questionId}", decision="approve"|"deny", decided_for="사장님")`,
    "  승인은 1회용이다(한 번 스폰에 쓰면 소진).",
  ].join("\n");
}

/** 승인/거부 결과를 요청 에이전트에게 돌려줄 본문. */
export function formatApprovalDecision(input: {
  label: string;
  decision: "approved" | "denied";
  decidedFor?: string;
  note?: string;
}): string {
  const who = input.decidedFor ? ` (${input.decidedFor})` : "";
  if (input.decision === "approved") {
    return [
      `승인됨${who}: ${input.label} 를 1회 사용할 수 있습니다.`,
      input.note ? `메모: ${input.note}` : "",
      "★1회용입니다 — 이 칸으로 한 번 스폰하면 소진되고, 다시 쓰려면 다시 승인받아야 합니다.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `거부됨${who}: ${input.label} 는 쓸 수 없습니다.`,
    input.note ? `이유: ${input.note}` : "",
    "승인 없이 갈 수 있는 가장 높은 칸으로 진행하세요(사다리 강등).",
  ]
    .filter(Boolean)
    .join("\n");
}
