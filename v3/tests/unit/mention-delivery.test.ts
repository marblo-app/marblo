import { describe, expect, it } from "vitest";
import { mentionDeliveryStateFor } from "../../src/lib/mentionDelivery";

describe("team-chat @mention delivery state", () => {
  it("orchestrator durable fallback is unknown, never unavailable", () => {
    expect(mentionDeliveryStateFor("remote-queue")).toBe("unknown");
    expect(mentionDeliveryStateFor("remote-queue")).not.toBe("unavailable");
  });

  it("a failed local PTY write reports an unavailable local listener", () => {
    expect(mentionDeliveryStateFor("local-listener-unavailable")).toBe(
      "unavailable",
    );
  });

  it("a remote agent queue cannot verify its listener", () => {
    expect(mentionDeliveryStateFor("remote-queue")).toBe("unknown");
  });

  it("a committed local PTY write is available", () => {
    expect(mentionDeliveryStateFor("local-delivery")).toBe("available");
  });
});
