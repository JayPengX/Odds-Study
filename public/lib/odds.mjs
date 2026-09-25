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
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Betting habits for the season simulator. Each week a player buys a random
// number of tickets (Poisson around `perWeek`, so some weeks none), each with
// `legs` legs from different games (most lottery MLB games need 2+) and legs
// chosen by `pick`. Most tickets are a few hundred NT$ (`stakes`); a `big`
// share of them are NT$1,000-3,000. A chaser starts at `stakes[0]`, doubles
// after a losing week up to `chaseCap`, and drops back after a winning one.
export const BIG_STAKES = [1000, 2000, 3000];
export const HABITS = [
  { key: 'casual', perWeek: 1, legs: [2, 2], stakes: [100, 200, 300], big: 0.05, pick: 'any' },
  { key: 'fan', perWeek: 3, legs: [2, 2], stakes: [200, 300, 500], big: 0.1, pick: 'favorite' },
  { key: 'underdog', perWeek: 2, legs: [2, 3], stakes: [100, 200, 300], big: 0.05, pick: 'underdog' },
  { key: 'dreamer', perWeek: 2, legs: [4, 6], stakes: [100, 200], big: 0.02, pick: 'any' },
  { key: 'chaser', perWeek: 2, legs: [2, 2], stakes: [200], big: 0, pick: 'any', chaseCap: 3000 },
  { key: 'careful', perWeek: 1, legs: [2, 2], stakes: [200, 300, 500], big: 0.05, pick: 'best' }
];

// Splits a pool of bets ({gameId, fairChance, odds}) into the lists each
// `pick` style draws from. A style with nothing to pick falls back to all.
export function habitPools(pool) {
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
// loop reads numbers and allocates nothing. Cached per list.
const compiledLists = new WeakMap();
function compile(list) {
  let c = compiledLists.get(list);
  if (!c) {
    const games = new Map();
    c = {
      n: list.length,
      game: Int32Array.from(list, b => (games.has(b.gameId) ? games.get(b.gameId) : games.set(b.gameId, games.size).get(b.gameId))),
      fair: Float64Array.from(list, b => b.fairChance),
      odds: Float64Array.from(list, b => b.odds)
    };
    compiledLists.set(list, c);
  }
  return c;
}

// Games already on the ticket being built (at most 12 legs).
const ticketGames = new Int32Array(16);

// One player's `weeks` of betting with `habit`. Writes the running profit at
// the end of each week into `path` (if given) and returns the player's story.
function playSeason(habit, list, weeks, random, path) {
  const c = compile(list);
  const noTicket = Math.exp(-habit.perWeek);
  const [lo, hi] = habit.legs;
  const legSpan = hi - lo + 1;
  const base = habit.stakes[0];
  let profit = 0;
  let tickets = 0;
  let wonTickets = 0;
  let staked = 0;
  let biggestWin = 0;
  let biggestWinWeek = -1;
  let biggestWinStake = 0;
  let biggestWinLegs = 0;
  let biggestWinOdds = 0;
  let losing = 0;
  let longestLosing = 0;
  let chaseStake = base;
  let maxStake = 0;
  let peak = 0;
  let peakWeek = -1;
  let maxDrop = 0;
  for (let w = 0; w < weeks; w++) {
    // Poisson number of tickets this week.
    let count = 0;
    for (let p = random(); p > noTicket; p *= random()) count++;
    let week = 0;
    for (let i = 0; i < count; i++) {
      const want = lo + Math.floor(random() * legSpan);
      let legs = 0;
      let won = true;
      let odds = 1;
      for (let tries = 0; legs < want && tries < want * 20; tries++) {
        const j = Math.floor(random() * c.n);
        const game = c.game[j];
        let dup = false;
        for (let k = 0; k < legs; k++) if (ticketGames[k] === game) dup = true;
        if (dup) continue;
        ticketGames[legs++] = game;
        odds *= c.odds[j];
        if (random() >= c.fair[j]) won = false;
      }
      if (legs === 0) continue;
      const stake = habit.chaseCap
        ? chaseStake
        : random() < habit.big
          ? BIG_STAKES[Math.floor(random() * BIG_STAKES.length)]
          : habit.stakes[Math.floor(random() * habit.stakes.length)];
      const result = won ? afterTax(stake * odds) - stake : -stake;
      tickets++;
      staked += stake;
      week += result;
      if (stake > maxStake) maxStake = stake;
      if (won) {
        wonTickets++;
        losing = 0;
        if (result > biggestWin) {
          biggestWin = result;
          biggestWinWeek = w;
          biggestWinStake = stake;
          biggestWinLegs = legs;
          biggestWinOdds = odds;
        }
      } else if (++losing > longestLosing) longestLosing = losing;
    }
    if (habit.chaseCap && count > 0) chaseStake = week < 0 ? Math.min(chaseStake * 2, habit.chaseCap) : base;
    profit += week;
    if (path) path[w] = profit;
    if (profit > peak) {
      peak = profit;
      peakWeek = w;
    }
    if (peak - profit > maxDrop) maxDrop = peak - profit;
  }
  return {
    final: profit,
    tickets,
    wonTickets,
    staked,
    biggestWin,
    biggestWinWeek,
    biggestWinStake,
    biggestWinLegs,
    biggestWinOdds,
    longestLosing,
    maxStake,
    peak,
    peakWeek,
    everAhead: peak > 0,
    maxDrop
  };
}

// One player's season with their full week-by-week path.
export function simulateHabit({ habit, pools, weeks, random = Math.random }) {
  const path = new Float64Array(weeks);
  return { path, ...playSeason(habit, pools[habit.pick], weeks, random, path) };
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

// A crowd of `perHabit` players for every habit. Nothing per player is kept
// but the final result: each week streams into a histogram (for the 10/25/50/
// 75/90% bands) and each habit into running sums. The players at the top 10%,
// middle and bottom 10% are replayed at the end for their full stories.
export function simulateCrowdStats({ pools, weeks, perHabit = 500, seed = 1, onProgress }) {
  const total = HABITS.length * perHabit;
  const { bins, lo, width } = histogramShape(weeks);
  const hist = new Uint32Array(weeks * bins);
  const aheadByWeek = new Uint32Array(weeks);
  const finals = new Float64Array(total);
  const path = new Float64Array(weeks);
  const sums = HABITS.map(() => ({ staked: 0, net: 0, tickets: 0, ahead: 0, everAhead: 0, capHits: 0, rr: 0, rs: 0, ss: 0 }));
  // Record holders (by player index) and crowd-wide totals for the fun facts.
  const records = { biggestWin: [-1, -Infinity], best: [-1, -Infinity], worst: [-1, Infinity], drought: [-1, -1], fall: [-1, -1] };
  const beat = (key, index, value, higher = true) => {
    if (higher ? value > records[key][1] : value < records[key][1]) records[key] = [index, value];
  };
  let winnings = 0;
  let losses = 0;
  let neverWon = 0;
  for (let h = 0; h < HABITS.length; h++) {
    const habit = HABITS[h];
    const list = pools[habit.pick];
    const sum = sums[h];
    for (let i = 0; i < perHabit; i++) {
      const index = h * perHabit + i;
      const story = playSeason(habit, list, weeks, playerRandom(seed, index), path);
      finals[index] = story.final;
      for (let w = 0; w < weeks; w++) {
        const v = path[w];
        let bin = Math.floor((v - lo) / width);
        bin = bin < 0 ? 0 : bin >= bins ? bins - 1 : bin;
        hist[w * bins + bin]++;
        if (v > 0) aheadByWeek[w]++;
      }
      const returned = story.staked + story.final;
      sum.staked += story.staked;
      sum.net += story.final;
      sum.tickets += story.tickets;
      sum.rr += returned * returned;
      sum.rs += returned * story.staked;
      sum.ss += story.staked * story.staked;
      if (story.final > 0) {
        sum.ahead++;
        winnings += story.final;
      } else losses -= story.final;
      if (story.wonTickets === 0 && story.tickets > 0) neverWon++;
      beat('biggestWin', index, story.biggestWin);
      beat('best', index, story.final);
      beat('worst', index, story.final, false);
      beat('drought', index, story.longestLosing);
      // Furthest ahead at some point, yet down at the end.
      if (story.final < 0) beat('fall', index, story.peak);
      if (story.everAhead) sum.everAhead++;
      if (habit.chaseCap && story.maxStake >= habit.chaseCap) sum.capHits++;
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
  const bands = Array.from({ length: weeks }, (_, w) => ({
    q10: at(w, 0.1),
    q25: at(w, 0.25),
    q50: at(w, 0.5),
    q75: at(w, 0.75),
    q90: at(w, 0.9),
    ahead: aheadByWeek[w]
  }));
  const summaries = HABITS.map((habit, h) => {
    const s = sums[h];
    const n = perHabit;
    const back = s.staked > 0 ? (s.staked + s.net) / s.staked : 1;
    const aheadShare = s.ahead / n;
    // 95% sampling margins: a ratio estimate for the amount back, binomial for the share.
    const spread = Math.max(0, s.rr - 2 * back * s.rs + back * back * s.ss);
    const meanStaked = s.staked / n;
    return {
      habit,
      back: back * 100,
      backMargin: n > 1 && meanStaked > 0 ? (1.96 * Math.sqrt(spread / (n * (n - 1))) * 100) / meanStaked : 0,
      aheadShare,
      aheadMargin: 1.96 * Math.sqrt((aheadShare * (1 - aheadShare)) / n),
      avgFinal: s.net / n,
      avgStaked: s.staked / n,
      avgTickets: s.tickets / n,
      capShare: s.capHits / n
    };
  });
  const order = Uint32Array.from({ length: total }, (_, i) => i).sort((a, b) => finals[a] - finals[b]);
  // Replays one player exactly; `serial` is their 1-based number in the crowd.
  const replayIndex = index => {
    const habit = HABITS[Math.floor(index / perHabit)];
    return { serial: index + 1, habit, ...simulateHabit({ habit, pools, weeks, random: playerRandom(seed, index) }) };
  };
  const replay = q => replayIndex(order[Math.round((total - 1) * q)]);
  const finalAt = q => finals[order[Math.round((total - 1) * q)]];
  const sumOf = key => sums.reduce((t, s) => t + s[key], 0);
  return {
    weeks,
    players: total,
    bands,
    summaries,
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
    crowd: { winnings, losses, neverWonShare: neverWon / total, top1: finalAt(0.99), top01: finalAt(0.999) }
  };
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
