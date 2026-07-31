/**
 * Registry install ledger — "무엇을, 어느 커밋에서, 어디에 설치했나"의 유일한
 * 진실 소스 (설계 §4.5).
 *
 * uninstall 은 **이 원장 기반으로만** 동작한다(§4.4 rule 7) — 설치 후 편집된
 * manifest 가 삭제 경로를 다른 곳으로 돌릴 수 없다. detectStatus() 류의
 * 파일시스템 재유도로는 "어느 레지스트리 항목이, 갱신 가능한가, 로컬 수정이
 * 있나"를 답할 수 없어서 원장이 별도로 존재한다.
 *
 * 손상된 원장은 절대 스토어를 죽이지 않는다: 격리(.corrupt-<ts> 로 rename) 후
 * 빈 원장으로 시작한다. 쓰기는 temp+rename atomic(writeClaudeJsonAtomic 과
 * 같은 패턴).
 */
import fs from "fs";
import path from "path";

export interface LedgerFileEntry {
  path: string;
  sha256: string;
}

export interface LedgerInstallRecord {
  kind: "files" | "mcp-server";
  root?: string;
  dest?: string;
  mcpKey?: string;
}

export interface LedgerEntry {
  manifestVersion: string;
  /** 설치 페이로드를 받은 레지스트리 커밋. */
  commit: string;
  /** community source-fetch 전용: 설치 바이트를 받은 3자 repo 와 pinned ref. */
  sourceRepository?: string;
  sourceRef?: string;
  install: LedgerInstallRecord;
  /** kind=files 전용: 설치 시점에 실제로 쓴 파일과 해시 — 삭제는 이 목록만. */
  files?: LedgerFileEntry[];
  permissionsGranted: string[];
  installedAt: string;
  installedByMarbloVersion?: string;
}

export interface RegistryLedger {
  schema_version: 1;
  items: Record<string, LedgerEntry>;
}

const EMPTY_LEDGER: RegistryLedger = { schema_version: 1, items: {} };

export function registryLedgerPath(userDataDir: string): string {
  return path.join(userDataDir, "registry-installs.json");
}

export function readLedger(filePath: string): RegistryLedger {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return structuredClone(EMPTY_LEDGER);
  }
  try {
    const parsed = JSON.parse(raw) as RegistryLedger;
    if (
      !parsed ||
      parsed.schema_version !== 1 ||
      typeof parsed.items !== "object" ||
      parsed.items === null ||
      Array.isArray(parsed.items)
    ) {
      throw new Error("ledger shape invalid");
    }
    return parsed;
  } catch {
    // 격리 후 빈 원장 — 크래시 금지(§8 "corrupt ledger → quarantine + rebuild").
    try {
      fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      console.warn(`[registry] 손상된 원장 격리: ${filePath}`);
    } catch {
      /* 격리 실패는 무시 — 다음 쓰기가 덮는다 */
    }
    return structuredClone(EMPTY_LEDGER);
  }
}

export function writeLedger(filePath: string, ledger: RegistryLedger): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}
