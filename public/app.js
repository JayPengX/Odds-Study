import {
  HABITS,
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
  expectedReturn,
  habitPools,
  lotteryTotalLines,
  lotteryRunLines,
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

const STAKE = 100;
// Simulated players per habit. Big enough that the results barely move
// between runs, so one fixed-seed run is shown.
const PER_HABIT = Math.ceil(100_000 / HABITS.length);
const SIM_PLAYERS = HABITS.length * PER_HABIT;
const SIM_SEED = 1;
// Shown as a round "100,000".
const SIM_PLAYERS_SHOWN = Math.round(SIM_PLAYERS / 1000) * 1000;
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
  // True until the first simulation is ready: the loading screen covers the page.
  booting: true,
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
        if (game.sport !== 'mlb' && game.total && game.total.line % 1 === 0) {
          notes.push(el('p', { class: 'note', text: t('wholeLine', { line: game.total.line, a: game.total.line - 0.5, b: game.total.line + 0.5 }) }));
        }
        return el('article', { class: 'game' }, [
          el('div', { class: 'game-head' }, [
            el('span', { class: 'game-title', text: matchupText(game) }),
            el('span', { class: 'game-meta', text: meta })
          ]),
          betTable(bets),
          takeNote([
            takeText(bets.filter(b => b.kind === 'ml'), 'takeMoneyline'),
            // Each total line is its own market; they share one take, so show the first.
            ...(bets.some(b => b.kind === 'total') ? [takeText(bets.filter(b => b.kind === 'total' && b.totalLine === bets.find(x => x.kind === 'total').totalLine), 'takeTotal')] : []),
            ...(bets.some(b => b.kind === 'runline') ? [takeText(bets.filter(b => b.kind === 'runline').slice(0, 2), 'takeRunLine')] : [])
          ]),
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
        marginEl(`±${fmtOdds(bet.estOdds * ODDS_ERROR[bet.errKey].rel)}${ODDS_ERROR[bet.errKey].checked ? '' : '?'}`)
      ]),
      el('td', { 'data-label': t('colReal') }, input),
      el('td', { class: `num ${backClass(back)}`, 'data-label': t('colBack'), 'data-back': bet.id }, backCell(bet)),
      el('td', { 'data-label': '' }, legButton)
    ]);
  });
  return el('table', { class: 'bet-table' }, [head, el('tbody', {}, rows)]);
}

// "Estimated house take: 13% ±2" for one market (all its outcomes).
function takeText(bets, labelKey) {
  const { take, margin } = houseTake(bets.map(effectiveOdds), bets.map(oddsError));
  const pct = `${Math.round(take * 100)}%${margin >= 0.005 ? ` ±${Math.max(1, Math.round(margin * 100))}` : ''}`;
  return labelKey ? `${state.t(labelKey)} ${pct}` : pct;
}

function takeNote(parts) {
  return el('p', { class: 'note take-note', text: `${state.t('takeLabel')}：${parts.join(' · ')}` });
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
        takeNote([takeText(bets)]),
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
        statTile(t('slipProfit'), fmtChance(r.profit), r.profit < 0.5 ? 'back-low' : '', range(low.profit, high.profit, fmtChance)),
        // The house's share of the ticket (what the average leaves behind), then with Taiwan's tax on top.
        statTile(t('slipTake'), fmtPct(1 - r.expected / r.cost), '', range(1 - high.expected / r.cost, 1 - low.expected / r.cost, fmtPct)),
        statTile(t('slipTakeTax'), fmtPct(1 - r.expectedNet / r.cost), 'back-low', range(1 - high.expectedNet / r.cost, 1 - low.expectedNet / r.cost, fmtPct))
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
    // One total line per game (the main one), like the lottery's own balance of bets.
    .filter(b => inSport(b.sport) && (onlyF1 || b.kind !== 'f1') && (b.kind !== 'total' || b.mainLine) && b.kind !== 'runline')
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
  { key: 'best', name: 'simLucky', rank: 'simLuckyRank', color: 'var(--good)' },
  { key: 'median', name: 'simTypical', rank: 'simTypicalRank', color: 'var(--series-1)' },
  { key: 'worst', name: 'simUnlucky', rank: 'simUnluckyRank', color: 'var(--bad)' }
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

function crowdKey(pool, weeks) {
  return JSON.stringify([weeks, pool.map(b => [b.gameId, b.fairChance, b.odds])]);
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
function crowdStats(pool, weeks) {
  const key = crowdKey(pool, weeks);
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
    worker.postMessage({ id: key, pool, weeks, perHabit: PER_HABIT, seed: SIM_SEED });
  } catch {
    runHere();
  }
  // No worker (very old browser): run here after the loading screen paints.
  function runHere() {
    setTimeout(() => done(simulateCrowdStats({ pools: habitPools(pool), weeks, perHabit: PER_HABIT, seed: SIM_SEED })), 30);
  }
  return promise;
}

function renderSim() {
  const t = state.t;
  const chart = $('sim-chart');
  const parts = ['sim-headline', 'sim-stats', 'sim-legend', 'sim-players', 'sim-habits', 'sim-facts', 'sim-table'];
  const pool = simPool();
  if (pool.length === 0) {
    for (const id of parts) $(id).replaceChildren();
    chart.replaceChildren(el('p', { class: 'muted', text: t('noBets') }));
    return Promise.resolve();
  }
  const weeks = Number($('sim-weeks').value);
  const cached = crowdCache.get(crowdKey(pool, weeks));
  if (cached) {
    drawSim(cached, weeks);
    return Promise.resolve();
  }
  // Only run when someone will see it: on the simulator tab (or at start-up).
  if (state.tab !== 'sim' && !state.booting) return Promise.resolve();
  return crowdStats(pool, weeks).then(
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
  $('sim-stats').replaceChildren(
    statTile(t('simMedian'), fmtMoney(bands.at(-1).q50), bands.at(-1).q50 < 0 ? 'back-low' : ''),
    statTile(t('simEverAhead'), fmtShare(totals.everAheadShare)),
    statTile(t('simAhead'), fmtShare(totals.aheadShare), totals.aheadShare < 0.5 ? 'back-low' : '')
  );
  $('sim-legend').replaceChildren(
    el('span', {}, [el('span', { class: 'legend-key band-outer' }), document.createTextNode(t('simBand80'))]),
    el('span', {}, [el('span', { class: 'legend-key band-inner' }), document.createTextNode(t('simBand50'))]),
    el('span', {}, [el('span', { class: 'legend-key thick', style: 'background:var(--text-secondary)' }), document.createTextNode(t('simMedianLine'))]),
    ...characters.map(c => el('span', {}, [el('span', { class: 'legend-key thick', style: `background:${c.color}` }), document.createTextNode(t(c.name))]))
  );
  drawSimChart($('sim-chart'), bands, characters, weeks);
  renderPlayers(characters);
  renderHabits(summaries, period);
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
  $('sim-headline').replaceChildren(
    el('p', { class: 'headline-label', text: t('simHeadlineLabel', { period, n: fmtCount(SIM_PLAYERS_SHOWN) }) }),
    el('p', { class: 'headline-big' }, [
      document.createTextNode(t('simHeadlinePre')),
      el('strong', { class: share >= 0.5 ? 'good' : '', text: inTen === 0 ? t('simHeadlineNone') : t('simHeadlineShare', { n: inTen }) }),
      document.createTextNode(t('simHeadlinePost'))
    ]),
    el('p', {
      class: 'headline-sub',
      text: t('simHeadlineSub', { tickets: fmtCount(tickets), staked: fmtMoney(staked / SIM_PLAYERS, { sign: false }), back: fmtMoney(back, { sign: false }) })
    }),
    el('p', { class: 'headline-sub margin-note', text: t('simMarginNote', { share: fmtShare(share), n: fmtCount(SIM_PLAYERS_SHOWN), margin: (shareMargin * 100).toFixed(1) }) })
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
  $('habits-intro').textContent = t('habitsIntro', { n: fmtCount(Math.round(PER_HABIT / 100) * 100), period });
  const sorted = [...summaries].sort((a, b) => b.back - a.back);
  const scaleMax = Math.max(100, sorted[0].back) * 1.04;
  $('sim-habits').replaceChildren(
    ...sorted.map(h =>
      el('li', { class: 'ranking-item habit-item' }, [
        el('span', { class: 'rank-label' }, [
          el('strong', { text: t(`habit_${h.habit.key}`) }),
          el('small', { text: ` ${t(`habitDesc_${h.habit.key}`)}` })
        ]),
        el('span', { class: `rank-value ${backClass(h.back)}` }, [document.createTextNode(fmtMoney(h.back, { sign: false })), marginEl(`±${h.backMargin.toFixed(1)}`)]),
        el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
          el('div', { class: 'bar', style: `width:${(h.back / scaleMax) * 100}%` }),
          el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
        ]),
        el('span', {
          class: 'habit-meta',
          text: t('habitMeta', { ahead: `${fmtShare(h.aheadShare)} ±${(h.aheadMargin * 100).toFixed(1)}`, staked: fmtMoney(h.avgStaked, { sign: false }), final: fmtMoney(h.avgFinal) })
        })
      ])
    )
  );
}

function renderFacts(totals, characters, summaries, period) {
  const t = state.t;
  const facts = [];
  const by = key => summaries.find(h => h.habit.key === key);
  facts.push(t('factParlay', { two: fmtMoney(by('casual').back, { sign: false }), many: fmtMoney(by('dreamer').back, { sign: false }) }));
  if (totals.everAheadShare > totals.aheadShare) facts.push(t('factEverAhead', { ever: fmtShare(totals.everAheadShare), ended: fmtShare(totals.aheadShare) }));
  const chaser = by('chaser');
  if (chaser.capShare > 0) facts.push(t('factChaser', { share: fmtShare(chaser.capShare), cap: fmtMoney(chaser.habit.chaseCap, { sign: false }), staked: fmtMoney(chaser.avgStaked, { sign: false }), final: fmtMoney(chaser.avgFinal) }));
  const lucky = characters[0].player;
  if (lucky.biggestWin > 0) facts.push(t('factLucky', { win: fmtMoney(lucky.biggestWin, { sign: false }), streak: lucky.longestLosing }));
  const avgLoss = -totals.net / SIM_PLAYERS;
  if (avgLoss > 0) {
    facts.push(t('factWage', { period, loss: fmtMoney(avgLoss, { sign: false }), hours: (avgLoss / MIN_WAGE_HOURLY).toLocaleString(numberLocale(), { maximumFractionDigits: avgLoss < 10 * MIN_WAGE_HOURLY ? 1 : 0 }), wage: MIN_WAGE_HOURLY }));
  }
  facts.push(t(totals.net < 0 ? 'factHouse' : 'factHouseWon', { total: fmtCount(SIM_PLAYERS_SHOWN), staked: fmtMoney(totals.staked, { sign: false }), net: fmtMoney(Math.abs(totals.net), { sign: false }), kept: fmtMoney((-totals.net / totals.staked) * 100, { sign: false }) }));
  $('sim-facts').replaceChildren(...facts.map(f => el('li', { text: f })));
}

// Record holders among the 100,000, by their number in the crowd, and the
// crowd-wide truths behind them.
function renderStories(stats, period) {
  const t = state.t;
  const { notable, crowd } = stats;
  const money = v => fmtMoney(v, { sign: false });
  const who = p => ({ serial: `#${fmtCount(p.serial)}`, habit: t(`habit_${p.habit.key}`) });
  const stories = [];
  const add = (icon, titleKey, textKey, p, vars) => p && stories.push({ icon, title: t(titleKey), text: t(textKey, { ...who(p), period, ...vars }), serial: who(p).serial });
  const hours = v => (v / MIN_WAGE_HOURLY).toLocaleString(numberLocale(), { maximumFractionDigits: 0 });
  add('🎯', 'storyBigWinTitle', 'storyBigWin', notable.biggestWin, notable.biggestWin && {
    week: notable.biggestWin.biggestWinWeek + 1,
    stake: money(notable.biggestWin.biggestWinStake),
    legs: notable.biggestWin.biggestWinLegs,
    odds: fmtOdds(notable.biggestWin.biggestWinOdds),
    win: money(notable.biggestWin.biggestWin),
    final: fmtMoney(notable.biggestWin.final)
  });
  // The biggest ticket often makes the biggest winner too, who without it
  // would have been losing: say so when it's true.
  const bestIsBigWin = notable.best?.serial === notable.biggestWin?.serial && notable.best.final - notable.best.biggestWin < 0;
  add('🏆', 'storyBestTitle', bestIsBigWin ? 'storyBestSame' : 'storyBest', notable.best, notable.best && { final: fmtMoney(notable.best.final), staked: money(notable.best.staked), tickets: fmtCount(notable.best.tickets) });
  add('🎢', 'storyFallTitle', 'storyFall', notable.fall, notable.fall && { week: notable.fall.peakWeek + 1, peak: fmtMoney(notable.fall.peak), final: fmtMoney(notable.fall.final) });
  add('🥶', 'storyDroughtTitle', 'storyDrought', notable.drought, notable.drought && { streak: fmtCount(notable.drought.longestLosing), tickets: fmtCount(notable.drought.tickets), won: fmtCount(notable.drought.wonTickets) });
  add('💸', 'storyWorstTitle', 'storyWorst', notable.worst, notable.worst && { final: money(-notable.worst.final), staked: money(notable.worst.staked), max: money(notable.worst.maxStake), hours: hours(-notable.worst.final) });
  $('sim-stories').replaceChildren(
    ...stories.map(s =>
      el('li', { class: 'story' }, [
        el('span', { class: 'story-icon', 'aria-hidden': 'true', text: s.icon }),
        el('p', { class: 'story-title' }, [document.createTextNode(`${s.title} `), el('span', { class: 'story-serial', text: s.serial })]),
        el('p', { class: 'story-text', text: s.text })
      ])
    )
  );
  const truths = [];
  if (crowd.winnings > 0) truths.push(t('truthRatio', { n: fmtCount(SIM_PLAYERS_SHOWN), win: money(crowd.winnings), loss: money(crowd.losses), ratio: (crowd.losses / crowd.winnings).toLocaleString(numberLocale(), { maximumFractionDigits: 1 }) }));
  truths.push(crowd.top1 > 0 ? t('truthTop', { period, top1: fmtMoney(crowd.top1), top01: fmtMoney(crowd.top01) }) : t('truthTopLosing', { period, top1: fmtMoney(crowd.top1) }));
  if (crowd.neverWonShare > 0) truths.push(t('truthNeverWon', { period, share: fmtChance(crowd.neverWonShare), n: fmtCount(crowd.neverWonShare * SIM_PLAYERS) }));
  truths.push(t('truthSameOdds'));
  $('sim-truths').replaceChildren(...truths.map(text => el('li', { text })));
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

function renderF1() {
  const t = state.t;
  const body = $('f1-body');
  const f1 = state.data.f1;
  $('f1').hidden = !inSport('f1');
  if (!f1) {
    body.replaceChildren(el('p', { class: 'muted', text: t('f1None') }));
    return;
  }
  const drivers = state.bets.filter(b => b.kind === 'f1');
  const table = betTable(drivers.slice(0, 10));
  table.querySelector('th').textContent = t('colDriver');
  body.replaceChildren(el('p', { class: 'game-meta', text: `${f1.title} · ${fmtTime(f1.startUtc)}` }), table, takeNote([takeText(drivers)]));
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

// Tells the page's failsafe (in index.html) that the scripts loaded and started.
window.__oddsStarted = true;
renderStatic();
renderTabs();
load();
