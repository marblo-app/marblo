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
   * 툴 인자 원문.
   *
   * ★감사 뷰는 이 필드를 **화면에 뿌리지 않는다.** 툴 인자에는 지시문·경로·
   * 티켓 본문이 그대로 들어오고 거기 자격증명이 섞일 수 있는데, 원장은 불변이라
   * 한번 들어간 것은 못 지운다. 원장이 지시문을 해시로만 담는 것과 같은 취지.
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
  /** 이 행위가 속한 티켓. */
  taskId?: string | null;
  /** `<projectId>/<taskId>` — 워크트리 경로에서 파생. 규약 밖이면 null. */
  worktreeId?: string | null;

  // ── 체인(ledger.ts §6) — L3 가 채운다 ──
  seq?: number;
  prevHash?: string;
  hash?: string;
}
