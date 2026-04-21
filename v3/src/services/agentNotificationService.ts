import { sendSystemMessage, sendAgentMessage } from './chatService';

export async function notifyAgentSpawned(
  projectId: string,
  name: string,
  role: string,
): Promise<void> {
  await sendSystemMessage(
    projectId,
    `에이전트 "${name}" (${role})이(가) 시작되었습니다.`,
  );
}

export async function notifyAgentTaskCompleted(
  projectId: string,
  name: string,
  taskId: string,
  taskTitle: string,
): Promise<void> {
  await sendAgentMessage(
    projectId,
    name,
    `태스크를 완료했습니다: "${taskTitle}"`,
    taskId,
    taskTitle,
  );
}

export async function notifyAgentSubmittedForReview(
  projectId: string,
  name: string,
  taskId: string,
  taskTitle: string,
): Promise<void> {
  await sendAgentMessage(
    projectId,
    name,
    `태스크 리뷰를 제출했습니다: "${taskTitle}"`,
    taskId,
    taskTitle,
  );
}

export async function notifyAgentError(
  projectId: string,
  name: string,
  error: string,
): Promise<void> {
  await sendSystemMessage(
    projectId,
    `에이전트 "${name}" 오류: ${error}`,
  );
}

export async function notifyAgentRestarted(
  projectId: string,
  name: string,
): Promise<void> {
  await sendSystemMessage(
    projectId,
    `에이전트 "${name}"이(가) 재시작되었습니다.`,
  );
}
