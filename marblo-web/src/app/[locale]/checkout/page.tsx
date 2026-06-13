"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { httpsCallable, getFunctions } from "firebase/functions";
import { auth } from "@/lib/firebase";
import app from "@/lib/firebase";
import CouponInput from "@/components/CouponInput";
import { lectures } from "@/data/lectures";
import { ArrowLeft, Loader2, AlertCircle, ShoppingCart } from "lucide-react";

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
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [couponCode, setCouponCode] = useState("");
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

  // Validate query params
  const isValid = isLecture ? !!lectureInfo : !!planInfo;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthLoading(false);
      if (!u) {
        const redirectPath = isLecture
          ? `/${locale}/checkout?type=lecture&slug=${lectureSlug}`
          : `/${locale}/checkout?plan=${plan}`;
        router.push(
          `/${locale}/auth/login?redirect=${encodeURIComponent(redirectPath)}`
        );
      } else {
        setUser(u);
      }
    });
    return () => unsub();
  }, [locale, plan, lectureSlug, isLecture, router]);

  // Pre-load TossPayments SDK
  useEffect(() => {
    if (!user || !isValid) return;
    let cancelled = false;
    const preload = async () => {
      try {
        const { loadTossPayments } = await import(
          "@tosspayments/tosspayments-sdk"
        );
        await loadTossPayments(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || "");
        if (!cancelled) setSdkReady(true);
      } catch (err) {
        console.error("TossPayments SDK preload error:", err);
        if (!cancelled) setError(t("sdkLoadError"));
      }
    };
    preload();
    return () => {
      cancelled = true;
    };
  }, [user, isValid, t]);

  const handleCouponApply = useCallback(
    (result: { discountPercent?: number; code: string }) => {
      if (result.discountPercent) {
        setDiscount(Math.round((baseAmount * result.discountPercent) / 100));
      }
      setCouponCode(result.code);
    },
    [baseAmount]
  );

  const handlePayment = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      if (isLecture && lectureSlug) {
        const functions = getFunctions(app, "us-central1");
        const createOrder = httpsCallable(functions, "createLectureOrder");
        const { data } = (await createOrder({
          lectureSlug,
          userId: user.uid,
        })) as { data: { amount: number; orderId: string; orderName: string } };
        const { loadTossPayments } = await import(
          "@tosspayments/tosspayments-sdk"
        );
        const toss = await loadTossPayments(
          process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || ""
        );
        const payment = toss.payment({ customerKey: user.uid });
        await payment.requestPayment({
          method: "CARD",
          amount: { currency: "KRW", value: data.amount },
          orderId: data.orderId,
          orderName: data.orderName,
          successUrl: `${window.location.origin}/${locale}/checkout/success?type=lecture`,
          failUrl: `${window.location.origin}/${locale}/checkout/fail`,
        });
      } else if (plan) {
        const { loadTossPayments } = await import(
          "@tosspayments/tosspayments-sdk"
        );
        const toss = await loadTossPayments(
          process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || ""
        );
        const payment = toss.payment({ customerKey: user.uid });
        await payment.requestBillingAuth({
          method: "CARD",
          successUrl: `${window.location.origin}/${locale}/checkout/success?plan=${plan}&billing=${billing}&coupon=${couponCode}`,
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
                isLecture ? `/${locale}/lectures` : `/${locale}/pricing`
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

            {/* Pay button */}
            <button
              onClick={handlePayment}
              disabled={loading || !sdkReady}
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
