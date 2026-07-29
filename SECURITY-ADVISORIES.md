# Security Advisories

Public, permanent record of registry items that have been **revoked** or **deprecated for a security reason**.

Entries are never deleted. If you installed something from this registry, this is where you find out what happened to it.

> **Status of enforcement:** the `status` field and this file are the vocabulary; **app-side enforcement lands in Phase 1a** ([ROADMAP.md](ROADMAP.md) §5). Until then this file is the authoritative source and has to be read by a human. We are stating that plainly rather than implying a kill switch that is not wired up yet.

---

## Active advisories

_None. No item in this registry has been revoked._

---

## How revocation works

**1. Report.** Email **team@marblo.app** with the item `id` and what is wrong. Put "registry item" in the subject. Do not open a public Issue for an undisclosed vulnerability in an item that is still installable.

**2. Triage.** A maintainer reproduces or confirms with the upstream author. Reports about a compromised upstream are treated as urgent regardless of the item's tier.

**3. Revoke.** Two things change in the same commit:

- The item's `marblo.yaml` gets `status: revoked`.
- An entry lands in this file (format below).

The manifest is **not** deleted, and neither is the folder. A deleted manifest is indistinguishable from an item that never existed — which is exactly the wrong outcome for someone trying to work out what they installed last month.

**4. Notify.** Once Phase 1a ships, the app checks this list and prompts to uninstall affected items. Until then, revocations are announced in [CHANGELOG.md](CHANGELOG.md) and this file is the record.

## Severity

| Level        | Meaning                                                                                    | Response                       |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------ |
| **Critical** | Executes attacker-controlled code, exfiltrates credentials, or destroys data.              | Revoke immediately.            |
| **High**     | Prompt injection into a privileged agent, or an upstream repository compromise.            | Revoke immediately.            |
| **Moderate** | License misrepresentation, or an upstream that has been deleted, archived, or transferred. | Revoke or deprecate on review. |
| **Low**      | Misleading metadata or overstated permissions.                                             | Fix in place; note here.       |

## Entry format

```markdown
### MARBLO-ADV-YYYY-NNN — <item id>

- **Item:** `<id>` (`<type>`, tier `<tier>`)
- **Affected versions:** <range, or `*` for all>
- **Severity:** Critical | High | Moderate | Low
- **Status:** revoked | deprecated
- **Date:** YYYY-MM-DD
- **Reason:** one paragraph — what was wrong, in plain language.
- **Impact:** what an installed copy could have done.
- **Action:** what a user who installed it should do now.
- **Upstream:** link to the upstream advisory or issue, if one exists.
```

Reasons are written to be understood without reading the payload, and without publishing a working exploit. If the safe-to-share version of a reason is vague, it will be vague — but the **action** line is always concrete.
