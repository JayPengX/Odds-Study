// The simulated crowd: 100,000 people betting on the same board as you, by
// exactly the same rules (the practice account's money, the lottery's ticket
// rules, its locks and parlay-only picks, its tax), each with their own
// personality made of traits.
//
// A person is a combination of traits, nothing else. Some traits say how
// they bet (what they pick, how many picks a ticket, how big, how often); the
// rest are reactions to what happens to them (chasing losses, cashing out,
// sulking after a near miss …). Each person draws every trait on its own
// share, one at most from each group of how-they-bet traits.
import { SLIP_RULES, afterTax, seededRandom, estimateF1LotteryOdds } from './odds.mjs';
import { houseRule } from './rules.mjs';
import { gameOptions, crowdPool, f1Podium } from './board.mjs';
import { recommend } from './recommend.mjs';

// ---- Money --------------------------------------------------------------------

// Every simulated person plays by the practice account's rules: NT$10,000 to
// start, NT$5,000 more at the start of every week after the first, and never
// a ticket costing more than what's left this week. Winnings come in at the
// end of the week (this week's results are decided together).
export const SIM_START_BALANCE = 10_000;
export const SIM_WEEKLY_GRANT = 5_000;
// A winning ticket let ride (the 滾雪球 trait) goes back in over at most this
// many extra tickets a week.
const RIDE_EXTRA_TICKETS = 30;
// A few tickets are big ones: this share, three times the usual stake.
const BIG_TICKET_SHARE = 0.05;
// A ticket's stake shrinks with its picks: 1 / (1 + this x (picks - 1)).
const PARLAY_STAKE_CUT = 0.35;
const unitRound = x => Math.floor(x / SLIP_RULES.unit) * SLIP_RULES.unit;

// ---- Traits ---------------------------------------------------------------------
//
// `group`: at most one trait of a group (the rest of that group bet the
// usual way). `share`: how many people have it. The usual way, without any
// trait of a group: picks like everyone (in proportion to how likely each is
// and how popular its kind of market is), 1-2 picks a ticket, 3% of the
// balance a ticket, one ticket a week on average.
//
// The mix is set so the crowd's money lands where real money does. By law
// the lottery pays out at most 78% of sales in prizes, and it pays about
// that, so it keeps about 22% before tax. Every extra pick on a ticket pays
// the cut again, so that can only be true if most money goes on singles and
// short parlays: here, long parlays are small tickets (their stake shrinks
// with every pick), and the crowd as a whole gives the house 21-23% before
// tax (checked on a run of 20,000).
export const TRAITS = [
  // How they pick.
  { key: 'favorite', group: 'pick', share: 0.2 }, // 押熱門: only picks with 60%+ chance
  { key: 'underdog', group: 'pick', share: 0.12 }, // 爆冷獵人: only 35% or less
  { key: 'value', group: 'pick', share: 0.06 }, // 精算派: only the page's recommended picks
  { key: 'exotic', group: 'pick', share: 0.12 }, // 玩法控: side markets (scores, margins, sets, halves …)
  // How many picks a ticket.
  { key: 'single', group: 'legs', share: 0.2 }, // 單場派: one pick, where the house sells it alone
  { key: 'parlay', group: 'legs', share: 0.15 }, // 串關狂: 3-6 picks
  // How big.
  { key: 'whale', group: 'stake', share: 0.06 }, // 大戶: 8% of the balance a ticket
  { key: 'small', group: 'stake', share: 0.22 }, // 小資: 1%
  // How often.
  { key: 'daily', group: 'pace', share: 0.15 }, // 天天買: 4 tickets a week
  { key: 'rare', group: 'pace', share: 0.2 }, // 偶爾玩: one every 3 weeks
  // Reactions, each on its own.
  { key: 'tilt', share: 0.15 }, // 越輸越大: each losing week the next stakes x1.5 (up to 4x); a winning week resets
  { key: 'chaser', share: 0.08 }, // 追輸族: doubles the stake after a losing week, up to the ticket limit; 4 weeks off when it breaks
  { key: 'cashOut', share: 0.12 }, // 見好就收: NT$5,000 up, 8 weeks off, then the next NT$5,000 is the goal
  { key: 'streaky', share: 0.15 }, // 手感派: a ticket more after a winning week
  { key: 'pressOn', share: 0.1 }, // 乘勝追擊: after a winning ticket, the next stake doubled
  { key: 'revenge', share: 0.1 }, // 報復型: twice the tickets after losing NT$2,000+ in a week
  { key: 'heartbroken', share: 0.12 }, // 玻璃心: a parlay missed by one pick, 2 weeks off
  { key: 'soClose', share: 0.1 }, // 不服輸: a parlay missed by one pick, the next stake doubled
  { key: 'jackpot', share: 0.08 }, // 大獎夢: after a 10x win, a pick more per ticket (up to 3 more)
  { key: 'rider', share: 0.08 }, // 滾雪球: lets a win ride on the next tickets
  { key: 'guardian', share: 0.15 }, // 守本派: under the NT$10,000 start, half stakes
  { key: 'stopLoss', share: 0.1 }, // 停損: losing 30% of the week's money in a week, 6 weeks off
  { key: 'content', share: 0.12 }, // 小確幸: happy with a win, a week off
  { key: 'moody', share: 0.2 }, // 看心情: each week's stakes between half and double
  { key: 'bored', share: 0.08 }, // 三分鐘熱度: 10 losing tickets in a row, quits for good
  { key: 'hailMary', share: 0.08 }, // 孤注一擲: under the start, 2 picks more a ticket for a big win
  { key: 'loyal', share: 0.2 }, // 死忠: off-season, takes the weeks off
  { key: 'hopper', share: 0.15 } // 見異思遷: off-season, always bets on whatever is on
];
export const TRAIT_BIT = Object.fromEntries(TRAITS.map((trait, i) => [trait.key, 1 << i]));
export const TRAIT_GROUPS = [...new Set(TRAITS.map(t => t.group).filter(Boolean))];
// The two baselines the traits are compared with: people who bet the usual
// way (no trait of any group), and people with no reaction trait.
const STYLE_MASK = TRAITS.reduce((m, t, i) => (t.group ? m | (1 << i) : m), 0);
const REACT_MASK = TRAITS.reduce((m, t, i) => (t.group ? m : m | (1 << i)), 0);
export const TRAIT_ROWS = [...TRAITS, { key: 'plainStyle' }, { key: 'plainReact' }];
// The pick styles: the crowd is laid out by style (each style bets from its
// own lists), 'any' being no pick trait at all.
export const STYLES = [{ key: 'any', share: 1 - TRAITS.filter(t => t.group === 'pick').reduce((s, t) => s + t.share, 0) }, ...TRAITS.filter(t => t.group === 'pick')];

export function traitKeys(mask) {
  return TRAITS.filter((_, i) => mask & (1 << i)).map(trait => trait.key);
}

// A person's traits: their pick style (from the crowd's layout), at most one
// of each other group, and each reaction on its own.
function drawTraits(random, style) {
  let mask = style && style !== 'any' ? TRAIT_BIT[style] : 0;
  for (const group of TRAIT_GROUPS) {
    if (group === 'pick') continue;
    const r = random();
    let acc = 0;
    for (const t of TRAITS) {
      if (t.group !== group) continue;
      acc += t.share;
      if (r < acc) {
        mask |= TRAIT_BIT[t.key];
        break;
      }
    }
  }
  for (const t of TRAITS) if (!t.group && random() < t.share) mask |= TRAIT_BIT[t.key];
  return mask;
}

// How a person with these traits bets.
export function personOf(mask) {
  const has = key => (mask & TRAIT_BIT[key]) !== 0;
  return {
    perWeek: has('daily') ? 4 : has('rare') ? 0.35 : 1,
    legs: has('single') ? [1, 1] : has('parlay') ? [3, 6] : [1, 2],
    share: has('whale') ? 0.08 : has('small') ? 0.01 : 0.03,
    // Off-season: the share of weeks they bet on another sport instead.
    switchRate: has('loyal') ? 0 : has('hopper') ? 1 : OFFSEASON_SWITCH
  };
}

// ---- One shared world ------------------------------------------------------------
// Every person bets into the same world: each week every game (and each F1
// race) has one real result, and everyone who bet on it sees that result. A
// result is a hash of (world seed, week, market, copy) turned into a number
// in [0, 1) and matched against each option's slice of that number line, so
// nothing is stored and anyone can be replayed alone. `copy` tells apart the
// several real games a week that share one template game (MLB plays ~90 a
// week; the board has ~15).
//
// Markets of one game that describe the same thing share one number, with
// slices that agree: the winner and every handicap line (the away team's
// slice first), and every total line (under first). So on one game's result,
// "over 7.5" won means "over 6.5" won too, for everyone.
let worldSeed = 1;

function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function worldDraw(week, market, copy) {
  return mix32(mix32(mix32(mix32(worldSeed ^ 0x9e3779b9) ^ week) ^ market) ^ copy) / 4294967296;
}

export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return mix32(h) | 0;
}

// Each option's slice of [0, 1) within its market: given (`outLo`/`outHi`),
// or stacked in order within the options sharing a `key`.
function withOutcomes(pool) {
  const markets = new Map();
  for (const b of pool) {
    const key = b.key ?? `${b.gameId}|${b.market ?? ''}`;
    if (!markets.has(key)) markets.set(key, []);
    markets.get(key).push(b);
  }
  const out = new Map();
  for (const [key, options] of markets) {
    const total = options.reduce((sum, b) => sum + b.fairChance, 0) || 1;
    let lo = 0;
    for (const b of options) {
      const hi = lo + b.fairChance / total;
      out.set(b, { ...b, outLo: b.outLo ?? lo, outHi: b.outHi ?? hi, marketId: hashString(key), gameKey: hashString(String(b.gameKey ?? b.gameId)) });
      lo = hi;
    }
  }
  return pool.map(b => out.get(b));
}

// How popular each kind of market is when people pick freely: the winner
// most, handicaps and totals next, every side market a little. A game's
// weight is shared among its lines of a kind, so a game with ten total lines
// isn't picked ten times as often.
export const KIND_WEIGHT = { ml: 1, f1: 1, runline: 0.45, total: 0.45, gamehcap: 0.3, gametotal: 0.3 };
const SIDE_WEIGHT = 0.1;
const MAIN_KINDS = new Set(['ml', 'f1', 'runline', 'total', 'gamehcap', 'gametotal']);

// The lists each pick style draws from, from one sport's pool of options
// ({ gameId, key?, outLo?, outHi?, fairChance, odds, kind?, minLegs?, lock? }).
// Locked options are never on sale; a style with nothing to pick falls back
// to all.
export function crowdPools(rawPool) {
  const open = rawPool.filter(b => !b.lock && b.fairChance > 0 && b.odds > 1);
  // Lines of a kind per game, to share the game's weight among them.
  const lines = new Map();
  for (const b of open) {
    const k = `${b.gameId}|${b.kind ?? 'ml'}`;
    lines.set(k, (lines.get(k) ?? new Set()).add(b.key ?? b.market ?? ''));
  }
  const pool = withOutcomes(open).map(b => ({ ...b, w: b.fairChance * (KIND_WEIGHT[b.kind ?? 'ml'] ?? SIDE_WEIGHT) / lines.get(`${b.gameId}|${b.kind ?? 'ml'}`).size }));
  const lists = {
    any: pool,
    favorite: pool.filter(b => b.fairChance >= 0.6),
    underdog: pool.filter(b => b.fairChance <= 0.35),
    // The picks the page recommends (recommend.mjs), from the same numbers.
    value: recommendedOf(pool),
    exotic: pool.filter(b => !MAIN_KINDS.has(b.kind ?? 'ml')).map(b => ({ ...b, w: b.fairChance / lines.get(`${b.gameId}|${b.kind}`).size }))
  };
  for (const k of Object.keys(lists)) if (lists[k].length === 0) lists[k] = pool;
  return lists;
}

function recommendedOf(pool) {
  const recs = recommend(pool.map((b, i) => ({ id: i, fairChance: b.fairChance, estOdds: b.odds, lock: b.lock })));
  return pool.filter((_, i) => recs.has(i));
}

// Pools compiled to flat arrays (game index, fair chance, odds, the house's
// minimum legs), so the inner loop reads numbers and allocates nothing.
// Cached per list. `pickCum`: people choose options in proportion to their
// weight (their chance of winning, times how popular their kind is).
const compiledLists = new WeakMap();
function compile(list) {
  let c = compiledLists.get(list);
  if (!c) {
    const games = new Map();
    c = {
      n: list.length,
      game: Int32Array.from(list, b => (games.has(b.gameId) ? games.get(b.gameId) : games.set(b.gameId, games.size).get(b.gameId))),
      fair: Float64Array.from(list, b => b.fairChance),
      odds: Float64Array.from(list, b => b.odds),
      // The house's parlay-only rule: this option only on tickets of at least this many.
      minLegs: Int8Array.from(list, b => b.minLegs ?? houseRule(b.kind ?? 'ml', b.odds).minLegs),
      pickCum: new Float64Array(list.length),
      // Where each option sits in its market, for the shared results.
      lo: Float64Array.from(list, b => b.outLo ?? 0),
      hi: Float64Array.from(list, b => b.outHi ?? b.fairChance),
      market: Int32Array.from(list, b => b.marketId ?? b.gameId ?? 0),
      gameKey: Int32Array.from(list, b => b.gameKey ?? 0)
    };
    let sum = 0;
    list.forEach((b, i) => (c.pickCum[i] = sum += b.w ?? b.fairChance));
    for (let i = 0; i < c.n; i++) c.pickCum[i] /= sum;
    compiledLists.set(list, c);
  }
  return c;
}

// Games already on the ticket being built (at most 12 legs).
const ticketGames = new Int32Array(16);

// What a person can bet on in a week: one or more compiled lists (one per
// sport), picked in proportion to `weights`: the real games each sport plays
// that week. Each template game on the board stands for `copies` of them,
// each with its own result.
function picker(lists, weights = lists.map(() => 1)) {
  const compiled = lists.map(compile);
  const cum = new Float64Array(lists.length);
  let sum = 0;
  weights.forEach((w, i) => (cum[i] = sum += w));
  for (let i = 0; i < cum.length; i++) cum[i] /= sum;
  const copies = Int32Array.from(compiled, (c, i) => Math.max(1, Math.round(weights[i] / Math.max(1, new Set(c.game).size))));
  return { compiled, cum, copies, games: compiled.reduce((n, c, i) => n + new Set(c.game).size * copies[i], 0) };
}

// ---- One person's season ---------------------------------------------------------

// A person's running totals, so a season can stop and carry on later.
function freshState() {
  return {
    profit: 0,
    tickets: 0,
    wonTickets: 0,
    staked: 0,
    biggestWin: 0,
    biggestWinWeek: -1,
    biggestWinStake: 0,
    biggestWinLegs: 0,
    biggestWinOdds: 0,
    losing: 0,
    longestLosing: 0,
    winning: 0,
    longestWinning: 0,
    // The longest-odds ticket that won, the worst and best weeks, tax
    // withheld, and whether the very first ticket won.
    longshotOdds: 0,
    longshotWeek: -1,
    longshotStake: 0,
    longshotWin: 0,
    worstWeek: 0,
    worstWeekAt: -1,
    bestWeek: 0,
    bestWeekAt: -1,
    taxPaid: 0,
    firstWon: null,
    firstWinWeek: -1,
    chaseStake: 0,
    // Winnings waiting to ride on the next ticket.
    pot: 0,
    // Weeks still off, weeks taken off in all, and the next stake's multiplier.
    rest: 0,
    restWeeks: 0,
    boost: 1,
    maxStake: 0,
    peak: 0,
    peakWeek: -1,
    trough: 0,
    troughWeek: -1,
    maxDrop: 0,
    // Money in hand, weeks a ticket had to be cut or skipped for lack of it,
    // the lowest the balance went and how often it ran out.
    cash: SIM_START_BALANCE,
    shortWeeks: 0,
    lowestCash: SIM_START_BALANCE,
    brokeTimes: 0,
    broke: false,
    // Where the money went: stakes lost on losing tickets, payouts (after
    // tax) on winning ones, and this week's stakes, payouts before tax and tax.
    lostStakes: 0,
    wonPaid: 0,
    weekStaked: 0,
    weekGross: 0,
    weekTax: 0,
    // How they bet: weeks with a ticket, weeks ending ahead, single tickets,
    // picks and log-odds summed, parlays missed by one pick, and the most
    // picks on a winning ticket.
    weeksPlayed: 0,
    weeksAhead: 0,
    singles: 0,
    legsSum: 0,
    logOddsSum: 0,
    chanceSum: 0,
    nearMisses: 0,
    biggestParlay: 0,
    // Traits (a bit mask, drawn when the season starts) and their state.
    traits: null,
    tiltMult: 1,
    cashTarget: 5000,
    lastWeekWon: false,
    revengeNext: false,
    extraLegs: 0,
    quit: false
  };
}

// The story told about a person at some point of their season.
function storyOf(st) {
  return {
    final: st.profit,
    tickets: st.tickets,
    wonTickets: st.wonTickets,
    staked: st.staked,
    biggestWin: st.biggestWin,
    biggestWinWeek: st.biggestWinWeek,
    biggestWinStake: st.biggestWinStake,
    biggestWinLegs: st.biggestWinLegs,
    biggestWinOdds: st.biggestWinOdds,
    longestLosing: st.longestLosing,
    maxStake: st.maxStake,
    peak: st.peak,
    peakWeek: st.peakWeek,
    trough: st.trough,
    troughWeek: st.troughWeek,
    everAhead: st.peak > 0,
    maxDrop: st.maxDrop,
    longestWinning: st.longestWinning,
    longshotOdds: st.longshotOdds,
    longshotWeek: st.longshotWeek,
    longshotStake: st.longshotStake,
    longshotWin: st.longshotWin,
    worstWeek: st.worstWeek,
    worstWeekAt: st.worstWeekAt,
    bestWeek: st.bestWeek,
    bestWeekAt: st.bestWeekAt,
    taxPaid: st.taxPaid,
    restWeeks: st.restWeeks,
    firstWon: st.firstWon === true,
    firstWinWeek: st.firstWinWeek,
    cash: st.cash,
    shortWeeks: st.shortWeeks,
    lowestCash: st.lowestCash,
    brokeTimes: st.brokeTimes,
    lostStakes: st.lostStakes,
    wonPaid: st.wonPaid,
    weeksPlayed: st.weeksPlayed,
    weeksAhead: st.weeksAhead,
    singles: st.singles,
    avgLegs: st.tickets ? st.legsSum / st.tickets : 0,
    avgOdds: st.tickets ? Math.exp(st.logOddsSum / st.tickets) : 0,
    avgChance: st.legsSum ? st.chanceSum / st.legsSum : 0,
    nearMisses: st.nearMisses,
    biggestParlay: st.biggestParlay,
    traits: st.traits ?? 0,
    quit: st.quit
  };
}

// One person's betting from week `from` up to `weeks`, carrying on from `st`
// (their state so far; fresh by default). `weekPicker(w)` is what they bet
// on in week w (null: nothing on; then, by their off-season habit, they bet
// on `fallback(w)` instead). `legsCap` [lo, hi] overrides the picks per
// ticket (F1 fans: one race, one pick). Writes the running result at the end
// of each week into `path` (if given), calls `onWeek(w + 1, st)` after each
// week, pushes every ticket into `log` (if given) and returns the story.
function playSeason(style, weekPicker, weeks, random, path, fallback = null, legsCap = null, { from = 0, st = freshState(), onWeek = null, log = null } = {}) {
  if (st.traits == null) st.traits = drawTraits(random, style);
  const mask = st.traits;
  const has = key => (mask & TRAIT_BIT[key]) !== 0;
  const person = personOf(mask);
  const noTicket = Math.exp(-person.perWeek);
  const [lo, hi] = legsCap ?? person.legs;
  const legSpan = hi - lo + 1;
  for (let w = from; w < weeks; w++) {
    if (w > 0) st.cash += SIM_WEEKLY_GRANT;
    st.weekStaked = 0;
    st.weekGross = 0;
    st.weekTax = 0;
    const weekCash = st.cash;
    let spent = 0;
    let short = false;
    let pick = weekPicker(w);
    if (!pick && fallback && random() < person.switchRate) pick = fallback(w);
    // Poisson number of tickets this week (none when there's nothing to bet on).
    let count = 0;
    if (pick) for (let p = random(); p > noTicket; p *= random()) count++;
    if (pick && count > 0) {
      if (has('streaky') && st.lastWeekWon) count++;
      if (has('revenge') && st.revengeNext) count *= 2;
    }
    // This week's stake multiplier from the traits.
    let mood = 1;
    if (has('tilt')) mood *= st.tiltMult;
    if (has('moody')) mood *= 0.5 + random() * 1.5;
    if (has('guardian') && st.cash < SIM_START_BALANCE) mood *= 0.5;
    if (st.quit) count = 0;
    if (st.rest > 0) {
      st.rest--;
      st.restWeeks++;
      count = 0;
    }
    const riding = () => has('rider') && pick && st.pot >= SLIP_RULES.minTicket;
    if (count === 0 && riding()) count = 1;
    // The usual stake: a share of what they have, never under the minimum.
    const base = Math.max(SLIP_RULES.minTicket, unitRound(st.cash * person.share));
    const hail = has('hailMary') && st.cash < SIM_START_BALANCE ? 2 : 0;
    let week = 0;
    let winnings = 0;
    let played = false;
    for (let i = 0; i < count || (riding() && i < count + RIDE_EXTRA_TICKETS); i++) {
      const want = Math.min(lo + Math.floor(random() * legSpan) + st.extraLegs + hail, pick.games, SLIP_RULES.maxLegs);
      let legs = 0;
      let won = true;
      let missed = 0;
      let odds = 1;
      let chance = 0;
      for (let tries = 0; legs < want && tries < want * 20; tries++) {
        const r = random();
        let s = 0;
        while (s < pick.cum.length - 1 && r > pick.cum[s]) s++;
        const c = pick.compiled[s];
        const u = random();
        let a = 0;
        let b = c.n - 1;
        while (a < b) {
          const mid = (a + b) >> 1;
          if (c.pickCum[mid] < u) a = mid + 1;
          else b = mid;
        }
        const j = a;
        // The house's rule: a parlay-only option can't go on a smaller ticket.
        if (c.minLegs[j] > want) continue;
        // Which of that week's real games this is, and its shared result.
        const copy = Math.floor(random() * pick.copies[s]);
        const game = mix32(c.gameKey[j] ^ Math.imul(copy + 1, 0x9e3779b1)) | 0;
        let dup = false;
        for (let k = 0; k < legs; k++) if (ticketGames[k] === game) dup = true;
        if (dup) continue;
        ticketGames[legs++] = game;
        odds *= c.odds[j];
        chance += c.fair[j];
        const result = worldDraw(w, c.market[j], copy);
        // A slice with lo > hi wraps round (double chance's away or home).
        if (c.lo[j] <= c.hi[j] ? result < c.lo[j] || result >= c.hi[j] : result < c.lo[j] && result >= c.hi[j]) {
          won = false;
          missed++;
        }
      }
      if (legs === 0) continue;
      // Extra tickets are the winnings alone.
      let stake = 0;
      if (i < count) {
        stake = has('chaser') ? Math.max(base, st.chaseStake || base) : base;
        // Long parlays are small tickets: the money goes on singles and short ones.
        if (legs > 1) stake = Math.max(SLIP_RULES.minTicket, unitRound(stake / (1 + PARLAY_STAKE_CUT * (legs - 1))));
        if (random() < BIG_TICKET_SHARE) stake *= 3;
        if (st.boost > 1) {
          stake = Math.min(SLIP_RULES.maxTicket, stake * st.boost);
          st.boost = 1;
        }
        if (mood !== 1) stake = Math.max(SLIP_RULES.minTicket, unitRound(stake * mood));
        stake = Math.min(stake, SLIP_RULES.maxTicket);
      }
      // Only what's left this week can be bet.
      const afford = Math.floor((st.cash - spent) / SLIP_RULES.unit) * SLIP_RULES.unit;
      if (stake > afford) {
        stake = Math.max(0, afford);
        short = true;
      }
      if (st.pot > 0) {
        const ride = Math.max(0, Math.min(Math.floor(st.pot / SLIP_RULES.unit) * SLIP_RULES.unit, SLIP_RULES.maxTicket - stake, afford - stake));
        stake += ride;
        st.pot -= ride;
      }
      if (stake < SLIP_RULES.minTicket) {
        if (i < count) short = true;
        continue;
      }
      played = true;
      spent += stake;
      const gross = Math.min(stake * odds, SLIP_RULES.maxPayout);
      const paid = won ? afterTax(gross) : 0;
      const result = paid - stake;
      st.weekStaked += stake;
      if (won) {
        st.weekGross += gross;
        st.weekTax += gross - paid;
        st.wonPaid += paid;
      } else st.lostStakes += stake;
      st.firstWon ??= won;
      st.tickets++;
      st.staked += stake;
      st.legsSum += legs;
      st.logOddsSum += Math.log(odds);
      st.chanceSum += chance;
      if (legs === 1) st.singles++;
      week += result;
      if (stake > st.maxStake) st.maxStake = stake;
      if (log) log.push({ w, stake, legs, odds, chance: chance / legs, won, missed, paid });
      if (won) {
        if (has('rider')) winnings += paid;
        if (has('pressOn')) st.boost = 2;
        if (has('jackpot') && odds >= 10) st.extraLegs = Math.min(3, st.extraLegs + 1);
        if (has('content')) st.rest = Math.max(st.rest, 1);
        if (st.firstWinWeek < 0) st.firstWinWeek = w;
        if (legs > st.biggestParlay) st.biggestParlay = legs;
        st.wonTickets++;
        st.losing = 0;
        if (++st.winning > st.longestWinning) st.longestWinning = st.winning;
        st.taxPaid += gross - paid;
        if (odds > st.longshotOdds) {
          st.longshotOdds = odds;
          st.longshotWeek = w;
          st.longshotStake = stake;
          st.longshotWin = result;
        }
        if (result > st.biggestWin) {
          st.biggestWin = result;
          st.biggestWinWeek = w;
          st.biggestWinStake = stake;
          st.biggestWinLegs = legs;
          st.biggestWinOdds = odds;
        }
      } else {
        st.winning = 0;
        if (++st.losing > st.longestLosing) st.longestLosing = st.losing;
        const nearMiss = missed === 1 && legs > 1;
        if (nearMiss) st.nearMisses++;
        if (has('soClose') && nearMiss) st.boost = 2;
        if (has('heartbroken') && nearMiss) st.rest = Math.max(st.rest, 2);
        if (has('bored') && st.losing >= 10) st.quit = true;
      }
    }
    st.pot += winnings;
    st.cash += week;
    if (played) st.weeksPlayed++;
    if (short) st.shortWeeks++;
    if (st.cash < st.lowestCash) st.lowestCash = st.cash;
    // Ran out (under the minimum ticket), counted each time it happens.
    const broke = st.cash < SLIP_RULES.minTicket;
    if (broke && !st.broke) st.brokeTimes++;
    st.broke = broke;
    if (played && week < st.worstWeek) {
      st.worstWeek = week;
      st.worstWeekAt = w;
    }
    if (played && week > st.bestWeek) {
      st.bestWeek = week;
      st.bestWeekAt = w;
    }
    if (has('chaser') && played) {
      // Doubles after a losing week, up to the ticket limit; broken there, 4 weeks off.
      if (week < 0 && (st.chaseStake >= SLIP_RULES.maxTicket || short)) {
        st.chaseStake = 0;
        st.rest = Math.max(st.rest, 4);
      } else st.chaseStake = week < 0 ? Math.min(Math.max(st.chaseStake, base) * 2, SLIP_RULES.maxTicket) : 0;
    }
    if (has('stopLoss') && week < 0 && -week >= 0.3 * weekCash) st.rest = Math.max(st.rest, 6);
    st.profit += week;
    // The traits react to how the week went.
    if (st.weekStaked > 0) {
      if (has('tilt')) st.tiltMult = week < 0 ? Math.min(4, st.tiltMult * 1.5) : 1;
      st.lastWeekWon = week > 0;
      st.revengeNext = week <= -2000;
    }
    if (has('cashOut') && st.profit >= st.cashTarget) {
      st.rest = Math.max(st.rest, 8);
      st.cashTarget = st.profit + 5000;
    }
    if (path) path[w] = st.profit;
    if (st.profit > 0) st.weeksAhead++;
    if (st.profit > st.peak) {
      st.peak = st.profit;
      st.peakWeek = w;
    }
    if (st.profit < st.trough) {
      st.trough = st.profit;
      st.troughWeek = w;
    }
    if (st.peak - st.profit > st.maxDrop) st.maxDrop = st.peak - st.profit;
    if (onWeek) onWeek(w + 1, st);
  }
  return storyOf(st);
}

// One person's season with a given set of traits (for tests and the guide):
// `style` their pick style, `traits` any other trait keys.
export function simulatePerson({ traits = [], pools, weeks, random = Math.random, seed = 1, legs = null }) {
  worldSeed = seed;
  const style = STYLES.find(s => traits.includes(s.key))?.key ?? 'any';
  const st = freshState();
  st.traits = traits.reduce((m, key) => m | TRAIT_BIT[key], 0);
  const path = new Float64Array(weeks);
  const log = [];
  const pick = picker([pools[style]]);
  return { path, log, ...playSeason(style, () => pick, weeks, random, path, null, legs, { st, log }) };
}

// Each person gets their own random stream, so anyone can be replayed
// exactly without storing everyone's path.
export function playerRandom(seed, index) {
  return seededRandom((Math.imul(seed, 0x9e3779b1) + Math.imul(index + 1, 0x85ebca6b)) >>> 0);
}

// ---- Records and leaderboards ----------------------------------------------------

// The crowd's top 10 on each record, and what puts a person on it at all
// (false: not on this board). Higher is better, except results below zero,
// where the lowest leads. The first of each board tells its story.
export const LEADER_SIZE = 10;
export const LEADERBOARDS = {
  best: s => s.final > 0 && s.final,
  biggestWin: s => s.biggestWin > 0 && s.biggestWin,
  longshot: s => s.longshotOdds > 1 && s.longshotOdds,
  comeback: s => s.final > 0 && s.trough < 0 && s.final - s.trough,
  bestWeek: s => s.bestWeek > 0 && s.bestWeek,
  biggestParlay: s => s.biggestParlay > 1 && s.biggestParlay,
  hotStreak: s => s.longestWinning > 1 && s.longestWinning,
  mostTickets: s => s.tickets > 0 && s.tickets,
  taxman: s => s.taxPaid > 0 && s.taxPaid,
  nearMisses: s => s.nearMisses > 0 && s.nearMisses,
  worst: s => s.final < 0 && s.final,
  fall: s => s.final < 0 && s.peak > 0 && s.peak,
  worstWeek: s => s.worstWeek < 0 && s.worstWeek,
  drought: s => s.longestLosing > 0 && s.longestLosing,
  broke: s => s.brokeTimes > 0 && s.brokeTimes
};
// The records the stories tell, in order.
export const STORY_KEYS = ['biggestWin', 'best', 'comeback', 'fall', 'drought', 'worst', 'hotStreak', 'longshot', 'nearMisses', 'worstWeek', 'mostTickets', 'taxman'];

// Where the crowd's winnings (everyone's result above zero) went: the share
// the top winners took. `finals` is sorted from lowest to highest.
export function surplusOf(finals) {
  let total = 0;
  let winners = 0;
  for (let i = finals.length - 1; i >= 0 && finals[i] > 0; i--) (total += finals[i], winners++);
  const topShare = k => {
    let sum = 0;
    for (let i = finals.length - 1; i >= finals.length - Math.min(k, winners); i--) sum += finals[i];
    return total > 0 ? sum / total : 0;
  };
  // How few of the biggest winners hold half of it.
  let half = 0;
  for (let i = finals.length - 1, sum = 0; i >= 0 && total > 0 && sum < total / 2; i--) (sum += finals[i], half++);
  const players = finals.length;
  return {
    total,
    winners,
    top1: topShare(1),
    top10: topShare(10),
    topTenth: topShare(Math.round(players / 1000)),
    topPct: topShare(Math.round(players / 100)),
    half
  };
}

// Histogram bins for the weekly spread: about 2 million counters at most,
// from everything anyone could have lost (the start and every weekly grant)
// to twice that up.
function histogramShape(weeks) {
  const bins = Math.min(20000, Math.floor(2_000_000 / weeks));
  const low = SIM_START_BALANCE + SIM_WEEKLY_GRANT * weeks + 1000;
  return { bins, lo: -low, width: (3 * low) / bins };
}

// ---- Multi-sport calendar ------------------------------------------------------------

// Periods run month by month up to 5 years; a month is 52 / 12 weeks, rounded
// (1 month = 4 weeks, 3 = 13, 6 = 26, 12 = 52).
export const MAX_MONTHS = 60;
export const monthWeeks = months => Math.round((months * 52) / 12);
// Month by month up to a year, then every 3 months (fewer checkpoints keep long runs quick).
export const PERIOD_MONTHS = Array.from({ length: MAX_MONTHS }, (_, i) => i + 1).filter(m => m <= 12 || m % 3 === 0);
export const MONTH_WEEKS = PERIOD_MONTHS.map(monthWeeks);

// ---- Sports in the simulation ----------------------------------------------------
//
// Every sport the crowd bets on, in one place. Adding a sport is one entry:
// - `family`: its kind (baseball, football, basketball, hockey, soccer,
//   racing, sets), which picks its typical-game template for weeks without
//   real odds;
// - `kind`: its sport, for people who bet on every series of one sport;
// - `pop`: how popular it is with Taiwan's lottery players (a relative
//   weight: MLB and the NBA the most, then CPBL, the Premier League, NPB …),
//   which sets how many people follow it;
// - `headline`: its seasons starting and ending show in the time-lapse feed;
// - `games(w)`: its games in week w of the year (0 = 1-7 January), from the
//   published 2026/27 schedules. Weeks with 0 games are its off-season.
// A sport with no bets at all (no real games and no template) is never on.
const between = (w, a, b) => (a <= b ? w >= a && w <= b : w >= a || w <= b);
// European soccer: mid-August to late May, off in the international breaks.
const EURO_BREAKS = new Set([12, 38, 39, 45]);
const euroLeague = perWeek => w => (between(w, 33, 21) && !EURO_BREAKS.has(w) ? perWeek : 0);
const F1_RACE_WEEKS = new Set([10, 11, 13, 14, 15, 17, 20, 22, 24, 26, 27, 29, 30, 35, 36, 38, 39, 40, 42, 43, 44, 46, 48, 49]);
// UEFA club competitions: league-phase matchdays (18 games), then knockouts.
const UEFA_WEEKS = { 37: 18, 39: 18, 42: 18, 44: 18, 47: 18, 49: 18, 3: 18, 4: 18, 7: 8, 8: 8, 10: 8, 11: 8, 14: 4, 15: 4, 17: 2, 18: 2, 22: 1 };
// Tennis tours run all year but for the December break; the BWF and WTT
// tours hold events about three weeks in five.
const tourWeek = perWeek => w => (between(w, 1, 47) ? perWeek : 0);
const eventWeeks = perWeek => w => (between(w, 1, 49) && w % 5 !== 2 && w % 5 !== 4 ? perWeek : 0);

export const SIM_SPORTS = {
  // MLB: 2,430 games from Opening Day (25 March 2027, week 11) to 26 September
  // (week 38), then the postseason to the end of October (~40 games).
  mlb: { family: 'baseball', kind: 'baseball', pop: 10, headline: true, games: w => (between(w, 11, 38) ? 87 : between(w, 39, 43) ? 8 : 0) },
  // NPB (12 clubs, ~36 games a week), KBO (10 clubs, ~30) and CPBL (6 clubs,
  // ~15): late March to early October, then short postseasons.
  npb: { family: 'baseball', kind: 'baseball', pop: 5, games: w => (between(w, 12, 39) ? 36 : between(w, 40, 44) ? 4 : 0) },
  kbo: { family: 'baseball', kind: 'baseball', pop: 3, games: w => (between(w, 12, 39) ? 30 : between(w, 40, 44) ? 4 : 0) },
  cpbl: { family: 'baseball', kind: 'baseball', pop: 7, headline: true, games: w => (between(w, 12, 41) ? 15 : between(w, 42, 45) ? 3 : 0) },
  // NFL: 272 games from 10 September (week 36) to 10 January (week 1), then
  // the playoffs and the Super Bowl (14 February, week 6).
  nfl: { family: 'football', kind: 'football', pop: 2, headline: true, games: w => (between(w, 36, 1) ? 16 : { 2: 6, 3: 4, 4: 2, 6: 1 }[w] ?? 0) },
  // College football: late August (week 34) to early December, then bowls.
  ncaaf: { family: 'football', kind: 'football', pop: 0.5, games: w => (between(w, 34, 49) ? 45 : between(w, 50, 1) ? 10 : 0) },
  // NBA: 1,230 games, opening night 20 October (week 41) to 11 April (week
  // 14), then the play-in and playoffs to mid-June (~90 games).
  nba: { family: 'basketball', kind: 'basketball', pop: 10, headline: true, games: w => (w === 41 ? 15 : w === 14 ? 39 : between(w, 42, 13) ? 49 : between(w, 15, 24) ? 9 : 0) },
  // WNBA: mid-May (week 19) to mid-September, then the playoffs.
  wnba: { family: 'basketball', kind: 'basketball', pop: 1, games: w => (between(w, 19, 37) ? 10 : between(w, 38, 41) ? 4 : 0) },
  // EuroLeague (20 clubs, double rounds some weeks) and Japan's B1 League:
  // October to May.
  euroleague: { family: 'basketball', kind: 'basketball', pop: 1, games: w => (between(w, 40, 20) ? 14 : 0) },
  bleague: { family: 'basketball', kind: 'basketball', pop: 1.5, games: w => (between(w, 40, 18) ? 26 : 0) },
  // NHL: 1,312 games, 7 October (week 40) to mid-April (week 15), then the playoffs.
  nhl: { family: 'hockey', kind: 'hockey', pop: 1, headline: true, games: w => (between(w, 40, 15) ? 47 : between(w, 16, 24) ? 10 : 0) },
  // Premier League: 380 games, 22 August 2026 (week 33) to 30 May 2027 (week
  // 21), no games in the international breaks, Boxing Day week doubled.
  epl: { family: 'soccer', kind: 'soccer', pop: 6, headline: true, games: w => (w === 51 ? 20 : euroLeague(10)(w)) },
  laliga: { family: 'soccer', kind: 'soccer', pop: 2.5, games: euroLeague(10) },
  seriea: { family: 'soccer', kind: 'soccer', pop: 1.5, games: euroLeague(10) },
  bundesliga: { family: 'soccer', kind: 'soccer', pop: 1.5, games: w => (between(w, 52, 1) ? 0 : euroLeague(9)(w)) },
  ligue1: { family: 'soccer', kind: 'soccer', pop: 1, games: euroLeague(9) },
  eredivisie: { family: 'soccer', kind: 'soccer', pop: 0.3, games: euroLeague(9) },
  primeira: { family: 'soccer', kind: 'soccer', pop: 0.3, games: euroLeague(9) },
  championship: { family: 'soccer', kind: 'soccer', pop: 0.3, games: w => (between(w, 31, 18) && !EURO_BREAKS.has(w) ? 12 : 0) },
  ucl: { family: 'soccer', kind: 'soccer', pop: 3, headline: true, games: w => UEFA_WEEKS[w] ?? 0 },
  uel: { family: 'soccer', kind: 'soccer', pop: 1, games: w => UEFA_WEEKS[w] ?? 0 },
  // MLS: late February (week 8) to October, then the playoffs.
  mls: { family: 'soccer', kind: 'soccer', pop: 0.5, games: w => (between(w, 8, 42) ? 14 : between(w, 43, 48) ? 4 : 0) },
  // Liga MX: Clausura January-May, Apertura July-December.
  ligamx: { family: 'soccer', kind: 'soccer', pop: 0.3, games: w => (between(w, 1, 21) || between(w, 28, 50) ? 9 : 0) },
  // J1 League (autumn-spring from August 2026, a winter break December-February).
  jleague: { family: 'soccer', kind: 'soccer', pop: 0.8, games: w => (between(w, 31, 50) || between(w, 7, 21) ? 10 : 0) },
  // Tennis: ATP and WTA main-draw singles, about 60 and 50 matches a week.
  tennis: { family: 'sets', kind: 'tennis', pop: 2, headline: true, games: tourWeek(60) },
  wta: { family: 'sets', kind: 'tennis', pop: 1, games: tourWeek(50) },
  // Badminton (BWF World Tour) and table tennis (WTT): event weeks.
  badminton: { family: 'sets', kind: 'badminton', pop: 1.5, games: eventWeeks(40) },
  tabletennis: { family: 'sets', kind: 'tabletennis', pop: 1, games: eventWeeks(30) },
  // Volleyball: the club leagues October-April, the Nations League May-July.
  volleyball: { family: 'sets', kind: 'volleyball', pop: 0.7, games: w => (between(w, 40, 16) ? 20 : between(w, 21, 30) ? 30 : 0) },
  // Snooker: ranking events most weeks from July to April.
  snooker: { family: 'sets', kind: 'snooker', pop: 0.3, games: w => (between(w, 27, 17) ? 16 : 0) },
  // F1: the 24 races of the 2027 calendar, Bahrain 14 March to Abu Dhabi 12 December.
  f1: { family: 'racing', kind: 'f1', pop: 1.2, headline: true, games: w => (F1_RACE_WEEKS.has(w) ? 1 : 0) }
};
export const SPORTS = Object.keys(SIM_SPORTS);
// Who bets on what. Everyone follows a stack of series: most one series
// only (only the Premier League, only CPBL), some every series of one sport
// (all baseball), some a mix across sports (MLB and the NBA), and a few
// everything. How many follow each is its popularity (`pop`). They bet on
// their series while any is in season; in their off-season, on whatever else
// is on that week in OFFSEASON_SWITCH of the weeks (never, if loyal; always,
// if hoppers). F1 is one race at a time, so F1-only people bet single picks.
const MIXES = [['mlb', 'nba'], ['cpbl', 'mlb'], ['cpbl', 'npb'], ['nba', 'epl'], ['epl', 'ucl'], ['mlb', 'epl'], ['nba', 'nfl'], ['cpbl', 'bleague'], ['tennis', 'badminton'], ['nba', 'f1']];
const SHARE_OF = { one: 0.55, kind: 0.3, mix: 0.25, all: 0.12 };
const pop = sports => sports.reduce((s, sp) => s + SIM_SPORTS[sp].pop, 0);
const KINDS = [...new Set(SPORTS.map(sp => SIM_SPORTS[sp].kind))];
export const FANS = (() => {
  const list = [
    ...SPORTS.map(sp => ({ key: sp, type: 'one', sports: [sp], w: SHARE_OF.one * SIM_SPORTS[sp].pop, ...(sp === 'f1' ? { legs: [1, 1] } : {}) })),
    ...KINDS.map(kind => SPORTS.filter(sp => SIM_SPORTS[sp].kind === kind))
      .filter(sports => sports.length > 1)
      .map(sports => ({ key: `kind:${SIM_SPORTS[sports[0]].kind}`, type: 'kind', kind: SIM_SPORTS[sports[0]].kind, sports, w: SHARE_OF.kind * pop(sports) })),
    ...MIXES.map(sports => ({ key: sports.join('+'), type: 'mix', sports, w: (SHARE_OF.mix * pop(sports)) / sports.length })),
    { key: 'all', type: 'all', sports: SPORTS, w: SHARE_OF.all * pop(SPORTS) }
  ];
  const sum = list.reduce((s, f) => s + f.w, 0);
  return list.map(({ w, ...f }) => ({ ...f, share: w / sum }));
})();
// The series a person follows, as labels: every one of them (everything: none).
export const fanSeries = fan => (fan?.type === 'all' ? [] : fan?.sports ?? []);
export const OFFSEASON_SWITCH = 0.3;

// Games a sport has in a week of the year.
export function gamesInWeek(sport, week) {
  const w = ((week % 52) + 52) % 52;
  return SIM_SPORTS[sport]?.games(w) ?? 0;
}

// Week of the year (0-51) for a date.
export function weekOfYear(date) {
  const d = new Date(date);
  return Math.min(51, Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * 86_400_000)));
}

// A typical week of games for a sport with nothing on the board today: made-
// up games (win chances spread as they usually are in that sport, a total
// near its usual line) run through the very code that builds the real board
// (board.mjs), so they get the same markets, the same house cut for the
// league and the same locks. A sport off the board is then no cheaper, or
// dearer, to bet on than one on it. Seeded, so it's the same every time.
const TEMPLATE_WIN = { baseball: [0.35, 0.65], basketball: [0.15, 0.85], football: [0.2, 0.8], hockey: [0.35, 0.65], sets: [0.12, 0.88] };
// Each sport's usual total line (none: its own model sets one).
const TEMPLATE_TOTAL = { mlb: 8.5, npb: 7.5, kbo: 9.5, cpbl: 9.5, nfl: 44.5, ncaaf: 52.5, nba: 224.5, wnba: 162.5, euroleague: 160.5, bleague: 158.5, nhl: 5.5 };
// An F1 field as the market usually prices it: the average shape of two real
// 2026 boards (Polymarket, one flat before qualifying, one with a 64%
// favourite after), so a typical race returns what a real one does
// (NT$62 per NT$100 for the crowd's usual pick, against 59 and 65).
const F1_FIELD = [0.5165, 0.1703, 0.105, 0.077, 0.0431, 0.0323, 0.0261, 0.0095, 0.0041, 0.0018, 0.0014, 0.0012, 0.0012, 0.0012, 0.0012, 0.0009, 0.0009, 0.0009, 0.0009, 0.0009, 0.0009, 0.0009, 0.0009, 0.0007, 0.0002];
// Matches in sets: the bookmaker's handicap and total in games (tennis),
// points or frames, as it lists them.
const TEMPLATE_UNITS = { tennis: [3.5, 22.5], wta: [3.5, 21.5], badminton: [4.5, 80.5], tabletennis: [3.5, 75.5], volleyball: [4.5, 180.5], snooker: [1.5, 8.5] };
const templates = new Map();
export function sportTemplate(sport, seed = 7) {
  const key = `${sport}|${seed}`;
  if (!templates.has(key)) templates.set(key, buildTemplate(sport, seed));
  return templates.get(key);
}

function buildTemplate(sport, seed) {
  const random = seededRandom(seed);
  const between = (lo, hi) => lo + random() * (hi - lo);
  const family = SIM_SPORTS[sport]?.family;
  if (family === 'racing') {
    const sum = F1_FIELD.reduce((a, b) => a + b, 0);
    const options = F1_FIELD.map((p, i) => ({ id: `f1|t${i}`, gameId: 'f1t', sport, kind: 'f1', market: 'f1', fairChance: p / sum, estOdds: estimateF1LotteryOdds(p / sum), ...houseRule('f1', 2) }));
    f1Podium(options.map(o => ({ fair: o.fairChance, odds: o.estOdds }))).forEach((p, i) => options.push({ id: `f1pod|t${i}`, gameId: 'f1t', sport, kind: 'f1podium', market: `f1podium|${i}`, fairChance: p.fair, estOdds: p.odds, lock: p.lock, minLegs: p.minLegs }));
    return crowdPool(options).map(b => ({ ...b, gameKey: `${sport}|f1t` }));
  }
  const options = [];
  for (let g = 0; g < (family === 'soccer' ? 10 : 12); g++) {
    const game = { id: `t${g}`, sport, startUtc: null, polymarket: null, spread: null, total: null };
    if (family === 'soccer') {
      const home = between(0.3, 0.6);
      const draw = between(0.22, 0.3);
      game.draftKings = { home, draw, away: 1 - home - draw };
      game.total = { line: 2.5, overFair: between(0.45, 0.55) };
    } else {
      const homeWin = between(...TEMPLATE_WIN[family]);
      game.draftKings = { home: homeWin, away: 1 - homeWin };
      if (TEMPLATE_TOTAL[sport]) game.total = { line: TEMPLATE_TOTAL[sport], overFair: between(0.45, 0.55) };
      const units = TEMPLATE_UNITS[sport];
      if (units) {
        // The favourite giving the line, near 50/50 to cover.
        const awayLine = homeWin > 0.5 ? units[0] : -units[0];
        game.spread = { awayLine, awayFair: between(0.45, 0.55) };
        game.total = { line: units[1], overFair: between(0.45, 0.55) };
      }
    }
    options.push(...gameOptions(game));
  }
  // Keys per sport, so template games of different sports get their own results.
  return crowdPool(options).map(b => ({ ...b, gameKey: `${sport}|${b.gameId}` }));
}

// ---- The crowd ------------------------------------------------------------------

// The simulated groups: every pick style x every kind of fan, each with what
// it can bet on week by week. `sportPools` maps a sport to crowdPools(...) of
// its bets; a sport missing from it is never on.
function crowdGroups(sportPools, startWeek, weeks) {
  const cache = new Map();
  const pickerFor = (sports, style, w) => {
    const live = sports.filter(sp => sportPools[sp] && gamesInWeek(sp, startWeek + w) > 0);
    if (live.length === 0) return null;
    const weights = live.map(sp => gamesInWeek(sp, startWeek + w));
    const key = `${style}|${live.join(',')}|${weights.join(',')}`;
    if (!cache.has(key)) cache.set(key, picker(live.map(sp => sportPools[sp][style]), weights));
    return cache.get(key);
  };
  const groups = [];
  for (const style of STYLES)
    for (const fan of FANS) {
      const own = Array.from({ length: weeks }, (_, w) => pickerFor(fan.sports, style.key, w));
      const other = Array.from({ length: weeks }, (_, w) => pickerFor(SPORTS, style.key, w));
      groups.push({ style: style.key, share: style.share * fan.share * FANS.length, fan, weekPicker: w => own[w], fallback: fan.key === 'all' ? null : w => other[w], legs: fan.legs ?? null });
    }
  return groups;
}

// People in a group, for `per` people per group on average: each style's
// share of the crowd (at least 1).
export function groupSize(share, per) {
  return Math.max(1, Math.round(per * STYLES.length * share));
}
export const crowdSize = per => FANS.reduce((n, f) => n + STYLES.reduce((m, s) => m + groupSize(s.share * f.share * FANS.length, per), 0), 0);

// Where each group starts in the crowd's numbering, and the crowd's size.
function layout(groups, per) {
  const starts = [];
  let total = 0;
  for (const group of groups) {
    starts.push(total);
    total += groupSize(group.share, per);
  }
  // The group person `index` belongs to.
  const groupOf = index => {
    if (index < 0 || index >= total) return -1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return { starts, total, groupOf, size: g => groupSize(groups[g].share, per) };
}

const emptySum = () => ({ n: 0, staked: 0, net: 0, tickets: 0, ahead: 0, everAhead: 0, quit: 0, rr: 0, rs: 0, ss: 0 });
// Several groups' running sums as one.
function mergeSums(list) {
  const out = emptySum();
  for (const sum of list) for (const key in out) out[key] += sum[key];
  return out;
}

function addSum(sum, story) {
  const back = story.staked + story.final;
  sum.n++;
  sum.staked += story.staked;
  sum.net += story.final;
  sum.tickets += story.tickets;
  sum.rr += back * back;
  sum.rs += back * story.staked;
  sum.ss += story.staked * story.staked;
  if (story.final > 0) sum.ahead++;
  if (story.everAhead) sum.everAhead++;
  if (story.quit) sum.quit++;
}

// A group's averages from its running sums, with 95% sampling margins (a
// ratio estimate for the amount back, binomial for the share ahead).
function summarize(s) {
  const n = s.n || 1;
  const back = s.staked > 0 ? (s.staked + s.net) / s.staked : 1;
  const aheadShare = s.ahead / n;
  const spread = Math.max(0, s.rr - 2 * back * s.rs + back * back * s.ss);
  const meanStaked = s.staked / n;
  return {
    back: back * 100,
    backMargin: s.n > 1 && meanStaked > 0 ? (1.96 * Math.sqrt(spread / (s.n * (s.n - 1))) * 100) / meanStaked : 0,
    aheadShare,
    aheadMargin: 1.96 * Math.sqrt((aheadShare * (1 - aheadShare)) / n),
    avgFinal: s.net / n,
    avgStaked: s.staked / n,
    avgTickets: s.tickets / n,
    quitShare: s.quit / n,
    players: s.n
  };
}

// A crowd of people: every pick style x fan type on the multi-sport calendar
// from week `startWeek` (`sportPools`), or one pool every week (`pools`).
// `perGroup` people per group on average, each style by its share.
// Nothing per person is kept but the final result: each week streams into a
// histogram (for the bands) and running sums (per trait, per fan, per fan x
// trait). Record holders, leaderboards and the people at the top 10%, middle
// and bottom 10% are replayed at the end for their full stories.
//
// The crowd at several points at once: one pass of `weeks` weeks yields the
// stats after each week in `checkpoints`. `resume` (an earlier run's
// `resume`) carries everyone on from where that run stopped. Returns
// { results: {weeks: stats}, resume }.
export function simulateCrowd({ pools, sportPools, startWeek = 0, weeks, checkpoints = [weeks], perGroup = 500, seed = 1, onProgress, resume = null }) {
  worldSeed = seed;
  const groups = sportPools
    ? crowdGroups(sportPools, startWeek, weeks)
    : STYLES.map(style => {
        const pick = picker([pools[style.key]]);
        return { style: style.key, share: style.share, fan: null, weekPicker: () => pick, fallback: null, legs: null };
      });
  const fans = sportPools ? FANS : [];
  const { starts, total, groupOf, size } = layout(groups, perGroup);
  const from = resume?.weeks ?? 0;
  const marks = [...new Set(checkpoints)].filter(c => c > from && c <= weeks).sort((x, y) => x - y);
  const { bins, lo, width } = histogramShape(weeks);
  // Weekly spread for the weeks this run plays; earlier weeks come from `resume`.
  const span = weeks - from;
  const hist = new Uint32Array(span * bins);
  const aheadByWeek = new Uint32Array(span);
  const netByWeek = new Float64Array(span);
  // The whole crowd's money each week: stakes, payouts before tax, tax.
  const stakedByWeek = new Float64Array(span);
  const grossByWeek = new Float64Array(span);
  const taxByWeek = new Float64Array(span);
  const states = new Array(total);
  const rngs = new Uint32Array(total);
  const nTraits = TRAIT_ROWS.length;
  const inRow = (k, mask) => (k < TRAITS.length ? (mask & (1 << k)) !== 0 : k === TRAITS.length ? !(mask & STYLE_MASK) : !(mask & REACT_MASK));
  // One tally per checkpoint: sums, leaderboards and crowd totals.
  const tallies = new Map(
    marks.map(m => [
      m,
      {
        finals: new Float64Array(total),
        all: emptySum(),
        // Per trait (and the two baselines), per fan, per fan x trait.
        traitSums: Array.from({ length: nTraits }, emptySum),
        fanSums: fans.map(emptySum),
        fanTraitSums: fans.map(() => Array.from({ length: nTraits }, emptySum)),
        leaders: Object.fromEntries(Object.keys(LEADERBOARDS).map(key => [key, []])),
        crowd: { winnings: 0, losses: 0, neverWon: 0, wonTickets: 0, taxTotal: 0, taxed: 0, firstWon: 0, firstWonLost: 0, short: 0, broke: 0, winners: 0, winnersPaid: 0, winnersLost: 0, winnersStaked: 0, singles: 0, legs: 0, nearMisses: 0 }
      }
    ])
  );
  const fanIndex = groups.map(group => fans.indexOf(group.fan));
  const count = (tally, g, index, story) => {
    const c = tally.crowd;
    tally.finals[index] = story.final;
    addSum(tally.all, story);
    const f = fanIndex[g];
    if (f >= 0) addSum(tally.fanSums[f], story);
    for (let k = 0; k < nTraits; k++) {
      if (!inRow(k, story.traits)) continue;
      addSum(tally.traitSums[k], story);
      if (f >= 0) addSum(tally.fanTraitSums[f][k], story);
    }
    if (story.final > 0) {
      c.winnings += story.final;
      // What winners won on their winning tickets, and lost on the rest.
      c.winners++;
      c.winnersPaid += story.wonPaid;
      c.winnersLost += story.lostStakes;
      c.winnersStaked += story.staked;
    } else c.losses -= story.final;
    if (story.wonTickets === 0 && story.tickets > 0) c.neverWon++;
    if (story.shortWeeks > 0) c.short++;
    if (story.brokeTimes > 0) c.broke++;
    c.wonTickets += story.wonTickets;
    c.taxTotal += story.taxPaid;
    c.singles += story.singles;
    c.legs += story.avgLegs * story.tickets;
    c.nearMisses += story.nearMisses;
    if (story.taxPaid > 0) c.taxed++;
    if (story.firstWon) {
      c.firstWon++;
      if (story.final < 0) c.firstWonLost++;
    }
    // Top 10s: higher is better, except results below zero, where the lowest leads.
    for (const key in LEADERBOARDS) {
      const value = LEADERBOARDS[key](story);
      if (value === false) continue;
      const list = tally.leaders[key];
      const low = value < 0;
      const ahead = x => (low ? value < x.value : value > x.value);
      if (list.length === LEADER_SIZE && !ahead(list[LEADER_SIZE - 1])) continue;
      let at = list.findIndex(ahead);
      if (at < 0) at = list.length;
      list.splice(at, 0, { index, value, final: story.final, traits: story.traits, g });
      if (list.length > LEADER_SIZE) list.pop();
    }
  };
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    for (let i = 0; i < size(g); i++) {
      const index = starts[g] + i;
      const random = resume ? seededRandom(resume.rngs[index]) : playerRandom(seed, index);
      const st = resume ? { ...resume.states[index] } : freshState();
      playSeason(group.style, group.weekPicker, weeks, random, null, group.fallback, group.legs, {
        from,
        st,
        onWeek: (w, now) => {
          const v = now.profit;
          let bin = Math.floor((v - lo) / width);
          bin = bin < 0 ? 0 : bin >= bins ? bins - 1 : bin;
          hist[(w - 1 - from) * bins + bin]++;
          if (v > 0) aheadByWeek[w - 1 - from]++;
          netByWeek[w - 1 - from] += v;
          stakedByWeek[w - 1 - from] += now.weekStaked;
          grossByWeek[w - 1 - from] += now.weekGross;
          taxByWeek[w - 1 - from] += now.weekTax;
          const tally = tallies.get(w);
          if (tally) count(tally, g, index, storyOf(now));
        }
      });
      states[index] = st;
      rngs[index] = random.state();
      if (onProgress && index % 2000 === 1999) onProgress((index + 1) / total);
    }
  }
  // Weekly bands from the histogram (each value is its bin's middle).
  const at = (w, q) => {
    const target = q * (total - 1);
    let seen = 0;
    for (let b = 0; b < bins; b++) {
      seen += hist[w * bins + b];
      if (seen > target) return lo + (b + 0.5) * width;
    }
    return lo + (bins - 0.5) * width;
  };
  const bands = [
    ...(resume?.bands ?? []),
    ...Array.from({ length: span }, (_, w) => ({
      q01: at(w, 0.01),
      q05: at(w, 0.05),
      q10: at(w, 0.1),
      q25: at(w, 0.25),
      q50: at(w, 0.5),
      q75: at(w, 0.75),
      q90: at(w, 0.9),
      q95: at(w, 0.95),
      q99: at(w, 0.99),
      ahead: aheadByWeek[w],
      mean: netByWeek[w] / total
    }))
  ];
  // Every week's money from the start, earlier weeks from `resume`.
  const flowWeeks = [
    ...(resume?.flowWeeks ?? []),
    ...Array.from({ length: span }, (_, w) => ({ staked: stakedByWeek[w], gross: grossByWeek[w], tax: taxByWeek[w] }))
  ];
  const results = {};
  for (const [m, tally] of tallies) {
    const { finals, crowd, leaders } = tally;
    const traitRows = TRAIT_ROWS;
    const traitSummaries = traitRows.map((trait, k) => ({ trait, share: tally.traitSums[k].n / total, ...summarize(tally.traitSums[k]) }));
    const fanSummaries = fans.map((fan, f) => ({ fan, ...summarize(tally.fanSums[f]) }));
    // Per series: everyone who bets on it (alone or among others).
    const following = sp => fans.flatMap((fan, f) => (fan.sports.includes(sp) ? [f] : []));
    const seriesSummaries = sportPools
      ? SPORTS.filter(sp => sportPools[sp]).map(sp => ({ series: sp, only: summarize(mergeSums(following(sp).filter(f => fans[f].type === 'one').map(f => tally.fanSums[f]))), ...summarize(mergeSums(following(sp).map(f => tally.fanSums[f]))) }))
      : [];
    // For "people like you": every series x trait.
    const groupStats = seriesSummaries.flatMap(({ series }) => traitRows.map((trait, k) => ({ series, trait: trait.key, ...summarize(mergeSums(following(series).map(f => tally.fanTraitSums[f][k]))) })));
    // Sorted results (a plain numeric sort, far quicker than sorting indexes).
    const sorted = finals.slice().sort();
    // Replays one person exactly up to this checkpoint, every ticket logged;
    // `serial` is their 1-based number in the crowd.
    const replayIndex = index => replayGroup(groups[groupOf(index)], seed, index, m);
    // The person at rank r; among equal results, the lower number comes first.
    const atRank = r => {
      const v = sorted[r];
      let a = 0;
      let b = r;
      while (a < b) {
        const mid = (a + b) >> 1;
        if (sorted[mid] < v) a = mid + 1;
        else b = mid;
      }
      let k = r - a;
      for (let i = 0; i < total; i++) if (finals[i] === v && k-- === 0) return i;
      return -1;
    };
    const replay = q => replayIndex(atRank(Math.round((total - 1) * q)));
    const finalAt = q => sorted[Math.round((total - 1) * q)];
    const totals = tally.all;
    results[m] = {
      weeks: m,
      players: total,
      bands: bands.slice(0, m),
      traitSummaries,
      fanSummaries,
      seriesSummaries,
      groupStats,
      characters: { best: replay(0.9), median: replay(0.5), worst: replay(0.1) },
      totals: {
        staked: totals.staked,
        net: totals.net,
        tickets: totals.tickets,
        aheadShare: totals.ahead / total,
        everAheadShare: totals.everAhead / total
      },
      // The first of each board, replayed in full, for the stories.
      notable: Object.fromEntries(STORY_KEYS.filter(key => leaders[key]?.length).map(key => [key, replayIndex(leaders[key][0].index)])),
      // Top 10 on each record, by serial number.
      leaders: Object.fromEntries(Object.entries(leaders).map(([key, list]) => [key, list.map(x => ({ serial: x.index + 1, value: x.value, final: x.final, traits: x.traits, fan: groups[x.g].fan?.key ?? null }))])),
      surplus: surplusOf(sorted),
      // Everyone's final result at every 0.1%, to place anyone in the crowd.
      finalQuantiles: Array.from({ length: 1001 }, (_, i) => finalAt(i / 1000)),
      crowd: {
        winnings: crowd.winnings,
        losses: crowd.losses,
        neverWonShare: crowd.neverWon / total,
        top1: finalAt(0.99),
        top01: finalAt(0.999),
        wonTickets: crowd.wonTickets,
        taxTotal: crowd.taxTotal,
        taxedShare: crowd.taxed / total,
        firstWonShare: crowd.firstWon / total,
        firstWonLostShare: crowd.firstWon > 0 ? crowd.firstWonLost / crowd.firstWon : 0,
        // Ran short of money at least once (a ticket cut or skipped), and ran
        // out altogether (under the NT$100 minimum).
        shortShare: crowd.short / total,
        brokeShare: crowd.broke / total,
        // The ticket mix: single picks, picks per ticket, parlays missed by one.
        singleShare: totals.tickets ? crowd.singles / totals.tickets : 0,
        avgLegs: totals.tickets ? crowd.legs / totals.tickets : 0,
        nearMisses: crowd.nearMisses
      },
      flow: moneyFlow(flowWeeks.slice(0, m), crowd, totals.staked, totals.net)
    };
  }
  return { results, resume: { weeks, states, rngs, bands, flowWeeks } };
}

function replayGroup(group, seed, index, weeks) {
  const path = new Float64Array(weeks);
  const log = [];
  const story = playSeason(group.style, group.weekPicker, weeks, playerRandom(seed, index), path, group.fallback, group.legs, { log });
  return { serial: index + 1, fan: group.fan, style: group.style, path, log, ...story };
}

// Where the crowd's money went. Every NT$ a winner takes home comes out of
// what losers lost: losers' losses = winners' winnings + the lottery's take +
// tax, exactly. The lottery's own take is stakes minus payouts before tax, so
// in a week when winners are paid more than everyone staked, it loses money
// (unlikely, but it happens), and the losers' money of other weeks covers it.
export function moneyFlow(weeks, crowd, staked, net) {
  const house = weeks.map(w => w.staked - w.gross);
  const tax = weeks.reduce((s, w) => s + w.tax, 0);
  const take = house.reduce((s, x) => s + x, 0);
  const lossWeeks = house.map((v, w) => ({ w, v })).filter(x => x.v < 0);
  const worst = lossWeeks.reduce((a, b) => (!a || b.v < a.v ? b : a), null);
  return {
    staked,
    paid: staked + net,
    tax,
    take,
    winnersWon: crowd.winnings,
    losersLost: crowd.losses,
    // Losers' losses less winners' winnings, take and tax: zero up to rounding.
    balance: crowd.losses - crowd.winnings - take - tax,
    winners: crowd.winners,
    winnersPaid: crowd.winnersPaid,
    winnersLost: crowd.winnersLost,
    winnersStaked: crowd.winnersStaked,
    houseLossWeeks: lossWeeks.length,
    houseWorstWeek: worst ? { week: worst.w, loss: -worst.v } : null,
    weeks: weeks.length
  };
}

// Anyone in the crowd, replayed exactly (every ticket logged): `index` is
// their serial - 1.
export function replayPlayer({ pools, sportPools, startWeek = 0, weeks, perGroup = 500, seed = 1, index }) {
  worldSeed = seed;
  const groups = sportPools
    ? crowdGroups(sportPools, startWeek, weeks)
    : STYLES.map(style => {
        const pick = picker([pools[style.key]]);
        return { style: style.key, share: style.share, fan: null, weekPicker: () => pick, fallback: null, legs: null };
      });
  const group = groups[layout(groups, perGroup).groupOf(index)];
  return group ? replayGroup(group, seed, index, weeks) : null;
}

// The crowd after `weeks` weeks (one checkpoint of simulateCrowd).
export function simulateCrowdStats(options) {
  return simulateCrowd({ ...options, checkpoints: [options.weeks] }).results[options.weeks];
}
