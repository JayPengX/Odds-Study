import {
  HABITS,
  K_DRAFTKINGS,
  blendOutcomes,
  FUTURES_OVERROUND,
  ODDS_ERROR,
  backMargin,
  estimateF1LotteryOdds,
  estimateFuturesOdds,
  estimateLotteryOdds,
  evaluateSlip,
  expectedReturn,
  habitPools,
  median,
  quantile,
  SLIP_RULES,
  choose,
  seededRandom,
  simulateCrowd,
  slipErrors,
  slipSizes,
  summarizeCrowd
} from './lib/odds.mjs';
import { loadOdds, taipeiDayKey } from './lib/sources.mjs';
import { detectLocale, makeT } from './lib/i18n.mjs';

const STAKE = 100;
// Simulated players per habit. Big enough that the results barely move
// between runs, so one fixed-seed run is shown.
const PER_HABIT = 500;
const SIM_PLAYERS = HABITS.length * PER_HABIT;
const SIM_SEED = 1;
const THIN_LIQUIDITY = 10_000;
const TIE_BAND = 2;
// Championship teams shown before the rest fold away.
const FUTURES_SHOWN = 6;
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
  sport: 'all',
  tab: 'games'
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
    if (total && total.line % 1 !== 0) {
      for (const side of ['over', 'under']) {
        const p = side === 'over' ? total.overFair : 1 - total.overFair;
        bets.push({
          ...base,
          id: `${game.id}|tot|${side}`,
          kind: 'total',
          fairMargin: null,
          errKey: game.sport,
          label: `${matchup} ${t(side)} ${total.line}`,
          shortLabel: `${t(side)} ${total.line}`,
          fairChance: p,
          estOdds: estimateLotteryOdds(p, K_DRAFTKINGS)
        });
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
    for (const b of bets) if (b.sport === sport && b.fairMargin == null) Object.assign(b, { fairMargin: typical, typicalMargin: true });
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

function renderSportFilter() {
  const t = state.t;
  const present = new Set([...state.bets, ...state.futures].map(b => b.sport));
  const sports = ['all', 'mlb', 'epl', 'nba', 'f1'].filter(s => s === 'all' || present.has(s));
  if (!sports.includes(state.sport)) state.sport = 'all';
  $('sport-filter').replaceChildren(
    ...sports.map(sport =>
      el('button', {
        class: 'ghost-button',
        type: 'button',
        'aria-pressed': String(sport === state.sport),
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
      const count = [games ? String(games) : null, hasF1 ? 'F1' : null].filter(Boolean).join(' + ');
      return el('button', {
        class: 'ghost-button',
        type: 'button',
        'aria-pressed': String(day === state.day),
        text: `${fmt.format(new Date(y, m - 1, d))} · ${count}`,
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

// ---- Rendering: static text ------------------------------------------------

function renderStatic() {
  const t = state.t;
  document.documentElement.lang = state.locale === 'zh' ? 'zh-Hant' : 'en';
  document.title = `${t('title')} · Odds Study`;
  $('title').textContent = t('title');
  $('subtitle').textContent = t('subtitle');
  $('notice').textContent = t('notice');
  $('refresh').textContent = t('refresh');
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
  $('math-body').replaceChildren(
    ...t('mathSteps').map(([h, p]) => el('div', { class: 'math-step' }, [el('h3', { text: h }), el('p', { text: p })]))
  );
}

function renderStatus(kind) {
  const t = state.t;
  if (kind === 'loading') $('status').textContent = t('loading');
  else if (kind === 'error') $('status').textContent = t('loadFailed');
  else $('status').textContent = `${t('updated')} ${fmtTime(state.data.loadedAt)} · ${t('sources')}`;
}

// ---- Ranking ------------------------------------------------------------------

function renderRanking() {
  const t = state.t;
  const list = $('ranking-list');
  const ranked = rankedBets();
  if (ranked.length === 0) {
    list.replaceChildren(el('li', { class: 'muted', text: t('noBets') }));
    return;
  }
  const top = ranked;
  const scaleMax = Math.max(100, betReturn(ranked[0])) * 1.04;
  const best = betReturn(ranked[0]);
  const hasReal = id => Number(state.userOdds[id]) >= 1.01;
  const items = ranked.map((bet, i) => {
    const back = betReturn(bet);
    const track = el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
      el('div', { class: 'bar', style: `width:${(back / scaleMax) * 100}%` }),
      el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
    ]);
    const context = bet.label.includes(bet.matchup) ? fmtTime(bet.start) : `${bet.matchup} · ${fmtTime(bet.start)}`;
    const tag = hasReal(bet.id) ? t('tagReal') : t('tagEstimated');
    return el('li', { class: 'ranking-item' }, [
      el('span', { class: 'rank', text: String(i + 1) }),
      el('span', { class: 'rank-label' }, [
        document.createTextNode(`${bet.label} @ ${fmtOdds(effectiveOdds(bet))} `),
        el('span', { class: `tag ${hasReal(bet.id) ? 'tag-real' : ''}`, text: tag }),
        el('small', { text: ` ${context}` })
      ]),
      el('span', { class: `rank-value ${backClass(back)}` }, [document.createTextNode(fmtMoney(back, { sign: false })), marginEl(`±${Math.round(betBackMargin(bet))}`)]),
      track
    ]);
  });
  list.replaceChildren(...items);
  const tied = top.filter(b => best - betReturn(b) <= TIE_BAND).length;
  const notes = [];
  if (tied > 1) notes.push(`#1–#${tied}: ${t('tie')}`);
  if (!ranked.some(b => hasReal(b.id))) notes.push(t('rankingEstimateNote'));
  const noteBox = list.parentElement.querySelector('.ranking-notes') || el('div', { class: 'ranking-notes' });
  noteBox.replaceChildren(...notes.map(text => el('p', { class: 'tie-note', text })));
  list.after(noteBox);
}

// ---- Games --------------------------------------------------------------------

function renderGames() {
  const t = state.t;
  const container = $('games-list');
  const games = state.data.games.filter(g => inSport(g.sport) && dayKey(g.startUtc) === state.day);
  if (games.length === 0) {
    container.replaceChildren(el('p', { class: 'muted', text: t('noBets') }));
    return;
  }
  const byGame = Map.groupBy ? Map.groupBy(state.bets, b => b.gameId) : groupBy(state.bets, b => b.gameId);
  container.replaceChildren(
    ...games
      .filter(g => byGame.get(g.id))
      .map(game => {
        const bets = byGame.get(game.id);
        const sourceKey = game.draftKings && game.polymarket ? 'sourceBoth' : game.draftKings ? 'sourceDk' : 'sourcePm';
        const thin = sourceKey === 'sourcePm' && (game.polymarketLiquidity ?? 0) < THIN_LIQUIDITY;
        const meta = `${t(`sport_${game.sport}`)} · ${fmtTime(game.startUtc)} · ${t(sourceKey)}${thin ? ` · ${t('thin')}` : ''}`;
        const notes = [];
        if (game.sport === 'epl') notes.push(el('p', { class: 'note', text: t('soccerUnverified') }));
        if (game.total && game.total.line % 1 === 0) {
          notes.push(el('p', { class: 'note', text: t('wholeLine', { line: game.total.line, a: game.total.line - 0.5, b: game.total.line + 0.5 }) }));
        }
        return el('article', { class: 'game' }, [
          el('div', { class: 'game-head' }, [
            el('span', { class: 'game-title', text: matchupText(game) }),
            el('span', { class: 'game-meta', text: meta })
          ]),
          betTable(bets),
          ...notes
        ]);
      })
  );
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

function betTable(bets) {
  const t = state.t;
  const head = el('thead', {}, el('tr', {}, [
    el('th', { text: t('colPick') }),
    el('th', { class: 'num', text: t('colFair') }),
    el('th', { class: 'num', text: t('colEst') }),
    el('th', { text: t('colReal') }),
    el('th', { class: 'num', text: t('colBack') }),
    el('th', {})
  ]));
  const rows = bets.map(bet => {
    const back = betReturn(bet);
    const input = el('input', {
      class: 'odds-input',
      type: 'number',
      inputmode: 'decimal',
      step: '0.01',
      min: '1.01',
      placeholder: fmtOdds(bet.estOdds),
      'aria-label': `${bet.label} ${t('colReal')}`,
      value: state.userOdds[bet.id] ?? null,
      oninput: event => onUserOdds(bet, event.target.value)
    });
    const inParlay = state.parlay.includes(bet.id);
    const legButton =
      bet.kind === 'f1' || bet.kind === 'future'
        ? null
        : el('button', {
            class: 'ghost-button leg-button',
            type: 'button',
            'aria-pressed': String(inParlay),
            text: inParlay ? t('removeLeg') : t('addLeg'),
            onclick: () => toggleLeg(bet)
          });
    return el('tr', {}, [
      el('td', { class: 'pick', text: bet.shortLabel }),
      el('td', { class: 'num', 'data-label': t('colFair') }, [
        document.createTextNode(fmtPct(bet.fairChance)),
        bet.fairMargin ? marginEl(`${fmtMarginPts(bet.fairMargin)}${bet.typicalMargin ? '*' : ''}`) : marginEl(t('oneSource'))
      ]),
      el('td', { class: 'num', 'data-label': t('colEst') }, [
        document.createTextNode(fmtOdds(bet.estOdds)),
        marginEl(`±${Math.round(ODDS_ERROR[bet.errKey].rel * 100)}%${ODDS_ERROR[bet.errKey].checked ? '' : '?'}`)
      ]),
      el('td', { 'data-label': t('colReal') }, input),
      el('td', { class: `num ${backClass(back)}`, 'data-label': t('colBack'), 'data-back': bet.id }, backCell(bet)),
      el('td', { 'data-label': '' }, legButton)
    ]);
  });
  return el('table', { class: 'bet-table' }, [head, el('tbody', {}, rows)]);
}

function backCell(bet) {
  return [document.createTextNode(fmtMoney(betReturn(bet), { sign: false })), marginEl(`±${Math.round(betBackMargin(bet))}`)];
}

function onUserOdds(bet, raw) {
  const value = Number(raw);
  if (raw === '' || !(value >= 1.01)) delete state.userOdds[bet.id];
  else state.userOdds[bet.id] = value;
  saveUserOdds();
  const cell = document.querySelector(`[data-back="${CSS.escape(bet.id)}"]`);
  if (cell) {
    cell.replaceChildren(...backCell(bet));
    cell.className = `num ${backClass(betReturn(bet))}`;
  }
  renderRanking();
  renderParlay();
  renderSim();
}

// ---- Futures ------------------------------------------------------------------

function renderFutures() {
  const t = state.t;
  const markets = Map.groupBy ? Map.groupBy(state.futures.filter(b => inSport(b.sport)), b => b.market) : groupBy(state.futures.filter(b => inSport(b.sport)), b => b.market);
  $('futures').hidden = markets.size === 0;
  $('futures-list').replaceChildren(
    ...[...markets.values()].map(bets => {
      const { market, matchup, sport } = bets[0];
      const notes = [];
      if (sport === 'nba') notes.push(el('p', { class: 'note', text: t('futureNbaNote') }));
      if (sport === 'epl') notes.push(el('p', { class: 'note', text: t('futureEplNote') }));
      const rest = bets.slice(FUTURES_SHOWN);
      return el('article', { class: 'game' }, [
        el('div', { class: 'game-head' }, [
          el('span', { class: 'game-title', text: matchup }),
          el('span', { class: 'game-meta', text: `${t('futureSettles')} ${t(`futureSettle_${market}`)}` })
        ]),
        betTable(bets.slice(0, FUTURES_SHOWN)),
        rest.length
          ? el('details', { class: 'table-view' }, [el('summary', { text: t('futureMore', { n: rest.length }) }), betTable(rest)])
          : null,
        ...notes
      ]);
    })
  );
}

// ---- Bet slip -----------------------------------------------------------------

function toggleLeg(bet) {
  if (state.parlay.includes(bet.id)) {
    state.parlay = state.parlay.filter(id => id !== bet.id);
  } else {
    // One pick per game: a new pick from the same game replaces the old one.
    const sameGame = state.bets.filter(b => b.gameId === bet.gameId).map(b => b.id);
    state.parlay = state.parlay.filter(id => !sameGame.includes(id));
    state.parlay.push(bet.id);
    if (state.parlay.length > SLIP_RULES.maxLegs) state.parlay.shift();
  }
  renderGames();
  renderParlay();
}

function started(bet) {
  return Date.parse(bet.start) <= Date.now();
}

// Picks on the slip. Games already under way are dropped: the page doesn't
// cover live (in-play) betting.
function slipLegs() {
  const legs = state.parlay.map(id => state.bets.find(b => b.id === id)).filter(Boolean);
  const live = legs.filter(started);
  if (live.length) state.parlay = state.parlay.filter(id => !live.some(b => b.id === id));
  return { legs: legs.filter(b => !started(b)), dropped: live.length };
}

function statTile(label, value, extraClass = '', range = null) {
  return el('div', { class: 'stat' }, [
    el('p', { class: 'stat-label', text: label }),
    el('p', { class: `stat-value ${extraClass}`, text: value }),
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

  const modeButtons = el('div', { class: 'button-row slip-modes', role: 'group', 'aria-label': t('slipMode') },
    ['single', 'parlay', 'system'].map(m =>
      el('button', {
        class: 'ghost-button',
        type: 'button',
        'aria-pressed': String(m === mode),
        text: t(`slipMode_${m}`),
        onclick: () => {
          state.slipMode = m;
          rerender();
        }
      })
    )
  );
  const parts = [modeButtons, el('p', { class: 'note', text: t(`slipModeNote_${mode}`) })];
  if (dropped) parts.push(el('p', { class: 'note back-low', text: t('slipDroppedLive', { n: dropped }) }));
  if (n === 0) {
    parts.push(el('p', { class: 'muted', text: t('parlayEmpty') }));
    body.replaceChildren(...parts);
    return;
  }

  parts.push(
    el('ul', { class: 'parlay-legs' },
      legs.map(b =>
        el('li', {}, [
          // The start time tells doubleheader games apart.
          el('span', {}, [el('strong', { text: b.shortLabel }), el('small', { class: 'slip-leg-game', text: `${b.matchup} · ${fmtTime(b.start)}` })]),
          el('span', { class: 'slip-leg-right' }, [
            el('span', { class: 'num', text: fmtOdds(effectiveOdds(b)) }),
            el('button', { class: 'ghost-button leg-button', type: 'button', 'aria-label': t('removeLeg'), text: '×', onclick: () => toggleLeg(b) })
          ])
        ])
      )
    )
  );

  if (mode === 'system' && n >= 3) {
    const options = [...Array.from({ length: n - 2 }, (_, i) => i + 2), 'all'];
    parts.push(
      el('div', { class: 'slip-sizes', role: 'group', 'aria-label': t('slipSizes') },
        options.map(k => {
          const size = k === 'all' ? n : k;
          const on = state.slipSizes.has(k);
          return el('button', {
            class: 'ghost-button leg-button',
            type: 'button',
            'aria-pressed': String(on),
            text: `${sizeName(size, n)} · ${t(choose(n, size) === 1 ? 'slipCombo1' : 'slipCombos', { n: choose(n, size) })}`,
            onclick: () => {
              if (on) state.slipSizes.delete(k);
              else state.slipSizes.add(k);
              rerender();
            }
          });
        })
      )
    );
  }

  const stakeInput = el('input', {
    class: 'odds-input slip-stake',
    type: 'number',
    inputmode: 'numeric',
    min: String(SLIP_RULES.unit),
    step: String(SLIP_RULES.unit),
    value: String(stake),
    'aria-label': t('slipStake'),
    onchange: event => {
      const value = Math.max(0, Math.round(Number(event.target.value) || 0));
      if (value === state.slipStake) return;
      state.slipStake = value;
      // Redraw after the event: redrawing removes this input, and removing a
      // focused input fires another change while the first is still running.
      setTimeout(rerender);
    }
  });
  parts.push(el('label', { class: 'slip-stake-row' }, [el('span', { text: t('slipStake') }), stakeInput, el('small', { class: 'muted', text: t('slipStakeHint') })]));

  if (errors.length) {
    parts.push(el('ul', { class: 'slip-errors' }, errors.map(e => el('li', { text: t(`slipError_${e}`, { max: SLIP_RULES.maxLegs, min: fmtMoney(SLIP_RULES.minTicket, { sign: false }), maxTicket: fmtMoney(SLIP_RULES.maxTicket, { sign: false }), unit: SLIP_RULES.unit }) }))));
  }
  if (sizes.length && !errors.includes('stakeUnit')) {
    const r = evaluateSlip({ legs: slip, sizes, stake });
    const backPer100 = r.cost > 0 ? (r.expectedNet / r.cost) * 100 : 0;
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
    const range = (a, b, fmt) => `${fmt(Math.min(a, b))} – ${fmt(Math.max(a, b))}`;
    parts.push(
      el('div', { class: 'stat-row' }, [
        statTile(t('slipCombosTotal'), `${fmtCount(r.combos)} × ${fmtMoney(stake, { sign: false })}`),
        statTile(t('slipCost'), fmtMoney(r.cost, { sign: false })),
        statTile(t('slipBest'), fmtMoney(r.best, { sign: false }), 'back-high'),
        statTile(t('slipExpected'), fmtMoney(r.expectedNet, { sign: false }), backPer100 < 100 ? 'back-low' : 'back-high', range(low.expectedNet, high.expectedNet, v => fmtMoney(v, { sign: false }))),
        statTile(t('slipAny'), fmtChance(r.anyPayout), '', range(low.anyPayout, high.anyPayout, fmtChance)),
        statTile(t('slipProfit'), fmtChance(r.profit), r.profit < 0.5 ? 'back-low' : '', range(low.profit, high.profit, fmtChance))
      ]),
      el('p', { class: 'note', text: t('slipExpectedNote', { back: fmtMoney(backPer100, { sign: false }), gross: fmtMoney(r.expected, { sign: false }) }) }),
      el('p', { class: 'note', text: t('slipRangeNote') })
    );
    parts.push(
      el('div', { class: 'table-view slip-table' }, [
        el('table', {}, [
          el('thead', {}, el('tr', {}, [t('slipHits'), t('slipHitsChance'), t('slipHitsPayout')].map(h => el('th', { text: h })))),
          el('tbody', {},
            [...r.byHits].reverse().map(row =>
              el('tr', {}, [
                el('td', { text: t('slipHitsN', { k: row.hits, n }) }),
                el('td', { text: fmtChance(row.chance) }),
                el('td', { class: row.max > r.cost ? 'back-high' : row.max === 0 ? 'muted' : '', text: row.max === 0 ? '—' : row.min === row.max ? fmtMoney(row.max, { sign: false }) : `${fmtMoney(row.min, { sign: false })} – ${fmtMoney(row.max, { sign: false })}` })
              ])
            )
          )
        ])
      ])
    );
  }
  parts.push(
    el('p', { class: 'note', text: t('slipRulesNote') }),
    el('div', { class: 'button-row' }, [
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
    ])
  );
  body.replaceChildren(...parts);
}

// ---- Simulator ----------------------------------------------------------------

// Every bet on the board (all days) is a stand-in for the games of a typical
// week. F1 joins only when it's the chosen sport: a race isn't parlayed with
// ball games.
function simPool() {
  const onlyF1 = state.sport === 'f1';
  return state.bets
    .filter(b => inSport(b.sport) && (onlyF1 || b.kind !== 'f1'))
    .map(b => ({ gameId: b.gameId, fairChance: b.fairChance, odds: effectiveOdds(b) }));
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
  { q: 0.9, name: 'simLucky', rank: 'simLuckyRank', color: 'var(--good)' },
  { q: 0.5, name: 'simTypical', rank: 'simTypicalRank', color: 'var(--series-1)' },
  { q: 0.1, name: 'simUnlucky', rank: 'simUnluckyRank', color: 'var(--bad)' }
];

function fmtShare(p) {
  if (p === 0) return '0%';
  if (p < 0.01) return '<1%';
  return `${Math.round(p * 100)}%`;
}

function fmtCount(n) {
  return Math.round(n).toLocaleString(numberLocale());
}

// The crowd is the slow part, so it's kept until the pool or the period
// changes (a resize or a language switch only redraws).
let crowdCache = { key: null, value: null };

function simulate(pool, weeks) {
  const pools = habitPools(pool);
  const key = JSON.stringify([weeks, pools.any.map(b => [b.gameId, b.fairChance, b.odds])]);
  if (crowdCache.key === key) return crowdCache.value;
  const players = simulateCrowd({ pools, weeks, perHabit: PER_HABIT, random: seededRandom(SIM_SEED) });
  const byFinal = [...players].sort((a, b) => a.final - b.final);
  // The crowd's spread, week by week: 10th, 25th, 50th, 75th, 90th percentile.
  const bands = Array.from({ length: weeks }, (_, w) => {
    const values = players.map(p => p.path[w]).sort((a, b) => a - b);
    return {
      q10: quantile(values, 0.1),
      q25: quantile(values, 0.25),
      q50: quantile(values, 0.5),
      q75: quantile(values, 0.75),
      q90: quantile(values, 0.9),
      ahead: values.filter(v => v > 0).length
    };
  });
  const value = {
    players,
    bands,
    summaries: summarizeCrowd(players),
    characters: CHARACTERS.map(c => ({ ...c, player: byFinal[Math.round((byFinal.length - 1) * c.q)] }))
  };
  crowdCache = { key, value };
  return value;
}

function renderSim() {
  const t = state.t;
  const chart = $('sim-chart');
  const parts = ['sim-headline', 'sim-stats', 'sim-legend', 'sim-players', 'sim-habits', 'sim-facts', 'sim-table'];
  const pool = simPool();
  if (pool.length === 0) {
    for (const id of parts) $(id).replaceChildren();
    chart.replaceChildren(el('p', { class: 'muted', text: t('noBets') }));
    return;
  }
  const weeks = Number($('sim-weeks').value);
  const period = t(`period_${weeks}`);
  const { players, bands, summaries, characters } = simulate(pool, weeks);
  const endedAhead = players.filter(p => p.final > 0).length / SIM_PLAYERS;
  const everAhead = players.filter(p => p.everAhead).length / SIM_PLAYERS;

  renderSimHeadline(players, period);
  $('sim-stats').replaceChildren(
    statTile(t('simMedian'), fmtMoney(bands.at(-1).q50), bands.at(-1).q50 < 0 ? 'back-low' : ''),
    statTile(t('simEverAhead'), fmtShare(everAhead)),
    statTile(t('simAhead'), fmtShare(endedAhead), endedAhead < 0.5 ? 'back-low' : '')
  );
  $('sim-legend').replaceChildren(
    el('span', {}, [el('span', { class: 'legend-key band-outer' }), document.createTextNode(t('simBand80'))]),
    el('span', {}, [el('span', { class: 'legend-key band-inner' }), document.createTextNode(t('simBand50'))]),
    el('span', {}, [el('span', { class: 'legend-key thick', style: 'background:var(--text-secondary)' }), document.createTextNode(t('simMedianLine'))]),
    ...characters.map(c => el('span', {}, [el('span', { class: 'legend-key thick', style: `background:${c.color}` }), document.createTextNode(t(c.name))]))
  );
  drawSimChart(chart, bands, characters, weeks);
  renderPlayers(characters);
  renderHabits(summaries, period);
  renderFacts(players, characters, summaries, { period, endedAhead, everAhead });
  renderSimTable(bands, characters, weeks);
}

function renderSimHeadline(players, period) {
  const t = state.t;
  const share = players.filter(p => p.final > 0).length / players.length;
  const staked = players.reduce((s, p) => s + p.staked, 0);
  const net = players.reduce((s, p) => s + p.final, 0);
  const tickets = players.reduce((s, p) => s + p.tickets, 0) / players.length;
  const inTen = Math.round(share * 10);
  const back = staked > 0 ? ((staked + net) / staked) * 100 : 100;
  const shareMargin = 1.96 * Math.sqrt((share * (1 - share)) / players.length);
  $('sim-headline').replaceChildren(
    el('p', { class: 'headline-label', text: t('simHeadlineLabel', { period, n: fmtCount(SIM_PLAYERS) }) }),
    el('p', { class: 'headline-big' }, [
      document.createTextNode(t('simHeadlinePre')),
      el('strong', { class: share >= 0.5 ? 'good' : '', text: inTen === 0 ? t('simHeadlineNone') : t('simHeadlineShare', { n: inTen }) }),
      document.createTextNode(t('simHeadlinePost'))
    ]),
    el('p', {
      class: 'headline-sub',
      text: t('simHeadlineSub', { tickets: fmtCount(tickets), staked: fmtMoney(staked / players.length, { sign: false }), back: fmtMoney(back, { sign: false }) })
    }),
    el('p', { class: 'headline-sub margin-note', text: t('simMarginNote', { share: fmtShare(share), margin: Math.max(1, Math.round(shareMargin * 100)) }) })
  );
}

function renderPlayers(characters) {
  const t = state.t;
  $('sim-players').replaceChildren(
    ...characters.map(({ name, rank, color, player: p }) => {
      let tale;
      if (p.final > 0) tale = t('taleAhead', { habit: t(`habit_${p.habit.key}`) });
      else if (!p.everAhead) tale = t('taleNever');
      else tale = t('taleGaveBack', { peak: fmtMoney(p.peak, { sign: false }), at: fmtCount(p.peakWeek + 1) });
      const line = (label, value) => el('div', { class: 'player-line' }, [el('span', { text: label }), el('strong', { text: value })]);
      return el('article', { class: 'player', style: `--player:${color}` }, [
        el('p', { class: 'player-name' }, [document.createTextNode(t(name)), el('span', { class: 'habit-tag', text: t(`habit_${p.habit.key}`) })]),
        el('p', { class: 'player-rank', text: t(rank) }),
        el('p', { class: `player-final ${p.final < 0 ? 'back-low' : 'back-high'}`, text: fmtMoney(p.final) }),
        el('p', { class: 'player-tale', text: tale }),
        line(t('playerTickets'), `${fmtCount(p.wonTickets)} / ${fmtCount(p.tickets)}`),
        line(t('playerStaked'), fmtMoney(p.staked, { sign: false })),
        line(t('playerMaxStake'), fmtMoney(p.maxStake, { sign: false })),
        line(t('playerBiggestWin'), p.biggestWin > 0 ? fmtMoney(p.biggestWin) : t('playerNoWin')),
        line(t('playerPeak'), p.everAhead ? `${fmtMoney(p.peak)} · ${t('simWeekN', { n: fmtCount(p.peakWeek + 1) })}` : t('playerNeverAhead')),
        line(t('playerStreak'), t('inARow', { n: p.longestLosing })),
        line(t('playerDrop'), fmtMoney(-p.maxDrop))
      ]);
    })
  );
}

function renderHabits(summaries, period) {
  const t = state.t;
  $('habits-intro').textContent = t('habitsIntro', { n: fmtCount(PER_HABIT), period });
  const sorted = [...summaries].sort((a, b) => b.back - a.back);
  const scaleMax = Math.max(100, sorted[0].back) * 1.04;
  $('sim-habits').replaceChildren(
    ...sorted.map(h =>
      el('li', { class: 'ranking-item habit-item' }, [
        el('span', { class: 'rank-label' }, [
          el('strong', { text: t(`habit_${h.habit.key}`) }),
          el('small', { text: ` ${t(`habitDesc_${h.habit.key}`)}` })
        ]),
        el('span', { class: `rank-value ${backClass(h.back)}` }, [document.createTextNode(fmtMoney(h.back, { sign: false })), marginEl(`±${Math.max(1, Math.round(h.backMargin))}`)]),
        el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
          el('div', { class: 'bar', style: `width:${(h.back / scaleMax) * 100}%` }),
          el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
        ]),
        el('span', {
          class: 'habit-meta',
          text: t('habitMeta', { ahead: `${fmtShare(h.aheadShare)} ±${Math.max(1, Math.round(h.aheadMargin * 100))}`, staked: fmtMoney(h.avgStaked, { sign: false }), final: fmtMoney(h.avgFinal) })
        })
      ])
    )
  );
}

function renderFacts(players, characters, summaries, { period, endedAhead, everAhead }) {
  const t = state.t;
  const facts = [];
  const by = key => summaries.find(h => h.habit.key === key);
  facts.push(t('factParlay', { two: fmtMoney(by('casual').back, { sign: false }), many: fmtMoney(by('dreamer').back, { sign: false }) }));
  if (everAhead > endedAhead) facts.push(t('factEverAhead', { ever: fmtShare(everAhead), ended: fmtShare(endedAhead) }));
  const chasers = players.filter(p => p.habit.key === 'chaser');
  const cap = chasers[0].habit.chaseCap;
  const hitCap = chasers.filter(p => p.maxStake >= cap).length / chasers.length;
  if (hitCap > 0) facts.push(t('factChaser', { share: fmtShare(hitCap), cap: fmtMoney(cap, { sign: false }), staked: fmtMoney(by('chaser').avgStaked, { sign: false }), final: fmtMoney(by('chaser').avgFinal) }));
  const lucky = characters[0].player;
  if (lucky.biggestWin > 0) facts.push(t('factLucky', { win: fmtMoney(lucky.biggestWin, { sign: false }), streak: lucky.longestLosing }));
  const avgLoss = -players.reduce((s, p) => s + p.final, 0) / players.length;
  if (avgLoss > 0) {
    facts.push(t('factWage', { period, loss: fmtMoney(avgLoss, { sign: false }), hours: (avgLoss / MIN_WAGE_HOURLY).toLocaleString(numberLocale(), { maximumFractionDigits: avgLoss < 10 * MIN_WAGE_HOURLY ? 1 : 0 }), wage: MIN_WAGE_HOURLY }));
  }
  const net = players.reduce((s, p) => s + p.final, 0);
  const staked = players.reduce((s, p) => s + p.staked, 0);
  facts.push(t(net < 0 ? 'factHouse' : 'factHouseWon', { total: fmtCount(SIM_PLAYERS), staked: fmtMoney(staked, { sign: false }), net: fmtMoney(Math.abs(net), { sign: false }), kept: fmtMoney((-net / staked) * 100, { sign: false }) }));
  $('sim-facts').replaceChildren(...facts.map(f => el('li', { text: f })));
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

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('chartLabel', { n: fmtCount(SIM_PLAYERS) }) });
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
  const hit = svgEl('rect', { class: 'hit', x: m.left, y: m.top, width: w, height: h, tabindex: '0', 'aria-label': t('chartLabel', { n: fmtCount(SIM_PLAYERS) }) });
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

function renderF1() {
  const t = state.t;
  const body = $('f1-body');
  const f1 = state.data.f1;
  $('f1').hidden = !inSport('f1');
  if (!f1) {
    body.replaceChildren(el('p', { class: 'muted', text: t('f1None') }));
    return;
  }
  const bets = state.bets.filter(b => b.kind === 'f1').slice(0, 10);
  const table = betTable(bets);
  table.querySelector('th').textContent = t('colDriver');
  body.replaceChildren(el('p', { class: 'game-meta', text: `${f1.title} · ${fmtTime(f1.startUtc)}` }), table);
}

// ---- Boot ---------------------------------------------------------------------

function renderAll() {
  renderStatic();
  if (!state.data) return;
  state.bets = buildBets(state.data);
  state.futures = buildFutures(state.data);
  state.parlay = state.parlay.filter(id => state.bets.some(b => b.id === id));
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

async function load() {
  renderStatus('loading');
  $('refresh').disabled = true;
  try {
    state.data = await loadOdds();
    renderAll();
  } catch (error) {
    console.error(error);
    renderStatus('error');
  } finally {
    $('refresh').disabled = false;
  }
}

// ---- Tabs ---------------------------------------------------------------------

const TABS = ['games', 'futures', 'f1', 'slip', 'sim', 'math'];

function tabAvailable(tab) {
  if (!state.data) return tab === 'games' || tab === 'math';
  if (tab === 'futures') return state.futures.some(b => inSport(b.sport));
  if (tab === 'f1') return Boolean(state.data.f1) && inSport('f1');
  return true;
}

function renderTabs() {
  const t = state.t;
  if (!tabAvailable(state.tab)) state.tab = 'games';
  const legs = state.parlay.length;
  $('tab-slip').textContent = legs ? `${t('tab_slip')} (${legs})` : t('tab_slip');
  for (const tab of TABS) {
    const button = $(`tab-${tab}`);
    button.hidden = !tabAvailable(tab);
    button.setAttribute('aria-selected', String(tab === state.tab));
    button.tabIndex = tab === state.tab ? 0 : -1;
    $(`panel-${tab}`).hidden = tab !== state.tab;
  }
}

function showTab(tab) {
  state.tab = tab;
  try {
    history.replaceState(null, '', `#${tab}`);
  } catch {}
  renderTabs();
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

renderStatic();
renderTabs();
load();
