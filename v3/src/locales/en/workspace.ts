/**
 * English — `workspace.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { workspace as koWorkspace } from "../ko/workspace";

export const workspace: Record<keyof typeof koWorkspace, string> = {
  // Shell chrome
  "workspace.badge": "Workspace Beta",
  "workspace.tagline": "IDE split — fixed terminals left · work tabs right",
  "workspace.exit": "Exit",
  "workspace.browser.openExternal": "Open external browser",
  "workspace.browser.external.title":
    "This link opens in your external browser",
  "workspace.browser.external.reason":
    "Authentication, payment, or site policy keeps it out of the app tab.",
  "workspace.browser.external.signInReason":
    "Google account sign-in can't finish inside an app tab — Google blocks embedded-browser sign-in. Signing in out there does not sign you in here. If this site also offers an email/password sign-in, go back and use that: it is kept in this tab, so the site opens signed in next time.",
  "workspace.browser.backToPage": "Back to the page",
  "workspace.browser.clearSiteData.button": "Clear site data",
  "workspace.browser.clearSiteData.title": "Clear data for {host}",
  "workspace.browser.clearSiteData.body":
    "Cookies, cache, service workers, and local storage will all be deleted, and this site's sign-in will be lost. This cannot be undone.",
  "workspace.browser.clearSiteData.categoriesHeader": "What gets cleared",
  "workspace.browser.clearSiteData.category.cookies": "Cookies",
  "workspace.browser.clearSiteData.category.cache": "Cache",
  "workspace.browser.clearSiteData.category.serviceWorkers": "Service workers",
  "workspace.browser.clearSiteData.category.localStorage": "Local storage",
  "workspace.browser.clearSiteData.cookiesHeader": "Stored cookies ({count})",
  "workspace.browser.clearSiteData.noCookies":
    "No cookies are stored for this site.",
  "workspace.browser.clearSiteData.sessionCookie": "Expires at end of session",
  "workspace.browser.clearSiteData.loading": "Checking…",
  "workspace.browser.clearSiteData.previewError":
    "Could not check this site's data.",
  "workspace.browser.clearSiteData.cancel": "Cancel",
  "workspace.browser.clearSiteData.confirm": "Clear and reload",
  "workspace.browser.clearSiteData.confirming": "Clearing…",
  "workspace.browser.clearSiteData.failed": "Failed to clear site data.",
  "workspace.browser.clearSiteData.originChanged":
    "The site changed while you were confirming. Check the refreshed preview and try again.",

  // IDE split shell
  "workspace.terminals": "Terminals",
  "workspace.collapseTerminals": "Collapse terminals",
  "workspace.expandTerminals": "Expand terminals",
  "workspace.resizeTerminals": "Resize orchestrator / agents",
  "workspace.showFiles": "Show file tree",
  "workspace.hideFiles": "Hide file tree",
  "workspace.showActivity": "Show activity stream",
  "workspace.activity": "Activity",
  "workspace.tab.startHere": "Start here",
  "workspace.tab.board": "Board",
  "workspace.tab.agents": "Marblo Bots",
  "workspace.tab.fleet": "Fleet",
  "workspace.tab.project": "Project",
  "workspace.tab.settings": "Settings",
  "workspace.tab.code": "Code",
  "workspace.tab.worktrees": "Worktrees",
  "workspace.tab.history": "History",
  "workspace.tab.lanes": "Parallel Work",
  "workspace.tab.browser": "Web",
  "workspace.tab.guide": "Guide",
  "workspace.tab.usage": "Usage",
  "workspace.tab.store": "Store",
  "workspace.tab.harness": "Harness",
  "workspace.tab.missions": "Missions",
  "workspace.tab.flows": "Flows (Beta)",
  "workspace.tab.deploy": "Deploy",

  // ── Marblo mode first-entry coachmark tour ─────────────────────────────
  "workspace.tour.progress": "Tip {current}/{total}",
  "workspace.tour.next": "Next",
  "workspace.tour.back": "Back",
  "workspace.tour.done": "Got it",
  "workspace.tour.skip": "Skip",
  "workspace.tour.never": "Don't show this again",
  "workspace.tour.board.title": "Board — tickets at a glance",
  "workspace.tour.board.body":
    "Tickets flow from TODO to DONE on a kanban. Open a card for the agent and activity trail.",
  "workspace.tour.code.title": "Code — files and diffs",
  "workspace.tour.code.body":
    "Open project files and review the diffs agents wrote.",
  "workspace.tour.agents.title": "Agents — your team roster",
  "workspace.tour.agents.body":
    "See who's working, open their terminals, and spawn or stop agents yourself.",
  "workspace.tour.harness.title": "Harness — CLI and model links",
  "workspace.tour.harness.body":
    "Manage Claude, Codex and other harness connections and model routes.",
  "workspace.tour.usage.title": "Usage — cost and limits",
  "workspace.tour.usage.body":
    "Check this month's usage and plan limits before you hit the ceiling.",
  "workspace.tour.settings.title": "Settings — account, beginner mode, alerts",
  "workspace.tour.settings.body":
    "Account, beginner mode, Marblo mode, and notifications. Come back here to return to beginner mode.",
};
