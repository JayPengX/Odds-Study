import {
  FANS,
  HABITS,
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
  expectedReturn,
  habitPools,
  lotteryTotalLines,
  lotteryRunLines,
  fitTeamRuns,
  lotteryTeamTotal,
  TOP_INNING_ODDS,
  MLB_MARKET_OVERROUND,
  median,
  quantile,
  SLIP_RULES,
  choose,
  seededRandom,
  simulateCrowdStats,
  slipErrors,
  slipSizes,
} from './lib/odds.mjs';
import { loadOdds, taipeiDayKey } from './lib/sources.mjs';
import { detectLocale, makeT } from './lib/i18n.mjs';
import { f1Driver, leagueLogo, teamLogo } from './lib/teams.mjs';

const STAKE = 100;
// Simulated players per habit. Big enough that the results barely move
// between runs, so one fixed-seed run is shown.
// Simulated players per habit x fan type group.
const PER_GROUP = Math.ceil(100_000 / (HABITS.length * FANS.length));
const PER_HABIT = PER_GROUP * FANS.length;
const SIM_PLAYERS = HABITS.length * PER_HABIT;
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

const state = {
  locale: detectLocale(),
  t: null,
  data: null,
  bets: [],
  futures: [],
  userOdds: loadUserOdds(),
  parlay: [],
  slipMode: 'parlay',
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
  // Off: only the odds and the average back. On: margins, chances, takes, extra stats.
  detail: loadDetail()
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

function fmtMoney(value, { sign = true } = {}) {
  const abs = Math.abs(Math.round(value)).toLocaleString(numberLocale());
  if (!sign) return `NT$${abs}`;
  return `${value < -0.5 ? '−' : value > 0.5 ? '+' : ''}NT$${abs}`;
}

function fmtAxis(value) {
  const abs = Math.abs(Math.round(value)).toLocaleString(numberLocale());
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
  return new Intl.DateTimeFormat(numberLocale(), {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Taipei'
  }).format(new Date(iso));
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
    const total = game.total;
    // MLB: the lottery's three lines, modelled from DraftKings' one line (any
    // line, whole or half). Premier League: DraftKings' own half-goal line only.
    const lines =
      !total ? [] : game.sport === 'mlb' ? lotteryTotalLines(total.line, total.overFair) : total.line % 1 !== 0 ? [{ line: total.line, over: total.overFair, main: true }] : [];
    for (const { line, over, main } of lines) {
      for (const side of ['over', 'under']) {
        const p = side === 'over' ? over : 1 - over;
        bets.push({
          ...base,
          id: `${game.id}|tot|${line}|${side}`,
          kind: 'total',
          totalLine: line,
          mainLine: main,
          market: `total|${line}`,
          marketLabel: String(line),
          chip: t(side),
          // The main line's margin is the usual source gap (filled in below);
          // the lines either side add the model's error, ~1-3 points.
          fairMargin: main ? null : 0.02,
          errKey: game.sport === 'mlb' ? 'mlbTotal' : game.sport,
          label: `${matchup} ${t(side)} ${line}`,
          shortLabel: `${t(side)} ${line}`,
          fairChance: p,
          estOdds: estimateLotteryOdds(p, K_DRAFTKINGS)
        });
      }
    }
    // MLB team totals (單隊大小): each team's runs from a model fitted to
    // DraftKings' win chance and total; the line closest to 50/50.
    if (game.sport === 'mlb' && game.total && game.draftKings) {
      const means = fitTeamRuns(game.draftKings.home, game.total.line, game.total.overFair);
      for (const team of ['away', 'home']) {
        const { line, over } = lotteryTeamTotal(means[team]);
        for (const side of ['over', 'under']) {
          const p = side === 'over' ? over : 1 - over;
          bets.push({
            ...base,
            id: `${game.id}|tt|${team}|${line}|${side}`,
            kind: 'teamtotal',
            market: `tt|${team}`,
            marketLabel: teamName(game[team]),
            chip: `${t(side)} ${line}`,
            fairMargin: 0.03,
            errKey: 'mlbTeamTotal',
            label: `${teamName(game[team])} ${t(side)} ${line}`,
            shortLabel: `${teamName(game[team])} ${t(side)} ${line}`,
            fairChance: p,
            estOdds: Math.round((1 / (p * MLB_MARKET_OVERROUND)) * 100) / 100
          });
        }
      }
    }
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
    // MLB run lines (讓分): true chance from DraftKings; the price from the
    // lottery's own (shrunk) chance, which differs from the true one.
    if (game.sport === 'mlb' && game.spread) {
      for (const [i, { awayLine, fair, lottery }] of lotteryRunLines(game.spread.awayLine, game.spread.awayFair).entries()) {
        for (const side of ['away', 'home']) {
          const line = side === 'away' ? awayLine : -awayLine;
          const text = `${teamName(game[side])} ${line > 0 ? '+' : ''}${line}`;
          const p = side === 'away' ? fair : 1 - fair;
          const priced = side === 'away' ? lottery : 1 - lottery;
          bets.push({
            ...base,
            id: `${game.id}|rl|${line}|${side}`,
            kind: 'runline',
            market: `rl|${Math.abs(line)}`,
            marketLabel: `±${Math.abs(line)}`,
            chip: text,
            // DraftKings' own line has one source; the extra run adds model error.
            fairMargin: i === 0 ? 0.02 : 0.03,
            errKey: 'mlbRunLine',
            label: text,
            shortLabel: `${t('runLine')} ${text}`,
            fairChance: p,
            estOdds: Math.round((1 / (priced * MLB_MARKET_OVERROUND)) * 100) / 100
          });
        }
      }
    }
  }
  if (data.f1) {
    for (const d of data.f1.drivers) {
      bets.push({
        id: `f1|${d.name}`,
        gameId: 'f1',
        kind: 'f1',
        sport: 'f1',
        matchup: data.f1.title,
        start: data.f1.startUtc,
        label: `F1 ${d.name}`,
        shortLabel: d.name,
        driver: f1Driver(d.name),
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
  renderFutures();
  renderSim();
  renderF1();
}

function chip({ pressed, icon, text, count, onclick }) {
  return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed), onclick }, [
    icon ?? null,
    el('span', { text }),
    count ? el('span', { class: 'chip-count', text: count }) : null
  ]);
}

function renderSportFilter() {
  const t = state.t;
  const present = new Set([...state.bets, ...state.futures].map(b => b.sport));
  const sports = ['all', 'mlb', 'epl', 'nba', 'f1'].filter(s => s === 'all' || present.has(s));
  if (!sports.includes(state.sport)) state.sport = 'all';
  $('sport-filter').replaceChildren(
    ...sports.map(sport =>
      chip({
        pressed: sport === state.sport,
        icon: sport === 'all' ? null : leagueImg(sport, 'logo-xs'),
        text: t(`sport_${sport}`),
        onclick: () => {
          state.sport = sport;
          rerenderFiltered();
        }
      })
    )
  );
}

function renderDayFilter() {
  const days = [...new Set(state.bets.filter(b => inSport(b.sport)).map(b => dayKey(b.start)))].sort();
  if (!days.includes(state.day)) state.day = days[0] ?? null;
  const fmt = new Intl.DateTimeFormat(numberLocale(), { month: 'numeric', day: 'numeric', weekday: 'short' });
  $('day-filter').replaceChildren(
    ...days.map(day => {
      const games = state.data.games.filter(g => inSport(g.sport) && dayKey(g.startUtc) === day).length;
      const hasF1 = inSport('f1') && state.data.f1 && dayKey(state.data.f1.startUtc) === day;
      const [y, m, d] = day.split('-').map(Number);
      return chip({
        pressed: day === state.day,
        text: fmt.format(new Date(y, m - 1, d)),
        count: [games ? String(games) : null, hasF1 ? 'F1' : null].filter(Boolean).join('+'),
        onclick: () => {
          state.day = day;
          rerenderFiltered();
        }
      });
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
  const fallback = () => el('span', { class: `logo logo-fallback ${size}`, 'aria-hidden': 'true', text: (label || '?').slice(0, 2) });
  return logoPicture(teamLogo(sport, enName), teamLogo(sport, enName, true), `logo ${size}`, fallback);
}

// The league's logo; "all" and anything without one get a letter badge.
function leagueImg(sport, size = '') {
  const fallback = () => el('span', { class: `logo logo-fallback ${size}`, 'aria-hidden': 'true', text: sport === 'all' ? '∑' : sport.toUpperCase().slice(0, 3) });
  return logoPicture(leagueLogo(sport), leagueLogo(sport, true), `logo league ${size}`, fallback);
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
  for (const option of $('sim-weeks').options) option.textContent = t(`period_${option.value}`);
  $('footer').textContent = t('footer');
  for (const [id, key] of [
    ['ranking-title', 'rankingTitle'],
    ['games-title', 'gamesTitle'],
    ['futures-title', 'futuresTitle'],
    ['parlay-title', 'parlayTitle'],
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
    el('span', {}, [el('b', { text: t('backTiny', { v: '87' }) }), document.createTextNode(` ${t('legendBack')}`)]),
    el('span', { text: t('legendTap') }),
    el('details', { class: 'detail-only' }, [el('summary', { text: t('marginsHelpTitle') }), el('p', { text: t('marginsHelp') })])
  );
}

function renderStatus(kind) {
  const t = state.t;
  const status = $('status');
  if (kind === 'loading') status.textContent = t('loading');
  else if (kind === 'error') status.textContent = t('loadFailed');
  else status.textContent = `${t('updated')} ${fmtTime(state.data.loadedAt)} · DraftKings + Polymarket`;
  status.title = t('sources');
}

// ---- Ranking ------------------------------------------------------------------

function betIcon(bet) {
  if (bet.kind === 'f1') return driverBadge(bet, 'logo-sm');
  if (bet.kind === 'future') return logoImg(bet.sport, bet.teamEn, bet.shortLabel, 'logo-sm');
  const side = bet.side ?? (/\|(away|home)$/.exec(bet.id)?.[1] || /\|tt\|(away|home)\|/.exec(bet.id)?.[1]);
  if (bet.game && side) return logoImg(bet.sport, bet.game[side].en, teamName(bet.game[side]), 'logo-sm');
  return leagueImg(bet.sport, 'logo-sm');
}

function renderRanking() {
  const t = state.t;
  const list = $('ranking-list');
  const ranked = rankedBets();
  if (ranked.length === 0) {
    list.replaceChildren(el('li', { class: 'muted', text: t('noBets') }));
    return;
  }
  const scaleMax = Math.max(100, betReturn(ranked[0])) * 1.04;
  const best = betReturn(ranked[0]);
  const items = ranked.map((bet, i) => {
    const back = betReturn(bet);
    const context = bet.label.includes(bet.matchup) ? fmtTime(bet.start) : `${bet.matchup} · ${fmtTime(bet.start)}`;
    return el('li', { class: 'ranking-item' }, [
      el('span', { class: 'rank', text: String(i + 1) }),
      betIcon(bet),
      el('span', { class: 'rank-label' }, [
        document.createTextNode(`${bet.label} @ ${fmtOdds(effectiveOdds(bet))} `),
        hasRealOdds(bet) ? el('span', { class: 'tag tag-real', text: t('tagReal') }) : null,
        el('small', { text: ` ${context}` })
      ]),
      el('span', { class: `rank-value ${backClass(back)}` }, [document.createTextNode(fmtMoney(back, { sign: false })), marginEl(`±${Math.round(betBackMargin(bet))}`)]),
      el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
        el('div', { class: 'bar', style: `width:${(back / scaleMax) * 100}%` }),
        el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
      ])
    ]);
  });
  list.replaceChildren(...items);
  const tied = ranked.filter(b => best - betReturn(b) <= TIE_BAND).length;
  const notes = [];
  if (tied > 1) notes.push(`#1–#${tied}: ${t('tie')}`);
  if (!ranked.some(hasRealOdds)) notes.push(t('rankingEstimateNote'));
  const noteBox = list.parentElement.querySelector('.ranking-notes') || el('div', { class: 'ranking-notes' });
  noteBox.replaceChildren(...notes.map(text => el('p', { class: 'tie-note', text })));
  list.after(noteBox);
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
  return new Intl.DateTimeFormat(numberLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Taipei' }).format(new Date(iso));
}

// A game: its teams with logos and win picks; every other market folds away.
function gameCard(game, bets) {
  const t = state.t;
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
    return el('div', { class: 'team-row' }, [...who, bet ? pickButton(bet, '', editing) : null]);
  });
  const others = bets.filter(b => b.kind !== 'ml');
  const toggle = () => {
    if (state.open.has(game.id)) state.open.delete(game.id);
    else state.open.add(game.id);
    renderGames();
  };
  return el('article', { class: `game ${open ? 'open' : ''}` }, [
    el('div', { class: 'game-top' }, [
      leagueImg(game.sport, 'logo-xs'),
      el('span', { class: 'game-time', text: hhmm(game.startUtc) }),
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
  const markets = [];
  for (const s of SECTIONS.filter(s => s.kind !== 'ml')) {
    for (const options of groupBy(bets.filter(b => b.kind === s.kind), b => b.market).values()) {
      const label = options[0].marketLabel ? `${t(s.title)} ${options[0].marketLabel}` : t(s.title);
      // Without 詳細: the main total line and the 1.5 run line only.
      const extra = (s.kind === 'total' && !options[0].mainLine) || (s.kind === 'runline' && options[0].market !== 'rl|1.5');
      const head = el('div', { class: 'market-head' }, [el('span', { class: 'market-title', text: label }), el('span', { class: 'detail-only market-take' }, takePill(options))]);
      const picks = el('div', { class: 'market-picks' }, options.map(b => pickButton(b, b.chip ?? b.shortLabel, editing)));
      // The ten-way inning market folds away.
      markets.push(
        s.wide
          ? el('details', { class: 'market wide' }, [el('summary', {}, head), picks])
          : el('div', { class: `market ${extra ? 'detail-only' : ''}` }, [head, picks])
      );
    }
  }
  const sourceKey = game.draftKings && game.polymarket ? 'sourceBoth' : game.draftKings ? 'sourceDk' : 'sourcePm';
  const thin = sourceKey === 'sourcePm' && (game.polymarketLiquidity ?? 0) < THIN_LIQUIDITY;
  const notes = [];
  if (game.sport === 'epl') notes.push(t('soccerUnverified'));
  if (game.sport !== 'mlb' && game.total && game.total.line % 1 === 0) notes.push(t('wholeLine', { line: game.total.line, a: game.total.line - 0.5, b: game.total.line + 0.5 }));
  if (thin) notes.push(t('thin'));
  return el('div', { class: 'game-more' }, [
    markets.length ? el('div', { class: 'markets' }, markets) : null,
    el('div', { class: 'game-foot' }, [
      el('span', { class: 'detail-only', text: `${fmtTime(game.startUtc)} · ${t(sourceKey)}` }),
      editToggle(game.id, renderGames),
      notes.length ? el('details', { class: 'info detail-only' }, [el('summary', { text: t('notesTitle') }), ...notes.map(text => el('p', { text }))]) : null
    ])
  ]);
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
  { kind: 'inning', title: 'secTopInning', wide: true }
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
    el('span', { class: 'pick-sub', 'data-back': bet.id }, pickSub(bet))
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

// ---- Championships and F1: one board each -------------------------------------

function driverBadge(bet, size = '') {
  const initials = bet.shortLabel.split(/\s+/).filter(w => !/^jr\.?$/i.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase();
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
          el('small', { class: backClass(betReturn(bet)), text: t('backTiny', { v: Math.round(betReturn(bet)) }) })
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
  renderF1();
  renderFutures();
  renderParlay();
}

// Everything that can go on the slip: games, F1 and championships.
function slipCandidates() {
  return [...state.bets, ...state.futures];
}

// Championships have no start time: they stay open until the lottery closes them.
function started(bet) {
  return bet.start != null && Date.parse(bet.start) <= Date.now();
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
function slipAnalysisView(a, legs, ranges) {
  const t = state.t;
  const money = v => fmtMoney(v, { sign: false });
  const n = legs.length;
  const cards = [];

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
      el('details', { class: 'info detail-only' }, [el('summary', { text: t('slipRangeTitle') }), el('p', { text: t('slipRangeNote') })])
    ])
  );

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

  // The same ticket every week for a year.
  const y = a.year;
  const everyYears = a.top.chance > 0 ? 1 / (a.top.chance * y.weeks) : Infinity;
  cards.push(
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: t('anaYearTitle', { n: y.weeks }) }),
      el('div', { class: 'kpis' }, [
        statTile(t('anaYearAhead'), fmtChance(y.ahead), y.ahead < 0.5 ? 'back-low' : 'back-high', null, false, '🏁'),
        statTile(t('anaYearMedian'), fmtMoney(y.q50), y.q50 < 0 ? 'back-low' : 'back-high', t('anaYearRange', { lo: fmtMoney(y.q10), hi: fmtMoney(y.q90) }), false, '🧍'),
        statTile(t('anaYearExpected'), fmtMoney(y.expected), y.expected < 0 ? 'back-low' : 'back-high', null, true, '📉'),
        statTile(t('anaTopOdds'), t('anaOneIn', { n: fmtCount(1 / Math.max(a.top.chance, 1e-12)) }), '', everyYears > 1 ? t('anaTopWait', { y: everyYears < 10 ? everyYears.toFixed(1) : fmtCount(everyYears) }) : null, false, '🎰')
      ]),
      y.neverPaid > 0.01 ? el('p', { class: 'note', text: t('anaNeverPaid', { p: fmtChance(y.neverPaid), n: y.weeks }) }) : null
    ])
  );
  return cards;
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
          // The start time tells doubleheader games apart.
          el('span', { class: 'leg-main' }, [el('strong', { text: b.shortLabel }), el('small', { class: 'slip-leg-game', text: b.start ? `${b.matchup} · ${fmtTime(b.start)}` : b.matchup })]),
          el('span', { class: 'leg-odds', text: fmtOdds(effectiveOdds(b)) }),
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
    });
  }
  body.replaceChildren(el('div', { class: 'slip has-legs' }, [el('div', { class: 'card ticket' }, ticket), el('div', { class: 'slip-results' }, results)]));
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
      .map(b => ({ gameId: b.gameId, fairChance: b.fairChance, odds: effectiveOdds(b) }));
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
  return Math.round(n).toLocaleString(numberLocale());
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
function crowdStats(sportBets, weeks) {
  const key = crowdKey(sportBets, weeks);
  const startWeek = weekOfYear(new Date());
  if (crowdCache.has(key)) return Promise.resolve(crowdCache.get(key));
  if (crowdJob?.key === key) return crowdJob.promise;
  if (crowdJob) {
    worker?.terminate();
    worker = null;
    crowdJob.reject(new Error('cancelled'));
  }
  const label = () => state.t('loadingSim', { n: fmtCount(SIM_PLAYERS_SHOWN), period: state.t(`period_${weeks}`) });
  // At start-up the simulation is the second stage of one bar.
  const report = p => (state.booting ? showLoading(label(), BOOT_ODDS_SHARE + (1 - BOOT_ODDS_SHARE) * p) : showLoading(label(), p, 'sim'));
  report(0);
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  crowdJob = { key, promise, reject };
  const done = stats => {
    crowdCache.set(key, stats);
    crowdJob = null;
    hideLoading();
    resolve(stats);
  };
  try {
    worker ??= new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.id !== key) return;
      if (data.stats) done(data.stats);
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
    setTimeout(() => done(simulateCrowdStats({ sportPools, startWeek, weeks, perGroup: PER_GROUP, seed: SIM_SEED })), 30);
  }
  return promise;
}

function renderSim() {
  const t = state.t;
  const chart = $('sim-chart');
  const sportBets = simSportBets();
  const weeks = Number($('sim-weeks').value);
  const cached = crowdCache.get(crowdKey(sportBets, weeks));
  if (cached) {
    drawSim(cached, weeks);
    return Promise.resolve();
  }
  // Only run when someone will see it: on the simulator tab (or at start-up).
  if (state.tab !== 'sim' && !state.booting) return Promise.resolve();
  return crowdStats(sportBets, weeks).then(
    stats => {
      if (Number($('sim-weeks').value) === weeks) drawSim(stats, weeks);
    },
    () => {}
  );
}

function drawSim(stats, weeks) {
  const t = state.t;
  const period = t(`period_${weeks}`);
  const { bands, summaries, totals } = stats;
  const characters = CHARACTERS.map(c => ({ ...c, player: stats.characters[c.key] }));

  renderSimHeadline(totals, period);
  const back = totals.staked > 0 ? ((totals.staked + totals.net) / totals.staked) * 100 : 100;
  $('sim-stats').replaceChildren(
    statTile(t('simMedian'), fmtMoney(bands.at(-1).q50), bands.at(-1).q50 < 0 ? 'back-low' : '', null, false, '🧍'),
    statTile(t('simBackPer100'), fmtMoney(back, { sign: false }), back < 100 ? 'back-low' : '', null, false, '💸'),
    statTile(t('simEverAhead'), fmtShare(totals.everAheadShare), '', null, true, '📈'),
    statTile(t('simAhead'), fmtShare(totals.aheadShare), totals.aheadShare < 0.5 ? 'back-low' : '', null, false, '🏁')
  );
  $('sim-legend').replaceChildren(
    el('span', {}, [el('span', { class: 'legend-key band-outer' }), document.createTextNode(t('simBand80'))]),
    el('span', {}, [el('span', { class: 'legend-key band-inner' }), document.createTextNode(t('simBand50'))]),
    el('span', {}, [el('span', { class: 'legend-key thick', style: 'background:var(--text-secondary)' }), document.createTextNode(t('simMedianLine'))]),
    ...characters.map(c => el('span', {}, [el('span', { class: 'legend-key thick', style: `background:${c.color}` }), document.createTextNode(t(c.name))]))
  );
  drawSimChart($('sim-chart'), bands, characters, weeks);
  renderPlayers(characters);
  renderHabits(summaries);
  renderFans(stats.fanSummaries);
  renderFacts(totals, characters, summaries, period);
  renderStories(stats, period);
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
          el('span', { class: 'habit-tag detail-only', text: `${t('playerMaxStake')} ${fmtMoney(p.maxStake, { sign: false })}` })
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

// A fact as a big number and a short caption.
function factItem(value, caption) {
  return el('li', { class: 'fact' }, [value ? el('strong', { class: 'fact-value', text: value }) : null, el('span', { class: 'fact-text', text: caption })]);
}

function renderFacts(totals, characters, summaries, period) {
  const t = state.t;
  const money = v => fmtMoney(v, { sign: false });
  const facts = [];
  const by = key => summaries.find(h => h.habit.key === key);
  facts.push(factItem(`${money(by('casual').back)} → ${money(by('dreamer').back)}`, t('factParlay')));
  if (totals.everAheadShare > totals.aheadShare) facts.push(factItem(`${fmtShare(totals.everAheadShare)} → ${fmtShare(totals.aheadShare)}`, t('factEverAhead')));
  const chaser = by('chaser');
  if (chaser.capShare > 0) facts.push(factItem(fmtShare(chaser.capShare), t('factChaser', { cap: money(chaser.habit.chaseCap) })));
  const lucky = characters[0].player;
  if (lucky.biggestWin > 0) facts.push(factItem(t('inARow', { n: lucky.longestLosing }), t('factLucky')));
  const avgLoss = -totals.net / SIM_PLAYERS;
  if (avgLoss > 0) {
    const hours = (avgLoss / MIN_WAGE_HOURLY).toLocaleString(numberLocale(), { maximumFractionDigits: avgLoss < 10 * MIN_WAGE_HOURLY ? 1 : 0 });
    facts.push(factItem(t('hoursN', { n: hours }), t('factWage', { period, loss: money(avgLoss) })));
  }
  if (totals.net < 0) facts.push(factItem(money((-totals.net / totals.staked) * 100), t('factHouse')));
  else facts.push(factItem(null, t('factHouseWon')));
  $('sim-facts').replaceChildren(...facts);
}

// Record holders among the 100,000, by their number in the crowd: a big key
// number and one short line each. Then the crowd-wide truths behind them.
function renderStories(stats, period) {
  const t = state.t;
  const { notable, crowd } = stats;
  const money = v => fmtMoney(v, { sign: false });
  const who = p => (p.fan ? `${t(`fan_${p.fan.key}`)} · ${t(`habit_${p.habit.key}`)}` : t(`habit_${p.habit.key}`));
  const stories = [];
  const add = (icon, titleKey, p, big, line) => p && stories.push({ icon, title: t(titleKey), serial: `#${fmtCount(p.serial)}`, big, line: `${who(p)} · ${line}` });
  const w = notable.biggestWin;
  if (w) add('🎯', 'storyBigWinTitle', w, fmtMoney(w.biggestWin), t('storyBigWin', { week: w.biggestWinWeek + 1, stake: money(w.biggestWinStake), legs: w.biggestWinLegs, odds: fmtOdds(w.biggestWinOdds) }));
  const best = notable.best;
  // The biggest ticket often makes the biggest winner too, who without it
  // would have been losing: say so when it's true.
  const bestIsBigWin = best?.serial === w?.serial && best.final - best.biggestWin < 0;
  if (best) add('🏆', 'storyBestTitle', best, fmtMoney(best.final), t(bestIsBigWin ? 'storyBestSame' : 'storyBest', { tickets: fmtCount(best.tickets), staked: money(best.staked) }));
  const fall = notable.fall;
  if (fall) add('🎢', 'storyFallTitle', fall, `${fmtMoney(fall.peak)} → ${fmtMoney(fall.final)}`, t('storyFall', { week: fall.peakWeek + 1 }));
  const dry = notable.drought;
  if (dry) add('🧊', 'storyDroughtTitle', dry, t('inARow', { n: fmtCount(dry.longestLosing) }), t('storyDrought', { tickets: fmtCount(dry.tickets), won: fmtCount(dry.wonTickets) }));
  const worst = notable.worst;
  if (worst) add('💸', 'storyWorstTitle', worst, fmtMoney(worst.final), t('storyWorst', { staked: money(worst.staked), hours: fmtCount(-worst.final / MIN_WAGE_HOURLY) }));
  $('sim-stories').replaceChildren(
    // Three stories by default; the rest with 詳細 on.
    ...stories.map((s, i) =>
      el('li', { class: `story ${i >= 3 ? 'detail-only' : ''}` }, [
        el('span', { class: 'story-icon', 'aria-hidden': 'true', text: s.icon }),
        el('p', { class: 'story-title' }, [document.createTextNode(`${s.title} `), el('span', { class: 'story-serial', text: s.serial })]),
        el('p', { class: `story-big ${s.big.startsWith('−') ? 'back-low' : 'back-high'}`, text: s.big }),
        el('p', { class: 'story-text', text: s.line })
      ])
    )
  );
  const truths = [];
  if (crowd.winnings > 0) truths.push(factItem(`NT$${(crowd.losses / crowd.winnings).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })}`, t('truthRatio')));
  truths.push(crowd.top1 > 0 ? factItem(fmtMoney(crowd.top1), t('truthTop', { period })) : factItem(fmtMoney(crowd.top1), t('truthTopLosing', { period })));
  if (crowd.neverWonShare > 0) truths.push(factItem(fmtChance(crowd.neverWonShare), t('truthNeverWon', { period })));
  truths.push(factItem(null, t('truthSameOdds')));
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
}

// Longest the loading screen waits at start-up; after that the page opens and
// whatever is still loading finishes in the background.
const BOOT_LIMIT_MS = 45_000;

async function load() {
  renderStatus('loading');
  const booting = state.booting;
  const onProgress = booting ? p => showLoading(state.t('loading'), BOOT_ODDS_SHARE * p) : undefined;
  if (booting) onProgress(0);
  const limit = booting ? setTimeout(() => ((state.booting = false), hideLoading()), BOOT_LIMIT_MS) : null;
  $('refresh').disabled = true;
  try {
    state.data = await loadOdds(new Date(), onProgress);
    renderAll();
    // The page opens once the default simulation is ready too.
    if (state.booting) await renderSim();
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

const TABS = ['games', 'slip', 'sim', 'math'];

function tabAvailable(tab) {
  if (!state.data) return tab === 'games' || tab === 'math';
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
function renderPeriods() {
  const select = $('sim-weeks');
  $('sim-periods').replaceChildren(
    ...[...select.options].map(option =>
      el('button', {
        type: 'button',
        'aria-pressed': String(option.value === select.value),
        text: state.t(`periodShort_${option.value}`),
        onclick: () => {
          select.value = option.value;
          renderPeriods();
          renderSim();
        }
      })
    )
  );
}

function showTab(tab) {
  state.tab = tab;
  try {
    history.replaceState(null, '', `#${tab}`);
  } catch {}
  renderTabs();
  window.scrollTo({ top: 0 });
  // The chart sizes itself to its container, which is hidden until now.
  if (tab === 'sim' && state.data) renderSim();
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
$('sim-weeks').addEventListener('change', renderSim);
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

// Tells the page's failsafe (in index.html) that the scripts loaded and started.
window.__oddsStarted = true;
renderStatic();
renderTabs();
load();
