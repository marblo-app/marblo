#!/usr/bin/env node
// Vendors the Pyodide runtime into src/public/pyodide/ so the Code tab's
// notebook kernel is fully self-contained — the packaged app never talks to a
// CDN at runtime, which is the whole point (offline use, no third-party
// request carrying a user's code path, no CDN outage breaking the feature).
//
// The npm `pyodide` package ships only the core (wasm + stdlib); the science
// wheels normally stream from jsdelivr on first loadPackage(). So we download
// them ONCE here, at build time, and verify every byte against the sha256 in
// pyodide-lock.json before it is written.
//
//   npm run assets:pyodide              # strict — build path, any failure aborts
//   npm run assets:pyodide -- --force   # re-download even when the sha256 matches
//   npm run assets:pyodide:soft         # best-effort — used by the dev pre-hooks
//
// Output is gitignored and re-created on demand. Without it the notebook
// renders fine and Run reports that the runtime is missing (see NotebookView).
//
// --soft exists because this now runs before `npm run dev` (predev). Vendoring
// is a nice-to-have for a dev session, but being unable to start the app on a
// plane is not — so in soft mode every failure (offline, CDN down, checksum
// mismatch) degrades to a warning and exit 0. Only the notebook feature is
// affected, and it says exactly how to fix itself. The build path stays strict:
// an installer must never ship without the runtime it promises.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  copyFile,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V3 = path.resolve(HERE, "..");
const SRC = path.join(V3, "node_modules", "pyodide");
const OUT = path.join(V3, "src", "public", "pyodide");
const FORCE = process.argv.includes("--force");
// Best-effort mode for the dev pre-hooks: warn and succeed instead of aborting.
const SOFT = process.argv.includes("--soft");

// Everything the Pyodide loader itself fetches from indexURL, plus the loader.
const CORE_FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

// The quant workflow this feature exists for. Transitive deps are resolved
// from the lock, so adding one name here pulls in whatever it needs.
const ROOT_PACKAGES = ["numpy", "pandas", "matplotlib"];

/** A failure we recognise and can explain — as opposed to a crash. */
class AssetError extends Error {}

// Throws rather than exits so soft mode can decide the exit code in one place.
// Every caller treats this as terminating, which a throw still is.
function fail(msg) {
  throw new AssetError(msg);
}

// PEP 503 name normalization — the lock spells it "Pillow" while matplotlib's
// depends list says "pillow", so an exact-match lookup misses the dependency.
function normalize(name) {
  return name.replace(/[-_.]+/g, "-").toLowerCase();
}

function closure(lock, roots) {
  const byName = new Map(
    Object.entries(lock.packages).map(([key, p]) => [
      normalize(p.name),
      { key, ...p },
    ]),
  );
  const picked = new Map();
  const visit = (name) => {
    const pkg = byName.get(normalize(name));
    if (!pkg) fail(`pyodide-lock.json 에 '${name}' 패키지가 없습니다.`);
    if (picked.has(pkg.name)) return;
    picked.set(pkg.name, pkg);
    for (const dep of pkg.depends ?? []) visit(dep);
  };
  roots.forEach(visit);
  return [...picked.values()];
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function alreadyGood(dest, expectedSha) {
  if (FORCE || !existsSync(dest)) return false;
  if (!expectedSha) return true; // core files: presence is enough
  return sha256(await readFile(dest)) === expectedSha;
}

async function download(url, dest, expectedSha) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    // Offline / DNS / TLS. Surface it as a diagnosis, not a node stack trace —
    // soft mode prints this straight to a developer's `npm run dev` output.
    fail(
      `${url} → 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) fail(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (expectedSha && got !== expectedSha) {
    // A mismatch means the file is not what the lock pinned. Never write it.
    fail(
      `체크섬 불일치: ${path.basename(dest)}\n  기대 ${expectedSha}\n  실제 ${got}`,
    );
  }
  await writeFile(dest, buf);
  return buf.length;
}

async function main() {
  if (!existsSync(SRC)) {
    fail("node_modules/pyodide 가 없습니다. 먼저 npm install 을 실행하세요.");
  }
  const pkgJson = JSON.parse(
    await readFile(path.join(SRC, "package.json"), "utf-8"),
  );
  const version = pkgJson.version;
  const lock = JSON.parse(
    await readFile(path.join(SRC, "pyodide-lock.json"), "utf-8"),
  );
  // Wheels are version-locked to the runtime ABI, so they must come from the
  // release matching the installed npm package — never "latest".
  const base = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

  await mkdir(OUT, { recursive: true });
  console.log(`[pyodide-assets] pyodide ${version} → src/public/pyodide/`);

  for (const file of CORE_FILES) {
    if (!existsSync(path.join(SRC, file)))
      fail(`node_modules/pyodide/${file} 이 없습니다.`);
  }

  const packages = closure(lock, ROOT_PACKAGES);
  console.log(
    `[pyodide-assets] 패키지 ${packages.length}개: ${packages
      .map((p) => `${p.name}@${p.version}`)
      .join(", ")}`,
  );

  let downloaded = 0;
  let skipped = 0;
  for (const pkg of packages) {
    const dest = path.join(OUT, pkg.file_name);
    if (await alreadyGood(dest, pkg.sha256)) {
      skipped++;
      continue;
    }
    const bytes = await download(base + pkg.file_name, dest, pkg.sha256);
    downloaded++;
    console.log(
      `[pyodide-assets]   ✓ ${pkg.file_name} (${(bytes / 1e6).toFixed(1)} MB, sha256 확인)`,
    );
  }

  // Core files land LAST, on purpose. The kernel treats pyodide-lock.json as
  // proof the directory is complete (see kernel.worker.ts), so writing it
  // before the wheels would let a half-finished soft run — the one that just
  // lost the network — look fully vendored and fail later with a far more
  // confusing error than "assets missing".
  for (const file of CORE_FILES) {
    await copyFile(path.join(SRC, file), path.join(OUT, file));
  }
  console.log(`[pyodide-assets] core ${CORE_FILES.length}개 복사 완료`);

  const files = await readdir(OUT);
  const total = (
    await Promise.all(files.map((f) => stat(path.join(OUT, f))))
  ).reduce((sum, s) => sum + s.size, 0);
  console.log(
    `[pyodide-assets] 완료 — 신규 ${downloaded}개, 재사용 ${skipped}개, 합계 ${(
      total / 1e6
    ).toFixed(0)} MB`,
  );
}

main().catch((e) => {
  // An AssetError is a diagnosis; anything else is a bug and keeps its stack.
  const detail =
    e instanceof AssetError
      ? e.message
      : e instanceof Error
        ? (e.stack ?? e.message)
        : String(e);

  if (SOFT) {
    console.warn(`[pyodide-assets] 자산 준비를 건너뜁니다 — ${detail}`);
    console.warn(
      "[pyodide-assets] 앱은 정상 기동합니다. 노트북(.ipynb) 셀 실행만 비활성화되며,\n" +
        "[pyodide-assets] 네트워크 복구 후 `npm run assets:pyodide` 로 언제든 받을 수 있습니다.",
    );
    process.exit(0);
  }

  console.error(`[pyodide-assets] ${detail}`);
  process.exit(1);
});
