// Live (場中) odds. A game in progress is modelled from its pregame lines
// (DraftKings' win odds and total, from ESPN) and the live state (score,
// inning and outs, or minute): each team's remaining runs or goals follow
// the same negative binomial as before the game, scaled to what's left. The
// win chance is averaged with Polymarket's live price when enough money is
// behind it. Polymarket's live totals and run lines are too thin to use: on
// 2026-09-26 one total jumped from 0.52 to 0.77 in three minutes with no run.
//
// Checked on one real lottery snapshot (CIN @ TOR, middle of the 4th, 5-2,
// 2026-09-26): the lottery posts the lines closest to 50/50, as the model
// picks them (total 11.5, run line 2.5), and its live markets add up to
// 1.143-1.166 in implied chance, the same cut as before the game.
import { fitTeamRuns, TEAM_RUNS_DISPERSION, GOALS_DISPERSION, estimateLineOdds, round2 } from './odds.mjs';

export const LIVE_OVERROUND = 1.16;
// Polymarket's live winner price counts only with this much money behind it.
export const LIVE_MIN_LIQUIDITY = 5000;
const MAX_RUNS = 45;

function nbPmf(mean, r, kMax = MAX_RUNS) {
  const out = new Float64Array(kMax + 1);
  if (mean <= 1e-9 || r <= 1e-9) {
    out[0] = 1;
    return out;
  }
  const p = r / (r + mean);
  let pmf = p ** r;
  for (let k = 0; k <= kMax; k++) {
    out[k] = pmf;
    pmf *= ((k + r) / (k + 1)) * (1 - p);
  }
  return out;
}

// Half-innings left for each team, from ESPN's state: 'top' | 'mid' |
// 'bottom' | 'end' of `inning`, with `outs` in the half being played. In
// extra innings a tied game gets one more inning each.
export function inningsLeft({ inning, half, outs = 0 }) {
  const done = Math.min(3, outs) / 3;
  let away;
  let home;
  if (half === 'top') [away, home] = [10 - inning - done, 10 - inning];
  else if (half === 'mid') [away, home] = [9 - inning, 10 - inning];
  else if (half === 'bottom') [away, home] = [9 - inning, 10 - inning - done];
  else [away, home] = [9 - inning, 9 - inning];
  return { away: Math.max(0, away), home: Math.max(0, home) };
}

// Final-score distribution of a baseball game in progress: [{ away, home, p }].
// A tie at the end goes to extra innings, split by the teams' strength.
export function liveBaseball({ means, awayScore, homeScore, awayLeft, homeLeft, r = TEAM_RUNS_DISPERSION }) {
  const A = nbPmf((means.away * awayLeft) / 9, (r * awayLeft) / 9);
  const H = nbPmf((means.home * homeLeft) / 9, (r * homeLeft) / 9);
  const homeExtra = means.home / (means.home + means.away);
  const out = [];
  for (let a = 0; a < A.length; a++) {
    if (A[a] < 1e-9) continue;
    for (let h = 0; h < H.length; h++) {
      const p = A[a] * H[h];
      if (p < 1e-10) continue;
      const fa = awayScore + a;
      const fh = homeScore + h;
      if (fa !== fh) out.push({ away: fa, home: fh, p });
      else {
        out.push({ away: fa, home: fh + 1, p: p * homeExtra });
        out.push({ away: fa + 1, home: fh, p: p * (1 - homeExtra) });
      }
    }
  }
  return out;
}

// Soccer: goals left in proportion to the minutes left (90 in all); a draw stays a draw.
export function liveSoccer({ means, awayScore, homeScore, minutesLeft }) {
  const share = Math.max(0, minutesLeft) / 90;
  const A = nbPmf(means.away * share, GOALS_DISPERSION, 15);
  const H = nbPmf(means.home * share, GOALS_DISPERSION, 15);
  const out = [];
  for (let a = 0; a < A.length; a++) for (let h = 0; h < H.length; h++) if (A[a] * H[h] > 1e-10) out.push({ away: awayScore + a, home: homeScore + h, p: A[a] * H[h] });
  return out;
}

// Each team's mean goals matching the pregame home and away win chances.
export function fitGoals(homeWin, awayWin) {
  const chances = (home, away) => {
    const A = nbPmf(away, GOALS_DISPERSION, 15);
    const H = nbPmf(home, GOALS_DISPERSION, 15);
    let hw = 0;
    let aw = 0;
    for (let a = 0; a < A.length; a++) for (let h = 0; h < H.length; h++) (h > a ? (hw += A[a] * H[h]) : a > h ? (aw += A[a] * H[h]) : 0);
    return { hw, aw };
  };
  // Total goals from the favourite's strength, then the split between the teams.
  let lo = 0.05;
  let hi = 0.95;
  let total = 2.7;
  for (let i = 0; i < 40; i++) {
    const share = (lo + hi) / 2;
    const { hw, aw } = chances(total * share, total * (1 - share));
    if (hw / (hw + aw) < homeWin / (homeWin + awayWin)) lo = share;
    else hi = share;
  }
  const share = (lo + hi) / 2;
  // Draws: fewer goals, more draws. Pick the total whose draw chance matches.
  const draw = 1 - homeWin - awayWin;
  let tlo = 0.8;
  let thi = 5;
  for (let i = 0; i < 40; i++) {
    total = (tlo + thi) / 2;
    const { hw, aw } = chances(total * share, total * (1 - share));
    if (1 - hw - aw > draw) tlo = total;
    else thi = total;
  }
  total = (tlo + thi) / 2;
  return { home: total * share, away: total * (1 - share) };
}

export function chance(dist, test) {
  let sum = 0;
  for (const s of dist) if (test(s.away, s.home)) sum += s.p;
  return sum;
}

// The half line whose over chance is closest to 50/50, for a value of the final score.
function mainLine(dist, value, min) {
  let best = null;
  for (let line = min + 0.5; line < min + 40; line += 1) {
    const over = chance(dist, (a, h) => value(a, h) > line);
    if (!best || Math.abs(over - 0.5) < Math.abs(best.over - 0.5)) best = { line, over };
    if (over < 0.05) break;
  }
  return best;
}

const avg = (model, market) => (market == null ? model : (model + market) / 2);

// Every live market for a game: [{ kind, market, line?, side, team?, fair, posted }].
// `pm` is Polymarket's live winner price for the game (see parsePolymarketLive).
export function liveMarkets(dist, { sport, awayScore, homeScore, pm = null }) {
  const bets = [];
  const add = (kind, market, picks, extra = {}) => {
    for (const pick of picks) bets.push({ kind, market, ...extra, ...pick });
  };
  // Winner.
  if (sport === 'epl') {
    const home = chance(dist, (a, h) => h > a);
    const away = chance(dist, (a, h) => a > h);
    add('ml', 'ml', [
      { side: 'home', fair: home },
      { side: 'draw', fair: 1 - home - away },
      { side: 'away', fair: away }
    ], { posted: true });
  } else {
    const away = avg(chance(dist, (a, h) => a > h), pm?.awayWin);
    add('ml', 'ml', [
      { side: 'away', fair: away },
      { side: 'home', fair: 1 - away }
    ], { posted: true });
  }
  // Totals: the main line and two either side.
  const total = (a, h) => a + h;
  const main = mainLine(dist, total, awayScore + homeScore);
  if (main) {
    for (let d = -2; d <= 2; d++) {
      const line = main.line + d;
      if (line < awayScore + homeScore) continue;
      const over = chance(dist, (a, h) => a + h > line);
      if (over < 0.03 || over > 0.97) continue;
      add('total', `total|${line}`, [
        { side: 'over', fair: over },
        { side: 'under', fair: 1 - over }
      ], { line, posted: d === 0, main: d === 0 });
    }
  }
  if (sport !== 'mlb') return bets;
  // Run line: the team ahead on chances gives runs; the line closest to 50/50, then ±1.
  const awayFav = chance(dist, (a, h) => a > h) >= 0.5;
  const giver = awayFav ? 'away' : 'home';
  const margin = (a, h) => (awayFav ? a - h : h - a);
  let best = null;
  for (let line = 1.5; line < 15; line += 1) {
    const cover = chance(dist, (a, h) => margin(a, h) > line);
    if (!best || Math.abs(cover - 0.5) < Math.abs(best.cover - 0.5)) best = { line, cover };
  }
  for (const line of [best.line - 1, best.line, best.line + 1]) {
    if (line < 1.5) continue;
    const cover = chance(dist, (a, h) => margin(a, h) > line);
    if (cover < 0.03 || cover > 0.97) continue;
    // Stored from the away team's side, like the pregame run lines.
    const awayLine = giver === 'away' ? -line : line;
    const awayCover = giver === 'away' ? cover : 1 - cover;
    add('runline', `rl|${awayLine}`, [
      { side: 'away', fair: awayCover, line: awayLine },
      { side: 'home', fair: 1 - awayCover, line: -awayLine }
    ], { awayLine, giver, posted: line === best.line });
  }
  // Team totals: each team's line closest to 50/50, and one either side.
  for (const team of ['away', 'home']) {
    const runs = (a, h) => (team === 'away' ? a : h);
    const tm = mainLine(dist, runs, team === 'away' ? awayScore : homeScore);
    if (!tm) continue;
    for (const line of [tm.line - 1, tm.line, tm.line + 1]) {
      if (line < (team === 'away' ? awayScore : homeScore)) continue;
      const over = chance(dist, (a, h) => runs(a, h) > line);
      if (over < 0.03 || over > 0.97) continue;
      add('teamtotal', `tt|${team}|${line}`, [
        { side: 'over', fair: over },
        { side: 'under', fair: 1 - over }
      ], { team, line, posted: line === tm.line });
    }
  }
  return bets;
}

// Live odds at the lottery's usual cut.
export function liveOdds(fair) {
  return estimateLineOdds(fair, LIVE_OVERROUND);
}

// Pregame team means for a baseball game from its DraftKings lines.
export function pregameRuns({ homeWin, totalLine, overFair }) {
  return fitTeamRuns(homeWin, totalLine, overFair);
}

// 第N分: which team scores the game's Nth run (N past the current total), or
// no one (the game ends first). Half-innings are played in order, each
// team's runs in one half-inning negative binomial with a ninth of its game
// mean; the half being played counts only its outs still to come. Extra
// innings and a home team not batting in the 9th are left out.
export function halvesLeft({ inning, half, outs = 0 }) {
  const done = Math.min(3, outs) / 3;
  const list = [];
  let i = inning;
  let top = half === 'top' || half === 'end';
  if (half === 'end') i += 1;
  if (half === 'mid') top = false;
  let first = half === 'top' || half === 'bottom';
  for (; i <= 9; i++, top = true) {
    for (const isTop of top ? [true, false] : [false]) {
      list.push({ team: isTop ? 'away' : 'home', share: first ? 1 - done : 1 });
      first = false;
    }
  }
  return list;
}

export function nextRunChances({ means, state, runsAhead, r = TEAM_RUNS_DISPERSION }) {
  // P(c more runs so far), c < runsAhead, before each half-inning.
  let before = new Float64Array(runsAhead);
  before[0] = 1;
  const out = { away: 0, home: 0, none: 0 };
  for (const { team, share } of halvesLeft(state)) {
    const pmf = nbPmf((means[team] / 9) * share, (r / 9) * share, runsAhead);
    const after = new Float64Array(runsAhead);
    for (let c = 0; c < runsAhead; c++) {
      if (!before[c]) continue;
      let below = 0;
      for (let k = 0; k < runsAhead - c; k++) {
        after[c + k] += before[c] * pmf[k];
        below += pmf[k];
      }
      out[team] += before[c] * (1 - below);
    }
    before = after;
  }
  out.none = before.reduce((s, p) => s + p, 0);
  return out;
}

// The lottery's 第N分 markets carry a much bigger cut than its others (1.30
// and 1.33 in implied chance on the one snapshot) and lean toward an even
// split: it paid 10.00 for 無 (no more runs) where the model's fair price is
// about 24. Its chances ~= the model's moved NEXT_RUN_SHRINK of the way to a
// third each: 6 prices, about 6% off on average.
export const NEXT_RUN_OVERROUND = 1.31;
export const NEXT_RUN_SHRINK = 0.14;

// The lottery's price for one outcome of a 第N分 market, from its model chance.
export function nextRunOdds(fair) {
  const priced = (1 - NEXT_RUN_SHRINK) * fair + NEXT_RUN_SHRINK / 3;
  return Math.max(1.01, round2(1 / (priced * NEXT_RUN_OVERROUND)));
}

// Who scored each run of a game, in order, from ESPN's scoring plays (each
// carries the score after it): ['home', 'home', 'away', …].
export function runOrder(plays) {
  const order = [];
  let away = 0;
  let home = 0;
  for (const play of plays || []) {
    if (!play.scoringPlay) continue;
    const a = Number(play.awayScore);
    const h = Number(play.homeScore);
    if (!Number.isFinite(a) || !Number.isFinite(h)) continue;
    for (; away < a; away++) order.push('away');
    for (; home < h; home++) order.push('home');
  }
  return order;
}

export { round2 };
