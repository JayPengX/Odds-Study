import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, PACE, STREAK, scorer, scoreRound, bestRound, typicalPerMinute, earnedToday, roomToday, payGame, wageMinutes, stakeToLose, DERBY, pitchPlan, ballAt, swingResult, derbyPayout, TYPING, ticketCode, groupCode, typedRight, typingPayout, SORT, SORT_SETS, sortSet, sortTicket, sortPayout, FREE_THROW, shotPlan, markerAt, shotResult, freeThrowPayout } from '../public/lib/arcade.mjs';
import { leagueTeams, rememberTeams, normalizeTeamName } from '../public/lib/teams.mjs';
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
  // Ten home runs: their pay and a streak bonus every 3.
  assert.equal(derbyPayout(Array(10).fill('hr')), 10 * DERBY.pay.hr + 3 * STREAK.derby.bonus);
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
  // NT$49 is 15 minutes of a minimum-wage job; betting NT$273 loses NT$60 on average.
  assert.equal(wageMinutes(49), 15);
  assert.equal(Math.round(stakeToLose(60)), 273);
  // Effort pays modestly: a whole round of any game stays small.
  for (const game of ARCADE.games) assert.ok(bestRound(game) <= 100, game);
});


test('ticket sorting: sets of four confusable leagues, a team from one of them, never the same twice running', () => {
  // Leagues without our own tables get ESPN's lists at play time; stand-ins here.
  for (const league of new Set(Object.values(SORT_SETS).flat()))
    if (!leagueTeams(league).length) rememberTeams(league, Array.from({ length: 16 }, (_, i) => ({ name: `${league} Club ${i}`, logo: `https://a.espncdn.com/x/${league}${i}.png` })));
  for (const [set, leagues] of Object.entries(SORT_SETS)) {
    assert.equal(leagues.length, 4);
    // Enough teams that a round of 30 is a real quiz.
    assert.ok(leagues.reduce((n, l) => n + leagueTeams(l).length, 0) >= 50, set);
    let last = null;
    for (let i = 0; i < 40; i++) {
      const ticket = sortTicket(set, Math.random, last?.team);
      assert.ok(leagues.includes(ticket.league));
      assert.ok(leagueTeams(ticket.league).includes(ticket.team));
      assert.notEqual(ticket.team, last?.team);
      last = ticket;
    }
  }
  // Our own tables are big enough on their own.
  for (const league of SORT_SETS.baseball) assert.ok(leagueTeams(league).length >= 6, league);
  assert.ok(SORT_SETS[sortSet()]);
  assert.equal(sortPayout(SORT.tickets), Math.round(SORT.tickets * SORT.pay));
});

test('streaks and penalties follow how hard each game is', () => {
  // The easy work punishes mistakes most; the hardest game not at all and pays streaks most.
  assert.ok(STREAK.typing.penalty >= STREAK.sort.penalty && STREAK.sort.penalty >= STREAK.freethrow.penalty && STREAK.freethrow.penalty > STREAK.derby.penalty);
  assert.equal(STREAK.derby.penalty, 0);
  assert.ok(STREAK.derby.bonus / STREAK.derby.every > STREAK.typing.bonus / STREAK.typing.every);
  // A streak pays its bonus on every `every`th in a row; a mistake resets it.
  const score = scorer('typing');
  for (let i = 0; i < 4; i++) assert.equal(score.good(3), 0);
  assert.equal(score.good(3), STREAK.typing.bonus);
  assert.equal(score.bad(), STREAK.typing.penalty);
  assert.equal(score.run, 0);
  assert.equal(score.total, 5 * 3 + STREAK.typing.bonus - STREAK.typing.penalty);
  // A round never pays under 0.
  assert.equal(scoreRound('typing', ['bad', 'bad', 'bad']).total, 0);
});

test('free throws: the arrow sweeps faster and the zone narrows; the middle swishes', () => {
  assert.ok(shotPlan(9).period < shotPlan(0).period && shotPlan(9).zone < shotPlan(0).zone);
  const plan = shotPlan(0);
  assert.equal(markerAt(plan, 0), 0);
  assert.equal(markerAt(plan, plan.period / 2), 1);
  assert.equal(shotResult(0.5, plan), 'swish');
  assert.equal(shotResult(0.5 + plan.zone / 3, plan), 'make');
  assert.equal(shotResult(0.9, plan), 'miss');
  assert.equal(freeThrowPayout(['swish', 'make', 'miss']), FREE_THROW.pay.swish + FREE_THROW.pay.make - STREAK.freethrow.penalty);
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

test('the pay is balanced: every game pays about the same per minute of typical play', () => {
  for (const game of ARCADE.games) {
    assert.ok(PACE[game], game);
    const rate = typicalPerMinute(game);
    assert.ok(Math.abs(rate - ARCADE.perMinute) / ARCADE.perMinute < 0.15, `${game} ${rate}`);
  }
  // A perfect round of a skill game pays at most about five times a typical one.
  for (const game of ['derby', 'freethrow']) assert.ok(bestRound(game) <= 6 * scoreRound(game, PACE[game].events).total, game);
});
