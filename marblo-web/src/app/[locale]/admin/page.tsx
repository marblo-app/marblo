"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
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
  Bug,
  RefreshCw,
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

// 버그 신고 항목 (listBugReports 함수 응답).
type BugReportStatus = "new" | "triaged" | "resolved";
type BugReportItem = {
  id: string;
  uid: string;
  email: string | null;
  description: string;
  appVersion: string | null;
  platform: string | null;
  context: {
    recentLogs: string;
    route: string;
    agentSnapshot: string;
  };
  status: BugReportStatus;
  createdAt: string | null;
};

const BUG_STATUS_LABEL: Record<BugReportStatus, string> = {
  new: "신규",
  triaged: "확인됨",
  resolved: "해결됨",
};

const BUG_STATUS_ORDER: BugReportStatus[] = ["new", "triaged", "resolved"];
type AdminTab = "waitlist" | "founders" | "bugs";

const ADMIN_TABS: Array<{
  id: AdminTab;
  label: string;
  icon: typeof Users;
}> = [
  { id: "waitlist", label: "대기자", icon: Users },
  { id: "founders", label: "파운더 현황", icon: Award },
  { id: "bugs", label: "버그 신고", icon: Bug },
];

// Firebase callable errors carry a `code` like "functions/permission-denied".
type CallableError = { code?: string; message?: string };

function mapError(
  err: CallableError,
  kind: "select" | "interview" | "list" | "resend",
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export default function AdminPage() {
  const locale = useLocale();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 어드민 권한 판정: null=판정 전(로딩), true=어드민, false=권한 없음.
  // 신규 콜러블 없이 첫 어드민 데이터 호출(getFounderWaitlist)의
  // functions/permission-denied 신호를 재사용해 판정한다.
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // Waitlist state
  const [activeTab, setActiveTab] = useState<AdminTab>("waitlist");
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

  // 버그 신고 state
  const [bugReports, setBugReports] = useState<BugReportItem[]>([]);
  const [bugLoading, setBugLoading] = useState(true);
  const [bugError, setBugError] = useState<string | null>(null);
  const [bugStatusFilter, setBugStatusFilter] = useState<
    BugReportStatus | "all"
  >("all");
  const [bugUpdating, setBugUpdating] = useState<Record<string, boolean>>({});
  const [bugDetail, setBugDetail] = useState<BugReportItem | null>(null);
  const selectedFounderEmails = useMemo(() => {
    return new Set(
      founders
        .filter((f) => !!f.accessGrantedAt)
        .map((f) => normalizeEmail(f.email)),
    );
  }, [founders]);

  // Auth gate
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthLoading(false);
      if (!u) {
        router.push(
          `/${locale}/auth/login?redirect=${encodeURIComponent(
            "/" + locale + "/admin",
          )}`,
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
          "getFounderWaitlist",
        );
        const res = await fn({});
        if (cancelled) return;
        setEntries(res.data.items || []);
        setAuthorized(true);
      } catch (err: unknown) {
        if (cancelled) return;
        const ce = err as CallableError;
        // permission-denied 만 권한 없음으로 판정. 그 외(네트워크 등)는
        // 실제 어드민의 일시 오류일 수 있어 셸은 유지하고 에러만 표시.
        setAuthorized(
          ce?.code === "functions/permission-denied" ? false : true,
        );
        setListError(mapError(ce, "list"));
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
          "listFounders",
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

  // 버그 신고 목록 로드 (Cloud Function 경유 — 최신순 전량, UI 에서 status 필터).
  const loadBugReports = useCallback(async () => {
    setBugLoading(true);
    setBugError(null);
    try {
      const fn = httpsCallable<unknown, { items: BugReportItem[] }>(
        getFunctions(app, "us-central1"),
        "listBugReports",
      );
      const res = await fn({});
      setBugReports(res.data.items || []);
    } catch (err: unknown) {
      setBugError(mapError(err as CallableError, "list"));
    } finally {
      setBugLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadBugReports();
  }, [user, loadBugReports]);

  // 버그 신고 status 변경 (new → triaged → resolved). 낙관적 갱신.
  const handleBugStatus = useCallback(
    async (id: string, status: BugReportStatus) => {
      setBugUpdating((s) => ({ ...s, [id]: true }));
      try {
        const fn = httpsCallable(
          getFunctions(app, "us-central1"),
          "updateBugReportStatus",
        );
        await fn({ id, status });
        setBugReports((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status } : r)),
        );
        setBugDetail((d) => (d && d.id === id ? { ...d, status } : d));
      } catch (err: unknown) {
        setBugError(mapError(err as CallableError, "list"));
      } finally {
        setBugUpdating((s) => ({ ...s, [id]: false }));
      }
    },
    [],
  );

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
      setFounders((prev) => {
        const email = normalizeEmail(entry.email);
        const now = new Date().toISOString();
        let found = false;
        const next = prev.map((f) => {
          if (normalizeEmail(f.email) !== email) return f;
          found = true;
          return {
            ...f,
            email,
            status: f.status || "selected",
            accessGrantedAt: f.accessGrantedAt || now,
          };
        });
        if (found) return next;
        return [
          {
            email,
            status: "selected",
            accessGrantedAt: now,
            proGrantedMonths: 0,
            hasFeedback: false,
          },
          ...next,
        ];
      });
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
        `인터뷰 보너스(+3개월)가 적용되었습니다 — 총 6개월로 연장됨.`,
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
        "resendFounderAccessEmail",
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

  // 권한 판정 대기 — 어드민 데이터/구조가 노출되기 전 스피너만 표시.
  if (authorized === null) {
    return (
      <div className="py-24 px-4 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  // 로그인했으나 어드민이 아님 — 어드민 셸 대신 전체 차단 화면.
  if (authorized === false) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-5">
          <div className="flex justify-center">
            <div className="rounded-full bg-red-950/40 border border-red-900/50 p-4">
              <ShieldAlert className="w-8 h-8 text-red-400" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold">접근 권한 없음</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              이 페이지는 어드민만 접근할 수 있습니다. 현재 계정에는 어드민
              권한이 없습니다.
            </p>
          </div>
          <button
            onClick={() => router.push(`/${locale}`)}
            className="inline-flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
          >
            홈으로 가기
          </button>
        </div>
      </div>
    );
  }

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
            탭에서 바로 확인할 수 있습니다.
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

        <nav
          className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3"
          aria-label="어드민 섹션"
        >
          {ADMIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const count =
              tab.id === "waitlist"
                ? entries.length
                : tab.id === "founders"
                  ? founders.length
                  : bugReports.length;
            const hasError =
              (tab.id === "waitlist" && !!listError) ||
              (tab.id === "founders" && !!foundersError) ||
              (tab.id === "bugs" && !!bugError);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {hasError ? (
                  <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-200">
                    오류
                  </span>
                ) : (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      active
                        ? "bg-white/15 text-white"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Waitlist card */}
        {activeTab === "waitlist" && (
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
                    const isSelected =
                      !!selected[entry.id] ||
                      selectedFounderEmails.has(normalizeEmail(entry.email));
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
        )}

        {/* Interview card */}
        {activeTab === "founders" && (
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
        )}

        {/* 파운더 현황 card */}
        {activeTab === "founders" && (
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
        )}

        {/* 버그 신고 트리아지 card */}
        {activeTab === "bugs" && (
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-semibold">버그 신고</h2>
            </div>
            <div className="flex items-center gap-3">
              {!bugLoading && !bugError && (
                <span className="text-sm text-zinc-400">
                  총 {bugReports.length}건
                </span>
              )}
              <button
                onClick={loadBugReports}
                disabled={bugLoading}
                className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 text-sm transition"
                aria-label="새로고침"
              >
                <RefreshCw
                  className={`w-4 h-4 ${bugLoading ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          {/* status 필터 */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {(["all", ...BUG_STATUS_ORDER] as const).map((s) => {
              const active = bugStatusFilter === s;
              const count =
                s === "all"
                  ? bugReports.length
                  : bugReports.filter((r) => r.status === s).length;
              return (
                <button
                  key={s}
                  onClick={() => setBugStatusFilter(s)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    active
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {s === "all" ? "전체" : BUG_STATUS_LABEL[s]} ({count})
                </button>
              );
            })}
          </div>

          {bugLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
          ) : bugError ? (
            <div className="flex items-start gap-3 text-red-400 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <p className="text-sm">{bugError}</p>
            </div>
          ) : (
            (() => {
              const filtered =
                bugStatusFilter === "all"
                  ? bugReports
                  : bugReports.filter((r) => r.status === bugStatusFilter);
              if (filtered.length === 0) {
                return (
                  <p className="text-sm text-zinc-500 py-8 text-center">
                    신고가 없습니다.
                  </p>
                );
              }
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-800">
                        <th className="py-2 pr-4 font-medium">접수일</th>
                        <th className="py-2 pr-4 font-medium">상태</th>
                        <th className="py-2 pr-4 font-medium">신고자</th>
                        <th className="py-2 pr-4 font-medium">환경</th>
                        <th className="py-2 pr-4 font-medium">내용</th>
                        <th className="py-2 font-medium text-right">액션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-zinc-800/60 last:border-0 align-top"
                        >
                          <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                            {formatDate(r.createdAt)}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                r.status === "new"
                                  ? "bg-amber-950/40 text-amber-300"
                                  : r.status === "triaged"
                                    ? "bg-blue-950/40 text-blue-300"
                                    : "bg-green-950/40 text-green-300"
                              }`}
                            >
                              {BUG_STATUS_LABEL[r.status]}
                            </span>
                          </td>
                          <td className="py-3 pr-4 break-all text-zinc-300">
                            {r.email || "—"}
                          </td>
                          <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap text-xs">
                            <div>{r.platform || "—"}</div>
                            <div className="text-zinc-600">
                              v{r.appVersion || "—"}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-zinc-300 max-w-[20rem]">
                            <p className="line-clamp-2">{r.description}</p>
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex flex-col items-end gap-1.5">
                              <button
                                onClick={() => setBugDetail(r)}
                                className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                상세
                              </button>
                              <select
                                value={r.status}
                                disabled={!!bugUpdating[r.id]}
                                onChange={(e) =>
                                  handleBugStatus(
                                    r.id,
                                    e.target.value as BugReportStatus,
                                  )
                                }
                                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                              >
                                {BUG_STATUS_ORDER.map((s) => (
                                  <option key={s} value={s}>
                                    {BUG_STATUS_LABEL[s]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()
          )}
        </section>
        )}
      </div>

      {/* 버그 신고 상세 모달 */}
      {bugDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setBugDetail(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bug className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-semibold">버그 신고 상세</h3>
              </div>
              <button
                onClick={() => setBugDetail(null)}
                className="text-zinc-400 hover:text-zinc-200 transition shrink-0"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-400">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    bugDetail.status === "new"
                      ? "bg-amber-950/40 text-amber-300"
                      : bugDetail.status === "triaged"
                        ? "bg-blue-950/40 text-blue-300"
                        : "bg-green-950/40 text-green-300"
                  }`}
                >
                  {BUG_STATUS_LABEL[bugDetail.status]}
                </span>
                <span className="text-zinc-500">
                  {formatDate(bugDetail.createdAt)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-zinc-500 mb-0.5">신고자</p>
                  <p className="text-zinc-200 break-all">
                    {bugDetail.email || "—"}
                  </p>
                  <p className="text-zinc-600 break-all font-mono mt-0.5">
                    {bugDetail.uid}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 mb-0.5">환경</p>
                  <p className="text-zinc-200">
                    {bugDetail.platform || "—"} · v{bugDetail.appVersion || "—"}
                  </p>
                  <p className="text-zinc-600 mt-0.5">
                    {bugDetail.context.route || "—"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-zinc-500 mb-1">설명</p>
                <p className="text-zinc-100 whitespace-pre-wrap leading-relaxed">
                  {bugDetail.description}
                </p>
              </div>

              {bugDetail.context.agentSnapshot && (
                <div>
                  <p className="text-zinc-500 mb-1">에이전트 스냅샷</p>
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 overflow-x-auto">
                    {bugDetail.context.agentSnapshot}
                  </pre>
                </div>
              )}

              {bugDetail.context.recentLogs && (
                <div>
                  <p className="text-zinc-500 mb-1">최근 로그</p>
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 overflow-x-auto max-h-48">
                    {bugDetail.context.recentLogs}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
                <span className="text-xs text-zinc-500">상태 변경:</span>
                {BUG_STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleBugStatus(bugDetail.id, s)}
                    disabled={
                      !!bugUpdating[bugDetail.id] || bugDetail.status === s
                    }
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      bugDetail.status === s
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {BUG_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
