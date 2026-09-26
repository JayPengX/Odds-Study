import {
  FANS,
  HABITS,
  groupSize,
  SPORTS,
  sportTemplate,
  weekOfYear,
  K_DRAFTKINGS,
  blendOutcomes,
  FUTURES_OVERROUND,
  ODDS_ERROR,
  backMargin,
  houseTake,
  estimateF1LotteryOdds,
  estimateFuturesOdds,
  estimateLotteryOdds,
  evaluateSlip,
  analyzeSlip,
  slipPayoutTable,
  expectedReturn,
  habitPools,
  lotteryTotalLines,
  lotteryRunLines,
  fitTeamRuns,
  lotteryTeamTotal,
  fitTotalRuns,
  totalOverChance,
  MLB_TOTAL_DISPERSION,
  GOALS_DISPERSION,
  scoreGrid,
  runLineCover,
  teamOverChance,
  lineInRange,
  estimateLineOdds,
  settleSlip,
  TOP_INNING_ODDS,
  MLB_MARKET_OVERROUND,
  median,
  quantile,
  SLIP_RULES,
  afterTax,
  choose,
  seededRandom,
  simulateCrowd,
  gamesInWeek,
  MONTH_WEEKS,
  PERIOD_MONTHS,
  monthWeeks,
  replayPlayer,
  slipErrors,
  slipSizes,
} from './lib/odds.mjs';
import { loadOdds, taipeiDayKey, fetchOutcomes, loadLive } from './lib/sources.mjs';
import { inningsLeft, liveBaseball, liveSoccer, fitGoals, liveMarkets, liveOdds, pregameRuns, nextRunChances, nextRunOdds, LIVE_MIN_LIQUIDITY } from './lib/live.mjs';
import {
  START_BALANCE,
  WEEKLY_GRANT,
  newAccount,
  balance,
  canClaim,
  claimGrant,
  nextGrantAt,
  weekKey,
  newSlipId,
  placeSlip,
  legResult,
  applyResults,
  mergeAccounts,
  isAccount
} from './lib/account.mjs';
import { createSync, readSync, writeSync, cleanPasscode, PASSCODE_PATTERN } from './lib/sync.mjs';
import { pack, unpack } from './lib/codec.mjs';
import { historyStats, outlookOf, chanceOf, funFacts, crowdPercentile, bettingProfile, closestHabit } from './lib/history.mjs';
import { detectLocale, makeT } from './lib/i18n.mjs';
import { f1Driver, leagueLogo, teamLogo, teamZh } from './lib/teams.mjs';

const STAKE = 100;
// Simulated players per habit. Big enough that the results barely move
// between runs, so one fixed-seed run is shown.
// Simulated players per habit x fan type group, on average: each habit gets
// its share of the crowd (100,020 in all).
const PER_GROUP = Math.ceil(100_000 / (HABITS.length * FANS.length));
const SIM_PLAYERS = FANS.length * HABITS.reduce((n, habit) => n + groupSize(habit, PER_GROUP), 0);
const SIM_SEED = 1;
// Shown as a round "100,000".
const SIM_PLAYERS_SHOWN = Math.round(SIM_PLAYERS / 1000) * 1000;
const THIN_LIQUIDITY = 10_000;
const TIE_BAND = 2;
// Championship teams shown before the rest fold away.
const FUTURES_SHOWN = 8;
// One icon and colour per betting habit.
const HABIT_ICON = { casual: '🎟️', fan: '📣', underdog: '🎯', dreamer: '🎰', chaser: '🔁', careful: '🧮' };
const HABIT_COLOR = { casual: '#0ea5e9', fan: '#f59e0b', underdog: '#8b5cf6', dreamer: '#ec4899', chaser: '#ef4444', careful: '#10b981' };
const DETAIL_KEY = 'oddsStudy.detail';
const USER_ODDS_KEY = 'oddsStudy.userOdds';
const ACCOUNT_KEY = 'oddsStudy.account';
const SYNC_KEY = 'oddsStudy.syncCode';
// Saved slips shown before the rest fold away.
const SAVED_SHOWN = 10;

const state = {
  locale: detectLocale(),
  t: null,
  data: null,
  bets: [],
  futures: [],
  // Games in progress and their live bets.
  liveGames: [],
  liveBets: [],
  liveAt: null,
  userOdds: loadUserOdds(),
  parlay: [],
  slipMode: 'single',
  // Chosen 過關組合 sizes; 'all' stands for 全過, whatever the leg count.
  slipSizes: new Set([2, 'all']),
  slipStake: 100,
  day: null,
  // True until the first simulation is ready: the loading screen covers the page.
  booting: true,
  sport: 'all',
  tab: 'games',
  // Game cards showing all their markets, and cards showing real-odds boxes.
  open: new Set(),
  editing: new Set(),
  // Each open game's market tab (大小分, 讓分, 單隊大小, 得分最高單局).
  marketTab: new Map(),
  // Off: only the odds and the average back. On: margins, chances, takes, extra stats.
  detail: loadDetail(),
  // The simulated account (play money) and its sync.
  account: null,
  accountReady: false,
  sync: { code: '', busy: false, error: '', at: null },
  syncOpen: false,
  // Slips saved or settled since the page opened, highlighted.
  freshSlips: new Set(),
  checking: false,
  checkedAt: 0,
  showAllSaved: false,
  historyFilter: 'all',
  // 紀錄 shows the slips or the stats.
  historyView: 'slips'
};
state.t = makeT(state.locale);

const $ = id => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) if (child != null) node.append(child);
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function loadUserOdds() {
  try {
    return JSON.parse(localStorage.getItem(USER_ODDS_KEY)) || {};
  } catch {
    return {};
  }
}

function loadDetail() {
  try {
    return localStorage.getItem(DETAIL_KEY) === '1';
  } catch {
    return false;
  }
}

function saveUserOdds() {
  try {
    localStorage.setItem(USER_ODDS_KEY, JSON.stringify(state.userOdds));
  } catch {}
}

// ---- Formatting -------------------------------------------------------------

function numberLocale() {
  return state.locale === 'zh' ? 'zh-TW' : 'en-US';
}

// Formatters are made once per language and kept: making one is slow
// (Safari especially), and hundreds of bets are formatted on every tap.
const formatters = new Map();
function formatter(kind, make) {
  const key = `${kind}|${numberLocale()}`;
  if (!formatters.has(key)) formatters.set(key, make(numberLocale()));
  return formatters.get(key);
}
const fmtInt = n => formatter('int', locale => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })).format(n);

function fmtMoney(value, { sign = true } = {}) {
  const abs = fmtInt(Math.abs(Math.round(value)));
  if (!sign) return `NT$${abs}`;
  return `${value < -0.5 ? '−' : value > 0.5 ? '+' : ''}NT$${abs}`;
}

function fmtAxis(value) {
  const abs = fmtInt(Math.abs(Math.round(value)));
  return value < -0.5 ? `−${abs}` : abs;
}

function fmtPct(p) {
  return `${(p * 100).toFixed(1)}%`;
}

function fmtOdds(o) {
  return o.toFixed(2);
}

// Taiwan time, like the lottery, wherever the page is opened.
function fmtTime(iso) {
  return formatter('time', locale =>
    new Intl.DateTimeFormat(locale, {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Taipei'
    })
  ).format(new Date(iso));
}

function teamName(team) {
  return state.locale === 'zh' ? team.zh : team.en;
}

// ---- Bets -------------------------------------------------------------------

function matchupText(game) {
  return game.sport === 'epl'
    ? `${teamName(game.home)} vs ${teamName(game.away)}`
    : `${teamName(game.away)} @ ${teamName(game.home)}`;
}

// ---- Lines (大小分, 讓分, 單隊大小) -------------------------------------------

// Lines shown besides the lottery's own: totals and team totals this many
// either side of the main line, run lines up to 4.5 runs either way.
const TOTAL_SPAN = 3;
const TEAM_TOTAL_SPAN = 2;
const RUN_LINES = [1.5, 2.5, 3.5, 4.5];
// Each game's run and goal models, fitted once: fitting team runs is slow.
const modelCache = new Map();
function gameModel(game) {
  const key = `${game.id}|${game.total?.line}|${game.total?.overFair}|${game.draftKings?.home}`;
  if (modelCache.has(key)) return modelCache.get(key);
  const model = {};
  if (game.total) model.mu = fitTotalRuns(game.total.line, game.total.overFair, game.sport === 'mlb' ? MLB_TOTAL_DISPERSION : GOALS_DISPERSION);
  if (game.sport === 'mlb' && game.total && game.draftKings) {
    model.means = fitTeamRuns(game.draftKings.home, game.total.line, game.total.overFair);
    model.grid = scoreGrid(model.means.home, model.means.away);
  }
  modelCache.set(key, model);
  return model;
}

function fmtLine(line) {
  return `${line > 0 ? '+' : line < 0 ? '−' : ''}${Math.abs(line)}`;
}

// Every line of a game's totals, run lines and team totals: the lottery's own
// (checked against its prices) and the wider range.
function lineBets(game, base, matchup) {
  const t = state.t;
  const bets = [];
  const model = gameModel(game);
  const total = game.total;
  const mlb = game.sport === 'mlb';

  // 大小分. MLB: the lottery's three lines, modelled from DraftKings' one line
  // (any line, whole or half). Premier League: DraftKings' own half-goal line.
  const totals = new Map();
  if (total && mlb) for (const l of lotteryTotalLines(total.line, total.overFair)) totals.set(l.line, { ...l, posted: true });
  else if (total && total.line % 1 !== 0) totals.set(total.line, { line: total.line, over: total.overFair, main: true, posted: true });
  if (model.mu != null) {
    const r = mlb ? MLB_TOTAL_DISPERSION : GOALS_DISPERSION;
    const main = [...totals.values()].find(l => l.main)?.line ?? Math.floor(model.mu) + 0.5;
    for (let d = -TOTAL_SPAN; d <= TOTAL_SPAN; d++) {
      const line = main + d;
      if (line <= 0 || totals.has(line)) continue;
      const over = totalOverChance(line, model.mu, r);
      if (lineInRange(over) && lineInRange(1 - over)) totals.set(line, { line, over, main: false, posted: false });
    }
  }
  for (const { line, over, main, posted } of [...totals.values()].sort((a, b) => a.line - b.line)) {
    for (const side of ['over', 'under']) {
      const p = side === 'over' ? over : 1 - over;
      bets.push({
        ...base,
        id: `${game.id}|tot|${line}|${side}`,
        kind: 'total',
        side,
        totalLine: line,
        mainLine: main,
        posted,
        market: `total|${line}`,
        marketLabel: String(line),
        chip: t(side),
        // The main line's margin is the usual source gap (filled in below);
        // the lines either side add the model's error, ~1-3 points.
        fairMargin: main ? null : posted ? 0.02 : 0.03,
        errKey: !mlb ? game.sport : posted ? 'mlbTotal' : 'mlbTotalExtra',
        label: `${matchup} ${t(side)} ${line}`,
        shortLabel: `${t(side)} ${line}`,
        fairChance: p,
        estOdds: estimateLineOdds(p, K_DRAFTKINGS)
      });
    }
  }

  // 讓分: true chance from DraftKings; the lottery's two posted lines priced
  // from its own (shrunk) chance, which differs from the true one. Other
  // lines come from the per-team score model at the lottery's usual cut.
  if (mlb && (game.spread || model.grid)) {
    const lines = new Map();
    if (game.spread) {
      for (const [i, l] of lotteryRunLines(game.spread.awayLine, game.spread.awayFair).entries()) lines.set(l.awayLine, { ...l, posted: true, first: i === 0 });
    }
    if (model.grid) {
      for (const abs of RUN_LINES) {
        for (const awayLine of [-abs, abs]) {
          if (lines.has(awayLine)) continue;
          const fair = runLineCover(model.grid, awayLine);
          if (lineInRange(fair) && lineInRange(1 - fair)) lines.set(awayLine, { awayLine, fair, lottery: fair, posted: false });
        }
      }
    }
    const order = [...lines.values()].sort((a, b) => Math.abs(a.awayLine) - Math.abs(b.awayLine) || a.awayLine - b.awayLine);
    for (const { awayLine, fair, lottery, posted, first } of order) {
      const giver = awayLine < 0 ? 'away' : 'home';
      for (const side of ['away', 'home']) {
        const line = side === 'away' ? awayLine : -awayLine;
        const text = `${teamName(game[side])} ${fmtLine(line)}`;
        const p = side === 'away' ? fair : 1 - fair;
        const priced = side === 'away' ? lottery : 1 - lottery;
        bets.push({
          ...base,
          id: `${game.id}|rl|${line}|${side}`,
          kind: 'runline',
          side,
          runLine: line,
          awayLine,
          giver,
          posted,
          market: `rl|${awayLine}`,
          marketLabel: `${teamName(game[giver])} ${fmtLine(-Math.abs(awayLine))}`,
          chip: text,
          // DraftKings' own line has one source; the extra run adds model error.
          fairMargin: first ? 0.02 : 0.03,
          errKey: posted ? 'mlbRunLine' : 'mlbRunLineExtra',
          label: text,
          shortLabel: `${t('runLine')} ${text}`,
          fairChance: p,
          estOdds: estimateLineOdds(priced, MLB_MARKET_OVERROUND)
        });
      }
    }
  }

  // 單隊大小: each team's runs from a model fitted to DraftKings' win chance
  // and total; the lottery's line is the one closest to 50/50.
  if (model.means) {
    for (const team of ['away', 'home']) {
      const posted = lotteryTeamTotal(model.means[team]).line;
      for (let d = -TEAM_TOTAL_SPAN; d <= TEAM_TOTAL_SPAN; d++) {
        const line = posted + d;
        if (line <= 0) continue;
        const over = teamOverChance(model.means[team], line);
        if (!(lineInRange(over) && lineInRange(1 - over))) continue;
        for (const side of ['over', 'under']) {
          const p = side === 'over' ? over : 1 - over;
          bets.push({
            ...base,
            id: `${game.id}|tt|${team}|${line}|${side}`,
            kind: 'teamtotal',
            side,
            team,
            teamLine: line,
            posted: line === posted,
            market: `tt|${team}|${line}`,
            marketLabel: `${teamName(game[team])} ${line}`,
            chip: t(side),
            fairMargin: line === posted ? 0.03 : 0.04,
            errKey: line === posted ? 'mlbTeamTotal' : 'mlbTeamTotalExtra',
            label: `${teamName(game[team])} ${t(side)} ${line}`,
            shortLabel: `${teamName(game[team])} ${t(side)} ${line}`,
            fairChance: p,
            estOdds: estimateLineOdds(p, MLB_MARKET_OVERROUND)
          });
        }
      }
    }
  }
  return bets;
}

function buildBets(data) {
  const t = state.t;
  const bets = [];
  for (const game of data.games) {
    const blend = blendOutcomes(game.draftKings, game.polymarket);
    if (!blend) continue;
    const matchup = matchupText(game);
    const base = { gameId: game.id, game, sport: game.sport, matchup, start: game.startUtc };
    const sides = game.sport === 'epl' ? ['home', 'draw', 'away'] : ['away', 'home'];
    for (const side of sides) {
      const p = blend.probs[side];
      const name = side === 'draw' ? t('draw') : teamName(game[side]);
      // The two sources' disagreement is the margin; one source gets the typical one below.
      const both = game.draftKings && game.polymarket;
      bets.push({
        ...base,
        id: `${game.id}|ml|${side}`,
        kind: 'ml',
        side,
        market: 'ml',
        chip: name,
        // Never below half of Polymarket's 1-cent price step.
        fairMargin: both ? Math.max(0.005, Math.abs(game.draftKings[side] - game.polymarket[side]) / 2) : null,
        errKey: game.sport,
        label: side === 'draw' ? `${matchup} ${name}` : `${name} ${t('win')}`,
        shortLabel: name,
        fairChance: p,
        estOdds: estimateLotteryOdds(p, blend.k)
      });
    }
    bets.push(...lineBets(game, base, matchup));
    // 得分最高單局: the lottery's own (nearly fixed) table, its cut removed.
    if (game.sport === 'mlb') {
      const book = TOP_INNING_ODDS.reduce((sum, o) => sum + 1 / o, 0);
      TOP_INNING_ODDS.forEach((odds, i) => {
        const name = i < 9 ? t('inningN', { n: i + 1 }) : t('inningTie');
        bets.push({
          ...base,
          id: `${game.id}|inning|${i}`,
          kind: 'inning',
          market: 'inning',
          inning: i,
          chip: name,
          fairMargin: null,
          errKey: 'topInning',
          label: `${matchup} ${t('topInning')} ${name}`,
          shortLabel: name,
          fairChance: 1 / odds / book,
          estOdds: odds
        });
      });
    }
  }
  if (data.f1) {
    for (const d of data.f1.drivers) {
      const driver = f1Driver(d.name);
      const name = state.locale === 'zh' ? driver.zh : d.name;
      bets.push({
        id: `f1|${d.name}`,
        gameId: 'f1',
        kind: 'f1',
        sport: 'f1',
        matchup: data.f1.title,
        start: data.f1.startUtc,
        label: `F1 ${name}`,
        shortLabel: name,
        driverEn: d.name,
        driver,
        fairChance: d.fair,
        fairMargin: null,
        errKey: d.fair < 0.01 ? 'f1Longshot' : 'f1',
        estOdds: estimateF1LotteryOdds(d.fair)
      });
    }
  }
  // Single-source games: the typical DraftKings-Polymarket gap of that sport.
  for (const sport of ['mlb', 'epl']) {
    const gaps = bets.filter(b => b.sport === sport && b.fairMargin != null).map(b => b.fairMargin);
    const typical = median(gaps) ?? 0.02;
    for (const b of bets) if (b.sport === sport && b.fairMargin == null && (b.kind === 'ml' || b.kind === 'total')) Object.assign(b, { fairMargin: typical, typicalMargin: true });
  }
  return bets;
}

// One bet per team of every championship market.
function buildFutures(data) {
  const t = state.t;
  return (data.futures || []).flatMap(market => {
    const odds = estimateFuturesOdds(market.teams.map(team => team.fair), FUTURES_OVERROUND[market.sport]);
    const title = t(`future_${market.key}`, { season: market.season });
    return market.teams.map((team, i) => ({
      id: `fut|${market.key}|${team.name.en}`,
      gameId: `fut|${market.key}`,
      kind: 'future',
      market: market.key,
      sport: market.sport,
      matchup: title,
      label: `${title} ${teamName(team.name)}`,
      shortLabel: teamName(team.name),
      teamEn: team.name.en,
      eventSlug: market.slug,
      fairChance: team.fair,
      fairMargin: null,
      errKey: team.fair < 0.004 && market.sport !== 'nba' ? 'futureLongshot' : `future_${market.key}`,
      estOdds: odds[i]
    }));
  });
}

function effectiveOdds(bet) {
  const user = Number(state.userOdds[bet.id]);
  return user >= 1.01 ? user : bet.estOdds;
}

function betReturn(bet) {
  return expectedReturn(bet.fairChance, effectiveOdds(bet), STAKE);
}

function hasRealOdds(bet) {
  return Number(state.userOdds[bet.id]) >= 1.01;
}

// Relative margin of the odds used: none once real odds are typed in.
function oddsError(bet) {
  return hasRealOdds(bet) ? 0 : ODDS_ERROR[bet.errKey]?.rel ?? 0;
}

function betBackMargin(bet) {
  return backMargin(bet.fairChance, bet.fairMargin, effectiveOdds(bet), oddsError(bet));
}

// "±1.5" (percentage points), "±4%" or "±NT$3" in small muted text.
function marginEl(text) {
  return el('small', { class: 'margin', text });
}

function fmtMarginPts(m) {
  return `±${(m * 100).toFixed(m < 0.01 ? 1 : 0)}`;
}

// Days follow Taiwan time, like the lottery.
function dayKey(iso) {
  return taipeiDayKey(iso);
}

function inSport(sport) {
  return state.sport === 'all' || state.sport === sport;
}

function visibleBets() {
  return state.bets.filter(b => inSport(b.sport) && dayKey(b.start) === state.day);
}

function rankedBets() {
  return visibleBets().sort((a, b) => betReturn(b) - betReturn(a));
}

function rerenderFiltered() {
  renderSportFilter();
  renderTabs();
  renderDayFilter();
  renderRanking();
  renderGames();
  renderLive();
  renderFutures();
  renderF1();
}

function chip({ pressed, icon, text, count, onclick }) {
  return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed), onclick }, [
    icon ?? null,
    el('span', { text }),
    count ? el('span', { class: 'chip-count', text: count }) : null
  ]);
}

// Sports as tiles: the league's logo, its name and how many games are listed.
function renderSportFilter() {
  const t = state.t;
  const present = new Set([...state.bets, ...state.futures].map(b => b.sport));
  const sports = ['all', 'mlb', 'epl', 'nba', 'f1'].filter(s => s === 'all' || present.has(s));
  if (!sports.includes(state.sport)) state.sport = 'all';
  const games = sport => (sport === 'f1' ? (state.data.f1 ? 1 : 0) : state.data.games.filter(g => sport === 'all' || g.sport === sport).length);
  $('sport-filter').replaceChildren(
    ...sports.map(sport =>
      el('button', {
        class: 'sport-tile',
        type: 'button',
        'aria-pressed': String(sport === state.sport),
        onclick: () => {
          state.sport = sport;
          rerenderFiltered();
        }
      }, [
        sport === 'all' ? allIcon() : leagueImg(sport, 'logo-tile'),
        el('span', { class: 'tile-name', text: t(`sport_${sport}`) }),
        el('span', { class: 'tile-count', text: sport === 'f1' ? t('f1Race') : games(sport) > 0 ? t('gamesN', { n: games(sport) }) : t('futuresOnly') })
      ])
    )
  );
}

// "All sports": four small squares.
function allIcon() {
  const svg = svgEl('svg', { class: 'logo logo-tile all-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  for (const [x, y] of [[3, 3], [13, 3], [3, 13], [13, 13]]) svg.append(svgEl('rect', { x, y, width: 8, height: 8, rx: 2.5 }));
  return svg;
}

// 今天 / 明天 / the weekday, in Taiwan time.
function dayLabel(day) {
  const today = dayKey(new Date().toISOString());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000).toISOString());
  if (day === today) return state.t('today');
  if (day === tomorrow) return state.t('tomorrow');
  const [y, m, d] = day.split('-').map(Number);
  return formatter('weekday', locale => new Intl.DateTimeFormat(locale, { weekday: 'short' })).format(new Date(y, m - 1, d));
}

// Days as a calendar strip: weekday, date, and what's on.
function renderDayFilter() {
  const t = state.t;
  const days = [...new Set(state.bets.filter(b => inSport(b.sport)).map(b => dayKey(b.start)))].sort();
  if (!days.includes(state.day)) state.day = days[0] ?? null;
  // One day only (the usual case): no picker, the day goes in the heading.
  $('day-filter').hidden = days.length <= 1;
  const [, gm, gd] = (state.day ?? '').split('-').map(Number);
  $('games-title').textContent = state.day ? `${t('gamesTitle')} · ${dayLabel(state.day)} ${gm}/${gd}` : t('gamesTitle');
  $('day-filter').replaceChildren(
    ...days.map(day => {
      const games = state.data.games.filter(g => inSport(g.sport) && dayKey(g.startUtc) === day).length;
      const hasF1 = inSport('f1') && state.data.f1 && dayKey(state.data.f1.startUtc) === day;
      const [y, m, d] = day.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const label = dayLabel(day);
      return el('button', {
        class: 'day-tile',
        type: 'button',
        'aria-pressed': String(day === state.day),
        onclick: () => {
          state.day = day;
          rerenderFiltered();
        }
      }, [
        el('span', { class: 'day-text' }, [el('span', { class: 'day-week', text: label }), el('span', { class: 'day-num', text: `${m}/${d}` })]),
        el('span', { class: 'day-count', text: [games ? t('gamesN', { n: games }) : null, hasF1 ? 'F1' : null].filter(Boolean).join(' + ') })
      ]);
    })
  );
}

function backClass(back) {
  if (back > 100) return 'back-high';
  if (back < 80) return 'back-low';
  return '';
}

// A logo with its dark-background version, or `fallback()` if it fails.
function logoPicture(light, dark, cls, fallback) {
  if (!light) return fallback();
  const img = el('img', { class: cls, src: light, alt: '', loading: 'lazy', decoding: 'async' });
  const picture = el('picture', { class: 'logo-wrap' }, [dark ? el('source', { srcset: dark, media: '(prefers-color-scheme: dark)' }) : null, img]);
  img.addEventListener('error', () => picture.replaceWith(fallback()), { once: true });
  return picture;
}

// A team logo, or its initials in a circle when there's no logo (or it fails).
function logoImg(sport, enName, label, size = '') {
  // One character: a Chinese name's first character, or an English initial.
  const fallback = () => el('span', { class: `logo logo-fallback ${size}`, 'aria-hidden': 'true', text: (label || '?').trim().slice(0, 1) });
  return logoPicture(teamLogo(sport, enName), teamLogo(sport, enName, true), `logo ${size}`, fallback);
}

// The league's own logo on a small white disc, the same for every league in
// light and dark mode (as Match-Find shows them), so no logo ever vanishes
// into a dark background and none stands out.
function leagueImg(sport, size = '') {
  const fallback = () => el('span', { class: 'league-img league-missing', 'aria-hidden': 'true' });
  return el('span', { class: `league-badge ${size}` }, logoPicture(leagueLogo(sport), null, 'league-img', fallback));
}

// A round badge with a letter, in a group's colour.
function badge(text, color, size = '') {
  return el('span', { class: `badge ${size}`, style: `--badge:${color}`, 'aria-hidden': 'true', text });
}

// ---- Rendering: static text ------------------------------------------------

// The guide's groups, in order: the odds math, then i18n's `guide` groups.

function renderStatic() {
  const t = state.t;
  document.documentElement.lang = state.locale === 'zh' ? 'zh-Hant' : 'en';
  document.title = `${t('title')} · Odds Study`;
  $('title').textContent = t('title');
  $('notice').textContent = t('notice');
  $('refresh').setAttribute('aria-label', t('refresh'));
  $('refresh').title = t('refresh');
  $('footer').textContent = t('footer');
  for (const [id, key] of [
    ['ranking-title', 'rankingTitle'],
    ['games-title', 'gamesTitle'],
    ['live-title', 'liveTitle'],
    ['futures-title', 'futuresTitle'],
    ['parlay-title', 'parlayTitle'],
    ['account-title', 'accountTitle'],
    ['saved-title', 'savedTitle'],
    ['stats-title', 'statsTitle'],
    ['sim-title', 'simTitle'],
    ['f1-title', 'f1Title'],
    ['math-title', 'mathTitle']
  ])
    $(id).textContent = t(key);
  for (const node of document.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);
  for (const tab of TABS) $(`tab-${tab}`).querySelector('.tab-label').textContent = t(`tab_${tab}`);
  renderLegend();
  renderPeriods();
  renderDetailToggle();
  // The guide: the odds math, then every habit, kind of fan, kind of bet, how
  // the simulators work, the rules and the data, each group folded.
  const groups = [[t('guideMathTitle'), t('mathSteps')], ...t('guide')];
  $('math-body').replaceChildren(
    ...groups.map(([title, items], i) =>
      el('details', { class: 'card fold guide-group' }, [
        el('summary', {}, [
          el('span', { class: 'guide-icon', 'aria-hidden': 'true', text: GUIDE_ICONS[i] ?? '📘' }),
          el('span', {}, [el('span', { text: title }), el('span', { class: 'guide-count', text: ` · ${items.length}` })])
        ]),
        el('div', {}, items.map(([h, p]) => el('div', { class: 'math-step' }, [el('h3', { text: h }), el('p', { text: p })])))
      ])
    )
  );
}

// One icon per guide group, in order: the odds math, habits, fans, kinds of
// bet, the simulators, rules and tax, data and margins.
const GUIDE_ICONS = ['🧮', '🧑‍🤝‍🧑', '🏟️', '🎫', '🎲', '⚖️', '📡'];

// What the numbers on a pick mean, in one line, with the ± explained on tap.
function renderLegend() {
  const t = state.t;
  $('legend').replaceChildren(
    el('span', {}, [el('b', { text: '1.80' }), document.createTextNode(` ${t('legendOdds')}`)]),
    el('span', { class: 'detail-only' }, [el('b', { text: '52%' }), document.createTextNode(` ${t('legendFair')}`)]),
    el('span', { class: 'detail-only' }, [el('b', { text: t('backTiny', { v: '87' }) }), document.createTextNode(` ${t('legendBack')}`)]),
    el('span', { text: t('legendTap') }),
    el('details', { class: 'detail-only' }, [el('summary', { text: t('marginsHelpTitle') }), el('p', { text: t('marginsHelp') })])
  );
}

function renderStatus(kind) {
  const t = state.t;
  const status = $('status');
  if (kind === 'loading') status.textContent = t('loading');
  else if (kind === 'error') status.textContent = t('loadFailed');
  else {
    status.textContent = t('updatedShort', { time: fmtTime(state.data.loadedAt) });
    status.title = `${fmtTime(state.data.loadedAt)} · ${t('sources')}`;
  }
}

// ---- Ranking ------------------------------------------------------------------

function betIcon(bet) {
  if (bet.kind === 'f1') return driverBadge(bet, 'logo-sm');
  if (bet.kind === 'future') return logoImg(bet.sport, bet.teamEn, bet.shortLabel, 'logo-sm');
  // Totals' side is over/under: they show the league, team totals the team.
  const side = bet.kind === 'teamtotal' ? bet.team : ['away', 'home'].includes(bet.side) ? bet.side : null;
  if (bet.game && side) return logoImg(bet.sport, bet.game[side].en, teamName(bet.game[side]), 'logo-sm');
  return leagueImg(bet.sport, 'logo-sm');
}

// The day's bets by average back per NT$100: the top three as cards, then
// every bet in a folded list.
function renderRanking() {
  const t = state.t;
  const ranked = rankedBets();
  $('ranking').hidden = ranked.length === 0;
  if (ranked.length === 0) return;
  const best = betReturn(ranked[0]);
  const context = rankingContext;
  const medals = ['🥇', '🥈', '🥉'];
  $('ranking-podium').replaceChildren(
    ...ranked.slice(0, 3).map((bet, i) => {
      const back = betReturn(bet);
      const inSlip = state.parlay.includes(bet.id);
      return el('li', { class: `podium-card ${inSlip ? 'in-slip' : ''}` }, [
        el('span', { class: 'podium-medal', 'aria-hidden': 'true', text: medals[i] }),
        betIcon(bet),
        el('div', { class: 'podium-body' }, [el('p', { class: 'podium-pick', text: bet.shortLabel }), el('p', { class: 'podium-game', text: context(bet) })]),
        el('div', { class: 'podium-side' }, [
          el('p', { class: `podium-back ${backClass(back)}` }, [
            el('small', { text: t('perHundred') }),
            el('strong', { text: fmtMoney(back, { sign: false }) }),
            marginEl(`±${Math.round(betBackMargin(bet))}`)
          ]),
          el('button', {
            class: `podium-odds ${inSlip ? 'in-slip' : ''}`,
            type: 'button',
            'aria-pressed': String(inSlip),
            'aria-label': `${bet.label} ${fmtOdds(effectiveOdds(bet))} · ${inSlip ? t('removeLeg') : t('addLeg')}`,
            onclick: () => toggleLeg(bet)
          }, [document.createTextNode(fmtOdds(effectiveOdds(bet))), el('span', { text: inSlip ? ' ✓' : ' +' })])
        ])
      ]);
    })
  );
  // The full list (hundreds of rows with MLB) is built only while it's open.
  const more = document.querySelector('.ranking-more');
  if (more.open) fillRankingList(ranked);
  else $('ranking-list').replaceChildren();
  $('ranking-more-label').textContent = t('rankingMore', { n: ranked.length });
  // With estimated odds only, nearly every bet ties: say so rather than rank noise.
  const tied = ranked.filter(b => best - betReturn(b) <= TIE_BAND).length;
  const notes = [];
  if (!ranked.some(hasRealOdds)) notes.push(t('rankingEstimateNote'));
  else if (tied > 1) notes.push(`#1–#${tied}: ${t('tie')}`);
  $('ranking-notes').replaceChildren(
    ...notes.map(text => el('details', { class: 'info' }, [el('summary', { text: t(ranked.some(hasRealOdds) ? 'tieTitle' : 'rankingEstimateTitle') }), el('p', { text })]))
  );
}

function rankingContext(bet) {
  return bet.label.includes(bet.matchup) ? hhmm(bet.start) : `${bet.matchup} · ${hhmm(bet.start)}`;
}

function fillRankingList(ranked) {
  const t = state.t;
  if (!ranked.length) return $('ranking-list').replaceChildren();
  const context = rankingContext;
  const scaleMax = Math.max(100, betReturn(ranked[0])) * 1.04;
  $('ranking-list').replaceChildren(
    ...ranked.map((bet, i) => {
      const back = betReturn(bet);
      return el('li', { class: 'ranking-item' }, [
        el('span', { class: 'rank', text: String(i + 1) }),
        betIcon(bet),
        el('span', { class: 'rank-label' }, [
          document.createTextNode(`${bet.label} @ ${fmtOdds(effectiveOdds(bet))} `),
          hasRealOdds(bet) ? el('span', { class: 'tag tag-real', text: t('tagReal') }) : null,
          el('small', { text: ` ${context(bet)}` })
        ]),
        el('span', { class: `rank-value ${backClass(back)}` }, [document.createTextNode(fmtMoney(back, { sign: false })), marginEl(`±${Math.round(betBackMargin(bet))}`)]),
        el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
          el('div', { class: 'bar', style: `width:${(back / scaleMax) * 100}%` }),
          el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
        ])
      ]);
    })
  );
}
document.querySelector('.ranking-more').addEventListener('toggle', event => {
  if (event.target.open && state.data) fillRankingList(rankedBets());
});

// ---- Games --------------------------------------------------------------------

function renderGames() {
  const t = state.t;
  const container = $('games-list');
  const games = state.data.games.filter(g => inSport(g.sport) && dayKey(g.startUtc) === state.day);
  $('games').hidden = games.length === 0 && !(inSport('f1') && state.data.f1);
  if (games.length === 0) {
    container.replaceChildren(el('p', { class: 'muted', text: t('noBets') }));
    return;
  }
  const byGame = groupBy(state.bets, b => b.gameId);
  container.replaceChildren(...games.filter(g => byGame.get(g.id)).map(game => gameCard(game, byGame.get(game.id))));
}

function hhmm(iso) {
  return formatter('hhmm', locale => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Taipei' })).format(new Date(iso));
}

// A game: its teams with logos and win picks; every other market folds away.
function gameCard(game, bets) {
  const t = state.t;
  const rerender = game.live ? renderLive : renderGames;
  const open = state.open.has(game.id);
  const editing = state.editing.has(game.id);
  const ml = bets.filter(b => b.kind === 'ml');
  const sides = game.sport === 'epl' ? ['home', 'draw', 'away'] : ['away', 'home'];
  const rows = sides.map(side => {
    const bet = ml.find(b => b.side === side);
    const who =
      side === 'draw'
        ? [badge('=', 'var(--text-muted)'), el('span', { class: 'team-name', text: t('draw') })]
        : [
            logoImg(game.sport, game[side].en, teamName(game[side])),
            el('span', { class: 'team-name' }, [document.createTextNode(teamName(game[side])), el('small', { text: t(side === 'home' ? 'homeTag' : 'awayTag') })])
          ];
    const score = game.live && side !== 'draw' ? el('span', { class: 'live-score', text: String(game.live[`${side}Score`]) }) : null;
    return el('div', { class: 'team-row' }, [...who, score, bet ? pickButton(bet, '', editing) : null]);
  });
  const others = bets.filter(b => b.kind !== 'ml');
  const toggle = () => {
    if (state.open.has(game.id)) state.open.delete(game.id);
    else state.open.add(game.id);
    rerender();
  };
  return el('article', { class: `game ${open ? 'open' : ''} ${game.live ? 'live' : ''}` }, [
    el('div', { class: 'game-top' }, [
      leagueImg(game.sport, 'logo-xs'),
      game.live
        ? el('span', { class: 'game-time live-state' }, [el('span', { class: 'live-dot', text: t('tagLive') }), document.createTextNode(liveStateText(game.live))])
        : el('span', { class: 'game-time', text: hhmm(game.startUtc) }),
      ml.length ? el('span', { class: 'game-take detail-only' }, takePill(ml)) : null
    ]),
    el('div', { class: 'team-rows' }, rows),
    open ? gameMore(game, others, editing) : null,
    others.length === 0 ? null : el('button', { class: 'more-toggle', type: 'button', 'aria-expanded': String(open), onclick: toggle }, [
      document.createTextNode(open ? t('lessMarkets') : t('moreMarkets'))
    ])
  ]);
}

// Every other market of a game, one small card each, then the game's details.
function gameMore(game, bets, editing) {
  const t = state.t;
  const kinds = SECTIONS.filter(sec => sec.kind !== 'ml' && bets.some(b => b.kind === sec.kind));
  const current = kinds.find(sec => sec.kind === state.marketTab.get(game.id)) ?? kinds[0];
  const sourceKey = game.live ? (game.live.pmWin != null ? 'liveSourcePm' : 'liveSource') : game.draftKings && game.polymarket ? 'sourceBoth' : game.draftKings ? 'sourceDk' : 'sourcePm';
  const thin = sourceKey === 'sourcePm' && (game.polymarketLiquidity ?? 0) < THIN_LIQUIDITY;
  const notes = [];
  if (game.live) notes.push(t(game.sport === 'mlb' ? 'liveNote' : 'liveNoteSoccer'));
  if (game.sport === 'epl') notes.push(t('soccerUnverified'));
  if (game.sport !== 'mlb' && game.total && game.total.line % 1 === 0) notes.push(t('wholeLine', { line: game.total.line, a: game.total.line - 0.5, b: game.total.line + 0.5 }));
  if (thin) notes.push(t('thin'));
  return el('div', { class: 'game-more' }, [
    kinds.length > 1
      ? el('div', { class: 'segmented market-tabs', role: 'tablist', 'aria-label': t('moreMarkets') },
          kinds.map(sec =>
            el('button', {
              type: 'button',
              role: 'tab',
              'aria-selected': String(sec === current),
              'aria-pressed': String(sec === current),
              text: t(sec.short ?? sec.title),
              onclick: () => {
                state.marketTab.set(game.id, sec.kind);
                (game.live ? renderLive : renderGames)();
              }
            })
          )
        )
      : null,
    current ? marketPanel(game, current, bets.filter(b => b.kind === current.kind), editing) : null,
    el('div', { class: 'game-foot' }, [
      el('span', { class: 'detail-only', text: `${fmtTime(game.startUtc)} · ${t(sourceKey)}` }),
      editToggle(game.id, game.live ? renderLive : renderGames),
      notes.length ? el('details', { class: 'info detail-only' }, [el('summary', { text: t('notesTitle') }), ...notes.map(text => el('p', { text }))]) : null
    ])
  ]);
}

// One line of a two-way market: the line (tagged when the lottery posts it,
// with the market's take under 詳細) and its two picks.
function lineRow(label, pair, editing, { posted = false, main = false } = {}) {
  const t = state.t;
  return el('div', { class: `line-row ${posted ? 'posted' : ''} ${main ? 'main' : ''}` }, [
    el('span', { class: 'line-label' }, [
      el('strong', { text: label }),
      posted ? el('small', { class: 'line-tag', text: t(main ? 'lineMain' : 'lineLottery') }) : null,
      el('small', { class: 'detail-only line-take' }, takePill(pair))
    ]),
    ...pair.map(b => pickButton(b, '', editing))
  ]);
}

// A block of lines under its own heading: [first column, pick A, pick B].
function lineTable(heads, rows, title = null) {
  return el('div', { class: 'line-table' }, [
    title ? el('p', { class: 'line-title', text: title }) : null,
    el('div', { class: 'line-head' }, heads.map(text => el('span', { text }))),
    ...rows
  ]);
}

// Each kind of market laid out as a table of its lines.
function marketPanel(game, section, bets, editing) {
  const t = state.t;
  const by = (list, side) => list.find(b => b.side === side);
  let body;
  if (section.kind === 'total') {
    const rows = [...groupBy(bets, b => b.totalLine).values()]
      .sort((a, b) => a[0].totalLine - b[0].totalLine)
      .map(pair => lineRow(String(pair[0].totalLine), [by(pair, 'over'), by(pair, 'under')], editing, { posted: pair[0].posted, main: pair[0].mainLine }));
    body = [lineTable([t('colLine'), t('over'), t('under')], rows)];
  } else if (section.kind === 'runline') {
    // One block per team giving the runs: "遊騎兵 讓分" -1.5, -2.5, …
    body = ['away', 'home']
      .map(giver => {
        const taker = giver === 'away' ? 'home' : 'away';
        const markets = [...groupBy(bets.filter(b => b.giver === giver), b => b.market).values()].sort((a, b) => Math.abs(a[0].awayLine) - Math.abs(b[0].awayLine));
        if (!markets.length) return null;
        const rows = markets.map(pair => lineRow(fmtLine(-Math.abs(pair[0].awayLine)), [by(pair, giver), by(pair, taker)], editing, { posted: pair[0].posted }));
        return lineTable([t('colLine'), teamName(game[giver]), teamName(game[taker])], rows, t('giveRuns', { team: teamName(game[giver]) }));
      })
      .filter(Boolean);
  } else if (section.kind === 'teamtotal') {
    body = ['away', 'home']
      .map(team => {
        const lines = [...groupBy(bets.filter(b => b.team === team), b => b.teamLine).values()].sort((a, b) => a[0].teamLine - b[0].teamLine);
        if (!lines.length) return null;
        const rows = lines.map(pair => lineRow(String(pair[0].teamLine), [by(pair, 'over'), by(pair, 'under')], editing, { posted: pair[0].posted, main: pair[0].posted }));
        return lineTable([t('colLine'), t('over'), t('under')], rows, teamName(game[team]));
      })
      .filter(Boolean);
  } else {
    // One block per market (最高單局 has one; 第N分 one per run).
    body = [...groupBy(bets, b => b.market).values()].flatMap(list => [
      el('div', { class: 'market-head' }, [el('span', { class: 'market-title', text: list[0].marketLabel ?? t(section.title) }), el('span', { class: 'detail-only market-take' }, takePill(list))]),
      el('div', { class: 'market-picks' }, list.map(b => pickButton(b, b.chip ?? b.shortLabel, editing)))
    ]);
  }
  const extra = bets.some(b => b.posted === false);
  return el('div', { class: `market-panel ${section.kind}` }, [...body, extra ? el('p', { class: 'note', text: t('linesNote') }) : null]);
}

// Shows or hides the real-odds boxes of one card.
function editToggle(id, rerender) {
  const on = state.editing.has(id);
  return el('button', {
    class: 'ghost-button',
    type: 'button',
    'aria-pressed': String(on),
    text: state.t(on ? 'editOddsDone' : 'editOdds'),
    onclick: () => {
      if (on) state.editing.delete(id);
      else state.editing.add(id);
      rerender();
    }
  });
}

// One section per kind of bet, each market of it with its own take. The
// inning market's ten results take a whole row.
const SECTIONS = [
  { kind: 'ml', title: 'secMoneyline' },
  { kind: 'total', title: 'secTotal' },
  { kind: 'runline', title: 'secRunLine' },
  { kind: 'teamtotal', title: 'secTeamTotal' },
  { kind: 'inning', title: 'secTopInning', short: 'topInningShort' },
  { kind: 'nextrun', title: 'secNextRun' }
];

function takePill(bets) {
  return el('span', { class: 'take-pill', title: state.t('takeLabel'), text: state.t('takeShort', { v: takeText(bets) }) });
}

function fmtPctShort(p) {
  return p >= 0.1 ? `${Math.round(p * 100)}%` : `${(p * 100).toFixed(1)}%`;
}

// "52% · 回 87": the fair chance and the average back per NT$100.
function pickSub(bet) {
  return [el('span', { class: 'detail-only', text: `${fmtPctShort(bet.fairChance)} · ` }), el('b', { text: state.t('backTiny', { v: Math.round(betReturn(bet)) }) })];
}

function pickTitle(bet) {
  const t = state.t;
  const err = ODDS_ERROR[bet.errKey];
  return [
    bet.label,
    `${t('legendOdds')} ${fmtOdds(effectiveOdds(bet))}${hasRealOdds(bet) ? ` (${t('tagReal')})` : ` ±${fmtOdds(bet.estOdds * err.rel)}${err.checked ? '' : '?'}`}`,
    `${t('colFair')} ${fmtPct(bet.fairChance)}${bet.fairMargin ? ` ${fmtMarginPts(bet.fairMargin)}${bet.typicalMargin ? '*' : ''}` : ''}`,
    `${t('legendBack')} ${fmtMoney(betReturn(bet), { sign: false })} ±${Math.round(betBackMargin(bet))}`
  ].join('\n');
}

function canAddToSlip() {
  return true;
}

// A pick: tap to put it on the bet slip (or take it off). The big number is
// the estimated lottery odds; below it the fair chance and average back.
function pickButton(bet, name, editing) {
  const t = state.t;
  const back = betReturn(bet);
  const inSlip = state.parlay.includes(bet.id);
  const err = ODDS_ERROR[bet.errKey];
  const add = canAddToSlip(bet);
  const body = [
    name ? el('span', { class: 'pick-name', text: name }) : null,
    el('span', { class: 'pick-odds' }, [
      document.createTextNode(fmtOdds(effectiveOdds(bet))),
      el('small', { class: hasRealOdds(bet) ? '' : 'detail-only', text: hasRealOdds(bet) ? t('tagReal') : `±${fmtOdds(bet.estOdds * err.rel)}` })
    ]),
    el('span', { class: 'pick-sub detail-only', 'data-back': bet.id }, pickSub(bet))
  ];
  const pick = el(add ? 'button' : 'div', {
    class: `pick ${backClass(back)} ${inSlip ? 'in-slip' : ''}`,
    type: add ? 'button' : null,
    title: pickTitle(bet),
    'aria-pressed': add ? String(inSlip) : null,
    'aria-label': add ? `${bet.label} ${fmtOdds(effectiveOdds(bet))} · ${inSlip ? t('removeLeg') : t('addLeg')}` : null,
    onclick: add ? () => toggleLeg(bet) : null
  }, body);
  if (!editing) return pick;
  return el('div', { class: 'pick-wrap' }, [pick, realOddsInput(bet, 'pick-real')]);
}

function realOddsInput(bet, cls) {
  return el('input', {
    class: cls,
    type: 'number',
    inputmode: 'decimal',
    step: '0.01',
    min: '1.01',
    placeholder: state.t('realOddsShort'),
    'aria-label': `${bet.label} ${state.t('colReal')}`,
    value: state.userOdds[bet.id] ?? null,
    oninput: event => onUserOdds(bet, event.target.value)
  });
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

function takeText(bets, labelKey) {
  const { take, margin } = houseTake(bets.map(effectiveOdds), bets.map(oddsError));
  const pct = `${Math.round(take * 100)}%${margin >= 0.005 ? ` ±${Math.max(1, Math.round(margin * 100))}` : ''}`;
  return labelKey ? `${state.t(labelKey)} ${pct}` : pct;
}

function onUserOdds(bet, raw) {
  const value = Number(raw);
  if (raw === '' || !(value >= 1.01)) delete state.userOdds[bet.id];
  else state.userOdds[bet.id] = value;
  saveUserOdds();
  // Update the numbers in place: redrawing the card would drop the typing focus.
  for (const cell of document.querySelectorAll(`[data-back="${CSS.escape(bet.id)}"]`)) {
    const back = betReturn(bet);
    if (cell.classList.contains('pick-sub')) {
      cell.replaceChildren(...pickSub(bet));
      const pick = cell.closest('.pick');
      pick.classList.remove('back-high', 'back-low');
      if (backClass(back)) pick.classList.add(backClass(back));
      pick.querySelector('.pick-odds').firstChild.textContent = fmtOdds(effectiveOdds(bet));
    } else {
      cell.replaceChildren(document.createTextNode(fmtOdds(effectiveOdds(bet))), el('small', { text: state.t('backTiny', { v: Math.round(back) }) }));
    }
  }
  renderRanking();
  renderParlay();
  renderSim();
}

// ---- Live (場中) --------------------------------------------------------------------

// "4局下 1出局", "中場", "67'".
function liveStateText(live) {
  const t = state.t;
  if (live.delayed) return `${live.detail} · ${t('livePaused')}`;
  if (live.sport !== 'mlb') return live.minute >= 45 && /half/i.test(live.detail) ? t('liveHalfTime') : `${live.minute}'`;
  const text = t(`liveHalf_${live.half}`, { n: live.inning });
  return live.half === 'top' || live.half === 'bottom' ? `${text} ${t('liveOuts', { n: live.outs })}` : text;
}

// Every live game as a game card's data, and its bets at live odds.
function buildLiveBets(data) {
  const t = state.t;
  const games = [];
  const bets = [];
  for (const g of data?.games ?? []) {
    const pre = g.pregame;
    let dist;
    if (g.sport === 'mlb') {
      if (!pre.totalLine) continue;
      const means = pregameRuns({ homeWin: pre.homeWin, totalLine: pre.totalLine, overFair: pre.overFair });
      const left = inningsLeft(g);
      dist = liveBaseball({ means, awayScore: g.awayScore, homeScore: g.homeScore, awayLeft: left.away, homeLeft: left.home });
    } else {
      if (!(pre.draw > 0)) continue;
      dist = liveSoccer({ means: fitGoals(pre.homeWin, pre.awayWin), awayScore: g.awayScore, homeScore: g.homeScore, minutesLeft: 90 - g.minute });
    }
    const game = {
      id: `live|${g.sport}|${g.espnId}`,
      espnId: g.espnId,
      sport: g.sport,
      startUtc: g.startUtc,
      away: { en: g.away, zh: teamZh(g.sport, g.away) },
      home: { en: g.home, zh: teamZh(g.sport, g.home) },
      live: { ...g, pmWin: g.pm?.awayWin ?? null }
    };
    games.push(game);
    // Rain delay or suspended: no live odds until play resumes.
    if (g.delayed) continue;
    const matchup = matchupText(game);
    const base = { gameId: game.id, game, sport: g.sport, matchup, start: g.startUtc, live: true, fairMargin: null, errKey: g.sport === 'mlb' ? 'live' : 'liveSoccer' };
    for (const m of liveMarkets(dist, { sport: g.sport, awayScore: g.awayScore, homeScore: g.homeScore, pm: g.pm })) {
      const common = { ...base, kind: m.kind, side: m.side, market: m.market, posted: m.posted, fairChance: m.fair, estOdds: liveOdds(m.fair) };
      if (m.kind === 'ml') {
        const name = m.side === 'draw' ? t('draw') : teamName(game[m.side]);
        bets.push({ ...common, id: `${game.id}|ml|${m.side}`, chip: name, label: m.side === 'draw' ? `${matchup} ${name}` : `${name} ${t('win')}`, shortLabel: name });
      } else if (m.kind === 'total') {
        bets.push({ ...common, id: `${game.id}|tot|${m.line}|${m.side}`, totalLine: m.line, mainLine: m.main, chip: t(m.side), label: `${matchup} ${t(m.side)} ${m.line}`, shortLabel: `${t(m.side)} ${m.line}` });
      } else if (m.kind === 'runline') {
        const text = `${teamName(game[m.side])} ${fmtLine(m.line)}`;
        bets.push({ ...common, id: `${game.id}|rl|${m.line}|${m.side}`, runLine: m.line, awayLine: m.awayLine, giver: m.giver, chip: text, label: text, shortLabel: `${t('runLine')} ${text}` });
      } else if (m.kind === 'teamtotal') {
        const text = `${teamName(game[m.team])} ${t(m.side)} ${m.line}`;
        bets.push({ ...common, id: `${game.id}|tt|${m.team}|${m.line}|${m.side}`, team: m.team, teamLine: m.line, chip: t(m.side), label: text, shortLabel: text });
      }
    }
    // 第N分: the next two runs of the game.
    if (g.sport === 'mlb') {
      const means = pregameRuns({ homeWin: pre.homeWin, totalLine: pre.totalLine, overFair: pre.overFair });
      for (const ahead of [1, 2]) {
        const n = g.awayScore + g.homeScore + ahead;
        const chances = nextRunChances({ means, state: g, runsAhead: ahead });
        for (const side of ['away', 'none', 'home']) {
          const name = side === 'none' ? t('nextRunNone') : teamName(game[side]);
          const label = `${t('nextRunN', { n })} ${name}`;
          bets.push({ ...base, id: `${game.id}|nr|${n}|${side}`, kind: 'nextrun', side, runN: n, market: `nr|${n}`, marketLabel: t('nextRunN', { n }), posted: true, fairChance: chances[side], estOdds: nextRunOdds(chances[side]), errKey: 'liveNextRun', chip: name, label: `${matchup} ${label}`, shortLabel: label });
        }
      }
    }
  }
  return { games, bets };
}

function renderLive() {
  const t = state.t;
  const games = state.liveGames.filter(g => inSport(g.sport));
  $('live').hidden = !games.length;
  if (!games.length) return;
  const byGame = groupBy(state.liveBets, b => b.gameId);
  $('live-updated').textContent = state.liveAt ? t('liveUpdated', { time: formatter('hms', locale => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Taipei' })).format(new Date(state.liveAt)) }) : '';
  $('live-list').replaceChildren(...games.map(g => gameCard(g, byGame.get(g.id) ?? [])));
}

// Live games refresh every 30 seconds while the games tab is on screen.
const LIVE_REFRESH_MS = 30_000;
let liveBusy = false;
async function refreshLive() {
  if (liveBusy) return;
  liveBusy = true;
  try {
    const data = await loadLive(new Date(), LIVE_MIN_LIQUIDITY);
    const { games, bets } = buildLiveBets(data);
    state.liveGames = games;
    state.liveBets = bets;
    state.liveAt = data.loadedAt;
    // A live pick whose line is gone (the game moved on, or ended) leaves the slip.
    const ids = new Set(slipCandidates().map(b => b.id));
    state.parlay = state.parlay.filter(id => ids.has(id));
    renderLive();
    renderParlay();
    renderTabs();
  } catch (error) {
    console.error(error);
  } finally {
    liveBusy = false;
  }
}

setInterval(() => {
  if (document.visibilityState === 'visible' && (state.tab === 'games' || (state.tab === 'slip' && state.parlay.some(id => id.startsWith('live|'))))) refreshLive();
}, LIVE_REFRESH_MS);

// ---- Championships and F1: one board each -------------------------------------

function driverBadge(bet, size = '') {
  const initials = bet.driverEn.split(/\s+/).filter(w => !/^jr\.?$/i.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return el('span', { class: `driver-badge ${size}`, style: `--team:${bet.driver.color}`, 'aria-hidden': 'true', text: initials });
}

// One row per team or driver: picture, name, chance, then the estimated odds
// and average back as a button that puts the pick on the slip.
function entryRow(bet, i, editing, picture, sub) {
  const t = state.t;
  const inSlip = state.parlay.includes(bet.id);
  return el('div', { class: `entry ${inSlip ? 'in-slip' : ''}`, title: pickTitle(bet) }, [
    el('span', { class: 'entry-rank', text: String(i + 1) }),
    picture,
    el('span', { class: 'entry-name' }, [document.createTextNode(bet.shortLabel), el('small', { text: [fmtPctShort(bet.fairChance), sub].filter(Boolean).join(' · ') })]),
    editing
      ? realOddsInput(bet, 'entry-real')
      : el('button', {
          class: `entry-odds ${inSlip ? 'in-slip' : ''}`,
          type: 'button',
          'data-back': bet.id,
          'aria-pressed': String(inSlip),
          'aria-label': `${bet.label} ${fmtOdds(effectiveOdds(bet))} · ${inSlip ? t('removeLeg') : t('addLeg')}`,
          onclick: () => toggleLeg(bet)
        }, [
          document.createTextNode(fmtOdds(effectiveOdds(bet))),
          el('small', { class: `detail-only ${backClass(betReturn(bet))}`, text: t('backTiny', { v: Math.round(betReturn(bet)) }) })
        ])
  ]);
}

function board({ emblem, title, sub, bets, rows, id, notes = [], shown = Infinity }) {
  const t = state.t;
  const editing = state.editing.has(id);
  const entries = bets.map((b, i) => rows(b, i, editing));
  const rest = entries.slice(shown);
  return el('article', { class: 'board' }, [
    el('div', { class: 'board-head' }, [
      el('span', { class: 'board-emblem' }, leagueImg(emblem)),
      el('div', {}, [el('p', { class: 'board-title', text: title }), el('p', { class: 'board-sub', text: sub })]),
      el('span', { class: 'detail-only board-take' }, takePill(bets))
    ]),
    el('div', { class: 'entries' }, entries.slice(0, shown)),
    rest.length ? el('details', { class: 'board-more' }, [el('summary', { text: t('futureMore', { n: rest.length }) }), el('div', { class: 'entries' }, rest)]) : null,
    el('div', { class: 'board-foot' }, [
      editToggle(id, () => (renderFutures(), renderF1())),
      notes.length ? el('details', { class: 'info' }, [el('summary', { text: t('notesTitle') }), ...notes.map(text => el('p', { text }))]) : null
    ])
  ]);
}

function renderFutures() {
  const t = state.t;
  const markets = groupBy(state.futures.filter(b => inSport(b.sport)), b => b.market);
  $('futures').hidden = markets.size === 0;
  $('futures-list').replaceChildren(
    ...[...markets.values()].map(bets => {
      const { market, matchup, sport } = bets[0];
      const notes = [];
      if (sport === 'nba') notes.push(t('futureNbaNote'));
      if (sport === 'epl') notes.push(t('futureEplNote'));
      return board({
        emblem: sport,
        title: matchup,
        sub: `${t('futureSettles')} ${t(`futureSettle_${market}`)}`,
        bets,
        id: `fut|${market}`,
        notes,
        shown: FUTURES_SHOWN,
        rows: (b, i, editing) => entryRow(b, i, editing, logoImg(b.sport, b.teamEn, b.shortLabel))
      });
    })
  );
}

// ---- Bet slip -----------------------------------------------------------------

function toggleLeg(bet) {
  if (state.parlay.includes(bet.id)) {
    state.parlay = state.parlay.filter(id => id !== bet.id);
  } else {
    // One pick per game: a new pick from the same game replaces the old one.
    const sameGame = slipCandidates().filter(b => b.gameId === bet.gameId).map(b => b.id);
    state.parlay = state.parlay.filter(id => !sameGame.includes(id));
    state.parlay.push(bet.id);
    if (state.parlay.length > SLIP_RULES.maxLegs) state.parlay.shift();
  }
  renderGames();
  renderLive();
  renderF1();
  renderFutures();
  renderRanking();
  renderParlay();
}

// Everything that can go on the slip: games, F1 and championships.
function slipCandidates() {
  return [...state.bets, ...state.liveBets, ...state.futures];
}

// Championships have no start time: they stay open until the lottery closes them.
function started(bet) {
  return !bet.live && bet.start != null && Date.parse(bet.start) <= Date.now();
}

// Picks on the slip. Games already under way are dropped: the page doesn't
// cover live (in-play) betting.
function slipLegs() {
  const candidates = slipCandidates();
  const legs = state.parlay.map(id => candidates.find(b => b.id === id)).filter(Boolean);
  const live = legs.filter(started);
  if (live.length) state.parlay = state.parlay.filter(id => !live.some(b => b.id === id));
  return { legs: legs.filter(b => !started(b)), dropped: live.length };
}

// A number with its label; `detail` tiles show only with 詳細 on.
function statTile(label, value, extraClass = '', range = null, detail = false, icon = null) {
  return el('div', { class: `stat ${detail ? 'detail-only' : ''} ${icon ? 'has-icon' : ''}` }, [
    icon ? el('span', { class: 'stat-icon', 'aria-hidden': 'true', text: icon }) : null,
    el('p', { class: `stat-value ${extraClass}`, text: value }),
    el('p', { class: 'stat-label', text: label }),
    range ? el('p', { class: 'stat-range', text: state.t('rangeLabel', { range }) }) : null
  ]);
}

function fmtChance(p) {
  if (p >= 0.995) return p >= 1 ? '100%' : '>99%';
  if (p >= 0.1) return `${Math.round(p * 100)}%`;
  if (p >= 0.001) return `${(p * 100).toFixed(1)}%`;
  if (p >= 0.0001) return `${(p * 100).toFixed(2)}%`;
  return p > 0 ? '<0.01%' : '0%';
}

function sizeName(k, n) {
  return k === n ? state.t('slipAll') : state.t('slipSize', { k });
}

// A deep look at the ticket, all computed exactly from each pick's fair chance.
function slipAnalysisView(a, legs, ranges, extra) {
  const t = state.t;
  const money = v => fmtMoney(v, { sign: false });
  const n = legs.length;
  const cards = [];
  cards.push(gradeCard(a));

  // Key numbers.
  cards.push(
    el('div', { class: 'card' }, [
      el('div', { class: 'kpis' }, [
        statTile(t('slipCost'), money(a.cost), '', null, false, '💵'),
        statTile(t('slipBest'), money(a.top.net), 'back-high', null, false, '🏆'),
        statTile(t('slipExpected'), money(a.expectedNet), a.backPer100 < 100 ? 'back-low' : 'back-high', ranges.expected, false, '⚖️'),
        statTile(t('slipAny'), fmtChance(a.paid), '', ranges.any, true, '🎯'),
        statTile(t('slipProfit'), fmtChance(a.profit), a.profit < 0.5 ? 'back-low' : '', ranges.profit, false, '📈'),
        statTile(t('slipTakeTax'), fmtPct(1 - a.expectedNet / a.cost), 'back-low', ranges.take, true, '🏦')
      ]),
      extra.fairTop > a.top.gross ? el('p', { class: 'note detail-only', text: t('anaFairTop', { fair: money(extra.fairTop), real: money(a.top.gross), cut: fmtPct(1 - a.top.gross / extra.fairTop) }) }) : null,
      el('details', { class: 'info detail-only' }, [el('summary', { text: t('slipRangeTitle') }), el('p', { text: t('slipRangeNote') })])
    ])
  );
  cards.push(drawCard(legs, a, extra.sig));

  // Where each NT$100 goes.
  const { take, tax, back } = a.per100;
  const seg = (cls, v) => el('span', { class: `split-seg ${cls}`, style: `flex:${Math.max(0, v)}` });
  cards.push(
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: `${t('anaSplitTitle')}` }),
      el('div', { class: 'split-bar', 'aria-hidden': 'true' }, [seg('split-back', back), seg('split-take', take), seg('split-tax', tax)]),
      el('div', { class: 'split-legend' }, [
        el('span', {}, [el('i', { class: 'split-back' }), document.createTextNode(`${t('anaBack')} ${money(back)}`)]),
        el('span', {}, [el('i', { class: 'split-take' }), document.createTextNode(`${t('anaTake')} ${money(take)}`)]),
        el('span', {}, [el('i', { class: 'split-tax' }), document.createTextNode(`${t('anaTax')} ${money(tax)}`)])
      ])
    ])
  );

  // Every result, exactly.
  const scale = Math.max(...a.byHits.map(r => r.chance));
  cards.push(
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: `${t('anaResultsTitle')}` }),
      el('ol', { class: 'run-bars' },
        [...a.byHits].reverse().map(r =>
          el('li', { class: r.profit ? 'row-profit' : '' }, [
            el('span', { class: 'run-hits', text: t('slipHitsN', { k: r.hits, n }) }),
            el('span', { class: 'run-track' }, [el('span', { class: 'run-bar', style: `width:${(r.chance / scale) * 100}%` })]),
            el('span', { class: 'run-share' }, [el('strong', { text: fmtChance(r.chance) }), el('small', { text: r.max > 0 ? (r.min === r.max ? money(r.max) : `${money(r.min)}–${money(r.max)}`) : '—' })])
          ])
        )
      ),
      el('p', { class: 'note', text: a.profitFrom == null ? t('anaNoProfit') : t('anaProfitFrom', { k: a.profitFrom, n, p: fmtChance(a.profit) }) })
    ])
  );

  cards.push(rareCard(a));

  // Each pick on its own.
  cards.push(
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: `${t('anaLegsTitle')}` }),
      el('ul', { class: 'leg-analysis' },
        legs.map((b, i) => {
          const info = a.legs[i];
          return el('li', { class: i === a.weakest && n > 1 ? 'weakest' : '' }, [
            betIcon(b),
            el('span', { class: 'leg-main' }, [
              el('strong', { text: b.shortLabel }),
              el('small', { class: 'slip-leg-game', text: t('anaLegOdds', { odds: fmtOdds(effectiveOdds(b)), fair: fmtOdds(info.fairOdds), p: fmtPctShort(b.fairChance) }) })
            ]),
            el('span', { class: 'leg-value' }, [
              el('strong', { class: backClass(info.value), text: money(info.value) }),
              info.without != null && n > 1 ? el('small', { class: 'detail-only', text: t('anaWithout', { v: money(info.without) }) }) : null
            ])
          ]);
        })
      ),
      n > 1 ? el('p', { class: 'note', text: t('anaWeakest', { leg: legs[a.weakest].shortLabel, v: money(a.legs[a.weakest].value) }) }) : null
    ])
  );

  // Missing by one only means something when the picks share one ticket.
  if (state.slipMode !== 'single') cards.push(heartbreakCard(a, legs));
  return cards;
}

// ---- Bet slip extras: a grade, how rare a win is, and trying a draw ----------

// Things everyone knows the odds of, to measure a ticket's chances against.
const RARE_EVENTS = [
  { key: 'coin', p: 1 / 2, icon: '🪙' },
  { key: 'dice', p: 1 / 6, icon: '🎲' },
  { key: 'birthday', p: 1 / 365, icon: '🎂' },
  { key: 'tenHeads', p: 1 / 1024, icon: '🪙' },
  { key: 'royal', p: 1 / 649_740, icon: '🃏' },
  { key: 'lotto', p: 1 / 13_983_816, icon: '🎱' },
  { key: 'power', p: 1 / 22_085_448, icon: '🎱' }
];
const TICKET_TYPES = [
  { key: 'steady', min: 0.4, icon: '🐢' },
  { key: 'balanced', min: 0.15, icon: '⚖️' },
  { key: 'thrill', min: 0.03, icon: '🎢' },
  { key: 'dream', min: 0.002, icon: '🌈' },
  { key: 'lottery', min: 0, icon: '🎰' }
];

// A school grade from the average back per NT$100 (a single game at the
// lottery's usual cut gets about 87, an A), and a type from the chance of profit.
function slipGrade(a) {
  const b = a.backPer100;
  const grade = b >= 100 ? 'S' : b >= 85 ? 'A' : b >= 72 ? 'B' : b >= 62 ? 'C' : b >= 50 ? 'D' : 'F';
  return { grade, type: TICKET_TYPES.find(x => a.profit >= x.min) };
}

function gradeCard(a) {
  const t = state.t;
  const { grade, type } = slipGrade(a);
  const loss = a.cost - a.expectedNet;
  return el('div', { class: 'card grade-card' }, [
    el('div', { class: `grade-letter grade-${grade}`, text: grade, 'aria-label': t('gradeTitle') }),
    el('div', { class: 'grade-main' }, [
      el('p', { class: 'grade-kicker', text: t('gradeTitle') }),
      el('p', { class: 'grade-type' }, [el('span', { 'aria-hidden': 'true', text: type.icon }), document.createTextNode(` ${t(`type_${type.key}`)}`)]),
      el('p', { class: 'grade-note', text: `${t(`typeNote_${type.key}`)} · ${t(`gradeNote_${grade}`)}` }),
      el('div', { class: 'grade-lines' }, [
        loss > 0 ? el('span', { text: t('gradeLoss', { loss: fmtMoney(loss, { sign: false }), cups: (loss / BOBA_PRICE).toLocaleString(numberLocale(), { maximumFractionDigits: 1 }) }) }) : null,
        a.paid > 0 ? el('span', { text: t('gradeEvery', { n: (1 / a.paid).toLocaleString(numberLocale(), { maximumFractionDigits: 1 }) }) }) : null
      ])
    ])
  ]);
}

function fmtOneIn(p) {
  return t => t('anaOneIn', { n: fmtCount(1 / Math.max(p, 1e-12)) });
}

// The ticket's chances placed among well-known odds, rarest at the bottom.
function rareCard(a) {
  const t = state.t;
  const same = Math.abs(a.profit - a.top.chance) < 1e-12;
  const mine = [{ key: same ? 'mineBoth' : 'mineTop', p: a.top.chance, icon: '🎫', mine: true }];
  if (!same && a.profit > 0) mine.push({ key: 'mineProfit', p: a.profit, icon: '💰', mine: true });
  const all = [...RARE_EVENTS, ...mine].sort((x, y) => y.p - x.p);
  // Keep the neighbours of the ticket's rows: one well-known event above and below.
  const idx = all.map((r, i) => (r.mine ? i : -1)).filter(i => i >= 0);
  const rows = all.slice(Math.max(0, idx[0] - 1), Math.min(all.length, idx.at(-1) + 2));
  const rarest = Math.max(...rows.map(r => -Math.log10(r.p)));
  const coins = Math.round(Math.log2(1 / Math.max(a.top.chance, 1e-15)));
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: t('rareTitle') }),
    el('ol', { class: 'rare-list' },
      rows.map(r =>
        el('li', { class: r.mine ? 'rare-mine' : '' }, [
          el('span', { class: 'rare-icon', 'aria-hidden': 'true', text: r.icon }),
          el('span', { class: 'rare-name', text: t(`rare_${r.key}`) }),
          el('span', { class: 'rare-track' }, [el('span', { class: 'rare-bar', style: `width:${Math.max(3, (-Math.log10(r.p) / rarest) * 100)}%` })]),
          el('strong', { class: 'rare-odds', text: r.p >= 0.5 ? fmtChance(r.p) : fmtOneIn(r.p)(t) })
        ])
      )
    ),
    coins >= 2 ? el('p', { class: 'note', text: t('rareCoins', { n: coins }) }) : null
  ]);
}

// Opens the ticket for real: every pick drawn from its fair chance. One at a
// time with each pick revealed in turn, with a running tally.
function drawCard(legs, a, sig) {
  const t = state.t;
  const money = v => fmtMoney(v, { sign: false });
  if (state.draws?.sig !== sig) state.draws = { sig, n: 0, spent: 0, back: 0, best: 0, wins: 0, path: [], last: null, busy: false };
  const d = state.draws;
  const box = el('div', { class: 'card draw-card' });
  const drawOne = () => legs.reduce((won, b, i) => (Math.random() < b.fairChance ? won | (1 << i) : won), 0);
  const record = won => {
    const pay = a.net[won];
    d.n++;
    d.spent += a.cost;
    d.back += pay;
    if (pay > 0) d.wins++;
    d.best = Math.max(d.best, pay);
    d.path.push(d.back - d.spent);
    return pay;
  };
  const openOne = () => {
    if (d.busy) return;
    d.busy = true;
    d.last = { won: drawOne(), shown: 0 };
    paint();
    const step = () => {
      if (state.draws !== d || !box.isConnected) return (d.busy = false);
      d.last.shown++;
      if (d.last.shown >= legs.length) {
        d.last.pay = record(d.last.won);
        d.busy = false;
      } else setTimeout(step, 380);
      paint();
    };
    setTimeout(step, 380);
  };
  function paint() {
    const last = d.last;
    const parts = [
      el('h3', { class: 'card-title', text: t('drawTitle') }),
      el('p', { class: 'lede', text: t('drawNote') }),
      el('div', { class: 'draw-buttons' }, [
        el('button', { class: 'primary-button', type: 'button', text: t(d.n > 0 ? 'drawAgain' : 'drawStart'), disabled: d.busy ? '' : null, onclick: openOne })
      ])
    ];
    if (last && last.batch == null) {
      const done = last.shown >= legs.length;
      parts.push(
        el('ul', { class: 'draw-legs' },
          legs.map((b, i) => {
            const shown = i < last.shown;
            const hit = (last.won >> i) & 1;
            return el('li', { class: shown ? (hit ? 'hit' : 'miss') : 'wait' }, [
              el('span', { class: 'draw-mark', 'aria-hidden': 'true', text: shown ? (hit ? '✓' : '✗') : '?' }),
              el('span', { class: 'draw-leg', text: b.shortLabel }),
              el('small', { text: fmtPctShort(b.fairChance) })
            ]);
          })
        )
      );
      if (done) {
        const pay = last.pay;
        const text = pay <= 0 ? t('drawLost', { cost: money(a.cost) }) : pay > a.cost ? t('drawWon', { v: money(pay), profit: money(pay - a.cost) }) : t('drawBackSome', { v: money(pay), loss: money(a.cost - pay) });
        parts.push(el('p', { class: `draw-result ${pay > a.cost ? 'win' : 'lose'}`, text }));
      }
    }
    if (d.n > 0) {
      const net = d.back - d.spent;
      parts.push(
        el('div', { class: 'kpis draw-tally' }, [
          statTile(t('drawOpened'), fmtCount(d.n), '', null, false, '🎫'),
          statTile(t('drawWins'), `${fmtCount(d.wins)} (${fmtShare(d.wins / d.n)})`, '', null, false, '🎯'),
          statTile(t('drawNet'), fmtMoney(net), net < 0 ? 'back-low' : 'back-high', null, false, '💵'),
          statTile(t('drawBest'), d.best > 0 ? money(d.best) : '—', '', null, false, '🏆')
        ]),
        d.path.length > 1 ? sparkline(d.path) : null,
        el('p', { class: 'note', text: t('drawExpected', { n: fmtCount(d.n), v: fmtMoney(d.n * (a.expectedNet - a.cost)) }) })
      );
    }
    box.replaceChildren(...parts.filter(Boolean));
  }
  paint();
  return box;
}

// Missing by one pick: how often it happens next to winning outright, and
// which pick is most often the one that lets the ticket down.
function heartbreakCard(a, legs) {
  const t = state.t;
  const n = legs.length;
  if (n < 2) return null;
  const scale = Math.max(...a.lone);
  const worst = a.lone.indexOf(scale);
  const times = a.top.chance > 0 ? a.nearMiss / a.top.chance : 0;
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: t('heartTitle') }),
    el('p', { class: 'heart-big' }, [
      el('span', { 'aria-hidden': 'true', text: '💔 ' }),
      document.createTextNode(t('heartPre')),
      el('strong', { text: fmtChance(a.nearMiss) }),
      document.createTextNode(times >= 1.05 ? t('heartTimes', { x: times.toLocaleString(numberLocale(), { maximumFractionDigits: 1 }) }) : t('heartPost'))
    ]),
    el('ol', { class: 'run-bars heart-bars' },
      legs.map((b, i) =>
        el('li', { class: i === worst ? 'heart-worst' : '' }, [
          el('span', { class: 'run-hits', text: b.shortLabel }),
          el('span', { class: 'run-track' }, [el('span', { class: 'run-bar', style: `width:${scale > 0 ? (a.lone[i] / scale) * 100 : 0}%` })]),
          el('span', { class: 'run-share' }, [el('strong', { text: fmtChance(a.lone[i]) })])
        ])
      )
    ),
    el('p', { class: 'note', text: t('heartWorst', { leg: legs[worst].shortLabel, p: fmtPctShort(1 - legs[worst].fairChance) }) })
  ]);
}

function renderParlay() {
  const t = state.t;
  const body = $('parlay-body');
  const { legs, dropped } = slipLegs();
  const n = legs.length;
  renderTabs();
  const mode = state.slipMode;
  const chosen = [...state.slipSizes].map(k => (k === 'all' ? n : k));
  const sizes = slipSizes(mode, n, chosen);
  const stake = state.slipStake;
  const slip = legs.map(b => ({ gameId: b.gameId, odds: effectiveOdds(b), fairChance: b.fairChance }));
  const errors = slipErrors({ mode, legs: slip, sizes, stake });
  const rerender = () => renderParlay();

  if (n === 0) {
    body.replaceChildren(
      el('div', { class: 'card slip-empty' }, [
        el('div', { class: 'big-emoji', 'aria-hidden': 'true', text: '🎫' }),
        el('p', { text: t('parlayEmpty') }),
        dropped ? el('p', { class: 'back-low', text: t('slipDroppedLive', { n: dropped }) }) : null,
        el('button', { class: 'primary-button', type: 'button', text: t('goPick'), onclick: () => showTab('games') })
      ])
    );
    return;
  }

  // Left: the ticket itself. Right: what it can pay and what it costs on average.
  const ticket = [
    el('div', { class: 'ticket-head' }, [
      el('strong', { text: t('slipLegs', { n }) }),
      el('button', {
        class: 'ghost-button',
        type: 'button',
        text: t('clearParlay'),
        onclick: () => {
          state.parlay = [];
          renderGames();
          renderLive();
          renderF1();
          renderFutures();
          renderRanking();
          renderParlay();
        }
      })
    ]),
    el('div', { class: 'segmented slip-modes', role: 'group', 'aria-label': t('slipMode') },
      ['single', 'parlay', 'system'].map(m =>
        el('button', {
          type: 'button',
          'aria-pressed': String(m === mode),
          text: t(`slipMode_${m}`),
          onclick: () => {
            state.slipMode = m;
            rerender();
          }
        })
      )
    ),
    el('p', { class: 'mode-note', text: t(`slipModeNote_${mode}`) }),
    dropped ? el('p', { class: 'note back-low', text: t('slipDroppedLive', { n: dropped }) }) : null,
    el('ul', { class: 'parlay-legs' },
      legs.map(b =>
        el('li', {}, [
          betIcon(b),
          legMain(b),
          el('span', { class: 'leg-odds' }, [el('small', { text: '@' }), document.createTextNode(fmtOdds(effectiveOdds(b)))]),
          el('button', { class: 'leg-remove', type: 'button', 'aria-label': t('removeLeg'), text: '×', onclick: () => toggleLeg(b) })
        ])
      )
    )
  ];
  if (mode === 'system' && n >= 3) {
    const options = [...Array.from({ length: n - 2 }, (_, i) => i + 2), 'all'];
    ticket.push(
      el('div', { class: 'slip-field' }, [
        el('span', { text: t('slipSizes') }),
        el('div', { class: 'slip-sizes', role: 'group', 'aria-label': t('slipSizes') },
          options.map(k => {
            const size = k === 'all' ? n : k;
            const on = state.slipSizes.has(k);
            return chip({
              pressed: on,
              text: sizeName(size, n),
              count: `×${fmtCount(choose(n, size))}`,
              onclick: () => {
                if (on) state.slipSizes.delete(k);
                else state.slipSizes.add(k);
                rerender();
              }
            });
          })
        )
      ])
    );
  }
  // Typed in NT$10 units, like the lottery's own slip: 10 units = NT$100.
  const stakeInput = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: '1',
    step: '1',
    value: String(Math.round(stake / SLIP_RULES.unit)),
    'aria-label': t('slipStake'),
    onchange: event => {
      const units = Math.max(0, Math.round(Number(event.target.value) || 0));
      const value = units * SLIP_RULES.unit;
      if (value === state.slipStake) return;
      state.slipStake = value;
      // Redraw after the event: redrawing removes this input, and removing a
      // focused input fires another change while the first is still running.
      setTimeout(rerender);
    }
  });
  ticket.push(
    el('label', { class: 'slip-field' }, [
      el('span', { text: t('slipStake') }),
      el('span', { class: 'stake-box' }, [
        stakeInput,
        el('strong', { text: t('slipStakeEquals', { v: fmtMoney(stake, { sign: false }) }) }),
        el('small', { text: t('slipStakeHint', { unit: SLIP_RULES.unit }) })
      ])
    ])
  );
  if (errors.length) {
    ticket.push(el('ul', { class: 'slip-errors' }, errors.map(e => el('li', { text: t(`slipError_${e}`, { max: SLIP_RULES.maxLegs, min: fmtMoney(SLIP_RULES.minTicket, { sign: false }), maxTicket: fmtMoney(SLIP_RULES.maxTicket, { sign: false }), unit: SLIP_RULES.unit }) }))));
  }
  const cost = sizes.reduce((sum, k) => sum + choose(n, k), 0) * stake;
  if (sizes.length && !errors.includes('stakeUnit')) ticket.push(payoutBox(slip, sizes, stake, mode));
  ticket.push(placeButton(legs, sizes, cost, errors));
  ticket.push(el('details', { class: 'info' }, [el('summary', { text: t('slipRulesTitle') }), el('p', { text: t('slipRulesNote') })]));

  let results = [];
  if (sizes.length && !errors.includes('stakeUnit')) {
    const a = analyzeSlip({ legs: slip, sizes, stake });
    // Range if every fair chance and estimated price is off by its margin, all
    // the same way (the realistic worst and best case).
    const shifted = dir =>
      evaluateSlip({
        legs: legs.map(b => ({
          gameId: b.gameId,
          odds: Math.max(1.01, effectiveOdds(b) * (1 + dir * oddsError(b))),
          fairChance: Math.min(0.999, Math.max(0.001, b.fairChance + dir * (b.fairMargin ?? 0)))
        })),
        sizes,
        stake
      });
    const [low, high] = [shifted(-1), shifted(1)];
    const range = (x, y, fmt) => `${fmt(Math.min(x, y))} – ${fmt(Math.max(x, y))}`;
    results = slipAnalysisView(a, legs, {
      expected: range(low.expectedNet, high.expectedNet, v => fmtMoney(v, { sign: false })),
      any: range(low.anyPayout, high.anyPayout, fmtChance),
      profit: range(low.profit, high.profit, fmtChance),
      take: range(1 - high.expectedNet / a.cost, 1 - low.expectedNet / a.cost, fmtPct)
    }, {
      // Pre-tax top payout if every price were fair (odds = 1 / chance).
      fairTop: slipPayoutTable({ legs: slip.map(l => ({ ...l, odds: 1 / l.fairChance })), sizes, stake }).gross[(1 << n) - 1],
      // A new ticket starts a new tally of draws.
      sig: JSON.stringify([slip, sizes, stake])
    });
  }
  body.replaceChildren(el('div', { class: 'slip has-legs' }, [el('div', { class: 'card ticket' }, ticket), el('div', { class: 'slip-results' }, results)]));
}

// ---- Slip: what each pick is, what the ticket pays ------------------------------

// The market a pick is from, as a small tag: 不讓分, 大小分, 讓分 …
function marketTag(kind) {
  const key = { ml: 'secMoneyline', total: 'secTotal', runline: 'secRunLine', teamtotal: 'secTeamTotal', inning: 'topInningShort', nextrun: 'secNextRun', f1: 'f1Short', future: 'futuresTitle' }[kind];
  return key ? el('span', { class: `market-tag tag-${kind}`, text: state.t(key) }) : null;
}

// A pick on a slip: what it is (with its market), then its game and start
// time in full (the time tells doubleheader games apart).
function legMain(leg) {
  return el('span', { class: 'leg-main' }, [
    el('span', { class: 'leg-pick' }, [leg.live ? el('span', { class: 'market-tag tag-live', text: state.t('tagLive') }) : null, marketTag(leg.kind), el('strong', { text: leg.shortLabel })]),
    el('small', { class: 'slip-leg-game', text: leg.start ? `${leg.matchup} · ${fmtTime(leg.start)}` : leg.matchup })
  ]);
}

// Payout at a glance: for a parlay the odds multiplied out, for singles each
// pick's return, for a system each size; then cost, what all correct pays
// (after tax) and the least a winning ticket pays.
function payoutBox(legs, sizes, stake, mode) {
  const t = state.t;
  const n = legs.length;
  const combos = sizes.reduce((sum, k) => sum + choose(n, k), 0);
  const cost = combos * stake;
  const { gross, net } = slipPayoutTable({ legs, sizes, stake });
  const all = (1 << n) - 1;
  let least = Infinity;
  for (let won = 1; won < gross.length; won++) if (gross[won] > 0) least = Math.min(least, net[won]);
  const rows = [];
  if (mode === 'parlay') {
    const product = legs.reduce((p, l) => p * l.odds, 1);
    rows.push(el('div', { class: 'pay-line pay-formula' }, [
      el('span', { text: `${legs.map(l => fmtOdds(l.odds)).join(' × ')} =` }),
      el('strong', { text: `×${fmtOdds(product)}` })
    ]));
    rows.push(payLine(t('payStake'), fmtMoney(stake, { sign: false })));
  } else if (mode === 'single') {
    legs.forEach((l, i) => rows.push(payLine(`${t('payEach', { i: i + 1 })} ${fmtMoney(stake, { sign: false })} × ${fmtOdds(l.odds)}`, fmtMoney(afterTax(stake * l.odds), { sign: false }))));
  } else {
    for (const k of sizes) rows.push(payLine(t('paySize', { size: sizeName(k, n), c: fmtInt(choose(n, k)) }), fmtMoney(choose(n, k) * stake, { sign: false })));
  }
  rows.push(payLine(t('payCost', { c: fmtInt(combos) }), fmtMoney(cost, { sign: false }), 'pay-cost'));
  const taxed = gross[all] - net[all] > 0.5;
  return el('div', { class: 'pay-box' }, [
    el('p', { class: 'pay-title', text: t('payTitle') }),
    ...rows,
    el('div', { class: 'pay-top' }, [
      el('span', { text: t('payAll') }),
      el('strong', { text: fmtMoney(net[all], { sign: false }) }),
      el('small', { class: net[all] > cost ? 'back-high' : 'back-low', text: t('payProfit', { v: fmtMoney(net[all] - cost) }) })
    ]),
    taxed ? el('p', { class: 'pay-note', text: t('payTaxed', { gross: fmtMoney(gross[all], { sign: false }), tax: fmtMoney(gross[all] - net[all], { sign: false }) }) }) : null,
    mode !== 'parlay' && least < net[all] ? el('p', { class: 'pay-note', text: t('payLeast', { v: fmtMoney(least, { sign: false }) }) }) : null
  ]);
}

function payCell(label, value, cls = '') {
  return el('div', { class: 'pay-cell' }, [el('small', { text: label }), el('strong', { class: cls, text: value })]);
}

function payLine(label, value, cls = '') {
  return el('div', { class: `pay-line ${cls}` }, [el('span', { text: label }), el('strong', { text: value })]);
}

// ---- Simulated account and saved slips ------------------------------------------

// This device's copy, gzip-compressed (see codec.mjs). Older plain-JSON saves still read.
async function loadAccount() {
  try {
    const stored = await unpack(localStorage.getItem(ACCOUNT_KEY));
    if (isAccount(stored)) return stored;
  } catch {}
  return newAccount();
}

function loadSyncCode() {
  try {
    return localStorage.getItem(SYNC_KEY) || '';
  } catch {
    return '';
  }
}

// Writes go one after another, so an older (slower to compress) save never
// lands after a newer one.
let saving = Promise.resolve();
function saveAccountLocal() {
  const account = state.account;
  const code = state.sync.code;
  saving = saving.then(async () => {
    try {
      localStorage.setItem(ACCOUNT_KEY, await pack(account));
      if (code) localStorage.setItem(SYNC_KEY, code);
      else localStorage.removeItem(SYNC_KEY);
    } catch {}
  });
  return saving;
}

// Every change goes to this device at once and to the synced copy shortly after.
function commitAccount(next) {
  // Nothing is written before the saved account has opened: it would be lost.
  if (next === state.account || !state.accountReady) return;
  state.account = next;
  saveAccountLocal();
  renderAccount();
  renderSaved();
  pushSoon();
}

let pushTimer = null;
function pushSoon() {
  if (!state.sync.code) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), 1200);
}

// Reads the synced copy, merges it with this device's and writes the result
// back if this device had anything new: no device ever overwrites another's
// slips or top-ups.
async function syncNow() {
  const code = state.sync.code;
  if (!code || state.sync.busy || !state.accountReady) return;
  state.sync = { ...state.sync, busy: true, error: '' };
  renderAccount();
  try {
    const remote = await readSync(code);
    if (remote && !isAccount(remote)) throw new Error('bad account');
    const merged = mergeAccounts(state.account, remote);
    if (!remote || JSON.stringify(merged) !== JSON.stringify(remote)) await writeSync(code, merged);
    if (JSON.stringify(merged) !== JSON.stringify(state.account)) {
      state.account = merged;
      saveAccountLocal();
      renderSaved();
    }
    state.sync = { ...state.sync, busy: false, at: new Date().toISOString() };
  } catch (error) {
    console.error(error);
    state.sync = { ...state.sync, busy: false, error: state.t('syncFailed') };
  }
  renderAccount();
}

async function createSyncCode() {
  state.sync = { ...state.sync, busy: true, error: '' };
  renderAccount();
  try {
    const code = await createSync(state.account);
    state.sync = { code, busy: false, error: '', at: new Date().toISOString(), fresh: true };
    saveAccountLocal();
  } catch (error) {
    console.error(error);
    state.sync = { ...state.sync, busy: false, error: state.t('syncFailed') };
  }
  renderAccount();
}

// Joining an account from another device: that account and this device's
// merged (the NT$10,000 start counts once).
async function linkSyncCode(raw) {
  const code = cleanPasscode(raw);
  if (!PASSCODE_PATTERN.test(code)) {
    state.sync = { ...state.sync, error: state.t('syncBadCode') };
    renderAccount();
    return;
  }
  state.sync = { ...state.sync, busy: true, error: '' };
  renderAccount();
  try {
    const remote = await readSync(code);
    if (!isAccount(remote)) {
      state.sync = { ...state.sync, busy: false, error: state.t('syncNotFound') };
      renderAccount();
      return;
    }
    state.sync = { code, busy: false, error: '', at: null };
    state.account = mergeAccounts(remote, state.account);
    saveAccountLocal();
    renderSaved();
    await syncNow();
  } catch (error) {
    console.error(error);
    state.sync = { ...state.sync, busy: false, error: state.t('syncFailed') };
    renderAccount();
  }
}

function unlinkSync() {
  if (!confirm(state.t('syncUnlinkConfirm'))) return;
  state.sync = { code: '', busy: false, error: '', at: null };
  saveAccountLocal();
  renderAccount();
}

// What a pick on the slip needs to be settled later, whatever the board shows then.
function legRecord(bet) {
  return {
    id: bet.id,
    kind: bet.kind,
    sport: bet.sport,
    label: bet.label,
    shortLabel: bet.shortLabel,
    matchup: bet.matchup,
    start: bet.start ?? null,
    odds: effectiveOdds(bet),
    fairChance: bet.fairChance,
    side: bet.side ?? null,
    line: bet.totalLine ?? bet.runLine ?? bet.teamLine ?? bet.runN ?? null,
    team: bet.kind === 'future' ? bet.teamEn : bet.team ?? null,
    inning: bet.inning ?? null,
    away: bet.game?.away.en ?? null,
    home: bet.game?.home.en ?? null,
    driver: bet.driverEn ?? null,
    eventSlug: bet.eventSlug ?? null,
    live: bet.live ? true : undefined
  };
}

// The 模擬下注 button: buys the slip on the simulated account.
function placeButton(legs, sizes, cost, errors) {
  const t = state.t;
  const funds = balance(state.account);
  const short = cost > funds;
  const blocked = errors.length > 0 || sizes.length === 0 || short || !state.accountReady;
  return el('div', { class: 'place-row' }, [
    el('button', {
      class: 'primary-button place-button',
      type: 'button',
      disabled: blocked ? '' : null,
      text: short ? t('placeShort', { v: fmtMoney(funds, { sign: false }) }) : t('placeSlip', { v: fmtMoney(cost, { sign: false }) }),
      onclick: () => {
        const slip = { id: newSlipId(), mode: state.slipMode, sizes, stake: state.slipStake, cost, legs: legs.map(legRecord) };
        const { account, error } = placeSlip(state.account, slip);
        if (error) return;
        state.parlay = [];
        state.freshSlips.add(slip.id);
        commitAccount(account);
        renderGames();
        renderLive();
        renderF1();
        renderFutures();
        renderRanking();
        renderParlay();
        showTab('history');
      }
    }),
    el('small', { class: 'muted', text: t('placeNote', { v: fmtMoney(funds, { sign: false }) }) })
  ]);
}

// Legs of open slips whose games are over get their results; a slip is paid
// once every leg is decided. A game still not found three days after its
// start (postponed and never replayed) counts as void, as the lottery does.
const RESULT_CHECK_MS = 90_000;
const VOID_AFTER_MS = 3 * 86_400_000;
async function checkResults(force = false) {
  if (!state.accountReady) return;
  const open = state.account.slips.filter(s => s.status === 'open');
  const now = new Date();
  const pending = open.flatMap(s => s.legs.filter(l => !l.result && (l.kind === 'future' || (l.start && Date.parse(l.start) <= now.getTime()))));
  if (!pending.length || state.checking) return;
  if (!force && now.getTime() - state.checkedAt < RESULT_CHECK_MS) return;
  state.checking = true;
  state.checkedAt = now.getTime();
  renderSaved();
  try {
    const outcomes = await fetchOutcomes(pending, now);
    let account = state.account;
    for (const slip of open) {
      const results = slip.legs.map(leg => {
        if (leg.result) return leg.result;
        const result = legResult(leg, outcomes.get(leg.id));
        if (result) return result;
        const stale = leg.kind !== 'future' && leg.start && now.getTime() - Date.parse(leg.start) > VOID_AFTER_MS;
        return stale && !outcomes.has(leg.id) ? 'void' : null;
      });
      const next = applyResults(account, slip.id, results, now);
      if (next !== account && next.slips.find(s => s.id === slip.id).status === 'settled') state.freshSlips.add(slip.id);
      account = next;
    }
    commitAccount(account);
  } catch (error) {
    console.error(error);
  } finally {
    state.checking = false;
    renderSaved();
  }
}

function renderAccount() {
  if (!state.accountReady) return;
  const t = state.t;
  const account = state.account;
  const now = new Date();
  const funds = balance(account);
  const grants = account.ledger.filter(e => e.kind === 'grant').reduce((s, e) => s + e.amount, 0);
  const open = account.slips.filter(s => s.status === 'open');
  const atStake = open.reduce((s, x) => s + x.cost, 0);
  // Won or lost on settled slips, and money still on open ones.
  const net = funds + atStake - START_BALANCE - grants;
  const claim = canClaim(account, now)
    ? el('button', { class: 'primary-button', type: 'button', text: t('claimGrant', { v: fmtMoney(WEEKLY_GRANT, { sign: false }) }), onclick: () => commitAccount(claimGrant(state.account)) })
    : el('p', { class: 'muted', text: t(account.ledger.some(e => e.id === `grant-${weekKey(now)}`) ? 'nextGrant' : 'firstGrant', { v: fmtMoney(WEEKLY_GRANT, { sign: false }), when: fmtTime(nextGrantAt(now).toISOString()) }) });
  const sync = state.sync;
  let syncBody;
  if (sync.code) {
    syncBody = [
      el('p', { class: 'sync-code-line' }, [
        el('span', { text: t('syncCode') }),
        el('code', { class: 'sync-code', text: `${sync.code.slice(0, 4)} ${sync.code.slice(4)}` }),
        el('button', {
          class: 'ghost-button',
          type: 'button',
          text: t('syncCopy'),
          onclick: event => {
            navigator.clipboard?.writeText(sync.code).then(() => (event.target.textContent = t('syncCopied'))).catch(() => {});
          }
        })
      ]),
      sync.fresh ? el('p', { class: 'note', text: t('syncKeep') }) : null,
      el('p', { class: 'muted', text: sync.busy ? t('syncing') : sync.at ? t('syncedAt', { when: fmtTime(sync.at) }) : '' }),
      el('div', { class: 'button-row' }, [
        el('button', { class: 'ghost-button', type: 'button', text: t('syncNow'), disabled: sync.busy ? '' : null, onclick: () => syncNow() }),
        el('button', { class: 'ghost-button', type: 'button', text: t('syncUnlink'), onclick: unlinkSync })
      ])
    ];
  } else {
    const input = el('input', { class: 'sync-input', type: 'text', maxlength: '9', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: t('syncPlaceholder'), 'aria-label': t('syncEnter') });
    syncBody = [
      el('p', { class: 'muted', text: t('syncIntro') }),
      el('div', { class: 'button-row' }, [el('button', { class: 'ghost-button', type: 'button', text: t('syncCreate'), disabled: sync.busy ? '' : null, onclick: createSyncCode })]),
      el('form', {
        class: 'sync-form',
        onsubmit: event => {
          event.preventDefault();
          linkSyncCode(input.value);
        }
      }, [input, el('button', { class: 'ghost-button', type: 'submit', text: t('syncLink'), disabled: sync.busy ? '' : null })])
    ];
  }
  $('account-body').replaceChildren(
    el('div', { class: 'card account-card' }, [
      el('div', { class: 'account-top' }, [
        el('div', {}, [el('p', { class: 'muted', text: t('accountBalance') }), el('p', { class: 'account-balance stat-value', text: fmtMoney(funds, { sign: false }) })]),
        el('div', { class: 'account-side' }, [
          el('p', {}, [el('span', { class: 'muted', text: `${t('accountAtStake')} ` }), el('strong', { text: fmtMoney(atStake, { sign: false }) })]),
          el('p', {}, [el('span', { class: 'muted', text: `${t('accountNet')} ` }), el('strong', { class: net < -0.5 ? 'back-low' : net > 0.5 ? 'back-high' : '', text: fmtMoney(net) })])
        ])
      ]),
      claim,
      el('p', { class: 'muted small', text: t('accountNote', { start: fmtMoney(START_BALANCE, { sign: false }), v: fmtMoney(WEEKLY_GRANT, { sign: false }) }) }),
      el('details', { class: 'sync', open: state.syncOpen || sync.error || sync.fresh ? '' : null, ontoggle: event => (state.syncOpen = event.target.open) }, [
        el('summary', { text: sync.code ? t('syncOn') : t('syncTitle') }),
        ...syncBody,
        sync.error ? el('p', { class: 'back-low', text: sync.error }) : null
      ])
    ])
  );
}

const RESULT_ICON = { won: '✓', lost: '✗', void: '↺' };

// Where each pick stands: won / lost / void, 'live' (its game is on), or
// 'waiting' (not started).
function legState(leg, now = Date.now()) {
  if (leg.result) return leg.result;
  return leg.start && Date.parse(leg.start) <= now ? 'live' : 'waiting';
}

// What an open slip has locked in (every undecided pick lost) and the most it
// can still pay (every undecided pick won).
function slipRange(slip) {
  const as = result => slip.legs.map(leg => ({ odds: leg.odds, result: leg.result ?? result }));
  return {
    locked: settleSlip({ legs: as('lost'), sizes: slip.sizes, stake: slip.stake }).net,
    most: settleSlip({ legs: as('won'), sizes: slip.sizes, stake: slip.stake }).net
  };
}

const LEG_ICON = { won: '✓', lost: '✗', void: '↺', live: '●', waiting: '⏳' };

function savedSlipCard(slip) {
  const t = state.t;
  const n = slip.legs.length;
  const now = Date.now();
  const settled = slip.status === 'settled';
  const states = slip.legs.map(leg => legState(leg, now));
  const decided = states.filter(st => ['won', 'lost', 'void'].includes(st)).length;
  const profit = settled ? slip.payout - slip.cost : null;
  const range = settled ? null : slipRange(slip);
  // Open, but nothing left can pay: a parlay with a lost pick.
  const dead = !settled && range.most <= 0;
  const mode = slip.mode === 'system' ? slip.sizes.map(k => sizeName(k, n)).join('、') : t(`slipMode_${slip.mode}`);
  const pill = settled
    ? el('span', { class: `slip-pill ${profit > 0 ? 'won' : profit < 0 ? 'lost' : ''}`, text: slip.payout > 0 ? t('slipPaid', { v: fmtMoney(slip.payout, { sign: false }) }) : t('slipLost') })
    : dead
      ? el('span', { class: 'slip-pill lost', text: t('slipDead') })
      : el('span', { class: `slip-pill ${states.includes('live') ? 'live' : 'open'}`, text: states.includes('live') ? t('slipLiveNow') : t('slipOpen') });
  const nextStart = slip.legs.filter((leg, k) => states[k] === 'waiting' && leg.start).map(leg => leg.start).sort()[0];
  return el('article', { class: `card saved-slip ${state.freshSlips.has(slip.id) ? 'fresh' : ''} ${dead ? 'dead' : ''}` }, [
    el('div', { class: 'saved-head' }, [
      el('div', { class: 'saved-title' }, [
        el('span', { class: 'mode-tag', text: mode }),
        el('strong', { text: t('slipLegs', { n }) }),
        el('small', { class: 'muted', text: t('slipBoughtAt', { time: fmtTime(slip.t) }) })
      ]),
      pill
    ]),
    // One segment per pick, coloured by where it stands.
    el('div', { class: 'leg-bar', role: 'img', 'aria-label': t('slipProgress', { k: decided, n }) }, states.map(st => el('span', { class: `seg seg-${st}` }))),
    el('p', { class: 'saved-progress' }, [
      document.createTextNode(t('slipProgress', { k: decided, n })),
      !settled && nextStart ? el('span', { class: 'muted', text: ` · ${t('slipNextStart', { time: fmtTime(nextStart) })}` }) : null
    ]),
    el('ul', { class: 'parlay-legs saved-legs' },
      slip.legs.map((leg, k) =>
        el('li', { class: `leg-${states[k]}` }, [
          el('span', { class: 'leg-result', 'aria-label': t(`legState_${states[k]}`), title: t(`legState_${states[k]}`), text: LEG_ICON[states[k]] }),
          legMain(leg),
          el('span', { class: 'leg-odds' }, [el('small', { text: '@' }), document.createTextNode(fmtOdds(leg.odds))])
        ])
      )
    ),
    el('div', { class: 'saved-pay' }, settled
      ? [
          payCell(t('slipCost'), fmtMoney(slip.cost, { sign: false })),
          payCell(t('slipPaidLabel'), fmtMoney(slip.payout, { sign: false })),
          payCell(t('slipResult'), fmtMoney(profit), profit > 0 ? 'back-high' : profit < 0 ? 'back-low' : '')
        ]
      : [
          payCell(t('slipCost'), fmtMoney(slip.cost, { sign: false })),
          slip.mode === 'parlay' ? payCell(t('payOdds'), `×${fmtOdds(slip.legs.reduce((p, l) => p * l.odds, 1))}`) : null,
          decided && range.locked > 0 ? payCell(t('slipLocked'), fmtMoney(range.locked, { sign: false }), 'back-high') : null,
          payCell(decided ? t('slipMost') : t('payAll'), fmtMoney(range.most, { sign: false }), dead ? 'back-low' : '')
        ]),
    slipInsight(slip)
  ]);
}

// What the odds said when the slip was bought, and (once settled) how it
// went against that; each pick's chance in the folded part.
function slipInsight(slip) {
  const t = state.t;
  const look = outlookOf(slip);
  const lines = [t('insightBought', { exp: fmtMoney(look.mean, { sign: false }), back: fmtBack((look.mean / slip.cost) * 100), any: fmtPctShort(look.any) })];
  if (slip.status === 'settled') lines.push(t('insightLuck', { v: fmtMoney(slip.payout - look.mean) }));
  const tax = (slip.gross ?? slip.payout) - slip.payout;
  if (tax > 0) lines.push(t('insightTax', { v: fmtMoney(tax, { sign: false }) }));
  return el('details', { class: 'slip-insight' }, [
    el('summary', { text: lines[0] }),
    ...lines.slice(1).map(text => el('p', { text })),
    table([t('colPick'), t('colOddsBought'), t('colFair'), t('colBackPer')], slip.legs.map(leg => [leg.shortLabel, fmtOdds(leg.odds), fmtPctShort(chanceOf(leg)), fmtBack(chanceOf(leg) * leg.odds * 100)]))
  ]);
}

const HISTORY_FILTERS = {
  all: () => true,
  open: s => s.status === 'open',
  won: s => s.status === 'settled' && s.payout > s.cost,
  lost: s => s.status === 'settled' && s.payout <= s.cost
};

// Groups for the slip list: games on now, waiting to start, already lost
// (a parlay with a lost pick, waiting for its other games), then settled
// slips by the Taiwan day they were settled.
function slipGroupKey(slip, now) {
  if (slip.status === 'settled') return `day|${taipeiDayKey(slip.settledAt ?? slip.t)}`;
  if (slipRange(slip).most <= 0) return 'dead';
  return slip.legs.some(leg => legState(leg, now) === 'live') ? 'live' : 'waiting';
}

function groupTitle(key) {
  const t = state.t;
  if (key === 'live') return t('groupLive');
  if (key === 'waiting') return t('groupWaiting');
  if (key === 'dead') return t('groupDead');
  const day = key.slice(4);
  const today = taipeiDayKey(new Date());
  const yesterday = taipeiDayKey(new Date(Date.now() - 86_400_000));
  const [, m, d] = day.split('-').map(Number);
  const name = day === today ? t('today') : day === yesterday ? t('yesterday') : `${m}/${d}（${dayLabel(day)}）`;
  return t('groupSettled', { day: name });
}

function groupSummary(key, slips) {
  const t = state.t;
  const cost = slips.reduce((s, x) => s + x.cost, 0);
  if (key.startsWith('day|')) {
    const net = slips.reduce((s, x) => s + x.payout - x.cost, 0);
    return el('span', { class: 'group-sum' }, [
      document.createTextNode(t('groupCountCost', { n: slips.length, cost: fmtMoney(cost, { sign: false }) })),
      el('strong', { class: net > 0.5 ? 'back-high' : net < -0.5 ? 'back-low' : '', text: fmtMoney(net) })
    ]);
  }
  if (key === 'dead') return el('span', { class: 'group-sum' }, [document.createTextNode(t('groupCountCost', { n: slips.length, cost: fmtMoney(cost, { sign: false }) })), el('strong', { class: 'back-low', text: fmtMoney(-cost) })]);
  const most = slips.reduce((s, x) => s + slipRange(x).most, 0);
  return el('span', { class: 'group-sum' }, [document.createTextNode(t('groupCountCost', { n: slips.length, cost: fmtMoney(cost, { sign: false }) })), el('strong', { text: t('groupMost', { v: fmtMoney(most, { sign: false }) }) })]);
}

// The 紀錄 tab shows either the slips or the stats.
function applyHistoryView() {
  const t = state.t;
  const any = state.accountReady && state.account.slips.length > 0;
  const view = state.historyView;
  $('history-tabs').hidden = !any;
  $('history-tabs').replaceChildren(
    ...['slips', 'stats'].map(key =>
      el('button', {
        type: 'button',
        'aria-pressed': String(key === view),
        text: t(`historyView_${key}`),
        onclick: () => {
          state.historyView = key;
          applyHistoryView();
          renderStats();
        }
      })
    )
  );
  if (!any) return;
  $('saved').hidden = view !== 'slips';
  $('stats').hidden = view !== 'stats';
}

function renderSaved() {
  renderStats();
  if (!state.accountReady) return;
  const t = state.t;
  const slips = state.account.slips;
  const open = slips.filter(s => s.status === 'open');
  $('saved').hidden = slips.length === 0;
  applyHistoryView();
  if (!slips.length) return;
  const now = Date.now();
  const filtered = slips.filter(HISTORY_FILTERS[state.historyFilter]);
  // Open slips all show; settled ones fold after SAVED_SHOWN.
  let settledShown = 0;
  const groups = new Map();
  for (const slip of filtered) {
    const key = slipGroupKey(slip, now);
    if (key.startsWith('day|') && !state.showAllSaved && settledShown++ >= SAVED_SHOWN) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slip);
  }
  const rank = key => ({ live: 0, waiting: 1, dead: 2 })[key] ?? 3;
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
  const hidden = filtered.filter(s => s.status === 'settled').length - Math.min(settledShown, SAVED_SHOWN);
  const openCost = open.reduce((s, x) => s + x.cost, 0);
  const openMost = open.reduce((s, x) => s + slipRange(x).most, 0);
  const settledNet = slips.filter(s => s.status === 'settled').reduce((s, x) => s + x.payout - x.cost, 0);
  $('saved-body').replaceChildren(
    el('div', { class: 'saved-summary' }, [
      payCell(t('sumOpen'), t('sumSlips', { n: open.length })),
      payCell(t('sumAtStake'), fmtMoney(openCost, { sign: false })),
      payCell(t('sumMost'), fmtMoney(openMost, { sign: false })),
      payCell(t('sumSettledNet'), fmtMoney(settledNet), settledNet > 0.5 ? 'back-high' : settledNet < -0.5 ? 'back-low' : '')
    ]),
    el('div', { class: 'saved-toolbar' }, [
      el('div', { class: 'chips history-filter', role: 'group', 'aria-label': t('savedTitle') },
        Object.keys(HISTORY_FILTERS).map(key =>
          chip({
            pressed: key === state.historyFilter,
            text: t(`filter_${key}`),
            count: String(slips.filter(HISTORY_FILTERS[key]).length),
            onclick: () => {
              state.historyFilter = key;
              state.showAllSaved = false;
              renderSaved();
            }
          })
        )
      ),
      open.length
        ? el('button', { class: 'ghost-button', type: 'button', disabled: state.checking ? '' : null, text: state.checking ? t('checking') : t('checkResults'), onclick: () => checkResults(true) })
        : null
    ]),
    ...(order.length
      ? order.map(key =>
          el('section', { class: `slip-group group-${key.split('|')[0]}` }, [
            el('div', { class: 'group-head' }, [el('h3', { text: groupTitle(key) }), groupSummary(key, groups.get(key))]),
            el('div', { class: 'saved-list' }, groups.get(key).map(savedSlipCard))
          ])
        )
      : [el('p', { class: 'muted', text: t('filterEmpty') })]),
    ...(hidden > 0 && !state.showAllSaved
      ? [el('button', { class: 'ghost-button', type: 'button', text: t('savedMore', { n: hidden }), onclick: () => ((state.showAllSaved = true), renderSaved()) })]
      : [])
  );
}

// ---- History: stats and analysis --------------------------------------------------

function table(head, rows) {
  return el('div', { class: 'table-view' }, el('table', {}, [
    el('thead', {}, el('tr', {}, head.map(h => el('th', { text: h })))),
    el('tbody', {}, rows.map(cells => el('tr', {}, cells.map(c => (c instanceof Node ? el('td', {}, c) : el('td', { text: c }))))))
  ]));
}

const fmtBack = v => (v == null ? '–' : fmtInt(Math.round(v)));
const fmtRate = v => (v == null ? '–' : fmtPctShort(v));
function netCell(v) {
  return el('span', { class: v < -0.5 ? 'back-low' : v > 0.5 ? 'back-high' : '', text: fmtMoney(v) });
}

// The balance after every entry: start, weekly top-ups, slips bought, payouts.
function balanceChart(timeline) {
  const t = state.t;
  const w = 600;
  const h = 170;
  const m = { top: 12, right: 8, bottom: 22, left: 8 };
  const values = timeline.map(p => p.balance);
  const lo = Math.min(0, ...values);
  const hi = Math.max(START_BALANCE, ...values);
  const x = i => m.left + (timeline.length < 2 ? 0 : (i / (timeline.length - 1)) * (w - m.left - m.right));
  const y = v => m.top + ((hi - v) / (hi - lo || 1)) * (h - m.top - m.bottom);
  const svg = svgEl('svg', { class: 'balance-chart', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': t('balanceChart') });
  svg.append(
    svgEl('line', { class: 'zero-line', x1: m.left, x2: w - m.right, y1: y(START_BALANCE), y2: y(START_BALANCE) }),
    Object.assign(svgEl('text', { class: 'chart-note', x: w - m.right, y: y(START_BALANCE) - 4, 'text-anchor': 'end' }), { textContent: fmtMoney(START_BALANCE, { sign: false }) })
  );
  // Steps: the balance holds until the next entry.
  let d = `M${x(0)},${y(values[0])}`;
  for (let i = 1; i < values.length; i++) d += `H${x(i).toFixed(1)}V${y(values[i]).toFixed(1)}`;
  svg.append(svgEl('path', { class: 'balance-line', d }));
  timeline.forEach((p, i) => {
    if (p.kind === 'payout' && p.amount > 0) svg.append(svgEl('circle', { class: 'balance-win', cx: x(i), cy: y(p.balance), r: 3.5 }));
    if (p.kind === 'grant') svg.append(svgEl('circle', { class: 'balance-grant', cx: x(i), cy: y(p.balance), r: 3 }));
  });
  const first = new Date(timeline[0].t);
  const last = new Date(timeline.at(-1).t);
  const day = d => formatter('md', locale => new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', timeZone: 'Asia/Taipei' })).format(d);
  svg.append(
    Object.assign(svgEl('text', { class: 'chart-note', x: m.left, y: h - 6 }), { textContent: day(first) }),
    Object.assign(svgEl('text', { class: 'chart-note', x: w - m.right, y: h - 6, 'text-anchor': 'end' }), { textContent: day(last) })
  );
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: t('balanceChart') }),
    svg,
    el('p', { class: 'legend' }, [
      el('span', {}, [el('span', { class: 'legend-key dot win' }), document.createTextNode(t('chartPayout'))]),
      el('span', {}, [el('span', { class: 'legend-key dot grant' }), document.createTextNode(t('chartGrant'))])
    ])
  ]);
}

// Luck against the lottery's cut: what the odds said these slips would pay
// back, what they did, and how unusual the gap is.
function luckCard(s) {
  const t = state.t;
  const pct = Math.round(s.luckShare * 100);
  const verdict =
    Math.abs(s.luckZ) < 0.5 ? t('luckNormal') : s.luckZ > 0 ? t('luckGood', { p: Math.max(1, 100 - pct) }) : t('luckBad', { p: Math.max(1, pct) });
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: t('luckTitle') }),
    el('ul', { class: 'facts' }, [
      el('li', { text: t('luckExpected', { staked: fmtMoney(s.staked, { sign: false }), exp: fmtMoney(s.expected, { sign: false }), back: fmtBack(s.expectedBack), loss: fmtMoney(s.expectedLoss, { sign: false }) }) }),
      el('li', { text: t('luckActual', { paid: fmtMoney(s.paid, { sign: false }), back: fmtBack(s.back), diff: fmtMoney(s.luck), sd: fmtMoney(s.luckSd, { sign: false }) }) }),
      el('li', { text: verdict }),
      el('li', { text: t('luckLongRun') })
    ])
  ]);
}

function picksCard(s) {
  const t = state.t;
  if (!s.picks.legs) return null;
  const bandName = ([lo, hi]) => `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`;
  const kindName = k => t({ ml: 'secMoneyline', total: 'secTotal', runline: 'secRunLine', teamtotal: 'secTeamTotal', inning: 'secTopInning', f1: 'f1Title', future: 'futuresTitle' }[k] ?? k);
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: t('picksTitle') }),
    el('p', { class: 'lede', text: t('picksSummary', { n: fmtInt(s.picks.legs), won: fmtInt(s.picks.won), rate: fmtRate(s.picks.rate), exp: fmtRate(s.picks.expectedRate), odds: fmtOdds(s.picks.avgOdds), voids: fmtInt(s.picks.void) }) }),
    table([t('colChance'), t('colPicks'), t('colHit'), t('colExpectedHit')], s.bands.filter(b => b.legs).map(b => [bandName(b.range), fmtInt(b.legs), fmtRate(b.rate), fmtRate(b.expectedRate)])),
    el('p', { class: 'note', text: t('picksBandsNote') }),
    table([t('colMarket'), t('colPicks'), t('colHit'), t('colExpectedHit'), t('colAvgOdds')], s.byKind.map(k => [kindName(k.key), fmtInt(k.legs), fmtRate(k.rate), fmtRate(k.expectedRate), fmtOdds(k.avgOdds)]))
  ]);
}

function breakdownCard(s) {
  const t = state.t;
  const moneyRows = list => list.map(b => [b.name, fmtInt(b.slips), fmtMoney(b.staked, { sign: false }), netCell(b.net), fmtBack(b.back), fmtBack(b.expectedBack)]);
  const head = first => [first, t('colSlips'), t('colStaked'), t('colNet'), t('colBackActual'), t('colExpectedBack')];
  const sports = s.bySport.filter(b => b.slips).map(b => ({ ...b, name: b.key === 'mixed' ? t('sportMixed') : t(`sport_${b.key}`) }));
  const modes = s.byMode.map(b => ({ ...b, name: t(`slipMode_${b.key}`) }));
  const legs = s.byLegs.map(b => ({ ...b, name: t('legsN', { n: b.key }) }));
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: t('breakdownTitle') }),
    el('p', { class: 'note', text: t('breakdownNote') }),
    table(head(t('colSport')), moneyRows(sports)),
    table(head(t('colMode')), moneyRows(modes)),
    table(head(t('colLegs')), moneyRows(legs))
  ]);
}

function recordsCard(s) {
  const t = state.t;
  const r = s.records;
  const slipName = slip => `${fmtTime(slip.t)} · ${t(`slipMode_${slip.mode}`)} ${t('slipLegs', { n: slip.legs.length })}`;
  const items = [];
  const streakNow = s.streak.current > 0 ? t('streakWinNow', { n: s.streak.current }) : s.streak.current < 0 ? t('streakLossNow', { n: -s.streak.current }) : null;
  if (streakNow) items.push(streakNow);
  items.push(t('streakBest', { win: s.streak.bestWin, loss: s.streak.bestLoss }));
  if (r.best && r.best.profit > 0) items.push(t('recordBest', { v: fmtMoney(r.best.profit), slip: slipName(r.best.slip) }));
  if (r.worst && r.worst.profit < 0) items.push(t('recordWorst', { v: fmtMoney(r.worst.profit), slip: slipName(r.worst.slip) }));
  if (r.longest) items.push(t('recordLongest', { x: fmtOdds(r.longest.odds), slip: slipName(r.longest.slip) }));
  items.push(t('recordAverage', { cost: fmtMoney(s.avgCost, { sign: false }), combos: fmtInt(s.combos) }));
  if (s.tax > 0) items.push(t('recordTax', { v: fmtMoney(s.tax, { sign: false }) }));
  return el('div', { class: 'card' }, [el('h3', { class: 'card-title', text: t('recordsTitle') }), el('ul', { class: 'facts records' }, items.map(text => el('li', { text })))]);
}

function weeksCard(s) {
  const t = state.t;
  if (s.weeks.length < 2) return null;
  const day = iso => formatter('md', locale => new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })).format(new Date(`${iso}T00:00:00Z`));
  return el('details', { class: 'card fold' }, [
    el('summary', { text: t('weeksTitle') }),
    table([t('colWeek'), t('colSlips'), t('colStaked'), t('colNet'), t('colBackActual')], s.weeks.map(b => [t('weekOf', { d: day(b.week) }), fmtInt(b.slips), fmtMoney(b.staked, { sign: false }), netCell(b.net), fmtBack(b.back)]))
  ]);
}

// Fun facts from the slips.
function funCard() {
  const t = state.t;
  const f = funFacts(state.account);
  const s = historyStats(state.account);
  const items = [];
  const leg = l => `${l.shortLabel}（${l.matchup}）`;
  if (f.upset) items.push(t('funUpset', { pick: leg(f.upset.leg), p: fmtPctShort(f.upset.chance), odds: fmtOdds(f.upset.leg.odds) }));
  if (f.heartbreak) items.push(t('funHeartbreak', { pick: leg(f.heartbreak.leg), p: fmtPctShort(f.heartbreak.chance) }));
  if (f.nearMiss) items.push(t('funNearMiss', { n: f.nearMiss.count, v: fmtMoney(f.nearMiss.missed, { sign: false }) }));
  if (f.team) items.push(t('funTeam', { team: f.team.name, n: f.team.picks, won: f.team.won, decided: f.team.decided }));
  if (f.market) items.push(t('funMarket', { market: marketTag(f.market.kind)?.textContent ?? f.market.kind, share: fmtPctShort(f.market.share) }));
  if (f.weekday) items.push(t('funWeekday', { day: formatter('weekdayLong', locale => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })).format(new Date(Date.UTC(2026, 0, 4 + f.weekday.day))), n: f.weekday.slips }));
  if (f.live) items.push(t('funLive', { n: f.live.picks, share: fmtPctShort(f.live.share) }));
  if (f.dream) items.push(t('funDream', { x: fmtInt(Math.round(f.dream.times)), cost: fmtMoney(f.dream.slip.cost, { sign: false }) }));
  if (s.settled && s.expectedLoss >= BOBA_PRICE) items.push(t('funBoba', { v: fmtMoney(s.expectedLoss, { sign: false }), cups: fmtInt(Math.round(s.expectedLoss / BOBA_PRICE)) }));
  if (!items.length) return null;
  return el('div', { class: 'card' }, [el('h3', { class: 'card-title', text: t('funTitle') }), el('ul', { class: 'facts' }, items.map(text => el('li', { text })))]);
}

// The account against the simulated crowd, over the same length of time.
// The crowd is simulated only here or on the simulator tab, never at start-up.
function crowdCard(s) {
  const t = state.t;
  const profile = bettingProfile(state.account);
  if (!profile || !state.data) return null;
  const months = PERIOD_MONTHS.find(m => m >= Math.min(60, Math.ceil((profile.weeks * 12) / 52))) ?? 60;
  const weeks = monthWeeks(months);
  const sportBets = simSportBets();
  const crowd = crowdCache.get(crowdKey(sportBets, weeks));
  const title = el('h3', { class: 'card-title', text: t('crowdTitle', { n: fmtCount(SIM_PLAYERS_SHOWN), period: periodName(weeks) }) });
  if (!crowd) {
    crowdStats(sportBets, weeks, { quiet: true }).then(
      () => state.tab === 'history' && state.historyView === 'stats' && renderStats(),
      () => {}
    );
    return el('div', { class: 'card' }, [title, el('p', { class: 'muted crowd-wait' }, [el('span', { class: 'spinner small', 'aria-hidden': 'true' }), document.createTextNode(t('crowdRunning', { n: fmtCount(SIM_PLAYERS_SHOWN) }))])]);
  }
  const mine = s.net;
  const beat = crowdPercentile(crowd.finalQuantiles, mine);
  const crowdBack = crowd.totals.staked ? ((crowd.totals.staked + crowd.totals.net) / crowd.totals.staked) * 100 : null;
  const habit = closestHabit(profile, HABITS);
  const summary = crowd.summaries.find(x => x.habit.key === habit.key);
  const perPerson = { tickets: crowd.totals.tickets / crowd.players, staked: crowd.totals.staked / crowd.players };
  const rows = [
    [t('crowdColNet'), fmtMoney(mine), fmtMoney(quantile(crowd.finalQuantiles, 0.5))],
    [t('crowdColBack'), s.settled ? fmtBack(s.back) : '–', fmtBack(crowdBack)],
    [t('crowdColSlips'), fmtInt(s.placed), fmtCount(perPerson.tickets)],
    [t('crowdColStaked'), fmtMoney(state.account.slips.reduce((x, y) => x + y.cost, 0), { sign: false }), fmtMoney(perPerson.staked, { sign: false })],
    [t('crowdColLegs'), profile.legs.toFixed(1), '–']
  ];
  return el('div', { class: 'card crowd-card' }, [
    title,
    el('div', { class: 'crowd-hero' }, [
      el('strong', { text: fmtPctShort(beat) }),
      el('span', { text: t('crowdBeat', { n: fmtCount(SIM_PLAYERS_SHOWN), period: periodName(weeks) }) })
    ]),
    el('div', { class: 'crowd-bar', role: 'img', 'aria-label': t('crowdBeat', { n: fmtCount(SIM_PLAYERS_SHOWN), period: periodName(weeks) }) }, [el('span', { class: 'crowd-you', style: `left:${(beat * 100).toFixed(1)}%` })]),
    el('p', { class: 'crowd-scale muted' }, [el('span', { text: t('crowdWorst') }), el('span', { text: t('crowdBest') })]),
    table([t('crowdColWhat'), t('crowdColYou'), t('crowdColCrowd')], rows),
    el('p', { class: 'crowd-like' }, [
      el('span', { class: 'crowd-like-icon', 'aria-hidden': 'true', text: HABIT_ICON[habit.key] }),
      el('span', { text: t('crowdLike', { habit: t(`habit_${habit.key}`), ahead: summary ? fmtPctShort(summary.aheadShare) : '–', back: summary ? fmtBack(summary.back) : '–', period: periodName(weeks) }) })
    ]),
    el('ul', { class: 'facts' }, [
      el('li', { text: t('crowdAhead', { share: fmtPctShort(crowd.totals.aheadShare), period: periodName(weeks) }) }),
      el('li', { text: t('crowdNote', { weeks: fmtCount(Math.max(1, Math.round(profile.weeks))) }) })
    ])
  ]);
}

function renderStats() {
  // Drawn only when on screen: it can start the crowd simulation.
  if (!state.accountReady || state.tab !== 'history' || state.historyView !== 'stats') return;
  const t = state.t;
  const s = historyStats(state.account);
  $('stats').hidden = s.placed === 0;
  if (!s.placed) return;
  const kpis = el('div', { class: 'kpis' }, [
    statTile(t('kpiSettled'), `${fmtInt(s.settled)} / ${fmtInt(s.placed)}`),
    statTile(t('kpiStaked'), fmtMoney(s.staked, { sign: false })),
    statTile(t('kpiPaid'), fmtMoney(s.paid, { sign: false })),
    statTile(t('kpiNet'), fmtMoney(s.net), s.net < -0.5 ? 'back-low' : s.net > 0.5 ? 'back-high' : ''),
    statTile(t('kpiBack'), s.settled ? `${fmtBack(s.back)} / ${fmtBack(s.expectedBack)}` : '–'),
    statTile(t('kpiHit'), s.settled ? `${fmtRate(s.paidSlips / s.settled)} / ${fmtRate(s.expectedPaidSlips / s.settled)}` : '–'),
    statTile(t('kpiOpen'), `${fmtInt(s.open)} · ${fmtMoney(s.openStake, { sign: false })}`)
  ]);
  const cards = [el('div', { class: 'card' }, [kpis, el('p', { class: 'note', text: t('kpiNote') })])];
  if (s.timeline.length > 1) cards.push(balanceChart(s.timeline));
  cards.push(crowdCard(s), funCard());
  if (s.settled) cards.push(el('div', { class: 'two-col' }, [luckCard(s), recordsCard(s)]), picksCard(s), breakdownCard(s), weeksCard(s));
  else cards.push(el('p', { class: 'muted', text: t('statsWait') }));
  $('stats-body').replaceChildren(...cards.filter(Boolean));
}

// ---- Simulator ----------------------------------------------------------------

// Bets per sport that stand in for that sport's games in any week of the
// year: the real ones on the board (win lines and each game's main total),
// or a typical week when a sport has none (always for the NBA). Every sport
// is simulated, whatever the sport filter shows.
function simSportBets() {
  const real = sport =>
    state.bets
      .filter(b => b.sport === sport && (b.kind === 'ml' || b.kind === 'f1' || (b.kind === 'total' && b.mainLine)))
      // `key`: the market (a game's win market, its total, the race) whose one
      // shared result decides every bet on it.
      .map(b => ({ gameId: b.gameId, key: `${sport}|${b.gameId}|${b.kind === 'total' ? 'total' : 'win'}`, fairChance: b.fairChance, odds: effectiveOdds(b) }));
  return Object.fromEntries(
    SPORTS.map(sport => {
      const bets = sport === 'nba' ? [] : real(sport);
      const games = new Set(bets.map(b => b.gameId)).size;
      return [sport, games >= (sport === 'f1' ? 1 : 2) ? bets : sportTemplate(sport)];
    })
  );
}

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

// Taiwan's 2026 minimum hourly wage.
const MIN_WAGE_HOURLY = 196;
// Each character is the real simulated player at that point of the ranking.
const CHARACTERS = [
  { key: 'best', name: 'simLucky', rank: 'simLuckyRank', color: 'var(--good)', icon: '🍀' },
  { key: 'median', name: 'simTypical', rank: 'simTypicalRank', color: 'var(--series-1)', icon: '🙂' },
  { key: 'worst', name: 'simUnlucky', rank: 'simUnluckyRank', color: 'var(--bad-strong)', icon: '🌧️' }
];

function fmtShare(p) {
  if (p === 0) return '0%';
  if (p < 0.01) return '<1%';
  return `${Math.round(p * 100)}%`;
}

function fmtCount(n) {
  return fmtInt(Math.round(n));
}

// ---- Crowd simulation: worker, cache and loading screen ----------------------

// Results per pool and period. The 100,000-player run is the slow part, so it
// runs once per period in a background worker, and only when it's shown.
const crowdCache = new Map();
let crowdJob = null;
let worker = null;

function crowdKey(sportBets, weeks) {
  return JSON.stringify([weeks, sportBets]);
}

// Loading screen progress. At start-up it spans both stages, odds (first 35%)
// then the simulation; later only the simulation. The time left is estimated
// from the pace so far.
const BOOT_ODDS_SHARE = 0.35;
const loadingClock = { start: 0, key: '' };

function showLoading(text, progress = 0, stage = 'boot') {
  const box = $('loading');
  if (box.hidden || loadingClock.key !== stage) Object.assign(loadingClock, { start: performance.now(), key: stage });
  box.hidden = false;
  $('loading-error').hidden = true;
  $('loading-spinner').hidden = false;
  $('loading-text').textContent = text;
  $('loading-fill').style.width = `${Math.round(progress * 100)}%`;
  const elapsed = (performance.now() - loadingClock.start) / 1000;
  const left = progress > 0.08 && progress < 1 ? Math.ceil((elapsed / progress) * (1 - progress)) : null;
  $('loading-eta').textContent = left == null ? '' : state.t('loadingEta', { pct: Math.round(progress * 100), s: left });
}

function hideLoading() {
  $('loading').hidden = true;
}

// Runs (or reuses) the simulation for this pool and period. A new request
// cancels a running one, so no power goes to a result nobody will see.
// `quiet`: run without the loading screen (the history tab's comparison).
function crowdStats(sportBets, weeks, { quiet = false } = {}) {
  const key = crowdKey(sportBets, weeks);
  const startWeek = weekOfYear(new Date());
  if (crowdCache.has(key)) return Promise.resolve(crowdCache.get(key));
  if (crowdJob?.key === key) return crowdJob.promise;
  if (crowdJob) {
    worker?.terminate();
    worker = null;
    crowdJob.reject(new Error('cancelled'));
  }
  const label = () => state.t('loadingSim', { n: fmtCount(SIM_PLAYERS_SHOWN), period: periodName(weeks) });
  // At start-up the simulation is the second stage of one bar.
  const report = quiet ? () => {} : p => (state.booting ? showLoading(label(), BOOT_ODDS_SHARE + (1 - BOOT_ODDS_SHARE) * p) : showLoading(label(), p, 'sim'));
  report(0);
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  crowdJob = { key, promise, reject };
  // Every period the run answered (a 1-year run also gives 1, 3 and 6 months).
  const done = results => {
    for (const [w, stats] of Object.entries(results)) crowdCache.set(crowdKey(sportBets, Number(w)), stats);
    crowdJob = null;
    if (!quiet) hideLoading();
    resolve(results[weeks]);
  };
  try {
    worker ??= new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.id !== key) return;
      if (data.results) done(data.results);
      else report(data.progress);
    };
    worker.onerror = () => {
      worker = null;
      runHere();
    };
    worker.postMessage({ id: key, sportBets, startWeek, weeks, perGroup: PER_GROUP, seed: SIM_SEED });
  } catch {
    runHere();
  }
  // No worker (very old browser): run here after the loading screen paints.
  function runHere() {
    const sportPools = Object.fromEntries(Object.entries(sportBets).map(([sport, bets]) => [sport, habitPools(bets)]));
    const checkpoints = [...MONTH_WEEKS.filter(w => w <= weeks), weeks];
    setTimeout(() => done(simulateCrowd({ sportPools, startWeek, weeks, checkpoints, perGroup: PER_GROUP, seed: SIM_SEED }).results), 30);
  }
  return promise;
}

function renderSim() {
  const t = state.t;
  const chart = $('sim-chart');
  const sportBets = simSportBets();
  const weeks = Number($('sim-weeks').value);
  const key = crowdKey(sportBets, weeks);
  const cached = crowdCache.get(key);
  // Run and drawn only when the tab shows (opening it does both): the
  // simulation takes seconds and the page is big, so nothing happens hidden.
  if (state.tab !== 'sim') return Promise.resolve();
  // Already showing exactly this (same run, width and language): nothing to do.
  const drawn = `${key}|${window.innerWidth}|${state.locale}`;
  if (cached) {
    if (state.simDrawn !== drawn) drawSim(cached, weeks);
    state.simDrawn = drawn;
    return Promise.resolve();
  }
  return crowdStats(sportBets, weeks).then(
    stats => {
      if (Number($('sim-weeks').value) === weeks && state.tab === 'sim') {
        drawSim(stats, weeks);
        state.simDrawn = drawn;
      }
    },
    () => {}
  );
}

function drawSim(stats, weeks) {
  const t = state.t;
  const period = periodName(weeks);
  const { bands, summaries, totals } = stats;
  const characters = CHARACTERS.map(c => ({ ...c, player: stats.characters[c.key] }));

  renderSimHeadline(totals, period);
  const back = totals.staked > 0 ? ((totals.staked + totals.net) / totals.staked) * 100 : 100;
  $('sim-stats').replaceChildren(
    statTile(t('simMedian'), fmtMoney(bands.at(-1).q50), bands.at(-1).q50 < 0 ? 'back-low' : '', null, false, '🧍'),
    statTile(t('simBackPer100'), fmtMoney(back, { sign: false }), back < 100 ? 'back-low' : '', null, false, '💸'),
    statTile(t('simEverAhead'), fmtShare(totals.everAheadShare), '', null, false, '📈'),
    statTile(t('simAhead'), fmtShare(totals.aheadShare), totals.aheadShare < 0.5 ? 'back-low' : '', null, false, '🏁')
  );
  $('sim-legend').replaceChildren(
    el('span', {}, [el('span', { class: 'legend-key band-outer' }), document.createTextNode(t('simBand80'))]),
    el('span', {}, [el('span', { class: 'legend-key band-inner' }), document.createTextNode(t('simBand50'))]),
    el('span', {}, [el('span', { class: 'legend-key thick', style: 'background:var(--text-secondary)' }), document.createTextNode(t('simMedianLine'))]),
    ...characters.map(c => el('span', {}, [el('span', { class: 'legend-key thick', style: `background:${c.color}` }), document.createTextNode(t(c.name))]))
  );
  drawSimChart($('sim-chart'), bands, characters, weeks);
  renderLapse(bands, weeks);
  renderBuys(totals, period);
  renderPlayers(characters);
  renderHabits(summaries);
  renderFans(stats.fanSummaries);
  renderFacts(stats, totals, characters, summaries, period);
  renderStories(stats, period);
  state.simStats = stats;
  renderYou();
  if (state.lookup) renderLookup(state.lookup);
  renderSimTable(bands, characters, weeks);
}

function renderSimHeadline(totals, period) {
  const t = state.t;
  const share = totals.aheadShare;
  const { staked, net } = totals;
  const tickets = totals.tickets / SIM_PLAYERS;
  const inTen = Math.round(share * 10);
  const back = staked > 0 ? ((staked + net) / staked) * 100 : 100;
  const shareMargin = 1.96 * Math.sqrt((share * (1 - share)) / SIM_PLAYERS);
  // Ten little people, the ones still ahead in green.
  const person = won => {
    const svg = svgEl('svg', { class: `person ${won ? 'won' : ''}`, viewBox: '0 0 24 30', 'aria-hidden': 'true' });
    svg.append(svgEl('circle', { cx: 12, cy: 7, r: 5.5 }), svgEl('path', { d: 'M2 30v-6a10 10 0 0 1 20 0v6z' }));
    return svg;
  };
  $('sim-headline').replaceChildren(
    el('p', { class: 'headline-label', text: t('simHeadlineLabel', { period, n: fmtCount(SIM_PLAYERS_SHOWN) }) }),
    el('p', { class: 'headline-big' }, [
      document.createTextNode(t('simHeadlinePre')),
      el('strong', { text: inTen === 0 ? t('simHeadlineNone') : t('simHeadlineShare', { n: inTen }) }),
      document.createTextNode(t('simHeadlinePost'))
    ]),
    el('div', { class: 'people', role: 'img', 'aria-label': t('simHeadlineShare', { n: inTen }) }, Array.from({ length: 10 }, (_, i) => person(i < inTen))),
    el('p', {
      class: 'headline-sub',
      text: t('simHeadlineSub', { tickets: fmtCount(tickets), staked: fmtMoney(staked / SIM_PLAYERS, { sign: false }), back: fmtMoney(back, { sign: false }) })
    }),
    el('p', { class: 'margin-note detail-only', text: t('simMarginNote', { share: fmtShare(share), n: fmtCount(SIM_PLAYERS_SHOWN), margin: (shareMargin * 100).toFixed(1) }) })
  );
}

function renderPlayers(characters) {
  const t = state.t;
  $('sim-players').replaceChildren(
    ...characters.map(({ name, rank, color, icon, player: p }) => {
      let tale;
      if (p.final > 0) tale = t('taleAhead', { habit: t(`habit_${p.habit.key}`) });
      else if (!p.everAhead) tale = t('taleNever');
      else tale = t('taleGaveBack', { peak: fmtMoney(p.peak, { sign: false }), at: fmtCount(p.peakWeek + 1) });
      const line = (label, value) => el('div', { class: 'player-line' }, [el('span', { text: label }), el('strong', { text: value })]);
      return el('article', { class: 'player', style: `--player:${color}` }, [
        el('div', { class: 'player-head' }, [
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: icon }),
          el('div', {}, [el('p', { class: 'player-name', text: t(name) }), el('p', { class: 'player-rank', text: t(rank) })])
        ]),
        el('p', { class: `player-final ${p.final < 0 ? 'back-low' : 'back-high'}`, text: fmtMoney(p.final) }),
        el('p', { class: 'player-tale', text: tale }),
        el('div', { class: 'player-lines detail-only' }, [
          line(t('playerTickets'), `${fmtCount(p.wonTickets)} / ${fmtCount(p.tickets)}`),
          line(t('playerStaked'), fmtMoney(p.staked, { sign: false })),
          line(t('playerBiggestWin'), p.biggestWin > 0 ? fmtMoney(p.biggestWin) : t('playerNoWin')),
          line(t('playerPeak'), p.everAhead ? `${fmtMoney(p.peak)} · ${t('simWeekN', { n: fmtCount(p.peakWeek + 1) })}` : t('playerNeverAhead')),
          line(t('playerStreak'), t('inARow', { n: p.longestLosing })),
          line(t('playerDrop'), fmtMoney(-p.maxDrop))
        ]),
        el('div', { class: 'player-tags' }, [
          p.fan ? el('span', { class: 'habit-tag', text: t(`fan_${p.fan.key}`) }) : null,
          el('span', { class: 'habit-tag', text: t(`habit_${p.habit.key}`) }),
          el('span', { class: 'habit-tag detail-only', text: `${t('playerMaxStake')} ${fmtMoney(p.maxStake, { sign: false })}` }),
          p.restWeeks > 0 ? el('span', { class: 'habit-tag detail-only', text: t('playerRest', { n: fmtCount(p.restWeeks) }) }) : null
        ])
      ]);
    })
  );
}

// One row per group: avatar, name, bar to break-even, average back per NT$100.
function barItem({ icon, name, desc, back, margin, meta, scaleMax }) {
  return el('li', { class: 'bar-item', title: desc }, [
    icon,
    el('span', { class: 'bar-name', text: name }),
    el('span', { class: `rank-value ${backClass(back)}` }, [document.createTextNode(fmtMoney(back, { sign: false })), marginEl(`±${margin.toFixed(1)}`)]),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
      el('div', { class: 'bar', style: `width:${(back / scaleMax) * 100}%` }),
      el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
    ]),
    el('span', { class: 'habit-meta detail-only', text: meta })
  ]);
}

function renderHabits(summaries) {
  const t = state.t;
  const sorted = [...summaries].sort((a, b) => b.back - a.back);
  const scaleMax = Math.max(100, sorted[0].back) * 1.04;
  $('sim-habits').replaceChildren(
    ...sorted.map(h =>
      barItem({
        icon: badge(HABIT_ICON[h.habit.key], HABIT_COLOR[h.habit.key], 'emoji'),
        name: t(`habit_${h.habit.key}`),
        desc: t(`habitDesc_${h.habit.key}`),
        back: h.back,
        margin: h.backMargin,
        scaleMax,
        meta: t('habitMeta', { ahead: fmtShare(h.aheadShare), staked: fmtMoney(h.avgStaked, { sign: false }), final: fmtMoney(h.avgFinal) })
      })
    )
  );
}

// The same crowd by what they bet on: one sport all year, or everything.
function renderFans(fans) {
  const t = state.t;
  const sorted = [...fans].sort((a, b) => b.back - a.back);
  const scaleMax = Math.max(100, sorted[0].back) * 1.04;
  $('sim-fans').replaceChildren(
    ...sorted.map(f =>
      barItem({
        icon: f.fan.key === 'all' ? badge('🌐', 'var(--accent)', 'emoji') : leagueImg(f.fan.key, 'logo-sm'),
        name: t(`fan_${f.fan.key}`),
        desc: t(`fanDesc_${f.fan.key}`),
        back: f.back,
        margin: f.backMargin,
        scaleMax,
        meta: t('fanMeta', { ahead: fmtShare(f.aheadShare), tickets: fmtCount(f.avgTickets), final: fmtMoney(f.avgFinal) })
      })
    )
  );
}

// A fact: one plain sentence with its numbers highlighted inside it
// ({name} placeholders filled from `nums`), then the explanation.
function factItem(sentence, nums = {}, why = null) {
  const line = el('p', { class: 'fact-line' });
  for (const [i, part] of sentence.split(/\{(\w+)\}/).entries()) {
    if (i % 2 === 0) line.append(part);
    else line.append(el('strong', { class: 'fact-num', text: nums[part] ?? `{${part}}` }));
  }
  return el('li', { class: 'fact' }, [line, why ? el('p', { class: 'fact-why', text: why }) : null]);
}

function renderFacts(stats, totals, characters, summaries, period) {
  const t = state.t;
  const money = v => fmtMoney(v, { sign: false });
  const facts = [];
  const by = key => summaries.find(h => h.habit.key === key);
  facts.push(factItem(t('factParlay'), { a: money(by('casual').back), b: money(by('dreamer').back) }, t('factParlayWhy')));
  if (totals.everAheadShare > totals.aheadShare) facts.push(factItem(t('factEverAhead'), { a: fmtShare(totals.everAheadShare), b: fmtShare(totals.aheadShare) }, t('factEverAheadWhy')));
  const chaser = by('chaser');
  if (chaser.capShare > 0) {
    facts.push(factItem(t('factChaser'), { v: fmtShare(chaser.capShare), cap: money(chaser.habit.chaseCap) }, t('factChaserWhy', { staked: money(chaser.avgStaked), final: fmtMoney(chaser.avgFinal) })));
  }
  const lucky = characters[0].player;
  if (lucky.biggestWin > 0) facts.push(factItem(t('factLucky'), { v: fmtCount(lucky.longestLosing) }, t('factLuckyWhy', { win: money(lucky.biggestWin) })));
  const avgLoss = -totals.net / SIM_PLAYERS;
  if (avgLoss > 0) {
    const hours = (avgLoss / MIN_WAGE_HOURLY).toLocaleString(numberLocale(), { maximumFractionDigits: avgLoss < 10 * MIN_WAGE_HOURLY ? 1 : 0 });
    facts.push(factItem(t('factWage', { period }), { loss: money(avgLoss), v: hours }, t('factWageWhy', { wage: MIN_WAGE_HOURLY })));
  }
  if (avgLoss > 0) facts.push(factItem(t('factBoba', { period }), { loss: money(avgLoss), v: fmtCount(avgLoss / BOBA_PRICE) }, t('factBobaWhy', { price: BOBA_PRICE })));
  const hitRate = totals.tickets > 0 ? stats.crowd.wonTickets / totals.tickets : 0;
  facts.push(factItem(t('factHitRate'), { v: fmtShare(hitRate) }, t('factHitRateWhy', { tickets: fmtCount(totals.tickets), won: fmtCount(stats.crowd.wonTickets) })));
  if (stats.crowd.taxTotal > 0) facts.push(factItem(t('factTax'), { v: money(stats.crowd.taxTotal) }, t('factTaxWhy', { share: fmtChance(stats.crowd.taxedShare) })));
  if (totals.net < 0) facts.push(factItem(t('factPerDay'), { v: money(-totals.net / (stats.weeks * 7)) }, t('factPerDayWhy', { total: fmtCount(SIM_PLAYERS_SHOWN) })));
  if (totals.net < 0) {
    facts.push(factItem(t('factHouse'), { v: money((-totals.net / totals.staked) * 100) }, t('factHouseWhy', { total: fmtCount(SIM_PLAYERS_SHOWN), staked: money(totals.staked), net: money(-totals.net) })));
  } else facts.push(factItem(t('factHouseWon')));
  $('sim-facts').replaceChildren(...facts);
}

// ---- People like you, and any player by number ------------------------------

const BOBA_PRICE = 65;

// ---- Simulator extras: a time-lapse, what the losses buy --------------------

// Week by week: 100 dots of 1,000 people each, coloured by how each one
// stands (big win to heavy loss), with the date, the lottery's running take,
// what happened that week (seasons starting and ending, milestones) and a
// small chart of the share ahead with a playhead. Plays itself the first
// time it scrolls into view.
const LAPSE_LEVELS = [
  { key: 'gold', min: 5000 },
  { key: 'win', min: 0 },
  { key: 'lose1', min: -1000 },
  { key: 'lose2', min: -5000 },
  { key: 'lose3', min: -Infinity }
];

// A dot's result from the week's percentiles (dot 0 is the best 1%).
function lapseValue(b, rank) {
  const q = 1 - (rank + 0.5) / 100;
  const points = [[0.01, b.q01 ?? b.q10], [0.05, b.q05 ?? b.q10], [0.1, b.q10], [0.25, b.q25], [0.5, b.q50], [0.75, b.q75], [0.9, b.q90], [0.95, b.q95 ?? b.q90], [0.99, b.q99 ?? b.q90]];
  if (q <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [q1, v1] = points[i];
    if (q <= q1) {
      const [q0, v0] = points[i - 1];
      return v0 + ((v1 - v0) * (q - q0)) / (q1 - q0);
    }
  }
  return points.at(-1)[1];
}

// What happens along the way: seasons starting, turning to playoffs and ending
// (from each league's calendar), and the crowd's milestones.
function lapseEvents(bands, weeks, startWeek) {
  const t = state.t;
  const events = [];
  const games = (sport, w) => gamesInWeek(sport, startWeek + w - 1);
  const quiet = (sport, from, to) => {
    for (let w = from; w <= to; w++) if (games(sport, w) > 0) return false;
    return true;
  };
  for (let w = 1; w <= weeks; w++) {
    for (const sport of ['mlb', 'epl', 'nba', 'f1']) {
      const now = games(sport, w);
      const before = games(sport, w - 1);
      const name = t(`sport_${sport}`);
      // F1 has a championship (賽季), not a league season (球季).
      const f1 = sport === 'f1' ? 'F1' : '';
      if (now > 0 && quiet(sport, w - 5, w - 1)) events.push({ w, sport, text: t(`lapseSeasonStart${f1}`, { sport: name }) });
      else if (before > 0 && now > 0 && before >= 3 * now) events.push({ w, sport, text: t('lapsePlayoffs', { sport: name }) });
      if (now > 0 && w < weeks && quiet(sport, w + 1, w + 5)) events.push({ w, sport, text: t(`lapseSeasonEnd${f1}`, { sport: name }) });
    }
  }
  const money = v => fmtMoney(v, { sign: false });
  const first = (test, make) => {
    const i = bands.findIndex(test);
    if (i >= 0) events.push({ w: i + 1, ...make(bands[i], i) });
  };
  let peak = 0;
  bands.forEach((b, i) => b.ahead > bands[peak].ahead && (peak = i));
  events.push({ w: peak + 1, icon: '⛰️', text: t('lapsePeakEv', { v: fmtShare(bands[peak].ahead / SIM_PLAYERS) }) });
  for (const share of [0.2, 0.1, 0.05]) first((b, i) => i > peak && b.ahead / SIM_PLAYERS < share, () => ({ icon: '📉', text: t('lapseBelow', { v: fmtShare(share) }) }));
  for (const loss of [1000, 5000, 10_000]) first(b => b.q50 <= -loss, () => ({ icon: '🧍', text: t('lapseMedian', { v: money(loss) }) }));
  for (const take of [1e8, 1e9]) first(b => (b.mean ?? 0) * -SIM_PLAYERS_SHOWN >= take, () => ({ icon: '🏦', text: t('lapseHouse', { v: money(take) }) }));
  for (let y = 1; y * 52 <= weeks; y++) events.push({ w: y * 52, icon: '🎂', text: t('lapseYear', { n: y }) });
  return events.sort((a, b) => a.w - b.w);
}

function renderLapse(bands, weeks) {
  const t = state.t;
  const box = $('sim-lapse');
  if (!box) return;
  clearTimeout(box._timer);
  box._observer?.disconnect();
  const startWeek = weekOfYear(new Date());
  const events = lapseEvents(bands, weeks, startWeek);
  const random = seededRandom(3);
  const order = Array.from({ length: 100 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // Where each dot sits in the crowd: its rank, 0 = the best 1,000 people.
  const rank = new Array(100);
  order.forEach((dot, r) => (rank[dot] = r));
  const dots = Array.from({ length: 100 }, () => el('span', { class: 'lapse-dot' }));
  const date = el('p', { class: 'lapse-date' });
  const ahead = el('strong');
  const median = el('strong');
  const house = el('strong', { class: 'back-low' });
  const feed = el('ol', { class: 'lapse-feed', 'aria-live': 'polite' });
  const slider = el('input', { type: 'range', min: '1', max: String(weeks), value: '1', 'aria-label': t('lapseTitle') });
  const play = el('button', { class: 'primary-button lapse-play', type: 'button' });

  // The share ahead over the whole period, with event ticks and a playhead.
  const W = 300;
  const H = 56;
  const top = Math.max(...bands.map(b => b.ahead)) || 1;
  const x = w => ((w - 1) / Math.max(1, weeks - 1)) * W;
  const y = a => H - 4 - (a / top) * (H - 12);
  let line = '';
  bands.forEach((b, i) => (line += `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(b.ahead).toFixed(1)}`));
  const chart = svgEl('svg', { class: 'lapse-chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': t('lapseAhead') });
  chart.append(svgEl('path', { class: 'lapse-area', d: `${line}L${W},${H}L0,${H}Z` }), svgEl('path', { class: 'lapse-line', d: line }));
  for (const e of events) chart.append(svgEl('line', { class: 'lapse-tick', x1: x(e.w), x2: x(e.w), y1: 0, y2: 5 }));
  const head = svgEl('line', { class: 'lapse-head', y1: 0, y2: H });
  chart.append(head);
  chart.addEventListener('click', event => {
    const r = chart.getBoundingClientRect();
    stop();
    set(Math.max(1, Math.min(weeks, Math.round(1 + ((event.clientX - r.left) / r.width) * (weeks - 1)))));
  });

  const eventIcon = e => (e.sport ? leagueImg(e.sport, 'logo-xs') : el('span', { class: 'lapse-ev-icon', 'aria-hidden': 'true', text: e.icon }));
  let shownEvents = -1;
  const set = w => {
    const b = bands[w - 1];
    const lit = Math.round((b.ahead / SIM_PLAYERS) * 100);
    dots.forEach((dot, i) => {
      const r = rank[i];
      let v = lapseValue(b, r);
      // The exact share ahead decides green or not; the percentiles, how much.
      if (r < lit) v = Math.max(v, 1);
      else v = Math.min(v, 0);
      const level = LAPSE_LEVELS.find(l => v > l.min);
      dot.className = `lapse-dot ${level.key}`;
      dot.title = fmtMoney(v);
    });
    const day = new Date(Date.now() + w * 7 * 86_400_000);
    date.textContent = t('lapseDate', { date: day.toLocaleDateString(numberLocale(), { year: 'numeric', month: 'numeric', day: 'numeric' }), w });
    ahead.textContent = fmtShare(b.ahead / SIM_PLAYERS);
    median.textContent = fmtMoney(b.q50);
    median.className = b.q50 < 0 ? 'back-low' : 'back-high';
    // Short, like 1.7億 or 168M: it grows to hundreds of millions.
    house.textContent = `NT$${Math.max(0, -(b.mean ?? 0) * SIM_PLAYERS_SHOWN).toLocaleString(numberLocale(), { notation: 'compact', maximumFractionDigits: 1 })}`;
    head.setAttribute('x1', x(w));
    head.setAttribute('x2', x(w));
    slider.value = String(w);
    // The latest three things that have happened, newest first.
    const past = events.filter(e => e.w <= w);
    let fresh = false;
    if (past.length !== shownEvents) {
      fresh = past.length > shownEvents && shownEvents >= 0;
      shownEvents = past.length;
      const recent = past.slice(-3).reverse();
      feed.replaceChildren(
        ...(recent.length ? recent : [{ w: 0, icon: '🎫', text: t('lapseKickoff') }]).map((e, i) =>
          el('li', { class: `${i === 0 && fresh ? 'new' : ''} ${i ? 'old' : ''}` }, [eventIcon(e), el('span', { text: e.text }), el('small', { text: e.w ? t('lapseWeek', { w: e.w }) : '' })])
        )
      );
    }
    return fresh ? past.at(-1) : null;
  };
  const stop = () => {
    clearTimeout(box._timer);
    box._timer = null;
    play.textContent = `▶ ${t('lapsePlay')}`;
  };
  const start = () => {
    let w = Number(slider.value) >= weeks ? 1 : Number(slider.value);
    set(w);
    play.textContent = `⏸ ${t('lapsePause')}`;
    // About 20 seconds for a year (short periods no faster than 0.6 s a
    // week), holding 2.5 s on each new event so it can be read. Past a year
    // the seasons repeat, so only the crowd's milestones hold, and for 1.2 s.
    const step = Math.max(80, Math.min(600, Math.round(20_000 / weeks)));
    const long = weeks > 52;
    const hold = e => (!e ? step : !long ? 2500 : e.sport ? step : 1200);
    const tick = () => {
      if (!box.contains(play)) return;
      const fresh = set(++w);
      if (w >= weeks) stop();
      else box._timer = setTimeout(tick, hold(fresh));
    };
    box._timer = setTimeout(tick, step);
  };
  play.addEventListener('click', () => (box._timer ? stop() : start()));
  slider.addEventListener('input', () => (stop(), set(Number(slider.value))));

  box.replaceChildren(
    el('div', { class: 'lapse' }, [
      el('div', {}, [
        el('div', { class: 'lapse-grid', role: 'img', 'aria-label': t('lapseLegend') }, dots),
        el('div', { class: 'lapse-legend' }, LAPSE_LEVELS.map(l => el('span', {}, [el('i', { class: `lapse-dot ${l.key}` }), document.createTextNode(t(`lapse_${l.key}`))])))
      ]),
      el('div', { class: 'lapse-side' }, [
        date,
        el('div', { class: 'lapse-stats' }, [
          el('p', {}, [el('span', { text: t('lapseAhead') }), ahead]),
          el('p', {}, [el('span', { text: t('youMedian') }), median]),
          el('p', {}, [el('span', { text: t('lapseHouseNow') }), house])
        ]),
        feed,
        chart,
        el('div', { class: 'lapse-controls' }, [play, slider]),
        el('p', { class: 'note', text: t('lapseLegend') })
      ])
    ])
  );
  stop();
  set(1);
  // Play once when it first comes into view.
  if ('IntersectionObserver' in window) {
    box._observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        box._observer.disconnect();
        if (!box._timer) start();
      }
    }, { threshold: 0.5 });
    box._observer.observe(box);
  } else set(weeks);
}

// What the crowd's total loss would have bought instead.
const BUYS = [
  { key: 'boba', price: BOBA_PRICE, icon: '🧋' },
  { key: 'noodles', price: 200, icon: '🍜' },
  { key: 'iphone', price: 30_000, icon: '📱' },
  { key: 'scooter', price: 80_000, icon: '🛵' }
];
function renderBuys(totals, period) {
  const t = state.t;
  const loss = -totals.net * (SIM_PLAYERS_SHOWN / SIM_PLAYERS);
  const box = $('sim-buys');
  if (loss <= 0) return box.replaceChildren();
  box.replaceChildren(
    el('p', { class: 'fact-line', text: t('buysTitle', { period, n: fmtCount(SIM_PLAYERS_SHOWN), v: fmtMoney(loss, { sign: false }) }) }),
    el('div', { class: 'buys-grid' },
      BUYS.map(b =>
        el('div', { class: 'buy' }, [
          el('span', { class: 'buy-icon', 'aria-hidden': 'true', text: b.icon }),
          el('strong', { text: fmtCount(loss / b.price) }),
          el('small', { text: t(`buy_${b.key}`, { price: fmtCount(b.price) }) })
        ])
      )
    )
  );
}

// How the group of people with one habit and one kind of fan did.
function renderYou() {
  const t = state.t;
  const stats = state.simStats;
  if (!stats?.groupStats) return;
  const habitSelect = $('you-habit');
  const fanSelect = $('you-fan');
  if (!habitSelect.options.length || habitSelect.dataset.locale !== state.locale) {
    habitSelect.replaceChildren(...HABITS.map(h => el('option', { value: h.key, text: t(`habit_${h.key}`) })));
    fanSelect.replaceChildren(...FANS.map(f => el('option', { value: f.key, text: t(`fan_${f.key}`) })));
    habitSelect.value = state.youHabit ?? 'casual';
    fanSelect.value = state.youFan ?? 'all';
    habitSelect.dataset.locale = state.locale;
  }
  const g = stats.groupStats.find(x => x.habit === habitSelect.value && x.fan === fanSelect.value);
  if (!g) return;
  const money = v => fmtMoney(v, { sign: false });
  const period = periodName(stats.weeks);
  $('you-result').replaceChildren(
    el('p', { class: 'you-headline' }, [
      document.createTextNode(t('youAheadPre', { n: fmtCount(g.players), period })),
      el('strong', { class: g.aheadShare >= 0.5 ? 'back-high' : 'back-low', text: fmtShare(g.aheadShare) }),
      document.createTextNode(t('youAheadPost'))
    ]),
    el('div', { class: 'kpis' }, [
      statTile(t('youMedian'), fmtMoney(g.median), g.median < 0 ? 'back-low' : 'back-high', null, false, '🧍'),
      statTile(t('simBackPer100'), money(g.back), g.back < 100 ? 'back-low' : '', null, false, '💸'),
      statTile(t('youTickets'), fmtCount(g.avgTickets), '', null, false, '🎫'),
      statTile(t('youStaked'), money(g.avgStaked), '', null, false, '💰')
    ]),
    el('div', { class: 'you-range' }, [
      el('span', { class: 'you-end back-low', text: fmtMoney(g.worst) }),
      el('span', { class: 'you-bar' }, [el('span', { class: 'you-mid', style: `left:${rangePos(g.median, g.worst, g.best)}%` }), el('span', { class: 'you-zero', style: `left:${rangePos(0, g.worst, g.best)}%` })]),
      el('span', { class: 'you-end back-high', text: fmtMoney(g.best) })
    ]),
    el('p', { class: 'fact-why', text: t('youRange', { lo: fmtMoney(g.q10), hi: fmtMoney(g.q90) }) }),
    g.median < 0 ? el('p', { class: 'fact-why', text: t('youBoba', { cups: fmtCount(-g.median / BOBA_PRICE) }) }) : null
  );
}

function rangePos(v, lo, hi) {
  return hi > lo ? Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)) : 50;
}

$('you-habit').addEventListener('change', event => ((state.youHabit = event.target.value), renderYou()));
$('you-fan').addEventListener('change', event => ((state.youFan = event.target.value), renderYou()));

// Replays one player of the crowd, by number, on this device (one player is
// quick): their season, a small chart of it and their story.
function renderLookup(serial) {
  const t = state.t;
  const stats = state.simStats;
  if (!stats) return;
  const total = stats.players;
  const n = Math.max(1, Math.min(total, Math.round(serial)));
  state.lookup = n;
  $('lookup-number').value = String(n);
  $('lookup-number').max = String(total);
  const sportBets = simSportBets();
  const sportPools = Object.fromEntries(Object.entries(sportBets).map(([sport, bets]) => [sport, habitPools(bets)]));
  const p = replayPlayer({ sportPools, startWeek: weekOfYear(new Date()), weeks: stats.weeks, perGroup: PER_GROUP, seed: SIM_SEED, index: n - 1 });
  if (!p) return;
  let tale;
  if (p.final > 0) tale = t('taleAhead', { habit: t(`habit_${p.habit.key}`) });
  else if (!p.everAhead) tale = t('taleNever');
  else tale = t('taleGaveBack', { peak: fmtMoney(p.peak, { sign: false }), at: fmtCount(p.peakWeek + 1) });
  const line = (label, value, cls = '', note = null) =>
    el('div', { class: 'player-line' }, [el('span', { text: label }), el('strong', { class: cls, text: value }), note ? el('small', { text: note }) : null]);
  // Their highest and lowest running total, and the week of each.
  let hi = 0;
  let lo = 0;
  p.path.forEach((v, i) => (v > p.path[hi] && (hi = i), v < p.path[lo] && (lo = i)));
  // The amount, with its week on a small line underneath.
  const point = (label, i, cls) => line(label, fmtMoney(p.path[i]), cls, t('simWeekN', { n: fmtCount(i + 1) }));
  // 百分位 (PR): the share of the crowd this player finished ahead of.
  const qs = stats.finalQuantiles;
  const pr = qs ? Math.max(1, Math.min(99, Math.floor((qs.filter(v => v < p.final).length / qs.length) * 100))) : null;
  $('lookup-result').replaceChildren(
    el('div', { class: 'lookup-card' }, [
      el('div', { class: 'story-head' }, [
        el('span', { class: 'story-icon', 'aria-hidden': 'true', text: p.final > 0 ? '😎' : p.everAhead ? '😬' : '😶' }),
        el('div', {}, [el('p', { class: 'story-serial' }, [document.createTextNode(`#${fmtCount(n)}`), pr ? el('span', { class: 'serial-pr', text: t('playerPR', { n: pr }) }) : null]), el('div', { class: 'player-tags' }, [p.fan ? el('span', { class: 'habit-tag', text: t(`fan_${p.fan.key}`) }) : null, el('span', { class: 'habit-tag', text: t(`habit_${p.habit.key}`) })])])
      ]),
      el('p', { class: `story-big ${p.final < 0 ? 'back-low' : 'back-high'}`, text: fmtMoney(p.final) }),
      sparkline(p.path),
      el('p', { class: 'story-text', text: tale }),
      el('div', { class: 'player-lines' }, [
        line(t('playerTickets'), `${fmtCount(p.wonTickets)} / ${fmtCount(p.tickets)}`),
        line(t('playerStaked'), fmtMoney(p.staked, { sign: false })),
        point(t('playerPeak'), hi, p.path[hi] > 0 ? 'back-high' : 'back-low'),
        point(t('playerLow'), lo, p.path[lo] < 0 ? 'back-low' : 'back-high'),
        line(t('playerBiggestWin'), p.biggestWin > 0 ? fmtMoney(p.biggestWin) : t('playerNoWin')),
        line(t('playerStreak'), t('inARow', { n: p.longestLosing }))
      ])
    ])
  );
}

// A small line chart of one player's running result, zero marked.
function sparkline(path) {
  const w = 300;
  const h = 64;
  let lo = 0;
  let hi = 0;
  for (const v of path) (lo = Math.min(lo, v), hi = Math.max(hi, v));
  const span = hi - lo || 1;
  const y = v => 4 + ((hi - v) / span) * (h - 8);
  let d = `M0,${y(0).toFixed(1)}`;
  path.forEach((v, i) => (d += `L${(((i + 1) / path.length) * w).toFixed(1)},${y(v).toFixed(1)}`));
  const svg = svgEl('svg', { class: 'sparkline', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  svg.append(svgEl('line', { class: 'zero-line', x1: 0, x2: w, y1: y(0), y2: y(0) }), svgEl('path', { class: path.at(-1) < 0 ? 'spark-bad' : 'spark-good', d }));
  return svg;
}

$('lookup-form').addEventListener('submit', event => {
  event.preventDefault();
  const n = Number($('lookup-number').value);
  if (n >= 1) renderLookup(n);
});
$('lookup-random').addEventListener('click', () => {
  const total = state.simStats?.players ?? SIM_PLAYERS;
  renderLookup(1 + Math.floor(Math.random() * total));
});

// Record holders among the 100,000, by their number in the crowd: the key
// figure, who they are, then their story. Then the crowd-wide truths.
function renderStories(stats, period) {
  const t = state.t;
  const { notable, crowd } = stats;
  const money = v => fmtMoney(v, { sign: false });
  const stories = [];
  // `tone`: how the big figure reads (good, bad or neutral); money by its sign.
  // A record held only within the player's habit says so in its title.
  const add = (icon, titleKey, p, big, textKey, vars, tone = null) =>
    p && stories.push({ icon, title: p.overall ? t(titleKey) : t('storyAmong', { title: t(titleKey), habit: t(`habit_${p.habit.key}`) }), serial: `#${fmtCount(p.serial)}`, index: p.serial - 1, big, tone: tone ?? (big.startsWith('−') ? 'back-low' : 'back-high'), tags: [p.fan && t(`fan_${p.fan.key}`), t(`habit_${p.habit.key}`)].filter(Boolean), text: t(textKey, { period, ...vars }) });
  const w = notable.biggestWin;
  if (w) add('🎯', 'storyBigWinTitle', w, fmtMoney(w.biggestWin), 'storyBigWin', { week: w.biggestWinWeek + 1, stake: money(w.biggestWinStake), legs: w.biggestWinLegs, odds: fmtOdds(w.biggestWinOdds), final: fmtMoney(w.final) });
  const best = notable.best;
  // The biggest ticket often makes the biggest winner too, who without it
  // would have been losing: say so when it's true.
  const bestIsBigWin = best?.serial === w?.serial && best.final - best.biggestWin < 0;
  if (best) add('🏆', 'storyBestTitle', best, fmtMoney(best.final), bestIsBigWin ? 'storyBestSame' : 'storyBest', { tickets: fmtCount(best.tickets), staked: money(best.staked) });
  const fall = notable.fall;
  if (fall) add('🎢', 'storyFallTitle', fall, `${fmtMoney(fall.peak)} → ${fmtMoney(fall.final)}`, 'storyFall', { week: fall.peakWeek + 1, peak: fmtMoney(fall.peak), final: fmtMoney(fall.final) }, 'back-low');
  const dry = notable.drought;
  if (dry) add('🧊', 'storyDroughtTitle', dry, t('inARow', { n: fmtCount(dry.longestLosing) }), dry.wonTickets ? 'storyDrought' : 'storyDroughtNone', { streak: fmtCount(dry.longestLosing), tickets: fmtCount(dry.tickets), won: fmtCount(dry.wonTickets) }, 'back-low');
  const worst = notable.worst;
  if (worst) add('💸', 'storyWorstTitle', worst, fmtMoney(worst.final), 'storyWorst', { staked: money(worst.staked), max: money(worst.maxStake), hours: fmtCount(-worst.final / MIN_WAGE_HOURLY) });
  const hot = notable.hotStreak;
  if (hot?.longestWinning > 1) add('🔥', 'storyHotTitle', hot, t('inARowWon', { n: fmtCount(hot.longestWinning) }), 'storyHot', { tickets: fmtCount(hot.tickets), won: fmtCount(hot.wonTickets), final: fmtMoney(hot.final) });
  const long = notable.longshot;
  if (long?.longshotOdds > 1) add('🦄', 'storyLongshotTitle', long, `@ ${fmtOdds(long.longshotOdds)}`, 'storyLongshot', { week: long.longshotWeek + 1, stake: money(long.longshotStake), win: fmtMoney(long.longshotWin) });
  const bad = notable.worstWeek;
  if (bad?.worstWeek < 0) add('🌪️', 'storyBadWeekTitle', bad, fmtMoney(bad.worstWeek), 'storyBadWeek', { week: bad.worstWeekAt + 1, final: fmtMoney(bad.final) });
  const busy = notable.mostTickets;
  if (busy) add('🧾', 'storyBusyTitle', busy, t('ticketsN', { n: fmtCount(busy.tickets) }), 'storyBusy', { perWeek: (busy.tickets / stats.weeks).toFixed(1), staked: money(busy.staked), final: fmtMoney(busy.final) }, 'neutral');
  const even = notable.closest;
  if (even) add('⚖️', 'storyEvenTitle', even, fmtMoney(even.final), 'storyEven', { tickets: fmtCount(even.tickets), staked: money(even.staked) }, 'neutral');
  const tax = notable.taxman;
  if (tax?.taxPaid > 0) add('🏛️', 'storyTaxTitle', tax, money(tax.taxPaid), 'storyTax', { final: fmtMoney(tax.final) }, 'back-low');
  $('sim-stories').replaceChildren(
    ...stories.map(s =>
      el('li', { class: 'story' }, [
        el('div', { class: 'story-head' }, [
          el('span', { class: 'story-icon', 'aria-hidden': 'true', text: s.icon }),
          el('div', {}, [
            el('p', { class: 'story-title', text: s.title }),
            // Tapping the number opens this player's season below.
            el('button', {
              class: 'story-serial link-button',
              type: 'button',
              title: t('lookupTitle'),
              text: s.serial,
              onclick: () => {
                renderLookup(s.index + 1);
                $('lookup-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            })
          ])
        ]),
        el('p', { class: `story-big ${s.tone}`, text: s.big }),
        el('div', { class: 'player-tags' }, s.tags.map(tag => el('span', { class: 'habit-tag', text: tag }))),
        el('p', { class: 'story-text', text: s.text })
      ])
    )
  );
  const truths = [];
  if (crowd.winnings > 0) {
    truths.push(factItem(t('truthRatio'), { v: `NT$${(crowd.losses / crowd.winnings).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })}` }, t('truthRatioWhy', { n: fmtCount(SIM_PLAYERS_SHOWN), win: money(crowd.winnings), loss: money(crowd.losses) })));
  }
  truths.push(crowd.top1 > 0 ? factItem(t('truthTop', { period }), { v: fmtMoney(crowd.top1) }, t('truthTopWhy', { top01: fmtMoney(crowd.top01) })) : factItem(t('truthTopLosing', { period }), { v: fmtMoney(crowd.top1) }));
  if (crowd.neverWonShare > 0) truths.push(factItem(t('truthNeverWon', { period }), { v: fmtChance(crowd.neverWonShare) }, t('truthNeverWonWhy', { n: fmtCount(crowd.neverWonShare * SIM_PLAYERS) })));
  if (crowd.firstWonShare > 0) truths.push(factItem(t('truthFirstWin'), { v: fmtShare(crowd.firstWonLostShare) }, t('truthFirstWinWhy', { share: fmtShare(crowd.firstWonShare) })));
  truths.push(factItem(t('truthSameOdds'), {}, t('truthSameOddsWhy')));
  $('sim-truths').replaceChildren(...truths);
}

function drawSimChart(container, bands, characters, weeks) {
  const t = state.t;
  const width = Math.max(300, container.clientWidth || 600);
  const wide = width >= 560;
  const height = width < 520 ? 260 : 320;
  const m = { top: 12, right: wide ? 164 : 12, bottom: 26, left: 62 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  let lo = 0;
  let hi = 0;
  for (const b of bands) (lo = Math.min(lo, b.q10), hi = Math.max(hi, b.q90));
  for (const c of characters) for (const v of c.player.path) (lo = Math.min(lo, v), hi = Math.max(hi, v));
  const step = niceStep(hi - lo || 1, 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = i => m.left + ((i + 1) / weeks) * w;
  const y = v => m.top + ((hi - v) / (hi - lo)) * h;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('chartLabel', { n: fmtCount(SIM_PLAYERS_SHOWN) }) });
  for (let v = lo; v <= hi + step / 2; v += step) {
    svg.append(svgEl('line', { class: Math.abs(v) < step / 2 ? 'zero-line' : 'grid-line', x1: m.left, x2: m.left + w, y1: y(v), y2: y(v) }));
    const label = svgEl('text', { class: 'tick', x: m.left - 6, y: y(v) + 4, 'text-anchor': 'end' });
    label.textContent = fmtAxis(v);
    svg.append(label);
  }
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const k = Math.round(frac * weeks);
    const label = svgEl('text', { class: 'tick', x: m.left + frac * w, y: height - 6, 'text-anchor': frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle' });
    label.textContent = k === 0 ? t('simStart') : t('simWeekShort', { n: fmtCount(k) });
    svg.append(label);
  }
  const pathOf = values => {
    let d = `M${m.left},${y(0)}`;
    for (let i = 0; i < weeks; i++) d += `L${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`;
    return d;
  };
  const areaOf = (low, high) => {
    let d = `M${m.left},${y(0)}`;
    for (let i = 0; i < weeks; i++) d += `L${x(i).toFixed(1)},${y(bands[i][high]).toFixed(1)}`;
    for (let i = weeks - 1; i >= 0; i--) d += `L${x(i).toFixed(1)},${y(bands[i][low]).toFixed(1)}`;
    return `${d}Z`;
  };
  svg.append(svgEl('path', { class: 'band-outer', d: areaOf('q10', 'q90') }));
  svg.append(svgEl('path', { class: 'band-inner', d: areaOf('q25', 'q75') }));
  const median = bands.map(b => b.q50);
  svg.append(svgEl('path', { class: 'median', d: pathOf(median) }));
  for (const c of [...characters].reverse()) svg.append(svgEl('path', { class: 'run-hero', style: `stroke:${c.color}`, d: pathOf(c.player.path) }));

  if (wide) {
    // Right-edge labels, nudged apart so they never overlap.
    const labels = [
      ...characters.map(c => ({ text: `${t(c.name)} ${fmtMoney(c.player.final)}`, value: c.player.final, color: c.color })),
      { text: `${t('simMedianLine')} ${fmtMoney(median.at(-1))}`, value: median.at(-1), color: 'var(--text-secondary)' }
    ]
      .map(l => ({ ...l, y: y(l.value) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
    const overflow = labels.at(-1).y - (m.top + h);
    if (overflow > 0) for (const l of labels) l.y -= overflow;
    for (const l of labels) {
      const text = svgEl('text', { class: 'end-label', x: m.left + w + 8, y: l.y + 4, style: `fill:${l.color}` });
      text.textContent = l.text;
      svg.append(text);
    }
  }

  const crosshair = svgEl('line', { class: 'crosshair', y1: m.top, y2: m.top + h, visibility: 'hidden' });
  const hit = svgEl('rect', { class: 'hit', x: m.left, y: m.top, width: w, height: h, tabindex: '0', 'aria-label': t('chartLabel', { n: fmtCount(SIM_PLAYERS_SHOWN) }) });
  svg.append(crosshair, hit);
  const tooltip = el('div', { class: 'tooltip', hidden: '' });
  container.replaceChildren(svg, tooltip);

  let current = weeks - 1;
  const show = i => {
    current = Math.max(0, Math.min(weeks - 1, i));
    const px = x(current);
    crosshair.setAttribute('x1', px);
    crosshair.setAttribute('x2', px);
    crosshair.setAttribute('visibility', 'visible');
    const row = (key, value, color) =>
      el('div', { class: 'tooltip-row' }, [
        el('span', {}, [color ? el('span', { class: 'legend-key thick', style: `background:${color}` }) : null, document.createTextNode(key)]),
        el('strong', { text: value })
      ]);
    const b = bands[current];
    tooltip.replaceChildren(
      el('p', { class: 'tooltip-title', text: t('simWeekN', { n: fmtCount(current + 1) }) }),
      ...characters.map(c => row(t(c.name), fmtMoney(c.player.path[current]), c.color)),
      row(t('simMedianLine'), fmtMoney(b.q50), 'var(--text-secondary)'),
      row(t('simBand80'), `${fmtAxis(b.q10)} ~ ${fmtAxis(b.q90)}`),
      row(t('simAheadNow'), fmtShare(b.ahead / SIM_PLAYERS))
    );
    tooltip.hidden = false;
    const scale = container.clientWidth / width;
    const left = px * scale;
    const tipWidth = tooltip.offsetWidth;
    tooltip.style.left = `${Math.max(0, left + 12 + tipWidth > container.clientWidth ? left - tipWidth - 12 : left + 12)}px`;
    tooltip.style.top = `${m.top * scale}px`;
  };
  const hide = () => {
    crosshair.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };
  hit.addEventListener('pointermove', event => {
    const rect = svg.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * width;
    show(Math.round(((sx - m.left) / w) * weeks) - 1);
  });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(current));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', event => {
    const jump = Math.max(1, Math.round(weeks / 26));
    if (event.key === 'ArrowRight') show(current + jump);
    else if (event.key === 'ArrowLeft') show(current - jump);
    else return;
    event.preventDefault();
  });
}

function renderSimTable(bands, characters, weeks) {
  const t = state.t;
  const rows = [];
  const points = [...new Set(Array.from({ length: 10 }, (_, k) => Math.max(0, Math.round(((k + 1) / 10) * weeks) - 1)))];
  for (const i of points) {
    rows.push(
      el('tr', {}, [
        el('td', { text: fmtCount(i + 1) }),
        el('td', { text: fmtMoney(bands[i].q50) }),
        ...characters.map(c => el('td', { text: fmtMoney(c.player.path[i]) })),
        el('td', { text: fmtShare(bands[i].ahead / SIM_PLAYERS) })
      ])
    );
  }
  $('sim-table').replaceChildren(
    el('table', {}, [
      el('thead', {}, el('tr', {}, [t('simTableWeek'), t('simMedianLine'), ...characters.map(c => t(c.name)), t('simAheadNow')].map(h => el('th', { text: h })))),
      el('tbody', {}, rows)
    ])
  );
}

// ---- F1 -----------------------------------------------------------------------

// Every driver the market prices, like the lottery's full list.
function renderF1() {
  const t = state.t;
  const f1 = state.data.f1;
  $('f1').hidden = !inSport('f1') || !f1;
  if (!f1) return;
  const drivers = state.bets.filter(b => b.kind === 'f1');
  $('f1-body').replaceChildren(
    board({
      emblem: 'f1',
      title: f1.title,
      sub: fmtTime(f1.startUtc),
      bets: drivers,
      id: 'f1',
      notes: [t('f1Intro')],
      rows: (b, i, editing) => entryRow(b, i, editing, driverBadge(b), b.driver.team)
    })
  );
}

// ---- Boot ---------------------------------------------------------------------

function renderAll() {
  renderStatic();
  if (!state.data) return;
  state.bets = buildBets(state.data);
  state.futures = buildFutures(state.data);
  state.parlay = state.parlay.filter(id => slipCandidates().some(b => b.id === id));
  renderStatus('ok');
  renderTabs();
  renderSportFilter();
  renderDayFilter();
  renderRanking();
  renderGames();
  renderFutures();
  renderParlay();
  renderSim();
  renderF1();
  renderAccount();
  renderSaved();
}

// Longest the loading screen waits at start-up; after that the page opens and
// whatever is still loading finishes in the background.
const BOOT_LIMIT_MS = 45_000;

async function load() {
  renderStatus('loading');
  const booting = state.booting;
  // The simulation runs at start-up only when the page opens on its tab.
  const oddsShare = state.tab === 'sim' ? BOOT_ODDS_SHARE : 1;
  const onProgress = booting ? p => showLoading(state.t('loading'), oddsShare * p) : undefined;
  if (booting) onProgress(0);
  const limit = booting ? setTimeout(() => ((state.booting = false), hideLoading()), BOOT_LIMIT_MS) : null;
  $('refresh').disabled = true;
  try {
    state.data = await loadOdds(new Date(), onProgress);
    renderAll();
    // Opened on the simulator: the page opens once its simulation is ready.
    if (state.booting && state.tab === 'sim') await renderSim();
  } catch (error) {
    console.error(error);
    renderStatus('error');
  } finally {
    clearTimeout(limit);
    if (booting) {
      state.booting = false;
      hideLoading();
    }
    $('refresh').disabled = false;
  }
}

// ---- Tabs ---------------------------------------------------------------------

const TABS = ['games', 'slip', 'history', 'sim', 'math'];

function tabAvailable(tab) {
  if (!state.data) return tab === 'games' || tab === 'math' || tab === 'history';
  return true;
}

function renderTabs() {
  const t = state.t;
  if (!tabAvailable(state.tab)) state.tab = 'games';
  const legs = state.parlay.length;
  const badge = $('tab-slip').querySelector('.tab-badge');
  badge.hidden = legs === 0;
  badge.textContent = String(legs);
  for (const tab of TABS) {
    const button = $(`tab-${tab}`);
    button.hidden = !tabAvailable(tab);
    button.setAttribute('aria-selected', String(tab === state.tab));
    button.tabIndex = tab === state.tab ? 0 : -1;
    $(`panel-${tab}`).hidden = tab !== state.tab;
  }
}

// 詳細: shows the margins, chances, takes and extra stats everywhere. The
// page marks those with .detail-only, so switching needs no redraw.
function renderDetailToggle() {
  const button = $('detail-toggle');
  document.body.classList.toggle('detail', state.detail);
  button.setAttribute('aria-pressed', String(state.detail));
  button.querySelector('span').textContent = state.t('detailLabel');
  button.title = state.t('detailHint');
}

$('detail-toggle').addEventListener('click', () => {
  state.detail = !state.detail;
  try {
    localStorage.setItem(DETAIL_KEY, state.detail ? '1' : '0');
  } catch {}
  renderDetailToggle();
});

// The simulated period as pills; the hidden select keeps the value.
// "1 個月", "半年", "1 年 3 個月", "5 年": a period of whole months.
function periodName(weeks) {
  const t = state.t;
  const months = PERIOD_MONTHS[MONTH_WEEKS.indexOf(weeks)] ?? Math.round((weeks * 12) / 52);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y && m === 6) return t('periodHalf');
  const part = (n, one, many) => (n === 1 ? t(one) : t(many, { n }));
  return [y ? part(y, 'periodYear', 'periodYears') : '', m ? part(m, 'periodMonth', 'periodMonths') : ''].filter(Boolean).join(' ');
}

// Quick picks under the period slider.
const PERIOD_PRESETS = [1, 6, 12, 24, 36, 60];

// The period: a slider by the month up to 5 years, and a few quick picks.
// The label follows the slider as it moves; the simulation runs on release.
function renderPeriods() {
  const weeks = Number($('sim-weeks').value);
  const months = PERIOD_MONTHS[MONTH_WEEKS.indexOf(weeks)];
  $('sim-months').value = String(months);
  $('period-value').textContent = periodName(weeks);
  $('sim-periods').replaceChildren(
    ...PERIOD_PRESETS.map(m =>
      el('button', {
        type: 'button',
        'aria-pressed': String(m === months),
        text: periodName(monthWeeks(m)),
        onclick: () => setPeriod(m)
      })
    )
  );
}

function setPeriod(months) {
  $('sim-weeks').value = String(monthWeeks(months));
  renderPeriods();
  renderSim();
}

// The nearest period the simulation records.
const snapMonths = m => PERIOD_MONTHS.reduce((best, x) => (Math.abs(x - m) < Math.abs(best - m) ? x : best));
$('sim-months').addEventListener('input', event => ($('period-value').textContent = periodName(monthWeeks(snapMonths(Number(event.target.value))))));
$('sim-months').addEventListener('change', event => setPeriod(snapMonths(Number(event.target.value))));

function showTab(tab) {
  state.tab = tab;
  try {
    history.replaceState(null, '', `#${tab}`);
  } catch {}
  renderTabs();
  window.scrollTo({ top: 0 });
  // The chart sizes itself to its container, which is hidden until now.
  if (tab === 'sim' && state.data) renderSim();
  if (tab === 'history') {
    checkResults();
    renderStats();
  }
}

for (const button of document.querySelectorAll('#tabs .tab')) button.addEventListener('click', () => showTab(button.dataset.tab));
$('tabs').addEventListener('keydown', event => {
  const visible = TABS.filter(tab => !$(`tab-${tab}`).hidden);
  const i = visible.indexOf(state.tab);
  const next = event.key === 'ArrowRight' ? visible[(i + 1) % visible.length] : event.key === 'ArrowLeft' ? visible[(i - 1 + visible.length) % visible.length] : null;
  if (!next) return;
  event.preventDefault();
  showTab(next);
  $(`tab-${next}`).focus();
});
{
  const fromHash = location.hash.slice(1);
  if (TABS.includes(fromHash)) state.tab = fromHash;
}

$('refresh').addEventListener('click', load);
// Redraw only when the width changes: phones fire resize when the address bar
// slides away, and that shouldn't reset the chart.
let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    if (state.data) renderSim();
  }, 150);
});

// Phones: no app header. The 詳細 switch, the status and refresh move to a
// slim row at the top of the page (the tabs are already at the bottom).
{
  const phone = matchMedia('(max-width: 720px)');
  const place = () => {
    const into = phone.matches ? $('mobile-bar') : document.querySelector('.appbar-inner');
    if (phone.matches) into.append($('status'), $('detail-toggle'), $('refresh'));
    else {
      document.querySelector('.brand-text').append($('status'));
      into.append($('detail-toggle'), $('refresh'));
    }
  };
  place();
  phone.addEventListener('change', place);
}

// Big numbers on one line: each of these shrinks its font (down to 60%) to
// fit its box, instead of wrapping onto a second row on phones. Checked when
// its text changes and when its box resizes (which also covers a tab or the
// 詳細 switch showing it for the first time). Only the slip and simulator
// have such numbers. All reads, then all writes, so the page lays out once.
const FIT_SELECTOR = '.stat-value, .player-line strong, .lapse-stats strong, .story-big, .buy strong, .you-end';
function fitNumbers(nodes) {
  for (const node of nodes) node.style.fontSize = '';
  const sizes = nodes.map(node => {
    const box = node.clientWidth;
    const need = node.scrollWidth;
    if (!box || need <= box + 0.5) return null;
    const full = parseFloat(getComputedStyle(node).fontSize);
    return Math.max(full * 0.6, Math.floor(((full * box) / need) * 10) / 10);
  });
  nodes.forEach((node, i) => sizes[i] && (node.style.fontSize = `${sizes[i]}px`));
}
if ('ResizeObserver' in window) {
  const fitted = new WeakSet();
  const resized = new ResizeObserver(entries => fitNumbers(entries.map(entry => entry.target)));
  const watch = new MutationObserver(mutations => {
    const found = new Set();
    for (const m of mutations) {
      const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!target) continue;
      const own = target.closest(FIT_SELECTOR);
      if (own) found.add(own);
      else for (const node of target.querySelectorAll(FIT_SELECTOR)) found.add(node);
    }
    for (const node of found) {
      if (fitted.has(node)) continue;
      fitted.add(node);
      resized.observe(node);
    }
    if (found.size) fitNumbers([...found]);
  });
  for (const id of ['panel-slip', 'panel-sim']) watch.observe($(id), { childList: true, subtree: true, characterData: true });
}

// Tells the page's failsafe (in index.html) that the scripts loaded and started.
window.__oddsStarted = true;
state.account = newAccount();
state.sync = { ...state.sync, code: loadSyncCode() };
renderStatic();
renderTabs();
// The saved account is compressed, so it opens a moment after the page.
loadAccount().then(account => {
  state.account = account;
  state.accountReady = true;
  renderAccount();
  renderSaved();
  syncNow();
  if (state.data) checkResults();
});
load().then(() => {
  if (state.accountReady) checkResults();
  refreshLive();
});
// Back on the tab: pick up what another device did, and any games that ended.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  syncNow();
  if (state.tab === 'history') checkResults();
});
