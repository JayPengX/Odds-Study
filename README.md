# Odds Study 賠率研究室

**Live site: https://jaypengx.github.io/Odds-Study/**

An educational app about the math of the Taiwan Sports Lottery (台灣運彩): what each bet gives back on average, where the money goes, and why nearly every bet loses over time.

> Not betting advice. Lottery tickets in Taiwan are 18+ only, and betting on overseas sites (Polymarket included) is illegal in Taiwan.

## The app

Five tabs. On phones they sit in a bottom bar and there's no app header; its controls (status, refresh) sit in a slim row at the top. Big numbers never wrap: they shrink (to 60% at most) to fit on one line. On desktop the tabs are in the top bar.

Logos come from ESPN, with dark-background versions in dark mode: the leagues on the filters, cards and boards, and the teams on the games.

The page stays simple: odds, colours and the amounts that matter. What the numbers mean (fair chance, back per NT$100, house take, margins of error) is explained in 說明's first card, 怎麼看這些數字; hovering a pick shows its own figures.

### 賽事 Games

- **What's listed** follows the lottery's own schedule:
  - MLB games up to the end of tomorrow, Taiwan time; the Premier League's next matchweek once its first game is within 3 days.
  - **More sports from ESPN** (DraftKings' lines): NFL and college football (5 days ahead), NBA, WNBA and NHL (to the end of tomorrow), and 12 more soccer leagues (3 days ahead).
  - **More sports from Kambi** (a European bookmaker's public odds, `public/lib/kambi.mjs`): NPB, KBO and CPBL baseball, EuroLeague and B.League basketball, tennis (ATP, WTA), badminton, table tennis, volleyball and snooker, whenever they have matches (busy table tennis and volleyball show the next 16).
  - The next F1 race winner, every driver named as the lottery writes them (G.羅素, AK.安東內利 …).
  - Championships (see Boards below).
  Everything but MLB, the Premier League and F1 loads in the background after the page opens.
- **Filters:** one tile per sport, never several sports in one (棒球, 籃球, 足球, 美式足球, 冰球, 網球, 羽球, 桌球, 排球, 撞球, F1, each with its games listed). Picking one with several leagues shows its leagues as chips underneath (全部聯賽, MLB, 日職 …). Then a day strip.
- **Picks:** tap one to add it to the bet slip. It shows the estimated lottery odds, and:
  - 🔒 (just the lock) when the lottery doesn't sell it, and 限2關 / 限3關 when it's sold only in parlays (see House rules);
  - a corner tag when it's recommended: 划算 (value), 穩 (steady) or 值博 (worth a shot) (see Recommendations);
  - a green tint when it gives back more than most; its fair chance, the market's cut and the average back per NT$100 in its tooltip.
- **更多玩法 (more markets)**, one tab per kind of market:
  - MLB: 大小分, 讓分 and 單隊大小 (the lottery's own lines, checked against its board, and a wider range), 得分最高單局, and from the score model 單雙, 勝分差, 首局得分, 前五局 and **首分** (who scores first);
  - other baseball (NPB, KBO, CPBL): the same (得分最高單局 too), from Kambi's win, run line and total;
  - football and basketball: 讓分, 大小分, **單隊總分** (team totals), 單雙, 勝分差, 上半場, **上半場大小** (first-half total) and **第一節** (first quarter);
  - hockey: puck lines, totals, **單隊大小**, 60 分鐘勝負, 單雙;
  - soccer: 讓球, 大小, **單隊大小**, 雙方進球, 波膽, 上半場, **上半場大小**, **雙重機會** (double chance: either of two results), **半全場** (half-time and full-time results together, 9 outcomes) and **總進球數** (0–1, 2–3, 4–6, 7+);
  - tennis, badminton, table tennis, volleyball, snooker: **第一局, 局數比分** ("Sinner 2:1"), **總局數, 讓局**, and handicaps and totals in games (tennis), points or frames on every match: Kambi's own line plus lines from a point-by-point model (each game or point won with the chance that gives the set chance; a set to 6 with a tiebreak, 11, 21 capped at 30, or 25 with a 15-point decider), shifted so it agrees with Kambi's price. Snooker's match length isn't in the feed: it's the one whose frame total best matches Kambi's line. Set chances come from the match chance (best of 3 or 5, sets independent);
  - F1: the race winner and **前三名** (podium): top-three chances from the win chances (Harville), priced to return what the winner board does.
- **Cards:** each shows its series (日職 · NPB, 網球 WTA · Seoul: the league and, for tours and cups, the event). Players' sports (tennis, badminton, table tennis, snooker) have no 主/客: players are listed in the draw's order as "A vs B".
- **場中 (live):** games in progress (MLB and the Premier League), refreshed every 30 seconds while on screen, with the same market tabs, 第N分 for MLB, and the live model (`public/lib/live.mjs`) checked on one real snapshot of the lottery's 場中 page. The house rules apply live too, so lopsided games show their lopsided side locked.
- **小遊戲 (mini games)** in 紀錄 (`public/lib/arcade.mjs`): play money for the practice account earned by effort, with no luck and no math, four to choose from:
  - 打工輸入號碼 (data entry): key ten-digit numbers off a lottery ticket on the page's own number pad (no phone keyboard; a real keyboard works too; the tenth digit sends it), NT$3 each;
  - 整理彩券 (ticket sorting): each ticket shows a team's logo and name; put it in its league's box (keys 1–4) within 5 seconds, or it counts as wrong. A round uses four leagues easy to mix up: the four baseball leagues (is it NPB or KBO?), four basketball leagues, America's big four (Rangers, Giants, Mets or Knicks?), Europe's big four soccer leagues, or Ligue 1, Eredivisie, Primeira Liga and MLS. Teams come from our own tables and ESPN's team lists (loaded when the game opens, cached by the proxy): 58–120 a round; NT$1.2 each;
  - 全壘打大賽 (home run derby), drawn on a canvas: the pitch comes in from the mound, faster each time, change-ups from the third pitch and breaking balls from the fifth; a home run (NT$6) needs a swing within about 30 ms and shows its distance, a hit NT$1;
  - 罰球 (free throws): stop the sweeping arrow in the green, which narrows as the arrow speeds up and moves fastest through the green; the ball arcs to the hoop, swishes (NT$5), rims in (NT$3) or bounces off.
  **Streaks and penalties by difficulty** (`STREAK`): data entry, the easiest, gives NT$2 every 5 right in a row and takes NT$2 a typo; sorting teams NT$2 every 5, NT$1 a wrong box; free throws NT$2 every 3 makes, NT$1 a miss; the derby, the hardest, NT$3 every 3 hits and nothing for a miss. A round never pays under 0. The HUD shows progress, the round's money, the streak and each bonus or penalty as it happens.
  **Balanced pay:** every game pays about NT$25 a minute of typical play, streaks and penalties included (`PACE`: a round's usual length and an ordinary player's results; a test keeps all four within 15%), so none is the one to farm; practice pays more. All of them pay at most NT$1,500 a Taiwan day. After every round the page shows how many minutes of a job at Taiwan's minimum wage (NT$196 an hour) the pay equals (a short round's pay stretched to an hour read oddly high) and how much betting loses it again on average (the lottery keeps about 22%), as a reminder of how slowly money is earned. Winnings are ledger entries like the grants: they sync and merge the same way, and the account's betting result leaves them out.
- **Boards:** F1 (drivers with team-coloured badges, and whether the odds are before or after qualifying) and every championship: World Series, AL, NL, NBA, Premier League, and from Polymarket's search NFL, NHL, WNBA, college football, Champions League, Europa League, La Liga, Serie A, Bundesliga, Ligue 1, MLS, and the F1 drivers' and constructors' titles.

### House rules, the house cut and recommendations

- **House rules** (`public/lib/rules.mjs`), for you and the simulated crowd alike:
  - locked (🔒): odds of 1.05 or less, or 8+ on ordinary markets (80+ on correct scores, margins, set scores and the like). F1 and championships are priced one by one up to 500 and never locked;
  - parlay only: under 1.30 only in parlays of 2+ games (限2關), under 1.15 of 3+ (限3關). The slip refuses a ticket with any combination too small for one of its picks. These thresholds are the house's usual shape, not measured on the lottery's board.
- **A cut by the house's risk:** each market's overround starts from what the lottery was measured taking on that kind of market (1.158 on MLB's two-way markets, 1.20 three-way, 1.35 bands, 1.50 correct scores, 1.92 the top inning) and grows with the house's risk: the sources disagreeing beyond the usual 1 point (point for point), a league it knows less (+1.5%) or one with a single bookmaker's line (+3%), and each line step away from the main one (+0.6%), at most +8%. With no extra risk it's the measured cut, so MLB prices exactly as before.
- **Recommendations** (`public/lib/recommend.mjs`), shown on each pick instead of a separate list: every pick is judged by its average back per NT$100 against the others. The day's top 10% get 划算; picks of 65%+ that return at least the median get 穩; picks of 30% or less in the top quarter get 值博. Locked picks, picks over 85% or under 5%, and lots of under 10 picks get none. The simulator's value hunters bet exactly these picks.

### 投注單 Bet slip

- **Ticket rules** follow the lottery:
  - 一關, 全部過關 and 過關組合 (過2關 … 過11關, 全過);
  - 1–12 picks, one per game;
  - NT$100–100,000 per ticket, with a NT$20 million payout cap;
  - 20% income tax plus 0.4% stamp duty on any combination paying over NT$5,000.
- **Mode:** 一關 (singles) by default.
- **Stake:** typed in NT$10 units, like a real slip (10 = NT$100 per combination).
- **Each pick** shows its market as a coloured tag (不讓分, 大小分, 讓分, 單隊大小 …), the pick, its game and start time in full, and its odds large (`@1.87`).
- **派彩試算 (what it pays)** above the place button: for 全部過關 the odds multiplied out (`1.89 × 1.87 × 1.68 = ×5.94`), for 一關 each pick's return, for 過關組合 each size with its number of combinations; then the ticket total, what all correct pays after tax (large) with the profit, the tax withheld when any combination is over NT$5,000, and the least a winning ticket pays.
- **Games that have started:** their pregame picks drop off the slip; live picks from 場中 stay.
- **Analysis:** all of it is exact over every way the picks can land:
  - **Key numbers:** cost, top payout, average back after tax, chance of any payout, chance of profit, take + tax. Each comes with its error range.
  - **Where each NT$100 goes:** back to you, the lottery's cut and the tax.
  - **Every result:** the chance of k of n correct, what it pays, and which results make a profit.
  - **Each pick on its own:** the odds against the fair odds, its value per NT$100, and what the ticket returns without it. The costliest pick is flagged.
  - **One pick short:** the chance of missing by exactly one pick, how many times likelier that is than winning outright, and for each pick the chance it's the only one that lost. The pick most likely to let the ticket down is flagged.
- **Grade:** a letter from the average back per NT$100 (a single game at the usual cut gets an A), a type from the chance of profit (steady to lottery ticket), the average loss per ticket in bubble teas, and how many tickets it takes on average to get paid once.
- **How hard is it to win?** The ticket's chances of all correct and of any profit, placed among well-known odds: a coin, a die, a stranger's birthday, 10 heads in a row, a royal flush, the Lotto 6/49 and Power Lottery jackpots.
- **Try a draw:** opens the ticket with each pick drawn from its fair chance. One ticket at a time, the picks revealed one by one; the button reads 開始 (Start), then 再開一張 (Restart) once a ticket is done. A running tally shows tickets opened, how many paid, the result so far with a small chart, the biggest ticket, and what the odds say that many tickets average.

### 紀錄 History: practice account, saved slips and stats

- **Play money only:** a new account has NT$10,000. From the next week on, NT$5,000 can be claimed once a week, from Monday 00:00 Taiwan time; unclaimed weeks don't add up.
- **模擬下注 (place with play money)** on the slip buys it at the odds shown: the cost comes off the balance at once, and the page opens the 紀錄 (history) tab with the slip in **我的投注單 (my slips)**. A slip costing more than the balance can't be placed.
- **Settling:** opening the 紀錄 tab (or coming back to it) checks every open slip whose games have started, at most every 90 seconds, or at once with 檢查結果:
  - MLB and Premier League from ESPN's final scores (innings for the top-scoring inning);
  - F1 from ESPN's race result;
  - championships from Polymarket once it resolves the market;
  - tennis from ESPN's tennis scoreboards (sets and games, whichever side each player is on; a retirement is void);
  - the other Kambi sports have no public results: they settle when Kambi's live score shows the match decided (a side has won the sets it needs, each sport's set target counted: 11 in table tennis, 21 in badminton, 25 and 15 in volleyball), otherwise 3 hours after the start the pick shows 中 / 沒中 / 取消 buttons to settle it by hand.

  Each pick is marked won, lost or void. Once all are decided the slip pays like a real ticket: a postponed or cancelled game counts at odds 1.00, every combination over NT$5,000 is taxed 20.4%, NT$20 million at most. A game still without a result three days after its start counts as void.
- **The card** shows the balance, the money on open slips, the total won or lost, and each slip with its picks (✓ ✗ ↺ ⏳, each with its market tag and odds) and a row of large figures: cost, total odds (全部過關), and what all correct pays or, once settled, the payout and profit.
- **Two views** under the account card: 投注單 (slips) and 統計分析 (stats).
- **Slip history:** a summary row (open slips, money at stake, the most they can pay, the settled result), filters for all, open, won and lost, and the slips in groups, each with its count, cost and result (or the most it can pay):
  - 比賽進行中: at least one game on now;
  - 等待開賽: no game started yet;
  - 已確定沒中: open, but nothing left can pay (a parlay with a lost pick) while its other games finish;
  - settled slips by the day they settled (今天, 昨天, then dates); 10 shown, the rest behind a button.

  Each pick shows its team's logo (saved with the pick, so it stays after the board moves on), the driver's badge for F1, or the league's logo for picks on no one team (單雙, 波膽 …).   Each card shows the mode, the number of games and when it was bought; a bar with one segment per pick (green won, red lost, grey void, pulsing red in play, empty not started); how many games are over and when the next one starts; each pick with its state (✓ ✗ ↺ ● ⏳), market tag and odds; and large figures: cost, total odds (parlays), what is already locked in and the most it can still pay, or once settled the payout and profit. Each slip folds out what the odds said when it was bought: its average payout, the chance of any payout, each pick's fair chance and value per NT$100, and once settled, its result against that average (luck) and the tax withheld.
- **統計與分析 (stats and analysis)**, from `public/lib/history.mjs`:
  - key numbers: slips settled, staked, paid after tax, net, back per NT$100 and the share of slips that paid, each against what the odds said to expect;
  - the balance over time, a step line with payouts and weekly claims marked;
  - luck or the cut: the expected loss (the lottery's cut plus tax) against the actual result, the usual luck range (one standard deviation over all settled slips) and how rare the result is (normal approximation);
  - how good the picks are: won against their fair chances, overall, by chance band (0–20% … 80–100%) and by market, with average odds;
  - by sport (slips from several sports count as mixed), by mode and by number of picks: slips, staked, net, back per NT$100 actual and expected;
  - streaks and records: the current and longest winning and losing runs, the best and worst slip, the biggest return, the average slip and the tax paid;
  - week by week (Taiwan weeks from Monday);
  - **你的下注輪廓 (how you bet)**, from `public/lib/profile.mjs`: tickets and hit rate, back per NT$100, average and largest ticket, picks per ticket and singles, average odds and pick chance, biggest win, longest streaks, near misses, best and worst week, pace, and the simulator's traits your tickets show (backs favourites, upset hunter, singles, parlay lover, every day, now and then, tilts). A simulated person's lookup shows the very same card from their replayed tickets;
  - **你和 100,000 人比 (you against the crowd):** the simulated crowd playing the nearest period at least as long as your record, run only now that it's needed, in the background: the share of the crowd your result beats, you against the typical person, and how the crowd's people with your traits did;
  - **趣味數據 (fun facts):** the biggest upset you picked, the most painful miss, parlays one pick short and what they'd have paid, the team you pick most and its record, your most played market, your favourite day to bet, how many picks were live, your boldest slip, and the lottery's average take from you in bubble teas.
- **Saves are always compressed:** the account is gzip-compressed (JSON → gzip → base64, marked `gz1:`, see `public/lib/codec.mjs`) both in `localStorage` and in the synced copy, about 8–10 times smaller. Older plain-JSON saves still open, and are rewritten compressed.
- **Sync:** 建立同步碼 creates an 8-character passcode (letters and digits, no 0/1/O/I); typing it on another device links that device to the same account. The two copies merge: the balance is a ledger of entries with fixed ids (start, each week's grant, each slip's stake and payout), so nothing counts twice, and a slip settled on either device is settled on both. Changes are sent a second after they happen, and picked up when the page opens or the tab comes back. The account lives in `localStorage` on each device and in Firestore (through Shared-Proxy's `/odds-sync`), stored under the passcode's hash.

### 模擬 Simulator

The crowd lives in `public/lib/sim.mjs`.

- **Everyone is a mix of traits**, nothing else. At most one of each of four how-they-bet groups, and any number of reactions:
  - how they pick: 押熱門 backs favourites (20%, 60%+ chances only), 爆冷獵人 upset hunter (12%, 35% or less), 精算派 value hunter (6%, only the recommended picks), 玩法控 side-market fan (12%, scores, margins, sets, half-time/full-time …); the rest pick in proportion to each pick's chance and its market's popularity (the winner most, handicaps and totals next, side markets a little, a game's weight shared among its lines);
  - picks per ticket: 單場派 singles (20%), 串關狂 parlay lover (15%, 3–6); the rest 1–2. A ticket's stake shrinks with its picks (÷ (1 + 0.35 × (picks − 1))): long parlays are small tickets;
  - stake: 大戶 high roller (6%, 8% of the balance a ticket), 小資 small (22%, 1%); the rest 3%; 5% of tickets are three times that;
  - pace: 天天買 every day (15%, about 4 a week), 偶爾玩 now and then (20%, one every 3 weeks); the rest about one a week;
  - reactions: 越輸越大 tilts, 追輸族 chaser (doubles after a losing week up to the ticket limit, 4 weeks off when it breaks), 見好就收 cashes out, 手感派 streaky, 乘勝追擊 presses on, 報復型 revenge, 玻璃心 heartbroken, 不服輸 so close, 大獎夢 jackpot dreamer, 滾雪球 lets it ride, 守本派 guards the start, 停損 stop-loss, 小確幸 content, 看心情 moody, 三分鐘熱度 easily bored, 孤注一擲 Hail Mary (under the start, 2 more picks a ticket), 死忠 loyal (off-season off), 見異思遷 hopper (off-season always on); 8–20% each.
- **Why these shares:** by law the lottery pays out at most 78% of sales in prizes, and it pays about that, so it keeps about 22% before tax. Every extra pick pays the cut again, so that can only hold if most money goes on singles and short parlays. The mix is set to match: the crowd as a whole gives the house 21–23% before tax (a test checks 17–27%), about 1.8 picks per ticket.
- **The crowd:** 5 pick styles × 47 stacks of series, about 100,000 people; each person's other traits drawn from their own random stream. Everyone bets on a stack of series (the labels on each person): most on one series only (only the Premier League, only CPBL), some on every series of one sport (all baseball), some on a mix across sports (MLB + NBA), a few on everything. How many follow each is its popularity with Taiwan's lottery players (`pop` in `SIM_SPORTS`: MLB and the NBA the most, then CPBL, the Premier League, NPB …).
- **Everything by your rules:** NT$10,000 to start, NT$5,000 a week, never money they don't have; the lottery's ticket limits, tax and payout cap; locked picks never, parlay-only picks only in parlays; the very markets and odds on this page (every market, not just the winners). A sport with nothing on today (the NBA before its season, say) gets a typical week of made-up games run through the very code that builds the real board (`public/lib/board.mjs`), so it gets the same markets, the house's cut for that league and its locks, and returns what a real board of that sport does (within about a point).
- **One shared world:** each week every game has one real result for everyone. A game's markets agree: the winner and every handicap line share one draw (the away side's slice first), every total line another (under first), so over 8.5 winning means over 7.5 won.
- **Every sport in one registry:** `SIM_SPORTS` lists each sport's kind, its sport (for people who bet on all of one sport), its popularity, whether its seasons show in the time-lapse and its games per week from the 2026/27 schedules (NPB ~36 a week, KBO ~30, CPBL ~15 from late March to October; tennis tours all year but December; badminton and table tennis event weeks; volleyball clubs and the Nations League). Adding a sport: a `LEAGUES` entry in `public/lib/teams.mjs` and a `SIM_SPORTS` entry; a test fails if either is missing.
- **What it shows:**
  - how many in 10 are still ahead, the crowd's range over time, the time-lapse, and what the crowd's loss would buy;
  - the luckiest 10%, the middle person and the unluckiest 10%, with their traits;
  - **哪種人虧最多？** one card, three tabs: 下注方式 (the how-they-bet traits against the usual way), 個性 (reactions against people with none), 賭什麼 (each series: everyone who bets on it, whatever else they bet on), ranked by average result;
  - **你是哪種人？** pick a trait and a series: how many of them are ahead, their average result, back, tickets and stake;
  - **Look up anyone** (1 to about 100,000): their season replayed on the device, every ticket, with the same profile card as your own history, "贏過 N%", and for a winner their share of all winnings;
  - stories from the record holders: the biggest ticket, the biggest winner and loser, **the comeback** (furthest behind, ended ahead), the roller coaster, streaks, the longest shot, **the most near misses**, the worst week, the most tickets and the most tax;
  - **who holds the winnings**, and **leaderboards**: the top 10 on 15 records (up most, biggest ticket, longest shot, comeback, best week, longest parlay won, win streak, most tickets, most tax, near misses, down most, roller coaster, worst week, drought, went broke);
  - the brutal truths and facts (singles against parlay lovers, chasers against people without the trait, the ticket mix, near misses …), and where the money went (losers' losses = winners' winnings + the lottery's take + tax, exactly).
- **Fairness audit** (`public/lib/audit.mjs`): no sport, or series' followers, may do better or worse only because of how it's modelled. Each sport's pool is scored by what the crowd's usual pick returns per NT$100; one more than 6 points from the rest is flagged, and so are a series' followers more than 5 points from the whole crowd (series followed by too few people to tell are skipped) (F1 is exempt: the lottery really takes more on it). The tests run it on every sport's typical week, against a real board, on a deliberately inflated pool (which it must catch) and on a simulated crowd; the page runs it on the live board and each simulation and warns in the console. It exists because a basketball stand-in once paid NT$86 per NT$100 against 76-83 on real boards and put basketball fans on top of the leaderboards.
- **Periods:** 1 month to 5 years; one run records every period along the way, and longer periods carry everyone on from where they stopped (tests check it matches a straight run).
- **How it runs:** in a Web Worker, streaming weeks into histograms instead of keeping 100,000 paths; about 8 seconds for a year on a laptop. Tests prove it equals replaying everyone in full.

### 說明 Guide

Folding cards explain: reading the numbers; the odds math; the traits; what people bet on (series stacks); every kind of bet; the lottery's rules (locks, parlay only, the cut by risk, tickets and tax, the practice account); recommendations; how the simulator works; data and margins.

## The math

| What | How |
| --- | --- |
| Fair chance | DraftKings (via ESPN), Polymarket and Kambi, each with its margin removed, averaged |
| MLB win odds | `1 ÷ (fair × 1.15)`; average error about 0.04 against 14 real lottery games (2026-09-25) |
| MLB totals | Total runs as negative binomial (r = 5) fitted to DraftKings' line; the lottery's 3 lines (the one closest to 50/50, ±1). Matched all 12 lottery lines, 0.9 points off |
| MLB run lines | Lottery chance `0.5 + 0.732 × (p − 0.5)` for ±1.5, then 8.6 points more for ±2.5; 1.6% off on 38 prices |
| MLB team totals | Each team's runs as negative binomial (r = 4) fitted to the win chance and total; 17 of 18 lines matched |
| Top-scoring inning | The lottery's own fixed table (about a 48% take) |
| F1 winner, after qualifying | `1 ÷ (1.17 × fair^0.765)`, at least 1.05; drivers under 1% get the lottery's fixed 65 (0.4–1%) / 275 (0.15–0.4%) / 500. About 10% off on 8 drivers the eve of the 2026 Azerbaijan GP (`tests/fixtures/lottery-f1-2026-09-26.json`) |
| F1 winner, before qualifying | `1 ÷ fair^0.692`; 65 (0.4–1%) / 325 (0.1–0.4%) / 500. About 8% off on 9 prices from the same race's board the morning before qualifying. The phase comes from ESPN's F1 schedule (qualifying start + 90 minutes); without it, over 21 hours before the race counts as before |
| House cut | The measured cut of the market's kind × (1 + risk): sources' extra disagreement, the league's tier (0 / 1.5% / 3%), 0.6% per line step, at most 8% |
| Sets (tennis …) | Per-set chance q from the match chance (best of 3 or 5); set scores `C(need−1+lost, lost) q^need (1−q)^lost` |
| Extra lines | Totals from the same negative binomial; run lines and team totals from the per-team score grid; odds `1 ÷ (p × 1.158)` (totals × 1.153), never above halfway from p to 1 in implied chance, at least 1.01. Not checked against the lottery |
| Championships | Implied chance ∝ `fair^0.7`, scaled to the lottery's total (MLB 200%, EPL 160%, others 180%, unchecked); longshots 133 / 300 |
| Back per NT$100 | `fair chance × odds × 100`; below 100 loses on average |
| House take | `1 − 1 ÷ Σ(1 / odds)` |
| Tax | 20.4% of any combination paying over NT$5,000 |

Every estimate carries its **margin of error**:

- **Fair chances:** half the DraftKings–Polymarket gap. `*` marks a game with only one source, which gets its league's typical gap.
- **Estimated odds:** their measured error against real lottery prices. `?` marks one not yet checked.
- **Simulator results:** 95% sampling error.

The calibration data is the real lottery prices in `tests/fixtures/lottery-mlb-2026-09-25.json` `tests/fixtures/lottery-f1-2026-09-26.json` and, for live odds, `tests/fixtures/lottery-live-2026-09-26.json`. Soccer, the Kambi sports and the new plays haven't been checked against the lottery yet.

## How it works

A static site with no build step and no dependencies. The browser fetches odds live through the `sports-proxy` Cloudflare Worker from [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy) (`PROXY_URL` in `public/lib/sources.mjs`). The Worker adds the CORS headers Polymarket doesn't send, and caches responses. A failed request is retried once. Team logos load straight from ESPN's image server; for the leagues ESPN doesn't cover (NPB, KBO, CPBL, B.League, EuroLeague, and the badminton, table tennis, snooker and WTA tours) they come from TheSportsDB's free badges, matched by the words the club names share. Players (tennis and the like) show initials.

The page depends on that Worker:

- **No proxy, no data.** If the Worker is down, the page opens without odds. The tests don't need it.
- **Allowed origins only:** `https://jaypengx.github.io` and `http://localhost:<port>`. Hosting elsewhere needs the origin added to `ALLOWED_ORIGINS` in Shared-Proxy's `sports-proxy-worker.js`.
- **Allowed hosts only:** `site.api.espn.com`, `gamma-api.polymarket.com` and `eu-offering-api.kambicdn.com` are the ones used here.
- **Fetching politely:** every response is cached at the Worker for every viewer (Kambi's lists 2 minutes, Polymarket's championship search 10 minutes, live scores 20 seconds), Kambi's responses are trimmed to the fields used (`&trim=kambi-events`, about 5× smaller), the page sends at most 6 requests at once, and live scores are polled only while the page is visible.

The practice account's sync uses Shared-Proxy's other Worker, `orbit-workers-proxy` (`SYNC_URL` in `public/lib/sync.mjs`), route `/odds-sync`. Without it the account still works on each device alone.

| File | Purpose |
| --- | --- |
| `public/lib/odds.mjs` | The math: devig, estimated odds, F1 phases, bet slip rules and analysis |
| `public/lib/board.mjs` | Every priced option of a game, for the page and the crowd alike, and the crowd's pool |
| `public/lib/arcade.mjs` | The mini games' rules, pay and daily cap |
| `public/lib/audit.mjs` | The fairness audit of sports and series |
| `public/lib/rules.mjs` | House rules (locks, parlay only) and the house cut by risk |
| `public/lib/recommend.mjs` | Recommendations on single picks |
| `public/lib/sim.mjs` | The simulated crowd: traits, calendar, the shared world, leaderboards |
| `public/lib/profile.mjs` | One person's betting from their tickets, for you and for anyone in the crowd |
| `public/lib/kambi.mjs` | Kambi's odds and live scores |
| `public/lib/markets.mjs` | Every sport's side markets, the new plays and matches in sets |
| `public/lib/sources.mjs` | Fetching and parsing ESPN, Polymarket and Kambi; results; what the lottery would list |
| `public/lib/teams.mjs` | Leagues, Chinese team and driver names, ESPN logo ids, TheSportsDB badges, the F1 grid's team colours |
| `public/lib/i18n.mjs` | Traditional Chinese and English text (follows the browser's language) |
| `public/lib/account.mjs` | The practice account: ledger, weekly grant, placing and settling slips, merging two copies |
| `public/lib/sync.mjs` | The account's sync through Shared-Proxy's `/odds-sync` |
| `public/lib/live.mjs` | Live odds: the in-game score model, the lines closest to 50/50, prices at the live cut |
| `public/lib/history.mjs` | Stats over saved slips: money, luck against the cut, picks against their chances, breakdowns, streaks, records |
| `public/lib/codec.mjs` | gzip + base64 for every save |
| `public/app.js` | Rendering |
| `public/sim-worker.js` | Runs the crowd simulation off the main thread |
| `public/styles.css` | Design tokens (light and dark) and components |

A loading screen (logo, spinner, progress, time left) covers the page until the odds are ready, for 45 seconds at most. The crowd simulation never runs at start-up: only when the 模擬 tab opens (the page waits for it when it opens on that tab), or quietly in the background when 紀錄's 統計分析 needs it for the comparison. If the scripts never start, a failsafe in `index.html` offers Reload or Open anyway. On deploy, `scripts/stamp-version.mjs` does two things:

- It adds `?v=<commit>` to every local file, so browsers never mix new files with cached old ones.
- It stamps the commit into `index.html` and writes `version.json`. On open, and whenever the tab comes back, the page fetches `version.json` past every cache. If a newer deploy is out, the page reloads once under `?v=<commit>`, which fetches it and every file fresh.

A browser holding an old copy of the page still gets the new version.

## Development

```sh
npm test                                              # node:test, no installs needed
python3 -m http.server 8000 --directory public        # then open http://localhost:8000
```

Pushing to `main` runs the tests and deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).
