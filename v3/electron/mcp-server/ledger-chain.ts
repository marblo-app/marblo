/**
 * 감사 원장(ledger) L3 — 해시 체인 + 머클 체크포인트.
 *
 * 설계 권위: docs/superpowers/specs/2026-07-19-team-governance-audit-ledger-design.md
 * (§6 해시 체인 · §10 마이그레이션 · §11 실패 모드 · §12 검증)
 *
 * ## 이 파일이 답하는 질문
 *
 * L2 까지로 원장은 **클라이언트가 지우거나 고칠 수 없다**(룰: `delete: false`,
 * `update` 는 동일 내용 no-op 만). 하지만 그건 *우리 룰을 지나는* 경로에만 걸린다.
 * 콘솔·admin SDK·백업 복원처럼 룰을 우회하는 경로에서 문서가 사라지거나 바뀌면
 * 원장은 그 사실을 **말할 수 없다**. 룰은 접근 제어이지 무결성 증거가 아니다.
 *
 * → 그래서 증거를 데이터 자체에 넣는다. 이벤트를 해시로 잇고(체인), 체인 머리를
 * 주기적으로 한 장에 묶어 봉인한다(체크포인트).
 *
 * | 공격                  | 탐지              |
 * | --------------------- | ----------------- |
 * | 이벤트 중간 삭제·변조 | 체인 단절         |
 * | 체인 통째 삭제        | 체크포인트 불일치 |
 *
 * ## ★체인 단위가 (projectId, agentId) 인 이유 — 프로젝트 단일 체인 금지
 *
 * 프로젝트 단위 단일 체인은 에이전트 5기가 동시에 write 할 때 **매 write 마다
 * 트랜잭션 경합**이 생긴다. 현재 `auditLog()` 는 fire-and-forget 이라 MCP 툴 호출을
 * 막지 않는데, 체인 머리를 공유 자원으로 만들면 모든 툴 호출이 그 자원을 두고
 * 줄을 서게 된다 — 감사 기능이 제품 성능을 갉아먹는 구조가 된다(§6).
 *
 * 반면 `(projectId, agentId)` 로 쪼개면 **에이전트당 MCP 서버가 하나**라 각 체인의
 * writer 가 프로세스 하나뿐이다. 순서가 자연히 단일이므로 잠금도 트랜잭션도
 * 필요 없고, 봉인이 순수 인메모리 연산 하나로 끝난다. 비차단 성질이 설계상
 * 보존되는 것이지 조심해서 지키는 게 아니다.
 *
 * ## ★봉인 시점 = enqueue 시점 (write 시점이 아니다)
 *
 * L1 스풀이 이미 이 정합을 못박아 뒀다(ledger-spool.ts 상단 "L3 와의 정합"):
 * 스풀은 30분 뒤에 재적재될 수 있어서 **write 순서 ≠ 발생 순서**다. `seq` 를 write
 * 시점에 매기면 오프라인 구간의 이벤트가 복구 시점 순서로 번호를 받아 원장이
 * "그때 일어난 일"의 순서를 잃는다. `enqueue()` 가 이 프로세스의 단일 직렬화
 * 지점이므로 봉인도 거기서 한다.
 *
 * 부수 효과로 **L1.6 멱등 재시도가 유지된다**: 봉인이 enqueue 에서 1회 끝나므로
 * 재시도 페이로드가 결정적으로 동일하고, 그래서 룰의
 * `request.resource.data == resource.data` 를 그대로 통과한다. 봉인을 sink 에서
 * 했다면 재시도마다 해시가 달라져 update 가 거부되고 스풀이 고착됐을 것이다.
 *
 * ## 순서 권위는 createdAt 이 아니라 seq (§11 시계 왜곡)
 *
 * `createdAt` 은 클라이언트 시계에서 온다. 시계가 흔들리면 정렬이 뒤집히는데,
 * `seq` 는 프로세스 내 단조 증가라 시계와 무관하다. 검증은 항상 `seq` 로 정렬한다.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { LedgerEventWrite } from "./ledger.js";

// ── 상수 ─────────────────────────────────────────────────────────

/**
 * 해시 입력 포맷의 버전. 해시 계산에 들어가므로, 이 값이 바뀌면 과거 이벤트의
 * 해시를 재현할 수 없다 — **바꾸려면 새 체크포인트 세대를 시작해야 한다**(§10 과
 * 같은 논리: 없는 보증을 있는 척하지 않는다).
 */
export const LEDGER_CHAIN_VERSION = 1;

export const CHAIN_HASH_PREFIX = "sha256:";

/**
 * 체인 첫 이벤트(`seq: 0`)의 `prevHash`.
 *
 * null 이 아니라 고정 문자열인 이유: null 이면 "첫 이벤트"와 "prevHash 필드가
 * 지워진 이벤트"가 구분되지 않는다. 지워진 것을 시작으로 읽으면 앞을 통째로
 * 잘라낸 체인이 정상으로 검증된다 — 정확히 막으려는 공격이다.
 */
export const GENESIS_PREV_HASH = "genesis";

/** 빈 머클 트리의 루트. 체인이 하나도 없는 제네시스 체크포인트가 쓴다. */
export const EMPTY_MERKLE_ROOT = `${CHAIN_HASH_PREFIX}${createHash("sha256")
  .update("marblo-ledger-empty", "utf8")
  .digest("hex")}`;

/** 체크포인트 체인의 첫 장이 가리키는 값. GENESIS_PREV_HASH 와 같은 이유로 고정 문자열. */
export const GENESIS_CHECKPOINT_PREV_HASH = "genesis-checkpoint";

// ── 정규 직렬화 ──────────────────────────────────────────────────

/**
 * 결정적 JSON 직렬화. 객체 키를 **재귀적으로 정렬**한다.
 *
 * 왜 `JSON.stringify` 로 충분하지 않은가: 키 순서가 삽입 순서를 따르므로, 같은
 * 내용이 Firestore 를 왕복하며 키 순서만 바뀌어도 해시가 달라진다. 그러면 멀쩡한
 * 기록이 "변조됨"으로 보고된다 — 감사 도구에서 거짓 양성은 거짓 음성만큼 나쁘다.
 * 아무도 안 믿게 되기 때문이다.
 *
 * `undefined` 는 생략한다(JSON 및 Firestore 와 같은 취급). 비유한 수는 거부한다 —
 * NaN/Infinity 는 JSON 왕복에서 null 로 뭉개져 서로 다른 값이 같은 해시를 받는다.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error(
        `원장 해시 입력에 비유한 수(${String(value)})가 있습니다 — JSON 왕복에서 ` +
          `null 로 뭉개져 서로 다른 값이 같은 해시를 받게 됩니다.`,
      );
    }
    return JSON.stringify(value);
  }
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
      .join(",")}}`;
  }
  // 함수·심볼·bigint 등은 Firestore 에 저장될 수 없다. 조용히 통과시키면 저장된
  // 문서와 해시 입력이 어긋난다.
  throw new Error(`원장 해시 입력에 직렬화 불가 타입(${t})이 있습니다.`);
}

const sha256 = (input: string): string =>
  CHAIN_HASH_PREFIX + createHash("sha256").update(input, "utf8").digest("hex");

// ── 체인 필드 ────────────────────────────────────────────────────

export interface ChainFields {
  /** `(projectId, agentId)` 체인 내 순번. 0 부터. 순서 권위는 이것이다. */
  seq: number;
  prevHash: string;
  hash: string;
}

/** 체인이 붙은 원장 이벤트. */
export type SealedLedgerEvent = LedgerEventWrite & ChainFields;

/**
 * 체인 필드를 뺀 알맹이. 해시 입력을 만들 때 쓴다 — `hash` 가 자기 자신을 포함하면
 * 계산이 성립하지 않고, `seq`/`prevHash` 는 따로 명시적으로 넣는다.
 */
function chainPayload(event: LedgerEventWrite): Record<string, unknown> {
  const rest = { ...(event as Record<string, unknown>) };
  delete rest.seq;
  delete rest.prevHash;
  delete rest.hash;
  return rest;
}

export interface SealMeta {
  /** Firestore 문서 id. 해시에 넣어 문서 갈아끼우기를 막는다. */
  id: string;
  /** 발생 시각. `createdAt` 으로 저장되므로 해시에 넣어야 시각 변조가 드러난다. */
  occurredAtMs: number;
  seq: number;
  prevHash: string;
}

/**
 * 이벤트 한 건의 해시.
 *
 * 입력에 무엇이 들어가는지가 곧 **무엇을 변조 탐지할 수 있는가**다:
 *  - `id`           — 다른 문서로 갈아끼우기
 *  - `occurredAtMs` — 시각 조작(`createdAt` 이 여기서 나온다)
 *  - `seq`/`prevHash` — 순서 조작·앞부분 잘라내기
 *  - 이벤트 본문 전체 — 내용 변조
 *
 * 반대로 여기 없는 것은 탐지되지 않는다. 그래서 본문은 필드를 골라 담지 않고
 * **통째로** 넣는다 — 나중에 필드가 추가돼도 자동으로 보호 범위에 든다.
 */
export function computeEventHash(
  event: LedgerEventWrite,
  meta: SealMeta,
): string {
  return sha256(
    canonicalize({
      v: LEDGER_CHAIN_VERSION,
      id: meta.id,
      occurredAtMs: meta.occurredAtMs,
      seq: meta.seq,
      prevHash: meta.prevHash,
      event: chainPayload(event),
    }),
  );
}

/** 체인 식별자. `(projectId, agentId)` 한 쌍을 문자열 하나로. */
export function chainKey(projectId: string, agentId: string): string {
  // 구분자를 JSON 으로 둔다 — projectId 에 구분자 문자가 섞여도 두 체인이 같은
  // 키로 뭉치지 않는다(귀속 혼선은 감사에서 곧 오판이다).
  return JSON.stringify([projectId, agentId]);
}

export function parseChainKey(key: string): {
  projectId: string;
  agentId: string;
} {
  const [projectId, agentId] = JSON.parse(key) as [string, string];
  return { projectId, agentId };
}

// ── 봉인기 ───────────────────────────────────────────────────────

/** 한 체인의 머리(마지막으로 봉인된 이벤트). */
export interface ChainHead {
  projectId: string;
  agentId: string;
  seq: number;
  hash: string;
}

/** 디스크에 남는 봉인기 상태. */
export interface ChainSnapshot {
  version: number;
  agentId: string;
  chains: Record<string, { seq: number; hash: string }>;
}

/**
 * 체인 봉인기 — **순수 인메모리, 동기.** 잠금도 트랜잭션도 없다.
 *
 * 성립 근거는 §6 의 단위 선택 그 자체다: 체인 하나의 writer 가 프로세스 하나뿐이라
 * 경합할 상대가 없다. 그래서 `seal()` 이 맵 조회 + 해시 한 번으로 끝나고,
 * 호출부(`enqueue()`)의 비차단 성질이 그대로 보존된다.
 */
export class LedgerChainSealer {
  private readonly chains = new Map<string, { seq: number; hash: string }>();
  private dirty = false;

  constructor(private readonly agentId: string) {}

  /**
   * 다음 자리를 할당해 이벤트를 봉인한다.
   *
   * 같은 프로세스에서 여러 projectId 의 이벤트가 나올 수 있으므로(cross-project
   * 계열 툴) 체인은 이벤트의 projectId 로 고른다 — 프로세스 하나가 여러 체인을
   * 굴리는 것은 정상이다.
   */
  seal(
    event: LedgerEventWrite,
    meta: { id: string; occurredAtMs: number },
  ): SealedLedgerEvent {
    const key = chainKey(event.projectId, event.agentId);
    const head = this.chains.get(key);
    const seq = head ? head.seq + 1 : 0;
    const prevHash = head ? head.hash : GENESIS_PREV_HASH;
    const sealed = this.sealAt(event, {
      id: meta.id,
      occurredAtMs: meta.occurredAtMs,
      seq,
      prevHash,
    });
    this.chains.set(key, { seq, hash: sealed.hash });
    this.dirty = true;
    return sealed;
  }

  /**
   * **자리를 옮기지 않고** 다시 봉인한다.
   *
   * 스풀의 메타 마커(오버플로 tombstone·미해결 마커)는 큐에 있는 동안 내용이
   * 갱신된다(유실 구간이 넓어지면 카운트를 키운다). 그때 해시를 다시 계산하지
   * 않으면 저장되는 내용과 해시가 어긋나 **멀쩡한 마커가 변조로 보고된다.**
   * 자리(`seq`/`prevHash`)는 그대로 두므로 체인은 흔들리지 않는다 — 아직 원장에
   * 나가지도 않은 레코드라 뒤 이벤트가 이 해시를 참조한 적이 없다.
   */
  reseal(event: LedgerEventWrite, meta: SealMeta): SealedLedgerEvent {
    const sealed = this.sealAt(event, meta);
    const key = chainKey(event.projectId, event.agentId);
    const head = this.chains.get(key);
    // 이 마커가 아직 체인 머리라면 머리의 해시도 같이 갱신해야 다음 이벤트의
    // prevHash 가 맞는다.
    if (head && head.seq === meta.seq) {
      this.chains.set(key, { seq: meta.seq, hash: sealed.hash });
      this.dirty = true;
    }
    return sealed;
  }

  private sealAt(event: LedgerEventWrite, meta: SealMeta): SealedLedgerEvent {
    const base = { ...event, seq: meta.seq, prevHash: meta.prevHash };
    return { ...base, hash: computeEventHash(base, meta) };
  }

  /** 지금 이 프로세스가 아는 모든 체인 머리. 체크포인트 재료다. */
  heads(): ChainHead[] {
    return [...this.chains.entries()]
      .map(([key, v]) => {
        const { projectId, agentId } = parseChainKey(key);
        return { projectId, agentId, seq: v.seq, hash: v.hash };
      })
      .sort(sortHeads);
  }

  snapshot(): ChainSnapshot {
    return {
      version: LEDGER_CHAIN_VERSION,
      agentId: this.agentId,
      chains: Object.fromEntries(this.chains),
    };
  }

  /**
   * 이전 기동의 머리를 이어받는다.
   *
   * ★이게 없으면 재기동마다 모든 체인이 `seq: 0` 에서 다시 시작해, 원장에 같은
   * `(projectId, agentId, seq)` 가 여러 벌 생긴다. 그러면 "이 자리에 어떤 이벤트가
   * 있었나"에 답이 둘 이상 나오고 체인이 증거 구실을 못 한다.
   */
  restoreFrom(snapshot: ChainSnapshot | null): number {
    if (!snapshot || snapshot.version !== LEDGER_CHAIN_VERSION) return 0;
    let n = 0;
    for (const [key, v] of Object.entries(snapshot.chains ?? {})) {
      if (
        v &&
        typeof v.seq === "number" &&
        Number.isInteger(v.seq) &&
        v.seq >= 0 &&
        typeof v.hash === "string" &&
        v.hash
      ) {
        this.chains.set(key, { seq: v.seq, hash: v.hash });
        n += 1;
      }
    }
    return n;
  }

  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }
}

const sortHeads = (a: ChainHead, b: ChainHead): number =>
  a.projectId === b.projectId
    ? a.agentId < b.agentId
      ? -1
      : a.agentId > b.agentId
        ? 1
        : 0
    : a.projectId < b.projectId
      ? -1
      : 1;

// ── 머리 저장소 (재기동 연속성) ──────────────────────────────────

/**
 * 체인 머리를 디스크에 남긴다. 스풀 파일과 같은 디렉터리·같은 tmp+rename 패턴이라
 * 반쯤 쓰인 파일이 존재하지 않는다.
 *
 * ★기록은 **write-behind**다: `save()` 는 await 하지 않아도 되도록 만들어져 있고
 * 동시에 하나만 돈다. 봉인이 디스크를 기다리면 §6 이 지키려는 비차단 성질이 깨진다.
 *
 * ★크래시 창(마지막 저장 이후 봉인된 이벤트)에서는 재기동 후 이미 쓴 `seq` 를 다시
 * 발급할 수 있다. 그 결과는 **중복 seq 이고, 검증이 `duplicate-seq` 로 잡아낸다** —
 * 조용히 지나가지 않는다. 반대 설계(안전하게 앞질러 예약)는 재기동마다 확정적으로
 * `seq` 구멍을 만들어 "기록이 삭제됐다"와 구분되지 않는 잡음을 매번 만든다.
 * 드물고 탐지되는 중복 쪽이 상시 거짓 경보보다 낫다.
 */
export class ChainHeadStore {
  private writing: Promise<void> | null = null;
  private pending = false;

  constructor(
    private readonly dir: string,
    private readonly agentId: string,
  ) {}

  get filePath(): string {
    const cleaned = (this.agentId || "").replace(/[^A-Za-z0-9_.-]/g, "_");
    const safe = /^[A-Za-z0-9_-]/.test(cleaned)
      ? cleaned.slice(0, 120)
      : "unknown";
    return path.join(this.dir, `${safe}.chain.json`);
  }

  async load(): Promise<ChainSnapshot | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return null; // 첫 기동 — 정상
    }
    try {
      const parsed = JSON.parse(raw) as ChainSnapshot;
      if (!parsed || typeof parsed.chains !== "object")
        throw new Error("shape");
      return parsed;
    } catch (err) {
      // 읽지 못했다고 조용히 seq 0 으로 되돌아가면 원장에 같은 자리가 두 벌 생긴다.
      // 파일은 증거로 남기고(격리) 호출부가 불연속을 기록하게 null 을 돌려준다.
      const quarantine = `${this.filePath}.corrupt`;
      console.error(
        `[Audit] ★체인 머리 파일을 읽지 못했습니다 — ${quarantine} 로 격리합니다. ` +
          `이 프로세스의 체인은 새로 시작되며, 그 불연속은 원장에 기록됩니다: ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
      await fs.rename(this.filePath, quarantine).catch(() => {});
      return null;
    }
  }

  /** 저장을 예약한다. 이미 쓰는 중이면 끝난 뒤 한 번 더 돈다(중간 상태는 건너뛴다). */
  save(snapshot: ChainSnapshot): void {
    if (this.writing) {
      this.pending = true;
      return;
    }
    this.writing = this.write(snapshot).finally(() => {
      this.writing = null;
      if (this.pending) {
        this.pending = false;
        this.save(snapshot);
      }
    });
  }

  /** 테스트·종료 경로에서 진행 중인 기록이 끝날 때까지 기다린다. */
  async settled(): Promise<void> {
    while (this.writing) await this.writing;
  }

  private async write(snapshot: ChainSnapshot): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(snapshot), "utf8");
      await fs.rename(tmp, this.filePath);
    } catch (err) {
      console.error(
        `[Audit] 체인 머리 기록 실패 — 이 프로세스가 죽으면 체인이 새로 ` +
          `시작되고 그 불연속이 원장에 남습니다: ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }
}

// ── 검증 ─────────────────────────────────────────────────────────

/** 검증 대상 한 건. Firestore 문서에서 그대로 뽑아 만든다. */
export interface ChainEntry {
  id: string;
  occurredAtMs: number;
  event: LedgerEventWrite & Partial<ChainFields>;
}

export type ChainIssueKind =
  /** 저장된 hash 가 내용과 맞지 않는다 — 내용이 바뀌었다. */
  | "tampered"
  /** prevHash 가 앞 이벤트의 hash 와 다르다 — 사이의 것이 지워지거나 바뀌었다. */
  | "broken-link"
  /** seq 가 건너뛴다 — 이벤트가 없다. */
  | "seq-gap"
  /** 같은 seq 가 둘 이상 — 체인이 갈라졌다(크래시 후 자리 재발급 등). */
  | "duplicate-seq"
  /** 체인 시작이 0 이 아니다 — 앞부분이 통째로 없다. */
  | "missing-head"
  /** seq: 0 인데 prevHash 가 제네시스가 아니다 — 앞을 잘라내고 위장했다. */
  | "forged-genesis";

export interface ChainIssue {
  kind: ChainIssueKind;
  seq: number | null;
  id: string | null;
  detail: string;
}

export interface ChainVerdict {
  projectId: string;
  agentId: string;
  ok: boolean;
  /** 체인 필드가 붙어 있어 실제로 검증된 건수. */
  checked: number;
  /**
   * 체인 이전 기록(§10). 무결성 **미보증**이지 실패가 아니다 — 없는 보증을
   * 있는 척하지 않기 위해 별도로 센다.
   */
  preLedger: number;
  head: ChainHead | null;
  issues: ChainIssue[];
}

/** 체인 필드가 붙어 있는가. 없으면 제네시스 이전 기록이다(§10). */
export function isSealed(
  event: LedgerEventWrite & Partial<ChainFields>,
): event is SealedLedgerEvent {
  return (
    typeof event.seq === "number" &&
    typeof event.prevHash === "string" &&
    typeof event.hash === "string"
  );
}

/**
 * 체인 하나를 검증한다. **순수 함수** — Firestore 도 시계도 안 본다.
 *
 * 정렬은 `createdAt` 이 아니라 `seq` 로 한다(§11 시계 왜곡). 시계를 되돌려 이벤트
 * 순서를 뒤집으려는 시도는 `seq` 기준 정렬 앞에서 무력하다.
 */
export function verifyChain(
  entries: ChainEntry[],
  opts?: {
    /**
     * 체인이 `seq: 0` 부터 있어야 하는가. 창(window)으로 잘라 읽은 구간을 검증할
     * 때는 false — 앞이 없는 게 정상이라 `missing-head` 를 내면 거짓 양성이다.
     */
    expectFullChain?: boolean;
  },
): ChainVerdict {
  const expectFull = opts?.expectFullChain ?? true;
  const projectId = entries[0]?.event.projectId ?? "";
  const agentId = entries[0]?.event.agentId ?? "";
  const issues: ChainIssue[] = [];

  const sealed: Array<ChainEntry & { event: SealedLedgerEvent }> = [];
  let preLedger = 0;
  for (const e of entries) {
    if (isSealed(e.event)) {
      sealed.push(e as ChainEntry & { event: SealedLedgerEvent });
    } else {
      preLedger += 1;
    }
  }

  sealed.sort((a, b) => a.event.seq - b.event.seq);

  for (let i = 0; i < sealed.length; i += 1) {
    const cur = sealed[i];
    const { seq, prevHash, hash } = cur.event;

    // ① 내용 변조 — 저장된 해시를 내용으로부터 재현할 수 있는가.
    const recomputed = computeEventHash(cur.event, {
      id: cur.id,
      occurredAtMs: cur.occurredAtMs,
      seq,
      prevHash,
    });
    if (recomputed !== hash) {
      issues.push({
        kind: "tampered",
        seq,
        id: cur.id,
        detail:
          `내용에서 재계산한 해시가 저장된 해시와 다릅니다 — 이 이벤트는 기록 ` +
          `이후 변경되었습니다. 저장=${hash} 재계산=${recomputed}`,
      });
    }

    if (i === 0) {
      // ② 체인 시작 검사.
      if (seq === 0) {
        if (prevHash !== GENESIS_PREV_HASH) {
          issues.push({
            kind: "forged-genesis",
            seq,
            id: cur.id,
            detail:
              `seq 0 인데 prevHash 가 제네시스(${GENESIS_PREV_HASH})가 아닙니다 ` +
              `— 앞부분을 잘라내고 시작점으로 위장했을 수 있습니다.`,
          });
        }
      } else if (expectFull) {
        issues.push({
          kind: "missing-head",
          seq,
          id: cur.id,
          detail:
            `체인이 seq ${seq} 부터 시작합니다 — 앞의 ${seq}건이 원장에 ` +
            `없습니다.`,
        });
      }
      continue;
    }

    const prev = sealed[i - 1];
    // ③ 같은 자리 중복.
    if (seq === prev.event.seq) {
      issues.push({
        kind: "duplicate-seq",
        seq,
        id: cur.id,
        detail:
          `seq ${seq} 가 둘 이상입니다(id=${prev.id}, ${cur.id}) — 체인이 ` +
          `갈라졌습니다. 한 자리에 어떤 이벤트가 있었는지 단정할 수 없습니다.`,
      });
      continue;
    }

    // ④ 구멍.
    if (seq > prev.event.seq + 1) {
      issues.push({
        kind: "seq-gap",
        seq,
        id: cur.id,
        detail: `seq ${prev.event.seq} 다음이 ${seq} 입니다 — 사이 ${
          seq - prev.event.seq - 1
        }건이 원장에 없습니다. "일어나지 않았다"가 아니라 "기록이 없다"입니다.`,
      });
    }

    // ⑤ 연결. 구멍이 있어도 링크는 따로 본다 — 구멍만 있고 링크가 성하면
    //   "쓰이지 못했다"(스풀 유실)이고, 링크까지 끊기면 "쓰인 뒤 지워졌다"다.
    //   이 둘은 조사 시 취할 조치가 다르므로 합쳐서 보고하지 않는다.
    if (prevHash !== prev.event.hash) {
      issues.push({
        kind: "broken-link",
        seq,
        id: cur.id,
        detail:
          `prevHash 가 앞 이벤트(seq ${prev.event.seq})의 hash 와 다릅니다 — ` +
          `사이의 이벤트가 삭제되었거나 앞 이벤트가 변조되었습니다. ` +
          `기대=${prev.event.hash} 실제=${prevHash}`,
      });
    }
  }

  const last = sealed[sealed.length - 1];
  return {
    projectId,
    agentId,
    ok: issues.length === 0,
    checked: sealed.length,
    preLedger,
    head: last
      ? {
          projectId: last.event.projectId,
          agentId: last.event.agentId,
          seq: last.event.seq,
          hash: last.event.hash,
        }
      : null,
    issues,
  };
}

/** 여러 체인이 섞인 이벤트 목록을 체인별로 갈라 전부 검증한다. */
export function verifyAllChains(
  entries: ChainEntry[],
  opts?: { expectFullChain?: boolean },
): ChainVerdict[] {
  const byChain = new Map<string, ChainEntry[]>();
  for (const e of entries) {
    const key = chainKey(e.event.projectId, e.event.agentId);
    const list = byChain.get(key);
    if (list) list.push(e);
    else byChain.set(key, [e]);
  }
  return [...byChain.values()].map((list) => verifyChain(list, opts));
}

// ── 머클 루트 ────────────────────────────────────────────────────

/** 체인 머리 하나를 머클 잎으로. */
export function chainHeadLeaf(h: ChainHead): string {
  return sha256(
    canonicalize({
      v: LEDGER_CHAIN_VERSION,
      projectId: h.projectId,
      agentId: h.agentId,
      seq: h.seq,
      hash: h.hash,
    }),
  );
}

/**
 * 머클 루트. 잎을 둘씩 묶어 올라간다. 홀수면 마지막 잎을 그대로 올린다.
 *
 * 잎 하나만 바뀌어도 루트가 바뀌므로, 체크포인트 한 장(루트 하나)이 그 시점의
 * **모든 체인 머리 전체**를 봉인한다. 체인 하나를 통째로 지우면 남은 머리로
 * 계산한 루트가 봉인된 루트와 달라진다 — 그게 §6 표의 "체인 통째 삭제" 탐지다.
 */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return EMPTY_MERKLE_ROOT;
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(
        i + 1 < level.length ? sha256(`${level[i]}|${level[i + 1]}`) : level[i],
      );
    }
    level = next;
  }
  return level[0];
}

export function chainsMerkleRoot(heads: ChainHead[]): string {
  // 정렬해야 같은 집합이 항상 같은 루트를 낸다 — 관측 순서에 루트가 의존하면
  // 멀쩡한 원장이 "불일치"로 보고된다.
  return merkleRoot([...heads].sort(sortHeads).map(chainHeadLeaf));
}

// ── 체크포인트 ───────────────────────────────────────────────────

export type CheckpointKind = "genesis" | "periodic";

export interface LedgerCheckpoint {
  projectId: string;
  kind: CheckpointKind;
  /** 프로젝트 내 체크포인트 순번. 순서 권위는 시각이 아니라 이것이다(§11). */
  seqNo: number;
  atMs: number;
  chains: ChainHead[];
  merkleRoot: string;
  /**
   * 앞 체크포인트의 hash. ★체크포인트 자체도 체인으로 잇는다 — 이게 없으면
   * 공격자가 체인과 그 체인을 담은 체크포인트를 **함께** 지워 흔적을 없앨 수 있다.
   * 이으면 체크포인트를 지운 사실이 다음 장의 불일치로 드러난다.
   */
  prevCheckpointHash: string;
  hash: string;
}

export function computeCheckpointHash(
  cp: Omit<LedgerCheckpoint, "hash">,
): string {
  return sha256(
    canonicalize({
      v: LEDGER_CHAIN_VERSION,
      projectId: cp.projectId,
      kind: cp.kind,
      seqNo: cp.seqNo,
      atMs: cp.atMs,
      merkleRoot: cp.merkleRoot,
      prevCheckpointHash: cp.prevCheckpointHash,
      chains: [...cp.chains].sort(sortHeads),
    }),
  );
}

export function buildCheckpoint(input: {
  projectId: string;
  kind: CheckpointKind;
  seqNo: number;
  atMs: number;
  chains: ChainHead[];
  prevCheckpointHash: string;
}): LedgerCheckpoint {
  const chains = [...input.chains].sort(sortHeads);
  const body: Omit<LedgerCheckpoint, "hash"> = {
    projectId: input.projectId,
    kind: input.kind,
    seqNo: input.seqNo,
    atMs: input.atMs,
    chains,
    merkleRoot: chainsMerkleRoot(chains),
    prevCheckpointHash: input.prevCheckpointHash,
  };
  return { ...body, hash: computeCheckpointHash(body) };
}

/**
 * 제네시스 체크포인트(§10).
 *
 * 소급해서 변조 불가로 만들 수는 없다 — 이미 쓰인 기록은 그 시점에 무결성 증거가
 * 없었다. 없는 보증을 있는 척하면 그게 더 큰 컴플라이언스 문제다. 대신 **"언제부터
 * 보증되는가"를 원장 안에 못박는다.** 기업 고객에게는 경계가 분명한 편이 오히려
 * 신뢰를 준다.
 */
export function buildGenesisCheckpoint(
  projectId: string,
  atMs: number,
): LedgerCheckpoint {
  return buildCheckpoint({
    projectId,
    kind: "genesis",
    seqNo: 0,
    atMs,
    chains: [],
    prevCheckpointHash: GENESIS_CHECKPOINT_PREV_HASH,
  });
}

export type CheckpointIssueKind =
  /** 체크포인트가 봉인한 체인이 원장에 아예 없다 — 통째 삭제. */
  | "chain-missing"
  /** 체인은 있는데 머리가 봉인 시점보다 뒤로 갔다 — 꼬리를 잘랐다. */
  | "chain-truncated"
  /** seq 는 봉인 시점 이상인데 그 자리 hash 가 다르다 — 갈아끼웠다. */
  | "chain-diverged"
  /** 체크포인트 자체의 hash 가 내용과 안 맞는다. */
  | "checkpoint-tampered"
  /** 체크포인트 체인이 끊겼다 — 체크포인트를 지웠다. */
  | "checkpoint-broken-link"
  /** 체크포인트 순번이 건너뛴다. */
  | "checkpoint-gap";

export interface CheckpointIssue {
  kind: CheckpointIssueKind;
  detail: string;
  projectId: string;
  agentId: string | null;
}

export interface CheckpointVerdict {
  ok: boolean;
  issues: CheckpointIssue[];
}

/**
 * 체크포인트가 봉인한 머리들을, **지금 원장에서 관측되는** 머리들과 대조한다.
 *
 * 이게 §6 표의 아래 칸이다: 체인 하나를 통째로 지우면 그 체인의 이벤트가 전부
 * 사라지므로 체인 내부 검증으로는 아무것도 안 걸린다(검증할 대상 자체가 없다).
 * 봉인된 명부가 있어야 "있어야 할 것이 없다"를 말할 수 있다.
 */
export function verifyCheckpointAgainstHeads(
  cp: LedgerCheckpoint,
  observed: ChainHead[],
): CheckpointVerdict {
  const issues: CheckpointIssue[] = [];

  if (computeCheckpointHash(cp) !== cp.hash) {
    issues.push({
      kind: "checkpoint-tampered",
      projectId: cp.projectId,
      agentId: null,
      detail:
        `체크포인트 내용에서 재계산한 해시가 저장된 해시와 다릅니다 — ` +
        `체크포인트 자체가 변조되었습니다(seqNo=${cp.seqNo}).`,
    });
  }

  const byKey = new Map(
    observed.map((h) => [chainKey(h.projectId, h.agentId), h]),
  );

  for (const sealed of cp.chains) {
    const key = chainKey(sealed.projectId, sealed.agentId);
    const now = byKey.get(key);
    if (!now) {
      issues.push({
        kind: "chain-missing",
        projectId: sealed.projectId,
        agentId: sealed.agentId,
        detail:
          `체크포인트(seqNo=${cp.seqNo})가 봉인한 체인이 원장에 없습니다 — ` +
          `seq ${sealed.seq} 까지 ${sealed.seq + 1}건이 있었어야 합니다. ` +
          `체인이 통째로 삭제되었습니다.`,
      });
      continue;
    }
    if (now.seq < sealed.seq) {
      issues.push({
        kind: "chain-truncated",
        projectId: sealed.projectId,
        agentId: sealed.agentId,
        detail:
          `체인 머리가 뒤로 갔습니다 — 봉인 시점 seq ${sealed.seq}, 현재 ` +
          `seq ${now.seq}. 뒤쪽 ${sealed.seq - now.seq}건이 삭제되었습니다.`,
      });
      continue;
    }
    if (now.seq === sealed.seq && now.hash !== sealed.hash) {
      issues.push({
        kind: "chain-diverged",
        projectId: sealed.projectId,
        agentId: sealed.agentId,
        detail:
          `seq ${sealed.seq} 의 hash 가 봉인된 값과 다릅니다 — 같은 자리의 ` +
          `이벤트가 다른 것으로 갈아끼워졌습니다. 봉인=${sealed.hash} ` +
          `현재=${now.hash}`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * 체크포인트들 자체의 연속성. 체크포인트를 지우면 여기서 드러난다.
 *
 * 입력은 같은 projectId 의 체크포인트 전부. `seqNo` 로 정렬한다(시각 아님).
 */
export function verifyCheckpointChain(
  checkpoints: LedgerCheckpoint[],
  opts?: {
    /**
     * 제네시스(seqNo 0)부터 다 있어야 하는가. 최근 N 장만 창으로 읽어 검사할 때는
     * false — 앞이 없는 게 정상이라 `checkpoint-gap` 을 내면 거짓 양성이다.
     * 체인 이상을 매 주기 외치면 진짜 삭제가 났을 때 아무도 안 믿는다.
     */
    expectGenesis?: boolean;
  },
): CheckpointVerdict {
  const expectGenesis = opts?.expectGenesis ?? true;
  const issues: CheckpointIssue[] = [];
  const sorted = [...checkpoints].sort((a, b) => a.seqNo - b.seqNo);

  for (let i = 0; i < sorted.length; i += 1) {
    const cp = sorted[i];
    if (computeCheckpointHash(cp) !== cp.hash) {
      issues.push({
        kind: "checkpoint-tampered",
        projectId: cp.projectId,
        agentId: null,
        detail: `체크포인트 seqNo=${cp.seqNo} 의 해시가 내용과 맞지 않습니다.`,
      });
    }
    if (i === 0) {
      if (expectGenesis && cp.seqNo !== 0) {
        issues.push({
          kind: "checkpoint-gap",
          projectId: cp.projectId,
          agentId: null,
          detail:
            `체크포인트가 seqNo=${cp.seqNo} 부터 시작합니다 — 제네시스를 ` +
            `포함한 앞의 ${cp.seqNo}장이 없습니다.`,
        });
      }
      continue;
    }
    const prev = sorted[i - 1];
    if (cp.seqNo > prev.seqNo + 1) {
      issues.push({
        kind: "checkpoint-gap",
        projectId: cp.projectId,
        agentId: null,
        detail:
          `체크포인트 seqNo ${prev.seqNo} 다음이 ${cp.seqNo} 입니다 — ` +
          `사이 ${cp.seqNo - prev.seqNo - 1}장이 없습니다.`,
      });
    }
    if (cp.prevCheckpointHash !== prev.hash) {
      issues.push({
        kind: "checkpoint-broken-link",
        projectId: cp.projectId,
        agentId: null,
        detail:
          `체크포인트 seqNo=${cp.seqNo} 의 prevCheckpointHash 가 앞 장(seqNo=` +
          `${prev.seqNo})의 hash 와 다릅니다 — 사이의 체크포인트가 삭제되었거나 ` +
          `앞 장이 변조되었습니다.`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * 이번 주기에 관측된 머리와 앞 체크포인트의 머리를 합친다.
 *
 * ★왜 단순 교체가 아닌가: 체크포인터는 최근 구간만 읽는다(전량 스캔은 프로젝트가
 * 커질수록 비싸진다). 조용해진 에이전트의 체인은 그 창에 안 잡히는데, 관측된 것만
 * 새 체크포인트에 담으면 **그 체인이 명부에서 조용히 빠진다** — 그러면 나중에 그
 * 체인을 통째로 지워도 대조할 명부가 없어 탐지가 죽는다. 한 번 봉인된 체인은
 * 계속 명부에 남긴다.
 *
 * 머리가 뒤로 간 경우(잘림)는 여기서 **덮어쓰지 않는다** — 덮어쓰면 잘림이
 * 새 체크포인트에 정상으로 박제된다. 앞선 값을 유지하고 이슈로 보고한다.
 */
export function mergeObservedHeads(
  previous: ChainHead[],
  observed: ChainHead[],
): { heads: ChainHead[]; issues: CheckpointIssue[] } {
  const issues: CheckpointIssue[] = [];
  const merged = new Map<string, ChainHead>();
  for (const h of previous) merged.set(chainKey(h.projectId, h.agentId), h);

  for (const h of observed) {
    const key = chainKey(h.projectId, h.agentId);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, h);
      continue;
    }
    if (h.seq < prev.seq) {
      issues.push({
        kind: "chain-truncated",
        projectId: h.projectId,
        agentId: h.agentId,
        detail:
          `관측된 머리(seq ${h.seq})가 앞 체크포인트(seq ${prev.seq})보다 ` +
          `뒤입니다 — 삭제 가능성. 앞선 값을 유지합니다(잘림을 새 체크포인트에 ` +
          `정상으로 박제하지 않기 위해서).`,
      });
      continue;
    }
    if (h.seq === prev.seq && h.hash !== prev.hash) {
      issues.push({
        kind: "chain-diverged",
        projectId: h.projectId,
        agentId: h.agentId,
        detail:
          `seq ${h.seq} 의 hash 가 앞 체크포인트와 다릅니다 — 같은 자리가 ` +
          `갈아끼워졌습니다. 앞선 값을 유지합니다.`,
      });
      continue;
    }
    merged.set(key, h);
  }

  return { heads: [...merged.values()].sort(sortHeads), issues };
}

// ── 보증 구간 리포트 (§10) ───────────────────────────────────────

export interface LedgerCoverage {
  /** 무결성이 보증되는 구간의 시작. 제네시스 체크포인트 시각. */
  guaranteedFromMs: number | null;
  /** 체인이 붙어 검증 가능한 건수. */
  sealed: number;
  /** 체인 이전 기록 — **무결성 미보증 구간**. */
  preLedger: number;
  /** 사람이 읽는 요약. */
  summary: string;
}

/**
 * 원장의 보증 구간을 계산한다(§10).
 *
 * ★`preLedger` 를 0 으로 반올림하지 않는 것이 요점이다. 기존 `audit_logs` 에는
 * 체인이 없고 소급해서 붙일 수도 없다(룰상 update 는 동일 내용 no-op 만 허용된다).
 * 그 구간을 보증되는 것처럼 보이게 만들면 감사 리포트 자체가 거짓이 된다.
 */
export function summarizeCoverage(
  entries: ChainEntry[],
  genesisAtMs: number | null,
): LedgerCoverage {
  let sealed = 0;
  let pre = 0;
  for (const e of entries) {
    if (isSealed(e.event)) sealed += 1;
    else pre += 1;
  }
  const summary =
    genesisAtMs === null
      ? `제네시스 체크포인트가 아직 없습니다 — 이 원장은 **무결성 미보증** ` +
        `상태입니다(전체 ${entries.length}건).`
      : `무결성 보증 구간: ${new Date(genesisAtMs).toISOString()} 이후. ` +
        `검증 가능 ${sealed}건 / 보증 이전 ${pre}건. ` +
        (pre > 0
          ? `★보증 이전 ${pre}건은 기록 시점에 무결성 증거가 없었으므로 ` +
            `변조 여부를 판정할 수 없습니다 — 소급 보증은 하지 않습니다.`
          : `보증 이전 기록은 없습니다.`);
  return { guaranteedFromMs: genesisAtMs, sealed, preLedger: pre, summary };
}
