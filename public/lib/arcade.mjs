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
import { leagueTeams, teamNick, familyOf, normalizeTeamName } from './teams.mjs';

export const ARCADE = {
  dailyCap: 1500,
  // What every game pays for a minute of typical play (NT$).
  perMinute: 25,
  // About how long a round of any game takes (s).
  roundSeconds: 60,
  games: ['typing', 'sort', 'derby', 'freethrow'],
  // Taiwan's minimum hourly wage in 2026 (NT$).
  minWage: 196,
  // What the lottery keeps of every NT$100 staked, on average (it pays out at most 78%).
  take: 0.22
};

// Balanced pay and length: every round takes about a minute (ARCADE.roundSeconds)
// and pays about ARCADE.perMinute for typical play, streaks and penalties
// included, so none is the one to farm.
// PACE is each game's typical round: how long it takes (typing about 7 s a
// number on a phone, sorting 1.5 s a ticket, a pitch or a shot about 3.5 s
// with the wait and the replay) and how an ordinary player does ('ok' and
// 'bad' for the work games). Better players earn more, up to about 4 times.

// Risk by kind of game, none of it extreme, since this is work:
// - typing is the safe earn: a typo costs nothing (retype it), a small bonus
//   for keeping it up, and nearly the same pay every round;
// - the team quiz is in between: a wrong box costs a little;
// - the derby and free throws are high risk, high pay, and paid mostly for
//   streaks: one success pays little, each one in a row after it adds a
//   bonus (`ladder`: the 2nd adds `ladder[0]`, the 3rd on `ladder[1]`), a
//   miss costs a little and ends the streak. Their difficulty follows the
//   player (see ADAPT), so a streak is always earned at the edge of your
//   skill. A bad round pays about nothing, a good one about twice typical.
// `every` + `bonus`: that many right in a row adds the bonus; `penalty`: what a mistake costs.
export const STREAK = {
  typing: { every: 5, bonus: 1, penalty: 0 },
  sort: { every: 4, bonus: 2, penalty: 1 },
  freethrow: { ladder: [3, 6], penalty: 1 },
  derby: { ladder: [3, 6], penalty: 1 }
};

// Dynamic difficulty for the skill games: a level from 0 (easy) to 1 (the
// hardest), starting low; up after a success (more after the best kind),
// down after a miss, so the game settles where you hit about half.
export const ADAPT = { start: 0.15, up: 0.1, upBest: 0.14, down: 0.16 };
export function adapt(level, result) {
  const step = result === 'miss' ? -ADAPT.down : result === 'hr' || result === 'swish' ? ADAPT.upBest : ADAPT.up;
  return Math.min(1, Math.max(0, level + step));
}

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
      const extra = rule.ladder ? (run === 1 ? 0 : rule.ladder[Math.min(run - 2, rule.ladder.length - 1)]) : run % rule.every === 0 ? rule.bonus : 0;
      sum += extra;
      bonus += extra;
      return extra;
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
  typing: { seconds: 63, events: [...run(5, 'ok'), 'bad', ...run(3, 'ok')] },
  sort: { seconds: 60, events: [...run(4, 'ok'), 'bad', ...run(3, 'ok'), 'bad', ...run(2, 'ok'), 'bad', ...run(3, 'ok'), 'bad', 'bad', ...run(2, 'ok'), 'bad'] },
  derby: { seconds: 60, events: ['hr', 'hit', 'miss', 'hit', 'hit', 'hr', 'miss', 'hit', 'miss', 'hr', 'hit', 'miss', 'hit', 'hit', 'hr', 'miss', 'hit', 'miss'] },
  freethrow: { seconds: 60, events: ['swish', 'make', 'miss', 'make', 'make', 'swish', 'miss', 'make', 'miss', 'swish', 'make', 'miss', 'make', 'make', 'swish', 'miss', 'make', 'miss'] }
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

// A round's pay so far, into the account as it's earned: one ledger entry
// per round ('game-<round>'), set to the round's running total every time it
// changes (streak bonuses in, penalties out, never under 0), as much as
// today's room allows. Returns { account, paid }.
export function payRound(account, round, game, amount, now = new Date()) {
  const id = `game-${round}`;
  const current = account.ledger.find(e => e.id === id);
  const others = { ...account, ledger: account.ledger.filter(e => e.id !== id) };
  const paid = Math.max(0, Math.min(Math.round(amount), roomToday(others, now)));
  if (paid === (current?.amount ?? 0)) return { account, paid };
  const t = current?.t ?? now.toISOString();
  const entry = { id, t, kind: 'game', game, amount: paid };
  return { account: { ...account, updated: now.toISOString(), ledger: current ? account.ledger.map(e => (e.id === id ? entry : e)) : [...account.ledger, entry] }, paid };
}

// A new round's id.
export function roundId(now = new Date()) {
  return entryId(now).slice('game-'.length);
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
export const DERBY = { pitches: 18, plate: 0.83, hr: 0.018, hit: 0.05, pay: { hr: 1, hit: 0.5 } };

// A pitch at difficulty `level` (0-1, see adapt): how long it takes to reach
// the end of the track, in ms (faster the harder); whether it's a change-up
// (from level 0.25); and how much it breaks sideways (from level 0.5: it
// looks different, the timing is the same).
export function pitchPlan(level, random = Math.random) {
  const base = 1000 - 540 * level;
  return { ms: Math.round(base * (0.85 + random() * 0.3)), changeUp: level >= 0.25 && random() < 0.35, breakX: level >= 0.5 ? random() * 2 - 1 : 0 };
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
export const TYPING = { codes: 8, digits: 10, pay: 3 };

// A ticket number: ten digits, shown in groups of four ("4829 1735 06").
export function ticketCode(random = Math.random) {
  return Array.from({ length: TYPING.digits }, () => Math.floor(random() * 10)).join('');
}
export const groupCode = code => code.replace(/(\d{4})(?=\d)/g, '$1 ');
// Typed right: the same digits, whatever spaces or dashes.
export const typedRight = (typed, code) => typed.replace(/\D/g, '') === code;

export const typingPayout = right => Math.round(right * TYPING.pay);

// ---- 整理彩券 (the team quiz) ----------------------------------------------------------
//
// Work that takes knowing your teams, and a new question every ticket (a
// wrong answer moves on to the next one too), so
// nothing can be learnt by rote:
// - `group`: which of four easily confused leagues (MLB, NPB, KBO or CPBL?);
// - `sport`: which sport, from the nickname alone ("Rangers": hockey or
//   baseball?);
// - `mixed`: which of any four leagues, across sports.
// The clue is the logo alone, the nickname alone (no city to give it away),
// or now and then both. The boxes come in a new order every ticket. A
// nickname is only shown when it fits one box alone (two "Tigers" in the
// boxes would be a coin toss, and nothing here is left to luck). Answer
// before the clock runs out or it counts as wrong.
// Questions a round: right or wrong, each counts.
export const SORT = { questions: 20, pay: 2, seconds: 6 };
// Leagues easily confused with each other.
export const SORT_SETS = {
  baseball: ['mlb', 'npb', 'kbo', 'cpbl'],
  basketball: ['nba', 'wnba', 'euroleague', 'bleague'],
  usa: ['nfl', 'nhl', 'mlb', 'nba'],
  soccer: ['epl', 'laliga', 'seriea', 'bundesliga'],
  soccer2: ['ligue1', 'mls', 'epl', 'bundesliga']
};
export const SORT_LEAGUES = [...new Set(Object.values(SORT_SETS).flat())];
export const SORT_SPORTS = ['baseball', 'basketball', 'football', 'hockey', 'soccer'];
const KINDS = [['group', 0.35], ['sport', 0.35], ['mixed', 0.3]];
const CLUES = { group: [['logo', 0.4], ['nick', 0.4], ['full', 0.2]], sport: [['nick', 0.65], ['logo', 0.35]], mixed: [['logo', 0.5], ['nick', 0.5]] };

const pickFrom = (list, random) => list[Math.floor(random() * list.length)];
const weighted = (pairs, random) => {
  let r = random();
  for (const [x, w] of pairs) if ((r -= w) < 0) return x;
  return pairs.at(-1)[0];
};
function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// One question: { kind, clue, boxes: [{ key, type: 'league' | 'sport' }],
// answer (a box key), league, team, nick }. `leagues` limits it to leagues
// with teams loaded; `last` is the team just shown (never twice running).
export function sortQuestion({ random = Math.random, leagues = SORT_LEAGUES, last = null } = {}) {
  const has = new Set(leagues.filter(l => leagueTeams(l).length));
  for (let tries = 0; tries < 40; tries++) {
    const kind = weighted(KINDS, random);
    let boxes;
    let boxOf;
    if (kind === 'group') {
      const group = pickFrom(Object.values(SORT_SETS), random).filter(l => has.has(l));
      if (group.length < 4) continue;
      boxes = shuffled(group, random).map(key => ({ key, type: 'league' }));
      boxOf = league => league;
    } else if (kind === 'sport') {
      boxes = shuffled(SORT_SPORTS, random).slice(0, 4).map(key => ({ key, type: 'sport' }));
      boxOf = league => familyOf(league);
    } else {
      const pool = shuffled([...has], random).slice(0, 4);
      if (pool.length < 4) continue;
      boxes = pool.map(key => ({ key, type: 'league' }));
      boxOf = league => league;
    }
    const keys = new Set(boxes.map(b => b.key));
    const candidates = [...has].filter(l => keys.has(boxOf(l)));
    if (!candidates.length) continue;
    const league = pickFrom(candidates, random);
    const team = pickFrom(leagueTeams(league), random);
    if (!team || team === last) continue;
    const clue = weighted(CLUES[kind], random);
    const nick = teamNick(league, team);
    // A nickname must point to one box only.
    if (clue !== 'logo') {
      const same = normalizeTeamName(clue === 'nick' ? nick : team);
      const clash = candidates.some(l => boxOf(l) !== boxOf(league) && leagueTeams(l).some(t => normalizeTeamName(clue === 'nick' ? teamNick(l, t) : t) === same));
      if (clash) continue;
    }
    return { kind, clue, boxes, answer: boxOf(league), league, team, nick };
  }
  return null;
}

export const sortPayout = right => Math.round(right * SORT.pay);

// ---- 罰球 (free throws) ------------------------------------------------------------------
//
// Ten shots. A marker sweeps back and forth across the aim bar, faster each
// shot, while the green zone in the middle narrows: stop it in the zone's
// middle half for a swish, anywhere in the zone for a make.
export const FREE_THROW = { shots: 18, pay: { swish: 1, make: 0.5 } };

// A shot at difficulty `level` (0-1, see adapt): the arrow's sweep (ms there
// and back) and the green's size, faster and narrower the harder.
export function shotPlan(level) {
  return { period: 1300 - 630 * level, zone: 0.13 - 0.072 * level };
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
  const best = { typing: ['ok', TYPING.codes], sort: ['ok', SORT.questions], derby: ['hr', DERBY.pitches], freethrow: ['swish', FREE_THROW.shots] }[game];
  return scoreRound(game, Array(best[1]).fill(best[0])).total;
}
