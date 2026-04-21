import { create } from 'zustand';
import type { ChatMessage } from '../types/chat';
import * as chatService from '../services/chatService';

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  unreadCount: number;

  subscribeToMessages: (projectId: string) => () => void;
  sendMessage: (
    projectId: string,
    userId: string,
    userName: string,
    userPhotoURL: string,
    content: string,
  ) => Promise<void>;
  incrementUnread: () => void;
  resetUnread: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  loading: false,
  unreadCount: 0,

  subscribeToMessages: (projectId: string) => {
    if (!projectId) {
      set({ messages: [], loading: false });
      return () => {};
    }
    set({ loading: true });

    // Firestore 에러 시 loading이 영원히 true인 것 방지 — 5초 타임아웃
    const timeout = setTimeout(() => {
      set((s) => s.loading ? { loading: false } : s);
    }, 5000);

    const unsub = chatService.subscribeToMessages(projectId, (messages) => {
      clearTimeout(timeout);
      set((state) => {
        const isInitialLoad = state.loading;
        return {
          messages,
          loading: false,
          unreadCount: isInitialLoad ? 0 : state.unreadCount,
        };
      });
    });

    return () => {
      clearTimeout(timeout);
      unsub();
    };
  },

  sendMessage: async (projectId, userId, userName, userPhotoURL, content) => {
    await chatService.sendUserMessage(projectId, userId, userName, userPhotoURL, content);
  },

  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  resetUnread: () => set({ unreadCount: 0 }),
}));
