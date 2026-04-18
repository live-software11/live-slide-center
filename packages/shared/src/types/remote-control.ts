/**
 * Sprint T-3-G (G10) — tipi pubblici per il telecomando remoto via tablet.
 *
 * Vedi:
 *   - migration `supabase/migrations/20260418210000_remote_control_pairings.sql`
 *   - Edge Function `supabase/functions/remote-control-dispatch/index.ts`
 *   - PWA route `/remote/:token` (RemoteControlView)
 *   - pannello admin (RemoteControlPairingsPanel)
 */

/**
 * Comandi accettati dall'Edge Function `remote-control-dispatch`. La RPC
 * `rpc_dispatch_remote_command` valida con CHECK il valore.
 *
 * - `next`/`prev`/`first`: navigano la SCALETTA (lista presentations) della
 *   sessione corrente. NON cambiano slide all'interno del file (limitazione
 *   architetturale documentata in §0.22 STATO_E_TODO).
 * - `goto`: richiede `target_presentation_id`, valida cross-room.
 * - `blank`: imposta `current_presentation_id = NULL` ("schermo nero").
 */
export type RemoteControlCommand = 'next' | 'prev' | 'goto' | 'blank' | 'first';

export interface RemoteControlPairingSummary {
  id: string;
  name: string;
  roomId: string;
  eventId: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  commandsCount: number;
}

/**
 * Risultato di create: contiene il TOKEN IN CHIARO. Mostrato in UI una sola
 * volta — l'admin deve copiarlo subito (DB conserva solo l'hash SHA-256).
 */
export interface RemoteControlPairingCreated {
  pairingId: string;
  token: string;
  expiresAt: string;
  roomId: string;
  eventId: string;
}

export interface RemoteControlValidatedToken {
  pairingId: string;
  tenantId: string;
  eventId: string;
  roomId: string;
  name: string;
  expiresAt: string;
  roomName: string | null;
  eventTitle: string | null;
}

export interface RemoteControlScheduleItem {
  presentationId: string;
  versionId: string;
  fileName: string;
  speakerName: string | null;
  displayOrder: number | null;
}

export interface RemoteControlSchedule {
  sessionId: string | null;
  sessionTitle: string | null;
  currentPresentationId: string | null;
  schedule: RemoteControlScheduleItem[];
}

export interface RemoteControlDispatchResult {
  roomId: string;
  command: string;
  presentationId: string | null;
  startedAt: string | null;
}
