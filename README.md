# Token Radar — pre-token protocols ranked by implied value

Entry for make.fun `token-radar-01`. Node 22, standard library only, no network, deterministic.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Reads `/input/snapshot.json` (or `--input <snapshot.json|directory>`), writes to
`/output` (or `--output <dir>` / `MAKEFUN_OUTPUT_DIR`):

- `board.json` — 200 ranked rows: the 40-protocol watchlist (TVL ≥ $50M, no token) plus
  160 early pre-token protocols below the floor, ranked by implied value.
- `data.js` — the same board, compact, for the dashboard.
- `dashboard/` — static page (index.html, app.css, app.js), no network.
- `screenshots/` — 3 screenshots of the dashboard: board, detail, filtered.
- `dossier.json` — built from `vendor/makefun-board.ts`, the summary the judge reads.

## The model (radar-2)

`implied = round(TVL × category multiple × growth multiplier × maturity multiplier)`

- **Category multiple**: the median mcap/TVL of the snapshot's own traded protocols in the
  same category, shrunk toward the global median by peer count (k = 5), each peer ratio
  clamped to [0.005, 3], the result clamped to [0.02, 1.0]. A category with no traded peer
  takes the global median. No protocol name is ever special-cased.
- **Growth multiplier**: log-damped upside, linear downside — 1 + 0.45 × ln(1 + max(7d, 0)/50)
  + 0.5 × min(7d, 0)/100, clamped to [0.7, 2.0]; the 7-day change is clamped to [-80, 2000].
  A 7-day spike cannot triple a protocol.
- **Maturity multiplier**: a hump over age without a token — 0.70 at listing, 1.00 at 730 days,
  easing to 0.85 past 1,825 days; unknown age takes 0.85.

The dashboard recomputes every row from the same formula and shows whether it matches
`board.json`, prints every category's multiple with its peer count, and shows the live-token
protocols set aside with their market caps — the market's own values, never mixed into the
ranking. Every row carries an 8-step farm plan derived from its category, chains, TVL and
age, with a cost and a time per step.

## Layout

- `main.ts` — entrypoint: parse, build, copy dashboard and screenshots, write dossier.
- `lib/model.ts` — the model, the board builder, the farm plans, the snapshot parser.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored, unmodified).
- `dashboard/` — the page. `screenshots/` — the three screenshots.
