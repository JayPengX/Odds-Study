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
export function placeSlip(account, slip, now = new Date()) {
  if (!(slip.cost > 0) || slip.cost > balance(account)) return { error: 'funds' };
  const t = now.toISOString();
  const saved = { ...slip, t, status: 'open', legs: slip.legs.map(leg => ({ ...leg, result: null })) };
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
export function applyResults(account, slipId, results, now = new Date()) {
  const slip = account.slips.find(s => s.id === slipId);
  if (!slip || slip.status !== 'open') return account;
  const legs = slip.legs.map((leg, i) => ({ ...leg, result: leg.result ?? results[i] ?? null }));
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
    else if (other.status !== 'settled') slips.set(slip.id, { ...other, legs: other.legs.map((leg, i) => ({ ...leg, result: leg.result ?? slip.legs[i]?.result ?? null })) });
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
