# Odds Study 賠率研究室

**Live site: https://jaypengx.github.io/Odds-Study/**

An educational page about the math of the Taiwan Sports Lottery (台灣運彩): what each bet returns on average, why nearly every bet loses over time, and which bets lose the least. It is not betting advice. Buying lottery tickets in Taiwan requires being 18+, and betting on overseas sites (Polymarket included) is illegal gambling in Taiwan.

## What it shows

- **Fair chance** for each MLB game and Premier League match (home/draw/away): DraftKings (via ESPN) and Polymarket, each with its own margin removed, averaged. Like the lottery, MLB games are listed up to the end of tomorrow in Taiwan time, and the Premier League's whole next matchweek (ESPN doesn't label rounds, so a round ends where a club would play a second time). Days and times are Taiwan time. Filter by sport (All / MLB / Premier League / NBA / F1) and by day.
- **Estimated lottery odds**: `1 ÷ (fair chance × 1.15)` for MLB, fitted against 14 real lottery games on 2026-09-25 (average error about 0.04). Anyone can type the real lottery odds in, and every number switches to them.
- **Back per NT$100**: `fair chance × odds × 100`. Below 100 loses on average.
- **Every bet of the day, ranked** from least costly.
- **Margins of error** on every estimate: fair chance ± half the DraftKings–Polymarket gap (at least ±0.5 points; single-source games use the league's typical gap, marked *); estimated odds ± their average error against real lottery prices, as an odds number (marked ? where never checked); amount back ± both combined; bet slip results as a range; simulator results ± 95% sampling error.
- **House take** for every market (`1 − 1 ÷ Σ 1/odds`: about 13% for single games, 40–50% for championships) and for a bet slip, before and after tax.
- **Taiwan's tax**: any single combination paying over NT$5,000 has 20% income tax and 0.4% stamp duty withheld (20.4%); the bet slip and the simulator include it.
- **Bet slip** under the lottery's ticket rules, in three modes: 一關 (singles), 全部過關 (parlay) and 過關組合 (system, choosing any of 過2關 … 過11關 and 全過). Up to 12 games, one pick per game, NT$10 units per combination, NT$100–100,000 per ticket, NT$20 million payout cap, 20.4% tax (20% income tax + 0.4% stamp duty) on any combination paying over NT$5,000. Type an amount per combination to see the ticket total, the most you can get back, the average back after tax, the chance of any payout or a profit, and every result by number of correct picks (computed exactly over all outcomes). Games already under way are removed: no live betting.
- **Simulator**: 100,000 people (about 16,700 per habit) play for 1 month to 3 years, drawing their picks from the real games on the board. Each week they buy a random number of parlay tickets; most are NT$100–500, now and then one is NT$1,000–3,000, never more than NT$3,000, and winning tickets over NT$5,000 are taxed. Habits: Casual, Big fan (favorites), Upset hunter (underdogs), Parlay dreamer (4–6 games), Chaser (doubles after a losing week, up to NT$3,000) and Careful (least costly bets). The chart shows the crowd's middle 80% and 50% as bands, the median, and the players at the top 10%, middle and bottom 10%. It runs in a Web Worker behind a loading screen before the page opens (about 2 s for a year on a laptop), only for the period being viewed, and each period is cached. To stay light it keeps no per-player paths: weeks stream into histograms, habits into running sums, and each player has their own seed so the three highlighted players are replayed exactly. Results are the same on every load.
- **Premier League**: uses the same MLB formula, which has **not** been checked against real lottery soccer prices yet. Real prices typed in override it.
- **Championships (futures)**: World Series, AL and NL champion, Premier League title and NBA title (NBA isn't on the lottery yet), from Polymarket. Estimated lottery odds: each team's implied chance is `fair^0.7`, scaled so the market adds up to the lottery's total (about 200% for MLB and 160% for the Premier League, fitted on real prices from 2026-09-25; MLB within about 5–15%). Below 0.4%, Polymarket can't tell teams apart, so those get a rough 133 or 300. These bets pay out only when the season's result is in.
- **F1 race winner**: `1 ÷ fair chance^0.69` for drivers the lottery prices one by one (checked on 9 prices from the 2026 Azerbaijan GP, average error about 8%). Drivers under 1% get the lottery's fixed longshot prices instead: 65, 325 or 500. The lottery sometimes rates drivers differently from Polymarket, which no formula can predict.

With estimated odds only, every MLB bet comes out at about NT$87, because the formula assumes the same cut everywhere. The ranking becomes informative once real lottery odds are entered.

The page is split into tabs (Games, Championships, F1, Bet slip, Simulator, The math), each with its own address (`#games`, `#slip`, …). The language follows the browser: Chinese for any `zh` language, English otherwise.

## How it works

A static site with no build step and no dependencies. The page fetches odds live in the visitor's browser (a failed request is retried once), and every request goes through the `sports-proxy` Cloudflare Worker from [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy) (`https://sports-proxy.pengzjay.workers.dev/sports-proxy?url=…`, set as `PROXY_URL` in `public/lib/sources.mjs`). The proxy adds the CORS headers Polymarket doesn't send and caches responses. For the MLB and Premier League Polymarket pages the page asks for `&trim=polymarket-events`, which cuts each response to the few fields it reads.

The page has no direct-fetch fallback, so it depends on that Worker:

- **No proxy, no data.** If the Worker is down, the page loads but shows no odds. The tests don't need it.
- **Allowed origins only.** The proxy accepts requests only from `https://jaypengx.github.io` and `http://localhost:<port>`. Hosting the page anywhere else needs that origin added to `ALLOWED_ORIGINS` in Shared-Proxy's `sports-proxy-worker.js`.
- **Allowed hosts only.** It forwards only to hosts on its allowlist (`site.api.espn.com` and `gamma-api.polymarket.com` are the ones used here). A new data source needs its host added there first.

| File | Purpose |
| --- | --- |
| `public/lib/odds.mjs` | The math: devig, estimated lottery odds, expected return, bet slip, simulation |
| `public/lib/sources.mjs` | Fetching and parsing ESPN and Polymarket (MLB, Premier League, F1) through the proxy |
| `public/lib/teams.mjs` | Chinese team names (MLB, Premier League) and name matching |
| `public/lib/i18n.mjs` | Traditional Chinese and English text |
| `public/app.js` | Rendering |
| `public/sim-worker.js` | Runs the crowd simulation off the main thread |

## Development

```sh
npm test                                              # node:test, no installs needed
python3 -m http.server 8000 --directory public        # then open http://localhost:8000
```

Pushing to `main` runs the tests and deploys to GitHub Pages (Settings → Pages → Source must be "GitHub Actions").
