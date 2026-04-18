import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createVersionDownloadUrl } from '@/features/presentations/repository';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { fetchLanEvents, signLanDownloadUrl, type LanEvent } from '@/lib/desktop-bridge';
import {
  invokeRoomPlayerBootstrap,
  type PlaybackMode,
  type RoomPlayerBootstrapFileRow,
  type RoomPlayerNetworkMode,
} from '../repository';
import {
  clearSavedDirHandle,
  downloadFileToPath,
  ensureWritePermission,
  getSavedDirHandle,
  getStorageEstimate,
  isFsAccessSupported,
  pickAndSaveDirHandle,
  purgeOrphanFiles,
  sanitizeFsSegment,
  verifyFileSha256,
  type DownloadOptions,
  type OrphanCleanupResult,
  type StorageEstimate,
} from '../lib/fs-access';
import { reportError } from '@/lib/telemetry';

export type FileSyncItemStatus = 'pending' | 'downloading' | 'synced' | 'error';

/**
 * Sprint C2 (GUIDA_OPERATIVA_v3 §2.C2-C3) — esito verifica SHA256 del file.
 *
 * - `pending`: download non ancora completato (default).
 * - `verified`: SHA256 calcolato e identico a quello dell'admin → file integro.
 * - `mismatch`: SHA256 diverso → ridownload in corso (max 3 retry totali) o
 *   stato finale di errore se i retry sono esauriti.
 * - `skipped`: il file e' troppo grande (>512MB) o l'admin non ha registrato
 *   un hash (upload legacy). Il file viene comunque considerato sincronizzato,
 *   ma l'utente in sala vede un'icona neutra ("non verificabile").
 */
export type FileVerifyStatus = 'pending' | 'verified' | 'mismatch' | 'skipped';

const MAX_VERIFY_RETRIES = 3;

/**
 * Sprint B (GUIDA_OPERATIVA_v3 §2.B) — stato del canale Realtime.
 *
 * Il Room Player NON ha sessione utente Supabase (auth via device_token).
 * Per ricevere notifiche push usa Realtime Broadcast su topic `room:<id>`,
 * alimentato da trigger PostgreSQL (migration 20260418010000_*) che
 * pubblicano con `private=false` (nessuna RLS sui realtime.messages).
 *
 * - `idle`: il channel non e' stato ancora creato (es. dirHandle mancante).
 * - `connecting`: subscribe inviato, in attesa di SUBSCRIBED.
 * - `subscribed`: channel attivo, broadcast in arrivo.
 * - `error`: SUBSCRIBE fallito (CHANNEL_ERROR / TIMED_OUT). Si torna al
 *   polling normale come safety-net.
 */
export type RealtimeChannelStatus = 'idle' | 'connecting' | 'subscribed' | 'error';

/**
 * Sprint A3 + A4 (GUIDA_OPERATIVA_v3 §2.A) — tuning per modalita di playback.
 *
 * - `auto` (default): polling 12s, concurrency 1, no throttle, priority `auto`.
 *   Stessa esperienza utente di prima della Sprint A.
 * - `live`: il PC sala sta proiettando, vogliamo disturbare il MENO possibile.
 *   Polling 60s, concurrency 1, throttle 50ms ogni 4MB, priority `low`.
 * - `turbo`: setup pre-evento, vogliamo finire in fretta. Polling 5s,
 *   concurrency 3, no throttle, priority `high`.
 *
 * Sprint N4 — comportamento in modalita LAN (admin desktop):
 *   I download usano `signLanDownloadUrl` + downloadFileToPath identici al cloud.
 *   Concurrency e throttle si applicano nello stesso modo:
 *     • `live` + LAN 100Mbit (~12.5 MB/s): throttle 50ms ogni 4MB ≈ 0.5s extra
 *       su un file da 40MB. Utile per non saturare il switch durante la proiezione.
 *     • `turbo` + LAN 1Gbit: 3 download paralleli, limitati dal SSD lato admin
 *       (~500 MB/s). Tipicamente scarica un evento da 5GB in <30s.
 *     • `auto` + LAN: comportamento conservativo, 1 file alla volta. Adatto per
 *       upload incrementali (l'admin carica file singoli durante la sessione).
 *   Il polling rate (12s/60s/5s) e' sostituito dal long-poll N3 per latenza
 *   istantanea: l'intervallo di polling diventa solo un safety-net.
 */
interface PlaybackModeTuning {
  pollIntervalMs: number;
  concurrency: number;
  download: Pick<DownloadOptions, 'priority' | 'throttleMs' | 'throttleEveryBytes'>;
}

const PLAYBACK_MODE_TUNING: Record<PlaybackMode, PlaybackModeTuning> = {
  auto: {
    pollIntervalMs: 12_000,
    concurrency: 1,
    download: { priority: 'auto' },
  },
  live: {
    pollIntervalMs: 60_000,
    concurrency: 1,
    download: { priority: 'low', throttleMs: 50, throttleEveryBytes: 4 * 1024 * 1024 },
  },
  turbo: {
    pollIntervalMs: 5_000,
    concurrency: 3,
    download: { priority: 'high' },
  },
};

export interface FileSyncItem {
  versionId: string;
  presentationId: string;
  storageKey: string;
  filename: string;
  speakerName: string | null;
  sessionId: string;
  sessionTitle: string;
  sessionScheduledStart: string | null;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  /** Sprint C2: hash SHA-256 atteso (server). `null` per upload legacy. */
  fileHashSha256: string | null;
  status: FileSyncItemStatus;
  progress: number;
  errorMessage: string | null;
  /** Sprint C2-C3: esito ultima verifica integrita'. */
  verified: FileVerifyStatus;
}

interface UseFileSyncParams {
  roomId: string;
  roomName: string;
  eventId: string;
  deviceToken: string;
  networkMode: RoomPlayerNetworkMode;
  agentLan: { lan_ip: string; lan_port: number } | null;
  navigatorOnline: boolean;
  enabled: boolean;
  /**
   * Sprint A — modalita di playback dichiarata dall'utente sul PC sala.
   * Cambia polling, concurrency e priorita di download. Default `auto`.
   */
  playbackMode?: PlaybackMode;
  /**
   * Sprint N2 — base URL HTTP del backend admin LAN (es. `http://192.168.1.10:7300`).
   * Quando presente, i download vengono firmati via `lan-sign-url` sull'admin
   * (non via Supabase Storage), e tryCloud usa l'admin come storage origin.
   *
   * Letto da `device.json.admin_server.base_url` in `RoomPlayerView`.
   */
  lanAdminBaseUrl?: string | null;
  /**
   * Sprint N3 — base URL HTTP del backend Rust **locale** del PC sala
   * (es. `http://127.0.0.1:7300`). Usato per long-poll degli eventi LAN
   * push dall'admin (`POST /events/file_added`).
   *
   * Quando settato, attiva il long-poll. Senza, ricadiamo solo sul polling
   * regolare (12s/60s/5s) gia' presente.
   */
  localBackendBaseUrl?: string | null;
}

interface UseFileSyncResult {
  supported: boolean;
  dirHandle: FileSystemDirectoryHandle | null;
  items: FileSyncItem[];
  pickFolder: () => Promise<void>;
  clearFolder: () => Promise<void>;
  retryItem: (versionId: string) => Promise<void>;
  refreshNow: () => Promise<void>;
  /** Sprint B: stato del channel Realtime (`subscribed` = push live attivo). */
  realtimeStatus: RealtimeChannelStatus;
  /** Sprint E3: stima quota storage origin (`null` = API non supportata o errore). */
  storage: StorageEstimate | null;
  /** Sprint E3: forza ricalcolo quota storage. */
  refreshStorage: () => Promise<void>;
  /**
   * Sprint E3: rimuove i file orfani dalla cartella scelta — file presenti su
   * disco ma non piu' nella lista corrente delle versioni (es. presentazioni
   * di sessioni ormai concluse o file rimossi dall'admin).
   *
   * Bypassato se `dirHandle` non e' settato. Ritorna conteggi.
   */
  cleanupOrphanFiles: () => Promise<OrphanCleanupResult | null>;
}

function manifestStorageKey(eventId: string, roomId: string): string {
  return `sc:rp:files:${eventId}:${roomId}`;
}

function persistManifest(
  eventId: string,
  roomId: string,
  files: RoomPlayerBootstrapFileRow[],
): void {
  try {
    localStorage.setItem(manifestStorageKey(eventId, roomId), JSON.stringify(files));
  } catch {
    /* ignore quota */
  }
}

function buildLanFileUrl(
  agent: { lan_ip: string; lan_port: number },
  eventId: string,
  filename: string,
): string {
  const base = `http://${agent.lan_ip}:${agent.lan_port}`;
  return `${base}/api/v1/files/${eventId}/${encodeURIComponent(filename)}`;
}

function rowToItem(
  row: RoomPlayerBootstrapFileRow,
  syncedIds: Set<string>,
  verifiedMap: Map<string, FileVerifyStatus>,
): FileSyncItem {
  const wasSynced = syncedIds.has(row.versionId);
  return {
    versionId: row.versionId,
    presentationId: row.presentationId,
    storageKey: row.storageKey,
    filename: row.filename,
    speakerName: row.speakerName,
    sessionId: row.sessionId,
    sessionTitle: row.sessionTitle,
    sessionScheduledStart: row.sessionScheduledStart,
    fileSizeBytes: row.fileSizeBytes,
    mimeType: row.mimeType,
    createdAt: row.createdAt,
    fileHashSha256: row.fileHashSha256,
    status: wasSynced ? 'synced' : 'pending',
    progress: wasSynced ? 100 : 0,
    errorMessage: null,
    verified: verifiedMap.get(row.versionId) ?? 'pending',
  };
}

export function useFileSync({
  roomId,
  roomName,
  eventId,
  deviceToken,
  networkMode,
  agentLan,
  navigatorOnline,
  enabled,
  playbackMode = 'auto',
  lanAdminBaseUrl = null,
  localBackendBaseUrl = null,
}: UseFileSyncParams): UseFileSyncResult {
  const supported = isFsAccessSupported();
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [items, setItems] = useState<FileSyncItem[]>([]);
  const syncedVersionIds = useRef<Set<string>>(new Set());
  // Sprint C: stato verifica SHA256 per versionId (sopravvive ad un reconcile,
  // cosi' i file gia' verificati restano marcati anche dopo un poll).
  const verifiedStatusRef = useRef<Map<string, FileVerifyStatus>>(new Map());

  // Sprint A4+A5: il tuning corrente (poll/concurrency/throttle) viene letto via
  // ref dentro le callback per restare sempre fresco anche se l'utente cambia
  // modalita a meta' di un download in corso.
  const tuning = useMemo(() => PLAYBACK_MODE_TUNING[playbackMode], [playbackMode]);
  const tuningRef = useRef(tuning);
  useEffect(() => {
    tuningRef.current = tuning;
  }, [tuning]);

  // Sprint B: stato del channel Realtime. Quando `subscribed`, il polling
  // diventa un semplice health-check ogni 60s (safety-net contro WebSocket
  // morti senza errore esplicito).
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeChannelStatus>('idle');
  const realtimeStatusRef = useRef<RealtimeChannelStatus>('idle');
  useEffect(() => {
    realtimeStatusRef.current = realtimeStatus;
  }, [realtimeStatus]);

  useEffect(() => {
    if (!supported || !enabled) return;
    void getSavedDirHandle().then((h) => {
      if (h) setDirHandle(h);
    });
  }, [supported, enabled]);

  const inflightRef = useRef<Set<string>>(new Set());
  // Sprint E4 (GUIDA_OPERATIVA_v3 §2.E4): lock anti-doppio fetch su
  // `fetchVersions`. Se polling, syncAll iniziale, refreshNow manuale e
  // broadcast `presentation_changed` chiamano `fetchVersions` quasi insieme,
  // riusiamo la stessa Promise in volo. Evita N chiamate inutili a
  // `room-player-bootstrap` e mantiene coerenza dei dati.
  const fetchVersionsInflightRef = useRef<Promise<RoomPlayerBootstrapFileRow[]> | null>(null);

  const downloadVersion = useCallback(
    async (item: FileSyncItem, handle: FileSystemDirectoryHandle) => {
      const { versionId, storageKey, filename, sessionTitle, fileSizeBytes, fileHashSha256 } = item;
      if (syncedVersionIds.current.has(versionId)) return;
      if (inflightRef.current.has(versionId)) return;
      inflightRef.current.add(versionId);

      setItems((prev) =>
        prev.map((i) =>
          i.versionId === versionId
            ? { ...i, status: 'downloading' as const, progress: 0, verified: 'pending' as const }
            : i,
        ),
      );

      const segments = [roomName || 'sala', sessionTitle || 'sessione'];

      // Sprint C: il download viene tentato fino a MAX_VERIFY_RETRIES volte se
      // la verifica SHA256 post-download fallisce. Dal 2° tentativo in poi
      // forziamo `forceFullDownload: true` per ignorare il file corrotto sul
      // disco e riscriverlo da zero.
      const buildOptions = (attempt: number): DownloadOptions => ({
        ...tuningRef.current.download,
        expectedSizeBytes: fileSizeBytes > 0 ? fileSizeBytes : undefined,
        forceFullDownload: attempt > 1,
      });

      const onProgress = (pct: number) => {
        setItems((prev) =>
          prev.map((i) => (i.versionId === versionId ? { ...i, progress: pct } : i)),
        );
      };

      const tryCloud = async (attempt: number) => {
        // Sprint N2: se siamo in modalita LAN (admin desktop raggiungibile),
        // chiediamo all'admin un signed URL HMAC e scarichiamo direttamente
        // dal suo storage locale, **bypassando completamente il cloud**.
        // Questo non richiede `navigatorOnline=true` (la LAN funziona offline).
        if (lanAdminBaseUrl) {
          const signed = await signLanDownloadUrl({
            adminBaseUrl: lanAdminBaseUrl,
            device_token: deviceToken,
            storage_key: storageKey,
          });
          await downloadFileToPath(
            handle,
            segments,
            filename,
            signed.signedURL,
            onProgress,
            buildOptions(attempt),
          );
          return;
        }
        if (!navigatorOnline) throw new Error('offline_cloud');
        const signedUrl = await createVersionDownloadUrl(storageKey);
        await downloadFileToPath(handle, segments, filename, signedUrl, onProgress, buildOptions(attempt));
      };

      try {
        const hasPermission = await ensureWritePermission(handle);
        if (!hasPermission) {
          inflightRef.current.delete(versionId);
          setItems((prev) =>
            prev.map((i) =>
              i.versionId === versionId
                ? { ...i, status: 'error' as const, errorMessage: 'permission_denied' }
                : i,
            ),
          );
          return;
        }

        // Sprint E3 (GUIDA_OPERATIVA_v3 §2.E3): storage guard.
        // `navigator.storage.estimate()` ritorna la quota dell'ORIGIN (IndexedDB
        // / OPFS), NON dello spazio reale del disco scelto. E' comunque un buon
        // segnale di pre-allarme: se il browser ha gia' poco spazio per
        // l'origin, il File System Access API a volte fallisce silente. Soglia
        // pragmatica: se `availableBytes < fileSizeBytes * 1.1` segnaliamo
        // errore prima di iniziare il download (non sprechiamo banda).
        if (fileSizeBytes > 0) {
          const est = await getStorageEstimate();
          if (est && est.quotaBytes > 0 && est.availableBytes < fileSizeBytes * 1.1) {
            inflightRef.current.delete(versionId);
            setItems((prev) =>
              prev.map((i) =>
                i.versionId === versionId
                  ? { ...i, status: 'error' as const, errorMessage: 'storage_full' }
                  : i,
              ),
            );
            reportError(new Error('storage_full'), {
              tag: 'sync.storage_full',
              extra: {
                versionId,
                fileSizeBytes,
                availableBytes: est.availableBytes,
                quotaBytes: est.quotaBytes,
                eventId,
                roomId,
              },
            });
            return;
          }
        }

        const lanUrl = agentLan ? buildLanFileUrl(agentLan, eventId, filename) : null;
        if (networkMode === 'intranet' && !lanUrl) throw new Error('no_lan_agent');

        let verifyResult: true | false | 'skipped' = 'skipped';
        let attempt = 0;
        while (attempt < MAX_VERIFY_RETRIES) {
          attempt++;
          if (networkMode === 'cloud' || !lanUrl) {
            await tryCloud(attempt);
          } else if (networkMode === 'intranet') {
            await downloadFileToPath(handle, segments, filename, lanUrl, onProgress, buildOptions(attempt));
          } else {
            try {
              await downloadFileToPath(
                handle,
                segments,
                filename,
                lanUrl,
                onProgress,
                buildOptions(attempt),
              );
            } catch {
              await tryCloud(attempt);
            }
          }

          verifyResult = await verifyFileSha256(handle, segments, filename, fileHashSha256);
          if (verifyResult === true || verifyResult === 'skipped') break;
          // mismatch → loop con forceFullDownload
        }

        const finalVerified: FileVerifyStatus =
          verifyResult === true ? 'verified' : verifyResult === 'skipped' ? 'skipped' : 'mismatch';

        if (finalVerified === 'mismatch') {
          // 3 download e 3 hash diversi: file rotto a monte, nessun retry automatico.
          verifiedStatusRef.current.set(versionId, 'mismatch');
          inflightRef.current.delete(versionId);
          setItems((prev) =>
            prev.map((i) =>
              i.versionId === versionId
                ? {
                  ...i,
                  status: 'error' as const,
                  errorMessage: 'verify_mismatch',
                  verified: 'mismatch' as const,
                }
                : i,
            ),
          );
          // Sprint E2: telemetry per spottare file rotti a monte (regressioni
          // upload, bug nel calcolo hash, file modificato lato CDN, ecc.)
          reportError(new Error('verify_mismatch'), {
            tag: 'sync.verify_mismatch',
            extra: { versionId, fileHashSha256, retries: MAX_VERIFY_RETRIES, eventId, roomId },
          });
          return;
        }

        syncedVersionIds.current.add(versionId);
        verifiedStatusRef.current.set(versionId, finalVerified);
        inflightRef.current.delete(versionId);
        setItems((prev) =>
          prev.map((i) =>
            i.versionId === versionId
              ? {
                ...i,
                status: 'synced' as const,
                progress: 100,
                errorMessage: null,
                verified: finalVerified,
              }
              : i,
          ),
        );
      } catch (err) {
        inflightRef.current.delete(versionId);
        const errorMessage = err instanceof Error ? err.message : 'download_failed';
        setItems((prev) =>
          prev.map((i) =>
            i.versionId === versionId
              ? {
                ...i,
                status: 'error' as const,
                errorMessage,
              }
              : i,
          ),
        );
        // Sprint E2: log errori download non recuperati (post-retry).
        // Filtriamo `permission_denied` e `offline_*` (non sono bug reali ma
        // stati noti del flusso) per non spammare Sentry.
        if (
          errorMessage !== 'permission_denied' &&
          !errorMessage.startsWith('offline_')
        ) {
          reportError(err, {
            tag: 'sync.download_failed',
            extra: { versionId, eventId, roomId, networkMode, errorMessage },
          });
        }
      }
    },
    [
      roomName,
      eventId,
      roomId,
      networkMode,
      agentLan,
      navigatorOnline,
      lanAdminBaseUrl,
      deviceToken,
    ],
  );

  const fetchVersions = useCallback(async (): Promise<RoomPlayerBootstrapFileRow[]> => {
    // Sprint A6: passiamo il `playbackMode` corrente cosi' il bootstrap
    // (chiamato sia all'avvio sia ad ogni tick di polling) aggiorna la
    // dashboard admin senza bisogno di un endpoint dedicato.
    // Sprint E4: dedup tramite ref. Se gia' in volo, attacchiamo i nuovi
    // chiamanti alla stessa Promise. La pulizia avviene in `finally` cosi'
    // anche un errore (rete giu') libera il lock.
    if (fetchVersionsInflightRef.current) return fetchVersionsInflightRef.current;
    const promise = (async () => {
      try {
        const data = await invokeRoomPlayerBootstrap(deviceToken, true, playbackMode);
        persistManifest(eventId, roomId, data.files);
        return data.files;
      } finally {
        fetchVersionsInflightRef.current = null;
      }
    })();
    fetchVersionsInflightRef.current = promise;
    return promise;
  }, [deviceToken, eventId, roomId, playbackMode]);

  /**
   * Sprint A5: pool di download con concurrency configurabile per modalita.
   * Mantiene l'ordine inserito (cosi' i file della prima sessione partono
   * prima di quelli della seconda) ma permette fino a N download paralleli.
   */
  const runWithConcurrency = useCallback(
    async <T,>(
      list: T[],
      limit: number,
      runner: (item: T) => Promise<void>,
      isCancelled: () => boolean,
    ): Promise<void> => {
      const safeLimit = Math.max(1, Math.floor(limit));
      let cursor = 0;
      const workers: Promise<void>[] = [];
      for (let w = 0; w < Math.min(safeLimit, list.length); w++) {
        workers.push(
          (async () => {
            while (!isCancelled()) {
              const idx = cursor++;
              if (idx >= list.length) return;
              await runner(list[idx]);
            }
          })(),
        );
      }
      await Promise.all(workers);
    },
    [],
  );

  const reconcileItems = useCallback((versions: RoomPlayerBootstrapFileRow[]) => {
    setItems((prev) => {
      const byId = new Map(prev.map((i) => [i.versionId, i]));
      const result: FileSyncItem[] = [];
      const incomingIds = new Set<string>();
      for (const v of versions) {
        incomingIds.add(v.versionId);
        const existing = byId.get(v.versionId);
        if (existing) {
          // Sprint C: se l'admin pubblica una nuova versione con hash diverso
          // da quello attualmente sul disco (cambio file ma stesso versionId
          // e' raro ma possibile), invalidiamo la verifica precedente. Lo
          // stato `synced` viene anche lui resettato cosi' il prossimo poll
          // ridownload-a il file con il nuovo hash atteso.
          const hashChanged =
            existing.fileHashSha256 !== v.fileHashSha256 && v.fileHashSha256 !== null;
          if (hashChanged) {
            syncedVersionIds.current.delete(v.versionId);
            verifiedStatusRef.current.delete(v.versionId);
          }
          result.push({
            ...existing,
            presentationId: v.presentationId,
            filename: v.filename,
            speakerName: v.speakerName,
            sessionTitle: v.sessionTitle,
            sessionScheduledStart: v.sessionScheduledStart,
            fileSizeBytes: v.fileSizeBytes,
            mimeType: v.mimeType,
            createdAt: v.createdAt,
            storageKey: v.storageKey,
            fileHashSha256: v.fileHashSha256,
            status: hashChanged ? ('pending' as const) : existing.status,
            progress: hashChanged ? 0 : existing.progress,
            verified: hashChanged ? ('pending' as const) : existing.verified,
          });
        } else {
          result.push(rowToItem(v, syncedVersionIds.current, verifiedStatusRef.current));
        }
      }
      // File rimossi dal server: li droppiamo dalla lista (non cancelliamo i file
      // locali per scelta esplicita: l'utente sa che restano sul disco).
      return result.filter((i) => incomingIds.has(i.versionId));
    });
  }, []);

  useEffect(() => {
    if (!dirHandle || !roomId || !eventId || !deviceToken || !enabled) return;
    let cancelled = false;

    async function syncAll() {
      let versions: RoomPlayerBootstrapFileRow[] = [];
      try {
        versions = await fetchVersions();
      } catch {
        if (cancelled) return;
        try {
          const raw = localStorage.getItem(manifestStorageKey(eventId, roomId));
          if (raw) versions = JSON.parse(raw) as RoomPlayerBootstrapFileRow[];
        } catch {
          versions = [];
        }
      }
      if (cancelled) return;

      reconcileItems(versions);

      const pending = versions.filter((v) => !syncedVersionIds.current.has(v.versionId));
      await runWithConcurrency(
        pending,
        tuningRef.current.concurrency,
        async (v) => {
          if (cancelled) return;
          await downloadVersion(
            rowToItem(v, syncedVersionIds.current, verifiedStatusRef.current),
            dirHandle!,
          );
        },
        () => cancelled,
      );
    }

    void syncAll();
    return () => {
      cancelled = true;
    };
  }, [
    dirHandle,
    roomId,
    eventId,
    deviceToken,
    enabled,
    downloadVersion,
    fetchVersions,
    reconcileItems,
    runWithConcurrency,
  ]);

  useEffect(() => {
    if (!dirHandle || !roomId || !eventId || !deviceToken || !enabled) return;
    // Sprint A3 + B3: il polling rate dipende dalla modalita corrente. Quando
    // il channel Realtime e' `subscribed` (Sprint B) il polling diventa un
    // health-check ogni 60s, perche' i refresh veri arrivano via broadcast.
    // L'intervallo viene rivalutato ad ogni tick leggendo `realtimeStatusRef`,
    // cosi' non serve riavviare l'interval ogni volta che cambia lo stato.
    let cancelled = false;
    const baseIntervalMs = tuning.pollIntervalMs;
    const HEALTH_CHECK_MS = 60_000;
    let lastTickAt = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const effective = realtimeStatusRef.current === 'subscribed'
        ? Math.max(HEALTH_CHECK_MS, baseIntervalMs)
        : baseIntervalMs;
      if (now - lastTickAt < effective) return;
      lastTickAt = now;
      void (async () => {
        try {
          const versions = await fetchVersions();
          if (cancelled) return;
          reconcileItems(versions);
          const pending = versions.filter((v) => !syncedVersionIds.current.has(v.versionId));
          await runWithConcurrency(
            pending,
            tuningRef.current.concurrency,
            async (v) => {
              if (cancelled) return;
              await downloadVersion(
                rowToItem(v, syncedVersionIds.current, verifiedStatusRef.current),
                dirHandle!,
              );
            },
            () => cancelled,
          );
        } catch {
          /* offline: silent until next tick */
        }
      })();
    }, Math.min(baseIntervalMs, 5_000)); // tick frequente, gating sull'intervallo "logico"
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    dirHandle,
    roomId,
    eventId,
    deviceToken,
    enabled,
    downloadVersion,
    fetchVersions,
    reconcileItems,
    runWithConcurrency,
    tuning.pollIntervalMs,
  ]);

  // Sprint B (B1+B4): subscription Realtime al topic `room:<roomId>`.
  // Il channel riceve due eventi:
  //   - `presentation_changed`: una `presentation_versions` di una sessione di
  //     questa room ha avuto INSERT/UPDATE/DELETE.
  //   - `room_state_changed`: la riga `room_state` di questa room e' cambiata.
  // In entrambi i casi forziamo un `refreshNow()` (debounced) per riallineare
  // immediatamente il PC sala. Le modifiche provengono da trigger Postgres
  // (migration 20260418010000_room_realtime_broadcast) che pubblicano con
  // `private=false`, quindi la subscription da utente anon riceve i payload.
  const refreshNowRef = useRef<() => Promise<void>>(async () => { });
  useEffect(() => {
    if (!roomId || !enabled) {
      setRealtimeStatus('idle');
      return;
    }
    const supabase = getSupabaseBrowserClient();
    setRealtimeStatus('connecting');
    let debounceTimer: number | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void refreshNowRef.current();
      }, 250); // debounce: cluster di INSERT/UPDATE = 1 sola refresh
    };
    // Sprint D (force_refresh): handler invocato dall'admin via
    // `broadcastForceRefresh(roomId)`. Resettiamo TUTTA la cache locale
    // (`syncedVersionIds`, `verifiedStatusRef`) e forziamo un refresh: cosi'
    // il PC sala riscarica e ri-verifica tutti i file. Utile in caso di file
    // sostituito a runtime, dubbio sulla cache, o test field.
    const onForceRefresh = () => {
      syncedVersionIds.current.clear();
      verifiedStatusRef.current.clear();
      setItems((prev) =>
        prev.map((i) => ({ ...i, status: 'pending' as const, progress: 0, verified: 'pending' as const })),
      );
      // Bypassiamo il debounce di 250ms: una force-refresh deve essere immediata.
      void refreshNowRef.current();
    };

    const channel = supabase
      .channel(`room:${roomId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'presentation_changed' }, () => scheduleRefresh())
      .on('broadcast', { event: 'room_state_changed' }, () => scheduleRefresh())
      .on('broadcast', { event: 'force_refresh' }, onForceRefresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('subscribed');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
          setRealtimeStatus('error');
      });
    return () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
      setRealtimeStatus('idle');
    };
  }, [roomId, enabled]);

  // ── Sprint N3 — long-poll eventi LAN dal proprio backend (push admin → sala)
  //
  // Quando il PC sala e' in modalita desktop LAN, il backend Rust locale
  // (Axum) riceve push HTTP dall'admin (`POST /events/file_added`) e li
  // pubblica su un bus broadcast. La SPA del sala fa long-poll su
  // `GET /events/stream?since=<cursor>` (timeout 25s default) e su ogni
  // evento ricevuto chiama `refreshNow()` per riallineare i file.
  //
  // Confronto vs polling cloud (Realtime / 12s/60s/5s):
  //   • In LAN il push HTTP latency e' < 100ms, quindi il sala e' aggiornato
  //     ~istantaneamente quando l'admin finalizza un upload (vs 5-60s polling).
  //   • Il polling tradizionale resta attivo come safety-net ogni 30s minimo
  //     in modalita LAN (vedi il polling effect sotto: `Math.max(...)`).
  //
  // Cancellazione: `AbortController` su unmount o cambio params chiude la
  // fetch in volo senza errori in console.
  useEffect(() => {
    if (!enabled) return;
    if (!localBackendBaseUrl) return; // solo modalita desktop
    let cancelled = false;
    const ctrl = new AbortController();
    let cursor = 0;

    const onEvent = (evt: LanEvent) => {
      const kind = evt.payload?.kind;
      if (kind === 'file_added' || kind === 'presentation_deleted') {
        // Bypassiamo la cache `syncedVersionIds` per forzare il refetch del
        // bootstrap. Il `refreshNow` passa per `fetchVersions` con dedup,
        // quindi piu' eventi ravvicinati = 1 sola chiamata bootstrap.
        void refreshNowRef.current();
      }
    };

    async function loop() {
      while (!cancelled) {
        try {
          const res = await fetchLanEvents({
            baseUrl: localBackendBaseUrl!,
            since: cursor,
            timeoutMs: 25_000,
            eventId: eventId || undefined,
            signal: ctrl.signal,
          });
          if (cancelled) return;
          if (res.events.length > 0) {
            for (const e of res.events) onEvent(e);
            cursor = Math.max(cursor, res.cursor);
          } else if (res.cursor > cursor) {
            // long-poll terminato senza eventi (timeout): aggiorna cursor lo stesso
            cursor = res.cursor;
          }
          // Se la chiamata e' tornata < 200ms (errore? race?), evitiamo busy-loop
          // con micro-pause. Il long-poll lato Rust dura 25s, quindi il caso
          // tipico e' fetch lunga → attesa 0.
        } catch (err) {
          if (cancelled || ctrl.signal.aborted) return;
          // Fallback: backoff progressivo per evitare di martellare il backend.
          // 1s → 2s → 5s → 10s, ricomincia a 1s al primo successo.
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes('abort')) {
            console.warn('[useFileSync] LAN events long-poll error', message);
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    void loop();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [enabled, localBackendBaseUrl, eventId]);

  const pickFolder = useCallback(async () => {
    const handle = await pickAndSaveDirHandle();
    if (handle) setDirHandle(handle);
  }, []);

  const clearFolder = useCallback(async () => {
    await clearSavedDirHandle();
    setDirHandle(null);
    setItems([]);
    syncedVersionIds.current.clear();
    verifiedStatusRef.current.clear();
  }, []);

  const retryItem = useCallback(
    async (versionId: string) => {
      if (!dirHandle) return;
      const item = items.find((i) => i.versionId === versionId);
      if (!item) return;
      syncedVersionIds.current.delete(versionId);
      verifiedStatusRef.current.delete(versionId);

      setItems((prev) =>
        prev.map((i) =>
          i.versionId === versionId
            ? { ...i, status: 'pending' as const, verified: 'pending' as const }
            : i,
        ),
      );
      await downloadVersion(item, dirHandle);
    },
    [dirHandle, items, downloadVersion],
  );

  const refreshNow = useCallback(async () => {
    if (!dirHandle || !enabled) return;
    try {
      const versions = await fetchVersions();
      reconcileItems(versions);
      const pending = versions.filter((v) => !syncedVersionIds.current.has(v.versionId));
      await runWithConcurrency(
        pending,
        tuningRef.current.concurrency,
        async (v) => {
          await downloadVersion(
            rowToItem(v, syncedVersionIds.current, verifiedStatusRef.current),
            dirHandle,
          );
        },
        () => false,
      );
    } catch {
      /* swallow */
    }
  }, [dirHandle, enabled, fetchVersions, reconcileItems, downloadVersion, runWithConcurrency]);

  // Sprint B: il subscription effect ha bisogno di chiamare la versione
  // "fresca" di refreshNow (che dipende da dirHandle, enabled, ecc.). Usiamo
  // un ref aggiornato ad ogni render per evitare di rifare il subscribe del
  // channel ogni volta che cambia un dependency interno.
  useEffect(() => {
    refreshNowRef.current = refreshNow;
  }, [refreshNow]);

  // Sprint E3: stima quota storage. Polling lento (60s) tramite lo stesso
  // tick del polling versions. Lo spazio "appare" usato solo dopo che il
  // browser flushia la quota — non e' tempo-critico. Setup separato in un
  // useEffect dedicato per non accoppiare il fetch storage al fetch versions.
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const refreshStorage = useCallback(async () => {
    const est = await getStorageEstimate();
    setStorage(est);
  }, []);
  useEffect(() => {
    if (!supported || !enabled) return;
    let cancelled = false;
    const tick = async () => {
      const est = await getStorageEstimate();
      if (cancelled) return;
      setStorage(est);
    };
    const initialId = window.setTimeout(() => void tick(), 0);
    const intervalId = window.setInterval(() => void tick(), 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
    };
  }, [supported, enabled]);

  const cleanupOrphanFiles = useCallback(async (): Promise<OrphanCleanupResult | null> => {
    if (!dirHandle) return null;
    // Costruiamo le `expectedKeys` con la STESSA logica di `downloadFileToPath`
    // (sanitizeFsSegment su ogni componente). Se non match perfetto il file
    // viene erroneamente cancellato — documentato in `purgeOrphanFiles`.
    const expectedKeys = new Set<string>();
    for (const it of items) {
      const segs = [
        sanitizeFsSegment(roomName || 'sala'),
        sanitizeFsSegment(it.sessionTitle || 'sessione'),
      ];
      const safeName = sanitizeFsSegment(it.filename, 'file');
      expectedKeys.add([...segs, safeName].join('/'));
    }
    const result = await purgeOrphanFiles(dirHandle, expectedKeys);
    // Refresh quota subito dopo (lo spazio liberato e' immediato per OPFS).
    await refreshStorage();
    return result;
  }, [dirHandle, items, roomName, refreshStorage]);

  return {
    supported,
    dirHandle,
    items,
    pickFolder,
    clearFolder,
    retryItem,
    refreshNow,
    realtimeStatus,
    storage,
    refreshStorage,
    cleanupOrphanFiles,
  };
}
