"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { httpsCallable, getFunctions } from "firebase/functions";
import { auth } from "@/lib/firebase";
import app from "@/lib/firebase";
import {
  Loader2,
  AlertCircle,
  Check,
  ShieldAlert,
  Users,
  UserCheck,
  Award,
  MessageSquare,
  Mail,
  X,
} from "lucide-react";

// 신청 목록 항목 (getFounderWaitlist 함수 응답; 날짜는 ISO 문자열).
type WaitlistEntry = {
  id: string;
  email: string;
  locale?: string | null;
  source?: string | null;
  createdAt?: string | null;
};

// 파운더 현황 항목 (listFounders 함수 응답).
type FounderEntry = {
  email: string;
  status?: string | null;
  accessGrantedAt?: string | null;
  feedbackSubmittedAt?: string | null;
  interviewedAt?: string | null;
  proGrantedMonths?: number;
  feedbackId?: string | null;
  hasFeedback?: boolean;
};

// 6문항 피드백 (getFounderFeedbackByEmail 함수 응답).
type FounderFeedback = {
  answers: {
    q1: string;
    q2: string;
    q3: string;
    q4: string;
    q5: string;
    reason: string;
  };
  rating: number | null;
  consentQuote: boolean;
  createdAt: string | null;
};

// Firebase callable errors carry a `code` like "functions/permission-denied".
type CallableError = { code?: string; message?: string };

function mapError(
  err: CallableError,
  kind: "select" | "interview" | "list" | "resend"
): string {
  const code = err?.code || "";
  if (code === "functions/permission-denied") {
    return "어드민 권한이 없습니다 (ADMIN_UID 미설정 또는 계정 불일치).";
  }
  if (kind === "interview") {
    if (code === "functions/failed-precondition") {
      return "해당 파운더가 아직 피드백을 제출하지 않았습니다(계정 미연결).";
    }
    if (code === "functions/already-exists") {
      return "이미 인터뷰 보너스가 적용되었습니다.";
    }
  }
  return err?.message || "알 수 없는 오류가 발생했습니다.";
}

// ISO 문자열을 한국어 날짜·시각으로. 없거나 파싱 실패 시 "—".
function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function AdminPage() {
  const locale = useLocale();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Waitlist state
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Per-row "선정" state, keyed by entry id
  const [selecting, setSelecting] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // Interview section state
  const [interviewEmail, setInterviewEmail] = useState("");
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewSuccess, setInterviewSuccess] = useState<string | null>(null);
  const [interviewError, setInterviewError] = useState<string | null>(null);

  // 파운더 현황 state
  const [founders, setFounders] = useState<FounderEntry[]>([]);
  const [foundersLoading, setFoundersLoading] = useState(true);
  const [foundersError, setFoundersError] = useState<string | null>(null);

  // 접근 이메일 재발송 state (이메일 키)
  const [resending, setResending] = useState<Record<string, boolean>>({});
  const [resendMsg, setResendMsg] = useState<Record<string, string>>({});

  // 피드백 열람 모달 state
  const [fbOpen, setFbOpen] = useState(false);
  const [fbEmail, setFbEmail] = useState("");
  const [fbLoading, setFbLoading] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);
  const [fbData, setFbData] = useState<FounderFeedback | null>(null);
  const [fbEmpty, setFbEmpty] = useState(false);

  // Auth gate
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthLoading(false);
      if (!u) {
        router.push(
          `/${locale}/auth/login?redirect=${encodeURIComponent(
            "/" + locale + "/admin"
          )}`
        );
      } else {
        setUser(u);
      }
    });
    return () => unsub();
  }, [locale, router]);

  // 신청 목록 로드 (Cloud Function 경유 — 클라 직접 조회는 규칙으로 차단됨).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      setListLoading(true);
      setListError(null);
      try {
        const fn = httpsCallable<unknown, { items: WaitlistEntry[] }>(
          getFunctions(app, "us-central1"),
          "getFounderWaitlist"
        );
        const res = await fn({});
        if (cancelled) return;
        setEntries(res.data.items || []);
      } catch (err: unknown) {
        if (cancelled) return;
        setListError(mapError(err as CallableError, "list"));
      } finally {
        if (!cancelled) setListLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 파운더 현황 로드 (Cloud Function 경유).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      setFoundersLoading(true);
      setFoundersError(null);
      try {
        const fn = httpsCallable<unknown, { items: FounderEntry[] }>(
          getFunctions(app, "us-central1"),
          "listFounders"
        );
        const res = await fn({});
        if (cancelled) return;
        setFounders(res.data.items || []);
      } catch (err: unknown) {
        if (cancelled) return;
        setFoundersError(mapError(err as CallableError, "list"));
      } finally {
        if (!cancelled) setFoundersLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 피드백 열람 — 이메일로 6문항 조회 후 모달 표시.
  const openFeedback = useCallback(async (email: string) => {
    setFbOpen(true);
    setFbEmail(email);
    setFbLoading(true);
    setFbError(null);
    setFbData(null);
    setFbEmpty(false);
    try {
      const fn = httpsCallable<
        { email: string },
        { feedback: FounderFeedback | null }
      >(getFunctions(app, "us-central1"), "getFounderFeedbackByEmail");
      const res = await fn({ email });
      if (res.data.feedback) {
        setFbData(res.data.feedback);
      } else {
        setFbEmpty(true);
      }
    } catch (err: unknown) {
      setFbError(mapError(err as CallableError, "list"));
    } finally {
      setFbLoading(false);
    }
  }, []);

  const handleSelect = useCallback(async (entry: WaitlistEntry) => {
    setSelecting((s) => ({ ...s, [entry.id]: true }));
    setRowError((e) => {
      const next = { ...e };
      delete next[entry.id];
      return next;
    });
    try {
      const functions = getFunctions(app, "us-central1");
      const fn = httpsCallable(functions, "markFounderSelected");
      await fn({ email: entry.email });
      setSelected((s) => ({ ...s, [entry.id]: true }));
    } catch (err: unknown) {
      const message = mapError(err as CallableError, "select");
      setRowError((e) => ({ ...e, [entry.id]: message }));
    } finally {
      setSelecting((s) => ({ ...s, [entry.id]: false }));
    }
  }, []);

  const handleInterview = useCallback(async () => {
    const email = interviewEmail.trim();
    if (!email) return;
    setInterviewLoading(true);
    setInterviewSuccess(null);
    setInterviewError(null);
    try {
      const functions = getFunctions(app, "us-central1");
      const fn = httpsCallable(functions, "markFounderInterviewed");
      await fn({ email });
      setInterviewSuccess(
        `인터뷰 보너스(+3개월)가 적용되었습니다 — 총 6개월로 연장됨.`
      );
    } catch (err: unknown) {
      setInterviewError(mapError(err as CallableError, "interview"));
    } finally {
      setInterviewLoading(false);
    }
  }, [interviewEmail]);

  // 접근 안내 이메일 재발송 (resendFounderAccessEmail).
  const handleResend = useCallback(async (email: string) => {
    if (!email) return;
    setResending((s) => ({ ...s, [email]: true }));
    setResendMsg((m) => ({ ...m, [email]: "" }));
    try {
      const functions = getFunctions(app, "us-central1");
      const fn = httpsCallable<unknown, { ok: boolean; emailSent: boolean }>(
        functions,
        "resendFounderAccessEmail"
      );
      const res = await fn({ email });
      setResendMsg((m) => ({
        ...m,
        [email]: res.data?.emailSent
          ? "재발송 완료"
          : "발송 스킵(이메일 미설정)",
      }));
    } catch (err: unknown) {
      setResendMsg((m) => ({
        ...m,
        [email]: mapError(err as CallableError, "resend"),
      }));
    } finally {
      setResending((s) => ({ ...s, [email]: false }));
    }
  }, []);

  // Auth loading
  if (authLoading) {
    return (
      <div className="py-24 px-4 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 py-16 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <header>
          <div className="flex items-center gap-3 mb-2">
            <Award className="w-7 h-7 text-indigo-400" />
            <h1 className="text-2xl font-bold">파운더 어드민</h1>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">
            대기자(waitlist)를 확인하고 파운더를 선정하세요. 선정 시 3일간의
            피드백 제출 기간이 시작됩니다. 파운더 현황과 제출된 6문항 피드백은
            아래 &quot;파운더 현황&quot; 섹션에서 바로 확인할 수 있습니다.
          </p>
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-900/40 rounded-lg p-3">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              이 페이지의 작업은 서버 측에서 어드민 권한으로 게이트됩니다.{" "}
              <code className="text-amber-300">ADMIN_UID</code>가 설정되어 있지
              않거나 계정이 일치하지 않으면 작업이 실패합니다.
            </span>
          </div>
        </header>

        {/* Waitlist card */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-semibold">대기자 명단</h2>
            </div>
            {!listLoading && !listError && (
              <span className="text-sm text-zinc-400">
                총 {entries.length}명
              </span>
            )}
          </div>

          {listLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
          ) : listError ? (
            <div className="flex items-start gap-3 text-red-400 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <p className="text-sm">{listError}</p>
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">
              대기자가 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-800">
                    <th className="py-2 pr-4 font-medium">이메일</th>
                    <th className="py-2 pr-4 font-medium">소스</th>
                    <th className="py-2 pr-4 font-medium">신청일</th>
                    <th className="py-2 font-medium text-right">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const isSelecting = !!selecting[entry.id];
                    const isSelected = !!selected[entry.id];
                    const err = rowError[entry.id];
                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-zinc-800/60 last:border-0 align-top"
                      >
                        <td className="py-3 pr-4 break-all">{entry.email}</td>
                        <td className="py-3 pr-4 text-zinc-400">
                          {entry.source || "—"}
                        </td>
                        <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                          {formatDate(entry.createdAt)}
                        </td>
                        <td className="py-3 text-right">
                          {isSelected ? (
                            <span className="inline-flex items-center gap-1.5 text-green-400 text-sm font-medium">
                              <Check className="w-4 h-4" />
                              선정됨
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSelect(entry)}
                              disabled={isSelecting}
                              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-sm font-medium transition"
                            >
                              {isSelecting && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              )}
                              선정
                            </button>
                          )}
                          {err && (
                            <p className="mt-1.5 text-xs text-red-400 max-w-[16rem] ml-auto">
                              {err}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Interview card */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserCheck className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold">인터뷰 완료 처리</h2>
          </div>
          <p className="text-sm text-zinc-400 mb-4">
            인터뷰를 마친 파운더의 이메일을 입력하면 보너스(+3개월)를
            적용합니다.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              value={interviewEmail}
              onChange={(e) => setInterviewEmail(e.target.value)}
              placeholder="founder@example.com"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleInterview}
              disabled={interviewLoading || !interviewEmail.trim()}
              className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap"
            >
              {interviewLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              인터뷰 보너스 적용(+3개월)
            </button>
          </div>
          {interviewSuccess && (
            <div className="mt-3 flex items-start gap-2 text-green-400 text-sm p-3 bg-green-950/30 border border-green-900/40 rounded-lg">
              <Check className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{interviewSuccess}</span>
            </div>
          )}
          {interviewError && (
            <div className="mt-3 flex items-start gap-2 text-red-400 text-sm p-3 bg-red-950/30 border border-red-900/50 rounded-lg">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{interviewError}</span>
            </div>
          )}
        </section>

        {/* 파운더 현황 card */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-semibold">파운더 현황</h2>
            </div>
            {!foundersLoading && !foundersError && (
              <span className="text-sm text-zinc-400">
                총 {founders.length}명
              </span>
            )}
          </div>

          {foundersLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
          ) : foundersError ? (
            <div className="flex items-start gap-3 text-red-400 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <p className="text-sm">{foundersError}</p>
            </div>
          ) : founders.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">
              선정된 파운더가 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-800">
                    <th className="py-2 pr-4 font-medium">이메일</th>
                    <th className="py-2 pr-4 font-medium">상태</th>
                    <th className="py-2 pr-4 font-medium">접근부여</th>
                    <th className="py-2 pr-4 font-medium">피드백제출</th>
                    <th className="py-2 pr-4 font-medium">인터뷰</th>
                    <th className="py-2 pr-4 font-medium">Pro개월</th>
                    <th className="py-2 pr-4 font-medium">접근이메일</th>
                    <th className="py-2 font-medium text-right">피드백</th>
                  </tr>
                </thead>
                <tbody>
                  {founders.map((f) => (
                    <tr
                      key={f.email}
                      className="border-b border-zinc-800/60 last:border-0 align-top"
                    >
                      <td className="py-3 pr-4 break-all">{f.email}</td>
                      <td className="py-3 pr-4 text-zinc-300">
                        {f.status || "—"}
                      </td>
                      <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                        {formatDate(f.accessGrantedAt)}
                      </td>
                      <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                        {formatDate(f.feedbackSubmittedAt)}
                      </td>
                      <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                        {formatDate(f.interviewedAt)}
                      </td>
                      <td className="py-3 pr-4 text-zinc-300">
                        {f.proGrantedMonths ?? 0}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => handleResend(f.email)}
                            disabled={!!resending[f.email]}
                            className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-100 px-3 py-1.5 rounded-lg text-xs font-medium transition w-fit"
                          >
                            {resending[f.email] ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Mail className="w-3.5 h-3.5" />
                            )}
                            재발송
                          </button>
                          {resendMsg[f.email] && (
                            <span className="text-xs text-zinc-400">
                              {resendMsg[f.email]}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        {f.hasFeedback ? (
                          <button
                            onClick={() => openFeedback(f.email)}
                            className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-3 py-1.5 rounded-lg text-sm font-medium transition"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            보기
                          </button>
                        ) : (
                          <span className="text-xs text-zinc-600">미제출</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 임의 이메일 피드백 조회 */}
          <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              value={fbEmail}
              onChange={(e) => setFbEmail(e.target.value)}
              placeholder="피드백을 볼 이메일 (founder@example.com)"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => openFeedback(fbEmail.trim())}
              disabled={!fbEmail.trim()}
              className="inline-flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-100 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap"
            >
              <MessageSquare className="w-4 h-4" />
              피드백 보기
            </button>
          </div>
        </section>
      </div>

      {/* 피드백 열람 모달 */}
      {fbOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setFbOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-semibold break-all">
                  피드백 — {fbEmail}
                </h3>
              </div>
              <button
                onClick={() => setFbOpen(false)}
                className="text-zinc-400 hover:text-zinc-200 transition shrink-0"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {fbLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
              </div>
            ) : fbError ? (
              <div className="flex items-start gap-3 text-red-400 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <p className="text-sm">{fbError}</p>
              </div>
            ) : fbEmpty ? (
              <p className="text-sm text-zinc-500 py-8 text-center">
                아직 제출된 피드백이 없습니다.
              </p>
            ) : fbData ? (
              <div className="space-y-4 text-sm">
                <div className="flex items-center gap-4 text-zinc-300">
                  <span>
                    점수:{" "}
                    <span className="font-semibold text-indigo-300">
                      {fbData.rating ?? "—"}/10
                    </span>
                  </span>
                  <span className="text-zinc-500">
                    제출: {formatDate(fbData.createdAt)}
                  </span>
                  {fbData.consentQuote && (
                    <span className="text-green-400 text-xs">인용 동의함</span>
                  )}
                </div>
                {(
                  [
                    ["① 무엇을 하려 했나", fbData.answers.q1],
                    ["② 좋았던 점", fbData.answers.q2],
                    ["③ 내 문제를 해결한 점", fbData.answers.q3],
                    ["④ 막히거나 아쉬운 점", fbData.answers.q4],
                    ["⑤ 있었으면 하는 것", fbData.answers.q5],
                    ["⑥ 점수 이유", fbData.answers.reason],
                  ] as const
                ).map(([label, val]) => (
                  <div key={label}>
                    <p className="text-zinc-500 mb-1">{label}</p>
                    <p className="text-zinc-100 whitespace-pre-wrap leading-relaxed">
                      {val || "—"}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
