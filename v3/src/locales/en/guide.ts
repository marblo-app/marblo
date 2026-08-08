/**
 * English — `guide.*` namespace. Typed `Record<keyof typeof koGuide, string>`
 * so key drift vs ko is a compile error for this namespace alone.
 */
import type { guide as koGuide } from "../ko/guide";

export const guide: Record<keyof typeof koGuide, string> = {
  "guide.title": "Using Marblo",
  "guide.subtitle":
    "What each tab is for · how to brief the orchestrator · picking models · FAQ",
  "guide.jumpLabel": "Jump to a section",
  "guide.footer":
    "Installing, signing in and your first ticket are handled step by step — with live state — on the Start here tab. This guide covers what comes after that, and where to do it.",
};
