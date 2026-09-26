import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { americanToProbability, devigProportional } from '../public/lib/odds.mjs';
import { inningsLeft, liveBaseball, liveMarkets, liveOdds, pregameRuns, chance, fitGoals, liveSoccer, LIVE_OVERROUND } from '../public/lib/live.mjs';
import { parseInning, parseEspnLive, parsePregameLines } from '../public/lib/sources.mjs';

const snap = JSON.parse(readFileSync(new URL('./fixtures/lottery-live-2026-09-26.json', import.meta.url)));

test('innings left from the live state', () => {
  assert.deepEqual(inningsLeft({ inning: 4, half: 'mid' }), { away: 5, home: 6 });
  assert.deepEqual(inningsLeft({ inning: 4, half: 'top', outs: 1 }), { away: 6 - 1 / 3, home: 6 });
  assert.deepEqual(inningsLeft({ inning: 9, half: 'end' }), { away: 0, home: 0 });
  assert.deepEqual(parseInning('Rain Delay, Top 1st', 1), { inning: 1, half: 'top' });
  assert.deepEqual(parseInning('Mid 4th', 4), { inning: 4, half: 'mid' });
});

test('the live model posts the lottery\'s lines and lands near its prices', () => {
  const p = snap.pregame;
  const [away, home] = devigProportional([americanToProbability(p.awayMoneyline), americanToProbability(p.homeMoneyline)]);
  const [over] = devigProportional([americanToProbability(p.overOdds), americanToProbability(p.underOdds)]);
  const means = pregameRuns({ homeWin: home, totalLine: p.total, overFair: over });
  assert.ok(away < 0.5);
  const left = inningsLeft(snap.state);
  const dist = liveBaseball({ means, awayScore: 5, homeScore: 2, awayLeft: left.away, homeLeft: left.home });
  assert.ok(Math.abs(dist.reduce((s, x) => s + x.p, 0) - 1) < 1e-6);
  const markets = liveMarkets(dist, { sport: 'mlb', awayScore: 5, homeScore: 2, pm: { awayWin: snap.polymarketAwayWin } });
  const posted = kind => markets.filter(m => m.kind === kind && m.posted);
  // The same lines the lottery posted: total 11.5, CIN -2.5.
  assert.equal(posted('total')[0].line, snap.lottery.total.line);
  assert.equal(posted('runline')[0].giver, 'away');
  assert.equal(posted('runline')[0].awayLine, -snap.lottery.runline.line);
  const L = snap.lottery;
  const pairs = [
    [liveOdds(posted('ml').find(m => m.side === 'away').fair), L.ml.away],
    [liveOdds(posted('ml').find(m => m.side === 'home').fair), L.ml.home],
    [liveOdds(posted('total').find(m => m.side === 'over').fair), L.total.over],
    [liveOdds(posted('total').find(m => m.side === 'under').fair), L.total.under],
    [liveOdds(posted('runline').find(m => m.side === 'away').fair), L.runline.giverOdds],
    [liveOdds(posted('runline').find(m => m.side === 'home').fair), L.runline.takerOdds]
  ];
  const err = pairs.reduce((s, [est, real]) => s + Math.abs(est - real) / real, 0) / pairs.length;
  assert.ok(err < 0.08, `average error ${err} ${JSON.stringify(pairs)}`);
  // The lottery's live cut is its usual one.
  for (const book of [[L.ml.away, L.ml.home], [L.total.over, L.total.under], [L.runline.giverOdds, L.runline.takerOdds]]) {
    assert.ok(Math.abs(book.reduce((s, o) => s + 1 / o, 0) - LIVE_OVERROUND) < 0.02);
  }
});

test('a finished game is certain; soccer goals scale with the minutes left', () => {
  const dist = liveBaseball({ means: { home: 4.5, away: 4 }, awayScore: 3, homeScore: 1, awayLeft: 0, homeLeft: 0 });
  assert.equal(chance(dist, (a, h) => a > h), 1);
  const means = fitGoals(0.45, 0.28);
  const full = liveSoccer({ means, awayScore: 0, homeScore: 0, minutesLeft: 90 });
  const homeWin = chance(full, (a, h) => h > a);
  const draw = chance(full, (a, h) => h === a);
  assert.ok(Math.abs(homeWin - 0.45) < 0.03, homeWin);
  assert.ok(Math.abs(draw - 0.27) < 0.03, draw);
  const late = liveSoccer({ means, awayScore: 0, homeScore: 1, minutesLeft: 5 });
  assert.ok(chance(late, (a, h) => h > a) > 0.85);
});

test('ESPN live games and pregame lines', () => {
  const board = { events: [
    { id: '1', date: '2026-09-25T23:07Z', competitions: [{ status: { period: 4, displayClock: '0:00', type: { state: 'in', shortDetail: 'Bot 4th' } }, situation: { outs: 1 }, competitors: [
      { homeAway: 'home', score: '2', team: { displayName: 'Toronto Blue Jays' } },
      { homeAway: 'away', score: '5', team: { displayName: 'Cincinnati Reds' } }
    ] }] },
    { id: '2', date: '2026-09-25T23:07Z', competitions: [{ status: { type: { state: 'post' } }, competitors: [] }] }
  ] };
  const [game] = parseEspnLive(board, 'mlb');
  assert.equal(game.half, 'bottom');
  assert.equal(game.outs, 1);
  assert.equal(game.awayScore, 5);
  const lines = parsePregameLines({ pickcenter: [{ overUnder: 7.5, overOdds: -114, underOdds: -105, homeTeamOdds: { moneyLine: -174 }, awayTeamOdds: { moneyLine: 143 } }] });
  assert.equal(lines.totalLine, 7.5);
  assert.ok(lines.homeWin > 0.6);
  const soccer = parsePregameLines({ pickcenter: [{ overUnder: 2.5, overOdds: -170, underOdds: 135, homeTeamOdds: { moneyLine: 215 }, awayTeamOdds: { moneyLine: 115 }, drawOdds: { moneyLine: 270 } }] });
  assert.ok(Math.abs(soccer.homeWin + soccer.draw + soccer.awayWin - 1) < 1e-9);
  assert.ok(soccer.draw > 0.2);
});
