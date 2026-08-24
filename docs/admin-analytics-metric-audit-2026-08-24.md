# Admin Analytics Metric Audit - 2026-08-24

Scope: `marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx`.
This is the split-PR audit for "remove unnecessary admin analytics noise and make the remaining data honest." No new BigQuery measurement was run; the checks below use the facts supplied by orchestration on 2026-08-24.

## Known Facts To Preserve

- Token-spending accounts: 5 total = 1 admin + 4 non-admin.
- Activation funnel: app first run 577 -> first spawn 18 (3.1%) -> first task completed 2. The primary product problem is 96.9% pre-spawn loss.
- `analytics_install_profile`: 608 rows; 591 rows have no UTM/referrer; active rows 43.
- Retention cohort base: N=6; outside cohort window 29; D14 = 2/3. One user changes the rate by 33 percentage points.
- "33 non-admin users" is not a signup count. It is 33 `founderGrant` holders.
- Person axis exists: `analytics_user_install` has 3 people / 4 installs. The old zero was a key-space mismatch and is fixed by #1171/#1175.

## Classification

Legend:
- OK: number and label match.
- Rename/definition: number may be right, but the visible name or denominator invites the wrong reading.
- Empty-state: value may be absent, but the UI must say whether it is failed, denied, not ready, not deployed, unmapped, or true zero.
- Remove/noise: keep out of the default view or fold behind a secondary view until the sample is useful.

| Tab | Metric/group | Status | Required change/size |
| --- | --- | --- | --- |
| Acquisition | Waitlist total, new waitlist | OK | Keep. Firestore source. |
| Acquisition | Founder access granted, feedback, interview | Rename/definition | Must say founder access/grant, not users or signups. Small copy fix. |
| Acquisition | Waitlist -> founder selected | OK | Keep as fraction. |
| Acquisition | Founder -> feedback submitted | OK | Keep as fraction. |
| Acquisition | Country/channel visit -> download -> install -> connect -> 10m success | Rename/definition | Install denominators are diluted by dev/CI installs and GA4 join misses. Add install denominator warning. Done in this PR. |
| Acquisition | GA4 link-back coverage | Rename/definition | It is join coverage, not acquisition coverage. Keep label "link-back matching". |
| Acquisition | Zero-download countries | OK | Keep. It explains a real gap rather than hiding it. |
| Acquisition | Source/campaign/CAC placeholders | Empty-state | Keep as not-ready/source-missing; do not render zero rows. |
| Activation | Zero-friction KPI | Rename/definition | Denominator is connected install/client, not signup/account. Add install denominator warning. Done in this PR. |
| Activation | Model connect reach | Rename/definition | Numerator can exceed first-run denominator because windows differ; use ratio verdict and no percent when incomparable. Existing guard OK. |
| Activation | Multi-agent active/success | Rename/definition | Install/client denominator. Needs denominator warning. Done in this PR. |
| Activation | Weekly twice plus | Rename/definition | Base is recent active install/client, not signup. Needs denominator warning. Done in this PR. |
| Activation | Free -> paid | OK with caveat | Fraction is shown, but keep away from install-axis cards because denominator differs. |
| Activation | Onboarding stall | OK | Keep; it explains blockers rather than vanity usage. |
| Activation | Beta-exit gauges | Remove/noise | Hide from default or collapse. Current sample is too small and some events are 3.0.19+ only. Medium UI split. |
| Activation | Weekly active projects/tasks, second session, stickiness | Remove/noise | Useful later, noisy now. Fold below first-spawn cliff. Small UI reorder/collapse. |
| Activation | Spawn success/crash/restart | OK | Keep, but read with admin-exclusion caveat. |
| Activation | CLI setup, demo, marketing consent, survey/NPS | Remove/noise | New event cohorts are too small; collapse until N >= 30 or responses >= 10. Medium UI split. |
| Activation | Core activation headline | Rename/definition | Was percent-first and said signup denominator. Change to fraction-first and server-defined base. Done in this PR. |
| Activation | Step funnel reaches/drop/conversion | OK with caveat | Existing missing/partial labels are right. Add first-run -> spawn cliff summary. Done in this PR. |
| Activation | Product usage WAU/sample/DAU/spawn/top events/role/model | OK with caveat | Opt-in sample. Keep, but it should not outrank the first-spawn cliff. |
| Activation | Task success rate/avg duration | Rename/definition | Task denominator is completed/reported task outcomes, not all attempted user tasks. Candidate follow-up copy. |
| Activation | `analytics_user_daily` active/zombie/observed installs | Rename/definition | Install denominator, raw install key. Add dilution warning. Done in this PR. |
| Activation | Beta segment grant cohort/observed/observed rate | Rename/definition | `founderGrant` holders, not signups/users. Copy fixed in this PR. |
| Activation | Beta segment feature/session/adoption cards | Empty-state/remove | Account event axis retired; existing code lowers cards when retired. Keep collapsed/removed. |
| Activation | Release/version observed/latest/crash rates/adoption/stability | OK with caveat | CI and non-semver labels exist. Keep as operational health, not business KPI. |
| Activation | App exception/Sentry placeholder | Empty-state/remove | This is not wired and points users to Sentry. Remove from default analytics or move to ops. Small UI removal. |
| Retention | Account weekly cohorts D1/D7/D14/D30 | OK with caveat | Fraction-first and small sample warnings exist. |
| Retention | Streak install/account D7/D14 | OK with caveat | D14 2/3 is displayed as fraction. Small sample warning covers 33pp movement. |
| Retention | Streak exact retention | Remove/noise | Existing UI collapses exact. Keep collapsed. |
| Retention | Streak unit table/grid | OK | Useful for explaining which unit caused a fraction. |
| Retention | Install profile retention D1/D3/D7/D14/D30 | Rename/definition | Install-profile denominator is diluted by 608 profile rows and many no-UTM/dev/CI installs. Warning added in this PR. |
| Retention | Person-axis identity_linked_ratio | OK | Correct name and basis. Keep. |
| Retention | Model cost/day/model/day-model | OK | Cost_logs axis; token-spending accounts are only 5, so present as ops/cost, not adoption. |
| Retention | Model role success/efficiency/outcomes | Remove/noise | Labels are thin; hide from default or keep behind "routing/debug". Medium UI split. |
| Retention | Routing decision/model/reuse/score buckets | Remove/noise | Internal routing diagnostics. Move to ops/debug tab. Medium UI split. |
| Revenue | Active subscribers, paid Pro, churn/past_due | OK | Firestore source. |
| Revenue | Paid Pro active with founder grant in subtext | Rename/definition | Subtext should say founderGrant/free grant, not imply paid users. Small copy follow-up. |
| Revenue | Consecutive subscribers/cycles | Rename/definition | Toss-only; Paddle gap already noted. Keep caveat. |
| Revenue | Paid conversion vs waitlist/subscriptions | OK with caveat | Fractions shown; denominators differ. |
| Revenue | Subscription tier/status/provider distributions | OK | Keep. |
| Revenue | Signup -> active -> Pro funnel | Rename/definition | Mixes green signup/Pro with yellow opt-in active. Existing note warns; do not use as mathematical funnel. |
| Revenue | Account profile spend/MRR/LTV | Empty-state | Existing null handling is right: null is not zero. |
| Revenue | Purchase split revenue/internal/grant/unclassified | OK | Correctly separates external revenue from admin/internal and founderGrant. |
| Revenue | MRR/LTV/recovery placeholders | Empty-state | Keep as not-ready/source-missing; no zero rows. |

## Split PR Proposal

1. PR A, this change: activation headline fraction-first, founderGrant wording, install-denominator warnings.
2. PR B: default-collapse or remove beta-exit/new-onboarding micro metrics until sample thresholds are met.
3. PR C: move model routing/model outcome diagnostics and Sentry placeholder out of business analytics into ops/debug.
4. PR D: tighten remaining task-success and paid-Pro copy where denominators are not all users or all subscribers.

