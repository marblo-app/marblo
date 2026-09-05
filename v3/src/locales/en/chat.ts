/**
 * English — `chat.*` namespace. Typed against the ko counterpart so key drift
 * is a compile-time error.
 */
import type { chat as koChat } from "../ko/chat";

export const chat: Record<keyof typeof koChat, string> = {
  "chat.empty.noProject": "Select a project",
  "chat.empty.noMessages": "No messages yet",
  "chat.empty.startHint": "Start a team chat",
  "chat.inputPlaceholder": "Type a message... (@ to mention)",
  "chat.orchestratorQueueFailed":
    "⚠️ Failed to queue the orchestrator message.",
  "chat.mentionDelivery.available":
    "The instruction was delivered to a recipient on this device.",
  "chat.mentionDelivery.unavailable":
    "There is no active receiving listener, so delivery cannot be confirmed.",
  "chat.mentionDelivery.unknown":
    "The instruction was queued for remote delivery. The remote listener status is unknown.",
};
