import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, earnedToday, roomToday, payGame, hourlyRate, stakeToLose, DERBY, pitchPlan, ballAt, swingResult, derbyPayout, valueQuestion, valuePayout, VALUE_GAME, TYPING, ticketCode, groupCode, typedRight, typingPayout, QUIZZES, quizQuestion, quizRight, quizPayout } from '../public/lib/arcade.mjs';
import { newAccount, balance, mergeAccounts } from '../public/lib/account.mjs';

test('mini games pay into the ledger, at most the daily cap, and merge like any entry', () => {
  const now = new Date('2026-09-26T04:00:00Z');
  let account = newAccount(now);
  let paid;
  ({ account, paid } = payGame(account, 'derby', 700, now));
  assert.equal(paid, 700);
  ({ account, paid } = payGame(account, 'memory', 1000, now));
  assert.equal(paid, ARCADE.dailyCap - 700);
  assert.equal(roomToday(account, now), 0);
  assert.equal(payGame(account, 'value', 100, now).paid, 0);
  assert.equal(balance(account), 10_000 + ARCADE.dailyCap);
  // A new Taiwan day, a new cap.
  const tomorrow = new Date('2026-09-26T17:00:00Z');
  assert.equal(earnedToday(account, tomorrow), 0);
  assert.equal(payGame(account, 'value', 100, tomorrow).paid, 100);
  // Two devices' winnings add up, none counted twice.
  const merged = mergeAccounts(account, payGame(account, 'derby', 50, tomorrow).account);
  assert.equal(balance(merged), balance(account) + 50);
  assert.equal(balance(mergeAccounts(merged, merged)), balance(merged));
});

test('home run derby: timing decides, faster pitches, change-ups slow down', () => {
  assert.equal(swingResult(DERBY.plate), 'hr');
  assert.equal(swingResult(DERBY.plate + DERBY.hr + 0.01), 'hit');
  assert.equal(swingResult(DERBY.plate - DERBY.hit - 0.01), 'miss');
  const fixed = () => 0.5;
  assert.ok(pitchPlan(9, fixed).ms < pitchPlan(0, fixed).ms);
  const change = { ms: 1000, changeUp: true };
  assert.equal(ballAt(change, 500), 0.5);
  assert.ok(ballAt(change, 900) < 0.9);
  // The home run window is a few tens of milliseconds even on the slowest pitch.
  assert.ok(2 * DERBY.hr * pitchPlan(0, () => 1).ms < 70);
  assert.equal(derbyPayout(Array(10).fill('hr')), 10 * DERBY.pay.hr + DERBY.allHrBonus);
  assert.equal(derbyPayout(['hit', 'miss']), DERBY.pay.hit);
});

test('which pays more: two picks from different games, a clear answer', () => {
  const picks = [
    { id: 'a', gameId: 1, fairChance: 0.5, odds: 1.9 },
    { id: 'b', gameId: 2, fairChance: 0.3, odds: 2.9 },
    { id: 'c', gameId: 2, fairChance: 0.6, odds: 1.4 }
  ];
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 20; i++) {
    const q = valueQuestion(picks, random);
    assert.notEqual(q.a.gameId, q.b.gameId);
    assert.ok(Math.abs(q.backA - q.backB) >= VALUE_GAME.minGap);
    assert.equal(q.answer, q.backA > q.backB ? 'a' : 'b');
  }
  assert.equal(valueQuestion(picks.slice(0, 1)), null);
  assert.equal(valuePayout(10), 10 * VALUE_GAME.pay + VALUE_GAME.perfectBonus);
  assert.equal(valuePayout(9), 9 * VALUE_GAME.pay);
});

test('data entry: pure effort, the same pay for every number typed right', () => {
  const code = ticketCode();
  assert.match(code, /^\d{10}$/);
  assert.equal(groupCode('4829173506'), '4829 1735 06');
  assert.ok(typedRight('4829 1735 06', '4829173506'));
  assert.ok(typedRight('4829-1735-06', '4829173506'));
  assert.ok(!typedRight('4829 1735 60', '4829173506'));
  assert.equal(typingPayout(TYPING.codes), TYPING.codes * TYPING.pay);
});

test('every round is measured against the minimum wage and the lottery\'s take', () => {
  // NT$60 in 10 minutes is NT$360 an hour; betting NT$273 loses it on average.
  assert.equal(hourlyRate(60, 600_000), 360);
  assert.equal(Math.round(stakeToLose(60)), 273);
  // Effort pays modestly: a whole round of any game stays small.
  assert.ok(typingPayout(TYPING.codes) <= 100 && valuePayout(VALUE_GAME.questions) <= 150 && derbyPayout(Array(10).fill('hr')) <= 250);
});

test('office quizzes: worked-out answers, the same pay for each right one', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 50; i++) {
    const pay = quizQuestion('payout', random);
    assert.equal(pay.answer, Math.round(pay.parts.stake * pay.parts.odds));
    assert.ok(quizRight(pay, String(pay.answer)) && !quizRight(pay, String(pay.answer + 1)));
    const till = quizQuestion('till', random);
    assert.equal(till.answer, till.parts.amounts.reduce((a, b) => a + b, 0));
    assert.ok(quizRight(till, `${till.answer.toLocaleString('en')}`));
    const implied = quizQuestion('implied', random);
    assert.ok(quizRight(implied, `${implied.answer + 1}%`) && !quizRight(implied, String(implied.answer + 2)));
  }
  assert.ok(!quizRight(quizQuestion('till'), ''));
  for (const kind of Object.keys(QUIZZES)) assert.equal(quizPayout(kind, 10), 10 * QUIZZES[kind].pay);
  assert.deepEqual(ARCADE.games.filter(g => QUIZZES[g]), Object.keys(QUIZZES));
});
