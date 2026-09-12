// Read-only CBOR decoding for review. Transaction construction stays in sc-tools WASM.
export function decodeCbor(hex) {
  if (!/^(?:[\da-f]{2})+$/i.test(hex)) throw new Error("Invalid CBOR hex.");
  const bytes = Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
  let offset = 0;
  const byte = () => {
    if (offset >= bytes.length) throw new Error("Truncated CBOR.");
    return bytes[offset++];
  };
  const take = (n) => {
    if (n > BigInt(bytes.length - offset))
      throw new Error("Truncated CBOR bytes.");
    const result = bytes.slice(offset, offset + Number(n));
    offset += Number(n);
    return result;
  };
  function read(depth = 0) {
    if (depth > 100) throw new Error("CBOR nesting exceeds viewer limit.");
    const initial = byte(),
      major = initial >> 5,
      info = initial & 31;
    let length = BigInt(info);
    if (info >= 24 && info <= 27) {
      length = 0n;
      for (let i = 0; i < 2 ** (info - 24); i++)
        length = (length << 8n) | BigInt(byte());
    } else if (info > 27 && info !== 31)
      throw new Error("Invalid CBOR header.");
    const indefinite = info === 31;
    if (indefinite && ![2, 3, 4, 5].includes(major))
      throw new Error("Invalid indefinite CBOR.");
    if (major === 0) return length;
    if (major === 1) return -1n - length;
    if (major === 2 || major === 3) {
      if (!indefinite) {
        const value = take(length);
        return major === 2
          ? value
          : new TextDecoder("utf-8", { fatal: true }).decode(value);
      }
      const parts = [];
      while (bytes[offset] !== 255) {
        const part = read(depth + 1);
        if (
          (major === 2 && !(part instanceof Uint8Array)) ||
          (major === 3 && typeof part !== "string")
        )
          throw new Error("Invalid CBOR string chunk.");
        parts.push(part);
      }
      byte();
      if (major === 3) return parts.join("");
      const value = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let i = 0;
      for (const part of parts) {
        value.set(part, i);
        i += part.length;
      }
      return value;
    }
    if (major === 4 || major === 5) {
      const values = major === 4 ? [] : new Map();
      if (!indefinite && length > BigInt(bytes.length))
        throw new Error("Invalid CBOR collection length.");
      for (let i = 0n; indefinite ? bytes[offset] !== 255 : i < length; i++) {
        const value = read(depth + 1);
        if (major === 4) values.push(value);
        else values.set(value, read(depth + 1));
      }
      if (indefinite) byte();
      return values;
    }
    if (major === 6) {
      const value = read(depth + 1);
      if ((length === 2n || length === 3n) && value instanceof Uint8Array) {
        let n = 0n;
        for (const b of value) n = (n << 8n) | BigInt(b);
        return length === 2n ? n : -1n - n;
      }
      return { cborTag: length, value };
    }
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return { simple: "undefined" };
      if (info === 25) {
        const n = Number(length),
          sign = n & 32768 ? -1 : 1,
          exponent = (n >> 10) & 31,
          fraction = n & 1023;
        return (
          sign *
          (exponent === 31
            ? fraction
              ? NaN
              : Infinity
            : exponent === 0
              ? fraction * 2 ** -24
              : (1 + fraction / 1024) * 2 ** (exponent - 15))
        );
      }
      if (info === 26 || info === 27) {
        const size = info === 26 ? 4 : 8,
          buffer = new ArrayBuffer(size),
          view = new DataView(buffer);
        let n = length;
        for (let i = size - 1; i >= 0; i--) {
          view.setUint8(i, Number(n & 255n));
          n >>= 8n;
        }
        return size === 4 ? view.getFloat32(0) : view.getFloat64(0);
      }
      return { simple: length };
    }
    throw new Error("Unsupported CBOR.");
  }
  const value = read();
  if (offset !== bytes.length) throw new Error("Trailing bytes after CBOR.");
  return value;
}
export const bodyFields = {
  0: "Inputs",
  1: "Outputs",
  2: "Fee",
  3: "Validity upper bound",
  4: "Certificates",
  5: "Withdrawals",
  6: "Update",
  7: "Auxiliary data hash",
  8: "Validity lower bound",
  9: "Mint / burn",
  11: "Script data hash",
  13: "Collateral inputs",
  14: "Required signers",
  15: "Network ID",
  16: "Collateral return",
  17: "Total collateral",
  18: "Reference inputs",
  19: "Voting procedures",
  20: "Proposal procedures",
  21: "Current treasury value",
  22: "Treasury donation",
};
export const witnessFields = {
  0: "Verification key witnesses",
  1: "Native scripts",
  2: "Bootstrap witnesses",
  3: "Plutus V1 scripts",
  4: "Datums",
  5: "Redeemers",
  6: "Plutus V2 scripts",
  7: "Plutus V3 scripts",
};
export function namedMap(value, labels) {
  return value instanceof Map
    ? Object.fromEntries(
        [...value].map(([key, v]) => [
          `${labels[String(key)] || "Field"} (${key})`,
          v,
        ]),
      )
    : value;
}
