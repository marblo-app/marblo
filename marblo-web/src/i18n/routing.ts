import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en", "ja"],
  // Global beta default: unsupported Accept-Language → /en fallback.
  // Korean visitors are unaffected (Accept-Language ko / NEXT_LOCALE=ko → /ko).
  defaultLocale: "en",
});
