/**
 * Sprint O2 (GUIDA_OPERATIVA_v3 §4.G — UX parity cloud/offline) — sessione fittizia desktop+admin.
 *
 * Problema: la SPA in cloud richiede un `Session` Supabase per renderizzare
 * l'app autenticata (vedi `RequireAuth`). In modalita desktop il backend Rust
 * NON ha il modulo Supabase Auth (non c'e' JWT, niente login/signup), quindi
 * `supabase.auth.getSession()` restituisce sempre `null` → l'utente
 * desktop+admin verrebbe bloccato in un loop `/login` permanente.
 *
 * Soluzione: in modalita desktop+admin forniamo una sessione fittizia con i
 * dati del seed locale (`LOCAL_TENANT_ID` + `LOCAL_ADMIN_USER_ID` definiti in
 * `apps/desktop/src-tauri/src/server/db.rs`). Cosi' tutti gli hook che fanno
 * query con `tenant_id` filtrano sul tenant locale e l'app funziona end-to-end.
 *
 * Sicurezza: la session fittizia esiste SOLO in memoria del processo Tauri,
 * non viene mai inviata a Supabase cloud (in desktop il client Supabase punta
 * al backend Rust locale). L'`access_token` e' l'`admin_token` UUID generato
 * al boot, gia' usato come bearer per l'AdminAuth extractor.
 *
 * Le sale (role=sala) NON passano per qui: `DesktopRoleGate` le redirige
 * direttamente a `/sala/:token` saltando l'auth flow.
 */

import type { Session, User } from '@supabase/supabase-js';

const LOCAL_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const LOCAL_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000002';
const LOCAL_ADMIN_EMAIL = 'admin@local.slidecenter';

/**
 * Costruisce una `Session` fittizia compatibile con `RequireAuth` /
 * `useAuth()` / `getTenantIdFromSession()`. L'`access_token` viene
 * usato come bearer dal client Supabase (configurato in `supabase.ts`)
 * verso il backend Rust locale, dove l'`AdminAuth` extractor lo valida
 * via `constant_time_eq` contro il proprio `admin_token`.
 */
export function buildDesktopAdminSession(adminToken: string): Session {
  const now = Math.floor(Date.now() / 1000);
  const user: User = {
    id: LOCAL_ADMIN_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: LOCAL_ADMIN_EMAIL,
    email_confirmed_at: new Date(0).toISOString(),
    phone: '',
    confirmation_sent_at: undefined,
    confirmed_at: new Date(0).toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: {
      provider: 'desktop-local',
      providers: ['desktop-local'],
      tenant_id: LOCAL_TENANT_ID,
      role: 'admin',
    },
    user_metadata: {
      full_name: 'Local Admin (Desktop)',
      display_name: 'Admin',
    },
    identities: [],
    created_at: new Date(0).toISOString(),
    updated_at: new Date().toISOString(),
  };
  return {
    access_token: adminToken,
    refresh_token: adminToken,
    expires_in: 60 * 60 * 24 * 365,
    expires_at: now + 60 * 60 * 24 * 365,
    token_type: 'bearer',
    user,
  };
}
