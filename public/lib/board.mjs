// Every priced option of a game, the one place a board is built. The page
// adds names to these for you, and the simulated crowd bets on exactly the
// same options (real games, and the typical weeks of sports with nothing on
// today, which are made-up games run through this same code). One pricing
// path, so nothing can be cheaper to bet on in the simulator than on the page
// or the other way round.
//
// An option: { id, gameId, sport, kind, side, market, fairChance, fairMargin,
// errKey, cut, estOdds, posted, lock, minLegs, ... } plus the fields its kind
// needs to be named and settled (totalLine, runLine, awayLine, giver, team,
// teamLine, inning, line, settle) and, for side markets, the market and pick
// it came from (`m`, `pick`).
import {
  blendOutcomes,
  estimateLotteryOdds,
  estimateLineOdds,
  lotteryTotalLines,
  lotteryRunLines,
  lotteryTeamTotal,
  fitTeamRuns,
  fitTotalRuns,
  totalOverChance,
  teamOverChance,
  runLineCover,
  scoreGrid,
  lineInRange,
  MLB_TOTAL_DISPERSION,
  GOALS_DISPERSION,
  MLB_MARKET_OVERROUND,
  K_DRAFTKINGS,
  TOP_INNING_ODDS
} from './odds.mjs';
import { pointsModel, pointsMarkets, goalMarkets, fitHockey, baseballMarkets, setsMarkets, marketOdds } from './markets.mjs';
import { fitGoals } from './live.mjs';
import { houseCut, houseRule } from './rules.mjs';
import { LEAGUES, familyOf, isSoccer, isSets } from './teams.mjs';

// Lines besides the lottery's own: totals this many either side of the main
// line, team totals this many, run lines up to 4.5 runs either way.
const TOTAL_SPAN = 3;
const TEAM_TOTAL_SPAN = 2;
const RUN_LINES = [1.5, 2.5, 3.5, 4.5];

// Lottery-checked error sizes exist for MLB and the Premier League; every
// other league uses its kind of sport's (unchecked) one.
export function errKeyOf(sport) {
  return ['mlb', 'epl'].includes(sport) ? sport : familyOf(sport);
}

// Each game's run and goal models, fitted once: fitting team runs is slow.
const modelCache = new Map();
function gameModel(game) {
  const key = `${game.id}|${game.total?.line}|${game.total?.overFair}|${game.draftKings?.home}`;
  if (modelCache.has(key)) return modelCache.get(key);
  const model = {};
  const baseball = familyOf(game.sport) === 'baseball';
  if (game.total && !isSets(game.sport)) model.mu = fitTotalRuns(game.total.line, game.total.overFair, baseball ? MLB_TOTAL_DISPERSION : GOALS_DISPERSION);
  if (baseball && game.total && game.draftKings) {
    model.means = fitTeamRuns(game.draftKings.home, game.total.line, game.total.overFair);
    model.grid = scoreGrid(model.means.home, model.means.away);
  }
  if (modelCache.size > 2000) modelCache.clear();
  modelCache.set(key, model);
  return model;
}

// Totals, run lines and team totals of baseball and soccer: the lottery's own
// lines (MLB's checked against its prices) and the wider range.
function lineOptions(game, base) {
  const out = [];
  const model = gameModel(game);
  const total = game.total;
  const mlb = game.sport === 'mlb';
  const baseball = familyOf(game.sport) === 'baseball';
  const cut = (k, steps) => houseCut({ base: k, sport: game.sport, steps });

  // 大小分. MLB: the lottery's three lines, from one line; elsewhere the
  // bookmaker's own half line; then the wider range from the model.
  const totals = new Map();
  if (total && mlb) for (const l of lotteryTotalLines(total.line, total.overFair)) totals.set(l.line, { ...l, posted: true });
  else if (total && total.line % 1 !== 0) totals.set(total.line, { line: total.line, over: total.overFair, main: true, posted: true });
  if (model.mu != null) {
    const r = baseball ? MLB_TOTAL_DISPERSION : GOALS_DISPERSION;
    const main = [...totals.values()].find(l => l.main)?.line ?? Math.floor(model.mu) + 0.5;
    for (let d = -TOTAL_SPAN; d <= TOTAL_SPAN; d++) {
      const line = main + d;
      if (line <= 0 || totals.has(line)) continue;
      const over = totalOverChance(line, model.mu, r);
      if (lineInRange(over) && lineInRange(1 - over)) totals.set(line, { line, over, main: false, posted: false });
    }
  }
  const mainTotal = [...totals.values()].find(l => l.main)?.line;
  for (const { line, over, main, posted } of [...totals.values()].sort((a, b) => a.line - b.line)) {
    const k = cut(K_DRAFTKINGS, posted || mainTotal == null ? 0 : line - mainTotal);
    for (const side of ['over', 'under']) {
      const p = side === 'over' ? over : 1 - over;
      out.push({
        ...base,
        id: `${game.id}|tot|${line}|${side}`,
        kind: 'total',
        side,
        totalLine: line,
        mainLine: main,
        posted,
        market: `total|${line}`,
        // The main line's margin is the usual source gap; lines either side add the model's error.
        fairMargin: main ? null : posted ? 0.02 : 0.03,
        errKey: !mlb ? errKeyOf(game.sport) : posted ? 'mlbTotal' : 'mlbTotalExtra',
        fairChance: p,
        cut: k,
        estOdds: estimateLineOdds(p, k)
      });
    }
  }

  // 讓分: MLB's two posted lines priced from the lottery's own (shrunk)
  // chance; other leagues the bookmaker's line; the rest from the score model.
  if (baseball && (game.spread || model.grid)) {
    const lines = new Map();
    if (game.spread && mlb) {
      for (const [i, l] of lotteryRunLines(game.spread.awayLine, game.spread.awayFair).entries()) lines.set(l.awayLine, { ...l, posted: true, first: i === 0 });
    } else if (game.spread && game.spread.awayLine % 1 !== 0) {
      lines.set(game.spread.awayLine, { awayLine: game.spread.awayLine, fair: game.spread.awayFair, lottery: game.spread.awayFair, posted: true, first: true });
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
      const k = cut(MLB_MARKET_OVERROUND, posted ? 0 : Math.max(1, Math.abs(awayLine) - 2.5));
      for (const side of ['away', 'home']) {
        const p = side === 'away' ? fair : 1 - fair;
        const priced = side === 'away' ? lottery : 1 - lottery;
        out.push({
          ...base,
          id: `${game.id}|rl|${side === 'away' ? awayLine : -awayLine}|${side}`,
          kind: 'runline',
          side,
          runLine: side === 'away' ? awayLine : -awayLine,
          awayLine,
          giver,
          posted,
          market: `rl|${awayLine}`,
          fairMargin: first ? 0.02 : 0.03,
          errKey: !mlb ? errKeyOf(game.sport) : posted ? 'mlbRunLine' : 'mlbRunLineExtra',
          fairChance: p,
          cut: k,
          estOdds: estimateLineOdds(priced, k)
        });
      }
    }
  }

  // 單隊大小: each team's runs; the lottery's line is the one closest to 50/50.
  if (model.means) {
    for (const team of ['away', 'home']) {
      const posted = lotteryTeamTotal(model.means[team]).line;
      for (let d = -TEAM_TOTAL_SPAN; d <= TEAM_TOTAL_SPAN; d++) {
        const line = posted + d;
        if (line <= 0) continue;
        const over = teamOverChance(model.means[team], line);
        if (!(lineInRange(over) && lineInRange(1 - over))) continue;
        const k = cut(MLB_MARKET_OVERROUND, d);
        for (const side of ['over', 'under']) {
          const p = side === 'over' ? over : 1 - over;
          out.push({
            ...base,
            id: `${game.id}|tt|${team}|${line}|${side}`,
            kind: 'teamtotal',
            side,
            team,
            teamLine: line,
            posted: line === posted,
            market: `tt|${team}|${line}`,
            fairMargin: line === posted ? 0.03 : 0.04,
            errKey: !mlb ? errKeyOf(game.sport) : line === posted ? 'mlbTeamTotal' : 'mlbTeamTotalExtra',
            fairChance: p,
            cut: k,
            estOdds: estimateLineOdds(p, k)
          });
        }
      }
    }
  }
  return out;
}

// Every side market of a game (markets.mjs).
function sideOptions(game, base, probs) {
  const family = familyOf(game.sport);
  const homeWin = probs.home / (probs.home + probs.away);
  let markets = [];
  if (family === 'baseball') markets = baseballMarkets({ homeWin, total: game.total });
  else if (family === 'football' || family === 'basketball') {
    const model = pointsModel(game.sport, { homeWin, spread: game.spread, total: game.total });
    if (model) markets = pointsMarkets(model, { spreadLine: game.spread?.awayLine ?? null, totalLine: game.total?.line ?? null });
  } else if (family === 'hockey') markets = goalMarkets(fitHockey(homeWin, game.total), { family, totalLine: game.total?.line ?? null });
  else if (family === 'sets') markets = setsMarkets({ homeWin, bestOf: LEAGUES[game.sport]?.sets?.bestOf });
  else if (family === 'soccer' && probs.draw != null) {
    // Totals come from lineOptions; the rest from each team's mean goals.
    markets = goalMarkets(fitGoals(probs.home, probs.away), { family }).filter(m => m.kind !== 'total');
  }
  const out = [];
  for (const m of markets) {
    const k = houseCut({ base: m.cut, sport: game.sport, steps: m.steps ?? 0 });
    for (const pick of m.picks) {
      const o = {
        ...base,
        id: `${game.id}|${m.kind}|${m.market}|${pick.side}`,
        kind: m.kind,
        side: pick.side,
        market: m.market,
        posted: m.posted ?? false,
        fairChance: pick.fair,
        fairMargin: null,
        errKey: 'extra',
        cut: k,
        estOdds: marketOdds(m, pick.fair, k),
        m,
        pick,
        settle: { lo: pick.lo, hi: pick.hi, score: pick.score, listed: m.listed, team: pick.team, ht: pick.ht, ft: pick.ft, ...(m.line != null && m.kind !== 'total' ? { line: m.line } : {}), ...(pick.line != null && m.kind === 'sethcap' ? { line: pick.line } : {}) }
      };
      if (m.kind === 'runline') Object.assign(o, { runLine: pick.line, awayLine: m.awayLine, giver: m.giver });
      if (m.kind === 'total') Object.assign(o, { totalLine: m.line, mainLine: m.main });
      out.push(o);
    }
  }
  return out;
}

// The bookmaker's own handicap and total in games or points, for matches in
// sets (tennis games; points in badminton, table tennis and volleyball).
function unitLineOptions(game, base) {
  const k = houseCut({ base: 'twoWay', sport: game.sport });
  const out = [];
  if (game.spread) {
    const { awayLine, awayFair } = game.spread;
    for (const side of ['away', 'home']) {
      const line = side === 'away' ? awayLine : -awayLine;
      const p = side === 'away' ? awayFair : 1 - awayFair;
      out.push({ ...base, id: `${game.id}|gh|${line}|${side}`, kind: 'gamehcap', side, market: `gh|${awayLine}`, line, awayLine, giver: awayLine < 0 ? 'away' : 'home', posted: true, fairChance: p, fairMargin: null, errKey: errKeyOf(game.sport), cut: k, estOdds: estimateLineOdds(p, k), settle: { line } });
    }
  }
  if (game.total) {
    const { line, overFair } = game.total;
    for (const side of ['over', 'under']) {
      const p = side === 'over' ? overFair : 1 - overFair;
      out.push({ ...base, id: `${game.id}|gt|${line}|${side}`, kind: 'gametotal', side, market: `gt|${line}`, line, posted: true, fairChance: p, fairMargin: null, errKey: errKeyOf(game.sport), cut: k, estOdds: estimateLineOdds(p, k), settle: { line } });
    }
  }
  return out;
}

// Every option of one game, priced, with the house's rules on each.
export function gameOptions(game) {
  const blend = blendOutcomes(game.draftKings, game.polymarket);
  if (!blend) return [];
  const base = { gameId: game.id, game, sport: game.sport, start: game.startUtc };
  const sides = isSoccer(game.sport) ? ['home', 'draw', 'away'] : ['away', 'home'];
  // The winner at the measured cut for its source, more for a league the
  // house knows less or sources that disagree.
  const both = game.draftKings && game.polymarket;
  const gap = both ? Math.max(...sides.map(side => Math.abs(game.draftKings[side] - game.polymarket[side]) / 2)) : null;
  const mlCut = houseCut({ base: blend.k, sport: game.sport, fairMargin: gap });
  const out = sides.map(side => ({
    ...base,
    id: `${game.id}|ml|${side}`,
    kind: 'ml',
    side,
    market: 'ml',
    // Never below half of Polymarket's 1-cent price step.
    fairMargin: both ? Math.max(0.005, Math.abs(game.draftKings[side] - game.polymarket[side]) / 2) : null,
    errKey: errKeyOf(game.sport),
    fairChance: blend.probs[side],
    cut: mlCut,
    estOdds: estimateLotteryOdds(blend.probs[side], mlCut)
  }));
  const family = familyOf(game.sport);
  if (family === 'sets') out.push(...unitLineOptions(game, base));
  if (family === 'baseball' || family === 'soccer') out.push(...lineOptions(game, base));
  out.push(...sideOptions(game, base, blend.probs));
  // 得分最高單局: the lottery's own (nearly fixed) table, its cut removed.
  if (game.sport === 'mlb') {
    const book = TOP_INNING_ODDS.reduce((sum, o) => sum + 1 / o, 0);
    TOP_INNING_ODDS.forEach((odds, i) => out.push({ ...base, id: `${game.id}|inning|${i}`, kind: 'inning', market: 'inning', inning: i, fairMargin: null, errKey: 'topInning', fairChance: 1 / odds / book, estOdds: odds }));
  }
  for (const o of out) Object.assign(o, houseRule(o.kind, o.estOdds));
  return out;
}

// ---- The simulated crowd's pool ----------------------------------------------

// Where each option sits on its game's shared result: the winner and every
// handicap of a game on one number line (the away side's slice first), every
// total line on another (under first), so one game's markets agree; other
// markets stacked in order within their own.
function resultSlice(o, probs) {
  const game = `${o.sport}|${o.gameId}`;
  if (o.kind === 'ml') {
    const lo = { away: 0, draw: probs.away ?? 0, home: (probs.away ?? 0) + (probs.draw ?? 0) }[o.side];
    return { key: `${game}|side`, outLo: lo, outHi: lo + o.fairChance };
  }
  if (o.kind === 'runline' || o.kind === 'sethcap' || o.kind === 'gamehcap') {
    const away = o.side === 'away' ? o.fairChance : 1 - o.fairChance;
    return { key: `${game}|${o.kind === 'runline' ? 'side' : o.kind}`, outLo: o.side === 'away' ? 0 : away, outHi: o.side === 'away' ? away : 1 };
  }
  if (o.kind === 'total' || o.kind === 'teamtotal' || o.kind === 'totalsets' || o.kind === 'gametotal') {
    const over = o.side === 'over' ? o.fairChance : 1 - o.fairChance;
    return { key: `${game}|${o.kind}${o.kind === 'teamtotal' ? `|${o.team}` : ''}`, outLo: o.side === 'under' ? 0 : 1 - over, outHi: o.side === 'under' ? 1 - over : 1 };
  }
  return { key: `${game}|${o.market ?? o.kind}` };
}

// A board's options as the crowd's pool: what's on sale (locked options and
// live ones dropped), at `oddsOf(option)` (the estimate by default).
export function crowdPool(options, oddsOf = o => o.estOdds) {
  const winners = new Map();
  for (const o of options) if (o.kind === 'ml') winners.set(o.gameId, { ...(winners.get(o.gameId) ?? {}), [o.side]: o.fairChance });
  return options
    .filter(o => !o.lock && !o.live && o.fairChance > 0)
    .map(o => ({ gameId: o.gameId, kind: o.kind, market: o.market ?? o.kind, fairChance: o.fairChance, odds: oddsOf(o), minLegs: o.minLegs ?? 1, ...resultSlice(o, winners.get(o.gameId) ?? {}) }));
}
