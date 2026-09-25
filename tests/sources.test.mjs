import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEspnScoreboard, parsePolymarketMlb, parsePolymarketEpl, mergeGames, parseF1RaceWinner, eplMatchdays } from '../public/lib/sources.mjs';

const NOW = new Date('2026-09-25T12:00:00Z');

const espn = {
  events: [
    {
      date: '2026-09-25T22:40Z',
      competitions: [
        {
          status: { type: { state: 'pre' } },
          competitors: [
            { homeAway: 'home', team: { displayName: 'Detroit Tigers' } },
            { homeAway: 'away', team: { displayName: 'Pittsburgh Pirates' } }
          ],
          odds: [
            {
              moneyline: { away: { close: { odds: '-109' } }, home: { close: { odds: '-110' } } },
              total: { over: { close: { line: 'o7.5', odds: '-102' } }, under: { close: { line: 'u7.5', odds: '-118' } } }
            }
          ]
        }
      ]
    },
    { date: '2026-09-25T01:40Z', competitions: [{ status: { type: { state: 'post' } }, competitors: [] }] }
  ]
};

const polymarket = [
  {
    title: 'Pittsburgh Pirates vs. Detroit Tigers',
    startTime: '2026-09-25T22:40:00Z',
    teams: [
      { name: 'Pittsburgh Pirates', ordering: 'away' },
      { name: 'Detroit Tigers', ordering: 'home' }
    ],
    markets: [
      { question: 'Pittsburgh Pirates vs. Detroit Tigers', outcomes: '["Pittsburgh Pirates","Detroit Tigers"]', outcomePrices: '["0.505","0.495"]', liquidity: '101745' },
      { question: 'Pittsburgh Pirates to win the 1st inning?', outcomes: '["Yes","No"]', outcomePrices: '["0.21","0.79"]' }
    ]
  },
  {
    title: 'Houston Astros vs. Athletics',
    startTime: '2026-09-25T01:40:00Z',
    teams: [{ name: 'Houston Astros', ordering: 'away' }, { name: 'Athletics', ordering: 'home' }],
    markets: [{ question: 'Houston Astros vs. Athletics', outcomes: '["Houston Astros","Athletics"]', outcomePrices: '["0.99","0.01"]' }]
  }
];

test('ESPN parser keeps only upcoming games and devigs moneyline and total', () => {
  const games = parseEspnScoreboard(espn, 'mlb');
  assert.equal(games.length, 1);
  assert.equal(games[0].away, 'Pittsburgh Pirates');
  assert.ok(Math.abs(games[0].outcomes.away - 0.4988) < 0.001);
  assert.equal(games[0].total.line, 7.5);
});

test('Polymarket parser skips started games and reads the moneyline market', () => {
  const games = parsePolymarketMlb(polymarket, NOW);
  assert.equal(games.length, 1);
  assert.ok(Math.abs(games[0].outcomes.away - 0.505) < 1e-9);
  assert.equal(games[0].liquidity, 101745);
});

test('mergeGames joins both sources and adds Chinese names', () => {
  const [game] = mergeGames(parseEspnScoreboard(espn, 'mlb'), parsePolymarketMlb(polymarket, NOW));
  assert.equal(game.sport, 'mlb');
  assert.equal(game.away.zh, '匹茲堡海盜');
  assert.equal(game.home.zh, '底特律老虎');
  assert.ok(Math.abs(game.polymarket.away - 0.505) < 1e-9);
  assert.ok(game.draftKings.away > 0.49);
  assert.equal(game.total.line, 7.5);
});

test('F1 parser picks the next race-winner event and devigs drivers', () => {
  const f1 = parseF1RaceWinner(
    [
      { slug: 'f1-azerbaijan-grand-prix-driver-pole-position-2026-09-25', startTime: '2026-09-25T12:00:00Z', markets: [] },
      {
        slug: 'f1-azerbaijan-grand-prix-winner-2026-09-26',
        title: 'Azerbaijan Grand Prix: Driver Winner',
        startTime: '2026-09-26T11:00:00Z',
        markets: [
          { groupItemTitle: 'Kimi Antonelli', outcomePrices: '["0.41","0.59"]' },
          { groupItemTitle: 'George Russell', outcomePrices: '["0.2","0.8"]' },
          { groupItemTitle: 'Lando Norris', outcomePrices: '["0.4","0.6"]', closed: true }
        ]
      }
    ],
    NOW
  );
  assert.equal(f1.drivers.length, 2);
  assert.equal(f1.drivers[0].name, 'Kimi Antonelli');
  assert.ok(Math.abs(f1.drivers[0].fair + f1.drivers[1].fair - 1) < 1e-6);
});

const eplEspn = {
  events: [
    {
      date: '2026-10-10T11:30Z',
      competitions: [
        {
          status: { type: { state: 'pre' } },
          competitors: [
            { homeAway: 'home', team: { displayName: 'Arsenal' } },
            { homeAway: 'away', team: { displayName: 'Leeds United' } }
          ],
          odds: [
            {
              moneyline: { home: { close: { odds: '-270' } }, away: { close: { odds: '+650' } }, draw: { close: { odds: '+380' } } },
              total: { over: { close: { line: 'o2.5', odds: '-135' } }, under: { close: { line: 'u2.5', odds: '+100' } } }
            }
          ]
        }
      ]
    }
  ]
};

const eplPolymarket = [
  {
    title: 'Arsenal FC vs. Leeds United FC',
    startTime: '2026-10-10T11:30:00Z',
    teams: [
      { name: 'Arsenal FC', ordering: 'home' },
      { name: 'Leeds United FC', ordering: 'away' }
    ],
    markets: [
      { question: 'Will Arsenal FC win on 2026-10-10?', outcomes: '["Yes","No"]', outcomePrices: '["0.69","0.31"]', liquidity: '50000' },
      { question: 'Will Arsenal FC vs. Leeds United FC end in a draw?', outcomes: '["Yes","No"]', outcomePrices: '["0.19","0.81"]', liquidity: '20000' },
      { question: 'Will Leeds United FC win on 2026-10-10?', outcomes: '["Yes","No"]', outcomePrices: '["0.13","0.87"]', liquidity: '30000' },
      { question: 'Arsenal FC vs. Leeds United FC: O/U 2.5', outcomes: '["Over","Under"]', outcomePrices: '["0.55","0.45"]' }
    ]
  }
];

test('ESPN soccer parser devigs home/draw/away', () => {
  const [game] = parseEspnScoreboard(eplEspn, 'epl');
  const { away, draw, home } = game.outcomes;
  assert.ok(Math.abs(away + draw + home - 1) < 1e-9);
  assert.ok(home > 0.67 && home < 0.69);
  assert.ok(draw > 0.19 && draw < 0.2);
  assert.equal(game.total.line, 2.5);
});

test('Polymarket soccer parser reads the three yes/no markets', () => {
  const [game] = parsePolymarketEpl(eplPolymarket, NOW);
  assert.equal(game.home, 'Arsenal FC');
  assert.ok(Math.abs(game.outcomes.home - 0.69 / 1.01) < 1e-9);
  assert.equal(game.liquidity, 20000);
});

test('soccer games merge across name styles and get Chinese names', () => {
  const [game] = mergeGames(parseEspnScoreboard(eplEspn, 'epl'), parsePolymarketEpl(eplPolymarket, NOW));
  assert.equal(game.sport, 'epl');
  assert.equal(game.home.en, 'Arsenal');
  assert.equal(game.home.zh, '阿森納');
  assert.equal(game.away.zh, '里茲聯');
  assert.ok(game.draftKings.draw > 0 && game.polymarket.draw > 0);
});

test('eplMatchdays keeps calendar dates in the coming three weeks', () => {
  const days = eplMatchdays({ leagues: [{ calendar: ['2026-09-20T07:00Z', '2026-10-10T07:00Z', '2026-10-11T07:00Z', '2026-10-31T07:00Z'] }] }, NOW);
  assert.deepEqual(days.map(d => d.toISOString().slice(0, 10)), ['2026-10-10', '2026-10-11']);
});
