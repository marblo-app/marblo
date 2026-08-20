/**
 * English — `code.*` namespace. Typed `Record<keyof typeof koCode, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { code as koCode } from "../ko/code";

export const code: Record<keyof typeof koCode, string> = {
  "code.rootNotSelected": "No project root selected",
  "code.noFileSelected.title": "Select a file",
  "code.noFileSelected.hint": "Click a file in the sidebar to open it here",
  "code.diffView": "View diff",
  "code.diffLoading": "Loading diff...",
  "code.saveFailed": "Failed to save {name} — changes were not written to disk",
  "code.saveFailedDismiss": "Dismiss save error",
  "code.rootArchivedHint": "{count} archived · manage in the Worktrees tab",
  "code.rootUnknownHint": "{count} unjudged · hygiene status unavailable",

  "code.notebook.cellCount": "{total} cells · {code} code",
  "code.notebook.empty": "This notebook has no cells.",

  "code.notebook.rawFallback.title":
    "Couldn't read this notebook — showing the raw JSON instead",
  "code.notebook.rawFallback.reason": "Reason: {message}",
  "code.notebook.rawFallback.unknownReason":
    "The cause couldn't be determined — this may not be a .ipynb file.",
  "code.notebook.run": "Run",
  "code.notebook.restart": "Restart kernel",
  "code.notebook.kernel.loadingRuntime": "Loading Python runtime…",
  "code.notebook.kernel.loadingPackages": "Loading packages…",
  "code.notebook.kernel.running": "Running…",
  "code.notebook.kernel.ready": "Kernel ready",
  "code.notebook.kernel.failed": "Kernel error",

  "code.notebook.kernel.missingAssets": "Python runtime not installed",
  "code.notebook.kernel.missingAssetsError":
    "The Python runtime is not installed. Run `{command}` from the repo root, then try again.",
  "code.notebook.assets.title": "The Python runtime isn't ready",
  "code.notebook.assets.body":
    "Running notebook cells needs the Pyodide runtime (~31MB). `npm run dev` normally fetches it for you — you're seeing this because you were offline or the download failed. Run the command below from the repo root, then hit Retry.",
  "code.notebook.assets.copy": "Copy command",
  "code.notebook.assets.copied": "Copied",
  "code.notebook.assets.retry": "Retry",

  "code.worktreeDiff.loading": "Checking worktree changes...",
  "code.worktreeDiff.changedCount": "{count} changed",
  "code.worktreeDiff.deletedFile": "{path} — deleted, cannot be opened",
  "code.worktreeDiff.clean":
    "This worktree has no changes (identical to its base).",
  "code.worktreeDiff.committedOnly":
    "No uncommitted changes — this branch has {count} file(s) changed against its base, all already committed.",
  "code.worktreeDiff.viewFullDiff": "View full diff",
  "code.worktreeDiff.deletionsOnly":
    "All {count} change(s) are deletions — no file left on disk to diff.",
  "code.worktreeDiff.error": "Could not open the worktree diff: {message}",

  "code.quickAction.explain": "Explain",
  "code.quickAction.fix": "Fix this",
  "code.quickAction.running": "Asking your CLI about lines {start}–{end}…",
  "code.quickAction.onDemandHint":
    "Runs once, only when you click — it does not keep running like autocomplete.",
  "code.quickAction.truncated":
    "The selection was long, so only the beginning was sent. A shorter selection gives a sharper answer.",
  "code.quickAction.tooLong":
    "That selection is too long — select {max} lines or fewer. (A truncated fix wouldn't line up with the original range and would break the code.)",
  "code.quickAction.noRoot":
    "No project root found, so the CLI could not be run.",
  "code.quickAction.spawnFailed": "Could not run the CLI: {message}",
  "code.quickAction.emptyResult":
    "The CLI returned no result (exit code {code}). Its last output is below.",
  "code.quickAction.noCodeBlock":
    "No code block was found in the fix, so it can't be applied automatically. Review the answer below.",
  "code.quickAction.needsCli": "No CLI is connected.",
  "code.quickAction.needsCliWhy":
    "Quick actions reuse a CLI you already installed and signed into (Claude Code or Codex). No new subscription, no extra cost.",
  "code.quickAction.needsCliCta": "Install & sign in",
  "code.quickAction.diffTitle": "Suggested fix · lines {start}–{end}",
  "code.quickAction.diffStat": "+{added} −{removed}",
  "code.quickAction.diffNoChange": "Nothing changed.",
  "code.quickAction.apply": "Apply",
  "code.quickAction.rangeDrifted":
    "The code changed in the meantime, so nothing was applied. Select it again and re-run.",

  // Document relationship graph (Obsidian-style · Code sidebar Graph sub-tab)
  "code.docGraph.empty": "No markdown documents",
  "code.docGraph.emptyHint":
    "Add .md files to the project to see link relationships as a graph",
  "code.docGraph.noLinksHint":
    "Try adding links in your docs — [[wikilink]] or [text](target.md)",
  "code.docGraph.noRoot": "Select a project root first",
  "code.docGraph.summary": "{nodes} docs · {edges} links",
  "code.docGraph.orphans": "{count} orphan",
  "code.docGraph.fit": "Fit to view",
  "code.docGraph.refresh": "Refresh",
  "code.docGraph.loading": "Reading documents…",
  "code.docGraph.scanned": "{count} md",
  "code.docGraph.scope.label": "Folder",
  "code.docGraph.scope.all": "All",
  "code.docGraph.scope.filtered": "{count} shown",
  "code.docGraph.scope.depthLimited": "Folders shown to {count} levels",
  "code.docGraph.external.label": "External",
  "code.docGraph.external.exclude": "Exclude",
  "code.docGraph.external.boundary": "Boundary",
  "code.docGraph.legend.doc": "Doc",
  "code.docGraph.legend.index": "index",
  "code.docGraph.legend.log": "log",
  "code.docGraph.legend.orphan": "Orphan",
  "code.docGraph.legend.backlink": "Backlink",
  "code.docGraph.tooltip.links": "{out} links · {back} backlinks",
  "code.docGraph.tooltip.index": "List hub (index.md)",
  "code.docGraph.tooltip.log": "Timeline (log.md)",
  "code.docGraph.tooltip.orphan": "No links to other docs",
  "code.docGraph.nodeListLabel": "Document graph nodes ({count})",
  "code.docGraph.guide.toggle": "How to use the document graph",
  "code.docGraph.guide.step1":
    "Add [[wikilink]] or a markdown link [text](target.md) in a doc — they become nodes and edges on the graph.",
  "code.docGraph.guide.step2":
    "index.md is the list hub; log.md is the timeline.",
  "code.docGraph.guide.step3":
    "Orphan docs (0 links) appear faded; backlinks show who references this doc.",
  "code.docGraph.guide.step4": "Click a node to open the file.",
  "code.docGraph.guide.diff":
    "Unlike Obsidian, the LLM/orchestrator keeps and refines the links.",
};
