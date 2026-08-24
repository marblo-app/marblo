# UTM live verification - 2026-08-24

Ticket: `q7KwGBw28fOjerryL7ue`

## Result

Positive for the live ledger path tested here: a zero-cost UTM payload reached
`marblo_telemetry.install_attribution`.

This does not mean the pre-#1178 traffic is fixed retroactively. The user's BQ
measurement remains the baseline:

- `install_attribution`: 631 rows, `utmSource` 0, `referrerHost` 17, `gaClientId`
  631
- `landingPath`: `/en/link` 545 + `/ko/link` 69 = 614 rows (97%), `/en` 16,
  `/en/download` 1
- `linkSource`: 631 rows all `app_first_run`
- 66 rows from 2026-08-24 were all before the #1178 merge at 15:55 KST, so they
  were not evidence for or against #1178.

## Deployment Check

- PR: <https://github.com/melocream/marblo/pull/1178>
- Merge commit: `7b1ed948b4fa6d5e3fa3a9772e8be3775541682b`
- Merged at: 2026-08-24 15:55:17 KST
- `https://marblo.app/en/link?...` is served by Vercel.
- Live deployment id observed in HTML: `dpl_84GqwJmbBGi4iyYHQyjnSC2dmucU`
- The live JS bundle contains the #1178 behavior:
  `captureFirstTouch`, the empty `/link` skip branch, `buildChannel`, and
  `linkInstallAttribution`.

## Hypothesis Split

The observed `linkSource = app_first_run` does not prove that app first-run
overwrote a web first-touch row.

Code evidence points to hypothesis (b): the web path does not write an
`install_attribution` ledger row by itself.

- `marblo-web/src/components/AttributionCapture.tsx` only stores first-touch in
  browser storage.
- `marblo-web/src/app/[locale]/link/LinkClient.tsx` sends the stored first-touch
  when the app opens `/link`.
- `v3/functions/src/installAttribution.ts` sets `linkSource` to
  `app_first_run` for every accepted row.

So `linkSource = app_first_run` means the row was written by the app-opened
linkback callable. It is not a source-of-first-touch discriminator.

## Live Ledger Probe

No GUI, Playwright, Electron, screenshots, or browser window were used.

1. Requested a real UTM landing URL:
   `https://marblo.app/en?utm_source=codex_q7kwgbw2&utm_medium=zero_cost&utm_campaign=utm_live_verify_q7kw_20260824`
2. Confirmed BQ had 0 rows for `utmCampaign = 'utm_live_verify_q7kw_20260824'`.
3. Called the live production callable with the same anonymous payload shape that
   `/en/link` builds after a first-touch UTM landing.

Callable response:

```json
{"result":{"ok":true,"alreadyLinked":false}}
```

BQ result:

| installId | utmSource | utmMedium | utmCampaign | landingPath | linkSource | gaClientId | buildChannel | linkedAtKst |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `883e6a28-7f8e-4802-8fa9-35dcd40a37da` | `codex_q7kwgbw2` | `zero_cost` | `utm_live_verify_q7kw_20260824` | `/en` | `app_first_run` | null | `prod` | `2026-08-24 20:23:14 UTC+9` |

## Query Notes

Dataset: `marblo-2253d.marblo_telemetry`, location `US`.

Columns are camelCase: `utmSource`, `referrerHost`, `landingPath`,
`linkSource`, `gaClientId`, `buildChannel`.

If a query returns empty, verify the query first before concluding the target is
empty.
