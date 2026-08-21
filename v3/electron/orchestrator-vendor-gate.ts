/**
 * 오케 **런타임 게이트 벤더**의 스폰 가부 판정 — 순수 규칙.
 *
 * ── 왜 이 파일이 있나 ────────────────────────────────────────────────────
 * `model-selection.selectorEligible` 은 오래도록 "하네스 네이티브 벤더만" 이었고,
 * 그 사유는 MCP 도, 성능도 아니었다:
 *
 *   > 오케 모델 선택은 **프로젝트별로 영구 저장**된다. 수명이 무한한 기본값에
 *   > 조건부 크레덴셜을 얹지 않는다.
 *
 * DeepSeek 이 그 필터를 여는 첫 예외인데, 예외를 **지탱하는 것이 이 파일**이다.
 * DeepSeek 은 구독제가 아니라 선불 충전이라 만료일이 없다 — 쓰다가 어느 날 0 이
 * 된다(2026-08-21 실측: 아침에 0 이었다). 즉 원래 주석이 두려워한 "저장된 값이
 * 나중에 못 쓰게 되는" 시나리오가 GLM 보다 **더 잘 일어난다**. 그래서 필터를 걷는
 * 대신, 걷은 자리에 **런타임 판정**을 세운다.
 *
 * ── ★순수하게 남는 이유 ─────────────────────────────────────────────────
 * `selectorEligible` 이 시크릿을 안 읽는 순수함수인 것은 우연이 아니라 위 결정의
 * 구현이다(model-registry 상단 규율: 이 층은 시크릿을 읽지 않는다). 그 성질을
 * 유지하려고 이 파일도 **입력만 받는다** — 네트워크도, `process.env` 도, 안전저장소도
 * 만지지 않는다. 잔액을 실제로 읽는 것은 `vendor-balance.getVendorBalance`(main),
 * 판정은 여기, 목록 생성은 `model-selection` 이다. 퀵레인이 `requiredEnvKeys` 를
 * 실어 보내고 main 이 `process.env` 를 보는 패턴과 같은 분업이다.
 *
 * ── ★실패 사유를 뭉개지 않는다 ──────────────────────────────────────────
 * "DeepSeek 오케를 못 띄웁니다" 하나로 접으면 사용자는 **충전을 해야 하는지, 키를
 * 넣어야 하는지, 키가 폐기된 건지, 그냥 네트워크가 죽은 건지** 알 수 없다. 넷은
 * 조치가 전부 다르다. 이 레포는 Solar 조용한 실패로 하루를 태운 적이 있고
 * (`vendor-balance.ts` 상단), 그 학습이 여기 그대로 적용된다. 그래서
 * `OrchestratorVendorGateStatus` 는 벤더 응답의 구분을 **끝까지 들고 간다**.
 *
 * ── ★통화를 환산하지 않는다 ─────────────────────────────────────────────
 * DeepSeek 은 계정에 따라 CNY 로 답한다. 우리는 환율을 들고 있지 않으므로
 * (`vendor-balance.ts` §통화) "저잔액" 임계도 **통화별로 따로** 둔다. 이건 환산이
 * 아니라 서로 독립적으로 고른 두 숫자다. 모르는 통화가 오면 임계 경고를 그리지
 * 않는다 — 그 단위에서 "적다" 가 얼마인지 우리가 모르기 때문이다. 반면 **소진
 * (≤ 0) 판정은 통화와 무관**하므로 모르는 통화에서도 그대로 산다.
 */

import type {
  VendorBalanceAmount,
  VendorBalanceResult,
} from "./vendor-balance";

/**
 * 판정 결과. `ok`/`low` 만 스폰을 허용하고 나머지는 전부 차단이다.
 *
 * ★`indeterminate` 가 따로 있는 이유: 2xx 를 받았는데 우리가 아는 스키마가 아닌
 * 경우(`vendor-balance` 의 `malformed`)를 위 넷 중 아무 데나 접으면 없는 사실을
 * 만든다. "닿긴 했는데 읽을 수 없었다" 는 "닿지 못했다" 와 다른 말이다.
 */
export type OrchestratorVendorGateStatus =
  /** 잔액이 있고 벤더도 계정을 사용 가능으로 답했다. */
  | "ok"
  /** 잔액은 남아 있지만 임계 이하 — 스폰은 허용하고 충전 안내만 띄운다. */
  | "low"
  /** 잔액 0(또는 벤더가 `is_available: false`). 조치 = 충전. */
  | "depleted"
  /** 키가 이 기기에 없다. 조치 = 키 등록. */
  | "no-key"
  /** 401/403 — 키가 틀렸거나 폐기됐다. 조치 = 키 교체. */
  | "unauthorized"
  /** 벤더에 닿지 못했다(오프라인·타임아웃·5xx). 조치 = 네트워크/재시도. */
  | "unreachable"
  /** 아직 조회하지 않았거나, 2xx 인데 스키마 미상. 숫자를 지어내지 않는다. */
  | "indeterminate";

/**
 * 통화별 **저잔액 임계**. 환산이 아니라 통화마다 독립적으로 고른 값이다
 * (파일 상단 §통화).
 *
 * 근거: DeepSeek peak 정가 기준으로 v4-flash 는 input $0.44 / output $1.32 per 1M
 * (`model-registry` DeepSeek 블록). 오케 한 세션이 수십만 토큰을 쉽게 쓰므로 "몇
 * 달러" 는 한 세션 안에서 0 이 될 수 있는 구간이다 — 즉 이 임계는 "곧 끊긴다" 를
 * 뜻한다. CNY 는 대략 같은 무게가 되도록 골랐고, 정밀한 환율이 아니다(정밀할
 * 필요도 없다 — 경고 문턱이지 금액 표시가 아니다).
 */
export const LOW_BALANCE_THRESHOLDS: Readonly<Record<string, number>> = {
  USD: 2,
  CNY: 15,
};

/** 판정에 쓴 잔액 한 줄(화면·로그 문구용). 값은 금액과 통화뿐이다. */
export interface OrchestratorVendorGateAmount {
  currency: string;
  total: number;
}

export interface OrchestratorVendorGateVerdict {
  vendor: string;
  status: OrchestratorVendorGateStatus;
  /** 이 상태로 오케를 띄워도 되는가. `ok`/`low` 만 true. */
  allowed: boolean;
  /**
   * 사용자가 **무엇을 해야 하는지**. "잔액이 부족합니다" 로 끝내지 않는다 —
   * 상태마다 다른 조치가 적힌다(파일 상단 §실패).
   */
  action: string;
  /** 판정에 쓴 통화별 총액. 상태가 `ok`/`low`/`depleted` 일 때만 채워진다. */
  amounts: OrchestratorVendorGateAmount[];
  /** `no-key` 일 때 비어 있는 env 키 **이름**(값 아님). */
  missingEnvKeys?: string[];
  /** `unauthorized`/`unreachable` 일 때의 상태 코드(있으면). */
  httpStatus?: number;
}

/** 벤더 표시명 — 문구에 쓴다. `model-selection.VENDOR_LABEL` 을 주입받는다. */
export interface VendorGateInput {
  vendor: string;
  vendorLabel: string;
  /** `getVendorBalance` 결과. 아직 조회 전이면 null. */
  balance: VendorBalanceResult | null;
  /** 이 벤더에 필요한 env 키 이름들(레지스트리 파생). 문구 보강용. */
  requiredEnvKeys?: string[];
}

/** 총액이 0 이하인가 — 통화와 무관한 판정이다. */
function isDepleted(amounts: readonly VendorBalanceAmount[]): boolean {
  if (amounts.length === 0) return false;
  return amounts.every((a) => a.total <= 0);
}

/**
 * 임계 이하인가. **모르는 통화는 판정하지 않는다**(false) — 그 단위에서 "적다" 가
 * 얼마인지 모르는 채로 경고를 띄우면 그건 지어낸 사실이다.
 */
function isLow(amounts: readonly VendorBalanceAmount[]): boolean {
  const known = amounts.filter(
    (a) => LOW_BALANCE_THRESHOLDS[a.currency.toUpperCase()] !== undefined
  );
  if (known.length === 0) return false;
  return known.every(
    (a) => a.total <= LOW_BALANCE_THRESHOLDS[a.currency.toUpperCase()]
  );
}

function formatAmounts(amounts: readonly VendorBalanceAmount[]): string {
  // 통화 기호로 바꾸지 않는다 — 벤더가 준 코드를 그대로 붙인다
  // (`VendorCreditsPanel.formatMoney` 와 같은 규율).
  return amounts.map((a) => `${a.total.toFixed(2)} ${a.currency}`).join(" · ");
}

/**
 * 충전 경로 안내. ★URL 을 지어내지 않는다 — `src/lib/vendorBilling.ts` 의
 * DeepSeek 행은 `consoleUrl` 이 **없다**(1차 문서에서 충전 페이지 URL 을 그대로
 * 읽어오지 못했고, 그 표의 규율이 "추측 URL 금지" 다). 그래서 벤더 콘솔 대신 우리가
 * 확실히 아는 **앱 안의 경로**를 적는다: 사용량 탭의 벤더 크레딧 패널이 잔액과
 * 새로고침을 이미 그린다(PR #1073).
 */
const TOP_UP_HINT =
  "충전 후 [사용량] 탭 → 벤더 크레딧에서 새로고침(⟳)해 잔액을 확인하고 다시 시작하세요";

/**
 * 런타임 게이트 벤더 하나의 스폰 가부. **순수** — 입력만 보고 답한다.
 *
 * 아직 조회 전(`balance === null`)이면 `indeterminate` 로 **차단**한다. 이게
 * fail-closed 인 이유는 이 게이트의 존재 이유 그 자체다: 저장된 값이 나중에 못 쓰게
 * 됐을 때 **조용히 하네스 기본 백엔드로 새지 않는 것**이 목적이고, "모르니까 일단
 * 띄운다" 는 정확히 그 샘을 다시 여는 선택이다. 대신 사유는 미상이라고 정직하게
 * 적는다(없는 사실을 만들지 않는다).
 */
export function decideOrchestratorVendorGate(
  input: VendorGateInput
): OrchestratorVendorGateVerdict {
  const { vendor, vendorLabel, balance } = input;
  const base = { vendor, amounts: [] as OrchestratorVendorGateAmount[] };

  if (!balance) {
    return {
      ...base,
      status: "indeterminate",
      allowed: false,
      action: `${vendorLabel} 잔액을 아직 확인하지 못했습니다 — [사용량] 탭 → 벤더 크레딧에서 새로고침(⟳)한 뒤 다시 시작하세요`,
    };
  }

  switch (balance.status) {
    case "no-key": {
      const keys = (
        balance.missingEnvKeys?.length
          ? balance.missingEnvKeys
          : input.requiredEnvKeys ?? []
      ).join(", ");
      return {
        ...base,
        status: "no-key",
        allowed: false,
        ...(keys ? { missingEnvKeys: keys.split(", ") } : {}),
        action: keys
          ? `${vendorLabel} API 키가 없습니다 — [설정] → API 키 → 벤더 API 키에서 ${keys} 를 등록한 뒤 다시 시작하세요`
          : `${vendorLabel} API 키가 없습니다 — [설정] → API 키 → 벤더 API 키에서 등록한 뒤 다시 시작하세요`,
      };
    }
    case "unauthorized":
      return {
        ...base,
        status: "unauthorized",
        allowed: false,
        ...(balance.httpStatus ? { httpStatus: balance.httpStatus } : {}),
        action: `${vendorLabel} 가 키를 거절했습니다(HTTP ${
          balance.httpStatus ?? 401
        }) — 잔액 문제가 아닙니다. 키가 폐기·오타·다른 계정일 수 있으니 [설정] → API 키에서 새 키로 교체한 뒤 다시 시작하세요`,
      };
    case "network-error":
      return {
        ...base,
        status: "unreachable",
        allowed: false,
        action: `${vendorLabel} 에 닿지 못했습니다(네트워크·타임아웃) — 잔액도 키도 문제가 아닐 수 있습니다. 연결을 확인하고 [사용량] 탭 → 벤더 크레딧에서 새로고침(⟳) 한 뒤 다시 시작하세요`,
      };
    case "http-error":
      return {
        ...base,
        status: "unreachable",
        allowed: false,
        ...(balance.httpStatus ? { httpStatus: balance.httpStatus } : {}),
        action: `${vendorLabel} 가 HTTP ${
          balance.httpStatus ?? 0
        } 로 답했습니다(벤더 측 오류·레이트리밋) — 키 문제가 아닙니다. 잠시 뒤 [사용량] 탭 → 벤더 크레딧에서 새로고침(⟳) 해보세요`,
        // ★`unauthorized` 와 갈라 두는 이유: 503 을 "키를 바꾸세요" 로 안내하면
        // 사용자를 정확히 반대 방향으로 보낸다.
      };
    case "malformed":
    case "unsupported":
      return {
        ...base,
        status: "indeterminate",
        allowed: false,
        action: `${vendorLabel} 잔액 응답을 해석하지 못했습니다 — 숫자를 지어내지 않고 여기서 멈춥니다. 벤더 API 가 바뀌었을 수 있으니 다른 오케 모델을 고르거나 개발팀에 알려주세요`,
      };
    case "ok":
      break;
  }

  const amounts: OrchestratorVendorGateAmount[] = balance.amounts.map((a) => ({
    currency: a.currency,
    total: a.total,
  }));

  // ★벤더가 스스로 "이 계정으로 API 를 쓸 수 없다" 고 답하면 잔액 숫자보다 그
  // 답이 우선이다. 잔액이 남아 있어도 false 가 나올 수 있다(계정 상태).
  if (balance.isAvailable === false) {
    return {
      vendor,
      status: "depleted",
      allowed: false,
      amounts,
      action: `${vendorLabel} 계정이 현재 사용 불가 상태입니다(벤더 응답 is_available=false${
        amounts.length ? `, 잔액 ${formatAmounts(balance.amounts)}` : ""
      }) — 크레딧을 충전하거나 계정 상태를 확인하세요. ${TOP_UP_HINT}`,
    };
  }

  if (isDepleted(balance.amounts)) {
    return {
      vendor,
      status: "depleted",
      allowed: false,
      amounts,
      action: `${vendorLabel} 잔액이 0 입니다(${formatAmounts(
        balance.amounts
      )}) — 로그인 문제가 아닙니다. ${vendorLabel} 계정에 크레딧을 충전해야 이 오케를 띄울 수 있습니다. ${TOP_UP_HINT}`,
    };
  }

  if (isLow(balance.amounts)) {
    return {
      vendor,
      status: "low",
      allowed: true,
      amounts,
      action: `${vendorLabel} 잔액이 얼마 남지 않았습니다(${formatAmounts(
        balance.amounts
      )}) — 오케 한 세션에 소진될 수 있습니다. 지금 충전해 두세요. ${TOP_UP_HINT}`,
    };
  }

  return {
    vendor,
    status: "ok",
    allowed: true,
    amounts,
    action: "",
  };
}

/**
 * 판정에서 나온 **저잔액 경고를 오케 자신에게** 전달할 한 줄.
 *
 * ── 왜 부트 프롬프트인가 ────────────────────────────────────────────────
 * 사장님 요청은 "내부 터미널에서 토큰 충전하라고 알림이 오면 되지 않나" 였다.
 * 터미널에 글자를 띄우는 방법이 둘인데 하나는 못 쓴다:
 *
 *   ✗ `PtyManager.write` — 그건 **stdin** 이다. 표시가 아니라 키 입력이라 CLI 의
 *     프롬프트에 문자열이 타이핑돼 들어간다.
 *   ✗ `pty:data` 위조 — codex TUI 는 alt-screen 이라 우리가 끼워 넣은 줄은 다음
 *     리드로우에 덮이거나 화면을 깨뜨린다.
 *   ✓ **부트 프롬프트** — 이미 `handoffPrompt` 가 쓰는 채널이고, 오케가 그 말을
 *     읽어 사용자에게 자기 말투로 전달한다. 차단이 아니라 **경고**라 이 정도가 맞다
 *     (차단은 패널 배너가 진다).
 */
export function orchestratorVendorBootNotice(
  verdict: OrchestratorVendorGateVerdict
): string | undefined {
  if (verdict.status !== "low") return undefined;
  return (
    `★사용자에게 가장 먼저 이 사실을 알려라(작업을 시작하기 전에 한 번만): ` +
    `${verdict.action}.`
  );
}
