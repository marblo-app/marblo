"use client";

/**
 * `/org/new` — (b) 조직 정보 1화면 배선(#1338 §3.1 (b)).
 *
 * 결제 성공 화면(팀 요금제)의 배너가 여기로 보낸다. 실패해도 결제는 유효하고,
 * 같은 배너로 언제든 재진입한다 — 그래서 이 화면은 상태를 어디에도 남기지
 * 않는다(성공하면 조직 홈으로 이어질 뿐).
 *
 * ★`/org` 본 라우트·스위처·착지 규칙은 동시 티켓(조직 뼈대 ② krDTLfTP)의
 * 것이다. 이 디렉터리는 `/org/new` 하나만 소유한다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useMessages } from "next-intl";
import { httpsCallable, getFunctions } from "firebase/functions";
import { onAuthStateChanged, type User } from "firebase/auth";
import app, { auth } from "@/lib/firebase";
import { localeHref } from "@/i18n/routing";
import {
  CREATE_ORGANIZATION_CALLABLE,
  classifyOrgIntakeError,
  parseCreateOrganizationData,
  type CreatedOrganization,
  type OrgIntakeFailure,
} from "@/lib/orgOnboarding";
import { buildOrgOnboardingCopy } from "@/lib/orgOnboardingCopy";
import { Loader2 } from "lucide-react";
import {
  IntakeForm,
  IntakeLoginRequired,
  IntakeSuccess,
} from "./OrgIntakeViews";

export default function OrgNewPage() {
  const locale = useLocale();
  const messages = useMessages();
  const copy = useMemo(
    () =>
      buildOrgOnboardingCopy(
        (messages as Record<string, unknown>).orgOnboarding
      ),
    [messages]
  );

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Exclude<
    OrgIntakeFailure,
    "unauthenticated"
  > | null>(null);
  const [created, setCreated] = useState<CreatedOrganization | null>(null);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    // 빈 이름만 클라에서 거른다 — 나머지 판정은 전부 서버
    // (validateTeamOrgIntake)의 것이고, 여기 복제하지 않는다.
    if (name.trim() === "") {
      setFailure("name_required");
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      const functions = getFunctions(app, "us-central1");
      const create = httpsCallable<{ displayName: string }, unknown>(
        functions,
        CREATE_ORGANIZATION_CALLABLE
      );
      const { data } = await create({ displayName: name.trim() });
      const org = parseCreateOrganizationData(data);
      if (org) setCreated(org);
      else setFailure("unavailable");
    } catch (err) {
      const kind = classifyOrgIntakeError(err);
      setFailure(kind === "unauthenticated" ? "unavailable" : kind);
    } finally {
      setSubmitting(false);
    }
  }, [name, submitting]);

  if (!authReady) {
    return (
      <div className="py-24 px-4 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-400 mx-auto" />
      </div>
    );
  }

  if (!user) {
    const returnHref = localeHref(locale, "/org/new");
    return (
      <IntakeLoginRequired
        copy={copy}
        loginHref={localeHref(
          locale,
          `/auth/login?redirect=${encodeURIComponent(returnHref)}`
        )}
      />
    );
  }

  if (created) {
    return (
      <IntakeSuccess
        copy={copy}
        org={created}
        orgHomeHref={localeHref(locale, `/org/${created.orgId}`)}
        downloadHref={localeHref(locale, "/download")}
        guideHrefBase={localeHref(locale, "/guide")}
      />
    );
  }

  return (
    <IntakeForm
      copy={copy}
      value={name}
      submitting={submitting}
      failure={failure}
      onChange={(next) => {
        setName(next);
        if (failure) setFailure(null);
      }}
      onSubmit={handleSubmit}
    />
  );
}
