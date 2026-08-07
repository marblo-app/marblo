/**
 * English — `beginner.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { beginner as koBeginner } from "../ko/beginner";

export const beginner: Record<keyof typeof koBeginner, string> = {
  // ── Top bar ─────────────────────────────────────────────────────────────
  "beginner.topbar.noFolder": "No folder",
  "beginner.topbar.openFolder": "Open my folder",
  "beginner.topbar.changeFolder": "Change folder",
  "beginner.topbar.settings": "Settings",
  "beginner.topbar.advanced": "Advanced mode",
  "beginner.topbar.advancedHint":
    "Takes you to the full screen with the board, worktrees and model picker. You can come back any time from Settings.",

  // ── ① Connect (just one) ────────────────────────────────────────────────
  "beginner.connect.title": "Connect one account and you're in",
  "beginner.connect.subtitle":
    "Connect **either** Claude or Codex — just one. You can add the other later.",
  "beginner.connect.claudeName": "Claude",
  "beginner.connect.claudeDesc": "Sign in with your Claude Code subscription",
  "beginner.connect.codexName": "Codex",
  "beginner.connect.codexDesc":
    "Sign in with your ChatGPT (Codex) subscription",
  "beginner.connect.cta": "Connect",
  "beginner.connect.connecting": "Connecting…",
  "beginner.connect.installing": "Installing — one moment",
  "beginner.connect.terminalHint":
    "Finish the browser sign-in below. We'll move on automatically once it's done.",
  "beginner.connect.recheck": "Check again",
  "beginner.connect.checking": "Checking…",
  "beginner.connect.ready": "Connected",
  "beginner.connect.watchDemo": "Watch the demo first",
  "beginner.connect.stuck":
    "Stuck? You can paste the URL printed in the terminal into your browser directly.",

  // ── ② Folder ────────────────────────────────────────────────────────────
  "beginner.folder.title": "Open a folder to work in",
  "beginner.folder.body":
    "Pick a project folder and the agents will work inside it. An empty new folder is fine too.",
  "beginner.folder.cta": "Open my folder",

  // ── ③ First ask ─────────────────────────────────────────────────────────
  "beginner.ask.title": "What should we build?",
  "beginner.ask.body":
    "Just write it in plain language. Splitting it into tickets and assigning agents is Marblo's job.",
  "beginner.ask.placeholder":
    "e.g. Read this repo's README and write a getting-started guide",
  "beginner.ask.send": "Send",
  "beginner.ask.sending": "Sending…",
  "beginner.ask.sent": "Sent. You'll see progress below.",
  "beginner.ask.resend": "Send again",
  "beginner.ask.queued":
    "The orchestrator isn't up yet, so this only went to the queue. Please try again in a moment.",
  "beginner.ask.failed": "Couldn't deliver it. Please try again in a moment.",
  "beginner.ask.example1": "Read the README and write a getting-started guide",
  "beginner.ask.example2": "Add tests to the functions that don't have any",
  "beginner.ask.example3": "Explain how this project is structured",

  // ── ④ Inline live (★S4) ─────────────────────────────────────────────────
  "beginner.live.thinking": "Reading your request… (usually 1–3 min)",
  "beginner.live.stalled": "Still no tickets",
  "beginner.live.stalledHelp":
    "The orchestrator may not have received it. Send again, or type it straight into the chat below.",
  "beginner.live.planned": "Created {count} to-dos",
  "beginner.live.working": "{count} agent(s) working",
  "beginner.live.completed": "{count} done",
  "beginner.live.progress": "{done}/{total} done",
  "beginner.live.label": "Happening now",

  // ── Chat ────────────────────────────────────────────────────────────────
  "beginner.chat.title": "Talk to Marblo",
  "beginner.chat.hint": "Keep the conversation going right here.",

  // ── Promotion modal ─────────────────────────────────────────────────────
  "beginner.promote.title": "Ready for the real thing?",
  "beginner.promote.body":
    "You've got the hang of it. Advanced mode unlocks all of this.",
  "beginner.promote.point1": "Direct several agents yourself from the board",
  "beginner.promote.point2": "Review changed code through worktrees and diffs",
  "beginner.promote.point3": "Pick a model per ticket when you spawn",
  "beginner.promote.cta": "Switch to advanced",
  "beginner.promote.later": "Not yet",
  "beginner.promote.revertHint": "You can come back any time from Settings.",
  "beginner.promote.reason.completed": "You finished {count} tickets",
  "beginner.promote.reason.merged": "You landed your first merge",
  "beginner.promote.reason.days": "You've been using Marblo for a few days",

  // ── Coachmark tour (first-run walkthrough) ──────────────────────────────
  "beginner.tour.progress": "Tip {current}/{total}",
  "beginner.tour.next": "Next",
  "beginner.tour.back": "Back",
  "beginner.tour.done": "Get started",
  "beginner.tour.skip": "Skip",
  "beginner.tour.never": "Don't show this again",
  "beginner.tour.chat.title": "This is where you talk to Marblo",
  "beginner.tour.chat.body":
    "It looks like a terminal, but you can just talk to it. Marblo splits the work up and hands it to agents.",
  "beginner.tour.ask.title": "Write your first request here",
  "beginner.tour.ask.body":
    "Describe what you want in plain language — or tap one of the examples below.",
  "beginner.tour.live.title": "Progress shows up here",
  "beginner.tour.live.body":
    "Once you send a request, this line keeps showing how many tickets exist and how many agents are working.",
  "beginner.tour.advanced.title": "Switch to advanced mode any time",
  "beginner.tour.advanced.body":
    "Need the board, worktrees or the model picker? Click here. Settings brings you back.",

  // ── Settings toggle ─────────────────────────────────────────────────────
  "beginner.settings.heading": "Beginner mode",
  "beginner.settings.body":
    "Hides the tabs, board and worktrees and shows one big chat instead. Good when you're new, or when you just want to hand work off quietly.",
  "beginner.settings.on": "Turn on beginner mode",
  "beginner.settings.off": "Switch to advanced",
  "beginner.settings.restartHint":
    "The whole screen changes. Agents already running keep going.",
  "beginner.settings.replayTour": "Replay the first-run walkthrough",
  "beginner.settings.replayTourDone":
    "The walkthrough will show up next time you open the beginner screen.",
};
