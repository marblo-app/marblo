"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { httpsCallable, getFunctions } from "firebase/functions";
import {
  collection,
  getDocs,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import app from "@/lib/firebase";
import {
  Loader2,
  AlertCircle,
  Check,
  ShieldAlert,
  Users,
  UserCheck,
  Award,
} from "lucide-react";

type WaitlistEntry = {
  id: string;
  email: string;
  source?: string;
  createdAt?: Timestamp | null;
};

// Firebase callable errors carry a `code` like "functions/permission-denied".
type CallableError = { code?: string; message?: string };

function mapError(err: CallableError, kind: "select" | "interview"): string {
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

function formatDate(ts?: Timestamp | null): string {
  if (!ts || typeof ts.toDate !== "function") return "—";
  try {
    const d = ts.toDate();
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

  // Load waitlist
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      setListLoading(true);
      setListError(null);
      try {
        const q = query(
          collection(db, "betatester50_waitlist"),
          orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const rows: WaitlistEntry[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            email: (data.email as string) || "(이메일 없음)",
            source: data.source as string | undefined,
            createdAt: (data.createdAt as Timestamp | undefined) ?? null,
          };
        });
        setEntries(rows);
      } catch (err: unknown) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "목록을 불러오지 못했습니다.";
        setListError(message);
      } finally {
        if (!cancelled) setListLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

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
            피드백 제출 기간이 시작됩니다. 제출된 피드백과 Pro 상태는 현재
            Firestore 콘솔(
            <code className="text-zinc-300">founders</code>,{" "}
            <code className="text-zinc-300">founder_feedback</code>)에서 확인할
            수 있습니다.
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
      </div>
    </div>
  );
}
