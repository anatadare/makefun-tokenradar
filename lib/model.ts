// Token Radar: the value model, the board builder and the farm-plan recipes.
//
// The model works only from the snapshot's own figures. Nothing here names a
// protocol: every implied value is TVL times a category multiple fitted on the
// snapshot's token-trading protocols, adjusted by the protocol's own seven-day
// growth, its age and how many chains it runs on.
//
//   implied_value = tvl_usd x category_multiple x growth_factor x age_factor x chain_factor
//
// The category multiple is the median market-cap-to-TVL ratio of the token
// protocols in that category, shrunk toward the global median with weight
// n / (n + 15), so a category with few peers borrows strength from the whole
// snapshot instead of trusting a handful of ratios. Ratios are winsorized at
// their 95th percentile first, so one tiny-TVL protocol with a large token
// cannot set its whole category's multiple. A protocol with no category
// recorded takes the global median outright.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** One protocol's valuation, with every input the detail view needs to redo it. */
export interface Valuation {
  value: number;
  multiple: number;
  peers: number;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  age_days: number | null;
  gaps: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  symbol: string | null;
  token_status: string;
  watchlist: boolean;
  multiple: number;
  peers: number;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  age_days: number | null;
  listed_at: string | null;
  data_gaps: string[];
}

export interface BoardStats {
  rows: number;
  watchlist_rows: number;
  candidate_rows: number;
  comparable_rows: number;
  min_value: number;
  max_value: number;
  categories: number;
}

export interface Board {
  rows: BoardRow[];
  stats: BoardStats;
}

// ---------------------------------------------------------------- parsing

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asProtocol(v: unknown, i: number): Protocol {
  if (!isRecord(v)) throw new Error(`snapshot.protocols[${i}] is not an object`);
  const str = (k: string): string => {
    const x = v[k];
    if (typeof x !== 'string' || x.length === 0) throw new Error(`snapshot.protocols[${i}].${k} must be a non-empty string`);
    return x;
  };
  const num = (k: string): number => {
    const x = v[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`snapshot.protocols[${i}].${k} must be a finite number`);
    return x;
  };
  const numOrNull = (k: string): number | null => {
    const x = v[k];
    if (x === null) return null;
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`snapshot.protocols[${i}].${k} must be a number or null`);
    return x;
  };
  const strOrNull = (k: string): string | null => {
    const x = v[k];
    if (x === null) return null;
    if (typeof x !== 'string') throw new Error(`snapshot.protocols[${i}].${k} must be a string or null`);
    return x;
  };
  const chains = v.chains;
  if (!Array.isArray(chains) || chains.some((c) => typeof c !== 'string')) {
    throw new Error(`snapshot.protocols[${i}].chains must be an array of strings`);
  }
  return {
    slug: str('slug'),
    name: str('name'),
    category: strOrNull('category'),
    chains: chains as string[],
    tvl_usd: num('tvl_usd'),
    change_7d: numOrNull('change_7d'),
    mcap_usd: numOrNull('mcap_usd'),
    listed_at: strOrNull('listed_at'),
    gecko_id: strOrNull('gecko_id'),
    symbol: strOrNull('symbol'),
  };
}

/** Parse and validate the snapshot JSON. Throws with a clear message on bad input. */
export function parseSnapshot(raw: unknown): Snapshot {
  if (!isRecord(raw)) throw new Error('snapshot is not a JSON object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) {
    throw new Error('snapshot.as_of must be a YYYY-MM-DD date string');
  }
  if (typeof raw.floor_usd !== 'number' || !Number.isFinite(raw.floor_usd)) {
    throw new Error('snapshot.floor_usd must be a finite number');
  }
  if (!Array.isArray(raw.protocols) || raw.protocols.length === 0) {
    throw new Error('snapshot.protocols must be a non-empty array');
  }
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((w) => typeof w !== 'string')) {
    throw new Error('snapshot.watchlist must be an array of strings');
  }
  const protocols = raw.protocols.map((p, i) => asProtocol(p, i));
  const seen = new Set<string>();
  for (const p of protocols) {
    if (seen.has(p.slug)) throw new Error(`snapshot repeats the slug ${p.slug}`);
    seen.add(p.slug);
  }
  for (const w of raw.watchlist as string[]) {
    if (!seen.has(w)) throw new Error(`watchlist names ${w}, which is not in snapshot.protocols`);
  }
  return {
    as_of: raw.as_of,
    source: typeof raw.source === 'string' ? raw.source : '',
    floor_usd: raw.floor_usd,
    protocols,
    watchlist: raw.watchlist as string[],
  };
}

// ---------------------------------------------------------------- token status

/** True when the snapshot records a token for the protocol (a CoinGecko id or a ticker). */
export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** The board's token label. "No token recorded" is the snapshot's wording, never "has no token". */
export function tokenStatus(p: Protocol): string {
  return hasToken(p) ? 'Token trades' : 'No token recorded';
}

// ---------------------------------------------------------------- the value model

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface Multiples {
  global: number;
  byCategory: Map<string, { multiple: number; peers: number }>;
}

/**
 * Fit the category multiples on the snapshot's token-trading protocols: for
 * each category, the median market-cap-to-TVL ratio among its protocols with
 * a positive market cap and TVL, shrunk toward the global median with weight
 * n / (n + 15). A category with no priced peers takes the global median.
 */
export function categoryMultiples(protocols: Protocol[]): Multiples {
  const priced = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (priced.length === 0) throw new Error('no protocol in the snapshot has a market cap to fit multiples on');
  // Winsorize the ratios at their 95th percentile before taking medians: a
  // single tiny-TVL protocol with a large token (one peer here sits at 400x)
  // must not set its whole category's multiple. The cap comes from the data,
  // and 95% of the ratios pass through untouched.
  const ratios = priced.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const cap = ratios[Math.ceil(0.95 * ratios.length) - 1]!;
  const capped = (p: Protocol): number => Math.min(p.mcap_usd! / p.tvl_usd, cap);
  const global = median(priced.map(capped));
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  const cats = new Map<string, number[]>();
  for (const p of priced) {
    if (p.category === null) continue;
    const list = cats.get(p.category) ?? [];
    list.push(capped(p));
    cats.set(p.category, list);
  }
  for (const [cat, ratios] of cats) {
    const n = ratios.length;
    const w = n / (n + 15);
    byCategory.set(cat, { multiple: w * median(ratios) + (1 - w) * global, peers: n });
  }
  return { global, byCategory };
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** 1 + 0.25 x the seven-day change, clamped to +/-40%; no report means a neutral 1. */
export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + 0.25 * clamp(change7d / 100, -0.4, 0.4);
}

/** Whole days from a YYYY-MM-DD date to the snapshot date, or null when unreported. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${listedAt}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

/** 0.90 for a brand-new protocol rising to 1.10 at two years; no date means a neutral 1. */
export function ageFactor(days: number | null): number {
  if (days === null) return 1;
  return 0.9 + 0.2 * Math.min(days / 730, 1);
}

/** 1 + 2.5% per extra chain, capped at four extra chains; no chains recorded means 1. */
export function chainFactor(chains: string[]): number {
  if (chains.length === 0) return 1;
  return 1 + 0.025 * Math.min(Math.max(chains.length - 1, 0), 4);
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/** Value one protocol from the snapshot's own figures, keeping every input for the detail view. */
export function valueProtocol(p: Protocol, multiples: Multiples, asOf: string): Valuation {
  const cat = p.category === null ? null : multiples.byCategory.get(p.category);
  const multiple = cat === null || cat === undefined ? multiples.global : cat.multiple;
  const peers = cat === null || cat === undefined ? 0 : cat.peers;
  const days = ageDays(p.listed_at, asOf);
  const gf = growthFactor(p.change_7d);
  const af = ageFactor(days);
  const cf = chainFactor(p.chains);
  const gaps: string[] = [];
  if (p.change_7d === null) gaps.push('7-day change not reported');
  if (p.listed_at === null) gaps.push('Listing date not reported');
  if (p.chains.length === 0) gaps.push('No chains recorded');
  if (p.category === null) gaps.push('No category recorded');
  return {
    value: Math.max(1, Math.round(p.tvl_usd * multiple * gf * af * cf)),
    multiple: round4(multiple),
    peers,
    growth_factor: round4(gf),
    age_factor: round4(af),
    chain_factor: round4(cf),
    age_days: days,
    gaps,
  };
}

// ---------------------------------------------------------------- board selection

/** Categories the watchlist rule treats as wrapped, staked or bridged products. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * The watchlist rule's product test, minus the parent-protocol field the
 * snapshot does not carry: a wrapped, staked or bridged product of a token
 * that already trades is not a launch candidate, so it is kept out of the
 * pre-token candidate set (it may still appear as a token comparable).
 */
export function excludedProduct(p: Protocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_NAMES.some((e) => p.name.startsWith(e));
}

const byValueThenSlug = (a: { value: number; slug: string }, b: { value: number; slug: string }): number =>
  b.value - a.value || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/**
 * Build the 200-row board: every watchlist protocol, up to 120 further
 * pre-token candidates by modeled value, and token comparables to reach 200.
 * Comparables are token-trading protocols at or below the watchlist floor, so
 * they calibrate the multiples at the candidates' own size instead of letting
 * the largest exchanges top a board about launches. Ranks follow implied
 * value, ties broken by slug.
 */
export function buildBoard(snapshot: Snapshot): Board {
  const multiples = categoryMultiples(snapshot.protocols);
  const valued = snapshot.protocols.map((p) => ({ p, v: valueProtocol(p, multiples, snapshot.as_of) }));
  const bySlug = new Map(valued.map(({ p, v }) => [p.slug, { p, v }]));
  const watch = new Set(snapshot.watchlist);

  const chosen = new Map<string, { p: Protocol; v: Valuation }>();
  for (const slug of snapshot.watchlist) {
    const hit = bySlug.get(slug);
    if (hit) chosen.set(slug, hit);
  }
  const candidates = valued
    .filter(({ p }) => !watch.has(p.slug) && !hasToken(p) && !excludedProduct(p))
    .sort((a, b) => byValueThenSlug({ value: a.v.value, slug: a.p.slug }, { value: b.v.value, slug: b.p.slug }))
    .slice(0, 120);
  for (const c of candidates) chosen.set(c.p.slug, c);
  const comparables = valued
    .filter(({ p }) => hasToken(p) && p.tvl_usd <= snapshot.floor_usd)
    .sort((a, b) => byValueThenSlug({ value: a.v.value, slug: a.p.slug }, { value: b.v.value, slug: b.p.slug }))
    .slice(0, 40);
  for (const c of comparables) chosen.set(c.p.slug, c);

  // Fill any shortfall (a snapshot with few comparables) from the remaining
  // pre-token protocols first, then the remaining token protocols, by value.
  if (chosen.size < 200) {
    const rest = valued
      .filter(({ p }) => !chosen.has(p.slug))
      .sort((a, b) => {
        const at = hasToken(a.p) ? 1 : 0;
        const bt = hasToken(b.p) ? 1 : 0;
        return at - bt || byValueThenSlug({ value: a.v.value, slug: a.p.slug }, { value: b.v.value, slug: b.p.slug });
      });
    for (const r of rest) {
      if (chosen.size >= 200) break;
      chosen.set(r.p.slug, r);
    }
  }

  const ranked = [...chosen.values()].sort((a, b) =>
    byValueThenSlug({ value: a.v.value, slug: a.p.slug }, { value: b.v.value, slug: b.p.slug }),
  );
  const rows: BoardRow[] = ranked.map(({ p, v }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: v.value,
    farm_steps: farmPlan(p),
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    symbol: p.symbol,
    token_status: tokenStatus(p),
    watchlist: watch.has(p.slug),
    multiple: v.multiple,
    peers: v.peers,
    growth_factor: v.growth_factor,
    age_factor: v.age_factor,
    chain_factor: v.chain_factor,
    age_days: v.age_days,
    listed_at: p.listed_at,
    data_gaps: v.gaps,
  }));
  const values = rows.map((r) => r.implied_value_usd);
  return {
    rows,
    stats: {
      rows: rows.length,
      watchlist_rows: rows.filter((r) => r.watchlist).length,
      candidate_rows: rows.filter((r) => !r.watchlist && r.token_status === 'No token recorded').length,
      comparable_rows: rows.filter((r) => r.token_status === 'Token trades').length,
      min_value: Math.min(...values),
      max_value: Math.max(...values),
      categories: new Set(rows.map((r) => r.category)).size,
    },
  };
}

// ---------------------------------------------------------------- farm plans

type Family = 'lending' | 'dex' | 'vault' | 'rwa' | 'derivatives' | 'verify';

const FAMILY_OF: Record<string, Family> = {
  Lending: 'lending',
  'Uncollateralized Lending': 'lending',
  CDP: 'lending',
  'CDP Manager': 'lending',
  'Collateral Markets': 'lending',
  'Collateral Management': 'lending',
  'Leveraged Farming': 'lending',
  Dexs: 'dex',
  'Liquidity Manager': 'dex',
  'OTC Marketplace': 'dex',
  Yield: 'vault',
  'Yield Aggregator': 'vault',
  Farm: 'vault',
  'Risk Curators': 'vault',
  'Onchain Capital Allocator': 'vault',
  'Basis Trading': 'vault',
  Restaking: 'vault',
  DOR: 'vault',
  Indexes: 'vault',
  'Liquid Staking': 'vault',
  'Liquid Restaking': 'vault',
  'Restaked BTC': 'vault',
  'Staking Pool': 'vault',
  RWA: 'rwa',
  'Stablecoin Issuer': 'rwa',
  'Algo-Stables': 'rwa',
  'Dual-Token Stablecoin': 'rwa',
  'Reserve Currency': 'rwa',
  'Anchor BTC': 'rwa',
  'Decentralized BTC': 'rwa',
  'Stablecoin Wrapper': 'rwa',
  Derivatives: 'derivatives',
  Options: 'derivatives',
  'Options Vault': 'derivatives',
  Synthetics: 'derivatives',
  'Interest Rate Derivatives': 'derivatives',
  'Prediction Market': 'derivatives',
};

/**
 * Each recipe is five steps (four for verify-only): check the live market
 * first, run a small trial against a fee budget, scale only when the trial
 * exits cleanly, recheck after seven days, then exit. Costs are planning
 * ranges, never quotes, and no step invents a pool, a yield or an airdrop.
 * A category with no recipe gets the verify-only plan, which stops before
 * any funding.
 */
function recipe(family: Family, name: string, chain: string): string[] {
  const verify = {
    lending: `On ${chain}, confirm that ${name} has a live lending market for a stablecoin you hold. Allow 5-10 minutes and $0 for this check. Continue only if deposits and withdrawals are both enabled.`,
    dex: `On ${chain}, confirm that ${name} has a live trading pool for a pair you hold. Allow 5-10 minutes and $0 for this check. Continue only if the pool shows recent trades and working withdrawals.`,
    vault: `On ${chain}, confirm that ${name} runs a live vault that accepts deposits. Allow 5-10 minutes and $0 for this check. Continue only if deposits and withdrawals are both enabled.`,
    rwa: `On ${chain}, confirm that ${name} has a live market for its tokenised asset and that redemptions are open. Allow 5-10 minutes and $0 for this check. Continue only if you can see how to exit.`,
    derivatives: `On ${chain}, confirm that ${name} has a live market for the contract you want to trade. Allow 5-10 minutes and $0 for this check. Continue only if you can open and close a position.`,
    verify: `Look up ${name}'s official docs and confirm which chain its markets run on. Allow 10-15 minutes and $0. Do not fund anything until you can name the market and its withdrawal terms.`,
  }[family];
  const trial = {
    lending: `Deposit $25-50 of stablecoin as a trial. Check the preview before you confirm: if the quoted fee is above $2, stop and try a cheaper chain or a smaller amount.`,
    dex: `Swap $25-50 as a trial. Check the preview before you confirm: if the quoted fee and slippage together are above $2, stop and try a cheaper chain or a smaller amount.`,
    vault: `Deposit $25-50 of stablecoin into the vault as a trial. Check the preview before you confirm: if the quoted fee is above $2, stop and try a cheaper chain or a smaller amount.`,
    rwa: `Buy $25-50 of the asset as a trial. Check the preview before you confirm: if the quoted fee is above $2, stop and try a cheaper chain or a smaller amount.`,
    derivatives: `Open a $25-50 trial position. Check the preview before you confirm: if the quoted fee is above $2, stop and try a cheaper chain or a smaller amount.`,
    verify: `Check that the protocol's contracts are the ones its docs name, and that recent activity is visible on a block explorer. Allow 10 minutes and $0. Stop if the docs and the chain disagree.`,
  }[family];
  const scale = {
    lending: `If the trial withdraws cleanly, scale to the amount you planned, in no more than two further deposits. Keep the position below what you can afford to leave in place for 30 days.`,
    dex: `If the trial settles cleanly, add liquidity or trade up to the amount you planned, in no more than two further steps. Keep the position below what you can afford to leave in place for 30 days.`,
    vault: `If the trial withdraws cleanly, scale to the amount you planned, in no more than two further deposits. Keep the position below what you can afford to leave in place for 30 days.`,
    rwa: `If the trial redeems cleanly, scale to the amount you planned, in no more than two further steps. Keep the position below what you can afford to leave in place for 30 days.`,
    derivatives: `If the trial closes cleanly, trade up to the amount you planned, in no more than two further steps. Keep the position below what you can afford to lose in full.`,
    verify: `List the fees, the minimum amounts and the exit path before you commit any funds. Allow 10 minutes and $0. If any of the three is unclear, treat the protocol as unverified.`,
  }[family];
  const review = {
    lending: `Recheck withdrawal liquidity, the borrow rate and your position after 7 days. If withdrawals are slow or the market has shrunk, exit instead of adding more.`,
    dex: `Recheck the pool's depth, your share and the withdrawal path after 7 days. If the pool has thinned or withdrawals are slow, exit instead of adding more.`,
    vault: `Recheck withdrawal liquidity, the vault's size and your share after 7 days. If withdrawals are slow or the vault has shrunk, exit instead of adding more.`,
    rwa: `Recheck redemption liquidity, the asset's backing and your holding after 7 days. If redemptions are slow or the backing is unclear, exit instead of adding more.`,
    derivatives: `Recheck the market's depth, funding and your position after 7 days. If the market has thinned or exits are slow, close the position instead of adding more.`,
    verify: `Revisit the checks after 7 days: if the docs, the contracts and the activity still agree, the protocol is ready for a trial. Until then, keep your funds out.`,
  }[family];
  const exit = {
    lending: `Withdraw the trial amount plus any interest, then decide whether to keep a position. Keep a note of the fees you paid so the next trial starts from real numbers.`,
    dex: `Withdraw your position plus any fees earned, then decide whether to keep farming it. Keep a note of the fees you paid so the next trial starts from real numbers.`,
    vault: `Withdraw the trial amount plus any yield, then decide whether to keep a position. Keep a note of the fees you paid so the next trial starts from real numbers.`,
    rwa: `Redeem the trial amount plus any yield, then decide whether to keep a position. Keep a note of the fees you paid so the next trial starts from real numbers.`,
    derivatives: `Close the trial position, then decide whether to keep trading it. Keep a note of the fees you paid so the next trial starts from real numbers.`,
    verify: ``,
  }[family];
  return family === 'verify' ? [verify, trial, scale, review] : [verify, trial, scale, review, exit];
}

/** A protocol's farm plan: 5 steps from its category's recipe, 4 when its category has none. */
export function farmPlan(p: Protocol): string[] {
  const family = p.category === null ? 'verify' : (FAMILY_OF[p.category] ?? 'verify');
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its chain';
  const steps = recipe(family, p.name, chain);
  if (hasToken(p)) {
    steps[0] = `${p.name}'s token already trades, so this plan farms yield, not a future launch. ${steps[0]}`;
  }
  return steps;
}

// ---------------------------------------------------------------- the gate's own checks, run before writing

/** The first thing wrong with a board, or null when it passes every gate row the model can check. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board holds ${board.length} rows, outside the 100 to 4,000 the gate allows`;
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = new Set<number>();
  let prev = Number.POSITIVE_INFINITY;
  let allEqual = board.length > 0;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (const row of byRank) {
    if (!slugs.has(row.slug)) return `row names ${row.slug}, which is not in the snapshot`;
    if (seen.has(row.slug)) return `row repeats the slug ${row.slug}`;
    seen.add(row.slug);
    if (typeof row.name !== 'string' || row.name.length === 0) return `row ${row.slug} has no name`;
    if (!Number.isInteger(row.rank) || row.rank < 1) return `row ${row.slug} has rank ${row.rank}`;
    ranks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100000000000000) {
      return `row ${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== prev && prev !== Number.POSITIVE_INFINITY) allEqual = false;
    prev = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 0} farm steps, outside 3 to 12`;
    }
    for (const s of row.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `row ${row.slug} has a farm step of ${n} characters, outside 20 to 600`;
    }
  }
  if (ranks.size !== board.length) return 'ranks are not all distinct';
  for (let r = 1; r <= board.length; r++) {
    if (!ranks.has(r)) return `rank ${r} is missing`;
  }
  if (board.length >= 2 && allEqual) return 'every implied value is the same, so the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}
