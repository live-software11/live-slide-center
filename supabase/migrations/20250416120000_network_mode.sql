-- Fase 7 (Dual-Mode) — Aggiunta colonna network_mode alla tabella events.
-- Valori possibili:
--   cloud    : default. Ogni PC sala usa internet. Download diretto da Supabase Storage via PWA.
--   intranet : rete locale gestita (router Andrea). Files serviti da Local Agent + Room Agent.
--   hybrid   : coesistenza — PWA cloud con fallback su Local Agent se raggiungibile.
CREATE TYPE public.network_mode AS ENUM ('cloud', 'intranet', 'hybrid');
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS network_mode public.network_mode NOT NULL DEFAULT 'cloud';
COMMENT ON COLUMN public.events.network_mode IS 'Modalita rete per distribuzione file: cloud (Supabase Storage + PWA), intranet (Local Agent LAN), hybrid (LAN con fallback cloud).';
