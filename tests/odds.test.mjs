import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToProbability,
  devigTwoWay,
  devigPower,
  estimateLotteryOdds,
  estimateF1LotteryOdds,
  estimateFuturesOdds,
  evaluateSlip,
  lotteryTotalLines,
  lotteryRunLines,
  MLB_MARKET_OVERROUND,
  houseTake,
  slipErrors,
  slipSizes,
  choose,
  expectedReturn,
  overround,
  combineParlay,
  blendOutcomes,
  devigProportional,
  HABITS,
  habitPools,
  simulateHabit,
  simulateCrowdStats,
  playerRandom,
  quantile,
  seededRandom,
  K_BOTH,
  K_POLYMARKET
} from '../public/lib/odds.mjs';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('American odds convert to implied chance', () => {
  close(americanToProbability(-110), 0.5238);
  close(americanToProbability(150), 0.4);
  assert.equal(americanToProbability('x'), null);
  assert.equal(americanToProbability(0), null);
});

test('two-way devig removes the margin', () => {
  close(devigTwoWay(0.5238, 0.5238), 0.5);
  assert.equal(devigTwoWay(0, 0.5), null);
});

test('power devig sums to 1 and shrinks longshots more', () => {
  const raw = [0.6, 0.3, 0.2];
  const fair = devigPower(raw);
  close(fair.reduce((s, p) => s + p, 0), 1);
  assert.ok(fair[2] / raw[2] < fair[0] / raw[0]);
});

// Real lottery prices from 2026-09-25 against DraftKings+Polymarket fair chances.
test('lottery estimate reproduces real MLB prices within a few cents', () => {
  close(estimateLotteryOdds(0.4455, K_BOTH), 1.95, 0.02);
  close(estimateLotteryOdds(1 - 0.4455, K_BOTH), 1.57, 0.02);
  close(estimateLotteryOdds(0.502, K_BOTH), 1.73, 0.01);
});

test('F1 estimate follows the power rule', () => {
  close(estimateF1LotteryOdds(0.4081), 1.86, 0.01);
  close(estimateF1LotteryOdds(0.041), 9.1, 0.1);
  close(estimateF1LotteryOdds(0.0287), 11.67, 0.01);
  // Longshots sit on the lottery's fixed prices (2026 Azerbaijan GP).
  assert.equal(estimateF1LotteryOdds(0.0064), 65);
  assert.equal(estimateF1LotteryOdds(0.0025), 325);
  assert.equal(estimateF1LotteryOdds(0.0005), 500);
});

test('expected return and overround', () => {
  close(expectedReturn(0.502, 1.8), 90.36);
  close(overround([1.8, 1.7]), 1.1438);
});

test('parlay multiplies odds and chances', () => {
  const p = combineParlay([
    { odds: 1.8, fairChance: 0.5 },
    { odds: 1.72, fairChance: 0.517 }
  ]);
  close(p.odds, 3.096);
  close(p.fairChance, 0.2585);
});

test('blendOutcomes averages sources and picks the right multiplier', () => {
  assert.equal(blendOutcomes(null, null), null);
  const both = blendOutcomes({ away: 0.5, home: 0.5 }, { away: 0.52, home: 0.48 });
  close(both.probs.away, 0.51);
  assert.equal(both.k, K_BOTH);
  assert.equal(blendOutcomes(null, { away: 0.4, draw: 0.3, home: 0.3 }).k, K_POLYMARKET);
});

test('proportional devig handles three outcomes', () => {
  const [a, d, h] = devigProportional([0.14, 0.2, 0.75]);
  close(a + d + h, 1);
  assert.ok(h > 0.68 && h < 0.7);
  assert.equal(devigProportional([0.5, null, 0.5]), null);
});

// 10 games, two sides each, every price at the estimated 1.15 cut.
function examplePool() {
  const pool = [];
  for (let g = 0; g < 10; g++) {
    const p = 0.35 + g * 0.03;
    for (const q of [p, 1 - p]) pool.push({ gameId: g, fairChance: q, odds: estimateLotteryOdds(q, 1.15) });
  }
  return pool;
}
const habit = key => HABITS.find(h => h.key === key);

test('habit pools pick favorites, underdogs and the least costly bets', () => {
  const pools = habitPools(examplePool());
  assert.ok(pools.favorite.every(b => b.fairChance >= 0.55));
  assert.ok(pools.underdog.every(b => b.fairChance <= 0.4));
  assert.equal(pools.best.length, 5);
  // Nothing to pick falls back to the whole pool.
  const even = [{ gameId: 1, fairChance: 0.5, odds: 1.74 }, { gameId: 2, fairChance: 0.5, odds: 1.74 }];
  assert.equal(habitPools(even).favorite.length, 2);
});

test('a season is reproducible and its path adds up', () => {
  const pools = habitPools(examplePool());
  const run = () => simulateHabit({ habit: habit('casual'), pools, weeks: 52, random: seededRandom(5) });
  assert.deepEqual(run(), run());
  const a = run();
  assert.equal(a.path.length, 52);
  assert.equal(a.final, a.path.at(-1));
  assert.ok(a.wonTickets <= a.tickets && a.staked >= a.tickets * 100 && a.maxStake <= 3000);
  assert.equal(a.everAhead, a.peak > 0);
});

test('the chaser doubles after a losing week and stays under the cap', () => {
  const pools = habitPools(examplePool());
  const run = simulateHabit({ habit: habit('chaser'), pools, weeks: 156, random: seededRandom(2) });
  assert.ok(run.maxStake > 200 && run.maxStake <= 3000);
  assert.ok([400, 800, 1600, 3000].includes(run.maxStake));
});

test('riders keep betting their winnings, within the ticket limit', () => {
  const pools = habitPools(examplePool());
  const ride = key => simulateHabit({ habit: habit(key), pools, weeks: 260, random: seededRandom(5) });
  const flat = key => simulateHabit({ habit: { ...habit(key), ride: false }, pools, weeks: 260, random: seededRandom(5) });
  for (const key of ['dreamer', 'underdog']) {
    const [r, f] = [ride(key), flat(key)];
    assert.ok(r.tickets >= f.tickets, key);
    assert.ok(r.staked > f.staked, key);
    assert.ok(r.maxStake > 3000 && r.maxStake <= 100_000 && r.maxStake % 10 === 0, `${key} ${r.maxStake}`);
  }
});

test('each extra parlay leg takes the cut again, and a big crowd is stable', () => {
  const pools = habitPools(examplePool());
  const crowd = seed => simulateCrowdStats({ pools, weeks: 52, perHabit: 2000, seed });
  const a = crowd(1);
  const back = key => a.summaries.find(h => h.habit.key === key).back;
  // 2 legs: (1 / 1.15)^2 = 75.6 before tax; the occasional big ticket paying
  // over NT$5,000 loses 20.4% to tax, so a bit less. 4-6 legs: about 50.
  assert.ok(back('casual') > 66 && back('casual') < 76, `${back('casual')}`);
  assert.ok(back('dreamer') > 38 && back('dreamer') < 60, `${back('dreamer')}`);
  // The same seed is the same world: identical results. (Another seed is
  // another world, with its own lucky and unlucky results for everyone.)
  const b = crowd(1);
  for (let i = 0; i < a.summaries.length; i++) assert.equal(a.summaries[i].back, b.summaries[i].back);
  // Bands are ordered and every week is counted.
  for (const w of a.bands) assert.ok(w.q10 <= w.q25 && w.q25 <= w.q50 && w.q50 <= w.q75 && w.q75 <= w.q90);
  assert.equal(a.players, 2000 * HABITS.length);
});

test('the highlighted players are replayed exactly and sit at their rank', () => {
  const pools = habitPools(examplePool());
  const stats = simulateCrowdStats({ pools, weeks: 26, perHabit: 300, seed: 4 });
  const { best, median, worst } = stats.characters;
  assert.ok(worst.final <= median.final && median.final <= best.final);
  assert.equal(best.path.length, 26);
  assert.equal(best.path.at(-1), best.final);
  // Same seed and index, same player.
  const again = simulateHabit({ habit: best.habit, pools, weeks: 26, random: playerRandom(4, 0) });
  const first = simulateHabit({ habit: best.habit, pools, weeks: 26, random: playerRandom(4, 0) });
  assert.deepEqual(again, first);
});

test('quantile interpolates a sorted list', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([0, 10], 0.25), 2.5);
  assert.equal(quantile([7], 0.9), 7);
});

test('futures estimate reproduces the lottery AL prices and its longshot steps', () => {
  // Polymarket fair chances and real lottery prices, 2026-09-25.
  const fair = [0.276, 0.219, 0.154, 0.119, 0.118, 0.071, 0.042];
  const real = [2.2, 2.45, 3.5, 3.95, 3.95, 4.85, 7.25];
  const est = estimateFuturesOdds(fair, 2.0);
  const err = est.reduce((s, o, i) => s + Math.abs(o - real[i]) / real[i], 0) / real.length;
  assert.ok(err < 0.08, `${err}`);
  // Implied chances add up to the overround.
  close(est.reduce((s, o) => s + 1 / o, 0), 2.0, 0.01);
  assert.deepEqual(estimateFuturesOdds([0.9, 0.003, 0.001], 1.6).slice(1), [133, 300]);
});

const slipLegs = [
  { gameId: 1, odds: 1.8, fairChance: 0.5 },
  { gameId: 2, odds: 2, fairChance: 0.45 },
  { gameId: 3, odds: 1.7, fairChance: 0.55 }
];

test('slip modes buy the right combinations', () => {
  assert.deepEqual(slipSizes('single', 3), [1]);
  assert.deepEqual(slipSizes('parlay', 3), [3]);
  assert.deepEqual(slipSizes('parlay', 1), []);
  assert.deepEqual(slipSizes('system', 3, [3, 2, 2, 5]), [2, 3]);
  // 12 games, every size from 2 up: 2^12 - 1 - 12 combinations.
  const all = slipSizes('system', 12, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(all.reduce((s, k) => s + choose(12, k), 0), 4083);
});

test('slip follows the lottery ticket rules', () => {
  const ok = { mode: 'parlay', legs: slipLegs, sizes: [3], stake: 100 };
  assert.deepEqual(slipErrors(ok), []);
  assert.ok(slipErrors({ ...ok, stake: 105 }).includes('stakeUnit'));
  assert.ok(slipErrors({ ...ok, stake: 50 }).includes('ticketMin'));
  assert.ok(slipErrors({ ...ok, stake: 100_010 }).includes('ticketMax'));
  assert.ok(slipErrors({ ...ok, legs: [slipLegs[0], { ...slipLegs[1], gameId: 1 }], sizes: [2] }).includes('sameGame'));
  const thirteen = Array.from({ length: 13 }, (_, i) => ({ gameId: i, odds: 1.8, fairChance: 0.5 }));
  assert.ok(slipErrors({ ...ok, legs: thirteen, sizes: [13] }).includes('tooManyLegs'));
  assert.ok(slipErrors({ mode: 'system', legs: slipLegs.slice(0, 2), sizes: [], stake: 100 }).includes('systemNeedsThree'));
  // Three NT$10 singles total NT$30: under the NT$100 ticket minimum.
  assert.ok(slipErrors({ mode: 'single', legs: slipLegs, sizes: [1], stake: 10 }).includes('ticketMin'));
});

test('slip payouts, averages and chances are exact', () => {
  const parlay = evaluateSlip({ legs: slipLegs, sizes: [3], stake: 100 });
  close(parlay.best, 612);
  close(parlay.expected, 0.5 * 0.45 * 0.55 * 612, 1e-9);
  close(parlay.anyPayout, 0.5 * 0.45 * 0.55, 1e-12);
  close(parlay.byHits.reduce((s, r) => s + r.chance, 0), 1, 1e-12);
  // Singles: average back is each leg's own chance x odds.
  const single = evaluateSlip({ legs: slipLegs, sizes: [1], stake: 100 });
  close(single.expected, 90 + 90 + 93.5, 1e-9);
  close(single.anyPayout, 1 - 0.5 * 0.55 * 0.45, 1e-12);
  // System 2+3 of 3: all three pairs plus the treble.
  const system = evaluateSlip({ legs: slipLegs, sizes: [2, 3], stake: 100 });
  assert.equal(system.combos, 4);
  close(system.best, 100 * (3.6 + 3.06 + 3.4 + 6.12));
  // Exactly 2 right pays one pair: between 1.8x1.7 and 2x1.8.
  close(system.byHits[2].min, 306);
  close(system.byHits[2].max, 360);
});

test('slip withholds 20.4% from each combination over NT$5,000 and caps a ticket', () => {
  const big = evaluateSlip({ legs: [{ gameId: 1, odds: 3, fairChance: 1 }, { gameId: 2, odds: 3, fairChance: 1 }], sizes: [2], stake: 1000 });
  close(big.expected, 9000);
  close(big.expectedNet, 9000 * 0.796, 1e-9);
  // At NT$5,000 or less nothing is withheld.
  close(evaluateSlip({ legs: [{ gameId: 1, odds: 2.5, fairChance: 1 }, { gameId: 2, odds: 2, fairChance: 1 }], sizes: [2], stake: 1000 }).expectedNet, 5000);
  const huge = evaluateSlip({ legs: Array.from({ length: 12 }, (_, i) => ({ gameId: i, odds: 10, fairChance: 1 })), sizes: [12], stake: 100 });
  assert.equal(huge.best, 20_000_000);
});

test('house take is 1 - 1 / overround, with a margin from the prices', () => {
  const at = p => 1 / (p * 1.15);
  const { take, margin } = houseTake([at(0.6), at(0.4)], [0.022, 0.022]);
  close(take, 1 - 1 / 1.15, 1e-12);
  // Every price 2.2% off moves the overround 2.2%: take moves 2.2% / 1.15.
  close(margin, 0.022 / 1.15, 1e-12);
  assert.equal(houseTake([2, 2]).take, 0);
});

test('every text key exists in both languages', async () => {
  globalThis.navigator ??= { language: 'en' };
  const { makeT } = await import('../public/lib/i18n.mjs');
  const { readFile } = await import('node:fs/promises');
  const src = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')) + (await readFile(new URL('../public/index.html', import.meta.url), 'utf8'));
  const keys = new Set([...src.matchAll(/t\('([A-Za-z0-9_]+)'/g), ...src.matchAll(/data-t="([A-Za-z0-9_]+)"/g)].map(m => m[1]));
  // Keys whose English text is the key itself.
  const same = new Set(['win', 'worst', 'f1']);
  for (const locale of ['zh', 'en']) {
    const t = makeT(locale);
    assert.deepEqual([...keys].filter(k => !same.has(k) && t(k) === k), [], locale);
  }
});

test('MLB total lines reproduce the lottery from one DraftKings line', () => {
  const am = a => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
  const devig = (o, u) => am(o) / (am(o) + am(u));
  const priced = lines => lines.map(l => [l.line, 1 / (l.over * 1.15), 1 / ((1 - l.over) * 1.15)]);
  // Cubs @ Red Sox, DraftKings 6.5 at -105/-115; lottery 5.5/6.5/7.5 (2026-09-25).
  const cubs = priced(lotteryTotalLines(6.5, devig(-105, -115)));
  const cubsReal = [[5.5, 1.53, 1.97], [6.5, 1.78, 1.72], [7.5, 2.2, 1.42]];
  // Mets @ Nationals, DraftKings 8 (whole) at -107/-112; lottery 6.5/7.5/8.5.
  const mets = priced(lotteryTotalLines(8, devig(-107, -112)));
  const metsReal = [[6.5, 1.38, 2.33], [7.5, 1.63, 1.87], [8.5, 1.87, 1.63]];
  for (const [est, real] of [[cubs, cubsReal], [mets, metsReal]]) {
    assert.deepEqual(est.map(l => l[0]), real.map(l => l[0]));
    for (let i = 0; i < 3; i++) for (const j of [1, 2]) assert.ok(Math.abs(est[i][j] - real[i][j]) / real[i][j] < 0.1, `${est[i]} vs ${real[i]}`);
  }
});

// Real lottery prices with DraftKings' lines for the same games (2026-09-25).
const fixture = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/lottery-mlb-2026-09-25.json', import.meta.url), 'utf8'));
const american = a => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
const devig2 = (a, b) => american(a) / (american(a) + american(b));
const lotteryChance = (a, b) => 1 / a / (1 / a + 1 / b);

test('the lottery prices every two-way MLB market at the same cut', () => {
  for (const g of fixture.games) {
    const markets = [g.ml, ...(g.totals || []).map(t => t.slice(1)), ...(g.spreads || []).map(t => t.slice(1))].filter(Boolean);
    for (const [a, b] of markets) close(1 / a + 1 / b, MLB_MARKET_OVERROUND, 0.02);
  }
});

test('MLB total lines: same lines as the lottery, prices within a few percent', () => {
  let err = 0;
  let n = 0;
  for (const g of fixture.games) {
    const [line, over, under] = g.draftKings.total;
    const est = lotteryTotalLines(line, devig2(over, under));
    if (g.totals.length === 3) assert.deepEqual(est.map(l => l.line), g.totals.map(t => t[0]), g.home);
    for (const [l, o, u] of g.totals) {
      const e = est.find(x => x.line === l);
      if (!e) continue;
      err += Math.abs(e.over - lotteryChance(o, u));
      n++;
    }
  }
  assert.ok(err / n < 0.015, `${err / n}`);
});

test('MLB run lines: the lottery shrinks DraftKings toward 50/50', () => {
  let err = 0;
  let n = 0;
  for (const g of fixture.games.filter(g => g.spreads)) {
    const [awayLine, awayOdds, homeOdds] = g.draftKings.runLine;
    const lines = lotteryRunLines(awayLine, devig2(awayOdds, homeOdds));
    for (const [line, a, h] of g.spreads) {
      const e = lines.find(x => x.awayLine === line);
      assert.ok(e, `${g.home} ${line}`);
      err += Math.abs(e.lottery - lotteryChance(a, h));
      n++;
    }
  }
  assert.ok(err / n < 0.012, `${err / n}`);
  // The underdog getting runs is the better deal: true chance above the priced one.
  const [dog] = lotteryRunLines(1.5, 0.64);
  assert.ok(dog.fair > dog.lottery);
});

test('the streaming crowd equals simulating everyone in full', () => {
  // The slow way: every player's whole path kept, exact percentiles.
  const pools = habitPools(examplePool());
  const weeks = 13;
  const perHabit = 400;
  const seed = 9;
  const stats = simulateCrowdStats({ pools, weeks, perHabit, seed });
  const players = [];
  HABITS.forEach((habit, h) => {
    for (let i = 0; i < perHabit; i++) players.push({ index: h * perHabit + i, ...simulateHabit({ habit, pools, weeks, random: playerRandom(seed, h * perHabit + i), seed }) });
  });
  // Totals match to the cent.
  close(stats.totals.staked, players.reduce((s, p) => s + p.staked, 0), 1e-6);
  close(stats.totals.net, players.reduce((s, p) => s + p.final, 0), 1e-6);
  assert.equal(stats.totals.aheadShare, players.filter(p => p.final > 0).length / players.length);
  // The highlighted players are the same people, replayed exactly.
  const byFinal = [...players].sort((a, b) => a.final - b.final);
  const at = q => byFinal[Math.round((byFinal.length - 1) * q)];
  for (const [key, q] of [['best', 0.9], ['median', 0.5], ['worst', 0.1]]) {
    assert.equal(stats.characters[key].final, at(q).final, key);
    assert.deepEqual([...stats.characters[key].path], [...at(q).path], key);
  }
  // Record holders too.
  assert.equal(stats.notable.best.final, byFinal.at(-1).final);
  assert.equal(stats.notable.worst.final, byFinal[0].final);
  // Weekly bands: within one histogram step of the exact percentiles.
  const step = (2 * (2500 * weeks + 20000)) / Math.min(20000, Math.floor(2_000_000 / weeks));
  for (let w = 0; w < weeks; w++) {
    const values = players.map(p => p.path[w]).sort((a, b) => a - b);
    for (const [k, q] of [['q10', 0.1], ['q50', 0.5], ['q90', 0.9]]) {
      const exact = values[Math.floor(q * (values.length - 1))];
      assert.ok(Math.abs(stats.bands[w][k] - exact) <= step, `week ${w} ${k}: ${stats.bands[w][k]} vs ${exact}`);
    }
    assert.equal(stats.bands[w].ahead, values.filter(v => v > 0).length);
  }
});

test('ticket analysis: exact figures, where the money goes, each leg, one short', async () => {
  const { analyzeSlip } = await import('../public/lib/odds.mjs');
  const legs = [
    { odds: 1.8, fairChance: 0.5 },
    { odds: 1.9, fairChance: 0.45 },
    { odds: 1.7, fairChance: 0.55 },
    { odds: 1.9, fairChance: 0.5 }
  ];
  const a = analyzeSlip({ legs, sizes: [2, 4], stake: 100 });
  const exact = evaluateSlip({ legs, sizes: [2, 4], stake: 100 });
  close(a.expectedNet, exact.expectedNet, 1e-9);
  close(a.paid, exact.anyPayout, 1e-12);
  close(a.profit, exact.profit, 1e-12);
  close(a.byHits.reduce((s, r) => s + r.chance, 0), 1, 1e-12);
  // Cut + tax + back = 100.
  close(a.per100.take + a.per100.tax + a.per100.back, 100, 1e-9);
  close(a.top.chance, 0.5 * 0.45 * 0.55 * 0.5, 1e-12);
  // The worst-value leg is the one priced furthest under its fair odds.
  assert.equal(a.weakest, 1);
  // Without the worst leg, the rest return more.
  assert.ok(a.legs[1].without > a.backPer100);

  // One short: exactly one pick lost.
  const one = legs.reduce((sum, _, i) => sum + legs.reduce((p, l, j) => p * (j === i ? 1 - l.fairChance : l.fairChance), 1), 0);
  close(a.nearMiss, one, 1e-12);
  close(a.lone[0], 0.5 * 0.45 * 0.55 * 0.5, 1e-12);
  close(a.nearMiss, a.byHits[3].chance, 1e-12);
});

test('the sport calendar has a realistic number of games per year', async () => {
  const { gamesInWeek, SPORTS } = await import('../public/lib/odds.mjs');
  const perYear = Object.fromEntries(SPORTS.map(s => [s, Array.from({ length: 52 }, (_, w) => gamesInWeek(s, w)).reduce((a, b) => a + b, 0)]));
  // MLB ~2,430 + postseason; Premier League 380; NBA 1,230 + playoffs; 24 F1 races.
  assert.ok(perYear.mlb > 2400 && perYear.mlb < 2650, `${perYear.mlb}`);
  assert.ok(perYear.epl > 360 && perYear.epl < 410, `${perYear.epl}`);
  assert.ok(perYear.nba > 1200 && perYear.nba < 1350, `${perYear.nba}`);
  assert.equal(perYear.f1, 24);
  // Seasons: no MLB in January, no Premier League or NBA in July.
  assert.equal(gamesInWeek('mlb', 2), 0);
  assert.equal(gamesInWeek('epl', 28), 0);
  assert.equal(gamesInWeek('nba', 28), 0);
});

test('the multi-sport crowd splits by fan type and replays players exactly', async () => {
  const { sportTemplate, FANS, SPORTS } = await import('../public/lib/odds.mjs');
  const sportPools = Object.fromEntries(SPORTS.map(s => [s, habitPools(sportTemplate(s))]));
  const stats = simulateCrowdStats({ sportPools, startWeek: 38, weeks: 26, perGroup: 60, seed: 3 });
  assert.equal(stats.players, 60 * HABITS.length * FANS.length);
  assert.equal(stats.fanSummaries.length, FANS.length);
  // F1 fans face the biggest cut: on average over several seasons (one season
  // has only ~24 real races, so it can go either way).
  let f1 = 0;
  let mlb = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const year = simulateCrowdStats({ sportPools, startWeek: 10, weeks: 52, perGroup: 30, seed });
    f1 += year.fanSummaries.find(f => f.fan.key === 'f1').back;
    mlb += year.fanSummaries.find(f => f.fan.key === 'mlb').back;
  }
  assert.ok(f1 < mlb, `${f1 / 6} vs ${mlb / 6}`);
  // Replaying a record holder gives the same person.
  const again = simulateCrowdStats({ sportPools, startWeek: 38, weeks: 26, perGroup: 60, seed: 3 });
  assert.equal(again.notable.best.serial, stats.notable.best.serial);
  assert.equal(again.notable.best.final, stats.notable.best.final);
  assert.deepEqual([...again.characters.median.path], [...stats.characters.median.path]);
});

test('one run gives every shorter period, and 3 years carries on from 1 year', async () => {
  const { simulateCrowd, sportTemplate, SPORTS } = await import('../public/lib/odds.mjs');
  const sportPools = Object.fromEntries(SPORTS.map(sp => [sp, habitPools(sportTemplate(sp))]));
  const base = { sportPools, startWeek: 38, perGroup: 40, seed: 9 };
  const strip = r => ({ ...r, bands: undefined });
  // Checkpoints inside one 52-week run = separate runs of 4 / 13 / 52 weeks.
  const year = simulateCrowd({ ...base, weeks: 52, checkpoints: [4, 13, 52] });
  for (const w of [4, 13, 52]) {
    const alone = simulateCrowdStats({ ...base, weeks: w });
    assert.deepEqual(strip(year.results[w]), strip(alone), `${w} weeks`);
    assert.equal(year.results[w].bands.length, w);
    for (let i = 0; i < w; i++) assert.equal(year.results[w].bands[i].ahead, alone.bands[i].ahead);
  }
  // 52 weeks then 104 more = 156 weeks straight.
  const longer = simulateCrowd({ ...base, weeks: 156, resume: year.resume }).results[156];
  const straight = simulateCrowdStats({ ...base, weeks: 156 });
  assert.deepEqual(strip(longer), strip(straight));
  assert.equal(longer.bands.length, 156);
  for (let i = 0; i < 156; i++) assert.equal(longer.bands[i].ahead, straight.bands[i].ahead);
});

test('ticket frequency matches surveys: about one ticket every two weeks for the median bettor', async () => {
  const { simulateCrowdStats, sportTemplate, SPORTS } = await import('../public/lib/odds.mjs');
  const sportPools = Object.fromEntries(SPORTS.map(sp => [sp, habitPools(sportTemplate(sp))]));
  const stats = simulateCrowdStats({ sportPools, startWeek: 10, weeks: 52, perGroup: 100, seed: 2 });
  const perMonth = stats.totals.tickets / stats.players / 12;
  // Hong Kong football bettors (HKU, 2021): median once every two weeks.
  assert.ok(perMonth > 1 && perMonth < 3.5, `${perMonth} tickets a month`);
});

test('every guide entry is a [title, text] pair in both languages', async () => {
  globalThis.navigator ??= { language: 'en' };
  const { makeT } = await import('../public/lib/i18n.mjs');
  for (const locale of ['zh', 'en']) {
    const t = makeT(locale);
    for (const [title, items] of [[t('guideMathTitle'), t('mathSteps')], ...t('guide')]) {
      assert.equal(typeof title, 'string');
      for (const item of items) assert.ok(Array.isArray(item) && item.length === 2 && item.every(x => typeof x === 'string'), `${locale} ${title}: ${JSON.stringify(item).slice(0, 60)}`);
    }
  }
});

test('any player can be replayed on their own, and groups add up', async () => {
  const { simulateCrowdStats, replayPlayer, sportTemplate, SPORTS } = await import('../public/lib/odds.mjs');
  const sportPools = Object.fromEntries(SPORTS.map(sp => [sp, habitPools(sportTemplate(sp))]));
  const opts = { sportPools, startWeek: 20, weeks: 26, perGroup: 30, seed: 5 };
  const stats = simulateCrowdStats(opts);
  for (const who of Object.values(stats.notable)) {
    const again = replayPlayer({ ...opts, index: who.serial - 1 });
    assert.equal(again.final, who.final);
    assert.equal(again.tickets, who.tickets);
    assert.equal(again.habit, who.habit);
  }
  assert.equal(stats.groupStats.length, 30);
  assert.equal(stats.groupStats.reduce((n, g) => n + g.players, 0), stats.players);
  for (const g of stats.groupStats) assert.ok(g.worst <= g.q10 && g.q10 <= g.median && g.median <= g.q90 && g.q90 <= g.best);
});

test('everyone bets into one world: a race has one winner for all', async () => {
  const { simulateCrowdStats, sportTemplate, estimateF1LotteryOdds, SPORTS } = await import('../public/lib/odds.mjs');
  // An F1 field with long shots, as the lottery prices it.
  const raw = [0.41, 0.22, 0.145, 0.115, 0.0555, 0.034, 0.0275, 0.0065, ...Array(14).fill(0.0015), 0.0025, 0.002, 0.0005];
  const sum = raw.reduce((a, b) => a + b);
  const f1 = raw.map((p, i) => ({ gameId: 'race', key: `f1|race|win|${i}`.replace(/\|\d+$/, ''), fairChance: p / sum, odds: estimateF1LotteryOdds(p / sum) }));
  const sportPools = Object.fromEntries(SPORTS.map(sp => [sp, habitPools(sp === 'f1' ? f1 : sportTemplate(sp))]));
  // Over many worlds, a 0.1-0.25% driver comes in rarely: the longest shot
  // anyone cashes in a season is usually a normal price.
  let longshotSeasons = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const stats = simulateCrowdStats({ sportPools, startWeek: 10, weeks: 52, perGroup: 40, seed });
    if (stats.notable.longshot.longshotOdds >= 300) longshotSeasons++;
  }
  // 24 races, each with ~2% combined chance for a 300+ driver: ~40% of seasons at most.
  assert.ok(longshotSeasons <= 5, `${longshotSeasons} of 8 seasons`);
});
