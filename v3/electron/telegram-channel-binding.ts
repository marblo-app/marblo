/**
 * telegram-channel-binding — "이 프로젝트의 텔레그램을 **어느 기기가 인증했는가**"
 * 라는 지속 사실 (티켓 t5X4CUwr4LqbEZNRpeEZ).
 *
 * ★★★ 이 모듈이 막는 것과 막지 못하는 것 — 먼저 정직하게 긋는다.
 *
 * 이 모듈도, 짝이 되는 firestore.rules 도 **다른 기기의 폴링을 차단하지 못한다.**
 * 룰은 우리 Firestore 문서 접근만 통제한다. 다른 맥에 깔린 마블로가 자기 로컬
 * ~/.marblo/telegram-channels.json 의 토큰으로 api.telegram.org 를 직접 부르는
 * 것은 우리 룰이 관여할 수 있는 경로가 아예 아니다.
 *
 * 2026-09-05 사고가 정확히 그것이었다: 맥미니 마블로(8/22 빌드)가 같은 프로젝트·
 * 같은 봇을 enabled=true 로 물고 있어서 맥북프로의 getUpdates 를 6.4초마다 409 로
 * 강탈했다. 세 시간 넘게 인바운드가 동전던지기였다. 그 맥미니는 우리 Firestore
 * 문서를 한 번도 건드리지 않고 그렇게 할 수 있었다 — 그러므로 어떤 룰을 썼더라도
 * 오늘 사고는 막히지 않았다.
 *
 * 그래서 이 층이 실제로 주는 것은 셋이다:
 *   1. **자동 계승 차단** — 다른 기기가 인증한 채널이 이 기기에서 *저절로*
 *      켜지지 않는다. 사람이 여기서 명시적으로 켜는 것은 막지 않는다.
 *   2. **사실 표시** — "이 채널은 <기기명>에서 인증됐습니다"를 화면에 올린다.
 *      그리고 여기서 켜면 앞 기기가 잃는다는 것까지 같이 말한다(봇당 소비자는
 *      하나다). 사용자가 모르고 뺏는 일이 없게.
 *   3. **탐지 가능성** — 귀속이 언제 누구에게 넘어갔는지 문서에 남는다.
 *      룰은 그 기록을 위조 불가능하게 만든다(boundByUid == request.auth.uid).
 *
 * 차단이 아니라 탐지다. 이 문장을 지우지 마라 — "룰로 막았다"고 적으면 다음에
 * 같은 사고가 났을 때 아무도 이 경로를 의심하지 않는다.
 *
 * ★#1419 의 리스와 무엇이 다른가 (혼동 금지).
 *
 *   telegram-poller-lease  — 90초 TTL 의 **협조적 소유권**. "지금 이 순간 누가
 *                            폴링하고 있는가". 만료되면 그냥 넘어간다. 사람이
 *                            손으로 푸는 상태가 없다.
 *   이 모듈(binding)       — 만료 없는 **지속 사실**. "누가 여기서 인증했는가".
 *                            사람이 다른 기기에서 토큰을 다시 넣어 인수할 때만
 *                            바뀐다.
 *
 * 다른 수명, 다른 목적이다. 같은 기판(machineId · tokenHash · hostLabel)을 쓰되
 * 판정 로직을 중복 구현하지 않는다 — tokenHash 는 리스 모듈의
 * {@link telegramLeaseTokenHash} 를 그대로 재사용한다.
 *
 * ★fail-open 이 여기서도 최상위 제약이다 (#1419 규율 계승).
 *
 * 귀속을 못 읽거나(오프라인·익명 인증·권한·Firestore 장애) 문서가 깨져 있으면
 * 판정은 "unknown" 이고 **아무것도 막지 않는다**. 귀속 검사 때문에 텔레그램이
 * 영영 죽는 경로는 지금(겹쳐서 절반 유실)보다 명백히 나쁘다. 이 파일의 모든
 * 오류 경로는 autoEnableAllowed:true 로 끝난다.
 *
 * ★토큰은 어떤 형태로도 저장되지 않는다 — tokenHash(sha256 앞 16자)만.
 *   기존 불변식 그대로다: 봇 토큰은 ~/.marblo 밖으로 나가지 않는다.
 */

import { telegramLeaseTokenHash } from "./telegram-poller-lease";

// ─── 레코드 ───────────────────────────────────────────────────────────

/** 귀속이 넘어가기 직전의 보유자 — 한 홉짜리 변경 이력(누가 언제 가져갔나). */
export interface TelegramBindingPrevious {
  machineId: string;
  hostLabel: string;
  boundAt: number;
  boundByUid: string;
}

/**
 * projects/{projectId}.telegramChannelBinding 에 실리는 귀속 레코드.
 *
 * ★botToken 은 원문도 해시 이전 형태도 들어가지 않는다. tokenHash 만이 "같은
 * 봇인가"의 판정 근거다 — 해시가 다르면 애초에 경쟁이 아니므로 아무도 막지
 * 않는다(리스의 other-bot 과 같은 판단).
 */
export interface TelegramChannelBinding {
  /** 이 채널을 인증한 기기의 machineId (app-state.json 의 안정 식별자). */
  machineId: string;
  /** 사람이 읽는 기기 이름(호스트명). UI 문구에 그대로 나간다. */
  hostLabel: string;
  /** 인증에 쓰인 봇 토큰의 sha256 앞 16자. */
  tokenHash: string;
  /** 귀속이 성립한 시각(보유 기기의 epoch ms). */
  boundAt: number;
  /**
   * 귀속을 기록한 Firebase uid. ★firestore.rules 가
   * `boundByUid == request.auth.uid` 를 강제하므로 **위조할 수 없다** —
   * 룰이 실제로 주는 것이 이 한 줄이다(차단이 아니라 귀속의 진정성).
   */
  boundByUid: string;
  /** 직전 보유자(있으면). 누가 언제 가져갔는지 한 홉이 문서에 남는다. */
  previous?: TelegramBindingPrevious;
}

// ─── 판정 ─────────────────────────────────────────────────────────────

/**
 * 귀속 판정. ★어휘는 새로 만들지 않고 reconnect-manager 의 own/foreign/legacy
 * 3분류를 그대로 따른다(legacy 는 여기서 "unbound" 로 부른다 — 귀속 필드가
 * 도입되기 전부터 쓰던 채널).
 *
 *   own       — 이 기기가 인증했다. 정상.
 *   foreign   — 다른 기기가 같은 봇으로 인증했다. ★유일하게 자동 활성을 막는 값.
 *   other-bot — 귀속은 남 기기 것이지만 tokenHash 가 달라 애초에 경쟁이 아니다.
 *   unbound   — 귀속 기록이 없다. 이 기능 배포 전부터 쓰던 기존 채널이 여기다.
 *               ★절대 막지 않는다 — 기존 사용자가 갑자기 죽으면 안 된다.
 *   unknown   — 검사가 실패했다(예외·인증 미완·문서 파손). fail-open.
 */
export type TelegramBindingVerdict =
  | "own"
  | "foreign"
  | "other-bot"
  | "unbound"
  | "unknown";

export interface TelegramBindingDecision {
  verdict: TelegramBindingVerdict;
  /** 판정 근거가 된 원격 귀속(없거나 못 읽었으면 null). */
  binding: TelegramChannelBinding | null;
  /**
   * ★false 는 verdict === "foreign" 일 때 **뿐이다**. 오류·미지·기존 채널은
   * 전부 true — fail-open 규율(#1419)의 이 모듈판이다.
   *
   * 의미: "이 기기에서 *저절로* 켜져도 되는가". 사용자가 여기서 명시적으로
   * 켜는 것(=인수)은 이 값과 무관하게 허용된다. 막는 게 아니라 알리는 층이다.
   */
  autoEnableAllowed: boolean;
  /** unknown 일 때 토큰 없는 한 줄 사유. 아니면 null. */
  failOpenReason: string | null;
  /**
   * 사용자에게 띄울 사실 문구(foreign 일 때만). ★이 문장의 유일한 출처는
   * {@link describeForeignBinding} 이다 — 프론트가 같은 말을 다시 조립하지
   * 않게 해서, 문구가 갈라지는 것을 막는다. getStatus 가 채운다.
   */
  notice: string | null;
}

/** 원격 문서의 임의 값을 신뢰-경계 검증해 귀속으로 정규화한다. 불완전하면 null. */
export function parseTelegramChannelBinding(
  raw: unknown,
): TelegramChannelBinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const machineId = typeof m.machineId === "string" ? m.machineId.trim() : "";
  const tokenHash = typeof m.tokenHash === "string" ? m.tokenHash.trim() : "";
  const boundAt = typeof m.boundAt === "number" ? m.boundAt : NaN;
  const boundByUid =
    typeof m.boundByUid === "string" ? m.boundByUid.trim() : "";
  // machineId 없는 귀속은 판정에 쓸 수 없다 — 없는 것과 같게 취급(→ unbound).
  if (!machineId || !Number.isFinite(boundAt)) return null;
  const previous = parsePrevious(m.previous);
  return {
    machineId,
    hostLabel:
      typeof m.hostLabel === "string" && m.hostLabel.trim()
        ? m.hostLabel
        : machineId,
    tokenHash,
    boundAt,
    boundByUid,
    ...(previous ? { previous } : {}),
  };
}

function parsePrevious(raw: unknown): TelegramBindingPrevious | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const machineId = typeof m.machineId === "string" ? m.machineId.trim() : "";
  const boundAt = typeof m.boundAt === "number" ? m.boundAt : NaN;
  if (!machineId || !Number.isFinite(boundAt)) return null;
  return {
    machineId,
    hostLabel:
      typeof m.hostLabel === "string" && m.hostLabel.trim()
        ? m.hostLabel
        : machineId,
    boundAt,
    boundByUid: typeof m.boundByUid === "string" ? m.boundByUid : "",
  };
}

/**
 * 귀속 판정. ★이 함수는 절대 throw 하지 않는다 — 어떤 입력이 와도 판정을
 * 돌려준다. 호출자가 try/catch 를 잊어도 fail-open 이 유지되게 하기 위해서다.
 *
 * @param binding      원격에서 관측한 귀속(못 읽었으면 null 이 아니라 undefined
 *                     를 넘겨 "미지"와 "없음"을 구분한다).
 * @param thisMachineId 이 기기의 machineId.
 * @param localToken   이 기기가 쥔 봇 토큰(없으면 null). 해시 비교에만 쓰이고
 *                     밖으로 나가지 않는다.
 */
export function classifyTelegramBinding(
  binding: TelegramChannelBinding | null | undefined,
  thisMachineId: string,
  localToken: string | null,
): TelegramBindingDecision {
  // "미지"(undefined) 와 "귀속 없음"(null) 은 다르다 — 전자는 검사 실패,
  // 후자는 기존 채널. 둘 다 막지 않지만 사용자에게 하는 말이 다르다.
  if (binding === undefined) {
    return {
      verdict: "unknown",
      binding: null,
      autoEnableAllowed: true,
      failOpenReason: "device binding not observed yet",
      notice: null,
    };
  }
  if (binding === null) {
    return {
      verdict: "unbound",
      binding: null,
      autoEnableAllowed: true,
      failOpenReason: null,
      notice: null,
    };
  }
  if (!thisMachineId) {
    // 이 기기의 정체를 모르면 남의 것인지도 판정할 수 없다 — fail-open.
    return {
      verdict: "unknown",
      binding,
      autoEnableAllowed: true,
      failOpenReason: "this machine has no stable machineId",
      notice: null,
    };
  }
  if (binding.machineId === thisMachineId) {
    return {
      verdict: "own",
      binding,
      autoEnableAllowed: true,
      failOpenReason: null,
      notice: null,
    };
  }
  // 남의 기기 귀속이다. 같은 봇일 때만 경쟁이다 — 토큰이 다르면 두 기기가
  // 서로 다른 봇을 도는 것이므로 409 도 강탈도 없다(리스의 other-bot 과 동일).
  // ★이 기기에 토큰이 없으면 비교 자체가 불가능한데, 그때는 **막는 쪽**이
  //   맞다: 복원 직후가 정확히 그 상태이고, 거기서 자동으로 켜지는 것이
  //   이 티켓이 없애려는 바로 그 동작이다.
  if (localToken) {
    const mine = telegramLeaseTokenHash(localToken);
    if (binding.tokenHash && binding.tokenHash !== mine) {
      return {
        verdict: "other-bot",
        binding,
        autoEnableAllowed: true,
        failOpenReason: null,
        notice: null,
      };
    }
  }
  return {
    verdict: "foreign",
    binding,
    autoEnableAllowed: false,
    failOpenReason: null,
    notice: describeForeignBinding(binding),
  };
}

/**
 * 이 기기가 인증했다는 사실로서의 귀속 레코드를 만든다(push 용).
 * 직전 보유자가 있으면 previous 로 한 홉 남긴다 — 누가 언제 가져갔는지가
 * 문서에 보이게.
 */
export function buildTelegramChannelBinding(args: {
  machineId: string;
  hostLabel: string;
  botToken: string;
  boundByUid: string;
  now: number;
  previous?: TelegramChannelBinding | null;
}): TelegramChannelBinding {
  const prev = args.previous;
  return {
    machineId: args.machineId,
    hostLabel: args.hostLabel,
    tokenHash: telegramLeaseTokenHash(args.botToken),
    boundAt: args.now,
    boundByUid: args.boundByUid,
    // 자기 자신으로의 갱신은 이력이 아니다 — 같은 기기면 previous 를 남기지
    // 않는다(토큰만 바꿔 저장할 때 이력이 자기 복사로 더럽혀지는 것 방지).
    ...(prev && prev.machineId !== args.machineId
      ? {
          previous: {
            machineId: prev.machineId,
            hostLabel: prev.hostLabel,
            boundAt: prev.boundAt,
            boundByUid: prev.boundByUid,
          },
        }
      : {}),
  };
}

/**
 * 다른 기기 귀속일 때 화면에 띄울 사실 문구.
 *
 * ★두 가지를 반드시 함께 말한다: (a) 여기서 쓰려면 봇 토큰을 다시 넣어야 하고,
 * (b) 그렇게 하면 앞 기기가 잃는다. 텔레그램은 봇당 소비자가 하나뿐이라
 * 인수는 곧 강탈이다 — 사용자가 모르고 뺏는 일이 없게 대가를 먼저 알린다.
 */
export function describeForeignBinding(
  binding: TelegramChannelBinding,
): string {
  return (
    `이 채널은 다른 기기(${binding.hostLabel})에서 인증됐습니다. ` +
    `여기서 쓰시려면 봇 토큰을 다시 입력하고 저장하세요 — ` +
    `텔레그램은 봇 하나당 수신자가 한 곳뿐이라, 여기서 켜는 순간 ` +
    `${binding.hostLabel} 의 텔레그램 수신은 끊깁니다.`
  );
}
