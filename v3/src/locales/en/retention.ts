/**
 * English — `retention.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 *
 * Same copy discipline as the ko file: no pleading, no guilt, no reward, and
 * the freedom to skip is stated above the choices — not buried under them.
 */
import type { retention as koRetention } from "../ko/retention";

export const retention: Record<keyof typeof koRetention, string> = {
  "retention.pauseReason.eyebrow": "One question",
  "retention.pauseReason.title":
    "It's been {days} days. What's closest to why you didn't use Marblo in between?",
  "retention.pauseReason.optOut":
    "You don't have to answer. This question won't come back.",

  "retention.pauseReason.option.noNeed": "Busy, or nothing for Marblo to do",
  "retention.pauseReason.option.otherTool":
    "Did the same work with another tool",
  "retention.pauseReason.option.setupFriction":
    "Setup or connecting was a hassle",
  "retention.pauseReason.option.outputQuality":
    "The output fell short of what I expected",
  "retention.pauseReason.option.cost": "The cost was too much",
  "retention.pauseReason.option.other": "Something else",

  "retention.pauseReason.noteLabel": "Anything to add (optional)",
  "retention.pauseReason.notePlaceholder": "One line is plenty.",
  "retention.pauseReason.noteScope":
    "Only the choice above and this line are sent.",

  "retention.pauseReason.send": "Send",
  "retention.pauseReason.sending": "Sending...",
  "retention.pauseReason.close": "Close",
  "retention.pauseReason.dismiss": "Close question",
  "retention.pauseReason.noteFailed":
    "Your note wasn't delivered. Your choice was recorded.",
};
