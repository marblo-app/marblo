import type { ChatMessage } from "../types/chat";

const STORAGE_PREFIX = "marblo:chat:last-read";
const DEFAULT_CHANNEL_ID = "team";

export interface ChatReadWatermark {
  messageId: string | null;
  timestamp: number;
}

export type ChatWatermarkStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

function storageKey(projectId: string, channelId = DEFAULT_CHANNEL_ID): string {
  return `${STORAGE_PREFIX}:${projectId}:${channelId}`;
}

function messageTime(message: ChatMessage): number {
  return message.createdAt instanceof Date ? message.createdAt.getTime() : 0;
}

function isLaterMessage(message: ChatMessage, watermark: ChatReadWatermark) {
  const time = messageTime(message);
  if (time > watermark.timestamp) return true;
  if (time < watermark.timestamp) return false;
  return watermark.messageId !== null && message.id !== watermark.messageId;
}

export function readChatReadWatermark(
  storage: ChatWatermarkStorage | null,
  projectId: string | null,
  channelId = DEFAULT_CHANNEL_ID,
): ChatReadWatermark | null {
  if (!storage || !projectId) return null;

  const raw = storage.getItem(storageKey(projectId, channelId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ChatReadWatermark>;
    if (typeof parsed.timestamp !== "number") return null;
    return {
      messageId: typeof parsed.messageId === "string" ? parsed.messageId : null,
      timestamp: parsed.timestamp,
    };
  } catch {
    storage.removeItem(storageKey(projectId, channelId));
    return null;
  }
}

export function writeChatReadWatermark(
  storage: ChatWatermarkStorage | null,
  projectId: string | null,
  message: ChatMessage | null,
  channelId = DEFAULT_CHANNEL_ID,
): ChatReadWatermark | null {
  if (!storage || !projectId || !message) return null;

  const current = readChatReadWatermark(storage, projectId, channelId);
  const next: ChatReadWatermark = {
    messageId: message.id,
    timestamp: messageTime(message),
  };

  if (
    current &&
    (current.timestamp > next.timestamp ||
      (current.timestamp === next.timestamp &&
        current.messageId === next.messageId))
  ) {
    return current;
  }

  storage.setItem(storageKey(projectId, channelId), JSON.stringify(next));
  return next;
}

export function getMessagesAfterWatermark(
  messages: ChatMessage[],
  watermark: ChatReadWatermark | null,
): ChatMessage[] {
  if (!watermark) return messages;

  const messageIndex = watermark.messageId
    ? messages.findIndex((message) => message.id === watermark.messageId)
    : -1;
  if (messageIndex >= 0) return messages.slice(messageIndex + 1);

  return messages.filter((message) => isLaterMessage(message, watermark));
}
