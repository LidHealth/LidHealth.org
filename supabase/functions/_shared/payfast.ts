import CryptoJS from "npm:crypto-js@4.2.0";

export type PayFastFields = Record<string, string>;

function encodeValue(value: string): string {
  return new URLSearchParams([["value", value]]).toString().slice(6);
}

export function payFastSignature(
  entries: Iterable<[string, string]>,
  passphrase: string,
): string {
  const parameters = Array.from(entries)
    .filter(([key]) => key !== "signature")
    .map(([key, value]) => `${key}=${encodeValue(value.trim())}`);
  if (passphrase) {
    parameters.push(`passphrase=${encodeValue(passphrase.trim())}`);
  }
  return CryptoJS.MD5(parameters.join("&")).toString(CryptoJS.enc.Hex);
}

export function addPayFastSignature(
  fields: PayFastFields,
  passphrase: string,
): PayFastFields {
  return {
    ...fields,
    signature: payFastSignature(Object.entries(fields), passphrase),
  };
}

export function payFastBaseUrl(): string {
  return Deno.env.get("PAYFAST_SANDBOX") === "false"
    ? "https://www.payfast.co.za"
    : "https://sandbox.payfast.co.za";
}
