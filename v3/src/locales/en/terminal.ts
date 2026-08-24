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
  "terminal.feedback.refused.composerOccupied":
    "Not sent because the other composer has an unsubmitted draft — try again after it is cleared",
  "terminal.feedback.refused.awaitingChoice":
    "Not sent because the other side is stopped at a confirmation dialog",
  "terminal.feedback.refused.generic": "Not sent — please try again shortly",
  "terminal.session.expired": "Session expired.",
  "terminal.session.expiredReason":
    "The PTY session ended when the app restarted.",
  "terminal.session.restartHint":
    "Restart it with the Restart button in the Agents tab.",
  "terminal.session.remoteUser": "This agent belongs to another teammate.",
  "terminal.session.remoteUserReason":
    "It is running on that teammate's machine — the terminal is only visible there.",
  "terminal.session.remoteMachine": "Running on another machine.",
  "terminal.session.remoteMachineReason":
    "This agent is running on a different machine, not this one — the terminal is only visible there.",
  "terminal.session.remoteHint":
    "The ticket and its activity are still up to date. There is nothing to restart here.",
  "terminal.session.agentMissing": "No agent is attached to this terminal.",
  "terminal.session.agentMissingReason":
    "The agent was deleted, or it now lives in a different project.",
  "terminal.session.agentMissingHint": "You can close this terminal tab.",
};
