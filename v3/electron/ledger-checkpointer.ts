/**
 * 감사 원장 L3 — 주기적 머클 체크포인터 (메인 프로세스).
 *
 * 설계 권위: docs/superpowers/specs/2026-07-19-team-governance-audit-ledger-design.md
 * (§6 해시 체인 · §10 마이그레이션 · §11 실패 모드)
 *
 * ## 왜 메인 프로세스인가
 *
 * 체인 봉인은 **에이전트별**로 그 에이전트의 MCP 서버가 한다(경합 없음이 §6 의
 * 요점이다). 하지만 그래서 어떤 MCP 서버도 *다른* 체인의 존재를 모른다 — 자기
 * 체인이 통째로 지워져도 자기는 이미 죽고 없다. **여러 체인을 가로질러 볼 수 있는
 * 관측자**가 따로 있어야 "있어야 할 체인이 없다"를 말할 수 있고, 앱 생애 내내 살아
 * 있는 프로세스는 메인뿐이다.
 *
 * 체크포인트는 그 시점 모든 체인 머리를 머클 루트 하나로 봉인한다. 체인 하나를
 * 통째로 지우면 남은 머리로 계산한 루트가 봉인된 루트와 달라진다(§6 표 아래 칸).
 *
 * ## ★관측 창(window)과 거짓 양성
 *
 * 체크포인터는 최근 구간만 읽는다 — 프로젝트가 커질수록 전량 스캔이 비싸지고,
 * 주기 작업이 앱을 느리게 만들면 감사 기능이 제품을 갉아먹는다. 그런데 조용해진
 * 에이전트의 체인은 그 창에 안 잡힌다. 그래서 이 모듈은 두 가지를 **다른 연산으로**
 * 다룬다:
 *
 *  - `runCheckpointCycle` (여기) — 관측된 머리를 앞 명부에 **합친다**
 *    (`mergeObservedHeads`). 창에 안 잡힌 체인을 삭제로 단정하지 않는다.
 *  - `verifyCheckpointAgainstHeads` (ledger-chain.ts) — 감사 리포트가 **모든**
 *    머리를 열거해 대조할 때 쓴다. 거기서는 부재가 곧 삭제다.
 *
 * 이 구분이 없으면 주기 작업이 매번 "체인 통째 삭제!"를 외치고, 그러면 진짜
 * 삭제가 일어났을 때 아무도 안 믿는다. 감사 도구에서 거짓 양성은 거짓 음성만큼
 * 나쁘다.
 *
 * ## §11 실패 모드
 *
 * 체크포인트 쓰기 실패는 던지지 않는다 — 다음 주기에 다시 시도하고, 공백은
 * 결과에 남겨 리포트가 표기한다. 감사 보조 장치가 앱을 죽이면 안 된다.
 */

import {
  buildCheckpoint,
  buildGenesisCheckpoint,
  mergeObservedHeads,
  verifyAllChains,
  verifyCheckpointChain,
  type ChainEntry,
  type ChainHead,
  type ChainIssue,
  type CheckpointIssue,
  type LedgerCheckpoint,
} from "./mcp-server/ledger-chain.js";

/** 한 주기에 읽어들일 최근 이벤트 상한. 전량 스캔을 피하기 위한 창(window). */
export const CHECKPOINT_WINDOW = 2_000;

/** 체크포인트 주기. 너무 촘촘하면 읽기 비용이 늘고, 너무 성기면 삭제 탐지가 늦다. */
export const CHECKPOINT_INTERVAL_MS = 15 * 60 * 1000;

export interface CheckpointerDeps {
  /** 이 프로젝트의 체크포인트 전부(순서 무관 — seqNo 로 정렬한다). */
  loadCheckpoints: (projectId: string) => Promise<LedgerCheckpoint[]>;
  /** 최근 원장 이벤트(창). 정렬 보장은 필요 없다 — seq 로 다시 정렬한다. */
  loadRecentEvents: (projectId: string, limit: number) => Promise<ChainEntry[]>;
  writeCheckpoint: (cp: LedgerCheckpoint) => Promise<void>;
  now: () => number;
  /**
   * `loadCheckpoints` 가 최근 N 장만 돌려주는가(전량이 아니라 창인가).
   *
   * true 면 제네시스 부재를 이상으로 보지 않는다 — 창의 앞이 없는 건 정상이다.
   * 이걸 구분하지 않으면 프로젝트가 오래될수록 매 주기 `checkpoint-gap` 이 뜨고,
   * 그러면 진짜 체크포인트 삭제가 났을 때 신호가 잡음에 묻힌다.
   */
  checkpointsWindowed?: boolean;
}

export interface CheckpointCycleResult {
  projectId: string;
  /** 이번 주기에 쓴 체크포인트. 쓰지 못했으면 null. */
  written: LedgerCheckpoint | null;
  /** 제네시스를 이번에 찍었는가(§10 — 보증 구간의 시작). */
  genesis: boolean;
  /** 봉인된 체인 수. */
  chains: number;
  /** 창에서 검증한 이벤트 수. */
  checkedEvents: number;
  /** 창에서 발견된 체인 이상. */
  chainIssues: ChainIssue[];
  /** 명부 대조·체크포인트 연속성 이상. */
  checkpointIssues: CheckpointIssue[];
  /** 쓰기 실패 사유. 성공했으면 null — 다음 주기에 재시도한다(§11). */
  error: string | null;
}

/**
 * 체크포인트 한 주기.
 *
 * 첫 실행이면 **제네시스**를 찍는다(§10). 소급해서 무결성을 보증할 수는 없으므로 —
 * 이미 쓰인 기록은 그 시점에 증거가 없었다 — 대신 "언제부터 보증되는가"를 원장 안에
 * 못박는다. 없는 보증을 있는 척하는 것이 더 큰 컴플라이언스 문제다.
 */
export async function runCheckpointCycle(
  projectId: string,
  deps: CheckpointerDeps,
): Promise<CheckpointCycleResult> {
  const base: CheckpointCycleResult = {
    projectId,
    written: null,
    genesis: false,
    chains: 0,
    checkedEvents: 0,
    chainIssues: [],
    checkpointIssues: [],
    error: null,
  };

  let existing: LedgerCheckpoint[];
  try {
    existing = await deps.loadCheckpoints(projectId);
  } catch (err) {
    return { ...base, error: `체크포인트 조회 실패: ${msg(err)}` };
  }

  // 체크포인트끼리의 연속성 — 체크포인트를 지운 흔적이 여기서 드러난다.
  const chainOfCheckpoints =
    existing.length > 0
      ? verifyCheckpointChain(existing, {
          expectGenesis: !deps.checkpointsWindowed,
        }).issues
      : [];

  if (existing.length === 0) {
    const genesis = buildGenesisCheckpoint(projectId, deps.now());
    try {
      await deps.writeCheckpoint(genesis);
    } catch (err) {
      // 던지지 않는다 — 다음 주기에 다시 시도한다(§11).
      return { ...base, error: `제네시스 체크포인트 기록 실패: ${msg(err)}` };
    }
    return { ...base, written: genesis, genesis: true };
  }

  const prev = [...existing].sort((a, b) => a.seqNo - b.seqNo).at(-1)!;

  let entries: ChainEntry[];
  try {
    entries = await deps.loadRecentEvents(projectId, CHECKPOINT_WINDOW);
  } catch (err) {
    return {
      ...base,
      checkpointIssues: chainOfCheckpoints,
      error: `원장 조회 실패: ${msg(err)}`,
    };
  }

  // 창은 체인의 일부만 담으므로 expectFullChain:false — 앞이 없는 게 정상이다.
  const verdicts = verifyAllChains(entries, { expectFullChain: false });
  const observed: ChainHead[] = verdicts
    .map((v) => v.head)
    .filter((h): h is ChainHead => h !== null);
  const chainIssues = verdicts.flatMap((v) => v.issues);

  const { heads, issues: mergeIssues } = mergeObservedHeads(
    prev.chains,
    observed,
  );

  const cp = buildCheckpoint({
    projectId,
    kind: "periodic",
    seqNo: prev.seqNo + 1,
    atMs: deps.now(),
    chains: heads,
    prevCheckpointHash: prev.hash,
  });

  const checkpointIssues = [...chainOfCheckpoints, ...mergeIssues];
  const checkedEvents = verdicts.reduce((n, v) => n + v.checked, 0);

  try {
    await deps.writeCheckpoint(cp);
  } catch (err) {
    return {
      ...base,
      chains: heads.length,
      checkedEvents,
      chainIssues,
      checkpointIssues,
      // 공백은 숨기지 않는다 — 이 주기에 봉인이 없었다는 사실이 리포트에 남는다(§11).
      error: `체크포인트 기록 실패: ${msg(err)}`,
    };
  }

  return {
    ...base,
    written: cp,
    chains: heads.length,
    checkedEvents,
    chainIssues,
    checkpointIssues,
  };
}

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * 주기 결과를 사람이 읽는 한 줄로. **문제가 없으면 null** — 건강한 앱의 로그를
 * 늘리지 않되, 이상이 있으면 반드시 눈에 띄게 한다.
 */
export function formatCycleNotice(r: CheckpointCycleResult): string | null {
  const parts: string[] = [];
  if (r.error) parts.push(`★${r.error} (다음 주기에 재시도)`);
  if (r.chainIssues.length > 0) {
    parts.push(
      `체인 이상 ${r.chainIssues.length}건: ${r.chainIssues
        .slice(0, 3)
        .map((i) => `${i.kind}@seq${i.seq}`)
        .join(", ")}`,
    );
  }
  if (r.checkpointIssues.length > 0) {
    parts.push(
      `체크포인트 이상 ${r.checkpointIssues.length}건: ${r.checkpointIssues
        .slice(0, 3)
        .map((i) => i.kind)
        .join(", ")}`,
    );
  }
  if (parts.length === 0) return null;
  return `[Ledger] ${r.projectId} — ${parts.join(" | ")}`;
}
