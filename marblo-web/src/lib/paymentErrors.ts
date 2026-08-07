/**
 * Payment / PG / Firebase callable error → user-facing message key map.
 *
 * Returns a stable i18n key under the `checkout` namespace (or a known
 * technical code the UI can map). Never expose raw PG dumps as the primary
 * message when a mapping exists.
 */

export type PaymentErrorTone = "error" | "soft" | "network";

export type PaymentErrorKey =
  | "alreadySubscribed"
  | "firstChargeFailed"
  | "paymentInProgress"
  | "paymentCancelled"
  | "paymentError"
  | "networkError"
  | "sdkLoadError"
  | "unsupportedCard"
  | "loginRequired"
  | "couponInvalid"
  | "paymentNotPaid"
  | "unknownError";

export interface MappedPaymentError {
  /** next-intl key under `checkout` */
  key: PaymentErrorKey;
  /** soft = user closed/cancelled; network = retry-friendly; error = hard fail */
  tone: PaymentErrorTone;
  /** original code if known (for support / fail page detail) */
  code?: string;
  /** whether UI should offer "retry first charge" */
  canRetryFirstCharge: boolean;
  /** whether UI should treat as already subscribed redirect */
  alreadySubscribed: boolean;
}

/** Codes that mean the user closed the payment window (not a hard failure). */
const USER_CANCEL_CODES = new Set(
  [
    "USER_CANCEL",
    "USER_CANCELLED",
    "USER_CANCELED",
    "PAY_PROCESS_CANCELED",
    "PAY_PROCESS_ABORTED",
    "CANCEL",
    "CANCELED",
    "CANCELLED",
  ].map((c) => c.toUpperCase()),
);

/** Codes / substrings that often mean unsupported or declined card. */
const UNSUPPORTED_CARD_CODES = new Set(
  [
    "INVALID_CARD",
    "INVALID_CARD_COMPANY",
    "CARD_NOT_SUPPORTED",
    "UNSUPPORTED_CARD",
    "CARD_COMPANY_ERROR",
    "NOT_SUPPORTED_CARD",
    "INVALID_CARD_NUMBER",
    "REJECT_CARD_COMPANY",
  ].map((c) => c.toUpperCase()),
);

/** Firebase Functions error codes (HttpsError.code) that mean network/transient. */
const NETWORK_FUNCTION_CODES = new Set([
  "unavailable",
  "deadline-exceeded",
  "resource-exhausted",
  "aborted", // only when message is not a known business code
]);

/** Stable business codes we put in HttpsError message (server contract). */
const BUSINESS_MESSAGE_MAP: Array<{
  match: string | RegExp;
  key: PaymentErrorKey;
  tone?: PaymentErrorTone;
  canRetryFirstCharge?: boolean;
  alreadySubscribed?: boolean;
}> = [
  {
    match: "already_subscribed",
    key: "alreadySubscribed",
    alreadySubscribed: true,
  },
  {
    match: "first_charge_failed",
    key: "firstChargeFailed",
    canRetryFirstCharge: true,
  },
  { match: "payment_in_progress", key: "paymentInProgress" },
  { match: "payment_not_paid", key: "paymentNotPaid" },
  { match: "Login required", key: "loginRequired" },
  { match: "Invalid coupon", key: "couponInvalid" },
];

function upper(s: string): string {
  return s.trim().toUpperCase();
}

function extractFirebaseParts(err: unknown): {
  code?: string;
  message: string;
} {
  if (!err || typeof err !== "object") {
    return {
      message: err instanceof Error ? err.message : String(err ?? ""),
    };
  }
  const e = err as {
    code?: string;
    message?: string;
    details?: unknown;
    customData?: { code?: string };
  };
  // Firebase JS SDK: "functions/unavailable" or just "unavailable"
  let code = e.code;
  if (typeof code === "string" && code.startsWith("functions/")) {
    code = code.slice("functions/".length);
  }
  const message = String(e.message ?? "");
  return { code, message };
}

/**
 * Extract a likely PG/API error code from a free-form message or object.
 */
export function extractErrorCode(err: unknown): string | undefined {
  if (!err) return undefined;
  if (typeof err === "string") {
    const m = err.match(/\b([A-Z][A-Z0-9_]{2,})\b/);
    return m?.[1];
  }
  if (typeof err === "object") {
    const e = err as {
      code?: string;
      name?: string;
      message?: string;
    };
    if (typeof e.code === "string" && !e.code.startsWith("functions/")) {
      // Prefer short business codes over firebase ones for display
      const bare = e.code.startsWith("functions/")
        ? e.code.slice("functions/".length)
        : e.code;
      if (/^[A-Za-z][A-Za-z0-9_]+$/.test(bare) && bare.length <= 48) {
        // Firebase codes are lowercase-hyphen; PG codes are UPPER_SNAKE
        if (bare === bare.toUpperCase() || bare.includes("_")) {
          return bare;
        }
      }
    }
    if (typeof e.message === "string") {
      const fromMsg = extractErrorCode(e.message);
      if (fromMsg) return fromMsg;
    }
  }
  return undefined;
}

export function isUserCancelCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return USER_CANCEL_CODES.has(upper(code));
}

export function isUserCancelMessage(message: string): boolean {
  const m = message.toLowerCase();
  if (
    m.includes("user cancel") ||
    m.includes("user_cancel") ||
    m.includes("cancelled by user") ||
    m.includes("canceled by user") ||
    m.includes("사용자가 취소") ||
    m.includes("결제를 취소") ||
    m.includes("결제 취소") ||
    m.includes("창을 닫")
  ) {
    return true;
  }
  // Exact-ish cancel codes embedded in message
  for (const c of USER_CANCEL_CODES) {
    if (message.toUpperCase().includes(c)) return true;
  }
  return false;
}

export function isUnsupportedCardCode(
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  return UNSUPPORTED_CARD_CODES.has(upper(code));
}

/**
 * Map any thrown error / PG response into a UI-safe result.
 */
export function mapPaymentError(err: unknown): MappedPaymentError {
  const { code: fbCode, message } = extractFirebaseParts(err);
  const pgCode = extractErrorCode(err);
  const haystack = `${fbCode ?? ""} ${message} ${pgCode ?? ""}`.trim();

  // 1) User cancel (soft)
  if (
    isUserCancelCode(pgCode) ||
    isUserCancelCode(fbCode) ||
    isUserCancelMessage(message)
  ) {
    return {
      key: "paymentCancelled",
      tone: "soft",
      code: pgCode || fbCode,
      canRetryFirstCharge: false,
      alreadySubscribed: false,
    };
  }

  // 2) Business message codes from our callables
  for (const rule of BUSINESS_MESSAGE_MAP) {
    const hit =
      typeof rule.match === "string"
        ? haystack.includes(rule.match)
        : rule.match.test(haystack);
    if (hit) {
      return {
        key: rule.key,
        tone: rule.tone ?? "error",
        code: rule.match.toString(),
        canRetryFirstCharge: !!rule.canRetryFirstCharge,
        alreadySubscribed: !!rule.alreadySubscribed,
      };
    }
  }

  // 3) Unsupported / declined card
  if (isUnsupportedCardCode(pgCode) || isUnsupportedCardCode(message)) {
    return {
      key: "unsupportedCard",
      tone: "error",
      code: pgCode || message,
      canRetryFirstCharge: false,
      alreadySubscribed: false,
    };
  }
  // Korean PG phrases often include 카드사 / 미지원 / 거절
  if (
    /카드.*(거절|미지원|불가|실패)|unsupported.?card|card.?not.?support|invalid.?card/i.test(
      message,
    )
  ) {
    return {
      key: "unsupportedCard",
      tone: "error",
      code: pgCode,
      canRetryFirstCharge: false,
      alreadySubscribed: false,
    };
  }

  // 4) Network / SDK load
  if (
    (fbCode && NETWORK_FUNCTION_CODES.has(fbCode)) ||
    /network|unavailable|timeout|Failed to fetch|ERR_NETWORK|ECONN|로드|불러오/i.test(
      message,
    )
  ) {
    // payment_in_progress uses "aborted" — already handled above
    if (fbCode === "aborted" && message.includes("payment_in_progress")) {
      return {
        key: "paymentInProgress",
        tone: "error",
        code: "payment_in_progress",
        canRetryFirstCharge: false,
        alreadySubscribed: false,
      };
    }
    if (/sdk|script|결제 시스템|payment system/i.test(message)) {
      return {
        key: "sdkLoadError",
        tone: "network",
        code: fbCode || pgCode,
        canRetryFirstCharge: false,
        alreadySubscribed: false,
      };
    }
    return {
      key: "networkError",
      tone: "network",
      code: fbCode || pgCode,
      canRetryFirstCharge: false,
      alreadySubscribed: false,
    };
  }

  if (fbCode === "unauthenticated") {
    return {
      key: "loginRequired",
      tone: "error",
      code: fbCode,
      canRetryFirstCharge: false,
      alreadySubscribed: false,
    };
  }

  // 5) Generic — do NOT pass through technical English/Korean dumps when empty
  // Prefer paymentError over raw message for unknown technical codes.
  const looksTechnical =
    !message ||
    /^[a-z_]+$/.test(message) ||
    /payment_not_paid|HttpsError|INTERNAL|functions\//i.test(message) ||
    message.length < 3;

  return {
    key: looksTechnical ? "paymentError" : "paymentError",
    tone: "error",
    code: pgCode || fbCode || (looksTechnical ? message : undefined),
    canRetryFirstCharge: false,
    alreadySubscribed: false,
  };
}

/**
 * Map Toss failUrl query params (code + message) the same way as live errors.
 */
export function mapFailPageParams(
  code: string | null,
  message: string | null,
): MappedPaymentError {
  if (isUserCancelCode(code) || (message && isUserCancelMessage(message))) {
    return {
      key: "paymentCancelled",
      tone: "soft",
      code: code ?? undefined,
      canRetryFirstCharge: false,
      alreadySubscribed: false,
    };
  }
  if (isUnsupportedCardCode(code)) {
    return {
      key: "unsupportedCard",
      tone: "error",
      code: code ?? undefined,
      canRetryFirstCharge: false,
      alreadySubscribed: false,
    };
  }
  return mapPaymentError({
    code: code ?? undefined,
    message: message ?? "",
  });
}

/** Show test-card / sandbox hints outside production builds. */
export function shouldShowTestCardHint(): boolean {
  if (typeof process === "undefined") return false;
  return process.env.NODE_ENV !== "production";
}
