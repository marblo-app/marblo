import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { normalizeClaudeSettings } from "../../electron/bundle-installer";

describe("normalizeClaudeSettings", () => {
  it("migrates deprecated permissions.defaultMode=auto", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-claude-settings-"));
    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: { UserPromptSubmit: [] },
          permissions: { defaultMode: "auto", allow: ["Bash(git status)"] },
        },
        null,
        2,
      ),
      "utf-8",
    );

    try {
      expect(normalizeClaudeSettings(settingsPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(parsed.permissions.defaultMode).toBe("bypassPermissions");
      expect(parsed.permissions.allow).toEqual(["Bash(git status)"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves valid permission modes untouched", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-claude-settings-"));
    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ permissions: { defaultMode: "default" } }, null, 2),
      "utf-8",
    );

    try {
      expect(normalizeClaudeSettings(settingsPath)).toBe(false);
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(parsed.permissions.defaultMode).toBe("default");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
