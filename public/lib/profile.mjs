// One person's betting, told the same way whether it's you (your practice
// account's slips) or anyone in the simulated crowd (their replayed season):
// both become a list of tickets, and everything below reads only that list.
// The traits it spots are the simulator's own (sim.mjs), so you can be told
// which of the crowd's people you bet like.
//
// A ticket: { w: week (0 = the first week), stake, legs: picks on it, odds:
// what it paid per NT$1 if everything won, chance: its picks' average fair
// chance, won: paid anything, missed: picks that lost, paid: payout after
// tax }.

// A practice-account slip as a ticket (settled slips only).
export function slipTicket(slip, firstMs) {
  const legs = slip.legs.length;
  const chance = slip.legs.reduce((s, l) => s + (l.fairChance >= 0 && l.fairChance <= 1 ? l.fairChance : Math.min(1, 1 / l.odds)), 0) / Math.max(1, legs);
  const odds = slip.mode === 'parlay' ? slip.legs.reduce((p, l) => p * l.odds, 1) : slip.legs.reduce((s, l) => s + l.odds, 0) / Math.max(1, legs);
  return {
    w: Math.max(0, Math.floor((Date.parse(slip.t) - firstMs) / (7 * 86_400_000))),
    stake: slip.cost,
    legs,
    odds,
    chance,
    won: slip.payout > 0,
    missed: slip.legs.filter(l => l.result === 'lost').length,
    paid: slip.payout
  };
}

export function accountTickets(account) {
  const slips = [...account.slips].filter(s => s.status === 'settled').sort((a, b) => a.t.localeCompare(b.t));
  if (!slips.length) return [];
  const first = Date.parse(slips[0].t);
  return slips.map(s => slipTicket(s, first));
}

// Everything about one person's tickets. `weeks`: how long they've been
// betting (default: up to their last ticket).
export function ticketProfile(tickets, { weeks = null } = {}) {
  if (!tickets.length) return null;
  const n = tickets.length;
  const span = Math.max(1, weeks ?? tickets.at(-1).w + 1);
  let staked = 0;
  let paid = 0;
  let won = 0;
  let legs = 0;
  let logOdds = 0;
  let chance = 0;
  let singles = 0;
  let nearMisses = 0;
  let maxStake = 0;
  let biggestWin = null;
  let run = 0;
  let longestWin = 0;
  let longestLose = 0;
  const byWeek = new Map();
  for (const x of tickets) {
    staked += x.stake;
    paid += x.paid;
    legs += x.legs;
    logOdds += Math.log(Math.max(1, x.odds));
    chance += x.chance;
    if (x.legs === 1) singles++;
    if (!x.won && x.missed === 1 && x.legs > 1) nearMisses++;
    if (x.stake > maxStake) maxStake = x.stake;
    const net = x.paid - x.stake;
    byWeek.set(x.w, (byWeek.get(x.w) ?? 0) + net);
    if (x.won) {
      won++;
      run = run > 0 ? run + 1 : 1;
      if (!biggestWin || net > biggestWin.net) biggestWin = { net, odds: x.odds, legs: x.legs, w: x.w, stake: x.stake };
    } else run = run < 0 ? run - 1 : -1;
    longestWin = Math.max(longestWin, run);
    longestLose = Math.max(longestLose, -run);
  }
  const weekNets = [...byWeek.entries()];
  const best = weekNets.reduce((a, b) => (b[1] > a[1] ? b : a), [null, -Infinity]);
  const worst = weekNets.reduce((a, b) => (b[1] < a[1] ? b : a), [null, Infinity]);
  const profile = {
    tickets: n,
    won,
    hitRate: won / n,
    staked,
    paid,
    net: paid - staked,
    back: staked ? (paid / staked) * 100 : null,
    avgStake: staked / n,
    maxStake,
    avgLegs: legs / n,
    singleShare: singles / n,
    avgOdds: Math.exp(logOdds / n),
    avgChance: chance / n,
    nearMisses,
    biggestWin: biggestWin && biggestWin.net > 0 ? biggestWin : null,
    longestWin,
    longestLose,
    bestWeek: best[0] != null && best[1] > 0 ? { w: best[0], net: best[1] } : null,
    worstWeek: worst[0] != null && worst[1] < 0 ? { w: worst[0], net: worst[1] } : null,
    weeksPlayed: byWeek.size,
    weeks: span,
    perWeek: n / span,
    raiseAfterLoss: raiseAfterLoss(tickets)
  };
  profile.traits = detectTraits(profile);
  return profile;
}

// How often a losing week is followed by a week of bigger tickets (half as
// big again, on average): the chasing and tilting habits.
function raiseAfterLoss(tickets) {
  const weeks = new Map();
  for (const x of tickets) {
    const wk = weeks.get(x.w) ?? { net: 0, stake: 0, n: 0 };
    wk.net += x.paid - x.stake;
    wk.stake += x.stake;
    wk.n++;
    weeks.set(x.w, wk);
  }
  const list = [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  let losses = 0;
  let raised = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].net >= 0) continue;
    losses++;
    if (list[i].stake / list[i].n >= 1.5 * (list[i - 1].stake / list[i - 1].n)) raised++;
  }
  return losses >= 3 ? raised / losses : null;
}

// The simulator's traits that show in someone's tickets: how they pick, how
// many picks, how often, and whether losing weeks make their tickets bigger.
export const DETECTABLE = {
  favorite: p => p.avgChance >= 0.6,
  underdog: p => p.avgChance <= 0.35,
  single: p => p.avgLegs <= 1.2,
  parlay: p => p.avgLegs >= 4,
  daily: p => p.tickets >= 6 && p.perWeek >= 3,
  rare: p => p.weeks >= 6 && p.perWeek <= 0.5,
  tilt: p => p.raiseAfterLoss != null && p.raiseAfterLoss >= 0.5
};

export function detectTraits(profile) {
  return Object.keys(DETECTABLE).filter(key => DETECTABLE[key](profile));
}
