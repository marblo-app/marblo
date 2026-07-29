# korean-docs (referenced)

A single-file, prompt-only skill that writes Korean technical documentation to a written-down convention instead of to the model's default instincts. The rules are concrete:

- **What stays in English** — language names, frameworks, tools, protocols, and established concepts (hook, middleware, context, state) are not translated.
- **What gets translated** — general technical vocabulary (배포, 설정, 의존성) and action verbs.
- **Register** — 경어체 ("실행합니다"), not 해라체.
- **Sentence style** — active voice, no padding ("환경 변수를 설정합니다", not "…설정하는 것이 필요합니다").

That English-vs-Korean term boundary is the part worth having written down: it is the decision an agent gets wrong most often in Korean technical prose, and getting it wrong in either direction — translating `hook` or leaving 배포 in English — reads as machine output immediately.

## How this differs from the other Korean writing items here

[`korean-skills`](../korean-skills/) corrects prose you already have; [`fluent-korean`](../fluent-korean/) changes the agent's own speaking voice everywhere. This one is narrower than both: it is a convention for one genre, technical documentation — READMEs, API docs, guides.

## Referenced, not vendored

**No files from this skill live in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a tag.

- **Upstream:** [roboco-io/plugins](https://github.com/roboco-io/plugins) — a 23-skill plugin collection; this manifest references one skill inside it.
- **Pinned at:** tag `v0.3.0` · **path:** `plugins/documentation/skills/korean-docs`

`v0.3.0` is an annotated tag (`6d75408d00ba3f63db687500f15ab3aa9cb82d67`) that dereferences to commit `0938adeefa13d462c236e89876ce7849615ed8f6`.

## Why it is listed here

**Measured 2026-07-29:** 19 stars on the parent repo · last upstream push 2026-07-12 · MIT · `v0.3.0` released 2026-04-20.

Low adoption, and the honest framing is that most of the parent repo is generic (development, security, workflow plugins) — `korean-docs` is the Korean-specific part, which is why this manifest points at that path rather than at the repo. It is listed because writing Korean technical documentation to a fixed convention is a real recurring job with almost nothing else covering it, and because the skill is 137 lines of explicit rules you can read in full before installing.

## Installing it standalone

It is one `SKILL.md` with no dependencies:

```bash
# Clone at the pinned tag and copy the one skill
git clone --branch v0.3.0 https://github.com/roboco-io/plugins /tmp/roboco-plugins \
  && cp -r /tmp/roboco-plugins/plugins/documentation/skills/korean-docs ~/.claude/skills/

# Codex — same file, its skills directory
cp -r /tmp/roboco-plugins/plugins/documentation/skills/korean-docs ~/.codex/skills/
```

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read` only — a single markdown file, no scripts, no network.
- **License:** MIT (upstream, verified via the GitHub license API)
