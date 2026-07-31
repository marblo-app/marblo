#!/usr/bin/env node
/**
 * Generates `install:` blocks for community skill/agent manifests from their
 * pinned `source` refs — the no-vendor way to make them installable.
 *
 * For every `skills|agents/<item>/marblo.yaml` with `publisher.tier: community`
 * and no `install:` block yet, this script:
 *
 *   1. resolves `source.repository` + `source.ref` (must be an immutable pin),
 *   2. lists the upstream tree at that ref; if `source.path` points at a single
 *      file, the manifest's `source.path` is rewritten to its directory so
 *      `install.files` stay relative to a directory prefix (the app contract),
 *   3. builds the explicit file allowlist (caps: 200 files, 5 MB/file, 10 MB
 *      total; symlinks disqualify the whole item; names must satisfy the same
 *      segment rules the app enforces — anything excluded is REPORTED, never
 *      silently dropped),
 *   4. fetches every file's bytes at the pin and records sha256 digests, and
 *   5. writes the `install:` block into the manifest, above `permissions:`.
 *
 * The digests are what the app verifies before anything lands on disk, and the
 * registry validator re-verifies them against upstream on every PR — so a
 * force-moved tag or rewritten upstream shows up as CI red, not as a changed
 * install.
 *
 * Usage: GITHUB_TOKEN=… node scripts/gen-community-installs.mjs [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parse } from "yaml";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const DRY_RUN = process.argv.includes("--dry-run");

const MAX_FILES = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
// Same shape the app (registry-installer) and the validator enforce.
const REL_FILE_RE =
  /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const MAX_FILE_DEPTH = 8;
const PINNED_REF_RE =
  /^(?:[0-9a-f]{40}|v?\d+(?:\.\d+)*(?:[.-][0-9A-Za-z.-]+)?)$/;

const ROOT_FOR_TYPE = { skill: "claude-skills", agent: "claude-agents" };

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const TOKEN = githubToken();

async function ghJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "marblo-registry-gen",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function fetchRaw(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "marblo-registry-gen" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function parseGitHubRepo(repository) {
  try {
    const url = new URL(repository);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/, "")
      .split("/");
    return parts.length === 2 && parts.every(Boolean) ? parts.join("/") : null;
  } catch {
    return null;
  }
}

const treeCache = new Map();
async function upstreamTree(slug, ref) {
  const key = `${slug}@${ref}`;
  if (!treeCache.has(key)) {
    const res = await ghJson(
      `https://api.github.com/repos/${slug}/git/trees/${ref}?recursive=1`
    );
    if (!res?.tree || res.truncated) {
      throw new Error(`tree listing failed or truncated for ${key}`);
    }
    treeCache.set(key, res.tree);
  }
  return treeCache.get(key);
}

function isSafeRel(rel) {
  return (
    REL_FILE_RE.test(rel) &&
    rel.length <= 300 &&
    rel.split("/").length <= MAX_FILE_DEPTH
  );
}

async function planItem(manifest, label, notes) {
  const slug = parseGitHubRepo(manifest.source?.repository ?? "");
  const ref = manifest.source?.ref ?? "";
  if (!slug) throw new Error("source.repository is not a github.com repo URL");
  if (!PINNED_REF_RE.test(ref))
    throw new Error(`source.ref '${ref}' is not a pin`);

  const tree = await upstreamTree(slug, ref);
  const srcPath = manifest.source?.path ?? "";
  const exact = srcPath ? tree.find((e) => e.path === srcPath) : null;

  let payloadDir;
  let rels;
  if (exact && exact.type === "blob") {
    // source.path points at one file → normalize to its directory.
    if (exact.mode === "120000")
      throw new Error(`${srcPath} is a symlink upstream`);
    const cut = srcPath.lastIndexOf("/");
    payloadDir = cut === -1 ? "" : srcPath.slice(0, cut);
    rels = [cut === -1 ? srcPath : srcPath.slice(cut + 1)];
  } else {
    payloadDir = srcPath;
    const prefix = srcPath ? `${srcPath}/` : "";
    const blobs = tree.filter(
      (e) => e.path.startsWith(prefix) && e.type === "blob"
    );
    if (blobs.length === 0)
      throw new Error(`no files under '${srcPath}' at ${ref}`);
    const symlink = blobs.find((e) => e.mode === "120000");
    if (symlink) throw new Error(`symlink in payload: ${symlink.path}`);
    rels = [];
    for (const e of blobs) {
      const rel = e.path.slice(prefix.length);
      if (!isSafeRel(rel)) {
        // Loud exclusion, not a silent cap — dotfiles and odd names cannot be
        // expressed in the install allowlist the app accepts.
        notes.push(
          `${label}: EXCLUDED '${rel}' (name outside the allowlist grammar)`
        );
        continue;
      }
      rels.push(rel);
    }
    if (rels.length === 0) throw new Error("every upstream file was excluded");
    if (rels.length > MAX_FILES)
      throw new Error(`${rels.length} files > ${MAX_FILES}`);
  }

  if (manifest.type === "skill" && !rels.includes("SKILL.md")) {
    notes.push(`${label}: note — payload has no top-level SKILL.md`);
  }

  rels.sort();
  const integrity = {};
  let total = 0;
  for (const rel of rels) {
    const url = `https://raw.githubusercontent.com/${slug}/${ref}/${
      payloadDir ? `${payloadDir}/` : ""
    }${rel}`;
    const bytes = await fetchRaw(url);
    if (bytes.length > MAX_FILE_BYTES) {
      throw new Error(`${rel} is ${bytes.length} B > ${MAX_FILE_BYTES} B`);
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES)
      throw new Error(`payload > ${MAX_TOTAL_BYTES} B`);
    const { createHash } = await import("node:crypto");
    integrity[rel] = createHash("sha256").update(bytes).digest("hex");
  }
  return { payloadDir, rels, integrity };
}

function renderInstallBlock(manifest, plan) {
  const lines = [
    "# Not vendored: the app copies these files from the pinned `source` ref above,",
    "# checking every byte against the digests below before anything lands on disk.",
    "# Generated by scripts/gen-community-installs.mjs — regenerate, don't hand-edit.",
    "install:",
    "  kind: files",
    `  root: ${ROOT_FOR_TYPE[manifest.type]}`,
    `  dest: ${manifest.id}`,
    "  files:",
    ...plan.rels.map((rel) => `    - ${rel}`),
    "  integrity:",
    "    algorithm: sha256",
    "    files:",
    ...plan.rels.map((rel) => `      ${rel}: ${plan.integrity[rel]}`),
    "",
  ];
  return lines.join("\n");
}

function rewriteSourcePath(text, oldPath, newDir) {
  const oldLine = new RegExp(
    `^(\\s*path:\\s*)${oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "m"
  );
  if (newDir) return text.replace(oldLine, `$1${newDir}`);
  // Payload sits at the repo root — drop the path line entirely.
  return text.replace(
    new RegExp(
      `^\\s*path:\\s*${oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n`,
      "m"
    ),
    ""
  );
}

const results = { written: [], skipped: [], notes: [] };

for (const category of ["skills", "agents"]) {
  const dir = join(REPO_ROOT, category);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(dir, entry.name, "marblo.yaml");
    if (!existsSync(manifestPath)) continue;
    const label = `${category}/${entry.name}`;
    const text = readFileSync(manifestPath, "utf8");
    let manifest;
    try {
      manifest = parse(text);
    } catch (error) {
      results.skipped.push(`${label}: unparseable YAML (${error.message})`);
      continue;
    }
    if (manifest?.publisher?.tier !== "community") continue;
    if (!ROOT_FOR_TYPE[manifest?.type]) continue;
    if (manifest.install) continue;

    try {
      const plan = await planItem(manifest, label, results.notes);
      let next = text;
      const srcPath = manifest.source?.path ?? "";
      if (srcPath && plan.payloadDir !== srcPath) {
        next = rewriteSourcePath(next, srcPath, plan.payloadDir);
      }
      const anchor = /^permissions:/m.exec(next);
      if (!anchor) throw new Error("no top-level permissions: anchor");
      next =
        next.slice(0, anchor.index) +
        renderInstallBlock(manifest, plan) +
        "\n" +
        next.slice(anchor.index);
      if (!DRY_RUN) writeFileSync(manifestPath, next);
      results.written.push(
        `${label}: ${plan.rels.length} file(s) from ${manifest.source.repository}@${manifest.source.ref}`
      );
    } catch (error) {
      results.skipped.push(`${label}: ${error.message}`);
    }
  }
}

for (const line of results.notes) console.warn(`note: ${line}`);
for (const line of results.skipped) console.warn(`SKIPPED ${line}`);
for (const line of results.written) console.log(`wrote ${line}`);
console.log(
  `${DRY_RUN ? "[dry-run] " : ""}${results.written.length} install block(s), ${
    results.skipped.length
  } skipped.`
);
process.exitCode = 0;
