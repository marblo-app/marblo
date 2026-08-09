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
  "beginner.connect.pickYourself": "Or pick one yourself",
  "beginner.connect.installFail": "Couldn't install it",
  "beginner.connect.officialDocs": "Open the official install guide",

  // ── ①-a One click (install everything + sign in) ────────────────────────
  "beginner.oneClick.ctaTitle": "Set everything up in one click",
  "beginner.oneClick.ctaBody":
    "We'll install the CLIs for you and open the sign-in for you when that's done. All you do is approve it in your browser.",
  "beginner.oneClick.cta": "Install everything & sign me in",
  "beginner.oneClick.ctaPending": "{count} left to install",
  "beginner.oneClick.ctaNothingToInstall":
    "Already installed — only the sign-in is left",
  "beginner.oneClick.title": "Installing and signing you in",
  "beginner.oneClick.step.install": "Install",
  "beginner.oneClick.step.auth": "Sign in",
  "beginner.oneClick.status.installing":
    "Installing the CLIs you need. This takes a moment.",
  "beginner.oneClick.status.signIn": "Installed. Opening the sign-in…",
  "beginner.oneClick.status.awaitingAuth":
    "Just approve it in your browser — we'll move on automatically.",
  "beginner.oneClick.status.blocked":
    "Auto-install is blocked. Paste the command below into a terminal instead.",
  "beginner.oneClick.status.done": "Connected. You're ready to start.",
  "beginner.oneClick.installProgress": "{done}/{total} installed",
  "beginner.oneClick.partial":
    "{failed} of {total} failed, but we're carrying on with the ones that worked.",
  "beginner.oneClick.terminalHint":
    "This is the {cli} sign-in. Approve it when the browser opens — you can leave this window as it is.",
  "beginner.oneClick.stuck":
    "If the browser doesn't open, copy the URL printed below and open it yourself.",
  "beginner.oneClick.blocked.title": "Auto-install failed",
  "beginner.oneClick.blocked.body":
    "Paste the command below into a terminal to install it yourself, then hit Try again.",
  "beginner.oneClick.blocked.docs": "Open the official install guide",
  "beginner.oneClick.done": "All set — tell us what you'd like to build.",
  "beginner.oneClick.retry": "Try again",
  "beginner.oneClick.manual": "I'll pick one myself",
  "beginner.oneClick.close": "Close",
  "beginner.oneClick.footerHint":
    "You can close this and carry on manually at any time.",

  // ── ①-b Signed in, but nothing runs (no subscription / credits) ─────────
  "beginner.funding.unfunded.title": "You need a subscription",
  "beginner.funding.unfunded.body":
    "Signing in worked. But that account has no subscription or credits available, so {cli} couldn't run even once. Turn on a plan below and you can pick up right where you left off.",
  "beginner.funding.blocked.title": "Signed in, but it won't run",
  "beginner.funding.blocked.rateLimit":
    "Signing in worked and you do appear to have a plan — you're just at {cli}'s usage limit right now. Check again once the limit resets.",
  "beginner.funding.blocked.auth":
    "You're shown as signed in, but running {cli} asks you to sign in again. Run the sign-in once more, then check again.",
  "beginner.funding.blocked.unknown":
    "Signing in worked, but running {cli} once failed. See the message below for what it said — it may be a subscription/credit problem, or just a temporary one.",
  "beginner.funding.step1": "Open the {cli} plans page with the button below.",
  "beginner.funding.step2":
    "Subscribe with the **same account** you signed in with.",
  "beginner.funding.step3":
    "Come back and hit 'Check again' — we'll carry straight on.",
  "beginner.funding.openSubscription": "See {cli} plans",
  "beginner.funding.apiPlan.title": "Simple API-rate checkout (coming soon)",
  "beginner.funding.apiPlan.body":
    "We're also working on pay-for-what-you-use instead of a subscription. When it's ready you'll be able to pay for it right here.",
  "beginner.funding.detail": "See what it printed when we ran it",
  "beginner.funding.recheck": "I've subscribed · Check again",
  "beginner.funding.rechecking": "Checking…",
  "beginner.funding.later": "Later",
  "beginner.funding.close": "Close",
  "beginner.funding.footerHint":
    "You can close this and keep using the app either way.",

  // ── ② Folder ────────────────────────────────────────────────────────────
  "beginner.folder.title": "Open a folder to work in",
  "beginner.folder.body":
    "Pick a project folder and the agents will work inside it. An empty new folder is fine too.",
  "beginner.folder.cta": "Open my folder",
  "beginner.folder.preparingTitle": "Setting up a practice project",
  "beginner.folder.preparingBody":
    "We're creating a small example folder and connecting it for you. Just a few seconds.",
  "beginner.folder.sampleFailed":
    "We couldn't create the example folder. Use the button above to open one yourself.",

  // ── ③ First ask ─────────────────────────────────────────────────────────
  "beginner.ask.title": "What should we build?",
  "beginner.ask.body":
    "Just write it in plain language. Splitting it into tickets and assigning agents is Marblo's job.",
  "beginner.ask.placeholder":
    "e.g. Read this repo's README and write a getting-started guide",
  "beginner.ask.send": "Send",
  "beginner.ask.sending": "Sending…",
  "beginner.ask.sent": "Sent. You'll see progress below.",
  "beginner.ask.sentShort": "Sent",
  "beginner.ask.queuedShort": "Queued",
  "beginner.ask.failedShort": "Not sent",
  "beginner.ask.duplicate":
    "That's the same message you just sent. It already went through — give it a moment, or phrase it differently.",
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

  // ── ⑤ Mini board + mini agent view ──────────────────────────────────────
  "beginner.board.label": "Work in flight",
  "beginner.board.todo": "To do",
  "beginner.board.doing": "In progress",
  "beginner.board.done": "Done",
  "beginner.board.more": "+{count} more",
  "beginner.agents.label": "Who's working",
  "beginner.agents.empty":
    "Nobody's on the job yet. Say what you'd like built and Marblo puts a team on it.",
  "beginner.agents.noTask": "Nothing assigned right now",
  "beginner.agents.openTerminal": "Tap to see what they're doing",
  "beginner.agents.terminalEmpty":
    "Nothing to show yet. This teammate just started or is reconnecting — try again in a moment.",
  "beginner.agents.terminalHint":
    "This is what your teammate is working on right now. Watching is enough — but you can answer them here if they ask.",

  // ── Chat ────────────────────────────────────────────────────────────────
  "beginner.chat.title": "Talk to Marblo",
  "beginner.chat.hint": "Keep the conversation going right here.",
  "beginner.chat.composerLabel": "Say something else",
  "beginner.chat.dismiss": "Close this box",
  "beginner.chat.placeholder":
    "What next? e.g. add a few examples to the guide you just wrote",
  "beginner.chat.orchestratorRunning": "In conversation",

  // ── Ticket detail (mini board card click) ───────────────────────────────
  "beginner.taskDetail.label": "Task detail",
  "beginner.taskDetail.owner": "{name} is on it",
  "beginner.taskDetail.noOwner": "Nobody's picked this up yet",
  "beginner.taskDetail.askProgressCta": "Ask how it's going",
  "beginner.taskDetail.askProgress":
    "How far along is '{title}'? Keep it short.",
  "beginner.taskDetail.askStuckCta": "Ask why it's stuck",
  "beginner.taskDetail.askStuck":
    "'{title}' looks stuck. In plain language: what stopped it, and what do you need from me?",
  "beginner.taskDetail.askDoneCta": "Ask what changed",
  "beginner.taskDetail.askDone":
    "Summarise what changed in '{title}', in plain language.",
  "beginner.taskDetail.close": "Close",

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
    "Once you send a request, this line keeps showing how many tickets exist and how far along they are. Click a card to see what it is; who's on it shows up in the team column on the right.",
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
  "beginner.topbar.simple": "Simple mode",
  "beginner.topbar.simpleHint":
    "Folds away tabs and the board, leaving one big chat. You can switch back any time from Settings.",
  "beginner.settings.replayTour": "Replay the first-run walkthrough",
  "beginner.settings.replayTourDone":
    "The walkthrough will show up next time you open the beginner screen.",

  // ── Onboarding preview (dev/QA demo) ────────────────────────────────────
  "beginner.preview.badge": "Preview",
  "beginner.preview.bannerBody":
    "Simulating a brand-new user's first connect flow — nothing is actually installed, signed in or reconnected.",
  "beginner.preview.restart": "Restart",
  "beginner.preview.advance": "Next step",
  "beginner.preview.exit": "Exit preview",
  "beginner.preview.sampleFolder": "marblo-sample (preview)",
  "beginner.preview.folderLocked":
    "Folders aren't changed while the preview is on. Exit to get your folder back.",
  "beginner.preview.settings.heading": "Onboarding preview (dev)",
  "beginner.preview.settings.body":
    "Replays a brand-new user's first connect flow (one-click install → auto sign-in → terminal → sample folder) even on a machine where the CLIs are already installed and signed in. For demos and QA.",
  "beginner.preview.settings.on":
    "Preview on — the screen switches to the new-user flow",
  "beginner.preview.settings.off": "Turn on preview",
  "beginner.preview.settings.safety":
    "Simulation only: real installs, sign-ins, keychain entries and folder connections are untouched, and turning it off restores your normal screen immediately.",
};
