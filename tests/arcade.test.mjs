import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, earnedToday, roomToday, payGame, hourlyRate, stakeToLose, DERBY, pitchPlan, ballAt, swingResult, derbyPayout, TYPING, ticketCode, groupCode, typedRight, typingPayout, SORT, SORT_BINS, sortTicket, sortPayout, FREE_THROW, shotPlan, markerAt, shotResult, freeThrowPayout } from '../public/lib/arcade.mjs';
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
  assert.ok(typingPayout(TYPING.codes) <= 100 && sortPayout(SORT.tickets) <= 100 && derbyPayout(Array(10).fill('hr')) <= 250 && freeThrowPayout(Array(10).fill('swish')) <= 100);
});


test('ticket sorting: every ticket has one right box', () => {
  const owner = new Map(Object.entries(SORT_BINS).flatMap(([bin, leagues]) => leagues.map(l => [l, bin])));
  assert.equal(owner.size, Object.values(SORT_BINS).flat().length);
  for (let i = 0; i < 50; i++) {
    const ticket = sortTicket();
    assert.equal(owner.get(ticket.league), ticket.bin);
  }
  assert.equal(sortPayout(SORT.tickets), SORT.tickets * SORT.pay);
});

test('free throws: the arrow sweeps faster and the zone narrows; the middle swishes', () => {
  assert.ok(shotPlan(9).period < shotPlan(0).period && shotPlan(9).zone < shotPlan(0).zone);
  const plan = shotPlan(0);
  assert.equal(markerAt(plan, 0), 0);
  assert.equal(markerAt(plan, plan.period / 2), 1);
  assert.equal(shotResult(0.5, plan), 'swish');
  assert.equal(shotResult(0.5 + plan.zone / 3, plan), 'make');
  assert.equal(shotResult(0.9, plan), 'miss');
  assert.equal(freeThrowPayout(['swish', 'make', 'miss']), FREE_THROW.pay.swish + FREE_THROW.pay.make);
  // No math and no luck: every game is work or timing.
  assert.deepEqual(ARCADE.games, ['typing', 'sort', 'derby', 'freethrow']);
});

test('no two leagues share a name, so every ticket (and board card) says which one it is', async () => {
  globalThis.navigator ??= { language: 'en' };
  const { makeT } = await import('../public/lib/i18n.mjs');
  const { LEAGUES } = await import('../public/lib/teams.mjs');
  for (const locale of ['zh', 'en']) {
    const t = makeT(locale);
    const names = [...Object.keys(LEAGUES), 'f1'].map(k => t(`sport_${k}`));
    assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], locale);
  }
});
