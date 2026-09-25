# Odds Study 賠率研究室

**Live site: https://jaypengx.github.io/Odds-Study/**

An educational app about the math of the Taiwan Sports Lottery (台灣運彩): what each bet gives back on average, where the money goes, and why nearly every bet loses over time.

> Not betting advice. Lottery tickets in Taiwan are 18+ only, and betting on overseas sites (Polymarket included) is illegal in Taiwan.

## The app

Four tabs. On phones they sit in a bottom bar and there's no app header; its controls (status, 詳細, refresh) sit in a slim row at the top. On desktop the tabs are in the top bar.

Logos come from ESPN, with dark-background versions in dark mode: the leagues on the filters, cards and boards, and the teams on the games.

The **詳細 (Details)** switch in the top bar starts off. Off, the page shows the odds and the average back per NT$100. On, it adds:

- the ± margins of error;
- fair chances and house takes;
- the extra stats and notes.

The choice is remembered.

### 賽事 Games

- **What's listed** follows the lottery's own schedule:
  - MLB games up to the end of tomorrow, Taiwan time.
  - The Premier League's next matchweek, once its first game is within 3 days.
  - Championships, NBA included only from its opening night (the first Tuesday on or after 19 October) to the end of June.
  - The next F1 race winner, with **every** driver the market prices.
- **Filters:** sport tiles (league logo, name and games listed) and a day strip (weekday or 今天/明天, the date and what's on). Every league logo sits on the same small white disc in both themes (as in Match-Find); the Premier League shows just its purple lion, cropped by ESPN's own resizer.
- **Game cards** show the league logo, the kick-off time, the team logos and the win picks.
- **Picks:** tap one to add it to the bet slip. It shows:
  - the estimated lottery odds, tinted green or red when a bet is unusually good or bad;
  - with 詳細 on: the odds' ± error, the fair chance and the average back per NT$100 (usually just 100 minus the take).
- **更多玩法 (more markets)** opens the other markets:
  - 大小分 (totals, 3 lines);
  - 讓分 (run lines, ±1.5 and ±2.5);
  - 單隊大小 (team totals);
  - 得分最高單局 (top-scoring inning).

  With 詳細 on, each market shows its own house take.
- **✎ 填真實賠率** shows a box on every pick for the lottery's real odds. Once typed in, the real odds replace the estimates everywhere.
- **Best value of the day:** the top three bets as cards (a phone scrolls through them), each with its average back per NT$100 and a button to add it, then every bet ranked in a folded list.
- **Boards:**
  - F1: drivers with team-coloured badges.
  - Championships (World Series, AL, NL, Premier League, NBA): team logos.
  - Each board carries its league's logo.

  Both can go on the bet slip too.

### 投注單 Bet slip

- **Ticket rules** follow the lottery:
  - 一關, 全部過關 and 過關組合 (過2關 … 過11關, 全過);
  - 1–12 picks, one per game;
  - NT$100–100,000 per ticket, with a NT$20 million payout cap;
  - 20% income tax plus 0.4% stamp duty on any combination paying over NT$5,000.
- **Mode:** 一關 (singles) by default.
- **Stake:** typed in NT$10 units, like a real slip (10 = NT$100 per combination).
- **Live games:** games that have started drop off the slip.
- **Analysis:** all of it is exact over every way the picks can land:
  - **Key numbers:** cost, top payout, average back after tax, chance of any payout, chance of profit, take + tax. Each comes with its error range.
  - **Where each NT$100 goes:** back to you, the lottery's cut and the tax.
  - **Every result:** the chance of k of n correct, what it pays, and which results make a profit.
  - **Each pick on its own:** the odds against the fair odds, its value per NT$100, and what the ticket returns without it. The costliest pick is flagged.
  - **One pick short:** the chance of missing by exactly one pick, how many times likelier that is than winning outright, and for each pick the chance it's the only one that lost. The pick most likely to let the ticket down is flagged.
- **Grade:** a letter from the average back per NT$100 (a single game at the usual cut gets an A), a type from the chance of profit (steady to lottery ticket), the average loss per ticket in bubble teas, and how many tickets it takes on average to get paid once. With 詳細 on: what all-correct would pay at fair odds, and how much less the lottery pays.
- **How hard is it to win?** The ticket's chances of all correct and of any profit, placed among well-known odds: a coin, a die, a stranger's birthday, 10 heads in a row, a royal flush, the Lotto 6/49 and Power Lottery jackpots.
- **Try a draw:** opens the ticket with each pick drawn from its fair chance. One ticket at a time, the picks revealed one by one; the button reads 開始 (Start), then 再開一張 (Restart) once a ticket is done. A running tally shows tickets opened, how many paid, the result so far with a small chart, the biggest ticket, and what the odds say that many tickets average.

### 模擬 Simulator

- **The crowd:** 100,000 people, made of 6 betting habits × 5 kinds of fan.
  - Habits: Casual, Big fan, Upset hunter, Parlay dreamer, Chaser, Careful.
  - Fans: MLB, Premier League, NBA, F1, and people who bet on everything.
- **The calendar:** time runs forward from this week on each league's real schedule. From the published 2026/27 schedules: 2,430 MLB games (25 March to 26 September) plus about 40 in the postseason; 380 Premier League games (22 August to 30 May, no games in the international breaks, Boxing Day week doubled); 1,230 NBA games (20 October to 11 April) plus about 90 in the play-in and playoffs; and the 24 races of the 2027 F1 calendar.
  - In a sport's off-season, 30% of its fans bet on something else.
  - Today's real prices stand in for future games. The NBA uses a typical-game template, because its game odds aren't fetched.
- **How often and how much:** calibrated on the closest published survey, the University of Hong Kong's 2021 government-commissioned gambling study. The median football bettor there bets once every two weeks and spends HK$201–500 a month; Taiwanese studies don't publish these figures.
  - In the simulation, habits range from about one ticket every three weeks (Careful) to one a week (Big fan). The average person buys about 2 tickets a month.
  - Most tickets are NT$100–500, now and then up to NT$3,000. Anything paying over NT$5,000 is taxed.
  - Upset hunters and parlay dreamers let it ride: a winning ticket's whole payout (after tax) is bet again. It tops up their next ticket, and whatever is over the lottery's NT$100,000 per-ticket limit goes on extra tickets that week (up to 30), so a big win keeps being bet until it's lost.
  - Each habit has its quirks too:
    - Casual: happy with a win, takes a week off; after 6 losing tickets in a row, a month off.
    - Big fan: hot hand, the ticket after a win is doubled (up to NT$3,000).
    - Parlay dreamer: "so close!", the ticket after missing by one game is doubled.
    - Chaser: losing a week at the NT$3,000 cap, quits for a month, then starts over from NT$200.
    - Careful: a stop-loss, six weeks off after losing NT$1,000 or more in a week.
  - A player's card shows the weeks they took off (with 詳細 on).
- **What it shows:**
  - how many in 10 are still ahead, as a pictogram;
  - the crowd's range over time;
  - a time-lapse, which plays itself when it scrolls into view (about 20 seconds a year, holding 2.5 seconds on each new event; past a year it holds only on the crowd's milestones, for 1.2 seconds, so five years plays in well under a minute): 100 dots of 1,000 people each, coloured from big win (NT$5,000+) to heavy loss; the date; the share ahead, the typical result and the lottery's running take; a feed of what happens (each league's season starting, its playoffs and its end, the week most people were ahead, the share ahead dropping under 20/10/5%, the typical loss passing NT$1,000/5,000/10,000, the lottery's take passing NT$100 million and NT$1 billion, each year's mark); and a small chart of the share ahead with those events marked, which can be tapped to jump to a week.
  - what the crowd's total loss would buy: bubble teas, bowls of beef noodles, iPhones and scooters;
  - the luckiest 10%, the middle player and the unluckiest 10%;
  - habits and fans ranked by money back;
  - record holders by their number in the crowd, each with their full story. The biggest winner and loser are always the real ones; the other records are shared out so every habit tells at least one (the best of a habit not yet shown gets it, titled like "精算派之中・最慘的一週"):
    - the biggest single ticket, the biggest winner and loser;
    - the roller coaster (furthest ahead, yet ended down);
    - the longest winning and losing streaks;
    - the longest shot that came in and the worst single week;
    - the most tickets, the closest to break-even and the most tax paid;
  - the brutal truths and surprising facts (all shown, 詳細 or not), each one plain sentence with its numbers highlighted, then the explanation:
    - how much others lose for every NT$1 won;
    - the top-1% line and who never won once;
    - how often a first-ticket winner still loses;
    - the hit rate, the tax collected and what the lottery makes per day.
- **People like you:** pick a habit and a kind of fan to see that group of about 3,334 people. It shows:
  - how many are still ahead;
  - the typical result, the average back and the tickets bought;
  - the group's range from its biggest loser to its biggest winner;
  - the typical loss in bubble teas.
- **Look up any player:** type a number from 1 to 100,020 (a birthday, a lucky number) or draw one at random. That person's season is replayed exactly on the device, with a small chart, their story, and their highest and lowest running total (and the week of each). The numbers in the stories are clickable too.
- **One shared world:** each week every game and F1 race has a single real result that everyone who bet on it shares. This is a hash of (seed, week, market, which real game), so it takes no storage and any player can still be replayed alone.
  - Sports keep their real number of distinct games per week.
  - With 24 races a year, F1 long shots come in only as rarely as they should.
  - Picks are weighted by each option's chance, so a 0.1% driver gets about 0.1% of the bets.
- **Periods:** a slider from 1 month to 5 years (month by month up to a year, then every 3 months), with quick picks (1 month, 6 months, 1, 2, 3 and 5 years). The seed is fixed, so the same period always gives the same result.
  - Every run records the crowd at the end of each of those periods along the way, so the default 1-year run answers every period up to a year at once.
  - Longer periods carry every player on from the furthest week played so far and play only the extra weeks. Tests check this matches a straight run exactly.
- **How it runs:** in a Web Worker, streaming weeks into histograms instead of keeping 100,000 paths. Tests prove this equals simulating everyone in full.

### 說明 Guide

Folding cards explain:

- the odds math;
- every habit and kind of fan;
- every kind of bet;
- how the simulators work;
- the lottery's rules and tax;
- where the data and margins come from.

## The math

| What | How |
| --- | --- |
| Fair chance | DraftKings (via ESPN) and Polymarket, each with its margin removed, averaged |
| MLB win odds | `1 ÷ (fair × 1.15)`; average error about 0.04 against 14 real lottery games (2026-09-25) |
| MLB totals | Total runs as negative binomial (r = 5) fitted to DraftKings' line; the lottery's 3 lines (the one closest to 50/50, ±1). Matched all 12 lottery lines, 0.9 points off |
| MLB run lines | Lottery chance `0.5 + 0.732 × (p − 0.5)` for ±1.5, then 8.6 points more for ±2.5; 1.6% off on 38 prices |
| MLB team totals | Each team's runs as negative binomial (r = 4) fitted to the win chance and total; 17 of 18 lines matched |
| Top-scoring inning | The lottery's own fixed table (about a 48% take) |
| F1 winner | `1 ÷ fair^0.69`; drivers under 1% get the lottery's fixed 65 / 325 / 500 |
| Championships | Implied chance ∝ `fair^0.7`, scaled to the lottery's total (MLB 200%, EPL 160%); longshots 133 / 300 |
| Back per NT$100 | `fair chance × odds × 100`; below 100 loses on average |
| House take | `1 − 1 ÷ Σ(1 / odds)` |
| Tax | 20.4% of any combination paying over NT$5,000 |

Every estimate carries its **margin of error**:

- **Fair chances:** half the DraftKings–Polymarket gap. `*` marks a game with only one source, which gets its league's typical gap.
- **Estimated odds:** their measured error against real lottery prices. `?` marks one not yet checked.
- **Simulator results:** 95% sampling error.

The calibration data is the real lottery prices in `tests/fixtures/lottery-mlb-2026-09-25.json`. Soccer prices haven't been checked against the lottery yet.

## How it works

A static site with no build step and no dependencies. The browser fetches odds live through the `sports-proxy` Cloudflare Worker from [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy) (`PROXY_URL` in `public/lib/sources.mjs`). The Worker adds the CORS headers Polymarket doesn't send, and caches responses. A failed request is retried once. Team logos load straight from ESPN's image server.

The page depends on that Worker:

- **No proxy, no data.** If the Worker is down, the page opens without odds. The tests don't need it.
- **Allowed origins only:** `https://jaypengx.github.io` and `http://localhost:<port>`. Hosting elsewhere needs the origin added to `ALLOWED_ORIGINS` in Shared-Proxy's `sports-proxy-worker.js`.
- **Allowed hosts only:** `site.api.espn.com` and `gamma-api.polymarket.com` are the ones used here.

| File | Purpose |
| --- | --- |
| `public/lib/odds.mjs` | The math: devig, estimated odds, bet slip analysis, simulation |
| `public/lib/sources.mjs` | Fetching and parsing ESPN and Polymarket; what the lottery would list |
| `public/lib/teams.mjs` | Chinese team names, ESPN logo ids, the F1 grid's team colours |
| `public/lib/i18n.mjs` | Traditional Chinese and English text (follows the browser's language) |
| `public/app.js` | Rendering |
| `public/sim-worker.js` | Runs the crowd simulation off the main thread |
| `public/styles.css` | Design tokens (light and dark) and components |

A loading screen (logo, spinner, progress, time left) covers the page until the odds and the first simulation are ready, for 45 seconds at most. If the scripts never start, a failsafe in `index.html` offers Reload or Open anyway. On deploy, `scripts/stamp-version.mjs` does two things:

- It adds `?v=<commit>` to every local file, so browsers never mix new files with cached old ones.
- It stamps the commit into `index.html` and writes `version.json`. On open, and whenever the tab comes back, the page fetches `version.json` past every cache. If a newer deploy is out, the page reloads once under `?v=<commit>`, which fetches it and every file fresh.

A browser holding an old copy of the page still gets the new version.

## Development

```sh
npm test                                              # node:test, no installs needed
python3 -m http.server 8000 --directory public        # then open http://localhost:8000
```

Pushing to `main` runs the tests and deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).
