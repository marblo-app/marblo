/**
 * telegram-poller-lease — 한 봇의 getUpdates 소유권을 **기기 간에** 확정하는 리스
 * (티켓 hAzP05kOTxggd8LhZGwT).
 *
 * ★왜 필요한가 (2026-09-05 실측).
 *
 * 맥북프로의 마블로와 맥미니의 마블로가 같은 봇 토큰으로 동시에 getUpdates 를
 * 돌고 있었다. 양쪽 telegram-channels.json 에 같은 projectId + 같은 봇이
 * enabled=true 로 들어 있었기 때문이다. 텔레그램은 봇당 소비자가 하나뿐이라
 * 둘은 서로를 HTTP 409 로 강탈했고, 각자 5초 백오프 후 재시도해서 12초 주기의
 * 시소가 됐다. 인바운드는 동전던지기가 됐고, 지는 쪽으로 간 메시지는 그대로
 * 유실됐다.
 *
 * #1415 가 고친 것은 **한 앱 안의** 중복 루프다(telegram-poller 의 토큰 단위
 * dedup + 중복 시작 가드). 그 가드들은 한 프로세스의 메모리만 보므로 다른 맥에
 * 대해서는 아무 것도 모른다. 이 모듈이 그 위에 얹는 기기 간 층이다.
 *
 * ★설계 — 토큰은 절대 저장하지 않는다.
 *
 * 봇 토큰은 보안 정책상 기기 간 동기화되지 않는다(telegram-channel-sync 참고:
 * 토큰은 ~/.marblo 밖으로 나가지 않는다). 그래서 리스에도 토큰을 넣지 않고
 * **해시만** 넣는다 — 두 기기가 같은 봇을 물고 있다는 판정은 해시 일치로만
 * 한다. 해시가 다르면 애초에 경쟁이 아니므로 아무도 막지 않는다.
 *
 * ★설계 — 사람이 손으로 푸는 상태를 만들지 않는다.
 *
 * 리스는 짧게(기본 90초) 만료되고 30초마다 갱신된다. 앱이 죽거나 맥이 잠들면
 * 갱신이 멈추고 90초 뒤 자연 만료되어 다른 기기가 그냥 이어받는다. "리스가
 * 걸려서 안 됩니다, 풀어주세요" 같은 상태는 존재하지 않는다.
 *
 * ★★설계 — fail-open 이 이 모듈의 최상위 제약이다.
 *
 * 리스 읽기/쓰기가 실패하면(오프라인, 익명 인증, 권한, Firestore 장애) 폴링을
 * **막지 않는다**. 리스는 두 기기가 겹칠 때의 손해를 줄이는 장치일 뿐이고,
 * 리스 때문에 텔레그램이 영영 죽는 경로는 지금(겹쳐서 절반 유실)보다 명백히
 * 나쁘다. 그래서 이 파일의 모든 오류 경로는 granted:true 로 끝난다 —
 * {@link TelegramLeaseDecision.outcome} 이 "fail-open" 으로 남아 사용자/저널이
 * "가드가 꺼진 채로 돌고 있다"는 사실을 볼 수 있게만 한다.
 *
 * 시계 왜곡: renewedAt 은 **상대 기기의 벽시계**다. TTL 90초에 비해 통상 NTP
 * 오차는 무시할 만하지만, 시계가 심하게 앞선 기기가 쓴 리스가 우리를 영원히
 * 막는 경로는 막아야 한다 — 미래로 TTL 이상 벗어난 renewedAt 은 고장난 시계로
 * 보고 만료 취급한다(위 fail-open 원칙의 연장).
 */

import * as crypto from "node:crypto";
import * as os from "node:os";

/** 리스 만료(ms). 이 시간 동안 갱신이 없으면 다른 기기가 인수한다. */
export const TELEGRAM_LEASE_TTL_MS = 90_000;
/** 리스 갱신 주기(ms). TTL 의 1/3 — 한 번 걸러 실패해도 만료되지 않는다. */
export const TELEGRAM_LEASE_RENEW_MS = 30_000;
/** 남의 리스에 막혔을 때 재시도 간격(ms). TTL 보다 짧아야 인수가 빠르다. */
export const TELEGRAM_LEASE_RETRY_MS = 15_000;

/**
 * 프로젝트 문서에 실리는 리스 레코드. ★botToken 은 어떤 형태로도 들어가지
 * 않는다 — tokenHash 만이 "같은 봇인가"의 유일한 판정 근거다.
 */
export interface TelegramPollerLease {
  /** 리스 보유 기기의 machineId(app-state.json 의 안정 식별자). */
  holderId: string;
  /** Firestore 인증 주체. 룰이 이 값과 request.auth.uid 의 일치를 강제한다. */
  holderUid: string;
  /** 사람이 읽는 기기 이름(호스트명). UI 문구에 그대로 쓰인다. */
  hostLabel: string;
  /** 봇 토큰의 sha256 앞 16자. 토큰 자체는 절대 저장하지 않는다. */
  tokenHash: string;
  /** 마지막 갱신 시각(보유 기기의 epoch ms). */
  renewedAt: number;
}

/** 쓰기 직전의 리스. 인증 UID와 갱신 시각은 Firestore 게이트웨이가 붙인다. */
export type TelegramPollerLeaseDraft = Omit<
  TelegramPollerLease,
  "holderUid" | "renewedAt"
>;

/**
 * 리스 저장소 게이트웨이 — Firestore 접근을 세 메서드로 좁혀 리스 로직을
 * firebase 없이 단위 테스트할 수 있게 한다(telegram-channel-sync 의
 * TelegramMetaRemote 와 같은 패턴). 실패는 **던져야 한다** — 조용히 null 을
 * 돌려주면 매니저가 "빈 자리"로 오인해 가드가 있다고 착각한다.
 */
export interface TelegramLeaseRemote {
  readLease(projectId: string): Promise<TelegramPollerLease | null>;
  writeLease(projectId: string, lease: TelegramPollerLeaseDraft): Promise<void>;
  clearLease(projectId: string): Promise<void>;
}

/** 봇 토큰의 로그·저장 안전 지문. 토큰 자체는 절대 반환하지 않는다. */
export function telegramLeaseTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function timestampMillis(value: unknown): number {
  if (!value || typeof value !== "object") return NaN;
  const candidate = value as { toMillis?: unknown };
  if (typeof candidate.toMillis !== "function") return NaN;
  const millis = candidate.toMillis();
  return typeof millis === "number" ? millis : NaN;
}

/** 원격 문서의 임의 값을 신뢰-경계 검증해 리스로 정규화한다. 불완전하면 null. */
export function parseTelegramLease(raw: unknown): TelegramPollerLease | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const holderId = typeof m.holderId === "string" ? m.holderId.trim() : "";
  const holderUid = typeof m.holderUid === "string" ? m.holderUid.trim() : "";
  const tokenHash = typeof m.tokenHash === "string" ? m.tokenHash.trim() : "";
  const renewedAt =
    typeof m.renewedAt === "number"
      ? m.renewedAt
      : timestampMillis(m.renewedAt);
  if (!holderId || !holderUid || !tokenHash || !Number.isFinite(renewedAt))
    return null;
  return {
    holderId,
    holderUid,
    hostLabel:
      typeof m.hostLabel === "string" && m.hostLabel.trim()
        ? m.hostLabel
        : holderId,
    tokenHash,
    renewedAt,
  };
}

/**
 * 리스 판정 결과의 이름.
 *
 *   acquired      — 빈 자리를 새로 잡았다.
 *   renewed       — 우리가 이미 보유 중이던 리스를 갱신했다.
 *   taken-over    — 만료된 (또는 시계가 고장난) 타인의 리스를 인수했다.
 *   other-bot     — 리스는 남 것이지만 tokenHash 가 달라 애초에 경쟁이 아니다.
 *   held-by-other — ★유일하게 폴링을 막는 결과. 타인의 유효한 리스.
 *   fail-open     — 읽기/쓰기가 실패했다. 막지 않고 그대로 진행한다.
 */
export type TelegramLeaseOutcome =
  | "acquired"
  | "renewed"
  | "taken-over"
  | "other-bot"
  | "held-by-other"
  | "fail-open";

export interface TelegramLeaseDecision {
  /** ★false 는 outcome==="held-by-other" 일 때뿐이다. 오류는 전부 true. */
  granted: boolean;
  outcome: TelegramLeaseOutcome;
  /** 판정 근거가 된 상대 리스(우리 것이거나 없으면 null). */
  observed: TelegramPollerLease | null;
  /** fail-open 일 때 토큰 없는 한 줄 사유. 아니면 null. */
  failOpenReason: string | null;
}

/** 폴러가 의존하는 리스 게이트의 최소 형태(테스트가 이 모양만 흉내내면 된다). */
export interface TelegramLeaseGate {
  acquire(projectId: string, token: string): Promise<TelegramLeaseDecision>;
  renew(projectId: string, token: string): Promise<TelegramLeaseDecision>;
  release(projectId: string): Promise<void>;
}

export interface TelegramLeaseManagerDeps {
  remote: TelegramLeaseRemote;
  /** 이 기기의 안정 식별자(machineId). */
  holderId: () => string;
  /** 사람이 읽는 기기 이름. 기본 os.hostname(). */
  hostLabel?: () => string;
  /** 리스 만료(ms). 기본 90초. */
  ttlMs?: number;
  /** 주입 가능한 시계(테스트). */
  now?: () => number;
  /**
   * 잡은 직후 되읽어 우리 것인지 확인할지. 기본 true — 두 기기가 거의 동시에
   * 빈 자리를 본 경우(read-modify-write 경합) 나중에 쓴 쪽만 살아남게 한다.
   * 갱신 경로에서는 하지 않는다(왕복 비용 대비 이득이 없다).
   */
  confirmOnAcquire?: boolean;
}

/**
 * 기기 간 폴러 리스 매니저.
 *
 * ★원자성에 대한 정직한 한계. 게이트웨이가 read/write 두 개뿐이라 획득은
 * read-modify-write 이고, 트랜잭션이 아니다. 두 기기가 밀리초 단위로 겹치면
 * 둘 다 "빈 자리"를 볼 수 있다 — 그래서 획득 직후 되읽어(confirmOnAcquire)
 * 진 쪽이 스스로 물러난다. 이것도 완벽한 상호배제는 아니지만, 이 티켓이 고치는
 * 실제 상황(수 분 간격으로 켜진 두 맥)에는 충분하고, 실패해도 결과는 "지금과
 * 같음"(둘 다 폴링 → 409 시소)이지 "둘 다 멈춤"이 아니다. 최악이 현상 유지인
 * 쪽으로 기울인 설계다.
 */
export class TelegramPollerLeaseManager implements TelegramLeaseGate {
  private readonly deps: TelegramLeaseManagerDeps;

  constructor(deps: TelegramLeaseManagerDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private ttl(): number {
    return this.deps.ttlMs ?? TELEGRAM_LEASE_TTL_MS;
  }

  private mine(tokenHash: string): TelegramPollerLeaseDraft {
    return {
      holderId: this.deps.holderId(),
      hostLabel: this.deps.hostLabel?.() ?? os.hostname(),
      tokenHash,
    };
  }

  /**
   * 상대 리스가 아직 유효한가. 만료됐거나, 시계가 미래로 TTL 이상 벗어나
   * 신뢰할 수 없으면 false(=인수 가능).
   */
  private isLive(lease: TelegramPollerLease): boolean {
    const age = this.now() - lease.renewedAt;
    if (age > this.ttl()) return false; // 자연 만료
    if (age < -this.ttl()) return false; // 시계 고장 — 영구 차단을 막는다
    return true;
  }

  /**
   * 폴링을 시작하기 전에 리스를 잡는다. granted:false 는 **타인의 유효한
   * 리스**일 때 하나뿐이며, 그 밖의 모든 경로(오류 포함)는 granted:true 다.
   */
  async acquire(
    projectId: string,
    token: string,
  ): Promise<TelegramLeaseDecision> {
    const tokenHash = telegramLeaseTokenHash(token);
    const me = this.deps.holderId();

    let observed: TelegramPollerLease | null;
    try {
      observed = await this.deps.remote.readLease(projectId);
    } catch (err) {
      // ★fail-open: 리스를 못 읽었다고 폴링을 막지 않는다.
      return failOpen("read", err);
    }

    if (observed) {
      if (observed.holderId !== me && observed.tokenHash === tokenHash) {
        if (this.isLive(observed)) {
          // ★유일한 거절 경로.
          return {
            granted: false,
            outcome: "held-by-other",
            observed,
            failOpenReason: null,
          };
        }
      }
    }

    const outcome: TelegramLeaseOutcome = !observed
      ? "acquired"
      : observed.holderId === me
        ? "renewed"
        : observed.tokenHash !== tokenHash
          ? "other-bot"
          : "taken-over";

    try {
      await this.deps.remote.writeLease(projectId, this.mine(tokenHash));
    } catch (err) {
      // ★fail-open: 리스를 못 썼다고 폴링을 막지 않는다.
      return failOpen("write", err);
    }

    if (this.deps.confirmOnAcquire === false || outcome === "renewed") {
      return { granted: true, outcome, observed, failOpenReason: null };
    }

    // 경합 확인 — 우리가 쓴 뒤에 남이 덮었으면 우리가 진 것이다.
    let confirmed: TelegramPollerLease | null;
    try {
      confirmed = await this.deps.remote.readLease(projectId);
    } catch (err) {
      return failOpen("confirm", err);
    }
    if (
      confirmed &&
      confirmed.holderId !== me &&
      confirmed.tokenHash === tokenHash &&
      this.isLive(confirmed)
    ) {
      return {
        granted: false,
        outcome: "held-by-other",
        observed: confirmed,
        failOpenReason: null,
      };
    }
    return { granted: true, outcome, observed, failOpenReason: null };
  }

  /**
   * 폴링을 계속하면서 주기적으로 부르는 갱신. acquire 와 같은 규칙이되
   * 되읽기 확인은 하지 않는다. granted:false 면 **뺏긴 것**이므로 호출자는
   * 폴링을 멈추고 게이트로 돌아가야 한다.
   */
  async renew(
    projectId: string,
    token: string,
  ): Promise<TelegramLeaseDecision> {
    const tokenHash = telegramLeaseTokenHash(token);
    const me = this.deps.holderId();

    let observed: TelegramPollerLease | null;
    try {
      observed = await this.deps.remote.readLease(projectId);
    } catch (err) {
      return failOpen("read", err);
    }

    if (
      observed &&
      observed.holderId !== me &&
      observed.tokenHash === tokenHash &&
      this.isLive(observed)
    ) {
      return {
        granted: false,
        outcome: "held-by-other",
        observed,
        failOpenReason: null,
      };
    }

    const outcome: TelegramLeaseOutcome = !observed
      ? "acquired"
      : observed.holderId === me
        ? "renewed"
        : observed.tokenHash !== tokenHash
          ? "other-bot"
          : "taken-over";

    try {
      await this.deps.remote.writeLease(projectId, this.mine(tokenHash));
    } catch (err) {
      return failOpen("write", err);
    }
    return { granted: true, outcome, observed, failOpenReason: null };
  }

  /**
   * 우리 리스를 놓는다(정상 종료). 남의 리스는 절대 지우지 않는다 — 그러면
   * 리스가 상호배제가 아니라 서로 밀어내기가 된다. 실패는 무시한다: 놓지
   * 못해도 TTL 이 알아서 정리한다(사람 개입 없음).
   */
  async release(projectId: string): Promise<void> {
    try {
      const observed = await this.deps.remote.readLease(projectId);
      if (!observed || observed.holderId !== this.deps.holderId()) return;
      await this.deps.remote.clearLease(projectId);
    } catch {
      /* ★fail-open: 못 놓아도 TTL 만료로 자연 회수된다. */
    }
  }
}

/** 오류를 토큰 없는 한 줄로 줄여 fail-open 판정을 만든다. */
function failOpen(stage: string, err: unknown): TelegramLeaseDecision {
  const detail = err instanceof Error ? err.message : String(err);
  return {
    granted: true,
    outcome: "fail-open",
    observed: null,
    // 리스 경로는 봇 토큰을 만지지 않으므로 메시지에 토큰이 섞일 수 없다.
    failOpenReason: `${stage}: ${detail.slice(0, 160)}`,
  };
}
