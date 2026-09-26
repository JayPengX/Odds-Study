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

// ---- Fun facts --------------------------------------------------------------

// Small stories from the slips: the biggest upset picked, the most painful
// miss, parlays one pick short, the team picked most, the market picked
// most, the favourite day, and how much of it was live. Each is null when
// there's nothing to tell yet.
export function funFacts(account) {
  const slips = [...account.slips].sort((a, b) => a.t.localeCompare(b.t));
  const legs = slips.flatMap(slip => slip.legs.map(leg => ({ ...leg, slip })));
  const decided = legs.filter(l => l.result === 'won' || l.result === 'lost');
  const facts = {};
  const upset = decided.filter(l => l.result === 'won').sort((a, b) => chanceOf(a) - chanceOf(b))[0];
  if (upset && chanceOf(upset) < 0.45) facts.upset = { leg: upset, chance: chanceOf(upset) };
  const heartbreak = decided.filter(l => l.result === 'lost').sort((a, b) => chanceOf(b) - chanceOf(a))[0];
  if (heartbreak && chanceOf(heartbreak) > 0.55) facts.heartbreak = { leg: heartbreak, chance: chanceOf(heartbreak) };
  // Parlays lost by exactly one pick, and what they'd have paid.
  const near = slips.filter(s => s.status === 'settled' && s.mode === 'parlay' && s.legs.filter(l => l.result === 'lost').length === 1);
  if (near.length) facts.nearMiss = { count: near.length, missed: near.reduce((sum, s) => sum + s.stake * s.legs.reduce((p, l) => p * (l.result === 'void' ? 1 : l.odds), 1), 0) };
  // Team picked most (win picks), with how often it came in.
  const teams = new Map();
  for (const l of legs.filter(l => l.kind === 'ml' && l.side !== 'draw')) {
    const name = l.shortLabel;
    const entry = teams.get(name) ?? { name, picks: 0, won: 0, decided: 0 };
    entry.picks++;
    if (l.result === 'won' || l.result === 'lost') entry.decided++;
    if (l.result === 'won') entry.won++;
    teams.set(name, entry);
  }
  const team = [...teams.values()].sort((a, b) => b.picks - a.picks)[0];
  if (team && team.picks >= 2) facts.team = team;
  const kinds = new Map();
  for (const l of legs) kinds.set(l.kind, (kinds.get(l.kind) ?? 0) + 1);
  const kind = [...kinds].sort((a, b) => b[1] - a[1])[0];
  if (kind) facts.market = { kind: kind[0], picks: kind[1], share: kind[1] / legs.length };
  // Busiest weekday (Taiwan time).
  const days = new Array(7).fill(0);
  for (const s of slips) days[new Date(Date.parse(s.t) + 8 * 3_600_000).getUTCDay()]++;
  const busiest = days.indexOf(Math.max(...days));
  if (slips.length >= 3) facts.weekday = { day: busiest, slips: days[busiest] };
  const live = legs.filter(l => l.live).length;
  if (live) facts.live = { picks: live, share: live / legs.length };
  // Biggest ticket bought, by what all correct would pay against its cost.
  const dream = slips.map(s => ({ slip: s, times: outlookTop(s) / s.cost })).sort((a, b) => b.times - a.times)[0];
  if (dream && dream.times >= 5) facts.dream = dream;
  return facts;
}

// What all correct pays for a slip, before tax, as a multiple is enough here.
function outlookTop(slip) {
  const n = slip.legs.length;
  let total = 0;
  const sizes = new Set(slip.sizes);
  for (let pick = 1; pick < 1 << n; pick++) {
    let size = 0;
    let product = 1;
    for (let i = 0; i < n; i++) if (pick & (1 << i)) (size++, (product *= slip.legs[i].odds));
    if (sizes.has(size)) total += slip.stake * product;
  }
  return total;
}

// ---- Against the 100,000 ------------------------------------------------------

// The share of the simulated crowd a result beats, from its final quantiles
// (1,001 of them, lowest first).
export function crowdPercentile(quantiles, value) {
  if (!quantiles?.length) return null;
  let lo = 0;
  let hi = quantiles.length - 1;
  if (value <= quantiles[0]) return 0;
  if (value >= quantiles[hi]) return 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (quantiles[mid] <= value) lo = mid;
    else hi = mid;
  }
  const span = quantiles[hi] - quantiles[lo] || 1;
  return (lo + (value - quantiles[lo]) / span) / (quantiles.length - 1);
}

// How the account bets, in the simulator's terms: picks per slip, cost per
// slip, slips per week, how often picks are favourites or underdogs, and how
// often a losing slip is followed by a bigger one (chasing).
export function bettingProfile(account, now = new Date()) {
  const slips = [...account.slips].sort((a, b) => a.t.localeCompare(b.t));
  if (!slips.length) return null;
  const first = Date.parse(slips[0].t);
  const weeks = Math.max(1, (now.getTime() - first) / (7 * 86_400_000));
  const legs = slips.flatMap(s => s.legs);
  let losses = 0;
  let raised = 0;
  for (let i = 1; i < slips.length; i++) {
    const prev = slips[i - 1];
    if (prev.status !== 'settled' || prev.payout >= prev.cost) continue;
    losses++;
    if (slips[i].cost >= prev.cost * 1.5) raised++;
  }
  return {
    weeks,
    legs: legs.length / slips.length,
    cost: slips.reduce((s, x) => s + x.cost, 0) / slips.length,
    perWeek: slips.length / weeks,
    favourites: legs.filter(l => chanceOf(l) >= 0.55).length / legs.length,
    underdogs: legs.filter(l => chanceOf(l) <= 0.4).length / legs.length,
    chase: losses ? raised / losses : 0
  };
}

// What each way of picking looks like: share of favourites and underdogs.
const PICK_STYLE = {
  favorite: { favourites: 1, underdogs: 0 },
  underdog: { favourites: 0, underdogs: 1 },
  best: { favourites: 0.4, underdogs: 0.3 },
  any: { favourites: 0.35, underdogs: 0.3 }
};

// The simulated habit that bets most like the account.
export function closestHabit(profile, habits) {
  const mid = list => list.reduce((s, x) => s + x, 0) / list.length;
  const dist = habit => {
    const style = PICK_STYLE[habit.pick] ?? PICK_STYLE.any;
    return (
      Math.abs(Math.log(profile.legs / mid(habit.legs))) +
      Math.abs(Math.log(profile.cost / mid(habit.stakes))) +
      Math.abs(Math.log(Math.max(0.05, profile.perWeek) / habit.perWeek)) +
      Math.abs(profile.favourites - style.favourites) +
      Math.abs(profile.underdogs - style.underdogs) +
      2 * Math.abs(profile.chase - (habit.chaseCap ? 1 : 0))
    );
  };
  return [...habits].sort((a, b) => dist(a) - dist(b))[0];
}
