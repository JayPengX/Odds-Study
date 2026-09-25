// Fetches upcoming MLB odds (DraftKings via ESPN, Polymarket) and the next F1
// race-winner market through the shared sports proxy, which adds the CORS
// headers Polymarket doesn't send.
import { americanToProbability, devigTwoWay, devigPower } from './odds.mjs';
import { MLB_TEAM_ZH } from './teams.mjs';

export const PROXY_URL = 'https://sports-proxy.pengzjay.workers.dev';
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const GAMMA = 'https://gamma-api.polymarket.com';
const POLYMARKET_MLB_TAG = 100381;
const POLYMARKET_F1_TAG = 100389;
const DAYS_AHEAD = 4;
const MATCH_TOLERANCE_MS = 6 * 60 * 60 * 1000;

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

export function parseEspnScoreboard(data) {
  const games = [];
  for (const event of data.events || []) {
    const comp = event.competitions?.[0];
    if (!comp || comp.status?.type?.state !== 'pre') continue;
    const teams = Object.fromEntries(comp.competitors.map(c => [c.homeAway, c.team.displayName]));
    const odds = comp.odds?.[0];
    const ml = odds?.moneyline;
    const awayFair = devigTwoWay(americanToProbability(ml?.away?.close?.odds), americanToProbability(ml?.home?.close?.odds));
    let total = null;
    const over = odds?.total?.over?.close;
    const under = odds?.total?.under?.close;
    if (over?.line && under) {
      const line = Number(String(over.line).replace(/^[ou]/, ''));
      const overFair = devigTwoWay(americanToProbability(over.odds), americanToProbability(under.odds));
      if (Number.isFinite(line) && overFair != null) total = { line, overFair };
    }
    games.push({ startUtc: new Date(event.date).toISOString(), away: teams.away, home: teams.home, awayFair, total });
  }
  return games;
}

async function fetchDraftKings(now) {
  const days = [];
  for (let d = -1; d < DAYS_AHEAD; d++) days.push(new Date(now.getTime() + d * 86_400_000));
  const pages = await Promise.all(days.map(day => getJson(`${ESPN_SCOREBOARD}?dates=${yyyymmdd(day)}`).catch(() => null)));
  if (pages.every(p => p === null)) throw new Error('ESPN unreachable');
  return pages.filter(Boolean).flatMap(parseEspnScoreboard);
}

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

function parseJsonArray(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parsePolymarketMlb(events, now) {
  const games = [];
  for (const event of events) {
    const start = Date.parse(event.startTime);
    if (!Number.isFinite(start) || start <= now.getTime()) continue;
    if (!Array.isArray(event.teams) || event.teams.length !== 2) continue;
    const market = (event.markets || []).find(m => m.question === event.title);
    const prices = market && parseJsonArray(market.outcomePrices)?.map(Number);
    const outcomes = market && parseJsonArray(market.outcomes);
    if (!prices || !outcomes) continue;
    const away = event.teams.find(t => t.ordering === 'away')?.name ?? outcomes[0];
    const home = event.teams.find(t => t.name !== away)?.name ?? outcomes[1];
    const iAway = outcomes.indexOf(away);
    const iHome = outcomes.indexOf(home);
    if (iAway < 0 || iHome < 0) continue;
    games.push({
      startUtc: new Date(start).toISOString(),
      away,
      home,
      awayFair: devigTwoWay(prices[iAway], prices[iHome]),
      liquidity: Math.round(Number(market.liquidity) || 0)
    });
  }
  return games;
}

export function mergeGames(dkGames, pmGames) {
  const usedDk = new Set();
  const merged = pmGames.map(pm => {
    const pmMs = Date.parse(pm.startUtc);
    const i = dkGames.findIndex(
      (g, j) => !usedDk.has(j) && g.away === pm.away && g.home === pm.home && Math.abs(Date.parse(g.startUtc) - pmMs) <= MATCH_TOLERANCE_MS
    );
    if (i >= 0) usedDk.add(i);
    return { ...pm, dk: i >= 0 ? dkGames[i] : null };
  });
  dkGames.forEach((dk, i) => {
    if (!usedDk.has(i)) merged.push({ startUtc: dk.startUtc, away: dk.away, home: dk.home, awayFair: null, liquidity: null, dk });
  });
  return merged
    .map(g => ({
      id: `${g.startUtc.slice(0, 13)}_${g.away}_${g.home}`.replaceAll(' ', ''),
      startUtc: g.startUtc,
      away: { en: g.away, zh: MLB_TEAM_ZH[g.away] ?? g.away },
      home: { en: g.home, zh: MLB_TEAM_ZH[g.home] ?? g.home },
      draftKingsAway: g.dk?.awayFair ?? null,
      polymarketAway: g.awayFair,
      polymarketLiquidity: g.liquidity,
      total: g.dk?.total ?? null
    }))
    .filter(g => g.draftKingsAway != null || g.polymarketAway != null)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
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

export async function loadOdds(now = new Date()) {
  const results = await Promise.allSettled([
    fetchDraftKings(now),
    fetchPolymarketEvents(POLYMARKET_MLB_TAG, 'polymarket-events'),
    fetchPolymarketEvents(POLYMARKET_F1_TAG)
  ]);
  if (results.every(r => r.status === 'rejected')) throw results[0].reason;
  const [dk, pmEvents, f1Events] = results.map(r => (r.status === 'fulfilled' ? r.value : []));
  return {
    loadedAt: now.toISOString(),
    mlb: mergeGames(dk, parsePolymarketMlb(pmEvents, now)),
    f1: parseF1RaceWinner(f1Events, now)
  };
}
