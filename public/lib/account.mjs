// The simulated betting account: play money only. It starts with NT$10,000,
// can claim NT$5,000 once a week (Taiwan time, weeks from Monday), and buys
// saved slips at the lottery's own prices; once every game on a slip is over,
// the slip pays out like a real ticket (tax and payout cap included).
//
// The balance is never stored: it's the sum of a ledger of entries with fixed
// ids ('start', 'grant-<Monday>', 'stake-<slip>', 'payout-<slip>'), so two
// devices' copies merge by taking the union, and nothing counts twice.
import { settleSlip } from './odds.mjs';
import { taipeiDayKey } from './sources.mjs';
import { isSoccer } from './teams.mjs';

export const START_BALANCE = 10_000;
export const WEEKLY_GRANT = 5_000;

export function newAccount(now = new Date()) {
  const t = now.toISOString();
  return { v: 1, created: t, updated: t, ledger: [{ id: 'start', t, kind: 'start', amount: START_BALANCE }], slips: [] };
}

export function balance(account) {
  return account.ledger.reduce((sum, entry) => sum + entry.amount, 0);
}

// Monday (YYYY-MM-DD) of the Taiwan week a moment falls in.
export function weekKey(now) {
  const d = new Date(`${taipeiDayKey(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// The next Monday 00:00 Taiwan time after `now`.
export function nextGrantAt(now) {
  const monday = new Date(`${weekKey(now)}T00:00:00+08:00`);
  return new Date(monday.getTime() + 7 * 86_400_000);
}

// A new account starts with its NT$10,000; the weekly NT$5,000 is there from
// the next week on, once a week, and doesn't pile up over skipped weeks.
export function canClaim(account, now = new Date()) {
  const week = weekKey(now);
  return weekKey(new Date(account.created)) !== week && !account.ledger.some(e => e.id === `grant-${week}`);
}

function touched(account, now) {
  return { ...account, updated: now.toISOString() };
}

export function claimGrant(account, now = new Date()) {
  if (!canClaim(account, now)) return account;
  const entry = { id: `grant-${weekKey(now)}`, t: now.toISOString(), kind: 'grant', amount: WEEKLY_GRANT };
  return touched({ ...account, ledger: [...account.ledger, entry] }, now);
}

export function newSlipId(now = new Date()) {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `${now.getTime().toString(36)}${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

// Buys a slip: { id, mode, sizes, stake, cost, legs }. The cost comes off the
// balance at once. Returns { account } or { error: 'funds' }.
// A pick as saved: empty fields left out, so years of slips stay small.
export function compactLeg(leg) {
  return Object.fromEntries(Object.entries(leg).filter(([key, v]) => v != null || key === 'result'));
}

// Every saved pick compacted (older accounts saved empty fields too).
export function compactAccount(account) {
  return { ...account, slips: account.slips.map(slip => ({ ...slip, legs: slip.legs.map(compactLeg) })) };
}

export function placeSlip(account, slip, now = new Date()) {
  if (!(slip.cost > 0) || slip.cost > balance(account)) return { error: 'funds' };
  const t = now.toISOString();
  const saved = { ...slip, t, status: 'open', legs: slip.legs.map(leg => compactLeg({ ...leg, result: null })) };
  const entry = { id: `stake-${slip.id}`, t, kind: 'stake', amount: -slip.cost, slipId: slip.id };
  return { account: touched({ ...account, ledger: [...account.ledger, entry], slips: [saved, ...account.slips] }, now) };
}

const norm = name =>
  String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Top-scoring inning: 0-8 for innings 1-9, 9 for a tie for the most. Extra
// innings don't count; an inning a team didn't bat counts as 0.
export function topInning(awayInnings, homeInnings) {
  const runs = Array.from({ length: 9 }, (_, i) => (Number(awayInnings[i]) || 0) + (Number(homeInnings[i]) || 0));
  const most = Math.max(...runs);
  const at = runs.flatMap((r, i) => (r === most ? [i] : []));
  return at.length === 1 ? at[0] : 9;
}

// 'won', 'lost' or 'void' for one leg from its game's (or race's, or
// championship's) outcome; null while it isn't decided.
// outcome: { status: 'final' | 'void' | 'pending', awayScore, homeScore,
// awayInnings, homeInnings } for a game, { status, winner } otherwise.
export function legResult(leg, outcome) {
  if (!outcome || outcome.status === 'pending') return null;
  if (outcome.status === 'void') return 'void';
  const win = test => (test ? 'won' : 'lost');
  if (leg.kind === 'f1') return win(norm(outcome.winner) === norm(leg.driver));
  if (leg.kind === 'future') return win(norm(outcome.winner) === norm(leg.team));
  if (leg.kind === 'f1podium') return outcome.podium ? win(outcome.podium.some(name => norm(name) === norm(leg.driver))) : null;
  const away = Number(outcome.awayScore);
  const home = Number(outcome.homeScore);
  if (!Number.isFinite(away) || !Number.isFinite(home)) return null;
  const push = diff => (diff === 0 ? 'void' : win(diff > 0));
  switch (leg.kind) {
    case 'ml':
      return win(leg.side === 'draw' ? away === home : leg.side === 'away' ? away > home : home > away);
    case 'total':
      return push(leg.side === 'over' ? away + home - leg.line : leg.line - away - home);
    case 'runline':
      return push(leg.side === 'away' ? away + leg.line - home : home + leg.line - away);
    case 'teamtotal': {
      const runs = leg.team === 'away' ? away : home;
      return push(leg.side === 'over' ? runs - leg.line : leg.line - runs);
    }
    case 'oddeven':
      return win((away + home) % 2 === (leg.side === 'odd' ? 1 : 0));
    case 'btts':
      return win((away > 0 && home > 0) === (leg.side === 'yes'));
    case 'margin': {
      // The picked team winning by lo to hi (no upper end when hi is null).
      const m = leg.team === 'home' ? home - away : away - home;
      return win(m >= leg.lo && (leg.hi == null || m <= leg.hi));
    }
    case 'score': {
      // Correct score, written home-away; 'other' is any score not listed.
      const final = `${home}-${away}`;
      return win(leg.score === 'other' ? !(leg.listed || []).includes(final) : leg.score === final);
    }
    case 'htft': {
      // Half-time and full-time results, both right.
      const a = outcome.awayInnings || [];
      const h = outcome.homeInnings || [];
      if (!a.length && !h.length) return null;
      const res = (x, y) => (y > x ? 'home' : y === x ? 'draw' : 'away');
      return win(res(Number(a[0]) || 0, Number(h[0]) || 0) === leg.ht && res(away, home) === leg.ft);
    }
    case 'dc':
      // Double chance: either of two results.
      return win(leg.side.split('|').includes(away > home ? 'away' : away === home ? 'draw' : 'home'));
    case 'htotal': {
      // First-half total: one soccer half, two quarters.
      const a = outcome.awayInnings || [];
      const h = outcome.homeInnings || [];
      if (!a.length && !h.length) return null;
      const periods = leg.sport && isSoccer(leg.sport) ? 1 : 2;
      const sum = list => list.slice(0, periods).reduce((s, x) => s + (Number(x) || 0), 0);
      const pts = sum(a) + sum(h);
      return push(leg.side === 'over' ? pts - leg.line : leg.line - pts);
    }
    case 'goalbands':
      return win(away + home >= leg.lo && (leg.hi == null || away + home <= leg.hi));
    // Played in sets: the score is sets won; `homeSets`/`awaySets` each set's score.
    case 'sets':
      return win(`${home}-${away}` === leg.score);
    case 'totalsets':
      return push(leg.side === 'over' ? away + home - leg.line : leg.line - away - home);
    case 'sethcap':
      return push(leg.side === 'away' ? away + leg.line - home : home + leg.line - away);
    case 'firstset': {
      const h = outcome.homeSets?.[0];
      const a = outcome.awaySets?.[0];
      if (h == null || a == null) return null;
      return win(leg.side === 'home' ? h > a : a > h);
    }
    case 'gamehcap':
    case 'gametotal': {
      // Games (tennis) or points across every set.
      if (!outcome.homeSets || !outcome.awaySets) return null;
      const sum = list => list.reduce((s, x) => s + (Number(x) || 0), 0);
      const hs = sum(outcome.homeSets);
      const as = sum(outcome.awaySets);
      if (leg.kind === 'gametotal') return push(leg.side === 'over' ? hs + as - leg.line : leg.line - hs - as);
      return push(leg.side === 'away' ? as + leg.line - hs : hs + leg.line - as);
    }
    case 'q1':
    case 'half':
    case 'f5':
    case 'regulation': {
      // Part of the game, from the period scores: the first half (one soccer
      // half, two quarters), the first five innings, or hockey's three periods.
      const periods = leg.kind === 'f5' ? 5 : leg.kind === 'regulation' ? 3 : leg.kind === 'q1' || (leg.sport && isSoccer(leg.sport)) ? 1 : 2;
      const a = outcome.awayInnings || [];
      const h = outcome.homeInnings || [];
      if (!a.length && !h.length) return null;
      const sum = list => list.slice(0, periods).reduce((s, x) => s + (Number(x) || 0), 0);
      const pa = sum(a);
      const ph = sum(h);
      return win(leg.side === 'draw' ? pa === ph : leg.side === 'away' ? pa > ph : ph > pa);
    }
    case 'firstinning': {
      if (!outcome.awayInnings?.length) return null;
      const runs = (Number(outcome.awayInnings[0]) || 0) + (Number(outcome.homeInnings?.[0]) || 0);
      return win((runs > 0) === (leg.side === 'yes'));
    }
    case 'nextrun': {
      // The game's Nth run: whose it was, or no one's if the game ended first.
      if (!outcome.runOrder) return null;
      return win(leg.side === (outcome.runOrder[leg.line - 1] ?? 'none'));
    }
    case 'inning':
      if (!outcome.awayInnings?.length) return null;
      return win(topInning(outcome.awayInnings, outcome.homeInnings || []) === leg.inning);
    default:
      return null;
  }
}

// Records leg results (one per leg, null if not known yet); once every leg
// is decided the slip is settled and its payout (after tax) is paid in.
// `finals` (optional, one per leg): the final score to keep with a pick as it
// is decided, { away, home } (and each set's score), so a slip's history
// never depends on the sources keeping old games.
export function applyResults(account, slipId, results, now = new Date(), finals = []) {
  const slip = account.slips.find(s => s.id === slipId);
  if (!slip || slip.status !== 'open') return account;
  const legs = slip.legs.map((leg, i) => {
    if (leg.result || !results[i]) return leg;
    return { ...leg, result: results[i], ...(finals[i] ? { final: finals[i] } : {}) };
  });
  if (legs.every((leg, i) => leg.result === slip.legs[i].result)) return account;
  let updated = { ...slip, legs };
  let ledger = account.ledger;
  if (legs.every(leg => leg.result)) {
    const { gross, net } = settleSlip({ legs, sizes: slip.sizes, stake: slip.stake });
    const payout = Math.round(net);
    updated = { ...updated, status: 'settled', settledAt: now.toISOString(), gross: Math.round(gross), payout };
    if (!ledger.some(e => e.id === `payout-${slip.id}`)) ledger = [...ledger, { id: `payout-${slip.id}`, t: now.toISOString(), kind: 'payout', amount: payout, slipId: slip.id }];
  }
  return touched({ ...account, ledger, slips: account.slips.map(s => (s.id === slipId ? updated : s)) }, now);
}

// Two copies of one account (this device's and the synced one) as one: every
// ledger entry and slip from either, a settled slip over an open one, and
// leg results known on either side.
export function mergeAccounts(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ledger = new Map();
  for (const entry of [...a.ledger, ...b.ledger]) if (!ledger.has(entry.id)) ledger.set(entry.id, entry);
  const slips = new Map();
  for (const slip of [...a.slips, ...b.slips]) {
    const other = slips.get(slip.id);
    if (!other) slips.set(slip.id, slip);
    else if (other.status !== 'settled' && slip.status === 'settled') slips.set(slip.id, slip);
    else if (other.status !== 'settled') slips.set(slip.id, { ...other, legs: other.legs.map((leg, i) => ({ ...leg, result: leg.result ?? slip.legs[i]?.result ?? null, ...(leg.final ?? slip.legs[i]?.final ? { final: leg.final ?? slip.legs[i]?.final } : {}) })) });
  }
  return {
    v: 1,
    created: a.created < b.created ? a.created : b.created,
    updated: a.updated > b.updated ? a.updated : b.updated,
    ledger: [...ledger.values()].sort((x, y) => x.t.localeCompare(y.t)),
    slips: [...slips.values()].sort((x, y) => y.t.localeCompare(x.t))
  };
}

// Whether a stored value looks like an account (from storage or the sync).
export function isAccount(value) {
  return Boolean(value && value.v === 1 && Array.isArray(value.ledger) && Array.isArray(value.slips) && typeof value.created === 'string');
}
