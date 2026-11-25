# Pump.fun Bot Sprint — Burst Scalper

[![make.fun](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rwnliwan/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rwnliwan/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A paper-money trading bot for the pump.fun bonding-curve replay
(`agent-fun/replay/v2`). It buys launches only — never a coin that has
already run — and leaves on a clock, not on hope.

## Strategy (strategy.ts)

**Entry** — once per coin, inside its first 8 slots of life (20 for the
strict tier), only if the tape is clean: the creator has not sold and
bought at most 1 SOL; at least 3 distinct non-creator buyers with buys
clearly outweighing sells; no single sell over 20% of the real reserve;
real SOL between 0.2 and 25; price within −5%…+50% of its create price.
Sizing is tiered: a coin with a much stronger tape (5+ buyers, 6+ buy
trades) gets 0.25 SOL, the rest get a guardrail-sized 0.01 SOL — both
capped at 1% of the curve's real SOL reserve, which binds first on most
coins. At most 5 open, at most 2 new entries per batch.

**Exit** — take half at +8% over cost, the rest at +25% or on an 8%
trailing fall from the best value after the first take-profit; stop out
at −8%; leave after 150 slots held, 90 slots with no trade, the moment
the creator sells, or on any single sell worth 25% of the real reserve.

**Why this shape:** on the dev window the pilot momentum bot lost
9.46 SOL pyramiding into strength and the pilot reversion bot lost
3.89 SOL buying dips that kept dipping, while the pilot sniper lost
only 0.47 SOL by buying early and leaving fast. This bot is the
sniper family, tightened: a bought-tape filter at entry, a half
take-profit so winners bank something, and a creator-sell / big-sell
eject for rugs.

Deterministic: every decision is a pure function of the batches the
harness sends — no clock, no randomness, no I/O — so the two graded
executions produce byte-identical action logs.

## Run

The grader runs `node /bot/main.ts` (Node 22). Local grade:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot <this repo> --driver process
```

## Files

- `main.ts` — entrypoint
- `strategy.ts` — the strategy
- `vendor/makefun-bot.ts` — SDK shim, byte-identical to the kit's
- `trial-log.md` — one trial per change, with dev-window scores
