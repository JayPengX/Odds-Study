// Recommendations, shown on each pick rather than in a separate list. Every
// pick is judged by the same number the whole page uses, its average back per
// NT$100 (its chance of winning x the lottery's odds), against the other
// picks on offer. The simulated crowd's value hunters pick from the same
// recommendations, so both sides see the same "good" bets.
//
// A pick gets at most one tag, first that fits:
// - value 划算: among the best returns of the lot (top 10%);
// - steady 穩: likely to win (65% or more) and returns at least the median;
// - shot 值博: a long shot (30% or less) whose return is in the top quarter.
// Locked picks (the house won't sell them) never get one, nor near-certain
// picks (over 85%: their return looks good only because the house can't
// price them under 1.01) or near-hopeless ones (under 5%), nor a lot too
// small to compare (under 10 picks).
export const RECOMMEND = { valueTop: 0.1, shotTop: 0.25, steadyChance: 0.65, shotChance: 0.3, minPool: 10, range: [0.05, 0.85] };

// Average back per NT$100.
export const backOf = bet => bet.fairChance * bet.estOdds * 100;

// Map of bet id -> { tag, back, beats } where `beats` is the share of the lot
// the pick returns more than.
export function recommend(bets, back = backOf) {
  const [lo, hi] = RECOMMEND.range;
  const pool = bets.filter(b => !b.lock && b.fairChance >= lo && b.fairChance <= hi && b.estOdds > 1);
  const out = new Map();
  if (pool.length < RECOMMEND.minPool) return out;
  const values = pool.map(back).sort((a, b) => a - b);
  const at = q => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  const valueLine = at(1 - RECOMMEND.valueTop);
  const shotLine = at(1 - RECOMMEND.shotTop);
  const median = at(0.5);
  const beats = v => {
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / values.length;
  };
  for (const b of pool) {
    const v = back(b);
    let tag = null;
    if (v >= valueLine) tag = 'value';
    else if (b.fairChance >= RECOMMEND.steadyChance && v >= median) tag = 'steady';
    else if (b.fairChance <= RECOMMEND.shotChance && v >= shotLine) tag = 'shot';
    if (tag) out.set(b.id ?? b, { tag, back: v, beats: beats(v) });
  }
  return out;
}
