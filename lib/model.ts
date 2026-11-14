// The token radar's model, version 2: one snapshot of the protocol universe in, one ranked
// board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor, ranked by the model's implied value, not by TVL:
// the early rows the radar exists to find. A protocol is pre-token when its index entry records no
// token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token protocols are kept
// apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, in three parts:
//
//   multiple   the category's comparable: the median mcap/TVL of the snapshot's own traded
//              protocols in the same category, shrunk toward the global median by peer count
//              (k = 5: one peer cannot set a category on its own), each peer ratio clamped to
//              [0.005, 3] first, the result clamped to [0.02, 1.0]. A category with no traded
//              peer takes the global median. No name is ever special-cased: the same function
//              scores every row, and the dashboard prints every category's multiple with its
//              peer count so the yardstick can be checked.
//   growth     log-damped: growthMult = clamp(1 + 0.45 * ln(1 + max(g,0)/50) + 0.5 * min(g,0)/100,
//              0.7, 2.0), g the 7-day change in percent, clamped to [-80, 2000] first. A 7-day
//              spike cannot triple a protocol, and a 70% drawdown costs at most 30%.
//   maturity   a hump over age without a token: 0.70 at listing, rising to 1.00 at 730 days, easing
//              to 0.85 past 1,825 days (a protocol that has waited five years without a token is
//              less likely to launch one than one two years in). Unknown age takes 0.85.
//   implied    = max(1, round(tvl_usd * multiple * growthMult * maturityMult))
//
// The constants are the model's, stated in the dashboard and changeable in the model sandbox.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  shrink_peers: number;
  peer_ratio_floor: number;
  peer_ratio_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_log_weight: number;
  growth_log_scale: number;
  growth_down_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_mult_floor: number;
  growth_mult_cap: number;
  maturity_start: number;
  maturity_peak: number;
  maturity_peak_days: number;
  maturity_tail: number;
  maturity_tail_days: number;
  unknown_age_multiplier: number;
}

export const MODEL: ModelConstants = {
  shrink_peers: 5,
  peer_ratio_floor: 0.005,
  peer_ratio_cap: 3,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
  growth_log_weight: 0.45,
  growth_log_scale: 50,
  growth_down_weight: 0.5,
  growth_floor: -80,
  growth_cap: 2000,
  growth_mult_floor: 0.7,
  growth_mult_cap: 2.0,
  maturity_start: 0.7,
  maturity_peak: 1.0,
  maturity_peak_days: 730,
  maturity_tail: 0.85,
  maturity_tail_days: 1825,
  unknown_age_multiplier: 0.85,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by implied value. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparable multiple, with how many traded peers set it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist: string[];
  category_multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array, or null when empty. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category comparables, computed from the snapshot's own traded protocols: for each category,
 * the median of its traded peers' mcap/TVL (each peer ratio clamped first), shrunk toward the
 * global median by peer count, then clamped. Categories with no traded peer take the global median.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, { multiple: number; peers: number }>; global: number; table: CategoryMultiple[] } {
  const peersByCat = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = Math.min(model.peer_ratio_cap, Math.max(model.peer_ratio_floor, p.mcap_usd / p.tvl_usd));
    allRatios.push(ratio);
    if (p.category !== null) {
      const arr = peersByCat.get(p.category) ?? [];
      arr.push(ratio);
      peersByCat.set(p.category, arr);
    }
  }
  allRatios.sort((a, b) => a - b);
  const global = medianOf(allRatios) ?? 0.25;
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  const table: CategoryMultiple[] = [];
  const cats = new Set<string>();
  for (const p of snapshot.protocols) if (p.category !== null) cats.add(p.category);
  for (const cat of [...cats].sort()) {
    const peers = peersByCat.get(cat) ?? [];
    const sorted = [...peers].sort((a, b) => a - b);
    const catMedian = medianOf(sorted);
    const multiple =
      catMedian === null
        ? global
        : Math.min(
            model.multiple_cap,
            Math.max(model.multiple_floor, (peers.length * catMedian + model.shrink_peers * global) / (peers.length + model.shrink_peers)),
          );
    byCategory.set(cat, { multiple, peers: peers.length });
    table.push({ category: cat, multiple: round4(multiple), peers: peers.length });
  }
  return { byCategory, global, table };
}

/** The maturity multiplier for an age in days: 0.70 at listing, 1.00 at the peak, 0.85 past the tail. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  if (age === null) return model.unknown_age_multiplier;
  if (age <= 0) return model.maturity_start;
  if (age <= model.maturity_peak_days) {
    return model.maturity_start + ((model.maturity_peak - model.maturity_start) * age) / model.maturity_peak_days;
  }
  if (age >= model.maturity_tail_days) return model.maturity_tail;
  return model.maturity_peak + ((model.maturity_tail - model.maturity_peak) * (age - model.maturity_peak_days)) / (model.maturity_tail_days - model.maturity_peak_days);
}

/** The growth multiplier for a 7-day change in percent: log-damped upside, linear downside. */
export function growthMultiplier(growthPct: number, model: ModelConstants): number {
  const g = Math.min(model.growth_cap, Math.max(model.growth_floor, growthPct));
  const up = g > 0 ? model.growth_log_weight * Math.log(1 + g / model.growth_log_scale) : 0;
  const down = g < 0 ? model.growth_down_weight * (g / 100) : 0;
  return Math.min(model.growth_mult_cap, Math.max(model.growth_mult_floor, 1 + up + down));
}

/** The three parts and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: Map<string, { multiple: number; peers: number }>,
  globalMultiple: number,
): { implied: number; multiple: number; peers: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const cat = protocol.category !== null ? multiples.get(protocol.category) : undefined;
  const multiple = cat === undefined ? globalMultiple : cat.multiple;
  const peers = cat === undefined ? 0 : cat.peers;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = growthMultiplier(growthPct, model);
  const maturityMult = maturityMultiplier(age, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, peers, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory, global } = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by implied value, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model, byCategory, global) }))
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, byCategory, global);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.multiple),
      category_peers: s.peers,
      growth_pct: round2(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 1e2) / 1e2;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas cost of one ordinary transaction on a chain, by name. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $8 of gas';
  if (c.includes('solana')) return 'a few cents of gas';
  if (c.includes('arbitrum') || c.includes('optimism') || c.includes('base') || c.includes('zksync') || c.includes('linea') || c.includes('blast') || c.includes('mode') || c.includes('scroll') || c.includes('mantle')) return 'under $0.50 of gas';
  if (c.includes('bnb') || c.includes('binance') || c.includes('polygon') || c.includes('avalanche') || c.includes('fantom') || c.includes('gnosis')) return 'about $1 of gas';
  return 'about $2 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow 25-35% of it in the same market and keep both legs open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the chain's asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then leave the outcome open.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it to accrue yield.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and let it compound.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} over the month.`;
  if (c.includes('governance')) return `Lock $${capital} of voting power through ${name} on ${chain} and vote in the next round.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into ${name}'s CeDeFi vault on ${chain} and keep the shares.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different interaction with the same protocol. */
function action2For(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay part of the borrow on ${name}, then borrow again for a smaller amount so the account shows two cycles.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $${Math.max(10, Math.round(capital / 5))} of USDC for another asset inside ${name} on ${chain}.`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool')) return `Use the receipt token as collateral in a lending market on ${chain} for a small borrow.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge a small amount back through ${name} so the account shows two-way flow.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the first position on ${name}, then open a second one half its size.`;
  if (c.includes('prediction')) return `Settle the first market on ${name}, then place a second position in a different market.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) return `Deposit a second, smaller amount into a different ${name} vault on ${chain}.`;
  if (c.includes('stable')) return `Swap half the stable position into USDC and back through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Claim the accrued yield on ${name} once, then re-deposit it into the same asset.`;
  if (c.includes('insurance')) return `Renew or top up the cover on ${name} so the policy covers a second month.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Harvest the vault rewards on ${name} once and re-deposit them into the same vault.`;
  if (c.includes('basis')) return `Check the funding rate on ${name} weekly and add $${Math.max(10, Math.round(capital / 5))} when it is positive.`;
  if (c.includes('payment')) return `Send a second payment through ${name} to a different recipient on ${chain}.`;
  if (c.includes('governance')) return `Vote in a second proposal through ${name} on ${chain}.`;
  if (c.includes('cedefi')) return `Harvest the vault yield on ${name} once and re-deposit it.`;
  return `Make a second, smaller deposit into ${name} on ${chain} a week after the first.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Move $${capital} of USDC onto ${chain} from the chain you already hold funds on, and check the protocol's own docs for its contract address before you interact.`,
      cost: `bridge fee plus ${gas}`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: action2For(p, capital, chain),
      cost: gas,
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action each week, such as a deposit, a swap, a vote or a claim, so the wallet stays active.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Open the protocol's own points or rewards page once a week and confirm this wallet is counted; claim only from the link the protocol itself publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '5 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When you unwind, reverse the steps: repay any borrow, remove liquidity, unstake, then bridge back. Write the wallet, the dates and every transaction in a farm log.`,
      cost: gas,
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. The category
 * multiple is carried at full precision (unlike board.json's rounded breakdown) so the page's
 * recompute of the implied value lands on the same integer board.json carries. */
export function radarRow(row: BoardRow, byCategory: Map<string, { multiple: number; peers: number }>, globalMultiple: number): RadarRow {
  const cat = row.category !== null ? byCategory.get(row.category) : undefined;
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: cat === undefined ? globalMultiple : cat.multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { byCategory, global, table } = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    watchlist: snapshot.watchlist,
    category_multiples: table,
    rows: board.map((r) => radarRow(r, byCategory, global)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
