// Runs the crowd simulation off the page's main thread, so the page stays
// responsive, and reports progress for the loading screen.
//
// One 1-year run answers 1, 3 and 6 months and 1 year at once. The worker
// keeps where every player stopped, so 3 years only plays the 2 years after
// that instead of starting over.
import { habitPools, simulateCrowd } from './lib/odds.mjs';

const YEAR = 52;
const WITHIN_YEAR = [4, 13, 26, 52];
let base = null;

self.onmessage = ({ data }) => {
  const { id, sportBets, startWeek, weeks, perGroup, seed } = data;
  const key = JSON.stringify([sportBets, startWeek, perGroup, seed]);
  const sportPools = Object.fromEntries(Object.entries(sportBets).map(([sport, bets]) => [sport, habitPools(bets)]));
  const common = { sportPools, startWeek, perGroup, seed };
  const longer = weeks > YEAR;
  const report = (from, share) => progress => self.postMessage({ id, progress: from + share * progress });
  let results = {};
  if (base?.key !== key) {
    const year = simulateCrowd({ ...common, weeks: YEAR, checkpoints: WITHIN_YEAR, onProgress: report(0, longer ? YEAR / weeks : 1) });
    base = { key, resume: year.resume };
    results = year.results;
  }
  if (longer) {
    const rest = simulateCrowd({ ...common, weeks, resume: base.resume, onProgress: report(YEAR / weeks, 1 - YEAR / weeks) });
    results = { ...results, ...rest.results };
  }
  self.postMessage({ id, results });
};
