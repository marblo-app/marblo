/**
 * English — `legal.*` namespace. Typed `Record<keyof typeof koLegal, string>`
 * so key drift vs ko is a compile error for this namespace alone.
 */
import type { legal as koLegal } from "../ko/legal";

export const legal: Record<keyof typeof koLegal, string> = {
  "legal.privacy.title": "Privacy Policy",
  "legal.privacy.close": "Close",
  "legal.privacy.summaryHeading": "Summary",
  "legal.privacy.measuresHeading": "Technical safeguards",
  "legal.privacy.contactHeading": "Contact",
  "legal.privacy.contactPrefix": "Privacy inquiries / data deletion requests: ",
};
