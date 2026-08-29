import { describe, expect, it } from "vitest";

import { activity as enActivity } from "../../src/locales/en/activity";
import { agents as enAgents } from "../../src/locales/en/agents";
import { auth as enAuth } from "../../src/locales/en/auth";
import { beginner as enBeginner } from "../../src/locales/en/beginner";
import { billing as enBilling } from "../../src/locales/en/billing";
import { board as enBoard } from "../../src/locales/en/board";
import { bugReport as enBugReport } from "../../src/locales/en/bugReport";
import { chat as enChat } from "../../src/locales/en/chat";
import { code as enCode } from "../../src/locales/en/code";
import { collaboration as enCollaboration } from "../../src/locales/en/collaboration";
import { common as enCommon } from "../../src/locales/en/common";
import { deploy as enDeploy } from "../../src/locales/en/deploy";
import { diffComment as enDiffComment } from "../../src/locales/en/diffComment";
import { flows as enFlows } from "../../src/locales/en/flows";
import { guide as enGuide } from "../../src/locales/en/guide";
import { harness as enHarness } from "../../src/locales/en/harness";
import { header as enHeader } from "../../src/locales/en/header";
import { lanes as enLanes } from "../../src/locales/en/lanes";
import { legal as enLegal } from "../../src/locales/en/legal";
import { missions as enMissions } from "../../src/locales/en/missions";
import { onboarding as enOnboarding } from "../../src/locales/en/onboarding";
import { orchestrator as enOrchestrator } from "../../src/locales/en/orchestrator";
import { plan as enPlan } from "../../src/locales/en/plan";
import { project as enProject } from "../../src/locales/en/project";
import { retention as enRetention } from "../../src/locales/en/retention";
import { settings as enSettings } from "../../src/locales/en/settings";
import { sidebar as enSidebar } from "../../src/locales/en/sidebar";
import { terminal as enTerminal } from "../../src/locales/en/terminal";
import { updater as enUpdater } from "../../src/locales/en/updater";
import { usage as enUsage } from "../../src/locales/en/usage";
import { workHistory as enWorkHistory } from "../../src/locales/en/workHistory";
import { workspace as enWorkspace } from "../../src/locales/en/workspace";
import { worktree as enWorktree } from "../../src/locales/en/worktree";
import { activity as koActivity } from "../../src/locales/ko/activity";
import { agents as koAgents } from "../../src/locales/ko/agents";
import { auth as koAuth } from "../../src/locales/ko/auth";
import { beginner as koBeginner } from "../../src/locales/ko/beginner";
import { billing as koBilling } from "../../src/locales/ko/billing";
import { board as koBoard } from "../../src/locales/ko/board";
import { bugReport as koBugReport } from "../../src/locales/ko/bugReport";
import { chat as koChat } from "../../src/locales/ko/chat";
import { code as koCode } from "../../src/locales/ko/code";
import { collaboration as koCollaboration } from "../../src/locales/ko/collaboration";
import { common as koCommon } from "../../src/locales/ko/common";
import { deploy as koDeploy } from "../../src/locales/ko/deploy";
import { diffComment as koDiffComment } from "../../src/locales/ko/diffComment";
import { flows as koFlows } from "../../src/locales/ko/flows";
import { guide as koGuide } from "../../src/locales/ko/guide";
import { harness as koHarness } from "../../src/locales/ko/harness";
import { header as koHeader } from "../../src/locales/ko/header";
import { lanes as koLanes } from "../../src/locales/ko/lanes";
import { legal as koLegal } from "../../src/locales/ko/legal";
import { missions as koMissions } from "../../src/locales/ko/missions";
import { onboarding as koOnboarding } from "../../src/locales/ko/onboarding";
import { orchestrator as koOrchestrator } from "../../src/locales/ko/orchestrator";
import { plan as koPlan } from "../../src/locales/ko/plan";
import { project as koProject } from "../../src/locales/ko/project";
import { retention as koRetention } from "../../src/locales/ko/retention";
import { settings as koSettings } from "../../src/locales/ko/settings";
import { sidebar as koSidebar } from "../../src/locales/ko/sidebar";
import { terminal as koTerminal } from "../../src/locales/ko/terminal";
import { updater as koUpdater } from "../../src/locales/ko/updater";
import { usage as koUsage } from "../../src/locales/ko/usage";
import { workHistory as koWorkHistory } from "../../src/locales/ko/workHistory";
import { workspace as koWorkspace } from "../../src/locales/ko/workspace";
import { worktree as koWorktree } from "../../src/locales/ko/worktree";

type LocaleNamespace = Record<string, string>;

const NAMESPACES: Array<{
  name: string;
  ko: LocaleNamespace;
  en: LocaleNamespace;
}> = [
  { name: "activity", ko: koActivity, en: enActivity },
  { name: "agents", ko: koAgents, en: enAgents },
  { name: "auth", ko: koAuth, en: enAuth },
  { name: "beginner", ko: koBeginner, en: enBeginner },
  { name: "billing", ko: koBilling, en: enBilling },
  { name: "board", ko: koBoard, en: enBoard },
  { name: "bugReport", ko: koBugReport, en: enBugReport },
  { name: "chat", ko: koChat, en: enChat },
  { name: "code", ko: koCode, en: enCode },
  { name: "collaboration", ko: koCollaboration, en: enCollaboration },
  { name: "common", ko: koCommon, en: enCommon },
  { name: "deploy", ko: koDeploy, en: enDeploy },
  { name: "diffComment", ko: koDiffComment, en: enDiffComment },
  { name: "flows", ko: koFlows, en: enFlows },
  { name: "guide", ko: koGuide, en: enGuide },
  { name: "harness", ko: koHarness, en: enHarness },
  { name: "header", ko: koHeader, en: enHeader },
  { name: "lanes", ko: koLanes, en: enLanes },
  { name: "legal", ko: koLegal, en: enLegal },
  { name: "missions", ko: koMissions, en: enMissions },
  { name: "onboarding", ko: koOnboarding, en: enOnboarding },
  { name: "orchestrator", ko: koOrchestrator, en: enOrchestrator },
  { name: "plan", ko: koPlan, en: enPlan },
  { name: "project", ko: koProject, en: enProject },
  { name: "retention", ko: koRetention, en: enRetention },
  { name: "settings", ko: koSettings, en: enSettings },
  { name: "sidebar", ko: koSidebar, en: enSidebar },
  { name: "terminal", ko: koTerminal, en: enTerminal },
  { name: "updater", ko: koUpdater, en: enUpdater },
  { name: "usage", ko: koUsage, en: enUsage },
  { name: "workHistory", ko: koWorkHistory, en: enWorkHistory },
  { name: "workspace", ko: koWorkspace, en: enWorkspace },
  { name: "worktree", ko: koWorktree, en: enWorktree },
];

function sortedKeys(table: LocaleNamespace) {
  return Object.keys(table).sort();
}

describe("locale namespace parity", () => {
  it.each(NAMESPACES)(
    "$name has identical ko/en key sets",
    ({ ko, en, name }) => {
      const koKeys = sortedKeys(ko);
      const enKeys = sortedKeys(en);
      const missingInEn = koKeys.filter((key) => !enKeys.includes(key));
      const staleInEn = enKeys.filter((key) => !koKeys.includes(key));

      expect(
        {
          missingInEn,
          staleInEn,
          koCount: koKeys.length,
          enCount: enKeys.length,
        },
        `${name}: ko keys and en keys must stay symmetric`,
      ).toEqual({
        missingInEn: [],
        staleInEn: [],
        koCount: koKeys.length,
        enCount: koKeys.length,
      });
    },
  );

  it("keeps English locale values free of Korean fallback copy", () => {
    const koreanText = /\p{Script=Hangul}/u;
    const leaked = NAMESPACES.flatMap(({ name, en }) =>
      Object.entries(en)
        .filter(([, value]) => koreanText.test(value))
        .map(([key, value]) => ({ namespace: name, key, value })),
    );

    expect(leaked).toEqual([]);
  });

  it("keeps English locale values free of internal Oke transliteration", () => {
    const internalOkeTerms = /\bOke\b|오케/u;
    const leaked = NAMESPACES.flatMap(({ name, en }) =>
      Object.entries(en)
        .filter(([, value]) => internalOkeTerms.test(value))
        .map(([key, value]) => ({ namespace: name, key, value })),
    );

    expect(leaked).toEqual([]);
  });
});
