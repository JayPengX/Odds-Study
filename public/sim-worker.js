// Runs the crowd simulation off the page's main thread, so the page stays
// responsive, and reports progress for the loading screen.
import { habitPools, simulateCrowdStats } from './lib/odds.mjs';

self.onmessage = ({ data }) => {
  const { id, pool, weeks, perHabit, seed } = data;
  const stats = simulateCrowdStats({
    pools: habitPools(pool),
    weeks,
    perHabit,
    seed,
    onProgress: progress => self.postMessage({ id, progress })
  });
  self.postMessage({ id, stats });
};
