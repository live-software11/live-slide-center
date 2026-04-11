export type TenantPlan = 'trial' | 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  storageLimitBytes: number;
  maxEventsPerMonth: number;
  maxRoomsPerEvent: number;
  maxAgentsPerEvent: number;
  maxUsersPerTenant: number;
}

export const TENANT_PLANS: TenantPlan[] = ['trial', 'starter', 'pro', 'enterprise'];

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  trial: {
    storageLimitBytes: 5 * 1024 ** 3,
    maxEventsPerMonth: 2,
    maxRoomsPerEvent: 3,
    maxAgentsPerEvent: 3,
    maxUsersPerTenant: 3,
  },
  starter: {
    storageLimitBytes: 50 * 1024 ** 3,
    maxEventsPerMonth: 10,
    maxRoomsPerEvent: 10,
    maxAgentsPerEvent: 10,
    maxUsersPerTenant: 10,
  },
  pro: {
    storageLimitBytes: 200 * 1024 ** 3,
    maxEventsPerMonth: 50,
    maxRoomsPerEvent: 30,
    maxAgentsPerEvent: 30,
    maxUsersPerTenant: 50,
  },
  enterprise: {
    storageLimitBytes: 1024 * 1024 ** 3,
    maxEventsPerMonth: -1,
    maxRoomsPerEvent: -1,
    maxAgentsPerEvent: -1,
    maxUsersPerTenant: -1,
  },
};
