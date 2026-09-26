// Statistics over the practice account's slips: money in and out, how it
// compares with what the odds said to expect (luck versus the lottery's cut),
// how often picks came in against their chances, breakdowns, streaks and
// records. Pure: the page and the tests both use it.
import { slipOutlook, choose } from './odds.mjs';

// A pick's fair chance as saved; a pick saved without one counts at its odds.
export const chanceOf = leg => (leg.fairChance >= 0 && leg.fairChance <= 1 ? leg.fairChance : Math.min(1, 1 / leg.odds));

const outlooks = new Map();
// A slip's outlook when bought, from the chances and odds saved with it.
export function outlookOf(slip) {
  if (!outlooks.has(slip.id)) outlooks.set(slip.id, slipOutlook({ legs: slip.legs.map(leg => ({ odds: leg.odds, fairChance: chanceOf(leg) })), sizes: slip.sizes, stake: slip.stake }));
  return outlooks.get(slip.id);
}

function money() {
  return { slips: 0, staked: 0, paid: 0, expected: 0 };
}

function addMoney(bucket, slip) {
  bucket.slips++;
  bucket.staked += slip.cost;
  bucket.paid += slip.payout;
  bucket.expected += outlookOf(slip).mean;
}

function finish(bucket) {
  const net = bucket.paid - bucket.staked;
  return { ...bucket, net, back: bucket.staked ? (bucket.paid / bucket.staked) * 100 : null, expectedBack: bucket.staked ? (bucket.expected / bucket.staked) * 100 : null };
}

function picks() {
  return { legs: 0, won: 0, expWins: 0, odds: 0 };
}

// Chance bands for the "were the chances right?" check.
export const CHANCE_BANDS = [
  [0, 0.2],
  [0.2, 0.4],
  [0.4, 0.6],
  [0.6, 0.8],
  [0.8, 1.01]
];

const legBand = p => CHANCE_BANDS.findIndex(([lo, hi]) => p >= lo && p < hi);

// Legs 1 / 2 / 3-4 / 5+ on a slip.
export function legsGroup(n) {
  return n <= 2 ? String(n) : n <= 4 ? '3-4' : '5+';
}

// The kind of slip: single, parlay, or a system with its sizes.
function modeKey(slip) {
  return slip.mode;
}

export function historyStats(account) {
  const all = [...account.slips].sort((a, b) => a.t.localeCompare(b.t));
  const settled = all.filter(s => s.status === 'settled');
  const open = all.filter(s => s.status === 'open');
  const total = money();
  const byMode = new Map();
  const byLegs = new Map();
  const bySport = new Map();
  const byKind = new Map();
  const bands = CHANCE_BANDS.map(() => picks());
  const legTotals = { ...picks(), lost: 0, void: 0 };
  let tax = 0;
  let variance = 0;
  let paidSlips = 0;
  let profitSlips = 0;
  let expectedPaid = 0;
  const records = { best: null, worst: null, longest: null, bigPayout: null };
  const streak = { win: 0, loss: 0, bestWin: 0, bestLoss: 0, current: 0 };
  // Money per Taiwan week (Monday), for the week table.
  const weeks = new Map();

  for (const slip of settled) {
    const look = outlookOf(slip);
    addMoney(total, slip);
    variance += look.sd ** 2;
    expectedPaid += look.any;
    tax += Math.max(0, (slip.gross ?? slip.payout) - slip.payout);
    if (slip.payout > 0) paidSlips++;
    const profit = slip.payout - slip.cost;
    if (profit > 0) profitSlips++;
    for (const [map, key] of [
      [byMode, modeKey(slip)],
      [byLegs, legsGroup(slip.legs.length)]
    ]) {
      if (!map.has(key)) map.set(key, money());
      addMoney(map.get(key), slip);
    }
    // A slip all from one sport counts its money there too.
    const sports = new Set(slip.legs.map(l => l.sport));
    const sportKey = sports.size === 1 ? [...sports][0] : 'mixed';
    if (!bySport.has(sportKey)) bySport.set(sportKey, { ...money(), ...picks() });
    addMoney(bySport.get(sportKey), slip);

    if (!records.best || profit > records.best.profit) records.best = { slip, profit };
    if (!records.worst || profit < records.worst.profit) records.worst = { slip, profit };
    if (profit > 0) {
      const odds = slip.payout / slip.cost;
      if (!records.longest || odds > records.longest.odds) records.longest = { slip, odds };
    }
    if (!records.bigPayout || slip.payout > records.bigPayout.slip.payout) records.bigPayout = { slip };

    // Streaks of slips that made or lost money (break-even ones don't count).
    if (profit > 0) {
      streak.win = streak.win + 1;
      streak.loss = 0;
    } else if (profit < 0) {
      streak.loss = streak.loss + 1;
      streak.win = 0;
    }
    streak.bestWin = Math.max(streak.bestWin, streak.win);
    streak.bestLoss = Math.max(streak.bestLoss, streak.loss);
    streak.current = streak.win ? streak.win : -streak.loss;

    const week = weekOf(slip.settledAt ?? slip.t);
    if (!weeks.has(week)) weeks.set(week, money());
    addMoney(weeks.get(week), slip);
  }

  // Every decided pick, from open slips too: did picks come in as often as
  // their chances said?
  for (const slip of all) {
    for (const leg of slip.legs) {
      if (!leg.result) continue;
      if (leg.result === 'void') {
        legTotals.void++;
        continue;
      }
      const won = leg.result === 'won' ? 1 : 0;
      const chance = chanceOf(leg);
      if (!won) legTotals.lost++;
      for (const bucket of [legTotals, bands[legBand(chance)]]) {
        bucket.legs++;
        bucket.won += won;
        bucket.expWins += chance;
        bucket.odds += leg.odds;
      }
      if (!byKind.has(leg.kind)) byKind.set(leg.kind, picks());
      const kind = byKind.get(leg.kind);
      kind.legs++;
      kind.won += won;
      kind.expWins += chance;
      kind.odds += leg.odds;
      const sportKey = leg.sport;
      if (!bySport.has(sportKey)) bySport.set(sportKey, { ...money(), ...picks() });
      const sport = bySport.get(sportKey);
      sport.legs++;
      sport.won += won;
      sport.expWins += chance;
      sport.odds += leg.odds;
    }
  }

  const summary = finish(total);
  const sd = Math.sqrt(variance);
  const luck = summary.paid - summary.expected;
  // The balance after every ledger entry, oldest first.
  let running = 0;
  const timeline = [...account.ledger]
    .sort((a, b) => a.t.localeCompare(b.t))
    .map(entry => ({ t: entry.t, kind: entry.kind, amount: entry.amount, balance: (running += entry.amount) }));
  const pickRate = b => ({ ...b, rate: b.legs ? b.won / b.legs : null, expectedRate: b.legs ? b.expWins / b.legs : null, avgOdds: b.legs ? b.odds / b.legs : null });

  return {
    placed: all.length,
    open: open.length,
    openStake: open.reduce((s, x) => s + x.cost, 0),
    openExpected: open.reduce((s, x) => s + outlookOf(x).mean, 0),
    settled: settled.length,
    paidSlips,
    profitSlips,
    expectedPaidSlips: expectedPaid,
    ...summary,
    tax,
    // The lottery's cut and the tax, on average: what the odds said you'd lose.
    expectedLoss: summary.staked - summary.expected,
    luck,
    luckSd: sd,
    luckZ: sd > 0 ? luck / sd : 0,
    // How often a run this good (or bad) happens, roughly (normal approximation).
    luckShare: sd > 0 ? normalCdf(luck / sd) : 0.5,
    picks: pickRate(legTotals),
    bands: bands.map((b, i) => ({ range: CHANCE_BANDS[i], ...pickRate(b) })),
    byMode: [...byMode].map(([key, b]) => ({ key, ...finish(b) })),
    byLegs: [...byLegs].map(([key, b]) => ({ key, ...finish(b) })).sort((a, b) => a.key.localeCompare(b.key)),
    bySport: [...bySport].map(([key, b]) => ({ key, ...finish(b), ...pickRate(b) })),
    byKind: [...byKind].map(([key, b]) => ({ key, ...pickRate(b) })).sort((a, b) => b.legs - a.legs),
    weeks: [...weeks].map(([week, b]) => ({ week, ...finish(b) })).sort((a, b) => b.week.localeCompare(a.week)),
    streak,
    records,
    timeline,
    avgCost: settled.length ? summary.staked / settled.length : 0,
    combos: settled.reduce((s, x) => s + x.sizes.reduce((c, k) => c + choose(x.legs.length, k), 0), 0)
  };
}

// Monday (YYYY-MM-DD, Taiwan time) of a moment's week.
function weekOf(iso) {
  const d = new Date(Date.parse(iso) + 8 * 3_600_000);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf).
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
