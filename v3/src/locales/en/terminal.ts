/**
 * English — `terminal.*` namespace. Typed `Record<keyof typeof koTerminal, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { terminal as koTerminal } from "../ko/terminal";

export const terminal: Record<keyof typeof koTerminal, string> = {
  "terminal.feedback.toggleTitle": "PM feedback",
  "terminal.feedback.label": "Feedback",
  "terminal.feedback.recent": "Recent feedback",
  "terminal.feedback.historyTitle": "Feedback history",
  "terminal.feedback.placeholder": "Send PM feedback to the agent",
  "terminal.feedback.send": "Send",
  "terminal.session.expired": "Session expired.",
  "terminal.session.expiredReason":
    "The PTY session ended when the app restarted.",
  "terminal.session.restartHint":
    "Restart it with the Restart button in the Agents tab.",
};
