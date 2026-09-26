import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('F1 estimate matches the lottery board on race eve', () => {
  const { drivers } = JSON.parse(readFileSync(new URL('./fixtures/lottery-f1-2026-09-26.json', import.meta.url)));
  const fair = devigPower(drivers.map(d => d.polymarket));
  const priced = drivers.map((d, i) => ({ ...d, fair: fair[i], est: estimateF1LotteryOdds(fair[i]) })).filter(d => d.fair >= 0.01);
  assert.equal(priced.length, 8);
  const err = priced.reduce((s, d) => s + Math.abs(d.est - d.lottery) / d.lottery, 0) / priced.length;
  assert.ok(err < 0.11, `average error ${err}`);
  // The favourite: 1.20 on the board.
  close(priced[0].est, 1.2, 0.03);
  // Longshots sit on the lottery's fixed prices.
  assert.equal(estimateF1LotteryOdds(0.0064), 65);
  assert.equal(estimateF1LotteryOdds(0.0035), 275);
  assert.equal(estimateF1LotteryOdds(0.0005), 500);
  // A huge favourite never drops below the floor.
  assert.equal(estimateF1LotteryOdds(0.95), 1.05);
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

test('wider lines: team totals and run lines from the score model, odds never below 1.01', async () => {
  const { fitTeamRuns, scoreGrid, runLineCover, teamOverChance, estimateLineOdds, totalOverChance, fitTotalRuns } = await import('../public/lib/odds.mjs');
  const means = fitTeamRuns(0.58, 8.5, 0.5);
  const grid = scoreGrid(means.home, means.away);
  // The away underdog getting runs covers more often the more runs it gets.
  const covers = [-4.5, -3.5, -2.5, -1.5, 1.5, 2.5, 3.5, 4.5].map(l => runLineCover(grid, l));
  for (let i = 1; i < covers.length; i++) assert.ok(covers[i] > covers[i - 1]);
  // +1.5 for the away side and -1.5 for the home side are the same bet.
  close(runLineCover(grid, 1.5) + (1 - runLineCover(grid, 1.5)), 1);
  assert.ok(teamOverChance(means.home, 2.5) > teamOverChance(means.home, 5.5));
  const mu = fitTotalRuns(8.5, 0.5);
  close(totalOverChance(8.5, mu), 0.5, 0.01);
  // Near-certain lines still pay a bit; the usual lines are the usual price.
  assert.ok(estimateLineOdds(0.97, 1.158) >= 1.01);
  close(estimateLineOdds(0.5, 1.158), 1.73, 0.01);
});

