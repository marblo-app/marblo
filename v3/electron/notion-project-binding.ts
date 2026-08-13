import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type NotionBindingKind = "database" | "page";

export interface NotionProjectBinding {
  projectId: string;
  objectId: string;
  objectKind: NotionBindingKind;
  title: string | null;
  updatedAt: number;
}

export interface NotionProjectBindingInput {
  projectId: string;
  objectId: string;
  objectKind: NotionBindingKind;
  title?: string | null;
}

const NOTION_ID_RE =
  /^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_TITLE = 200;
const DEFAULT_STORE_DIR = path.join(os.homedir(), ".marblo");
const DEFAULT_STORE_FILE = "notion-project-bindings.json";
const FILE_MODE = 0o600;

type StoredBindings = Record<string, NotionProjectBinding>;

export function isValidNotionObjectId(value: unknown): value is string {
  return typeof value === "string" && NOTION_ID_RE.test(value.trim());
}

export function normalizeNotionObjectId(id: string): string {
  return id.trim();
}

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TITLE);
}

function readJsonMap<T>(filePath: string): Record<string, T> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, T>;
    }
  } catch {
    // Missing or malformed store means no bindings.
  }
  return {};
}

function atomicWriteJson(filePath: string, data: unknown, mode: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode,
  });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, mode);
}

export class NotionProjectBindingStore {
  private readonly filePath: string;

  constructor(opts?: { storeDir?: string }) {
    this.filePath = path.join(
      opts?.storeDir ?? DEFAULT_STORE_DIR,
      DEFAULT_STORE_FILE,
    );
  }

  getFilePath(): string {
    return this.filePath;
  }

  private readRaw(): Record<string, unknown> {
    return readJsonMap<unknown>(this.filePath);
  }

  private readStored(): StoredBindings {
    const out: StoredBindings = {};
    for (const [projectId, raw] of Object.entries(this.readRaw())) {
      if (!projectId || !raw || typeof raw !== "object") continue;
      const value = raw as Partial<NotionProjectBinding>;
      if (!isValidNotionObjectId(value.objectId)) continue;
      if (value.objectKind !== "database" && value.objectKind !== "page") {
        continue;
      }
      out[projectId] = {
        projectId,
        objectId: normalizeNotionObjectId(value.objectId),
        objectKind: value.objectKind,
        title: normalizeTitle(value.title),
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
      };
    }
    return out;
  }

  get(projectId: string): NotionProjectBinding | null {
    if (!projectId) return null;
    return this.readStored()[projectId] ?? null;
  }

  list(): NotionProjectBinding[] {
    return Object.values(this.readStored());
  }

  set(input: NotionProjectBindingInput): NotionProjectBinding {
    const projectId = input.projectId.trim();
    if (!projectId) throw new Error("projectId 가 필요합니다.");
    if (!isValidNotionObjectId(input.objectId)) {
      throw new Error(
        "Notion 페이지/데이터베이스 id 형식이 올바르지 않습니다.",
      );
    }
    if (input.objectKind !== "database" && input.objectKind !== "page") {
      throw new Error("Notion 바인딩 종류는 page 또는 database 여야 합니다.");
    }
    const all = this.readRaw();
    const record: NotionProjectBinding = {
      projectId,
      objectId: normalizeNotionObjectId(input.objectId),
      objectKind: input.objectKind,
      title: normalizeTitle(input.title),
      updatedAt: Date.now(),
    };
    all[projectId] = record;
    atomicWriteJson(this.filePath, all, FILE_MODE);
    return record;
  }

  clear(projectId: string): boolean {
    const all = this.readRaw();
    if (!(projectId in all)) return false;
    delete all[projectId];
    atomicWriteJson(this.filePath, all, FILE_MODE);
    return true;
  }
}

let _defaultStore: NotionProjectBindingStore | null = null;

export function getNotionProjectBindingStore(): NotionProjectBindingStore {
  if (!_defaultStore) _defaultStore = new NotionProjectBindingStore();
  return _defaultStore;
}

export function _setDefaultNotionProjectBindingStore(
  store: NotionProjectBindingStore | null,
): void {
  _defaultStore = store;
}

export function getNotionProjectBinding(
  projectId: string,
): NotionProjectBinding | null {
  return getNotionProjectBindingStore().get(projectId);
}

export function setNotionProjectBinding(
  input: NotionProjectBindingInput,
): NotionProjectBinding {
  return getNotionProjectBindingStore().set(input);
}

export function clearNotionProjectBinding(projectId: string): boolean {
  return getNotionProjectBindingStore().clear(projectId);
}

export function listNotionProjectBindings(): NotionProjectBinding[] {
  return getNotionProjectBindingStore().list();
}
