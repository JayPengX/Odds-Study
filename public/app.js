import {
  FUTURES_OVERROUND,
  ODDS_ERROR,
  backMargin,
  estimateF1LotteryOdds,
  f1Phase,
  estimateFuturesOdds,
  analyzeSlip,
  slipPayoutTable,
  expectedReturn,
  settleSlip,
  median,
  quantile,
  SLIP_RULES,
  afterTax,
  choose,
  seededRandom,
  slipErrors,
  slipSizes
} from './lib/odds.mjs';
import {
  FANS,
  fanSeries,
  STYLES,
  TRAITS,
  TRAIT_ROWS,
  SPORTS,
  SIM_SPORTS,
  traitKeys,
  sportTemplate,
  weekOfYear,
  crowdPools,
  crowdSize,
  hashString,
  SIM_START_BALANCE,
  SIM_WEEKLY_GRANT,
  simulateCrowd,
  gamesInWeek,
  MONTH_WEEKS,
  PERIOD_MONTHS,
  monthWeeks,
  replayPlayer
} from './lib/sim.mjs';
import { ticketProfile, accountTickets } from './lib/profile.mjs';
import { loadOdds, loadExtraLeagues, loadExtraFutures, taipeiDayKey, fetchOutcomes, loadLive } from './lib/sources.mjs';
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
import { historyStats, outlookOf, chanceOf, funFacts, crowdPercentile } from './lib/history.mjs';
import { detectLocale, makeT } from './lib/i18n.mjs';
import { f1Driver, leagueLogo, teamLogo, teamZh, LEAGUES, familyOf, isSoccer, isSets, isNeutral, normalizeTeamName } from './lib/teams.mjs';
import { houseRule, minLegsProblem } from './lib/rules.mjs';
import { gameOptions, crowdPool, f1Podium } from './lib/board.mjs';
import { ARCADE, STREAK, scorer, bestRound, earnedToday, roomToday, payGame, wageMinutes, stakeToLose, DERBY, pitchPlan, ballAt, swingResult, TYPING, ticketCode, groupCode, typedRight, SORT, SORT_SETS, sortSet, sortTicket, FREE_THROW, shotPlan, markerAt, shotResult } from './lib/arcade.mjs';
import { auditPools, auditCrowd } from './lib/audit.mjs';
import { recommend } from './lib/recommend.mjs';

const STAKE = 100;
// Simulated people per pick style x series-follow group, on average: each style
// gets its share of the crowd, 100,000 people in all.
const PER_GROUP = Math.ceil(100_000 / (STYLES.length * FANS.length));
const SIM_PLAYERS = crowdSize(PER_GROUP);
const SIM_SEED = 1;
// Shown as a round "100,000".
const SIM_PLAYERS_SHOWN = Math.round(SIM_PLAYERS / 1000) * 1000;
const THIN_LIQUIDITY = 10_000;
// Championship teams shown before the rest fold away.
const FUTURES_SHOWN = 8;
const ACCOUNT_KEY = 'oddsStudy.account';
const SYNC_KEY = 'oddsStudy.syncCode';
// Saved slips shown before the rest fold away.
const SAVED_SHOWN = 10;

const state = {
  // 小遊戲: the open game, its view (kept across re-renders) and its animation frame.
  arcadeGame: null,
  arcadeView: null,
  arcadeFrame: 0,
  locale: detectLocale(),
  t: null,
  data: null,
  bets: [],
  futures: [],
  // Recommended picks (recommend.mjs): bet id -> { tag, back, beats }.
  recs: new Map(),
  // Games in progress and their live bets.
  liveGames: [],
  liveBets: [],
  liveRecs: new Map(),
  liveAt: null,
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
  // Game cards showing all their markets.
  open: new Set(),
  // Each open game's market tab (大小分, 讓分, 單隊大小, 得分最高單局).
  marketTab: new Map(),
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
  // 大手筆 (bets grow with the balance) or 真實 (survey-based stakes) in the simulator.
  // The leaderboard shown.
  leaderKey: 'best',
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
  // Players at a neutral venue: in the order the draw lists them.
  return isSoccer(game.sport) || isNeutral(game.sport)
    ? `${teamName(game.home)} vs ${teamName(game.away)}`
    : `${teamName(game.away)} @ ${teamName(game.home)}`;
}

// Which competition a game is in: its league, and for tours and cups the
// event (Kambi's group: "Chengdu", "Italy Serie A" …).
function gameSeries(game) {
  const league = state.t(`sport_${game.sport}`);
  const event = game.group && normalizeTeamName(game.group) !== normalizeTeamName(league) ? game.group : null;
  return event ? `${league} · ${event}` : league;
}

// ---- Names for the board's options (board.mjs prices them) --------------------

function fmtLine(line) {
  return `${line > 0 ? '+' : line < 0 ? '−' : ''}${Math.abs(line)}`;
}

// A priced option with what the page calls it: `chip` (on its button),
// `label` (in full), `shortLabel` (on the slip) and `marketLabel` (its
// market's heading).
function named(game, o, matchup) {
  const t = state.t;
  const team = side => teamName(game[side]);
  const unit = () => t(`unit_${LEAGUES[game.sport]?.sets?.unit ?? 'points'}`);
  switch (o.kind) {
    case 'ml': {
      const name = o.side === 'draw' ? t('draw') : team(o.side);
      return { ...o, matchup, chip: name, label: o.side === 'draw' ? `${matchup} ${name}` : `${name} ${t('win')}`, shortLabel: name };
    }
    case 'total':
      return { ...o, matchup, marketLabel: String(o.totalLine), chip: t(o.side), label: `${matchup} ${t(o.side)} ${o.totalLine}`, shortLabel: `${t(o.side)} ${o.totalLine}` };
    case 'runline': {
      const text = `${team(o.side)} ${fmtLine(o.runLine)}`;
      return { ...o, matchup, marketLabel: `${team(o.giver)} ${fmtLine(-Math.abs(o.awayLine))}`, chip: text, label: text, shortLabel: `${t('runLine')} ${text}` };
    }
    case 'teamtotal': {
      const text = `${team(o.team)} ${t(o.side)} ${o.teamLine}`;
      return { ...o, matchup, marketLabel: `${team(o.team)} ${o.teamLine}`, chip: t(o.side), label: text, shortLabel: text };
    }
    case 'inning': {
      const name = o.inning < 9 ? t('inningN', { n: o.inning + 1 }) : t('inningTie');
      return { ...o, matchup, chip: name, label: `${matchup} ${t('topInning')} ${name}`, shortLabel: name };
    }
    case 'gamehcap': {
      const text = `${team(o.side)} ${fmtLine(o.line)}`;
      return { ...o, matchup, marketLabel: `${team(o.giver)} ${fmtLine(-Math.abs(o.awayLine))} ${unit()}`, chip: text, label: text, shortLabel: `${t('secGameHcap')} ${text}` };
    }
    case 'gametotal':
      return { ...o, matchup, marketLabel: `${o.line} ${unit()}`, chip: t(o.side), label: `${matchup} ${t(o.side)} ${o.line}`, shortLabel: `${t(o.side)} ${o.line} ${unit()}` };
    default: {
      const name = pickName(game, o.m, o.pick);
      return { ...o, matchup, marketLabel: marketLabelOf(game, o.m), chip: name, label: `${matchup} ${name}`, shortLabel: name };
    }
  }
}

// A market's heading inside its section, when it needs one.
function marketLabelOf(game, m) {
  const t = state.t;
  if (m.kind === 'runline' || m.kind === 'total') return null;
  if (m.kind === 'totalsets') return `${t('secTotalSets')} ${m.line}`;
  if (m.kind === 'sethcap') return `${teamName(game[m.giver])} ${fmtLine(-Math.abs(m.awayLine))}`;
  if (m.kind === 'nextrun') return t('firstScore');
  return t(SECTIONS.find(sec => sec.kind === m.kind)?.title ?? m.kind);
}

const RESULT_SHORT = { home: 'homeShort', draw: 'drawShort', away: 'awayShort' };

// What a pick is called: a team, a line, a band, a score …
function pickName(game, market, pick) {
  const t = state.t;
  if (market.kind === 'runline' || market.kind === 'sethcap') return `${teamName(game[pick.side])} ${fmtLine(pick.line)}`;
  if (market.kind === 'dc') return pick.side.split('|').map(x => (x === 'draw' ? t('draw') : teamName(game[x]))).join(' / ');
  if (market.kind === 'htft') return `${t(RESULT_SHORT[pick.ht])}/${t(RESULT_SHORT[pick.ft])}`;
  if (market.kind === 'goalbands') return pick.hi == null ? `${pick.lo}+` : `${pick.lo}-${pick.hi}`;
  if (market.kind === 'sets') {
    // The winner and the score in sets (frames): "Sinner 2:1".
    const [h, a] = pick.score.split('-').map(Number);
    return `${teamName(game[h > a ? 'home' : 'away'])} ${Math.max(h, a)}:${Math.min(h, a)}`;
  }
  if (market.kind === 'margin') return `${teamName(game[pick.team])} ${pick.hi == null ? `${pick.lo}+` : pick.lo === pick.hi ? pick.lo : `${pick.lo}-${pick.hi}`}`;
  if (market.kind === 'score') return pick.score === 'other' ? t('scoreOther') : pick.score.replace('-', ':');
  if (pick.side === 'away' || pick.side === 'home') return teamName(game[pick.side]);
  return t({ draw: 'draw', odd: 'odd', even: 'even', yes: 'yes', no: 'no', over: 'over', under: 'under' }[pick.side] ?? pick.side);
}

function buildBets(data) {
  const t = state.t;
  const bets = [];
  for (const game of data.games) {
    const matchup = matchupText(game);
    for (const o of gameOptions(game)) bets.push(named(game, o, matchup));
  }
  if (data.f1) {
    // Before qualifying the lottery prices the race on its own curve.
    const phase = f1Phase(new Date(), { qualifyingUtc: data.f1.qualifyingUtc, raceUtc: data.f1.startUtc });
    data.f1.phase = phase;
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
        errKey: `${phase === 'pre' ? 'f1Pre' : 'f1'}${d.fair < 0.01 ? 'Longshot' : ''}`,
        estOdds: estimateF1LotteryOdds(d.fair, phase)
      });
    }
    // 前三名: the same drivers finishing in the top three.
    const winners = bets.filter(b => b.kind === 'f1');
    f1Podium(winners.map(b => ({ fair: b.fairChance, odds: b.estOdds }))).forEach((p, i) => {
      const w = winners[i];
      bets.push({ ...w, id: `f1pod|${w.driverEn}`, kind: 'f1podium', market: `f1podium|${w.driverEn}`, label: `F1 ${t('f1PodiumShort')} ${w.shortLabel}`, fairChance: p.fair, estOdds: p.odds, errKey: 'extra', lock: p.lock, minLegs: p.minLegs });
    });
  }
  // Single-source games: the typical DraftKings-Polymarket gap of that sport.
  for (const sport of new Set(bets.map(b => b.sport))) {
    const gaps = bets.filter(b => b.sport === sport && b.fairMargin != null).map(b => b.fairMargin);
    const typical = median(gaps) ?? 0.02;
    for (const b of bets) if (b.sport === sport && b.fairMargin == null && (b.kind === 'ml' || b.kind === 'total')) Object.assign(b, { fairMargin: typical, typicalMargin: true });
  }
  return withHouseRules(bets);
}

// The lottery's locks and parlay-only rules (rules.mjs), on every pick
// (board.mjs already applies them to games; F1 and live picks here).
function withHouseRules(bets) {
  for (const b of bets) Object.assign(b, houseRule(b.kind, b.estOdds));
  return bets;
}

// A championship pick's name: drivers as the lottery writes them.
function futureName(market, team) {
  if (market.key === 'f1drivers' && state.locale === 'zh') return f1Driver(team.name.en).zh;
  return teamName(team.name);
}

// One bet per team of every championship market.
function buildFutures(data) {
  const t = state.t;
  return (data.futures || []).flatMap(market => {
    const odds = estimateFuturesOdds(market.teams.map(team => team.fair), FUTURES_OVERROUND[market.key] ?? FUTURES_OVERROUND[market.sport] ?? FUTURES_OVERROUND.other);
    const title = t(`future_${market.key}`, { season: market.season });
    return market.teams.map((team, i) => ({
      id: `fut|${market.key}|${team.name.en}`,
      gameId: `fut|${market.key}`,
      kind: 'future',
      market: market.key,
      sport: market.sport,
      matchup: title,
      label: `${title} ${futureName(market, team)}`,
      shortLabel: futureName(market, team),
      teamEn: team.name.en,
      eventSlug: market.slug,
      fairChance: team.fair,
      fairMargin: null,
      errKey: ODDS_ERROR[`future_${market.key}`] ? (team.fair < 0.004 && market.sport !== 'nba' ? 'futureLongshot' : `future_${market.key}`) : 'futureOther',
      estOdds: odds[i]
    }));
  });
}

function effectiveOdds(bet) {
  return bet.estOdds;
}

function betReturn(bet) {
  return expectedReturn(bet.fairChance, effectiveOdds(bet), STAKE);
}

// Relative margin of the odds used: none once real odds are typed in.
function oddsError(bet) {
  return ODDS_ERROR[bet.errKey]?.rel ?? 0;
}

function betBackMargin(bet) {
  return backMargin(bet.fairChance, bet.fairMargin, effectiveOdds(bet), oddsError(bet));
}

function fmtMarginPts(m) {
  return `±${(m * 100).toFixed(m < 0.01 ? 1 : 0)}`;
}

// Days follow Taiwan time, like the lottery.
function dayKey(iso) {
  return taipeiDayKey(iso);
}

// The sport filter: everything, a kind of sport (g:<group>), or one league.
const SPORT_GROUPS = {
  baseball: { icon: '⚾', leagues: ['mlb', 'npb', 'kbo', 'cpbl'] },
  basketball: { icon: '🏀', leagues: ['nba', 'wnba', 'euroleague', 'bleague'] },
  soccer: { icon: '⚽', leagues: Object.keys(LEAGUES).filter(key => LEAGUES[key].family === 'soccer') },
  football: { icon: '🏈', leagues: ['nfl', 'ncaaf'] },
  hockey: { icon: '🏒', leagues: ['nhl'] },
  tennis: { icon: '🎾', leagues: ['tennis', 'wta'] },
  badminton: { icon: '🏸', leagues: ['badminton'] },
  tabletennis: { icon: '🏓', leagues: ['tabletennis'] },
  volleyball: { icon: '🏐', leagues: ['volleyball'] },
  snooker: { icon: '🎱', leagues: ['snooker'] },
  f1: { icon: '🏎️', leagues: ['f1'] }
};
const groupOfSport = sport => Object.keys(SPORT_GROUPS).find(g => SPORT_GROUPS[g].leagues.includes(sport));

function inSport(sport) {
  if (state.sport === 'all' || state.sport === sport) return true;
  return state.sport.startsWith('g:') && SPORT_GROUPS[state.sport.slice(2)]?.leagues.includes(sport);
}

function visibleBets() {
  return state.bets.filter(b => inSport(b.sport) && dayKey(b.start) === state.day);
}

function rerenderFiltered() {
  renderSportFilter();
  renderTabs();
  renderDayFilter();
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

// Kinds of sport as tiles (an icon, the name, games listed), and once one
// with several leagues is picked, its leagues as small chips underneath.
function renderSportFilter() {
  const t = state.t;
  const present = new Set([...state.bets, ...state.futures].map(b => b.sport));
  const groups = Object.keys(SPORT_GROUPS).filter(g => SPORT_GROUPS[g].leagues.some(l => present.has(l)));
  const valid = state.sport === 'all' || (state.sport.startsWith('g:') && groups.includes(state.sport.slice(2))) || present.has(state.sport);
  if (!valid) state.sport = 'all';
  const games = inside => state.data.games.filter(g => inside(g.sport)).length;
  const countText = (n, f1) => (f1 ? t('f1Race') : n > 0 ? t('gamesN', { n }) : t('futuresOnly'));
  const current = state.sport === 'all' ? null : state.sport.startsWith('g:') ? state.sport.slice(2) : groupOfSport(state.sport);
  const pick = value => () => {
    state.sport = value;
    rerenderFiltered();
  };
  const tile = (value, icon, name, count, pressed) =>
    el('button', { class: 'sport-tile', type: 'button', 'aria-pressed': String(pressed), onclick: pick(value) }, [icon, el('span', { class: 'tile-name', text: name }), el('span', { class: 'tile-count', text: count })]);
  const groupIcon = g => (SPORT_GROUPS[g].leagues.length === 1 && leagueLogo(SPORT_GROUPS[g].leagues[0]) ? leagueImg(SPORT_GROUPS[g].leagues[0], 'logo-tile') : el('span', { class: 'league-badge logo-tile' }, el('span', { class: 'league-img league-icon', 'aria-hidden': 'true', text: SPORT_GROUPS[g].icon })));
  $('sport-filter').replaceChildren(
    tile('all', allIcon(), t('sport_all'), countText(games(() => true)), state.sport === 'all'),
    ...groups.map(g => {
      const leagues = SPORT_GROUPS[g].leagues.filter(l => present.has(l));
      const value = leagues.length === 1 ? leagues[0] : `g:${g}`;
      return tile(value, groupIcon(g), t(`group_${g}`), countText(games(sp => SPORT_GROUPS[g].leagues.includes(sp)), g === 'f1'), current === g);
    })
  );
  // Keep the picked tile in view in the scrolling row.
  {
    const row = $('sport-filter');
    const on = row.querySelector('[aria-pressed="true"]');
    if (on && (on.offsetLeft < row.scrollLeft || on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth)) row.scrollLeft = on.offsetLeft - 16;
  }
  // The picked kind's leagues.
  const leagues = current ? SPORT_GROUPS[current].leagues.filter(l => present.has(l)) : [];
  $('league-filter').hidden = leagues.length < 2;
  $('league-filter').replaceChildren(
    ...(leagues.length < 2
      ? []
      : [
          chip({ pressed: state.sport === `g:${current}`, text: t('leagueAll'), onclick: pick(`g:${current}`) }),
          ...leagues.map(l => chip({ pressed: state.sport === l, icon: leagueImg(l, 'logo-xs'), text: t(`sport_${l}`), count: games(sp => sp === l) || null, onclick: pick(l) }))
        ])
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
  const icon = LEAGUES[sport]?.icon;
  const fallback = () => (icon ? el('span', { class: 'league-img league-icon', 'aria-hidden': 'true', text: icon }) : el('span', { class: 'league-img league-missing', 'aria-hidden': 'true' }));
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
    ['games-title', 'gamesTitle'],
    ['live-title', 'liveTitle'],
    ['futures-title', 'futuresTitle'],
    ['parlay-title', 'parlayTitle'],
    ['account-title', 'accountTitle'],
    ['arcade-title', 'arcadeTitle'],
    ['saved-title', 'savedTitle'],
    ['stats-title', 'statsTitle'],
    ['sim-title', 'simTitle'],
    ['f1-title', 'f1Title'],
    ['math-title', 'mathTitle']
  ])
    $(id).textContent = t(key);
  for (const node of document.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);
  for (const tab of TABS) $(`tab-${tab}`).querySelector('.tab-label').textContent = t(`tab_${tab}`);
  renderPeriods();
  // The guide: reading the numbers, the odds math, then every habit, kind of fan, kind of bet, how
  // the simulators work, the rules and the data, each group folded.
  const groups = [[t('guideReadTitle'), t('guideRead')], [t('guideMathTitle'), t('mathSteps')], ...t('guide')];
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

// One icon per guide group, in order: reading the numbers, the odds math,
// traits, fans, kinds of bet, the lottery's rules, recommendations, the
// simulator, data and margins.
const GUIDE_ICONS = ['🔎', '🧮', '🧑‍🤝‍🧑', '🏟️', '🎫', '⚖️', '👍', '🎲', '📡'];

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
  if (bet.kind === 'f1' || bet.kind === 'f1podium') return driverBadge(bet, 'logo-sm');
  if (bet.kind === 'future') return logoImg(bet.sport, bet.teamEn, bet.shortLabel, 'logo-sm');
  // Totals' side is over/under: they show the league, team totals the team.
  const side = bet.kind === 'teamtotal' ? bet.team : ['away', 'home'].includes(bet.side) ? bet.side : null;
  if (bet.game && side) return logoImg(bet.sport, bet.game[side].en, teamName(bet.game[side]), 'logo-sm');
  return leagueImg(bet.sport, 'logo-sm');
}

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
  const ml = bets.filter(b => b.kind === 'ml');
  const neutral = isNeutral(game.sport);
  const sides = isSoccer(game.sport) ? ['home', 'draw', 'away'] : neutral ? ['home', 'away'] : ['away', 'home'];
  const rows = sides.map(side => {
    const bet = ml.find(b => b.side === side);
    const who =
      side === 'draw'
        ? [badge('=', 'var(--text-muted)'), el('span', { class: 'team-name', text: t('draw') })]
        : [
            logoImg(game.sport, game[side].en, teamName(game[side])),
            el('span', { class: 'team-name' }, [document.createTextNode(teamName(game[side])), neutral ? null : el('small', { text: t(side === 'home' ? 'homeTag' : 'awayTag') })])
          ];
    const score = game.live && side !== 'draw' ? el('span', { class: 'live-score', text: String(game.live[`${side}Score`]) }) : null;
    return el('div', { class: 'team-row' }, [...who, score, bet ? pickButton(bet, '') : null]);
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
      el('span', { class: 'game-series', text: gameSeries(game) }),
      game.live
        ? el('span', { class: 'game-time live-state' }, [el('span', { class: 'live-dot', text: t('tagLive') }), document.createTextNode(liveStateText(game.live))])
        : el('span', { class: 'game-time', text: hhmm(game.startUtc) })
    ]),
    el('div', { class: 'team-rows' }, rows),
    open ? gameMore(game, others) : null,
    others.length === 0 ? null : el('button', { class: 'more-toggle', type: 'button', 'aria-expanded': String(open), onclick: toggle }, [
      document.createTextNode(open ? t('lessMarkets') : t('moreMarkets'))
    ])
  ]);
}

// Every other market of a game, one small card each, then the game's details.
function gameMore(game, bets) {
  const t = state.t;
  const kinds = SECTIONS.filter(sec => sec.kind !== 'ml' && bets.some(b => b.kind === sec.kind));
  const current = kinds.find(sec => sec.kind === state.marketTab.get(game.id)) ?? kinds[0];
  const sourceKey = game.live ? (game.live.pmWin != null ? 'liveSourcePm' : 'liveSource') : game.book === 'kambi' ? 'sourceKambi' : game.draftKings && game.polymarket ? 'sourceBoth' : game.draftKings ? 'sourceDk' : 'sourcePm';
  const thin = sourceKey === 'sourcePm' && (game.polymarketLiquidity ?? 0) < THIN_LIQUIDITY;
  const notes = [];
  if (game.live) notes.push(t(game.sport === 'mlb' ? 'liveNote' : 'liveNoteSoccer'));
  if (game.book === 'kambi') notes.push(t('kambiNote'));
  if (LEAGUES[game.sport]?.kambi && !LEAGUES[game.sport]?.results) notes.push(t('handSettleNote'));
  if (isSoccer(game.sport)) notes.push(t('soccerUnverified'));
  if (['football', 'basketball', 'hockey'].includes(familyOf(game.sport))) notes.push(t('otherSportNote'));
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
              text: t(sec.kind === 'runline' && isSoccer(game.sport) ? 'secHandicap' : sec.short ?? sec.title),
              onclick: () => {
                state.marketTab.set(game.id, sec.kind);
                (game.live ? renderLive : renderGames)();
              }
            })
          )
        )
      : null,
    current ? marketPanel(game, current, bets.filter(b => b.kind === current.kind)) : null,
    el('div', { class: 'game-foot' }, [
      el('details', { class: 'info' }, [el('summary', { text: t('notesTitle') }), el('p', { text: `${fmtTime(game.startUtc)} · ${t(sourceKey)}` }), ...notes.map(text => el('p', { text }))])
    ])
  ]);
}

// One line of a two-way market: the line (tagged when the lottery posts it)
// and its two picks.
function lineRow(label, pair, { posted = false, main = false } = {}) {
  const t = state.t;
  // Outside MLB the tagged line is DraftKings' main line, not a checked lottery line.
  if (posted && pair[0]?.sport !== 'mlb') main = true;
  return el('div', { class: `line-row ${posted ? 'posted' : ''} ${main ? 'main' : ''}` }, [
    el('span', { class: 'line-label' }, [
      el('strong', { text: label }),
      posted ? el('small', { class: 'line-tag', text: t(main ? 'lineMain' : 'lineLottery') }) : null
    ]),
    ...pair.map(b => (b ? pickButton(b, '') : el('span')))
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
function marketPanel(game, section, bets) {
  const t = state.t;
  const by = (list, side) => list.find(b => b.side === side);
  let body;
  if (TOTAL_KINDS.has(section.kind)) {
    const lineOf = b => b.totalLine ?? b.line;
    const rows = [...groupBy(bets, lineOf).values()]
      .sort((a, b) => lineOf(a[0]) - lineOf(b[0]))
      .map(pair => lineRow(String(lineOf(pair[0])), [by(pair, 'over'), by(pair, 'under')], { posted: pair[0].posted, main: pair[0].mainLine }));
    body = [lineTable([t('colLine'), t('over'), t('under')], rows)];
  } else if (HCAP_KINDS.has(section.kind)) {
    // One block per team giving the runs: "遊騎兵 讓分" -1.5, -2.5, …
    body = ['away', 'home']
      .map(giver => {
        const taker = giver === 'away' ? 'home' : 'away';
        const markets = [...groupBy(bets.filter(b => b.giver === giver), b => b.market).values()].sort((a, b) => Math.abs(a[0].awayLine) - Math.abs(b[0].awayLine));
        if (!markets.length) return null;
        const rows = markets.map(pair => lineRow(fmtLine(-Math.abs(pair[0].awayLine)), [by(pair, giver), by(pair, taker)], { posted: pair[0].posted }));
        const heading = section.kind === 'runline' ? t(isSoccer(game.sport) ? 'giveGoals' : familyOf(game.sport) === 'baseball' ? 'giveRuns' : 'givePoints', { team: teamName(game[giver]) }) : `${teamName(game[giver])} · ${t(section.title)}`;
        return lineTable([t('colLine'), teamName(game[giver]), teamName(game[taker])], rows, heading);
      })
      .filter(Boolean);
  } else if (section.kind === 'teamtotal') {
    body = ['away', 'home']
      .map(team => {
        const lines = [...groupBy(bets.filter(b => b.team === team), b => b.teamLine).values()].sort((a, b) => a[0].teamLine - b[0].teamLine);
        if (!lines.length) return null;
        const rows = lines.map(pair => lineRow(String(pair[0].teamLine), [by(pair, 'over'), by(pair, 'under')], { posted: pair[0].posted, main: pair[0].posted }));
        return lineTable([t('colLine'), t('over'), t('under')], rows, teamName(game[team]));
      })
      .filter(Boolean);
  } else {
    // One block per market (最高單局 has one; 第N分 one per run).
    body = [...groupBy(bets, b => b.market).values()].flatMap(list => [
      el('div', { class: 'market-head' }, [el('span', { class: 'market-title', text: list[0].marketLabel ?? t(section.title) })]),
      el('div', { class: 'market-picks' }, list.map(b => pickButton(b, b.chip ?? b.shortLabel)))
    ]);
  }
  const extra = bets.some(b => b.posted === false);
  // Only MLB's lines were compared with the lottery; elsewhere the main line is DraftKings'.
  const note = game.sport === 'mlb' ? (extra ? t('linesNote') : null) : ['total', 'runline', 'teamtotal'].includes(section.kind) ? t('linesNoteOther') : null;
  return el('div', { class: `market-panel ${section.kind}` }, [...body, note ? el('p', { class: 'note', text: note }) : null]);
}

// Kinds laid out as tables of lines: over/under, and one team giving a line.
const TOTAL_KINDS = new Set(['total', 'gametotal', 'htotal', 'totalsets']);
const HCAP_KINDS = new Set(['runline', 'gamehcap', 'sethcap']);

// One section per kind of bet, each market of it with its own take. The
// inning market's ten results take a whole row.
const SECTIONS = [
  { kind: 'ml', title: 'secMoneyline' },
  { kind: 'total', title: 'secTotal' },
  { kind: 'runline', title: 'secRunLine' },
  { kind: 'teamtotal', title: 'secTeamTotal' },
  { kind: 'inning', title: 'secTopInning', short: 'topInningShort' },
  { kind: 'nextrun', title: 'secNextRun' },
  { kind: 'margin', title: 'secMargin' },
  { kind: 'half', title: 'secHalf' },
  { kind: 'htotal', title: 'secHalfTotal' },
  { kind: 'dc', title: 'secDoubleChance' },
  { kind: 'f5', title: 'secF5' },
  { kind: 'regulation', title: 'secRegulation' },
  { kind: 'firstinning', title: 'secFirstInning' },
  { kind: 'btts', title: 'secBtts' },
  { kind: 'score', title: 'secScore' },
  { kind: 'oddeven', title: 'secOddEven' },
  { kind: 'htft', title: 'secHtft' },
  { kind: 'goalbands', title: 'secGoalBands' },
  { kind: 'q1', title: 'secQ1' },
  { kind: 'firstset', title: 'secFirstSet' },
  { kind: 'sets', title: 'secSets' },
  { kind: 'totalsets', title: 'secTotalSets' },
  { kind: 'sethcap', title: 'secSetHcap' },
  { kind: 'gamehcap', title: 'secGameHcap' },
  { kind: 'gametotal', title: 'secGameTotal' }
];

function fmtPctShort(p) {
  return p >= 0.1 ? `${Math.round(p * 100)}%` : `${(p * 100).toFixed(1)}%`;
}

function pickTitle(bet) {
  const t = state.t;
  const err = ODDS_ERROR[bet.errKey] ?? ODDS_ERROR.extra;
  return [
    bet.label,
    `${t('legendOdds')} ${fmtOdds(effectiveOdds(bet))} ±${fmtOdds(bet.estOdds * err.rel)}${err.checked ? '' : '?'}`,
    bet.cut ? `${t('takeTitle')} ${fmtPct(1 - 1 / bet.cut)}` : null,
    `${t('colFair')} ${fmtPct(bet.fairChance)}${bet.fairMargin ? ` ${fmtMarginPts(bet.fairMargin)}${bet.typicalMargin ? '*' : ''}` : ''}`,
    `${t('legendBack')} ${fmtMoney(betReturn(bet), { sign: false })} ±${Math.round(betBackMargin(bet))}`,
    bet.lock ? t(`lock_${bet.lock}`) : bet.minLegs > 1 ? t('minLegsNote', { n: bet.minLegs }) : null
  ]
    .filter(Boolean)
    .join('\n');
}

// A pick: tap to put it on the bet slip (or take it off). The big number is
// the estimated lottery odds; its colour, whether it pays back more or less
// than most (the numbers behind it are in its tooltip and in 說明). A locked
// pick (the house doesn't sell it) shows a lock; one sold only in parlays
// shows its minimum (2關, 3關).
function pickButton(bet, name) {
  const t = state.t;
  const back = betReturn(bet);
  const inSlip = state.parlay.includes(bet.id);
  const locked = Boolean(bet.lock);
  const rec = !locked && (bet.live ? state.liveRecs : state.recs)?.get(bet.id);
  const body = [
    rec ? el('span', { class: `rec rec-${rec.tag}`, text: t(`rec_${rec.tag}`) }) : null,
    name ? el('span', { class: 'pick-name', text: name }) : null,
    el('span', { class: 'pick-odds' }, [
      locked ? el('span', { class: 'lock', 'aria-hidden': 'true', text: '🔒' }) : document.createTextNode(fmtOdds(effectiveOdds(bet))),
      !locked && bet.minLegs > 1 ? el('small', { class: 'min-legs', text: t('minLegsTag', { n: bet.minLegs }) }) : null
    ])
  ];
  return el('button', {
    class: `pick ${locked ? 'locked' : backClass(back)} ${rec ? 'has-rec' : ''} ${inSlip ? 'in-slip' : ''}`,
    type: 'button',
    title: [rec ? t(`recWhy_${rec.tag}`, { back: Math.round(rec.back), beats: Math.round(rec.beats * 100) }) : null, pickTitle(bet)].filter(Boolean).join('\n'),
    disabled: locked ? true : null,
    'aria-pressed': String(inSlip),
    'aria-label': `${bet.label} ${fmtOdds(effectiveOdds(bet))} · ${locked ? t(`lock_${bet.lock}`) : inSlip ? t('removeLeg') : t('addLeg')}`,
    onclick: locked ? null : () => toggleLeg(bet)
  }, body);
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
  return { games, bets: withHouseRules(bets) };
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
    state.liveRecs = recommend(bets);
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
function entryRow(bet, i, picture, sub) {
  const t = state.t;
  const inSlip = state.parlay.includes(bet.id);
  const locked = Boolean(bet.lock);
  return el('div', { class: `entry ${inSlip ? 'in-slip' : ''} ${locked ? 'locked' : ''}`, title: pickTitle(bet) }, [
    el('span', { class: 'entry-rank', text: String(i + 1) }),
    picture,
    el('span', { class: 'entry-name' }, [document.createTextNode(bet.shortLabel), el('small', { text: [fmtPctShort(bet.fairChance), sub].filter(Boolean).join(' · ') })]),
    el('button', {
      class: `entry-odds ${inSlip ? 'in-slip' : ''}`,
      type: 'button',
      'aria-pressed': String(inSlip),
      'aria-label': `${bet.label} ${fmtOdds(effectiveOdds(bet))} · ${locked ? t(`lock_${bet.lock}`) : inSlip ? t('removeLeg') : t('addLeg')}`,
      disabled: locked ? true : null,
      onclick: locked ? null : () => toggleLeg(bet)
    }, [locked ? el('span', { class: 'lock', 'aria-hidden': 'true', text: '🔒' }) : document.createTextNode(fmtOdds(effectiveOdds(bet))), !locked && bet.minLegs > 1 ? el('small', { class: 'min-legs', text: t('minLegsTag', { n: bet.minLegs }) }) : null])
  ]);
}

function board({ emblem, title, sub, bets, rows, id, notes = [], shown = Infinity }) {
  const t = state.t;
  const entries = bets.map((b, i) => rows(b, i));
  const rest = entries.slice(shown);
  return el('article', { class: 'board' }, [
    el('div', { class: 'board-head' }, [
      el('span', { class: 'board-emblem' }, leagueImg(emblem)),
      el('div', {}, [el('p', { class: 'board-title', text: title }), el('p', { class: 'board-sub', text: sub })])
    ]),
    el('div', { class: 'entries' }, entries.slice(0, shown)),
    rest.length ? el('details', { class: 'board-more' }, [el('summary', { text: t('futureMore', { n: rest.length }) }), el('div', { class: 'entries' }, rest)]) : null,
    notes.length ? el('div', { class: 'board-foot' }, [el('details', { class: 'info' }, [el('summary', { text: t('notesTitle') }), ...notes.map(text => el('p', { text }))])]) : null
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
      if (bets[0].errKey === 'futureOther') notes.push(t('futureOtherNote'));
      return board({
        emblem: sport,
        title: matchup,
        sub: `${t('futureSettles')} ${t(`futureSettle_${market}`)}`,
        bets,
        id: `fut|${market}`,
        notes,
        shown: FUTURES_SHOWN,
        rows: (b, i) => entryRow(b, i, market === 'f1drivers' ? driverBadge({ driverEn: b.teamEn, driver: f1Driver(b.teamEn) }) : logoImg(b.sport, b.teamEn, b.shortLabel))
      });
    })
  );
}

// ---- Bet slip -----------------------------------------------------------------

function toggleLeg(bet) {
  if (bet.lock && !state.parlay.includes(bet.id)) return;
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

// A number with its label.
function statTile(label, value, extraClass = '', icon = null) {
  return el('div', { class: `stat ${icon ? 'has-icon' : ''}` }, [
    icon ? el('span', { class: 'stat-icon', 'aria-hidden': 'true', text: icon }) : null,
    el('p', { class: `stat-value ${extraClass}`, text: value }),
    el('p', { class: 'stat-label', text: label })
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
function slipAnalysisView(a, legs, extra) {
  const t = state.t;
  const money = v => fmtMoney(v, { sign: false });
  const n = legs.length;
  const cards = [];
  cards.push(gradeCard(a));

  // Key numbers.
  cards.push(
    el('div', { class: 'card' }, [
      el('div', { class: 'kpis' }, [
        statTile(t('slipCost'), money(a.cost), '', '💵'),
        statTile(t('slipBest'), money(a.top.net), 'back-high', '🏆'),
        statTile(t('slipExpected'), money(a.expectedNet), a.backPer100 < 100 ? 'back-low' : 'back-high', '⚖️'),
        statTile(t('slipProfit'), fmtChance(a.profit), a.profit < 0.5 ? 'back-low' : '', '📈')
      ])
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
              el('strong', { class: backClass(info.value), text: money(info.value) })
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
          statTile(t('drawOpened'), fmtCount(d.n), '', '🎫'),
          statTile(t('drawWins'), `${fmtCount(d.wins)} (${fmtShare(d.wins / d.n)})`, '', '🎯'),
          statTile(t('drawNet'), fmtMoney(net), net < 0 ? 'back-low' : 'back-high', '💵'),
          statTile(t('drawBest'), d.best > 0 ? money(d.best) : '—', '', '🏆')
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
  const slip = legs.map(b => ({ gameId: b.gameId, odds: effectiveOdds(b), fairChance: b.fairChance, minLegs: b.minLegs ?? 1, lock: b.lock ?? null }));
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
    type: 'text',
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
  attachPad(stakeInput, { digits: 5, label: t('slipStake') });
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
    ticket.push(el('ul', { class: 'slip-errors' }, errors.map(e => el('li', { text: t(`slipError_${e}`, { max: SLIP_RULES.maxLegs, min: fmtMoney(SLIP_RULES.minTicket, { sign: false }), maxTicket: fmtMoney(SLIP_RULES.maxTicket, { sign: false }), unit: SLIP_RULES.unit, need: minLegsProblem(slip, sizes) }) }))));
  }
  const cost = sizes.reduce((sum, k) => sum + choose(n, k), 0) * stake;
  if (sizes.length && !errors.includes('stakeUnit')) ticket.push(payoutBox(slip, sizes, stake, mode));
  ticket.push(placeButton(legs, sizes, cost, errors));
  ticket.push(el('details', { class: 'info' }, [el('summary', { text: t('slipRulesTitle') }), el('p', { text: t('slipRulesNote') })]));

  let results = [];
  if (sizes.length && !errors.includes('stakeUnit')) {
    const a = analyzeSlip({ legs: slip, sizes, stake });
    results = slipAnalysisView(a, legs, {
      // A new ticket starts a new tally of draws.
      sig: JSON.stringify([slip, sizes, stake])
    });
  }
  body.replaceChildren(el('div', { class: 'slip has-legs' }, [el('div', { class: 'card ticket' }, ticket), el('div', { class: 'slip-results' }, results)]));
}

// ---- Slip: what each pick is, what the ticket pays ------------------------------

// A kind of bet's name (its board section's).
function kindKey(kind) {
  const sec = SECTIONS.find(x => x.kind === kind);
  return { f1: 'f1Title', f1podium: 'f1PodiumShort', future: 'futuresTitle' }[kind] ?? sec?.short ?? sec?.title ?? null;
}

// The market a pick is from, as a small tag: 不讓分, 大小分, 讓分 …
function marketTag(kind) {
  const key = { inning: 'topInningShort', f1: 'f1Short' }[kind] ?? kindKey(kind);
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

// The logo of the team a pick is on (saved with the pick, so history shows
// it whatever the board holds later), or null for picks on no one team.
function legLogo(bet) {
  if (bet.kind === 'future') return teamLogo(bet.sport, bet.teamEn);
  const side = bet.kind === 'teamtotal' ? bet.team : bet.settle?.team ?? (['away', 'home'].includes(bet.side) ? bet.side : null);
  return side && bet.game ? teamLogo(bet.sport, bet.game[side].en) : null;
}

// A saved pick's picture: its team's logo, the driver's badge, or the league's logo.
function legIcon(leg) {
  if ((leg.kind === 'f1' || leg.kind === 'f1podium') && leg.driver) {
    const driver = f1Driver(leg.driver);
    return driverBadge({ driverEn: leg.driver, driver }, 'logo-sm');
  }
  if (leg.logo) {
    const fallback = () => leagueImg(leg.sport, 'logo-sm');
    return logoPicture(leg.logo, leg.logo.includes('/500/') ? leg.logo.replace('/500/', '/500-dark/') : null, 'logo logo-sm', fallback);
  }
  const side = leg.kind === 'teamtotal' ? leg.team : ['away', 'home'].includes(leg.side) ? leg.side : null;
  const url = side && leg[side] ? teamLogo(leg.sport, leg[side]) : null;
  if (url) return logoPicture(url, teamLogo(leg.sport, leg[side], true), 'logo logo-sm', () => leagueImg(leg.sport, 'logo-sm'));
  return leagueImg(leg.sport, 'logo-sm');
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
    inning: bet.inning ?? null,
    away: bet.game?.away.en ?? null,
    home: bet.game?.home.en ?? null,
    driver: bet.driverEn ?? null,
    eventSlug: bet.eventSlug ?? null,
    live: bet.live ? true : undefined,
    kambiId: bet.game?.kambiId ?? undefined,
    ...(bet.settle ?? {}),
    team: bet.kind === 'future' ? bet.teamEn : bet.settle?.team ?? bet.team ?? null,
    logo: legLogo(bet)
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
  // Money that didn't come from betting: the weekly grants and mini games.
  const grants = account.ledger.filter(e => e.kind === 'grant' || e.kind === 'game').reduce((s, e) => s + e.amount, 0);
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
  renderArcade();
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
          legIcon(leg),
          legMain(leg),
          el('span', { class: 'leg-odds' }, [el('small', { text: '@' }), document.createTextNode(fmtOdds(leg.odds))]),
          needsHandSettle(leg, now) ? handSettle(slip, k) : null
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

// Sports with no automatic result (only Kambi's odds, and the live score
// didn't show the end): a few hours after the start, the pick can be settled
// by hand. Anything left after 3 days is refunded, as the lottery does with
// a result it can't confirm.
const HAND_SETTLE_AFTER_MS = 3 * 3_600_000;
function needsHandSettle(leg, now) {
  const league = LEAGUES[leg.sport];
  return !leg.result && league?.kambi && !league.results && leg.start && now - Date.parse(leg.start) > HAND_SETTLE_AFTER_MS;
}

function handSettle(slip, k) {
  const t = state.t;
  const settle = result => {
    const results = slip.legs.map((leg, i) => (i === k ? result : leg.result ?? null));
    const next = applyResults(state.account, slip.id, results);
    if (next.slips.find(s => s.id === slip.id).status === 'settled') state.freshSlips.add(slip.id);
    commitAccount(next);
    renderSaved();
  };
  return el('span', { class: 'hand-settle', role: 'group', 'aria-label': t('handSettle') }, [
    el('small', { class: 'muted', text: t('handSettle') }),
    ...['won', 'lost', 'void'].map(result => el('button', { class: 'ghost-button tiny', type: 'button', text: t(`handSettle_${result}`), onclick: () => settle(result) }))
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
  const kindName = k => (kindKey(k) ? t(kindKey(k)) : k);
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

// One person's betting in numbers (profile.mjs), the same card for you and
// for anyone in the simulated crowd: what they bought, how it went, their
// streaks and best and worst moments, and the traits their tickets show.
function profileCard(p, { weekLabel = w => state.t('simWeekN', { n: fmtCount(w + 1) }) } = {}) {
  const t = state.t;
  if (!p) return null;
  const money = v => fmtMoney(v, { sign: false });
  const line = (label, value, cls = '', note = null) => el('div', { class: 'player-line' }, [el('span', { text: label }), el('strong', { class: cls, text: value }), note ? el('small', { text: note }) : null]);
  return el('div', { class: 'profile' }, [
    el('div', { class: 'player-lines' }, [
      line(t('profTickets'), t('profTicketsV', { n: fmtCount(p.tickets), won: fmtCount(p.won) }), '', t('profHit', { v: fmtShare(p.hitRate) })),
      line(t('profBack'), p.back == null ? '–' : money(p.back), p.back != null && p.back < 100 ? 'back-low' : 'back-high', t('profPer100')),
      line(t('profStake'), money(p.avgStake), '', t('profMaxStake', { v: money(p.maxStake) })),
      line(t('profLegs'), p.avgLegs.toFixed(1), '', t('profSingles', { v: fmtShare(p.singleShare) })),
      line(t('profOdds'), `×${fmtOdds(p.avgOdds)}`, '', t('profChance', { v: fmtPctShort(p.avgChance) })),
      line(t('profBigWin'), p.biggestWin ? fmtMoney(p.biggestWin.net) : t('playerNoWin'), p.biggestWin ? 'back-high' : '', p.biggestWin ? t('profBigWinNote', { odds: fmtOdds(p.biggestWin.odds), legs: p.biggestWin.legs, week: weekLabel(p.biggestWin.w) }) : null),
      line(t('profStreaks'), t('profStreaksV', { won: fmtCount(p.longestWin), lost: fmtCount(p.longestLose) })),
      line(t('profNearMiss'), t('timesN', { n: fmtCount(p.nearMisses) })),
      p.bestWeek ? line(t('profBestWeek'), fmtMoney(p.bestWeek.net), 'back-high', weekLabel(p.bestWeek.w)) : null,
      p.worstWeek ? line(t('profWorstWeek'), fmtMoney(p.worstWeek.net), 'back-low', weekLabel(p.worstWeek.w)) : null,
      line(t('profPace'), t('profPaceV', { n: p.perWeek.toFixed(1) }), '', t('profWeeksPlayed', { n: fmtCount(p.weeksPlayed), of: fmtCount(p.weeks) }))
    ]),
    p.traits.length ? el('div', { class: 'player-tags' }, [el('small', { class: 'muted', text: t('profSeen') }), ...p.traits.map(key => el('span', { class: 'habit-tag trait-tag', title: t(`traitDesc_${key}`), text: `${TRAIT_ICON[key]} ${t(`trait_${key}`)}` }))]) : null
  ]);
}

// Your betting in the same numbers as the crowd's people.
function youCard() {
  const t = state.t;
  const p = ticketProfile(accountTickets(state.account));
  if (!p) return null;
  const first = state.account.slips.filter(s => s.status === 'settled').map(s => s.t).sort()[0];
  const weekLabel = w => fmtTime(new Date(Date.parse(first) + w * 7 * 86_400_000).toISOString()).split(' ')[0];
  return el('div', { class: 'card' }, [el('h3', { class: 'card-title', text: t('youProfileTitle') }), profileCard(p, { weekLabel })]);
}

// The account against the simulated crowd, over the same length of time.
// The crowd is simulated only here or on the simulator tab, never at start-up.
function crowdCard(s) {
  const t = state.t;
  const slips = state.account.slips;
  if (!slips.length || !state.data) return null;
  const firstMs = Math.min(...slips.map(x => Date.parse(x.t)));
  const accountWeeks = Math.max(1, (Date.now() - firstMs) / (7 * 86_400_000));
  const months = PERIOD_MONTHS.find(m => m >= Math.min(60, Math.ceil((accountWeeks * 12) / 52))) ?? 60;
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
  const profile = ticketProfile(accountTickets(state.account));
  const perPerson = { tickets: crowd.totals.tickets / crowd.players, staked: crowd.totals.staked / crowd.players };
  const rows = [
    [t('crowdColNet'), fmtMoney(mine), fmtMoney(quantile(crowd.finalQuantiles, 0.5))],
    [t('crowdColBack'), s.settled ? fmtBack(s.back) : '–', fmtBack(crowdBack)],
    [t('crowdColSlips'), fmtInt(s.placed), fmtCount(perPerson.tickets)],
    [t('crowdColStaked'), fmtMoney(slips.reduce((x, y) => x + y.cost, 0), { sign: false }), fmtMoney(perPerson.staked, { sign: false })],
    [t('crowdColLegs'), profile ? profile.avgLegs.toFixed(1) : '–', crowd.crowd.avgLegs ? crowd.crowd.avgLegs.toFixed(1) : '–']
  ];
  // People in the crowd with the traits your tickets show.
  const like = (profile?.traits ?? []).map(key => crowd.traitSummaries.find(x => x.trait.key === key)).filter(Boolean);
  return el('div', { class: 'card crowd-card' }, [
    title,
    el('div', { class: 'crowd-hero' }, [
      el('strong', { text: fmtPctShort(beat) }),
      el('span', { text: t('crowdBeat', { n: fmtCount(SIM_PLAYERS_SHOWN), period: periodName(weeks) }) })
    ]),
    el('div', { class: 'crowd-bar', role: 'img', 'aria-label': t('crowdBeat', { n: fmtCount(SIM_PLAYERS_SHOWN), period: periodName(weeks) }) }, [el('span', { class: 'crowd-you', style: `left:${(beat * 100).toFixed(1)}%` })]),
    el('p', { class: 'crowd-scale muted' }, [el('span', { text: t('crowdWorst') }), el('span', { text: t('crowdBest') })]),
    table([t('crowdColWhat'), t('crowdColYou'), t('crowdColCrowd')], rows),
    like.length
      ? el('ul', { class: 'facts crowd-like-list' }, like.map(x => el('li', {}, [el('span', { class: 'crowd-like-icon', 'aria-hidden': 'true', text: TRAIT_ICON[x.trait.key] }), document.createTextNode(t('crowdLikeTrait', { trait: t(`trait_${x.trait.key}`), ahead: fmtPctShort(x.aheadShare), final: fmtMoney(x.avgFinal), period: periodName(weeks) }))])))
      : null,
    el('ul', { class: 'facts' }, [
      el('li', { text: t('crowdAhead', { share: fmtPctShort(crowd.totals.aheadShare), period: periodName(weeks) }) }),
      el('li', { text: t('crowdNote', { weeks: fmtCount(Math.max(1, Math.round(accountWeeks))) }) })
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
  cards.push(youCard(), crowdCard(s), funCard());
  if (s.settled) cards.push(el('div', { class: 'two-col' }, [luckCard(s), recordsCard(s)]), picksCard(s), breakdownCard(s), weeksCard(s));
  else cards.push(el('p', { class: 'muted', text: t('statsWait') }));
  $('stats-body').replaceChildren(...cards.filter(Boolean));
}

// ---- Simulator ----------------------------------------------------------------

// What the crowd bets on, per sport: this board's options as they are (the
// same options you see, by board.mjs), or a typical week (made-up games run
// through the same code) for a sport with nothing on today. Every sport is
// simulated, whatever the sport filter shows. A sport whose pool returns
// clearly more or less than the rest is flagged (audit.mjs).
function simSportBets() {
  if (state.simBets?.bets === state.bets) return state.simBets.pools;
  const pools = Object.fromEntries(
    SPORTS.map(sport => {
      const bets = crowdPool(state.bets.filter(b => b.sport === sport), effectiveOdds);
      const games = new Set(bets.map(b => b.gameId)).size;
      return [sport, games >= (SIM_SPORTS[sport].family === 'racing' ? 1 : 2) ? bets : sportTemplate(sport)];
    })
  );
  const flagged = auditPools(pools);
  if (flagged.length) console.warn('Simulator pools out of line with the rest:', flagged);
  state.simBets = { bets: state.bets, pools };
  return pools;
}

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

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

// A short key for a pool and period (the pool itself is large).
const poolKeys = new WeakMap();
function crowdKey(sportBets, weeks) {
  if (!poolKeys.has(sportBets)) poolKeys.set(sportBets, String(hashString(JSON.stringify(sportBets))));
  return `${weeks}|${poolKeys.get(sportBets)}`;
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
    const sportPools = Object.fromEntries(Object.entries(sportBets).map(([sport, bets]) => [sport, crowdPools(bets)]));
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
  const { bands, totals } = stats;
  const characters = CHARACTERS.map(c => ({ ...c, player: stats.characters[c.key] }));

  renderSimHeadline(totals, period);
  const back = totals.staked > 0 ? ((totals.staked + totals.net) / totals.staked) * 100 : 100;
  $('sim-stats').replaceChildren(
    statTile(t('simMedian'), fmtMoney(bands.at(-1).q50), bands.at(-1).q50 < 0 ? 'back-low' : '', '🧍'),
    statTile(t('simBackPer100'), fmtMoney(back, { sign: false }), back < 100 ? 'back-low' : '', '💸'),
    statTile(t('simEverAhead'), fmtShare(totals.everAheadShare), '', '📈'),
    statTile(t('simAhead'), fmtShare(totals.aheadShare), totals.aheadShare < 0.5 ? 'back-low' : '', '🏁')
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
  renderGroups(stats);
  renderFacts(stats, totals, characters, period);
  renderFlow(stats, period);
  renderStories(stats, period);
  renderSurplus(stats, period);
  renderLeaders(stats);
  state.simStats = stats;
  const unfair = auditCrowd(stats);
  if (unfair.length) console.warn('Series whose followers are out of line with the crowd:', unfair);
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
    })
  );
}

// A person's tale in one line.
function taleOf(p) {
  const t = state.t;
  if (p.final > 0) return t('taleAheadTraits');
  if (!p.everAhead) return t('taleNever');
  return t('taleGaveBack', { peak: fmtMoney(p.peak, { sign: false }), at: fmtCount(p.peakWeek + 1) });
}

// The series a simulated person bets on, as a stack of small labels (league
// logo and name); a long stack shows its first few and how many more.
const fanByKey = key => (typeof key === 'string' ? FANS.find(f => f.key === key) : key) ?? null;
function seriesTags(fanKey, max = 3) {
  const t = state.t;
  const fan = fanByKey(fanKey);
  if (!fan) return [];
  const series = fanSeries(fan);
  if (!series.length) return [el('span', { class: 'series-tag', text: `🌐 ${t('fanEverything')}` })];
  return [
    ...series.slice(0, max).map(sp => el('span', { class: 'series-tag' }, [leagueImg(sp, 'logo-xxs'), document.createTextNode(t(`sport_${sp}`))])),
    series.length > max ? el('span', { class: 'series-tag more', text: `+${series.length - max}` }) : null
  ];
}
// The same as plain text: "MLB · NBA", "英超 +12", "全部".
function followText(fanKey, max = 2) {
  const t = state.t;
  const fan = fanByKey(fanKey);
  if (!fan) return '';
  const series = fanSeries(fan);
  if (!series.length) return t('fanEverything');
  return series.slice(0, max).map(sp => t(`sport_${sp}`)).join('·') + (series.length > max ? ` +${series.length - max}` : '');
}

// Who a simulated person is: the series they bet on and their traits.
function personTags(p) {
  return [el('span', { class: 'series-stack' }, seriesTags(p.fan)), ...traitTags(p)];
}

function renderPlayers(characters) {
  const t = state.t;
  $('sim-players').replaceChildren(
    ...characters.map(({ name, rank, color, icon, player: p }) =>
      el('article', { class: 'player', style: `--player:${color}` }, [
        el('div', { class: 'player-head' }, [
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: icon }),
          el('div', {}, [el('p', { class: 'player-name', text: t(name) }), el('p', { class: 'player-rank', text: t(rank) })])
        ]),
        el('p', { class: `player-final ${p.final < 0 ? 'back-low' : 'back-high'}`, text: fmtMoney(p.final) }),
        el('p', { class: 'player-tale', text: taleOf(p) }),
        el('div', { class: 'player-tags' }, personTags(p))
      ])
    )
  );
}

// One row per group: avatar, name, bar to break-even, average back per NT$100.
function barItem({ icon, name, desc, back, margin, meta, scaleMax }) {
  return el('li', { class: 'bar-item', title: desc }, [
    icon,
    el('span', { class: 'bar-name', text: name }),
    el('span', { class: `rank-value ${backClass(back)}`, text: fmtMoney(back, { sign: false }) }),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
      el('div', { class: 'bar', style: `width:${(back / scaleMax) * 100}%` }),
      el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
    ]),
    el('span', { class: 'habit-meta', text: meta })
  ]);
}

// Every trait's icon; people with no trait of a kind for comparison.
const TRAIT_ICON = {
  favorite: '📣', underdog: '🎯', value: '🧮', exotic: '🎲', single: '1️⃣', parlay: '🎰', whale: '🐋', small: '🪙', daily: '📅', rare: '🌙',
  tilt: '🔥', chaser: '🔁', cashOut: '💰', streaky: '🍀', pressOn: '🚀', revenge: '😤', heartbroken: '💔', soClose: '😣', jackpot: '🌠',
  rider: '⛄', guardian: '🛡️', stopLoss: '🛑', content: '😊', moody: '🎭', bored: '🥱', hailMary: '🙏', loyal: '❤️', hopper: '🦘', plainStyle: '😐', plainReact: '😐'
};

// The crowd three ways, one tab each: how people bet (the traits of pick,
// picks per ticket, stake and pace), their reactions, and what they bet on.
// Ranked by the average result: traits change how much people stake, so
// money back per NT$100 alone would hide the big losers.
const GROUP_TABS = ['style', 'react', 'fan'];
function renderGroups(stats) {
  const t = state.t;
  const tab = GROUP_TABS.includes(state.groupTab) ? state.groupTab : 'style';
  let rows;
  if (tab === 'fan') {
    // Everyone who bets on a series, whatever else they bet on.
    rows = (stats.seriesSummaries ?? []).map(f => ({ icon: leagueImg(f.series, 'logo-sm'), name: t(`sport_${f.series}`), desc: t('seriesDesc', { n: fmtCount(f.players * (SIM_PLAYERS_SHOWN / stats.players)), only: fmtCount(f.only.players * (SIM_PLAYERS_SHOWN / stats.players)) }), x: f, meta: t('fanMeta', { ahead: fmtShare(f.aheadShare), tickets: fmtCount(f.avgTickets), final: fmtMoney(f.avgFinal) }) }));
  } else {
    const groupOf = key => TRAITS.find(x => x.key === key)?.group ?? null;
    rows = stats.traitSummaries
      .filter(x => (tab === 'style' ? x.trait.key === 'plainStyle' || groupOf(x.trait.key) : x.trait.key === 'plainReact' || (!groupOf(x.trait.key) && x.trait.key !== 'plainStyle')))
      .map(x => ({ icon: badge(TRAIT_ICON[x.trait.key], 'var(--accent)', 'emoji'), name: t(`trait_${x.trait.key}`), desc: t(`traitDesc_${x.trait.key}`), x, meta: t('traitMeta', { share: fmtShare(x.share), ahead: fmtShare(x.aheadShare), final: fmtMoney(x.avgFinal) }) + (x.quitShare >= 0.05 ? ` · ${t('traitQuit', { v: fmtShare(x.quitShare) })}` : '') }));
  }
  rows.sort((a, b) => b.x.avgFinal - a.x.avgFinal);
  const scaleMax = Math.max(100, ...rows.map(r => r.x.back)) * 1.04;
  $('sim-group-tabs').replaceChildren(
    ...GROUP_TABS.map(key =>
      el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(key === tab),
        'aria-pressed': String(key === tab),
        text: t(`groupTab_${key}`),
        onclick: () => {
          state.groupTab = key;
          renderGroups(stats);
        }
      })
    )
  );
  $('sim-group-note').textContent = t(`groupNote_${tab}`);
  $('sim-groups').replaceChildren(...rows.map(r => barItem({ icon: r.icon, name: r.name, desc: r.desc, back: r.x.back, margin: r.x.backMargin, scaleMax, meta: r.meta })));
}

// A person's trait tags.
function traitTags(p) {
  return traitKeys(p.traits ?? 0).map(key => el('span', { class: 'habit-tag trait-tag', title: state.t(`traitDesc_${key}`), text: `${TRAIT_ICON[key]} ${state.t(`trait_${key}`)}` }));
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

// Where the crowd's money went: every NT$ a winner took home came out of what
// losers lost; the lottery kept its take and the government the tax. Weeks
// the lottery paid out more than it took in are counted too.
function renderFlow(stats, period) {
  const t = state.t;
  const f = stats.flow;
  if (!f) return;
  const money = v => fmtMoney(v, { sign: false });
  const n = v => fmtCount(v);
  const bar = [
    { key: 'winners', v: f.winnersWon, color: 'var(--good)' },
    { key: 'house', v: Math.max(0, f.take), color: 'var(--bad)' },
    { key: 'tax', v: f.tax, color: 'var(--gold)' }
  ];
  const total = bar.reduce((s, x) => s + x.v, 0) || 1;
  $('sim-flow').replaceChildren(
    el('p', { class: 'flow-equation' }, [
      el('span', { text: t('flowLosers') }),
      el('strong', { class: 'back-low', text: money(f.losersLost) }),
      el('span', { text: '=' }),
      el('span', { text: t('flowWinners') }),
      el('strong', { class: 'back-high', text: money(f.winnersWon) }),
      el('span', { text: '+' }),
      el('span', { text: t('flowHouse') }),
      el('strong', { text: money(f.take) }),
      el('span', { text: '+' }),
      el('span', { text: t('flowTax') }),
      el('strong', { text: money(f.tax) })
    ]),
    el('div', { class: 'flow-bar', role: 'img', 'aria-label': t('flowTitle') }, bar.map(x => el('span', { style: `width:${((x.v / total) * 100).toFixed(2)}%;background:${x.color}`, title: t(`flowPart_${x.key}`) }))),
    el('p', { class: 'legend' }, bar.map(x => el('span', {}, [el('span', { class: 'legend-key dot', style: `background:${x.color}` }), document.createTextNode(`${t(`flowPart_${x.key}`)} ${fmtShare(x.v / total)}`)]))),
    el('ul', { class: 'facts' }, [
      el('li', { text: t('flowWinnersDetail', { n: n(f.winners * (SIM_PLAYERS_SHOWN / stats.players)), period, paid: money(f.winnersPaid), lost: money(f.winnersLost), net: money(f.winnersWon) }) }),
      el('li', { text: f.houseLossWeeks ? t('flowHouseLost', { k: f.houseLossWeeks, weeks: f.weeks, worst: money(f.houseWorstWeek.loss) }) : t('flowHouseNever', { weeks: f.weeks }) }),
      el('li', { text: t('flowStaked', { staked: money(f.staked), paid: money(f.paid), back: fmtInt(Math.round((f.paid / f.staked) * 100)) }) })
    ])
  );
}

function renderFacts(stats, totals, characters, period) {
  const t = state.t;
  const money = v => fmtMoney(v, { sign: false });
  const facts = [];
  const by = key => stats.traitSummaries.find(x => x.trait.key === key);
  // Everyone plays by the practice account's rules.
  const grants = SIM_WEEKLY_GRANT * Math.max(0, stats.weeks - 1);
  facts.push(factItem(t('factBankroll', { period }), { cash: money(SIM_START_BALANCE + grants + totals.net / stats.players), grants: money(grants), short: fmtShare(stats.crowd.shortShare) }, t('factBankrollWhy', { start: money(SIM_START_BALANCE), grant: money(SIM_WEEKLY_GRANT), spend: money(totals.staked / stats.players / Math.max(1, stats.weeks)) })));
  facts.push(factItem(t('factParlay'), { a: money(by('single').back), b: money(by('parlay').back) }, t('factParlayWhy')));
  if (totals.everAheadShare > totals.aheadShare) facts.push(factItem(t('factEverAhead'), { a: fmtShare(totals.everAheadShare), b: fmtShare(totals.aheadShare) }, t('factEverAheadWhy')));
  const chaser = by('chaser');
  const none = by('plainReact');
  if (chaser && none) facts.push(factItem(t('factChaser'), { a: fmtMoney(chaser.avgFinal), b: fmtMoney(none.avgFinal) }, t('factChaserWhy', { staked: money(chaser.avgStaked), plain: money(none.avgStaked) })));
  if (stats.crowd.avgLegs) facts.push(factItem(t('factMix'), { legs: stats.crowd.avgLegs.toFixed(1), singles: fmtShare(stats.crowd.singleShare) }, t('factMixWhy')));
  if (stats.crowd.nearMisses) facts.push(factItem(t('factNearMiss'), { v: fmtCount(stats.crowd.nearMisses * (SIM_PLAYERS_SHOWN / stats.players)) }, t('factNearMissWhy')));
  const lucky = characters[0].player;
  if (lucky.biggestWin > 0) facts.push(factItem(t('factLucky'), { v: fmtCount(lucky.longestLosing) }, t('factLuckyWhy', { win: money(lucky.biggestWin) })));
  const avgLoss = -totals.net / SIM_PLAYERS;
  if (avgLoss > 0) {
    const hours = (avgLoss / ARCADE.minWage).toLocaleString(numberLocale(), { maximumFractionDigits: avgLoss < 10 * ARCADE.minWage ? 1 : 0 });
    facts.push(factItem(t('factWage', { period }), { loss: money(avgLoss), v: hours }, t('factWageWhy', { wage: ARCADE.minWage })));
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
    for (const sport of SPORTS.filter(sp => SIM_SPORTS[sp].headline)) {
      const now = games(sport, w);
      const before = games(sport, w - 1);
      const name = t(`sport_${sport}`);
      // F1 has a championship (賽季), not a league season (球季).
      const f1 = SIM_SPORTS[sport].family === 'racing' ? 'F1' : '';
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

// How the people with one trait who bet on one series did.
function renderYou() {
  const t = state.t;
  const stats = state.simStats;
  if (!stats?.groupStats) return;
  const traitSelect = $('you-trait');
  const fanSelect = $('you-fan');
  if (!traitSelect.options.length || traitSelect.dataset.locale !== state.locale) {
    traitSelect.replaceChildren(...TRAIT_ROWS.map(x => el('option', { value: x.key, text: `${TRAIT_ICON[x.key]} ${t(`trait_${x.key}`)}` })));
    fanSelect.replaceChildren(...(stats.seriesSummaries ?? []).map(f => el('option', { value: f.series, text: t(`sport_${f.series}`) })));
    traitSelect.value = state.youTrait ?? 'parlay';
    fanSelect.value = state.youFan ?? 'mlb';
    traitSelect.dataset.locale = state.locale;
  }
  const g = stats.groupStats.find(x => x.trait === traitSelect.value && x.series === fanSelect.value);
  if (!g || !g.players) return $('you-result').replaceChildren(el('p', { class: 'muted', text: t('youNone') }));
  const money = v => fmtMoney(v, { sign: false });
  const period = periodName(stats.weeks);
  $('you-result').replaceChildren(
    el('p', { class: 'you-headline' }, [
      document.createTextNode(t('youAheadPre', { n: fmtCount(g.players * (SIM_PLAYERS_SHOWN / stats.players)), period })),
      el('strong', { class: g.aheadShare >= 0.5 ? 'back-high' : 'back-low', text: fmtShare(g.aheadShare) }),
      document.createTextNode(t('youAheadPost'))
    ]),
    el('div', { class: 'kpis' }, [
      statTile(t('youAvg'), fmtMoney(g.avgFinal), g.avgFinal < 0 ? 'back-low' : 'back-high', '🧍'),
      statTile(t('simBackPer100'), money(g.back), g.back < 100 ? 'back-low' : '', '💸'),
      statTile(t('youTickets'), fmtCount(g.avgTickets), '', '🎫'),
      statTile(t('youStaked'), money(g.avgStaked), '', '💰')
    ]),
    el('p', { class: 'fact-why', text: t(`traitDesc_${traitSelect.value}`) }),
    g.avgFinal < 0 ? el('p', { class: 'fact-why', text: t('youBoba', { cups: fmtCount(-g.avgFinal / BOBA_PRICE) }) }) : null
  );
}

function rangePos(v, lo, hi) {
  return hi > lo ? Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)) : 50;
}

$('you-trait').addEventListener('change', event => ((state.youTrait = event.target.value), renderYou()));
$('you-fan').addEventListener('change', event => ((state.youFan = event.target.value), renderYou()));

// Replays one person of the crowd, by number, on this device (one person is
// quick): their season, a small chart of it, their story and their betting
// in the same numbers as yours (profile.mjs).
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
  const sportPools = Object.fromEntries(Object.entries(sportBets).map(([sport, bets]) => [sport, crowdPools(bets)]));
  const p = replayPlayer({ sportPools, startWeek: weekOfYear(new Date()), weeks: stats.weeks, perGroup: PER_GROUP, seed: SIM_SEED, index: n - 1 });
  if (!p) return;
  // 百分位 (PR): the share of the crowd this person finished ahead of.
  const qs = stats.finalQuantiles;
  const pr = qs ? Math.max(1, Math.min(99, Math.floor((qs.filter(v => v < p.final).length / qs.length) * 100))) : null;
  const profile = ticketProfile(p.log, { weeks: stats.weeks });
  $('lookup-result').replaceChildren(
    el('div', { class: 'lookup-card' }, [
      el('div', { class: 'story-head' }, [
        el('span', { class: 'story-icon', 'aria-hidden': 'true', text: p.final > 0 ? '😎' : p.everAhead ? '😬' : '😶' }),
        el('div', {}, [
          el('p', { class: 'story-serial' }, [
            document.createTextNode(`#${fmtCount(n)}`),
            pr ? el('span', { class: 'serial-pr', text: t('playerPR', { n: pr }) }) : null,
            p.final > 0 && stats.surplus?.total > 0 ? el('span', { class: 'serial-pr share', text: t('playerSurplus', { v: fmtChance(p.final / stats.surplus.total) }) }) : null
          ]),
          el('div', { class: 'player-tags' }, personTags(p))
        ])
      ]),
      el('p', { class: `story-big ${p.final < 0 ? 'back-low' : 'back-high'}`, text: fmtMoney(p.final) }),
      sparkline(p.path),
      el('p', { class: 'story-text', text: taleOf(p) }),
      profile ? profileCard(profile) : el('p', { class: 'muted', text: t('lookupNoTickets') })
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

attachPad($('lookup-number'), { digits: 6, onEnter: () => $('lookup-form').requestSubmit() });
$('lookup-form').addEventListener('submit', event => {
  event.preventDefault();
  const n = Number($('lookup-number').value);
  if (n >= 1) renderLookup(n);
});
$('lookup-random').addEventListener('click', () => {
  const total = state.simStats?.players ?? SIM_PLAYERS;
  renderLookup(1 + Math.floor(Math.random() * total));
});

// Everyone's winnings (results above zero) and who holds them: a bar from the
// single biggest winner to the rest of the winners, and how few hold half.
function renderSurplus(stats, period) {
  const t = state.t;
  const s = stats.surplus;
  if (!s || s.total <= 0) {
    $('sim-surplus').replaceChildren(el('p', { class: 'note', text: t('surplusNone', { period }) }));
    return;
  }
  const scale = SIM_PLAYERS_SHOWN / stats.players;
  const tenth = Math.round(stats.players / 1000);
  const pct = Math.round(stats.players / 100);
  const parts = [
    { label: t('surplusRank1'), v: s.top1, color: 'var(--gold)' },
    { label: t('surplusRanks', { a: 2, b: 10 }), v: s.top10 - s.top1, color: 'var(--good)' },
    { label: t('surplusRanks', { a: 11, b: fmtCount(tenth) }), v: s.topTenth - s.top10, color: 'color-mix(in srgb, var(--good) 65%, transparent)' },
    { label: t('surplusRanks', { a: fmtCount(tenth + 1), b: fmtCount(pct) }), v: s.topPct - s.topTenth, color: 'color-mix(in srgb, var(--good) 40%, transparent)' },
    { label: t('surplusRest', { n: fmtCount(Math.max(0, s.winners - pct) * scale) }), v: 1 - s.topPct, color: 'color-mix(in srgb, var(--text-muted) 35%, transparent)' }
  ].filter(x => x.v > 0.0005);
  const best = stats.leaders?.best?.[0];
  $('sim-surplus').replaceChildren(
    el('p', { class: 'surplus-total' }, [el('small', { text: t('surplusTotal', { period, n: fmtCount(s.winners * scale) }) }), el('strong', { class: 'back-high', text: fmtMoney(s.total * scale, { sign: false }) })]),
    el('div', { class: 'flow-bar surplus-bar', role: 'img', 'aria-label': t('surplusTitle') }, parts.map(x => el('span', { style: `width:${(x.v * 100).toFixed(2)}%;background:${x.color}`, title: `${x.label} ${fmtChance(x.v)}` }))),
    el('p', { class: 'legend' }, parts.map(x => el('span', {}, [el('span', { class: 'legend-key dot', style: `background:${x.color}` }), document.createTextNode(`${x.label} ${fmtChance(x.v)}`)]))),
    el('ul', { class: 'facts' }, [
      best ? el('li', { text: t('surplusOne', { serial: fmtCount(best.serial), won: fmtMoney(best.value, { sign: false }), share: fmtChance(s.top1) }) }) : null,
      el('li', { text: t('surplusHalf', { n: fmtCount(s.half * scale), winners: fmtCount(s.winners * scale) }) }),
      el('li', { text: t('surplusWhy') })
    ].filter(Boolean))
  );
}

// Top 10s: one board at a time, picked from a row of chips; tap a number to
// open that player below.
const LEADER_ICON = { best: '🏆', biggestWin: '🎯', longshot: '🦄', comeback: '🦸', bestWeek: '🚀', biggestParlay: '🧩', hotStreak: '🔥', mostTickets: '🧾', taxman: '🏛️', nearMisses: '😣', worst: '💸', fall: '🎢', worstWeek: '🌪️', drought: '🧊', broke: '🪫' };
function leaderValue(key, x) {
  const t = state.t;
  if (key === 'longshot') return `@ ${fmtOdds(x.value)}`;
  if (key === 'hotStreak') return t('inARowWon', { n: fmtCount(x.value) });
  if (key === 'drought') return t('inARow', { n: fmtCount(x.value) });
  if (key === 'mostTickets') return t('ticketsN', { n: fmtCount(x.value) });
  if (key === 'biggestParlay') return t('legsWon', { n: fmtCount(x.value) });
  if (key === 'nearMisses' || key === 'broke') return t('timesN', { n: fmtCount(x.value) });
  if (key === 'comeback') return `+${fmtMoney(x.value, { sign: false })}`;
  if (key === 'fall') return `${fmtMoney(x.value)} → ${fmtMoney(x.final)}`;
  if (key === 'taxman') return fmtMoney(x.value, { sign: false });
  return fmtMoney(x.value);
}

function renderLeaders(stats) {
  const t = state.t;
  const boards = Object.entries(stats.leaders ?? {}).filter(([, list]) => list.length);
  if (!boards.length) return $('sim-leaders').replaceChildren();
  const key = boards.some(([k]) => k === state.leaderKey) ? state.leaderKey : boards[0][0];
  const list = stats.leaders[key];
  const total = stats.surplus?.total ?? 0;
  const medals = ['🥇', '🥈', '🥉'];
  const bad = ['worst', 'fall', 'worstWeek', 'drought', 'taxman', 'nearMisses', 'broke'].includes(key);
  $('sim-leaders').replaceChildren(
    el('div', { class: 'segmented leader-tabs', role: 'tablist', 'aria-label': t('leadersTitle') },
      boards.map(([k]) =>
        el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': String(k === key),
          'aria-pressed': String(k === key),
          text: `${LEADER_ICON[k]} ${t(`lb_${k}`)}`,
          onclick: () => {
            state.leaderKey = k;
            renderLeaders(stats);
          }
        })
      )
    ),
    el('ol', { class: 'leaders' },
      list.map((x, i) =>
        el('li', { class: 'leader' }, [
          el('span', { class: 'leader-rank', text: medals[i] ?? String(i + 1) }),
          el('span', { class: 'leader-who' }, [
            el('button', {
              class: 'link-button leader-serial',
              type: 'button',
              title: t('lookupTitle'),
              text: `#${fmtCount(x.serial)}`,
              onclick: () => {
                renderLookup(x.serial);
                $('lookup-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }),
            el('small', { text: [x.fan && followText(x.fan), traitKeys(x.traits ?? 0).map(k => TRAIT_ICON[k]).join('')].filter(Boolean).join(' · ') })
          ]),
          el('span', { class: 'leader-value' }, [
            el('strong', { class: key === 'best' || key === 'biggestWin' ? 'back-high' : bad ? 'back-low' : '', text: leaderValue(key, x) }),
            key === 'best' && total > 0 ? el('small', { text: t('leaderShare', { v: fmtChance(x.value / total) }) }) : null
          ])
        ])
      )
    ),
    el('p', { class: 'note', text: t(`lbNote_${key}`) })
  );
}

// Record holders among the 100,000, by their number in the crowd: the key
// figure, who they are, then their story. Then the crowd-wide truths.
function renderStories(stats, period) {
  const t = state.t;
  const { notable, crowd } = stats;
  const money = v => fmtMoney(v, { sign: false });
  const stories = [];
  // `tone`: how the big figure reads (good, bad or neutral); money by its sign.
  const add = (icon, titleKey, p, big, textKey, vars, tone = null) =>
    p && stories.push({ icon, title: t(titleKey), serial: `#${fmtCount(p.serial)}`, index: p.serial - 1, big, tone: tone ?? (big.startsWith('−') ? 'back-low' : 'back-high'), tags: [p.fan && followText(p.fan, 3), ...traitKeys(p.traits ?? 0).map(key => `${TRAIT_ICON[key]} ${t(`trait_${key}`)}`)].filter(Boolean), text: t(textKey, { period, ...vars }) });
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
  if (worst) add('💸', 'storyWorstTitle', worst, fmtMoney(worst.final), 'storyWorst', { staked: money(worst.staked), max: money(worst.maxStake), hours: fmtCount(-worst.final / ARCADE.minWage) });
  const hot = notable.hotStreak;
  if (hot?.longestWinning > 1) add('🔥', 'storyHotTitle', hot, t('inARowWon', { n: fmtCount(hot.longestWinning) }), 'storyHot', { tickets: fmtCount(hot.tickets), won: fmtCount(hot.wonTickets), final: fmtMoney(hot.final) });
  const long = notable.longshot;
  if (long?.longshotOdds > 1) add('🦄', 'storyLongshotTitle', long, `@ ${fmtOdds(long.longshotOdds)}`, 'storyLongshot', { week: long.longshotWeek + 1, stake: money(long.longshotStake), win: fmtMoney(long.longshotWin) });
  const bad = notable.worstWeek;
  if (bad?.worstWeek < 0) add('🌪️', 'storyBadWeekTitle', bad, fmtMoney(bad.worstWeek), 'storyBadWeek', { week: bad.worstWeekAt + 1, final: fmtMoney(bad.final) });
  const busy = notable.mostTickets;
  if (busy) add('🧾', 'storyBusyTitle', busy, t('ticketsN', { n: fmtCount(busy.tickets) }), 'storyBusy', { perWeek: (busy.tickets / stats.weeks).toFixed(1), staked: money(busy.staked), final: fmtMoney(busy.final) }, 'neutral');
  const back = notable.comeback;
  if (back) add('🦸', 'storyComebackTitle', back, `${fmtMoney(back.trough)} → ${fmtMoney(back.final)}`, 'storyComeback', { week: back.troughWeek + 1, low: fmtMoney(back.trough), final: fmtMoney(back.final) }, 'back-high');
  const close = notable.nearMisses;
  if (close?.nearMisses > 0) add('😣', 'storyNearMissTitle', close, t('timesN', { n: fmtCount(close.nearMisses) }), 'storyNearMiss', { n: fmtCount(close.nearMisses), tickets: fmtCount(close.tickets), final: fmtMoney(close.final) }, 'back-low');
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

// ---- Number pad ----------------------------------------------------------------------

// Every number on the page is keyed on the page's own pad, like a game's
// controls, not the phone's keyboard: tapping the field opens a pad that
// slides up from the bottom (1-9, 0, delete, OK). A real keyboard still works
// in the field. On OK the field changes and `onEnter` runs.
function attachPad(input, { digits = 7, onEnter = null, label = '' } = {}) {
  input.readOnly = true;
  input.setAttribute('inputmode', 'none');
  input.classList.add('pad-field');
  const commit = value => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    onEnter?.(value);
  };
  const open = () => {
    if (document.querySelector('.pad-sheet')) return;
    const t = state.t;
    let value = input.value.replace(/\D/g, '');
    let fresh = true;
    const shown = el('p', { class: 'pad-value', 'aria-live': 'polite' });
    const draw = () => (shown.textContent = value || '0');
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      input.focus({ preventScroll: true });
    };
    const press = key => {
      if (key === 'enter') {
        close();
        return commit(value || '0');
      }
      if (key === 'back') value = fresh ? '' : value.slice(0, -1);
      // The first digit replaces the old number; the rest add to it.
      else if (fresh) value = key === '0' ? '' : key;
      else if (value.length < digits) value = (value + key).replace(/^0+/, '');
      fresh = false;
      draw();
    };
    const onKey = e => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') press('enter');
      else if (e.key === 'Escape') close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'enter'];
    const sheet = el('div', { class: 'pad-sheet', role: 'dialog', 'aria-label': label || input.getAttribute('aria-label') || '' }, [
      el('div', { class: 'pad-top' }, [el('span', { class: 'muted', text: label || input.getAttribute('aria-label') || '' }), shown]),
      el('div', { class: 'num-pad' },
        keys.map(key =>
          el('button', {
            class: `num-key ${key.length > 1 ? `num-${key}` : ''}`,
            type: 'button',
            'aria-label': key === 'back' ? t('keyBack') : key === 'enter' ? t('keyOk') : key,
            text: key === 'back' ? '⌫' : key === 'enter' ? t('keyOk') : key,
            onpointerdown: event => (event.preventDefault(), press(key))
          })
        )
      )
    ]);
    const backdrop = el('div', { class: 'pad-backdrop', onpointerdown: event => event.target === backdrop && close() }, sheet);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    draw();
  };
  input.addEventListener('click', open);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    } else if (/^\d$/.test(event.key)) {
      open();
    }
  });
  return input;
}

// ---- 小遊戲 (mini games) ------------------------------------------------------------

// The games' tiles, today's winnings against the daily cap, and the game
// being played. The game's own view is built once per round and kept, so the
// page re-rendering (new odds, a sync) never interrupts a pitch.
const ARCADE_ICON = { typing: '⌨️', sort: '🗂️', derby: '⚾', freethrow: '🏀' };
const ARCADE_MAX = Object.fromEntries(ARCADE.games.map(game => [game, bestRound(game)]));

function renderArcade() {
  if (!state.accountReady) return;
  const t = state.t;
  const earned = earnedToday(state.account);
  const room = roomToday(state.account);
  $('arcade-body').replaceChildren(
    el('div', { class: 'card arcade' }, [
      el('p', { class: 'lede', text: t('arcadeIntro', { cap: fmtMoney(ARCADE.dailyCap, { sign: false }) }) }),
      el('div', { class: 'arcade-cap' }, [
        el('div', { class: 'arcade-cap-bar', 'aria-hidden': 'true' }, el('div', { style: `width:${Math.min(100, (earned / ARCADE.dailyCap) * 100)}%` })),
        el('small', { class: 'muted', text: room > 0 ? t('arcadeEarned', { v: fmtMoney(earned, { sign: false }), cap: fmtMoney(ARCADE.dailyCap, { sign: false }) }) : t('arcadeCapped') })
      ]),
      el('div', { class: 'arcade-tiles' },
        ARCADE.games.map(game =>
          el('button', { class: 'arcade-tile', type: 'button', 'aria-pressed': String(state.arcadeGame === game), onclick: () => openGame(game) }, [
            el('span', { class: 'arcade-icon', 'aria-hidden': 'true', text: ARCADE_ICON[game] }),
            el('span', { class: 'arcade-name', text: t(`arcade_${game}`) }),
            el('small', { class: 'muted', text: t(`arcadeKind_${game}`) }),
            el('small', { class: 'arcade-max', text: t('arcadeUpTo', { v: fmtMoney(ARCADE_MAX[game], { sign: false }) }) })
          ])
        )
      ),
      state.arcadeView
    ])
  );
}

function openGame(game) {
  stopGame();
  state.arcadeGame = state.arcadeGame === game ? null : game;
  state.arcadeView = state.arcadeGame ? { typing: typingView, sort: sortView, derby: derbyView, freethrow: freeThrowView }[game]() : null;
  renderArcade();
  state.arcadeView?.focus({ preventScroll: true });
}

// Timers and the animation of the running game, all stopped when it closes.
let gameTimers = [];
function later(fn, ms) {
  gameTimers.push(setTimeout(fn, ms));
}
function stopGame() {
  gameTimers.forEach(clearTimeout);
  gameTimers = [];
  cancelAnimationFrame(state.arcadeFrame ?? 0);
}
// Runs draw(now) every frame until it returns false or the game closes.
function animate(draw) {
  cancelAnimationFrame(state.arcadeFrame ?? 0);
  const frame = now => {
    if (draw(now) !== false) state.arcadeFrame = requestAnimationFrame(frame);
  };
  state.arcadeFrame = requestAnimationFrame(frame);
}

// The strip above a game: progress, the round's money so far, the streak,
// and a moment's note of a streak bonus or a penalty.
function gameHud() {
  const t = state.t;
  const progress = el('div', { class: 'hud-bar', 'aria-hidden': 'true' }, el('div'));
  const count = el('span', { class: 'hud-count' });
  const money = el('strong', { class: 'hud-money' });
  const streak = el('span', { class: 'hud-streak' });
  const note = el('span', { class: 'hud-note', 'aria-live': 'polite' });
  const node = el('div', { class: 'game-hud' }, [el('div', { class: 'hud-row' }, [count, streak, note, money]), progress]);
  const set = ({ done, of, earned, run }) => {
    count.textContent = t('hudCount', { n: done, of });
    money.textContent = fmtMoney(earned, { sign: false });
    streak.textContent = run >= 2 ? t('hudStreak', { n: run }) : '';
    streak.classList.toggle('hot', run >= 5);
    progress.firstChild.style.width = `${(done / of) * 100}%`;
  };
  // After good() or bad(): +bonus in gold, -penalty in red.
  const flash = (amount, good) => {
    if (!amount) return;
    note.textContent = good ? t('hudBonus', { v: fmtMoney(amount, { sign: false }) }) : t('hudPenalty', { v: fmtMoney(amount, { sign: false }) });
    note.className = `hud-note ${good ? 'bonus' : 'penalty'}`;
    void note.offsetWidth;
    note.classList.add('show');
  };
  return { node, set, flash };
}

// Each game's streak and penalty, as one line under its rules.
function streakRule(game) {
  const r = STREAK[game];
  const v = x => fmtMoney(x, { sign: false });
  return r.penalty ? state.t('streakRule', { every: r.every, bonus: v(r.bonus), penalty: v(r.penalty) }) : state.t('streakRuleFree', { every: r.every, bonus: v(r.bonus) });
}

// A finished round: its winnings into the account (up to today's room), then
// what the work came to an hour against the minimum wage, and how much
// betting loses as much on average.
function finishRound(game, amount, box, summary, ms, score = null) {
  const t = state.t;
  stopGame();
  const { account, paid } = payGame(state.account, game, amount);
  if (paid > 0) commitAccount(account);
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  box.replaceChildren(
    ...[
      el('p', { class: 'arcade-result' }, [
        document.createTextNode(summary),
        el('strong', { class: paid > 0 ? 'back-high' : '', text: ` ${t('arcadePaid', { v: fmtMoney(paid) })}` })
      ]),
      score && (score.bonus || score.penalty) ? el('p', { class: 'arcade-score', text: t('scoreLine', { bonus: fmtMoney(score.bonus, { sign: false }), penalty: fmtMoney(score.penalty, { sign: false }) }) }) : null,
      amount > paid ? el('p', { class: 'note', text: t('arcadeCapNote') }) : null,
      el('p', { class: 'arcade-wage' }, [
        document.createTextNode(t('arcadeWage', { m: minutes, s: seconds, work: fmtWorkMinutes(wageMinutes(paid)), wage: fmtMoney(ARCADE.minWage, { sign: false }) })),
        paid > 0 ? el('strong', { text: ` ${t('arcadeLoss', { v: fmtMoney(paid, { sign: false }), stake: fmtMoney(stakeToLose(paid), { sign: false }) })}` }) : null
      ]),
      el('button', { class: 'primary-button', type: 'button', text: t('arcadeAgain'), onclick: () => ((state.arcadeGame = null), openGame(game)) })
    ].filter(Boolean)
  );
  renderArcade();
}

// Minutes of work: one decimal under 10 ("3.7"), whole above.
function fmtWorkMinutes(m) {
  return m < 10 ? (Math.round(m * 10) / 10).toString() : fmtInt(m);
}

// A canvas drawn at the screen's pixel density, W x H in CSS pixels.
function gameCanvas(W, H) {
  const canvas = el('canvas', { class: 'game-canvas', width: String(W * (window.devicePixelRatio || 1)), height: String(H * (window.devicePixelRatio || 1)) });
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  return { canvas, ctx };
}

// Big text in the middle of a canvas, fading out over `life` ms.
function drawCallout(ctx, W, text, sub, age, life = 1100, color = '#fff') {
  if (!text || age < 0 || age > life) return;
  const a = Math.max(0, 1 - age / life);
  const rise = (age / life) * 12;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 4;
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.strokeText(text, W / 2, 96 - rise);
  ctx.fillText(text, W / 2, 96 - rise);
  if (sub) {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeText(sub, W / 2, 120 - rise);
    ctx.fillText(sub, W / 2, 120 - rise);
  }
  ctx.restore();
}

// Bursts of confetti for the best results.
function burst(x, y, n = 28) {
  const colors = ['#ffd54f', '#ff7043', '#4fc3f7', '#81c784', '#f06292'];
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2;
    const speed = 1.5 + Math.random() * 2.5;
    return { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, color: colors[i % colors.length], life: 900 };
  });
}
function drawParticles(ctx, particles, dt) {
  for (const p of particles) {
    p.x += p.vx * dt * 0.06;
    p.y += p.vy * dt * 0.06;
    p.vy += 0.004 * dt;
    p.life -= dt;
    if (p.life <= 0) continue;
    ctx.globalAlpha = Math.min(1, p.life / 400);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  return particles.filter(p => p.life > 0);
}

// 全壘打大賽: the pitch comes in from the mound; swing as it reaches the plate.
function derbyView() {
  const t = state.t;
  const W = 360;
  const H = 250;
  const { canvas, ctx } = gameCanvas(W, H);
  const hud = gameHud();
  const box = el('div', { class: 'arcade-actions' });
  const mound = { x: W / 2, y: 78 };
  const plate = { x: W / 2, y: 214 };
  const results = [];
  let phase = 'idle';
  let plan = null;
  let pitchStart = 0;
  let swingAt = -1e9;
  let flight = null;
  let callout = null;
  let particles = [];
  let began = 0;
  const score = scorer('derby');
  let last = performance.now();
  const update = () => hud.set({ done: results.length, of: DERBY.pitches, earned: score.total, run: score.run });
  // The ball along its path: p is ballAt's 0-1, the plate at DERBY.plate.
  const ballPos = p => {
    const k = p / DERBY.plate;
    return { x: mound.x + (plate.x - mound.x) * k, y: mound.y + (plate.y - mound.y) * k, r: 2.5 + 5.5 * Math.min(1.2, k) };
  };
  const drawField = () => {
    // Stands and sky, the outfield grass in stripes, the infield dirt.
    const sky = ctx.createLinearGradient(0, 0, 0, 60);
    sky.addColorStop(0, '#0d2a4a');
    sky.addColorStop(1, '#1d4f7a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, 60);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(255,255,255,0.08)' : 'rgba(255,214,79,0.14)';
      ctx.fillRect((i * 37) % W, 30 + ((i * 13) % 22), 3, 3);
    }
    ctx.fillStyle = '#12351f';
    ctx.fillRect(0, 52, W, 6);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#2f7d3a' : '#358a41';
      ctx.fillRect(0, 58 + i * 25, W, 25);
    }
    ctx.fillStyle = '#b07a4a';
    ctx.beginPath();
    ctx.ellipse(W / 2, H + 30, 190, 120, 0, Math.PI, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#a06b3c';
    ctx.beginPath();
    ctx.ellipse(mound.x, mound.y + 6, 26, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // The pitcher: a simple figure, arm up while throwing.
    const throwing = phase === 'pitch' && performance.now() - pitchStart < 160;
    ctx.fillStyle = '#e8eef5';
    ctx.beginPath();
    ctx.arc(mound.x, mound.y - 22, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(mound.x - 5, mound.y - 16, 10, 16);
    ctx.strokeStyle = '#e8eef5';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mound.x + 4, mound.y - 13);
    ctx.lineTo(mound.x + (throwing ? -8 : 11), mound.y + (throwing ? -24 : -4));
    ctx.stroke();
    // Home plate, the batter's boxes and the strike zone ring.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(plate.x - 11, plate.y - 4);
    ctx.lineTo(plate.x + 11, plate.y - 4);
    ctx.lineTo(plate.x + 11, plate.y + 2);
    ctx.lineTo(plate.x, plate.y + 9);
    ctx.lineTo(plate.x - 11, plate.y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(plate.x - 52, plate.y - 26, 30, 44);
    ctx.strokeRect(plate.x + 22, plate.y - 26, 30, 44);
  };
  const drawBat = now => {
    // A right-handed batter's bat, swinging round in 160 ms.
    const pivot = { x: plate.x - 30, y: plate.y - 6 };
    const k = Math.min(1, (now - swingAt) / 160);
    const angle = -2.3 + (k < 1 ? k : 1) * 2.9 * (now - swingAt < 600 ? 1 : 0);
    ctx.strokeStyle = '#c58b4e';
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(pivot.x + Math.cos(angle) * 58, pivot.y + Math.sin(angle) * 58);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#7a4f24';
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(pivot.x + Math.cos(angle) * 14, pivot.y + Math.sin(angle) * 14);
    ctx.stroke();
  };
  const drawBall = (x, y, r) => {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + r + 2, r, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d32f2f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x - r * 0.9, y, r * 0.8, -0.8, 0.8);
    ctx.arc(x + r * 0.9, y, r * 0.8, Math.PI - 0.8, Math.PI + 0.8);
    ctx.stroke();
  };
  const draw = now => {
    const dt = Math.min(50, now - last);
    last = now;
    ctx.clearRect(0, 0, W, H);
    drawField();
    if (phase === 'pitch') {
      const p = ballAt(plan, now - pitchStart);
      // The timing ring lights up while the ball is in the hitting window.
      const inWindow = Math.abs(p - DERBY.plate) <= DERBY.hit;
      ctx.strokeStyle = inWindow ? 'rgba(255,213,79,0.95)' : 'rgba(255,213,79,0.35)';
      ctx.lineWidth = inWindow ? 3 : 2;
      ctx.beginPath();
      ctx.arc(plate.x, plate.y - 10, 16, 0, Math.PI * 2);
      ctx.stroke();
      const b = ballPos(p);
      drawBall(b.x, b.y, b.r);
      if (p > 1.02) swing(true);
    } else if (flight) {
      const k = Math.min(1, (now - flight.start) / flight.ms);
      const x = flight.from.x + (flight.to.x - flight.from.x) * k;
      const y = flight.from.y + (flight.to.y - flight.from.y) * k - Math.sin(k * Math.PI) * flight.arc;
      drawBall(x, y, Math.max(1.5, flight.r * (1 - 0.7 * k)));
      if (k >= 1 && flight.result === 'hr' && !flight.popped) {
        flight.popped = true;
        particles.push(...burst(x, Math.max(20, y)));
      }
    }
    drawBat(now);
    particles = drawParticles(ctx, particles, dt);
    if (phase === 'idle') drawCallout(ctx, W, t('derbyTitle'), t('derbyTap'), 0, 1);
    if (callout) drawCallout(ctx, W, callout.text, callout.sub, now - callout.at, 1200, callout.color);
    return phase !== 'done' || particles.length > 0 || (callout && now - callout.at < 1200);
  };
  const next = () => {
    if (results.length === DERBY.pitches) {
      phase = 'done';
      const hr = results.filter(r => r === 'hr').length;
      const hits = results.filter(r => r === 'hit').length;
      later(() => finishRound('derby', score.total, box, t('derbyDone', { hr, hits }), performance.now() - began, score), 900);
      return;
    }
    phase = 'wait';
    flight = null;
    later(() => {
      plan = pitchPlan(results.length);
      phase = 'pitch';
      pitchStart = performance.now();
    }, 900 + Math.random() * 700);
  };
  function swing(late = false) {
    const now = performance.now();
    if (phase === 'idle') return start();
    if (!late) swingAt = now;
    if (phase !== 'pitch') return;
    const p = ballAt(plan, now - pitchStart);
    const result = late ? 'miss' : swingResult(p);
    results.push(result);
    if (result === 'miss') hud.flash(score.bad(), false);
    else hud.flash(score.good(DERBY.pay[result]), true);
    phase = 'flight';
    const b = ballPos(Math.min(p, 1.1));
    const off = Math.abs(p - DERBY.plate);
    if (result === 'hr') {
      // Distance by how true the swing was.
      const meters = Math.round(118 + (1 - off / DERBY.hr) * 32);
      flight = { from: b, to: { x: W / 2 + (p - DERBY.plate) * 900, y: -30 }, arc: 90, ms: 1000, r: b.r, result };
      callout = { text: t('derby_hr'), sub: t('derbyMeters', { m: meters }), at: now, color: '#ffd54f' };
    } else if (result === 'hit') {
      const side = p < DERBY.plate ? -1 : 1;
      flight = { from: b, to: { x: W / 2 + side * (60 + Math.random() * 90), y: 95 + Math.random() * 40 }, arc: 50, ms: 800, r: b.r, result };
      callout = { text: t('derby_hit'), sub: t('derbyMeters', { m: Math.round(35 + (1 - off / DERBY.hit) * 55) }), at: now, color: '#fff' };
    } else {
      flight = { from: b, to: { x: plate.x + 4, y: H + 20 }, arc: 0, ms: 250, r: b.r, result };
      callout = { text: t(late ? 'derby_strike' : 'derby_miss'), sub: '', at: now, color: '#ff8a80' };
    }
    update();
    later(next, 1300);
  }
  function start() {
    began = performance.now();
    box.replaceChildren(swingButton);
    next();
  }
  canvas.addEventListener('pointerdown', event => (event.preventDefault(), swing()));
  const swingButton = el('button', { class: 'primary-button game-big-button', type: 'button', text: t('derbySwing'), onclick: () => swing() });
  box.append(el('button', { class: 'primary-button game-big-button', type: 'button', text: t('arcadeStart'), onclick: start }));
  update();
  animate(draw);
  return el('div', { class: 'arcade-game', tabindex: '0', onkeydown: e => e.key === ' ' && (e.preventDefault(), swing()) }, [
    el('p', { class: 'note', text: `${t('derbyRules', { hr: fmtMoney(DERBY.pay.hr, { sign: false }), hit: fmtMoney(DERBY.pay.hit, { sign: false }) })} ${streakRule('derby')}` }),
    hud.node,
    canvas,
    box
  ]);
}

// 罰球: stop the sweeping marker in the green zone, and watch the shot.
function freeThrowView() {
  const t = state.t;
  const W = 360;
  const H = 250;
  const { canvas, ctx } = gameCanvas(W, H);
  const hud = gameHud();
  const box = el('div', { class: 'arcade-actions' });
  const meter = { x: 22, y: 30, w: 16, h: 190 };
  const rim = { x: 286, y: 92, r: 18 };
  const hand = { x: 110, y: 186 };
  const results = [];
  let phase = 'idle';
  let plan = null;
  let aimStart = 0;
  let shot = null;
  let callout = null;
  let particles = [];
  let ripple = -1e9;
  let began = 0;
  const score = scorer('freethrow');
  let last = performance.now();
  const update = () => hud.set({ done: results.length, of: FREE_THROW.shots, earned: score.total, run: score.run });
  const drawCourt = now => {
    const wall = ctx.createLinearGradient(0, 0, 0, 150);
    wall.addColorStop(0, '#1b2331');
    wall.addColorStop(1, '#2a3547');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, 150);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? '#c8904f' : '#d19a58';
      ctx.fillRect(0, 150 + i * 12, W, 12);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, 250);
    ctx.lineTo(130, 150);
    ctx.stroke();
    // Backboard, its square, the pole.
    ctx.fillStyle = '#9aa7b8';
    ctx.fillRect(326, 60, 6, 140);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(304, 38, 8, 70);
    ctx.strokeStyle = '#e53935';
    ctx.strokeRect(304, 70, 8, 22);
    // The net: longer and swaying just after a make.
    const sway = Math.max(0, 1 - (now - ripple) / 600);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const x0 = rim.x - rim.r + (i * rim.r * 2) / 6;
      ctx.beginPath();
      ctx.moveTo(x0, rim.y);
      ctx.lineTo(rim.x - rim.r * 0.55 + (i * rim.r * 1.1) / 6 + Math.sin(now / 60 + i) * 3 * sway, rim.y + 26 + 8 * sway);
      ctx.stroke();
    }
  };
  const drawRim = () => {
    ctx.strokeStyle = '#ff6d00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(rim.x, rim.y, rim.r, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  };
  const drawBall = (x, y) => {
    ctx.fillStyle = '#ef6c00';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x + 9, y);
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x, y + 9);
    ctx.stroke();
  };
  const drawMeter = now => {
    const zone = plan?.zone ?? shotPlan(results.length).zone;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(meter.x - 3, meter.y - 3, meter.w + 6, meter.h + 6);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(meter.x, meter.y, meter.w, meter.h);
    ctx.fillStyle = '#fdd835';
    ctx.fillRect(meter.x, meter.y + meter.h * (0.5 - zone), meter.w, meter.h * zone * 2);
    ctx.fillStyle = '#43a047';
    ctx.fillRect(meter.x, meter.y + meter.h * (0.5 - zone / 2), meter.w, meter.h * zone);
    ctx.fillStyle = '#1b5e20';
    ctx.fillRect(meter.x, meter.y + meter.h * (0.5 - zone / 4), meter.w, (meter.h * zone) / 2);
    if (phase === 'aim' || phase === 'flight') {
      const m = phase === 'aim' ? markerAt(plan, now - aimStart) : shot.marker;
      const y = meter.y + meter.h * m;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(meter.x + meter.w + 2, y);
      ctx.lineTo(meter.x + meter.w + 12, y - 6);
      ctx.lineTo(meter.x + meter.w + 12, y + 6);
      ctx.fill();
      ctx.fillRect(meter.x - 2, y - 1.5, meter.w + 4, 3);
    }
  };
  const drawShooter = () => {
    ctx.fillStyle = '#e8eef5';
    ctx.beginPath();
    ctx.arc(hand.x - 22, hand.y - 26, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1565c0';
    ctx.fillRect(hand.x - 30, hand.y - 18, 16, 28);
    ctx.fillStyle = '#e8eef5';
    ctx.fillRect(hand.x - 29, hand.y + 10, 5, 22);
    ctx.fillRect(hand.x - 20, hand.y + 10, 5, 22);
    ctx.strokeStyle = '#e8eef5';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(hand.x - 16, hand.y - 14);
    ctx.lineTo(hand.x - 4, hand.y - 4);
    ctx.stroke();
  };
  const draw = now => {
    const dt = Math.min(50, now - last);
    last = now;
    ctx.clearRect(0, 0, W, H);
    drawCourt(now);
    drawShooter();
    drawMeter(now);
    if (shot) {
      // The flight: up and over to the target, then through, off the rim, or short.
      const k = Math.min(1, (now - shot.start) / 850);
      const x = hand.x + (shot.target.x - hand.x) * k;
      const y = hand.y + (shot.target.y - hand.y) * k - Math.sin(k * Math.PI) * 120;
      if (k < 1) drawBall(x, y);
      else {
        const k2 = Math.min(1, (now - shot.start - 850) / 500);
        if (shot.result !== 'miss') drawBall(rim.x + shot.drift * (1 - k2), rim.y + 8 + k2 * 70);
        else drawBall(shot.target.x + shot.bounce * k2 * 60, shot.target.y - Math.sin(k2 * Math.PI) * 30 + k2 * 60);
        if (!shot.landed) {
          shot.landed = true;
          if (shot.result !== 'miss') ripple = now;
          if (shot.result === 'swish') particles.push(...burst(rim.x, rim.y));
        }
      }
    } else if (phase !== 'done') drawBall(hand.x, hand.y);
    drawRim();
    particles = drawParticles(ctx, particles, dt);
    if (phase === 'idle') drawCallout(ctx, W, t('ftTitle'), t('ftTap'), 0, 1);
    if (callout) drawCallout(ctx, W, callout.text, callout.sub, now - callout.at, 1200, callout.color);
    return phase !== 'done' || particles.length > 0 || (callout && now - callout.at < 1200);
  };
  const next = () => {
    if (results.length === FREE_THROW.shots) {
      phase = 'done';
      const made = results.filter(r => r !== 'miss').length;
      const swish = results.filter(r => r === 'swish').length;
      later(() => finishRound('freethrow', score.total, box, t('ftDone', { made, swish }), performance.now() - began, score), 900);
      return;
    }
    shot = null;
    plan = shotPlan(results.length);
    phase = 'aim';
    aimStart = performance.now();
  };
  function shoot() {
    if (phase === 'idle') return start();
    if (phase !== 'aim') return;
    const now = performance.now();
    const marker = markerAt(plan, now - aimStart);
    const result = shotResult(marker, plan);
    results.push(result);
    // The money shows once the ball lands.
    later(() => (result === 'miss' ? hud.flash(score.bad(), false) : hud.flash(score.good(FREE_THROW.pay[result]), true), update()), 900);
    phase = 'flight';
    const err = marker - 0.5;
    // Too high a mark: long (off the back of the rim); too low: short.
    const target = result === 'miss' ? { x: rim.x + Math.sign(err) * (rim.r + 4), y: rim.y - 2 } : { x: rim.x + err * 40, y: rim.y - 2 };
    shot = { start: now, marker, result, target, drift: err * 40, bounce: err > 0 ? 1 : -1.2 };
    callout = { text: t(`ft_${result}`), sub: '', at: now + 850, color: result === 'swish' ? '#ffd54f' : result === 'make' ? '#fff' : '#ff8a80' };
    update();
    later(next, 1700);
  }
  function start() {
    began = performance.now();
    box.replaceChildren(shootButton);
    next();
  }
  canvas.addEventListener('pointerdown', event => (event.preventDefault(), shoot()));
  const shootButton = el('button', { class: 'primary-button game-big-button', type: 'button', text: t('ftShoot'), onclick: () => shoot() });
  box.append(el('button', { class: 'primary-button game-big-button', type: 'button', text: t('arcadeStart'), onclick: start }));
  update();
  animate(draw);
  return el('div', { class: 'arcade-game', tabindex: '0', onkeydown: e => e.key === ' ' && (e.preventDefault(), shoot()) }, [
    el('p', { class: 'note', text: `${t('ftRules', { swish: fmtMoney(FREE_THROW.pay.swish, { sign: false }), make: fmtMoney(FREE_THROW.pay.make, { sign: false }) })} ${streakRule('freethrow')}` }),
    hud.node,
    canvas,
    box
  ]);
}

// 整理彩券: each ticket shows a team; put it in its league's box (keys 1-4 too).
function sortView() {
  const t = state.t;
  const hud = gameHud();
  const box = el('div', { class: 'arcade-actions' });
  const slot = el('div', { class: 'sort-slot', 'aria-live': 'polite' });
  const set = sortSet();
  const bins = SORT_SETS[set];
  const score = scorer('sort');
  let ticket = sortTicket(set);
  let right = 0;
  let wrong = 0;
  let began = 0;
  const update = () => hud.set({ done: right, of: SORT.tickets, earned: score.total, run: score.run });
  const card = tk => {
    const team = { en: tk.team, zh: teamZh(tk.league, tk.team) };
    return el('div', { class: 'lotto-ticket sort-ticket' }, [
      el('span', { class: 'lotto-head', text: t('lottoHead') }),
      el('span', { class: 'sort-team' }, [logoImg(tk.league, tk.team, teamName(team), 'logo-lg'), el('strong', { text: teamName(team) })]),
      el('small', { class: 'lotto-serial', text: groupCode(ticketCode()) })
    ]);
  };
  const show = () => {
    slot.replaceChildren(card(ticket));
    update();
  };
  const place = (league, button) => {
    if (right >= SORT.tickets) return;
    if (!began) began = performance.now();
    const current = slot.firstChild;
    if (league === ticket.league) {
      right++;
      hud.flash(score.good(SORT.pay), true);
      button.classList.remove('flash');
      void button.offsetWidth;
      button.classList.add('flash');
      current?.classList.add('fly', `fly-${bins.indexOf(league)}`);
      ticket = sortTicket(set);
      if (right === SORT.tickets) {
        update();
        binRow.remove();
        later(() => finishRound('sort', score.total, box, t('sortDone', { n: right, wrong }), performance.now() - began, score), 250);
        return;
      }
      later(show, 140);
    } else {
      wrong++;
      hud.flash(score.bad(), false);
      current?.classList.remove('shake');
      void current?.offsetWidth;
      current?.classList.add('shake');
      update();
    }
  };
  const buttons = bins.map((league, i) =>
    el('button', { class: 'sort-bin', type: 'button', onclick: event => place(league, event.currentTarget) }, [
      leagueImg(league, 'logo-tile'),
      el('span', { text: t(`sport_${league}`) }),
      el('small', { class: 'muted', text: String(i + 1) })
    ])
  );
  const binRow = el('div', { class: 'sort-bins' }, buttons);
  show();
  return el('div', {
    class: 'arcade-game',
    tabindex: '0',
    onkeydown: e => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < bins.length) place(bins[i], buttons[i]);
    }
  }, [el('p', { class: 'note', text: `${t('sortRules', { n: SORT.tickets, pay: fmtMoney(SORT.pay, { sign: false }) })} ${streakRule('sort')}` }), hud.node, slot, binRow, box]);
}

// 打工：輸入彩券號碼: key in each ticket number on the page's own number pad
// (no phone keyboard popping up; a real keyboard works too). Each one right
// pays the same. The clock starts at the first key.
function typingView() {
  const t = state.t;
  const hud = gameHud();
  const slot = el('div', { class: 'sort-slot', 'aria-live': 'polite' });
  const entry = el('p', { class: 'typing-entry', 'aria-live': 'polite' });
  const box = el('div', { class: 'arcade-actions' });
  const score = scorer('typing');
  let code = ticketCode();
  let typed = '';
  let right = 0;
  let typos = 0;
  let began = 0;
  let done = false;
  const update = () => hud.set({ done: right, of: TYPING.codes, earned: score.total, run: score.run });
  const showEntry = () => {
    // What's keyed so far, grouped like the ticket, with the rest as dashes.
    entry.textContent = typed.padEnd(TYPING.digits, '·').replace(/(.{4})(?=.)/g, '$1 ');
    entry.classList.toggle('full', typed.length === TYPING.digits);
  };
  const show = () => {
    slot.replaceChildren(el('div', { class: 'lotto-ticket' }, [el('span', { class: 'lotto-head', text: t('lottoHead') }), el('p', { class: 'typing-code', text: groupCode(code) })]));
    showEntry();
    update();
  };
  const submit = () => {
    if (done || typed.length < TYPING.digits) return;
    if (typedRight(typed, code)) {
      right++;
      hud.flash(score.good(TYPING.pay), true);
      code = ticketCode();
      entry.classList.remove('typo');
      slot.firstChild?.classList.add('fly', 'fly-2');
      typed = '';
      if (right === TYPING.codes) {
        done = true;
        update();
        pad.remove();
        entry.remove();
        finishRound('typing', score.total, box, t('typingDone', { n: right, typos }), performance.now() - began, score);
        return;
      }
      later(show, 140);
    } else {
      typos++;
      hud.flash(score.bad(), false);
      entry.classList.remove('typo');
      void entry.offsetWidth;
      entry.classList.add('typo');
      typed = '';
      slot.firstChild?.classList.remove('shake');
      void slot.firstChild?.offsetWidth;
      slot.firstChild?.classList.add('shake');
      showEntry();
      update();
    }
  };
  const press = key => {
    if (done) return;
    began ||= performance.now();
    if (key === 'back') typed = typed.slice(0, -1);
    else if (key === 'enter') return submit();
    else if (typed.length < TYPING.digits) typed += key;
    showEntry();
    // The tenth digit sends it: one less tap per ticket.
    if (typed.length === TYPING.digits) submit();
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'enter'];
  const pad = el('div', { class: 'num-pad' },
    keys.map(key =>
      el('button', {
        class: `num-key ${key.length > 1 ? `num-${key}` : ''}`,
        type: 'button',
        'aria-label': key === 'back' ? t('keyBack') : key === 'enter' ? t('typingEnter') : key,
        text: key === 'back' ? '⌫' : key === 'enter' ? '✓' : key,
        // pointerdown answers at once on phones (no 300 ms click wait).
        onpointerdown: event => (event.preventDefault(), press(key))
      })
    )
  );
  show();
  return el('div', {
    class: 'arcade-game',
    tabindex: '0',
    onkeydown: e => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') press('enter');
      else return;
      e.preventDefault();
    }
  }, [el('p', { class: 'note', text: `${t('typingRules', { n: TYPING.codes, pay: fmtMoney(TYPING.pay, { sign: false }) })} ${streakRule('typing')}` }), hud.node, slot, entry, pad, box]);
}

// ---- F1 -----------------------------------------------------------------------

// Every driver the market prices, like the lottery's full list.
function renderF1() {
  const t = state.t;
  const f1 = state.data.f1;
  $('f1').hidden = !inSport('f1') || !f1;
  if (!f1) return;
  const drivers = state.bets.filter(b => b.kind === 'f1');
  const podium = state.bets.filter(b => b.kind === 'f1podium');
  $('f1-body').replaceChildren(
    board({
      emblem: 'f1',
      title: f1.title,
      sub: `${fmtTime(f1.startUtc)} · ${t(f1.phase === 'pre' ? 'f1PhasePre' : 'f1PhasePost')}`,
      bets: drivers,
      id: 'f1',
      notes: [t('f1Intro'), t('f1PhaseNote')],
      rows: (b, i) => entryRow(b, i, driverBadge(b), b.driver.team)
    }),
    podium.length
      ? board({
          emblem: 'f1',
          title: `${f1.title} · ${t('f1Podium')}`,
          sub: t('f1PodiumSub'),
          bets: podium,
          id: 'f1podium',
          shown: 8,
          notes: [t('f1PodiumNote')],
          rows: (b, i) => entryRow(b, i, driverBadge(b), b.driver.team)
        })
      : null
  );
}

// ---- Boot ---------------------------------------------------------------------

function renderAll() {
  renderStatic();
  if (!state.data) return;
  state.bets = buildBets(state.data);
  state.futures = buildFutures(state.data);
  state.recs = recommend(state.bets);
  state.parlay = state.parlay.filter(id => slipCandidates().some(b => b.id === id));
  renderStatus('ok');
  renderTabs();
  renderSportFilter();
  renderDayFilter();
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
    // A tab asked for in the address (#sim) that needed the odds opens now.
    if (state.wantedTab && state.tab !== state.wantedTab && tabAvailable(state.wantedTab)) state.tab = state.wantedTab;
    state.wantedTab = null;
    renderAll();
    // The other leagues and championships join once they arrive.
    loadExtraLeagues(new Date()).then(games => {
      if (!games.length || !state.data) return;
      const ids = new Set(state.data.games.map(g => g.id));
      state.data.games = [...state.data.games, ...games.filter(g => !ids.has(g.id))].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
      renderAll();
    }, error => console.error(error));
    loadExtraFutures().then(futures => {
      if (!futures.length || !state.data) return;
      const keys = new Set(state.data.futures.map(f => f.key));
      state.data.futures = [...state.data.futures, ...futures.filter(f => !keys.has(f.key))];
      renderAll();
    }, error => console.error(error));
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
  if (TABS.includes(fromHash)) state.tab = state.wantedTab = fromHash;
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

// Phones: no app header. The status and refresh move to a
// slim row at the top of the page (the tabs are already at the bottom).
{
  const phone = matchMedia('(max-width: 720px)');
  const place = () => {
    const into = phone.matches ? $('mobile-bar') : document.querySelector('.appbar-inner');
    if (phone.matches) into.append($('status'), $('refresh'));
    else {
      document.querySelector('.brand-text').append($('status'));
      into.append($('refresh'));
    }
  };
  place();
  phone.addEventListener('change', place);
}

// Big numbers on one line: each of these shrinks its font (down to 60%) to
// fit its box, instead of wrapping onto a second row on phones. Checked when
// its text changes and when its box resizes (which also covers a tab showing
// it for the first time). Only the slip and simulator
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
