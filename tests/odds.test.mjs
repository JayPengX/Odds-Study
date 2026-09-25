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
  blendFairChance,
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

test('blendFairChance picks the right multiplier', () => {
  assert.deepEqual(blendFairChance(null, null), null);
  const both = blendFairChance(0.5, 0.52);
  close(both.fairChance, 0.51);
  assert.equal(both.k, K_BOTH);
  assert.equal(blendFairChance(null, 0.4).k, K_POLYMARKET);
});

test('simulation is reproducible and averages to the expected loss', () => {
  const a = simulateRuns({ fairChance: 0.5, odds: 1.8, bets: 50, runs: 2, random: seededRandom(7) });
  const b = simulateRuns({ fairChance: 0.5, odds: 1.8, bets: 50, runs: 2, random: seededRandom(7) });
  assert.deepEqual(a, b);
  const runs = simulateRuns({ fairChance: 0.5, odds: 1.8, bets: 2000, runs: 50, random: seededRandom(1) });
  const avgPerBet = runs.reduce((s, r) => s + r.at(-1), 0) / runs.length / 2000;
  close(avgPerBet, -10, 1.5);
});
