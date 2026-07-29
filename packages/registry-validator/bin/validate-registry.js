#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const executableTypes = new Set(["skill", "agent", "workflow", "mcp-server", "harness"]);
const kebabId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pinnedRef = /^(?:[0-9a-f]{40}|v?\d+(?:\.\d+)*(?:[.-][0-9A-Za-z.-]+)?)$/;

function repositoryApiPath(repository) {
  try {
    const url = new URL(repository);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/");
    return parts.length === 2 && parts.every(Boolean) ? `repos/${parts.join("/")}` : null;
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
    stdio: ["ignore", "ignore", "pipe"]
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`;
    return `GitHub reachability not verified for ${repository} (${reason})`;
  }
  return null;
}

export function findManifests(repoRoot) {
  return readdirSync(repoRoot, { withFileTypes: true })
    .filter((category) => category.isDirectory() && !category.name.startsWith("."))
    .flatMap((category) => readdirSync(join(repoRoot, category.name), { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => join(repoRoot, category.name, item.name, "marblo.yaml"))
      .filter(existsSync))
    .sort();
}

export function validateRegistry({ repoRoot, checkSources = true } = {}) {
  const root = resolve(repoRoot ?? join(dirname(new URL(import.meta.url).pathname), "../../.."));
  const schemaPath = join(root, "registry", "manifest.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);
  const errors = [];
  const warnings = [];
  const ids = new Map();
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
        errors.push(`${label}: schema ${error.instancePath || "/"} ${error.message}`);
      }
    }
    if (!kebabId.test(manifest?.id ?? "")) errors.push(`${label}: id must be kebab-case`);
    if (manifest?.id) {
      const original = ids.get(manifest.id);
      if (original) errors.push(`${label}: duplicate id '${manifest.id}' (also in ${original})`);
      else ids.set(manifest.id, label);
    }
    if (manifest?.publisher?.tier !== "official") {
      if (!manifest?.source?.repository) errors.push(`${label}: non-official item requires source.repository`);
      if (!pinnedRef.test(manifest?.source?.ref ?? "")) errors.push(`${label}: non-official item requires a tag or 40-character SHA source.ref`);
    }
    if (executableTypes.has(manifest?.type) && !Array.isArray(manifest?.permissions)) {
      errors.push(`${label}: executable type '${manifest.type}' requires permissions`);
    }
    if (typeof manifest?.license !== "string" || manifest.license.trim() === "") {
      errors.push(`${label}: license must be a non-empty SPDX identifier string`);
    }
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
