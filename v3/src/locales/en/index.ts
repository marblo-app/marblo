/**
 * English string table — composed from per-surface namespace files.
 *
 * Typed `Record<MessageKey, string>` (MessageKey derived from ko): every key
 * defined in ko MUST appear here and vice-versa, or it's a compile-time error.
 * This is the original monolith's key-parity guarantee, preserved after the
 * namespace split. Each namespace file additionally type-checks itself against
 * its ko sibling, so drift is caught at the narrowest scope.
 */
import type { MessageKey } from "../ko";
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

export const en: Record<MessageKey, string> = {
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
};
