// Fetches upcoming MLB and Premier League odds (DraftKings via ESPN,
// Polymarket), the next F1 race-winner market and championship (futures)
// markets through the shared sports proxy, which adds the CORS headers
// Polymarket doesn't send.
import { americanToProbability, devigProportional, devigPower } from './odds.mjs';
import { normalizeTeamName, teamZh, LEAGUES, familyOf, isSoccer, rememberLogo, rememberTeams, hasTeams } from './teams.mjs';
import { runOrder } from './live.mjs';
import { fetchKambiLeague, fetchKambiLive, decidedFromLive, setsWon } from './kambi.mjs';
import { KAMBI_LEAGUES } from './teams.mjs';

export const PROXY_URL = 'https://sports-proxy.pengzjay.workers.dev';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const GAMMA = 'https://gamma-api.polymarket.com';
const POLYMARKET_TAG = { mlb: 100381, epl: 306, f1: 100389, nba: 745 };
const MLB_DAYS_AHEAD = 4;
// Soccer rounds can be two weeks apart (international breaks).
const EPL_DAYS_AHEAD = 21;
const MATCH_TOLERANCE_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

// Taiwan date (YYYY-MM-DD) of a moment. Taiwan has no daylight saving time.
export function taipeiDayKey(date) {
  return new Date(new Date(date).getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

// End of the day `days` after today, Taiwan time. MLB games are listed up to
// the end of tomorrow (days = 1).
export function lotteryWindowEnd(now, days = 1) {
  const [y, m, d] = taipeiDayKey(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1 + days) - TAIPEI_OFFSET_MS);
}

// A Premier League round is listed once it's close: its first game starts
// within the next 3 days (Taiwan time), not two weeks out after a break.
export const EPL_OPEN_DAYS = 3;

// The NBA only shows during its season: from opening night (the first
// Tuesday on or after 19 October) to the end of June, after the Finals.
export function nbaInSeason(now) {
  const day = taipeiDayKey(now);
  const year = Number(day.slice(0, 4));
  const opener = new Date(Date.UTC(year, 9, 19));
  opener.setUTCDate(19 + ((2 - opener.getUTCDay() + 7) % 7));
  return day >= opener.toISOString().slice(0, 10) || day <= `${year}-06-30`;
}

const MATCHWEEK_MAX_GAP_MS = 4 * DAY_MS;

// Premier League games of the next matchweek. ESPN doesn't label rounds, but
// every club plays once per round: from the next game, take games in order
// until a club would play twice (or the fixtures stop for over 4 days).
export function nextMatchweek(games) {
  const sorted = [...games].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  const clubs = new Set();
  const week = [];
  for (const game of sorted) {
    const teams = [normalizeTeamName(game.away.en ?? game.away), normalizeTeamName(game.home.en ?? game.home)];
    const last = week.at(-1);
    if (teams.some(team => clubs.has(team))) break;
    if (last && Date.parse(game.startUtc) - Date.parse(last.startUtc) > MATCHWEEK_MAX_GAP_MS) break;
    teams.forEach(team => clubs.add(team));
    week.push(game);
  }
  return week;
}

// What the page lists, like the lottery: MLB up to the end of tomorrow (Taiwan
// time), the Premier League's whole next matchweek (it has far fewer games)
// once that round is close.
export function lotteryGames(games, now) {
  const windowEnd = lotteryWindowEnd(now).getTime();
  const within = (g, days) => Date.parse(g.startUtc) < lotteryWindowEnd(now, days).getTime();
  const round = nextMatchweek(games.filter(g => g.sport === 'epl'));
  const epl = round.length && Date.parse(round[0].startUtc) < lotteryWindowEnd(now, EPL_OPEN_DAYS).getTime() ? round : [];
  const rest = games.filter(g => {
    if (g.sport === 'epl') return false;
    const family = familyOf(g.sport);
    // Weekly sports (football, soccer) a few days ahead; daily ones to the end of tomorrow.
    if (family === 'football') return within(g, 5);
    if (family === 'soccer') return within(g, EPL_OPEN_DAYS);
    return Date.parse(g.startUtc) < windowEnd;
  });
  return [...rest, ...epl].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

// Championship markets. Polymarket lists next season's market before this
// one ends, so the lowest year in the title wins.
export const FUTURES = [
  { key: 'ws', sport: 'mlb', title: /World Series Champion/i },
  { key: 'al', sport: 'mlb', title: /American League Champion$/i },
  { key: 'nl', sport: 'mlb', title: /National League Champion$/i },
  { key: 'epl', sport: 'epl', title: /^EPL: \d{4} Champion$/i },
  { key: 'nba', sport: 'nba', title: /^NBA: \d{4} Champion$/i }
];

// More championships, found with Polymarket's search after the page opens
// (they aren't under the tags the page already reads).
export const EXTRA_FUTURES = [
  { key: 'nfl', sport: 'nfl', query: 'Pro Football Champion', title: /^Pro Football: \d{4} Champion$/i },
  { key: 'nhl', sport: 'nhl', query: 'NHL Champion', title: /^NHL: \d{4} Champion$/i },
  { key: 'wnba', sport: 'wnba', query: 'WNBA Champion', title: /^WNBA: \d{4} Champion$/i },
  { key: 'ncaaf', sport: 'ncaaf', query: 'NCAA Football National Champion', title: /^NCAA Football: \d{4} National Champion$/i },
  { key: 'ucl', sport: 'ucl', query: 'UEFA Champions League Champion', title: /^UEFA Champions League: \d{4} Champion$/i },
  { key: 'uel', sport: 'uel', query: 'UEFA Europa League Champion', title: /^UEFA Europa League: \d{4} Champion$/i },
  { key: 'laliga', sport: 'laliga', query: 'LALIGA Champion', title: /^LALIGA: \d{4} Champion$/i },
  { key: 'seriea', sport: 'seriea', query: 'Serie A Champion', title: /^Serie A: \d{4} Champion$/i },
  { key: 'bundesliga', sport: 'bundesliga', query: 'Bundesliga Champion', title: /^Bundesliga: \d{4} Champion$/i },
  { key: 'ligue1', sport: 'ligue1', query: 'Ligue 1 Champion', title: /^Ligue 1: \d{4} Champion$/i },
  { key: 'mls', sport: 'mls', query: 'MLS Cup Winner', title: /^MLS Cup Winner \d{4}$/i },
  { key: 'f1drivers', sport: 'f1', query: "F1 Drivers' Champion", title: /^F1 Drivers' Champion$/i },
  { key: 'f1constructors', sport: 'f1', query: "F1 Constructors' Champion", title: /^F1 Constructors' Champion$/i }
];

// The team (or driver) a championship market is about: Polymarket's short
// name when it has one, else from the question ("Will the X win the ...?",
// "Will X be (named) the ... Champion?").
export function futureTeamName(market) {
  const short = (market.groupItemTitle || '').trim();
  if (short) return short;
  return /^Will (?:the )?(.+?) (?:win the|be (?:named )?the) /i.exec(market.question || '')?.[1] ?? null;
}

export function proxied(url, trim) {
  return `${PROXY_URL}/sports-proxy?url=${encodeURIComponent(url)}${trim ? `&trim=${trim}` : ''}`;
}

// At most this many requests at once: the page asks for dozens of lists at
// start-up (leagues, championships), and a burst is what gets a client
// throttled. The rest wait their turn.
const MAX_CONCURRENT = 6;
let running = 0;
const queue = [];
async function slot(task) {
  if (running >= MAX_CONCURRENT) await new Promise(resolve => queue.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    queue.shift()?.();
  }
}

// One retry after a short pause: a dropped connection on a phone network
// shouldn't lose a whole sport.
export async function getJson(url, trim, retries = 1) {
  try {
    const res = await slot(() => fetch(proxied(url, trim), { signal: AbortSignal.timeout(30_000) }));
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise(resolve => setTimeout(resolve, 800));
    return getJson(url, trim, retries - 1);
  }
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function parseJsonArray(text) {
  if (Array.isArray(text)) return text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- ESPN (DraftKings) --------------------------------------------------------

function closeProbability(side) {
  return americanToProbability(side?.close?.odds);
}

export function parseEspnScoreboard(data, sport) {
  const games = [];
  for (const event of data.events || []) {
    const comp = event.competitions?.[0];
    if (!comp || comp.status?.type?.state !== 'pre') continue;
    const teams = Object.fromEntries(comp.competitors.map(c => [c.homeAway, c.team.displayName]));
    for (const c of comp.competitors) rememberLogo(sport, c.team.displayName, c.team.logo);
    const odds = comp.odds?.[0];
    const ml = odds?.moneyline;
    let outcomes = null;
    if (isSoccer(sport)) {
      const fair = devigProportional([closeProbability(ml?.away), closeProbability(ml?.draw), closeProbability(ml?.home)]);
      if (fair) outcomes = { away: fair[0], draw: fair[1], home: fair[2] };
    } else {
      const fair = devigProportional([closeProbability(ml?.away), closeProbability(ml?.home)]);
      if (fair) outcomes = { away: fair[0], home: fair[1] };
    }
    let total = null;
    const over = odds?.total?.over?.close;
    const under = odds?.total?.under?.close;
    if (over?.line && under) {
      const line = Number(String(over.line).replace(/^[ou]/, ''));
      const fair = devigProportional([americanToProbability(over.odds), americanToProbability(under.odds)]);
      if (Number.isFinite(line) && fair) total = { line, overFair: fair[0] };
    }
    // Run line / handicap from the away team's side: { awayLine: -1.5, awayFair }.
    let spread = null;
    const awaySpread = odds?.pointSpread?.away?.close;
    const homeSpread = odds?.pointSpread?.home?.close;
    if (awaySpread?.line && homeSpread) {
      const awayLine = Number(awaySpread.line);
      const fair = devigProportional([americanToProbability(awaySpread.odds), americanToProbability(homeSpread.odds)]);
      // Baseball and soccer lines are half runs/goals; football and basketball
      // lines can be whole points (a push is rare enough to ignore).
      const whole = ['football', 'basketball'].includes(familyOf(sport));
      if (Number.isFinite(awayLine) && (whole || awayLine % 1 !== 0) && fair) spread = { awayLine, awayFair: fair[0] };
    }
    games.push({ sport, startUtc: new Date(event.date).toISOString(), away: teams.away, home: teams.home, outcomes, total, spread });
  }
  return games;
}

async function fetchEspnDays(sport, path, days) {
  const pages = await Promise.all(days.map(day => getJson(`${ESPN}/${path}/scoreboard?dates=${yyyymmdd(day)}`).catch(() => null)));
  if (pages.every(p => p === null)) throw new Error(`ESPN ${sport} unreachable`);
  return pages.filter(Boolean).flatMap(page => parseEspnScoreboard(page, sport));
}

function mlbDays(now) {
  const days = [];
  for (let d = -1; d < MLB_DAYS_AHEAD; d++) days.push(new Date(now.getTime() + d * DAY_MS));
  return days;
}

// The league calendar lists every matchday, so only those dates get fetched.
export function eplMatchdays(scoreboard, now) {
  const calendar = scoreboard?.leagues?.[0]?.calendar || [];
  const from = now.getTime() - DAY_MS;
  const to = now.getTime() + EPL_DAYS_AHEAD * DAY_MS;
  return calendar
    .map(entry => new Date(typeof entry === 'string' ? entry : entry?.startDate))
    .filter(d => Number.isFinite(d.getTime()) && d.getTime() >= from && d.getTime() <= to);
}

async function fetchEspnEpl(now) {
  return fetchSoccer('epl', now);
}

// Soccer leagues: their calendar's matchdays in the next three weeks.
async function fetchSoccer(key, now) {
  const path = LEAGUES[key].path;
  const scoreboard = await getJson(`${ESPN}/${path}/scoreboard`);
  const days = eplMatchdays(scoreboard, now);
  if (days.length === 0) return parseEspnScoreboard(scoreboard, key);
  return fetchEspnDays(key, path, days);
}

// Every other league: football's current week (its default scoreboard),
// daily sports from yesterday to two days ahead (US dates run behind Taiwan's).
async function fetchLeague(key, now) {
  const { family, path } = LEAGUES[key];
  if (family === 'soccer') return fetchSoccer(key, now);
  if (family === 'football') return parseEspnScoreboard(await getJson(`${ESPN}/${path}/scoreboard`), key);
  return fetchEspnDays(key, path, [-1, 0, 1, 2].map(d => new Date(now.getTime() + d * DAY_MS)));
}

// Leagues fetched from ESPN alone (DraftKings); MLB and the Premier League
// also have Polymarket.
export const EXTRA_LEAGUES = Object.keys(LEAGUES).filter(key => LEAGUES[key].path && !['mlb', 'epl'].includes(key));

// ---- Polymarket ---------------------------------------------------------------

async function fetchPolymarketEvents(tagId, trim) {
  const events = [];
  for (let page = 0; page < 10; page++) {
    const batch = await getJson(
      `${GAMMA}/events?tag_id=${tagId}&closed=false&limit=100&offset=${page * 100}&order=startTime&ascending=true`,
      trim
    );
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return events;
}

function eventTeams(event) {
  if (!Array.isArray(event.teams) || event.teams.length !== 2) return null;
  const away = event.teams.find(t => t.ordering === 'away')?.name;
  const home = event.teams.find(t => t.ordering === 'home')?.name;
  return away && home ? { away, home } : null;
}

// MLB: one combined market whose question is the event title.
export function parsePolymarketMlb(events, now) {
  const games = [];
  for (const event of events) {
    const start = Date.parse(event.startTime);
    if (!Number.isFinite(start) || start <= now.getTime()) continue;
    const market = (event.markets || []).find(m => m.question === event.title);
    const prices = market && parseJsonArray(market.outcomePrices)?.map(Number);
    const outcomes = market && parseJsonArray(market.outcomes);
    if (!prices || !outcomes) continue;
    const teams = eventTeams(event) ?? { away: outcomes[0], home: outcomes[1] };
    const iAway = outcomes.indexOf(teams.away);
    const iHome = outcomes.indexOf(teams.home);
    if (iAway < 0 || iHome < 0) continue;
    const fair = devigProportional([prices[iAway], prices[iHome]]);
    if (!fair) continue;
    games.push({
      sport: 'mlb',
      startUtc: new Date(start).toISOString(),
      ...teams,
      outcomes: { away: fair[0], home: fair[1] },
      liquidity: Math.round(Number(market.liquidity) || 0)
    });
  }
  return games;
}

// EPL: three separate Yes/No markets per match ("Will X win on …?",
// "Will X vs. Y end in a draw?", "Will Y win on …?").
export function parsePolymarketEpl(events, now) {
  const games = [];
  for (const event of events) {
    const start = Date.parse(event.startTime);
    const teams = eventTeams(event);
    if (!Number.isFinite(start) || start <= now.getTime() || !teams) continue;
    const yes = {};
    let liquidity = Infinity;
    for (const market of event.markets || []) {
      const outcomes = parseJsonArray(market.outcomes);
      const prices = parseJsonArray(market.outcomePrices);
      if (!outcomes || !prices || outcomes.length !== 2) continue;
      const price = Number(prices[outcomes.findIndex(o => /^yes$/i.test(o))]);
      if (!(price >= 0)) continue;
      const question = market.question || '';
      let key = null;
      if (/end in a draw/i.test(question)) key = 'draw';
      else {
        const who = /^will (.+?) win\b/i.exec(question)?.[1];
        if (who && normalizeTeamName(who) === normalizeTeamName(teams.away)) key = 'away';
        else if (who && normalizeTeamName(who) === normalizeTeamName(teams.home)) key = 'home';
      }
      if (!key || key in yes) continue;
      yes[key] = price;
      liquidity = Math.min(liquidity, Number(market.liquidity) || 0);
    }
    const fair = devigProportional([yes.away, yes.draw, yes.home]);
    if (!fair) continue;
    games.push({
      sport: 'epl',
      startUtc: new Date(start).toISOString(),
      ...teams,
      outcomes: { away: fair[0], draw: fair[1], home: fair[2] },
      liquidity: Math.round(liquidity)
    });
  }
  return games;
}

export function parseF1RaceWinner(events, now) {
  const event = events
    .filter(e => /-grand-prix-winner-\d{4}-\d{2}-\d{2}$/.test(e.slug) && Date.parse(e.startTime) > now.getTime())
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))[0];
  if (!event) return null;
  const drivers = (event.markets || [])
    .filter(m => !m.closed)
    .map(m => ({ name: m.groupItemTitle || m.question, raw: Number(parseJsonArray(m.outcomePrices)?.[0]) }))
    // Every priced driver, like the lottery's full list; Polymarket's unpriced
    // placeholders ("Driver A", "Other") drop out here.
    .filter(d => d.raw > 0 && !/^(driver [a-z]|other)$/i.test(d.name));
  const fair = devigPower(drivers.map(d => d.raw));
  return {
    title: event.title,
    slug: event.slug,
    startUtc: new Date(event.startTime).toISOString(),
    drivers: drivers
      .map((d, i) => ({ name: d.name, fair: fair[i] }))
      .sort((a, b) => b.fair - a.fair)
  };
}

// The next race weekend's qualifying and race start from ESPN's F1
// scoreboard: { qualifyingUtc, raceUtc } for the race nearest `startUtc`.
export function parseF1Schedule(data, startUtc) {
  let best = null;
  for (const event of data?.events || []) {
    const comps = event.competitions || [];
    const race = comps.find(c => c.type?.abbreviation === 'Race');
    const qual = comps.find(c => c.type?.abbreviation === 'Qual');
    if (!race) continue;
    const gap = Math.abs(Date.parse(race.date) - Date.parse(startUtc));
    if (gap > 4 * DAY_MS || (best && gap >= best.gap)) continue;
    best = { gap, raceUtc: new Date(race.date).toISOString(), qualifyingUtc: qual ? new Date(qual.date).toISOString() : null };
  }
  return best ? { raceUtc: best.raceUtc, qualifyingUtc: best.qualifyingUtc } : null;
}

// ---- Futures ---------------------------------------------------------------

// "2026" for MLB; "2026/27" for leagues whose season spans two years (the
// questions say "2026-27", the titles only "2027").
function seasonLabel(event, sport) {
  const span = /(\d{4})-(\d{2})\b/.exec((event.markets || []).map(m => m.question).join(' '));
  if (span) return `${span[1]}/${span[2]}`;
  const year = Number(/\d{4}/.exec(event.title)?.[0]);
  if (!year) return '';
  return sport === 'mlb' ? String(year) : `${year - 1}/${String(year).slice(2)}`;
}

// "Will (the) Los Angeles Dodgers win the 2026 World Series?" -> the team.
// Polymarket's placeholder markets ("Team C", "another team") are dropped, and
// so are eliminated teams (price 0).
export function parseFutures(events, sport, markets = FUTURES.filter(f => f.sport === sport)) {
  const out = [];
  for (const market of markets) {
    const year = e => Number(/\d{4}/.exec(e.title)?.[0] ?? 9999);
    const event = events.filter(e => market.title.test(e.title || '') && !e.closed).sort((a, b) => year(a) - year(b))[0];
    if (!event) continue;
    const teams = [];
    for (const m of event.markets || []) {
      const name = futureTeamName(m);
      if (!name || m.closed || /^(team [a-z]{1,3}|another team|other|driver [a-z]{1,3})$/i.test(name)) continue;
      const outcomes = parseJsonArray(m.outcomes);
      const prices = parseJsonArray(m.outcomePrices);
      const price = Number(prices?.[outcomes?.findIndex(o => /^yes$/i.test(o)) ?? 0]);
      if (price > 0) teams.push({ name, price });
    }
    const fair = devigProportional(teams.map(t => t.price));
    if (!fair || teams.length < 2) continue;
    out.push({
      key: market.key,
      sport: market.sport,
      slug: event.slug,
      season: seasonLabel(event, market.sport),
      teams: teams
        .map((t, i) => ({ name: { en: t.name, zh: teamZh(market.sport, t.name) }, fair: fair[i] }))
        .sort((a, b) => b.fair - a.fair)
    });
  }
  return out;
}

// The championships found by search, loaded in the background.
export async function loadExtraFutures() {
  const results = await Promise.allSettled(
    EXTRA_FUTURES.map(market => getJson(`${GAMMA}/public-search?q=${encodeURIComponent(market.query)}&limit_per_type=8&events_status=active`).then(d => parseFutures(d?.events || [], market.sport, [market])))
  );
  return results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
}

// ---- Merge --------------------------------------------------------------------

function sameGame(a, b) {
  return (
    a.sport === b.sport &&
    normalizeTeamName(a.away) === normalizeTeamName(b.away) &&
    normalizeTeamName(a.home) === normalizeTeamName(b.home) &&
    Math.abs(Date.parse(a.startUtc) - Date.parse(b.startUtc)) <= MATCH_TOLERANCE_MS
  );
}

// DraftKings team names win (ESPN's naming is the stabler of the two).
export function mergeGames(dkGames, pmGames) {
  const used = new Set();
  const merged = dkGames.map(dk => {
    const i = pmGames.findIndex((pm, j) => !used.has(j) && sameGame(dk, pm));
    if (i >= 0) used.add(i);
    return { base: dk, dk, pm: i >= 0 ? pmGames[i] : null };
  });
  pmGames.forEach((pm, j) => {
    if (!used.has(j)) merged.push({ base: pm, dk: null, pm });
  });
  return merged
    .map(({ base, dk, pm }) => ({
      id: `${base.sport}_${base.startUtc.slice(0, 13)}_${normalizeTeamName(base.away)}_${normalizeTeamName(base.home)}`.replaceAll(' ', ''),
      sport: base.sport,
      startUtc: base.startUtc,
      away: { en: base.away, zh: teamZh(base.sport, base.away) },
      home: { en: base.home, zh: teamZh(base.sport, base.home) },
      draftKings: dk?.outcomes ?? null,
      polymarket: pm?.outcomes ?? null,
      polymarketLiquidity: pm?.liquidity ?? null,
      total: dk?.total ?? null,
      spread: dk?.spread ?? null
    }))
    .filter(g => g.draftKings || g.polymarket)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

// `onProgress(share)` is called as each source finishes (0 to 1).
export async function loadOdds(now = new Date(), onProgress) {
  let finished = 0;
  const track = (promise, _, all) => promise.finally(() => onProgress?.(++finished / all.length));
  const results = await Promise.allSettled(
    [
      fetchEspnDays('mlb', 'baseball/mlb', mlbDays(now)),
      fetchPolymarketEvents(POLYMARKET_TAG.mlb, 'polymarket-events'),
      fetchEspnEpl(now),
      fetchPolymarketEvents(POLYMARKET_TAG.epl, 'polymarket-events'),
      fetchPolymarketEvents(POLYMARKET_TAG.f1),
      fetchPolymarketEvents(POLYMARKET_TAG.nba, 'polymarket-events'),
      getJson(`${ESPN}/racing/f1/scoreboard`)
    ].map(track)
  );
  if (results.every(r => r.status === 'rejected')) throw results[0].reason;
  const [mlbDk, mlbPm, eplDk, eplPm, f1, nbaPm, f1Espn] = results.map(r => (r.status === 'fulfilled' ? r.value : []));
  const race = parseF1RaceWinner(f1, now);
  if (race) Object.assign(race, { qualifyingUtc: parseF1Schedule(f1Espn, race.startUtc)?.qualifyingUtc ?? null });
  return {
    loadedAt: now.toISOString(),
    games: lotteryGames(mergeGames([...mlbDk, ...eplDk], [...parsePolymarketMlb(mlbPm, now), ...parsePolymarketEpl(eplPm, now)]), now),
    f1: race,
    futures: [...parseFutures(mlbPm, 'mlb'), ...parseFutures(eplPm, 'epl'), ...(nbaInSeason(now) ? parseFutures(nbaPm, 'nba') : [])]
  };
}

// ---- Results (for saved slips) ------------------------------------------------

const ESPN_PATH = Object.fromEntries(Object.entries(LEAGUES).map(([key, league]) => [key, league.path]));
const VOID_STATUS = /POSTPONED|CANCELED|CANCELLED|FORFEIT|ABANDONED/;

// Every game on an ESPN scoreboard with how it stands: 'final', 'void'
// (called off) or 'pending', and for baseball the runs of each inning.
export function parseEspnResults(data, sport) {
  const games = [];
  for (const event of data.events || []) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const side = ha => comp.competitors.find(c => c.homeAway === ha);
    const away = side('away');
    const home = side('home');
    if (!away || !home) continue;
    const type = comp.status?.type || {};
    const status = VOID_STATUS.test(type.name || '') ? 'void' : type.completed && type.state === 'post' ? 'final' : 'pending';
    games.push({
      sport,
      espnId: event.id,
      startUtc: new Date(event.date).toISOString(),
      away: away.team.displayName,
      home: home.team.displayName,
      status,
      awayScore: Number(away.score),
      homeScore: Number(home.score),
      awayInnings: (away.linescores || []).map(l => Number(l.value) || 0),
      homeInnings: (home.linescores || []).map(l => Number(l.value) || 0),
      // Where a game in progress is: 'in', ESPN's short detail ("Top 7th",
      // "Q3 5:21", "67'") and the period number.
      state: type.state ?? null,
      detail: type.shortDetail || type.detail || '',
      period: Number(comp.status?.period) || 0
    });
  }
  return games;
}

// The race winner from ESPN's F1 scoreboard: { status, winner } for the race
// starting near `startUtc`.
export function parseEspnRace(data, startUtc) {
  for (const event of data.events || []) {
    for (const comp of event.competitions || []) {
      if (comp.type?.abbreviation !== 'Race') continue;
      if (Math.abs(Date.parse(comp.date) - Date.parse(startUtc)) > MATCH_TOLERANCE_MS) continue;
      const type = comp.status?.type || {};
      if (VOID_STATUS.test(type.name || '')) return { status: 'void' };
      if (!type.completed) return { status: 'pending' };
      const first = (comp.competitors || []).find(c => c.winner) ?? (comp.competitors || []).find(c => Number(c.order) === 1);
      const name = c => c.athlete?.displayName || c.athlete?.fullName;
      const podium = [...(comp.competitors || [])].filter(c => Number(c.order) >= 1).sort((a, b) => Number(a.order) - Number(b.order)).slice(0, 3).map(name);
      return first ? { status: 'final', winner: name(first), ...(podium.length === 3 ? { podium } : {}) } : { status: 'pending' };
    }
  }
  return null;
}

// A championship's winner once Polymarket has resolved the market.
export function parseFutureResult(events) {
  const event = events?.[0];
  if (!event?.closed) return { status: 'pending' };
  for (const m of event.markets || []) {
    const name = futureTeamName(m);
    const outcomes = parseJsonArray(m.outcomes);
    const prices = parseJsonArray(m.outcomePrices);
    const yes = Number(prices?.[outcomes?.findIndex(o => /^yes$/i.test(o)) ?? 0]);
    if (name && yes >= 0.99) return { status: 'final', winner: name };
  }
  return { status: 'pending' };
}

// A tennis match from ESPN's scoreboard (the whole tournament's matches),
// found by the two players' names in either order: sets won and each set's
// games, from the leg's home and away. A retirement or walkover is void.
export function parseEspnTennis(data, home, away) {
  const key = name => normalizeTeamName(name);
  const want = new Set([key(home), key(away)]);
  for (const event of data?.events || []) {
    for (const grouping of event.groupings || []) {
      for (const comp of grouping.competitions || []) {
        const players = comp.competitors || [];
        const names = players.map(c => key(c.athlete?.displayName || c.athlete?.fullName || ''));
        if (players.length !== 2 || !names.every(n => want.has(n)) || names[0] === names[1]) continue;
        const type = comp.status?.type || {};
        if (/RETIRED|WALKOVER|CANCELED|CANCELLED|POSTPONED|ABANDONED/.test(type.name || '')) return { status: 'void' };
        if (!type.completed) return { status: 'pending' };
        const h = players[names.indexOf(key(home))];
        const a = players[names.indexOf(key(away))];
        const homeSets = (h.linescores || []).map(l => Number(l.value) || 0);
        const awaySets = (a.linescores || []).map(l => Number(l.value) || 0);
        const won = side => homeSets.filter((g, i) => (side === 'home' ? g > awaySets[i] : awaySets[i] > g)).length;
        return { status: 'final', homeScore: won('home'), awayScore: won('away'), homeSets, awaySets };
      }
    }
  }
  return null;
}

// ESPN files games under the US Eastern date.
function espnDates(startUtc) {
  const t = Date.parse(startUtc);
  return [...new Set([4, 5].map(h => yyyymmdd(new Date(t - h * 3_600_000))))];
}

// Outcomes for saved-slip legs that have started: legId -> outcome (see
// legResult in account.mjs). Legs whose results can't be fetched are left out.
export async function fetchOutcomes(legs, now = new Date()) {
  const out = new Map();
  const pages = new Map();
  const page = url => {
    if (!pages.has(url)) pages.set(url, getJson(url).catch(() => null));
    return pages.get(url);
  };
  await Promise.all(
    legs.map(async leg => {
      if (leg.kind === 'future') {
        if (!leg.eventSlug) return;
        const events = await page(`${GAMMA}/events?slug=${encodeURIComponent(leg.eventSlug)}`);
        if (events) out.set(leg.id, parseFutureResult(events));
        return;
      }
      if (!leg.start || Date.parse(leg.start) > now.getTime()) return;
      if (leg.kind === 'f1' || leg.kind === 'f1podium') {
        const data = await page(`${ESPN}/racing/f1/scoreboard?dates=${yyyymmdd(new Date(leg.start))}`);
        const result = data && parseEspnRace(data, leg.start);
        if (result) out.set(leg.id, result);
        return;
      }
      const league = LEAGUES[leg.sport];
      if (league?.results) {
        const data = await page(`${ESPN}/${league.results}/scoreboard?dates=${yyyymmdd(new Date(leg.start))}`);
        const result = data && parseEspnTennis(data, leg.home, leg.away);
        if (result && result.status !== 'pending') {
          out.set(leg.id, result);
          return;
        }
      }
      // Kambi's sports: the result once the live score shows the match decided.
      if (league?.kambi && leg.kambiId) {
        if (!pages.has('kambi-live')) pages.set('kambi-live', fetchKambiLive(getJson).catch(() => null));
        const live = await pages.get('kambi-live');
        const result = live && decidedFromLive(live.get(leg.kambiId), leg.sport);
        if (result) out.set(leg.id, result);
        else if (live?.get(leg.kambiId)) out.set(leg.id, kambiInPlay(live.get(leg.kambiId), leg.sport));
        return;
      }
      const path = ESPN_PATH[leg.sport];
      if (!path) return;
      for (const date of espnDates(leg.start)) {
        const data = await page(`${ESPN}/${path}/scoreboard?dates=${date}`);
        const game = data && parseEspnResults(data, leg.sport).find(g => sameGame(g, { sport: leg.sport, away: leg.away, home: leg.home, startUtc: leg.start }));
        if (game) {
          // 第N分 needs the order the runs came in: the game's scoring plays.
          if (leg.kind === 'nextrun' && game.status === 'final') {
            const summary = await page(`${ESPN}/${path}/summary?event=${game.espnId}`);
            if (!summary) return;
            out.set(leg.id, { ...game, runOrder: runOrder(summary.plays) });
            return;
          }
          out.set(leg.id, game);
          return;
        }
      }
    })
  );
  return out;
}

// ---- Live (場中) ------------------------------------------------------------------

// A baseball game's state from ESPN's short detail ("Top 4th", "Mid 4th",
// "Bot 4th", "End 4th", possibly after "Rain Delay, ").
export function parseInning(detail, period) {
  const half = /\b(Top|Mid|Bot|End)\b/.exec(detail || '')?.[1];
  const map = { Top: 'top', Mid: 'mid', Bot: 'bottom', End: 'end' };
  return half ? { inning: Number(period) || 1, half: map[half] } : null;
}

// Games in progress on an ESPN scoreboard, with their live state.
export function parseEspnLive(data, sport) {
  const games = [];
  for (const event of data.events || []) {
    const comp = event.competitions?.[0];
    if (!comp || comp.status?.type?.state !== 'in') continue;
    const side = ha => comp.competitors.find(c => c.homeAway === ha);
    const away = side('away');
    const home = side('home');
    if (!away || !home) continue;
    const game = {
      espnId: event.id,
      sport,
      startUtc: new Date(event.date).toISOString(),
      away: away.team.displayName,
      home: home.team.displayName,
      awayScore: Number(away.score) || 0,
      homeScore: Number(home.score) || 0,
      detail: comp.status.type.shortDetail || '',
      delayed: /delay|suspend/i.test(comp.status.type.shortDetail || '')
    };
    if (sport === 'mlb') {
      const inning = parseInning(game.detail, comp.status.period);
      if (!inning) continue;
      Object.assign(game, inning, { outs: Number(comp.situation?.outs) || 0 });
    } else {
      // "67'" or "45'+2'"; half time counts as 45 played.
      const minute = /^(\d+)/.exec(comp.status.displayClock || '')?.[1];
      game.minute = /half/i.test(game.detail) ? 45 : Math.min(90, Number(minute) || 0);
    }
    games.push(game);
  }
  return games;
}

// Pregame lines from ESPN's game summary (DraftKings), with the margin removed.
export function parsePregameLines(summary) {
  const pick = (summary?.pickcenter || []).find(p => p.homeTeamOdds?.moneyLine != null) ?? summary?.pickcenter?.[0];
  if (!pick) return null;
  const home = americanToProbability(pick.homeTeamOdds?.moneyLine);
  const away = americanToProbability(pick.awayTeamOdds?.moneyLine);
  const draw = americanToProbability(pick.drawOdds?.moneyLine);
  const win = draw ? devigProportional([home, draw, away]) : devigProportional([home, away]);
  const total = devigProportional([americanToProbability(pick.overOdds), americanToProbability(pick.underOdds)]);
  if (!win) return null;
  return {
    homeWin: win[0],
    awayWin: win.at(-1),
    draw: draw ? win[1] : 0,
    totalLine: Number(pick.overUnder) || null,
    overFair: total ? total[0] : 0.5
  };
}

const pmNumber = (market, outcome) => {
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices);
  const i = outcomes?.findIndex(o => o === outcome || normalizeTeamName(o) === normalizeTeamName(outcome)) ?? -1;
  const price = Number(prices?.[i]);
  return i >= 0 && price > 0 && price < 1 ? price : null;
};

// Polymarket's live winner price for one game (the away team's chance), when
// enough money is behind it.
export function parsePolymarketLive(event, game, minLiquidity) {
  const market = (event.markets || []).find(m => m.question === event.title);
  if (!market || (Number(market.liquidity) || 0) < minLiquidity) return { awayWin: null };
  return { awayWin: pmNumber(market, game.away) };
}

const pregameCache = new Map();

// Every game in progress (MLB, Premier League) with its state, pregame lines
// and Polymarket's live prices. Pregame lines are fetched once per game.
export async function loadLive(now = new Date(), minLiquidity = 5000) {
  const [mlb, epl, pmMlb, pmEpl] = await Promise.all([
    getJson(`${ESPN}/baseball/mlb/scoreboard`).then(d => parseEspnLive(d, 'mlb')).catch(() => []),
    getJson(`${ESPN}/soccer/eng.1/scoreboard`).then(d => parseEspnLive(d, 'epl')).catch(() => []),
    fetchPolymarketLiveEvents(POLYMARKET_TAG.mlb, now).catch(() => []),
    fetchPolymarketLiveEvents(POLYMARKET_TAG.epl, now).catch(() => [])
  ]);
  const games = [...mlb, ...epl];
  await Promise.all(
    games.map(async game => {
      const key = `${game.sport}|${game.espnId}`;
      if (!pregameCache.has(key)) {
        const path = ESPN_PATH[game.sport];
        pregameCache.set(key, getJson(`${ESPN}/${path}/summary?event=${game.espnId}`).then(parsePregameLines).catch(() => null));
      }
      game.pregame = await pregameCache.get(key);
      const events = game.sport === 'mlb' ? pmMlb : pmEpl;
      // The game's own event, not its side events ("… - 1st Inning Winner").
      const event = events.find(e => {
        if (/ - /.test(e.title || '')) return false;
        const teams = eventTeams(e);
        return teams && sameGame({ sport: game.sport, away: teams.away, home: teams.home, startUtc: new Date(e.startTime).toISOString() }, game);
      });
      game.pm = event && game.sport === 'mlb' ? parsePolymarketLive(event, game, minLiquidity) : null;
    })
  );
  return { loadedAt: now.toISOString(), games: games.filter(g => g.pregame) };
}

// Polymarket events that started in the last six hours (games in progress).
async function fetchPolymarketLiveEvents(tagId, now) {
  const since = new Date(now.getTime() - 6 * 3_600_000).toISOString();
  return getJson(`${GAMMA}/events?tag_id=${tagId}&closed=false&limit=100&order=startTime&ascending=true&start_time_min=${since}`, 'polymarket-events');
}

// Every other league (ESPN / DraftKings only), fetched after the page opens
// so they don't hold it up. A league that fails is left out.
export async function loadExtraLeagues(now = new Date()) {
  const [espn, kambi] = await Promise.all([
    Promise.allSettled(EXTRA_LEAGUES.map(key => fetchLeague(key, now))),
    Promise.allSettled(KAMBI_LEAGUES.map(key => fetchKambiLeague(key, now, getJson)))
  ]);
  const ok = results => results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  return lotteryGames([...mergeGames(ok(espn), []), ...ok(kambi)], now);
}

// A league's clubs, logos and nicknames from ESPN's team list (for the
// ticket sorting quiz), remembered in teams.mjs. The Asian leagues use our
// own tables.
export async function loadLeagueTeams(sport) {
  if (hasTeams(sport)) return true;
  // Our leagues by key, or any ESPN league as 'espn:<path>' (the rest of
  // Europe's clubs, for the UEFA competitions' championship boards).
  const path = LEAGUES[sport]?.path ?? (sport.startsWith('espn:') ? sport.slice(5) : null);
  if (!path) return false;
  // Every club: ESPN's list stops at its first page (college football's is long) without a limit.
  const data = await getJson(`${ESPN}/${path}/teams?limit=1000`).catch(() => null);
  const teams = (data?.sports?.[0]?.leagues?.[0]?.teams ?? [])
    .map(x => x.team)
    .filter(t => t?.displayName && t.logos?.[0]?.href)
    .map(t => ({ name: t.displayName, logo: t.logos[0].href, nick: t.name || t.shortDisplayName || t.displayName }));
  if (teams.length) rememberTeams(sport, teams);
  return teams.length > 0;
}

// A Kambi match in play as an outcome still pending: sets won so far (or the
// score, for baseball and basketball) and each set's score.
export function kambiInPlay(live, sport) {
  const spec = LEAGUES[sport]?.sets;
  if (spec && live.sets) {
    const won = setsWon(live.sets, spec);
    return { status: 'pending', state: 'in', homeScore: won.home, awayScore: won.away, homeSets: live.sets.home, awaySets: live.sets.away, detail: '' };
  }
  return { status: 'pending', state: 'in', homeScore: live.score.home, awayScore: live.score.away, detail: '' };
}

// The leagues whose clubs a championship market is about, for their logos
// (findTeamLogo): the league itself, or for the UEFA competitions every
// European league with clubs in them.
const EUROPE = ['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'eredivisie', 'primeira', ...['sco.1', 'tur.1', 'bel.1', 'aut.1', 'gre.1', 'cze.1', 'den.1', 'nor.1', 'sui.1', 'cro.1', 'srb.1', 'swe.1', 'pol.1', 'ukr.1'].map(l => `espn:soccer/${l}`)];
// The competitions' own entrant lists first (clubs from smaller leagues too).
export const FUTURE_TEAM_LEAGUES = { ucl: ['ucl', 'uel', ...EUROPE], uel: ['uel', 'ucl', 'espn:soccer/uefa.europa.conf', ...EUROPE] };
export const futureTeamLeagues = sport => FUTURE_TEAM_LEAGUES[sport] ?? [sport];

// Loads every team list the championship boards need; resolves when done.
export function loadFutureTeams(futures) {
  const leagues = [...new Set(futures.filter(f => f.sport !== 'f1').flatMap(f => futureTeamLeagues(f.sport)))];
  return Promise.all(leagues.map(l => loadLeagueTeams(l).catch(() => false)));
}
