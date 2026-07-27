<h1 align="center">
  <a href="https://marblo.app"><img src="assets/icon.png" alt="Marblo" width="64" valign="middle" /></a>
  Marblo
</h1>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows-6366f1?style=flat-square" alt="Supported platforms: macOS and Windows" />
  <a href="https://github.com/melocream/marblo-releases"><img src="https://img.shields.io/badge/download-desktop-0ea5e9?style=flat-square" alt="Download desktop app" /></a>
  <a href="https://marblo.app"><img src="https://img.shields.io/badge/web-marblo.app-8b5cf6?style=flat-square" alt="marblo.app" /></a>
  <a href="mailto:team@marblo.app"><img src="https://img.shields.io/badge/contact-team%40marblo.app-22c55e?style=flat-square" alt="Contact" /></a>
</p>

<p align="center">
  <strong>The live orchestrator for AI-native teams.</strong><br/>
  Describe a goal. Marblo’s orchestrator breaks it into tickets, spawns a real<br/>
  AI coding agent for each — Claude, Codex, and more — then tracks, verifies,<br/>
  and safely merges everything they ship. All from one board.
</p>

<h3 align="center">
  <a href="https://github.com/melocream/marblo-releases"><ins>⬇️ Download Marblo</ins></a>
  &nbsp;·&nbsp;
  <a href="https://marblo.app"><ins>🌐 marblo.app</ins></a>
  &nbsp;·&nbsp;
  <a href="https://marblo.app/en/guide"><ins>📖 Guide</ins></a>
</h3>

<p align="center">
  <img src="assets/hero.png" alt="Marblo — one developer, an entire team's output" width="960" />
</p>

---

## ✨ Live orchestration

The thing Marblo does that a single chat window can’t: **run a whole fleet, live.**

One orchestrator decomposes your mission, spawns the right agent per task, heals stuck agents on its own, judges each merge, and checks with you before anything lands.

<p align="center">
  <img src="assets/orchestration.png" alt="Heterogeneous agent orchestration — Claude, Codex, and Antigravity in parallel" width="920" />
</p>

> **Mission → auto ticket breakdown → per-model spawn → watchdog self-heal → merge judgment → your confirmation.**

<table>
<tr>
<td width="50%" valign="top" align="center">

**1 · Decompose &amp; assign**<br/>
Natural-language goal → tickets on the board, each with the model that fits.

<img src="assets/live-decompose.png" alt="Mission decomposed into tickets and agents assigned" width="100%" />

</td>
<td width="50%" valign="top" align="center">

**2 · Complete &amp; confirm**<br/>
Agents finish in parallel. You review, then merge — nothing lands without you.

<img src="assets/live-complete.png" alt="Work complete, ready for your confirmation" width="100%" />

</td>
</tr>
</table>

---

## Features

<table>
<tr>
<td width="48%" valign="middle">

### 📋 Board

Kanban for AI agents. Create a ticket — the right agent claims it, works in its own worktree, and the card moves with it.

You see the concrete model on every card (`claude-opus`, `gpt-codex`, `antigravity`).

[Guide →](https://marblo.app/en/guide)

</td>
<td width="52%">
  <img src="assets/board.png" alt="Marblo task board with multi-agent kanban" width="100%" />
</td>
</tr>

<tr>
<td width="48%" valign="middle">

### 🤖 Agents

A live terminal per agent. Watch stdout stream, send follow-ups without killing the session, reuse or hand off mid-run.

The orchestrator keeps the fleet healthy — watchdog self-heal when something stalls.

[Guide →](https://marblo.app/en/guide)

</td>
<td width="52%">
  <img src="assets/live-decompose.png" alt="Orchestrator assigning agents to tickets" width="100%" />
</td>
</tr>

<tr>
<td width="48%" valign="middle">

### 💻 Code

Browse and diff each agent’s work across worktrees. Review before merge — no mystery patches on `main`.

[Guide →](https://marblo.app/en/guide)

</td>
<td width="52%">
  <img src="assets/board.png" alt="Board and activity view for reviewing agent work" width="100%" />
</td>
</tr>

<tr>
<td width="48%" valign="middle">

### 🌿 Worktrees

Every ticket gets an isolated branch. Parallel agents never collide on the same files.

Fan out, compare, merge the winner.

[Guide →](https://marblo.app/en/guide)

</td>
<td width="52%">
  <img src="assets/orchestration.png" alt="Parallel agents routed from one orchestrator" width="100%" />
</td>
</tr>

<tr>
<td width="48%" valign="middle">

### 🎯 Missions

Describe the goal in natural language. Marblo turns it into a ticket graph, assigns models, and runs the fleet.

[Guide →](https://marblo.app/en/guide)

</td>
<td width="52%">
  <img src="assets/live-complete.png" alt="Mission complete — tickets done, ready to connect accounts" width="100%" />
</td>
</tr>

<tr>
<td width="48%" valign="middle">

### 📊 Usage

Cost and model usage per agent, project, and day. No more “why was this month’s API bill a surprise?”

[Pricing →](https://marblo.app/en/pricing)

</td>
<td width="52%" valign="middle">

### 🧩 Harness

Per-agent skills and MCP tools. Bring your own from a GitHub repo — connect once, every agent can use it.

[Guide →](https://marblo.app/en/guide)

</td>
</tr>

<tr>
<td width="48%" valign="middle">

### 🕘 History

An append-only ledger of progress, cost, and every merge / deploy decision. Full audit trail for the fleet.

[Guide →](https://marblo.app/en/guide)

</td>
<td width="52%" valign="middle">

### 🚀 Control plane, not just chat

Marblo is where you **manage** agents — board, isolation, cost, and safe merge — not where you wait on a single conversation.

[What is Marblo →](https://marblo.app/en/blog/what-is-marblo)

</td>
</tr>
</table>

**Also in the box**

- **Multi-model fleet** — Claude Code, Codex, Grok, GLM, MiniMax, and more CLI agents side by side
- **Safe merge** — review and verification before anything hits your main branch
- **Desktop-first** — local execution, your keys, your repos
- **Activity stream** — live structured log of who claimed what and when

---

## Why Marblo

| Pain today | What Marblo does |
| --- | --- |
| One chat, one agent, you wait | One orchestrator, many agents in parallel |
| “What’s it doing?” for 30 minutes | Live board + per-agent terminals |
| Parallel agents overwrite each other | Worktree-per-ticket isolation |
| API cost is a black hole | Usage by agent / model / day |
| Merge is trust-me | Review, verify, then you confirm |

> Agents are cheap to start. **Knowing what the fleet is doing** is the hard part. That’s the product.

---

## Download

| Platform | Get it |
| --- | --- |
| 🖥 **Desktop (macOS · Windows)** | [melocream/marblo-releases](https://github.com/melocream/marblo-releases) — latest: **v3.0.18** |
| 🌐 **Web** | [marblo.app](https://marblo.app) |
| 📖 **Guide** | [marblo.app/en/guide](https://marblo.app/en/guide) |
| 💰 **Pricing** | [marblo.app/en/pricing](https://marblo.app/en/pricing) |

> After install you’ll connect your existing AI CLIs (Claude Code, Codex, …). AI usage is billed to those accounts — not included in the Marblo fee.

---

## Links

- 🏠 Product site — [marblo.app](https://marblo.app)
- ⬇️ Releases — [github.com/melocream/marblo-releases](https://github.com/melocream/marblo-releases)
- ✉️ Contact — [team@marblo.app](mailto:team@marblo.app)
- 🧑‍💻 Founder — [@melocream](https://github.com/melocream)

---

<p align="center">
  <sub>Maintained by <a href="https://github.com/melocream">@melocream</a> · <a href="mailto:team@marblo.app">team@marblo.app</a></sub>
</p>
