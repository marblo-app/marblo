import { create } from "zustand";
import type { ChatMessage } from "../types/chat";
import * as chatService from "../services/chatService";

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  unreadCount: number;
  // 사이드바 CHAT 패널이 현재 보이는지 (Sidebar 가 동기화). 미읽음 배지는
  // 패널이 닫혀 있을 때 도착한 메시지만 세야 하므로 이 플래그로 게이트한다.
  chatPanelOpen: boolean;

  subscribeToMessages: (projectId: string) => () => void;
  sendMessage: (
    projectId: string,
    userId: string,
    userName: string,
    userPhotoURL: string,
    content: string,
  ) => Promise<void>;
  incrementUnread: (by?: number) => void;
  resetUnread: () => void;
  setChatPanelOpen: (open: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  loading: false,
  unreadCount: 0,
  chatPanelOpen: false,

  subscribeToMessages: (projectId: string) => {
    if (!projectId) {
      set({ messages: [], loading: false });
      return () => {};
    }
    set({ loading: true });

    // Firestore 에러 시 loading이 영원히 true인 것 방지 — 5초 타임아웃
    const timeout = setTimeout(() => {
      set((s) => (s.loading ? { loading: false } : s));
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
    await chatService.sendUserMessage(
      projectId,
      userId,
      userName,
      userPhotoURL,
      content,
    );
  },

  incrementUnread: (by = 1) =>
    set((s) => ({ unreadCount: s.unreadCount + by })),
  resetUnread: () => set({ unreadCount: 0 }),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
}));
