# Trial log — Pump.fun Bot Sprint (burst scalper)

- Slug: `u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed`
- Deadline: 2026-11-28T08:00:00Z (28 Nov 16:00 WITA). Target submit before blind round 1 cutoff: 2026-11-26T01:17:03Z (26 Nov 09:17 WITA).
- Kit: bundle_sha256 `19d88277d9da2cc96f477dae3f0e87cd61ff458dbea1cbfdcb298afa6665cec8` (verified vs brief + competition.yaml header; live API confirms slug, $2, deadline, 841 submissions at 25 Nov 01:24 WITA).
- Limits: capital 10 SOL; max 5 open positions; no short/leverage; latency 2 slots; fees 95 bps protocol + 30 bps creator + 5000 base + 100000 priority lamports; guardrail min 20 distinct mints with round trip >= 0.01 SOL, max drawdown <= 50%, net PnL > 0 SOL to qualify; ranking by Net PnL.
- Dev window: 128,058 events, 1,222 distinct mints, 35 completions.

## Baselines (grade-local, --driver process, dev window)

| bot | net PnL (SOL) | return | max DD | fills | mints | round trips | compliant |
|---|---|---|---|---|---|---|---|
| hold-cash | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 | no (0 mints) |
| equal-weight | -0.019 | -0.002 | 0.009 | 5 | 5 | 5 | no (5 mints) |
| pilot momentum | -9.460 | -0.946 | 0.956 | 411 | 46 | 77 | no (DD) |
| pilot reversion | -3.887 | -0.389 | 0.482 | 2330 | 195 | 424 | yes |
| pilot sniper | -0.468 | -0.047 | 0.052 | 841 | 351 | 351 | yes |

Lesson: momentum/reversion bleed on this tape; only the early-entry, fast-exit
family gets near breakeven. This entry is built in that family, with a
bought-tape entry filter, a half take-profit, and a creator-sell / big-sell eject.

## Trials (one row per change; grade-local --driver process unless noted)

| v | change | net PnL (SOL) | return | max DD | fills | mints | top-3 share | verdict |
|---|---|---|---|---|---|---|---|---|
| v1 | burst scalper v1: entry age<=8, min 2 buyers/3 trades, stake 0.08 SOL, TP half +12% / rest +30%, trail 8%, SL -10%, max hold 150, stale 90, dev-sell/big-sell exit | -0.055 | -0.005 | 0.017 | 5 | 5 | — | BUG: only 5 fills — housekeeping deleted `held` entries for buys decided in the same batch (not yet in `state.pending`), so exits never tracked and slots stayed full |
| v2 | fix: `justBought` set shields same-batch buys from housekeeping | -0.314 | -0.031 | 0.032 | 332 | 156 | 39.5% | compliant; beats sniper (-0.468) |
| v3 | exits tighter: TP 8/20, trail 6, SL -8 (note: v3 first run was a no-op — exits used hardcoded literals, not the constants; fixed by wiring exits to BPS constants) | -0.255 | -0.025 | 0.026 | 333 | 156 | 34.9% | better than v2 |
| v4 | exits tighter still: TP 5/12, trail 4, SL -6 | -0.294 | -0.029 | 0.029 | 331 | 156 | 33.7% | worse than v3 — optimum near v3 |
| v5 | entry stricter: min 3 buyers, 4 buy trades (exits back to v3) | -0.162 | -0.016 | 0.019 | 256 | 118 | 36.6% | big gain from stricter entry |
| v6 | entry stricter: min 4 buyers, 5 buy trades | -0.043 | -0.004 | 0.009 | 164 | 76 | 42.2% | near breakeven, but 76 dev mints → ~19 in 6 h final window: guardrail risk |
| v7 | entry stricter: min 5 buyers, 6 buy trades | +0.018 | +0.002 | 0.006 | 128 | 58 | 48.4% | POSITIVE, beats hold-cash — but 58 dev mints → ~14 in final window, BELOW the 20-mint guardrail. Not submittable as-is |
| v8 | tiered sizing on v5 entry: strict tier (5/6) 0.12 SOL, base 0.04 SOL | -0.115 | -0.012 | 0.015 | 256 | 118 | 40.0% | better than v5, keeps 118 mints |
| v9 | tiered 0.02 base / 0.20 strict | -0.054 | -0.005 | 0.010 | 256 | 118 | 46.0% | better — shrink base, grow strict |
| v10 | tiered 0.01 base / 0.25 strict | -0.024 | -0.002 | 0.007 | 256 | 118 | 57.2% | best safe config so far |
| v11 | strict 0.40 (base 0.01) | -0.024 | -0.002 | 0.007 | 256 | 118 | 57.2% | identical to v10: the 1%-of-reserve cap binds, not the stake |
| v12 | strict tier may enter up to age 20 (base stays 8) | -0.024 | -0.002 | 0.007 | 256 | 118 | 57.2% | no change — strict coins already pass by age 8 |
| v13 | one add-on buy for strict winners at +15% | -0.024 | -0.002 | 0.007 | 256 | 118 | 57.2% | no change — TP-half at +8% always fires first, add was blocked by `tookHalf` |
| v14 | add-on at +5%, allowed after take-half | -0.063 | -0.006 | 0.011 | 266 | 118 | 65.4% | worse — adding into noise retracements loses. Add-on reverted |
| v15 | SL -6% (from -8%) | -0.059 | -0.006 | 0.007 | 255 | 118 | 53.9% | worse — SL back to -8% |
| v16 | max runup +50% → +20% | -0.017 | -0.002 | 0.002 | 52 | 25 | 84.1% | slightly better PnL but only 25 mints → ~6 in final window. REJECTED on guardrail risk; runup back to +50% |
| v17 | TP rest +25%, trail 8% (from 20%/6%) | -0.023 | -0.002 | 0.007 | 258 | 118 | 57.0% | ≈ v10 (+0.0004 SOL). FINAL candidate |
| v18 | base tier gets fast exits (TP 6/12, trail 5, SL -4, hold 60) to cut its bleed | -0.023 | -0.002 | 0.007 | 258 | 118 | 57.0% | IDENTICAL to v17 — base coins exit via dev-sell/big-sell, not TP/SL. Kept (same behavior, documented intent). FINAL |

## Stress (grade-local --stress 20, v17; --stress-jobs 2, ~22 min)

- Median −0.094 SOL, p10 −0.156 SOL, p90 +0.008 SOL; 17/20 copies below zero; 0 failed; dev rank 17/20; warning "half or more of the rebuilt copies lost money".
- Honest read: the dev score (−0.023) is a better-than-median draw; on resampled windows this bot typically loses ~0.09 SOL. No baseline does better (sniper dev −0.468, reversion −3.887, momentum −9.460), and the final window is one unseen draw — the entry's edge is relative to the field, not an absolute profit guarantee.
- Tier split (dev, from per_token realized PnL): strict tier +0.0185 SOL over ~74 coins (22 winners); base tier −0.0419 SOL over ~46 coins (5 winners). The base tier is guardrail insurance: it buys ~12 extra expected mints in the 6 h final window (118 dev mints over 24 h → ~29 expected final vs ~14 for strict-only), keeping the 20-mint guardrail safe.

## Final config (v17)

- Entry: age ≤ 8 slots (strict tier ≤ 20), creator not sold, creator buys ≤ 1 SOL, ≥ 3 distinct non-creator buyers, ≥ 4 buy trades, sells ≤ 25% of buys, no single sell ≥ 20% of real reserve, real SOL 0.2–25, runup −5%…+50% vs create price.
- Sizing: strict tier (≥ 5 buyers, ≥ 6 buy trades) 0.25 SOL, base 0.01 SOL; both capped at 1% of real reserve (cap binds first on most coins); max 5 open, max 2 new entries per batch.
- Exits: take half +8%, rest +25%, trail 8% after first take-profit, stop −8%, max hold 150 slots, stale 90 slots, creator-sell / big-sell (≥ 25% of reserve) eject.
- Dev: net PnL −0.023 SOL, return −0.0023, max DD 0.0073, 258 fills, 118 distinct mints, 118 round trips, compliant. Still slightly negative on dev — the dev window's strict subset is the only profitable slice, and the base tier is guardrail insurance (~0.04 SOL) for the unseen 6-hour final window.

## Submission status (25 Nov 2026)

- Repo: https://github.com/rwnliwan/pumpfun-bot-sprint (public, created 2026-11-25T02:42:50Z, after opening; default branch `main`; About: homepage = bounty page, topics makefun/ai-agents/bounties — verified via `gh api`).
- HEAD pushed: `9e87152e7c59440abf5f905e6c6aee023a8509c9` (= ls-remote). Tree clean. README: 3 live make.fun badges, 0 shields.io. `.makefun/owner.json` committed (wallet `FwUebjzYUBF6uybmEkUkiQf9z35bGGQuUE3GrToXFcUq`).
- Bundle v1: `~/workspace/make-fun/marathon-pumpfun/pumpfun-bot-sprint-bundle-v1.tar.gz`, 244,477 B, sha256 `b6a7bf0ab44be78b65c4555f15319d03f1a406195de05f1b3a648cfad5133949` — **0 usage rows attached** (builder subagent session still running; rows flush only when the run ends).
- Check v1: **14 passed / 1 failed / 4 skipped** — only `thinking_priced` fails (0 usage rows). `thinking_reproduces` 88.4%, `thinking_revised` pass.
- NOT YET SUBMITTED. Next step (koordinator, after this builder run ends): re-bundle from the ORIGINAL session file `~/agents/agent-3c60bbf7-0346-43e7-a5a0-df1c4ecb3673/sessions/3c60bbf7-0346-43e7-a5a0-df1c4ecb3673.jsonl` with `--muse-usage` from the muse.db SELECT for agent_ids `3c60bbf7-0346-43e7-a5a0-df1c4ecb3673` (builder) + `8fbcd08d-9925-4645-901c-5dd73786f11c` (koordinator), same `--prompt-file ~/workspace/make-fun/marathon-pumpfun/prompt.txt --prompt-origin other --prompt-via "whatsapp"` flags; expect "≥1 usage row attached"; re-check (expect 14/0 or 15/0); then submit with the new bundle + `--commit <full HEAD sha>` (no `--play-code`); on clean 202 write claim-codes + Drive backup, then report.
