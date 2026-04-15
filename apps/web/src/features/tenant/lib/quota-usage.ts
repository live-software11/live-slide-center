import type { Database } from '@slidecenter/shared';

type TenantPlan = Database['public']['Enums']['tenant_plan'];

export function currentYearMonthLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function countEventsWithStartInYearMonth(
  events: readonly { start_date: string }[],
  yearMonth: string,
): number {
  return events.filter((e) => e.start_date.slice(0, 7) === yearMonth).length;
}

export function isUnlimitedEventsPerMonth(plan: TenantPlan, maxEventsPerMonth: number): boolean {
  return plan === 'enterprise' || maxEventsPerMonth <= 0;
}

export function isUnlimitedRoomsPerEvent(plan: TenantPlan, maxRoomsPerEvent: number): boolean {
  return plan === 'enterprise' || maxRoomsPerEvent <= 0;
}

export function isUnlimitedStorage(plan: TenantPlan, storageLimitBytes: number): boolean {
  return plan === 'enterprise' || storageLimitBytes <= 0;
}

export function storageUsageRatio(used: number, limit: number): number {
  if (!Number.isFinite(used) || used <= 0) return 0;
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(100, (used / limit) * 100);
}
