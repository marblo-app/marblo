#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const executableTypes = new Set([
  "skill",
  "agent",
  "workflow",
  "mcp-server",
  "harness",
]);
const kebabId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pinnedRef = /^(?:[0-9a-f]{40}|v?\d+(?:\.\d+)*(?:[.-][0-9A-Za-z.-]+)?)$/;

// ── install contract (registry/manifest.schema.json `install`) ───────────────
// The schema already rejects the malformed shapes. These checks cover what a
// JSON Schema structurally cannot: cross-field agreement (kind vs type, digests
// vs the files list), digests vs the bytes actually committed, dest collisions
// across the whole registry, and the runtime-expansion syntax that would turn a
// fixed argument into a secret-exfiltration channel.
const installableTypes = new Set(["skill", "agent", "mcp-server"]);
const installKindForType = {
  skill: "files",
  agent: "files",
  "mcp-server": "mcp-server",
};
// The root is bound to the type, not merely allowlisted: an item reviewed as a
// skill must not be able to land in the subagents tree (where a harness would
// load it as a persona on every session), and an agent must not land in the
// skills tree. Both directions are a category swap between review and install.
const installRootForType = {
  skill: "claude-skills",
  agent: "claude-agents",
};
const installRoots = new Set(Object.values(installRootForType));
const singleSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const relFilePath =
  /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const exactPackagePin =
  /^(?:@[a-z0-9~][a-z0-9._~-]{0,63}\/)?[a-z0-9~][a-z0-9._~-]{0,127}@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,32})?$/;
const envName = /^[A-Z][A-Z0-9_]{0,63}$/;
const sha256Hex = /^[0-9a-f]{64}$/;
const mcpInstallTiers = new Set(["official", "verified"]);
const maxInstallFiles = 200;
const maxPayloadBytes = 10 * 1024 * 1024;

/**
 * Harness CLIs expand `${VAR}` inside MCP config at launch. A manifest that
 * smuggles `${ANTHROPIC_API_KEY}` into an argument would have it expanded into
 * the server's argv even though nothing here ever calls an expander — so the
 * syntax itself is refused wherever a manifest supplies a string.
 */
function noRuntimeExpansion(value, where, errors, label) {
  if (typeof value === "string" && value.includes("${")) {
    errors.push(
      `${label}: install.${where} must not contain the runtime env-expansion syntax "\${"`
    );
  }
}

/** Credential names the app already holds. A third-party server never gets them. */
const envDenylist = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]);

/**
 * Where a files install's bytes actually come from, mirrored 1:1 with the app:
 * `community` items are never vendored (CONTRIBUTING), so the app fetches their
 * payload from the pinned `source` ref — this validator therefore verifies the
 * digests against the **upstream bytes at that pin**, not against this repo.
 * `official`/`verified` payloads live in this repo and are verified on disk.
 */
function communitySourceRawBase(manifest, label, errors) {
  const repository = manifest?.source?.repository;
  const ref = manifest?.source?.ref ?? "";
  const sourcePath = manifest?.source?.path;
  const apiPath = repositoryApiPath(repository);
  if (!apiPath) {
    errors.push(
      `${label}: a community files install requires source.repository to be an https://github.com/<owner>/<repo> URL`
    );
    return null;
  }
  if (!pinnedRef.test(ref)) {
    errors.push(
      `${label}: a community files install requires a tag or 40-character SHA source.ref`
    );
    return null;
  }
  if (sourcePath !== undefined) {
    if (
      typeof sourcePath !== "string" ||
      !relFilePath.test(sourcePath) ||
      sourcePath.length > 300
    ) {
      errors.push(
        `${label}: source.path '${sourcePath}' escapes the source repo or has an illegal segment`
      );
      return null;
    }
  }
  const slug = apiPath.replace(/^repos\//, "");
  const prefix = sourcePath ? `/${sourcePath}` : "";
  return `https://raw.githubusercontent.com/${slug}/${ref}${prefix}`;
}

/** Default remote fetcher — curl keeps the validator synchronous like `gh api`. */
function curlFetchRemoteFile(url) {
  const result = spawnSync("curl", ["-sfL", "--max-time", "30", url], {
    timeout: 45_000,
    maxBuffer: 6 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0 || !result.stdout) return null;
  return result.stdout;
}

function checkFilesInstall(
  install,
  manifest,
  manifestPath,
  label,
  errors,
  remote
) {
  if (!installRoots.has(install.root)) {
    errors.push(
      `${label}: install.root '${install.root}' is not an app-controlled root`
    );
  } else if (install.root !== installRootForType[manifest?.type]) {
    errors.push(
      `${label}: install.root '${install.root}' does not match type '${
        manifest?.type
      }' (expected '${installRootForType[manifest?.type]}')`
    );
  }
  if (
    typeof install.dest !== "string" ||
    !singleSegment.test(install.dest) ||
    install.dest.length > 64
  ) {
    errors.push(
      `${label}: install.dest '${install.dest}' must be a single lowercase-kebab path segment`
    );
  }
  const files = Array.isArray(install.files) ? install.files : [];
  if (files.length === 0 || files.length > maxInstallFiles) {
    errors.push(
      `${label}: install.files must list between 1 and ${maxInstallFiles} entries`
    );
  }
  const digests = install.integrity?.files ?? {};
  const itemDir = dirname(manifestPath);
  const community = manifest?.publisher?.tier === "community";
  const rawBase = community
    ? communitySourceRawBase(manifest, label, errors)
    : null;
  let totalBytes = 0;

  for (const file of files) {
    if (
      typeof file !== "string" ||
      !relFilePath.test(file) ||
      file.length > 300
    ) {
      errors.push(
        `${label}: install.files entry '${file}' escapes the item directory or has an illegal segment`
      );
      continue;
    }
    noRuntimeExpansion(file, `files[${file}]`, errors, label);
    const expected = digests[file];
    if (typeof expected !== "string" || !sha256Hex.test(expected)) {
      errors.push(
        `${label}: install.integrity.files is missing a sha256 digest for '${file}'`
      );
      continue;
    }
    if (community) {
      // Community payloads are never in this repo (CONTRIBUTING: no vendoring).
      // The bytes the app will install live upstream at the pinned source ref,
      // so that is what the digest is checked against. Skipped when remote
      // verification is off (offline test runs) — the structural requirements
      // above still hold.
      if (!rawBase || !remote?.enabled) continue;
      const bytes = remote.fetchRemoteFile(`${rawBase}/${file}`);
      if (!bytes) {
        errors.push(
          `${label}: install.files entry '${file}' is not fetchable at the pinned source ref`
        );
        continue;
      }
      totalBytes += bytes.length;
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== expected) {
        errors.push(
          `${label}: install.integrity digest for '${file}' does not match the pinned source bytes (expected ${actual})`
        );
      }
      continue;
    }
    const onDisk = join(itemDir, file);
    if (!existsSync(onDisk) || !statSync(onDisk).isFile()) {
      errors.push(
        `${label}: install.files entry '${file}' does not exist in this item's directory`
      );
      continue;
    }
    totalBytes += statSync(onDisk).size;
    const actual = createHash("sha256")
      .update(readFileSync(onDisk))
      .digest("hex");
    if (actual !== expected) {
      errors.push(
        `${label}: install.integrity digest for '${file}' does not match the committed file (expected ${actual})`
      );
    }
  }
  if (totalBytes > maxPayloadBytes) {
    errors.push(
      `${label}: install payload is ${totalBytes} bytes, over the ${maxPayloadBytes} byte limit`
    );
  }
  // A digest for a file that is not installed is either a stale leftover or an
  // attempt to imply coverage the install does not have. Neither is acceptable.
  for (const digestPath of Object.keys(digests)) {
    if (!files.includes(digestPath)) {
      errors.push(
        `${label}: install.integrity.files lists '${digestPath}', which is not in install.files`
      );
    }
  }
}

function checkMcpInstall(install, manifest, label, errors) {
  if (install.runner !== "npx" && install.runner !== "uvx") {
    errors.push(
      `${label}: install.runner '${install.runner}' is not a supported launcher (npx | uvx)`
    );
  }
  if (
    typeof install.package !== "string" ||
    !exactPackagePin.test(install.package)
  ) {
    errors.push(
      `${label}: install.package '${install.package}' must be an exact name@x.y.z pin (dist-tags such as @latest are not a pin)`
    );
  }
  noRuntimeExpansion(install.package, "package", errors, label);
  if (
    typeof install.mcp_key !== "string" ||
    !singleSegment.test(install.mcp_key) ||
    install.mcp_key.length > 48
  ) {
    errors.push(
      `${label}: install.mcp_key '${install.mcp_key}' must be a single lowercase-kebab segment`
    );
  }
  noRuntimeExpansion(install.mcp_key, "mcp_key", errors, label);
  for (const arg of install.args ?? []) {
    noRuntimeExpansion(arg, "args", errors, label);
  }
  if (!Array.isArray(install.env_required)) {
    errors.push(
      `${label}: install.env_required is required (an empty array declares 'needs no secrets')`
    );
  } else {
    for (const name of install.env_required) {
      if (typeof name !== "string" || !envName.test(name)) {
        errors.push(
          `${label}: install.env_required entry '${name}' must be an environment variable NAME, never a value`
        );
      } else if (envDenylist.has(name)) {
        errors.push(
          `${label}: install.env_required may not request the harness credential '${name}'`
        );
      }
    }
  }
  if (!mcpInstallTiers.has(manifest?.publisher?.tier)) {
    errors.push(
      `${label}: registering an MCP server requires tier official or verified, not '${manifest?.publisher?.tier}'`
    );
  }
}

/**
 * Anything the app will install has to be pinned immutably, regardless of tier —
 * `main` or a force-movable tag means the bytes installed tomorrow are not the
 * bytes reviewed today.
 */
function checkInstallBlock(
  manifest,
  manifestPath,
  label,
  errors,
  dests,
  remote
) {
  const install = manifest?.install;
  if (install === undefined || install === null) return;
  if (typeof install !== "object" || Array.isArray(install)) {
    errors.push(`${label}: install must be an object`);
    return;
  }
  if (!installableTypes.has(manifest?.type)) {
    errors.push(
      `${label}: type '${manifest?.type}' is not installable — remove the install block`
    );
    return;
  }
  const expectedKind = installKindForType[manifest.type];
  if (install.kind !== expectedKind) {
    errors.push(
      `${label}: install.kind '${install.kind}' does not match type '${manifest.type}' (expected '${expectedKind}')`
    );
    return;
  }
  if (manifest?.source && !pinnedRef.test(manifest.source.ref ?? "")) {
    errors.push(
      `${label}: an installable item requires a tag or 40-character SHA source.ref, not a moving branch`
    );
  }
  if (manifest?.status === "revoked") {
    errors.push(`${label}: a revoked item must not carry an install block`);
  }

  if (install.kind === "files") {
    checkFilesInstall(install, manifest, manifestPath, label, errors, remote);
    const key = `${install.root}/${install.dest}`;
    const original = dests.get(key);
    if (original)
      errors.push(
        `${label}: install dest '${key}' already claimed by ${original}`
      );
    else dests.set(key, label);
  } else {
    checkMcpInstall(install, manifest, label, errors);
    const key = `mcp:${install.mcp_key}`;
    const original = dests.get(key);
    if (original)
      errors.push(
        `${label}: install mcp_key '${install.mcp_key}' already claimed by ${original}`
      );
    else dests.set(key, label);
  }
}

// ── i18n overlay (registry/manifest.schema.json `i18n`) ─────────────────────
// The schema already rejects unknown locales and the wrong types. These checks
// cover what a JSON Schema structurally cannot: a string that is non-empty only
// because it is whitespace (minLength counts spaces), and a "translation" that
// is byte-identical to the English base — which renders exactly like no overlay
// at all, so shipping it as one is a claim the display does not back.
const supportedLocales = new Set(["ko", "ja"]);
const localizedFields = { name: 80, description: 280 };

function checkI18nBlock(manifest, label, errors, warnings) {
  const i18n = manifest?.i18n;
  if (i18n === undefined || i18n === null) return;
  if (typeof i18n !== "object" || Array.isArray(i18n)) {
    errors.push(`${label}: i18n must be an object keyed by locale`);
    return;
  }
  for (const [locale, strings] of Object.entries(i18n)) {
    if (!supportedLocales.has(locale)) {
      errors.push(
        `${label}: i18n locale '${locale}' is not supported (${[
          ...supportedLocales,
        ].join(" | ")})`
      );
      continue;
    }
    if (
      typeof strings !== "object" ||
      strings === null ||
      Array.isArray(strings)
    ) {
      errors.push(`${label}: i18n.${locale} must be an object`);
      continue;
    }
    const provided = Object.keys(strings);
    if (provided.length === 0) {
      errors.push(
        `${label}: i18n.${locale} is empty — omit the locale instead of declaring an empty translation`
      );
      continue;
    }
    for (const field of provided) {
      const maxLength = localizedFields[field];
      if (maxLength === undefined) {
        errors.push(
          `${label}: i18n.${locale}.${field} is not a translatable field (${Object.keys(
            localizedFields
          ).join(" | ")})`
        );
        continue;
      }
      const value = strings[field];
      if (typeof value !== "string" || value.trim() === "") {
        errors.push(
          `${label}: i18n.${locale}.${field} must be a non-empty string`
        );
        continue;
      }
      if (value.length > maxLength) {
        errors.push(
          `${label}: i18n.${locale}.${field} is ${value.length} characters, over the ${maxLength} limit that the base field has`
        );
      }
      if (value === manifest[field]) {
        warnings.push(
          `${label}: i18n.${locale}.${field} is identical to the English base — it renders the same as no translation`
        );
      }
    }
  }
}

function repositoryApiPath(repository) {
  try {
    const url = new URL(repository);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/, "")
      .split("/");
    return parts.length === 2 && parts.every(Boolean)
      ? `repos/${parts.join("/")}`
      : null;
  } catch {
    return null;
  }
}

function checkRepository(repository) {
  const apiPath = repositoryApiPath(repository);
  if (!apiPath) return null;
  const result = spawnSync("gh", ["api", "--method", "GET", apiPath], {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (result.error || result.status !== 0) {
    const reason =
      result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`;
    return `GitHub reachability not verified for ${repository} (${reason})`;
  }
  return null;
}

export function findManifests(repoRoot) {
  return readdirSync(repoRoot, { withFileTypes: true })
    .filter(
      (category) => category.isDirectory() && !category.name.startsWith(".")
    )
    .flatMap((category) =>
      readdirSync(join(repoRoot, category.name), { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => join(repoRoot, category.name, item.name, "marblo.yaml"))
        .filter(existsSync)
    )
    .sort();
}

export function validateRegistry({
  repoRoot,
  checkSources = true,
  // Community install digests are verified against upstream bytes. Follows
  // `checkSources` by default; tests flip it independently with an injected
  // fetcher so they stay fully offline.
  checkRemoteInstalls = checkSources,
  fetchRemoteFile = curlFetchRemoteFile,
} = {}) {
  const root = resolve(
    repoRoot ?? join(dirname(new URL(import.meta.url).pathname), "../../..")
  );
  const schemaPath = join(root, "registry", "manifest.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);
  const errors = [];
  const warnings = [];
  const ids = new Map();
  const installTargets = new Map();
  const manifests = findManifests(root);

  for (const manifestPath of manifests) {
    const label = relative(root, manifestPath);
    let manifest;
    try {
      manifest = parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      errors.push(`${label}: invalid YAML: ${error.message}`);
      continue;
    }

    if (!validateSchema(manifest)) {
      for (const error of validateSchema.errors ?? []) {
        errors.push(
          `${label}: schema ${error.instancePath || "/"} ${error.message}`
        );
      }
    }
    if (!kebabId.test(manifest?.id ?? ""))
      errors.push(`${label}: id must be kebab-case`);
    if (manifest?.id) {
      const original = ids.get(manifest.id);
      if (original)
        errors.push(
          `${label}: duplicate id '${manifest.id}' (also in ${original})`
        );
      else ids.set(manifest.id, label);
    }
    if (manifest?.publisher?.tier !== "official") {
      if (!manifest?.source?.repository)
        errors.push(`${label}: non-official item requires source.repository`);
      if (!pinnedRef.test(manifest?.source?.ref ?? ""))
        errors.push(
          `${label}: non-official item requires a tag or 40-character SHA source.ref`
        );
    }
    if (
      executableTypes.has(manifest?.type) &&
      !Array.isArray(manifest?.permissions)
    ) {
      errors.push(
        `${label}: executable type '${manifest.type}' requires permissions`
      );
    }
    if (
      typeof manifest?.license !== "string" ||
      manifest.license.trim() === ""
    ) {
      errors.push(
        `${label}: license must be a non-empty SPDX identifier string`
      );
    }
    checkInstallBlock(manifest, manifestPath, label, errors, installTargets, {
      enabled: checkRemoteInstalls,
      fetchRemoteFile,
    });
    checkI18nBlock(manifest, label, errors, warnings);
    if (checkSources && manifest?.source?.repository) {
      const warning = checkRepository(manifest.source.repository);
      if (warning) warnings.push(`${label}: ${warning}`);
    }
  }
  return { manifests, errors, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const { manifests, errors, warnings } = validateRegistry({ repoRoot });
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
  console.log(`Validated ${manifests.length} registry manifest(s).`);
  process.exitCode = errors.length ? 1 : 0;
}
