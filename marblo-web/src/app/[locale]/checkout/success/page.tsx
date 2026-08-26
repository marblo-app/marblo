"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable, getFunctions } from "firebase/functions";
import app, { auth, db } from "@/lib/firebase";
import { lectures } from "@/data/lectures";
import { trackPurchase } from "@/lib/gtag";
import { mapPaymentError } from "@/lib/paymentErrors";
import {
  Check,
  Loader2,
  BookOpen,
  Download,
  LayoutDashboard,
  Home,
  CreditCard,
} from "lucide-react";
import { localeHref } from "@/i18n/routing";

const PLAN_NAMES: Record<string, string> = {
  pro: "Pro",
  team: "Team",
  team_plus: "Team Plus",
};

/** 이 방문이 "방금 끝난 결제" 인지 판정하는 창. 지나면 이미 구독 중으로 본다. */
const FRESH_ACTIVATION_MS = 15 * 60 * 1000;

type ViewState = "processing" | "success" | "already" | "error";

/** Firestore Timestamp | Date | number → ms (없으면 null). */
function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof (v as { toDate?: unknown }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

interface SubscriptionReceipt {
  status: string | null;
  /** 서버가 실제로 청구한 금액(원). 구버전 문서면 null. */
  lastChargeAmount: number | null;
  /** 쿠폰을 넣었으나 서버가 정가로 폴백했는가. */
  couponRejected: boolean;
  activatedAtMs: number | null;
}

async function readSubscriptionReceipt(
  uid: string
): Promise<SubscriptionReceipt | null> {
  const snap = await getDoc(doc(db, "subscriptions", uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    status: typeof d.status === "string" ? d.status : null,
    lastChargeAmount:
      typeof d.lastChargeAmount === "number" ? d.lastChargeAmount : null,
    couponRejected: d.couponRejected === true,
    activatedAtMs: toMillis(d.currentPeriodStart),
  };
}

export default function CheckoutSuccessPage() {
  const t = useTranslations("checkout");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ViewState>("processing");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** ★화면에 그리는 금액은 서버가 청구한 값만 쓴다(쿼리 amount 아님). */
  const [chargedAmount, setChargedAmount] = useState<number | null>(null);
  const [couponRejected, setCouponRejected] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // GA4 purchase 중복 발화 가드 — StrictMode 이중 마운트/재실행 방지.
  const purchaseFiredRef = useRef(false);
  // 확정 로직 1회 실행 가드 — searchParams 신원 변화로 재실행되지 않게.
  const confirmStartedRef = useRef(false);

  const type = searchParams.get("type");
  const plan = searchParams.get("plan");
  const provider = searchParams.get("provider");
  const isLecture = type === "lecture";

  // 결제 확정 성공 시 GA4 purchase 1회만 발화 (강의 + 구독 Pro/Team/Team Plus).
  // transactionId 기준 중복 가드: ref(마운트 내) + sessionStorage(리로드/재마운트 간).
  // 이메일 등 PII 는 넣지 않는다 — transactionId(비식별)·금액·상품 id/제목만.
  const firePurchase = (args: {
    transactionId: string;
    value: number;
    itemId: string;
    itemName?: string;
    itemCategory: "lecture" | "subscription" | "one_time";
    itemVariant?: string;
  }) => {
    const {
      transactionId,
      value,
      itemId,
      itemName,
      itemCategory,
      itemVariant,
    } = args;
    if (!transactionId || !Number.isFinite(value) || value < 0) return;

    const dedupeKey = `ga4_purchase_${transactionId}`;
    if (purchaseFiredRef.current) return;
    try {
      if (
        typeof window !== "undefined" &&
        window.sessionStorage.getItem(dedupeKey)
      ) {
        purchaseFiredRef.current = true;
        return;
      }
    } catch {
      // sessionStorage 접근 불가 — ref 가드만으로 진행
    }
    purchaseFiredRef.current = true;
    try {
      if (typeof window !== "undefined")
        window.sessionStorage.setItem(dedupeKey, "1");
    } catch {
      // 무시 — 저장 실패해도 ref 가 이번 마운트 중복은 막음
    }

    trackPurchase({
      transactionId,
      value,
      currency: "KRW",
      items: [
        {
          item_id: itemId,
          item_name: itemName,
          item_category: itemCategory,
          price: value,
          quantity: 1,
          item_variant: itemVariant,
        },
      ],
    });
  };

  const resolveLectureItem = () => {
    const slug = searchParams.get("slug");
    const lecture = slug ? lectures.find((l) => l.slug === slug) : undefined;
    const itemName = lecture
      ? locale === "ko"
        ? lecture.title_ko
        : lecture.title_en
      : undefined;
    return { itemId: slug ?? "lecture", itemName };
  };

  const resolveSubscriptionItem = (planId: string) => {
    const billing = searchParams.get("billing") || "monthly";
    const planLabel = PLAN_NAMES[planId] || planId;
    const cycleLabel = billing === "annual" ? "Annual" : "Monthly";
    return {
      itemId: planId,
      itemName: `Marblo ${planLabel} (${cycleLabel})`,
      itemVariant: billing,
    };
  };

  // 로그인 상태 확정 — 성공 UI 는 로그인 사용자에게만 그린다.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || confirmStartedRef.current) return;
    // ★인증 게이트: 쿼리스트링만으로는 아무것도 성공으로 그리지 않는다.
    // 예전엔 URL 만 알면(또는 만들어내면) 누구나 결제 완료 화면과 GA4
    // purchase 를 띄울 수 있었다.
    if (!user) {
      setErrorMsg(t("loginRequired"));
      setState("error");
      return;
    }
    confirmStartedRef.current = true;
    const uid = user.uid;

    // 구독 결제의 공통 마감 — Firestore 구독 문서가 active 여야만 성공 UI.
    // 표시 금액·GA4 value 는 서버가 청구한 금액(lastChargeAmount 또는 callable
    // 응답 chargedAmount)만 쓴다. 클라이언트 계산액(?amount=)은 신뢰하지 않는다.
    const finishSubscription = async (args: {
      planId: string;
      transactionId: string;
      serverAmount?: number | null;
    }) => {
      const sub = await readSubscriptionReceipt(uid);
      if (!sub || sub.status !== "active") {
        setErrorMsg(t("notActivated"));
        setState("error");
        return;
      }
      const amount = args.serverAmount ?? sub.lastChargeAmount;
      setChargedAmount(amount);
      setCouponRejected(sub.couponRejected);

      // 방금 활성화된 결제가 아니면(직접 URL 진입·재방문) 성공 축하도 GA4 도
      // 띄우지 않는다 — 이미 구독 중 상태로 안내한다.
      const fresh =
        sub.activatedAtMs != null &&
        Date.now() - sub.activatedAtMs < FRESH_ACTIVATION_MS;
      if (!fresh) {
        setState("already");
        return;
      }

      setState("success");
      if (amount != null) {
        const subItem = resolveSubscriptionItem(args.planId);
        firePurchase({
          transactionId: args.transactionId,
          value: amount,
          itemId: subItem.itemId,
          itemName: subItem.itemName,
          itemCategory: "subscription",
          itemVariant: subItem.itemVariant,
        });
      }
    };

    const confirmPayment = async () => {
      const authKey = searchParams.get("authKey");
      const customerKey = searchParams.get("customerKey");
      const paymentKey = searchParams.get("paymentKey");
      const paymentId = searchParams.get("paymentId");
      const orderId = searchParams.get("orderId");
      const amountParam = searchParams.get("amount");
      const txParam = searchParams.get("tx");

      const functions = getFunctions(app, "us-central1");
      try {
        if (provider === "portone" && paymentId && plan) {
          // PortOne 단건(강의 등) — checkout 에서 이미 complete 했을 수 있으나
          // 리다이렉트 복귀 경로와 동일 callable 로 멱등 확정.
          // 실청구액은 서버 응답(chargedAmount)이 정본이다.
          const billing = searchParams.get("billing") || undefined;
          const complete = httpsCallable<
            { paymentId: string; planType: string; billing?: string },
            { success: boolean; chargedAmount?: number }
          >(functions, "completePortOnePayment");
          const { data: result } = await complete({
            paymentId,
            planType: plan,
            billing,
          });
          const serverAmount =
            typeof result?.chargedAmount === "number"
              ? result.chargedAmount
              : null;
          setChargedAmount(serverAmount);
          setState("success");
          if (serverAmount != null) {
            const lectureItem = resolveLectureItem();
            firePurchase({
              transactionId: paymentId,
              value: serverAmount,
              itemId: isLecture ? lectureItem.itemId : plan,
              itemName: isLecture
                ? lectureItem.itemName
                : resolveSubscriptionItem(plan).itemName,
              // 단건 결제는 구독을 열지 않는다 — 구독 상품으로 집계하지 않는다.
              itemCategory: isLecture ? "lecture" : "one_time",
              itemVariant: undefined,
            });
          }
        } else if (isLecture && paymentKey && orderId && amountParam) {
          // Toss 강의 결제 — 금액은 서버가 보관한 주문 금액과 대조해 확정한다
          // (불일치면 confirmLecturePayment 가 거절하므로 통과 = 서버 검증됨).
          const confirm = httpsCallable(functions, "confirmLecturePayment");
          await confirm({ paymentKey, orderId, amount: Number(amountParam) });
          const lectureItem = resolveLectureItem();
          setChargedAmount(Number(amountParam));
          setState("success");
          firePurchase({
            transactionId: orderId,
            value: Number(amountParam),
            itemId: lectureItem.itemId,
            itemName: lectureItem.itemName,
            itemCategory: "lecture",
            itemVariant: undefined,
          });
        } else if (authKey && customerKey && plan) {
          // Toss 구독 빌링키 발급 + 첫 청구
          // 쿠폰 코드를 첫 청구까지 전달(빈 문자열이면 미적용). checkout 페이지가
          // successUrl 에 &coupon= 로 실어 보낸다.
          const coupon = searchParams.get("coupon") || undefined;
          // ★결제 주기도 함께 전달한다. checkout 페이지가 successUrl 에
          // &billing= 로 이미 실어 보내고 있었는데 여기서 흘리고 있었다 — 그래서
          // 연간을 고른 사용자에게 연간 금액을 보여주고 서버는 주기를 모른 채
          // 월간 금액·1개월을 청구했다. 서버가 최종 정규화하므로
          // (normalizeBillingCycle) 값이 없거나 이상해도 월간으로 안전하게 떨어진다.
          const billing = searchParams.get("billing") || undefined;
          const issue = httpsCallable<
            {
              authKey: string;
              customerKey: string;
              plan: string;
              coupon?: string;
              billing?: string;
            },
            { chargedAmount?: number; couponRejected?: boolean }
          >(functions, "issueBillingKey");
          let serverAmount: number | null = null;
          try {
            const { data: issued } = await issue({
              authKey,
              customerKey,
              plan,
              coupon,
              billing,
            });
            serverAmount =
              typeof issued?.chargedAmount === "number"
                ? issued.chargedAmount
                : null;
          } catch (issueErr: unknown) {
            const msg =
              issueErr && typeof issueErr === "object" && "message" in issueErr
                ? String((issueErr as { message?: string }).message || "")
                : "";
            // 이미 구독 중 — 이중청구 없음. 새 결제가 아니므로 성공 축하도 GA4 도 없다.
            if (msg.includes("already_subscribed")) {
              setState("already");
              return;
            }
            // 카드 등록됨·청구 실패 — 재시도는 checkout 에서
            if (msg.includes("first_charge_failed")) {
              setErrorMsg(t("firstChargeFailed"));
              setState("error");
              return;
            }
            throw issueErr;
          }
          // authKey 는 빌링 인증 1회당 유일 — transaction_id 로 사용(PII 아님).
          await finishSubscription({
            planId: plan,
            transactionId: authKey,
            serverAmount,
          });
        } else if (plan && searchParams.get("retry")) {
          // checkout 의 retryFirstCharge 성공 후 착지 — 청구는 이미 끝났고
          // 여기서는 구독이 실제로 열렸는지만 확인한다.
          await finishSubscription({
            planId: plan,
            transactionId: `retry_${uid}_${plan}`,
          });
        } else if (provider === "portone" && plan) {
          // PortOne 구독: checkout 페이지에서 completePortOneBillingKey 까지 끝난 뒤
          // 여기로 리다이렉트만 한다(재확정 callable 없음). 그래서 응답을 못 받는다 —
          // ★구독 문서를 직접 읽어 active 를 확인하고, 실청구액도 거기서 가져온다.
          await finishSubscription({
            planId: plan,
            transactionId:
              txParam ||
              `portone_${plan}_${searchParams.get("billing") || "monthly"}`,
          });
        } else {
          // 확정할 결제 정보가 없는 진입 — 성공으로 그리지 않는다.
          setErrorMsg(t("paymentError"));
          setState("error");
        }
      } catch (err) {
        console.error("Confirmation error:", err);
        // Map HttpsError / PG codes to locale strings — never dump payment_not_paid etc.
        const mapped = mapPaymentError(err);
        setErrorMsg(t(mapped.key));
        setState("error");
      }
    };
    confirmPayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user, isLecture, plan, provider, t, locale]);

  return (
    <div className="py-24 px-4 text-center">
      <div className="max-w-md mx-auto">
        {state === "processing" ? (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-400 mx-auto" />
            <p className="text-zinc-400 text-lg">{t("processing")}</p>
            <p className="text-zinc-500 text-sm">
              {locale === "ko"
                ? "결제를 확인하고 있습니다. 잠시만 기다려주세요..."
                : "Verifying your payment. Please wait..."}
            </p>
          </div>
        ) : state === "already" ? (
          /* 이미 구독 중 — 이번 방문으로 새로 청구된 것이 없다. */
          <div className="space-y-6">
            <div className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center mx-auto">
              <CreditCard className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-2">
                {t("alreadySubscribedTitle")}
              </h1>
              <p className="text-zinc-400">{t("alreadySubscribedBody")}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href={localeHref(locale, "/my/subscription")}
                className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition font-semibold"
              >
                <CreditCard className="w-5 h-5" />
                {t("goToMySubscription")}
              </Link>
              <Link
                href={localeHref(locale)}
                className="inline-flex items-center justify-center gap-2 text-zinc-400 hover:text-white transition mt-2"
              >
                <Home className="w-4 h-4" />
                {t("goHome")}
              </Link>
            </div>
          </div>
        ) : state === "success" ? (
          <div className="space-y-6">
            {/* Success icon */}
            <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-10 h-10 text-white" />
            </div>

            {/* Title */}
            <div>
              <h1 className="text-2xl font-bold mb-2">{t("successTitle")}</h1>
              <p className="text-zinc-400">
                {isLecture ? t("successLecture") : t("successSubscription")}
              </p>
            </div>

            {/* Purchase details */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-left space-y-3">
              {!isLecture && plan && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">{t("purchasedPlan")}</span>
                  <span className="font-semibold">
                    {PLAN_NAMES[plan] || plan}
                  </span>
                </div>
              )}
              {isLecture && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">{t("lectureTitle")}</span>
                  <span className="font-semibold">
                    {locale === "ko"
                      ? "AI 에이전트 군단 마스터클래스"
                      : "AI Agent Army Masterclass"}
                  </span>
                </div>
              )}
              {/* ★서버가 실제로 청구한 금액. 클라이언트 계산액이 아니다. */}
              {chargedAmount != null && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">{t("purchasedAmount")}</span>
                  <span className="font-semibold">
                    {chargedAmount <= 0
                      ? t("freeFirstCharge")
                      : `₩${chargedAmount.toLocaleString()}`}
                  </span>
                </div>
              )}
              {/* 쿠폰을 넣었지만 서버가 쓰지 못한 경우(만료·소진·중복) 고지 */}
              {couponRejected && (
                <p className="text-sm text-amber-400 border-t border-zinc-800 pt-3">
                  {t("couponNotApplied")}
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              {isLecture ? (
                <Link
                  href={localeHref(locale, "/lectures/my")}
                  className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition font-semibold"
                >
                  <BookOpen className="w-5 h-5" />
                  {t("goToMyLectures")}
                </Link>
              ) : (
                <>
                  <Link
                    href={localeHref(locale, "/download")}
                    className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition font-semibold"
                  >
                    <Download className="w-5 h-5" />
                    {t("goToDownload")}
                  </Link>
                  <Link
                    href={localeHref(locale)}
                    className="inline-flex items-center justify-center gap-2 bg-zinc-700 hover:bg-zinc-600 text-white px-6 py-3 rounded-lg transition"
                  >
                    <LayoutDashboard className="w-5 h-5" />
                    {t("goToDashboard")}
                  </Link>
                </>
              )}
              <Link
                href={localeHref(locale)}
                className="inline-flex items-center justify-center gap-2 text-zinc-400 hover:text-white transition mt-2"
              >
                <Home className="w-4 h-4" />
                {t("goHome")}
              </Link>
            </div>
          </div>
        ) : (
          /* Error state */
          <div className="space-y-6">
            <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center mx-auto">
              <span className="text-3xl text-white">!</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-2">{t("failTitle")}</h1>
              <p className="text-zinc-400">{errorMsg || t("paymentError")}</p>
            </div>
            <Link
              href={
                errorMsg === t("loginRequired")
                  ? localeHref(
                      locale,
                      `/auth/login?redirect=${encodeURIComponent(
                        localeHref(locale, "/my/subscription")
                      )}`
                    )
                  : errorMsg === t("firstChargeFailed") && plan
                  ? localeHref(
                      locale,
                      `/checkout?plan=${encodeURIComponent(
                        plan
                      )}&billing=${encodeURIComponent(
                        searchParams.get("billing") || "monthly"
                      )}`
                    )
                  : localeHref(locale, "/pricing")
              }
              className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition"
            >
              {errorMsg === t("loginRequired")
                ? t("goToLogin")
                : errorMsg === t("firstChargeFailed")
                ? t("retryFirstCharge")
                : t("tryAgain")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
