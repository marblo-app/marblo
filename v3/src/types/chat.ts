export type ChatMessageType = 'user' | 'system' | 'agent';

export interface ChatMessage {
  id: string;
  projectId: string;
  type: ChatMessageType;
  senderId: string;       // user.uid or agentId or 'system'
  senderName: string;
  senderPhotoURL: string;
  content: string;
  taskId?: string;        // agent 알림에서 태스크 링크
  taskTitle?: string;
  createdAt: Date;
}

export interface TaskComment {
  id: string;
  taskId: string;
  projectId: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string;
  content: string;
  createdAt: Date;
}
