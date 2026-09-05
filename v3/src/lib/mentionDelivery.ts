/**
 * Evidence the team-chat renderer has after attempting an @mention.
 *
 * A durable remote queue is deliberately not proof that the other machine has
 * a live listener. Keeping that distinction here makes it testable instead of
 * leaving it as a comment at each call site.
 */
export type MentionDeliveryEvidence =
  | "local-delivery"
  | "local-listener-unavailable"
  | "remote-queue";

export type MentionDeliveryState = "available" | "unavailable" | "unknown";

export function mentionDeliveryStateFor(
  evidence: MentionDeliveryEvidence,
): MentionDeliveryState {
  switch (evidence) {
    case "local-delivery":
      return "available";
    case "local-listener-unavailable":
      return "unavailable";
    case "remote-queue":
      return "unknown";
  }
}
