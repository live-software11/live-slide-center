import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { createVersionDownloadUrl } from '@/features/presentations/repository';
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

/** Carica le versioni correnti (status='ready') per tutte le sessioni della sala — single-pass */
async function loadVersionsForRoom(
  roomId: string,
  eventId: string,
): Promise<Array<{ versionId: string; storageKey: string; filename: string; speakerName: string }>> {
  const supabase = getSupabaseBrowserClient();

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id')
    .eq('room_id', roomId)
    .eq('event_id', eventId);

  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);

  const { data: presentations } = await supabase
    .from('presentations')
    .select('id, current_version_id, speakers!inner(full_name)')
    .in('session_id', sessionIds)
    .not('current_version_id', 'is', null);

  if (!presentations || presentations.length === 0) return [];

  const versionIds = presentations
    .map((p) => p.current_version_id)
    .filter((id): id is string => !!id);

  if (versionIds.length === 0) return [];

  const { data: versions } = await supabase
    .from('presentation_versions')
    .select('id, storage_key, file_name')
    .in('id', versionIds)
    .eq('status', 'ready');

  if (!versions || versions.length === 0) return [];

  const versionMap = new Map(versions.map((v) => [v.id, v]));

  const results: Array<{ versionId: string; storageKey: string; filename: string; speakerName: string }> = [];
  for (const pres of presentations) {
    const version = versionMap.get(pres.current_version_id!);
    if (!version?.storage_key) continue;

    const speakerName = Array.isArray(pres.speakers)
      ? (pres.speakers[0] as { full_name: string })?.full_name ?? '—'
      : (pres.speakers as unknown as { full_name: string })?.full_name ?? '—';

    results.push({
      versionId: version.id,
      storageKey: version.storage_key,
      filename: version.file_name ?? `file_${version.id}`,
      speakerName,
    });
  }

  return results;
}

export function useFileSync({ roomId, roomName, eventId, enabled }: UseFileSyncParams): UseFileSyncResult {
  const supported = isFsAccessSupported();
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [items, setItems] = useState<FileSyncItem[]>([]);
  const syncedVersionIds = useRef<Set<string>>(new Set());

  // Ripristina handle da IndexedDB al mount
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

        const signedUrl = await createVersionDownloadUrl(storageKey);
        await downloadFileToDir(handle, roomName, filename, signedUrl, (pct) => {
          setItems((prev) =>
            prev.map((i) => (i.versionId === versionId ? { ...i, progress: pct } : i)),
          );
        });

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
    [roomName],
  );

  // Carica le versioni e avvia i download quando dirHandle è disponibile
  useEffect(() => {
    if (!dirHandle || !roomId || !eventId || !enabled) return;
    let cancelled = false;

    async function syncAll() {
      const versions = await loadVersionsForRoom(roomId, eventId);
      if (cancelled) return;

      // Aggiorna lista items (aggiunge nuovi, non rimuove esistenti)
      setItems((prev) => {
        const newItems: FileSyncItem[] = [];
        for (const v of versions) {
          const existing = prev.find((i) => i.versionId === v.versionId);
          if (!existing) {
            newItems.push({
              versionId: v.versionId,
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

      // Scarica i file pending
      for (const v of versions) {
        if (cancelled) break;
        if (!syncedVersionIds.current.has(v.versionId)) {
          await downloadVersion(v.versionId, v.storageKey, v.filename, dirHandle!);
        }
      }
    }

    void syncAll();
    return () => { cancelled = true; };
  }, [dirHandle, roomId, eventId, enabled, downloadVersion]);

  // Realtime: ascolta cambi su presentations (scoped per sala/evento via session_id)
  // Quando current_version_id cambia, ri-sincronizza le versioni ready della sala.
  useEffect(() => {
    if (!dirHandle || !roomId || !eventId || !enabled) return;
    let cancelled = false;

    const supabase = getSupabaseBrowserClient();

    async function resyncRoom() {
      const versions = await loadVersionsForRoom(roomId, eventId);
      if (cancelled) return;
      for (const v of versions) {
        if (cancelled) break;
        if (!syncedVersionIds.current.has(v.versionId)) {
          setItems((prev) => {
            const exists = prev.some((i) => i.versionId === v.versionId);
            if (exists) return prev;
            return [...prev, {
              versionId: v.versionId,
              filename: v.filename,
              speakerName: v.speakerName,
              status: 'pending' as const,
              progress: 0,
              errorMessage: null,
            }];
          });
          await downloadVersion(v.versionId, v.storageKey, v.filename, dirHandle!);
        }
      }
    }

    const channel = supabase
      .channel(`file-sync:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'presentations',
        },
        () => { void resyncRoom(); },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'presentations',
        },
        () => { void resyncRoom(); },
      )
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(channel); };
  }, [dirHandle, roomId, eventId, enabled, downloadVersion]);

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

      const supabase = getSupabaseBrowserClient();
      const { data: version } = await supabase
        .from('presentation_versions')
        .select('storage_key, file_name')
        .eq('id', versionId)
        .maybeSingle();
      if (!version?.storage_key) return;

      setItems((prev) =>
        prev.map((i) => (i.versionId === versionId ? { ...i, status: 'pending' as const } : i)),
      );
      await downloadVersion(versionId, version.storage_key, version.file_name ?? `file_${versionId}`, dirHandle);
    },
    [dirHandle, items, downloadVersion],
  );

  return { supported, dirHandle, items, pickFolder, clearFolder, retryItem };
}
