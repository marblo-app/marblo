/**
 * Korean string table — composed from per-surface namespace files.
 *
 * Why split: every i18n PR (P1–P6) used to edit this one file and collide.
 * Namespaces (header/settings/agents/plan) now live in sibling files so PRs
 * touch disjoint files. Add a key to the matching namespace file AND its
 * en/ counterpart — the runtime t() falls back to ko if en is missing, but
 * that defeats translation. See ../README.md for what is/ isn't translatable.
 *
 * `MessageKey` (derived here) is the single source of truth for valid keys;
 * en/index.ts is typed `Record<MessageKey, string>` so a missing/extra key
 * in either locale is a compile-time error.
 */
import { header } from "./header";
import { settings } from "./settings";
import { agents } from "./agents";
import { plan } from "./plan";
import { common } from "./common";

export const ko = {
  ...header,
  ...settings,
  ...agents,
  ...plan,
  ...common,
};

export type MessageKey = keyof typeof ko;
