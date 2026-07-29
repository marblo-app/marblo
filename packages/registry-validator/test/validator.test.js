import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRegistry } from "../bin/validate-registry.js";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

test("the committed registry contains exactly 39 valid manifests", () => {
  const result = validateRegistry({ repoRoot: repositoryRoot, checkSources: false });
  assert.equal(result.manifests.length, 39);
  assert.deepEqual(result.errors, []);
});

test("invalid manifest requirements are reported", () => {
  const fixture = mkdtempSync(join(tmpdir(), "marblo-registry-"));
  try {
    cpSync(join(repositoryRoot, "registry"), join(fixture, "registry"), { recursive: true });
    cpSync(join(repositoryRoot, "skills", "code-review"), join(fixture, "skills", "bad_id"), { recursive: true });
    writeFileSync(join(fixture, "skills", "bad_id", "marblo.yaml"), `schema_version: 1\nid: Bad_ID\nname: Invalid\ntype: skill\nversion: 1.0.0\ndescription: invalid\npublisher:\n  name: Example\n  tier: community\nlicense: \n`);
    const result = validateRegistry({ repoRoot: fixture, checkSources: false });
    assert.ok(result.errors.some((error) => error.includes("id must be kebab-case")));
    assert.ok(result.errors.some((error) => error.includes("requires source.repository")));
    assert.ok(result.errors.some((error) => error.includes("requires permissions")));
    assert.ok(result.errors.some((error) => error.includes("license")));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
