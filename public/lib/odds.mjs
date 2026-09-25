// Pure odds math, shared by the browser page and scripts/build-data.mjs.

// Fitted on 2026-09-25 against real Taiwan Sports Lottery prices (14 MLB
// games, 28 prices): lottery implied chance ~= fair chance x K. Separate K per
// input because each source's own fair chance sits slightly differently.
export const K_BOTH = 1.151;
export const K_DRAFTKINGS = 1.153;
export const K_POLYMARKET = 1.158;
// F1 race winner, drivers the lottery prices one by one: lottery implied
// chance ~= fair chance ^ F1_EXPONENT. Checked on 9 prices from two snapshots
// of the 2026 Azerbaijan GP (average error ~8%); a refit didn't beat it.
export const F1_EXPONENT = 0.692;
// Longshots aren't on that curve: the lottery puts them on a few fixed prices.
// On 2026-09-25 a 0.6% driver was 65, 0.15-0.25% drivers 325, the rest 500.
// [fair chance at or above, price], checked in order.
export const F1_LONGSHOT_STEPS = [
  [0.01, null],
  [0.004, 65],
  [0.001, 325],
  [0, 500]
];

export function americanToProbability(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? 100 / (a + 100) : -a / (-a + 100);
}

// Removes a two-way book's margin by proportional rescaling.
export function devigTwoWay(pA, pB) {
  if (!(pA > 0) || !(pB > 0)) return null;
  return pA / (pA + pB);
}

// Same, for any number of outcomes (soccer's home/draw/away).
export function devigProportional(probabilities) {
  if (!probabilities.every(p => p > 0)) return null;
  const total = probabilities.reduce((s, p) => s + p, 0);
  return probabilities.map(p => p / total);
}

// Removes an N-way book's margin with the power method: finds k so that
// sum(p_i^k) = 1. Undoes a longshot's larger overround more than a favorite's.
export function devigPower(probabilities) {
  const ps = probabilities.filter(p => p > 0);
  if (ps.length === 0) return probabilities.map(() => 0);
  let lo = 0.01;
  let hi = 100;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (ps.reduce((s, p) => s + p ** mid, 0) > 1) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  return probabilities.map(p => (p > 0 ? p ** k : 0));
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}

export function estimateLotteryOdds(fairChance, k) {
  return round2(1 / (fairChance * k));
}

// Championship (futures) markets, fitted on 2026-09-25 against the lottery's
// AL, NL, World Series (14 teams) and EPL title prices. The lottery's implied
// chances add up to about FUTURES_OVERROUND per market (single games: ~1.15)
// and lean on longshots: each team's implied chance is fair^FUTURES_EXPONENT,
// scaled so the market adds up to that total. MLB markets fit within ~5-15%.
export const FUTURES_EXPONENT = 0.7;
export const FUTURES_OVERROUND = { mlb: 2.0, epl: 1.6, nba: 2.0 };
// Below 0.4% Polymarket's 0.1-cent price step can't tell teams apart. The
// lottery priced 0.2-0.4% clubs at 133 and those below at 159-500.
export const FUTURES_LONGSHOT_STEPS = [
  [0.004, null],
  [0.002, 133],
  [0, 300]
];
export const LOTTERY_MAX_ODDS = 500;

// Estimated lottery odds for every team of one market, in the same order.
export function estimateFuturesOdds(fairChances, overround) {
  const total = fairChances.reduce((s, p) => s + p ** FUTURES_EXPONENT, 0);
  return fairChances.map(p => {
    const [, step] = FUTURES_LONGSHOT_STEPS.find(([min]) => p >= min);
    if (step) return step;
    return Math.min(LOTTERY_MAX_ODDS, round2(total / (overround * p ** FUTURES_EXPONENT)));
  });
}

export function estimateF1LotteryOdds(fairChance, exponent = F1_EXPONENT) {
  const [, step] = F1_LONGSHOT_STEPS.find(([min]) => fairChance >= min);
  return step ?? round2(1 / fairChance ** exponent);
}

// Average amount returned per `stake` over many identical bets.
export function expectedReturn(fairChance, odds, stake = 100) {
  return fairChance * odds * stake;
}

// How far estimated lottery odds can be off, as a share of the odds (average
// error against real lottery prices). `checked: false` marks a guess.
export const ODDS_ERROR = {
  mlb: { rel: 0.022, checked: true }, // 28 prices, 14 games: ~0.04 on ~1.8
  mlbTotal: { rel: 0.02, checked: true }, // 68 total-line prices, 12 games (model)
  mlbRunLine: { rel: 0.016, checked: true }, // 38 run-line prices, 10 games
  mlbTeamTotal: { rel: 0.03, checked: true }, // 36 team-total prices, 9 games (model)
  topInning: { rel: 0.03, checked: true }, // the lottery's own table, 8 games
  epl: { rel: 0.1, checked: false }, // soccer never checked
  f1: { rel: 0.08, checked: true }, // 9 prices
  f1Longshot: { rel: 0.35, checked: true }, // 325 vs 500 can't be told apart
  future_al: { rel: 0.06, checked: true },
  future_nl: { rel: 0.2, checked: true },
  future_ws: { rel: 0.15, checked: true },
  future_epl: { rel: 0.16, checked: true },
  futureLongshot: { rel: 0.5, checked: true }, // 133-500 from one rough step
  future_nba: { rel: 0.15, checked: false } // not on the lottery
};

// Margin of the average amount back (fair chance x odds x 100), from the
// fair chance's margin (absolute, may be null) and the odds' (relative).
export function backMargin(fairChance, fairMargin, odds, oddsRel) {
  const relFair = fairMargin ? fairMargin / fairChance : 0;
  return fairChance * odds * 100 * Math.hypot(relFair, oddsRel || 0);
}

// Middle value of a list (null when empty).
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

// MLB total runs (大小分). The lottery centres its total lines on the half-run
// line closest to 50/50 and adds one run either side, at its usual ~13% take.
// Total runs are modelled as negative binomial (mean mu, dispersion r): fitted
// to DraftKings' one line, it picked the lottery's three lines in 12 of 12
// games and landed 0.9 points of chance (2% of price) off on 34 lines
// (2026-09-25).
export const MLB_TOTAL_DISPERSION = 5;

// P(total runs <= k) for each k up to kMax.
function runsCdf(mu, r, kMax) {
  const p = r / (r + mu);
  const out = new Float64Array(kMax + 1);
  let pmf = p ** r;
  let sum = 0;
  for (let k = 0; k <= kMax; k++) {
    sum += pmf;
    out[k] = sum;
    pmf *= ((k + r) / (k + 1)) * (1 - p);
  }
  return out;
}

// Chance the total goes over a half-run line (e.g. 7.5).
export function totalOverChance(line, mu, r = MLB_TOTAL_DISPERSION) {
  return 1 - runsCdf(mu, r, Math.floor(line))[Math.floor(line)];
}

// Mean runs matching a line's fair over chance. On a whole line (8) the chance
// is over given no push, as a book prices it.
export function fitTotalRuns(line, overFair, r = MLB_TOTAL_DISPERSION) {
  const over = mu => {
    if (line % 1 !== 0) return totalOverChance(line, mu, r);
    const cdf = runsCdf(mu, r, line);
    const push = cdf[line] - (line > 0 ? cdf[line - 1] : 0);
    return (1 - cdf[line]) / (1 - push);
  };
  let lo = 0.3;
  let hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (over(mid) < overFair) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The lottery's three total lines for a game, from one line and its fair over
// chance: [{ line, over, main }], main = the half-line closest to 50/50.
export function lotteryTotalLines(line, overFair, r = MLB_TOTAL_DISPERSION) {
  const mu = fitTotalRuns(line, overFair, r);
  const candidates = [Math.floor(line) - 0.5, Math.floor(line) + 0.5, Math.ceil(line) + 0.5].filter((l, i, all) => all.indexOf(l) === i && l > 0);
  const main = candidates.reduce((best, l) => (Math.abs(totalOverChance(l, mu, r) - 0.5) < Math.abs(totalOverChance(best, mu, r) - 0.5) ? l : best));
  return [main - 1, main, main + 1].filter(l => l > 0).map(l => ({ line: l, over: totalOverChance(l, mu, r), main: l === main }));
}

// Every two-way MLB market the lottery posts (win, totals, run lines, team
// totals) adds up to about this in implied chance: 81 markets, 10 games on
// 2026-09-25 ranged 1.143-1.173.
export const MLB_MARKET_OVERROUND = 1.158;

// MLB run lines (讓分). The lottery posts DraftKings' 1.5-run line and the
// 2.5 line on the same side, but doesn't use DraftKings' chances: it pulls
// them toward 50/50 (so the side likelier to cover is underpriced: usually the
// underdog getting runs, for a heavy favourite the favourite giving them),
// then moves a fixed step for the extra run. Fitted on 19 real prices
// from 10 games (2026-09-25): 0.7 points of chance off, 1.6% of price.
export const RUN_LINE_SHRINK = 0.732;
export const RUN_LINE_STEP = 0.086;
// The true chance's step for that extra run (the chance the favourite wins
// by exactly 2), from a per-team run model; not checked against a market.
export const RUN_LINE_TRUE_STEP = 0.09;

// The two run lines for a game from DraftKings' line for the away team (e.g.
// -1.5) and its fair chance of covering: [{ awayLine, fair, lottery }], where
// `fair` is the away team's true chance of covering and `lottery` the chance
// the lottery prices it at.
export function lotteryRunLines(awayLine, awayFair) {
  const lottery = 0.5 + RUN_LINE_SHRINK * (awayFair - 0.5);
  const toward = Math.sign(awayLine); // +: the away team gets runs, so 2.5 covers more often
  const clamp = p => Math.min(0.98, Math.max(0.02, p));
  return [
    { awayLine, fair: clamp(awayFair), lottery: clamp(lottery) },
    { awayLine: awayLine + toward, fair: clamp(awayFair + toward * RUN_LINE_TRUE_STEP), lottery: clamp(lottery + toward * RUN_LINE_STEP) }
  ];
}

// Each team's runs (for team totals). Runs per team are negative binomial
// (dispersion TEAM_RUNS_DISPERSION), independent; a tie after nine goes to
// extra innings and the winner takes it by one run. The two means are fitted
// so the home team's win chance and the game total match DraftKings. On the
// lottery's team totals from 9 games (2026-09-25) it picked the lottery's line
// 17 times out of 18 and landed about 1.1 points of chance off (r = 4 fit best).
export const TEAM_RUNS_DISPERSION = 4;
const TEAM_RUNS_MAX = 30;

function runsPmf(mu, r = TEAM_RUNS_DISPERSION, kMax = TEAM_RUNS_MAX) {
  const p = r / (r + mu);
  const out = new Float64Array(kMax + 1);
  let pmf = p ** r;
  for (let k = 0; k <= kMax; k++) {
    out[k] = pmf;
    pmf *= ((k + r) / (k + 1)) * (1 - p);
  }
  return out;
}

// Final score distribution as a flat (kMax+2)^2 grid: grid[h * size + a].
export function scoreGrid(homeMean, awayMean, r = TEAM_RUNS_DISPERSION) {
  const H = runsPmf(homeMean, r);
  const A = runsPmf(awayMean, r);
  const size = TEAM_RUNS_MAX + 2;
  const grid = new Float64Array(size * size);
  let homeWins = 0;
  let awayWins = 0;
  for (let h = 0; h <= TEAM_RUNS_MAX; h++)
    for (let a = 0; a <= TEAM_RUNS_MAX; a++) {
      if (h > a) homeWins += H[h] * A[a];
      else if (a > h) awayWins += H[h] * A[a];
    }
  const homeExtra = homeWins / (homeWins + awayWins);
  for (let h = 0; h <= TEAM_RUNS_MAX; h++)
    for (let a = 0; a <= TEAM_RUNS_MAX; a++) {
      const p = H[h] * A[a];
      if (h !== a) grid[h * size + a] += p;
      else {
        grid[(h + 1) * size + a] += p * homeExtra;
        grid[h * size + a + 1] += p * (1 - homeExtra);
      }
    }
  return { grid, size };
}

function gridChance({ grid, size }, test) {
  let sum = 0;
  for (let h = 0; h < size; h++) for (let a = 0; a < size; a++) if (test(h, a)) sum += grid[h * size + a];
  return sum;
}

// The two teams' mean runs matching DraftKings' home win chance and total.
export function fitTeamRuns(homeWinFair, totalLine, overFair, r = TEAM_RUNS_DISPERSION) {
  const overChance = g => {
    if (totalLine % 1 !== 0) return gridChance(g, (h, a) => h + a > totalLine);
    const push = gridChance(g, (h, a) => h + a === totalLine);
    return gridChance(g, (h, a) => h + a > totalLine) / (1 - push);
  };
  const bisect = (lo, hi, f) => {
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid)) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // Total mean for a given home share, then the share for the win chance.
  const totalFor = share => bisect(1, 25, t => overChance(scoreGrid(t * share, t * (1 - share), r)) < overFair);
  const share = bisect(0.15, 0.85, s => {
    const t = totalFor(s);
    return gridChance(scoreGrid(t * s, t * (1 - s), r), (h, a) => h > a) < homeWinFair;
  });
  const total = totalFor(share);
  return { home: total * share, away: total * (1 - share) };
}

// The lottery's team total for one team: the half-run line closest to 50/50.
export function lotteryTeamTotal(teamMean, r = TEAM_RUNS_DISPERSION) {
  const pmf = runsPmf(teamMean, r);
  const over = line => 1 - pmf.slice(0, Math.floor(line) + 1).reduce((s, p) => s + p, 0);
  let line = 0.5;
  while (line < 15 && Math.abs(over(line + 1) - 0.5) < Math.abs(over(line) - 0.5)) line += 1;
  return { line, over: over(line) };
}

// 得分最高單局: which inning (1-9, extra innings excluded) scores the most runs,
// or a tie for the most. No other source prices it, and the lottery's table
// barely moves between games (each price within about 0.2 on 8 games,
// 2026-09-25), so this is its average table. It adds up to about 1.92 in
// implied chance: a take of about 48%.
export const TOP_INNING_ODDS = [5.4, 6.38, 5.69, 6.13, 6.0, 6.04, 6.31, 5.97, 8.0, 2.19];

// Implied chances of every outcome in a market, summed. 1.15 means a 15% overround.
export function overround(oddsList) {
  return oddsList.reduce((s, o) => s + 1 / o, 0);
}

// The house's take on a market: the share of all money bet it keeps when
// bets come in balanced, 1 - 1 / sum(1 / odds). At every price = fair odds / 1.15
// that's 13%. `rels` are each price's relative margin; the take's margin
// follows from them (d take = d overround / overround^2).
export function houseTake(odds, rels = []) {
  const total = odds.reduce((s, o) => s + 1 / o, 0);
  const spread = odds.reduce((s, o, i) => s + (rels[i] ?? 0) / o, 0);
  return { take: 1 - 1 / total, margin: spread / total ** 2 };
}

// Legs are independent games, so chances and odds both multiply.
export function combineParlay(legs) {
  return legs.reduce(
    (acc, leg) => ({ odds: acc.odds * leg.odds, fairChance: acc.fairChance * leg.fairChance }),
    { odds: 1, fairChance: 1 }
  );
}

// Fair chance of every outcome for one game ({away, home} or {away, draw, home})
// from whichever sources exist, plus the K to use.
export function blendOutcomes(draftKings, polymarket) {
  if (draftKings && polymarket) {
    const blended = Object.fromEntries(Object.keys(draftKings).map(k => [k, (draftKings[k] + polymarket[k]) / 2]));
    return { probs: blended, k: K_BOTH, source: 'both' };
  }
  if (draftKings) return { probs: draftKings, k: K_DRAFTKINGS, source: 'draftkings' };
  if (polymarket) return { probs: polymarket, k: K_POLYMARKET, source: 'polymarket' };
  return null;
}

// Mulberry32: small seedable PRNG so a simulation can be replayed.
// `.state()` is where the sequence is now: seededRandom(r.state()) carries on
// exactly where r stopped.
export function seededRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a;
  return next;
}

// Betting habits for the season simulator. Each week a player buys a random
// number of tickets (Poisson around `perWeek`, so most weeks none: from about
// 1.5 tickets a month for the careful to one a week for a big fan), each with
// `legs` legs from different games (most lottery MLB games need 2+) and legs
// chosen by `pick`. Most tickets are a few hundred NT$ (`stakes`); a `big`
// share of them are NT$1,000-3,000. A chaser starts at `stakes[0]`, doubles
// after a losing week up to `chaseCap`, and drops back after a winning one.
export const BIG_STAKES = [1000, 2000, 3000];
export const HABITS = [
  { key: 'casual', perWeek: 0.5, legs: [2, 2], stakes: [100, 200, 300], big: 0.05, pick: 'any' },
  { key: 'fan', perWeek: 1, legs: [2, 2], stakes: [200, 300, 500], big: 0.1, pick: 'favorite' },
  { key: 'underdog', perWeek: 0.5, legs: [2, 3], stakes: [100, 200, 300], big: 0.05, pick: 'underdog' },
  { key: 'dreamer', perWeek: 0.5, legs: [4, 6], stakes: [100, 200], big: 0.02, pick: 'any' },
  { key: 'chaser', perWeek: 0.75, legs: [2, 2], stakes: [200], big: 0, pick: 'any', chaseCap: 3000 },
  { key: 'careful', perWeek: 0.35, legs: [2, 2], stakes: [200, 300, 500], big: 0.05, pick: 'best' }
];

// Splits a pool of bets ({gameId, fairChance, odds}) into the lists each
// `pick` style draws from. A style with nothing to pick falls back to all.
// ---- One shared world ---------------------------------------------------------
// Every player bets into the same world: each week every game (and each F1
// race) has one real result, and everyone who bet on it sees that result. A
// result is a hash of (world seed, week, market, copy) turned into a number
// in [0, 1) and matched against the market's outcomes, so nothing has to be
// stored and any player can be replayed alone. `copy` tells apart the
// several real games a week that share one template game (MLB plays ~90 a
// week; the board has ~15).
let worldSeed = 1;

function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function worldDraw(week, market, copy) {
  return mix32(mix32(mix32(mix32(worldSeed ^ 0x9e3779b9) ^ week) ^ market) ^ copy) / 4294967296;
}

function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return mix32(h) | 0;
}

// Each option's slice of [0, 1) within its market (a game's win market, its
// total, an F1 race), from the whole pool so filtered lists keep the slices.
function withOutcomes(pool) {
  const markets = new Map();
  for (const b of pool) {
    const key = b.key ?? `${b.gameId}|${b.market ?? ''}`;
    if (!markets.has(key)) markets.set(key, []);
    markets.get(key).push(b);
  }
  const out = new Map();
  for (const [key, options] of markets) {
    const total = options.reduce((sum, b) => sum + b.fairChance, 0) || 1;
    let lo = 0;
    for (const b of options) {
      const hi = lo + b.fairChance / total;
      out.set(b, { ...b, outLo: lo, outHi: hi, marketId: hashString(key), gameKey: hashString(String(b.gameKey ?? b.gameId)) });
      lo = hi;
    }
  }
  return pool.map(b => out.get(b));
}

export function habitPools(rawPool) {
  const pool = withOutcomes(rawPool);
  const byBack = [...pool].sort((a, b) => b.fairChance * b.odds - a.fairChance * a.odds);
  const lists = {
    any: pool,
    favorite: pool.filter(b => b.fairChance >= 0.55),
    underdog: pool.filter(b => b.fairChance <= 0.4),
    best: byBack.slice(0, Math.max(1, Math.ceil(pool.length / 4)))
  };
  for (const k of Object.keys(lists)) if (lists[k].length === 0) lists[k] = pool;
  return lists;
}

// Pools compiled to flat arrays (game index, fair chance, odds), so the inner
// loop reads numbers and allocates nothing. Cached per list. `pickCum` is how
// players choose among the options: in proportion to each one's chance of
// winning. A game's outcomes add up to 1, so every game is equally likely to
// be picked, and within it favourites far more often than long shots (a
// 0.1% F1 driver gets 0.1% of the bets on that race, not 1 in 23).
const compiledLists = new WeakMap();
function compile(list) {
  let c = compiledLists.get(list);
  if (!c) {
    const games = new Map();
    c = {
      n: list.length,
      game: Int32Array.from(list, b => (games.has(b.gameId) ? games.get(b.gameId) : games.set(b.gameId, games.size).get(b.gameId))),
      fair: Float64Array.from(list, b => b.fairChance),
      odds: Float64Array.from(list, b => b.odds),
      pickCum: new Float64Array(list.length),
      // Where each option sits in its market, for the shared results.
      lo: Float64Array.from(list, b => b.outLo ?? 0),
      hi: Float64Array.from(list, b => b.outHi ?? b.fairChance),
      market: Int32Array.from(list, b => b.marketId ?? b.gameId ?? 0),
      gameKey: Int32Array.from(list, b => b.gameKey ?? 0)
    };
    let sum = 0;
    list.forEach((b, i) => (c.pickCum[i] = sum += b.fairChance));
    for (let i = 0; i < c.n; i++) c.pickCum[i] /= sum;
    compiledLists.set(list, c);
  }
  return c;
}

// Games already on the ticket being built (at most 12 legs).
const ticketGames = new Int32Array(16);

// What a player can bet on in a week: one or more compiled lists (one per
// sport), picked in proportion to `weights` (the sport's games that week).
// Game keys are made unique across sports.
// `weights` are the real games each sport plays that week: each template game
// on the board stands for `copies` of them, each with its own result.
function picker(lists, weights = lists.map(() => 1)) {
  const compiled = lists.map(compile);
  const cum = new Float64Array(lists.length);
  let sum = 0;
  weights.forEach((w, i) => (cum[i] = sum += w));
  for (let i = 0; i < cum.length; i++) cum[i] /= sum;
  const copies = Int32Array.from(compiled, (c, i) => Math.max(1, Math.round(weights[i] / Math.max(1, new Set(c.game).size))));
  return { compiled, cum, copies, games: compiled.reduce((n, c, i) => n + new Set(c.game).size * copies[i], 0) };
}

// A player's running totals, so a season can stop and carry on later.
function freshState(habit) {
  return {
    profit: 0,
    tickets: 0,
    wonTickets: 0,
    staked: 0,
    biggestWin: 0,
    biggestWinWeek: -1,
    biggestWinStake: 0,
    biggestWinLegs: 0,
    biggestWinOdds: 0,
    losing: 0,
    longestLosing: 0,
    winning: 0,
    longestWinning: 0,
    // The longest-odds ticket that won, the worst week, tax withheld, and
    // whether the very first ticket won.
    longshotOdds: 0,
    longshotWeek: -1,
    longshotStake: 0,
    longshotWin: 0,
    worstWeek: 0,
    worstWeekAt: -1,
    taxPaid: 0,
    firstWon: null,
    chaseStake: habit.stakes[0],
    maxStake: 0,
    peak: 0,
    peakWeek: -1,
    maxDrop: 0
  };
}

// The story told about a player at some point of their season.
function storyOf(st) {
  return {
    final: st.profit,
    tickets: st.tickets,
    wonTickets: st.wonTickets,
    staked: st.staked,
    biggestWin: st.biggestWin,
    biggestWinWeek: st.biggestWinWeek,
    biggestWinStake: st.biggestWinStake,
    biggestWinLegs: st.biggestWinLegs,
    biggestWinOdds: st.biggestWinOdds,
    longestLosing: st.longestLosing,
    maxStake: st.maxStake,
    peak: st.peak,
    peakWeek: st.peakWeek,
    everAhead: st.peak > 0,
    maxDrop: st.maxDrop,
    longestWinning: st.longestWinning,
    longshotOdds: st.longshotOdds,
    longshotWeek: st.longshotWeek,
    longshotStake: st.longshotStake,
    longshotWin: st.longshotWin,
    worstWeek: st.worstWeek,
    worstWeekAt: st.worstWeekAt,
    taxPaid: st.taxPaid,
    firstWon: st.firstWon === true
  };
}

// One player's betting with `habit` from week `from` up to `weeks`, carrying
// on from `st` (their state so far; a fresh one by default). `weekPicker(w)`
// is what the player bets on in week w (null: nothing to bet on; then with
// chance `switchRate` they bet on `fallback(w)` instead). Writes the running
// profit at the end of each week into `path` (if given), calls
// `onWeek(w + 1, st)` after each week, and returns the story.
function playSeason(habit, weekPicker, weeks, random, path, fallback = null, switchRate = 0, legsCap = null, { from = 0, st = freshState(habit), onWeek = null } = {}) {
  const noTicket = Math.exp(-habit.perWeek);
  const [lo, hi] = legsCap ?? habit.legs;
  const legSpan = hi - lo + 1;
  const base = habit.stakes[0];
  for (let w = from; w < weeks; w++) {
    let pick = weekPicker(w);
    if (!pick && fallback && random() < switchRate) pick = fallback(w);
    // Poisson number of tickets this week (none when there's nothing to bet on).
    let count = 0;
    if (pick) for (let p = random(); p > noTicket; p *= random()) count++;
    let week = 0;
    for (let i = 0; i < count; i++) {
      const want = Math.min(lo + Math.floor(random() * legSpan), pick.games);
      let legs = 0;
      let won = true;
      let odds = 1;
      for (let tries = 0; legs < want && tries < want * 20; tries++) {
        const r = random();
        let s = 0;
        while (s < pick.cum.length - 1 && r > pick.cum[s]) s++;
        const c = pick.compiled[s];
        const u = random();
        let lo = 0;
        let hi = c.n - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (c.pickCum[mid] < u) lo = mid + 1;
          else hi = mid;
        }
        const j = lo;
        // Which of that week's real games this is, and its shared result.
        const copy = Math.floor(random() * pick.copies[s]);
        const game = mix32(c.gameKey[j] ^ Math.imul(copy + 1, 0x9e3779b1)) | 0;
        let dup = false;
        for (let k = 0; k < legs; k++) if (ticketGames[k] === game) dup = true;
        if (dup) continue;
        ticketGames[legs++] = game;
        odds *= c.odds[j];
        const result = worldDraw(w, c.market[j], copy);
        if (result < c.lo[j] || result >= c.hi[j]) won = false;
      }
      if (legs === 0) continue;
      const stake = habit.chaseCap
        ? st.chaseStake
        : random() < habit.big
          ? BIG_STAKES[Math.floor(random() * BIG_STAKES.length)]
          : habit.stakes[Math.floor(random() * habit.stakes.length)];
      const gross = stake * odds;
      const result = won ? afterTax(gross) - stake : -stake;
      st.firstWon ??= won;
      st.tickets++;
      st.staked += stake;
      week += result;
      if (stake > st.maxStake) st.maxStake = stake;
      if (won) {
        st.wonTickets++;
        st.losing = 0;
        if (++st.winning > st.longestWinning) st.longestWinning = st.winning;
        st.taxPaid += gross - afterTax(gross);
        if (odds > st.longshotOdds) {
          st.longshotOdds = odds;
          st.longshotWeek = w;
          st.longshotStake = stake;
          st.longshotWin = result;
        }
        if (result > st.biggestWin) {
          st.biggestWin = result;
          st.biggestWinWeek = w;
          st.biggestWinStake = stake;
          st.biggestWinLegs = legs;
          st.biggestWinOdds = odds;
        }
      } else {
        st.winning = 0;
        if (++st.losing > st.longestLosing) st.longestLosing = st.losing;
      }
    }
    if (week < st.worstWeek) {
      st.worstWeek = week;
      st.worstWeekAt = w;
    }
    if (habit.chaseCap && count > 0) st.chaseStake = week < 0 ? Math.min(st.chaseStake * 2, habit.chaseCap) : base;
    st.profit += week;
    if (path) path[w] = st.profit;
    if (st.profit > st.peak) {
      st.peak = st.profit;
      st.peakWeek = w;
    }
    if (st.peak - st.profit > st.maxDrop) st.maxDrop = st.peak - st.profit;
    if (onWeek) onWeek(w + 1, st);
  }
  return storyOf(st);
}

// One player's season with their full week-by-week path.
export function simulateHabit({ habit, pools, weeks, random = Math.random, seed = 1 }) {
  worldSeed = seed;
  const path = new Float64Array(weeks);
  const pick = picker([pools[habit.pick]]);
  return { path, ...playSeason(habit, () => pick, weeks, random, path) };
}

// Each player gets their own random stream, so any one of them can be
// replayed exactly without storing everyone's path.
export function playerRandom(seed, index) {
  return seededRandom((Math.imul(seed, 0x9e3779b1) + Math.imul(index + 1, 0x85ebca6b)) >>> 0);
}

// Histogram bins for the weekly spread: about 2 million counters at most, and
// a range wide enough for the worst chaser.
function histogramShape(weeks) {
  const bins = Math.min(20000, Math.floor(2_000_000 / weeks));
  const half = 2500 * weeks + 20000;
  return { bins, lo: -half, width: (2 * half) / bins };
}

// ---- Multi-sport calendar ----------------------------------------------------

// Periods run month by month up to 5 years; a month is 52 / 12 weeks, rounded
// (1 month = 4 weeks, 3 = 13, 6 = 26, 12 = 52).
export const MAX_MONTHS = 60;
export const monthWeeks = months => Math.round((months * 52) / 12);
export const MONTH_WEEKS = Array.from({ length: MAX_MONTHS }, (_, i) => monthWeeks(i + 1));
export const SPORTS = ['mlb', 'epl', 'nba', 'f1'];
// Who bets on what. A fan of one sport bets on it while it's in season; in
// its off-season, OFFSEASON_SWITCH of them bet on whatever else is on that
// week and the rest take the week off. F1 is one race at a time, so F1 fans'
// tickets are single picks.
export const FANS = [
  { key: 'mlb', sports: ['mlb'] },
  { key: 'epl', sports: ['epl'] },
  { key: 'nba', sports: ['nba'] },
  { key: 'f1', sports: ['f1'], legs: [1, 1] },
  { key: 'all', sports: SPORTS }
];
export const OFFSEASON_SWITCH = 0.3;
const F1_RACE_WEEKS = new Set([9, 11, 13, 15, 17, 19, 20, 22, 23, 25, 26, 27, 29, 30, 34, 35, 37, 38, 41, 42, 43, 45, 47, 48]);
const EPL_BREAKS = new Set([12, 36, 41, 46]);

// Games a sport has in a week of the year (0 = first week of January), from
// its usual calendar: MLB ~2,430 regular-season games late March to September
// plus the October postseason; the Premier League's 380 games August to May,
// with international breaks and a busy festive period; the NBA's 1,230 games
// late October to mid April plus the playoffs to June; 24 F1 races.
export function gamesInWeek(sport, week) {
  const w = ((week % 52) + 52) % 52;
  if (sport === 'mlb') return w >= 12 && w <= 38 ? 93 : w >= 39 && w <= 42 ? 10 : 0;
  if (sport === 'epl') {
    if (!(w >= 32 || w <= 20) || EPL_BREAKS.has(w)) return 0;
    return w === 51 || w === 0 ? 20 : 10;
  }
  if (sport === 'nba') return w >= 42 || w <= 14 ? 47 : w >= 15 && w <= 23 ? 9 : 0;
  if (sport === 'f1') return F1_RACE_WEEKS.has(w) ? 1 : 0;
  return 0;
}

// Week of the year (0-51) for a date.
export function weekOfYear(date) {
  const d = new Date(date);
  return Math.min(51, Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * 86_400_000)));
}

// The simulated groups: every habit x every fan type, each with what it can
// bet on week by week. `sportPools` maps a sport to habitPools(...) of its
// bets (a template for that sport's games); a missing sport is never on.
function multiSportGroups(sportPools, startWeek, weeks) {
  const cache = new Map();
  const pickerFor = (sports, pick, w) => {
    const live = sports.filter(sp => sportPools[sp] && gamesInWeek(sp, startWeek + w) > 0);
    if (live.length === 0) return null;
    const weights = live.map(sp => gamesInWeek(sp, startWeek + w));
    const key = `${pick}|${live.join(',')}|${weights.join(',')}`;
    if (!cache.has(key)) cache.set(key, picker(live.map(sp => sportPools[sp][pick]), weights));
    return cache.get(key);
  };
  const groups = [];
  for (const habit of HABITS)
    for (const fan of FANS) {
      const own = Array.from({ length: weeks }, (_, w) => pickerFor(fan.sports, habit.pick, w));
      const other = Array.from({ length: weeks }, (_, w) => pickerFor(SPORTS, habit.pick, w));
      groups.push({ habit, fan, weekPicker: w => own[w], fallback: fan.key === 'all' ? null : w => other[w], switchRate: OFFSEASON_SWITCH, legs: fan.legs ?? null });
    }
  return groups;
}

// A crowd of players in groups: with `sportPools`, every habit x fan type on
// the multi-sport calendar starting at week `startWeek`; with `pools`, one
// group per habit on the same bets every week. `perGroup` players each.
// Nothing per player is kept but the final result: each week streams into a
// histogram (for the 10/25/50/75/90% bands) and each group into running sums.
// Record holders and the players at the top 10%, middle and bottom 10% are
// replayed at the end for their full stories.
//
// The crowd at several points at once: one pass of `weeks` weeks yields the
// stats after each week in `checkpoints` (1, 3 and 6 months come free with a
// year). `resume` (from an earlier run's `resume`) carries every player on
// from where that run stopped instead of starting over, so 3 years is the
// 1-year run plus 2 more years. Returns { results: {weeks: stats}, resume }.
export function simulateCrowd({ pools, sportPools, startWeek = 0, weeks, checkpoints = [weeks], perHabit, perGroup, seed = 1, onProgress, resume = null }) {
  worldSeed = seed;
  const groups = sportPools
    ? multiSportGroups(sportPools, startWeek, weeks)
    : HABITS.map(habit => {
        const pick = picker([pools[habit.pick]]);
        return { habit, fan: null, weekPicker: () => pick, fallback: null, switchRate: 0, legs: null };
      });
  const per = perGroup ?? perHabit ?? 500;
  const total = groups.length * per;
  const from = resume?.weeks ?? 0;
  const marks = [...new Set(checkpoints)].filter(c => c > from && c <= weeks).sort((x, y) => x - y);
  const { bins, lo, width } = histogramShape(weeks);
  // Weekly spread for the weeks this run plays; earlier weeks come from `resume`.
  const span = weeks - from;
  const hist = new Uint32Array(span * bins);
  const aheadByWeek = new Uint32Array(span);
  const netByWeek = new Float64Array(span);
  const path = new Float64Array(weeks);
  const states = new Array(total);
  const rngs = new Uint32Array(total);
  const emptySum = () => ({ n: 0, staked: 0, net: 0, tickets: 0, ahead: 0, everAhead: 0, capHits: 0, rr: 0, rs: 0, ss: 0 });
  // One tally per checkpoint: group sums, record holders and crowd totals.
  const tallies = new Map(
    marks.map(m => [
      m,
      {
        finals: new Float64Array(total),
        sums: groups.map(emptySum),
        records: {
          biggestWin: [-1, -Infinity],
          best: [-1, -Infinity],
          worst: [-1, Infinity],
          drought: [-1, -1],
          fall: [-1, -1],
          hotStreak: [-1, 0],
          longshot: [-1, 0],
          worstWeek: [-1, 0],
          mostTickets: [-1, 0],
          closest: [-1, Infinity],
          taxman: [-1, 0]
        },
        crowd: { winnings: 0, losses: 0, neverWon: 0, wonTickets: 0, taxTotal: 0, taxed: 0, firstWon: 0, firstWonLost: 0 }
      }
    ])
  );
  const count = (tally, g, index, story) => {
    const beat = (key, value, higher = true) => {
      const r = tally.records[key];
      if (higher ? value > r[1] : value < r[1]) tally.records[key] = [index, value];
    };
    const sum = tally.sums[g];
    const c = tally.crowd;
    tally.finals[index] = story.final;
    const returned = story.staked + story.final;
    sum.n++;
    sum.staked += story.staked;
    sum.net += story.final;
    sum.tickets += story.tickets;
    sum.rr += returned * returned;
    sum.rs += returned * story.staked;
    sum.ss += story.staked * story.staked;
    if (story.final > 0) {
      sum.ahead++;
      c.winnings += story.final;
    } else c.losses -= story.final;
    if (story.everAhead) sum.everAhead++;
    if (groups[g].habit.chaseCap && story.maxStake >= groups[g].habit.chaseCap) sum.capHits++;
    if (story.wonTickets === 0 && story.tickets > 0) c.neverWon++;
    c.wonTickets += story.wonTickets;
    c.taxTotal += story.taxPaid;
    if (story.taxPaid > 0) c.taxed++;
    if (story.firstWon) {
      c.firstWon++;
      if (story.final < 0) c.firstWonLost++;
    }
    beat('biggestWin', story.biggestWin);
    beat('best', story.final);
    beat('worst', story.final, false);
    beat('drought', story.longestLosing);
    // Furthest ahead at some point, yet down at the end.
    if (story.final < 0) beat('fall', story.peak);
    beat('hotStreak', story.longestWinning);
    beat('longshot', story.longshotOdds);
    beat('worstWeek', story.worstWeek, false);
    beat('mostTickets', story.tickets);
    // Closest to breaking even, among people who really played.
    if (story.tickets >= 10) beat('closest', Math.abs(story.final), false);
    beat('taxman', story.taxPaid);
  };
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    for (let i = 0; i < per; i++) {
      const index = g * per + i;
      const random = resume ? seededRandom(resume.rngs[index]) : playerRandom(seed, index);
      const st = resume ? { ...resume.states[index] } : freshState(group.habit);
      playSeason(group.habit, group.weekPicker, weeks, random, path, group.fallback, group.switchRate, group.legs, {
        from,
        st,
        onWeek: (w, now) => {
          const v = now.profit;
          let bin = Math.floor((v - lo) / width);
          bin = bin < 0 ? 0 : bin >= bins ? bins - 1 : bin;
          hist[(w - 1 - from) * bins + bin]++;
          if (v > 0) aheadByWeek[w - 1 - from]++;
          netByWeek[w - 1 - from] += v;
          const tally = tallies.get(w);
          if (tally) count(tally, g, index, storyOf(now));
        }
      });
      states[index] = st;
      rngs[index] = random.state();
      if (onProgress && index % 2000 === 1999) onProgress((index + 1) / total);
    }
  }
  // Weekly bands from the histogram (each value is its bin's middle).
  const at = (w, q) => {
    const target = q * (total - 1);
    let seen = 0;
    for (let b = 0; b < bins; b++) {
      seen += hist[w * bins + b];
      if (seen > target) return lo + (b + 0.5) * width;
    }
    return lo + (bins - 0.5) * width;
  };
  const bands = [
    ...(resume?.bands ?? []),
    ...Array.from({ length: span }, (_, w) => ({
      q01: at(w, 0.01),
      q05: at(w, 0.05),
      q10: at(w, 0.1),
      q25: at(w, 0.25),
      q50: at(w, 0.5),
      q75: at(w, 0.75),
      q90: at(w, 0.9),
      q95: at(w, 0.95),
      q99: at(w, 0.99),
      ahead: aheadByWeek[w],
      mean: netByWeek[w] / total
    }))
  ];
  // Per habit and per fan type, merged over the other dimension.
  const summarize = members => {
    const s = members.reduce((acc, m) => {
      for (const k of Object.keys(acc)) acc[k] += m[k];
      return acc;
    }, emptySum());
    const n = s.n;
    const back = s.staked > 0 ? (s.staked + s.net) / s.staked : 1;
    const aheadShare = s.ahead / n;
    // 95% sampling margins: a ratio estimate for the amount back, binomial for the share.
    const spread = Math.max(0, s.rr - 2 * back * s.rs + back * back * s.ss);
    const meanStaked = s.staked / n;
    return {
      back: back * 100,
      backMargin: n > 1 && meanStaked > 0 ? (1.96 * Math.sqrt(spread / (n * (n - 1))) * 100) / meanStaked : 0,
      aheadShare,
      aheadMargin: 1.96 * Math.sqrt((aheadShare * (1 - aheadShare)) / n),
      avgFinal: s.net / n,
      avgStaked: s.staked / n,
      avgTickets: s.tickets / n,
      capShare: s.capHits / n,
      players: n
    };
  };
  const results = {};
  for (const [m, tally] of tallies) {
    const { finals, sums, records, crowd } = tally;
    const summaries = HABITS.map(habit => ({ habit, ...summarize(sums.filter((_, g) => groups[g].habit === habit)) }));
    const fanSummaries = sportPools ? FANS.map(fan => ({ fan, ...summarize(sums.filter((_, g) => groups[g].fan === fan)) })) : [];
    // Sorted results (a plain numeric sort, far quicker than sorting indexes).
    const sorted = finals.slice().sort();
    // Replays one player exactly up to this checkpoint; `serial` is their
    // 1-based number in the crowd.
    const replayIndex = index => {
      const group = groups[Math.floor(index / per)];
      const p = new Float64Array(m);
      return { serial: index + 1, habit: group.habit, fan: group.fan, path: p, ...playSeason(group.habit, group.weekPicker, m, playerRandom(seed, index), p, group.fallback, group.switchRate, group.legs) };
    };
    // The player at rank r; among equal results, the lower number comes first.
    const atRank = r => {
      const v = sorted[r];
      let lo = 0;
      let hi = r;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      let k = r - lo;
      for (let i = 0; i < total; i++) if (finals[i] === v && k-- === 0) return i;
      return -1;
    };
    const replay = q => replayIndex(atRank(Math.round((total - 1) * q)));
    // Every habit x fan group on its own (its players are indexes
    // g * per ... g * per + per - 1): for "people like you".
    const groupStats = groups.map((group, g) => {
      const mine = finals.slice(g * per, (g + 1) * per).sort();
      return {
        habit: group.habit.key,
        fan: group.fan?.key ?? null,
        ...summarize([sums[g]]),
        median: mine[Math.floor(per / 2)],
        best: mine[per - 1],
        worst: mine[0],
        q10: mine[Math.floor(per * 0.1)],
        q90: mine[Math.floor(per * 0.9)]
      };
    });
    const finalAt = q => sorted[Math.round((total - 1) * q)];
    const sumOf = key => sums.reduce((acc, x) => acc + x[key], 0);
    results[m] = {
      weeks: m,
      players: total,
      bands: bands.slice(0, m),
      summaries,
      fanSummaries,
      groupStats,
      characters: { best: replay(0.9), median: replay(0.5), worst: replay(0.1) },
      totals: {
        staked: sumOf('staked'),
        net: sumOf('net'),
        tickets: sumOf('tickets'),
        aheadShare: sumOf('ahead') / total,
        everAheadShare: sumOf('everAhead') / total
      },
      // Notable players, replayed in full, and crowd-wide numbers for the fun facts.
      notable: Object.fromEntries(Object.entries(records).filter(([, [index]]) => index >= 0).map(([key, [index]]) => [key, replayIndex(index)])),
      crowd: {
        winnings: crowd.winnings,
        losses: crowd.losses,
        neverWonShare: crowd.neverWon / total,
        top1: finalAt(0.99),
        top01: finalAt(0.999),
        wonTickets: crowd.wonTickets,
        taxTotal: crowd.taxTotal,
        taxedShare: crowd.taxed / total,
        firstWonShare: crowd.firstWon / total,
        firstWonLostShare: crowd.firstWon > 0 ? crowd.firstWonLost / crowd.firstWon : 0
      }
    };
  }
  return { results, resume: { weeks, states, rngs, bands } };
}

// Any one player of the crowd, replayed exactly: `index` is their serial - 1.
export function replayPlayer({ pools, sportPools, startWeek = 0, weeks, perGroup, perHabit, seed = 1, index }) {
  worldSeed = seed;
  const groups = sportPools
    ? multiSportGroups(sportPools, startWeek, weeks)
    : HABITS.map(habit => {
        const pick = picker([pools[habit.pick]]);
        return { habit, fan: null, weekPicker: () => pick, fallback: null, switchRate: 0, legs: null };
      });
  const per = perGroup ?? perHabit ?? 500;
  const group = groups[Math.floor(index / per)];
  if (!group) return null;
  const path = new Float64Array(weeks);
  return { serial: index + 1, habit: group.habit, fan: group.fan, path, ...playSeason(group.habit, group.weekPicker, weeks, playerRandom(seed, index), path, group.fallback, group.switchRate, group.legs) };
}

// The crowd after `weeks` weeks (one checkpoint of simulateCrowd).
export function simulateCrowdStats(options) {
  return simulateCrowd({ ...options, checkpoints: [options.weeks] }).results[options.weeks];
}

// Value at quantile q (0-1) of an ascending sorted array.
export function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

// ---- Bet slip ---------------------------------------------------------------

// Taiwan Sports Lottery ticket rules: 1-12 games per ticket (never two picks
// from one game), NT$10 units per combination, NT$100-100,000 per ticket,
// payouts capped at NT$20 million per ticket. Any single combination paying
// over NT$5,000 has 20% income tax and 0.4% stamp duty withheld.
export const SLIP_RULES = {
  maxLegs: 12,
  unit: 10,
  minTicket: 100,
  maxTicket: 100_000,
  maxPayout: 20_000_000,
  taxFree: 5000,
  taxRate: 0.2,
  stampRate: 0.004
};

// What a winning combination actually pays out after Taiwan's withholding.
export function afterTax(pay) {
  return pay > SLIP_RULES.taxFree ? pay * (1 - SLIP_RULES.taxRate - SLIP_RULES.stampRate) : pay;
}

export function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
}

// Combination sizes each mode buys for n legs: 一關 = every game on its own,
// 全部過關 = all n together, 過關組合 = the chosen sizes.
export function slipSizes(mode, n, chosen = []) {
  if (mode === 'single') return n >= 1 ? [1] : [];
  if (mode === 'parlay') return n >= 2 ? [n] : [];
  return [...new Set(chosen)].filter(k => k >= 2 && k <= n).sort((a, b) => a - b);
}

// Rule problems with a ticket, as codes the page turns into text.
export function slipErrors({ mode, legs, sizes, stake }) {
  const errors = [];
  const n = legs.length;
  if (n === 0) return ['empty'];
  if (n > SLIP_RULES.maxLegs) errors.push('tooManyLegs');
  if (new Set(legs.map(l => l.gameId)).size !== n) errors.push('sameGame');
  if (mode === 'parlay' && n < 2) errors.push('parlayNeedsTwo');
  if (mode === 'system' && n < 3) errors.push('systemNeedsThree');
  if (mode === 'system' && n >= 3 && sizes.length === 0) errors.push('noSizes');
  if (!(stake >= SLIP_RULES.unit) || stake % SLIP_RULES.unit !== 0) errors.push('stakeUnit');
  const combos = sizes.reduce((s, k) => s + choose(n, k), 0);
  const cost = combos * stake;
  if (combos > 0 && cost < SLIP_RULES.minTicket) errors.push('ticketMin');
  if (cost > SLIP_RULES.maxTicket) errors.push('ticketMax');
  return errors;
}

// Everything about one ticket, exactly: every way the legs can land (2^n, at
// most 4,096), and for each one every winning combination, taxed one by one.
// Fair chances are treated as independent (different games).
export function evaluateSlip({ legs, sizes, stake }) {
  const n = legs.length;
  const sizeSet = new Set(sizes);
  const combos = sizes.reduce((s, k) => s + choose(n, k), 0);
  const cost = combos * stake;
  const byHits = Array.from({ length: n + 1 }, (_, hits) => ({ hits, chance: 0, min: Infinity, max: 0 }));
  let expected = 0;
  let expectedNet = 0;
  let anyPayout = 0;
  let profit = 0;
  let best = 0;
  for (let won = 0; won < 1 << n; won++) {
    let chance = 1;
    const odds = [];
    for (let i = 0; i < n; i++) {
      if (won & (1 << i)) {
        chance *= legs[i].fairChance;
        odds.push(legs[i].odds);
      } else chance *= 1 - legs[i].fairChance;
    }
    // Every combination made only of winning legs pays stake x its odds.
    let gross = 0;
    let net = 0;
    const m = odds.length;
    for (let pick = 1; pick < 1 << m; pick++) {
      let size = 0;
      let product = 1;
      for (let j = 0; j < m; j++) if (pick & (1 << j)) (size++, (product *= odds[j]));
      if (!sizeSet.has(size)) continue;
      const pay = stake * product;
      gross += pay;
      net += afterTax(pay);
    }
    if (gross > SLIP_RULES.maxPayout) {
      net *= SLIP_RULES.maxPayout / gross;
      gross = SLIP_RULES.maxPayout;
    }
    expected += chance * gross;
    expectedNet += chance * net;
    if (gross > 0) anyPayout += chance;
    if (net > cost) profit += chance;
    if (gross > best) best = gross;
    const row = byHits[m];
    row.chance += chance;
    row.min = Math.min(row.min, gross);
    row.max = Math.max(row.max, gross);
  }
  return { combos, cost, best, expected, expectedNet, anyPayout, profit, byHits };
}

// What a ticket pays for every way its legs can land: index = bit mask of the
// legs that won. Gross is capped per ticket; net also takes Taiwan's tax off
// each combination over NT$5,000.
export function slipPayoutTable({ legs, sizes, stake }) {
  const n = legs.length;
  const sizeSet = new Set(sizes);
  const gross = new Float64Array(1 << n);
  const net = new Float64Array(1 << n);
  for (let won = 0; won < 1 << n; won++) {
    let g = 0;
    let t = 0;
    // Every combination made only of winning legs pays stake x its odds.
    for (let pick = won; pick > 0; pick = (pick - 1) & won) {
      let size = 0;
      let product = 1;
      for (let i = 0; i < n; i++) if (pick & (1 << i)) (size++, (product *= legs[i].odds));
      if (!sizeSet.has(size)) continue;
      const pay = stake * product;
      g += pay;
      t += afterTax(pay);
    }
    if (g > SLIP_RULES.maxPayout) {
      t *= SLIP_RULES.maxPayout / g;
      g = SLIP_RULES.maxPayout;
    }
    gross[won] = g;
    net[won] = t;
  }
  return { gross, net };
}

// A deep look at one ticket, all exact except the one-year outlook:
// - every result (legs won) with its chance and after-tax payout;
// - where each NT$100 goes: the lottery's cut, the tax, what comes back;
// - each leg's own value and what the ticket would return without it;
// - how rare the top payout is, and which results still make a profit;
// - buying the same ticket every week for `weeks` weeks: the chance of being
//   ahead and the usual range (a fixed-seed draw of `seasons` years, so it
//   reads the same every time).
export function analyzeSlip({ legs, sizes, stake, weeks = 52, seasons = 20_000, seed = 1 }) {
  const n = legs.length;
  const { gross, net } = slipPayoutTable({ legs, sizes, stake });
  const cost = sizes.reduce((s, k) => s + choose(n, k), 0) * stake;
  const chance = new Float64Array(1 << n);
  for (let won = 0; won < 1 << n; won++) {
    let p = 1;
    for (let i = 0; i < n; i++) p *= won & (1 << i) ? legs[i].fairChance : 1 - legs[i].fairChance;
    chance[won] = p;
  }
  let expectedGross = 0;
  let expectedNet = 0;
  let second = 0;
  let paid = 0;
  let profit = 0;
  const byHits = Array.from({ length: n + 1 }, (_, hits) => ({ hits, chance: 0, min: Infinity, max: 0, profit: false }));
  for (let won = 0; won < 1 << n; won++) {
    const p = chance[won];
    expectedGross += p * gross[won];
    expectedNet += p * net[won];
    second += p * net[won] * net[won];
    if (gross[won] > 0) paid += p;
    if (net[won] > cost) profit += p;
    let hits = 0;
    for (let i = 0; i < n; i++) if (won & (1 << i)) hits++;
    const row = byHits[hits];
    row.chance += p;
    row.min = Math.min(row.min, net[won]);
    row.max = Math.max(row.max, net[won]);
    if (net[won] > cost) row.profit = true;
  }
  const all = (1 << n) - 1;
  // Fewest legs won that can still show a profit.
  const profitFrom = byHits.find(r => r.profit)?.hits ?? null;
  // Each leg on its own (odds x chance) and the ticket without it.
  const backPer100 = cost > 0 ? (expectedNet / cost) * 100 : 0;
  const legInfo = legs.map((leg, i) => {
    const rest = legs.filter((_, j) => j !== i);
    const restSizes = [...new Set(sizes.map(k => Math.min(k, rest.length)))].filter(k => k >= 1);
    const without = rest.length && restSizes.length ? evaluateSlip({ legs: rest, sizes: restSizes, stake }) : null;
    return {
      fairOdds: 1 / leg.fairChance,
      value: leg.fairChance * leg.odds * 100,
      without: without && without.cost > 0 ? (without.expectedNet / without.cost) * 100 : null
    };
  });
  const weakest = legInfo.reduce((w, l, i) => (l.value < legInfo[w].value ? i : w), 0);

  // Same ticket every week: draw each week's result from the exact chances.
  const cumulative = new Float64Array(1 << n);
  let run = 0;
  for (let won = 0; won < 1 << n; won++) cumulative[won] = run += chance[won];
  const random = seededRandom(seed);
  const finals = new Float64Array(seasons);
  let ahead = 0;
  let neverPaid = 0;
  for (let s = 0; s < seasons; s++) {
    let total = 0;
    let anyPaid = false;
    for (let w = 0; w < weeks; w++) {
      const u = random() * run;
      let lo = 0;
      let hi = all;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < u) lo = mid + 1;
        else hi = mid;
      }
      total += net[lo] - cost;
      if (gross[lo] > 0) anyPaid = true;
    }
    finals[s] = total;
    if (total > 0) ahead++;
    if (!anyPaid) neverPaid++;
  }
  finals.sort();
  const at = q => finals[Math.min(seasons - 1, Math.floor(q * seasons))];
  return {
    cost,
    combos: cost / stake,
    expectedGross,
    expectedNet,
    backPer100,
    sd: Math.sqrt(Math.max(0, second - expectedNet * expectedNet)),
    // Per NT$100: the lottery's cut, the tax, and what comes back.
    per100: cost > 0 ? { take: 100 - (expectedGross / cost) * 100, tax: ((expectedGross - expectedNet) / cost) * 100, back: backPer100 } : null,
    paid,
    profit,
    profitFrom,
    top: { chance: chance[all], net: net[all], gross: gross[all] },
    // After-tax payout for every result (bit i set: leg i won), for draws.
    net,
    byHits,
    legs: legInfo,
    weakest,
    year: { weeks, ahead: ahead / seasons, neverPaid: neverPaid / seasons, q10: at(0.1), q50: at(0.5), q90: at(0.9), expected: weeks * (expectedNet - cost) }
  };
}

// A typical week of games for a sport with nothing on the board today (and
// always for the NBA, whose game odds aren't fetched): win chances spread as
// they usually are in that sport, priced at the lottery's usual cut. Seeded,
// so it's the same every time.
export function sportTemplate(sport, seed = 7) {
  const random = seededRandom(seed);
  const between = (lo, hi) => lo + random() * (hi - lo);
  const bets = [];
  const two = (gameId, p) => [p, 1 - p].forEach(q => bets.push({ gameId, fairChance: q, odds: estimateLotteryOdds(q, 1.15) }));
  if (sport === 'mlb') for (let g = 0; g < 15; g++) (two(g, between(0.35, 0.65)), two(g + 100, between(0.45, 0.55)));
  if (sport === 'nba') for (let g = 0; g < 10; g++) (two(g, between(0.15, 0.85)), two(g + 100, between(0.47, 0.53)));
  if (sport === 'epl')
    for (let g = 0; g < 10; g++) {
      const home = between(0.3, 0.6);
      const draw = between(0.22, 0.3);
      [home, draw, 1 - home - draw].forEach(q => bets.push({ gameId: g, fairChance: q, odds: estimateLotteryOdds(q, 1.15) }));
      two(g + 100, between(0.45, 0.55));
    }
  if (sport === 'f1') [0.35, 0.2, 0.14, 0.1, 0.06, 0.05, 0.04, 0.03, 0.01, 0.01, 0.005, 0.005].forEach(p => bets.push({ gameId: 0, fairChance: p, odds: estimateF1LotteryOdds(p) }));
  // Keys per sport, so template games of different sports get their own results.
  return bets.map(b => ({ ...b, key: `${sport}|${b.gameId}`, gameKey: `${sport}|${b.gameId % 100}` }));
}
