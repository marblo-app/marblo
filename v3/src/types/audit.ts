/**
 * 감사 원장(`audit_logs`) — 렌더러 쪽 타입.
 *
 * 스키마 권위는 **electron/mcp-server/ledger.ts 의 `LedgerEvent`** 다. 여기서
 * 그걸 import 하지 않고 다시 적는 이유는 렌더러 tsconfig 가 electron 트리를
 * 포함하지 않아서다(node:crypto/node:path 를 타는 모듈이라 포함시켜서도 안 된다).
 * 필드를 늘릴 때는 두 파일을 같이 고쳐야 한다.
 */

/** 이벤트 분류. 권위는 ledger.ts 의 `LedgerEventKind`. */
export type AuditLogKind = "action" | "lifecycle" | "deploy";

export interface AuditLog {
  id: string;
  projectId: string;
  agentId: string;
  toolName: string;
  /**
   * 툴 인자.
   *
   * ★**두 종류의 문서가 이 필드를 공유한다. 섞어 다루면 안 된다.**
   *
   * - `paramsPolicy` 가 박힌 문서 — write 화이트리스트를 통과한 것만 들어 있다
   *   (`ledger.ts` 의 `projectParamsForLedger`). 식별자는 그대로, 자유 텍스트는
   *   레드액트본, 나머지는 아예 없다. 화면에 그려도 된다.
   * - `paramsPolicy` 가 **없는 문서** — 정책 이전에 쌓인 **원문**이다. 툴 인자에는
   *   지시문·경로·티켓 본문이 그대로 들어오고 거기 자격증명이 섞일 수 있다.
   *   ★**원장은 불변이라 이 원문은 못 지운다.** 그래서 감사 뷰는 이 문서의 이
   *   필드를 화면에 뿌리지 않는다 — `lib/auditParamsPolicy.ts` 의
   *   `displayableLedgerParams` 를 지나야 화면으로 나간다.
   *
   * ★이 문장은 주석으로만 있던 시절 구현과 갈라져 있었다(티켓
   * yJLfoRpqvCcvarIXcT23). 지금은 테스트가 지킨다:
   * `tests/unit/ledger-params-whitelist.test.ts`,
   * `tests/unit/audit-params-display-guard.test.ts`.
   */
  params: Record<string, unknown>;
  result: string;
  duration: number;
  success: boolean;
  createdAt: Date;

  // ── 원장 확장 필드(ledger.ts §5) ────────────────────────────────
  // 전부 optional 이다. **이 필드들이 생기기 전에 쌓인 문서에는 아예 없다** —
  // `null`(귀속 불가)과 `undefined`(필드 이전 기록)는 다른 사실이고, 감사
  // 뷰가 그 둘을 뭉개지 않으려면 타입에서도 갈라져 있어야 한다.
  /** 이벤트 분류. 옛 문서엔 없다 — 없으면 `action` 으로 읽는다. */
  kind?: AuditLogKind;
  /** 이 에이전트를 발주한 **사람**의 uid. 감사 뷰의 구성원 축이 이것이다. */
  actorUid?: string | null;
  /** 에이전트가 돌고 있던 모델(claude/codex/grok/…). */
  model?: string | null;
  /** 모델 티어(스폰 시 complexity: simple/standard/complex). */
  tier?: string | null;
  /** 지시문 **해시만**. 원문은 원장에 없다 — 뷰가 원문을 추측하지 않는다. */
  instructionHash?: string | null;
  /** scrub+truncate 된 표시용 지시문. 마스킹 안전 검증 실패 시 null/부재. */
  instructionRedacted?: string | null;
  /** 이 행위가 속한 티켓. */
  taskId?: string | null;
  /** `<projectId>/<taskId>` — 워크트리 경로에서 파생. 규약 밖이면 null. */
  worktreeId?: string | null;

  // ── params 노출 정책(ledger.ts) ──
  /**
   * `params` 가 어느 화이트리스트로 걸러졌는가. ★**없으면 옛 원문 문서다** —
   * `undefined`(정책 이전)와 값이 있는 것은 다른 사실이고, 뷰가 그 둘을 뭉개면
   * 원문이 화면으로 샌다. 판별은 `ledgerParamsAreScrubbed` 하나로만 한다.
   */
  paramsPolicy?: string;
  /** 화이트리스트에서 떨어진 최상위 키 **이름**들. 값은 담기지 않는다. */
  paramsOmitted?: string[];
  /** 인자 **원본** 전체의 해시. 원문 대조용 — instructionHash 와 같은 취지. */
  paramsHash?: string | null;

  // ── 체인(ledger.ts §6) — L3 가 채운다 ──
  seq?: number;
  prevHash?: string;
  hash?: string;
}
