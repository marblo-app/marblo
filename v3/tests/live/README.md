# Live first-run boot harness

`tests/unit/orchestrator-first-run-boot.test.ts` replays **recorded** frames.
This directory drives the **real** CLIs. Nothing here runs under `npm test` —
the vitest include is `tests/**/*.test.ts` and none of these files match, on
purpose: they spawn `claude` / `codex`, take tens of seconds, and depend on what
is installed on the machine.

Everything under `electron/` that decides what gets typed is the real module:

| real                                                     | stubbed                                            |
| -------------------------------------------------------- | -------------------------------------------------- |
| `OrchestratorManager.launch()` / `AgentManager.launch()` | `AgentConfigGenerator` (orchestrator runner only)  |
| `PtyManager` — real `node-pty`, real `writeAndSubmit`    | `electron` (`stub-electron.ts`, agent runner only) |
| `agent-input-wait` — auto-accept + first-run dialog gate |                                                    |
| `harness-manager` — login backstop + `probeCliAuth`      |                                                    |

`PtyManager.write` / `writeAndSubmit` are wrapped so **every byte we send** is
recorded with the millisecond it was sent. That list is the whole point: the
question these runs answer is "what did WE type, and when".

## Two rules

1. **Never touch the real config.** `HOME` is repointed at a throwaway
   directory, and codex gets its own `CODEX_HOME`. `harness-manager` captures
   `os.homedir()` **at module load**, so `process.env.HOME` must be set _before_
   the first `import` of any electron module — which is why every scenario runs
   in its own process and the imports are dynamic. Verify the isolation held by
   checking `probeCliAuth("codex").authenticated === false` in a fresh home.
2. **Don't press keys yourself.** The runner never writes to the pty. If a
   keystroke appears in the recorded `writes`, the product sent it.

## Running

```sh
cd v3
BAN='import{createRequire as __cr}from "module";import{fileURLToPath as __f}from "url";import __p from "path";const require=__cr(import.meta.url);const __filename=__f(import.meta.url);const __dirname=__p.dirname(__filename);'
./node_modules/.bin/esbuild tests/live/runner.ts --bundle --platform=node \
  --format=esm --target=node22 --external:node-pty --banner:js="$BAN" \
  --outfile=node_modules/.cache/mb-live/runner.mjs
node node_modules/.cache/mb-live/runner.mjs <scenario> /tmp/out.json
```

`esbuild` rather than vitest because each scenario needs its own process with
its own `HOME`, and the banner exists because `agent-config.ts` uses
`__dirname`. The bundle has to live under `v3/` so the external `node-pty`
still resolves. The agent runner additionally needs
`--alias:electron=./tests/live/stub-electron.ts`.

### Scenarios (`runner.ts`)

| id                        | machine state                                      | what it answers                                |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `s1-claude-virgin`        | empty `HOME`                                       | theme picker → …?                              |
| `s1b-claude-onboarded`    | `.claude.json` = `{hasCompletedOnboarding, theme}` | folder trust → …?                              |
| `s1c-claude-consent-only` | dir trusted, consent re-armed                      | ★the screen PR #1070 auto-accepts              |
| `s2-claude-returning`     | trusted + consent accepted                         | regression: does a normal boot still work      |
| `s3-codex-authed`         | `auth.json` symlinked, dir pre-trusted             | does the prompt reach the REAL composer        |
| `s4-codex-unauthed`       | empty `CODEX_HOME`                                 | ★do we type anything into the login menu       |
| `r-quote-in-composer`     | stand-in CLI, ready from byte one                  | ★does auto-accept fire OUTSIDE the boot screen |

`s1c` / `s2` need a home that already answered the dialogs once. Build it with
`node tests/live/setup-homes.mjs` — the only script here that presses a key, and
it presses them as the USER (standing in for "they ran `claude` once by hand"),
never as the product.

`agentrunner.ts` is the same question for the **worker** path
(`AgentManager.launch()`). It mattered because `looksLikeFirstRunDialog` was
wired to the orchestrator only — the worker typed a 6,447-char instruction into
claude's folder-trust dialog at 10068 ms and then reported itself `working`
(ticket `f6t9trvIVBvAfEKvtFrt`). Both halves now import the same gate.

★Since `claude-workspace-trust.ts` landed, `launch()` pre-empts the trust key
before the spawn, so on a new worktree the dialog **no longer renders** — a1 now
measures a clean boot rather than the accident. `a3` is the scenario that still
exercises the gate: it holds claude's own `<config>.lock` for the whole run, so
the pre-emption loses the race exactly as it does on a machine with live claude
sessions, and the dialog comes back. Nothing in the product is stubbed for it.

| id             | machine state                                | ★PASS is                                |
| -------------- | -------------------------------------------- | --------------------------------------- |
| `a1` (default) | new worktree; pre-emption succeeds pre-spawn | composer at ~0.5 s, instruction sent    |
| `a2`           | same home, that directory pre-trusted        | the instruction IS delivered            |
| `a3`           | new worktree + `<config>.lock` held → dialog | writes 0, never `working`, then `error` |

```sh
node node_modules/.cache/mb-live/agentrunner.mjs a3 /tmp/a3.json
```

a3 runs 80 s on purpose — the hold's give-up window is 60 s counted from the PTY
SPAWN (the same basis the orchestrator uses; counting from the held send would
add each harness's blind fallback on top and make the shared constant mean 70 s
here and 60 s there). A 30 s run would stop before the error it exists to
observe. a1/a2 deliver in ~2 s and run 30 s.

## Re-arming the screens

- **claude bypass consent** — machine-wide, recorded as
  `skipDangerousModePermissionPrompt` in `~/.claude/settings.json`. Delete that
  key to see the screen again.
- **claude folder trust** — **per directory**, recorded as
  `projects["<dir>"].hasTrustDialogAccepted` in `~/.claude.json`, keyed by the
  **realpath** (write `/var/folders/…` on macOS and the CLI, which resolved its
  cwd to `/private/var/folders/…`, never sees it — measured). A directory under
  an already-trusted ancestor does NOT prompt; a sibling does. Point a run at a
  brand-new directory to see it again.
- **codex folder trust** — pre-empted by `trust_level = "trusted"` in the
  isolated `CODEX_HOME/config.toml` (agent-config.ts writes it).
- **codex login menu** — an isolated `CODEX_HOME` with no `auth.json`.
