// Pure odds math, shared by the browser page and scripts/build-data.mjs.

// Fitted on 2026-09-25 against real Taiwan Sports Lottery prices (14 MLB
// games, 28 prices): lottery implied chance ~= fair chance x K. Separate K per
// input because each source's own fair chance sits slightly differently.
export const K_BOTH = 1.151;
export const K_DRAFTKINGS = 1.153;
export const K_POLYMARKET = 1.158;
// F1 race winner: lottery implied chance ~= fair chance ^ F1_EXPONENT, fitted
// on 5 prices from one race, so only a rough guide.
export const F1_EXPONENT = 0.692;

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

export function estimateF1LotteryOdds(fairChance, exponent = F1_EXPONENT) {
  return round2(1 / fairChance ** exponent);
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

// Simulates `runs` bettors each placing `bets` identical bets of `stake`.
// Returns each run's running profit, one value per bet (index 0 = after bet 1).
export function simulateRuns({ fairChance, odds, stake = 100, bets = 1000, runs = 20, random = Math.random }) {
  const out = [];
  for (let r = 0; r < runs; r++) {
    const path = new Array(bets);
    let profit = 0;
    for (let i = 0; i < bets; i++) {
      profit += random() < fairChance ? stake * (odds - 1) : -stake;
      path[i] = profit;
    }
    out.push(path);
  }
  return out;
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

// Per-bet profit for 1 unit staked: its average and its standard deviation
// (how far luck typically moves a single bet away from that average).
export function betMoments(fairChance, odds) {
  return { mean: fairChance * odds - 1, sd: odds * Math.sqrt(fairChance * (1 - fairChance)) };
}

// Exact chance of being strictly ahead after n bets. Ahead means wins x odds > n,
// and the number of wins follows a binomial distribution.
export function chanceAhead(fairChance, odds, n) {
  if (fairChance <= 0) return 0;
  if (fairChance >= 1) return odds > 1 ? 1 : 0;
  const minWins = Math.floor(n / odds + 1e-9) + 1;
  if (minWins > n) return 0;
  const lp = Math.log(fairChance);
  const lq = Math.log(1 - fairChance);
  let logChoose = 0;
  let total = 0;
  for (let w = 0; w <= n; w++) {
    if (w >= minWins) total += Math.exp(logChoose + w * lp + (n - w) * lq);
    logChoose += Math.log(n - w) - Math.log(w + 1);
  }
  return Math.min(1, total);
}

// Bets until the house's cut outweighs typical luck: the average loss grows
// like n, luck's swing grows like sqrt(n), and they meet at n = (sd / mean)^2.
// Null when the bet doesn't lose on average.
export function luckCrossover(fairChance, odds) {
  const { mean, sd } = betMoments(fairChance, odds);
  if (mean >= 0) return null;
  return Math.max(1, Math.round((sd / mean) ** 2));
}

// Story of one simulated player, from their running profit path.
export function describeRun(path) {
  let wins = 0;
  let peak = 0;
  let peakAt = -1;
  let high = 0;
  let maxDrop = 0;
  let losing = 0;
  let longestLosing = 0;
  let prev = 0;
  for (let i = 0; i < path.length; i++) {
    const v = path[i];
    if (v > prev) {
      wins++;
      losing = 0;
    } else {
      losing++;
      if (losing > longestLosing) longestLosing = losing;
    }
    if (v > peak) {
      peak = v;
      peakAt = i;
    }
    if (v > high) high = v;
    if (high - v > maxDrop) maxDrop = high - v;
    prev = v;
  }
  return { final: path.at(-1), wins, peak, peakAt, everAhead: peak > 0, longestLosing, maxDrop };
}
