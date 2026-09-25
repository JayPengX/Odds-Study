import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToProbability,
  devigTwoWay,
  devigPower,
  estimateLotteryOdds,
  estimateF1LotteryOdds,
  expectedReturn,
  overround,
  combineParlay,
  blendOutcomes,
  devigProportional,
  HABITS,
  habitPools,
  simulateHabit,
  summarizeHabit,
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
  assert.ok(a.wonTickets <= a.tickets && a.staked >= a.tickets * 100);
  assert.equal(a.everAhead, a.peak > 0);
});

test('the chaser doubles after a losing week and stays under the cap', () => {
  const pools = habitPools(examplePool());
  const run = simulateHabit({ habit: habit('chaser'), pools, weeks: 156, random: seededRandom(2) });
  assert.ok(run.maxStake > 100 && run.maxStake <= 3200);
  assert.ok([100, 200, 400, 800, 1600, 3200].includes(run.maxStake));
});

test('each extra parlay leg takes the cut again', () => {
  const pools = habitPools(examplePool());
  const back = key => summarizeHabit({ habit: habit(key), pools, weeks: 52, players: 400, random: seededRandom(1) }).back;
  // 2 legs: (1 / 1.15)^2 = 75.6; 4-6 legs: about 50.
  close(back('casual'), 75.6, 5);
  const dreamer = back('dreamer');
  assert.ok(dreamer > 40 && dreamer < 62, `${dreamer}`);
});
