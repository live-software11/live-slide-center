-- Fase 8 Super-Admin: sospensione organizzazione (blocco accesso tenant lato app + audit trail consigliato)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.suspended IS 'When true, tenant users cannot use the product UI (enforced in app + login); super_admin unaffected.';
