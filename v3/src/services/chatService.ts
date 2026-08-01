import { where, type Unsubscribe } from "firebase/firestore";
import type { ChatMessage, ChatMessageType } from "../types/chat";
import {
  createDocument,
  subscribeToCollection,
  toTimestamp,
  convertTimestamps,
} from "./firestore";
import telemetry from "./telemetryService";
import { recordProjectAuditEvent } from "./projectAuditService";
import { chatAuditMetadata } from "../lib/projectAudit";

const COLLECTION = "chatMessages";
const DATE_FIELDS = ["createdAt"];

function toChatMessage(raw: Record<string, unknown>): ChatMessage {
  return convertTimestamps<ChatMessage>(raw, DATE_FIELDS);
}

export async function sendMessage(
  projectId: string,
  type: ChatMessageType,
  senderId: string,
  senderName: string,
  senderPhotoURL: string,
  content: string,
  taskId?: string,
  taskTitle?: string,
): Promise<string> {
  const messageId = await createDocument(COLLECTION, {
    projectId,
    type,
    senderId,
    senderName,
    senderPhotoURL,
    content,
    ...(taskId && { taskId }),
    ...(taskTitle && { taskTitle }),
    createdAt: toTimestamp(new Date()),
  });
  telemetry.chatMessageSent(projectId, type, senderId);

  // 감사 귀속은 **사람이 보낸 메시지만** 남긴다(type === 'user').
  //
  // ★system/agent 메시지를 제외하는 건 누락이 아니라 오귀속 방지다: 그 둘의
  // senderId 는 uid 가 아니라 라벨('system' / agentName)이고, 여기서 감사를
  // 남기면 actorUid 가 **그 메시지를 릴레이한 앱의 로그인 사용자**로 찍힌다 —
  // 에이전트가 한 말이 사람이 한 것처럼 기록된다. 감사에서 가장 나쁜 종류의
  // 오류(판별 불가한 것을 확실한 것처럼 보이게 만들기)라 명시적으로 뺐다.
  // 에이전트 행위는 이미 `audit_logs` 원장이 잡는다.
  if (type === "user") {
    recordProjectAuditEvent({
      projectId,
      actorUid: senderId, // type==='user' 면 senderId === auth uid (룰이 강제)
      actorName: senderName,
      type: "chat.message.sent",
      taskId: taskId ?? null,
      targetId: messageId,
      metadata: chatAuditMetadata(type, content),
    });
  }
  return messageId;
}

export async function sendUserMessage(
  projectId: string,
  userId: string,
  userName: string,
  userPhotoURL: string,
  content: string,
): Promise<string> {
  return sendMessage(
    projectId,
    "user",
    userId,
    userName,
    userPhotoURL,
    content,
  );
}

export async function sendSystemMessage(
  projectId: string,
  content: string,
): Promise<string> {
  return sendMessage(projectId, "system", "system", "System", "", content);
}

export async function sendAgentMessage(
  projectId: string,
  agentName: string,
  content: string,
  taskId?: string,
  taskTitle?: string,
): Promise<string> {
  return sendMessage(
    projectId,
    "agent",
    agentName,
    agentName,
    "",
    content,
    taskId,
    taskTitle,
  );
}

export function subscribeToMessages(
  projectId: string,
  callback: (messages: ChatMessage[]) => void,
): Unsubscribe {
  // orderBy 제거 — Firestore 복합 인덱스 없이도 동작하도록 클라이언트 정렬
  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    [where("projectId", "==", projectId)],
    (docs) => {
      const messages = docs
        .map(toChatMessage)
        .sort((a, b) => +a.createdAt - +b.createdAt)
        .slice(-200);
      callback(messages);
    },
  );
}
