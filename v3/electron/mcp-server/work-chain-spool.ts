/**
 * Durable, local fallback for work-chain writes.
 *
 * `workChains` can be unavailable precisely while it is most useful (for
 * example before its Firestore rule has been deployed).  Keep the intent on
 * disk so the next successful write/startup can replay it; never claim that
 * the chain write itself succeeded.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NewWorkChainItemInput, WorkChainItem } from "./work-chain-core.js";

export type WorkChainSpoolEntry =
  | { kind: "add"; projectId: string; by: string; item: WorkChainItem; position?: number }
  | { kind: "update"; projectId: string; by: string; itemId: string; input: Record<string, unknown> };

interface WorkChainSpoolFile { version: 1; entries: WorkChainSpoolEntry[] }

function spoolPath(): string {
  return process.env.MARBLO_WORK_CHAIN_SPOOL_PATH || path.join(os.homedir(), ".marblo", "work-chain-spool.json");
}

async function read(): Promise<WorkChainSpoolFile> {
  try {
    const raw = await fs.readFile(spoolPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkChainSpoolFile>;
    return parsed.version === 1 && Array.isArray(parsed.entries) ? { version: 1, entries: parsed.entries } : { version: 1, entries: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: [] };
    throw error;
  }
}

async function write(file: WorkChainSpoolFile): Promise<void> {
  const target = spoolPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(file), { mode: 0o600 });
  await fs.rename(temporary, target);
}

export async function enqueueWorkChainFallback(entry: WorkChainSpoolEntry): Promise<void> {
  const file = await read();
  file.entries.push(entry);
  await write(file);
}

export async function takeWorkChainFallbacks(): Promise<WorkChainSpoolEntry[]> {
  return (await read()).entries;
}

export async function replaceWorkChainFallbacks(entries: WorkChainSpoolEntry[]): Promise<void> {
  if (entries.length === 0) {
    await fs.rm(spoolPath(), { force: true });
    return;
  }
  await write({ version: 1, entries });
}

export function addFallbackEntry(projectId: string, by: string, item: WorkChainItem, position?: number): WorkChainSpoolEntry {
  return { kind: "add", projectId, by, item, ...(position === undefined ? {} : { position }) };
}

export function updateFallbackEntry(projectId: string, by: string, itemId: string, input: Record<string, unknown>): WorkChainSpoolEntry {
  return { kind: "update", projectId, by, itemId, input };
}
