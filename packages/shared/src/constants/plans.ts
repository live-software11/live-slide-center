export type TenantPlan = 'trial' | 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  storageLimitBytes: number;
  maxEventsPerMonth: number;
  maxRoomsPerEvent: number;
  maxAgentsPerEvent: number;
  maxUsersPerTenant: number;
  /** Limite dimensione singolo file; -1 = illimitato (Enterprise). */
  maxFileSizeBytes: number;
}

export const TENANT_PLANS: TenantPlan[] = ['trial', 'starter', 'pro', 'enterprise'];

/** Allineato a `docs/GUIDA_DEFINITIVA_PROGETTO.md` §12 — non modificare senza aggiornare la guida. */
export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  trial: {
    storageLimitBytes: 5 * 1024 ** 3,
    maxEventsPerMonth: 2,
    maxRoomsPerEvent: 3,
    /** Trial: 1 Local Agent per evento (tabella §12 guida; allineare DB/quote se si cambia). */
    maxAgentsPerEvent: 1,
    maxUsersPerTenant: 3,
    maxFileSizeBytes: 100 * 1024 ** 2,
  },
  starter: {
    storageLimitBytes: 100 * 1024 ** 3,
    maxEventsPerMonth: 5,
    maxRoomsPerEvent: 10,
    maxAgentsPerEvent: 3,
    maxUsersPerTenant: 10,
    maxFileSizeBytes: 1 * 1024 ** 3,
  },
  pro: {
    storageLimitBytes: 1024 * 1024 ** 3,
    maxEventsPerMonth: 20,
    maxRoomsPerEvent: 20,
    maxAgentsPerEvent: 10,
    maxUsersPerTenant: 50,
    maxFileSizeBytes: 2 * 1024 ** 3,
  },
  enterprise: {
    storageLimitBytes: -1,
    maxEventsPerMonth: -1,
    maxRoomsPerEvent: -1,
    maxAgentsPerEvent: -1,
    maxUsersPerTenant: -1,
    maxFileSizeBytes: -1,
  },
};
