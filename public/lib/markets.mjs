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
  wnba: { margin: 11, total: 14, bands: [[1, 5], [6, 10], [11, 15], [16, null]], step: 4 },
  // EuroLeague and B.League: shorter games (40 minutes), lower scoring than the NBA.
  euroleague: { margin: 11, total: 15, bands: [[1, 5], [6, 10], [11, 15], [16, null]], step: 4 },
  bleague: { margin: 11.5, total: 16, bands: [[1, 5], [6, 10], [11, 15], [16, null]], step: 4 }
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
    out.push({ kind: 'runline', market: `rl|${awayLine}`, awayLine, giver: awayLine < 0 ? 'away' : 'home', posted: d === 0, steps: Math.abs(d), cut: CUT.twoWay, picks: [
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
      out.push({ kind: 'total', market: `total|${line}`, line, posted: d === 0, main: d === 0, steps: Math.abs(d), cut: CUT.twoWay, picks: [
        { side: 'over', fair: over },
        { side: 'under', fair: 1 - over }
      ] });
    }
    out.push({ kind: 'oddeven', market: 'oddeven', cut: CUT.twoWay, picks: [{ side: 'odd', fair: 0.5 }, { side: 'even', fair: 0.5 }] });
  }
  if (m.total != null) {
    // 單隊總分: each team's points, the total split by the margin; a team's
    // spread is half the combined one.
    const teamSd = Math.sqrt(m.totalSd ** 2 + m.marginSd ** 2) / 2;
    for (const team of ['away', 'home']) {
      const mean = (m.total + (team === 'home' ? m.margin : -m.margin)) / 2;
      for (const d of [-1, 0, 1]) {
        const line = round2(half(mean) + d * step);
        const over = 1 - normalCdf((line - mean) / teamSd);
        if (over < 0.04 || over > 0.96) continue;
        out.push({ kind: 'teamtotal', market: `tt|${team}|${line}`, team, line, posted: d === 0, steps: Math.abs(d), cut: CUT.twoWay, picks: [
          { side: 'over', fair: over, team },
          { side: 'under', fair: 1 - over, team }
        ] });
      }
    }
    // 上半場大小: half the total, its spread shrunk by the square root of two.
    const hMean = m.total / 2;
    const hSd = m.totalSd / Math.SQRT2;
    for (const d of [-1, 0, 1]) {
      const line = round2(half(hMean) + d * step);
      const over = 1 - normalCdf((line - hMean) / hSd);
      if (over < 0.04 || over > 0.96) continue;
      out.push({ kind: 'htotal', market: `htotal|${line}`, line, posted: d === 0, steps: Math.abs(d), cut: CUT.twoWay, picks: [
        { side: 'over', fair: over },
        { side: 'under', fair: 1 - over }
      ] });
    }
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
  // 第一節 (basketball) / 第一節 of football: a quarter of the margin, half the spread.
  const q = { margin: m.margin / 4, marginSd: m.marginSd / 2 };
  const qTie = marginBetween(q, 0, 0);
  const qHome = 1 - normalCdf((0.5 - q.margin) / q.marginSd);
  out.push({ kind: 'q1', market: 'q1', cut: CUT.threeWay, picks: [
    { side: 'away', fair: 1 - qHome - qTie },
    { side: 'draw', fair: qTie },
    { side: 'home', fair: qHome }
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
  // 單隊大小: each team's goals.
  for (const team of ['away', 'home']) {
    for (const line of family === 'hockey' ? [1.5, 2.5, 3.5] : [0.5, 1.5, 2.5]) {
      const over = chance(grid, (a, h) => (team === 'home' ? h : a) > line);
      if (over < 0.04 || over > 0.96) continue;
      out.push({ kind: 'teamtotal', market: `tt|${team}|${line}`, team, line, posted: line === (family === 'hockey' ? 2.5 : 1.5), cut: CUT.twoWay, picks: [
        { side: 'over', fair: over, team },
        { side: 'under', fair: 1 - over, team }
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
    // 上半場大小: first-half goals.
    for (const line of [0.5, 1.5, 2.5]) {
      const over = chance(first, (a, h) => a + h > line);
      if (over < 0.04 || over > 0.96) continue;
      out.push({ kind: 'htotal', market: `htotal|${line}`, line, posted: line === 1.5, cut: CUT.twoWay, picks: [
        { side: 'over', fair: over },
        { side: 'under', fair: 1 - over }
      ] });
    }
    // 雙重機會: two of the three results in one pick.
    const win = { home: chance(grid, (a, h) => h > a), draw: chance(grid, (a, h) => a === h), away: chance(grid, (a, h) => a > h) };
    out.push({ kind: 'dc', market: 'dc', cut: CUT.twoWay, picks: [
      { side: 'home|draw', fair: win.home + win.draw },
      { side: 'home|away', fair: win.home + win.away },
      { side: 'draw|away', fair: win.draw + win.away }
    ] });
    // 半全場: the half-time and full-time results together (9 outcomes), the
    // second half's goals on their own.
    const second = goalGrid(means, 0.55);
    const res = (a, h) => (h > a ? 'home' : h === a ? 'draw' : 'away');
    const htft = new Map();
    for (const x of first) for (const y of second) {
      const key = `${res(x.away, x.home)}|${res(x.away + y.away, x.home + y.home)}`;
      htft.set(key, (htft.get(key) ?? 0) + x.p * y.p);
    }
    const order = ['home', 'draw', 'away'];
    out.push({ kind: 'htft', market: 'htft', cut: CUT.bands, picks: order.flatMap(ht => order.map(ft => ({ side: `${ht}|${ft}`, ht, ft, fair: htft.get(`${ht}|${ft}`) ?? 0 }))) });
    // 總進球數: total goals in bands.
    const bands = [[0, 1], [2, 3], [4, 6], [7, null]];
    out.push({ kind: 'goalbands', market: 'goalbands', cut: CUT.bands, picks: bands.map(([lo, hi]) => ({ side: `${lo}`, lo, hi, fair: chance(grid, (a, h) => a + h >= lo && (hi == null || a + h <= hi)) })) });
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
  // 首分: who scores first. Each half-inning a team scores with its own
  // chance (a ninth of its runs); the away team bats first.
  const sa = 1 - nb(means.away / 9, r)[0];
  const sh = 1 - nb(means.home / 9, r)[0];
  const awayFirst = sa / (1 - (1 - sa) * (1 - sh));
  out.push({ kind: 'nextrun', market: 'nextrun|1', line: 1, cut: CUT.twoWay, picks: [{ side: 'away', fair: awayFirst }, { side: 'home', fair: 1 - awayFirst }] });
  out.push({ kind: 'f5', market: 'f5', cut: CUT.threeWay, picks: [
    { side: 'away', fair: away },
    { side: 'draw', fair: tie },
    { side: 'home', fair: 1 - away - tie }
  ] });
  return out;
}

// Odds for one pick of a market at its cut (`k`: the house's cut for this
// market, its base cut when not given; many-outcome markets price every
// pick at the cut, others never more than halfway to certain).
export function marketOdds(market, fair, k = market.cut) {
  return market.cut >= CUT.bands ? bandOdds(fair, k) : oddsAt(fair, k);
}

// ---- Played in sets (tennis, badminton, table tennis, volleyball) -----------------

const choose = (n, k) => {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
};

// Chance the home side wins a best-of-`bestOf` match, winning each set with
// chance q, and the q that gives match chance p.
export function matchChance(q, bestOf) {
  const need = Math.ceil(bestOf / 2);
  let p = 0;
  for (let lost = 0; lost < need; lost++) p += choose(need - 1 + lost, lost) * q ** need * (1 - q) ** lost;
  return p;
}
export function setChance(p, bestOf) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (matchChance(mid, bestOf) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Every final set score (home-away) with its chance, sets independent.
export function setScores(q, bestOf) {
  const need = Math.ceil(bestOf / 2);
  const out = [];
  for (let lost = 0; lost < need; lost++) {
    out.push({ home: need, away: lost, p: choose(need - 1 + lost, lost) * q ** need * (1 - q) ** lost });
    out.push({ home: lost, away: need, p: choose(need - 1 + lost, lost) * (1 - q) ** need * q ** lost });
  }
  return out;
}

// The set markets: 比分 (correct sets), 總局數 (total sets), 讓局 (set
// handicap) and 第一局 (first set), from the match win chance.
export function setsMarkets({ homeWin, bestOf }) {
  if (!bestOf || !(homeWin > 0 && homeWin < 1)) return [];
  const q = setChance(homeWin, bestOf);
  const scores = setScores(q, bestOf);
  const need = Math.ceil(bestOf / 2);
  const out = [];
  out.push({ kind: 'firstset', market: 'firstset', cut: CUT.twoWay, picks: [{ side: 'away', fair: 1 - q }, { side: 'home', fair: q }] });
  out.push({ kind: 'sets', market: 'sets', cut: CUT.bands, picks: scores.map(x => ({ side: `${x.home}-${x.away}`, score: `${x.home}-${x.away}`, fair: x.p })) });
  for (let line = need + 0.5; line < bestOf; line += 1) {
    const over = scores.filter(x => x.home + x.away > line).reduce((s, x) => s + x.p, 0);
    out.push({ kind: 'totalsets', market: `totalsets|${line}`, line, cut: CUT.twoWay, picks: [{ side: 'over', fair: over }, { side: 'under', fair: 1 - over }] });
  }
  for (let line = 1.5; line < need; line += 1) {
    // The home side giving `line` sets, and taking them.
    for (const awayLine of [line, -line]) {
      const awayCover = scores.filter(x => x.away + awayLine > x.home).reduce((s, x) => s + x.p, 0);
      if (awayCover < 0.03 || awayCover > 0.97) continue;
      out.push({ kind: 'sethcap', market: `sethcap|${awayLine}`, awayLine, giver: awayLine > 0 ? 'home' : 'away', cut: CUT.twoWay, picks: [
        { side: 'away', fair: awayCover, line: awayLine },
        { side: 'home', fair: 1 - awayCover, line: -awayLine }
      ] });
    }
  }
  return out;
}

// ---- Games, points and frames across a match ------------------------------------
//
// The bookmaker lists one handicap and one total in games (tennis), points
// (badminton, table tennis, volleyball) or frames (snooker), when it lists
// them at all. For more lines, and for matches it lists none on, a small
// model: every game or point is won by the home side with the same chance r
// (the one that gives its chance of winning a set), a set goes to `target`
// won by 2 (tennis: a tiebreak at 6-6; badminton: 30 wins at 29-29), and
// sets are played until one side has won the match. A frame is a set of one.

// One set's final scores [{ h, a, p }] for unit chance r.
function setUnits(r, { unit, target, cap }) {
  if (unit === 'frames') return [{ h: 1, a: 0, p: r }, { h: 0, a: 1, p: 1 - r }];
  const T = target;
  // Sudden death: tennis's tiebreak at 6-6 (7-6), badminton's point at 29-29.
  const sudden = unit === 'games' ? T : cap ? cap - 1 : Infinity;
  const out = [];
  for (let k = 0; k <= T - 2; k++) {
    const c = choose(T - 1 + k, k);
    out.push({ h: T, a: k, p: c * r ** T * (1 - r) ** k });
    out.push({ h: k, a: T, p: c * (1 - r) ** T * r ** k });
  }
  // Level at T-1 all, then two clear (or the next unit at `sudden`).
  let mass = choose(2 * T - 2, T - 1) * (r * (1 - r)) ** (T - 1);
  for (let n = T - 1; mass > 1e-9 && n < T + 40; n++) {
    if (n === sudden) {
      out.push({ h: n + 1, a: n, p: mass * r }, { h: n, a: n + 1, p: mass * (1 - r) });
      break;
    }
    out.push({ h: n + 2, a: n, p: mass * r * r }, { h: n, a: n + 2, p: mass * (1 - r) * (1 - r) });
    mass *= 2 * r * (1 - r);
  }
  return out;
}

const setWin = scores => scores.reduce((s, x) => (x.h > x.a ? s + x.p : s), 0);

// Distributions of the match's total units and the home side's margin in
// units, for a best-of-`bestOf` match the home side wins with chance homeWin.
// Returns { total: [p by count], diff: [p by margin + off], off }.
export function unitModel({ homeWin, bestOf, spec }) {
  if (!bestOf || !spec?.unit || !(homeWin > 0 && homeWin < 1)) return null;
  const q = setChance(homeWin, bestOf);
  // The unit chance that wins a set with chance q.
  let lo = 0.01;
  let hi = 0.99;
  for (let i = 0; i < 40 && spec.unit !== 'frames'; i++) {
    const mid = (lo + hi) / 2;
    if (setWin(setUnits(mid, spec)) < q) lo = mid;
    else hi = mid;
  }
  const r = spec.unit === 'frames' ? q : (lo + hi) / 2;
  const sets = setUnits(r, spec);
  const lastSets = spec.last ? setUnits(r, { ...spec, target: spec.last }) : sets;
  const need = Math.ceil(bestOf / 2);
  const size = bestOf * ((spec.target ?? 1) + 45);
  const off = size;
  const total = new Float64Array(size + 1);
  const diff = new Float64Array(2 * size + 1);
  // States (home sets, away sets) -> their total and margin distributions.
  let states = new Map([['0|0', { hs: 0, as: 0, t: new Map([[0, 1]]), d: new Map([[0, 1]]) }]]);
  while (states.size) {
    const next = new Map();
    for (const st of states.values()) {
      const list = st.hs + st.as === bestOf - 1 ? lastSets : sets;
      for (const x of list) {
        const hs = st.hs + (x.h > x.a ? 1 : 0);
        const as = st.as + (x.h > x.a ? 0 : 1);
        const done = hs === need || as === need;
        const key = `${hs}|${as}`;
        const to = done ? null : next.get(key) ?? next.set(key, { hs, as, t: new Map(), d: new Map() }).get(key);
        for (const [v, p] of st.t) {
          const u = v + x.h + x.a;
          if (done) total[Math.min(size, u)] += p * x.p;
          else to.t.set(u, (to.t.get(u) ?? 0) + p * x.p);
        }
        for (const [v, p] of st.d) {
          const u = v + x.h - x.a;
          if (done) diff[Math.max(0, Math.min(2 * size, u + off))] += p * x.p;
          else to.d.set(u, (to.d.get(u) ?? 0) + p * x.p);
        }
      }
    }
    states = next;
  }
  return { total, diff, off };
}

// P(total > line) and P(home margin > line), for a half line.
const overAt = (model, line) => model.total.reduce((s, p, u) => (u > line ? s + p : s), 0);
const marginOver = (model, line) => model.diff.reduce((s, p, i) => (i - model.off > line ? s + p : s), 0);

// Units per line step: games and frames 1, points by the sport's scale.
const UNIT_STEP = { games: [1, 1], frames: [1, 1], points: [2, 2] };

// Handicap and total lines in units around the bookmaker's own (its line is
// left to the bookmaker's price; the model's lines are shifted so it agrees
// with that price), or around the model's middle when it lists none.
export function unitLineMarkets(model, { spread, total, spec }) {
  if (!model) return [];
  const [hStep, tStep] = spec.unit === 'points' ? [Math.max(2, Math.round(spec.target / 8)), Math.max(2, Math.round(spec.target / 5))] : UNIT_STEP[spec.unit];
  const out = [];
  // Where the model's own over chance at `line` matches `fair`: the line
  // shift that puts the model on the bookmaker's price.
  const shiftFor = (at, line, fair) => {
    let best = 0;
    let err = Infinity;
    for (let s = -12; s <= 12; s++) {
      const e = Math.abs(at(line - s) - fair);
      if (e < err) [best, err] = [s, e];
    }
    return best;
  };
  const middle = at => {
    for (let line = -200.5; line < 400; line += 1) if (at(line) < 0.5) return line;
    return 0.5;
  };
  // Totals.
  {
    const at = line => overAt(model, line);
    const main = total ? total.line : middle(at);
    const shift = total ? shiftFor(at, total.line, total.overFair) : 0;
    for (const d of [-2, -1, 0, 1, 2].filter(d => d || !total)) {
      const line = round2(main + d * tStep);
      if (line <= 0) continue;
      const over = at(line - shift);
      if (over < 0.05 || over > 0.95) continue;
      out.push({ kind: 'gametotal', market: `gt|${line}`, line, posted: false, steps: Math.abs(d), cut: CUT.twoWay, picks: [{ side: 'over', fair: over }, { side: 'under', fair: 1 - over }] });
    }
  }
  // Handicaps: away covers when home margin < awayLine.
  {
    const at = line => 1 - marginOver(model, line);
    const main = spread ? spread.awayLine : middle(line => 1 - at(line));
    const shift = spread ? shiftFor(at, spread.awayLine, spread.awayFair) : 0;
    for (const d of [-2, -1, 0, 1, 2].filter(d => d || !spread)) {
      const awayLine = round2(main + d * hStep);
      if (Math.abs(awayLine) < 0.5) continue;
      const awayCover = at(awayLine - shift);
      if (awayCover < 0.05 || awayCover > 0.95) continue;
      out.push({ kind: 'gamehcap', market: `gh|${awayLine}`, awayLine, giver: awayLine < 0 ? 'away' : 'home', posted: false, steps: Math.abs(d), cut: CUT.twoWay, picks: [
        { side: 'away', fair: awayCover, line: awayLine },
        { side: 'home', fair: 1 - awayCover, line: -awayLine }
      ] });
    }
  }
  return out;
}

// Snooker matches run to different lengths (best of 7 to 35 frames) and the
// feed doesn't say which: the length whose frame total agrees best with the
// bookmaker's total line.
const SNOOKER_LENGTHS = [7, 9, 11, 13, 17, 19, 25, 33, 35];
export function guessBestOf({ homeWin, total }) {
  if (!total || !(homeWin > 0 && homeWin < 1)) return null;
  let best = null;
  let err = Infinity;
  for (const bestOf of SNOOKER_LENGTHS) {
    const need = Math.ceil(bestOf / 2);
    if (total.line < need || total.line > bestOf) continue;
    const scores = setScores(setChance(homeWin, bestOf), bestOf);
    const over = scores.filter(x => x.home + x.away > total.line).reduce((s, x) => s + x.p, 0);
    const e = Math.abs(over - total.overFair);
    if (e < err) [best, err] = [bestOf, e];
  }
  return best;
}
