# Real Library Benchmark

Date: 2026-06-01

This page records one reproducible real-library benchmark used to check Lyne's
local scan speed and resource profile. It is evidence for this corpus, not a
blanket claim for every disk, cache state, tag shape, or remote source.

## Corpus

The benchmark used a real local music library supplied by the project owner.
Only aggregate metrics are recorded here.

| Metric | Value |
| --- | ---: |
| Supported files | 594 |
| Total size | 23.14 GB |
| FLAC files | 548 |
| MP3 files | 46 |

## Lyne Worker Matrix

Command shape:

```powershell
cd apps/desktop
npm run perf:real-library-benchmark -- --root "<music-dir>" --max-wait-ms 900000 --poll-ms 250 --sample-ms 250 --scan-workers <1|2|4|8>
```

The app default is `2` scan workers.

| Workers | Scan elapsed | Indexed files | CPU seconds | Peak CPU | Peak RSS |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.234 s | 593 | 2.090 s | 7.372% | 33.57 MB |
| 2 | 1.180 s | 593 | 1.910 s | 13.992% | 33.12 MB |
| 4 | 0.971 s | 593 | 1.950 s | 11.106% | 33.31 MB |
| 8 | 0.964 s | 593 | 2.140 s | 11.616% | 32.57 MB |

Interpretation:

- `2` workers is the default and the best balanced setting in this run.
- `4` and `8` workers are slightly faster, but the incremental gain over `2`
  workers is small.
- Peak memory stays flat across worker counts.

## SPlayer Native Scanner Baseline

Command shape:

```powershell
cd apps/desktop
npm run perf:splayer-library-benchmark -- --root "<music-dir>" --sample-ms 250
```

This calls SPlayer's installed native `tools.node` scanner directly and writes
into a benchmark-side SQLite database. It is not full SPlayer UI automation.

| Metric | Value |
| --- | ---: |
| Scan elapsed | 2.175 s |
| Indexed files | 590 |
| CPU seconds | 17.876 s |
| Peak CPU | 58.462% |
| Peak RSS | 93.22 MB |

## Current Takeaway

On this warm-cache corpus, Lyne's default 2-worker scan indexed more files than
the SPlayer native scanner baseline while finishing faster and using less memory
and CPU. The result is promising, but still scoped: it does not prove cold-cache
behavior, WebDAV scans, every malformed-tag corpus, or human-verified cover and
lyric accuracy.
