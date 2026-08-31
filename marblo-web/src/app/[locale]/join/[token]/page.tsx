"use client";

/**
 * `/join/<token>` — 초대 링크 착지(#1338 §3.2 (e)~(g)).
 *
 * 배선만 한다: 콜러블 호출·auth 상태·상태기계. 그리는 건 전부 `JoinViews.tsx`.
 * 콜러블 계약(가정 포함)은 `@/lib/orgOnboarding` 한 곳에 있다 — 서버 절반
 * (온보딩 ① backend)이 확정한 계약과 다르면 그 파일만 맞춘다.
 *
 * ★로그인 전에 이 화면이 말하는 것은 resolveInvite 가 주는 최소 정보뿐이다.
 * 토큰 없이 조직 존재를 떠볼 수 있는 요청은 여기서 만들 수 없다(#1338 §5).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useMessages } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { httpsCallable, getFunctions } from "firebase/functions";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import app, { auth } from "@/lib/firebase";
import { localeHref } from "@/i18n/routing";
import {
  ACCEPT_INVITE_CALLABLE,
  RESOLVE_INVITE_CALLABLE,
  classifyInviteCallableError,
  isPlausibleEmail,
  isPlausibleInviteToken,
  joinPath,
  parseAcceptInviteData,
  parseResolveInviteData,
  type AcceptedInvite,
  type InviteFailure,
  type ResolveInviteOutcome,
} from "@/lib/orgOnboarding";
import { buildOrgOnboardingCopy } from "@/lib/orgOnboardingCopy";
import { saveTeamDownloadContext } from "@/lib/teamDownloadContext";
import {
  InviteAccepted,
  InviteConfirm,
  InviteFailureCard,
  InviteLanding,
  JoinResolving,
} from "./JoinViews";

export default function JoinPage() {
  const locale = useLocale();
  const router = useRouter();
  const messages = useMessages();
  const copy = useMemo(
    () =>
      buildOrgOnboardingCopy(
        (messages as Record<string, unknown>).orgOnboarding
      ),
    [messages]
  );

  const params = useParams<{ token: string }>();
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = useMemo(() => {
    if (typeof rawToken !== "string") return null;
    try {
      const decoded = decodeURIComponent(rawToken);
      return isPlausibleInviteToken(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }, [rawToken]);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const [outcome, setOutcome] = useState<ResolveInviteOutcome | null>(null);
  // 재시도 버튼이 올린다 — 해석을 처음부터 다시 돈다.
  const [resolveAttempt, setResolveAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedInvite | null>(null);
  // 수락 실패 중 화면 이탈이 필요 없는 것(unavailable)의 인라인 안내.
  const [acceptNote, setAcceptNote] = useState<string | null>(null);

  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!authReady) return;
    if (!token) {
      // 겉모양부터 초대 토큰일 수 없는 경로 — 서버를 부르지 않고 접는다.
      setOutcome({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    setOutcome(null);
    const run = async () => {
      try {
        const functions = getFunctions(app, "us-central1");
        const resolve = httpsCallable<{ token: string }, unknown>(
          functions,
          RESOLVE_INVITE_CALLABLE
        );
        const { data } = await resolve({ token });
        if (!cancelled) setOutcome(parseResolveInviteData(data));
      } catch (err) {
        if (!cancelled) setOutcome({ kind: classifyInviteCallableError(err) });
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // uid: 로그인/계정 전환 후 같은 토큰을 그 계정의 눈으로 다시 해석한다.
  }, [authReady, token, uid, resolveAttempt]);

  const invite = outcome && "invite" in outcome ? outcome.invite ?? null : null;

  const handleAccept = useCallback(async () => {
    if (!token || accepting) return;
    setAccepting(true);
    setAcceptNote(null);
    try {
      const functions = getFunctions(app, "us-central1");
      const accept = httpsCallable<{ token: string }, unknown>(
        functions,
        ACCEPT_INVITE_CALLABLE
      );
      const { data } = await accept({ token });
      const result = parseAcceptInviteData(data);
      if (result.kind === "accepted") {
        setAccepted(result.result);
      } else if (result.kind === "already_accepted") {
        setAccepted({ alreadyMember: true, orgId: null, orgDisplayName: null });
      } else if (result.kind === "unavailable") {
        setAcceptNote(copy["join.unavailable.body"]);
      } else {
        setOutcome({ kind: result.kind, invite: invite ?? undefined });
      }
    } catch (err) {
      const failure: InviteFailure = classifyInviteCallableError(err);
      if (failure === "already_accepted") {
        setAccepted({ alreadyMember: true, orgId: null, orgDisplayName: null });
      } else if (failure === "unavailable") {
        // ★수락은 멱등(#1205 §5.3) — 화면을 떠나지 않고 다시 누르게 둔다.
        setAcceptNote(copy["join.unavailable.body"]);
      } else {
        setOutcome({ kind: failure, invite: invite ?? undefined });
      }
    } finally {
      setAccepting(false);
    }
  }, [token, accepting, copy, invite]);

  // 로그인/가입으로 갔다가 이 화면으로 돌아오는 왕복 — redirect 는 내부 상대
  // 경로라 sanitizeRedirect 를 그대로 통과한다. 초대 이메일을 서버가 준
  // 경우에만 프리필을 싣는다(없으면 생략일 뿐, 흐름은 같다).
  const returnHref = localeHref(locale, joinPath(token ?? ""));
  const emailParam =
    invite?.invitedEmail && isPlausibleEmail(invite.invitedEmail)
      ? `&email=${encodeURIComponent(invite.invitedEmail)}`
      : "";
  const loginHref = localeHref(
    locale,
    `/auth/login?redirect=${encodeURIComponent(returnHref)}${emailParam}`
  );
  const signupHref = localeHref(
    locale,
    `/auth/signup?redirect=${encodeURIComponent(returnHref)}${emailParam}`
  );

  const handleSwitchAccount = useCallback(async () => {
    try {
      await signOut(auth);
    } catch {
      // 로그아웃 실패해도 로그인 화면으로는 보낸다 — 거기서 계정을 고른다.
    }
    router.push(loginHref);
  }, [router, loginHref]);

  const handleRetry = useCallback(() => setResolveAttempt((n) => n + 1), []);

  const downloadHref = localeHref(locale, "/download");
  const guideHrefBase = localeHref(locale, "/guide");

  if (!authReady || outcome === null) return <JoinResolving copy={copy} />;

  if (accepted) {
    const orgDisplayName =
      accepted.orgDisplayName ?? invite?.orgDisplayName ?? null;
    return (
      <InviteAccepted
        copy={copy}
        orgDisplayName={orgDisplayName}
        alreadyMember={accepted.alreadyMember}
        orgHomeHref={
          accepted.orgId ? localeHref(locale, `/org/${accepted.orgId}`) : null
        }
        downloadHref={downloadHref}
        guideHrefBase={guideHrefBase}
        onDownloadClick={
          orgDisplayName
            ? () => saveTeamDownloadContext(orgDisplayName)
            : undefined
        }
      />
    );
  }

  if (outcome.kind === "valid") {
    if (!user) {
      return (
        <InviteLanding
          copy={copy}
          invite={outcome.invite}
          loginHref={loginHref}
          signupHref={signupHref}
        />
      );
    }
    return (
      <InviteConfirm
        copy={copy}
        invite={outcome.invite}
        signedInEmail={user.email}
        accepting={accepting}
        errorNote={acceptNote}
        onAccept={handleAccept}
      />
    );
  }

  if (outcome.kind === "already_accepted") {
    return (
      <InviteAccepted
        copy={copy}
        orgDisplayName={invite?.orgDisplayName ?? null}
        alreadyMember
        orgHomeHref={null}
        downloadHref={downloadHref}
        guideHrefBase={guideHrefBase}
        onDownloadClick={
          invite?.orgDisplayName
            ? () => saveTeamDownloadContext(invite.orgDisplayName)
            : undefined
        }
      />
    );
  }

  return (
    <InviteFailureCard
      copy={copy}
      failure={outcome.kind}
      locale={locale}
      expiresAtMs={invite?.expiresAtMs ?? null}
      signedInEmail={user?.email ?? null}
      loginHref={loginHref}
      onRetry={handleRetry}
      onSwitchAccount={handleSwitchAccount}
    />
  );
}
