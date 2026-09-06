/**
 * 감사 원장(ledger) L1 — 로컬 스풀 + 재시도 + 순서 보존 재적재.
 *
 * 설계 권위: docs/superpowers/specs/2026-07-19-team-governance-audit-ledger-design.md
 * (§7 조용한 유실 · §11 실패 모드 · §9 구현 순서)
 *
 * ## 이 파일이 존재하는 이유
 *
 * L0 이전의 `auditLog()` 는 이랬다:
 *
 *     addDoc(collection(db, "audit_logs"), {...})
 *       .catch(err => console.error("[Audit] Failed to write audit log:", err));
 *
 * 감사 기록 실패가 콘솔 한 줄로 삼켜진다. 활동 피드용으로는 괜찮지만 규제 원장으로는
 * 치명적이다 — 네트워크가 끊긴 30분 동안의 에이전트 행위가 흔적 없이 사라지고 그
 * 공백을 설명할 방법이 없다.
 *
 * ★목표를 한 문장으로: **"기록이 없다"와 "일어나지 않았다"를 구분할 수 있게 만드는
 * 것.** 이 파일의 모든 설계 판단이 이 한 문장에서 나온다. 유실 자체보다 유실을
 * 몰랐다는 게 감사에서 더 나쁘다.
 *
 * ## 순서 보존의 단위 — L3(체인)와의 정합
 *
 * 스풀은 **프로세스당 하나**이고 프로세스 내 **전역 순서(total order)** 를 보장한다.
 * L3 의 해시 체인 단위는 `(projectId, agentId)`(§6)인데, 한 프로세스가 여러
 * projectId 의 이벤트를 낼 수 있으므로(cross-project-create 계열 툴) 둘은 동치가
 * 아니라 **포함** 관계다: 프로세스 전역 순서가 보존되면 그 부분열인 각
 * `(projectId, agentId)` 체인의 순서도 자동으로 보존된다.
 *
 * → 스풀 순서는 체인 seq 의 **상위 보장**이다. L3 는 `seq` 를 **enqueue 시점**에
 * 매기기만 하면 된다. write 시점에 매기면 안 된다 — 스풀은 30분 뒤에 재적재될 수
 * 있어서 write 순서 ≠ 발생 순서다. `enqueue()` 가 이 프로세스의 단일 직렬화
 * 지점이고, 에이전트당 MCP 서버가 하나라 경합이 없다(§6). 스풀과 체인이 같은
 * 성질에서 나온 것이지 우연이 아니다.
 *
 * ## 비차단 성질 (요구사항)
 *
 * `enqueue()` 는 **동기**이고 아무것도 await 하지 않는다. 호출부(auditLog)는 여전히
 * fire-and-forget 이고 MCP 툴 호출을 막지 않는다. 정상 경로에서는 디스크를 아예
 * 건드리지 않는다 — 스풀 파일은 **쓰기가 실패했을 때만** 생긴다(§11 이 규정한 대로
 * 스풀은 실패 경로이지 write-ahead 로그가 아니다).
 *
 * ## ★라이브 실측으로 드러난 것 — 유실 기전이 스펙의 서술과 다르다
 *
 * 스펙 §7 은 "쓰기 실패가 `.catch` 의 console.error 한 줄로 삼켜진다"고 썼다. 실제
 * dist-mcp 번들을 띄워 Firestore 를 권한 거부(오프라인) 상태로 만들고 감사 대상 툴을
 * 호출해 보니 **catch 가 애초에 호출되지 않는다.**
 *
 * Firebase JS SDK 의 쓰기 프로미스는 백엔드 ack 까지 기다린다. 백엔드에 닿지
 * 못하면 SDK 는 오프라인 모드로 내려가 쓰기를 자기 큐에 쌓고 **프로미스는 영원히
 * settle 하지 않는다** — resolve 도 reject 도 안 한다. 실측:
 *
 *     PERMISSION_DENIED: Permission denied on resource project ...
 *     The client will operate in offline mode until it is able to connect.
 *     → setDoc 프로미스 미settle, [Audit] catch 0회, 에러 로그 0줄
 *
 * 그래서 기존 코드의 실패 모드는 "에러가 로그 한 줄로 삼켜진다"가 아니라 **"에러가
 * 아예 발생하지 않는다"** 였다. 콘솔이 조용한 게 정상이라서가 아니라 실패를 관측할
 * 지점이 없어서다. 게다가 이 MCP 서버는 Node 프로세스라 Firestore 캐시가
 * **메모리**다 — 프로세스가 죽으면 그 큐는 통째로 사라진다. §7 의 "네트워크 30분
 * 단절" 시나리오에서 기존 코드는 흔적을 하나도 남기지 못했다.
 *
 * → 그래서 sink 성공 판정에 **시간 상한**이 필수다(`requireServerAck`). 상한 안에
 * 백엔드가 확인하지 않으면 실패로 취급해 스풀에 남긴다. 상한이 없으면 배수 루프가
 * 첫 레코드에서 영원히 멈추고, 그게 정확히 기존 코드의 조용한 유실이다.
 *
 * 이때 SDK 큐에도 같은 쓰기가 남아 나중에 flush 될 수 있는데, 문서 id 가 로컬에서
 * 1회 생성돼 재시도마다 재사용되므로(SpoolRecord.id + setDoc) **SDK 의 뒤늦은
 * flush 와 우리의 재적재가 같은 문서를 가리켜 중복이 생기지 않는다.** 멱등 id
 * 결정이 여기서 값을 한다.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { sealLedgerParams, type LedgerEventWrite } from "./ledger.js";
import type { ChainFields } from "./ledger-chain.js";

// ── 파일 포맷 ────────────────────────────────────────────────────

export const SPOOL_FILE_VERSION = 1;

/**
 * 스풀이 나르는 이벤트. L3 가 봉인하면 체인 필드가 붙는다.
 *
 * `Partial` 인 이유: 봉인기가 주입되지 않은 경로(테스트·L3 이전 기동)에서도 스풀은
 * 그대로 돌아야 한다. 체인 필드의 **부재**가 곧 "이 기록은 무결성 미보증"이라는
 * 뜻이고(§10), 그 구분은 필드 존재 여부로 읽힌다.
 */
export type SpoolEvent = LedgerEventWrite & Partial<ChainFields>;

/**
 * 이벤트를 체인에 봉인한다(L3). 스풀은 **봉인 방식을 모른다** — 주입만 받는다.
 *
 * `seq`/`prevHash` 가 주어지면 **자리를 옮기지 않고 다시 봉인**하라는 뜻이다.
 * 스풀의 메타 마커는 큐에 있는 동안 내용이 갱신되는데(유실 구간이 넓어지면
 * 카운트가 커진다), 그때 해시를 다시 계산하지 않으면 저장 내용과 해시가 어긋나
 * 멀쩡한 마커가 변조로 보고된다.
 */
export type SpoolSeal = (
  event: SpoolEvent,
  meta: {
    id: string;
    occurredAtMs: number;
    seq?: number;
    prevHash?: string;
  },
) => SpoolEvent;

/**
 * 스풀에 담기는 한 건.
 *
 * `id` 는 **로컬에서 1회 생성**해 재시도마다 재사용한다. Firestore 쓰기는
 * `addDoc`(자동 id) 이 아니라 이 id 로 `setDoc` 하므로, ack 만 유실되고 실제로는
 * 성공했던 쓰기를 재시도해도 **중복 문서가 생기지 않는다**. 원장에서 같은 사건이 두
 * 건으로 보이면 그 자체가 감사 증거의 오염이다.
 *
 * `occurredAtMs` 는 **발생 시각**이지 적재 시각이 아니다. 30분 뒤에 재적재되는
 * 레코드에 재적재 시각을 찍으면 원장이 "그때 일어난 일"을 "지금 일어난 일"로
 * 기록하게 된다.
 */
export interface SpoolRecord {
  id: string;
  occurredAtMs: number;
  event: SpoolEvent;
}

/**
 * 재시도로도 원장에 넣지 못한 채 큐에서 내린 한 건.
 *
 * ★이건 "실패"도 "성공"도 아닌 **세 번째 상태**다. 이 상태를 만들지 않으면 둘 중
 * 하나로 반올림해야 하는데 양쪽 다 거짓말이 된다: 성공으로 치면 조용한 유실이고,
 * 실패로 두고 재시도를 계속하면 큐 머리가 막혀 뒤따르는 **모든** 감사 이벤트가
 * 함께 멈춘다(L1.6 회귀가 정확히 이것이었다).
 */
export interface UnresolvedRecord {
  rec: SpoolRecord;
  /** 마지막 실패 사유. */
  reason: string;
  /**
   * 원장에 이미 있는지 확인을 시도한 결과.
   *  - `false`: 확인했고 없었다 → 진짜 유실
   *  - `null` : 확인 자체가 불가능했다(읽기 권한 없음 등) → 유실 여부 미상
   * `true`(이미 있음)는 성공 처리되므로 여기 남지 않는다.
   */
  verified: false | null;
  parkedAtMs: number;
}

interface SpoolFileShape {
  version: number;
  /** 이 스풀을 쓴 프로세스의 정체(에이전트 id). 진단용. */
  agentId: string;
  records: SpoolRecord[];
  /**
   * 재시도를 포기하고 큐에서 내린 것들. 재기동해도 큐로 되돌리지 않는다 — 되돌리면
   * 같은 이유로 다시 막힌다. 지우지도 않는다: 증거이기 때문이다.
   */
  unresolved?: UnresolvedRecord[];
}

// ── 상한 (§11) ───────────────────────────────────────────────────

/** 스풀 파일 크기 상한. 넘으면 오래된 것부터 버리되 tombstone 을 남긴다. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** 건수 상한. 바이트 상한과 OR 로 걸린다(작은 레코드가 무한히 쌓이는 것도 막는다). */
export const DEFAULT_MAX_RECORDS = 5000;

/** 오버플로 tombstone 을 식별하는 toolName. 감사 뷰(L4)가 이걸로 공백을 표시한다. */
export const SPOOL_OVERFLOW_TOOL = "ledger:spool_overflow";

/**
 * 재시도를 포기한 레코드를 원장에 알리는 마커의 toolName.
 *
 * 오버플로 tombstone 과 같은 철학이다 — 공백의 존재 자체는 **원장 안에** 남아야
 * 한다. 로컬 상태 툴에만 남기면 그 프로세스가 죽는 순간 공백이 있었다는 사실까지
 * 함께 사라지고, 그게 이 서브시스템이 없애려는 조용한 유실이다.
 */
export const SPOOL_UNRESOLVED_TOOL = "ledger:spool_unresolved";

/**
 * 재시도 백오프. 마지막 값이 이후 모든 시도의 상한이 된다.
 *
 * 네트워크 단절은 분 단위로 이어지므로 초 단위 폭주 재시도는 배터리만 태운다.
 * 반대로 너무 길면 복구 감지가 늦다 — 1s 부터 시작해 1분에서 멈춘다.
 */
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];

// ── 상태 조회 (L2 라이브 검증이 직접 쓴다) ───────────────────────

export interface SpoolStatus {
  /** 아직 원장에 못 들어간 건수. 0 이면 지금 이 순간 밀린 것이 없다. */
  pending: number;
  /** 대기 중 가장 오래된 이벤트의 발생 시각. 큐가 비었으면 null. */
  oldestPendingAtMs: number | null;
  /** 지금 이 순간 밀린 것이 있는가(= degraded). */
  degraded: boolean;
  /**
   * ★프로세스 기동 이후 **한 번이라도** 쓰기가 실패했는가.
   *
   * `degraded` 와 따로 두는 이유: 순간 실패 후 회복하면 큐는 즉시 비지만, 그
   * 흔적까지 지우면 "실패가 있었나"를 물었을 때 조용한 유실과 구분할 수 없게 된다.
   * 이 필드와 아래 카운터들은 프로세스 생애 내내 초기화되지 않는다.
   */
  everDegraded: boolean;
  /** 마지막 실패 사유. 없으면 null — "모른다"를 "괜찮다"로 답하지 않는다. */
  lastError: string | null;
  lastErrorAtMs: number | null;
  /** 기동 이후 누적 쓰기 실패 횟수(재시도 각각을 1 로 센다). */
  failureCount: number;
  /** 마지막으로 원장 적재에 성공한 시각. */
  lastSuccessAtMs: number | null;
  /** 기동 이후 원장에 적재된 건수. */
  writtenCount: number;
  /** ★상한 초과로 버려진 누적 건수. 0 이 아니면 원장에 공백이 있다는 뜻. */
  droppedCount: number;
  /** 버려진 구간. droppedCount 가 0 이면 null. */
  droppedFromMs: number | null;
  droppedToMs: number | null;
  /**
   * ★재시도로 풀리지 않아 큐에서 내린 건수(pending 과 별개).
   *
   * 0 이 아니면 원장에 공백이 있거나, 최소한 **있는지 없는지 확인하지 못했다**는
   * 뜻이다. pending 에 합산하지 않는 이유: pending 은 "곧 들어갈 것"이고 이건
   * "재시도로는 안 들어갈 것"이라 사람이 취할 조치가 다르다.
   */
  unresolvedCount: number;
  /** 그중 확인 결과 원장에 **없다고 확정된** 건수(진짜 유실). */
  unresolvedConfirmedMissing: number;
  /** 그중 유실 여부를 **확인하지 못한** 건수(읽기 권한 없음 등). */
  unresolvedUnknown: number;
  /** 미해결 중 가장 오래된 것의 발생 시각. 없으면 null. */
  unresolvedOldestAtMs: number | null;
  /**
   * ★공백을 알리는 마커조차 원장에 쓰지 못한 횟수.
   *
   * 0 이 아니면 unresolvedCount 보다 나쁜 상태다 — 공백이 있었다는 사실이 이
   * 프로세스의 메모리·디스크에만 있고 원장에는 없다는 뜻이다.
   */
  unwrittenMarkerCount: number;
  /**
   * 쓰기는 실패했지만 확인해 보니 원장에 이미 있어서 성공 처리한 건수.
   * = ack 만 유실됐던 쓰기. 0 이 아니면 ack 유실이 실제로 일어나고 있다는 신호다.
   */
  ackRecoveredCount: number;
  /** 다음 재시도 예정 시각. 재시도 대기 중이 아니면 null. */
  nextRetryAtMs: number | null;
  spoolPath: string;
  maxBytes: number;
  maxRecords: number;
  /** 현재 큐의 직렬화 바이트 합(상한 대비 얼마나 찼는가). */
  queuedBytes: number;
}

export interface LedgerSpoolOptions {
  /** 스풀 파일이 놓일 디렉터리. */
  dir: string;
  /** 이 프로세스의 에이전트 id. 스풀 파일명이 된다. */
  agentId: string;
  /** 원장 적재기. 성공하면 resolve, 실패하면 reject. */
  sink: (record: SpoolRecord) => Promise<void>;
  maxBytes?: number;
  maxRecords?: number;
  now?: () => number;
  newId?: () => string;
  /**
   * 재시도 예약기. 기본은 `setTimeout` + `unref()` — 스풀 재시도가 프로세스 종료를
   * 붙잡지 않게 한다. 테스트는 여기에 수동 트리거를 꽂는다.
   */
  schedule?: (fn: () => void, ms: number) => void;
  /** 사람이 봐야 하는 사건(오버플로 등)을 알린다. */
  onNotice?: (notice: SpoolNotice) => void;
  /**
   * 이 실패가 **재시도로 풀릴 수 있는 종류인지** 판정한다. `true` 면 백오프
   * 재시도를 하지 않는다.
   *
   * ★권한 거부는 백오프로 회복되지 않는다. 재시도하면 같은 답이 영원히 돌아오고
   * 큐 머리가 막혀 뒤의 모든 이벤트가 함께 멈춘다 — L1.6 회귀의 기전이 정확히
   * 이것이었다(1s/2s/4s/9s/24s 마다 PERMISSION_DENIED, pending=1 영구 고착).
   * 반면 네트워크 단절·ack 타임아웃은 시간이 지나면 풀리므로 재시도가 맞다.
   *
   * 기본값은 "전부 재시도 가능" — Firestore 에러 코드 지식은 이 파일이 아니라
   * 주입하는 쪽(tools.ts)에 둔다. 이 파일은 firebase 를 import 하지 않는다.
   */
  isTerminal?: (err: unknown) => boolean;
  /**
   * 터미널 실패를 만났을 때 **그 레코드가 사실은 이미 원장에 있는지** 최선 노력으로
   * 확인한다.
   *
   *  - `true`  → 이미 있다. 우리 쓰기는 사실 성공했고 ack 만 유실됐다 → 성공 처리
   *  - `false` → 없다. 진짜 유실
   *  - `null`  → 확인할 수 없었다(읽기 권한 없음 등)
   *
   * ★`null` 을 반드시 별도로 다뤄야 한다. L2 가 audit_logs read 를
   * isProjectMember() 로 조이면 이 확인은 **정상적으로** 불가능해지고, 특히
   * 오버플로 tombstone 은 projectId 가 "" 라 영원히 확인 불가다. 확인 불가를
   * `false`(유실)로 반올림하면 멀쩡한 기록을 유실로 보고하고, `true`(성공)로
   * 반올림하면 진짜 유실을 숨긴다. 모르는 건 모른다고 남긴다.
   */
  verify?: (rec: SpoolRecord, err: unknown) => Promise<boolean | null>;
  /**
   * L3 체인 봉인기. 주입되면 `enqueue()` 가 **동기적으로** 이벤트를 봉인한다.
   *
   * ★봉인 지점이 여기여야 하는 이유(§6, 파일 상단 "L3 와의 정합"): 스풀은 30분 뒤에
   * 재적재될 수 있어 **write 순서 ≠ 발생 순서**다. sink 에서 봉인하면 오프라인
   * 구간의 이벤트가 복구 시점 순서로 seq 를 받아 원장이 발생 순서를 잃는다.
   * `enqueue()` 는 이 프로세스의 단일 직렬화 지점이므로 여기가 유일하게 맞는 자리다.
   *
   * 부수 효과로 **멱등 재시도가 유지된다**: 봉인이 1회로 끝나 재시도 페이로드가
   * 결정적으로 동일하고, 그래서 룰의 `request.resource.data == resource.data` 를
   * 그대로 통과한다. sink 에서 봉인했다면 재시도마다 해시가 달라져 update 가
   * 거부되고 큐가 고착됐을 것이다(L1.6 회귀).
   */
  seal?: SpoolSeal;
}

export interface SpoolNotice {
  kind: "overflow" | "write-failed" | "recovered" | "unresolved";
  message: string;
  atMs: number;
}

/**
 * 파일명에 쓸 수 있게 에이전트 id 를 정리한다. 경로 조각(`/`, `..`)이 섞여 들어와
 * 스풀이 엉뚱한 곳에 쓰이는 것을 막는다.
 */
export function spoolFileName(agentId: string): string {
  const cleaned = (agentId || "").replace(/[^A-Za-z0-9_.-]/g, "_");
  // 빈 값·점만 있는 값은 파일명으로 위험하므로 명시적 표식으로 바꾼다. 추측해서
  // 그럴듯한 id 를 지어내지 않는다 — 귀속 불명은 불명으로 남긴다.
  const safe = /^[A-Za-z0-9_-]/.test(cleaned)
    ? cleaned.slice(0, 120)
    : "unknown";
  return `${safe}.spool.json`;
}

/**
 * 서버 ack 대기 상한. 이 시간 안에 백엔드가 쓰기를 확인하지 않으면 **실패로
 * 취급**한다(스풀에 남긴다).
 *
 * 배수는 백그라운드라 이 대기가 툴 호출을 막지 않는다. 너무 짧으면 느린 회선에서
 * 멀쩡한 쓰기를 실패로 오판하고(스풀이 계속 부풀고), 너무 길면 단절 감지가 늦다.
 * 15초는 Firestore gRPC 재연결 시도 주기보다 넉넉하되 사람이 상태를 물었을 때
 * 답이 바뀌어 있을 만한 크기다.
 */
export const ACK_TIMEOUT_MS = 15_000;

/**
 * 쓰기 전체에 **시간 상한**을 씌운다. 상한 안에 끝나지 않으면 실패로 판정한다.
 *
 * ★이게 없으면 배수 루프가 첫 레코드에서 영원히 멈춘다 — 라이브에서 실제로 그랬다.
 * Firestore 쓰기 프로미스는 오프라인일 때 resolve 도 reject 도 하지 않으므로
 * (파일 상단 "라이브 실측" 참조), `await` 만으로는 실패를 **영원히 관측할 수 없다.**
 * 상한을 쓰기 프로미스 바깥에 두는 것이 요점이다: ack 확인만 감싸면 그 앞의
 * `setDoc` 에서 이미 매달려 여기까지 오지도 못한다.
 *
 * 판정은 의도적으로 **보수적**이다. 상한 초과를 실패로 보면 실제로는 나중에 성공한
 * 쓰기를 스풀에 중복 보관할 수 있지만, 문서 id 가 멱등이라 재적재해도 같은 문서다.
 * 반대 방향(실패를 성공으로 오인)은 원장에 공백을 남기고 아무도 모르게 만든다 —
 * 감사 원장에서 틀려도 되는 방향은 이쪽뿐이다.
 */
export async function requireServerAck(
  write: () => Promise<void>,
  timeoutMs: number = ACK_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      write(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `서버 ack 없음 — ${timeoutMs}ms 안에 Firestore 백엔드가 쓰기를 ` +
                  `확인하지 않았습니다(오프라인 또는 권한 거부 가능). ` +
                  `오프라인일 때 SDK 의 쓰기 프로미스는 resolve 도 reject 도 하지 ` +
                  `않으므로, 이 상한이 없으면 실패를 영원히 관측할 수 없습니다.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 스풀 디렉터리. 테스트·격리 실행을 위해 env 로 덮어쓸 수 있다. */
export function defaultSpoolDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const override = env.MARBLO_LEDGER_SPOOL_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(homeDir, ".marblo", "ledger-spool");
}

const byteLen = (rec: SpoolRecord): number =>
  Buffer.byteLength(JSON.stringify(rec), "utf8");

interface Entry {
  rec: SpoolRecord;
  size: number;
  /**
   * 스풀이 스스로 만든 메타 레코드(오버플로 tombstone · 미해결 마커)인가.
   *
   * 두 가지를 뜻한다: ①드롭 대상에서 제외된다 — 유실 기록이 유실되면 전체가
   * 무의미하다 ②이 레코드가 park 되어도 **새 마커를 만들지 않는다** — 마커의
   * 마커를 만들면 큐가 무한히 자란다.
   */
  tombstone: boolean;
}

const isOverflowMarker = (e: Entry): boolean =>
  e.rec.event?.toolName === SPOOL_OVERFLOW_TOOL;
const isUnresolvedMarker = (e: Entry): boolean =>
  e.rec.event?.toolName === SPOOL_UNRESOLVED_TOOL;

/**
 * 로컬 스풀.
 *
 * 큐 하나 + 소비자 하나. `enqueue()` 는 동기이고, 배수(drain)는 백그라운드에서
 * **한 건씩 순서대로** 진행한다. 한 건이 실패하면 그 자리에서 멈추고 백오프
 * 재시도하므로, 뒤 이벤트가 앞 이벤트를 추월하는 일이 구조적으로 불가능하다.
 *
 * ★"한 번 degraded 면 전부 큐로" 가 자동으로 성립한다: 모든 이벤트가 예외 없이 같은
 * 큐를 지나기 때문이다. 정상일 때 직행하고 실패할 때만 큐에 넣는 설계였다면 A 가
 * 실패해 스풀에 들어간 사이 B 가 직행해 순서가 깨졌을 것이다.
 */
export class LedgerSpool {
  private readonly opts: Required<
    Omit<LedgerSpoolOptions, "onNotice" | "verify" | "seal">
  > & {
    onNotice?: (n: SpoolNotice) => void;
    verify?: (rec: SpoolRecord, err: unknown) => Promise<boolean | null>;
    seal?: SpoolSeal;
  };
  private readonly queue: Entry[] = [];
  private queuedBytes = 0;
  private draining = false;
  private retryTimerArmed = false;
  private attempt = 0;
  private settledWaiters: Array<() => void> = [];

  // 프로세스 생애 내내 유지되는 관측값 — degraded 를 벗어나도 지우지 않는다.
  private everDegraded = false;
  private lastError: string | null = null;
  private lastErrorAtMs: number | null = null;
  private failureCount = 0;
  private lastSuccessAtMs: number | null = null;
  private writtenCount = 0;
  private droppedCount = 0;
  private droppedFromMs: number | null = null;
  private droppedToMs: number | null = null;
  private nextRetryAtMs: number | null = null;
  /** 재시도를 포기하고 큐에서 내린 것들. 큐로 되돌리지 않고, 지우지도 않는다. */
  private unresolved: UnresolvedRecord[] = [];
  private ackRecoveredCount = 0;
  private unwrittenMarkerCount = 0;

  constructor(options: LedgerSpoolOptions) {
    this.opts = {
      dir: options.dir,
      agentId: options.agentId,
      sink: options.sink,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      maxRecords: options.maxRecords ?? DEFAULT_MAX_RECORDS,
      now: options.now ?? (() => Date.now()),
      newId: options.newId ?? (() => randomUUID()),
      schedule:
        options.schedule ??
        ((fn, ms) => {
          const t = setTimeout(fn, ms);
          // 스풀 재시도 타이머가 MCP 서버 종료를 붙잡으면 안 된다.
          (t as unknown as { unref?: () => void }).unref?.();
        }),
      isTerminal: options.isTerminal ?? (() => false),
      onNotice: options.onNotice,
      verify: options.verify,
      seal: options.seal,
    };
  }

  /**
   * 봉인기가 있으면 봉인하고, 없으면 그대로 둔다.
   *
   * 봉인 실패가 감사 이벤트를 삼키면 안 된다 — 체인이 없는 기록은 "무결성 미보증"
   * 이지만, 기록이 아예 없는 것은 조용한 유실이다. 후자가 훨씬 나쁘므로 봉인이
   * 터지면 미봉인 상태로라도 큐에 넣고 그 사실을 남긴다.
   */
  private sealEvent(
    event: SpoolEvent,
    meta: { id: string; occurredAtMs: number; seq?: number; prevHash?: string },
  ): SpoolEvent {
    if (!this.opts.seal) return event;
    try {
      return this.opts.seal(event, meta);
    } catch (err) {
      console.error(
        `[Audit] ★체인 봉인 실패 — 이 이벤트는 무결성 미보증으로 원장에 ` +
          `들어갑니다(기록을 버리지는 않습니다): ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
      return event;
    }
  }

  /**
   * 큐에 있는 레코드의 내용을 갈아끼우고 **같은 자리에서** 다시 봉인한다.
   *
   * 봉인 전(체인 필드 없음)이면 새 자리를 받는다 — 봉인기가 없는 구성에서는
   * sealEvent 가 그대로 통과시키므로 결과적으로 아무 일도 일어나지 않는다.
   */
  private resealInPlace(rec: SpoolRecord, next: SpoolEvent): SpoolEvent {
    return this.sealEvent(next, {
      id: rec.id,
      occurredAtMs: rec.occurredAtMs,
      seq: rec.event.seq,
      prevHash: rec.event.prevHash,
    });
  }

  get spoolPath(): string {
    return path.join(this.opts.dir, spoolFileName(this.opts.agentId));
  }

  /**
   * 이벤트 한 건을 원장 적재 대기열에 넣는다. **동기이고 아무것도 기다리지 않는다.**
   *
   * 반환하는 id 는 Firestore 문서 id 이기도 하다(재시도 멱등).
   */
  enqueue(event: SpoolEvent, occurredAtMs?: number): string {
    const id = this.opts.newId();
    const at = occurredAtMs ?? this.opts.now();
    // ★봉인은 여기서 1회. id 와 발생 시각이 확정된 뒤여야 둘 다 해시에 들어가
    // 문서 갈아끼우기·시각 조작이 탐지된다.
    const rec: SpoolRecord = {
      id,
      occurredAtMs: at,
      event: this.sealEvent(event, { id, occurredAtMs: at }),
    };
    this.push({ rec, size: byteLen(rec), tombstone: false });
    void this.drain();
    return rec.id;
  }

  private push(entry: Entry): void {
    this.queue.push(entry);
    this.queuedBytes += entry.size;
    this.enforceCap();
  }

  /**
   * 상한 초과 처리 (§11 "상한 캡 + 초과 시 사용자 알림 — 조용히 버리지 않음").
   *
   * ★여기가 이 티켓의 함정 지점이다. 지속적 실패 → 전부 큐로 → 큐가 상한 도달,
   * 이 경로에서 조용히 버리면 없애려던 조용한 유실이 자리만 옮겨 되살아난다
   * (console.error → 큐 상한). 그래서 **상한에 닿는 순간이 가장 시끄러워야 한다.**
   *
   * 처리:
   *  1. 오래된 것부터 버린다(새 것을 거부하지 않는다 — 최근 행위가 더 조사 가치가
   *     높고, 새 것을 거부하면 "지금 일어나는 일"이 안 보이게 된다)
   *  2. 버린 즉시 큐 **머리에 tombstone 레코드**를 꽂는다. 별도 카운터가 아니라
   *     큐 안의 진짜 원장 레코드다 — 그래서 유실 구간의 올바른 자리에 놓이고,
   *     연결이 복구되는 순간 다른 레코드와 함께 원장에 적재된다. **L1 단계에서 이미
   *     원장에 흔적이 남는다**; L3 의 seq 구멍을 기다리지 않는다
   *  3. tombstone 자체는 절대 드롭 대상이 아니다
   *  4. 연속 오버플로는 새 tombstone 을 쌓지 않고 기존 것의 구간을 넓힌다
   */
  private enforceCap(): void {
    let dropped = 0;
    let fromMs: number | null = null;
    let toMs: number | null = null;

    while (
      this.queuedBytes > this.opts.maxBytes ||
      this.queue.length > this.opts.maxRecords
    ) {
      const idx = this.queue.findIndex((e) => !e.tombstone);
      // tombstone 만 남았다면 더 버릴 것이 없다. 상한을 넘겨서라도 유실 기록은 지킨다.
      if (idx === -1) break;
      const [victim] = this.queue.splice(idx, 1);
      this.queuedBytes -= victim.size;
      dropped += 1;
      if (fromMs === null) fromMs = victim.rec.occurredAtMs;
      toMs = victim.rec.occurredAtMs;
    }

    if (dropped === 0) return;

    this.droppedCount += dropped;
    if (this.droppedFromMs === null) this.droppedFromMs = fromMs;
    this.droppedToMs = toMs;
    this.mergeTombstone(dropped, fromMs, toMs);

    const message =
      `[Audit] ★스풀 상한 초과 — 감사 이벤트 ${dropped}건을 버렸습니다 ` +
      `(누적 ${this.droppedCount}건). 원장에 공백이 생겼고, 그 사실은 ` +
      `${SPOOL_OVERFLOW_TOOL} tombstone 으로 원장에 기록됩니다. ` +
      `spool=${this.spoolPath} lastError=${this.lastError ?? "(없음)"}`;
    // 조용히 버리지 않는다: 콘솔 + 알림 콜백(툴 결과 경고) + 상태 툴 + 원장 tombstone.
    console.error(message);
    this.opts.onNotice?.({
      kind: "overflow",
      message,
      atMs: this.opts.now(),
    });
  }

  /** 머리의 tombstone 을 갱신하거나 새로 꽂는다. */
  private mergeTombstone(
    dropped: number,
    fromMs: number | null,
    toMs: number | null,
  ): void {
    const head = this.queue[0];
    // ★`head.tombstone` 로 판정하면 안 된다 — 미해결 마커도 tombstone=true 라서
    // 오버플로 카운트를 미해결 마커에 덮어써 두 사건이 뒤섞인다. 종류로 판정한다.
    if (head && isOverflowMarker(head)) {
      const p = head.rec.event.params as Record<string, unknown>;
      const prevCount = typeof p.droppedCount === "number" ? p.droppedCount : 0;
      const prevFrom =
        typeof p.firstDroppedAtMs === "number" ? p.firstDroppedAtMs : fromMs;
      this.queuedBytes -= head.size;
      // 내용이 바뀌었으므로 **자리는 그대로 두고** 해시만 다시 계산한다. 아직 원장에
      // 나가지 않은 레코드라 뒤 이벤트가 이 해시를 참조한 적이 없어 안전하다.
      head.rec.event = this.resealInPlace(
        head.rec,
        this.tombstoneEvent(
          prevCount + dropped,
          prevFrom,
          toMs,
          head.rec.event,
        ),
      );
      head.size = byteLen(head.rec);
      this.queuedBytes += head.size;
      return;
    }

    const id = this.opts.newId();
    const at = fromMs ?? this.opts.now();
    const rec: SpoolRecord = {
      id,
      occurredAtMs: at,
      event: this.sealEvent(this.tombstoneEvent(dropped, fromMs, toMs, null), {
        id,
        occurredAtMs: at,
      }),
    };
    const entry: Entry = { rec, size: byteLen(rec), tombstone: true };
    this.queue.unshift(entry);
    this.queuedBytes += entry.size;
  }

  /**
   * 유실 구간을 서술하는 원장 이벤트.
   *
   * `kind: "lifecycle"` — 툴 호출이 아니라 "이 시점에 이 프로세스에 무슨 일이
   * 있었나"를 설명하는 사건이므로 §15 의 lifecycle 에 속한다.
   * `success: false` — 이건 정상 기록이 아니라 실패의 기록이다.
   */
  private tombstoneEvent(
    droppedCount: number,
    firstDroppedAtMs: number | null,
    lastDroppedAtMs: number | null,
    prior: SpoolEvent | null,
  ): LedgerEventWrite {
    return {
      projectId: prior?.projectId ?? "",
      agentId: this.opts.agentId,
      toolName: SPOOL_OVERFLOW_TOOL,
      // 계수만 담기는 자리지만 정책 표식은 똑같이 박는다 — 표식 없는 문서는
      // 뷰가 "정책 이전 원문"으로 보고 통째로 가린다(유실 기록의 유실 재발).
      ...sealLedgerParams({
        droppedCount,
        firstDroppedAtMs,
        lastDroppedAtMs,
        maxBytes: this.opts.maxBytes,
        maxRecords: this.opts.maxRecords,
      }),
      result:
        `감사 이벤트 ${droppedCount}건이 로컬 스풀 상한 초과로 유실되었습니다. ` +
        `이 구간의 에이전트 행위는 원장에 없습니다 — "일어나지 않았다"가 아니라 ` +
        `"기록되지 못했다"입니다.`,
      duration: 0,
      success: false,
      kind: "lifecycle",
      actorUid: prior?.actorUid ?? null,
      model: prior?.model ?? null,
      tier: prior?.tier ?? null,
      instructionHash: null,
      instructionRedacted: null,
      taskId: null,
      worktreeId: prior?.worktreeId ?? null,
    };
  }

  // ── 배수 ───────────────────────────────────────────────────────

  /**
   * 큐를 한 건씩 순서대로 원장에 밀어넣는다. 동시에 하나만 돈다(단일 소비자).
   *
   * 실패 처리가 두 갈래다:
   *  - **재시도 가능**(네트워크 단절, ack 타임아웃): 그 자리에서 멈추고 디스크에
   *    남긴 뒤 백오프 재시도. 순서가 보존된다
   *  - **터미널**(권한 거부 등): 재시도해도 같은 답이라 멈추면 안 된다. 확인 후
   *    성공 처리하거나 park 하고 **다음 레코드로 넘어간다** — 한 건 때문에 원장
   *    전체가 멈추는 것이 L1.6 회귀의 실체였다
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue[0];
        try {
          await this.opts.sink(entry.rec);
        } catch (err) {
          if (!this.opts.isTerminal(err)) {
            this.recordFailure(err);
            await this.persist();
            this.scheduleRetry();
            return;
          }
          this.recordFailure(err);
          if (await this.resolveTerminal(entry, err)) {
            // 이미 원장에 있었다 → 아래 성공 경로를 그대로 탄다.
          } else {
            await this.park(entry, err);
            continue;
          }
        }
        // ack 를 받은 뒤에만 큐에서 뺀다. 이 순서가 "큐가 비었다 = 전부 적재됐다"를
        // 참으로 만들고, 그래서 degraded 탈출에 별도 확인 사이클이 필요 없다.
        this.queue.shift();
        this.queuedBytes -= entry.size;
        this.writtenCount += 1;
        this.lastSuccessAtMs = this.opts.now();
        this.attempt = 0;
        this.nextRetryAtMs = null;
      }
      // 큐가 비었다 → 대기 중인 것은 없다. 단, ★미해결 레코드가 있으면 파일을
      // 지우면 안 된다 — 그 증거는 프로세스보다 오래 살아야 한다.
      if (this.unresolved.length > 0) {
        await this.persist();
      } else {
        await this.clearPersisted();
      }
      if (this.everDegraded && this.lastError !== null) {
        this.opts.onNotice?.({
          kind: "recovered",
          message:
            `[Audit] 스풀 복구 — 밀렸던 감사 이벤트를 모두 적재했습니다.` +
            (this.unresolved.length > 0
              ? ` 단, 원장에 넣지 못한 ${this.unresolved.length}건은 그대로 남아 ` +
                `있습니다 — 대기열이 비었다고 원장이 온전한 것은 아닙니다.`
              : ""),
          atMs: this.opts.now(),
        });
      }
    } finally {
      this.draining = false;
      this.notifySettled();
    }
  }

  /**
   * 터미널 실패를 만났을 때 "우리 쓰기가 사실은 성공했는가"를 판정한다.
   *
   * ★권한 거부는 실패 신호이면서 동시에 **"그 문서가 이미 있다"는 증거일 수 있다** —
   * 룰이 create 는 허용하고 update 는 막으므로, 기존 id 로의 쓰기만 거부된다.
   * 하지만 그렇게 **단정하지는 않는다**: 권한이 진짜로 없어서 거부됐을 수도 있고,
   * L2 가 create 를 조이면 정상 신규 쓰기도 같은 코드로 거부된다. 그래서 추론이
   * 아니라 확인(verify)에 맡기고, 확인이 불가능하면 미상으로 남긴다.
   *
   * @returns true 면 이미 원장에 있으므로 성공 처리해도 된다.
   */
  private async resolveTerminal(entry: Entry, err: unknown): Promise<boolean> {
    const verdict = await this.runVerify(entry.rec, err);
    if (verdict !== true) {
      this.lastVerdict = verdict;
      return false;
    }
    this.ackRecoveredCount += 1;
    console.error(
      `[Audit] 쓰기는 거부됐지만 확인 결과 원장에 이미 있습니다 — ack 만 ` +
        `유실됐던 쓰기입니다. 성공으로 처리합니다(id=${entry.rec.id}).`,
    );
    return true;
  }

  /** verify 실패는 "확인 불가"(null)이지 "유실"(false)이 아니다. */
  private async runVerify(
    rec: SpoolRecord,
    err: unknown,
  ): Promise<boolean | null> {
    if (!this.opts.verify) return null;
    try {
      return await this.opts.verify(rec, err);
    } catch {
      return null;
    }
  }

  /** 직전 resolveTerminal 의 확인 결과. park 가 이어받는다. */
  private lastVerdict: false | null = null;

  /**
   * 재시도로 풀리지 않는 레코드를 큐에서 내린다.
   *
   * 큐에서 내리는 이유는 포기해서가 아니라 **뒤를 막지 않기 위해서다**. 내린 것은
   * 지우지 않고 unresolved 로 디스크에 남기고, 상태·툴 경고·원장 마커 세 곳에
   * 동시에 드러낸다. 조용히 버리는 경로는 만들지 않는다.
   */
  private async park(entry: Entry, err: unknown): Promise<void> {
    this.queue.shift();
    this.queuedBytes -= entry.size;

    const reason = err instanceof Error ? err.message : String(err);
    const verified = this.lastVerdict;
    this.lastVerdict = null;

    // 다음 레코드는 이 레코드의 실패와 무관하다 — 백오프를 새로 시작한다.
    this.attempt = 0;
    this.nextRetryAtMs = null;

    // ★메타 마커(오버플로/미해결)가 park 되는 경우를 감사 이벤트와 같이 세면 안
    // 된다. sink 가 전부 거부하는 상황에서는 마커도 함께 거부되는데, 그걸
    // unresolvedCount 에 합산하면 "감사 이벤트 1건 유실"이 "2건"으로 부풀어
    // 보인다. 대신 **공백 사실조차 원장에 남기지 못했다**는 별도 사실로 센다 —
    // 이건 더 나쁜 상태이지 같은 상태가 아니다.
    if (entry.tombstone) {
      this.unwrittenMarkerCount += 1;
      const msg =
        `[Audit] ★원장 공백을 알리는 마커조차 원장에 쓰지 못했습니다 ` +
        `(누적 ${this.unwrittenMarkerCount}건). 공백이 있었다는 사실이 이 ` +
        `프로세스의 로컬 상태에만 남습니다 — 프로세스가 죽으면 그 사실도 ` +
        `사라집니다. 사유: ${reason}`;
      console.error(msg);
      this.opts.onNotice?.({
        kind: "unresolved",
        message: msg,
        atMs: this.opts.now(),
      });
      await this.persist();
      return;
    }

    this.unresolved.push({
      rec: entry.rec,
      reason,
      verified,
      parkedAtMs: this.opts.now(),
    });
    this.mergeUnresolvedMarker(entry.rec, verified);

    const message =
      `[Audit] ★감사 이벤트 1건을 원장에 넣지 못한 채 대기열에서 내렸습니다 ` +
      `(누적 ${this.unresolved.length}건). ${
        verified === false
          ? "확인 결과 원장에 없습니다 — 진짜 유실입니다."
          : "원장에 있는지 확인하지 못했습니다 — 유실 여부 미상입니다."
      } 재시도해도 같은 이유로 거부되므로 뒤따르는 이벤트를 막지 않기 위해 ` +
      `내렸습니다. id=${entry.rec.id} 사유: ${reason}`;
    console.error(message);
    this.opts.onNotice?.({
      kind: "unresolved",
      message,
      atMs: this.opts.now(),
    });

    await this.persist();
  }

  /**
   * 미해결 마커를 큐 **머리**에 꽂거나 기존 것을 갱신한다.
   *
   * 머리인 이유는 오버플로 tombstone 과 같다 — 공백이 생긴 자리가 바로 여기이기
   * 때문이다. 마커는 새 id 라 create 로 통과하므로, 원장에 넣지 못한 레코드가
   * 있었다는 사실 자체는 원장에 남는다.
   */
  private mergeUnresolvedMarker(
    parked: SpoolRecord,
    verified: false | null,
  ): void {
    const head = this.queue[0];
    if (head && isUnresolvedMarker(head)) {
      const p = head.rec.event.params as Record<string, unknown>;
      const prev =
        typeof p.unresolvedCount === "number" ? p.unresolvedCount : 0;
      const prevFrom =
        typeof p.firstUnresolvedAtMs === "number"
          ? p.firstUnresolvedAtMs
          : parked.occurredAtMs;
      this.queuedBytes -= head.size;
      head.rec.event = this.resealInPlace(
        head.rec,
        this.unresolvedEvent(
          prev + 1,
          prevFrom,
          parked.occurredAtMs,
          verified,
          head.rec.event,
        ),
      );
      head.size = byteLen(head.rec);
      this.queuedBytes += head.size;
      return;
    }

    const id = this.opts.newId();
    const rec: SpoolRecord = {
      id,
      occurredAtMs: parked.occurredAtMs,
      event: this.sealEvent(
        this.unresolvedEvent(
          1,
          parked.occurredAtMs,
          parked.occurredAtMs,
          verified,
          parked.event,
        ),
        { id, occurredAtMs: parked.occurredAtMs },
      ),
    };
    const entry: Entry = { rec, size: byteLen(rec), tombstone: true };
    this.queue.unshift(entry);
    this.queuedBytes += entry.size;
  }

  private unresolvedEvent(
    unresolvedCount: number,
    firstUnresolvedAtMs: number | null,
    lastUnresolvedAtMs: number | null,
    verified: false | null,
    prior: SpoolEvent | null,
  ): LedgerEventWrite {
    return {
      projectId: prior?.projectId ?? "",
      agentId: this.opts.agentId,
      toolName: SPOOL_UNRESOLVED_TOOL,
      ...sealLedgerParams({
        unresolvedCount,
        firstUnresolvedAtMs,
        lastUnresolvedAtMs,
        // 확인해서 없었던 것과 확인 자체를 못한 것은 조사 시 취할 조치가 다르다.
        confirmedMissing: verified === false,
      }),
      result:
        `감사 이벤트 ${unresolvedCount}건을 원장에 적재하지 못했습니다` +
        (verified === false
          ? " (확인 결과 원장에 없음 — 진짜 유실)."
          : " (원장에 있는지 확인 불가 — 유실 여부 미상).") +
        ` 이 구간의 에이전트 행위는 "일어나지 않았다"가 아니라 ` +
        `"기록되지 못했거나, 기록 여부를 확인할 수 없다"입니다.`,
      duration: 0,
      success: false,
      kind: "lifecycle",
      actorUid: prior?.actorUid ?? null,
      model: prior?.model ?? null,
      tier: prior?.tier ?? null,
      instructionHash: null,
      instructionRedacted: null,
      taskId: null,
      worktreeId: prior?.worktreeId ?? null,
    };
  }

  private recordFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.everDegraded = true;
    this.lastError = message;
    this.lastErrorAtMs = this.opts.now();
    this.failureCount += 1;
    // 첫 실패만 콘솔에 남긴다. 재시도마다 찍으면 로그가 실패로 도배돼 정작 다른
    // 신호가 묻힌다 — 지속 상태는 상태 툴과 툴 결과 경고가 보고한다.
    if (this.failureCount === 1) {
      console.error(
        `[Audit] 원장 쓰기 실패 — 로컬 스풀로 전환합니다. ` +
          `pending=${this.queue.length} spool=${this.spoolPath} 사유: ${message}`,
      );
      this.opts.onNotice?.({
        kind: "write-failed",
        message: `[Audit] 원장 쓰기 실패 — 로컬 스풀에 보관 중입니다: ${message}`,
        atMs: this.lastErrorAtMs,
      });
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimerArmed) return;
    const delay =
      RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.retryTimerArmed = true;
    this.nextRetryAtMs = this.opts.now() + delay;
    this.opts.schedule(() => {
      this.retryTimerArmed = false;
      void this.drain();
    }, delay);
  }

  // ── 디스크 ─────────────────────────────────────────────────────

  /**
   * 큐 전체를 스풀 파일에 기록한다. 임시 파일 + rename 이라 중간에 죽어도 파일은
   * 항상 온전한 이전 상태이거나 온전한 새 상태다(반쯤 쓰인 스풀은 없다).
   *
   * 파일이 큐 전체의 거울이므로 순서 보존이 자명하다 — append 후 부분 삭제를
   * 관리하는 것보다 추론할 것이 적다.
   */
  private async persist(): Promise<void> {
    const payload: SpoolFileShape = {
      version: SPOOL_FILE_VERSION,
      agentId: this.opts.agentId,
      records: this.queue.map((e) => e.rec),
      // 미해결분은 큐와 **분리해서** 남긴다. 같은 배열에 섞으면 재기동 때 다시
      // 큐로 올라가 같은 이유로 또 막힌다.
      ...(this.unresolved.length > 0 ? { unresolved: this.unresolved } : {}),
    };
    const tmp = `${this.spoolPath}.${process.pid}.tmp`;
    try {
      await fs.mkdir(this.opts.dir, { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(payload), "utf8");
      await fs.rename(tmp, this.spoolPath);
    } catch (err) {
      // 디스크에도 못 쓰면 남는 건 메모리 큐뿐이다. 이 사실을 숨기지 않는다.
      console.error(
        `[Audit] ★스풀 디스크 기록 실패 — 프로세스가 죽으면 대기 중인 ` +
          `${this.queue.length}건이 유실됩니다: ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  private async clearPersisted(): Promise<void> {
    await fs.rm(this.spoolPath, { force: true }).catch(() => {});
  }

  /**
   * 프로세스 기동 시 디스크에 남아 있던 스풀을 큐 **앞쪽**에 복원한다.
   *
   * 앞쪽인 이유: 디스크에 있던 건 이번 기동보다 먼저 일어난 일이다. 뒤에 붙이면
   * 재적재 순서가 발생 순서와 어긋나고, 그러면 L3 가 enqueue 순서로 매길 seq 가
   * 실제 시간 순서와 뒤집힌다.
   *
   * 손상된 파일은 삭제하지 않고 `.corrupt` 로 옮긴다 — 읽지 못한다고 증거를 버리면
   * 그게 조용한 유실이다.
   */
  async restore(): Promise<number> {
    let raw: string;
    try {
      raw = await fs.readFile(this.spoolPath, "utf8");
    } catch {
      return 0; // 스풀 없음 = 정상
    }

    let records: SpoolRecord[];
    let restoredUnresolved: UnresolvedRecord[] = [];
    try {
      const parsed = JSON.parse(raw) as SpoolFileShape;
      if (!parsed || !Array.isArray(parsed.records)) throw new Error("shape");
      records = parsed.records.filter(
        (r): r is SpoolRecord =>
          !!r &&
          typeof r.id === "string" &&
          !!r.event &&
          typeof r.event === "object",
      );
      // ★미해결분은 큐로 되돌리지 않는다 — 되돌리면 같은 이유로 다시 막힌다.
      // 그렇다고 버리지도 않는다: 이전 기동에 원장 공백이 있었다는 증거다.
      restoredUnresolved = Array.isArray(parsed.unresolved)
        ? parsed.unresolved.filter(
            (u): u is UnresolvedRecord =>
              !!u && !!u.rec && typeof u.rec.id === "string",
          )
        : [];
    } catch (err) {
      const quarantine = `${this.spoolPath}.corrupt`;
      console.error(
        `[Audit] ★스풀 파일을 읽지 못했습니다 — ${quarantine} 로 격리합니다. ` +
          `이 구간의 감사 이벤트는 원장에 없습니다: ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
      await fs.rename(this.spoolPath, quarantine).catch(() => {});
      this.everDegraded = true;
      this.lastError = `스풀 파일 손상 — ${quarantine} 로 격리됨`;
      this.lastErrorAtMs = this.opts.now();
      return 0;
    }

    if (restoredUnresolved.length > 0) {
      this.unresolved.push(...restoredUnresolved);
      this.everDegraded = true;
      console.error(
        `[Audit] ★이전 기동에서 원장에 넣지 못한 감사 이벤트 ` +
          `${restoredUnresolved.length}건이 있습니다. 재시도해도 같은 이유로 ` +
          `거부되므로 큐로 되돌리지 않고 증거로만 보존합니다 — ` +
          `get_ledger_spool_status 로 확인하세요.`,
      );
    }

    if (records.length === 0) {
      // 미해결분이 있으면 파일을 지우지 않는다(증거 보존). 그 경우 큐가 비었으므로
      // drain 이 돌지 않아 파일을 다시 써 줄 사람도 없다 — 여기서 직접 남긴다.
      if (this.unresolved.length > 0) await this.persist();
      else await this.clearPersisted();
      return 0;
    }

    const entries: Entry[] = records.map((rec) => ({
      rec,
      size: byteLen(rec),
      // 오버플로 tombstone 과 미해결 마커 **둘 다** 메타 레코드다. 여기서
      // 미해결 마커를 빠뜨리면 재기동 후 상한에 걸릴 때 유실 기록이 드롭된다.
      tombstone:
        rec.event?.toolName === SPOOL_OVERFLOW_TOOL ||
        rec.event?.toolName === SPOOL_UNRESOLVED_TOOL,
    }));
    this.queue.unshift(...entries);
    this.queuedBytes += entries.reduce((sum, e) => sum + e.size, 0);
    this.everDegraded = true;
    this.enforceCap();
    console.error(
      `[Audit] 이전 기동에서 밀린 감사 이벤트 ${records.length}건을 스풀에서 ` +
        `복원했습니다. 순서를 보존해 재적재합니다.`,
    );
    void this.drain();
    return records.length;
  }

  // ── 관측 ───────────────────────────────────────────────────────

  status(): SpoolStatus {
    const oldest = this.queue[0]?.rec.occurredAtMs ?? null;
    return {
      pending: this.queue.length,
      oldestPendingAtMs: oldest,
      degraded: this.queue.length > 0,
      everDegraded: this.everDegraded,
      lastError: this.lastError,
      lastErrorAtMs: this.lastErrorAtMs,
      failureCount: this.failureCount,
      lastSuccessAtMs: this.lastSuccessAtMs,
      writtenCount: this.writtenCount,
      droppedCount: this.droppedCount,
      droppedFromMs: this.droppedFromMs,
      droppedToMs: this.droppedToMs,
      unresolvedCount: this.unresolved.length,
      unresolvedConfirmedMissing: this.unresolved.filter(
        (u) => u.verified === false,
      ).length,
      unresolvedUnknown: this.unresolved.filter((u) => u.verified === null)
        .length,
      unresolvedOldestAtMs:
        this.unresolved.length > 0
          ? Math.min(...this.unresolved.map((u) => u.rec.occurredAtMs))
          : null,
      ackRecoveredCount: this.ackRecoveredCount,
      unwrittenMarkerCount: this.unwrittenMarkerCount,
      nextRetryAtMs: this.queue.length > 0 ? this.nextRetryAtMs : null,
      spoolPath: this.spoolPath,
      maxBytes: this.opts.maxBytes,
      maxRecords: this.opts.maxRecords,
      queuedBytes: this.queuedBytes,
    };
  }

  /** 진행 중인 배수 사이클이 끝날 때까지 기다린다(테스트용). */
  async settled(): Promise<void> {
    if (!this.draining) return;
    await new Promise<void>((resolve) => this.settledWaiters.push(resolve));
  }

  private notifySettled(): void {
    const waiters = this.settledWaiters;
    this.settledWaiters = [];
    for (const w of waiters) w();
  }

  /** 재시도 타이머를 기다리지 않고 즉시 한 번 더 시도한다(수동 복구·테스트). */
  async retryNow(): Promise<void> {
    await this.drain();
  }
}

// ── 사람이 읽는 상태 요약 ────────────────────────────────────────

const ago = (ms: number | null, now: number): string =>
  ms === null ? "없음" : `${Math.max(0, Math.round((now - ms) / 1000))}초 전`;

/**
 * 상태를 사람이 읽는 텍스트로. **"모른다"를 "괜찮다"로 답하지 않는다**(§15) —
 * 관측하지 못한 값은 "없음/미상"으로 명시하고, 공백이 있으면 그 사실을 맨 앞에 쓴다.
 */
export function formatSpoolStatus(s: SpoolStatus, now: number): string {
  const lines: string[] = [];

  if (s.droppedCount > 0) {
    lines.push(
      `★원장에 공백 있음 — 상한 초과로 ${s.droppedCount}건이 유실되었습니다 ` +
        `(${ago(s.droppedFromMs, now)} ~ ${ago(s.droppedToMs, now)}).`,
    );
  }
  if (s.unresolvedCount > 0) {
    // 확인해서 없었던 것과 확인 자체를 못한 것을 합치지 않는다 — 조사 시 취할
    // 조치가 다르고, 합치면 "모른다"가 "유실"로 반올림된다.
    lines.push(
      `★원장 미적재 ${s.unresolvedCount}건 — 재시도로 풀리지 않아 대기열에서 ` +
        `내렸습니다 (가장 오래된 것 ${ago(s.unresolvedOldestAtMs, now)}). ` +
        `그중 ${s.unresolvedConfirmedMissing}건은 원장에 없음이 확인됐고, ` +
        `${s.unresolvedUnknown}건은 있는지조차 확인하지 못했습니다.`,
    );
  }
  if (s.unwrittenMarkerCount > 0) {
    lines.push(
      `★공백 사실을 원장에 남기지도 못했습니다(${s.unwrittenMarkerCount}회) — ` +
        `공백이 있었다는 정보가 이 프로세스에만 있습니다. 프로세스가 죽으면 ` +
        `그 사실도 사라집니다.`,
    );
  }
  if (s.degraded) {
    lines.push(
      `상태: DEGRADED — ${s.pending}건이 원장에 못 들어가고 대기 중입니다 ` +
        `(가장 오래된 것 ${ago(s.oldestPendingAtMs, now)}).`,
    );
  } else if (s.everDegraded) {
    lines.push(
      // ★"대기 0건"만 말하면 미적재분이 있어도 정상으로 읽힌다. 대기열이 비었다는
      // 것과 원장이 온전하다는 것은 다른 명제다.
      `상태: ${s.unresolvedCount > 0 ? "주의" : "정상"}(회복됨) — 대기 0건${
        s.unresolvedCount > 0
          ? `, 단 원장 미적재 ${s.unresolvedCount}건은 그대로 남아 있습니다`
          : ""
      }. 이 프로세스는 기동 이후 ${s.failureCount}회 쓰기에 실패한 적이 있습니다.`,
    );
  } else {
    lines.push(`상태: 정상 — 대기 0건, 기동 이후 쓰기 실패 없음.`);
  }

  lines.push(
    `적재 성공: ${s.writtenCount}건 (마지막 ${ago(s.lastSuccessAtMs, now)})`,
  );
  if (s.ackRecoveredCount > 0) {
    lines.push(
      `그중 ${s.ackRecoveredCount}건은 쓰기가 거부됐지만 확인해 보니 원장에 이미 ` +
        `있었습니다(ack 만 유실된 쓰기).`,
    );
  }
  lines.push(
    `마지막 실패: ${
      s.lastError === null
        ? "없음"
        : `${s.lastError} (${ago(s.lastErrorAtMs, now)})`
    }`,
  );
  if (s.nextRetryAtMs !== null) {
    lines.push(
      `다음 재시도: ${Math.max(
        0,
        Math.round((s.nextRetryAtMs - now) / 1000),
      )}초 후`,
    );
  }
  lines.push(
    `스풀: ${s.spoolPath} (${s.queuedBytes}B / 상한 ${s.maxBytes}B · ` +
      `${s.pending}건 / 상한 ${s.maxRecords}건)`,
  );
  return lines.join("\n");
}

/**
 * 툴 결과에 붙일 경고. 정상이면 null 이라 건강한 프로세스는 출력이 늘지 않는다.
 *
 * ★오버플로는 스로틀하지 않는다 — 상한에 닿는 순간이 가장 시끄러워야 한다.
 */
export function spoolNotice(s: SpoolStatus): string | null {
  if (s.droppedCount > 0) {
    return (
      `⚠️ [감사 원장] 상한 초과로 ${s.droppedCount}건이 유실되었습니다. ` +
      `원장에 공백이 있습니다 — get_ledger_spool_status 로 구간을 확인하세요.`
    );
  }
  if (s.unresolvedCount > 0) {
    // pending 보다 먼저 본다: 재시도로 풀릴 것(pending)보다 안 풀릴 것이 더 급하다.
    return (
      `⚠️ [감사 원장] ${s.unresolvedCount}건을 원장에 넣지 못했습니다 ` +
      `(확인된 유실 ${s.unresolvedConfirmedMissing}건, 유실 여부 미상 ` +
      `${s.unresolvedUnknown}건). 재시도로는 풀리지 않습니다 — ` +
      `get_ledger_spool_status 로 확인하세요.`
    );
  }
  if (s.pending > 0) {
    return (
      `⚠️ [감사 원장] 쓰기 실패로 ${s.pending}건이 로컬 스풀에 대기 중입니다 ` +
      `(사유: ${
        s.lastError ?? "미상"
      }). 이 구간의 감사 기록은 아직 원장에 없습니다.`
    );
  }
  return null;
}
