// 小遊戲: small games that earn play money for the practice account, by
// effort, not luck, and no math: typing ticket numbers and sorting tickets
// (plain work), a home run derby and free throws (practice until your timing
// is right). The pay is small on purpose: every round shows what it worked
// out to an hour against Taiwan's minimum wage, and how little betting it
// takes to lose it again, so the games are a reminder of how slowly money is
// earned. All together they pay at most ARCADE.dailyCap a Taiwan day.
//
// Winnings go in the ledger like every other entry ('game-<id>', kind
// 'game'), so they sync and merge across devices the same way. The account's
// betting result leaves them out, like the weekly grants.
import { taipeiDayKey } from './sources.mjs';

export const ARCADE = {
  dailyCap: 1500,
  // What every game pays for a minute of typical play (NT$).
  perMinute: 25,
  games: ['typing', 'sort', 'derby', 'freethrow'],
  // Taiwan's minimum hourly wage in 2026 (NT$).
  minWage: 196,
  // What the lottery keeps of every NT$100 staked, on average (it pays out at most 78%).
  take: 0.22
};

// Balanced pay: every game pays about ARCADE.perMinute for a minute of
// typical play, so none is the one to farm. PACE is each game's typical
// round: how long it takes (typing about 7 s a number on a phone, sorting
// 1.5 s a ticket, a pitch or a shot about 3.5 s with the wait and the
// replay) and how a practised but ordinary player does at the skill games.
// Better players earn more at those, up to about 4 times as much.
export const PACE = {
  typing: { seconds: 140 },
  sort: { seconds: 45 },
  derby: { seconds: 35, results: ['hr', 'hr', 'hit', 'hit', 'hit', 'hit', 'miss', 'miss', 'miss', 'miss'] },
  freethrow: { seconds: 32, results: ['swish', 'swish', 'make', 'make', 'make', 'make', 'miss', 'miss', 'miss', 'miss'] }
};

// What a round worked out to an hour, and how much betting loses as much on average.
export const hourlyRate = (paid, ms) => (ms > 0 ? (paid / ms) * 3_600_000 : 0);
export const stakeToLose = paid => paid / ARCADE.take;

// ---- Money ------------------------------------------------------------------------

export function earnedToday(account, now = new Date()) {
  const day = taipeiDayKey(now.toISOString());
  return account.ledger.filter(e => e.kind === 'game' && taipeiDayKey(e.t) === day).reduce((s, e) => s + e.amount, 0);
}

export const roomToday = (account, now = new Date()) => Math.max(0, ARCADE.dailyCap - earnedToday(account, now));

function entryId(now) {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `game-${now.getTime().toString(36)}${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

// Pays a finished round's winnings, as much as today's room allows.
// Returns { account, paid }.
export function payGame(account, game, amount, now = new Date()) {
  const paid = Math.max(0, Math.min(Math.round(amount), roomToday(account, now)));
  if (paid === 0) return { account, paid };
  const t = now.toISOString();
  return { account: { ...account, updated: t, ledger: [...account.ledger, { id: entryId(now), t, kind: 'game', game, amount: paid }] }, paid };
}

// ---- 全壘打大賽 (home run derby) ------------------------------------------------------
//
// Ten pitches a round, each faster than the last, some of them change-ups
// that slow down halfway. Swing as the ball crosses the plate: within
// DERBY.hr of its middle a home run, within DERBY.hit a base hit, else a miss.
export const DERBY = { pitches: 10, plate: 0.83, hr: 0.025, hit: 0.07, pay: { hr: 4, hit: 2, miss: 0 }, allHrBonus: 20 };

// How long pitch i (0-based) takes to reach the end of the track, in ms, and
// whether it's a change-up.
export function pitchPlan(i, random = Math.random) {
  const base = 1150 - i * 55;
  return { ms: Math.round(base * (0.88 + random() * 0.24)), changeUp: i >= 3 && random() < 0.3 };
}

// Where the ball is (0-1 along the track) `elapsed` ms into a pitch: a
// change-up runs at full speed to halfway, then at 60%.
export function ballAt(plan, elapsed) {
  const x = elapsed / plan.ms;
  if (!plan.changeUp || x <= 0.5) return x;
  return 0.5 + (x - 0.5) * 0.6;
}

export function swingResult(position) {
  const off = Math.abs(position - DERBY.plate);
  return off <= DERBY.hr ? 'hr' : off <= DERBY.hit ? 'hit' : 'miss';
}

export function derbyPayout(results) {
  const sum = results.reduce((s, r) => s + DERBY.pay[r], 0);
  return sum + (results.length === DERBY.pitches && results.every(r => r === 'hr') ? DERBY.allHrBonus : 0);
}

// ---- 打工：輸入彩券號碼 (data entry) ---------------------------------------------------
//
// Plain work: type each ticket number exactly as shown. Every one typed right
// pays the same; a typo pays nothing and the number stays until it's right.
// Nothing is left to chance: the more you type, the more you earn.
export const TYPING = { codes: 20, digits: 10, pay: 3 };

// A ticket number: ten digits, shown in groups of four ("4829 1735 06").
export function ticketCode(random = Math.random) {
  return Array.from({ length: TYPING.digits }, () => Math.floor(random() * 10)).join('');
}
export const groupCode = code => code.replace(/(\d{4})(?=\d)/g, '$1 ');
// Typed right: the same digits, whatever spaces or dashes.
export const typedRight = (typed, code) => typed.replace(/\D/g, '') === code;

export const typingPayout = right => right * TYPING.pay;

// ---- 整理彩券 (sorting tickets) ----------------------------------------------------------
//
// Plain work: each ticket names a league; tap the box of its sport. Every one
// sorted right pays the same; a wrong box pays nothing and the ticket stays.
// NT$0.6 a ticket, paid rounded at the end of the round (NT$18 for all 30).
export const SORT = { tickets: 30, pay: 0.6 };
// The four boxes and the leagues whose tickets go in each.
export const SORT_BINS = {
  baseball: ['mlb', 'npb', 'kbo', 'cpbl'],
  basketball: ['nba', 'wnba', 'euroleague', 'bleague'],
  soccer: ['epl', 'laliga', 'seriea', 'bundesliga', 'ucl', 'jleague'],
  tennis: ['tennis', 'wta']
};

export function sortTicket(random = Math.random) {
  const bins = Object.keys(SORT_BINS);
  const bin = bins[Math.floor(random() * bins.length)];
  const leagues = SORT_BINS[bin];
  return { league: leagues[Math.floor(random() * leagues.length)], bin };
}

export const sortPayout = right => Math.round(right * SORT.pay);

// ---- 罰球 (free throws) ------------------------------------------------------------------
//
// Ten shots. A marker sweeps back and forth across the aim bar, faster each
// shot, while the green zone in the middle narrows: stop it in the zone's
// middle half for a swish, anywhere in the zone for a make.
export const FREE_THROW = { shots: 10, pay: { swish: 3, make: 2, miss: 0 } };

export function shotPlan(i) {
  return { period: 1500 - i * 80, zone: 0.16 - i * 0.009 };
}

// The marker's place (0-1) `elapsed` ms into a shot: there and back each period.
export function markerAt(plan, elapsed) {
  const x = (elapsed % plan.period) / plan.period;
  return x < 0.5 ? 2 * x : 2 - 2 * x;
}

export function shotResult(position, plan) {
  const off = Math.abs(position - 0.5);
  return off <= plan.zone / 4 ? 'swish' : off <= plan.zone / 2 ? 'make' : 'miss';
}

export const freeThrowPayout = results => results.reduce((s, r) => s + FREE_THROW.pay[r], 0);

// A game's typical pay per minute (PACE), to keep them level.
export function typicalPerMinute(game) {
  const pace = PACE[game];
  const pay = { typing: typingPayout(TYPING.codes), sort: sortPayout(SORT.tickets), derby: derbyPayout(PACE.derby.results), freethrow: freeThrowPayout(PACE.freethrow.results) }[game];
  return (pay / pace.seconds) * 60;
}
