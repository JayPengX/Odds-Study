// Runs the crowd simulation off the page's main thread, so the page stays
// responsive, and reports progress for the loading screen.
//
// Every run records the crowd at the end of each month along the way, so one
// 1-year run answers every period up to a year at once. The worker keeps where
// every player stopped at the furthest week so far, so a longer period only
// plays the weeks after that instead of starting over.
import { habitPools, simulateCrowd, MONTH_WEEKS } from './lib/odds.mjs';

const YEAR = 52;
let base = null;

self.onmessage = ({ data }) => {
  const { id, sportBets, startWeek, weeks, perGroup, seed } = data;
  const key = JSON.stringify([sportBets, startWeek, perGroup, seed]);
  if (base?.key !== key) base = null;
  const sportPools = Object.fromEntries(Object.entries(sportBets).map(([sport, bets]) => [sport, habitPools(bets)]));
  // Carry on from the furthest week played; the first run plays at least a year.
  const resume = base && base.resume.weeks < weeks ? base.resume : null;
  const from = resume?.weeks ?? 0;
  const to = resume ? weeks : Math.max(weeks, YEAR);
  const checkpoints = [...new Set([...MONTH_WEEKS.filter(w => w > from && w <= to), weeks])];
  const run = simulateCrowd({
    sportPools,
    startWeek,
    perGroup,
    seed,
    weeks: to,
    checkpoints,
    resume,
    onProgress: progress => self.postMessage({ id, progress })
  });
  if (!base || run.resume.weeks > base.resume.weeks) base = { key, resume: run.resume };
  self.postMessage({ id, results: run.results });
};
