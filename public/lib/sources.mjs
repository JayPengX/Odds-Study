// Fetches upcoming MLB and Premier League odds (DraftKings via ESPN,
// Polymarket), the next F1 race-winner market and championship (futures)
// markets through the shared sports proxy, which adds the CORS headers
// Polymarket doesn't send.
import { americanToProbability, devigProportional, devigPower } from './odds.mjs';
import { normalizeTeamName, teamZh } from './teams.mjs';
import { runOrder } from './live.mjs';

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
  const mlb = games.filter(g => g.sport === 'mlb' && Date.parse(g.startUtc) < windowEnd);
  const round = nextMatchweek(games.filter(g => g.sport === 'epl'));
  const epl = round.length && Date.parse(round[0].startUtc) < lotteryWindowEnd(now, EPL_OPEN_DAYS).getTime() ? round : [];
  return [...mlb, ...epl].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
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

// One retry after a short pause: a dropped connection on a phone network
// shouldn't lose a whole sport.
async function getJson(url, trim, retries = 1) {
  try {
    const res = await fetch(proxied(url, trim), { signal: AbortSignal.timeout(30_000) });
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
    // Run line / handicap from the away team's side: { awayLine: -1.5, awayFair }.
    let spread = null;
    const awaySpread = odds?.pointSpread?.away?.close;
    const homeSpread = odds?.pointSpread?.home?.close;
    if (awaySpread?.line && homeSpread) {
      const awayLine = Number(awaySpread.line);
      const fair = devigProportional([americanToProbability(awaySpread.odds), americanToProbability(homeSpread.odds)]);
      if (Number.isFinite(awayLine) && awayLine % 1 !== 0 && fair) spread = { awayLine, awayFair: fair[0] };
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
      slug: event.slug,
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
      fetchPolymarketEvents(POLYMARKET_TAG.nba, 'polymarket-events')
    ].map(track)
  );
  if (results.every(r => r.status === 'rejected')) throw results[0].reason;
  const [mlbDk, mlbPm, eplDk, eplPm, f1, nbaPm] = results.map(r => (r.status === 'fulfilled' ? r.value : []));
  return {
    loadedAt: now.toISOString(),
    games: lotteryGames(mergeGames([...mlbDk, ...eplDk], [...parsePolymarketMlb(mlbPm, now), ...parsePolymarketEpl(eplPm, now)]), now),
    f1: parseF1RaceWinner(f1, now),
    futures: [...parseFutures(mlbPm, 'mlb'), ...parseFutures(eplPm, 'epl'), ...(nbaInSeason(now) ? parseFutures(nbaPm, 'nba') : [])]
  };
}

// ---- Results (for saved slips) ------------------------------------------------

const ESPN_PATH = { mlb: 'baseball/mlb', epl: 'soccer/eng.1' };
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
      homeInnings: (home.linescores || []).map(l => Number(l.value) || 0)
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
      return first ? { status: 'final', winner: first.athlete?.displayName || first.athlete?.fullName } : { status: 'pending' };
    }
  }
  return null;
}

// A championship's winner once Polymarket has resolved the market.
export function parseFutureResult(events) {
  const event = events?.[0];
  if (!event?.closed) return { status: 'pending' };
  for (const m of event.markets || []) {
    const name = /^Will (?:the )?(.+?) win the /i.exec(m.question || '')?.[1];
    const outcomes = parseJsonArray(m.outcomes);
    const prices = parseJsonArray(m.outcomePrices);
    const yes = Number(prices?.[outcomes?.findIndex(o => /^yes$/i.test(o)) ?? 0]);
    if (name && yes >= 0.99) return { status: 'final', winner: name };
  }
  return { status: 'pending' };
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
      if (leg.kind === 'f1') {
        const data = await page(`${ESPN}/racing/f1/scoreboard?dates=${yyyymmdd(new Date(leg.start))}`);
        const result = data && parseEspnRace(data, leg.start);
        if (result) out.set(leg.id, result);
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
