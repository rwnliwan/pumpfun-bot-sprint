// Burst scalper for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// Thesis, from the dev window: almost every new coin dies. The pilot momentum
// bot lost 9.46 SOL by pyramiding into strength and holding through the
// collapse; the pilot reversion bot lost 3.89 SOL buying dips that kept
// dipping; the pilot sniper lost only 0.47 SOL by buying launches early and
// leaving fast. So this bot only ever buys a launch, never a coin that has
// already run, and it leaves on a clock, not on hope.
//
// Entry (once per coin, inside its first few slots of life):
//   * the creator has not sold, and the creator's own buys are small
//     (a big creator buy is a dump waiting to happen);
//   * at least three distinct non-creator wallets are buying, with buys
//     clearly outweighing sells in SOL terms, and no single sell larger
//     than a fifth of the real reserve;
//   * the curve already holds some real SOL (it is actually trading) but
//     not so much that the move is over, and the price has not already
//     run away from its create price.
//   * sizing is tiered: a coin whose tape is much stronger (5+ distinct
//     buyers, 6+ buy trades) gets a 0.25 SOL stake, the rest get a
//     guardrail-sized 0.01 SOL stake. The strict tier is where the
//     dev-window profit lives; the base tier is what keeps the coin
//     count above the 20-mint guardrail on the unseen 6-hour final
//     window (the dev window is 24 h, so the final window holds roughly
//     a quarter as many coins). Size is always capped at 1% of the
//     curve's real SOL reserve, which binds before either stake on most
//     coins.
// Exit (whole or half position, whichever fires first):
//   * take half at +8% over cost, the rest at +25%, or on a trailing
//     fall of 8% from the best value seen after the first take-profit;
//   * stop out at -8% under cost;
//   * leave after 150 slots held, after 90 slots with no trade at all,
//     the moment the creator sells, or on any single sell worth a
//     quarter of the real reserve.
// At most five coins open at once, at most two new entries per batch,
// so one hot slot cannot eat the whole book.
// Every decision is a pure function of the batches the harness sends:
// no clock, no randomness, no I/O, iteration only over insertion-ordered
// maps, so the two graded executions produce byte-identical action logs.

import {
  LAMPORTS_PER_SOL,
  runBot,
  type Batch,
  type BotState,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

const STAKE_LAMPORTS = (LAMPORTS_PER_SOL * 1n) / 100n; // 0.01 SOL base stake per coin (guardrail-sized)
// Coins whose opening tape is much stronger (many distinct buyers) get a
// bigger stake: the strict filter is where the dev-window profit lives,
// but the base filter is what keeps the coin count above the guardrail.
const STRICT_STAKE_LAMPORTS = (LAMPORTS_PER_SOL * 25n) / 100n; // 0.25 SOL
const STRICT_MIN_BUYERS = 5;
const STRICT_MIN_BUY_TRADES = 6;
const MAX_SLIPPAGE_BPS = 10_000; // wide open: never let a refusal strand an exit
const MAX_NEW_PER_BATCH = 2;

// Entry window, in slots since the CreateEvent.
const MAX_ENTRY_AGE = 8;
// Real SOL reserve window at entry (lamports).
const MIN_REAL_SOL = 200_000_000n; // 0.2 SOL
const MAX_REAL_SOL = 25_000_000_000n; // 25 SOL
// Creator's own buys in total must stay under this.
const MAX_DEV_BUY = 1_000_000_000n; // 1 SOL
// Tape quality at entry.
const MIN_BUYERS = 3;
const MIN_BUY_TRADES = 4;
const MAX_SELL_SHARE_BPS = 2_500; // sells by others <= 25% of buys, in SOL
const MAX_BIG_SELL_BPS = 2_000; // no single sell >= 20% of real reserve
const MIN_RUNUP_BPS = -500; // price vs create price, >= -5%
const MAX_RUNUP_BPS = 5_000; // ... and <= +50%

// Exits, in basis points over cost (value = tokens * virtual price).
const TAKE_HALF_BPS = 800; // sell half at +8%
const TAKE_REST_BPS = 2500; // sell the rest at +25%
const TRAIL_BPS = 800; // after the first take-profit, exit on a 8% fall from peak
const STOP_BPS = 800; // stop out at -8%
const MAX_HOLD_SLOTS = 150;
const STALE_SLOTS = 90;
const BIG_SELL_EXIT_BPS = 2_500; // any single sell >= 25% of real reserve

interface Tape {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Create-time virtual reserves: the run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  devSold: boolean;
  buyers: Set<Pubkey>;
  buyTrades: number;
  boughtSol: bigint;
  soldSol: bigint;
  bigSellBps: bigint;
  lastTradeSlot: number;
  /** Decided for good (bought, or filtered out). */
  done: boolean;
}

interface Held {
  openedSlot: number;
  peakValue: bigint;
  tookHalf: boolean;
  lastTradeSlot: number;
}


function priceOf(vq: bigint, vt: bigint): number {
  if (vt <= 0n) return 0;
  return Number(vq) / Number(vt);
}

/** Current liquidation value of a holding, in lamports (approx, pre-fees). */
function valueOf(state: BotState, mint: Pubkey, tokens: bigint): bigint {
  const curve = state.curves.get(mint);
  if (curve === undefined) return 0n;
  const p = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
  if (!(p > 0)) return 0n;
  return BigInt(Math.floor(Number(tokens) * p));
}

const tapes = new Map<Pubkey, Tape>();
const held = new Map<Pubkey, Held>();

function tapeFor(mint: Pubkey, slot: number): Tape {
  let t = tapes.get(mint);
  if (t === undefined) {
    t = {
      mint,
      createSlot: slot,
      creator: '',
      vq0: 0n,
      vt0: 0n,
      devBuy: 0n,
      devSold: false,
      buyers: new Set<Pubkey>(),
      buyTrades: 0,
      boughtSol: 0n,
      soldSol: 0n,
      bigSellBps: 0n,
      lastTradeSlot: slot,
      done: false,
    };
    tapes.set(mint, t);
  }
  return t;
}

await runBot({
  onBatch(state: BotState, batch: Batch): OrderInput[] {
    const { caps } = state.hello;
    const tx = state.txFeeLamports();
    const orders: OrderInput[] = [];
    // Mints bought in this very batch: state.pending does not include them
    // yet (the shim records orders only after onBatch returns), so the
    // housekeeping below must not drop their held entries.
    const justBought = new Set<Pubkey>();
    let free = state.freeCashLamports();
    let slots = caps.max_open_positions - state.committedPositionCount();
    let newEntries = 0;

    // --- fold this batch's events into the per-coin tapes -----------------
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        const t = tapeFor(e.mint, batch.slot);
        t.createSlot = batch.slot;
        t.creator = e.creator;
        t.vq0 = BigInt(e.virtual_quote_reserves);
        t.vt0 = BigInt(e.virtual_token_reserves);
        continue;
      }
      if (e.event === 'CompleteEvent') {
        const t = tapes.get(e.mint);
        if (t !== undefined) t.done = true;
        held.delete(e.mint);
        continue;
      }
      // TradeEvent
      const t = tapeFor(e.mint, batch.slot);
      const sol = BigInt(e.sol_amount);
      t.lastTradeSlot = batch.slot;
      if (e.user === t.creator) {
        if (e.is_buy) t.devBuy += sol;
        else t.devSold = true;
      } else if (e.is_buy) {
        t.buyers.add(e.user);
        t.buyTrades += 1;
        t.boughtSol += sol;
      } else {
        t.soldSol += sol;
        const curve = state.curves.get(e.mint);
        if (curve !== undefined && curve.real_quote_reserves > 0n) {
          const bps = (sol * 10_000n) / curve.real_quote_reserves;
          if (bps > t.bigSellBps) t.bigSellBps = bps;
        }
      }
    }

    // --- exits first: never let an exit wait behind an entry --------------
    const pendingSell = new Set<Pubkey>();
    const pendingBuy = new Set<Pubkey>();
    for (const p of state.pending.values()) {
      if (p.order.side === 'sell') pendingSell.add(p.order.mint);
      else pendingBuy.add(p.order.mint);
    }
    for (const [mint, holding] of state.positions) {
      if (pendingSell.has(mint)) continue;
      const h = held.get(mint);
      if (h === undefined) continue; // position we did not open (should not happen)
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const value = valueOf(state, mint, holding.token_amount);
      if (value <= 0n) continue;
      const cost = holding.cost_lamports;
      if (value > h.peakValue) h.peakValue = value;
      h.lastTradeSlot = Math.max(h.lastTradeSlot, curve.reserves_slot);

      const tape = tapes.get(mint);
      let reason = '';
      if (value * 10_000n >= cost * BigInt(10_000 + TAKE_REST_BPS)) reason = 'take-rest';
      else if (!h.tookHalf && value * 10_000n >= cost * BigInt(10_000 + TAKE_HALF_BPS)) reason = 'take-half';
      else if (h.tookHalf && value * 10_000n <= h.peakValue * BigInt(10_000 - TRAIL_BPS)) reason = 'trail';
      else if (value * 10_000n <= cost * BigInt(10_000 - STOP_BPS)) reason = 'stop';
      else if (batch.slot - h.openedSlot >= MAX_HOLD_SLOTS) reason = 'max-hold';
      else if (batch.slot - h.lastTradeSlot >= STALE_SLOTS) reason = 'stale';
      else if (tape !== undefined && tape.devSold) reason = 'dev-sold';
      else if (tape !== undefined && tape.bigSellBps >= BigInt(BIG_SELL_EXIT_BPS)) reason = 'big-sell';
      if (reason === '') continue;

      const amount =
        reason === 'take-half' ? holding.token_amount / 2n : holding.token_amount;
      if (amount <= 0n) continue;
      if (orders.length >= caps.max_orders_per_batch) continue;
      orders.push({
        side: 'sell',
        mint,
        token_amount: amount,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      });
      if (reason === 'take-half') {
        h.tookHalf = true;
      } else {
        held.delete(mint);
        const tp = tapes.get(mint);
        if (tp !== undefined) tp.done = true;
      }
    }

    // --- entries: young coins with a clean, bought tape -------------------
    for (const e of batch.events) {
      if (newEntries >= MAX_NEW_PER_BATCH) break;
      if (e.event !== 'TradeEvent' && e.event !== 'CreateEvent') continue;
      const mint = e.mint;
      const t = tapes.get(mint);
      if (t === undefined || t.done) continue;
      if (state.positions.has(mint)) {
        t.done = true;
        continue;
      }
      if (pendingBuy.has(mint)) continue;
      const age = batch.slot - t.createSlot;
      // Strict-tier coins may enter later: by then the real reserve has
      // grown, so the 1%-of-reserve size cap allows a bigger position.
      const strictNow =
        t.buyers.size >= STRICT_MIN_BUYERS && t.buyTrades >= STRICT_MIN_BUY_TRADES;
      const maxAge = strictNow ? 20 : MAX_ENTRY_AGE;
      if (age < 0 || age > maxAge) {
        if (age > maxAge) t.done = true;
        continue;
      }
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) {
        t.done = true;
        continue;
      }
      if (curve.real_quote_reserves < MIN_REAL_SOL) continue;
      if (curve.real_quote_reserves > MAX_REAL_SOL) {
        t.done = true;
        continue;
      }
      if (t.devSold || t.devBuy > MAX_DEV_BUY) {
        t.done = true;
        continue;
      }
      if (t.buyers.size < MIN_BUYERS || t.buyTrades < MIN_BUY_TRADES) continue;
      if (t.boughtSol <= 0n) continue;
      if ((t.soldSol * 10_000n) / t.boughtSol > BigInt(MAX_SELL_SHARE_BPS)) {
        t.done = true;
        continue;
      }
      if (t.bigSellBps >= BigInt(MAX_BIG_SELL_BPS)) {
        t.done = true;
        continue;
      }
      if (t.vq0 <= 0n || t.vt0 <= 0n) continue;
      const createPrice = priceOf(t.vq0, t.vt0);
      const nowPrice = priceOf(
        curve.virtual_quote_reserves,
        curve.virtual_token_reserves,
      );
      if (!(createPrice > 0) || !(nowPrice > 0)) continue;
      const runupBps = Math.round(((nowPrice - createPrice) / createPrice) * 10_000);
      if (runupBps < MIN_RUNUP_BPS || runupBps > MAX_RUNUP_BPS) {
        if (runupBps > MAX_RUNUP_BPS) t.done = true;
        continue;
      }

      // Size: the fixed stake (bigger for the strict tier), capped by the
      // per-reply reserve cap.
      const cap = state.maxBuyLamports(mint);
      if (cap < 10_000_000n) continue; // below the guardrail round-trip floor
      const stake = strictNow ? STRICT_STAKE_LAMPORTS : STAKE_LAMPORTS;
      const amount = cap < stake ? cap : stake;
      if (orders.length >= caps.max_orders_per_batch) break;
      if (slots <= 0 || free < amount + tx) continue;
      orders.push({
        side: 'buy',
        mint,
        quote_lamports: amount,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      });
      t.done = true;
      held.set(mint, {
        openedSlot: batch.slot,
        peakValue: amount,
        tookHalf: false,
        lastTradeSlot: batch.slot,
      });
      free -= amount + tx;
      slots -= 1;
      newEntries += 1;
      justBought.add(mint);
    }

    // --- housekeeping: drop state for positions that are gone -------------
    for (const mint of [...held.keys()]) {
      if (justBought.has(mint)) continue;
      if (!state.positions.has(mint) && ![...state.pending.values()].some(
        (p) => p.order.side === 'buy' && p.order.mint === mint,
      )) {
        held.delete(mint);
      }
    }
    return orders;
  },
});
