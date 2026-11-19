# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/anatadare/makefun-tokenradar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/anatadare/makefun-tokenradar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Built for the [Token Radar bounty on make.fun](https://make.fun/bounty/token-radar-01). [Join make.fun with my referral link](https://make.fun/r/x5qvvfcq).

A token launch radar for the make.fun `token-radar-01` bounty: it reads one
frozen DefiLlama snapshot, ranks the protocols that record no token by the
implied value a token would have if their record held, and gives every row a
concrete farm plan.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22+, standard library only) reads the snapshot, writes
`board.json` and the dashboard's `data.js`, copies `dashboard/` and
`screenshots/` into the output directory, and writes `dossier.json` last via
`buildDossier` from `vendor/makefun-board.ts`. The run is deterministic: the
same snapshot always writes the same bytes. It exits non-zero with a clear
message if the snapshot is missing or the board fails validation.

## The board

200 rows: all 40 watchlist protocols, 120 further pre-token candidates chosen
by modeled value, and 40 token comparables. Candidates exclude wrapped,
staked and bridged products under the same rule the watchlist uses (category,
name and exchange-name tests), because those are not launches. Comparables
are token-trading protocols at or below the watchlist floor ($50M TVL), so
they calibrate the multiples at the candidates' own size instead of letting
the largest exchanges top a board about launches.

## The value model

`lib/model.ts`, function `valueProtocol`:

```
implied_value = tvl_usd x category_multiple x growth_factor x age_factor x chain_factor
```

- **Category multiple**: the median market-cap-to-TVL ratio of the
  token-trading protocols in the category, shrunk toward the global median
  with weight n / (n + 15). Ratios are winsorized at their 95th percentile
  first, so one tiny-TVL protocol with a large token cannot set its whole
  category's multiple. A protocol with no category recorded takes the global
  median. The multiple, its peer count and every factor are shown in the
  detail view, so the valuation can be recalculated from the inputs.
- **Growth**: 1 + 0.25 x the 7-day TVL change, clamped to +/-40%.
- **Age**: 0.90 for a brand-new protocol, rising to 1.10 at two years from
  its listing date to the snapshot date.
- **Chain**: 1 + 2.5% per extra chain, capped at four extra chains.

Missing growth, listing date, chains or category keep their factor neutral
(1.00x) and are listed as visible data gaps in the detail view. Nothing is
hardcoded by name: every value follows from the snapshot's own figures.

## Farm plans

`lib/model.ts`, function `farmPlan`: 5 steps from the protocol's category
recipe (lending, swaps, vaults, RWA, derivatives), 4 steps when the category
has none, stopping before any funding. Every plan verifies the live market
first (free, 5-10 minutes), runs a $25-50 trial against a $2 fee budget,
scales only when the trial exits cleanly, rechecks withdrawal liquidity
after 7 days, then exits. Costs are planning ranges, never quotes; no step
invents a pool, a yield or an airdrop. Token comparables get a plan that
farms yield, and says so.

## The dashboard

`dashboard/` is vanilla HTML, CSS and JavaScript with no network: a sortable
board with name search, category and chain filters, a watchlist toggle and a
token filter, a live result count, and a detail view per protocol showing
the valuation inputs beside the farm plan. Routes live in the URL hash:
`#board`, `#protocol/<slug>`, `#board?watchlist=1&chain=Base`. The filtered
board shows the top result's trial plan and exit, so a filtered view answers
a real question at a glance.

## Layout

```
main.ts                  entrypoint: read, build, validate, write
lib/model.ts             snapshot parsing, value model, board, farm plans
dashboard/index.html     page shell
dashboard/app.css        warm neutral canvas, dark ink, teal accent
dashboard/app.js         board, filters, sorting, detail view, hash routes
screenshots/             the board, a detail view, a filtered view
vendor/makefun-board.ts  make.fun's dossier library (copied unchanged)
```
