import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * drive-project-binding — "이 프로젝트의 위키 = Drive 폴더 X" 의 단일 진실원.
 * 티켓 MCTHALmNAWPpilTFwe8o.
 *
 * ── ★축 분리 (이 파일이 존재하는 유일한 이유) ─────────────────────────────
 * Drive 연결에는 서로 다른 수명·서로 다른 주인을 가진 **두 축**이 있다.
 *
 *   1. **인증 = 유저 단위.** OAuth refresh/access 토큰은 "이 사람이 자기 구글
 *      계정을 이 기기에 붙였다" 는 사실이다. 프로젝트가 열 개여도 동의는 한 번이고,
 *      저장소는 `google-drive-token-store.ts`(safeStorage 암호화) 다.
 *   2. **지식 바인딩 = 프로젝트 단위.** "이 프로젝트의 위키는 저 폴더" 는 프로젝트의
 *      성질이다. 프로젝트 A 의 에이전트가 프로젝트 B 의 폴더를 읽으면 그건 지식
 *      오염이고, 위키로서 신뢰를 잃는다.
 *
 * 이 두 축을 한 레코드에 섞으면(예: 토큰 옆에 folderId 를 같이 둠) 프로젝트를
 * 추가할 때마다 재동의가 필요하거나, 반대로 모든 프로젝트가 같은 폴더를 보게 된다.
 * 그래서 **저장소를 분리**한다 — 토큰은 유저 키, 바인딩은 프로젝트 키.
 *
 * ── 저장 패턴 ────────────────────────────────────────────────────────────
 * `slack-channels.ts` / `telegram-channels.ts` 와 동일한 로컬 JSON 저장소다
 * (새 패턴 발명 금지): projectId 키 맵 + tmp→rename 원자 교체 + 읽기는 절대
 * throw 안 함 + storeDir 주입으로 테스트 격리.
 *
 * ★이 파일에는 시크릿이 없다. folderId/폴더명은 비밀이 아니고(Drive 링크에 그대로
 * 노출되는 값), 토큰은 이 모듈이 아예 모른다. 그래서 safeStorage 를 쓰지 않는다 —
 * 암호화가 불가능한 환경에서 조용히 평문으로 강등되는 경로 자체를 만들지 않는 게
 * 낫다. 파일 권한만 0600 으로 좁힌다(어느 프로젝트가 어느 폴더를 보는지는
 * 남에게 알릴 이유가 없는 사생활이다).
 */

// ─── 타입 ─────────────────────────────────────────────────────────────

/** "이 프로젝트의 위키 = 이 Drive 폴더" 레코드. */
export interface DriveProjectBinding {
  /** 1차 키 — Marblo 프로젝트 id. */
  projectId: string;
  /** 바인딩된 Drive 폴더 id. */
  folderId: string;
  /** 폴더 표시명(UI 전용 캐시). Drive 에서 이름이 바뀌면 낡을 수 있다. */
  folderName: string | null;
  /** 마지막 갱신 epoch ms. */
  updatedAt: number;
}

/** set 입력 — projectId·folderId 필수. */
export interface DriveProjectBindingInput {
  projectId: string;
  folderId: string;
  folderName?: string | null;
}

/**
 * Drive 폴더 id 로 받아들일 형태.
 *
 * Drive 의 file id 는 문서화된 고정 문법이 없다(길이도 계정·생성 시기에 따라
 * 다르다). 그래서 "정확한 id 문법" 을 흉내내는 대신 **주입 안전성**만 본다:
 * 쿼리 리터럴을 깨거나 경로/URL 로 해석될 수 있는 문자를 전부 배제한다.
 * 커넥터의 `escapeDriveQueryValue` 가 2차 방어선이지만, 애초에 저장 단계에서
 * 이상한 값이 들어오지 않게 막는 게 싸다.
 */
const FOLDER_ID_RE = /^[A-Za-z0-9_-]{8,256}$/;

/** 이 값이 폴더 id 로 저장 가능한 형태인가. */
export function isValidDriveFolderId(value: unknown): value is string {
  return typeof value === "string" && FOLDER_ID_RE.test(value);
}

/** 폴더명 표시 상한 — UI 캐시일 뿐이라 길이만 자른다. */
const MAX_FOLDER_NAME = 200;

function normalizeFolderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FOLDER_NAME);
}

// ─── 경로/저장 ────────────────────────────────────────────────────────

const DEFAULT_STORE_DIR = path.join(os.homedir(), ".marblo");
const DEFAULT_STORE_FILE = "drive-project-bindings.json";
/** 소유자 read/write 만(0600) — 형제 저장소들과 동일. */
const FILE_MODE = 0o600;

type StoredBindings = Record<string, DriveProjectBinding>;

/** JSON 맵 읽기 — 파일 없음/깨짐이면 빈 맵(절대 throw 안 함). */
function readJsonMap<T>(filePath: string): Record<string, T> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, T>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * JSON 을 tmp→rename 으로 원자 교체하며 권한을 mode 로 고정한다
 * (slack-channels.atomicWriteJson 과 동일 — 같은 규율, 같은 형태).
 */
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

function now(): number {
  return Date.now();
}

// ─── 스토어 ───────────────────────────────────────────────────────────

/**
 * 프로젝트↔Drive 폴더 바인딩의 로컬 단일 진실원. 테스트는 storeDir 을 주입해
 * 격리한다(SlackChannelStore 와 동일 패턴).
 */
export class DriveProjectBindingStore {
  private readonly filePath: string;

  constructor(opts?: { storeDir?: string }) {
    this.filePath = path.join(
      opts?.storeDir ?? DEFAULT_STORE_DIR,
      DEFAULT_STORE_FILE,
    );
  }

  /** 저장 파일 절대경로(진단용). */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * 디스크의 **원본** 맵. 쓰기 경로가 이걸 기반으로 병합한다.
   *
   * ★읽기용(readStored)과 쓰기용(readRaw)을 나눈 이유: 읽기는 깨진 항목을
   * 버려야 안전하지만, 쓰기까지 버린 결과를 기반으로 하면 **프로젝트 A 가 저장할
   * 때 프로젝트 B 의 깨진 레코드가 영구 삭제된다**. 격리를 목적으로 하는
   * 저장소가 프로젝트 간 쓰기 결합을 만드는 셈이라, 남의 칸은 손대지 않는다.
   */
  private readRaw(): Record<string, unknown> {
    return readJsonMap<unknown>(this.filePath);
  }

  private readStored(): StoredBindings {
    const out: StoredBindings = {};
    for (const [projectId, raw] of Object.entries(this.readRaw())) {
      if (!projectId || !raw || typeof raw !== "object") continue;
      const value = raw as Partial<DriveProjectBinding>;
      // 깨진/변조된 항목은 조용히 버린다 — 미바인딩과 같은 취급이 안전하다
      // (잘못된 folderId 로 스코프를 잡느니 "폴더를 고르라" 고 말하는 게 낫다).
      if (!isValidDriveFolderId(value.folderId)) continue;
      out[projectId] = {
        projectId,
        folderId: value.folderId,
        folderName: normalizeFolderName(value.folderName),
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
      };
    }
    return out;
  }

  /** projectId 의 바인딩, 없으면 null. (읽기 — 절대 throw 안 함.) */
  get(projectId: string): DriveProjectBinding | null {
    if (!projectId) return null;
    return this.readStored()[projectId] ?? null;
  }

  /** 모든 바인딩. */
  list(): DriveProjectBinding[] {
    return Object.values(this.readStored());
  }

  /**
   * 바인딩 저장(덮어쓰기). 형태가 틀리면 저장하지 않고 throw 한다 — 조용히
   * 무시하면 UI 는 "저장됨" 을 표시하는데 에이전트는 계속 미바인딩을 보게 된다.
   */
  set(input: DriveProjectBindingInput): DriveProjectBinding {
    const projectId = (input.projectId ?? "").trim();
    if (!projectId) throw new Error("projectId 가 필요합니다.");
    if (!isValidDriveFolderId(input.folderId)) {
      throw new Error("Drive 폴더 id 형식이 올바르지 않습니다.");
    }
    // 원본 맵 위에 내 칸만 얹는다 — 다른 프로젝트의 항목은 읽지도, 고치지도,
    // 지우지도 않는다(깨져 있더라도 그건 그 프로젝트의 문제다).
    const all = this.readRaw();
    const record: DriveProjectBinding = {
      projectId,
      folderId: input.folderId,
      folderName: normalizeFolderName(input.folderName),
      updatedAt: now(),
    };
    all[projectId] = record;
    atomicWriteJson(this.filePath, all, FILE_MODE);
    return record;
  }

  /** 바인딩 삭제(멱등). 있었으면 true. */
  clear(projectId: string): boolean {
    const all = this.readRaw();
    if (!(projectId in all)) return false;
    delete all[projectId];
    atomicWriteJson(this.filePath, all, FILE_MODE);
    return true;
  }
}

// ─── 기본 싱글톤 + 모듈 레벨 편의 함수 ────────────────────────────────

let _defaultStore: DriveProjectBindingStore | null = null;

/** 프로세스 공유 기본 store(~/.marblo/drive-project-bindings.json). */
export function getDriveProjectBindingStore(): DriveProjectBindingStore {
  if (!_defaultStore) _defaultStore = new DriveProjectBindingStore();
  return _defaultStore;
}

/** 테스트 훅 — 기본 store 주입/리셋. */
export function _setDefaultDriveProjectBindingStore(
  store: DriveProjectBindingStore | null,
): void {
  _defaultStore = store;
}

export function getDriveProjectBinding(
  projectId: string,
): DriveProjectBinding | null {
  return getDriveProjectBindingStore().get(projectId);
}

export function setDriveProjectBinding(
  input: DriveProjectBindingInput,
): DriveProjectBinding {
  return getDriveProjectBindingStore().set(input);
}

export function clearDriveProjectBinding(projectId: string): boolean {
  return getDriveProjectBindingStore().clear(projectId);
}

export function listDriveProjectBindings(): DriveProjectBinding[] {
  return getDriveProjectBindingStore().list();
}
