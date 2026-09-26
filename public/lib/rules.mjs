// The lottery's house rules for single options, shared by the bet slip and the
// simulated crowd, so both play by exactly the same rules.
//
// The lottery protects itself at both ends of the price range:
// - a very short price (a near-certain pick) is locked, or sold only inside a
//   parlay of 2 or 3+ games (限2關 / 限3關), so nobody can lean on it alone;
// - a long price on an ordinary game market (a lopsided game's underdog, a far
//   line) is locked: the house can't price it well and won't carry the risk.
// Markets built around long prices (correct score, top inning, winning
// margins) stay open further out; F1 and championships are priced one by one
// up to the lottery's 500 and are never locked.
//
// These thresholds are the house's usual shape, not measured on the lottery's
// board: the page marks them as an estimate.
export const HOUSE_RULES = {
  // At or under this, locked.
  lockLow: 1.05,
  // Under these, only in a parlay of at least 3 / 2 games.
  threeLegsUnder: 1.15,
  twoLegsUnder: 1.3,
  // At or over this, locked: ordinary game markets / many-outcome markets.
  lockHigh: 8,
  lockHighExotic: 80
};

// Markets whose outcomes are many and long by design.
const EXOTIC = new Set(['score', 'margin', 'inning', 'nextrun', 'htft', 'goalbands', 'sets']);
// Priced one by one by the lottery, never locked or limited here.
const UNRULED = new Set(['f1', 'future']);

// { lock: 'low' | 'high' | null, minLegs } for an option at `odds`.
export function houseRule(kind, odds) {
  if (UNRULED.has(kind) || !(odds > 0)) return { lock: null, minLegs: 1 };
  const r = HOUSE_RULES;
  if (odds <= r.lockLow) return { lock: 'low', minLegs: 1 };
  if (odds >= (EXOTIC.has(kind) ? r.lockHighExotic : r.lockHigh)) return { lock: 'high', minLegs: 1 };
  if (odds < r.threeLegsUnder) return { lock: null, minLegs: 3 };
  if (odds < r.twoLegsUnder) return { lock: null, minLegs: 2 };
  return { lock: null, minLegs: 1 };
}

// The fewest games any combination on a ticket has: every one of its
// combinations must satisfy each leg's minimum (a leg sits in combinations of
// every chosen size, so the smallest size is what counts).
export function minLegsProblem(legs, sizes) {
  const need = Math.max(1, ...legs.map(l => l.minLegs ?? 1));
  const smallest = sizes.length ? Math.min(...sizes) : 0;
  return smallest > 0 && smallest < need ? need : 0;
}

// ---- The house's cut, by its own risk --------------------------------------
//
// The lottery doesn't take the same cut everywhere: it takes more where it
// knows less or can lose more. Each market's overround (implied chances added
// up) starts from what the lottery was measured taking on that kind of market
// and grows with the house's risk:
// - how sure the fair price is: the gap between the sources (a pick whose
//   sources disagree by 3 points costs about 3 points more);
// - how well the league is known: the big North American leagues and the top
//   European soccer leagues add nothing, other leagues a little, sports with
//   one bookmaker's line only (tennis, table tennis, Asian baseball…) more;
// - how far a line is from the main one: each step out adds a little;
// - live (場中): prices move under the house, as measured (1.16).
// With no extra risk the cut is the measured one, so an MLB game with both
// sources prices exactly as the lottery's board did (1.151-1.158); the
// average across a normal day stays within about a point of that.
export const BASE_CUT = {
  twoWay: 1.158, // MLB win, totals, run lines, team totals: 81 markets, 2026-09-25
  threeWay: 1.2,
  bands: 1.35,
  score: 1.5,
  topInning: 1.92, // the lottery's own table
  nextRun: 1.31, // 第N分, live
  live: 1.16 // 場中 win, total, run line
};
export const TIER_RISK = { major: 0, minor: 0.015, thin: 0.03 };
export const LINE_STEP_RISK = 0.006;
// Never more than this much over the base.
export const MAX_RISK = 0.08;

// Leagues by how well the house knows them.
const MAJOR = new Set(['mlb', 'nba', 'nfl', 'nhl', 'epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl', 'f1']);
const THIN = new Set(['tennis', 'wta', 'badminton', 'tabletennis', 'volleyball', 'snooker', 'npb', 'kbo', 'cpbl', 'euroleague', 'bleague']);
export function leagueTier(sport) {
  return MAJOR.has(sport) ? 'major' : THIN.has(sport) ? 'thin' : 'minor';
}

// The usual gap between the sources on a big-league game: the measured cuts
// already carry it, so only disagreement beyond it adds risk.
export const TYPICAL_GAP = 0.01;

// The overround for one market: `base` a BASE_CUT key or a measured
// overround, `sport` the league, `fairMargin` the sources' disagreement
// (0-1, per pick; unknown counts as typical), `steps` how many lines from the
// main one.
export function houseCut({ base = 'twoWay', sport = null, fairMargin = null, steps = 0 } = {}) {
  const k = typeof base === 'number' ? base : BASE_CUT[base];
  const gap = Math.max(0, (fairMargin ?? TYPICAL_GAP) - TYPICAL_GAP);
  const risk = Math.min(MAX_RISK, (sport ? TIER_RISK[leagueTier(sport)] : 0) + gap + LINE_STEP_RISK * Math.abs(steps || 0));
  return k * (1 + risk);
}
