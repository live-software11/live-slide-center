import { useCallback, useEffect, useRef, useState } from 'react';
import { createVersionDownloadUrl } from '@/features/presentations/repository';
import {
  invokeRoomPlayerBootstrap,
  type RoomPlayerBootstrapFileRow,
  type RoomPlayerNetworkMode,
} from '../repository';
import {
  clearSavedDirHandle,
  downloadFileToPath,
  ensureWritePermission,
  getSavedDirHandle,
  isFsAccessSupported,
  pickAndSaveDirHandle,
} from '../lib/fs-access';

export type FileSyncItemStatus = 'pending' | 'downloading' | 'synced' | 'error';

export interface FileSyncItem {
  versionId: string;
  storageKey: string;
  filename: string;
  speakerName: string | null;
  sessionId: string;
  sessionTitle: string;
  sessionScheduledStart: string | null;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  status: FileSyncItemStatus;
  progress: number;
  errorMessage: string | null;
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
}

interface UseFileSyncResult {
  supported: boolean;
  dirHandle: FileSystemDirectoryHandle | null;
  items: FileSyncItem[];
  pickFolder: () => Promise<void>;
  clearFolder: () => Promise<void>;
  retryItem: (versionId: string) => Promise<void>;
  refreshNow: () => Promise<void>;
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
): FileSyncItem {
  const wasSynced = syncedIds.has(row.versionId);
  return {
    versionId: row.versionId,
    storageKey: row.storageKey,
    filename: row.filename,
    speakerName: row.speakerName,
    sessionId: row.sessionId,
    sessionTitle: row.sessionTitle,
    sessionScheduledStart: row.sessionScheduledStart,
    fileSizeBytes: row.fileSizeBytes,
    mimeType: row.mimeType,
    createdAt: row.createdAt,
    status: wasSynced ? 'synced' : 'pending',
    progress: wasSynced ? 100 : 0,
    errorMessage: null,
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
}: UseFileSyncParams): UseFileSyncResult {
  const supported = isFsAccessSupported();
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [items, setItems] = useState<FileSyncItem[]>([]);
  const syncedVersionIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!supported || !enabled) return;
    void getSavedDirHandle().then((h) => {
      if (h) setDirHandle(h);
    });
  }, [supported, enabled]);

  const inflightRef = useRef<Set<string>>(new Set());

  const downloadVersion = useCallback(
    async (item: FileSyncItem, handle: FileSystemDirectoryHandle) => {
      const { versionId, storageKey, filename, sessionTitle } = item;
      if (syncedVersionIds.current.has(versionId)) return;
      if (inflightRef.current.has(versionId)) return;
      inflightRef.current.add(versionId);

      setItems((prev) =>
        prev.map((i) =>
          i.versionId === versionId ? { ...i, status: 'downloading' as const, progress: 0 } : i,
        ),
      );

      const segments = [roomName || 'sala', sessionTitle || 'sessione'];

      const tryCloud = async () => {
        if (!navigatorOnline) {
          throw new Error('offline_cloud');
        }
        const signedUrl = await createVersionDownloadUrl(storageKey);
        await downloadFileToPath(handle, segments, filename, signedUrl, (pct) => {
          setItems((prev) =>
            prev.map((i) => (i.versionId === versionId ? { ...i, progress: pct } : i)),
          );
        });
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

        const lanUrl = agentLan ? buildLanFileUrl(agentLan, eventId, filename) : null;

        if (networkMode === 'intranet' && !lanUrl) {
          throw new Error('no_lan_agent');
        }

        if (networkMode === 'cloud' || !lanUrl) {
          await tryCloud();
        } else if (networkMode === 'intranet') {
          await downloadFileToPath(handle, segments, filename, lanUrl, (pct) => {
            setItems((prev) =>
              prev.map((i) => (i.versionId === versionId ? { ...i, progress: pct } : i)),
            );
          });
        } else {
          try {
            await downloadFileToPath(handle, segments, filename, lanUrl, (pct) => {
              setItems((prev) =>
                prev.map((i) => (i.versionId === versionId ? { ...i, progress: pct } : i)),
              );
            });
          } catch {
            await tryCloud();
          }
        }

        syncedVersionIds.current.add(versionId);
        inflightRef.current.delete(versionId);
        setItems((prev) =>
          prev.map((i) =>
            i.versionId === versionId
              ? { ...i, status: 'synced' as const, progress: 100, errorMessage: null }
              : i,
          ),
        );
      } catch (err) {
        inflightRef.current.delete(versionId);
        setItems((prev) =>
          prev.map((i) =>
            i.versionId === versionId
              ? {
                  ...i,
                  status: 'error' as const,
                  errorMessage: err instanceof Error ? err.message : 'download_failed',
                }
              : i,
          ),
        );
      }
    },
    [roomName, eventId, networkMode, agentLan, navigatorOnline],
  );

  const fetchVersions = useCallback(async (): Promise<RoomPlayerBootstrapFileRow[]> => {
    const data = await invokeRoomPlayerBootstrap(deviceToken, true);
    persistManifest(eventId, roomId, data.files);
    return data.files;
  }, [deviceToken, eventId, roomId]);

  const reconcileItems = useCallback((versions: RoomPlayerBootstrapFileRow[]) => {
    setItems((prev) => {
      const byId = new Map(prev.map((i) => [i.versionId, i]));
      const result: FileSyncItem[] = [];
      const incomingIds = new Set<string>();
      for (const v of versions) {
        incomingIds.add(v.versionId);
        const existing = byId.get(v.versionId);
        if (existing) {
          // Aggiorna metadati eventualmente cambiati lato server (es. filename
          // rinominato dall'admin) preservando lo stato di sync locale.
          result.push({
            ...existing,
            filename: v.filename,
            speakerName: v.speakerName,
            sessionTitle: v.sessionTitle,
            sessionScheduledStart: v.sessionScheduledStart,
            fileSizeBytes: v.fileSizeBytes,
            mimeType: v.mimeType,
            createdAt: v.createdAt,
            storageKey: v.storageKey,
          });
        } else {
          result.push(rowToItem(v, syncedVersionIds.current));
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

      // downloadVersion legge sempre l'item piu' fresco dal closure; ricostruiamo
      // un item locale dalla riga server per evitare deps non aggiornate.
      for (const v of versions) {
        if (cancelled) break;
        if (!syncedVersionIds.current.has(v.versionId)) {
          await downloadVersion(rowToItem(v, syncedVersionIds.current), dirHandle!);
        }
      }
    }

    void syncAll();
    return () => {
      cancelled = true;
    };
  }, [dirHandle, roomId, eventId, deviceToken, enabled, downloadVersion, fetchVersions, reconcileItems]);

  useEffect(() => {
    if (!dirHandle || !roomId || !eventId || !deviceToken || !enabled) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const versions = await fetchVersions();
          reconcileItems(versions);
          for (const v of versions) {
            if (!syncedVersionIds.current.has(v.versionId)) {
              await downloadVersion(rowToItem(v, syncedVersionIds.current), dirHandle!);
            }
          }
        } catch {
          /* offline: silent until next tick */
        }
      })();
    }, 12_000);
    return () => window.clearInterval(id);
  }, [dirHandle, roomId, eventId, deviceToken, enabled, downloadVersion, fetchVersions, reconcileItems]);

  const pickFolder = useCallback(async () => {
    const handle = await pickAndSaveDirHandle();
    if (handle) setDirHandle(handle);
  }, []);

  const clearFolder = useCallback(async () => {
    await clearSavedDirHandle();
    setDirHandle(null);
    setItems([]);
    syncedVersionIds.current.clear();
  }, []);

  const retryItem = useCallback(
    async (versionId: string) => {
      if (!dirHandle) return;
      const item = items.find((i) => i.versionId === versionId);
      if (!item) return;
      syncedVersionIds.current.delete(versionId);

      setItems((prev) =>
        prev.map((i) => (i.versionId === versionId ? { ...i, status: 'pending' as const } : i)),
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
      for (const v of versions) {
        if (!syncedVersionIds.current.has(v.versionId)) {
          await downloadVersion(rowToItem(v, syncedVersionIds.current), dirHandle);
        }
      }
    } catch {
      /* swallow */
    }
  }, [dirHandle, enabled, fetchVersions, reconcileItems, downloadVersion]);

  return { supported, dirHandle, items, pickFolder, clearFolder, retryItem, refreshNow };
}
