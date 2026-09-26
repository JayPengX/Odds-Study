import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, PACE, STREAK, scorer, scoreRound, bestRound, typicalPerMinute, earnedToday, roomToday, payGame, wageMinutes, stakeToLose, DERBY, pitchPlan, ballAt, swingResult, derbyPayout, TYPING, ticketCode, groupCode, typedRight, typingPayout, SORT, SORT_SETS, SORT_LEAGUES, SORT_SPORTS, sortQuestion, sortPayout, FREE_THROW, shotPlan, markerAt, shotResult, freeThrowPayout } from '../public/lib/arcade.mjs';
import { leagueTeams, rememberTeams, normalizeTeamName, teamNick, familyOf } from '../public/lib/teams.mjs';
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
  assert.equal(derbyPayout(['hit', 'miss']), DERBY.pay.hit - STREAK.derby.penalty);
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


test('team quiz: a new mixed question every ticket, one right box, never a coin toss', () => {
  // ESPN's lists at play time; stand-ins here, with clashing nicknames on purpose.
  const clash = { nhl: 'Rangers', mlb: 'Rangers', nfl: 'Giants' };
  for (const league of SORT_LEAGUES)
    if (league !== 'npb' && league !== 'kbo' && league !== 'cpbl' && league !== 'bleague' && league !== 'euroleague')
      rememberTeams(league, Array.from({ length: 16 }, (_, i) => ({ name: `${league} City ${i}`, nick: i === 0 && clash[league] ? clash[league] : `${league}${i}s`, logo: `https://a.espncdn.com/x/${league}${i}.png` })));
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const kinds = new Set();
  const orders = new Set();
  let last = null;
  for (let i = 0; i < 400; i++) {
    const q = sortQuestion({ random, last: last?.team });
    assert.ok(q, 'a question');
    kinds.add(`${q.kind}|${q.clue}`);
    orders.add(q.boxes.map(b => b.key).join(','));
    assert.equal(new Set(q.boxes.map(b => b.key)).size, 4);
    assert.ok(q.boxes.some(b => b.key === q.answer));
    assert.equal(q.kind === 'sport' ? familyOf(q.league) : q.league, q.answer);
    assert.notEqual(q.team, last?.team);
    // A nickname clue fits the right box alone.
    if (q.clue === 'nick') {
      const boxOf = l => (q.kind === 'sport' ? familyOf(l) : l);
      const keys = new Set(q.boxes.map(b => b.key));
      const others = SORT_LEAGUES.filter(l => keys.has(boxOf(l)) && boxOf(l) !== q.answer);
      assert.ok(!others.some(l => leagueTeams(l).some(t => normalizeTeamName(teamNick(l, t)) === normalizeTeamName(q.nick))), `${q.nick} is ambiguous`);
    }
    last = q;
  }
  // Every kind of question and clue turns up, and the boxes keep moving.
  for (const k of ['group|logo', 'group|nick', 'group|full', 'sport|nick', 'sport|logo', 'mixed|logo', 'mixed|nick']) assert.ok(kinds.has(k), k);
  assert.ok(orders.size > 100);
  assert.ok(SORT_SPORTS.every(sp => SORT_LEAGUES.some(l => familyOf(l) === sp)));
  assert.equal(sortPayout(SORT.tickets), Math.round(SORT.tickets * SORT.pay));
});

test('risk by kind of game: typing is the safe earn, the skill games high risk, high pay', () => {
  // Typing: a typo costs nothing, and a round pays nearly the same however it goes.
  assert.equal(STREAK.typing.penalty, 0);
  assert.ok(bestRound('typing') <= 1.1 * scoreRound('typing', PACE.typing.events).total);
  // The skill games: misses cost money, a bad round pays about nothing, a good one two to three times typical, a perfect one never more than about four and a half.
  const bad = { derby: ['hit', 'miss', 'miss', 'hit', 'miss', 'miss', 'miss', 'miss', 'miss', 'miss'], freethrow: ['make', 'miss', 'miss', 'make', 'miss', 'miss', 'miss', 'miss', 'miss', 'miss'] };
  const good = { derby: ['hr', 'hr', 'hit', 'hr', 'hit', 'hit', 'miss', 'hr', 'hit', 'hit'], freethrow: ['swish', 'make', 'swish', 'make', 'make', 'miss', 'swish', 'make', 'make', 'miss'] };
  for (const game of ['derby', 'freethrow']) {
    const typical = scoreRound(game, PACE[game].events).total;
    assert.ok(STREAK[game].penalty > 0, game);
    assert.ok(scoreRound(game, bad[game]).total <= 2, game);
    assert.ok(scoreRound(game, good[game]).total >= 2 * typical, game);
    assert.ok(bestRound(game) <= 4.5 * typical, game);
  }
  // A streak pays its bonus on every `every`th in a row; a mistake resets it.
  const score = scorer('sort');
  for (let i = 0; i < STREAK.sort.every - 1; i++) assert.equal(score.good(1), 0);
  assert.equal(score.good(1), STREAK.sort.bonus);
  assert.equal(score.bad(), STREAK.sort.penalty);
  assert.equal(score.run, 0);
  // A round never pays under 0.
  assert.equal(scoreRound('freethrow', ['miss', 'miss', 'miss']).total, 0);
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
});
