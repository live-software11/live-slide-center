/**
 * Sprint O2 (GUIDA_OPERATIVA_v3 §4.G — UX parity cloud/offline) — astrazione backend client.
 *
 * Punto di ingresso unico per fare query "PostgREST-compatible" indipendente
 * dalla modalita backend (cloud Supabase vs desktop Rust locale). Da usare al
 * posto di `getSupabaseBrowserClient()` quando il caller esprime intent
 * "voglio parlare al backend di dati", non "voglio specificamente Supabase".
 *
 * In Sprint O2 questa funzione e' un thin alias: ritorna il client Supabase
 * gia' costruito (in cloud → real Supabase, in desktop → Supabase puntato al
 * backend Rust locale). Gli usage Supabase-specifici (Auth Admin SDK, Realtime
 * channel, Storage signed URL) restano sul `getSupabaseBrowserClient()`
 * originale per chiarezza.
 *
 * Uso consigliato:
 *   • REST query/RPC normali → `getBackendClient()`
 *   • Auth (login/signup/forgotPassword) → `getSupabaseBrowserClient()` direttamente
 *     (il backend desktop salta l'auth, quindi questi flussi sono cloud-only)
 *   • Realtime channels → `getRealtimeClient()` (vedi `realtime-client.ts`)
 *
 * Nota: l'API ritornata e' identica a quella di Supabase JS (`from`, `rpc`,
 * `storage`, etc.). I metodi che richiedono auth Supabase (`auth.signOut`,
 * `auth.getSession`) NON funzionano in desktop e devono essere gestiti dal
 * caller con un check `getBackendMode() === 'desktop' ? skip : real`.
 */

import type { Database } from '@slidecenter/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from './supabase';

export type BackendClient = SupabaseClient<Database>;

export function getBackendClient(): BackendClient {
  return getSupabaseBrowserClient();
}
