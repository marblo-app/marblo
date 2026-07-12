"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable, getFunctions } from "firebase/functions";
import app, { auth, db } from "@/lib/firebase";
import {
  CreditCard,
  Loader2,
  ArrowUpRight,
  CalendarClock,
  AlertTriangle,
  Info,
} from "lucide-react";

type PlanType = "free" | "pro" | "team" | "team_plus" | "enterprise";
type SubStatus = "active" | "canceled" | "past_due" | "trialing";
type PaymentProvider = "paddle" | "toss";

interface SubDoc {
  planType: PlanType;
  status: SubStatus;
  paymentProvider?: PaymentProvider;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/** Firestore Timestamp | Date | undefined → Date | null (안전 변환). */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  // Firestore Timestamp: { toDate(): Date }
  if (typeof (v as { toDate?: unknown }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate();
  }
  return null;
}

export default function SubscriptionPage() {
  const t = useTranslations("subscription");
  const locale = useLocale();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<SubDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push(
          `/${locale}/auth/login?redirect=${encodeURIComponent(
            `/${locale}/my/subscription`
          )}`
        );
        return;
      }
      setUser(u);
      try {
        const snap = await getDoc(doc(db, "subscriptions", u.uid));
        if (snap.exists()) {
          const d = snap.data();
          setSub({
            planType: (d.planType as PlanType) || "free",
            status: (d.status as SubStatus) || "active",
            paymentProvider: d.paymentProvider as PaymentProvider | undefined,
            currentPeriodStart: toDate(d.currentPeriodStart),
            currentPeriodEnd: toDate(d.currentPeriodEnd),
          });
        } else {
          setSub(null); // 구독 문서 없음 = 무료 플랜
        }
      } catch {
        setSub(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [locale, router]);

  const handleCancel = async () => {
    if (!user || !sub) return;
    setError(null);
    setCanceling(true);
    try {
      const functions = getFunctions(app, "us-central1");
      // paymentProvider 에 맞는 해지 콜러블 선택. 둘 다 인증된 본인 구독만 해지.
      const fnName =
        sub.paymentProvider === "paddle"
          ? "cancelPaddleSubscription"
          : "cancelTossSubscription";
      const cancelFn = httpsCallable(functions, fnName);
      await cancelFn({});
      setSub((s) => (s ? { ...s, status: "canceled" } : s));
      setConfirmingCancel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cancel.error"));
    } finally {
      setCanceling(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 px-4 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  const dateFmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(d)
      : "-";

  const isPaid = !!sub && sub.planType !== "free";
  const isActive = sub?.status === "active" || sub?.status === "trialing";
  const canCancel = isPaid && isActive;

  const statusColor: Record<SubStatus, string> = {
    active: "text-emerald-300",
    trialing: "text-sky-300",
    past_due: "text-amber-300",
    canceled: "text-zinc-400",
  };

  return (
    <div className="py-24 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <CreditCard className="w-6 h-6 text-indigo-400" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <p className="text-sm text-zinc-400 mb-8">{t("subtitle")}</p>

        {/* 현재 플랜 */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1">{t("current_plan")}</p>
              <p className="text-2xl font-bold">
                {isPaid ? t(`plan.${sub!.planType}`) : t("plan.free")}
              </p>
              <p className="text-sm mt-2">
                <span className={statusColor[sub?.status ?? "active"]}>
                  {t(`status.${sub?.status ?? "active"}`)}
                </span>
              </p>
            </div>
            {!isPaid && (
              <Link
                href={`/${locale}/pricing`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 transition"
              >
                {t("upgrade")}
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            )}
          </div>

          {isPaid && (
            <div className="mt-6 divide-y divide-zinc-800 border-t border-zinc-800">
              <div className="flex items-center justify-between py-3">
                <span className="flex items-center gap-2 text-sm text-zinc-400">
                  <CalendarClock className="w-4 h-4" />
                  {sub!.status === "canceled"
                    ? t("period_end_canceled")
                    : t("next_renewal")}
                </span>
                <span className="text-sm text-zinc-200">
                  {dateFmt(sub!.currentPeriodEnd)}
                </span>
              </div>
              {sub!.paymentProvider && (
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-zinc-400">
                    {t("payment_method")}
                  </span>
                  <span className="text-sm text-zinc-200 capitalize">
                    {sub!.paymentProvider}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 업그레이드 (유료 사용자) */}
        {isPaid && isActive && (
          <Link
            href={`/${locale}/pricing`}
            className="flex items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6 hover:border-indigo-500 transition"
          >
            <div>
              <p className="text-sm font-semibold text-zinc-200">
                {t("change_plan.title")}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {t("change_plan.desc")}
              </p>
            </div>
            <ArrowUpRight className="w-5 h-5 text-indigo-400 shrink-0" />
          </Link>
        )}

        {/* 결제 내역 — billingCharges 는 현재 웹에서 직접 조회 불가(추후 제공) */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-zinc-200 mb-3">
            {t("history.title")}
          </h2>
          {isPaid && sub!.currentPeriodStart ? (
            <div className="flex items-center justify-between py-2 text-sm">
              <span className="text-zinc-400">
                {t("history.current_period")}
              </span>
              <span className="text-zinc-200">
                {dateFmt(sub!.currentPeriodStart)} –{" "}
                {dateFmt(sub!.currentPeriodEnd)}
              </span>
            </div>
          ) : null}
          <p className="flex items-start gap-2 text-xs text-zinc-500 mt-3 leading-relaxed">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {t("history.coming_soon")}
          </p>
        </section>

        {/* 해지 */}
        {canCancel && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              {t("cancel.title")}
            </h2>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              {t("cancel.desc")}
            </p>
            {!confirmingCancel ? (
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                className="mt-4 text-sm text-red-300 hover:text-red-200"
              >
                {t("cancel.button")}
              </button>
            ) : (
              <div className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 p-4">
                <p className="text-sm text-red-200">{t("cancel.confirm")}</p>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={canceling}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-50"
                  >
                    {canceling && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    {t("cancel.confirm_yes")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingCancel(false)}
                    disabled={canceling}
                    className="text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                  >
                    {t("cancel.confirm_no")}
                  </button>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
          </section>
        )}

        {/* 앱에서 관리 안내 */}
        <p className="text-xs text-zinc-600 leading-relaxed">{t("app_hint")}</p>

        <div className="mt-6">
          <Link
            href={`/${locale}/my`}
            className="text-sm text-indigo-300 hover:text-indigo-200"
          >
            ← {t("back_to_account")}
          </Link>
        </div>
      </div>
    </div>
  );
}
