import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  START_BALANCE,
  WEEKLY_GRANT,
  newAccount,
  balance,
  canClaim,
  claimGrant,
  weekKey,
  placeSlip,
  legResult,
  applyResults,
  mergeAccounts,
  topInning
} from '../public/lib/account.mjs';
import { settleSlip, SLIP_RULES } from '../public/lib/odds.mjs';
import { parseEspnResults, parseEspnRace, parseFutureResult } from '../public/lib/sources.mjs';

const at = iso => new Date(iso);

test('weeks start on Monday, Taiwan time', () => {
  // Sunday 23:30 in Taiwan is still the week of Monday the 21st.
  assert.equal(weekKey(at('2026-09-27T15:30:00Z')), '2026-09-21');
  // Monday 00:30 in Taiwan (Sunday in UTC) is the next week.
  assert.equal(weekKey(at('2026-09-27T16:30:00Z')), '2026-09-28');
});

test('a new account starts with NT$10,000 and claims NT$5,000 once a week from the next week', () => {
  let account = newAccount(at('2026-09-25T00:00:00Z'));
  assert.equal(balance(account), START_BALANCE);
  assert.equal(canClaim(account, at('2026-09-26T00:00:00Z')), false);
  const monday = at('2026-09-28T02:00:00Z');
  assert.equal(canClaim(account, monday), true);
  account = claimGrant(account, monday);
  assert.equal(balance(account), START_BALANCE + WEEKLY_GRANT);
  assert.equal(canClaim(account, monday), false);
  assert.equal(claimGrant(account, monday), account);
  // Skipped weeks don't pile up: two weeks later, one more grant.
  account = claimGrant(account, at('2026-10-14T02:00:00Z'));
  assert.equal(balance(account), START_BALANCE + 2 * WEEKLY_GRANT);
});

const slip = (id, cost, legs, extra = {}) => ({ id, mode: 'parlay', sizes: [legs.length], stake: cost, cost, legs, ...extra });

test('placing a slip takes its cost; not more than the balance', () => {
  const account = newAccount(at('2026-09-25T00:00:00Z'));
  assert.deepEqual(placeSlip(account, slip('a', 20_000, [{ id: 'x', odds: 2 }])), { error: 'funds' });
  const { account: after } = placeSlip(account, slip('a', 1000, [{ id: 'x', odds: 2 }]));
  assert.equal(balance(after), START_BALANCE - 1000);
  assert.equal(after.slips[0].status, 'open');
});

test('settling pays like a real ticket: voids count at 1.00, tax over NT$5,000', () => {
  // Parlay of 2.0 x 1.5 at NT$100: 300.
  assert.equal(settleSlip({ legs: [{ odds: 2, result: 'won' }, { odds: 1.5, result: 'won' }], sizes: [2], stake: 100 }).net, 300);
  assert.equal(settleSlip({ legs: [{ odds: 2, result: 'won' }, { odds: 1.5, result: 'lost' }], sizes: [2], stake: 100 }).net, 0);
  assert.equal(settleSlip({ legs: [{ odds: 2, result: 'won' }, { odds: 1.5, result: 'void' }], sizes: [2], stake: 100 }).net, 200);
  // Singles: each leg its own ticket.
  assert.equal(settleSlip({ legs: [{ odds: 2, result: 'won' }, { odds: 1.5, result: 'lost' }], sizes: [1], stake: 100 }).net, 200);
  // NT$10,000 at 1.8: 18,000 before tax.
  const big = settleSlip({ legs: [{ odds: 1.8, result: 'won' }], sizes: [1], stake: 10_000 });
  assert.equal(big.gross, 18_000);
  assert.ok(Math.abs(big.net - 18_000 * (1 - SLIP_RULES.taxRate - SLIP_RULES.stampRate)) < 1e-6);
});

test('each kind of leg is judged from the final score', () => {
  const game = { status: 'final', awayScore: 5, homeScore: 3, awayInnings: [0, 3, 0, 0, 2, 0, 0, 0, 0], homeInnings: [1, 0, 0, 0, 0, 2, 0, 0] };
  assert.equal(legResult({ kind: 'ml', side: 'away' }, game), 'won');
  assert.equal(legResult({ kind: 'ml', side: 'home' }, game), 'lost');
  assert.equal(legResult({ kind: 'total', side: 'over', line: 7.5 }, game), 'won');
  assert.equal(legResult({ kind: 'total', side: 'under', line: 8.5 }, game), 'won');
  assert.equal(legResult({ kind: 'runline', side: 'away', line: -1.5 }, game), 'won');
  assert.equal(legResult({ kind: 'runline', side: 'away', line: -2.5 }, game), 'lost');
  assert.equal(legResult({ kind: 'runline', side: 'home', line: 2.5 }, game), 'won');
  assert.equal(legResult({ kind: 'teamtotal', team: 'home', side: 'under', line: 3.5 }, game), 'won');
  assert.equal(legResult({ kind: 'teamtotal', team: 'away', side: 'over', line: 5.5 }, game), 'lost');
  // Innings: 2nd has 3 runs, the most on its own.
  assert.equal(legResult({ kind: 'inning', inning: 1 }, game), 'won');
  assert.equal(topInning([1, 0], [0, 1]), 9);
  assert.equal(legResult({ kind: 'ml', side: 'draw' }, { status: 'final', awayScore: 1, homeScore: 1 }), 'won');
  assert.equal(legResult({ kind: 'ml', side: 'away' }, { status: 'void' }), 'void');
  assert.equal(legResult({ kind: 'ml', side: 'away' }, { status: 'pending' }), null);
  assert.equal(legResult({ kind: 'f1', driver: 'Kimi Antonelli' }, { status: 'final', winner: 'Kimi Antonelli' }), 'won');
  assert.equal(legResult({ kind: 'future', team: 'Los Angeles Dodgers' }, { status: 'final', winner: 'New York Yankees' }), 'lost');
});

test('a slip settles once every leg is decided, and pays in once', () => {
  let account = newAccount(at('2026-09-25T00:00:00Z'));
  ({ account } = placeSlip(account, slip('s', 100, [{ id: 'a', odds: 2 }, { id: 'b', odds: 1.5 }])));
  account = applyResults(account, 's', ['won', null]);
  assert.equal(account.slips[0].status, 'open');
  assert.equal(account.slips[0].legs[0].result, 'won');
  account = applyResults(account, 's', [null, 'won']);
  assert.equal(account.slips[0].status, 'settled');
  assert.equal(account.slips[0].payout, 300);
  assert.equal(balance(account), START_BALANCE - 100 + 300);
  assert.equal(applyResults(account, 's', ['won', 'won']), account);
});

test('two devices merge without counting anything twice', () => {
  const base = newAccount(at('2026-09-25T00:00:00Z'));
  const { account: a } = placeSlip(base, slip('a', 500, [{ id: 'x', odds: 2 }]), at('2026-09-25T01:00:00Z'));
  const { account: b0 } = placeSlip(base, slip('b', 300, [{ id: 'y', odds: 3 }]), at('2026-09-25T02:00:00Z'));
  const b = applyResults(b0, 'b', ['won'], at('2026-09-25T05:00:00Z'));
  const merged = mergeAccounts(a, b);
  assert.equal(merged.slips.length, 2);
  assert.equal(balance(merged), START_BALANCE - 500 - 300 + 900);
  assert.deepEqual(mergeAccounts(merged, b).ledger, merged.ledger);
  // A slip settled on one device wins over the open copy on the other.
  const settledA = applyResults(a, 'a', ['lost']);
  assert.equal(mergeAccounts(a, settledA).slips.find(s => s.id === 'a').status, 'settled');
});

test('ESPN results: final scores and innings, postponed games void', () => {
  const data = {
    events: [
      {
        date: '2026-09-24T16:35Z',
        competitions: [{
          status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true } },
          competitors: [
            { homeAway: 'home', score: '2', team: { displayName: 'Pittsburgh Pirates' }, linescores: [{ value: 1 }, { value: 0 }] },
            { homeAway: 'away', score: '1', team: { displayName: 'St. Louis Cardinals' }, linescores: [{ value: 1 }] }
          ]
        }]
      },
      {
        date: '2026-09-24T23:05Z',
        competitions: [{
          status: { type: { name: 'STATUS_POSTPONED', state: 'post', completed: false } },
          competitors: [
            { homeAway: 'home', score: '0', team: { displayName: 'A' } },
            { homeAway: 'away', score: '0', team: { displayName: 'B' } }
          ]
        }]
      }
    ]
  };
  const [played, postponed] = parseEspnResults(data, 'mlb');
  assert.equal(played.status, 'final');
  assert.equal(played.homeScore, 2);
  assert.deepEqual(played.homeInnings, [1, 0]);
  assert.equal(postponed.status, 'void');
});

test('F1 winner from ESPN, championship winner from Polymarket', () => {
  const race = {
    events: [{ competitions: [
      { type: { abbreviation: 'Qual' }, date: '2026-09-12T14:00Z', status: { type: { completed: true } }, competitors: [{ order: 1, athlete: { displayName: 'Lando Norris' } }] },
      { type: { abbreviation: 'Race' }, date: '2026-09-13T13:00Z', status: { type: { completed: true } }, competitors: [{ order: 2, athlete: { displayName: 'Max Verstappen' } }, { order: 1, winner: true, athlete: { displayName: 'Kimi Antonelli' } }] }
    ] }]
  };
  assert.deepEqual(parseEspnRace(race, '2026-09-13T13:00:00Z'), { status: 'final', winner: 'Kimi Antonelli' });
  assert.equal(parseFutureResult([{ closed: false, markets: [] }]).status, 'pending');
  const done = parseFutureResult([{ closed: true, markets: [
    { question: 'Will the New York Yankees win the 2026 World Series?', outcomes: '["Yes","No"]', outcomePrices: '["0","1"]' },
    { question: 'Will the Los Angeles Dodgers win the 2026 World Series?', outcomes: '["Yes","No"]', outcomePrices: '["1","0"]' }
  ] }]);
  assert.deepEqual(done, { status: 'final', winner: 'Los Angeles Dodgers' });
});
