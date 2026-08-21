import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en", "ja"],
  // Global beta default: unsupported Accept-Language → /en fallback.
  // Korean visitors are unaffected (Accept-Language ko / NEXT_LOCALE=ko → /ko).
  //
  // Before changing this, read docs/HREFLANG-X-DEFAULT-DECISION-2026-08-21.md.
  // It measures what this line actually controls. Two things are commonly
  // assumed and are both false: it does NOT move any canonical URL (localePrefix
  // is unset, so next-intl's "always" applies and /ko, /en, /ja are all real
  // URLs regardless), and it does NOT affect Korean-speaking visitors — they
  // match hreflang="ko" and are negotiated to /ko either way. What it does
  // control is the landing page for visitors whose language matches none of
  // ko/en/ja, and the x-default target derived from it in lib/seo.ts and
  // app/sitemap.ts (both read this value; neither hardcodes a copy).
  defaultLocale: "en",
  // SEO hreflang is emitted by Next metadata + app/sitemap.ts. next-intl's
  // response Link header derives x-default from the locale-less request path
  // (`/pricing`) while the canonical site default is `/en/pricing`, producing
  // a conflicting hreflang cluster for crawlers that read HTTP headers.
  alternateLinks: false,
});
