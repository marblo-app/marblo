import { sendSystemMessage, sendAgentMessage } from "./chatService";
import { t } from "../lib/i18n";

export async function notifyAgentSpawned(
  projectId: string,
  name: string,
  role: string
): Promise<void> {
  await sendSystemMessage(
    projectId,
    t("common.notification.agentSpawned", { name, role })
  );
}

export async function notifyAgentTaskCompleted(
  projectId: string,
  name: string,
  taskId: string,
  taskTitle: string
): Promise<void> {
  await sendAgentMessage(
    projectId,
    name,
    t("common.notification.taskCompleted", { taskTitle }),
    taskId,
    taskTitle
  );
}

export async function notifyAgentSubmittedForReview(
  projectId: string,
  name: string,
  taskId: string,
  taskTitle: string
): Promise<void> {
  await sendAgentMessage(
    projectId,
    name,
    t("common.notification.submittedForReview", { taskTitle }),
    taskId,
    taskTitle
  );
}

export async function notifyAgentError(
  projectId: string,
  name: string,
  error: string
): Promise<void> {
  await sendSystemMessage(
    projectId,
    t("common.notification.agentError", { name, error })
  );
}

export async function notifyAgentRestarted(
  projectId: string,
  name: string
): Promise<void> {
  await sendSystemMessage(
    projectId,
    t("common.notification.agentRestarted", { name })
  );
}
