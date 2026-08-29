# Team Seat Enforcement Design (2026-08-29)

## Verdict

Team collaboration is sold as seat-based but currently enforced as a boolean feature gate. The immediate fix should be design-first: keep existing members working, block only new billable-member invites when seats are exhausted, and route enforcement through one server-side invitation callable.

No runtime enforcement is added in this ticket.

## Re-verified Observations

- `marblo-web/src/components/PricingSection.tsx:31-65` says Team is billed per-seat and renders Team periods as `/인/월`, `/人/月`, `/seat/mo`; Team Plus is a per-team floor with 5 seats included.
- `marblo-web/src/lib/pricing.ts:30-36` prices Team at KRW 29,000 / USD 25 / JPY 3,980 monthly and Team Plus at KRW 290,000 / USD 245 / JPY 39,800 monthly.
- `v3/src/lib/planLimits.ts` has `maxProjects`, `maxAgents`, and boolean `hasTeamCollab`, but no member-count enforcement.
- `v3/functions/src/githubApp.ts:95-134` gates inherited GitHub App token issuance with `planHasTeamCollab(ownerPlan)` only. It checks whether collaboration is available, not how many billable seats exist.
- `v3/firestore.rules:241-258` allows admin/owner `members` updates and invited self-join, but has no seat cap or paid-seat counter.

Root cause: `hasTeamCollab` answers only "can this owner use team collaboration?" Seat quantity is not represented in the authorization path, so price semantics and enforcement semantics drifted apart.

## Five Decisions

1. Count seats at invite acceptance / member-add time, not at active-use time.
   Recommendation: count before a new non-viewer member is admitted to `projects.members`.
   Reason: active-use counting creates surprising mid-work failures. Invitation/member-add is the least disruptive boundary because a user who was working yesterday keeps working today.

2. When seats are exceeded, block new billable-member invites and keep existing members.
   Recommendation: reject only the new invite or role-upgrade that would exceed the purchased seats; notify the owner with current count and required seats.
   Reason: retroactively locking repository token issuance would read as an outage. The failure must land on the administrative action, not on an existing teammate's next clone/fetch/push.

3. When seats increase mid-cycle, bill prorated from the change time.
   Recommendation: the billing implementation should create or update the provider subscription quantity immediately and let the provider prorate when supported; otherwise record a local `pendingSeatQuantity` and charge the prorated delta in the next invoice job.
   Reason: Team is sold per-seat, so waiting until the next billing date under-collects for added users and makes revenue leakage depend on timing.

4. Team Plus includes 5 seats; the 6th and later bill as overage seats.
   Recommendation: Team Plus should allow 5 billable non-viewer seats at the floor price. Seat 6+ requires an explicit paid overage quantity before accepting the invite. Existing copy already describes Team Plus as a 5-seat floor and local billing copy references extra-seat pricing.
   Reason: this preserves the floor SKU while keeping expansion revenue tied to actual team size.

5. Viewers do not consume seats.
   Recommendation: count `owner`, `admin`, and `member`; exclude `viewer`.
   Reason: read-only viewers are commonly free in SaaS products, and charging them discourages low-risk review/visibility workflows. The existing GitHub App role gate already treats viewers as read-only: read tokens pass, write tokens are denied.

## Single Enforcement Point

Use the invitation/member-management callable as the single enforcement point.

Do not enforce seat caps in GitHub App token issuance. That path is for repository access by existing members, and blocking it would create the worst failure mode: a paid team member suddenly cannot fetch or push. `githubApp.ts` should keep mirroring the seat policy constants for drift detection only.

Do not enforce seat caps only in `firestore.rules`. Rules cannot safely count billable roles across `members` plus `memberRoles` with the product messaging and billing side effects needed for upgrade prompts. Rules should remain a backstop after the callable migration, but the product decision and billing update must live in one server callable.

The callable should become the only writer for adding billable members. It should use a Firestore transaction over the project document, relevant `memberRoles`, and a seat-entitlement document/field, then write the invitation/member change only if the billable seat count is within the purchased quantity.

## Current Exposure

Measured on 2026-08-29 with Firestore REST aggregate output only; no UIDs, emails, project IDs, tokens, or raw documents were printed.

| Metric                                       | Value |
| -------------------------------------------- | ----: |
| Active paid Team customers                   |     0 |
| Active paid Team Plus customers              |     0 |
| Active paid Enterprise customers             |     0 |
| Projects owned by active paid team customers |     0 |
| Total project member slots in those projects |     0 |
| Max members on one such project              |     0 |
| Current confirmed monthly leakage floor      | KRW 0 |

There is no confirmed current paid-team leakage, but the public price is already seat-based, so this should be closed before the first paid team customer.

## Constant / MIRROR Contract

This ticket adds count semantics only:

- Team includes 1 billable seat.
- Team Plus includes 5 billable seats.
- Enterprise is unlimited by default until a negotiated contract model exists.
- Viewers do not consume seats.

`v3/src/lib/planLimits.ts` is the desktop-side canonical source. `v3/functions/src/githubApp.ts` mirrors those values because the functions package cannot import the desktop src package. Tests pin the mirror relationship so future seat work does not silently drift.

## Follow-up Implementation Tickets

1. Invitation callable enforcement
   - Add a callable for creating/accepting invites and role upgrades.
   - Count billable roles (`owner`, `admin`, `member`) in a Firestore transaction.
   - Block only new billable additions when purchased seats are exhausted.
   - Preserve existing members even if the account is currently over capacity.

2. Billing quantity source
   - Add a subscription seat quantity source for Team and Team Plus overage.
   - Wire Paddle/Toss/PortOne quantity changes with proration semantics.
   - Keep price amounts in pricing/billing sources, not in GitHub token logic.

3. Firestore rules backstop
   - After the callable owns member writes, restrict direct `projects.members` additions and invited self-join paths to server-mediated writes.
   - Keep rules as integrity protection, not as the product billing brain.

4. Owner UX and notifications
   - Show seats used / seats purchased in team management.
   - On blocked invite, present the upgrade/seat-increase path.
   - Notify owners when existing members exceed purchased seats due to migration or manual admin correction, without locking members out.

5. Migration and audit
   - Backfill a billable-seat snapshot for existing team projects.
   - Report over-capacity projects to owners and internal admin analytics.
   - Add analytics for blocked invites, seat increases, and overage conversion.
