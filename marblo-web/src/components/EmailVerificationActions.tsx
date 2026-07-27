"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { User } from "firebase/auth";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import {
  cooldownSeconds,
  readLastSentAt,
  refreshEmailVerified,
  resendCooldownRemainingMs,
  sendVerification,
  verificationErrorKey,
} from "@/lib/emailVerification";

type Feedback =
  | { kind: "sent" }
  | { kind: "still_unverified" }
  | { kind: "error"; messageKey: string }
  | null;

interface Props {
  user: User;
  locale: string;
  /** Where to send the user after they click the link in the email. */
  redirect?: string | null;
  /** Called once the account is confirmed verified (token already refreshed). */
  onVerified?: () => void;
  className?: string;
}

/**
 * The two things an unverified user can do — resend the link, and re-check
 * after clicking it. Shared by /auth/verify and the beta-survey banner so both
 * surfaces stay in step (same cooldown, same error copy, same token refresh).
 *
 * Re-checking is also wired to window focus: the common flow is "click link in
 * mail tab → switch back to this tab", and doing it automatically saves the
 * user from having to notice a button.
 */
export default function EmailVerificationActions({
  user,
  locale,
  redirect,
  onVerified,
  className = "",
}: Props) {
  const t = useTranslations("emailVerify");

  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [remainingMs, setRemainingMs] = useState(() =>
    resendCooldownRemainingMs(readLastSentAt(user.uid), Date.now())
  );
  const [everSent, setEverSent] = useState(
    () => readLastSentAt(user.uid) !== null
  );

  // Refs keep the effects below from re-running (and re-sending) on every
  // render caused by the cooldown ticker.
  const busyRef = useRef(false);
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  const syncCooldown = useCallback(() => {
    setRemainingMs(
      resendCooldownRemainingMs(readLastSentAt(user.uid), Date.now())
    );
  }, [user.uid]);

  const send = useCallback(async () => {
    if (busyRef.current) return;
    if (resendCooldownRemainingMs(readLastSentAt(user.uid), Date.now()) > 0) {
      syncCooldown();
      return;
    }
    busyRef.current = true;
    setSending(true);
    setFeedback(null);
    try {
      await sendVerification(user, { locale, redirect });
      setEverSent(true);
      setFeedback({ kind: "sent" });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      setFeedback({ kind: "error", messageKey: verificationErrorKey(code) });
    } finally {
      busyRef.current = false;
      setSending(false);
      syncCooldown();
    }
  }, [user, locale, redirect, syncCooldown]);

  const check = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (busyRef.current) return;
      busyRef.current = true;
      if (!opts.silent) {
        setChecking(true);
        setFeedback(null);
      }
      try {
        const verified = await refreshEmailVerified(user);
        if (verified) {
          onVerifiedRef.current?.();
        } else if (!opts.silent) {
          setFeedback({ kind: "still_unverified" });
        }
      } catch (err) {
        if (!opts.silent) {
          const code = (err as { code?: string } | null)?.code;
          setFeedback({
            kind: "error",
            messageKey: verificationErrorKey(code),
          });
        }
      } finally {
        busyRef.current = false;
        setChecking(false);
      }
    },
    [user]
  );

  // Refocus after clicking the link in another tab → pick it up silently.
  useEffect(() => {
    const onFocus = () => void check({ silent: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  // Tick the cooldown label down to zero.
  useEffect(() => {
    if (remainingMs <= 0) return;
    const id = window.setInterval(syncCooldown, 1000);
    return () => window.clearInterval(id);
  }, [remainingMs, syncCooldown]);

  const waiting = remainingMs > 0;
  const sendDisabled = sending || checking || waiting;

  return (
    <div className={className}>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={() => void send()}
          disabled={sendDisabled}
          className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-5 py-3 rounded-xl text-sm font-semibold transition"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Mail className="w-4 h-4" />
          )}
          {sending
            ? t("sending")
            : waiting
            ? t("resend_wait", { seconds: cooldownSeconds(remainingMs) })
            : everSent
            ? t("resend")
            : t("send")}
        </button>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking || sending}
          className="inline-flex items-center justify-center gap-2 border border-zinc-700 hover:border-zinc-500 disabled:opacity-50 text-zinc-100 px-5 py-3 rounded-xl text-sm font-semibold transition"
        >
          {checking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {checking ? t("refreshing") : t("refresh")}
        </button>
      </div>

      {feedback && (
        <p
          role="status"
          aria-live="polite"
          className={`text-sm mt-3 ${
            feedback.kind === "sent" ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          {feedback.kind === "sent"
            ? t("sent_ok")
            : feedback.kind === "still_unverified"
            ? t("still_unverified")
            : t(feedback.messageKey)}
        </p>
      )}
    </div>
  );
}
