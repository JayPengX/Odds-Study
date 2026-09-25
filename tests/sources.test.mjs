import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEspnScoreboard, parsePolymarketMlb, mergeGames, parseF1RaceWinner } from '../public/lib/sources.mjs';

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
  const games = parseEspnScoreboard(espn);
  assert.equal(games.length, 1);
  assert.equal(games[0].away, 'Pittsburgh Pirates');
  assert.ok(Math.abs(games[0].awayFair - 0.4988) < 0.001);
  assert.equal(games[0].total.line, 7.5);
});

test('Polymarket parser skips started games and reads the moneyline market', () => {
  const games = parsePolymarketMlb(polymarket, NOW);
  assert.equal(games.length, 1);
  assert.equal(games[0].awayFair, 0.505);
  assert.equal(games[0].liquidity, 101745);
});

test('mergeGames joins both sources and adds Chinese names', () => {
  const [game] = mergeGames(parseEspnScoreboard(espn), parsePolymarketMlb(polymarket, NOW));
  assert.equal(game.away.zh, '匹茲堡海盜');
  assert.equal(game.home.zh, '底特律老虎');
  assert.equal(game.polymarketAway, 0.505);
  assert.ok(game.draftKingsAway > 0.49);
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
