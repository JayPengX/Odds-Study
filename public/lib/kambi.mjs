// Kambi's public odds feed (the bookmaker behind Unibet and others): the
// sports ESPN doesn't carry, from Asian baseball to tennis, badminton, table
// tennis, volleyball and snooker. Read through the shared sports proxy, which
// caches each list for every viewer (2 minutes) and trims it to the fields
// read here, so the feed sees one request per league per few minutes. Odds come as thousandths (1950 = 1.95) and lines as
// thousandths too (1500 = 1.5); a match lists its home player first.
import { devigProportional } from './odds.mjs';
import { LEAGUES, normalizeTeamName, teamZh } from './teams.mjs';

export const KAMBI = 'https://eu-offering-api.kambicdn.com/offering/v2018/ub';

export function kambiUrl(path, kind = 'matches') {
  const parts = path.split('/');
  while (parts.length < 4) parts.push('all');
  return `${KAMBI}/listView/${parts.join('/')}/${kind}.json?lang=en_GB&market=GB&useCombined=true`;
}

const outcome = (offer, type) => offer.outcomes.find(o => o.type === type);
const odds = o => (o && o.odds > 1000 ? o.odds / 1000 : null);

// Fair chances from one offer's two (or three) prices, the margin removed.
function fairPair(a, b) {
  const pa = odds(a);
  const pb = odds(b);
  if (!pa || !pb) return null;
  return devigProportional([1 / pa, 1 / pb]);
}

// Upcoming matches of one league: games shaped like the rest of the page's
// ({ id, sport, startUtc, away, home, draftKings: fair win chances, total,
// spread }), with `book: 'kambi'`. `limit` keeps busy leagues (table tennis
// runs matches around the clock) to the next few.
export function parseKambiEvents(data, sport, now = new Date(), limit = Infinity) {
  const games = [];
  for (const item of data?.events || []) {
    const e = item.event;
    if (!e || e.state !== 'NOT_STARTED' || Date.parse(e.start) <= now.getTime()) continue;
    if (!e.homeName || !e.awayName) continue;
    const offers = item.betOffers || [];
    const match = offers.find(o => o.betOfferType?.englishName === 'Match' || /match odds|moneyline/i.test(o.criterion?.englishLabel || ''));
    if (!match) continue;
    // Two-way winner; a three-way one (a draw after regulation) is split between the two.
    const win = fairPair(outcome(match, 'OT_ONE'), outcome(match, 'OT_TWO'));
    if (!win) continue;
    const game = {
      id: `${sport}_${e.start.slice(0, 13)}_${normalizeTeamName(e.awayName)}_${normalizeTeamName(e.homeName)}`.replaceAll(' ', ''),
      sport,
      startUtc: new Date(e.start).toISOString(),
      away: { en: e.awayName, zh: teamZh(sport, e.awayName) },
      home: { en: e.homeName, zh: teamZh(sport, e.homeName) },
      draftKings: { home: win[0], away: win[1] },
      polymarket: null,
      polymarketLiquidity: null,
      total: null,
      spread: null,
      book: 'kambi',
      kambiId: e.id,
      group: e.group || ''
    };
    const handicap = offers.find(o => o.betOfferType?.englishName === 'Handicap');
    if (handicap) {
      const home = outcome(handicap, 'OT_ONE');
      const away = outcome(handicap, 'OT_TWO');
      const fair = fairPair(away, home);
      if (fair && away?.line != null) game.spread = { awayLine: away.line / 1000, awayFair: fair[0] };
    }
    const total = offers.find(o => o.betOfferType?.englishName === 'Over/Under');
    if (total) {
      const over = outcome(total, 'OT_OVER');
      const fair = fairPair(over, outcome(total, 'OT_UNDER'));
      if (fair && over?.line != null) game.total = { line: over.line / 1000, overFair: fair[0] };
    }
    games.push(game);
  }
  return games.sort((a, b) => a.startUtc.localeCompare(b.startUtc)).slice(0, limit);
}

export async function fetchKambiLeague(key, now = new Date(), getJson) {
  const league = LEAGUES[key];
  return parseKambiEvents(await getJson(kambiUrl(league.kambi), 'kambi-events'), key, now, league.cap ?? Infinity);
}

// ---- Live scores ---------------------------------------------------------------

// Every match Kambi has in play: kambiId -> { sport, home, away, score, sets }
// where `sets` is each side's score in every set played so far (-1: not
// played), and `score` the match score (sets won, or runs/points).
export function parseKambiLive(data) {
  const out = new Map();
  for (const item of data?.liveEvents || []) {
    const e = item.event;
    const live = item.liveData || {};
    if (!e) continue;
    const sets = live.statistics?.sets;
    out.set(e.id, {
      state: e.state,
      home: e.homeName,
      away: e.awayName,
      score: { home: Number(live.score?.home) || 0, away: Number(live.score?.away) || 0 },
      sets: sets ? { home: sets.home.filter(x => x >= 0), away: sets.away.filter(x => x >= 0) } : null
    });
  }
  return out;
}

export async function fetchKambiLive(getJson) {
  return parseKambiLive(await getJson(`${KAMBI}/event/live/open.json?lang=en_GB&market=GB`, 'kambi-events'));
}

// Sets each side has won from the set scores. A set counts once someone has
// won it: reached the set's target (the deciding set's, if it has its own)
// two clear, or the cap (badminton's 30), or in tennis 7 games (a tiebreak).
export function setsWon(sets, spec) {
  const won = { home: 0, away: 0 };
  if (!sets || !spec) return won;
  const n = Math.min(sets.home.length, sets.away.length);
  for (let i = 0; i < n; i++) {
    const h = sets.home[i];
    const a = sets.away[i];
    const hi = Math.max(h, a);
    const target = spec.last && i === spec.bestOf - 1 ? spec.last : spec.target;
    const done = (hi >= target && Math.abs(h - a) >= 2) || (spec.cap && hi >= spec.cap) || (spec.unit === 'games' && hi === 7);
    if (done) won[h > a ? 'home' : 'away']++;
  }
  return won;
}

// A match's result once the live score shows it decided: someone has won
// the sets they need. { status: 'final', homeScore, awayScore (sets won),
// homeSets, awaySets (each set's score) }, or null while it isn't decided.
export function decidedFromLive(live, sport) {
  const spec = LEAGUES[sport]?.sets;
  if (!live?.sets || !spec?.bestOf) return null;
  const need = Math.ceil(spec.bestOf / 2);
  const won = setsWon(live.sets, spec);
  if (won.home < need && won.away < need) return null;
  return { status: 'final', homeScore: won.home, awayScore: won.away, homeSets: live.sets.home, awaySets: live.sets.away };
}
