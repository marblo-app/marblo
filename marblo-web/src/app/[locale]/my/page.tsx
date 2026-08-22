"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  CreditCard,
  BookOpen,
  ShieldCheck,
  Loader2,
  LogOut,
  ChevronRight,
  UserRound,
} from "lucide-react";
import { localeHref } from "@/i18n/routing";

type PlanType = "free" | "pro" | "team" | "team_plus" | "enterprise";
type SubStatus = "active" | "canceled" | "past_due" | "trialing";

/** subscriptions/{uid} 에서 요약에 필요한 필드만. 없으면 free 로 취급. */
interface SubSummary {
  planType: PlanType;
  status: SubStatus;
}

export default function AccountHubPage() {
  const t = useTranslations("account");
  const locale = useLocale();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<SubSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push(
          localeHref(locale, `/auth/login?redirect=${encodeURIComponent(
            localeHref(locale, "/my")
          )}`)
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
          });
        } else {
          setSub({ planType: "free", status: "active" });
        }
      } catch {
        // 구독 문서 읽기 실패 → free 로 폴백(허브는 계속 노출)
        setSub({ planType: "free", status: "active" });
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [locale, router]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push(localeHref(locale));
  };

  if (loading) {
    return (
      <div className="py-24 px-4 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  const planLabel =
    sub && sub.planType !== "free" ? t(`plan.${sub.planType}`) : t("plan.free");
  const isActive = sub?.status === "active" || sub?.status === "trialing";

  return (
    <div className="py-24 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <UserRound className="w-6 h-6 text-indigo-400" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>

        {/* 로그인 정보 */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-4">
            {user?.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.photoURL}
                alt=""
                className="w-14 h-14 rounded-full object-cover"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
                <UserRound className="w-7 h-7 text-zinc-500" />
              </div>
            )}
            <div className="min-w-0">
              {user?.displayName && (
                <p className="text-base font-semibold truncate">
                  {user.displayName}
                </p>
              )}
              <p className="text-sm text-zinc-400 truncate">
                {user?.email ?? "-"}
              </p>
            </div>
          </div>
        </section>

        {/* 구독 요약 */}
        <Link
          href={localeHref(locale, "/my/subscription")}
          className="block bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6 hover:border-indigo-500 transition"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <CreditCard className="w-5 h-5 text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-200">
                  {t("subscription.title")}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {planLabel}
                  {" · "}
                  <span
                    className={isActive ? "text-emerald-300" : "text-zinc-400"}
                  >
                    {t(`status.${sub?.status ?? "active"}`)}
                  </span>
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-zinc-600 shrink-0" />
          </div>
        </Link>

        {/* 바로가기 링크 */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800 mb-6">
          <Link
            href={localeHref(locale, "/my/lectures")}
            className="flex items-center justify-between gap-4 p-6 hover:bg-zinc-800/40 transition first:rounded-t-2xl"
          >
            <div className="flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-indigo-400" />
              <span className="text-sm font-semibold text-zinc-200">
                {t("links.lectures")}
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-zinc-600" />
          </Link>
          <Link
            href={localeHref(locale, "/my/privacy")}
            className="flex items-center justify-between gap-4 p-6 hover:bg-zinc-800/40 transition last:rounded-b-2xl"
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
              <span className="text-sm font-semibold text-zinc-200">
                {t("links.privacy")}
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-zinc-600" />
          </Link>
        </section>

        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <LogOut className="w-4 h-4" />
          {t("logout")}
        </button>
      </div>
    </div>
  );
}
