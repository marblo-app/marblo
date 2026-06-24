/**
 * English — `plan.*` namespace. Plan tier names are brand terms, identical in
 * both locales. Typed against the ko counterpart so key drift is a compile error.
 */
import type { plan as koPlan } from "../ko/plan";

export const plan: Record<keyof typeof koPlan, string> = {
  "plan.free": "Free",
  "plan.pro": "Pro",
  "plan.team": "Team",
  "plan.teamPlus": "Team Plus",
  "plan.enterprise": "Enterprise",
};
