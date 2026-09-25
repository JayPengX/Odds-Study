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

// Implied chances of every outcome in a market, summed. 1.15 means a 15% overround.
export function overround(oddsList) {
  return oddsList.reduce((s, o) => s + 1 / o, 0);
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

function poisson(mean, random) {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = random();
  while (p > limit) {
    k++;
    p *= random();
  }
  return k;
}

function pickOne(list, random) {
  return list[Math.floor(random() * list.length)];
}

// Up to `n` legs, each from a different game.
function pickLegs(list, n, random) {
  const legs = [];
  const games = new Set();
  for (let tries = 0; legs.length < n && tries < n * 20; tries++) {
    const bet = pickOne(list, random);
    if (games.has(bet.gameId)) continue;
    games.add(bet.gameId);
    legs.push(bet);
  }
  return legs;
}

// One player's `weeks` of betting with `habit`. `path` is the running profit
// at the end of each week; the rest is the player's story.
export function simulateHabit({ habit, pools, weeks, random = Math.random }) {
  const list = pools[habit.pick];
  const path = new Array(weeks);
  let profit = 0;
  let tickets = 0;
  let wonTickets = 0;
  let staked = 0;
  let biggestWin = 0;
  let losing = 0;
  let longestLosing = 0;
  let chaseStake = habit.stakes[0];
  let maxStake = 0;
  let peak = 0;
  let peakWeek = -1;
  let maxDrop = 0;
  for (let w = 0; w < weeks; w++) {
    const count = poisson(habit.perWeek, random);
    let week = 0;
    for (let i = 0; i < count; i++) {
      const [lo, hi] = habit.legs;
      const legs = pickLegs(list, lo + Math.floor(random() * (hi - lo + 1)), random);
      if (legs.length === 0) continue;
      const stake = habit.chaseCap ? chaseStake : random() < habit.big ? pickOne(BIG_STAKES, random) : pickOne(habit.stakes, random);
      let won = true;
      let odds = 1;
      for (const leg of legs) {
        odds *= leg.odds;
        if (random() >= leg.fairChance) won = false;
      }
      const result = won ? stake * (odds - 1) : -stake;
      tickets++;
      staked += stake;
      week += result;
      if (stake > maxStake) maxStake = stake;
      if (won) {
        wonTickets++;
        losing = 0;
        if (result > biggestWin) biggestWin = result;
      } else if (++losing > longestLosing) longestLosing = losing;
    }
    if (habit.chaseCap && count > 0) chaseStake = week < 0 ? Math.min(chaseStake * 2, habit.chaseCap) : habit.stakes[0];
    profit += week;
    path[w] = profit;
    if (profit > peak) {
      peak = profit;
      peakWeek = w;
    }
    if (peak - profit > maxDrop) maxDrop = peak - profit;
  }
  return { path, final: profit, tickets, wonTickets, staked, biggestWin, longestLosing, maxStake, peak, peakWeek, everAhead: peak > 0, maxDrop };
}

// A crowd of `perHabit` players for every habit, all from one random stream.
export function simulateCrowd({ pools, weeks, perHabit = 500, random = Math.random }) {
  const players = [];
  for (const habit of HABITS) for (let i = 0; i < perHabit; i++) players.push({ habit, ...simulateHabit({ habit, pools, weeks, random }) });
  return players;
}

// Per habit: average amount back per NT$100 staked, share still ahead at the
// end, and the average total staked and result.
export function summarizeCrowd(players) {
  return HABITS.map(habit => {
    const group = players.filter(p => p.habit === habit);
    const staked = group.reduce((s, p) => s + p.staked, 0);
    const net = group.reduce((s, p) => s + p.final, 0);
    return {
      habit,
      back: staked > 0 ? ((staked + net) / staked) * 100 : 100,
      aheadShare: group.filter(p => p.final > 0).length / group.length,
      avgFinal: net / group.length,
      avgStaked: staked / group.length,
      avgTickets: group.reduce((s, p) => s + p.tickets, 0) / group.length
    };
  });
}

// Value at quantile q (0-1) of an ascending sorted array.
export function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}
