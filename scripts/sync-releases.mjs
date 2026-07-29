// Backfills release notes from melocream/marblo-releases into releases/<tag>.md.
// CREATE-IF-MISSING: hand-authored English notes are never overwritten. Regenerates
// the language-neutral index each run. Run by .github/workflows/sync-releases.yml.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

const SRC = "melocream/marblo-releases";
mkdirSync("releases", { recursive: true });

const rels = JSON.parse(execFileSync("gh", ["release","list","--repo",SRC,"--limit","100",
  "--json","tagName,name,publishedAt,isDraft"], { encoding: "utf8" }))
  .filter(r => !r.isDraft).sort((a,b)=> (a.publishedAt<b.publishedAt?1:-1));

let created = 0;
const rows = [];
for (const r of rels) {
  const tag = r.tagName, date = (r.publishedAt||"").slice(0,10);
  const file = `releases/${tag}.md`;
  if (!existsSync(file)) {               // never clobber hand-authored notes
    const body = (JSON.parse(execFileSync("gh",["release","view",tag,"--repo",SRC,"--json","body"],{encoding:"utf8"})).body||"").trim();
    writeFileSync(file, `# ${r.name||tag}\n\n> Released ${date} · tag \`${tag}\` · [download](https://github.com/${SRC}/releases/tag/${tag})\n\n${body}\n`);
    created++;
  }
  rows.push(`| [\`${tag}\`](${tag}.md) | ${date} | [notes →](${tag}.md) |`);
}
writeFileSync("releases/README.md",
  `# Releases — What's new\n\nProduct release notes for the Marblo desktop app, newest first. `+
  `Binaries: **[latest release](https://github.com/${SRC}/releases/latest)** · site: **[marblo.app/download](https://marblo.app/download)**.\n\n`+
  `| Version | Date | Notes |\n| --- | --- | --- |\n${rows.join("\n")}\n\n`+
  `> Significant versions are written up in detail; the rest are backfilled from GitHub Releases by \`scripts/sync-releases.mjs\` (create-if-missing, so hand-authored notes are preserved).\n`);
console.log(`Index regenerated. New files: ${created}.`);
