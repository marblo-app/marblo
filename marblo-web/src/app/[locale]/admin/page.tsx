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
  Video,
  ClipboardList,
  Ban,
} from "lucide-react";
import AnalyticsPanel from "./AnalyticsPanel";
import ProjectAuditPanel from "./ProjectAuditPanel";
import { ADMIN_TABS, DEFAULT_ADMIN_TAB, type AdminTab } from "./adminTabs";
import { localeHref } from "@/i18n/routing";

// 신청 목록 항목 (getFounderWaitlist 함수 응답; 날짜는 ISO 문자열).
// 서버가 정규화 이메일 기준으로 중복 신청을 1건(최신)으로 접어서 내려준다.
// duplicateCount = 접히기 전 신청 수(2 이상이면 중복 신청자).
type WaitlistEntry = {
  id: string;
  email: string;
  normalizedEmail?: string | null;
  locale?: string | null;
  source?: string | null;
  createdAt?: string | null;
  status?: string | null;
  duplicateCount?: number;
};

// V2 루브릭 5차원 점수 (가중치: specificity·usageEvidence ×2).
type RubricScore = {
  total: number;
  specificity: number;
  usageEvidence: number;
  insightQuality: number;
  actionability: number;
  icpFit: number;
};

// 파운더 현황 항목 (listFounders 함수 응답).
type FounderEntry = {
  email: string;
  status?: string | null;
  accessGrantedAt?: string | null;
  betaExpiresAt?: string | null;
  feedbackSubmittedAt?: string | null;
  rubricScore?: RubricScore | null;
  interviewRequested?: boolean;
  interviewRequestedAt?: string | null;
  interviewCompleted?: boolean;
  interviewCompletedAt?: string | null;
  interviewedAt?: string | null;
  proGrantedMonths?: number;
  proExpiresAt?: string | null;
  feedbackId?: string | null;
  hasFeedback?: boolean;
};

// V2 7문항 설문 (getFounderFeedbackByEmail 함수 응답).
type FounderFeedback = {
  id: string;
  userId: string | null;
  email: string | null;
  locale: string | null;
  answers: {
    q1: string;
    q2: string;
    q3: string;
    q4: string;
    q5: string;
    q6: string;
    q7: string;
  };
  rubricScore: RubricScore | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  proGrantedMonths: number;
  betaExpiresAt: string | null;
  proExpiresAt: string | null;
  interviewRequested: boolean;
  interviewRequestedAt: string | null;
  interviewCompleted: boolean;
  interviewCompletedAt: string | null;
  createdAt: string | null;
};

// 인터뷰 후보 항목 (listTopFounderFeedback 함수 응답).
type TopFeedbackItem = {
  id: string;
  userId: string;
  email: string;
  locale: string | null;
  rubricScore: RubricScore | null;
  total: number;
  usageEvidence: number;
  actionability: number;
  icpFit: number;
  interviewRequested: boolean;
  interviewCompleted: boolean;
  createdAt: string | null;
  reviewedAt: string | null;
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

// V2 루브릭 5차원 정의 (BETA-INCENTIVE-MODEL-V2 §5). 가중치는 총점 계산과 표시용.
type RubricDimKey = keyof Omit<RubricScore, "total">;
const RUBRIC_DIMS: Array<{
  key: RubricDimKey;
  label: string;
  weight: number;
}> = [
  { key: "specificity", label: "구체성", weight: 2 },
  { key: "usageEvidence", label: "실사용 근거", weight: 2 },
  { key: "insightQuality", label: "통찰 질", weight: 1 },
  { key: "actionability", label: "액셔너빌리티", weight: 1 },
  { key: "icpFit", label: "ICP 적합", weight: 1 },
];

// 0~3 점수 기준 요약 (§5.2). 채점 UI 툴팁/가이드용.
const RUBRIC_SCALE = [
  "0 = 빈 답변·일반론 / 실사용 없음",
  "1 = 일부 상황만·짧은 실행",
  "2 = 작업·상황·결과 명확 / 실제 작업 근거",
  "3 = 재현 가능 맥락 / 구매·확장 판단에 도움",
];

// §6.3 화상 인터뷰 10문항 스크립트 (상위 약 10명 대상).
const INTERVIEW_GUIDE: Array<{ q: string; purpose: string }> = [
  {
    q: "간단히 하시는 일, 팀 규모, 개발/운영 환경, Marblo 전의 작업 방식을 알려주세요.",
    purpose: "워밍업 및 ICP 파악",
  },
  {
    q: "Marblo를 처음 알게 된 경로, 첫 세션에서 기대한 것, 실제와 달랐던 점은 무엇인가요?",
    purpose: "첫인지·첫경험·기대 차이",
  },
  {
    q: "최근 Marblo로 처리한 실제 작업 하나를 처음부터 끝까지 이야기해 주세요.",
    purpose: "실제 사용 플로우 재구성",
  },
  {
    q: "그 작업에서 가장 막힌 순간은 언제였고 어떻게 대응했나요?",
    purpose: "장애물과 회피 전략 파악",
  },
  {
    q: "Marblo가 없었다면 같은 일을 어떻게 했고 시간/노력은 얼마나 들었을까요?",
    purpose: "대안 비용과 가치 추정",
  },
  {
    q: "Marblo를 안 쓰게 되는 순간이 있다면 어떤 이유일까요?",
    purpose: "이탈 요인 파악",
  },
  {
    q: "적정 가격은 얼마라고 느끼나요? 개인 결제와 회사카드 승인 조건은 각각 무엇인가요?",
    purpose: "WTP와 구매 장벽 확인",
  },
  {
    q: "동료에게 설명한다면 뭐라고 말할까요? 누구에게 추천하고 누구에게는 추천하지 않을까요?",
    purpose: "포지셔닝과 추천 대상 확인",
  },
  {
    q: "하나만 고칠 수 있다면 무엇을 고치겠나요?",
    purpose: "최우선 개선점 도출",
  },
  {
    q: "제가 묻지 않았지만 꼭 말하고 싶은 것이 있나요?",
    purpose: "누락된 통찰 수집",
  },
];

// 인터뷰 진행 팁 (§6.2).
const INTERVIEW_TIPS = [
  "30분을 기본으로 잡는다.",
  "사용자의 최근 실제 작업을 시간순으로 복기하게 한다.",
  "‘좋았다/별로였다’보다 ‘그때 무엇을 하려 했고, 무엇이 달라졌는가’를 묻는다.",
  "가격 질문은 실제 가치와 대안 비용을 들은 뒤 묻는다.",
  "반박하지 말고 맥락·원인·대안을 캐묻는다.",
  "녹화/기록 동의 여부를 먼저 확인한다.",
];

// Firebase callable errors carry a `code` like "functions/permission-denied".
type CallableError = { code?: string; message?: string };

function mapError(
  err: CallableError,
  kind: "select" | "reject" | "interview" | "list" | "resend" | "review"
): string {
  const code = err?.code || "";
  if (code === "functions/permission-denied") {
    return "어드민 권한이 없습니다 (ADMIN_UID 미설정 또는 계정 불일치).";
  }
  if (code === "functions/not-found") {
    return "제출된 설문을 찾을 수 없습니다.";
  }
  if (kind === "interview") {
    if (code === "functions/failed-precondition") {
      return "인터뷰 요청 대상자만 완료 처리할 수 있거나, 설문 제출 전이라 계정이 연결되지 않았습니다.";
    }
    if (code === "functions/already-exists") {
      return "이미 인터뷰 보상이 적용되었습니다.";
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

// 5차원 → 21점 총점 (specificity·usageEvidence 가중치 2).
function computeTotal(dims: Record<RubricDimKey, number>): number {
  return (
    dims.specificity * 2 +
    dims.usageEvidence * 2 +
    dims.insightQuality +
    dims.actionability +
    dims.icpFit
  );
}

export default function AdminPage() {
  const locale = useLocale();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 어드민 권한 판정: null=판정 전(로딩), true=어드민, false=권한 없음.
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // Waitlist state
  const [activeTab, setActiveTab] = useState<AdminTab>(DEFAULT_ADMIN_TAB);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Per-row "선정" state, keyed by entry id
  const [selecting, setSelecting] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // Per-row "선정 안 함"(반려) 진행 상태, keyed by entry id
  const [rejecting, setRejecting] = useState<Record<string, boolean>>({});

  // 반려 목록 보기 토글 — 반려는 실수할 수 있으니 되돌릴 진입점이 필요하다.
  // 켜면 getFounderWaitlist(includeRejected) 로 반려 항목까지 받아 '재선정' 노출.
  const [showRejected, setShowRejected] = useState(false);
  const [rejectedCount, setRejectedCount] = useState(0);

  // 파운더 현황 state
  const [founders, setFounders] = useState<FounderEntry[]>([]);
  const [foundersLoading, setFoundersLoading] = useState(true);
  const [foundersError, setFoundersError] = useState<string | null>(null);

  // 접근 이메일 재발송 state (이메일 키)
  const [resending, setResending] = useState<Record<string, boolean>>({});
  const [resendMsg, setResendMsg] = useState<Record<string, string>>({});

  // 인터뷰 후보 state
  const [topItems, setTopItems] = useState<TopFeedbackItem[]>([]);
  const [topLoading, setTopLoading] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(14);
  // 후보 행별 인터뷰 요청/완료 진행 상태 (feedbackId 키)
  const [ivBusy, setIvBusy] = useState<Record<string, boolean>>({});
  const [ivMsg, setIvMsg] = useState<Record<string, string>>({});

  // 설문 열람/채점 모달 state
  const [fbOpen, setFbOpen] = useState(false);
  const [fbEmail, setFbEmail] = useState("");
  const [fbLoading, setFbLoading] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);
  const [fbData, setFbData] = useState<FounderFeedback | null>(null);
  const [fbEmpty, setFbEmpty] = useState(false);
  // 채점 입력 state
  const [dims, setDims] = useState<Record<RubricDimKey, number>>({
    specificity: 0,
    usageEvidence: 0,
    insightQuality: 0,
    actionability: 0,
    icpFit: 0,
  });
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);

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
        .map((f) => normalizeEmail(f.email))
    );
  }, [founders]);

  const draftTotal = useMemo(() => computeTotal(dims), [dims]);

  // Auth gate
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthLoading(false);
      if (!u) {
        router.push(
          localeHref(locale, `/auth/login?redirect=${encodeURIComponent(
            localeHref(locale, "/admin")
          )}`)
        );
      } else {
        setUser(u);
      }
    });
    return () => unsub();
  }, [locale, router]);

  // 파운더 현황 로드 (Cloud Function 경유). getFounderWaitlist 대신 이 호출로
  // permission-denied 를 판정해 어드민 여부를 결정한다.
  const loadFounders = useCallback(async () => {
    setFoundersLoading(true);
    setFoundersError(null);
    try {
      const fn = httpsCallable<unknown, { items: FounderEntry[] }>(
        getFunctions(app, "us-central1"),
        "listFounders"
      );
      const res = await fn({});
      setFounders(res.data.items || []);
      setAuthorized(true);
    } catch (err: unknown) {
      const ce = err as CallableError;
      setAuthorized(ce?.code === "functions/permission-denied" ? false : true);
      setFoundersError(mapError(ce, "list"));
    } finally {
      setFoundersLoading(false);
    }
  }, []);

  // 신청 목록 로드 (Cloud Function 경유).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      setListLoading(true);
      setListError(null);
      try {
        const fn = httpsCallable<
          { includeRejected: boolean },
          { items: WaitlistEntry[]; rejectedCount?: number }
        >(getFunctions(app, "us-central1"), "getFounderWaitlist");
        const res = await fn({ includeRejected: showRejected });
        if (cancelled) return;
        setEntries(res.data.items || []);
        setRejectedCount(res.data.rejectedCount ?? 0);
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
  }, [user, showRejected]);

  useEffect(() => {
    if (!user) return;
    loadFounders();
  }, [user, loadFounders]);

  // 인터뷰 후보 로드 (listTopFounderFeedback). 채점된 설문만 대상, 총점 내림차순.
  const loadTop = useCallback(async () => {
    setTopLoading(true);
    setTopError(null);
    try {
      const fn = httpsCallable<
        { limit: number; minScore: number },
        { items: TopFeedbackItem[] }
      >(getFunctions(app, "us-central1"), "listTopFounderFeedback");
      const res = await fn({ limit: 50, minScore });
      setTopItems(res.data.items || []);
    } catch (err: unknown) {
      setTopError(mapError(err as CallableError, "list"));
    } finally {
      setTopLoading(false);
    }
  }, [minScore]);

  useEffect(() => {
    if (!user || activeTab !== "candidates") return;
    loadTop();
  }, [user, activeTab, loadTop]);

  // 버그 신고 목록 로드 (Cloud Function 경유 — 최신순 전량, UI 에서 status 필터).
  const loadBugReports = useCallback(async () => {
    setBugLoading(true);
    setBugError(null);
    try {
      const fn = httpsCallable<unknown, { items: BugReportItem[] }>(
        getFunctions(app, "us-central1"),
        "listBugReports"
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
          "updateBugReportStatus"
        );
        await fn({ id, status });
        setBugReports((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status } : r))
        );
        setBugDetail((d) => (d && d.id === id ? { ...d, status } : d));
      } catch (err: unknown) {
        setBugError(mapError(err as CallableError, "list"));
      } finally {
        setBugUpdating((s) => ({ ...s, [id]: false }));
      }
    },
    []
  );

  // 설문 열람 — 이메일로 7문항 조회 후 모달 표시. 채점 입력을 기존 점수로 초기화.
  const openFeedback = useCallback(async (email: string) => {
    setFbOpen(true);
    setFbEmail(email);
    setFbLoading(true);
    setFbError(null);
    setFbData(null);
    setFbEmpty(false);
    setReviewMsg(null);
    setReviewErr(null);
    setDims({
      specificity: 0,
      usageEvidence: 0,
      insightQuality: 0,
      actionability: 0,
      icpFit: 0,
    });
    try {
      const fn = httpsCallable<
        { email: string },
        { feedback: FounderFeedback | null }
      >(getFunctions(app, "us-central1"), "getFounderFeedbackByEmail");
      const res = await fn({ email });
      if (res.data.feedback) {
        setFbData(res.data.feedback);
        const rs = res.data.feedback.rubricScore;
        if (rs) {
          setDims({
            specificity: rs.specificity ?? 0,
            usageEvidence: rs.usageEvidence ?? 0,
            insightQuality: rs.insightQuality ?? 0,
            actionability: rs.actionability ?? 0,
            icpFit: rs.icpFit ?? 0,
          });
        }
      } else {
        setFbEmpty(true);
      }
    } catch (err: unknown) {
      setFbError(mapError(err as CallableError, "list"));
    } finally {
      setFbLoading(false);
    }
  }, []);

  // 루브릭 채점 저장 → reviewFounderFeedback. 10점 이상이면 Pro 총 5개월 자동 확정.
  const handleReview = useCallback(
    async (overrideGrantPro: boolean) => {
      if (!fbData) return;
      setReviewBusy(true);
      setReviewMsg(null);
      setReviewErr(null);
      try {
        const fn = httpsCallable<
          unknown,
          { ok: boolean; grantPro: boolean; proMonths: number }
        >(getFunctions(app, "us-central1"), "reviewFounderFeedback");
        const res = await fn({
          feedbackId: fbData.id,
          rubricScore: { ...dims, total: draftTotal },
          overrideGrantPro,
        });
        setReviewMsg(
          res.data.grantPro
            ? `채점 저장 완료 — Pro ${res.data.proMonths}개월 확정 (총점 ${draftTotal}/21).`
            : `채점 저장 완료 (총점 ${draftTotal}/21). 최소 기준(10점) 미달로 Pro 미지급.`
        );
        setFbData((d) =>
          d ? { ...d, rubricScore: { ...dims, total: draftTotal } } : d
        );
        loadFounders();
      } catch (err: unknown) {
        setReviewErr(mapError(err as CallableError, "review"));
      } finally {
        setReviewBusy(false);
      }
    },
    [fbData, dims, draftTotal, loadFounders]
  );

  // 인터뷰 요청 마킹 → requestFounderInterview. 모달 또는 후보 탭에서 호출.
  const requestInterview = useCallback(
    async (feedbackId: string, fromModal: boolean) => {
      setIvBusy((s) => ({ ...s, [feedbackId]: true }));
      setIvMsg((m) => ({ ...m, [feedbackId]: "" }));
      try {
        const fn = httpsCallable(
          getFunctions(app, "us-central1"),
          "requestFounderInterview"
        );
        await fn({ feedbackId });
        setIvMsg((m) => ({ ...m, [feedbackId]: "인터뷰 요청됨" }));
        setTopItems((prev) =>
          prev.map((t) =>
            t.id === feedbackId ? { ...t, interviewRequested: true } : t
          )
        );
        if (fromModal) {
          setFbData((d) => (d ? { ...d, interviewRequested: true } : d));
          setReviewMsg("인터뷰 요청됨.");
        }
        loadFounders();
      } catch (err: unknown) {
        const msg = mapError(err as CallableError, "interview");
        setIvMsg((m) => ({ ...m, [feedbackId]: msg }));
        if (fromModal) setReviewErr(msg);
      } finally {
        setIvBusy((s) => ({ ...s, [feedbackId]: false }));
      }
    },
    [loadFounders]
  );

  // 인터뷰 완료 마킹 → markFounderInterviewed. Pro 총 9개월로 연장.
  const completeInterview = useCallback(
    async (feedbackId: string, fromModal: boolean) => {
      setIvBusy((s) => ({ ...s, [feedbackId]: true }));
      setIvMsg((m) => ({ ...m, [feedbackId]: "" }));
      try {
        const fn = httpsCallable<unknown, { ok: boolean; proMonths: number }>(
          getFunctions(app, "us-central1"),
          "markFounderInterviewed"
        );
        const res = await fn({ feedbackId });
        setIvMsg((m) => ({
          ...m,
          [feedbackId]: `인터뷰 완료 — Pro ${res.data.proMonths}개월 연장`,
        }));
        setTopItems((prev) =>
          prev.map((t) =>
            t.id === feedbackId ? { ...t, interviewCompleted: true } : t
          )
        );
        if (fromModal) {
          setFbData((d) => (d ? { ...d, interviewCompleted: true } : d));
          setReviewMsg(`인터뷰 완료 — Pro ${res.data.proMonths}개월로 연장.`);
        }
        loadFounders();
      } catch (err: unknown) {
        const msg = mapError(err as CallableError, "interview");
        setIvMsg((m) => ({ ...m, [feedbackId]: msg }));
        if (fromModal) setReviewErr(msg);
      } finally {
        setIvBusy((s) => ({ ...s, [feedbackId]: false }));
      }
    },
    [loadFounders]
  );

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
      // 반려됐던 항목을 '재선정' 한 경우: 백엔드가 신청 doc 의 rejected 마킹을
      // 풀어주므로 로컬 상태도 되돌려 배지/버튼이 즉시 정상으로 보이게 한다.
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, status: null } : e))
      );
      setRejectedCount((c) =>
        entry.status === "rejected" ? Math.max(0, c - 1) : c
      );
      setFounders((prev) => {
        const email = normalizeEmail(entry.email);
        let found = false;
        const next = prev.map((f) => {
          if (normalizeEmail(f.email) !== email) return f;
          found = true;
          return {
            ...f,
            email,
            status: f.status || "selected",
            accessGrantedAt: f.accessGrantedAt || new Date().toISOString(),
          };
        });
        if (found) return next;
        return [
          {
            email,
            status: "selected",
            accessGrantedAt: new Date().toISOString(),
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

  // 선정 안 함(반려) — markFounderRejected. 신청을 rejected 로 내려 목록에서 빼고,
  // 이미 선정된 이메일이면 베타 grant 까지 회수한다. 되돌리려면 다시 '선정'.
  // 성공 시 해당 행을 목록에서 제거(낙관적 갱신) + 파운더 현황 배지도 rejected 로.
  const handleReject = useCallback(
    async (entry: WaitlistEntry) => {
      const email = normalizeEmail(entry.email);
      const isSelectedFounder = selectedFounderEmails.has(email);
      const warning = isSelectedFounder
        ? `\n\n⚠️ 이미 선정된 파운더입니다. 반려하면 베타 접근과 Pro 부여가 즉시 회수됩니다.`
        : "";
      if (
        !window.confirm(
          `${entry.email} 님을 선정 안 함(반려) 처리할까요?${warning}\n\n반려하면 대기자 목록에서 빠지고 재선정 대상에서 제외됩니다.`
        )
      ) {
        return;
      }
      setRejecting((s) => ({ ...s, [entry.id]: true }));
      setRowError((e) => {
        const next = { ...e };
        delete next[entry.id];
        return next;
      });
      try {
        const functions = getFunctions(app, "us-central1");
        const fn = httpsCallable(functions, "markFounderRejected");
        await fn({ email: entry.email });
        // 반려 목록 보기 중이면 행을 없애지 않고 '반려됨' 으로 표시해 되돌릴 수
        // 있게 남긴다. 기본 목록에서는 제거(반려 = 목록서 빠짐).
        setEntries((prev) =>
          showRejected
            ? prev.map((e) =>
                e.id === entry.id ? { ...e, status: "rejected" } : e
              )
            : prev.filter((e) => e.id !== entry.id)
        );
        setSelected((s) => ({ ...s, [entry.id]: false }));
        setRejectedCount((c) => c + 1);
        setFounders((prev) =>
          prev.map((f) =>
            normalizeEmail(f.email) === email ? { ...f, status: "rejected" } : f
          )
        );
      } catch (err: unknown) {
        const message = mapError(err as CallableError, "reject");
        setRowError((e) => ({ ...e, [entry.id]: message }));
      } finally {
        setRejecting((s) => ({ ...s, [entry.id]: false }));
      }
    },
    [selectedFounderEmails, showRejected]
  );

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

  if (authorized === null) {
    return (
      <div className="py-24 px-4 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

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
            onClick={() => router.push(localeHref(locale))}
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
      <div
        className={`${
          activeTab === "analytics" || activeTab === "projects"
            ? "max-w-6xl"
            : "max-w-4xl"
        } mx-auto space-y-8`}
      >
        {/* Header */}
        <header>
          <div className="flex items-center gap-3 mb-2">
            <Award className="w-7 h-7 text-indigo-400" />
            <h1 className="text-2xl font-bold">파운더 어드민</h1>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">
            대기자를 선정하고 3개월 베타를 부여합니다. 제출된 성실 설문(7문항)을
            21점 루브릭으로 채점해 Pro 총 5개월을 확정하고, 상위 응답자에게 화상
            인터뷰를 요청·완료 처리하면 Pro 총 9개월로 연장됩니다.
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
            const count: number | null =
              tab.id === "waitlist"
                ? entries.length
                : tab.id === "founders"
                ? founders.length
                : tab.id === "candidates"
                ? topItems.length
                : tab.id === "bugs"
                ? bugReports.length
                : null;
            const hasError =
              (tab.id === "waitlist" && !!listError) ||
              (tab.id === "founders" && !!foundersError) ||
              (tab.id === "candidates" && !!topError) ||
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
                ) : count !== null ? (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      active
                        ? "bg-white/15 text-white"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
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
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-400">
                    총 {entries.length}명
                  </span>
                  {/* 반려 되돌림 진입점 — 반려는 실수할 수 있으므로 목록을
                      열어 '재선정' 할 수 있어야 한다. */}
                  <label className="inline-flex items-center gap-1.5 text-sm text-zinc-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showRejected}
                      onChange={(e) => setShowRejected(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    반려 포함
                    {!showRejected && rejectedCount > 0 && (
                      <span className="text-zinc-400">({rejectedCount})</span>
                    )}
                  </label>
                </div>
              )}
            </div>

            {listLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
              </div>
            ) : listError ? (
              <div className="flex items-start gap-3 text-red-400 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <p className="text-sm">{listError}</p>
              </div>
            ) : entries.length === 0 ? (
              <p className="text-sm text-zinc-400 py-8 text-center">
                대기자가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-400 border-b border-zinc-800">
                      <th className="py-2 pr-4 font-medium">이메일</th>
                      <th className="py-2 pr-4 font-medium">소스</th>
                      <th className="py-2 pr-4 font-medium">신청일</th>
                      <th className="py-2 font-medium text-right">액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const isSelecting = !!selecting[entry.id];
                      const isRejecting = !!rejecting[entry.id];
                      const isSelected =
                        !!selected[entry.id] ||
                        selectedFounderEmails.has(normalizeEmail(entry.email));
                      const err = rowError[entry.id];
                      const dupes = entry.duplicateCount ?? 1;
                      const isRejected = entry.status === "rejected";
                      return (
                        <tr
                          key={entry.id}
                          className="border-b border-zinc-800/60 last:border-0 align-top"
                        >
                          <td className="py-3 pr-4 break-all">
                            {entry.email}
                            {dupes > 1 && (
                              <span
                                title={`동일 이메일로 ${dupes}건 신청 — 최신 1건만 표시`}
                                className="ml-2 inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 align-middle"
                              >
                                중복 {dupes}건
                              </span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-zinc-400">
                            {entry.source || "—"}
                          </td>
                          <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                            {formatDate(entry.createdAt)}
                          </td>
                          <td className="py-3 text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              {isRejected && (
                                <span className="inline-flex items-center gap-1.5 text-red-400/80 text-xs font-medium">
                                  <Ban className="w-3.5 h-3.5" />
                                  반려됨
                                </span>
                              )}
                              {isSelected && !isRejected ? (
                                <span className="inline-flex items-center gap-1.5 text-green-400 text-sm font-medium">
                                  <Check className="w-4 h-4" />
                                  선정됨
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleSelect(entry)}
                                  disabled={isSelecting || isRejecting}
                                  title={
                                    isRejected
                                      ? "반려를 되돌리고 베타 접근·Pro 를 다시 부여합니다"
                                      : undefined
                                  }
                                  className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-sm font-medium transition"
                                >
                                  {isSelecting && (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  )}
                                  {isRejected ? "재선정" : "선정"}
                                </button>
                              )}
                              {/* 선정됨 상태에서도 노출 — 반려 시 grant 회수 경로.
                                  이미 반려된 행에는 숨긴다(되돌리기만 남김). */}
                              {!isRejected && (
                                <button
                                  onClick={() => handleReject(entry)}
                                  disabled={isSelecting || isRejecting}
                                  title={
                                    isSelected
                                      ? "반려하면 베타 접근·Pro 부여가 즉시 회수됩니다"
                                      : "반려하면 대기자 목록에서 빠집니다"
                                  }
                                  className="inline-flex items-center gap-1.5 border border-zinc-700 hover:border-red-500/60 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-400 px-3 py-1.5 rounded-lg text-sm font-medium transition"
                                >
                                  {isRejecting && (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  )}
                                  선정 안 함
                                </button>
                              )}
                            </div>
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

        {/* 파운더 현황 card */}
        {activeTab === "founders" && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-semibold">파운더 현황</h2>
              </div>
              <div className="flex items-center gap-3">
                {!foundersLoading && !foundersError && (
                  <span className="text-sm text-zinc-400">
                    총 {founders.length}명
                  </span>
                )}
                <button
                  onClick={loadFounders}
                  disabled={foundersLoading}
                  className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 text-sm transition"
                  aria-label="새로고침"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${
                      foundersLoading ? "animate-spin" : ""
                    }`}
                  />
                </button>
              </div>
            </div>

            {foundersLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
              </div>
            ) : foundersError ? (
              <div className="flex items-start gap-3 text-red-400 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <p className="text-sm">{foundersError}</p>
              </div>
            ) : founders.length === 0 ? (
              <p className="text-sm text-zinc-400 py-8 text-center">
                선정된 파운더가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-400 border-b border-zinc-800">
                      <th className="py-2 pr-4 font-medium">이메일</th>
                      <th className="py-2 pr-4 font-medium">상태</th>
                      <th className="py-2 pr-4 font-medium">베타종료</th>
                      <th className="py-2 pr-4 font-medium">설문제출</th>
                      <th className="py-2 pr-4 font-medium">루브릭</th>
                      <th className="py-2 pr-4 font-medium">인터뷰</th>
                      <th className="py-2 pr-4 font-medium">Pro</th>
                      <th className="py-2 pr-4 font-medium">접근이메일</th>
                      <th className="py-2 font-medium text-right">설문</th>
                    </tr>
                  </thead>
                  <tbody>
                    {founders.map((f) => {
                      const iv = f.interviewCompleted
                        ? "완료"
                        : f.interviewRequested
                        ? "요청됨"
                        : "—";
                      return (
                        <tr
                          key={f.email}
                          className="border-b border-zinc-800/60 last:border-0 align-top"
                        >
                          <td className="py-3 pr-4 break-all">{f.email}</td>
                          <td className="py-3 pr-4 text-zinc-300">
                            {f.status || "—"}
                          </td>
                          <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                            {formatDate(f.betaExpiresAt)}
                          </td>
                          <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                            {formatDate(f.feedbackSubmittedAt)}
                          </td>
                          <td className="py-3 pr-4 text-zinc-300 whitespace-nowrap">
                            {f.rubricScore
                              ? `${f.rubricScore.total}/21`
                              : "미채점"}
                          </td>
                          <td className="py-3 pr-4 text-zinc-300 whitespace-nowrap">
                            {iv}
                          </td>
                          <td className="py-3 pr-4 text-zinc-300 whitespace-nowrap">
                            {f.proGrantedMonths
                              ? `${f.proGrantedMonths}개월`
                              : "—"}
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
                                채점
                              </button>
                            ) : (
                              <span className="text-xs text-zinc-400">
                                미제출
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 임의 이메일 설문 조회 */}
            <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={fbEmail}
                onChange={(e) => setFbEmail(e.target.value)}
                placeholder="설문을 볼 이메일 (founder@example.com)"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => openFeedback(fbEmail.trim())}
                disabled={!fbEmail.trim()}
                className="inline-flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-100 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap"
              >
                <MessageSquare className="w-4 h-4" />
                설문 열람/채점
              </button>
            </div>
          </section>
        )}

        {/* 인터뷰 후보 card */}
        {activeTab === "candidates" && (
          <section className="space-y-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <Video className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-lg font-semibold">인터뷰 후보</h2>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <label className="text-zinc-400">최소 점수</label>
                  <input
                    type="number"
                    min={0}
                    max={21}
                    value={minScore}
                    onChange={(e) =>
                      setMinScore(
                        Math.max(0, Math.min(21, Number(e.target.value) || 0))
                      )
                    }
                    className="w-16 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-100 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={loadTop}
                    disabled={topLoading}
                    className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition"
                    aria-label="새로고침"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${topLoading ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </div>
              <p className="text-xs text-zinc-400 mb-4">
                채점된 설문을 총점 내림차순으로 정렬합니다(동점 시 ICP → 실사용
                근거 → 액셔너빌리티). 권장 컷은 14점 이상 중 상위 약 10명입니다.
                점수만으로 자동 선정하지 말고 운영자가 최종 확인하세요.
              </p>

              {topLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                </div>
              ) : topError ? (
                <div className="flex items-start gap-3 text-red-400 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
                  <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                  <p className="text-sm">{topError}</p>
                </div>
              ) : topItems.length === 0 ? (
                <p className="text-sm text-zinc-400 py-8 text-center">
                  기준 점수 이상으로 채점된 설문이 없습니다.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-400 border-b border-zinc-800">
                        <th className="py-2 pr-3 font-medium">#</th>
                        <th className="py-2 pr-4 font-medium">이메일</th>
                        <th className="py-2 pr-4 font-medium">총점</th>
                        <th className="py-2 pr-4 font-medium">ICP</th>
                        <th className="py-2 pr-4 font-medium">근거</th>
                        <th className="py-2 pr-4 font-medium">액션</th>
                        <th className="py-2 font-medium text-right">인터뷰</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topItems.map((t, i) => (
                        <tr
                          key={t.id}
                          className="border-b border-zinc-800/60 last:border-0 align-top"
                        >
                          <td className="py-3 pr-3 text-zinc-400">{i + 1}</td>
                          <td className="py-3 pr-4 break-all">
                            {t.email}
                            <button
                              onClick={() => openFeedback(t.email)}
                              className="ml-2 text-xs text-indigo-400 hover:text-indigo-300"
                            >
                              보기
                            </button>
                          </td>
                          <td className="py-3 pr-4 font-semibold text-indigo-300 whitespace-nowrap">
                            {t.total}/21
                          </td>
                          <td className="py-3 pr-4 text-zinc-400">
                            {t.icpFit}
                          </td>
                          <td className="py-3 pr-4 text-zinc-400">
                            {t.usageEvidence}
                          </td>
                          <td className="py-3 pr-4 text-zinc-400">
                            {t.actionability}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex flex-col items-end gap-1">
                              {t.interviewCompleted ? (
                                <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium">
                                  <Check className="w-3.5 h-3.5" />
                                  완료 (총 9개월)
                                </span>
                              ) : t.interviewRequested ? (
                                <button
                                  onClick={() => completeInterview(t.id, false)}
                                  disabled={!!ivBusy[t.id]}
                                  className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg text-xs font-medium transition"
                                >
                                  {ivBusy[t.id] && (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  )}
                                  완료 처리 (총 9개월)
                                </button>
                              ) : (
                                <button
                                  onClick={() => requestInterview(t.id, false)}
                                  disabled={!!ivBusy[t.id]}
                                  className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg text-xs font-medium transition"
                                >
                                  {ivBusy[t.id] && (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  )}
                                  인터뷰 요청
                                </button>
                              )}
                              {ivMsg[t.id] && (
                                <span className="text-xs text-zinc-400 max-w-[12rem]">
                                  {ivMsg[t.id]}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* §6 화상 인터뷰 가이드 */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-2">
                <ClipboardList className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-semibold">화상 인터뷰 가이드</h2>
              </div>
              <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
                상위 약 10명 인터뷰의 목적은 보상 지급이 아니라 WTP·ICP·확장
                가능성 검증입니다. 30분 기준으로 진행하세요.
              </p>

              <div className="mb-5">
                <h3 className="text-sm font-semibold text-zinc-200 mb-2">
                  진행 팁
                </h3>
                <ul className="space-y-1.5 text-sm text-zinc-400">
                  {INTERVIEW_TIPS.map((tip) => (
                    <li key={tip} className="leading-relaxed">
                      · {tip}
                    </li>
                  ))}
                </ul>
              </div>

              <h3 className="text-sm font-semibold text-zinc-200 mb-2">
                10문항 스크립트
              </h3>
              <ol className="space-y-3">
                {INTERVIEW_GUIDE.map((item, i) => (
                  <li
                    key={i}
                    className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-3"
                  >
                    <p className="text-sm text-zinc-100 leading-relaxed">
                      <span className="text-indigo-400 font-semibold mr-1.5">
                        {i + 1}.
                      </span>
                      {item.q}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      목적: {item.purpose}
                    </p>
                  </li>
                ))}
              </ol>
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
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
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
                    <p className="text-sm text-zinc-400 py-8 text-center">
                      신고가 없습니다.
                    </p>
                  );
                }
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-zinc-400 border-b border-zinc-800">
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
                              <div className="text-zinc-400">
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
                                      e.target.value as BugReportStatus
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

        {/* 사업 분석 대시보드 */}
        {activeTab === "analytics" && <AnalyticsPanel />}

        {/* 프로젝트 감사 — 읽기 전용 관찰 뷰(Phase1). 자체 로딩·에러를 갖는다. */}
        {activeTab === "projects" && <ProjectAuditPanel />}
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
                <span className="text-zinc-400">
                  {formatDate(bugDetail.createdAt)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-zinc-400 mb-0.5">신고자</p>
                  <p className="text-zinc-200 break-all">
                    {bugDetail.email || "—"}
                  </p>
                  <p className="text-zinc-400 break-all font-mono mt-0.5">
                    {bugDetail.uid}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-400 mb-0.5">환경</p>
                  <p className="text-zinc-200">
                    {bugDetail.platform || "—"} · v{bugDetail.appVersion || "—"}
                  </p>
                  <p className="text-zinc-400 mt-0.5">
                    {bugDetail.context.route || "—"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-zinc-400 mb-1">설명</p>
                <p className="text-zinc-100 whitespace-pre-wrap leading-relaxed">
                  {bugDetail.description}
                </p>
              </div>

              {bugDetail.context.agentSnapshot && (
                <div>
                  <p className="text-zinc-400 mb-1">에이전트 스냅샷</p>
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 overflow-x-auto">
                    {bugDetail.context.agentSnapshot}
                  </pre>
                </div>
              )}

              {bugDetail.context.recentLogs && (
                <div>
                  <p className="text-zinc-400 mb-1">최근 로그</p>
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 overflow-x-auto max-h-48">
                    {bugDetail.context.recentLogs}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
                <span className="text-xs text-zinc-400">상태 변경:</span>
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

      {/* 설문 열람/채점 모달 */}
      {fbOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setFbOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-semibold break-all">
                  성실 설문 — {fbEmail}
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
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
              </div>
            ) : fbError ? (
              <div className="flex items-start gap-3 text-red-400 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <p className="text-sm">{fbError}</p>
              </div>
            ) : fbEmpty ? (
              <p className="text-sm text-zinc-400 py-8 text-center">
                아직 제출된 설문이 없습니다.
              </p>
            ) : fbData ? (
              <div className="space-y-5 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-300">
                  <span className="text-zinc-400">
                    제출: {formatDate(fbData.createdAt)}
                  </span>
                  {fbData.locale && (
                    <span className="text-zinc-400">
                      locale: {fbData.locale}
                    </span>
                  )}
                  {fbData.rubricScore && (
                    <span>
                      현재 점수:{" "}
                      <span className="font-semibold text-indigo-300">
                        {fbData.rubricScore.total}/21
                      </span>
                    </span>
                  )}
                  {fbData.proGrantedMonths > 0 && (
                    <span className="text-green-400 text-xs">
                      Pro {fbData.proGrantedMonths}개월
                    </span>
                  )}
                </div>

                {/* 7문항 답변 */}
                {(
                  [
                    ["① 사용 맥락", fbData.answers.q1],
                    ["② 계속 쓰겠다·아하 순간", fbData.answers.q2],
                    ["③ 막힌 점·버그·혼란", fbData.answers.q3],
                    ["④ 대안 대비 시간·노력", fbData.answers.q4],
                    ["⑤ 지불의사 (누가·얼마·왜)", fbData.answers.q5],
                    ["⑥ 남길 기능·추가 기능", fbData.answers.q6],
                    ["⑦ 추천 점수(0~10)+이유", fbData.answers.q7],
                  ] as const
                ).map(([label, val]) => (
                  <div key={label}>
                    <p className="text-zinc-400 mb-1">{label}</p>
                    <p className="text-zinc-100 whitespace-pre-wrap leading-relaxed">
                      {val || "—"}
                    </p>
                  </div>
                ))}

                {/* 루브릭 채점 */}
                <div className="pt-4 border-t border-zinc-800">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-zinc-200">
                      루브릭 채점 (0~3)
                    </h4>
                    <span className="text-sm">
                      총점{" "}
                      <span className="font-bold text-indigo-300">
                        {draftTotal}/21
                      </span>
                      <span
                        className={`ml-2 text-xs ${
                          draftTotal >= 10 ? "text-green-400" : "text-zinc-400"
                        }`}
                      >
                        {draftTotal >= 10 ? "Pro 총 5개월 기준 통과" : "10점 미만"}
                      </span>
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
                    {RUBRIC_SCALE.join("  ·  ")}
                  </p>
                  <div className="space-y-2">
                    {RUBRIC_DIMS.map((dim) => (
                      <div
                        key={dim.key}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="text-zinc-300">
                          {dim.label}
                          <span className="text-zinc-400 text-xs ml-1">
                            ×{dim.weight}
                          </span>
                        </span>
                        <div className="flex gap-1">
                          {[0, 1, 2, 3].map((n) => (
                            <button
                              key={n}
                              onClick={() =>
                                setDims((d) => ({ ...d, [dim.key]: n }))
                              }
                              className={`w-8 h-8 rounded-lg text-sm font-medium transition ${
                                dims[dim.key] === n
                                  ? "bg-indigo-600 text-white"
                                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {reviewMsg && (
                    <div className="mt-3 flex items-start gap-2 text-green-400 text-sm p-3 bg-green-950/30 border border-green-900/40 rounded-lg">
                      <Check className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{reviewMsg}</span>
                    </div>
                  )}
                  {reviewErr && (
                    <div className="mt-3 flex items-start gap-2 text-red-400 text-sm p-3 bg-red-950/30 border border-red-900/50 rounded-lg">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{reviewErr}</span>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleReview(false)}
                      disabled={reviewBusy}
                      className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                    >
                      {reviewBusy && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                      <UserCheck className="w-4 h-4" />
                      채점 저장 (10점↑ Pro 총 5개월)
                    </button>
                    <button
                      onClick={() => handleReview(true)}
                      disabled={reviewBusy}
                      className="inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-100 px-4 py-2 rounded-lg text-sm font-medium transition"
                    >
                      예외 승인 (Pro 총 5개월 강제)
                    </button>
                  </div>

                  {/* 인터뷰 요청/완료 */}
                  <div className="mt-4 pt-4 border-t border-zinc-800 flex flex-wrap items-center gap-2">
                    {fbData.interviewCompleted ? (
                      <span className="inline-flex items-center gap-1.5 text-green-400 text-sm font-medium">
                        <Check className="w-4 h-4" />
                        인터뷰 완료 — Pro 총 9개월
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => requestInterview(fbData.id, true)}
                          disabled={
                            !!ivBusy[fbData.id] || fbData.interviewRequested
                          }
                          className="inline-flex items-center gap-2 bg-indigo-600/20 border border-indigo-500/50 hover:bg-indigo-600/30 disabled:opacity-50 text-indigo-100 px-4 py-2 rounded-lg text-sm font-medium transition"
                        >
                          <Video className="w-4 h-4" />
                          {fbData.interviewRequested
                            ? "인터뷰 요청됨"
                            : "인터뷰 요청"}
                        </button>
                        {fbData.interviewRequested && (
                          <button
                            onClick={() => completeInterview(fbData.id, true)}
                            disabled={!!ivBusy[fbData.id]}
                            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                          >
                            {ivBusy[fbData.id] && (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            )}
                            인터뷰 완료 처리 (Pro 총 9개월)
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
