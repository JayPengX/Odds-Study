import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { houseRule, minLegsProblem, houseCut, BASE_CUT, leagueTier } from '../public/lib/rules.mjs';
import { recommend } from '../public/lib/recommend.mjs';
import { slipErrors, estimateF1LotteryOdds, f1Phase } from '../public/lib/odds.mjs';
import { parseKambiEvents, parseKambiLive, decidedFromLive, setsWon } from '../public/lib/kambi.mjs';
import { setsMarkets, matchChance, setChance, goalMarkets } from '../public/lib/markets.mjs';
import { legResult } from '../public/lib/account.mjs';
import { parseEspnTennis, parseF1Schedule, parseFutures, EXTRA_FUTURES, futureTeamName } from '../public/lib/sources.mjs';
import { LEAGUES } from '../public/lib/teams.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('the house locks very short and very long prices, and sells short ones only in parlays', () => {
  assert.deepEqual(houseRule('ml', 1.04), { lock: 'low', minLegs: 1 });
  assert.deepEqual(houseRule('ml', 1.1), { lock: null, minLegs: 3 });
  assert.deepEqual(houseRule('ml', 1.25), { lock: null, minLegs: 2 });
  assert.deepEqual(houseRule('ml', 1.9), { lock: null, minLegs: 1 });
  assert.deepEqual(houseRule('ml', 9), { lock: 'high', minLegs: 1 });
  // Many-outcome markets stay open further out; F1 and championships never lock.
  assert.deepEqual(houseRule('score', 40), { lock: null, minLegs: 1 });
  assert.deepEqual(houseRule('score', 90), { lock: 'high', minLegs: 1 });
  assert.deepEqual(houseRule('f1', 500), { lock: null, minLegs: 1 });
  // Every combination on the ticket must be big enough for its legs.
  assert.equal(minLegsProblem([{ minLegs: 1 }, { minLegs: 2 }], [2]), 0);
  assert.equal(minLegsProblem([{ minLegs: 1 }, { minLegs: 3 }], [2]), 3);
  assert.equal(minLegsProblem([{ minLegs: 2 }], [1]), 2);
  const legs = [{ gameId: 1, odds: 1.2, minLegs: 2 }, { gameId: 2, odds: 1.9, minLegs: 1 }];
  assert.ok(slipErrors({ mode: 'single', legs, sizes: [1], stake: 100 }).includes('minLegs'));
  assert.ok(!slipErrors({ mode: 'parlay', legs, sizes: [2], stake: 100 }).includes('minLegs'));
  assert.ok(slipErrors({ mode: 'parlay', legs: [...legs, { gameId: 3, odds: 12, lock: 'high' }], sizes: [3], stake: 100 }).includes('locked'));
});

test('the house cut grows with its risk, from the measured one', () => {
  // A big league, sources agreeing as usual: exactly the measured cut.
  close(houseCut({ base: 'twoWay', sport: 'mlb' }), BASE_CUT.twoWay);
  close(houseCut({ base: 1.151, sport: 'mlb', fairMargin: 0.01 }), 1.151);
  // Less-known leagues, disagreeing sources and far lines cost more.
  assert.equal(leagueTier('cpbl'), 'thin');
  assert.ok(houseCut({ sport: 'cpbl' }) > houseCut({ sport: 'mls' }));
  assert.ok(houseCut({ sport: 'mls' }) > houseCut({ sport: 'mlb' }));
  assert.ok(houseCut({ sport: 'mlb', fairMargin: 0.04 }) > houseCut({ sport: 'mlb', fairMargin: 0.01 }));
  assert.ok(houseCut({ sport: 'mlb', steps: 3 }) > houseCut({ sport: 'mlb', steps: 1 }));
  // Never more than 8% over the base.
  assert.ok(houseCut({ sport: 'tennis', fairMargin: 0.5, steps: 10 }) <= BASE_CUT.twoWay * 1.08 + 1e-9);
});

test('recommendations: tagged on single picks, never on locked or near-certain ones', () => {
  const bets = Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, fairChance: 0.2 + (i % 10) * 0.07, estOdds: 1 / ((0.2 + (i % 10) * 0.07) * (1.1 + (i % 7) * 0.02)) }));
  bets.push({ id: 'locked', fairChance: 0.5, estOdds: 2.5, lock: 'high' }, { id: 'sure', fairChance: 0.95, estOdds: 1.05 });
  const recs = recommend(bets);
  assert.ok(recs.size > 0);
  assert.ok(!recs.has('locked') && !recs.has('sure'));
  for (const [id, r] of recs) {
    const b = bets.find(x => x.id === id);
    if (r.tag === 'steady') assert.ok(b.fairChance >= 0.65);
    if (r.tag === 'shot') assert.ok(b.fairChance <= 0.3);
    assert.ok(r.beats >= 0 && r.beats <= 1);
  }
  // The best return of the lot is always tagged 划算.
  const best = [...bets].filter(b => !b.lock && b.fairChance <= 0.85).sort((a, b) => b.fairChance * b.estOdds - a.fairChance * a.estOdds)[0];
  assert.equal(recs.get(best.id).tag, 'value');
  assert.equal(recommend(bets.slice(0, 5)).size, 0);
});

test('Kambi odds become games with the margin removed, and live scores settle decided matches', () => {
  const games = parseKambiEvents(fixture('kambi-atp-2026-09-26.json'), 'tennis', new Date('2026-09-26T00:00:00Z'));
  assert.ok(games.length >= 3);
  for (const g of games) {
    close(g.draftKings.home + g.draftKings.away, 1);
    assert.equal(g.book, 'kambi');
    assert.ok(g.kambiId > 0);
  }
  const first = games[0];
  assert.equal(first.home.en, 'Juan Manuel Cerundolo');
  assert.equal(first.total.line, 22.5);
  assert.ok(first.spread.awayLine === -1.5 && first.spread.awayFair > 0.5);
  // Nothing already started, and a busy league keeps only the next few.
  assert.equal(parseKambiEvents(fixture('kambi-atp-2026-09-26.json'), 'tennis', new Date('2027-01-01T00:00:00Z')).length, 0);
  assert.equal(parseKambiEvents(fixture('kambi-atp-2026-09-26.json'), 'tennis', new Date('2026-09-26T00:00:00Z'), 2).length, 2);

  const live = parseKambiLive(fixture('kambi-live-2026-09-26.json'));
  assert.ok(live.size > 0);
  // Table tennis to 11, best of 5: 3 sets won decides it.
  const tt = LEAGUES.tabletennis.sets;
  assert.deepEqual(setsWon({ home: [11, 9, 11, 5], away: [9, 11, 7, 11] }, tt), { home: 2, away: 2 });
  assert.equal(decidedFromLive({ sets: { home: [11, 9, 11, 5], away: [9, 11, 7, 11] } }, 'tabletennis'), null);
  assert.deepEqual(decidedFromLive({ sets: { home: [11, 9, 11, 5, 11], away: [9, 11, 7, 11, 8] } }, 'tabletennis'), { status: 'final', homeScore: 3, awayScore: 2, homeSets: [11, 9, 11, 5, 11], awaySets: [9, 11, 7, 11, 8] });
  // Volleyball to 25, the fifth to 15; an unfinished set doesn't count.
  const vb = LEAGUES.volleyball.sets;
  assert.deepEqual(setsWon({ home: [25, 22, 25, 20, 15], away: [20, 25, 23, 25, 13] }, vb), { home: 3, away: 2 });
  assert.deepEqual(setsWon({ home: [25, 12], away: [20, 10] }, vb), { home: 1, away: 0 });
  // Tennis: 6 games two clear, or 7 (a tiebreak).
  assert.deepEqual(setsWon({ home: [6, 6, 7], away: [4, 7, 6] }, LEAGUES.tennis.sets), { home: 2, away: 1 });
});

test('matches in sets: set chances, correct set scores, totals and handicaps', () => {
  for (const bestOf of [3, 5]) {
    const q = setChance(0.7, bestOf);
    close(matchChance(q, bestOf), 0.7, 1e-6);
    const markets = setsMarkets({ homeWin: 0.7, bestOf });
    for (const m of markets) close(m.picks.reduce((s, p) => s + p.fair, 0), 1, 1e-9);
    const sets = markets.find(m => m.kind === 'sets');
    close(sets.picks.filter(p => Number(p.score.split('-')[0]) > Number(p.score.split('-')[1])).reduce((s, p) => s + p.fair, 0), 0.7, 1e-6);
    assert.ok(markets.some(m => m.kind === 'totalsets') && markets.some(m => m.kind === 'firstset'));
  }
  // Settled from the sets won and each set's score.
  const outcome = { status: 'final', homeScore: 2, awayScore: 1, homeSets: [6, 4, 6], awaySets: [3, 6, 4] };
  assert.equal(legResult({ kind: 'sets', score: '2-1' }, outcome), 'won');
  assert.equal(legResult({ kind: 'sets', score: '2-0' }, outcome), 'lost');
  assert.equal(legResult({ kind: 'totalsets', side: 'over', line: 2.5 }, outcome), 'won');
  assert.equal(legResult({ kind: 'sethcap', side: 'home', line: -1.5 }, outcome), 'lost');
  assert.equal(legResult({ kind: 'firstset', side: 'home' }, outcome), 'won');
  assert.equal(legResult({ kind: 'gametotal', side: 'over', line: 28.5 }, outcome), 'won');
  assert.equal(legResult({ kind: 'gamehcap', side: 'away', line: 3.5 }, outcome), 'won');
  assert.equal(legResult({ kind: 'ml', side: 'home' }, outcome), 'won');
});

test('new soccer plays: half-time/full-time and total-goal bands add up and settle', () => {
  const markets = goalMarkets({ home: 1.5, away: 1.1 }, { family: 'soccer' });
  for (const kind of ['htft', 'goalbands']) close(markets.find(m => m.kind === kind).picks.reduce((s, p) => s + p.fair, 0), 1, 1e-6);
  const final = { status: 'final', awayScore: 1, homeScore: 2, awayInnings: [1, 0], homeInnings: [0, 2] };
  assert.equal(legResult({ kind: 'htft', ht: 'away', ft: 'home' }, final), 'won');
  assert.equal(legResult({ kind: 'htft', ht: 'draw', ft: 'home' }, final), 'lost');
  assert.equal(legResult({ kind: 'goalbands', lo: 2, hi: 3 }, final), 'won');
  assert.equal(legResult({ kind: 'goalbands', lo: 4, hi: 6 }, final), 'lost');
  assert.equal(legResult({ kind: 'q1', side: 'draw', sport: 'nba' }, { status: 'final', awayScore: 100, homeScore: 98, awayInnings: [25, 30], homeInnings: [25, 20] }), 'won');
});

test('F1: before qualifying the lottery prices on its own curve', () => {
  // The lottery's board the morning before qualifying (2026 Azerbaijan GP).
  const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
  near(estimateF1LotteryOdds(0.4081, 'pre'), 1.86, 0.01);
  near(estimateF1LotteryOdds(0.041, 'pre'), 9.1, 0.1);
  near(estimateF1LotteryOdds(0.0287, 'pre'), 11.67, 0.01);
  assert.equal(estimateF1LotteryOdds(0.0064, 'pre'), 65);
  assert.equal(estimateF1LotteryOdds(0.0025, 'pre'), 325);
  assert.equal(estimateF1LotteryOdds(0.0005, 'pre'), 500);
  // After qualifying, the race-eve curve (the default).
  assert.equal(estimateF1LotteryOdds(0.0035), 275);
  // The phase from ESPN's schedule: qualifying 12:00 UTC on the 25th.
  const schedule = parseF1Schedule(fixture('espn-f1-2026-09-26.json'), '2026-09-26T11:00:00Z');
  assert.equal(schedule.qualifyingUtc, '2026-09-25T12:00:00.000Z');
  assert.equal(f1Phase('2026-09-25T07:00:00Z', schedule), 'pre');
  assert.equal(f1Phase('2026-09-25T14:00:00Z', schedule), 'post');
  // Without a schedule: more than 21 hours before the race counts as before qualifying.
  assert.equal(f1Phase('2026-09-24T12:00:00Z', { raceUtc: '2026-09-26T11:00:00Z' }), 'pre');
  assert.equal(f1Phase('2026-09-26T00:00:00Z', { raceUtc: '2026-09-26T11:00:00Z' }), 'post');
});

test('more championships: any Polymarket winner market, named by its short name', () => {
  const constructors = EXTRA_FUTURES.find(f => f.key === 'f1constructors');
  const [market] = parseFutures(fixture('polymarket-constructors-2026-09-26.json').events, 'f1', [constructors]);
  assert.equal(market.key, 'f1constructors');
  close(market.teams.reduce((s, t) => s + t.fair, 0), 1, 1e-9);
  assert.equal(market.teams[0].name.en, 'Mercedes');
  assert.equal(futureTeamName({ question: 'Will the Anaheim Ducks be named the 2026-27 NHL Stanley Cup Champion?' }), 'Anaheim Ducks');
  assert.equal(futureTeamName({ question: 'Will the Dodgers win the 2026 World Series?' }), 'Dodgers');
});

test('tennis results from ESPN, whichever side each player is on', () => {
  const data = fixture('espn-tennis-2026-09-25.json');
  const result = parseEspnTennis(data, 'Alexandre Muller', 'Luka Pavlovic');
  assert.deepEqual(result, { status: 'final', homeScore: 2, awayScore: 1, homeSets: [6, 6, 6], awaySets: [4, 7, 3] });
  const flipped = parseEspnTennis(data, 'Luka Pavlovic', 'Alexandre Muller');
  assert.deepEqual([flipped.homeScore, flipped.awayScore], [1, 2]);
  assert.equal(parseEspnTennis(data, 'Nobody', 'Someone'), null);
});

test('every match gets a full set of plays', async () => {
  const { gameOptions } = await import('../public/lib/board.mjs');
  const kinds = game => new Set(gameOptions(game).map(o => o.kind));
  const has = (game, list) => {
    const got = kinds(game);
    for (const k of list) assert.ok(got.has(k), `${game.sport} missing ${k}`);
  };
  // A table-tennis match with no bookmaker lines still gets point lines.
  has({ id: 'tt', sport: 'tabletennis', draftKings: { home: 0.6, away: 0.4 } }, ['ml', 'firstset', 'sets', 'totalsets', 'sethcap', 'gamehcap', 'gametotal']);
  // Snooker: the match length guessed from the frame total, then frame score and first frame.
  has({ id: 'sn', sport: 'snooker', draftKings: { home: 0.6, away: 0.4 }, total: { line: 8.5, overFair: 0.5 }, spread: { awayLine: 1.5, awayFair: 0.55 } }, ['sets', 'firstset', 'gamehcap', 'gametotal']);
  // Soccer: team totals, first-half total and double chance.
  has({ id: 'so', sport: 'epl', draftKings: { home: 0.45, draw: 0.27, away: 0.28 }, total: { line: 2.5, overFair: 0.5 } }, ['teamtotal', 'htotal', 'dc', 'htft', 'goalbands']);
  // Basketball: team totals and a first-half total.
  has({ id: 'bb', sport: 'nba', draftKings: { home: 0.6, away: 0.4 }, spread: { awayLine: 3.5, awayFair: 0.5 }, total: { line: 224.5, overFair: 0.5 } }, ['teamtotal', 'htotal', 'q1', 'margin']);
  // Every baseball league has the top-scoring inning.
  has({ id: 'np', sport: 'npb', draftKings: { home: 0.55, away: 0.45 }, total: { line: 7.5, overFair: 0.5 } }, ['inning', 'teamtotal', 'f5']);
  // Nothing ever pays back less than the stake.
  const heavy = gameOptions({ id: 'h', sport: 'ncaaf', draftKings: { home: 0.96, away: 0.04 }, spread: { awayLine: 24.5, awayFair: 0.5 }, total: { line: 52.5, overFair: 0.5 } });
  assert.ok(heavy.every(o => o.estOdds >= 1.01), 'odds under 1.01');
});

test('model lines agree with the bookmaker\'s own line', async () => {
  const { unitModel, unitLineMarkets } = await import('../public/lib/markets.mjs');
  const spec = LEAGUES.tennis.sets;
  const model = unitModel({ homeWin: 0.7, bestOf: 3, spec });
  close(model.total.reduce((a, b) => a + b, 0), 1, 1e-6);
  close(model.diff.reduce((a, b) => a + b, 0), 1, 1e-6);
  const total = { line: 22.5, overFair: 0.5 };
  const lines = unitLineMarkets(model, { total, spec }).filter(m => m.kind === 'gametotal');
  // Lines either side of the bookmaker's, over less likely the higher the line.
  const overs = lines.sort((a, b) => a.line - b.line).map(m => m.picks[0].fair);
  assert.ok(lines.every(m => m.line !== 22.5));
  assert.ok(overs.every((p, i) => i === 0 || p <= overs[i - 1]));
  assert.ok(overs[0] > 0.5 && overs.at(-1) < 0.5);
});

test('double chance, first-half total and podium settle', () => {
  const game = { status: 'final', awayScore: 1, homeScore: 1, awayInnings: [1, 0], homeInnings: [0, 1] };
  assert.equal(legResult({ kind: 'dc', side: 'home|draw' }, game), 'won');
  assert.equal(legResult({ kind: 'dc', side: 'home|away' }, game), 'lost');
  assert.equal(legResult({ kind: 'htotal', sport: 'epl', side: 'over', line: 0.5 }, game), 'won');
  assert.equal(legResult({ kind: 'htotal', sport: 'epl', side: 'under', line: 0.5 }, game), 'lost');
  const race = { status: 'final', winner: 'Max Verstappen', podium: ['Max Verstappen', 'Lando Norris', 'Oscar Piastri'] };
  assert.equal(legResult({ kind: 'f1podium', driver: 'Oscar Piastri' }, race), 'won');
  assert.equal(legResult({ kind: 'f1podium', driver: 'Charles Leclerc' }, race), 'lost');
});

test('F1 podium chances add up to three and pay what the winner board does', async () => {
  const { f1Podium } = await import('../public/lib/board.mjs');
  const fair = [0.4, 0.25, 0.15, 0.1, 0.05, 0.03, 0.02];
  const drivers = fair.map(p => ({ fair: p, odds: estimateF1LotteryOdds(p) }));
  const podium = f1Podium(drivers);
  close(podium.reduce((s, p) => s + p.fair, 0), 3, 0.01);
  assert.ok(podium.every((p, i) => p.fair >= fair[i] && p.odds >= 1.01));
  assert.ok(podium[0].odds < podium.at(-1).odds);
});
