import { describe, expect, it } from "vitest";
import {
  getMessagesAfterWatermark,
  readChatReadWatermark,
  writeChatReadWatermark,
  type ChatWatermarkStorage,
} from "../../src/stores/chatReadWatermark";
import type { ChatMessage } from "../../src/types/chat";

function message(id: string, createdAt: string): ChatMessage {
  return {
    id,
    projectId: "project-1",
    type: "user",
    senderId: "user-1",
    senderName: "User",
    senderPhotoURL: "",
    content: `message ${id}`,
    createdAt: new Date(createdAt),
  };
}

function memoryStorage(): ChatWatermarkStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("chat read watermark", () => {
  it("returns only messages after the saved message id", () => {
    const messages = [
      message("a", "2026-08-01T00:00:00.000Z"),
      message("b", "2026-08-01T00:01:00.000Z"),
      message("c", "2026-08-01T00:02:00.000Z"),
    ];

    expect(
      getMessagesAfterWatermark(messages, {
        messageId: "b",
        timestamp: messages[1].createdAt.getTime(),
      }).map((msg) => msg.id),
    ).toEqual(["c"]);
  });

  it("falls back to timestamp when the saved message is not in the snapshot", () => {
    const messages = [
      message("b", "2026-08-01T00:01:00.000Z"),
      message("c", "2026-08-01T00:02:00.000Z"),
    ];

    expect(
      getMessagesAfterWatermark(messages, {
        messageId: "a",
        timestamp: new Date("2026-08-01T00:01:30.000Z").getTime(),
      }).map((msg) => msg.id),
    ).toEqual(["c"]);
  });

  it("persists and advances the latest read message for a project channel", () => {
    const storage = memoryStorage();
    const first = message("a", "2026-08-01T00:00:00.000Z");
    const next = message("b", "2026-08-01T00:01:00.000Z");

    writeChatReadWatermark(storage, "project-1", first);
    expect(readChatReadWatermark(storage, "project-1")).toEqual({
      messageId: "a",
      timestamp: first.createdAt.getTime(),
    });

    writeChatReadWatermark(storage, "project-1", next);
    expect(readChatReadWatermark(storage, "project-1")).toEqual({
      messageId: "b",
      timestamp: next.createdAt.getTime(),
    });
  });

  it("does not move the watermark backward", () => {
    const storage = memoryStorage();
    const first = message("a", "2026-08-01T00:00:00.000Z");
    const next = message("b", "2026-08-01T00:01:00.000Z");

    writeChatReadWatermark(storage, "project-1", next);
    writeChatReadWatermark(storage, "project-1", first);

    expect(readChatReadWatermark(storage, "project-1")).toEqual({
      messageId: "b",
      timestamp: next.createdAt.getTime(),
    });
  });
});
