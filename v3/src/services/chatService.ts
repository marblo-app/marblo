import { where, type Unsubscribe } from 'firebase/firestore';
import type { ChatMessage, ChatMessageType } from '../types/chat';
import {
  createDocument,
  subscribeToCollection,
  toTimestamp,
  convertTimestamps,
} from './firestore';
import telemetry from './telemetryService';

const COLLECTION = 'chatMessages';
const DATE_FIELDS = ['createdAt'];

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
  return messageId;
}

export async function sendUserMessage(
  projectId: string,
  userId: string,
  userName: string,
  userPhotoURL: string,
  content: string,
): Promise<string> {
  return sendMessage(projectId, 'user', userId, userName, userPhotoURL, content);
}

export async function sendSystemMessage(
  projectId: string,
  content: string,
): Promise<string> {
  return sendMessage(projectId, 'system', 'system', 'System', '', content);
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
    'agent',
    agentName,
    agentName,
    '',
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
    [where('projectId', '==', projectId)],
    (docs) => {
      const messages = docs
        .map(toChatMessage)
        .sort((a, b) => +a.createdAt - +b.createdAt)
        .slice(-200);
      callback(messages);
    },
  );
}
