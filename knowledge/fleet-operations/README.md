# Fleet Operations (knowledge pack)

**The flagship pack in this repo.** What we learned running several different vendor agent CLIs in parallel, against real tickets, for months — the failure modes that only show up when the fleet is heterogeneous.

📄 **Read it: [`KNOWLEDGE.md`](KNOWLEDGE.md)** — no install required.

## What's in it

| §   | Topic                       | The short version                                                                                                           |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Vendor integration shapes   | "Ships its own CLI" is **not** what decides whether a vendor is cheap or expensive to add. The real discriminator, and why. |
| 2   | Env-swap wiring             | Four rules — including the partial-injection failure that sends your first-party credentials to a third-party endpoint.     |
| 3   | Session & resume contracts  | Per-CLI, version-stamped, measured. Several flags kill the process outright on the wrong input.                             |
| 4   | Agent liveness              | Why PTY output is the wrong liveness signal **in both directions**, and the self-destroying-evidence cleanup bug.           |
| 5   | Cost attribution            | The third wiring point nobody looks at, and its diagnostic fingerprint.                                                     |
| 6   | Worktree-per-ticket hygiene | Merging is four actions, not one. Plus the three-dot diff trap.                                                             |
| 7   | Watchdog false positives    | Three checks before a respawned agent touches a file — any one alone gives false confidence.                                |
| 8   | Method                      | Version-stamp contracts; write down the hypothesis you rejected.                                                            |

## Use it standalone

Nothing here requires Marblo. It applies to any system that spawns vendor coding CLIs as subprocesses.

Read it on GitHub, or keep it where your agents can find it:

```bash
# Drop it into a repo so every agent working there can read it
mkdir -p docs/fleet-operations
curl -sL https://raw.githubusercontent.com/marblo-app/marblo/main/knowledge/fleet-operations/KNOWLEDGE.md \
  -o docs/fleet-operations/KNOWLEDGE.md
```

```bash
# Or make it a Claude Code / Codex skill you can invoke by name
mkdir -p ~/.claude/skills/fleet-operations
curl -sL https://raw.githubusercontent.com/marblo-app/marblo/main/knowledge/fleet-operations/KNOWLEDGE.md \
  -o ~/.claude/skills/fleet-operations/SKILL.md
```

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Permissions:** none (it is prose)
- **License:** CC-BY-4.0 — adapt it into your own runbooks freely.

## Contributing

Corrections and additions from other fleet operators are very welcome. The bar is the same one the pack holds itself to: **measured, not inferred**, and version-stamped when it describes a CLI contract. If your finding contradicts one of ours, say so — that is the most useful PR this pack can get.
