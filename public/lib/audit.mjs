// A fairness check on the simulator's inputs and outputs. No sport, kind of
// fan or stand-in board should do better or worse than the rest because of
// how it's modelled: only because the lottery really prices it differently.
// Tests run it on every sport's typical week, and the page on the live board
// (it warns in the console), so a pool that quietly pays more (like the
// basketball stand-in that once paid NT$86 per NT$100 against 76-83 on real
// boards) is caught.
//
// F1 is left out: the lottery really does take far more on it.
import { crowdPools } from './sim.mjs';

// How far (in NT$ per NT$100) a sport or kind of fan may be from the rest.
export const AUDIT_TOLERANCE = { pool: 6, fan: 5 };
const EXEMPT = new Set(['f1']);

// What the crowd's usual pick returns per NT$100 on one sport's pool: every
// option weighted as people pick it (its chance x its market's popularity).
export function poolBack(pool) {
  const { any } = crowdPools(pool);
  let w = 0;
  let back = 0;
  for (const b of any) {
    w += b.w;
    back += b.w * b.fairChance * b.odds;
  }
  return w > 0 ? (back / w) * 100 : null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

// Sports whose pool is out of line: [{ sport, back, median }].
export function auditPools(sportPools, tolerance = AUDIT_TOLERANCE.pool) {
  const backs = Object.entries(sportPools)
    .filter(([sport, pool]) => !EXEMPT.has(sport) && pool?.length)
    .map(([sport, pool]) => ({ sport, back: poolBack(pool) }))
    .filter(x => x.back != null);
  const mid = median(backs.map(x => x.back));
  return backs.filter(x => Math.abs(x.back - mid) > tolerance).map(x => ({ ...x, median: mid }));
}

// Kinds of fan whose money back is out of line with the whole crowd's:
// [{ fan, back, crowd }].
export function auditCrowd(stats, tolerance = AUDIT_TOLERANCE.fan) {
  const crowd = stats.totals.staked ? ((stats.totals.staked + stats.totals.net) / stats.totals.staked) * 100 : null;
  if (crowd == null) return [];
  return stats.fanSummaries.filter(f => !EXEMPT.has(f.fan.key) && Math.abs(f.back - crowd) > tolerance).map(f => ({ fan: f.fan.key, back: f.back, crowd }));
}
