/**
 * Claim 권한 모델 — "제약이 틀린 게 아니라 탈출구가 없다."
 *
 * ── 무엇이 고장나 있었나 (실측, 티켓 r2rrPsblZPlUOTCWzc3Z) ──────────────────
 *
 * `getClaimOwnershipError`(task-ownership.ts) 는 "claim 을 쥔 에이전트만 이 티켓을
 * 바꿀 수 있다" 는 단 하나의 규칙이었다. 그 규칙 자체는 옳다 — 두 에이전트가 같은
 * 티켓(=같은 워크트리/브랜치)을 동시에 만지면 커밋이 경합하고 작업이 유실된다.
 *
 * 문제는 그 규칙을 **넘을 방법이 없었다**는 것이다. 하루에 다섯 번 멈췄다:
 *
 *   fable5-spawn-probe      28일 CLAIMED, activity 0. claim 보유자 90b38577 이
 *                           플릿(73기)에 **문서조차 없다** — 답할 주체가 없다.
 *   grok-usage-verify       25일 CLAIMED, activity 0. 보유자 10d1ea4e 도 부재.
 *   사람 축 게이트 배포 / SEO 백링크
 *                           작업은 끝났는데 담당이 idle → REVIEW 영구 적체.
 *
 * 오케는 티켓을 만들고, 배정하고, 리뷰하고, PR 을 머지까지 하면서 **닫지를 못했다**.
 * `workerAgentId()`(tools.ts)가 `orchestrator-*` id 를 의도적으로 "" 로 떨어뜨리기
 * 때문에 오케의 actorAgentId 는 **어떤 claimedBy 와도 절대 일치하지 않는다**.
 *
 * 그리고 더 나쁜 절반: `update_task_status` 에는 force 가 있었지만 `add_activity`
 * 에는 없었다. → **닫을 수는 있는데 왜 닫았는지 못 적는다.** 정리 에이전트가 자기
 * 보고의 오류를 정정하려다 막혀서 comment 로 우회한 게 실제로 일어났다. 근거 없는
 * 상태 변경이 남고, 다음 사람이 "이거 왜 닫혔지" 를 처음부터 다시 판다.
 *
 * ── 이 모듈이 세우는 규칙 ─────────────────────────────────────────────────
 *
 * 권한은 **자칭 플래그가 아니라 신원과 증거**로 정한다. 네 갈래뿐이다:
 *
 *   unclaimed    claimedBy 가 없다 — 누구나.
 *   self         내가 그 claim 보유자다 — 지금까지와 동일.
 *   orchestrator 오케가 **자기 프로젝트** 티켓을 만진다. 오케 신원은 스폰 시 주입된
 *                MARBLO_AGENT_ID 라 모델이 지어낼 수 없고, 오케 도구 호출은 이미
 *                살아있는 PTY 세션으로 게이트된다(validateLiveOrchestratorToolCall).
 *   dead-claim   claim 보유자가 **증명 가능하게** 사라졌다. 호출자가 주장하는 게
 *                아니라 서버가 플릿을 조회해 확인한다 — 그래서 위조가 불가능하고,
 *                일반 워커에게 열어도 안전하다.
 *
 * ★`force` 는 더 이상 claim 을 넘지 못한다. 예전엔 아무 워커나 force=true 한 줄로
 * 남의 claim 을 조용히 뺏을 수 있었다(기록도 안 남았다). force 는 이제 원래 뜻인
 * **상태머신 전이 규칙 건너뛰기**로만 남는다 — 그건 내 티켓에 대한 얘기라 안전하다.
 *
 * ★override(= 남의 claim 을 넘는 것)에는 **사유가 필수**다. 사유 없이는 거부한다.
 * 그리고 넘은 사실은 상태 write 와 **같은 트랜잭션에서** activities 문서로 남는다
 * (formatClaimOverrideAudit). 상태만 바뀌고 근거가 없는 조합이 구조적으로 불가능해야
 * 이 티켓이 실제로 닫힌 것이다.
 *
 * ── ★"죽었다" 를 무엇으로 판정하는가 — 그리고 오판 비용 ───────────────────
 *
 * 후보 기준 넷과, 각각이 틀렸을 때 무슨 일이 나는가:
 *
 *   ① 플릿 부재 (agents/{claimedBy} 문서가 Firestore 에도 브리지에도 없다)
 *      → reclaimable. 오판 비용 ≈ 0. 보드가 그 에이전트를 모른다는 뜻이고, 문서가
 *        없으면 그는 자기 작업을 보고할 수도, 워치독에 잡힐 수도 없다. 위 실사례
 *        둘(28일/25일 적체)이 정확히 이 상태다.
 *   ② PTY status ∈ {stopped, error, killed}
 *      → reclaimable. 죽은 PTY 는 되살아나지 않는다. 앱 재시작 후 남은 유령 문서가
 *        여기 해당한다.
 *   ③ 무활동 시간 (N시간 동안 activity 도 PTY 출력도 없다)
 *      → ★reclaimable 아님. 이 기준만 시간을 본다. 버그 재현, 대형 리팩터, 벤치 실행
 *        같은 정상 장시간 작업이 정확히 이렇게 보인다. 시간은 **가시화의 신호이지
 *        권한의 근거가 아니다** — 이 갈래는 오케의 명시적 판단으로만 넘는다.
 *   ④ 프로세스 부재 (OS 레벨 pid 조회)
 *      → 여기서 안 쓴다. ②의 부분집합인데 조회 비용과 플랫폼 편차가 크고, PTY 는
 *        죽었는데 status 가 안 씻긴 케이스는 ②가 이미 잡는다.
 *
 * ★오판이 어느 방향으로 나는 게 덜 나쁜가 — 이게 위 배치의 근거다:
 *
 *   false-dead (살아있는데 죽었다 판정) → 두 에이전트가 같은 티켓·같은 브랜치를
 *     동시에 만진다. 커밋 경합, 작업 유실, 리뷰 불가. **되돌릴 수 없다.**
 *   false-alive (죽었는데 살았다 판정) → 티켓이 적체된다. 사람이나 오케가 보고
 *     넘기면 끝난다. **되돌릴 수 있고 비용은 지연뿐이다.**
 *
 * → 그래서 자동 판정은 **false-alive 쪽으로 치우치게** 설계했다. 증거 조회가
 *   실패하면 "부재" 가 아니라 `unknown` 이고, unknown 은 **거부**한다(fail-closed).
 *   부재의 증거와 증거의 부재는 다르다.
 *
 * ── 티켓 Lfy6jvpil57eYf896km5(무활동 감시 + 자동 회수) 와의 관계 ──────────
 *
 * 층위가 다르다. 여기는 **권한**("누가 이 티켓에 쓸 수 있는가, 그 사실을 어떻게
 * 남기는가"), 저기는 **정책**("언제 자동으로 개입하는가"). 합치지 않는다. 대신
 * 저쪽이 쓸 술어를 여기서 내보낸다: `assessClaimHolder()` 의 ③ silent 판정이
 * 그쪽의 감지 대상이고, 그쪽이 회수를 결정하면 이 모듈의 override 경로를 통해
 * 감사 기록과 함께 실행하면 된다. 두 티켓이 같은 어휘를 쓰되 각자 자기 층에 남는다.
 */

/** 플릿이 보고하는 status 중 "이 프로세스는 되살아나지 않는다" 를 뜻하는 값. */
export const DEAD_CLAIM_AGENT_STATUSES: readonly string[] = [
  "stopped",
  "error",
  "killed",
];

export type ClaimHolderVerdict =
  /** 플릿에 문서조차 없다 — 답할 주체가 존재하지 않는다. */
  | "absent"
  /** 문서는 있으나 PTY 가 죽었다. */
  | "stopped"
  /** 살아 있고 무활동일 뿐 — 권한 판단으로는 alive 와 같게 취급한다. */
  | "silent"
  /** 살아 있다. */
  | "alive"
  /** 조회 실패 — 증거가 없다. 부재의 증거가 아니다. */
  | "unknown";

/**
 * 이 시간 넘게 티켓에 아무 흔적이 없으면 `silent` 로 부른다.
 *
 * ★이 상수는 **권한을 열지 않는다** — silent 는 reclaimable 이 아니다. 오직
 * "살아 있지만 진행하지 않는다" 를 이름 붙여 오케·사람에게 보여주기 위한 것이고,
 * 티켓 Lfy6jvpil57eYf896km5(무활동 감시)가 소비할 술어다. 6시간으로 잡은 이유는
 * 정상 장시간 작업(대형 리팩터, 벤치 실행, 버그 재현)이 그 안에 대부분 한 번은
 * activity 를 남기기 때문이고, 넉넉히 잡아도 손해가 없기 때문이다 — 이 판정으로
 * 무언가를 뺏지 않으므로 임계가 커봐야 "덜 시끄럽다" 밖에 안 된다.
 */
export const SILENT_CLAIM_THRESHOLD_MS = 6 * 60 * 60 * 1000;

export interface ClaimHolderEvidence {
  /** Firestore agents/{id} 또는 브리지 플릿에서 찾았는가. */
  found: boolean;
  /** 조회 자체가 실패했는가(네트워크/권한). true 면 found 는 신뢰할 수 없다. */
  lookupFailed: boolean;
  /** 플릿이 보고한 status. */
  status?: string | null;
  /** 이 티켓의 마지막 흔적(projection.lastActivityAt) — epoch ms. */
  lastActivityAtMs?: number | null;
  /** 비교 기준 시각 — epoch ms. 없으면 무활동 판정을 건너뛴다. */
  nowMs?: number | null;
}

export interface ClaimHolderAssessment {
  verdict: ClaimHolderVerdict;
  /** 증거만으로 claim 을 회수해도 되는가. */
  reclaimable: boolean;
  /** 감사 기록에 그대로 실릴 한 줄 근거. */
  why: string;
}

/**
 * claim 보유자가 회수 가능한 상태인지 증거로 판정한다. Pure.
 *
 * ★unknown 은 절대 reclaimable 이 아니다 — 조회가 실패했다는 이유로 남의 claim 을
 * 뺏으면, 브리지가 잠깐 흔들릴 때마다 살아있는 작업이 강탈된다(false-dead).
 */
export function assessClaimHolder(
  evidence: ClaimHolderEvidence,
): ClaimHolderAssessment {
  if (evidence.lookupFailed) {
    return {
      verdict: "unknown",
      reclaimable: false,
      why: "claim 보유자 조회에 실패했습니다 — 부재를 확인하지 못했습니다(증거의 부재는 부재의 증거가 아닙니다).",
    };
  }
  if (!evidence.found) {
    return {
      verdict: "absent",
      reclaimable: true,
      why: "claim 보유자가 플릿에 문서조차 없습니다 — 답할 주체가 존재하지 않습니다.",
    };
  }
  const status = (evidence.status ?? "").trim().toLowerCase();
  if (status && DEAD_CLAIM_AGENT_STATUSES.includes(status)) {
    return {
      verdict: "stopped",
      reclaimable: true,
      why: `claim 보유자의 PTY 가 종료 상태입니다(status=${status}).`,
    };
  }
  const silentForMs = inactiveForMs(evidence);
  if (silentForMs !== null && silentForMs >= SILENT_CLAIM_THRESHOLD_MS) {
    return {
      verdict: "silent",
      reclaimable: false,
      why:
        `claim 보유자는 플릿에 살아 있으나(status=${status || "unknown"}) ` +
        `이 티켓에 ${formatDuration(silentForMs)} 동안 흔적이 없습니다. ` +
        "★살아 있는 프로세스를 무활동만으로 뺏지는 않습니다 — 오케스트레이터의 판단이 필요합니다.",
    };
  }
  return {
    verdict: "alive",
    reclaimable: false,
    why: `claim 보유자가 플릿에 살아 있습니다(status=${status || "unknown"}).`,
  };
}

function inactiveForMs(evidence: ClaimHolderEvidence): number | null {
  const last = evidence.lastActivityAtMs;
  const now = evidence.nowMs;
  if (typeof last !== "number" || typeof now !== "number") return null;
  if (!Number.isFinite(last) || !Number.isFinite(now)) return null;
  return Math.max(0, now - last);
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}시간`;
  return `${Math.floor(hours / 24)}일`;
}

export type ClaimAuthorityGrant =
  | "unclaimed"
  | "self"
  | "orchestrator"
  | "dead-claim";

export interface ClaimAuthorityInput {
  claimedBy?: string | null;
  /** 귀속용 워커 id. 오케/unknown 프로세스는 "" 로 들어온다. */
  actorAgentId?: string | null;
  /** env MARBLO_AGENT_ID 기준 오케 여부 — 모델이 인자로 지어낼 수 없는 축. */
  actorIsOrchestrator?: boolean;
  /** 오케 프로세스의 프로젝트(MARBLO_PROJECT). */
  actorProjectId?: string | null;
  taskProjectId?: string | null;
  /** override 사유. 남의 claim 을 넘을 때 필수. */
  reason?: string | null;
  /** 플릿 조회 결과. 미조회면 null → needsHolderEvidence 로 되돌려준다. */
  holder?: ClaimHolderAssessment | null;
}

export interface ClaimAuthorityDecision {
  allowed: boolean;
  grant: ClaimAuthorityGrant | null;
  /** 남의 claim 을 넘었는가 → 감사 기록 의무가 발생한다. */
  override: boolean;
  /** override 근거 한 줄(감사 기록용). */
  overrideWhy: string | null;
  /** 거부 사유 — 그대로 도구 응답으로 나간다. */
  error: string | null;
  /**
   * true 면 판정이 아직 안 끝났다. 호출부가 플릿을 조회해 holder 를 채워
   * 다시 부른다. (I/O 를 순수 로직 밖에 두기 위한 두 단계 판정.)
   */
  needsHolderEvidence: boolean;
}

const OVERRIDE_REASON_REQUIRED =
  "이 티켓은 다른 에이전트가 claim 중입니다. 넘어서 변경하려면 **사유**를 함께 주세요 — " +
  "사유 없는 override 는 거부합니다(상태만 바뀌고 근거가 없으면 다음 사람이 " +
  "'이거 왜 이렇게 됐지' 를 처음부터 다시 파야 합니다).";

/**
 * claim 을 쥔 티켓에 대한 쓰기 권한 판정. Pure — I/O 없음.
 *
 * 2단계다: holder 증거가 필요하면 `needsHolderEvidence: true` 로 한 번 되돌려주고,
 * 호출부가 플릿을 조회해 `holder` 를 채워 다시 부른다. 그래야 이 로직이 Firestore
 * 없이 유닛테스트된다.
 */
export function decideClaimAuthority(
  input: ClaimAuthorityInput,
): ClaimAuthorityDecision {
  const claimedBy = (input.claimedBy ?? "").trim();
  const actorAgentId = (input.actorAgentId ?? "").trim();
  const reason = (input.reason ?? "").trim();

  if (!claimedBy) {
    return grantOf("unclaimed", false, null);
  }
  if (actorAgentId && actorAgentId === claimedBy) {
    return grantOf("self", false, null);
  }

  if (input.actorIsOrchestrator) {
    // ★오케 권한은 **자기 프로젝트 안에서만** 성립한다. 프로젝트가 다르면 그건
    // 권한이 아니라 크로스테넌트 쓰기다 — 오케라는 이유로 열어주지 않는다.
    const actorProject = (input.actorProjectId ?? "").trim();
    const taskProject = (input.taskProjectId ?? "").trim();
    if (actorProject && taskProject && actorProject !== taskProject) {
      return deny(
        `Task belongs to project ${taskProject}; this orchestrator owns ${actorProject}. ` +
          "Orchestrator authority does not cross projects.",
      );
    }
    if (!reason) return deny(OVERRIDE_REASON_REQUIRED);
    return grantOf(
      "orchestrator",
      true,
      "오케스트레이터 권한 — 자기 프로젝트 보드의 티켓입니다.",
    );
  }

  // 워커는 자칭이 아니라 **증거**로만 넘는다. 아직 조회 안 했으면 조회를 요청한다.
  if (!input.holder) {
    return {
      allowed: false,
      grant: null,
      override: false,
      overrideWhy: null,
      error: null,
      needsHolderEvidence: true,
    };
  }
  if (input.holder.reclaimable) {
    if (!reason) return deny(OVERRIDE_REASON_REQUIRED);
    return grantOf("dead-claim", true, input.holder.why);
  }

  return deny(
    `Task is claimed by agent ${claimedBy}; only the claiming agent can update it. ` +
      `${input.holder.why} ` +
      "살아 있는 claim 은 뺏지 않습니다 — 담당을 깨우거나, 오케스트레이터에게 " +
      "상태 변경을 요청하세요(오케는 자기 프로젝트 티켓을 사유와 함께 넘을 수 있습니다).",
  );
}

function grantOf(
  grant: ClaimAuthorityGrant,
  override: boolean,
  overrideWhy: string | null,
): ClaimAuthorityDecision {
  return {
    allowed: true,
    grant,
    override,
    overrideWhy,
    error: null,
    needsHolderEvidence: false,
  };
}

function deny(error: string): ClaimAuthorityDecision {
  return {
    allowed: false,
    grant: null,
    override: false,
    overrideWhy: null,
    error,
    needsHolderEvidence: false,
  };
}

export interface ClaimOverrideAuditInput {
  grant: ClaimAuthorityGrant;
  /** 표시용 실제 actor id (오케면 orchestrator-<projectId>). */
  actorAgentId: string;
  claimedBy: string;
  /** 무엇을 했는가 — "status CLAIMED → DONE" / "activity 기록" 등. */
  action: string;
  reason: string;
  /** assessClaimHolder 의 근거 한 줄. */
  overrideWhy?: string | null;
}

const GRANT_LABELS: Record<ClaimAuthorityGrant, string> = {
  unclaimed: "claim 없음",
  self: "본인 claim",
  orchestrator: "오케스트레이터 권한",
  "dead-claim": "죽은 claim 회수",
};

/**
 * override 감사 기록 한 덩어리. **누가·무엇을·왜·어떤 근거로** 가 한 화면에 있어야
 * 다음 사람이 "이거 왜 닫혔지" 를 다시 파지 않는다. 시각(when)은 activities 문서의
 * createdAt 이 갖는다.
 */
export function formatClaimOverrideAudit(
  input: ClaimOverrideAuditInput,
): string {
  const lines = [
    `⚠️ claim override — claim 보유자(${input.claimedBy})가 아닌 ${
      input.actorAgentId || "unknown"
    } 이(가) 이 티켓을 변경했습니다.`,
    `권한: ${GRANT_LABELS[input.grant]}`,
  ];
  if (input.overrideWhy) lines.push(`근거: ${input.overrideWhy}`);
  lines.push(`대상: ${input.action}`);
  lines.push(`사유: ${input.reason}`);
  return lines.join("\n");
}
