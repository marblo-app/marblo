import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en", "ja"],
  // Global beta default: unsupported Accept-Language → /en fallback.
  // Korean visitors are unaffected (Accept-Language ko / NEXT_LOCALE=ko → /ko).
  defaultLocale: "en",
  // SEO hreflang is emitted by Next metadata + app/sitemap.ts. next-intl's
  // response Link header derives x-default from the locale-less request path
  // (`/pricing`) while the canonical site default is `/en/pricing`, producing
  // a conflicting hreflang cluster for crawlers that read HTTP headers.
  alternateLinks: false,
});
