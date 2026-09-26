import { minLegsProblem } from './rules.mjs';
// Pure odds math, shared by the browser page and scripts/build-data.mjs.

// Fitted on 2026-09-25 against real Taiwan Sports Lottery prices (14 MLB
// games, 28 prices): lottery implied chance ~= fair chance x K. Separate K per
// input because each source's own fair chance sits slightly differently.
export const K_BOTH = 1.151;
export const K_DRAFTKINGS = 1.153;
export const K_POLYMARKET = 1.158;
// F1 race winner, drivers the lottery prices one by one. The lottery prices
// the race twice: before qualifying and again once the grid is set.
// - After qualifying: lottery implied chance ~= 1.17 x fair chance ^ 0.765.
//   Fitted on the lottery's 2026 Azerbaijan GP board on race eve (8 drivers
//   at 1% or more, against Polymarket's devigged prices the same hour): about
//   10% average error. Longshots: a 0.35% driver 275, 0.08-0.13% drivers
//   mostly 500 (one 275, one 56).
// - Before qualifying: implied chance ~= fair chance ^ 0.692, no scale.
//   Checked on 9 prices from two snapshots of the same race's board the
//   morning before qualifying (average error ~8%). Longshots: a 0.6% driver
//   65, 0.15-0.25% drivers 325, the rest 500.
// Steps: [fair chance at or above, price], checked in order.
export const F1_PRICING = {
  pre: { scale: 1, exponent: 0.692, steps: [[0.01, null], [0.004, 65], [0.001, 325], [0, 500]] },
  post: { scale: 1.17, exponent: 0.765, steps: [[0.01, null], [0.004, 65], [0.0015, 275], [0, 500]] }
};
export const F1_SCALE = F1_PRICING.post.scale;
export const F1_EXPONENT = F1_PRICING.post.exponent;
export const F1_LONGSHOT_STEPS = F1_PRICING.post.steps;
// Never below this, however big the favourite.
export const F1_MIN_ODDS = 1.05;
// The lottery reprices once qualifying is over: this long after it starts.
export const F1_REPRICE_AFTER_MS = 90 * 60_000;

// 'pre' or 'post' qualifying at `now`, from the qualifying start time. With
// no schedule, a race more than 21 hours away is taken as before qualifying
// (qualifying is usually the day before, 20-26 hours earlier).
export function f1Phase(now, { qualifyingUtc = null, raceUtc = null } = {}) {
  const t = new Date(now).getTime();
  if (qualifyingUtc) return t >= Date.parse(qualifyingUtc) + F1_REPRICE_AFTER_MS ? 'post' : 'pre';
  if (raceUtc) return Date.parse(raceUtc) - t > 21 * 3_600_000 ? 'pre' : 'post';
  return 'post';
}

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
  // A near-certain winner can't pay back less than the stake: 1.01 at least.
  return Math.max(1.01, round2(1 / (fairChance * k)));
}

// Championship (futures) markets, fitted on 2026-09-25 against the lottery's
// AL, NL, World Series (14 teams) and EPL title prices. The lottery's implied
// chances add up to about FUTURES_OVERROUND per market (single games: ~1.15)
// and lean on longshots: each team's implied chance is fair^FUTURES_EXPONENT,
// scaled so the market adds up to that total. MLB markets fit within ~5-15%.
export const FUTURES_EXPONENT = 0.7;
export const FUTURES_OVERROUND = { mlb: 2.0, epl: 1.6, nba: 2.0, other: 1.8 };
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
    // A runaway favourite: the market's margin shared out by chance would
    // price it under even money, so, like every other market, its implied
    // chance goes no more than halfway to certain, and it never pays under
    // 1.01.
    const implied = Math.min((overround * p ** FUTURES_EXPONENT) / total, p + (1 - p) / 2);
    return Math.min(LOTTERY_MAX_ODDS, Math.max(1.01, round2(1 / implied)));
  });
}

export function estimateF1LotteryOdds(fairChance, phase = 'post') {
  const { scale, exponent, steps } = F1_PRICING[phase] ?? F1_PRICING.post;
  const [, step] = steps.find(([min]) => fairChance >= min);
  return step ?? Math.max(F1_MIN_ODDS, round2(1 / (scale * fairChance ** exponent)));
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
  // Lines past the ones the lottery posted that day: the same model, unchecked.
  mlbTotalExtra: { rel: 0.05, checked: false },
  mlbRunLineExtra: { rel: 0.06, checked: false },
  mlbTeamTotalExtra: { rel: 0.05, checked: false },
  // Live (場中): one lottery snapshot, 6 prices (see tests/fixtures/lottery-live-2026-09-26.json).
  live: { rel: 0.08, checked: true },
  liveSoccer: { rel: 0.1, checked: false },
  liveNextRun: { rel: 0.07, checked: true }, // 第N分: 6 prices, one snapshot
  // Leagues and markets never compared with the lottery: DraftKings' lines at
  // the lottery's usual cut (see markets.mjs).
  soccer: { rel: 0.1, checked: false },
  football: { rel: 0.1, checked: false },
  basketball: { rel: 0.1, checked: false },
  hockey: { rel: 0.1, checked: false },
  extra: { rel: 0.12, checked: false },
  topInning: { rel: 0.03, checked: true }, // the lottery's own table, 8 games
  epl: { rel: 0.1, checked: false }, // soccer never checked
  f1: { rel: 0.1, checked: true }, // 8 prices, race eve (after qualifying)
  f1Longshot: { rel: 0.4, checked: true }, // 275 vs 500 can't be told apart
  f1Pre: { rel: 0.08, checked: true }, // 9 prices, before qualifying
  f1PreLongshot: { rel: 0.35, checked: true }, // 325 vs 500 can't be told apart
  future_al: { rel: 0.06, checked: true },
  future_nl: { rel: 0.2, checked: true },
  future_ws: { rel: 0.15, checked: true },
  future_epl: { rel: 0.16, checked: true },
  futureLongshot: { rel: 0.5, checked: true }, // 133-500 from one rough step
  future_nba: { rel: 0.15, checked: false }, // not on the lottery
  // The other championships: never compared with the lottery, at a cut between its measured ones.
  futureOther: { rel: 0.2, checked: false }
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

// Chance a team scores over a half-run line, from its mean runs.
export function teamOverChance(teamMean, line, r = TEAM_RUNS_DISPERSION) {
  const pmf = runsPmf(teamMean, r);
  let under = 0;
  for (let k = 0; k <= Math.floor(line) && k <= TEAM_RUNS_MAX; k++) under += pmf[k];
  return 1 - under;
}

// Chance the away team covers a run line (away score + awayLine > home
// score), from the fitted score grid. Any half-run line, either direction.
export function runLineCover(grid, awayLine) {
  return gridChance(grid, (h, a) => a + awayLine > h);
}

// Extra lines beyond the ones the lottery was checked on: only those whose
// chance is between these, so a pick is never a near-certainty or a lottery
// ticket by accident.
export const LINE_CHANCE_RANGE = [0.03, 0.97];
// Odds for any line: implied chance p x k (the lottery's usual cut), but never
// more than halfway from p to certainty, so a lopsided line still pays a bit.
// The same as p x k for every line the lottery posts (p under ~0.77).
export function estimateLineOdds(p, k) {
  return Math.max(1.01, round2(1 / Math.min(p * k, p + (1 - p) / 2)));
}

export function lineInRange(p) {
  return p >= LINE_CHANCE_RANGE[0] && p <= LINE_CHANCE_RANGE[1];
}

// Soccer goals: nearly Poisson, the same negative binomial with a huge dispersion.
export const GOALS_DISPERSION = 200;

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
  // The house's rules on single picks (rules.mjs): locked ones can't be
  // bought, parlay-only ones need every combination to be big enough.
  if (legs.some(l => l.lock)) errors.push('locked');
  if (minLegsProblem(legs, sizes)) errors.push('minLegs');
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

// A ticket's outlook when bought: average payout after tax, its spread
// (standard deviation) and the chance of any payout, over every way its legs
// can land. Used to tell luck from the lottery's cut in the slip history.
export function slipOutlook({ legs, sizes, stake }) {
  const { net } = slipPayoutTable({ legs, sizes, stake });
  let mean = 0;
  let square = 0;
  let any = 0;
  for (let won = 0; won < net.length; won++) {
    let chance = 1;
    for (let i = 0; i < legs.length; i++) chance *= won & (1 << i) ? legs[i].fairChance : 1 - legs[i].fairChance;
    mean += chance * net[won];
    square += chance * net[won] ** 2;
    if (net[won] > 0) any += chance;
  }
  return { mean, sd: Math.sqrt(Math.max(0, square - mean * mean)), any };
}

// What a finished ticket pays. Each leg is 'won', 'lost' or 'void' (called
// off: the lottery counts it at odds 1.00, so a single gets its stake back
// and a parlay goes on without it). Gross is before tax, net after.
export function settleSlip({ legs, sizes, stake }) {
  const { gross, net } = slipPayoutTable({ legs: legs.map(l => ({ odds: l.result === 'void' ? 1 : l.odds })), sizes, stake });
  const mask = legs.reduce((m, l, i) => (l.result === 'lost' ? m : m | (1 << i)), 0);
  return { gross: gross[mask], net: net[mask] };
}

// A deep look at one ticket, all exact except the one-year outlook:
// - every result (legs won) with its chance and after-tax payout;
// - where each NT$100 goes: the lottery's cut, the tax, what comes back;
// - each leg's own value and what the ticket would return without it;
// - how rare the top payout is, and which results still make a profit;
// - the heartbreak: the chance of missing by exactly one pick, and by which.
export function analyzeSlip({ legs, sizes, stake }) {
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

  // One game short: exactly one pick lost, and which pick it was.
  const lone = legs.map((_, i) => chance[all & ~(1 << i)]);
  const nearMiss = n > 1 ? lone.reduce((x, y) => x + y, 0) : 0;
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
    // Chance each pick is the only one that lost, and of any one-short result.
    lone,
    nearMiss
  };
}
