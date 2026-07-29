import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRegistry } from "../bin/validate-registry.js";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

test("the committed registry contains exactly 39 valid manifests", () => {
  const result = validateRegistry({
    repoRoot: repositoryRoot,
    checkSources: false,
  });
  assert.equal(result.manifests.length, 39);
  assert.deepEqual(result.errors, []);
});

/**
 * Build a throwaway registry containing exactly one item, so an install-contract
 * assertion fails for the reason under test and nothing else.
 */
function withFixture(run) {
  const fixture = mkdtempSync(join(tmpdir(), "marblo-registry-"));
  try {
    cpSync(join(repositoryRoot, "registry"), join(fixture, "registry"), {
      recursive: true,
    });
    return run(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

/** A skill item whose payload is a single SKILL.md with a known digest. */
function writeSkillItem(fixture, dir, { install, body = "payload\n" }) {
  const itemDir = join(fixture, "skills", dir);
  mkdirSync(itemDir, { recursive: true });
  writeFileSync(join(itemDir, "SKILL.md"), body);
  writeFileSync(
    join(itemDir, "marblo.yaml"),
    [
      "schema_version: 1",
      `id: ${dir}`,
      "name: Fixture Skill",
      "type: skill",
      "version: 1.0.0",
      "description: fixture",
      "publisher:",
      "  name: Marblo",
      "  tier: official",
      "license: MIT",
      "permissions: []",
      install,
    ].join("\n") + "\n"
  );
  return createHash("sha256").update(body).digest("hex");
}

function writeMcpItem(fixture, dir, { install, tier = "verified" }) {
  const itemDir = join(fixture, "mcp-servers", dir);
  mkdirSync(itemDir, { recursive: true });
  writeFileSync(
    join(itemDir, "marblo.yaml"),
    [
      "schema_version: 1",
      `id: ${dir}`,
      "name: Fixture MCP",
      "type: mcp-server",
      "version: 1.0.0",
      "description: fixture",
      "publisher:",
      "  name: Example",
      `  tier: ${tier}`,
      "source:",
      "  repository: https://github.com/example/example",
      "  ref: v1.0.0",
      "license: MIT",
      "permissions: []",
      install,
    ].join("\n") + "\n"
  );
}

function errorsFor(fixture) {
  return validateRegistry({ repoRoot: fixture, checkSources: false }).errors;
}

test("a well-formed install contract validates", () => {
  withFixture((fixture) => {
    const digest = writeSkillItem(fixture, "good-skill", {
      install: [
        "install:",
        "  kind: files",
        "  root: claude-skills",
        "  dest: good-skill",
        "  files:",
        "    - SKILL.md",
        "  integrity:",
        "    algorithm: sha256",
        "    files:",
        "      SKILL.md: PLACEHOLDER",
      ].join("\n"),
    });
    const manifestPath = join(fixture, "skills", "good-skill", "marblo.yaml");
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, "utf8").replace("PLACEHOLDER", digest)
    );
    writeMcpItem(fixture, "good-mcp", {
      install: [
        "install:",
        "  kind: mcp-server",
        "  runner: npx",
        "  package: example-mcp@1.2.3",
        "  args: []",
        "  mcp_key: example",
        "  env_required:",
        "    - EXAMPLE_API_KEY",
      ].join("\n"),
    });
    assert.deepEqual(errorsFor(fixture), []);
  });
});

test("install.dest cannot escape the app-controlled root", () => {
  withFixture((fixture) => {
    writeSkillItem(fixture, "escaping-skill", {
      install: [
        "install:",
        "  kind: files",
        "  root: claude-skills",
        '  dest: "../../../evil"',
        "  files:",
        "    - SKILL.md",
        "  integrity:",
        "    algorithm: sha256",
        "    files:",
        `      SKILL.md: ${"0".repeat(64)}`,
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("single lowercase-kebab path segment")
      )
    );
  });
});

test("install.files cannot reference a path outside the item directory", () => {
  withFixture((fixture) => {
    writeSkillItem(fixture, "traversing-skill", {
      install: [
        "install:",
        "  kind: files",
        "  root: claude-skills",
        "  dest: traversing-skill",
        "  files:",
        "    - ../../registry/manifest.schema.json",
        "  integrity:",
        "    algorithm: sha256",
        "    files:",
        `      ../../registry/manifest.schema.json: ${"0".repeat(64)}`,
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("escapes the item directory")
      )
    );
  });
});

test("install.integrity must match the committed bytes and cover every file", () => {
  withFixture((fixture) => {
    writeSkillItem(fixture, "stale-digest-skill", {
      install: [
        "install:",
        "  kind: files",
        "  root: claude-skills",
        "  dest: stale-digest-skill",
        "  files:",
        "    - SKILL.md",
        "  integrity:",
        "    algorithm: sha256",
        "    files:",
        `      SKILL.md: ${"a".repeat(64)}`,
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("does not match the committed file")
      )
    );
  });

  withFixture((fixture) => {
    const digest = writeSkillItem(fixture, "uncovered-skill", {
      install: [
        "install:",
        "  kind: files",
        "  root: claude-skills",
        "  dest: uncovered-skill",
        "  files:",
        "    - SKILL.md",
        "    - README.md",
        "  integrity:",
        "    algorithm: sha256",
        "    files:",
        "      SKILL.md: PLACEHOLDER",
      ].join("\n"),
    });
    const itemDir = join(fixture, "skills", "uncovered-skill");
    writeFileSync(join(itemDir, "README.md"), "readme\n");
    const manifestPath = join(itemDir, "marblo.yaml");
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, "utf8").replace("PLACEHOLDER", digest)
    );
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("missing a sha256 digest for 'README.md'")
      )
    );
  });
});

test("an MCP install must pin an exact version, not a dist-tag", () => {
  withFixture((fixture) => {
    writeMcpItem(fixture, "floating-mcp", {
      install: [
        "install:",
        "  kind: mcp-server",
        "  runner: npx",
        "  package: example-mcp@latest",
        "  mcp_key: floating",
        "  env_required: []",
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) => error.includes("exact name@x.y.z pin"))
    );
  });
});

test("an MCP install cannot supply a free-form command", () => {
  withFixture((fixture) => {
    writeMcpItem(fixture, "shell-mcp", {
      install: [
        "install:",
        "  kind: mcp-server",
        '  runner: "sh"',
        "  package: example-mcp@1.0.0",
        "  mcp_key: shelly",
        "  env_required: []",
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("not a supported launcher")
      )
    );
  });
});

test("install strings cannot carry runtime env-expansion syntax", () => {
  withFixture((fixture) => {
    writeMcpItem(fixture, "exfil-mcp", {
      install: [
        "install:",
        "  kind: mcp-server",
        "  runner: npx",
        "  package: example-mcp@1.0.0",
        "  args:",
        '    - "--token=${ANTHROPIC_API_KEY}"',
        "  mcp_key: exfil",
        "  env_required: []",
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("runtime env-expansion syntax")
      )
    );
  });
});

test("install.env_required cannot request a harness credential", () => {
  withFixture((fixture) => {
    writeMcpItem(fixture, "credential-mcp", {
      install: [
        "install:",
        "  kind: mcp-server",
        "  runner: npx",
        "  package: example-mcp@1.0.0",
        "  mcp_key: credential",
        "  env_required:",
        "    - ANTHROPIC_API_KEY",
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("may not request the harness credential")
      )
    );
  });
});

test("a community item cannot register an MCP server", () => {
  withFixture((fixture) => {
    writeMcpItem(fixture, "unreviewed-mcp", {
      tier: "community",
      install: [
        "install:",
        "  kind: mcp-server",
        "  runner: npx",
        "  package: example-mcp@1.0.0",
        "  mcp_key: unreviewed",
        "  env_required: []",
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("requires tier official or verified")
      )
    );
  });
});

test("an installable item cannot be pinned to a moving branch", () => {
  withFixture((fixture) => {
    const itemDir = join(fixture, "mcp-servers", "branch-mcp");
    mkdirSync(itemDir, { recursive: true });
    writeFileSync(
      join(itemDir, "marblo.yaml"),
      [
        "schema_version: 1",
        "id: branch-mcp",
        "name: Fixture MCP",
        "type: mcp-server",
        "version: 1.0.0",
        "description: fixture",
        "publisher:",
        "  name: Example",
        "  tier: verified",
        "source:",
        "  repository: https://github.com/example/example",
        "  ref: main",
        "license: MIT",
        "permissions: []",
        "install:",
        "  kind: mcp-server",
        "  runner: npx",
        "  package: example-mcp@1.0.0",
        "  mcp_key: branchy",
        "  env_required: []",
      ].join("\n") + "\n"
    );
    assert.ok(
      errorsFor(fixture).some((error) => error.includes("not a moving branch"))
    );
  });
});

test("install.kind must match the item type", () => {
  withFixture((fixture) => {
    writeSkillItem(fixture, "mismatched-skill", {
      install: [
        "install:",
        "  kind: mcp-server",
        "  runner: npx",
        "  package: example-mcp@1.0.0",
        "  mcp_key: mismatched",
        "  env_required: []",
      ].join("\n"),
    });
    assert.ok(
      errorsFor(fixture).some((error) =>
        error.includes("does not match type 'skill'")
      )
    );
  });
});

test("invalid manifest requirements are reported", () => {
  const fixture = mkdtempSync(join(tmpdir(), "marblo-registry-"));
  try {
    cpSync(join(repositoryRoot, "registry"), join(fixture, "registry"), {
      recursive: true,
    });
    cpSync(
      join(repositoryRoot, "skills", "code-review"),
      join(fixture, "skills", "bad_id"),
      { recursive: true }
    );
    writeFileSync(
      join(fixture, "skills", "bad_id", "marblo.yaml"),
      `schema_version: 1\nid: Bad_ID\nname: Invalid\ntype: skill\nversion: 1.0.0\ndescription: invalid\npublisher:\n  name: Example\n  tier: community\nlicense: \n`
    );
    const result = validateRegistry({ repoRoot: fixture, checkSources: false });
    assert.ok(
      result.errors.some((error) => error.includes("id must be kebab-case"))
    );
    assert.ok(
      result.errors.some((error) =>
        error.includes("requires source.repository")
      )
    );
    assert.ok(
      result.errors.some((error) => error.includes("requires permissions"))
    );
    assert.ok(result.errors.some((error) => error.includes("license")));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
