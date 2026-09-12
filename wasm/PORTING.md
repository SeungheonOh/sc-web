# Port notes

This standalone recipe fetches and links the original sc-tools library sources at
`4546122230491db4839a4a42fc2bc601f7900909`. It uses Cardano API 11.0.0.0,
Plutus 1.63.0.0, and GHC WASM 9.12.4.20260731. The separate Cabal project
selects the transaction, coin-selection, wallet, optics, and mockchain libraries
from the ignored `vendor/sc-tools/` dependency directory.

`dependencies.json` records source archive hashes or immutable Git revisions.
`patches/` contains the differences applied to those sources, including Cabal
metadata revisions. `prepare-dependencies.py` checks downloads, applies patches,
and refuses to overwrite a dependency with conflicting local modifications.

| Area | Change and reason |
| --- | --- |
| Plutus budgets | `SatInt` stores `Int64`. Arithmetic saturates at 64-bit bounds on WASM32. Ledger execution budgets exceed the signed 32-bit range. |
| Plutus builtins | Integer denotations that were native `Int` use `Int64`. Byte-array indexing narrows only after range checks or saturation. Bit operations preserve 64-bit indices and shift/rotate amounts. |
| Plutus examples | Example builtin denotations use explicit `Int64`/`Word64`, matching the native 64-bit meaning. No failing placeholder builtin instances are added. |
| Cryptography | Link portable sodium, blst, and secp256k1 C packages. Correct C/Haskell return signatures for Curve25519, Curve448, Ed25519, wallet initialization, and VRF conversion functions. WebAssembly validates function signatures strictly. |
| VRF | A four-limb C scalar buffer uses `unsigned long long`, retaining the required 32-byte size on WASM32. Certificate ordering compares serialized proof bytes as required by the selected crypto-class API. |
| Foundation | Use WASI memory-map emulation, little-endian configuration, WASI secure randomness, and clock wrappers. Native socket bindings are excluded from this package's WASM build. |
| Other portable dependencies | Use pinned WASM-compatible basement, network, cborg, ram, memory, cryptonite, and double-conversion sources/patches. Disable Argon2 native threading in crypton. |
| CBOR compatibility | Restore the `decodeWithByteSpan` tuple interface expected by the selected Cardano packages, using the decoder's byte offsets. |
| Build graph | Exclude native database tools and unrelated test/executable components from the vendored API/consensus package descriptions. Retain the libraries needed by the actual builder and local ledger. |
| GHC compatibility | Add required KES size constraints and match the heap-size C helper's 64-bit return type. |
| API compatibility | Use the crypto package's public BLS proof-of-possession context and disambiguate the ledger's `ByteSpan` type from the newer CBOR export. |

The Web Worker provides only WASI system calls and an in-memory filesystem.
It does not implement Cardano operations. Every scenario creates a fresh WASM
instance and a fresh sc-tools mockchain. Cryptographic signing, Plutus execution,
coin selection, fees, balancing, transaction construction, CBOR serialization,
and ledger acceptance run inside that instance.

This is a browser port demonstrated against a local Conway test ledger. It is
not a complete port of the repository's node services or database tools, and
the test transactions reference synthetic UTXOs. The included checks exercise
the demo and specific integer-width regressions; they are not a full Cardano
conformance suite.
