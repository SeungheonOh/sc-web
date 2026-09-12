# sc-tools in a browser

This standalone build recipe targets sc-tools revision
`4546122230491db4839a4a42fc2bc601f7900909`. The preparation script fetches upstream
sc-tools into ignored `wasm/vendor/sc-tools/`; no upstream checkout or Git
history is part of the recipe's source tree.
The browser application runs a GHC-compiled WASI executable in a Web Worker.
JavaScript supplies the form, an in-memory WASI environment, and result display.
The transaction logic is in `app/Main.hs`.

The demo constructs a Plutus V2 validator in WASM, locks ADA with an integer
datum, and attempts to spend that output using an integer redeemer. The validator
accepts exactly when the integers match. `app/MatchingNumber.hs` constructs the
UPLC program and serializes it inside the browser; no prebuilt transaction is
embedded in the page.

For both transactions the executable calls:

1. `Convex.BuildTx.execBuildTx` with the sc-tools lock/spend helpers.
2. `Convex.MockChain.CoinSelection.tryBalanceAndSubmit`.
3. Through that API, `Convex.CoinSelection.balanceForWalletReturn`, coin
   selection, `balanceTransactionBody`, and Cardano's execution-unit and fee
   calculations.
4. Cardano signing and the sc-tools mockchain's Cardano ledger validation.

The mockchain replaces network state and network submission with a local test
ledger. It does not replace the transaction builder, balancer, script evaluator,
or transaction serialization. Each scenario starts with deterministic test wallets
and fresh state. The transactions spend synthetic inputs and cannot be submitted
to an actual Cardano network.

## Scope

The selected libraries are `convex-base`, `convex-optics`, `convex-wallet`,
`convex-mockchain`, and `convex-coin-selection`. Node CLI programs, hosted API
clients, and database management tools are outside the browser target. The
upstream native `cabal.project` stays inside the fetched dependency;
`cabal.wasm.project` selects only the libraries needed here.

## Build from source

On Linux, install Git, Python 3.12+, curl, patch, autoconf, automake, make,
Perl, and the archive utilities required by ghc-wasm-meta. Then run:

```sh
npm run build:wasm
```

The script installs the pinned GHC WASM toolchain under `.wasm-toolchain/`,
fetches and patches the dependencies, builds the executable, and writes
`wasm/sc-tools.wasm`, `browser/sc-tools.wasm.gz`, and its size/hash manifest. Initial compilation is
substantial because it includes the Cardano ledger. To reuse a toolchain:

```sh
GHC_WASM_PREFIX=/path/to/ghc-wasm BUILD_JOBS=4 npm run build:wasm
```

See [PORTING.md](PORTING.md) for changes needed for WASM32. The source manifest
and patches are tracked; downloaded dependencies and build products are ignored.

## Browser execution

The static `browser/` directory needs an HTTP server to load its worker and WASM
asset. The server only sends static files. Runtime execution does not call it.

```sh
npm run serve
```

Open `http://127.0.0.1:4173`. The compressed executable is decompressed and compiled
once per worker. Each run instantiates a new WASM instance with an in-memory
filesystem. The UI shows fees, selected inputs, serialized signed transactions,
and the events emitted by sc-tools' own balancing tracer.

## Verification

```sh
npm ci
CHROMIUM_PATH=/path/to/chrome npm run test:browser
```

The browser test loads the executable and disables networking **before** asking
the browser to build any transactions. It checks successful locking/spending,
wrong-redeemer rejection, changed inputs, insufficient funds, minimum output
value, deterministic reruns, and absence of transaction-time network requests.
It also checks 64-bit saturating budgets, CBOR round trips, and Plutus operations
with indices and shift amounts above the 32-bit limit inside the same WASM module.
Evidence is written under `wasm/evidence/`.

The recorded Chromium 151 run passed all seven scenarios and all 12 portability
checks with networking disabled. The initial 10 ADA / datum 42 / redeemer 42
scenario took about 255 ms after loading the module; subsequent successful runs
took about 139–139 ms on the test machine. These are observations, not guarantees
for other devices.

| Transaction | Signed CBOR size | Fee |
| --- | ---: | ---: |
| Lock 10 ADA | 268 bytes | 171,749 lovelace |
| Redeem with 42 | 369 bytes | 174,466 lovelace |

The spending script used 601,970 CPU steps and 2,866 memory units. The module
imports only `wasi_snapshot_preview1`; the recorded run made zero transaction-time
network requests and reported no browser errors. A copy of the recorded report
is generated under `evidence/browser-results.json` when the tests run.

## Runtime dependencies

The browser WASI shim is `@bjorn3/browser_wasi_shim` 0.4.2, vendored in
`browser/vendor/wasi/` with its licenses. No JavaScript Cardano SDK implements
balancing or transaction construction in this demo.
