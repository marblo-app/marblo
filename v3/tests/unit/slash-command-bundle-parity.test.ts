/**
 * Slash-command menu ↔ packaged harness drift guard.
 *
 * electron-builder copies only `.claude/commands/tf-*.md` into the packaged
 * app's `Resources/bundled-harness/commands`. The sidebar and guide derive
 * their command list from `SLASH_COMMANDS`, so these two sets must stay equal:
 * a menu-only command fails for new users, and a bundle-only command is hidden.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { SLASH_COMMANDS } from "../../src/components/orchestrator/SlashCommandPopup";

function bundledTfCommands(): string[] {
  const repoRoot = path.resolve(__dirname, "../../..");
  const commandsDir = path.join(repoRoot, ".claude", "commands");

  return fs
    .readdirSync(commandsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^tf-.+\.md$/.test(entry.name))
    .map((entry) => `/${entry.name.replace(/\.md$/, "")}`)
    .sort();
}

describe("slash command bundle parity", () => {
  it("shows exactly the tf commands packaged for new users", () => {
    const menuCommands = SLASH_COMMANDS.map((command) => command.command).sort();

    expect(new Set(menuCommands).size).toBe(menuCommands.length);
    expect(menuCommands).toEqual(bundledTfCommands());
  });
});
