# Odds Study 賠率研究室

**Live site: https://jaypengx.github.io/Odds-Study/**

An educational page about the math of the Taiwan Sports Lottery (台灣運彩): what each bet returns on average, why nearly every bet loses over time, and which bets lose the least. It is not betting advice. Buying lottery tickets in Taiwan requires being 18+, and betting on overseas sites (Polymarket included) is illegal gambling in Taiwan.

## What it shows

- **Fair chance** for each MLB game: DraftKings (via ESPN) and Polymarket, each with its own margin removed, averaged.
- **Estimated lottery odds**: `1 ÷ (fair chance × 1.15)` for MLB, fitted against 14 real lottery games on 2026-09-25 (average error about 0.04). Anyone can type the real lottery odds in, and every number switches to them.
- **Back per NT$100**: `fair chance × odds × 100`. Below 100 loses on average.
- **Least costly ranking** per day, a **parlay calculator** (most MLB games on the lottery require 2+ games per ticket), and a **simulator** of 20 players repeating one bet.
- **F1 race winner**: `1 ÷ fair chance^0.69`, fitted on only 5 prices, so rough.

With estimated odds only, every MLB bet comes out at about NT$87, because the formula assumes the same cut everywhere. The ranking becomes informative once real lottery odds are entered.

## How it works

A static site with no build step and no dependencies. The page fetches odds live in the visitor's browser through the shared sports proxy (`sports-proxy.pengzjay.workers.dev`, from the Shared-Proxy repo), which adds the CORS headers Polymarket doesn't send. The proxy only accepts requests from `https://jaypengx.github.io` and `http://localhost:<port>`.

| File | Purpose |
| --- | --- |
| `public/lib/odds.mjs` | The math: devig, estimated lottery odds, expected return, parlays, simulation |
| `public/lib/sources.mjs` | Fetching and parsing ESPN and Polymarket through the proxy |
| `public/lib/teams.mjs` | MLB team names as the lottery writes them |
| `public/lib/i18n.mjs` | Traditional Chinese and English text |
| `public/app.js` | Rendering |

## Development

```sh
npm test                                              # node:test, no installs needed
python3 -m http.server 8000 --directory public        # then open http://localhost:8000
```

Pushing to `main` runs the tests and deploys to GitHub Pages (Settings → Pages → Source must be "GitHub Actions").
