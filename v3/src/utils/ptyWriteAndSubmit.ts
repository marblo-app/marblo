import type { MessageKey } from "../locales/ko";

export type PtyWriteAndSubmitRefusal = "composer-occupied" | "awaiting-choice";

export interface PtyWriteAndSubmitResult {
  ok: boolean;
  refusal: PtyWriteAndSubmitRefusal | null;
  reason: string | null;
}

export const PTY_WRITE_AND_SUBMIT_REFUSAL_MESSAGE_KEYS: Record<
  PtyWriteAndSubmitRefusal,
  MessageKey
> = {
  "composer-occupied": "terminal.feedback.refused.composerOccupied",
  "awaiting-choice": "terminal.feedback.refused.awaitingChoice",
};

export function refusalMessageKey(
  result: PtyWriteAndSubmitResult | null | undefined | void,
): MessageKey | null {
  if (result == null) return null;
  if (result.ok || !result.refusal) return null;
  return PTY_WRITE_AND_SUBMIT_REFUSAL_MESSAGE_KEYS[result.refusal];
}

export function writeAndSubmitAccepted(
  result: PtyWriteAndSubmitResult | null | undefined | void,
): boolean {
  return result == null || result.ok;
}
