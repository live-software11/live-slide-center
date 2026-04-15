/** URL assoluto `/u/:token` per il portale relatore (solo contesto browser). */
export function getUploadPortalAbsoluteUrl(uploadToken: string): string {
  const path = `/u/${encodeURIComponent(uploadToken)}`;
  if (typeof globalThis !== 'undefined' && globalThis.location?.origin) {
    return `${globalThis.location.origin}${path}`;
  }
  return path;
}
