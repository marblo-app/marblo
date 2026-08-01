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
import { board } from "./board";
import { flows } from "./flows";
import { worktree } from "./worktree";
import { lanes } from "./lanes";
import { harness } from "./harness";
import { sidebar } from "./sidebar";
import { orchestrator } from "./orchestrator";
import { guide } from "./guide";
import { missions } from "./missions";
import { legal } from "./legal";
import { billing } from "./billing";
import { usage } from "./usage";
import { onboarding } from "./onboarding";
import { common } from "./common";
import { activity } from "./activity";
import { bugReport } from "./bugReport";
import { chat } from "./chat";
import { auth } from "./auth";
import { updater } from "./updater";
import { workHistory } from "./workHistory";
import { deploy } from "./deploy";
import { code } from "./code";
import { terminal } from "./terminal";
import { workspace } from "./workspace";
import { diffComment } from "./diffComment";
import { collaboration } from "./collaboration";

export const ko = {
  ...header,
  ...settings,
  ...agents,
  ...plan,
  ...board,
  ...flows,
  ...worktree,
  ...lanes,
  ...harness,
  ...sidebar,
  ...orchestrator,
  ...guide,
  ...missions,
  ...legal,
  ...billing,
  ...usage,
  ...onboarding,
  ...common,
  ...activity,
  ...bugReport,
  ...chat,
  ...auth,
  ...updater,
  ...workHistory,
  ...deploy,
  ...code,
  ...terminal,
  ...workspace,
  ...diffComment,
  ...collaboration,
};

export type MessageKey = keyof typeof ko;
