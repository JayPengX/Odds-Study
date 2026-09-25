// Fetches upcoming MLB and Premier League odds (DraftKings via ESPN,
// Polymarket), the next F1 race-winner market and championship (futures)
// markets through the shared sports proxy, which adds the CORS headers
// Polymarket doesn't send.
import { americanToProbability, devigProportional, devigPower } from './odds.mjs';
import { normalizeTeamName, teamZh } from './teams.mjs';

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

// The lottery sells single games up to the end of tomorrow, Taiwan time.
export function lotteryWindowEnd(now) {
  const [y, m, d] = taipeiDayKey(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 2) - TAIPEI_OFFSET_MS);
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

export function proxied(url, trim) {
  return `${PROXY_URL}/sports-proxy?url=${encodeURIComponent(url)}${trim ? `&trim=${trim}` : ''}`;
}

async function getJson(url, trim) {
  const res = await fetch(proxied(url, trim), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
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
    const odds = comp.odds?.[0];
    const ml = odds?.moneyline;
    let outcomes = null;
    if (sport === 'epl') {
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
    games.push({ sport, startUtc: new Date(event.date).toISOString(), away: teams.away, home: teams.home, outcomes, total });
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
  const scoreboard = await getJson(`${ESPN}/soccer/eng.1/scoreboard`);
  const days = eplMatchdays(scoreboard, now);
  if (days.length === 0) return parseEspnScoreboard(scoreboard, 'epl');
  return fetchEspnDays('epl', 'soccer/eng.1', days);
}

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
    .filter(d => d.raw > 0);
  const fair = devigPower(drivers.map(d => d.raw));
  return {
    title: event.title,
    startUtc: new Date(event.startTime).toISOString(),
    drivers: drivers
      .map((d, i) => ({ name: d.name, fair: fair[i] }))
      .filter(d => d.fair >= 0.005)
      .sort((a, b) => b.fair - a.fair)
  };
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
export function parseFutures(events, sport) {
  const out = [];
  for (const market of FUTURES.filter(f => f.sport === sport)) {
    const year = e => Number(/\d{4}/.exec(e.title)?.[0] ?? 9999);
    const event = events.filter(e => market.title.test(e.title || '')).sort((a, b) => year(a) - year(b))[0];
    if (!event) continue;
    const teams = [];
    for (const m of event.markets || []) {
      const name = /^Will (?:the )?(.+?) win the /i.exec(m.question || '')?.[1];
      if (!name || /^(team [a-z]|another team|other)$/i.test(name)) continue;
      const outcomes = parseJsonArray(m.outcomes);
      const prices = parseJsonArray(m.outcomePrices);
      const price = Number(prices?.[outcomes?.findIndex(o => /^yes$/i.test(o)) ?? 0]);
      if (price > 0) teams.push({ name, price });
    }
    const fair = devigProportional(teams.map(t => t.price));
    if (!fair || teams.length < 2) continue;
    out.push({
      key: market.key,
      sport,
      season: seasonLabel(event, sport),
      teams: teams
        .map((t, i) => ({ name: { en: t.name, zh: teamZh(sport, t.name) }, fair: fair[i] }))
        .sort((a, b) => b.fair - a.fair)
    });
  }
  return out;
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
      total: dk?.total ?? null
    }))
    .filter(g => g.draftKings || g.polymarket)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

export async function loadOdds(now = new Date()) {
  const results = await Promise.allSettled([
    fetchEspnDays('mlb', 'baseball/mlb', mlbDays(now)),
    fetchPolymarketEvents(POLYMARKET_TAG.mlb, 'polymarket-events'),
    fetchEspnEpl(now),
    fetchPolymarketEvents(POLYMARKET_TAG.epl, 'polymarket-events'),
    fetchPolymarketEvents(POLYMARKET_TAG.f1),
    fetchPolymarketEvents(POLYMARKET_TAG.nba, 'polymarket-events')
  ]);
  if (results.every(r => r.status === 'rejected')) throw results[0].reason;
  const [mlbDk, mlbPm, eplDk, eplPm, f1, nbaPm] = results.map(r => (r.status === 'fulfilled' ? r.value : []));
  const windowEnd = lotteryWindowEnd(now).getTime();
  return {
    loadedAt: now.toISOString(),
    games: mergeGames([...mlbDk, ...eplDk], [...parsePolymarketMlb(mlbPm, now), ...parsePolymarketEpl(eplPm, now)]).filter(
      g => Date.parse(g.startUtc) < windowEnd
    ),
    f1: parseF1RaceWinner(f1, now),
    futures: [...parseFutures(mlbPm, 'mlb'), ...parseFutures(eplPm, 'epl'), ...parseFutures(nbaPm, 'nba')]
  };
}
