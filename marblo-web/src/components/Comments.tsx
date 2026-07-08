"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

/**
 * Giscus (GitHub Discussions) comments, mounted at the bottom of a blog post.
 *
 * Fully env-gated: if any of the four NEXT_PUBLIC_GISCUS_* values is missing,
 * Giscus is NOT loaded and a "comments coming soon" placeholder renders instead.
 * The blog therefore builds and deploys with no Giscus config at all.
 *
 * `term` (the post slug) drives Giscus mapping=specific, so each post maps to
 * its own discussion thread. `locale` sets the widget language.
 */
type CommentsProps = {
  term: string;
  locale: string;
};

const REPO = process.env.NEXT_PUBLIC_GISCUS_REPO;
const REPO_ID = process.env.NEXT_PUBLIC_GISCUS_REPO_ID;
const CATEGORY = process.env.NEXT_PUBLIC_GISCUS_CATEGORY;
const CATEGORY_ID = process.env.NEXT_PUBLIC_GISCUS_CATEGORY_ID;

const GISCUS_LANG: Record<string, string> = {
  ko: "ko",
  en: "en",
  ja: "ja",
};

export default function Comments({ term, locale }: CommentsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useTranslations("blog");

  const configured = Boolean(REPO && REPO_ID && CATEGORY && CATEGORY_ID);

  useEffect(() => {
    if (!configured || !ref.current) return;
    // Avoid double-injecting on client navigation / re-render.
    if (ref.current.querySelector("script")) return;

    const script = document.createElement("script");
    script.src = "https://giscus.app/client.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.setAttribute("data-repo", REPO as string);
    script.setAttribute("data-repo-id", REPO_ID as string);
    script.setAttribute("data-category", CATEGORY as string);
    script.setAttribute("data-category-id", CATEGORY_ID as string);
    script.setAttribute("data-mapping", "specific");
    script.setAttribute("data-term", term);
    script.setAttribute("data-strict", "1");
    script.setAttribute("data-reactions-enabled", "1");
    script.setAttribute("data-emit-metadata", "0");
    script.setAttribute("data-input-position", "top");
    script.setAttribute("data-theme", "dark");
    script.setAttribute("data-lang", GISCUS_LANG[locale] ?? "en");
    script.setAttribute("data-loading", "lazy");
    ref.current.appendChild(script);
  }, [configured, term, locale]);

  return (
    <section className="mt-14 border-t border-zinc-800 pt-8">
      <h2 className="text-lg font-semibold text-white mb-4">{t("comments")}</h2>
      {configured ? (
        <div ref={ref} className="giscus" />
      ) : (
        <p className="text-sm text-zinc-500">{t("commentsComingSoon")}</p>
      )}
    </section>
  );
}
