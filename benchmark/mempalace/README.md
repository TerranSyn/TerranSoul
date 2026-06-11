# Reference system: MemPalace

**Project:** Published memory system in the agent-memory comparison space.
**Status in TerranSoul bench:** reference numbers only (no local re-run).

## LongMemEval-S — published

| Metric | MemPalace (published) | TerranSoul (BENCH-AM-6/6.1) |
|---|---|---|
| R@5 | ~96.6 % | **99.2 %** |
| R@10 | — | **99.6 %** |
| R@20 | — | **100.0 %** |
| NDCG@10 | — | **91.3 %** |
| MRR | — | **92.6 %** |

TerranSoul leads MemPalace on R@5 by ~2.6 pp on the cleaned LongMemEval-S retrieval slice.

## Notes

- MemPalace publishes a subset of metrics on their LongMemEval table; only the comparable cells are mirrored here.
- The full TerranSoul comparison narrative against MemPalace and other memory systems lives in [../../docs/agentmemory-comparison.md](../../docs/agentmemory-comparison.md) and the cross-system results matrix in [../COMPARISON.md](../COMPARISON.md).

Attribution: [CREDITS.md](../../CREDITS.md).
