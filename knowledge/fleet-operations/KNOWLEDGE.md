# Fleet Operations

**Running a heterogeneous fleet of agent CLIs in production — what breaks, and why.**

Most agent documentation assumes one CLI, one model, one session. This pack is about the other case: several different vendor CLIs running in parallel, against real tickets, on the same machine, all day. That configuration has its own failure modes, and almost none of them are documented anywhere — you find them by running it.

Everything here is **measured**, not inferred. Where a finding depends on a specific CLI version, the version is stated, because these contracts drift between releases. Where our first guess was wrong, the wrong guess is included — the wrong guess is usually the more useful half.

**Harness-neutral.** Nothing here requires Marblo. It applies to any system that spawns vendor coding CLIs as subprocesses: a shell script, a CI runner, your own orchestrator.

---

## 1. Adding a vendor is two different jobs, and they differ by ~10x

When a new vendor appears, the first question is not "is it any good." It is **which shape of integration it needs**, because the two shapes cost wildly different amounts.

- **Shape A — a new harness.** The vendor ships its own CLI with its own auth, its own config format, its own session store, its own cost reporting. Every place your code branches on "which harness is this" has to grow a case. In our codebase, the literal name of one existing harness appeared in **52 places across 18 files**. That is the price of one Shape A vendor.
- **Shape B — a provider profile.** The vendor exposes an Anthropic-compatible endpoint, so you keep spawning the CLI you already spawn and swap **three environment variables**. Catalog, auth probe, spawn logic, MCP config generation, cost parser: zero lines. Our first Shape B vendor landed as **two rows of registry data and no code**.

### The discriminator is not what you think

Our first rule was _"does the vendor ship its own CLI?"_ — if yes, Shape A. **That rule is wrong**, and it cost us a survey that mispredicted an 18-file integration for a vendor that turned out to need three rows of data.

The rule that actually holds:

> **Does the vendor's _subscription_ open an Anthropic-compatible endpoint?**

Not "does an Anthropic-compatible API exist" — many vendors have one behind a _pay-per-token_ key that is a different product from the coding subscription. The question is whether the thing the user is already paying for opens that endpoint.

A vendor can ship a perfectly good native CLI _and_ still be Shape B, because its subscription also documents third-party tool use. One vendor we integrated has its own CLI, its own installer, its own rewrite in Node — and landed as Shape B anyway, on the strength of one sentence in its docs: _subscribers can also obtain an API key to integrate into third-party development tools._

Conversely, a vendor whose CLI authenticates **through the browser** is telling you its subscription lives behind an account session, not behind a portable key. That is Shape A.

**How to check, in order:**

1. Does the vendor document an Anthropic-compatible base URL (`/v1/messages`)?
2. Do the credentials for that URL come from the **coding subscription**, or only from a separate metered API product?
3. Does the vendor publish a Claude-Code-specific setup guide? (This is the strongest single signal — vendors that want the compatibility path advertise it.)

Two out of three yes → Shape B. Otherwise budget for Shape A.

### A related trap: subscription vs. metered is decided by the auth method

A vendor's public API price list tells you nothing about whether their _CLI_ is a subscription. We dropped a vendor as "pay-per-token" on the strength of its API pricing page, and were wrong: its CLI authenticates in the browser against an account plan, exactly like the first-party CLIs. The pricing page described a different product from the same company.

> **Rule:** classify by **how the CLI authenticates** — browser/account login means a subscription harness; an API key pasted into an env var means metered billing. Read the auth flow, not the pricing page.

### Local models ride the same axis

"Add local models" sounds like a new harness. It is not. A local runtime that implements the Anthropic Messages API (Ollama does, and its own docs point at Claude Code) is **Shape B with a localhost base URL** — the same three env vars, one row of data.

Two things that actually bite with local models:

- **Context length is the binding constraint, not model quality.** Default context windows scale off available VRAM and land far below what coding tools need. A machine in the 24–48 GiB band gets a default well under the 64k+ that coding agents want; the runtime's context setting has to be raised explicitly before anything else matters.
- **A `:cloud`-suffixed model is not local.** Those are the vendor's hosted tier on a paid plan with concurrency limits. Treating them as marginal-cost-zero poisons any cost model you build on top.

---

## 2. Env-swap wiring: four rules that are not optional

Shape B looks trivial — set three variables and go. These four rules are where the bodies are buried.

### 2.1 All-or-nothing credential injection

If you inject the vendor's base URL but the token fails to resolve — missing from the environment, typo'd variable name, unexpanded placeholder — the CLI does not fail. **It falls back to the credentials it already has and sends _your first-party API credentials_ to the third-party endpoint.**

That is a credential disclosure caused by a _partial success_, which is the worst kind, because nothing errors.

> **Rule:** treat a vendor profile as a single atomic unit. If any required variable in the profile is unresolved, inject **none** of it and fall back to the default provider. Never let a base URL travel without its token.

Store secrets in the registry as **placeholder references** (`${VENDOR_API_KEY}`), resolve them in exactly one place, and make the resolver reject partially-interpolated values — a value that is half literal and half placeholder is always a bug.

### 2.2 `ANTHROPIC_AUTH_TOKEN`, not `ANTHROPIC_API_KEY`

Several vendors' own docs tell you to set `ANTHROPIC_API_KEY`. For an **interactive** spawn, prefer `ANTHROPIC_AUTH_TOKEN`.

Reason: the API-key variable can route the CLI through an interactive _"use this API key?"_ approval prompt. In a terminal a human is watching, that is a small annoyance. In a spawned PTY nobody is watching, the process **hangs at a prompt forever** and looks like a stalled agent. We measured gateway-side support for both `x-api-key` and `Authorization: Bearer`, so the auth-token path costs nothing and avoids the prompt entirely.

### 2.3 Environment variable names collide across a vendor's own products

The same company will ship two different products with two different base URLs, two different model ID namespaces, and two similarly-named key variables — a coding **subscription** console and a metered **platform** API. Naming your variable after the company instead of after the _product_ means the two accounts' credentials eventually get sent to each other's backend.

> **Rule:** if the base URL differs, the model IDs and the credential are different too. Name env vars after the product, never after the vendor.

### 2.4 The forgotten variables leak model names

A vendor profile is usually documented as three variables — base URL, token, and a default-model mapping. Vendors differ in **how many** model-role slots they expect you to map. If your fleet uses a role the vendor's example omits (a lightweight subagent model, an extra tier), copying the three-variable example verbatim leaves that role **unmapped**, and requests for it go out to the vendor's endpoint carrying a _first-party model name the vendor has never heard of_.

Symptom: most work succeeds; one specific class of call fails or silently degrades.

> **Rule:** enumerate every model-role env var your spawner can emit, and require the vendor profile to map **all** of them or fail the profile.

### 2.5 Not every path a vendor model can reach is safe

Some selection paths **persist**. If your orchestrator remembers the chosen model per project, a model that requires credentials the user does not have will be resurrected on every restart, forever. A model that is only reachable via explicit per-task assignment has a blast radius of one ticket; a model reachable from a persisted selector has a blast radius of "until someone notices."

> **Rule:** new vendors join the explicit-assignment path first. They join automatic selection and persisted selectors only after their credential path is proven live.

---

## 3. Session and resume contracts are per-harness, and hostile

There is no shared resume convention across agent CLIs. Each one has its own, several of them kill the process on the wrong input, and the flag names look similar enough that you will assume they behave alike. They do not.

Measured contracts:

| CLI (version measured) | Flag                    | Behavior                                                                                                         |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Codex CLI **0.144.5**  | `resume <unknown-uuid>` | **exit 1, immediately.** Error wording differs between TUI and exec modes — do not assert on the message string. |
| Codex CLI **0.144.5**  | `resume --last`         | **Graceful.** Boots a fresh session even in a home directory with zero sessions. This is the correct default.    |
| Grok CLI **0.2.112**   | `--session-id <uuid>`   | **New sessions only.** If that ID already exists: `already in use`, instant death.                               |
| Grok CLI **0.2.112**   | `--resume <uuid>`       | Searches the whole home, cwd-independent. **An unknown ID hits a remote registry and 404s → instant death.**     |
| Grok CLI **0.2.112**   | `--continue`            | Most recent session **for the current directory**. In a directory with no session: instant death.                |
| Claude Code            | `--resume <uuid>`       | Keyed off its own project-scoped session store.                                                                  |

Three rules fall out of this table:

**3.1 Never pass one CLI another CLI's session ID.** This sounds too obvious to state. It is the single most expensive bug we hit in this area: a resume-ID resolver written for one harness, called without model awareness, fed that harness's UUIDs to a different harness — which died on startup **every restart**. It presented as "restarts are broken but switching works," because the switch path happened to be model-aware and the restart path was not.

> Whenever you add a resume path, check every _other_ place that already resolves a session ID and confirm each is model-aware. Copy the shape of the one that already got it right.

**3.2 Gate every resume flag on the precondition it silently requires.** `--continue` needs a session in this cwd. `--session-id` needs the ID to _not_ exist. `--resume` needs the ID to exist _and_ be resolvable. Each precondition failure is a process death, not a warning — so check before you spawn.

**3.3 Session keying is by literal working directory** — for at least one CLI, sessions live under an encoding of the actual cwd. Under git worktrees this means each worktree keeps its own session history.

Do not confuse this with **folder trust**, which is a _different_ rule in the same CLI: trust decisions can normalize a worktree back to the main checkout, so registering the worktree path alone leaves it untrusted and local tooling silently fails to start. Two rules, two different path semantics, one CLI. Untangling them cost a day.

Also: a `prompt_history` file next to the session directories is **not** a session. Counting it makes "does this directory have a session?" return true when the answer is no, and then `--continue` kills the process.

**3.4 Per-agent home isolation makes `--last`-style flags safe.** We assumed agents sharing a machine would steal each other's "most recent session." They do not, provided each spawn gets an isolated home directory — "most recent" is then always scoped to that agent. We tested this specifically because it seemed obviously dangerous; it was a false hypothesis, and `--last` is the right answer for the CLI that offers it.

---

## 4. "The agent is working" is a derived signal, and it is wrong in both directions

The intuitive implementation of agent liveness is: bytes came out of the PTY, so it is working. This is wrong **symmetrically**, which is what makes it hard to spot — you fix one direction and the other gets worse.

- **Finished agents look busy.** A CLI sitting at an idle prompt repaints its spinner and cursor forever. Every repaint re-promotes it to "working." A settle window only delays the misclassification.
- **Working agents look idle.** _An agent that is reasoning produces no PTY output at all._ Any inactivity timeout will eventually mark a genuinely-working agent as idle — and then your orchestrator hands it more work, or reclaims it mid-task.

> **Rule:** define a turn by its **boundaries**, not by its noise. A turn _starts_ on submitted input and _ends_ on an explicit completion report. Output is a hint, never the state.

Two details that are easy to miss when implementing that:

- **Human input counts.** If a person types into the agent's terminal directly and only programmatic submissions open a turn, manual sessions get stuck in idle forever. Open a turn on carriage return from any source (individual keystrokes do not count — they may be mid-composition in an IME).
- **Emit the turn-start event when the input is accepted, not when it flushes.** Queued/async write paths mean a flush-time event arrives after the state that depends on it has already been read.

### The self-destroying evidence pattern

A related bug worth naming because it generalizes far beyond agents:

Our reclamation logic required an agent to have a bound task ID to be eligible for reclamation. Our completion handler cleared the bound task ID as its first act. **The event that made an agent eligible for cleanup destroyed the evidence cleanup needed** — so agents that finished _cleanly_ became permanently unreclaimable, while only messily-dead ones got collected. Load average reached 44 on a 12-core machine with 11 zombie agents, while the cleanup tool reported "no reclaimable agents found."

> **Rule:** when a cleanup gate depends on state X, check whether the normal, happy-path completion of the work also clears X. Preserve the evidence under a separate key at unbind time.

And the corollary we explicitly rejected: _"no binding + idle a long time → reclaim."_ Do not do this. Agents that are still booting, and agents whose binding was never recorded, are indistinguishable from finished ones under that rule. **Absence of evidence is not evidence of completion** — report them as suspect, never reap them.

---

## 5. Cost attribution breaks in a place you will not look

Adding a new harness to per-agent cost tracking looks like two jobs: a **parser** for that CLI's usage format, and a **routing** rule that sends its sessions to the tracker. Both obvious, both easy.

There is a **third** wiring point, and it is the one that fails silently: whatever fires the _"start tracking this session"_ kickoff when an agent is spawned. In our system that kickoff was gated on an explicit list of harness names. A new harness landed with a working parser and working routing, was absent from the kickoff list, and therefore **no tracker was ever created**. Zero cost rows. The usage data sat perfectly intact in the session files the whole time.

This is a bug you cannot find by reading the parser or the routing code, because both are correct.

**The diagnostic fingerprint:**

- Events and task outcomes appear normally; **only** the cost table is empty for that harness.
- **New spawns lose data but reconnections do not** — cold-boot reconnection paths usually pass the model through from stored state, so they accidentally take a different branch. This asymmetry is the tell.

> **Rule:** make the set of cost-tracked harnesses a **single source of truth** that the parser, the router, and the spawn kickoff all read. A harness list that appears in three places will differ in three places.

### Related: unregistered model IDs invent costs

If your price lookup returns a **default rate** for an unknown model ID, every model you have not registered gets billed at that default. A free local model then accrues a mid-tier hosted price, and your routing learns to avoid the cheapest thing you own.

> **Rule:** an unknown model ID is a **zero-with-a-warning**, or a hard error. Never a silent default price. Fix this _before_ onboarding free or local models, not after.

---

## 6. Worktree-per-ticket hygiene

Worktree-per-ticket is the right isolation primitive for parallel agents: each ticket gets its own branch and its own directory, so two agents never fight over the same file. The operational cost is bookkeeping, and the bookkeeping fails in specific ways.

### 6.1 Merging is not one action, it is four

Merging a PR leaves three other pieces of state stale. Do all four together, every time, or they accumulate into a queue of things that _look_ like unfinished work:

1. Merge the PR (deleting the remote branch).
2. Sync the local default branch (`pull --ff-only`).
3. **Flip the ticket to done.** Submitting for review only moves a ticket to _review_; the merge happens through a different tool entirely, and nothing connects the two. This is the step everyone skips. We once merged 9 PRs in a day and left 13 tickets sitting in review, which later read as "needs merging" and got re-investigated.
4. **Prune worktree registrations.** Even when the worktree _directory_ is removed automatically, git's registration metadata survives as a stale entry.

### 6.2 Merged code is not always finished work

Some tickets are legitimately not done when their code merges — the code shipped but the data backfill needs credentials, or the change is live but a dashboard rule awaits approval. Flipping those to done because the PR merged loses the remaining work. State the residual explicitly in the ticket comment instead.

### 6.3 Three-dot diffs lie about stale branches

If a branch is behind the default branch, a three-dot diff (`main...branch`) reports changes that are not the branch's work. Use a merge-base comparison, or rebase before judging. A branch created from an old base will otherwise appear to _delete_ large amounts of code it never touched.

### 6.4 Never auto-remove a worktree with uncommitted changes

Agents leave untracked files — build artifacts, but also real work not yet committed. Look before removing.

Relatedly: agents working in isolated worktrees can clobber _untracked_ files that exist only in a shared checkout. The signature is a document mysteriously losing content during a review pass. Commit early and often in agent workflows; uncommitted work has no protection against a parallel agent.

---

## 7. Watchdog false positives: the agent you are replacing may be alive

Any supervisor that respawns "stalled" agents will eventually respawn one that is fine. If the replacement starts writing immediately, you get clobbered files and duplicate PRs.

Before a respawned agent touches a single file, run **three** checks. Any one of them alone produces false confidence:

1. **Branch and PR.** Does a branch matching this ticket's ID already exist, and is there an open PR from it? A `+` marker in the branch list means it is checked out in another worktree — someone else's worktree. If there is an open PR, the work is already **submitted**. Stop.
2. **File mtimes.** Compare the target files' mtimes to now. Modification times advancing in a source → test staircase, seconds apart, mean a live writer. Stop.
3. **Live processes.** mtimes alone are not enough: an agent running a multi-minute build (native toolchains especially) is completely silent on disk while very much alive. Match running processes against the worktree path. We watched an agent look dead for 3 minutes while it was verifying its own output with a build.

If any check says alive: **stand down completely.** Do not write, and do not submit or fail the ticket on the other agent's behalf — just record that you stood down. Taking over is only correct when output has genuinely stopped _and_ the work is verifiably complete.

One more signal, free and reliable: if your file-write tool refuses because _"the file has not been read yet,"_ that file already exists — someone else created it. That is a clobber warning one keystroke before the damage.

---

## 8. How to read findings like these

Two habits that made this pack possible, offered as method rather than fact:

**Version-stamp every CLI contract.** Every resume flag, every error string, every config format in §3 is true of one release. Vendors change these without ceremony. A finding without a version number is a finding you cannot re-verify later.

**Write down the hypothesis you rejected.** Half the entries here exist because a plausible theory was wrong: "the vendor ships a CLI so it needs a new harness" (wrong), "agents will steal each other's most recent session" (wrong), "the cost bug is in the parser" (wrong), "no output means the agent is dead" (wrong in both directions). The rejected hypothesis is what stops the next person re-deriving it — and in every one of these cases, the wrong theory was the _intuitive_ one.

---

## License

CC-BY-4.0. Take it, adapt it, ship it in your own runbooks. Corrections and additions from other fleet operators are very welcome — open an Issue or a PR.
