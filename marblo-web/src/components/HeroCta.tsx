"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import HeroCtaView from "./HeroCtaView";
import type { HeroCtaAuthState } from "./heroCtaLogic";

export interface HeroCtaProps {
  locale: string;
  signupLabel: string;
  downloadLabel: string;
  className?: string;
}

/**
 * Login-aware hero CTA, split out of the (server-rendered) homepage so the
 * rest of the page keeps its server rendering for SEO/initial paint. A
 * signed-in visitor is sent to /download instead of /auth/signup — they
 * already have an account, the next real step is getting the desktop app.
 * While Firebase is still resolving, the CTA stays reserved-but-invisible
 * (same layout box) instead of flashing the signed-out copy first.
 */
export default function HeroCta(props: HeroCtaProps) {
  const [state, setState] = useState<HeroCtaAuthState>("pending");

  useEffect(() => {
    return onAuthStateChanged(auth, (user) =>
      setState(user ? "authed" : "anon")
    );
  }, []);

  return <HeroCtaView state={state} {...props} />;
}
