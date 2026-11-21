# csv-reader-speed-01-run-20261121

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/asfel307/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/asfel307/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: it reads broken CSV
files and returns exactly csv-reader's `{columns, rows, errors}` for every
input, in less CPU time.

## How it is faster

No field is ever built one character at a time. A record with no quote and
no CR in it is one slice split on commas, natively. An unquoted field is
found with two native `indexOf` scans (next comma, next LF) and its slice
is the value, unless it holds a stray CR. A quoted field is found with
native `indexOf` scans for its closing quote (skipping `""` pairs) and its
slice is the value, unless it holds a line break, a lone CR or an escaped
quote. Only the rare broken fields take a fix-up path, and line numbers
inside quotes are counted from the slice, so an unterminated quote costs
nothing to abandon.

## Files

- `solve.js` — ES module exporting `run(input)`, the fast reader.
- `main.ts` — the harness driver: reads `/input/cases.json` (or
  `MAKEFUN_INPUT_DIR`), answers each case with `run`, writes
  `/output/answers.json` (or `MAKEFUN_OUTPUT_DIR`) with `JSON.stringify`.
  It turns V8's incremental marking off before importing `solve.js`.
- `LICENSE` — MIT.

## Run

```sh
node main.ts
```
