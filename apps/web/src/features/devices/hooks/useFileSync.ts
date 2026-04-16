import { useCallback, useEffect, useRef, useState } from 'react';
import { createVersionDownloadUrl } from '@/features/presentations/repository';
import { invokeRoomPlayerBootstrap, type RoomPlayerBootstrapFileRow, type RoomPlayerNetworkMode } from '../repository';
import {
  clearSavedDirHandle,
  downloadFileToDir,
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
  speakerName: string;
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
}

function manifestStorageKey(eventId: string, roomId: string): string {
  return `sc:rp:files:${eventId}:${roomId}`;
}

function persistManifest(eventId: string, roomId: string, files: RoomPlayerBootstrapFileRow[]): void {
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
    async (
      versionId: string,
      storageKey: string,
      filename: string,
      handle: FileSystemDirectoryHandle,
    ) => {
      if (syncedVersionIds.current.has(versionId)) return;
      if (inflightRef.current.has(versionId)) return;
      inflightRef.current.add(versionId);

      setItems((prev) => {
        const existing = prev.find((i) => i.versionId === versionId);
        if (!existing) return prev;
        return prev.map((i) =>
          i.versionId === versionId ? { ...i, status: 'downloading' as const, progress: 0 } : i,
        );
      });

      const tryCloud = async () => {
        if (!navigatorOnline) {
          throw new Error('offline_cloud');
        }
        const signedUrl = await createVersionDownloadUrl(storageKey);
        await downloadFileToDir(handle, roomName, filename, signedUrl, (pct) => {
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
          await downloadFileToDir(handle, roomName, filename, lanUrl, (pct) => {
            setItems((prev) =>
              prev.map((i) => (i.versionId === versionId ? { ...i, progress: pct } : i)),
            );
          });
        } else {
          try {
            await downloadFileToDir(handle, roomName, filename, lanUrl, (pct) => {
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

      setItems((prev) => {
        const newItems: FileSyncItem[] = [];
        for (const v of versions) {
          const existing = prev.find((i) => i.versionId === v.versionId);
          if (!existing) {
            newItems.push({
              versionId: v.versionId,
              storageKey: v.storageKey,
              filename: v.filename,
              speakerName: v.speakerName,
              status: syncedVersionIds.current.has(v.versionId) ? 'synced' : 'pending',
              progress: syncedVersionIds.current.has(v.versionId) ? 100 : 0,
              errorMessage: null,
            });
          }
        }
        return [...prev, ...newItems];
      });

      for (const v of versions) {
        if (cancelled) break;
        if (!syncedVersionIds.current.has(v.versionId)) {
          await downloadVersion(v.versionId, v.storageKey, v.filename, dirHandle!);
        }
      }
    }

    void syncAll();
    return () => { cancelled = true; };
  }, [dirHandle, roomId, eventId, deviceToken, enabled, downloadVersion, fetchVersions]);

  useEffect(() => {
    if (!dirHandle || !roomId || !eventId || !deviceToken || !enabled) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const versions = await fetchVersions();
          setItems((prev) => {
            const added: FileSyncItem[] = [];
            for (const v of versions) {
              if (!prev.some((i) => i.versionId === v.versionId)) {
                added.push({
                  versionId: v.versionId,
                  storageKey: v.storageKey,
                  filename: v.filename,
                  speakerName: v.speakerName,
                  status: syncedVersionIds.current.has(v.versionId) ? 'synced' : 'pending',
                  progress: syncedVersionIds.current.has(v.versionId) ? 100 : 0,
                  errorMessage: null,
                });
              }
            }
            return added.length ? [...prev, ...added] : prev;
          });
          for (const v of versions) {
            if (!syncedVersionIds.current.has(v.versionId)) {
              await downloadVersion(v.versionId, v.storageKey, v.filename, dirHandle!);
            }
          }
        } catch {
          /* offline: silent until next tick */
        }
      })();
    }, 12_000);
    return () => window.clearInterval(id);
  }, [dirHandle, roomId, eventId, deviceToken, enabled, downloadVersion, fetchVersions]);

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
      await downloadVersion(versionId, item.storageKey, item.filename, dirHandle);
    },
    [dirHandle, items, downloadVersion],
  );

  return { supported, dirHandle, items, pickFolder, clearFolder, retryItem };
}
