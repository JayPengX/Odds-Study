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
  simulateRuns,
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

test('simulation is reproducible and averages to the expected loss', () => {
  const a = simulateRuns({ fairChance: 0.5, odds: 1.8, bets: 50, runs: 2, random: seededRandom(7) });
  const b = simulateRuns({ fairChance: 0.5, odds: 1.8, bets: 50, runs: 2, random: seededRandom(7) });
  assert.deepEqual(a, b);
  const runs = simulateRuns({ fairChance: 0.5, odds: 1.8, bets: 2000, runs: 50, random: seededRandom(1) });
  const avgPerBet = runs.reduce((s, r) => s + r.at(-1), 0) / runs.length / 2000;
  close(avgPerBet, -10, 1.5);
});

test('chanceAhead matches a hand count and shrinks with more bets', async () => {
  const { chanceAhead } = await import('../public/lib/odds.mjs');
  // 1 bet: ahead only by winning.
  assert.ok(Math.abs(chanceAhead(0.5, 1.8, 1) - 0.5) < 1e-12);
  // 2 bets at 1.8: one win gives +80 - 100 = -20, so both must win.
  assert.ok(Math.abs(chanceAhead(0.5, 1.8, 2) - 0.25) < 1e-12);
  // Even odds at 2.0: exactly break-even isn't ahead.
  assert.ok(Math.abs(chanceAhead(0.5, 2, 2) - 0.25) < 1e-12);
  assert.ok(chanceAhead(0.5, 1.8, 1000) < chanceAhead(0.5, 1.8, 100));
  assert.ok(chanceAhead(0.5, 1.8, 10000) < 1e-6);
});

test('luckCrossover is where average loss equals typical luck', async () => {
  const { luckCrossover, chanceAhead } = await import('../public/lib/odds.mjs');
  // mean -0.1, sd 0.9 per unit -> (0.9 / 0.1)^2 = 81.
  assert.equal(luckCrossover(0.5, 1.8), 81);
  assert.equal(luckCrossover(0.5, 2.2), null);
  // Around the crossover roughly 1 in 6 players is still ahead.
  const p = chanceAhead(0.5, 1.8, 81);
  assert.ok(p > 0.1 && p < 0.25);
});

test('describeRun reads wins, peak, streaks and the biggest drop', async () => {
  const { describeRun } = await import('../public/lib/odds.mjs');
  // win, win, lose, lose, lose, win at odds 1.8
  const run = describeRun([80, 160, 60, -40, -140, -60]);
  assert.equal(run.wins, 3);
  assert.equal(run.peak, 160);
  assert.equal(run.peakAt, 1);
  assert.equal(run.longestLosing, 3);
  assert.equal(run.maxDrop, 300);
  assert.equal(run.everAhead, true);
  assert.equal(describeRun([-100, -200]).everAhead, false);
});
