import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

export interface ProvisionAssistantWebhookResponse {
  webhookId: string;
  url: string;
  secret: string | null;
  secretMasked: string;
  rotated: boolean;
}

const provisionAssistantWebhookFn = httpsCallable<
  { projectId: string; rotate?: boolean },
  ProvisionAssistantWebhookResponse
>(functions, "provisionAssistantWebhook");

export async function provisionAssistantWebhook(
  projectId: string,
  rotate: boolean,
): Promise<ProvisionAssistantWebhookResponse> {
  const result = await provisionAssistantWebhookFn({ projectId, rotate });
  return result.data;
}
