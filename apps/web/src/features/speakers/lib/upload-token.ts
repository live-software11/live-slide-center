function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Token opaco (128 bit hex) per `speakers.upload_token`; collisione trascurabile. */
export function generateSpeakerUploadToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Scadenza predefinita portale upload (90 giorni da ora, UTC). */
export function defaultUploadTokenExpiresAtIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 90);
  return d.toISOString();
}
