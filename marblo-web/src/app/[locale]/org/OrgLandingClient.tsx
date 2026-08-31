"use client";

/**
 * `/org` — 착지 판정 + 조직 선택 화면.
 *
 * ★착지 규칙은 §5.8 그대로다(`resolveOrgLanding`). 이 컴포넌트는 규칙을
 *   실행할 뿐 판정하지 않는다 — localStorage 의 후보는 서버가 준 멤버십
 *   목록과의 교집합으로만 쓰이고, 규칙 3(여럿 + 마지막 본 조직 없음)일 때만
 *   선택 화면이 그려진다.
 * ★권한을 화면에서 판정하지 않는다 — 목록 자체가 서버가 uid 로 도출한
 *   허용 집합이다(`/team` 과 같은 규약).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useMessages } from "next-intl";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { auth } from "@/lib/firebase";
import { Loader2 } from "lucide-react";
import { localeHref } from "@/i18n/routing";
import { buildOrgCopy } from "./orgCopy";
import {
  landingPath,
  normalizeOrganizations,
  resolveOrgLanding,
  type OrgsEnvelope,
} from "./orgContract";
import { readLastSeenOrgId } from "./orgStorage";
import { OrgChooserView } from "./OrgViews";

/** #1340 이 배포한 콜러블. 새 이름을 발명하지 않는다. */
const CALLABLE_GET_ORGANIZATIONS = "getOrganizations";

type CallableError = { code?: string; message?: string };

export default function OrgLandingClient() {
  const locale = useLocale();
  const messages = useMessages();
  const router = useRouter();
  const copy = useMemo(
    () =>
      buildOrgCopy((messages as Record<string, unknown> | undefined)?.["org"]),
    [messages]
  );

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [env, setEnv] = useState<OrgsEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable<Record<string, never>, unknown>(
        getFunctions(app, "us-central1"),
        CALLABLE_GET_ORGANIZATIONS
      );
      const res = await fn({});
      // ★신뢰 경계. 정규화를 거치지 않은 값은 화면으로 내려보내지 않는다.
      setEnv(normalizeOrganizations(res.data));
    } catch (err: unknown) {
      const code = (err as CallableError)?.code;
      setEnv(null);
      setError(
        code === "functions/unauthenticated"
          ? copy.text["error.unauthenticated"]
          : code === "functions/not-found" || code === "functions/internal"
          ? copy.text["error.notDeployed"]
          : copy.text["error.unknown"]
      );
    } finally {
      setLoading(false);
    }
  }, [copy]);

  useEffect(() => {
    if (!authReady || !user) return;
    void load();
  }, [authReady, user, load]);

  // ── 착지 — §5.8. 선택 화면(choose)만 이 라우트에 남는다 ──────────────────
  //
  // ★판정은 렌더에서(useMemo), 이동은 effect 에서 — effect 가 setState 를 하지
  //   않는다. localStorage 읽기는 effect 이후에만 값이 쓰인다(첫 렌더의 env 는
  //   항상 null 이라 SSR/hydration 불일치가 없다).
  const landing = useMemo(
    () => (env ? resolveOrgLanding(env.orgs, readLastSeenOrgId()) : null),
    [env]
  );
  useEffect(() => {
    if (!landing || landing.kind === "choose") return;
    router.replace(localeHref(locale, landingPath(landing)));
  }, [landing, router, locale]);

  if (!authReady) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <h1 className="text-xl font-semibold text-zinc-100">
          {copy.text["title"]}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {copy.text["state.signInRequired"]}
        </p>
        <Link
          href={localeHref(
            locale,
            `/auth/login?redirect=${encodeURIComponent(
              localeHref(locale, "/org")
            )}`
          )}
          className="mt-4 inline-flex items-center rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900"
        >
          {copy.text["action.signIn"]}
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-5">
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-200"
          >
            {copy.text["action.retry"]}
          </button>
        </div>
      </div>
    );
  }

  if (!env || !landing || landing.kind !== "choose") {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {copy.text["state.landing"]}
      </div>
    );
  }

  return (
    <div className={loading ? "opacity-60" : undefined}>
      <OrgChooserView copy={copy} locale={locale} orgs={env.orgs} />
    </div>
  );
}
