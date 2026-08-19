/**
 * 로컬 소형(chat-only) 스폰 — MCP/툴 스키마 비주입.
 *
 * 실측: qwen2.5:0.5b + tools/system(tool 강제) → tool_use JSON 흉내.
 * `--tools ""` + 빈 mcpServers + role-skill 생략으로 대화모드 회복.
 */
import { describe, it, expect } from "vitest";
import {
  LOCAL_CHAT_ONLY_SYSTEM_PROMPT,
  localChatOnlyClaudeArgExtras,
} from "../../electron/agent-config";
import {
  isLocalChatOnlyModel,
  resolveLocalToolSupport,
} from "../../electron/local-models";

describe("local chat-only spawn flags", () => {
  it("argv extras disable tools and replace system with chat prompt", () => {
    const extras = localChatOnlyClaudeArgExtras();
    expect(extras).toContain("--tools");
    expect(extras[extras.indexOf("--tools") + 1]).toBe("");
    expect(extras).toContain("--bare");
    expect(extras).toContain("--system-prompt");
    expect(extras).toContain(LOCAL_CHAT_ONLY_SYSTEM_PROMPT);
    expect(extras).toContain("--disable-slash-commands");
    expect(LOCAL_CHAT_ONLY_SYSTEM_PROMPT.toLowerCase()).toContain("do not call tools");
  });

  it("7b coder is chat-only; 32b coder keeps tool-use", () => {
    expect(isLocalChatOnlyModel("qwen2.5:0.5b")).toBe(true);
    expect(resolveLocalToolSupport("qwen2.5-coder:7b")).toBe("chat-only");
    expect(isLocalChatOnlyModel("qwen2.5-coder:7b")).toBe(true);
    expect(resolveLocalToolSupport("qwen2.5-coder:32b")).toBe("tool-use");
    expect(isLocalChatOnlyModel("qwen2.5-coder:32b")).toBe(false);
  });
});
