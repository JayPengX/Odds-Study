// More ways to play every sport, all priced at the lottery's cut. Each game's
// DraftKings lines (win, spread, total) fix a small model of its final score:
// - football and basketball: the home margin and the total are normal, with
//   each league's usual spread (NFL margins vary by about 13.5 points);
// - hockey and soccer: each team's goals follow the goals model;
// - baseball: the per-team runs model the other MLB markets use.
// From the score model come the spreads and totals either side of
// DraftKings' line, odd/even, winning margin bands, first half, both teams
// to score, correct score, first inning and first five innings.
//
// Cuts: two-way markets at the lottery's measured MLB cut (1.158). Three-way,
// band and correct-score markets aren't on the checked board; they get the
// bigger cuts the lottery takes on its many-outcome markets (the top-scoring
// inning, 1.92; 第N分, 1.31), scaled by the number of outcomes. Every one of
// these is marked unchecked.
import { estimateLineOdds, round2, scoreGrid, fitTeamRuns, fitTotalRuns, GOALS_DISPERSION, TEAM_RUNS_DISPERSION } from './odds.mjs';

export const CUT = {
  twoWay: 1.158,
  threeWay: 1.2,
  bands: 1.35,
  score: 1.5
};

// Each league's spread of the final margin and total (points), from the usual
// size of results against the closing line.
export const SCORE_SPREAD = {
  nfl: { margin: 13.5, total: 10.5, bands: [[1, 6], [7, 12], [13, 18], [19, null]], step: 3 },
  ncaaf: { margin: 16, total: 14, bands: [[1, 7], [8, 14], [15, 21], [22, null]], step: 3.5 },
  nba: { margin: 12.5, total: 18, bands: [[1, 5], [6, 10], [11, 15], [16, 20], [21, null]], step: 4 },
  wnba: { margin: 11, total: 14, bands: [[1, 5], [6, 10], [11, 15], [16, null]], step: 4 }
};

export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function normalQuantile(p) {
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Odds at a cut: implied chance p x cut, but never more than halfway to certain.
export function oddsAt(p, cut) {
  return estimateLineOdds(p, cut);
}

// Many-outcome markets: proportional cut, at most the lottery's 500.
function bandOdds(p, cut) {
  return Math.min(500, Math.max(1.01, round2(1 / (p * cut))));
}

const half = x => Math.floor(x) + 0.5;

// ---- Football and basketball --------------------------------------------------

// Home margin and total as normals fitted to DraftKings' lines.
export function pointsModel(league, { homeWin, spread, total }) {
  const sd = SCORE_SPREAD[league];
  if (!sd) return null;
  let margin;
  // Spread from the away side: away covers when away + awayLine > home, i.e. margin < awayLine.
  if (spread) margin = spread.awayLine - sd.margin * normalQuantile(spread.awayFair);
  else if (homeWin != null) margin = sd.margin * normalQuantile(homeWin);
  else return null;
  const totalMean = total ? total.line + sd.total * normalQuantile(total.overFair) : null;
  return { league, margin, marginSd: sd.margin, total: totalMean, totalSd: sd.total, spec: sd };
}

// P(lo <= home margin <= hi), whole points (continuity-corrected).
function marginBetween(m, lo, hi) {
  const upper = hi == null ? 1 : normalCdf((hi + 0.5 - m.margin) / m.marginSd);
  return upper - normalCdf((lo - 0.5 - m.margin) / m.marginSd);
}

export function pointsMarkets(m, { spreadLine, totalLine }) {
  const out = [];
  const step = m.spec.step;
  // Spreads: DraftKings' line (as a half point) and 1 and 2 steps either side.
  const main = spreadLine != null ? (spreadLine % 1 ? spreadLine : spreadLine + 0.5) : half(-m.margin);
  for (const d of [-2, -1, 0, 1, 2]) {
    const awayLine = round2(main + d * step);
    if (Math.abs(awayLine) < 0.5) continue;
    const awayCover = normalCdf((awayLine - m.margin) / m.marginSd);
    if (awayCover < 0.04 || awayCover > 0.96) continue;
    out.push({ kind: 'runline', market: `rl|${awayLine}`, awayLine, giver: awayLine < 0 ? 'away' : 'home', posted: d === 0, cut: CUT.twoWay, picks: [
      { side: 'away', fair: awayCover, line: awayLine },
      { side: 'home', fair: 1 - awayCover, line: -awayLine }
    ] });
  }
  if (m.total != null) {
    const mainTotal = totalLine != null ? (totalLine % 1 ? totalLine : totalLine + 0.5) : half(m.total);
    for (const d of [-2, -1, 0, 1, 2]) {
      const line = round2(mainTotal + d * step * 1.5);
      const over = 1 - normalCdf((line - m.total) / m.totalSd);
      if (over < 0.04 || over > 0.96) continue;
      out.push({ kind: 'total', market: `total|${line}`, line, posted: d === 0, main: d === 0, cut: CUT.twoWay, picks: [
        { side: 'over', fair: over },
        { side: 'under', fair: 1 - over }
      ] });
    }
    out.push({ kind: 'oddeven', market: 'oddeven', cut: CUT.twoWay, picks: [{ side: 'odd', fair: 0.5 }, { side: 'even', fair: 0.5 }] });
  }
  // Winning margin: each team by each band.
  const bands = [];
  for (const team of ['home', 'away']) {
    for (const [lo, hi] of m.spec.bands) {
      const fair = team === 'home' ? marginBetween(m, lo, hi) : marginBetween({ ...m, margin: -m.margin }, lo, hi);
      bands.push({ side: `${team}|${lo}`, team, lo, hi, fair });
    }
  }
  const sum = bands.reduce((s, b) => s + b.fair, 0);
  out.push({ kind: 'margin', market: 'margin', cut: CUT.bands, picks: bands.map(b => ({ ...b, fair: b.fair / sum })) });
  // First half: half the margin, a tie as likely as a whole point either way.
  const h = { margin: m.margin / 2, marginSd: m.marginSd / Math.SQRT2 };
  const tie = marginBetween(h, 0, 0);
  const home = 1 - normalCdf((0.5 - h.margin) / h.marginSd);
  out.push({ kind: 'half', market: 'half', cut: CUT.threeWay, picks: [
    { side: 'away', fair: 1 - home - tie },
    { side: 'draw', fair: tie },
    { side: 'home', fair: home }
  ] });
  return out;
}

// ---- Goals (soccer, hockey) ------------------------------------------------------

function pmf(mean, r = GOALS_DISPERSION, kMax = 15) {
  const out = new Float64Array(kMax + 1);
  const p = r / (r + mean);
  let v = p ** r;
  for (let k = 0; k <= kMax; k++) {
    out[k] = v;
    v *= ((k + r) / (k + 1)) * (1 - p);
  }
  return out;
}

// Final scores [{ away, home, p }] from each team's mean goals.
export function goalGrid(means, share = 1) {
  const A = pmf(means.away * share);
  const H = pmf(means.home * share);
  const out = [];
  for (let a = 0; a < A.length; a++) for (let h = 0; h < H.length; h++) if (A[a] * H[h] > 1e-9) out.push({ away: a, home: h, p: A[a] * H[h] });
  return out;
}

const chance = (grid, test) => grid.reduce((s, x) => (test(x.away, x.home) ? s + x.p : s), 0);

// Hockey: each team's goals fitted to DraftKings' total and the home win
// chance (a regulation tie goes to overtime, split by the teams' strength).
export function fitHockey(homeWin, total) {
  const mean = total ? fitTotalRuns(total.line, total.overFair, GOALS_DISPERSION) : 6;
  let lo = 0.1;
  let hi = 0.9;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    const g = goalGrid({ home: mean * s, away: mean * (1 - s) });
    const win = chance(g, (a, h) => h > a) + chance(g, (a, h) => h === a) * s;
    if (win < homeWin) lo = s;
    else hi = s;
  }
  const s = (lo + hi) / 2;
  return { home: mean * s, away: mean * (1 - s) };
}

const CORRECT_SCORES = ['1-0', '2-0', '2-1', '3-0', '3-1', '3-2', '0-0', '1-1', '2-2', '3-3', '0-1', '0-2', '1-2', '0-3', '1-3', '2-3'];

export function goalMarkets(means, { family, totalLine }) {
  const out = [];
  const grid = goalGrid(means);
  const favourite = means.away > means.home ? 'away' : 'home';
  const lines = family === 'hockey' ? [1.5, 2.5] : [0.5, 1.5, 2.5];
  // Handicaps: the favourite giving goals, and taking them for hockey's puck line.
  for (const line of lines) {
    for (const giver of family === 'hockey' ? [favourite, favourite === 'away' ? 'home' : 'away'] : [favourite]) {
      const awayLine = giver === 'away' ? -line : line;
      const awayCover = chance(grid, (a, h) => a + awayLine > h);
      if (awayCover < 0.04 || awayCover > 0.96) continue;
      out.push({ kind: 'runline', market: `rl|${awayLine}`, awayLine, giver, posted: line === lines[0] && giver === favourite, cut: CUT.twoWay, picks: [
        { side: 'away', fair: awayCover, line: awayLine },
        { side: 'home', fair: 1 - awayCover, line: -awayLine }
      ] });
    }
  }
  if (family === 'hockey') {
    // Totals around DraftKings' line, and the 60-minute (regulation) result.
    const main = totalLine != null ? (totalLine % 1 ? totalLine : totalLine + 0.5) : 5.5;
    for (const d of [-1, 0, 1]) {
      const line = main + d;
      const over = chance(grid, (a, h) => a + h > line);
      out.push({ kind: 'total', market: `total|${line}`, line, posted: d === 0, main: d === 0, cut: CUT.twoWay, picks: [
        { side: 'over', fair: over },
        { side: 'under', fair: 1 - over }
      ] });
    }
    out.push({ kind: 'regulation', market: 'regulation', cut: CUT.threeWay, picks: [
      { side: 'away', fair: chance(grid, (a, h) => a > h) },
      { side: 'draw', fair: chance(grid, (a, h) => a === h) },
      { side: 'home', fair: chance(grid, (a, h) => h > a) }
    ] });
  } else {
    const yes = chance(grid, (a, h) => a > 0 && h > 0);
    out.push({ kind: 'btts', market: 'btts', cut: CUT.twoWay, picks: [{ side: 'yes', fair: yes }, { side: 'no', fair: 1 - yes }] });
    // Correct score (home-away), the rest as "other".
    const listed = CORRECT_SCORES.map(score => {
      const [h, a] = score.split('-').map(Number);
      return { side: score, score, fair: chance(grid, (x, y) => y === h && x === a) };
    });
    const other = 1 - listed.reduce((s, x) => s + x.fair, 0);
    out.push({ kind: 'score', market: 'score', cut: CUT.score, listed: CORRECT_SCORES, picks: [...listed, { side: 'other', score: 'other', fair: other }] });
    // First half: 45% of the goals come before the break.
    const first = goalGrid(means, 0.45);
    out.push({ kind: 'half', market: 'half', cut: CUT.threeWay, picks: [
      { side: 'home', fair: chance(first, (a, h) => h > a) },
      { side: 'draw', fair: chance(first, (a, h) => a === h) },
      { side: 'away', fair: chance(first, (a, h) => a > h) }
    ] });
  }
  const odd = chance(grid, (a, h) => (a + h) % 2 === 1);
  out.push({ kind: 'oddeven', market: 'oddeven', cut: CUT.twoWay, picks: [{ side: 'odd', fair: odd }, { side: 'even', fair: 1 - odd }] });
  return out;
}

// ---- Baseball ---------------------------------------------------------------------

function nb(mean, r, kMax = 30) {
  return pmf(mean, r, kMax);
}

export function baseballMarkets({ homeWin, total }) {
  if (!total) return [];
  const means = fitTeamRuns(homeWin, total.line, total.overFair);
  const { grid, size } = scoreGrid(means.home, means.away);
  const at = test => {
    let s = 0;
    for (let h = 0; h < size; h++) for (let a = 0; a < size; a++) if (test(a, h)) s += grid[h * size + a];
    return s;
  };
  const out = [];
  const odd = at((a, h) => (a + h) % 2 === 1);
  out.push({ kind: 'oddeven', market: 'oddeven', cut: CUT.twoWay, picks: [{ side: 'odd', fair: odd }, { side: 'even', fair: 1 - odd }] });
  // Winning margin: each team by 1, 2, 3-4, 5+.
  const bands = [];
  for (const team of ['home', 'away']) {
    for (const [lo, hi] of [[1, 1], [2, 2], [3, 4], [5, null]]) {
      const fair = at((a, h) => {
        const m = team === 'home' ? h - a : a - h;
        return m >= lo && (hi == null || m <= hi);
      });
      bands.push({ side: `${team}|${lo}`, team, lo, hi, fair });
    }
  }
  out.push({ kind: 'margin', market: 'margin', cut: CUT.bands, picks: bands });
  // First inning: a run scored in it (either team), a ninth of each team's game.
  const r = TEAM_RUNS_DISPERSION / 9;
  const none = nb(means.away / 9, r)[0] * nb(means.home / 9, r)[0];
  out.push({ kind: 'firstinning', market: 'firstinning', cut: CUT.twoWay, picks: [{ side: 'yes', fair: 1 - none }, { side: 'no', fair: none }] });
  // First five innings: a five-inning game, ties allowed.
  const A = nb((means.away * 5) / 9, (TEAM_RUNS_DISPERSION * 5) / 9);
  const H = nb((means.home * 5) / 9, (TEAM_RUNS_DISPERSION * 5) / 9);
  let away = 0;
  let tie = 0;
  for (let a = 0; a < A.length; a++) for (let h = 0; h < H.length; h++) (a > h ? (away += A[a] * H[h]) : a === h ? (tie += A[a] * H[h]) : 0);
  out.push({ kind: 'f5', market: 'f5', cut: CUT.threeWay, picks: [
    { side: 'away', fair: away },
    { side: 'draw', fair: tie },
    { side: 'home', fair: 1 - away - tie }
  ] });
  return out;
}

// Odds for one pick of a market at its cut.
export function marketOdds(market, fair) {
  return market.cut >= CUT.bands ? bandOdds(fair, market.cut) : oddsAt(fair, market.cut);
}
