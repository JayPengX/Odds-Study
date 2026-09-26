// 小遊戲: small games that earn play money for the practice account, by
// effort, not luck, and no math: typing ticket numbers and sorting tickets
// (plain work), a home run derby and free throws (practice until your timing
// is right). The pay is small on purpose: every round shows how many minutes
// of a minimum-wage job it equals, and how little betting it takes to lose
// it again, so the games are a reminder of how slowly money is
// earned. All together they pay at most ARCADE.dailyCap a Taiwan day.
//
// Winnings go in the ledger like every other entry ('game-<id>', kind
// 'game'), so they sync and merge across devices the same way. The account's
// betting result leaves them out, like the weekly grants.
import { taipeiDayKey } from './sources.mjs';
import { leagueTeams } from './teams.mjs';

export const ARCADE = {
  dailyCap: 1500,
  // What every game pays for a minute of typical play (NT$).
  perMinute: 25,
  games: ['typing', 'sort', 'derby', 'freethrow'],
  // Taiwan's minimum hourly wage in 2026 (NT$).
  minWage: 196,
  // What the lottery keeps of every NT$100 staked, on average (it pays out at most 78%).
  take: 0.22
};

// Balanced pay: every game pays about ARCADE.perMinute for a minute of
// typical play, streaks and penalties included, so none is the one to farm.
// PACE is each game's typical round: how long it takes (typing about 7 s a
// number on a phone, sorting 1.5 s a ticket, a pitch or a shot about 3.5 s
// with the wait and the replay) and how an ordinary player does ('ok' and
// 'bad' for the work games). Better players earn more, up to about 4 times.

// Streaks and penalties by how hard each game really is. Typing is easy
// work: it punishes carelessness and pays little for keeping it up. Sorting
// teams takes knowing them and free throws a steady hand: in between. The
// derby's 40 ms window is hard enough that a miss costs nothing and a run of
// hits pays the most.
// `every`: right in a row for a bonus of `bonus`; `penalty`: what a mistake costs.
export const STREAK = {
  typing: { every: 5, bonus: 2, penalty: 2 },
  sort: { every: 5, bonus: 2, penalty: 1 },
  freethrow: { every: 3, bonus: 2, penalty: 1 },
  derby: { every: 3, bonus: 3, penalty: 0 }
};

// A round's running score: good(pay) for a success (returns the streak
// bonus it earned, if any), bad() for a mistake (returns what it cost). The
// round's pay never goes under 0.
export function scorer(game) {
  const rule = STREAK[game];
  let sum = 0;
  let run = 0;
  let bonus = 0;
  let penalty = 0;
  return {
    good(pay) {
      sum += pay;
      run++;
      if (run % rule.every !== 0) return 0;
      sum += rule.bonus;
      bonus += rule.bonus;
      return rule.bonus;
    },
    bad() {
      run = 0;
      sum -= rule.penalty;
      penalty += rule.penalty;
      return rule.penalty;
    },
    get total() {
      return Math.max(0, Math.round(sum));
    },
    get run() {
      return run;
    },
    get bonus() {
      return bonus;
    },
    get penalty() {
      return penalty;
    }
  };
}

// What each event pays before streaks ('bad' and 'miss' are mistakes).
const EVENT_PAY = {
  typing: { ok: () => TYPING.pay },
  sort: { ok: () => SORT.pay },
  derby: { hr: () => DERBY.pay.hr, hit: () => DERBY.pay.hit },
  freethrow: { swish: () => FREE_THROW.pay.swish, make: () => FREE_THROW.pay.make }
};

// A whole round's pay from its events, in order.
export function scoreRound(game, events) {
  const score = scorer(game);
  for (const e of events) {
    const pay = EVENT_PAY[game][e];
    if (pay) score.good(pay());
    else score.bad();
  }
  return score;
}
export const PACE = {
  typing: { seconds: 140, events: [...run(8, 'ok'), 'bad', ...run(7, 'ok'), 'bad', ...run(5, 'ok')] },
  sort: { seconds: 85, events: [...run(6, 'ok'), 'bad', ...run(5, 'ok'), 'bad', 'bad', ...run(7, 'ok'), 'bad', ...run(4, 'ok'), 'bad', ...run(3, 'ok'), 'bad', ...run(3, 'ok'), 'bad', ...run(2, 'ok')] },
  derby: { seconds: 33, events: ['hr', 'hit', 'hit', 'miss', 'hit', 'miss', 'miss', 'hit', 'miss', 'miss'] },
  freethrow: { seconds: 32, events: ['swish', 'make', 'make', 'miss', 'make', 'miss', 'miss', 'make', 'miss', 'miss'] }
};
function run(n, x) {
  return Array(n).fill(x);
}

// How long a minimum-wage job takes to earn a round's pay (minutes), and how
// much betting loses as much on average.
export const wageMinutes = paid => (paid / ARCADE.minWage) * 60;
export const stakeToLose = paid => paid / ARCADE.take;

// ---- Money ------------------------------------------------------------------------

export function earnedToday(account, now = new Date()) {
  const day = taipeiDayKey(now.toISOString());
  return account.ledger.filter(e => e.kind === 'game' && taipeiDayKey(e.t) === day).reduce((s, e) => s + e.amount, 0);
}

export const roomToday = (account, now = new Date()) => Math.max(0, ARCADE.dailyCap - earnedToday(account, now));

function entryId(now) {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `game-${now.getTime().toString(36)}${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

// Pays a finished round's winnings, as much as today's room allows.
// Returns { account, paid }.
export function payGame(account, game, amount, now = new Date()) {
  const paid = Math.max(0, Math.min(Math.round(amount), roomToday(account, now)));
  if (paid === 0) return { account, paid };
  const t = now.toISOString();
  return { account: { ...account, updated: t, ledger: [...account.ledger, { id: entryId(now), t, kind: 'game', game, amount: paid }] }, paid };
}

// ---- 全壘打大賽 (home run derby) ------------------------------------------------------
//
// Ten pitches a round, each faster than the last, some of them change-ups
// that slow down halfway. Swing as the ball crosses the plate: within
// DERBY.hr of its middle a home run, within DERBY.hit a base hit, else a miss.
export const DERBY = { pitches: 10, plate: 0.83, hr: 0.018, hit: 0.05, pay: { hr: 6, hit: 1 } };

// How long pitch i (0-based) takes to reach the end of the track, in ms;
// whether it's a change-up (from the third pitch); and how much it breaks
// sideways (from the fifth: it looks different, the timing is the same).
export function pitchPlan(i, random = Math.random) {
  const base = 1000 - i * 60;
  return { ms: Math.round(base * (0.85 + random() * 0.3)), changeUp: i >= 2 && random() < 0.35, breakX: i >= 4 ? random() * 2 - 1 : 0 };
}

// Where the ball is (0-1 along the track) `elapsed` ms into a pitch: a
// change-up runs at full speed to halfway, then at 60%.
export function ballAt(plan, elapsed) {
  const x = elapsed / plan.ms;
  if (!plan.changeUp || x <= 0.5) return x;
  return 0.5 + (x - 0.5) * 0.6;
}

export function swingResult(position) {
  const off = Math.abs(position - DERBY.plate);
  return off <= DERBY.hr ? 'hr' : off <= DERBY.hit ? 'hit' : 'miss';
}

export const derbyPayout = results => scoreRound('derby', results).total;

// ---- 打工：輸入彩券號碼 (data entry) ---------------------------------------------------
//
// Plain work: type each ticket number exactly as shown. Every one typed right
// pays the same; a typo pays nothing and the number stays until it's right.
// Nothing is left to chance: the more you type, the more you earn.
export const TYPING = { codes: 20, digits: 10, pay: 3 };

// A ticket number: ten digits, shown in groups of four ("4829 1735 06").
export function ticketCode(random = Math.random) {
  return Array.from({ length: TYPING.digits }, () => Math.floor(random() * 10)).join('');
}
export const groupCode = code => code.replace(/(\d{4})(?=\d)/g, '$1 ');
// Typed right: the same digits, whatever spaces or dashes.
export const typedRight = (typed, code) => typed.replace(/\D/g, '') === code;

export const typingPayout = right => right * TYPING.pay;

// ---- 整理彩券 (sorting tickets by team) -------------------------------------------------
//
// Work that takes knowing your teams: each ticket shows a team (its logo and
// name); put it in its league's box before its clock runs out (a ticket
// left too long counts as a mistake). A round uses one set of four boxes,
// chosen to be confusable: the four baseball leagues (NPB or KBO?), four
// basketball leagues, the four big American leagues (the New York Rangers,
// Giants, Mets or Knicks?), Europe's big four soccer leagues, or four more
// soccer leagues. Teams come from our own tables and ESPN's team lists:
// about 20-30 a league, so 80-120 a set.
export const SORT = { tickets: 30, pay: 1.2, seconds: 5 };
export const SORT_SETS = {
  baseball: ['mlb', 'npb', 'kbo', 'cpbl'],
  basketball: ['nba', 'wnba', 'euroleague', 'bleague'],
  usa: ['nfl', 'nhl', 'mlb', 'nba'],
  soccer: ['epl', 'laliga', 'seriea', 'bundesliga'],
  soccer2: ['ligue1', 'eredivisie', 'primeira', 'mls']
};

export const sortSet = (random = Math.random) => Object.keys(SORT_SETS)[Math.floor(random() * Object.keys(SORT_SETS).length)];

// A ticket: a league of the set, then one of its teams, never the team just
// shown (`last`).
export function sortTicket(set, random = Math.random, last = null) {
  const leagues = SORT_SETS[set];
  for (let tries = 0; tries < 20; tries++) {
    const league = leagues[Math.floor(random() * leagues.length)];
    const teams = leagueTeams(league);
    const team = teams[Math.floor(random() * teams.length)];
    if (team && team !== last) return { league, team };
  }
  return null;
}

export const sortPayout = right => Math.round(right * SORT.pay);

// ---- 罰球 (free throws) ------------------------------------------------------------------
//
// Ten shots. A marker sweeps back and forth across the aim bar, faster each
// shot, while the green zone in the middle narrows: stop it in the zone's
// middle half for a swish, anywhere in the zone for a make.
export const FREE_THROW = { shots: 10, pay: { swish: 5, make: 3 } };

export function shotPlan(i) {
  return { period: 1300 - i * 70, zone: 0.13 - i * 0.008 };
}

// The marker's place (0-1) `elapsed` ms into a shot: there and back each
// period, easing like a swing, slow at the ends and fastest through the
// middle, where the green is.
export function markerAt(plan, elapsed) {
  const x = (elapsed % plan.period) / plan.period;
  return (1 - Math.cos(2 * Math.PI * x)) / 2;
}

export function shotResult(position, plan) {
  const off = Math.abs(position - 0.5);
  return off <= plan.zone / 4 ? 'swish' : off <= plan.zone / 2 ? 'make' : 'miss';
}

export const freeThrowPayout = results => scoreRound('freethrow', results).total;

// A game's typical pay per minute (PACE), to keep them level, and the most a
// perfect round pays.
export function typicalPerMinute(game) {
  return (scoreRound(game, PACE[game].events).total / PACE[game].seconds) * 60;
}
export function bestRound(game) {
  const best = { typing: ['ok', TYPING.codes], sort: ['ok', SORT.tickets], derby: ['hr', DERBY.pitches], freethrow: ['swish', FREE_THROW.shots] }[game];
  return scoreRound(game, Array(best[1]).fill(best[0])).total;
}
