"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { httpsCallable, getFunctions } from "firebase/functions";
import { auth } from "@/lib/firebase";
import app from "@/lib/firebase";
import CouponInput from "@/components/CouponInput";
import { lectures } from "@/data/lectures";
import { trackBeginCheckout, trackViewItem, trackAddPaymentInfo } from "@/lib/gtag";
import { ArrowLeft, Loader2, AlertCircle, ShoppingCart } from "lucide-react";

type PaymentProvider = "toss" | "portone";

interface PortOneSDK {
  requestPayment(params: {
    storeId: string;
    channelKey: string;
    paymentId: string;
    orderName: string;
    totalAmount: number;
    currency: "KRW";
    payMethod: "CARD";
    redirectUrl?: string;
    customer?: {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
    };
  }): Promise<{ paymentId?: string; code?: string; message?: string }>;
  requestIssueBillingKey(params: {
    storeId: string;
    channelKey: string;
    billingKeyMethod: "CARD";
    issueId: string;
    issueName: string;
    customer?: {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
    };
  }): Promise<{ billingKey?: string; code?: string; message?: string }>;
}

declare global {
  interface Window {
    PortOne?: PortOneSDK;
  }
}

const PLAN_PRICES: Record<
  string,
  { name: string; monthly: number; annual: number }
> = {
  pro: { name: "Pro", monthly: 19000, annual: 19000 * 10 },
  // Team bills per seat (₩29,000); checkout currently charges 1 seat (seat
  // quantity selector is a follow-up).
  team: { name: "Team", monthly: 29000, annual: 29000 * 10 },
  // Team Plus is a per-team floor: ₩290,000 = 5 seats included.
  // Extra seats (+₩59,000/seat) handled post-purchase (follow-up).
  team_plus: {
    name: "Team Plus",
    monthly: 290000,
    annual: 290000 * 10,
  },
};

export default function CheckoutPage() {
  const t = useTranslations("checkout");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");
  const lectureSlug = searchParams.get("slug");
  const type = searchParams.get("type") || "subscription";
  const billing = searchParams.get("billing") || "monthly";
  const paymentProvider: PaymentProvider =
    searchParams.get("provider") === "portone" ||
    process.env.NEXT_PUBLIC_PAYMENT_PROVIDER === "portone"
      ? "portone"
      : "toss";
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [couponCode, setCouponCode] = useState("");
  const [paymentConsent, setPaymentConsent] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneNumberTouched, setPhoneNumberTouched] = useState(false);
  // KG이니시스 빌링은 customer.email REQUIRED. auth email 없는 유저만 수동 입력.
  const [checkoutEmail, setCheckoutEmail] = useState("");
  const [checkoutEmailTouched, setCheckoutEmailTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve plan or lecture info
  const planInfo = plan ? PLAN_PRICES[plan] : null;
  const lectureInfo = lectureSlug
    ? lectures.find((l) => l.slug === lectureSlug)
    : null;

  const isLecture = type === "lecture" && !!lectureSlug;
  const itemName = isLecture
    ? (locale === "ko" ? lectureInfo?.title_ko : lectureInfo?.title_en) ||
      lectureSlug
    : planInfo?.name || "";
  const baseAmount = isLecture
    ? lectureInfo?.price || 0
    : planInfo
      ? billing === "annual"
        ? planInfo.annual
        : planInfo.monthly
      : 0;
  const finalAmount = Math.max(0, baseAmount - discount);
  const baseAmountLabel = `\u20A9${baseAmount.toLocaleString()}`;
  const autoRenewNotice =
    billing === "annual"
      ? t("annualAutoRenewNotice", { amount: baseAmountLabel })
      : t("monthlyAutoRenewNotice", { amount: baseAmountLabel });
  const requiresPhoneNumber = paymentProvider === "portone";
  const isPhoneNumberValid =
    !requiresPhoneNumber || /^\d{10,11}$/.test(phoneNumber);
  const showPhoneNumberError =
    requiresPhoneNumber && phoneNumberTouched && !isPhoneNumberValid;
  // PortOne(KG이니시스) 결제 시 email 필수. auth email 있으면 그대로, 없으면 입력 필드.
  const requiresCheckoutEmail =
    paymentProvider === "portone" && !user?.email;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const resolvedCheckoutEmail = (
    user?.email ||
    checkoutEmail.trim() ||
    ""
  ).trim();
  const isCheckoutEmailValid =
    !requiresCheckoutEmail || EMAIL_RE.test(resolvedCheckoutEmail);
  const showCheckoutEmailError =
    requiresCheckoutEmail &&
    checkoutEmailTouched &&
    !isCheckoutEmailValid;
  const paymentProcessorName = t(
    paymentProvider === "portone"
      ? "paymentProcessorPortOne"
      : "paymentProcessorToss",
  );

  // Validate query params
  const isValid = isLecture ? !!lectureInfo : !!planInfo;

  // 강의 실결제 차단(A안): 강의 콘텐츠 미준비 상태이므로 강의 체크아웃 진입
  // 자체를 막고 강의 상세("출시 알림 받기")로 돌려보낸다. 직접 URL 진입도 차단.
  // 되돌릴 때: 이 useEffect 를 제거하면 실결제 흐름이 복구된다.
  useEffect(() => {
    if (type === "lecture") {
      router.replace(
        lectureSlug
          ? `/${locale}/lectures/${lectureSlug}`
          : `/${locale}/lectures`,
      );
    }
  }, [type, lectureSlug, locale, router]);

  useEffect(() => {
    // 강의는 위 가드에서 리다이렉트하므로 로그인 리다이렉트를 걸지 않는다.
    if (type === "lecture") return;
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthLoading(false);
      if (!u) {
        const redirectPath = isLecture
          ? `/${locale}/checkout?type=lecture&slug=${lectureSlug}`
          : `/${locale}/checkout?plan=${plan}`;
        router.push(
          `/${locale}/auth/login?redirect=${encodeURIComponent(redirectPath)}`,
        );
      } else {
        setUser(u);
      }
    });
    return () => unsub();
  }, [locale, plan, lectureSlug, isLecture, type, router]);

  const loadPortOneSDK = useCallback(async (): Promise<PortOneSDK> => {
    if (window.PortOne) return window.PortOne;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[src="https://cdn.portone.io/v2/browser-sdk.js"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(t("sdkLoadError"))), {
          once: true,
        });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.portone.io/v2/browser-sdk.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(t("sdkLoadError")));
      document.head.appendChild(script);
    });
    if (!window.PortOne) throw new Error(t("sdkLoadError"));
    return window.PortOne;
  }, [t]);

  // Pre-load selected payment SDK
  useEffect(() => {
    if (!user || !isValid) return;
    let cancelled = false;
    const preload = async () => {
      try {
        if (paymentProvider === "portone") {
          await loadPortOneSDK();
        } else {
          const { loadTossPayments } =
            await import("@tosspayments/tosspayments-sdk");
          await loadTossPayments(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || "");
        }
        if (!cancelled) setSdkReady(true);
      } catch (err) {
        console.error("Payment SDK preload error:", err);
        if (!cancelled) setError(t("sdkLoadError"));
      }
    };
    preload();
    return () => {
      cancelled = true;
    };
  }, [user, isValid, t, paymentProvider, loadPortOneSDK]);

  const handleCouponApply = useCallback(
    (result: { discountPercent?: number; code: string }) => {
      if (result.discountPercent) {
        setDiscount(Math.round((baseAmount * result.discountPercent) / 100));
      }
      setCouponCode(result.code);
    },
    [baseAmount],
  );

  // GA4 view_item — checkout 페이지 마운트 시 구독/강의 상세 보기.
  useEffect(() => {
    if (!isValid) return;
    trackViewItem({
      value: baseAmount,
      currency: "KRW",
      items: [
        {
          item_id: isLecture ? lectureSlug || "lecture" : plan || "plan",
          item_name: itemName,
          item_category: isLecture ? "lecture" : "subscription",
          price: baseAmount,
          quantity: 1,
          item_variant: isLecture ? undefined : billing,
        },
      ],
    });
  }, [isValid, baseAmount, isLecture, lectureSlug, plan, itemName, billing]);

  const handlePayment = async () => {
    if (!user) return;
    // 결제 전 필수 동의 게이팅 — 결제대행사(토스) 제3자 제공 동의 없이 결제 불가.
    if (!paymentConsent) {
      setError(t("consentRequired"));
      return;
    }
    if (!isPhoneNumberValid) {
      setPhoneNumberTouched(true);
      setError(t("phoneNumberInvalid"));
      return;
    }
    if (!isCheckoutEmailValid) {
      setCheckoutEmailTouched(true);
      setError(
        resolvedCheckoutEmail ? t("emailInvalid") : t("emailRequired"),
      );
      return;
    }
    setLoading(true);
    setError(null);
    // GA4 begin_checkout — 결제 요청 직전 발화(값/상품만, PII 없음).
    trackBeginCheckout({
      value: finalAmount,
      currency: "KRW",
      checkoutType: isLecture ? "lecture" : "subscription",
      items: [
        {
          item_id: isLecture ? lectureSlug || "lecture" : plan || "plan",
          item_name: itemName,
          item_category: isLecture ? "lecture" : "subscription",
          price: finalAmount,
          quantity: 1,
          item_variant: isLecture ? undefined : billing,
        },
      ],
    });
    // GA4 add_payment_info — 결제 수단 입력 완료 후 결제 버튼 직전 발화.
    // payment_type = "toss" | "portone"
    trackAddPaymentInfo({
      value: finalAmount,
      currency: "KRW",
      payment_type: paymentProvider,
      items: [
        {
          item_id: isLecture ? lectureSlug || "lecture" : plan || "plan",
          item_name: itemName,
          item_category: isLecture ? "lecture" : "subscription",
          price: finalAmount,
          quantity: 1,
          item_variant: isLecture ? undefined : billing,
        },
      ],
    });
    try {
      if (paymentProvider === "portone") {
        // PortOne customer — shared by requestPayment / requestIssueBillingKey.
        // fullName/email/phoneNumber field names must stay as-is (SDK contract).
        const fullName = (user.displayName || "Marblo User").trim();
        // KG이니시스: customer.email REQUIRED. auth email 우선, 없으면 수동 입력값.
        const email = resolvedCheckoutEmail;
        if (!email || !EMAIL_RE.test(email)) {
          setCheckoutEmailTouched(true);
          setError(email ? t("emailInvalid") : t("emailRequired"));
          throw new Error(email ? t("emailInvalid") : t("emailRequired"));
        }
        // Digits only, no hyphens; empty or not 10–11 digits → reject.
        const phoneDigits = phoneNumber.replace(/\D/g, "");
        if (!phoneDigits || !/^\d{10,11}$/.test(phoneDigits)) {
          setPhoneNumberTouched(true);
          setError(t("phoneNumberInvalid"));
          throw new Error(t("phoneNumberInvalid"));
        }
        const customer = {
          fullName,
          email,
          phoneNumber: phoneDigits,
        };

        const functions = getFunctions(app, "us-central1");
        const getConfig = httpsCallable<
          { kind: "one_time" | "subscription" },
          { storeId: string; channelKey: string }
        >(functions, "getPortOneCheckoutConfig");
        const { data: config } = await getConfig({
          kind: isLecture ? "one_time" : "subscription",
        });
        const portone = await loadPortOneSDK();
        const safePlan = plan || "pro";
        if (isLecture && lectureSlug) {
          const createIntent = httpsCallable<
            { planType: string; billing: string },
            { paymentId: string; orderName: string; amount: number }
          >(functions, "createPortOnePaymentIntent");
          const { data: intent } = await createIntent({
            planType: safePlan,
            billing,
          });
          const response = await portone.requestPayment({
            storeId: config.storeId,
            channelKey: config.channelKey,
            paymentId: intent.paymentId,
            orderName: intent.orderName || itemName,
            totalAmount: intent.amount,
            currency: "KRW",
            payMethod: "CARD",
            redirectUrl: `${window.location.origin}/${locale}/checkout/success?provider=portone&type=lecture&slug=${encodeURIComponent(lectureSlug)}&paymentId=${encodeURIComponent(intent.paymentId)}&plan=${safePlan}&billing=${billing}&amount=${intent.amount}`,
            customer,
          });
          if (response.code) throw new Error(response.message || response.code);
          const complete = httpsCallable(functions, "completePortOnePayment");
          await complete({
            paymentId: response.paymentId || intent.paymentId,
          });
          // amount/paymentId 로 success 페이지가 GA4 purchase 발화(멱등 complete + dedupe).
          router.push(
            `/${locale}/checkout/success?provider=portone&type=lecture&slug=${encodeURIComponent(lectureSlug)}&paymentId=${encodeURIComponent(intent.paymentId)}&plan=${safePlan}&amount=${intent.amount}`,
          );
        } else if (plan) {
          // KG이니시스 issueId 40자 제한 — uid 삽입 시 초과하므로 짧은 고정 prefix + UUID(무하이픈)
          const issueId = `mb_${crypto.randomUUID().replace(/-/g, "")}`;
          const response = await portone.requestIssueBillingKey({
            storeId: config.storeId,
            channelKey: config.channelKey,
            billingKeyMethod: "CARD",
            issueId,
            issueName: `Marblo ${itemName} 구독`,
            customer,
          });
          if (response.code) throw new Error(response.message || response.code);
          if (!response.billingKey) throw new Error(t("paymentError"));
          const complete = httpsCallable(functions, "completePortOneBillingKey");
          await complete({
            billingKey: response.billingKey,
            planType: plan,
            billing,
            coupon: couponCode || undefined,
            // PortOne billing-key charge requires customer.name/phone/email server-side.
            customerName: fullName,
            customerPhone: customer.phoneNumber,
            customerEmail: email,
          });
          // tx=issueId → success 페이지 GA4 purchase transaction_id (중복 가드 키)
          router.push(
            `/${locale}/checkout/success?provider=portone&plan=${plan}&billing=${billing}&amount=${finalAmount}&tx=${encodeURIComponent(issueId)}`,
          );
        }
      } else if (isLecture && lectureSlug) {
        const functions = getFunctions(app, "us-central1");
        const createOrder = httpsCallable(functions, "createLectureOrder");
        const { data } = (await createOrder({
          lectureSlug,
          userId: user.uid,
        })) as { data: { amount: number; orderId: string; orderName: string } };
        const { loadTossPayments } =
          await import("@tosspayments/tosspayments-sdk");
        const toss = await loadTossPayments(
          process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || "",
        );
        const payment = toss.payment({ customerKey: user.uid });
        await payment.requestPayment({
          method: "CARD",
          amount: { currency: "KRW", value: data.amount },
          orderId: data.orderId,
          orderName: data.orderName,
          successUrl: `${window.location.origin}/${locale}/checkout/success?type=lecture&slug=${lectureSlug}`,
          failUrl: `${window.location.origin}/${locale}/checkout/fail`,
        });
      } else if (plan) {
        const { loadTossPayments } =
          await import("@tosspayments/tosspayments-sdk");
        const toss = await loadTossPayments(
          process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || "",
        );
        const payment = toss.payment({ customerKey: user.uid });
        // amount 를 successUrl 에 실어 success 페이지 GA4 purchase value 로 사용.
        // Toss 가 authKey/customerKey 등을 쿼리에 추가한다.
        await payment.requestBillingAuth({
          method: "CARD",
          successUrl: `${window.location.origin}/${locale}/checkout/success?plan=${plan}&billing=${billing}&coupon=${encodeURIComponent(couponCode || "")}&amount=${finalAmount}`,
          failUrl: `${window.location.origin}/${locale}/checkout/fail`,
        });
      }
    } catch (err: unknown) {
      console.error("Payment error:", err);
      const message = err instanceof Error ? err.message : t("paymentError");
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // 강의 결제 비활성 — 위 가드 useEffect 가 리다이렉트하는 동안 UI 노출 방지.
  if (type === "lecture") return null;

  // Auth loading state
  if (authLoading) {
    return (
      <div className="py-24 px-4 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) return null;

  // Invalid params
  if (!isValid) {
    return (
      <div className="py-24 px-4">
        <div className="max-w-lg mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <p className="text-zinc-300 mb-6">
            {isLecture ? t("invalidLecture") : t("invalidPlan")}
          </p>
          <button
            onClick={() =>
              router.push(
                isLecture ? `/${locale}/lectures` : `/${locale}/pricing`,
              )
            }
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-24 px-4">
      <div className="max-w-lg mx-auto">
        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("back")}
        </button>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <ShoppingCart className="w-6 h-6 text-indigo-400" />
            <h1 className="text-2xl font-bold">{t("title")}</h1>
          </div>

          {/* SDK loading indicator */}
          {!sdkReady && !error && (
            <div className="flex items-center gap-3 text-zinc-400 mb-6 p-3 bg-zinc-800/50 rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{t("loading")}</span>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-3 text-red-400 mb-6 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Order summary */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              {t("orderSummary")}
            </h2>

            {/* Item name */}
            <div className="flex justify-between items-start gap-4">
              <span className="text-zinc-400">
                {isLecture ? t("lectureTitle") : t("plan")}
              </span>
              <span className="font-semibold text-right">{itemName}</span>
            </div>

            {/* Price */}
            <div className="flex justify-between">
              <span className="text-zinc-400">{t("amount")}</span>
              <span>
                {"\u20A9"}
                {baseAmount.toLocaleString()}
                {!isLecture &&
                  (billing === "annual" ? t("annual") : t("monthly"))}
              </span>
            </div>

            {/* Coupon (subscriptions only) */}
            {!isLecture && user && (
              <CouponInput onApply={handleCouponApply} userId={user.uid} />
            )}

            {/* Discount */}
            {discount > 0 && (
              <div className="flex justify-between text-green-400">
                <span>{t("discount")}</span>
                <span>
                  -{"\u20A9"}
                  {discount.toLocaleString()}
                </span>
              </div>
            )}

            {/* Total */}
            <div className="border-t border-zinc-700 pt-4 flex justify-between text-lg font-bold">
              <span>{t("total")}</span>
              <span>
                {"\u20A9"}
                {finalAmount.toLocaleString()}
                {!isLecture &&
                  (billing === "annual" ? t("annual") : t("monthly"))}
              </span>
            </div>

            {!isLecture && (
              <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/60 px-3 py-3 text-sm text-zinc-300 leading-relaxed">
                <p className="font-medium text-zinc-100">
                  {autoRenewNotice}
                </p>
                {/* 토스 계약과정 FAQ §3(무형재화) — 최대 서비스 제공기간 명시.
                    근거: billing.ts 의 nextPeriodEnd() = 월간 +1개월 / 연간
                    +12개월, selectDueForCharge 가 만료 전 선청구를 막아
                    사전결제 예약기간 0. 연간은 12개월 — 1년을 초과하는
                    제공기간은 토스에서 결제 이용이 불가하다. */}
                {billing === "annual" ? (
                  <p className="mt-1 text-xs text-zinc-300">
                    {t("annualServicePeriod")}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-zinc-300">
                    {t("monthlyServicePeriodNotice")}
                  </p>
                )}
                <p className="mt-1 text-xs text-zinc-400">
                  {t("cancelNotice")}
                </p>
              </div>
            )}

            {requiresCheckoutEmail && (
              <div className="space-y-2">
                <label
                  htmlFor="checkout-email"
                  className="block text-sm font-medium text-zinc-300"
                >
                  {t("emailLabel")}
                </label>
                <input
                  id="checkout-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={checkoutEmail}
                  onChange={(event) => {
                    setCheckoutEmail(event.target.value);
                    if (error) setError(null);
                  }}
                  onBlur={() => setCheckoutEmailTouched(true)}
                  placeholder={t("emailPlaceholder")}
                  aria-invalid={showCheckoutEmailError}
                  aria-describedby={
                    showCheckoutEmailError
                      ? "checkout-email-error"
                      : undefined
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                {showCheckoutEmailError && (
                  <p
                    id="checkout-email-error"
                    className="text-sm text-red-400"
                  >
                    {checkoutEmail.trim()
                      ? t("emailInvalid")
                      : t("emailRequired")}
                  </p>
                )}
              </div>
            )}

            {requiresPhoneNumber && (
              <div className="space-y-2">
                <label
                  htmlFor="checkout-phone-number"
                  className="block text-sm font-medium text-zinc-300"
                >
                  {t("phoneNumberLabel")}
                </label>
                <input
                  id="checkout-phone-number"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phoneNumber}
                  onChange={(event) => {
                    setPhoneNumber(event.target.value.replace(/\D/g, ""));
                    if (error) setError(null);
                  }}
                  onBlur={() => setPhoneNumberTouched(true)}
                  placeholder={t("phoneNumberPlaceholder")}
                  aria-invalid={showPhoneNumberError}
                  aria-describedby={
                    showPhoneNumberError
                      ? "checkout-phone-number-error"
                      : undefined
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  maxLength={11}
                />
                {showPhoneNumberError && (
                  <p
                    id="checkout-phone-number-error"
                    className="text-sm text-red-400"
                  >
                    {t("phoneNumberInvalid")}
                  </p>
                )}
              </div>
            )}

            {/* Payment consent gate (PIPA — 결제대행사 제3자 제공 동의) */}
            <label className="flex items-start gap-2.5 mt-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={paymentConsent}
                onChange={(e) => {
                  setPaymentConsent(e.target.checked);
                  if (error) setError(null);
                }}
                className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/40 shrink-0"
              />
              <span className="text-sm text-zinc-300 leading-snug">
                {t("consentLabel", { processor: paymentProcessorName })}{" "}
                <Link
                  href={`/${locale}/legal/privacy`}
                  target="_blank"
                  className="text-indigo-400 hover:text-indigo-300 underline"
                >
                  {t("consentView")}
                </Link>
              </span>
            </label>

            {/* Third-party provision disclosure (PIPA — 제3자 제공 고지) */}
            <div className="mt-2 rounded-lg bg-zinc-800/40 border border-zinc-700/60 px-3 py-2.5 text-xs text-zinc-400 leading-relaxed">
              <p className="font-medium text-zinc-300">
                {t("thirdPartyTitle")}
              </p>
              <ul className="mt-1 space-y-0.5">
                <li>
                  {t("thirdPartyRecipient", {
                    processor: paymentProcessorName,
                  })}
                </li>
                <li>
                  {t(
                    paymentProvider === "portone"
                      ? "thirdPartyItemsPortOne"
                      : "thirdPartyItemsToss",
                  )}
                </li>
                <li>{t("thirdPartyPurpose")}</li>
                <li>{t("thirdPartyRetention")}</li>
              </ul>
            </div>

            {/* Pay button */}
            <button
              onClick={handlePayment}
              disabled={
                loading ||
                !sdkReady ||
                !paymentConsent ||
                !isPhoneNumberValid ||
                !isCheckoutEmailValid
              }
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl text-lg font-semibold transition mt-4 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {t("processing")}
                </>
              ) : (
                t("pay")
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
