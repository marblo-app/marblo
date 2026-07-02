// GA4 tagging library — single source of truth for all event names.
// Naming follows GA4 best practices: snake_case, verb-first where possible.
// See docs/GA4_TAGGING_GUIDE.md for the full event catalog and conversion list.
//
// Privacy: NEVER pass PII (email, name, phone) into event params. Only
// non-identifying values (ids, amounts, os/arch, locale, source labels).
//
// No-op fallback: when NEXT_PUBLIC_GA4_MEASUREMENT_ID is unset, every helper
// below short-circuits (see the `if (!GA_MEASUREMENT_ID) return;` guards), so
// builds and runtime stay error-free until a real Measurement ID is injected.

export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || "";

// gtag / dataLayer are injected at runtime by components/GoogleAnalytics.tsx.
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

// GA4 ecommerce item shape (subset we use).
export interface GtagItem {
  item_id?: string;
  item_name?: string;
  item_category?: string;
  price?: number;
  quantity?: number;
}

type EventParamValue = string | number | boolean | undefined | GtagItem[];
type EventParams = Record<string, EventParamValue>;

// -------------------------------------------------------------------------
// Pageview (called automatically by components/GoogleAnalytics.tsx)
// -------------------------------------------------------------------------
export function pageview(url: string) {
  if (!GA_MEASUREMENT_ID) return;
  if (typeof window === "undefined" || typeof window.gtag !== "function")
    return;
  window.gtag("config", GA_MEASUREMENT_ID, {
    page_path: url,
  });
}

// -------------------------------------------------------------------------
// Low-level event sender
// -------------------------------------------------------------------------
export function sendEvent(eventName: string, params: EventParams = {}) {
  if (!GA_MEASUREMENT_ID) return;
  if (typeof window === "undefined" || typeof window.gtag !== "function")
    return;
  // Strip undefined values (GA4 rejects them).
  const cleaned: EventParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) cleaned[k] = v;
  }
  window.gtag("event", eventName, cleaned);
}

// =========================================================================
// CONVERSION-CRITICAL EVENTS — mark these as Key Events in GA4
// =========================================================================

/**
 * 강의/구독 결제 완료. GA4 표준 ecommerce 이벤트. 최상위 매출 전환.
 * Mark as Key Event in GA4 (관리 → 이벤트 → 키 이벤트로 표시).
 * ⚠️ PII 금지 — transaction_id 는 주문 ID(비식별), items 는 상품 slug/제목만.
 */
export function trackPurchase(args: {
  transactionId: string;
  value: number;
  currency?: string;
  items?: GtagItem[];
}) {
  sendEvent("purchase", {
    transaction_id: args.transactionId,
    value: args.value,
    currency: args.currency ?? "KRW",
    items: args.items,
  });
}

/**
 * 베타(파운더) 신청 폼 제출 성공. GA4 권장 이벤트명 generate_lead.
 * ⚠️ 이메일/이름 등 PII 절대 미포함 — source/locale 같은 비식별 값만.
 * Mark as Key Event in GA4.
 */
export function trackGenerateLead(args: { source: string; locale?: string }) {
  sendEvent("generate_lead", {
    lead_source: args.source,
    locale: args.locale,
    currency: "KRW",
    value: 0, // 실제 매출이 매칭되면 GA4에서 별도 매핑
  });
}

// =========================================================================
// FUNNEL EVENTS — 결제/다운로드 여정 추적
// =========================================================================

/**
 * 결제 시작(TossPayments requestPayment 직전). GA4 표준 ecommerce 이벤트.
 */
export function trackBeginCheckout(args: {
  value: number;
  currency?: string;
  items?: GtagItem[];
  checkoutType?: string;
}) {
  sendEvent("begin_checkout", {
    value: args.value,
    currency: args.currency ?? "KRW",
    checkout_type: args.checkoutType,
    items: args.items,
  });
}

/**
 * 데스크톱 앱 설치 파일 다운로드 클릭. 핵심 활성화 전환.
 * ⚠️ 비식별 값만 — os/arch/app_version.
 */
export function trackAppDownload(args: {
  os: "mac" | "win";
  arch?: string;
  appVersion: string;
}) {
  sendEvent("download", {
    os: args.os,
    arch: args.arch,
    app_version: args.appVersion,
  });
}

// =========================================================================
// ENGAGEMENT EVENTS — 사용자 관심·여정 추적
// =========================================================================

/**
 * 가격/구독 CTA 클릭 (pricing 도착지).
 */
export function trackPricingClick(location: string) {
  sendEvent("click_pricing", {
    cta_location: location,
  });
}

/**
 * 강의 상세/구매 CTA 클릭.
 */
export function trackLectureClick(lectureSlug: string, location: string) {
  sendEvent("click_lecture", {
    lecture_slug: lectureSlug,
    cta_location: location,
  });
}

/**
 * 다운로드 페이지 CTA 로 향하는 클릭 (헤더/히어로 등).
 */
export function trackDownloadCtaClick(location: string) {
  sendEvent("click_download_cta", {
    cta_location: location,
  });
}

/**
 * 데모 영상 재생.
 */
export function trackDemoView(demoType: string) {
  sendEvent("view_demo", {
    demo_type: demoType,
  });
}

/**
 * 외부 도메인 링크 클릭 (문서, GitHub, Discord 등).
 */
export function trackOutboundClick(url: string, location: string) {
  sendEvent("click_outbound", {
    outbound_url: url,
    cta_location: location,
  });
}

/**
 * 언어 전환 (KO ↔ EN ↔ JA).
 */
export function trackLangToggle(fromLang: string, toLang: string) {
  sendEvent("lang_toggle", {
    from_lang: fromLang,
    to_lang: toLang,
  });
}

/**
 * 회원가입 완료 (GA4 권장 이벤트명 sign_up).
 * ⚠️ PII 금지 — 인증 방식(method) 같은 비식별 값만.
 */
export function trackSignUp(method: string) {
  sendEvent("sign_up", {
    method,
  });
}

/**
 * 로그인 완료 (GA4 권장 이벤트명 login).
 */
export function trackLogin(method: string) {
  sendEvent("login", {
    method,
  });
}

// =========================================================================
// LEGACY — generic CTA fallback, routes to typed events when possible.
// =========================================================================

/**
 * @deprecated 가능하면 위의 타입별 헬퍼(trackPricingClick 등)를 사용.
 * 미분류 CTA 를 위한 제네릭 클릭 이벤트.
 */
export function trackCtaClick(ctaName: string, location: string) {
  const name = ctaName.toLowerCase();
  if (name.includes("pricing") || name.includes("가격")) {
    trackPricingClick(location);
    return;
  }
  if (name.includes("download") || name.includes("다운로드")) {
    trackDownloadCtaClick(location);
    return;
  }
  // Fallback for any uncategorized CTA.
  sendEvent("cta_click", {
    cta_name: ctaName,
    cta_location: location,
  });
}
