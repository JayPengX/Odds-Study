import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsModel, pointsMarkets, goalMarkets, fitHockey, baseballMarkets, marketOdds, normalCdf, normalQuantile, CUT } from '../public/lib/markets.mjs';
import { fitGoals } from '../public/lib/live.mjs';
import { legResult } from '../public/lib/account.mjs';

const sum = picks => picks.reduce((s, p) => s + p.fair, 0);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('normal helpers', () => {
  close(normalCdf(0), 0.5, 1e-6);
  close(normalQuantile(normalCdf(1.3)), 1.3, 1e-4);
});

test('football: the model reproduces DraftKings spread and total, and every market adds up', () => {
  // Chargers +7.5 at 50/50, total 49.5 at 50/50.
  const m = pointsModel('nfl', { homeWin: 0.72, spread: { awayLine: 7.5, awayFair: 0.5 }, total: { line: 49.5, overFair: 0.5 } });
  close(m.margin, 7.5, 1e-6);
  close(m.total, 49.5, 1e-6);
  const markets = pointsMarkets(m, { spreadLine: 7.5, totalLine: 49.5 });
  const main = markets.find(x => x.kind === 'runline' && x.posted);
  close(main.picks[0].fair, 0.5, 1e-6);
  for (const x of markets) close(sum(x.picks), 1, 1e-6);
  const margin = markets.find(x => x.kind === 'margin');
  assert.equal(margin.picks.length, 8);
  // Two-way odds carry the lottery's two-way cut.
  const total = markets.find(x => x.kind === 'total' && x.posted);
  close(1 / marketOdds(total, total.picks[0].fair) + 1 / marketOdds(total, total.picks[1].fair), CUT.twoWay, 0.01);
});

test('soccer and hockey goal markets', () => {
  const means = fitGoals(0.45, 0.28);
  const markets = goalMarkets(means, { family: 'soccer' });
  for (const x of markets) close(sum(x.picks), 1, 1e-6);
  const score = markets.find(x => x.kind === 'score');
  assert.equal(score.picks.at(-1).side, 'other');
  // Correct score is a many-outcome market: its odds add up to the bigger cut.
  const book = score.picks.reduce((s, p) => s + 1 / marketOdds(score, p.fair), 0);
  assert.ok(book > 1.4 && book < 1.6, book);
  const hockey = goalMarkets(fitHockey(0.58, { line: 5.5, overFair: 0.5 }), { family: 'hockey', totalLine: 5.5 });
  assert.ok(hockey.some(x => x.kind === 'regulation'));
  close(hockey.find(x => x.kind === 'total' && x.posted).picks[0].fair, 0.5, 0.02);
});

test('baseball extras', () => {
  const markets = baseballMarkets({ homeWin: 0.55, total: { line: 8.5, overFair: 0.5 } });
  for (const x of markets) close(sum(x.picks), 1, 1e-3);
  const yrfi = markets.find(x => x.kind === 'firstinning');
  // A run in the first inning happens in roughly half of MLB games.
  assert.ok(yrfi.picks[0].fair > 0.4 && yrfi.picks[0].fair < 0.6, yrfi.picks[0].fair);
});

test('new kinds of picks settle from the final score and periods', () => {
  const final = { status: 'final', awayScore: 21, homeScore: 27, awayInnings: [7, 7, 0, 7], homeInnings: [3, 10, 7, 7] };
  assert.equal(legResult({ kind: 'oddeven', side: 'even' }, final), 'won');
  assert.equal(legResult({ kind: 'margin', team: 'home', lo: 1, hi: 6 }, final), 'won');
  assert.equal(legResult({ kind: 'margin', team: 'home', lo: 7, hi: 12 }, final), 'lost');
  // First half 14-13 to the away side.
  assert.equal(legResult({ kind: 'half', sport: 'nfl', side: 'away' }, final), 'won');
  const soccer = { status: 'final', awayScore: 1, homeScore: 2, awayInnings: [1, 0], homeInnings: [0, 2] };
  assert.equal(legResult({ kind: 'btts', side: 'yes' }, soccer), 'won');
  assert.equal(legResult({ kind: 'score', score: '2-1', listed: ['2-1'] }, soccer), 'won');
  assert.equal(legResult({ kind: 'score', score: 'other', listed: ['2-1'] }, soccer), 'lost');
  assert.equal(legResult({ kind: 'half', sport: 'mls', side: 'away' }, soccer), 'won');
  const baseball = { status: 'final', awayScore: 3, homeScore: 5, awayInnings: [0, 1, 0, 0, 2], homeInnings: [1, 0, 0, 0, 0, 4] };
  assert.equal(legResult({ kind: 'firstinning', side: 'yes' }, baseball), 'won');
  assert.equal(legResult({ kind: 'f5', side: 'away' }, baseball), 'won');
  const hockey = { status: 'final', awayScore: 3, homeScore: 2, awayInnings: [1, 0, 1, 1], homeInnings: [0, 2, 0, 0] };
  assert.equal(legResult({ kind: 'regulation', side: 'draw' }, hockey), 'won');
});
