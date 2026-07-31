// Generates the README catalog block from the manifests — the ONLY source of truth
// for what this repo contains. Every value written below is read verbatim out of a
// <category>/<id>/marblo.yaml; nothing is inferred, summarised, or hand-maintained.
//
//   node scripts/gen-catalog.mjs            rewrite the block in README.md
//   node scripts/gen-catalog.mjs --check    fail if the committed block is stale
//
// Output is deterministic — no dates, no ordering by object-key insertion — because
// .github/workflows/validate.yml regenerates it and fails the PR on any diff. A
// timestamp here would make that guard fail on every run.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { parse } from "yaml";

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const README = join(REPO_ROOT, "README.md");
// Only the span between these two markers is rewritten; the surrounding prose is
// hand-written and never touched.
//
// In README.md both markers sit inside a `prettier-ignore-start` /
// `prettier-ignore-end` pair, and they must stay there. Prettier pads markdown
// table columns and inserts a blank line between adjacent HTML comments, either of
// which puts the committed file byte-for-byte out of step with this generator — so
// the drift guard would fail for a formatting reason while reporting a stale
// catalog. The fence has to wrap the markers, not sit inside them: a
// `prettier-ignore-end` placed before CATALOG:END is itself outside the ignored
// range, and prettier separates the two comments with a blank line.
const START = "<!-- CATALOG:START -->";
const END = "<!-- CATALOG:END -->";

// Display order, section heading, and the lowercase form used in the count line.
// Unknown category folders are appended rather than dropped, so adding a category
// cannot silently omit items from the catalog.
const CATEGORIES = [
  ["mcp-servers", "MCP servers", "MCP servers"],
  ["skills", "Skills", "skills"],
  ["agents", "Agents", "agents"],
  ["workflows", "Workflows", "workflows"],
  ["knowledge", "Knowledge packs", "knowledge packs"],
];

const TIER_BADGE = {
  official: "🟢 `official`",
  verified: "🔵 `verified`",
  community: "⚪ `community`",
};

/** Cells are single-line; a literal pipe would end the column. */
const cell = (value) =>
  String(value ?? "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();

/** github.com/owner/repo, tolerant of a trailing slash or .git suffix. */
function repoSlug(repository) {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    repository ?? ""
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * The pin column has to be checkable by a reader, so it links the exact reviewed
 * tree — ref plus source.path when the item is a subdirectory. A 40-hex SHA is
 * shown short and linked long; a tag is shown as written.
 */
function pinCell(manifest) {
  const source = manifest.source;
  if (!source) return "first-party — lives in this repo";

  const slug = repoSlug(source.repository);
  const ref = source.ref;
  const shown = /^[0-9a-f]{40}$/.test(ref)
    ? `\`${ref.slice(0, 7)}\``
    : `\`${ref}\``;
  if (!slug) return `${cell(source.repository)} ${shown}`;

  const path = source.path ? `/${source.path.replace(/^\/+|\/+$/g, "")}` : "";
  const url = `https://github.com/${slug}/tree/${ref}${path}`;
  return `[${slug}](${url}) ${shown}`;
}

/**
 * Two different facts, deliberately two columns. `tier` is the policy gate —
 * community items are never ONE-CLICK: their install contract exists, but the
 * app only runs it after an explicit unreviewed-content consent step
 * (SECURITY.md). `install` is whether THIS item's install contract is actually
 * written yet. Collapsing the columns would hide which of the two gates an
 * install goes through.
 */
const installCell = (manifest) =>
  manifest.install
    ? manifest.publisher?.tier === "community"
      ? `🔶 consent-gated (\`${manifest.install.kind}\`)`
      : `⚡ one-click (\`${manifest.install.kind}\`)`
    : "— reference";

const isKorea = (manifest) =>
  (manifest.keywords ?? []).some((keyword) => /^korea|^korean$/i.test(keyword));

// A dependency tree is not a catalog category — a vendored package that happened
// to ship a marblo.yaml would otherwise appear in the README.
const NOT_A_CATEGORY = new Set(["node_modules"]);

export function collectItems(repoRoot = REPO_ROOT) {
  const dirs = readdirSync(repoRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !NOT_A_CATEGORY.has(entry.name)
    )
    .map((entry) => entry.name);

  const known = CATEGORIES.map(([dir]) => dir);
  const ordered = [
    ...CATEGORIES.filter(([dir]) => dirs.includes(dir)),
    ...dirs
      .filter((dir) => !known.includes(dir))
      .sort()
      .map((dir) => [dir, dir, dir]),
  ];

  const groups = [];
  for (const [dir, heading, countLabel] of ordered) {
    const items = readdirSync(join(repoRoot, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        dir: entry.name,
        path: join(repoRoot, dir, entry.name, "marblo.yaml"),
      }))
      .filter((entry) => existsSync(entry.path))
      .map((entry) => ({
        // The link points at the directory; the label is the manifest id. They
        // differ today (mcp-servers/github holds id `github-mcp`), so deriving
        // either one from the other would put a broken link in the README.
        dir: entry.dir,
        category: dir,
        manifest: parse(readFileSync(entry.path, "utf8")),
      }))
      .sort((a, b) =>
        a.manifest.id < b.manifest.id
          ? -1
          : a.manifest.id > b.manifest.id
          ? 1
          : 0
      );
    if (items.length > 0) groups.push({ dir, heading, countLabel, items });
  }
  return groups;
}

export function renderCatalog(groups) {
  const all = groups.flatMap((group) => group.items);
  const count = (predicate) => all.filter(predicate).length;
  const tally = (tier) =>
    count((item) => item.manifest.publisher?.tier === tier);

  const lines = [
    START,
    "<!-- Generated by scripts/gen-catalog.mjs from every <category>/<id>/marblo.yaml.",
    "     Do NOT edit between these markers — run `npm run gen:catalog`.",
    "     CI regenerates this block and fails the PR if it differs from what is committed. -->",
    "",
    `**${all.length} items** · ` +
      groups
        .map((group) => `${group.items.length} ${group.countLabel}`)
        .join(" · "),
    "",
    `**Tier** — ${TIER_BADGE.official} ${tally(
      "official"
    )} maintained by Marblo · ` +
      `${TIER_BADGE.verified} ${tally(
        "verified"
      )} external, reviewed and source-pinned · ` +
      `${TIER_BADGE.community} ${tally(
        "community"
      )} external, listed and pinned but not reviewed.`,
    "",
    `**Install** — ⚡ **one-click in the app** for ${count(
      (item) =>
        Boolean(item.manifest.install) &&
        item.manifest.publisher?.tier !== "community"
    )} reviewed items · 🔶 **consent-gated** for ${count(
      (item) =>
        Boolean(item.manifest.install) &&
        item.manifest.publisher?.tier === "community"
    )} community items — ` +
      "their install contract is written and digest-verified against the pinned upstream, but the app " +
      "installs them only after an explicit \"unreviewed content\" warning is acknowledged " +
      "([why](SECURITY.md#why-community-items-cannot-be-installed-with-one-click)). Everything else is " +
      "**— reference**: listed, linked, and pinned, installed by following the item's own README.",
    "",
    `**🇰🇷** marks the ${count((item) =>
      isKorea(item.manifest)
    )} items covering Korean-language and Korean-market work.`,
    "",
  ];

  for (const group of groups) {
    lines.push(
      `#### ${group.heading} (${group.items.length})`,
      "",
      "| Item | What it does | Tier | Install | License | Upstream pin |",
      "| --- | --- | --- | --- | --- | --- |"
    );
    for (const item of group.items) {
      const m = item.manifest;
      const label = `[${cell(m.id)}](${item.category}/${item.dir}/)${
        isKorea(m) ? " 🇰🇷" : ""
      }`;
      lines.push(
        `| ${label} | ${cell(m.description)} | ${
          TIER_BADGE[m.publisher?.tier] ?? cell(m.publisher?.tier)
        }` + ` | ${installCell(m)} | ${cell(m.license)} | ${pinCell(m)} |`
      );
    }
    lines.push("");
  }

  lines.push(END);
  return lines.join("\n");
}

function main() {
  const groups = collectItems();
  const block = renderCatalog(groups);
  const readme = readFileSync(README, "utf8");

  const from = readme.indexOf(START);
  const to = readme.indexOf(END);
  if (from === -1 || to === -1 || to < from) {
    console.error(
      `gen-catalog: README.md is missing the ${START} / ${END} markers — cannot place the catalog.`
    );
    process.exit(1);
  }

  const next = readme.slice(0, from) + block + readme.slice(to + END.length);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (process.argv.includes("--check")) {
    if (next !== readme) {
      console.error(
        "gen-catalog: README.md catalog block is stale. Run `npm run gen:catalog` and commit the result."
      );
      process.exit(1);
    }
    console.error(
      `gen-catalog: README.md catalog is current (${total} manifests).`
    );
    return;
  }

  if (next === readme) {
    console.error(
      `gen-catalog: README.md already current (${total} manifests).`
    );
    return;
  }
  writeFileSync(README, next);
  console.error(`gen-catalog: README.md catalog updated (${total} manifests).`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}
