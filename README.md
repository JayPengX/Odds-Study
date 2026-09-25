# Odds Study 賠率研究室

**Live site: https://jaypengx.github.io/Odds-Study/**

An educational page about the math of the Taiwan Sports Lottery (台灣運彩): what each bet returns on average, why nearly every bet loses over time, and which bets lose the least. It is not betting advice. Buying lottery tickets in Taiwan requires being 18+, and betting on overseas sites (Polymarket included) is illegal gambling in Taiwan.

## What it shows

- **Fair chance** for each MLB game and Premier League match (home/draw/away): DraftKings (via ESPN) and Polymarket, each with its own margin removed, averaged. Filter by sport (All / MLB / Premier League / F1) and by day.
- **Estimated lottery odds**: `1 ÷ (fair chance × 1.15)` for MLB, fitted against 14 real lottery games on 2026-09-25 (average error about 0.04). Anyone can type the real lottery odds in, and every number switches to them.
- **Back per NT$100**: `fair chance × odds × 100`. Below 100 loses on average.
- **Least costly ranking** per day, and a **parlay calculator** (most MLB games on the lottery require 2+ games per ticket).
- **Simulator**: 24 people with realistic habits play for 1 month to 3 years, drawing their picks from the real games on the board. Each week they buy a random number of parlay tickets with varying stakes. Habits: Casual, Big fan (favorites), Upset hunter (underdogs), Parlay dreamer (4–6 games), Chaser (doubles after a losing week) and Careful (least costly bets). It follows the Lucky, Typical and Unlucky player, then compares the habits over 300 simulated people each: amount back per NT$100, share still ahead, average result.
- **Premier League**: uses the same MLB formula, which has **not** been checked against real lottery soccer prices yet. Real prices typed in override it.
- **F1 race winner**: `1 ÷ fair chance^0.69` for drivers the lottery prices one by one (checked on 9 prices from the 2026 Azerbaijan GP, average error about 8%). Drivers under 1% get the lottery's fixed longshot prices instead: 65, 325 or 500. The lottery sometimes rates drivers differently from Polymarket, which no formula can predict.

With estimated odds only, every MLB bet comes out at about NT$87, because the formula assumes the same cut everywhere. The ranking becomes informative once real lottery odds are entered.

## How it works

A static site with no build step and no dependencies. The page fetches odds live in the visitor's browser, and every request goes through the `sports-proxy` Cloudflare Worker from [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy) (`https://sports-proxy.pengzjay.workers.dev/sports-proxy?url=…`, set as `PROXY_URL` in `public/lib/sources.mjs`). The proxy adds the CORS headers Polymarket doesn't send and caches responses. For the MLB and Premier League Polymarket pages the page asks for `&trim=polymarket-events`, which cuts each response to the few fields it reads.

The page has no direct-fetch fallback, so it depends on that Worker:

- **No proxy, no data.** If the Worker is down, the page loads but shows no odds. The tests don't need it.
- **Allowed origins only.** The proxy accepts requests only from `https://jaypengx.github.io` and `http://localhost:<port>`. Hosting the page anywhere else needs that origin added to `ALLOWED_ORIGINS` in Shared-Proxy's `sports-proxy-worker.js`.
- **Allowed hosts only.** It forwards only to hosts on its allowlist (`site.api.espn.com` and `gamma-api.polymarket.com` are the ones used here). A new data source needs its host added there first.

| File | Purpose |
| --- | --- |
| `public/lib/odds.mjs` | The math: devig, estimated lottery odds, expected return, parlays, simulation |
| `public/lib/sources.mjs` | Fetching and parsing ESPN and Polymarket (MLB, Premier League, F1) through the proxy |
| `public/lib/teams.mjs` | Chinese team names (MLB, Premier League) and name matching |
| `public/lib/i18n.mjs` | Traditional Chinese and English text |
| `public/app.js` | Rendering |

## Development

```sh
npm test                                              # node:test, no installs needed
python3 -m http.server 8000 --directory public        # then open http://localhost:8000
```

Pushing to `main` runs the tests and deploys to GitHub Pages (Settings → Pages → Source must be "GitHub Actions").
