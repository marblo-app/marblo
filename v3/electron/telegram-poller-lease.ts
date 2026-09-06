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

/**
 * ★리스 시간 값 (티켓 4wLWuuzWwGJ6O965nYnw). 두 부등식이 규칙이다:
 *
 *   (1) 갱신 주기 < 롱폴 주기      — 안 그러면 폴 한 바퀴 도는 동안 갱신이
 *                                    한 번도 안 될 수 있다
 *   (2) TTL ≥ 갱신 주기 × 3        — 네트워크 blip 으로 2회 놓쳐도 안 뺏긴다
 *
 * ★그런데 (2)를 **명목 갱신 주기로 계산하면 안 된다.** `maybeRenewLease` 는
 * 폴 루프의 **맨 위**에서만 불리고, 루프 한 바퀴에는 롱폴
 * (`DEFAULT_LONG_POLL_SECONDS = 25`) 이 통째로 들어 있다. 즉 명목 20초로
 * 잡아도 **실효 갱신 간격은 25초**(폴 한 바퀴)다. 종전 값 30초는 이 때문에
 * 실효 50초가 됐고(25초 바퀴에서 한 번 건너뛴다), TTL 90초와 합치면 갱신
 * **한 번만 실패해도** 100초 > 90초로 살아 있는 채 리스를 잃었다 — 두 기기가
 * 서로 뺏는 핑퐁의 씨앗이다.
 *
 * ★핑퐁이 이 설계의 최대 위험이므로 실효 간격 기준으로 잡는다:
 *
 *   갱신 20초  — 롱폴 25초보다 짧다 (1) ✓. 실효 간격은 25초로 고정된다.
 *   TTL  90초  — 실효 25초 × 3 = 75초에 15초 여유. (2) 는 명목으로도 충족
 *                (90 ≥ 20×3=60). ★오케 제안 75초는 실효 기준으로 정확히
 *                경계값(25×3=75)이라 여유가 0이다. 그래서 90초로 둔다.
 *   재시도 15초 — TTL 보다 짧아야 만료 즉시 인수가 이어진다.
 *
 * 최악 복구 시간 ≈ TTL 90초 + 폴 1주기 25초 ≈ 115초. 보고 채널로 충분하다.
 * 인계 조건은 `renewedAt + TTL < now`(= expiresAt < now) 하나뿐이다 —
 * {@link TelegramPollerLeaseManager.isLive} 참고.
 *
 * ★★TTL 은 이 파일 혼자 정하는 값이 아니다 — `v3/firestore.rules` 가 같은 수를
 * 하드코딩한다:
 *
 *     firestore.rules:441
 *     || request.time >= leaseIn(resource.data).renewedAt + duration.value(90, 's');
 *
 * 즉 **서버도 90초 전에는 인수를 거부한다.** 여기 TTL 을 그보다 **짧게** 잡으면
 * 클라이언트는 "만료됐다"고 판정해 인수를 시도하는데 룰이 그 쓰기를 거부하고,
 * 그 거부는 fail-open 으로 흡수되어 `granted:true` 가 된다 — **가드가 스스로
 * 꺼진 채 두 기기가 같이 폴링한다.** 이 티켓이 없애려는 바로 그 상태다.
 *
 * ★그러므로 규칙은 셋이다: 갱신 < 롱폴, TTL ≥ 갱신×3, 그리고
 * **TTL ≥ firestore.rules 의 인수 유예(90초)**. 이 값을 줄이려면 룰을 먼저
 * 바꾸고 배포한 뒤에 줄여야 한다(순서가 반대면 위 자기무력화가 난다).
 */
export const TELEGRAM_LEASE_TTL_MS = 90_000;
/** 리스 갱신 주기(ms). ★롱폴 25초보다 짧아야 한다 — 위 (1). */
export const TELEGRAM_LEASE_RENEW_MS = 20_000;
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
  /**
   * ★원자적 인계 (티켓 4wLWuuzWwGJ6O965nYnw). `expected` 와 문서의 현재 리스가
   * **같을 때만** 쓴다. 같지 않으면 아무것도 쓰지 않고 false 를 돌려준다.
   *
   * 왜 필요한가: 종전 획득은 read → (판정) → write 였고 트랜잭션이 아니었다.
   * 두 기기가 같은 만료 리스를 동시에 보면 **둘 다** "빈 자리"로 판정하고 둘 다
   * 쓴다 — 원래 문제(둘 다 폴링)로 그대로 돌아간다. 획득 직후 되읽기
   * (confirmOnAcquire)는 그 창을 좁힐 뿐 닫지는 못한다.
   *
   * `expected` 가 null 이면 "지금 리스가 없어야 한다"는 뜻이다.
   *
   * ★**필수 메서드다**(리뷰 지적, PR #1490). 선택으로 두면 이 메서드가 없는
   * 게이트웨이가 조용히 원자성 없이 돌 수 있다 — "오늘은 프로덕션이 다 갖췄다"
   * 는 사실은 리팩터 한 번이면 썩는다. 필수로 두면 타입체커가 그 경로를
   * 애초에 만들지 못하게 한다. 실패는 **던져야 한다**(다른 메서드와 같은 규율):
   * 조용히 false 를 돌려주면 매니저가 "졌다"로 오인해 살아 있는 우리 폴링을
   * 멈춘다.
   */
  compareAndSetLease(
    projectId: string,
    expected: TelegramPollerLease | null,
    lease: TelegramPollerLeaseDraft,
  ): Promise<boolean>;
}

/**
 * 두 리스가 **같은 리스**인가. 원자적 인계의 compare 축이다.
 *
 * ★renewedAt 까지 본다 — holderId 만 보면 상대가 그 사이 갱신한 것을 놓친다.
 * holderUid 는 게이트웨이가 붙이는 값이라 비교에 넣지 않는다.
 */
export function sameTelegramLease(
  a: TelegramPollerLease | null,
  b: TelegramPollerLease | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.holderId === b.holderId &&
    a.tokenHash === b.tokenHash &&
    a.renewedAt === b.renewedAt
  );
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
 *   held-by-other — 타인의 유효한 리스를 **지금 읽어서** 확인했다.
 *   held-by-cached— ★읽기가 실패했지만, **마지막으로 성공한 읽기에서** 타인이
 *                   쥐고 있는 것을 봤고 그 리스가 아직 만료되지 않았다. 즉
 *                   "모르니까 일단 한다" 가 아니라 "남이 쥔 걸 방금 봤으니
 *                   안 한다". 기억이 TTL 을 넘겨 낡으면 fail-open 으로 돌아간다.
 *   fail-open     — 읽기/쓰기가 실패했고 막을 근거도 없다. 그대로 진행한다.
 */
export type TelegramLeaseOutcome =
  | "acquired"
  | "renewed"
  | "taken-over"
  | "other-bot"
  | "held-by-other"
  | "held-by-cached"
  | "fail-open";

export interface TelegramLeaseDecision {
  /** ★false 는 outcome 이 "held-by-other" 또는 "held-by-cached" 일 때뿐이다. */
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
}

/**
 * 기기 간 폴러 리스 매니저.
 *
 * ★원자성 (티켓 4wLWuuzWwGJ6O965nYnw 에서 닫혔다). 종전 이 자리에는 "정직한
 * 한계" 가 적혀 있었다 — 게이트웨이가 read/write 두 개뿐이라 획득이
 * read-modify-write 이고, 두 기기가 밀리초 단위로 겹치면 **둘 다** "빈 자리"를
 * 볼 수 있으며, 획득 직후 되읽기는 그 창을 **좁힐 뿐 닫지 못한다** 는 것이었다.
 *
 * 그 창은 이제 {@link TelegramLeaseRemote.compareAndSetLease} 로 닫혀 있다:
 * 우리가 판정 근거로 읽은 리스가 그대로일 때만 쓰고, 아니면 진다. 그래서
 * 되읽기 확인 경로는 통째로 없앴다 — 두 개의 상호배제 장치를 겹쳐 두면
 * 어느 쪽이 실제로 지키고 있는지 아무도 말할 수 없게 된다.
 *
 * ★변하지 않은 것: 최악이 "현상 유지"인 쪽으로 기운다는 원칙이다. 오류는
 * 여전히 전부 fail-open 이고(아래 참고), 리스 때문에 텔레그램이 영영 죽는
 * 경로는 만들지 않는다. 다만 그 fail-open 은 이제 "모르니까 일단 한다" 가
 * 아니라 **"남이 쥔 걸 방금 봤으면 안 한다"** 로 좁혀져 있다.
 */
export class TelegramPollerLeaseManager implements TelegramLeaseGate {
  private readonly deps: TelegramLeaseManagerDeps;

  /**
   * ★마지막으로 **성공한** 읽기가 본 리스 (티켓 4wLWuuzWwGJ6O965nYnw).
   *
   * fail-open 을 "모르니까 일단 폴링한다" 에서 **"남이 쥔 걸 방금 봤으면 안
   * 한다"** 로 좁히기 위한 유일한 상태다. projectId 별로 마지막 관측을 들고
   * 있다가, 이후 읽기가 실패하면 그 기억으로 판정한다.
   *
   * ★왜 fail-closed 로 뒤집지 않는가: Firestore 장애 때 텔레그램이 통째로
   * 죽는다. 그건 지금(겹쳐서 절반 유실)보다 명백히 나쁘다 — 이 파일 헤더의
   * 최상위 제약 그대로다. 그래서 막는 근거를 **실제로 본 것**으로 한정하고,
   * 그 기억마저 TTL 을 넘겨 낡으면 fail-open 으로 되돌아간다. 막힘은 언제나
   * 유한하다.
   */
  private readonly lastGoodRead = new Map<string, TelegramPollerLease | null>();

  constructor(deps: TelegramLeaseManagerDeps) {
    this.deps = deps;
  }

  /**
   * 읽기가 실패했을 때의 판정. 마지막으로 성공한 읽기에서 **다른 기기가 같은
   * 봇의 리스를 쥐고 있었고** 그 리스가 아직 만료되지 않았으면 막는다.
   * 그 밖에는(기억 없음·빈 자리였음·다른 봇·이미 만료) fail-open.
   */
  private denyFromMemory(
    projectId: string,
    tokenHash: string,
  ): TelegramLeaseDecision | null {
    if (!this.lastGoodRead.has(projectId)) return null;
    const remembered = this.lastGoodRead.get(projectId) ?? null;
    if (!remembered) return null; // 방금 봤을 때 빈 자리였다 → 막을 근거 없음
    if (remembered.holderId === this.deps.holderId()) return null; // 우리 것
    if (remembered.tokenHash !== tokenHash) return null; // 애초에 경쟁 아님
    if (!this.isLive(remembered)) return null; // ★기억이 낡았다 → fail-open
    return {
      granted: false,
      outcome: "held-by-cached",
      observed: remembered,
      failOpenReason: null,
    };
  }

  /** 성공한 읽기를 기억한다. 다음 읽기 실패의 유일한 판정 근거가 된다. */
  private rememberRead(
    projectId: string,
    lease: TelegramPollerLease | null,
  ): void {
    this.lastGoodRead.set(projectId, lease);
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
   * 상대 리스가 아직 유효한가. 만료됐으면 false(=인수 가능).
   *
   * ★미래로 보이는 리스는 **살아 있는 것으로 본다** (티켓 4wLWuuzWwGJ6O965nYnw).
   *
   * 종전에는 `age < -TTL` 을 "고장난 시계"로 보고 인수했다. 그 판단은 위
   * 파일 헤더가 쓴 전제 — *"renewedAt 은 상대 기기의 벽시계"* — 위에 서 있었고,
   * 그 전제라면 앞선 시계를 가진 기기가 우리를 영원히 막는 경로가 실제로
   * 있었다. ★그런데 구현은 그렇지 않다. `createTelegramLeaseRemote.writeLease`
   * 는 renewedAt 을 `serverTimestamp()` 로 쓴다(telegram-channel-sync.ts) —
   * **모든 기기의 리스가 한 서버 시계 위에 있다.** 그러면 리스가 미래로 보이는
   * 원인은 상대의 시계가 아니라 **우리 시계가 뒤처진 것** 하나뿐이다.
   *
   * 즉 종전 분기는 존재하지 않는 위험을 막으면서 실재하는 위험을 만들고 있었다:
   * 잠에서 깨어 NTP 재동기 전인 노트북(2026-09-06 의 "원격으로 켠 맥북에어"가
   * 정확히 이 모양이다)이 **정상 보유자의 살아 있는 리스를 즉시 인수**한다.
   * 그러면 두 기기가 같은 봇을 폴링하고, 리스는 막으라고 만든 바로 그것을
   * 못 막는다.
   *
   * ★그래서 안전한 쪽으로 기운다 — 미래로 보이면 물러난다. 그리고 이것이
   * "영영 못 받는" 상태를 만들지 않는다는 것이 중요하다: 보유자가 갱신을
   * 멈추면 renewedAt 은 고정되는데 우리 로컬 시각은 계속 흐르므로 age 는
   * 반드시 TTL 을 넘는다. 회수가 시계 차이만큼 **늦어질 뿐, 사라지지 않는다**
   * (테스트가 그 경계를 고정한다). 늦은 인수는 이중 폴링보다 낫다.
   */
  private isLive(lease: TelegramPollerLease): boolean {
    const age = this.now() - lease.renewedAt;
    if (age > this.ttl()) return false; // 자연 만료 — 유일한 인수 사유
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
      this.rememberRead(projectId, observed);
    } catch (err) {
      // ★막을 근거를 **실제로 본 적이 있을 때만** 막는다. 아니면 fail-open.
      return this.denyFromMemory(projectId, tokenHash) ?? failOpen("read", err);
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

    // ★원자적 인계 (티켓 4wLWuuzWwGJ6O965nYnw). 우리가 판정 근거로 읽은 그
    // 리스가 **그대로일 때만** 쓴다. 종전 read → 판정 → write 는 트랜잭션이
    // 아니어서 두 기기가 같은 만료 리스를 동시에 보면 둘 다 잡았고, 그러면
    // 리스가 막으라고 만든 바로 그 상태로 되돌아간다. 획득 직후 되읽기는 그
    // 창을 좁힐 뿐 닫지 못했다 — 그래서 그 경로째로 없앴다.
    let won: boolean;
    try {
      won = await this.deps.remote.compareAndSetLease(
        projectId,
        observed,
        this.mine(tokenHash),
      );
    } catch (err) {
      // ★fail-open: 리스를 못 썼다고 폴링을 막지 않는다.
      return failOpen("cas", err);
    }
    if (won) {
      return { granted: true, outcome, observed, failOpenReason: null };
    }

    // 졌다 = 우리가 읽은 뒤 누군가 리스를 바꿨다. 상대 이름을 붙여 돌려주되,
    // 읽기까지 실패하면 기억으로 판정한다(그것도 없으면 fail-open).
    let current: TelegramPollerLease | null;
    try {
      current = await this.deps.remote.readLease(projectId);
      this.rememberRead(projectId, current);
    } catch (err) {
      return (
        this.denyFromMemory(projectId, tokenHash) ?? failOpen("cas-read", err)
      );
    }
    // ★진 이상 이번 턴에는 폴링을 시작하지 않는다. 상대가 우리를 막는 모양이
    // 아니더라도(그 사이 또 바뀌었더라도) 다음 시도에서 다시 판정하면 된다 —
    // 리스 재시도 간격은 TTL 보다 짧으므로 이 보수적 선택의 비용은 한 주기다.
    return {
      granted: false,
      outcome: "held-by-other",
      observed: current,
      failOpenReason: null,
    };
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
      this.rememberRead(projectId, observed);
    } catch (err) {
      return this.denyFromMemory(projectId, tokenHash) ?? failOpen("read", err);
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

    // ★갱신도 원자적으로. 우리가 읽은 상태가 그대로일 때만 쓴다 — 그 사이
    // 다른 기기가 정당하게 인수했다면 우리는 져야 한다.
    let won: boolean;
    try {
      won = await this.deps.remote.compareAndSetLease(
        projectId,
        observed,
        this.mine(tokenHash),
      );
    } catch (err) {
      return failOpen("cas", err);
    }
    if (!won) {
      return {
        granted: false,
        outcome: "held-by-other",
        observed,
        failOpenReason: null,
      };
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
