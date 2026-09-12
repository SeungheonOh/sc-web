export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function ada(value) {
  const n = BigInt(value ?? 0),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${(a / 1000000n).toLocaleString("en-US")}.${(a % 1000000n).toString().padStart(6, "0")}`;
}
export function integer(value) {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return String(value ?? "");
  }
}
export function textFromHex(hex) {
  if (!/^(?:[\da-f]{2})*$/i.test(hex)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16)),
    );
    return /[\u0000-\u001f\u007f-\u009f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}
export const hexFromText = (text) =>
  [...new TextEncoder().encode(text)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export const assetName = (hex) =>
  hex === "" ? "(empty name)" : (textFromHex(hex) ?? `Hex ${hex}`);
