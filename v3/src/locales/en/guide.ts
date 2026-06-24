/**
 * English — `guide.*` namespace. Typed `Record<keyof typeof koGuide, string>`
 * so key drift vs ko is a compile error for this namespace alone.
 */
import type { guide as koGuide } from "../ko/guide";

export const guide: Record<keyof typeof koGuide, string> = {
  "guide.title": "Marblo Getting Started",
  "guide.subtitle":
    "Assemble and orchestrate an army of AI agents — the core building blocks on one page",
  "guide.footerPrefix": "For more detail, see ",
  "guide.footerSuffix": " or the PRD doc.",
};
