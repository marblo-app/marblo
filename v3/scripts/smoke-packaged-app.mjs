#!/usr/bin/env node
import { _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(repoRoot, "dist");
const appArg = process.env.MARBLO_PACKAGED_APP || process.argv[2];
const timeoutMs = Number(
  process.env.MARBLO_PACKAGED_SMOKE_TIMEOUT_MS || 45_000,
);

function findPackagedApp() {
  if (appArg) return path.resolve(appArg);
  if (process.platform !== "darwin") {
    throw new Error("MARBLO_PACKAGED_APP is required on non-macOS platforms.");
  }
  const queue = [distDir];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app")) return fullPath;
      if (entry.isDirectory()) queue.push(fullPath);
    }
  }
  throw new Error(`No .app bundle found under ${distDir}`);
}

function executableForApp(appPath) {
  if (process.platform !== "darwin" || !appPath.endsWith(".app")) {
    return appPath;
  }
  const macOsDir = path.join(appPath, "Contents", "MacOS");
  const candidates = fs
    .readdirSync(macOsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(macOsDir, entry.name));
  const executable = candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!executable) {
    throw new Error(`No executable found in ${macOsDir}`);
  }
  return executable;
}

const appPath = findPackagedApp();
const executablePath = executableForApp(appPath);
const userDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "marblo-packaged-smoke-"),
);
const consoleMessages = [];
const pageErrors = [];

console.log(`[packaged-smoke] app=${appPath}`);
console.log(`[packaged-smoke] executable=${executablePath}`);

const app = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    MARBLO_TEST_BYPASS_AUTH: "1",
    MARBLO_TEST_MODE: "smoke",
  },
  args: [`--user-data-dir=${userDataDir}`],
  timeout: timeoutMs,
});

try {
  const page = await app.firstWindow({ timeout: timeoutMs });
  page.on("console", (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
  });

  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  await page.waitForFunction(
    () => document.body && document.body.children.length > 0,
    undefined,
    { timeout: timeoutMs },
  );

  const result = await page.evaluate(() => {
    const api = window.electronAPI;
    return {
      href: window.location.href,
      title: document.title,
      bodyTextLength: document.body?.innerText?.trim().length ?? 0,
      rootChildCount:
        document.querySelector("#root")?.childElementCount ??
        document.body?.children.length ??
        0,
      hasElectronAPI: typeof api === "object" && api !== null,
      hasCoreBridges:
        typeof api?.pty?.create === "function" &&
        typeof api?.agent?.launch === "function" &&
        typeof api?.window?.isNewWindow === "function",
      bypassAuth: api?.testMode?.bypassAuth === true,
    };
  });

  if (!result.hasElectronAPI) {
    throw new Error("window.electronAPI is not exposed.");
  }
  if (!result.hasCoreBridges) {
    throw new Error("window.electronAPI core bridge methods are missing.");
  }
  if (result.rootChildCount < 1 || result.bodyTextLength < 1) {
    throw new Error("Renderer booted to an empty/white screen.");
  }
  if (pageErrors.length > 0) {
    throw new Error(`Renderer page errors:\n${pageErrors.join("\n\n")}`);
  }

  console.log("[packaged-smoke] PASS");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("[packaged-smoke] FAIL");
  console.error(error instanceof Error ? error.stack || error.message : error);
  if (consoleMessages.length > 0) {
    console.error("[packaged-smoke] recent console output:");
    for (const line of consoleMessages.slice(-25)) console.error(line);
  }
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
