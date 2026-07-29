# k-skill (referenced)

The largest Korean-language skill collection we found: **122 skills** at the pinned commit, one directory each, covering the everyday and administrative services a person in Korea actually has to deal with. Booking (`srt-booking`, `ktx-booking`, `express-bus-booking`), living (`delivery-tracking`, `korea-weather`, `fine-dust-location`, `seoul-subway-arrival`, `lotto-results`, `kbo-results`), search (`korean-law-search`, `korean-patent-search`, `joseon-sillok-search`, `library-book-search`), and a substantial business/administrative block — `nts-business-registration`, `nts-tax-delinquency`, `biz-health-check`, `national-pension-workplace`, `g2b-order-plan-search`, `popbill` (전자세금계산서), `korean-jangbu-for` (장부).

한국 생활·행정 서비스를 에이전트에게 시키는 스킬 122종. 예매·조회·검색부터 사업자 실사와 전자세금계산서까지.

## How this differs from the other Korea items here

`k-skill` is **breadth**: many small skills, each wrapping one Korean service surface. The other Korea entries are **depth** in one job — [`korean-legal-doc-drafter`](../korean-legal-doc-drafter/) drafts legal documents, [`hwpx-editing`](../hwpx-editing/) and [`hwpx-plugins`](../hwpx-plugins/) edit `.hwpx`, [`korean-skills`](../korean-skills/) fixes Korean prose. They overlap at the edges (k-skill also ships `korean-spell-check`, `korean-humanizer`, and `hwp`/`rhwp-edit`), and where they do, the focused item is the more developed one.

## Referenced, not vendored

**No files from this skill live in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [NomaDamas/k-skill](https://github.com/NomaDamas/k-skill)
- **Pinned at:** `42473dad91ca919fd21d6d8b7fc6dbae3fa48b2c` — the `main` HEAD as measured. The repo's one tag, `manus-bundle-latest`, is a moving bundle pointer rather than a release, so it is not a valid pin.

## Why it is listed here

**Measured 2026-07-29:** 6,526 stars · last upstream push 2026-07-29 · MIT · 122 top-level `SKILL.md` directories at the pinned commit. It is by a wide margin the most-adopted Korean agent-skill repository we measured, and it is still being pushed to daily.

Note that the pinned `main` commit is dated 2026-07-24 while repository activity registers 2026-07-29 — the newer pushes are on other branches. The pin is the reviewed `main` commit, not the newest byte upstream.

## Installing it standalone

Each skill is a self-contained directory at the repo root, so copy only the ones you want:

```bash
# Clone at the pinned commit
git clone https://github.com/NomaDamas/k-skill /tmp/k-skill \
  && git -C /tmp/k-skill checkout 42473dad91ca919fd21d6d8b7fc6dbae3fa48b2c

# Claude Code — pick individual skills
cp -r /tmp/k-skill/korean-spell-check /tmp/k-skill/delivery-tracking ~/.claude/skills/

# …or take everything (122 skills is a lot of skill-description context to load)
cp -r /tmp/k-skill/*/ ~/.claude/skills/
```

Upstream also ships `k-skill-setup` and `k-skill-cleaner` skills for managing the set, and documents a `k-skill-proxy` hosted fallback. Read `docs/features/<skill>.md` upstream before using any skill that books, pays, or files something.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec` (skills ship Python/Node scripts), `network:outbound` (nearly every skill calls a Korean public API or web surface), `secrets:read` (upstream's own table marks 사용자 로그인 **필요** for SRT/KTX booking, 등기부등본 automation, `popbill`, and others — those need your credentials).
- **License:** MIT (upstream, verified via the GitHub license API)
- **Read before you run it:** this set automates real transactions — train booking, court filings (`court-payment-order-assistant`), registry lookups that cost money. Several skills hand off to a browser for manual login and payment by design. Some wrap third-party surfaces whose own terms restrict commercial or automated use; `korean-spell-check`, for instance, documents upstream that the speller it calls is free for individuals and students only. Check the specific skill's terms before using it commercially.
