# jobstack (referenced)

A Claude Code skill system for a Korean job search, 16 `SKILL.md` files at the pinned commit, wired together by slash commands: `/strategy` → `/company_research` → `/resume` · `/cover_letter` → `/review` → `/mock_interview`, with `/track` for application status. Public-sector applicants get NCS competency mapping folded into the cover-letter step.

한국 취업 준비 전 과정 — 기업분석, 이력서·자소서 첨삭, NCS 역량 매핑, 포트폴리오 리뷰, 연봉 분석, 모의면접.

## Why it is listed here

Korean hiring documents are their own genre. 자기소개서 is not a cover letter, NCS competency statements are a public-sector-specific form with their own rubric, and the review conventions are local. A global career-advice skill does not carry any of that.

Upstream states the method comes from 60+ 자소서 reviews over four years by the author. That is the author's claim about their own experience — we list it as such, and it is not something a registry can verify.

**Measured 2026-07-29:** 33 stars · last upstream push 2026-07-20 · MIT · 16 `SKILL.md` files at the pinned commit. Modest adoption; listed on the coverage and structure of the workflow rather than on traction.

## Referenced, not vendored

**No files from this skill live in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [thesun4sky/jobstack](https://github.com/thesun4sky/jobstack)
- **Pinned at:** `a5ef5ed8df2840e08bb7f2d2ab7fbab679bb3eff` (no upstream git tags)

## Installing it standalone

```bash
# Clone at the pinned commit
git clone https://github.com/thesun4sky/jobstack /tmp/jobstack \
  && git -C /tmp/jobstack checkout a5ef5ed8df2840e08bb7f2d2ab7fbab679bb3eff

# Claude Code — each top-level directory with a SKILL.md is one skill
cp -r /tmp/jobstack/resume /tmp/jobstack/cover-letter /tmp/jobstack/mock-interview ~/.claude/skills/
```

Upstream ships `install.sh`; read it before running, as with any install script. The `bin/` helpers are Node and Python and need a local runtime.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read`, `filesystem:write` (it drafts and edits your documents), `shell:exec` and `network:outbound` (`bin/fetch-jobs.mjs`, `bin/wanted-verify.mjs`, `bin/is-fetch.py` pull job postings from Korean job boards). The skills declare `allowed-tools` including `Bash`, `Write`, and `Edit`.
- **License:** MIT (upstream, verified via the GitHub license API)
- **What you are handing it:** your résumé, your employment history, and the companies you are applying to. That is unusually personal input for a skill. Decide deliberately which agent and which model that goes to.
