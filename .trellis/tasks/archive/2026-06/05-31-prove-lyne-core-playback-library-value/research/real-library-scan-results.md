# Real Library Scan Results

Date: 2026-06-01

## Scope

The user supplied a real local music library:

```text
D:\移动云盘挂载\15869685321\Music
```

The evidence below records aggregate metrics only. It does not list private song
or folder names.

Input inventory:

| Metric | Value |
| --- | ---: |
| Supported files | 594 |
| Total size | 23,141,043,767 bytes |
| FLAC files | 548 |
| MP3 files | 46 |

## Lyne Real-Library Benchmark

Command:

```powershell
npm run perf:real-library-benchmark -- --root "D:\移动云盘挂载\15869685321\Music" --port 63894 --max-wait-ms 900000 --poll-ms 1000 --sample-ms 1000 --scan-workers 1
```

Generated outputs:

- `apps/desktop/output/lyne-evidence/real-library/library-scan-evidence.json`
- `apps/desktop/output/lyne-evidence/real-library/real-library-benchmark.json`

`apps/desktop/output/` is ignored and should not be committed.

Result: passed.

| Metric | Value |
| --- | ---: |
| Server ready time | 332.945 ms |
| Scan start latency | 34.899 ms |
| Scan elapsed | 6,097.012 ms |
| Task elapsed | 6,060.661 ms |
| Scanned files | 594 |
| Indexed files | 593 |
| Removed files | 0 |
| API readback media items | 593 |
| Approx scan rate | 97.4 files/s |
| Process CPU seconds | 1.406 s |
| Peak CPU | 2.246% of 16 logical cores |
| Peak working set | 45,170,688 bytes |
| Peak private memory | 28,856,320 bytes |

Readback summary:

| Area | Value |
| --- | ---: |
| FLAC media items | 547 |
| MP3 media items | 46 |
| Titles present | 593 / 593 |
| Artists present | 593 / 593 |
| Albums present | 589 / 593 |
| Durations present | 593 / 593 |
| Cover art present | 590 / 593 |
| Cover art missing | 3 / 593 |

The one scanned-but-not-indexed file is a zero-byte FLAC. It was identified by
aggregate metadata only: extension `flac`, size `0`, redacted relative-path hash
prefix `0c9946538016e049`. This does not look like a Lyne stability failure.

## Lyne Scan Speed Tuning Rerun

Follow-up question: whether the scan can get faster without paying much extra
CPU or memory.

Implementation change:

- The local scan worker no longer canonicalizes every discovered file on the
  hot path. The scan root has already gone through `validate_path()`, and the
  walker skips symlinks. Workers now use the walker-provided path directly for
  new scans, and only fall back to `canonicalize()` when an existing scan
  snapshot does not contain that direct path but does contain the canonical
  path. This keeps old canonical snapshots compatible while avoiding one extra
  filesystem call per file on fresh scans.
- The real-library benchmark default `--scan-workers` was aligned to the app
  default of `2`. Explicit `--scan-workers` still overrides it.
- Benchmark process monitors now wait for any in-flight sample before taking
  the final sample, so sub-second scan runs are less likely to report missing
  CPU/memory summaries.

Sequential rerun command shape:

```powershell
npm run perf:real-library-benchmark -- --root "D:\移动云盘挂载\15869685321\Music" --max-wait-ms 900000 --poll-ms 250 --sample-ms 250 --scan-workers <1|2|4|8> --output-dir output/lyne-evidence/real-library-workers-seq/w<N>
```

Generated outputs:

- `apps/desktop/output/lyne-evidence/real-library-workers-seq/w1/real-library-benchmark.json`
- `apps/desktop/output/lyne-evidence/real-library-workers-seq/w2/real-library-benchmark.json`
- `apps/desktop/output/lyne-evidence/real-library-workers-seq/w4/real-library-benchmark.json`
- `apps/desktop/output/lyne-evidence/real-library-workers-seq/w8/real-library-benchmark.json`

Result: all passed.

| Workers | Scan elapsed | Task elapsed | Indexed files | CPU seconds | Peak CPU | Peak working set |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2,234.217 ms | 2,126.550 ms | 593 | 2.090 s | 7.372% | 33.57 MB |
| 2 | 1,180.491 ms | 1,134.820 ms | 593 | 1.910 s | 13.992% | 33.12 MB |
| 4 | 971.026 ms | 915.200 ms | 593 | 1.950 s | 11.106% | 33.31 MB |
| 8 | 964.066 ms | 833.550 ms | 593 | 2.140 s | 11.616% | 32.57 MB |

Interpretation:

- The low-risk path optimization matters more than aggressive worker tuning:
  the same 1-worker corpus run improved from the earlier 6.097 s baseline to
  2.234 s in this warm-cache rerun.
- The default 2-worker setting is the best balanced recommendation. It cuts
  elapsed time roughly in half versus 1 worker on this rerun, while memory stays
  flat around 33 MB and CPU remains modest.
- 4 and 8 workers can be slightly faster on this warm local/cloud-mounted
  corpus, but the gain from 2 to 4 workers is only about 209 ms, and from 4 to 8
  workers is effectively noise. Keeping 2 as the default avoids unnecessary
  pressure on slower disks, cloud mounts, and battery systems.

SPlayer was also rerun after fixing the monitor:

```powershell
npm run perf:splayer-library-benchmark -- --root "D:\移动云盘挂载\15869685321\Music" --sample-ms 250 --output-dir output/splayer-library-baseline-rerun
```

Result: passed. SPlayer indexed 590 files in 2,175.182 ms, with 17.876 CPU
seconds, 58.462% peak CPU, and 93.22 MB peak working set.

## SPlayer Native Scanner Baseline

SPlayer was located through the installed shortcut:

```text
F:\SPlayer\SPlayer.exe
F:\SPlayer\resources\native\tools.node
```

The installed `tools.node` N-API module can be loaded directly from Node and
exports `scanMusicLibrary`. The benchmark uses that installed native scanner and
SPlayer's SQLite schema. Because the installed `better-sqlite3` package expects
Electron's packaged resolution and fails under plain Node with a missing
`bindings` module, the harness falls back to the local SPlayer source checkout's
`better-sqlite3` only for SQLite persistence.

Command:

```powershell
npm run perf:splayer-library-benchmark -- --root "D:\移动云盘挂载\15869685321\Music" --sample-ms 250
```

Generated output:

- `apps/desktop/output/splayer-library-baseline/splayer-library-benchmark.json`

Result: passed as a native scanner baseline.

| Metric | Value |
| --- | ---: |
| Scan elapsed | 1,212.393 ms |
| Scanned/progress total | 594 |
| Indexed files | 590 |
| Approx scan rate | 490.0 files/s |
| Process CPU seconds | 11.704 s |
| Peak CPU | 63.813% of 16 logical cores |
| Peak working set | 102,129,664 bytes |
| Peak private memory | 11,696,570 bytes |

Readback summary:

| Area | Value |
| --- | ---: |
| FLAC media items | 547 |
| MP3 media items | 43 |
| Titles present | 590 / 590 |
| Artists present | 590 / 590 |
| Albums present | 590 / 590 |
| Durations present | 590 / 590 |
| Cover art present | 587 / 590 |
| Cover art missing | 3 / 590 |

Important interpretation notes:

- This is not full SPlayer UI automation. It measures the installed native
  scanner plus benchmark-side SQLite writes.
- SPlayer's scanner intentionally skips files smaller than 1024 bytes and files
  whose tags cannot be read by lofty. That likely explains part of the
  594-input to 590-output gap, but private file names were not enumerated.
- SPlayer fills unknown artist/album/title defaults, so metadata presence is not
  equivalent to metadata accuracy.

## Comparison

| Area | Lyne | SPlayer native scanner |
| --- | ---: | ---: |
| Supported input files | 594 | 594 |
| Indexed media items | 593 | 590 |
| Scan elapsed | 1.180 s at default 2 workers | 2.175 s |
| Approx scan rate | 502.3 files/s | 271.2 files/s |
| Peak working set | 33.1 MB | 93.2 MB |
| CPU seconds | 1.910 s | 17.876 s |
| Peak CPU | 13.992% | 58.462% |
| Cover art present | 590 / 593 | 587 / 590 |

Verdict:

- Lyne's real-library scan is stable on this corpus and resource-frugal. It
  scans the supplied 594-file, 23.14 GB library successfully, indexes every
  non-empty supported track observed by the harness, and keeps memory modest.
- After the canonicalization hot-path fix and benchmark rerun, Lyne is faster
  than the SPlayer native scanner on this warm-cache corpus at the default
  2-worker setting, while using much less CPU and memory. This replaces the
  earlier 1-worker baseline verdict for speed.
- The speed claim should still be scoped carefully: this is one real corpus on
  one mounted local/cloud path with warm-cache effects. It does not prove all
  disks, cold cache, WebDAV, or malformed-tag corpora.
- Cover presence is strong for Lyne on this corpus, but this is still not a
  human-verified cover accuracy test.
- Lyrics remain unproven by this benchmark because neither harness checked
  expected lyrics.
