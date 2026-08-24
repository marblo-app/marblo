import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function sourceFiles(dir: string): string[] {
  const abs = path.join(root, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

describe("pty:writeAndSubmit IPC contract", () => {
  it("uses invoke/handle so renderer callers receive composer-gate refusals", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");

    expect(main).toContain('ipcMain.handle(\n  "pty:writeAndSubmit"');
    expect(main).not.toContain('ipcMain.on(\n  "pty:writeAndSubmit"');
    expect(preload).toContain('ipcRenderer.invoke("pty:writeAndSubmit"');
    expect(preload).not.toContain('ipcRenderer.send("pty:writeAndSubmit"');
  });

  it("keeps the renderer caller set explicit for refusal handling audits", () => {
    const expected = [
      "src/components/terminal/FeedbackInput.tsx",
      "src/components/sidebar/CommandPanel.tsx",
      "src/components/onboarding/FirstSpawnGuide.tsx",
      "src/services/cliSetupActions.ts",
    ];
    const callers = sourceFiles("src")
      .filter((file) =>
        read(file).includes("window.electronAPI.pty.writeAndSubmit"),
      )
      .sort();

    expect(callers).toEqual([...expected].sort());
  });
});
