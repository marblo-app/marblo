import type { ComposerState, OccupancyCause } from "./composer-gate";

/**
 * 비서 트리거 발화가 **오케스트레이터에 닿지 못한 사실**을 사유와 함께 붙들어
 * 두는 자리 (티켓 lcR4OMWCriWIpwbVDwVt).
 *
 * ── 왜 있나 ────────────────────────────────────────────────────────────────
 * 트리거는 이미 정직하다. `OrchestratorManager.injectMessage` 는 실패를 성공으로
 * 가장하지 않고 `false` 를 돌려주고, `assistant-triggers.ts` 의 inject 는 그것을
 * 받아 warn 을 찍는다. 문제는 **그 false 가 화면까지 오지 않는다** 는 것뿐이다.
 * 사용자 입장에서는 "트리거를 켜 뒀는데 아무 일도 안 일어난다" 로만 보인다.
 *
 * 그래서 이 모듈은 없는 신호를 만들지 않는다. 이미 있는 실패를
 *   1) 사용자가 **무엇을 하면 되는지**가 갈리는 단위로 분류하고,
 *   2) 프로젝트별로 마지막 상태를 들고 있다가,
 *   3) 같은 사유가 매 분 반복될 때 알림만 억제한다(사실은 계속 센다).
 *
 * ── 왜 사유를 가르나 ───────────────────────────────────────────────────────
 * "전달 실패" 한 줄은 이 결함을 푼 것이 아니다. 로그인이 풀린 것과, 오케 터미널에
 * 초안이 물려 있는 것과, 폴더를 옮긴 것은 **서로 다른 행동**을 요구한다. 사유가
 * 뭉치면 사용자는 아무것도 고칠 수 없고, 결국 "안 되네" 로 끝난다.
 *
 * ── 왜 여기서 억제하나 ─────────────────────────────────────────────────────
 * 1분 주기 폴링 트리거가 같은 사유로 계속 죽으면 알림이 분당 1건씩 쌓인다. 그건
 * 알림이 아니라 소음이고, 소음은 곧 무시된다. 그래서 같은 프로젝트·같은 사유는
 * `ANNOUNCE_INTERVAL_MS` 안에서 한 번만 알리되 **횟수(count)와 마지막 시각은 계속
 * 갱신**한다 — 화면은 "3분 전 · 47회" 를 보여줄 수 있고, 사실을 잃지 않는다.
 *
 * I/O·Electron 의존 없음. `tests/unit/assistant-trigger-delivery.test.ts` 가
 * 동작으로 검증한다.
 */

/**
 * 발화가 죽은 **사유**. 갈라 놓은 기준은 단 하나 — 사용자가 취할 행동이 다른가.
 * 행동이 같은 것끼리는 굳이 나누지 않는다(예: "아직 안 떴다" 와 "부팅 중이다" 는
 * 둘 다 기다리거나 오케를 켜는 것이므로 `orchestrator-offline` 하나다).
 */
export type AssistantTriggerFailureReason =
  /** (a) 오케가 아직 안 떴다 / 부팅 중이다 / 부팅 게이트가 안 잡힌다 / 세션이 사라졌다. */
  | "orchestrator-offline"
  /** 프로젝트의 로컬 폴더 경로가 없거나 사라졌다 — 깨울 자리가 없다. */
  | "orchestrator-folder-missing"
  /** 로그인·사용권(스폰 auth) 게이트에 막혔다. */
  | "orchestrator-auth-blocked"
  /** MCP 게이트에 막혔다. */
  | "orchestrator-mcp-blocked"
  /** 모델 제공사 잔액·결제 게이트에 막혔다. */
  | "orchestrator-vendor-blocked"
  /** (b) 오케 터미널 컴포저에 남의 초안이 물려 있거나 확인 다이얼로그 앞이다. */
  | "composer-busy"
  /** (c) 그 외 — 썼지만 제출이 확인되지 않았다. */
  | "delivery-failed";

/** 어떤 트리거의 발화가 죽었는지. 화면에서 "무엇이 안 돌았나" 를 말해 준다. */
export type AssistantTriggerKind =
  | "schedule"
  | "calendar"
  | "gmail"
  | "webhook"
  | "sheets"
  /** 설정 오류 안내처럼 트리거 자체가 아니라 엔진이 보내는 알림. */
  | "notice";

/** 화면으로 나가는 한 건. 판정 문구가 아니라 **사실**만 담는다. */
export interface AssistantTriggerDeliveryFailure {
  projectId: string;
  projectName: string;
  reason: AssistantTriggerFailureReason;
  trigger: AssistantTriggerKind;
  /** 이 사유가 (연속으로) 처음 관측된 시각. epoch ms. */
  firstAt: number;
  /** 가장 최근 관측 시각. epoch ms. */
  lastAt: number;
  /** 이 사유로 죽은 발화의 누적 횟수 — 억제된 것까지 전부 센다. */
  count: number;
}

export interface RecordFailureInput {
  projectId: string;
  projectName: string;
  reason: AssistantTriggerFailureReason;
  trigger: AssistantTriggerKind;
  at: number;
}

export interface RecordFailureResult {
  /** 갱신된 현재 상태. 화면이 그대로 그린다. */
  failure: AssistantTriggerDeliveryFailure;
  /**
   * 지금 **알릴** 차례인가. false 여도 `failure` 는 최신이다 — 억제는 알림에만
   * 걸리고 사실 기록에는 걸리지 않는다.
   */
  announce: boolean;
}

/**
 * 같은 프로젝트·같은 사유를 다시 알리기까지의 최소 간격.
 *
 * 30분인 이유: 제일 촘촘한 폴링 트리거가 1분 주기라 억제가 없으면 시간당 60건이
 * 된다. 반대로 너무 길면 사용자가 고친 뒤 다시 깨졌을 때 조용해진다. 30분이면
 * "고치는 동안은 안 시끄럽고, 안 고치면 하루 두 자리수로 남는" 자리다.
 */
export const ANNOUNCE_INTERVAL_MS = 30 * 60_000;

interface Entry extends AssistantTriggerDeliveryFailure {
  /** 마지막으로 **알린** 시각. 억제 계산의 기준점. */
  announcedAt: number;
}

/**
 * 프로젝트당 **현재의 실패 하나**를 들고 있는 로그.
 *
 * 왜 하나만: 화면에 띄울 것은 "지금 왜 안 도는가" 이지 실패 목록이 아니다. 사유가
 * 바뀌면(예: 로그인은 풀렸다가 이제 컴포저가 물렸다) 새 사유가 이전 것을 대체하고
 * 그 순간 다시 알린다 — 사용자가 할 행동이 바뀌었으므로 억제하면 안 된다.
 */
export class AssistantTriggerDeliveryLog {
  private entries: Map<string, Entry> = new Map();

  record(input: RecordFailureInput): RecordFailureResult {
    const prev = this.entries.get(input.projectId);
    // 사유가 바뀌면 이전 사유의 카운터를 이어받지 않는다 — 다른 사실이다.
    const continued = prev !== undefined && prev.reason === input.reason;
    const next: Entry = {
      projectId: input.projectId,
      projectName: input.projectName,
      reason: input.reason,
      trigger: input.trigger,
      firstAt: continued ? prev.firstAt : input.at,
      lastAt: input.at,
      count: continued ? prev.count + 1 : 1,
      announcedAt: continued ? prev.announcedAt : input.at,
    };
    const announce =
      !continued || input.at - prev.announcedAt >= ANNOUNCE_INTERVAL_MS;
    if (announce) next.announcedAt = input.at;
    this.entries.set(input.projectId, next);
    return { failure: toFailure(next), announce };
  }

  /**
   * 전달이 성공했다. 붙들고 있던 실패를 지운다.
   *
   * 반환값은 "지울 것이 있었는가" — 호출부가 **상태가 실제로 바뀐 경우에만**
   * 화면에 알리게 해서, 정상 동작 중인 프로젝트가 발화할 때마다 IPC 를 때리는 것을
   * 막는다.
   */
  clear(projectId: string): boolean {
    return this.entries.delete(projectId);
  }

  get(projectId: string): AssistantTriggerDeliveryFailure | null {
    const entry = this.entries.get(projectId);
    return entry ? toFailure(entry) : null;
  }

  list(): AssistantTriggerDeliveryFailure[] {
    return [...this.entries.values()].map(toFailure);
  }
}

function toFailure(entry: Entry): AssistantTriggerDeliveryFailure {
  return {
    projectId: entry.projectId,
    projectName: entry.projectName,
    reason: entry.reason,
    trigger: entry.trigger,
    firstAt: entry.firstAt,
    lastAt: entry.lastAt,
    count: entry.count,
  };
}

/**
 * 오케스트레이터 PTY 주입이 실패한 정본 기계 사유. 폴러 관측과 트리거 화면이
 * 같은 사유를 공유한다. `pty-refused`의 composer 필드가 초안/선택 대기 여부를
 * 보충하므로, 같은 사실을 composer-occupied 같은 별도 사유명으로 복제하지 않는다.
 */
export type InjectRefusal =
  | "boot-gate-unstable"
  | "session-gone"
  | "mission-changed"
  | "pty-refused";

/**
 * 상세 주입 결과. `injectMessage` 자체는 이 객체를 노출하지 않고 boolean 계약을
 * 유지한다. 그래야 텔레그램·슬랙 폴러의 false=보류/재배달 분기가 계속 산다.
 */
export interface InjectOutcome {
  ok: boolean;
  refusal: InjectRefusal | null;
  composer: ComposerState | null;
  /**
   * ★컴포저가 막혔다면 **왜** (티켓 nMpBzIMJmkSFqrrZfSKz). `composer` 는
   * "쓰면 안 된다" 만 말하고 사유를 말하지 않아서, 안내문이 전부 사람 탓으로
   * 나갔다 — 실측에서 사장님이 존재하지 않는 초안을 찾으셨다. 막히지 않았거나
   * 판정할 수 없으면 null.
   */
  occupancy: OccupancyCause | null;
  detail: string;
  at: number;
}

/** 주입의 정본 기계 사유를 트리거 화면의 사용자 행동 단위로 번역한다. */
export function failureReasonFromInject(
  outcome: Pick<InjectOutcome, "refusal" | "composer">,
): AssistantTriggerFailureReason {
  switch (outcome.refusal) {
    case "boot-gate-unstable":
    case "session-gone":
      return "orchestrator-offline";
    case "pty-refused":
      return outcome.composer === "occupied" ||
        outcome.composer === "awaiting-choice"
        ? "composer-busy"
        : "delivery-failed";
    case "mission-changed":
    case null:
      return "delivery-failed";
  }
}
