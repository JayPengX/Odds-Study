// 小遊戲: small games that earn play money for the practice account, by
// effort, not luck: typing ticket numbers, working out payouts, adding up
// the till and turning odds into chances (steady work), a which-pays-more
// quiz (mental math against the clock) and a home run derby (practice until
// your timing is right). The pay is small on purpose: every round shows what it worked out
// to an hour against Taiwan's minimum wage, and how little betting it takes
// to lose it again, so the games are a reminder of how slowly money is
// earned. All together they pay at most ARCADE.dailyCap a Taiwan day.
//
// Winnings go in the ledger like every other entry ('game-<id>', kind
// 'game'), so they sync and merge across devices the same way. The account's
// betting result leaves them out, like the weekly grants.
import { taipeiDayKey } from './sources.mjs';

export const ARCADE = {
  dailyCap: 1500,
  games: ['typing', 'payout', 'till', 'implied', 'value', 'derby'],
  // Taiwan's minimum hourly wage in 2026 (NT$).
  minWage: 196,
  // What the lottery keeps of every NT$100 staked, on average (it pays out at most 78%).
  take: 0.22
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
export const DERBY = { pitches: 10, plate: 0.83, hr: 0.025, hit: 0.07, pay: { hr: 15, hit: 4, miss: 0 }, allHrBonus: 50 };

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

// ---- 誰比較划算 (which pays back more) --------------------------------------------------
//
// Two real picks from today's board, each with its odds and fair chance: tap
// the one that returns more per NT$100 (chance x odds) before the clock runs
// out. The numbers are the page's own, so the game is the page's one lesson.
export const VALUE_GAME = { questions: 10, seconds: 7, pay: 8, perfectBonus: 40, minGap: 2 };

// A question from a list of picks ({ id, fairChance, odds, ... }): two picks
// whose return per NT$100 differs by at least minGap. Null if there aren't any.
export function valueQuestion(picks, random = Math.random) {
  const usable = picks.filter(p => p.fairChance >= 0.05 && p.fairChance <= 0.9 && p.odds > 1);
  if (usable.length < 2) return null;
  for (let tries = 0; tries < 60; tries++) {
    const a = usable[Math.floor(random() * usable.length)];
    const b = usable[Math.floor(random() * usable.length)];
    if (a === b || a.gameId === b.gameId) continue;
    const backA = a.fairChance * a.odds * 100;
    const backB = b.fairChance * b.odds * 100;
    if (Math.abs(backA - backB) >= VALUE_GAME.minGap) return { a, b, backA, backB, answer: backA > backB ? 'a' : 'b' };
  }
  return null;
}

export function valuePayout(correct, total = VALUE_GAME.questions) {
  return correct * VALUE_GAME.pay + (correct === total ? VALUE_GAME.perfectBonus : 0);
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

// ---- Office work: payout, till and odds sums ------------------------------------------
//
// Three more plain-work quizzes, typed answers, no clock and no luck: every
// answer is worked out, and every right one pays the same.
// - payout 算彩金: a single ticket's payout (stake x odds);
// - till 對帳: the day's tickets added up;
// - implied 換算機率: the chance odds imply (100 / odds, to the nearest %; 1 either way is fine).
export const QUIZZES = {
  payout: { questions: 10, pay: 5 },
  till: { questions: 10, pay: 5 },
  implied: { questions: 10, pay: 4 }
};

const pick = (list, random) => list[Math.floor(random() * list.length)];

// A question: { kind, parts, answer } (parts: what to show).
export function quizQuestion(kind, random = Math.random) {
  if (kind === 'payout') {
    const stake = pick([100, 200, 300, 500, 1000], random);
    const odds = Math.round((1.2 + random() * 3.3) * 100) / 100;
    return { kind, parts: { stake, odds }, answer: Math.round(stake * odds) };
  }
  if (kind === 'till') {
    const amounts = Array.from({ length: 5 }, () => 10 * (5 + Math.floor(random() * 196)));
    return { kind, parts: { amounts }, answer: amounts.reduce((a, b) => a + b, 0) };
  }
  const odds = Math.round((1.1 + random() * 8.8) * 100) / 100;
  return { kind: 'implied', parts: { odds }, answer: Math.round(100 / odds) };
}

export function quizRight(question, typed) {
  const value = Number(String(typed).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(value) || String(typed).trim() === '') return false;
  return question.kind === 'implied' ? Math.abs(value - question.answer) <= 1 : value === question.answer;
}

export const quizPayout = (kind, right) => right * QUIZZES[kind].pay;
