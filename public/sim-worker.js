// Runs the crowd simulation off the page's main thread, so the page stays
// responsive, and reports progress for the loading screen.
import { habitPools, simulateCrowdStats } from './lib/odds.mjs';

self.onmessage = ({ data }) => {
  const { id, sportBets, startWeek, weeks, perGroup, seed } = data;
  const sportPools = Object.fromEntries(Object.entries(sportBets).map(([sport, bets]) => [sport, habitPools(bets)]));
  const stats = simulateCrowdStats({
    sportPools,
    startWeek,
    weeks,
    perGroup,
    seed,
    onProgress: progress => self.postMessage({ id, progress })
  });
  self.postMessage({ id, stats });
};
