// Mirrors published GitHub Releases from melocream/marblo-releases into releases/*.md
// + regenerates releases/README.md index. Idempotent; run by CI (see .github/workflows/sync-releases.yml).
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const SRC = "melocream/marblo-releases";
mkdirSync("releases", { recursive: true });

const raw = execFileSync("gh", ["release","list","--repo",SRC,"--limit","100",
  "--json","tagName,name,publishedAt,isDraft,isPrerelease"], { encoding: "utf8" });
const rels = JSON.parse(raw).filter(r => !r.isDraft).sort((a,b)=> (a.publishedAt<b.publishedAt?1:-1));

const rows = [];
for (const r of rels) {
  const v = execFileSync("gh", ["release","view",r.tagName,"--repo",SRC,"--json","body"], {encoding:"utf8"});
  const body = (JSON.parse(v).body || "").trim();
  const date = (r.publishedAt || "").slice(0,10);
  const tag = r.tagName;
  const md = `# ${r.name || tag}\n\n> Released ${date} · tag \`${tag}\` · [download](https://github.com/${SRC}/releases/tag/${tag})\n\n${body}\n\n---\n\n_Mirrored from [${SRC} releases](https://github.com/${SRC}/releases). Product updates land here each version._\n`;
  writeFileSync(`releases/${tag}.md`, md);
  rows.push(`| [\`${tag}\`](${tag}.md) | ${date} | ${(r.name||"").replace(/^v?[\d.]+\s*[â-]?\s*/,"").replace(/\(mac[^)]*\)/i,"").replace(/^[—-]s*/,"").trim() || "release"} |`);
}

const index = `# Releases — What's new\n\n` +
`Product release notes for the Marblo desktop app, newest first. Binaries: **[releases/latest](https://github.com/${SRC}/releases/latest)** · site: **[marblo.app/download](https://marblo.app/download)**.\n\n` +
`| Version | Date | Highlights |\n| --- | --- | --- |\n${rows.join("\n")}\n\n` +
`> This page is generated from GitHub Releases on ${SRC} by \`scripts/sync-releases.mjs\` (see the Sync workflow). Every new version is mirrored here automatically.\n`;
writeFileSync("releases/README.md", index);
console.log(`Synced ${rels.length} release(s).`);
