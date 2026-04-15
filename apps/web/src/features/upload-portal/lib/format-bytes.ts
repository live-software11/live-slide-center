export function formatBytes(bytes: number | null | undefined, locale = 'it-IT'): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2,
  });
  return `${formatter.format(value)} ${units[i]}`;
}
