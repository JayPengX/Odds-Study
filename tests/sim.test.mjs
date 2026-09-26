import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateLotteryOdds, estimateF1LotteryOdds, SLIP_RULES } from '../public/lib/odds.mjs';
import {
  simulateCrowd,
  simulateCrowdStats,
  simulatePerson,
  replayPlayer,
  crowdPools,
  crowdSize,
  sportTemplate,
  gamesInWeek,
  personOf,
  traitKeys,
  TRAITS,
  TRAIT_BIT,
  TRAIT_ROWS,
  STYLES,
  SPORTS,
  SIM_SPORTS,
  FANS,
  LEADERBOARDS,
  LEADER_SIZE,
  surplusOf,
  SIM_START_BALANCE,
  SIM_WEEKLY_GRANT
} from '../public/lib/sim.mjs';
import { ticketProfile } from '../public/lib/profile.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// 10 games, two sides each, every price at the lottery's two-way cut.
function examplePool() {
  const pool = [];
  for (let g = 0; g < 10; g++) {
    const p = 0.3 + g * 0.04;
    [p, 1 - p].forEach((q, i) => pool.push({ gameId: g, kind: 'ml', fairChance: q, odds: estimateLotteryOdds(q, 1.158), outLo: i ? p : 0, outHi: i ? 1 : p }));
  }
  return pool;
}
const templatePools = () => Object.fromEntries(SPORTS.map(sp => [sp, crowdPools(sportTemplate(sp))]));

test('the streaming crowd equals replaying everyone in full', () => {
  const pools = crowdPools(examplePool());
  const opts = { pools, weeks: 13, perGroup: 60, seed: 9 };
  const stats = simulateCrowdStats(opts);
  const people = Array.from({ length: stats.players }, (_, index) => replayPlayer({ ...opts, index }));
  close(stats.totals.staked, people.reduce((s, p) => s + p.staked, 0));
  close(stats.totals.net, people.reduce((s, p) => s + p.final, 0));
  assert.equal(stats.totals.tickets, people.reduce((s, p) => s + p.tickets, 0));
  assert.equal(stats.totals.aheadShare, people.filter(p => p.final > 0).length / people.length);
  // The highlighted people are the same people, replayed exactly.
  const byFinal = [...people].sort((a, b) => a.final - b.final);
  assert.equal(stats.characters.median.final, byFinal[Math.round((byFinal.length - 1) * 0.5)].final);
  assert.equal(stats.notable.best.final, byFinal.at(-1).final);
  assert.equal(stats.notable.worst.final, byFinal[0].final);
  // Weekly bands: within one histogram step of the exact percentiles.
  const low = SIM_START_BALANCE + SIM_WEEKLY_GRANT * 13 + 1000;
  const step = (3 * low) / Math.min(20000, Math.floor(2_000_000 / 13));
  for (let w = 0; w < 13; w++) {
    const values = people.map(p => p.path[w]).sort((a, b) => a - b);
    const exact = values[Math.floor(0.5 * (values.length - 1))];
    assert.ok(Math.abs(stats.bands[w].q50 - exact) <= step, `week ${w}`);
    assert.equal(stats.bands[w].ahead, values.filter(v => v > 0).length);
  }
});

test('people are combinations of traits, drawn at their shares, one per group at most', () => {
  const stats = simulateCrowdStats({ sportPools: templatePools(), startWeek: 10, weeks: 4, perGroup: 200, seed: 4 });
  assert.equal(stats.players, crowdSize(200));
  for (const row of stats.traitSummaries) {
    const trait = TRAITS.find(t => t.key === row.trait.key);
    if (!trait) continue;
    // Pick styles come from the crowd's layout; the rest are drawn.
    close(row.share, trait.share, 0.025);
  }
  // No one has two traits of a group.
  const pool = crowdPools(examplePool());
  for (let index = 0; index < 300; index++) {
    const p = replayPlayer({ pools: pool, weeks: 1, perGroup: 60, seed: 1, index });
    const keys = traitKeys(p.traits);
    for (const group of ['pick', 'legs', 'stake', 'pace']) assert.ok(keys.filter(k => TRAITS.find(t => t.key === k).group === group).length <= 1);
    assert.equal(keys.includes(p.style), p.style !== 'any');
  }
  // Baselines and fan x trait groups add up.
  assert.equal(stats.traitSummaries.length, TRAIT_ROWS.length);
  assert.equal(stats.groupStats.length, FANS.length * TRAIT_ROWS.length);
  const all = stats.groupStats.filter(g => g.trait === 'plainReact').reduce((n, g) => n + g.players, 0);
  assert.equal(all, stats.traitSummaries.find(x => x.trait.key === 'plainReact').players);
});

test('traits change how people bet', () => {
  const pools = crowdPools(examplePool());
  const run = (traits, seed = 3) => simulatePerson({ traits, pools, weeks: 52, random: (() => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(), seed });
  assert.ok(run(['daily']).tickets > 3 * run(['rare']).tickets);
  assert.equal(run(['single']).log.every(x => x.legs === 1), true);
  assert.ok(run(['parlay']).log.every(x => x.legs >= 3 && x.legs <= 6));
  // Bigger stakes for high rollers than for small stakes.
  assert.ok(run(['whale']).staked > 4 * run(['small']).staked);
  // Favourites only: every pick 60%+.
  assert.ok(run(['favorite']).log.every(x => x.chance >= 0.6));
  // Bored people stop after 10 losing tickets in a row.
  const bored = run(['bored', 'parlay', 'daily']);
  if (bored.longestLosing >= 10) assert.equal(bored.quit, true);
  assert.deepEqual(personOf(TRAIT_BIT.single | TRAIT_BIT.daily).legs, [1, 1]);
});

test('everyone plays by the practice account and the lottery rules', () => {
  const stats = simulateCrowdStats({ sportPools: templatePools(), startWeek: 10, weeks: 26, perGroup: 30, seed: 2 });
  for (const who of [...Object.values(stats.notable), ...Object.values(stats.characters)]) {
    // Never a ticket over the limit, never money they didn't have.
    assert.ok(who.log.every(x => x.stake >= SLIP_RULES.minTicket && x.stake <= SLIP_RULES.maxTicket && x.legs <= SLIP_RULES.maxLegs));
    assert.ok(who.lowestCash >= 0);
    close(who.cash, SIM_START_BALANCE + SIM_WEEKLY_GRANT * 25 + who.final, 1e-6);
  }
  // Losers' losses = winners' winnings + the lottery's take + tax.
  const f = stats.flow;
  assert.ok(Math.abs(f.balance) < 1e-3 * f.staked);
  assert.ok(Math.abs(f.winnersPaid - f.winnersStaked - f.winnersWon) < 1e-3 * f.staked);
});

test('the crowd gives the house about what the real lottery keeps (22% before tax)', () => {
  const stats = simulateCrowdStats({ sportPools: templatePools(), startWeek: 38, weeks: 52, perGroup: 60, seed: 5 });
  const take = stats.flow.take / stats.flow.staked;
  assert.ok(take > 0.17 && take < 0.27, `${take}`);
  // Mostly singles and short parlays, as the money is.
  assert.ok(stats.crowd.avgLegs > 1.4 && stats.crowd.avgLegs < 2.4, `${stats.crowd.avgLegs}`);
});

test('the house rules hold in the crowd: locked picks never, parlay-only picks only in parlays', () => {
  const pool = examplePool();
  // A locked long shot and a parlay-only favourite on their own game.
  pool.push({ gameId: 99, kind: 'ml', fairChance: 0.05, odds: 12, lock: 'high' }, { gameId: 98, kind: 'ml', fairChance: 0.9, odds: 1.12, minLegs: 3 });
  const pools = crowdPools(pool);
  assert.ok(!pools.any.some(b => b.lock));
  for (let seed = 1; seed < 20; seed++) {
    const single = simulatePerson({ traits: ['single', 'daily', 'favorite'], pools, weeks: 26, random: Math.random, seed });
    // A single never carries the 3-leg-minimum pick: every single's chance is an ordinary game's.
    assert.ok(single.log.every(x => x.legs > 1 || x.chance < 0.89));
  }
});

test('one run gives every shorter period, and 3 years carries on from 1 year', () => {
  const base = { sportPools: templatePools(), startWeek: 38, perGroup: 20, seed: 9 };
  const strip = r => ({ ...r, bands: undefined, notable: undefined, characters: undefined });
  const year = simulateCrowd({ ...base, weeks: 52, checkpoints: [13, 52] });
  for (const w of [13, 52]) assert.deepEqual(strip(year.results[w]), strip(simulateCrowdStats({ ...base, weeks: w })), `${w} weeks`);
  const longer = simulateCrowd({ ...base, weeks: 156, resume: year.resume }).results[156];
  const straight = simulateCrowdStats({ ...base, weeks: 156 });
  assert.deepEqual(strip(longer), strip(straight));
  for (let i = 0; i < 156; i++) assert.equal(longer.bands[i].ahead, straight.bands[i].ahead);
});

test('the sport calendar has a realistic number of games per year, and every league is simulated', async () => {
  const { LEAGUES, familyOf } = await import('../public/lib/teams.mjs');
  const perYear = Object.fromEntries(SPORTS.map(s => [s, Array.from({ length: 52 }, (_, w) => gamesInWeek(s, w)).reduce((a, b) => a + b, 0)]));
  assert.ok(perYear.mlb > 2400 && perYear.mlb < 2650, `${perYear.mlb}`);
  assert.ok(perYear.epl > 360 && perYear.epl < 410, `${perYear.epl}`);
  assert.ok(perYear.nba > 1200 && perYear.nba < 1350, `${perYear.nba}`);
  assert.equal(perYear.f1, 24);
  // CPBL: 6 clubs, 120 games each (360) + playoffs; NPB 858; KBO 720.
  assert.ok(perYear.cpbl > 350 && perYear.cpbl < 500, `${perYear.cpbl}`);
  assert.ok(perYear.npb > 800 && perYear.npb < 1100, `${perYear.npb}`);
  assert.equal(gamesInWeek('mlb', 2), 0);
  assert.equal(gamesInWeek('tennis', 50), 0);
  for (const key of Object.keys(LEAGUES)) assert.ok(SIM_SPORTS[key], `${key} missing from SIM_SPORTS`);
  for (const [key, sport] of Object.entries(SIM_SPORTS)) {
    assert.equal(familyOf(key), sport.family, key);
    assert.ok(FANS.find(f => f.key === 'all').sports.includes(key));
    if (sport.fan) assert.ok(FANS.some(f => f.key === sport.fan && f.sports.includes(key)), key);
  }
  // Every sport has a typical week to bet on.
  for (const key of SPORTS) assert.ok(sportTemplate(key).length > 0, key);
});

test('anyone can be replayed exactly, and a replayed season tells the same numbers as a profile', () => {
  const opts = { sportPools: templatePools(), startWeek: 20, weeks: 26, perGroup: 20, seed: 5 };
  const stats = simulateCrowdStats(opts);
  for (const who of Object.values(stats.notable)) {
    const again = replayPlayer({ ...opts, index: who.serial - 1 });
    assert.equal(again.final, who.final);
    assert.equal(again.tickets, who.tickets);
    assert.equal(again.traits, who.traits);
    // The same analysis as your own slips (profile.mjs).
    const p = ticketProfile(again.log, { weeks: 26 });
    if (!p) continue;
    assert.equal(p.tickets, again.tickets);
    assert.equal(p.won, again.wonTickets);
    close(p.staked, again.staked, 1e-6);
    close(p.net, again.final, 1e-6);
    assert.equal(p.nearMisses, again.nearMisses);
    assert.equal(p.longestLose, again.longestLosing);
  }
});

test('everyone bets into one world: a race has one winner for all', () => {
  const raw = [0.41, 0.22, 0.145, 0.115, 0.0555, 0.034, 0.0275, 0.0065, ...Array(14).fill(0.0015), 0.0025, 0.002, 0.0005];
  const sum = raw.reduce((a, b) => a + b);
  const f1 = raw.map(p => ({ gameId: 'race', kind: 'f1', key: 'f1|race', fairChance: p / sum, odds: estimateF1LotteryOdds(p / sum) }));
  const sportPools = Object.fromEntries(SPORTS.map(sp => [sp, crowdPools(sp === 'f1' ? f1 : sportTemplate(sp))]));
  let longshotSeasons = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const stats = simulateCrowdStats({ sportPools, startWeek: 10, weeks: 52, perGroup: 20, seed });
    if (stats.leaders.longshot[0]?.value >= 300 && stats.leaders.longshot.filter(x => x.value >= 300).length === 10) longshotSeasons++;
  }
  // A 300+ driver comes in rarely: in most seasons nowhere near ten people cash one.
  assert.ok(longshotSeasons <= 3, `${longshotSeasons} of 6 seasons`);
});

test('who holds the winnings, and the top-10 leaderboards', () => {
  const s = surplusOf(Float64Array.from([-5, -1, 0, 2, 3, 15]));
  assert.deepEqual([s.total, s.winners, s.top1, s.top10, s.half], [20, 3, 0.75, 1, 1]);
  const stats = simulateCrowdStats({ sportPools: templatePools(), startWeek: 10, weeks: 52, perGroup: 20, seed: 3 });
  assert.deepEqual(Object.keys(stats.leaders), Object.keys(LEADERBOARDS));
  for (const [key, list] of Object.entries(stats.leaders)) {
    assert.ok(list.length <= LEADER_SIZE, key);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].value < 0 ? list[i - 1].value <= list[i].value : list[i - 1].value >= list[i].value, key);
  }
  const top = stats.leaders.best[0];
  assert.equal(top.serial, stats.notable.best.serial);
  assert.equal(top.value, stats.finalQuantiles.at(-1));
  // A comeback is someone who ended ahead after being behind.
  const back = stats.notable.comeback;
  if (back) assert.ok(back.final > 0 && back.trough < 0);
});

test('matching result slices keep one game\'s markets consistent', () => {
  // Over 7.5 and over 8.5 of one game on one number line: under first.
  const pool = [
    { gameId: 1, kind: 'total', key: 'g1|total', fairChance: 0.55, odds: 1.6, outLo: 0.45, outHi: 1 },
    { gameId: 1, kind: 'total', key: 'g1|total', fairChance: 0.45, odds: 1.95, outLo: 0, outHi: 0.45 },
    { gameId: 1, kind: 'total', key: 'g1|total', fairChance: 0.38, odds: 2.3, outLo: 0.62, outHi: 1 },
    { gameId: 1, kind: 'total', key: 'g1|total', fairChance: 0.62, odds: 1.4, outLo: 0, outHi: 0.62 }
  ];
  const pools = crowdPools(pool);
  const [a, , b] = pools.any;
  assert.deepEqual([a.outLo, a.outHi, b.outLo, b.outHi], [0.45, 1, 0.62, 1]);
  // Over 8.5 winning lies inside over 7.5 winning.
  assert.ok(b.outLo >= a.outLo && b.outHi <= a.outHi);
  assert.equal(STYLES[0].key, 'any');
});

test('every text the page builds from a key exists in both languages', async () => {
  globalThis.navigator ??= { language: 'en' };
  const { makeT } = await import('../public/lib/i18n.mjs');
  const { LEAGUES } = await import('../public/lib/teams.mjs');
  const { FUTURES, EXTRA_FUTURES } = await import('../public/lib/sources.mjs');
  const keys = [
    ...TRAIT_ROWS.flatMap(r => [`trait_${r.key}`, `traitDesc_${r.key}`]),
    ...Object.keys(LEADERBOARDS).flatMap(k => [`lb_${k}`, `lbNote_${k}`]),
    ...FANS.flatMap(f => [`fan_${f.key}`, `fanDesc_${f.key}`]),
    ...[...Object.keys(LEAGUES), 'f1', 'all'].map(k => `sport_${k}`),
    ...[...FUTURES, ...EXTRA_FUTURES].flatMap(f => [`future_${f.key}`, `futureSettle_${f.key}`]),
    ...['games', 'points', 'frames'].map(u => `unit_${u}`),
    ...['value', 'steady', 'shot'].flatMap(r => [`rec_${r}`, `recWhy_${r}`]),
    ...['low', 'high'].map(l => `lock_${l}`),
    ...['locked', 'minLegs'].map(e => `slipError_${e}`),
    ...['style', 'react', 'fan'].flatMap(g => [`groupTab_${g}`, `groupNote_${g}`]),
    ...['baseball', 'basketball', 'soccer', 'football', 'hockey', 'tennis', 'net', 'snooker', 'f1'].map(g => `group_${g}`),
    ...['secHtft', 'secGoalBands', 'secQ1', 'secFirstSet', 'secSets', 'secTotalSets', 'secSetHcap', 'secGameHcap', 'secGameTotal']
  ];
  for (const locale of ['zh', 'en']) {
    const t = makeT(locale);
    assert.deepEqual(keys.filter(k => t(k) === k && k !== 'group_f1'), [], locale);
  }
});

test('fairness audit: no sport or kind of fan does better or worse just from how it is modelled', async () => {
  const { auditPools, auditCrowd, poolBack } = await import('../public/lib/audit.mjs');
  const { gameOptions, crowdPool } = await import('../public/lib/board.mjs');
  const { parseKambiEvents } = await import('../public/lib/kambi.mjs');
  const { readFileSync } = await import('node:fs');
  // Every sport's typical week in line with the rest.
  const templates = Object.fromEntries(SPORTS.map(sp => [sp, sportTemplate(sp)]));
  assert.deepEqual(auditPools(templates), []);
  for (const [sport, pool] of Object.entries(templates)) assert.ok(pool.every(b => !b.lock && b.odds > 1), sport);
  // A real board and the typical week of its sport return the same, within 3.
  const data = JSON.parse(readFileSync(new URL('./fixtures/kambi-atp-2026-09-26.json', import.meta.url), 'utf8'));
  const games = parseKambiEvents(data, 'tennis', new Date('2026-09-26T00:00:00Z'));
  const real = crowdPool(games.flatMap(g => gameOptions(g)));
  assert.ok(Math.abs(poolBack(real) - poolBack(templates.tennis)) < 3, `${poolBack(real)} vs ${poolBack(templates.tennis)}`);
  // An inflated stand-in (winners only, a lower cut) is caught.
  const cheap = templates.nba.filter(b => b.kind === 'ml').map(b => ({ ...b, odds: b.odds * 1.08 }));
  assert.deepEqual(auditPools({ ...templates, nba: cheap }).map(x => x.sport), ['nba']);
  // In the crowd, every kind of fan within 5 of the whole crowd's money back.
  const stats = simulateCrowdStats({ sportPools: Object.fromEntries(Object.entries(templates).map(([sp, b]) => [sp, crowdPools(b)])), startWeek: 38, weeks: 52, perGroup: 80, seed: 1 });
  assert.deepEqual(auditCrowd(stats), []);
});
