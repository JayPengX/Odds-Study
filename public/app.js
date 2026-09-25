import {
  HABITS,
  K_DRAFTKINGS,
  blendOutcomes,
  combineParlay,
  estimateF1LotteryOdds,
  estimateLotteryOdds,
  expectedReturn,
  habitPools,
  seededRandom,
  simulateHabit,
  summarizeHabit
} from './lib/odds.mjs';
import { loadOdds } from './lib/sources.mjs';
import { detectLocale, makeT } from './lib/i18n.mjs';

const STAKE = 100;
// Four players per habit.
const SIM_PLAYERS = HABITS.length * 4;
// Players per habit for the habit comparison.
const SUMMARY_PLAYERS = 300;
const THIN_LIQUIDITY = 10_000;
const TIE_BAND = 2;
const RANKING_SIZE = 8;
const MAX_LEGS = 10;
const USER_ODDS_KEY = 'oddsStudy.userOdds';

const state = {
  locale: detectLocale(),
  t: null,
  data: null,
  bets: [],
  userOdds: loadUserOdds(),
  parlay: [],
  simSeed: 1,
  day: null,
  sport: 'all'
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

function fmtTime(iso) {
  return new Intl.DateTimeFormat(numberLocale(), {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
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
      bets.push({
        ...base,
        id: `${game.id}|ml|${side}`,
        kind: 'ml',
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
        estOdds: estimateF1LotteryOdds(d.fair)
      });
    }
  }
  return bets;
}

function effectiveOdds(bet) {
  const user = Number(state.userOdds[bet.id]);
  return user >= 1.01 ? user : bet.estOdds;
}

function betReturn(bet) {
  return expectedReturn(bet.fairChance, effectiveOdds(bet), STAKE);
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  renderDayFilter();
  renderRanking();
  renderGames();
  renderSim();
  renderF1();
}

function renderSportFilter() {
  const t = state.t;
  const present = new Set(state.bets.map(b => b.sport));
  const sports = ['all', 'mlb', 'epl', 'f1'].filter(s => s === 'all' || present.has(s));
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
  $('lang-toggle').textContent = t('langToggle');
  $('refresh').textContent = t('refresh');
  $('sim-rerun').textContent = t('simRerun');
  for (const option of $('sim-weeks').options) option.textContent = t(`period_${option.value}`);
  $('footer').textContent = t('footer');
  for (const [id, key] of [
    ['ranking-title', 'rankingTitle'],
    ['games-title', 'gamesTitle'],
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
  const top = ranked.slice(0, RANKING_SIZE);
  const worst = ranked.at(-1);
  const shown = ranked.length > RANKING_SIZE ? [...top, worst] : top;
  const scaleMax = Math.max(100, betReturn(ranked[0])) * 1.04;
  const best = betReturn(ranked[0]);
  const hasReal = id => Number(state.userOdds[id]) >= 1.01;
  const items = shown.map((bet, i) => {
    const back = betReturn(bet);
    const isWorst = i >= top.length;
    const track = el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
      el('div', { class: 'bar', style: `width:${(back / scaleMax) * 100}%` }),
      el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
    ]);
    const context = bet.label.includes(bet.matchup) ? fmtTime(bet.start) : `${bet.matchup} · ${fmtTime(bet.start)}`;
    const tag = hasReal(bet.id) ? t('tagReal') : t('tagEstimated');
    return el('li', { class: 'ranking-item' }, [
      el('span', { class: 'rank', text: isWorst ? t('worst') : String(i + 1) }),
      el('span', { class: 'rank-label' }, [
        document.createTextNode(`${bet.label} @ ${fmtOdds(effectiveOdds(bet))} `),
        el('span', { class: `tag ${hasReal(bet.id) ? 'tag-real' : ''}`, text: tag }),
        el('small', { text: ` ${context}` })
      ]),
      el('span', { class: `rank-value ${backClass(back)}`, text: fmtMoney(back, { sign: false }) }),
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
      bet.kind === 'f1'
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
      el('td', { class: 'num', 'data-label': t('colFair'), text: fmtPct(bet.fairChance) }),
      el('td', { class: 'num', 'data-label': t('colEst'), text: fmtOdds(bet.estOdds) }),
      el('td', { 'data-label': t('colReal') }, input),
      el('td', { class: `num ${backClass(back)}`, 'data-label': t('colBack'), 'data-back': bet.id, text: fmtMoney(back, { sign: false }) }),
      el('td', { 'data-label': '' }, legButton)
    ]);
  });
  return el('table', { class: 'bet-table' }, [head, el('tbody', {}, rows)]);
}

function onUserOdds(bet, raw) {
  const value = Number(raw);
  if (raw === '' || !(value >= 1.01)) delete state.userOdds[bet.id];
  else state.userOdds[bet.id] = value;
  saveUserOdds();
  const cell = document.querySelector(`[data-back="${CSS.escape(bet.id)}"]`);
  if (cell) {
    const back = betReturn(bet);
    cell.textContent = fmtMoney(back, { sign: false });
    cell.className = `num ${backClass(back)}`;
  }
  renderRanking();
  renderParlay();
  renderSim();
}

// ---- Parlay -------------------------------------------------------------------

function toggleLeg(bet) {
  if (state.parlay.includes(bet.id)) {
    state.parlay = state.parlay.filter(id => id !== bet.id);
  } else {
    const sameGame = state.bets.filter(b => b.gameId === bet.gameId).map(b => b.id);
    state.parlay = state.parlay.filter(id => !sameGame.includes(id));
    state.parlay.push(bet.id);
    if (state.parlay.length > MAX_LEGS) state.parlay.shift();
  }
  renderGames();
  renderParlay();
}

function parlayLegs() {
  return state.parlay.map(id => state.bets.find(b => b.id === id)).filter(Boolean);
}

function parlayResult() {
  const legs = parlayLegs();
  if (legs.length === 0) return null;
  const combined = combineParlay(legs.map(b => ({ odds: effectiveOdds(b), fairChance: b.fairChance })));
  return { legs, ...combined, back: expectedReturn(combined.fairChance, combined.odds, STAKE) };
}

function statTile(label, value, extraClass = '') {
  return el('div', { class: 'stat' }, [el('p', { class: 'stat-label', text: label }), el('p', { class: `stat-value ${extraClass}`, text: value })]);
}

function renderParlay() {
  const t = state.t;
  const body = $('parlay-body');
  const result = parlayResult();
  if (!result) {
    body.replaceChildren(el('p', { class: 'muted', text: t('parlayEmpty') }));
    return;
  }
  body.replaceChildren(
    el('ul', { class: 'parlay-legs' },
      result.legs.map(b =>
        el('li', {}, [
          el('span', { text: b.label.includes(b.matchup) ? b.label : `${b.label} · ${b.matchup}` }),
          el('span', { class: 'num', text: fmtOdds(effectiveOdds(b)) })
        ])
      )
    ),
    el('div', { class: 'stat-row' }, [
      statTile(t('parlayOdds'), fmtOdds(result.odds)),
      statTile(t('parlayChance'), fmtPct(result.fairChance)),
      statTile(t('parlayBack'), fmtMoney(result.back, { sign: false }), backClass(result.back))
    ]),
    el('p', { class: 'note', text: t('parlayCut') }),
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
const CHARACTERS = [
  { key: 'best', name: 'simLucky', color: 'var(--good)' },
  { key: 'median', name: 'simTypical', color: 'var(--series-1)' },
  { key: 'worst', name: 'simUnlucky', color: 'var(--bad)' }
];

function fmtShare(p) {
  if (p === 0) return '0%';
  if (p < 0.01) return '<1%';
  return `${Math.round(p * 100)}%`;
}

function fmtCount(n) {
  return Math.round(n).toLocaleString(numberLocale());
}

// The habit comparison is the slow part, so it's kept until the pool, the
// period or the seed changes (a resize only redraws).
let summaryCache = { key: null, value: null };

function habitSummaries(pools, weeks) {
  const key = JSON.stringify([weeks, state.simSeed, pools.any.map(b => [b.gameId, b.fairChance, b.odds])]);
  if (summaryCache.key !== key) {
    const random = seededRandom(state.simSeed * 7919);
    summaryCache = {
      key,
      value: HABITS.map(habit => ({ habit, ...summarizeHabit({ habit, pools, weeks, players: SUMMARY_PLAYERS, random }) }))
    };
  }
  return summaryCache.value;
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
  const pools = habitPools(pool);
  const random = seededRandom(state.simSeed);
  const players = Array.from({ length: SIM_PLAYERS }, (_, i) => {
    const habit = HABITS[i % HABITS.length];
    return { habit, ...simulateHabit({ habit, pools, weeks, random }) };
  });
  const summaries = habitSummaries(pools, weeks);
  // The average player: every habit weighted equally, as in the crowd.
  const expectedAt = w => summaries.reduce((s, h) => s + h.meanPath[w], 0) / summaries.length;
  const order = players.map((_, i) => i).sort((a, b) => players[a].final - players[b].final);
  const picked = { worst: order[0], median: order[SIM_PLAYERS >> 1], best: order.at(-1) };
  const characters = CHARACTERS.map(c => ({ ...c, index: picked[c.key], player: players[picked[c.key]] }));
  const endedAhead = players.filter(p => p.final > 0).length;
  const everAhead = players.filter(p => p.everAhead).length;

  renderSimHeadline(summaries, period);
  $('sim-stats').replaceChildren(
    statTile(t('simBiggestWin'), fmtMoney(Math.max(0, ...players.map(p => p.biggestWin)), { sign: false }), 'back-high'),
    statTile(t('simEverAhead'), `${everAhead} / ${SIM_PLAYERS}`),
    statTile(t('simAhead'), `${endedAhead} / ${SIM_PLAYERS}`, endedAhead === 0 ? 'back-low' : '')
  );
  $('sim-legend').replaceChildren(
    el('span', {}, [el('span', { class: 'legend-key', style: 'background:var(--text-muted);opacity:.5' }), document.createTextNode(t('simOthers', { n: SIM_PLAYERS - 3 }))]),
    ...characters.map(c => el('span', {}, [el('span', { class: 'legend-key thick', style: `background:${c.color}` }), document.createTextNode(t(c.name))])),
    el('span', {}, [el('span', { class: 'legend-key dashed' }), document.createTextNode(t('simExpected'))])
  );
  drawSimChart(chart, players, characters, expectedAt, weeks);
  renderPlayers(characters);
  renderHabits(summaries, period);
  renderFacts(players, characters, summaries, { weeks, period, endedAhead, everAhead });
  renderSimTable(players, characters, expectedAt, weeks);
}

function renderSimHeadline(summaries, period) {
  const t = state.t;
  const share = summaries.reduce((s, h) => s + h.aheadShare, 0) / summaries.length;
  const staked = summaries.reduce((s, h) => s + h.avgStaked, 0) / summaries.length;
  const final = summaries.reduce((s, h) => s + h.avgFinal, 0) / summaries.length;
  const tickets = summaries.reduce((s, h) => s + h.avgTickets, 0) / summaries.length;
  const inTen = Math.round(share * 10);
  const back = staked > 0 ? ((staked + final) / staked) * 100 : 100;
  $('sim-headline').replaceChildren(
    el('p', { class: 'headline-label', text: t('simHeadlineLabel', { period }) }),
    el('p', { class: 'headline-big' }, [
      document.createTextNode(t('simHeadlinePre')),
      el('strong', { class: share >= 0.5 ? 'good' : '', text: inTen === 0 ? t('simHeadlineNone') : t('simHeadlineShare', { n: inTen }) }),
      document.createTextNode(t('simHeadlinePost'))
    ]),
    el('p', {
      class: 'headline-sub',
      text: t('simHeadlineSub', { tickets: fmtCount(tickets), staked: fmtMoney(staked, { sign: false }), back: fmtMoney(back, { sign: false }) })
    })
  );
}

function renderPlayers(characters) {
  const t = state.t;
  $('sim-players').replaceChildren(
    ...characters.map(({ name, color, player: p }) => {
      let tale;
      if (p.final > 0) tale = t('taleAhead', { habit: t(`habit_${p.habit.key}`) });
      else if (!p.everAhead) tale = t('taleNever');
      else tale = t('taleGaveBack', { peak: fmtMoney(p.peak, { sign: false }), at: fmtCount(p.peakWeek + 1) });
      const line = (label, value) => el('div', { class: 'player-line' }, [el('span', { text: label }), el('strong', { text: value })]);
      return el('article', { class: 'player', style: `--player:${color}` }, [
        el('p', { class: 'player-name' }, [document.createTextNode(t(name)), el('span', { class: 'habit-tag', text: t(`habit_${p.habit.key}`) })]),
        el('p', { class: `player-final ${p.final < 0 ? 'back-low' : 'back-high'}`, text: fmtMoney(p.final) }),
        el('p', { class: 'player-tale', text: tale }),
        line(t('playerTickets'), `${fmtCount(p.wonTickets)} / ${fmtCount(p.tickets)}`),
        line(t('playerStaked'), fmtMoney(p.staked, { sign: false })),
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
  $('habits-intro').textContent = t('habitsIntro', { n: SUMMARY_PLAYERS, period });
  const sorted = [...summaries].sort((a, b) => b.back - a.back);
  const scaleMax = Math.max(100, sorted[0].back) * 1.04;
  $('sim-habits').replaceChildren(
    ...sorted.map(h =>
      el('li', { class: 'ranking-item habit-item' }, [
        el('span', { class: 'rank-label' }, [
          el('strong', { text: t(`habit_${h.habit.key}`) }),
          el('small', { text: ` ${t(`habitDesc_${h.habit.key}`)}` })
        ]),
        el('span', { class: `rank-value ${backClass(h.back)}`, text: fmtMoney(h.back, { sign: false }) }),
        el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [
          el('div', { class: 'bar', style: `width:${(h.back / scaleMax) * 100}%` }),
          el('div', { class: 'bar-even', style: `left:${(100 / scaleMax) * 100}%` })
        ]),
        el('span', {
          class: 'habit-meta',
          text: t('habitMeta', { ahead: fmtShare(h.aheadShare), staked: fmtMoney(h.avgStaked, { sign: false }), final: fmtMoney(h.avgFinal) })
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
  if (everAhead > endedAhead) facts.push(t(endedAhead ? 'factEverAhead' : 'factEverAheadNone', { ever: everAhead, ended: endedAhead, total: SIM_PLAYERS }));
  const chaser = players.filter(p => p.habit.key === 'chaser').sort((a, b) => b.maxStake - a.maxStake)[0];
  if (chaser && chaser.maxStake > chaser.habit.stakes[0]) {
    facts.push(t('factChaser', { max: fmtMoney(chaser.maxStake, { sign: false }), staked: fmtMoney(chaser.staked, { sign: false }), final: fmtMoney(chaser.final) }));
  }
  const lucky = characters[0].player;
  if (lucky.biggestWin > 0) facts.push(t('factLucky', { win: fmtMoney(lucky.biggestWin, { sign: false }), streak: lucky.longestLosing }));
  const avgLoss = -summaries.reduce((s, h) => s + h.avgFinal, 0) / summaries.length;
  if (avgLoss > 0) {
    facts.push(t('factWage', { period, loss: fmtMoney(avgLoss, { sign: false }), hours: (avgLoss / MIN_WAGE_HOURLY).toLocaleString(numberLocale(), { maximumFractionDigits: avgLoss < 10 * MIN_WAGE_HOURLY ? 1 : 0 }), wage: MIN_WAGE_HOURLY }));
  }
  const net = players.reduce((s, p) => s + p.final, 0);
  const staked = players.reduce((s, p) => s + p.staked, 0);
  facts.push(t(net < 0 ? 'factHouse' : 'factHouseWon', { total: SIM_PLAYERS, staked: fmtMoney(staked, { sign: false }), net: fmtMoney(Math.abs(net), { sign: false }) }));
  $('sim-facts').replaceChildren(...facts.map(f => el('li', { text: f })));
}

function drawSimChart(container, players, characters, expectedAt, weeks) {
  const t = state.t;
  const runs = players.map(p => p.path);
  const width = Math.max(300, container.clientWidth || 600);
  const wide = width >= 560;
  const height = width < 520 ? 260 : 320;
  const m = { top: 12, right: wide ? 164 : 12, bottom: 26, left: 62 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  let lo = 0;
  let hi = 0;
  for (const r of runs) for (const v of r) (v < lo && (lo = v), v > hi && (hi = v));
  for (let i = 0; i < weeks; i++) (lo = Math.min(lo, expectedAt(i)), hi = Math.max(hi, expectedAt(i)));
  const step = niceStep(hi - lo || 1, 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = i => m.left + ((i + 1) / weeks) * w;
  const y = v => m.top + ((hi - v) / (hi - lo)) * h;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('chartLabel', { n: SIM_PLAYERS }) });
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
  const pathOf = run => {
    let d = `M${m.left},${y(0)}`;
    for (let i = 0; i < weeks; i++) d += `L${x(i).toFixed(1)},${y(run[i]).toFixed(1)}`;
    return d;
  };
  const highlighted = new Set(characters.map(c => c.index));
  runs.forEach((run, i) => highlighted.has(i) || svg.append(svgEl('path', { class: 'run', d: pathOf(run) })));
  const expected = Array.from({ length: weeks }, (_, i) => expectedAt(i));
  svg.append(svgEl('path', { class: 'expected', d: pathOf(expected) }));
  for (const c of [...characters].reverse()) svg.append(svgEl('path', { class: 'run-hero', style: `stroke:${c.color}`, d: pathOf(runs[c.index]) }));

  if (wide) {
    // Right-edge labels, nudged apart so they never overlap.
    const labels = [
      ...characters.map(c => ({ text: `${t(c.name)} ${fmtMoney(c.player.final)}`, value: c.player.final, color: c.color })),
      { text: `${t('simExpected')} ${fmtMoney(expected.at(-1))}`, value: expected.at(-1), color: 'var(--text-secondary)' }
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
  const hit = svgEl('rect', { class: 'hit', x: m.left, y: m.top, width: w, height: h, tabindex: '0', 'aria-label': t('chartLabel', { n: SIM_PLAYERS }) });
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
    const ahead = runs.filter(r => r[current] > 0).length;
    tooltip.replaceChildren(
      el('p', { class: 'tooltip-title', text: t('simWeekN', { n: fmtCount(current + 1) }) }),
      ...characters.map(c => row(t(c.name), fmtMoney(runs[c.index][current]), c.color)),
      row(t('simExpected'), fmtMoney(expected[current]), 'var(--text-secondary)'),
      row(t('simAheadNow'), `${ahead} / ${SIM_PLAYERS}`)
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

function renderSimTable(players, characters, expectedAt, weeks) {
  const t = state.t;
  const rows = [];
  const points = [...new Set(Array.from({ length: 10 }, (_, k) => Math.max(0, Math.round(((k + 1) / 10) * weeks) - 1)))];
  for (const i of points) {
    rows.push(
      el('tr', {}, [
        el('td', { text: fmtCount(i + 1) }),
        el('td', { text: fmtMoney(expectedAt(i)) }),
        ...characters.map(c => el('td', { text: fmtMoney(c.player.path[i]) })),
        el('td', { text: `${players.filter(p => p.path[i] > 0).length} / ${SIM_PLAYERS}` })
      ])
    );
  }
  $('sim-table').replaceChildren(
    el('table', {}, [
      el('thead', {}, el('tr', {}, [t('simTableWeek'), t('simExpected'), ...characters.map(c => t(c.name)), t('simAheadNow')].map(h => el('th', { text: h })))),
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
  state.parlay = state.parlay.filter(id => state.bets.some(b => b.id === id));
  renderStatus('ok');
  renderSportFilter();
  renderDayFilter();
  renderRanking();
  renderGames();
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

$('lang-toggle').addEventListener('click', () => {
  state.locale = state.locale === 'zh' ? 'en' : 'zh';
  state.t = makeT(state.locale);
  try {
    localStorage.setItem('oddsStudy.lang', state.locale);
  } catch {}
  renderAll();
  if (!state.data) renderStatus('loading');
});
$('refresh').addEventListener('click', load);
$('sim-weeks').addEventListener('change', renderSim);
$('sim-rerun').addEventListener('click', () => {
  state.simSeed += 1;
  renderSim();
});
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
load();
