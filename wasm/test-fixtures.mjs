// Deterministic test keys and synthetic UTXOs are confined to this test helper.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
export function blake(bytes, length) {
  return Buffer.from(
    execFileSync(
      "python3",
      [
        "-B",
        "-c",
        `import sys,hashlib;sys.stdout.buffer.write(hashlib.blake2b(sys.stdin.buffer.read(),digest_size=${length}).digest())`,
      ],
      { input: bytes },
    ),
  );
}
export function encode(value) {
  const head = (major, n) => {
    n = BigInt(n);
    if (n < 24n) return Buffer.from([major * 32 + Number(n)]);
    const size = n <= 255n ? 1 : n <= 65535n ? 2 : n <= 4294967295n ? 4 : 8;
    const b = Buffer.alloc(size + 1);
    b[0] = major * 32 + { 1: 24, 2: 25, 4: 26, 8: 27 }[size];
    for (let i = size; i > 0; i--) {
      b[i] = Number(n & 255n);
      n >>= 8n;
    }
    return b;
  };
  if (value === null) return Buffer.from([0xf6]);
  if (typeof value === "boolean") return Buffer.from([value ? 0xf5 : 0xf4]);
  if (typeof value === "number" || typeof value === "bigint")
    return value < 0 ? head(1, -1n - BigInt(value)) : head(0, value);
  if (Buffer.isBuffer(value))
    return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") {
    const b = Buffer.from(value);
    return Buffer.concat([head(3, b.length), b]);
  }
  if (Array.isArray(value))
    return Buffer.concat([head(4, value.length), ...value.map(encode)]);
  if (value instanceof Map)
    return Buffer.concat([
      head(5, value.size),
      ...[...value].flatMap(([k, v]) => [encode(k), encode(v)]),
    ]);
  throw new Error("Unsupported fixture CBOR value");
}
export const hex = (value) => encode(value).toString("hex");
function key(n) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.alloc(32, n),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  return { privateKey, publicKey, hash: blake(publicKey, 28) };
}
export const payment = key(1),
  stake = key(2);
export const changeAddress = Buffer.concat([
  Buffer.from([0]),
  payment.hash,
  stake.hash,
]).toString("hex");
export const rewardAddress = Buffer.concat([
  Buffer.from([0xe0]),
  stake.hash,
]).toString("hex");
export const policy = blake(
  Buffer.concat([Buffer.from([0]), encode([0, payment.hash])]),
  28,
).toString("hex");
export const script = {
  language: "Native",
  nativeScript: { type: "sig", keyHash: payment.hash.toString("hex") },
};
export const refs = [
  "11".repeat(32) + "#0",
  "22".repeat(32) + "#0",
  "33".repeat(32) + "#0",
];
export function utxo(ref, amount, assets) {
  const [hash, index] = ref.split("#");
  return hex([
    [Buffer.from(hash, "hex"), Number(index)],
    [
      Buffer.from(changeAddress, "hex"),
      assets
        ? [
            amount,
            new Map([
              [
                Buffer.from(policy, "hex"),
                new Map([[Buffer.from("Token"), assets]]),
              ],
            ]),
          ]
        : amount,
    ],
  ]);
}
export const wallet = {
  networkId: 0,
  changeAddress,
  utxos: [
    utxo(refs[0], 80000000n, 10n),
    utxo(refs[1], 20000000n),
    utxo(refs[2], 10000000n),
  ],
  collateral: [],
  rewardAddresses: [rewardAddress],
};
export function witnessSet(txid) {
  return hex(
    new Map([
      [
        0,
        [payment].map((key) => [
          key.publicKey,
          sign(null, Buffer.from(txid, "hex"), key.privateKey),
        ]),
      ],
    ]),
  );
}
