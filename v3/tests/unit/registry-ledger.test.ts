/**
 * registry-ledger 스펙: atomic 쓰기 왕복, 손상 원장 격리(크래시 금지).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  readLedger,
  registryLedgerPath,
  writeLedger,
} from "../../electron/registry-ledger";

function tmpLedgerPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-ledger-"));
  return registryLedgerPath(dir);
}

describe("registry ledger", () => {
  it("missing file reads as an empty ledger", () => {
    const ledger = readLedger(tmpLedgerPath());
    expect(ledger).toEqual({ schema_version: 1, items: {} });
  });

  it("write/read roundtrip is stable", () => {
    const file = tmpLedgerPath();
    const ledger = readLedger(file);
    ledger.items["x"] = {
      manifestVersion: "1.0.0",
      commit: "c".repeat(40),
      install: { kind: "files", root: "claude-skills", dest: "x" },
      files: [{ path: "SKILL.md", sha256: "0".repeat(64) }],
      permissionsGranted: [],
      installedAt: new Date().toISOString(),
    };
    writeLedger(file, ledger);
    expect(readLedger(file)).toEqual(ledger);
    // atomic write: temp 파일이 남지 않는다.
    const leftovers = fs
      .readdirSync(path.dirname(file))
      .filter((n) => n.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("corrupt ledger is quarantined, never crashes the store", () => {
    const file = tmpLedgerPath();
    fs.writeFileSync(file, "{not json at all");
    const ledger = readLedger(file);
    expect(ledger).toEqual({ schema_version: 1, items: {} });
    const dir = path.dirname(file);
    expect(
      fs
        .readdirSync(dir)
        .some((n) => n.startsWith("registry-installs.json.corrupt-")),
    ).toBe(true);
    // 원본 자리는 비워져 다음 쓰기가 깨끗하게 시작한다.
    expect(fs.existsSync(file)).toBe(false);
  });

  it("wrong-shape ledger is treated as corrupt (quarantine + empty)", () => {
    const file = tmpLedgerPath();
    fs.writeFileSync(file, JSON.stringify({ schema_version: 2, items: [] }));
    expect(readLedger(file)).toEqual({ schema_version: 1, items: {} });
  });
});
