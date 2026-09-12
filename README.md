# sc-tools WASM build recipe

A standalone set of patches and scripts for building upstream
[sc-tools](https://github.com/input-output-hk/sc-tools) into WebAssembly.
The build fetches revision `4546122230491db4839a4a42fc2bc601f7900909` into
the ignored `wasm/vendor/sc-tools/` dependency directory.

```sh
bash wasm/build.sh
```

To reuse an installed GHC WASM toolchain:

```sh
GHC_WASM_PREFIX=/path/to/ghc-wasm bash wasm/build.sh
```

- `wasm/patches/`: dependency patches for WASM32.
- `wasm/dependencies.json`: pinned upstream sources and checksums.
- `wasm/prepare-dependencies.py`, `wasm/build.sh`: fetch, patch, and compile.
- `cabal.wasm.project`: browser build configuration.
- `wasm/app/`, `browser/`: minimal contract and browser balancing example.
- `wasm/check-browser.mjs`: offline browser verification.

Downloaded sources, the toolchain, build caches, and generated WASM artifacts
are ignored. The generated binary is `wasm/sc-tools.wasm`.

See [build and browser instructions](wasm/README.md) and
[porting notes](wasm/PORTING.md).
