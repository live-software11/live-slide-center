import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

import { getSupabaseBrowserClient } from '@/lib/supabase';

/**
 * Sprint U-2 (UX redesign V2.0): repository per la gerarchia cartelle
 * `event_folders` usata dalla nuova ProductionView.
 *
 * Niente realtime per ora — fetch on mount + refetch manuale dopo
 * mutazioni. Le mutazioni passano da Supabase client (RLS attiva,
 * policy admin/tech).
 */

export type EventFolderRow = Database['public']['Tables']['event_folders']['Row'];

export interface FolderTreeNode extends EventFolderRow {
  children: FolderTreeNode[];
  /** Livello nella gerarchia (0 = root, 1 = sotto root, ...). */
  depth: number;
}

function client(): SupabaseClient<Database> {
  return getSupabaseBrowserClient();
}

/**
 * Lista tutte le cartelle di un evento (no paginazione: assumiamo
 * dimensioni umane — un evento tipico ha 10-100 cartelle).
 */
export async function listEventFolders(eventId: string): Promise<EventFolderRow[]> {
  const { data, error } = await client()
    .from('event_folders')
    .select('*')
    .eq('event_id', eventId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Costruisce un albero gerarchico dalle cartelle flat. Le orfane
 * (parent_id che non esiste piu') sono trattate come root.
 */
export function buildFolderTree(rows: EventFolderRow[]): FolderTreeNode[] {
  const byId = new Map<string, FolderTreeNode>();
  rows.forEach((r) => byId.set(r.id, { ...r, children: [], depth: 0 }));
  const roots: FolderTreeNode[] = [];
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) {
      const parent = byId.get(node.parent_id)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // ricalcolo depth ricorsivo (i parent potrebbero essere stati toccati dopo i figli)
  function fixDepth(nodes: FolderTreeNode[], depth: number): void {
    for (const n of nodes) {
      n.depth = depth;
      fixDepth(n.children, depth + 1);
    }
  }
  fixDepth(roots, 0);
  // ordinamento alfabetico ad ogni livello
  function sortRec(nodes: FolderTreeNode[]): void {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    nodes.forEach((n) => sortRec(n.children));
  }
  sortRec(roots);
  return roots;
}

export interface CreateFolderInput {
  tenantId: string;
  eventId: string;
  parentId: string | null;
  name: string;
}

export async function createEventFolder(input: CreateFolderInput): Promise<EventFolderRow> {
  const trimmed = input.name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new Error('folder.errors.nameLength');
  }
  const { data, error } = await client()
    .from('event_folders')
    .insert({
      tenant_id: input.tenantId,
      event_id: input.eventId,
      parent_id: input.parentId,
      name: trimmed,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function renameEventFolder(folderId: string, name: string): Promise<EventFolderRow> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new Error('folder.errors.nameLength');
  }
  const { data, error } = await client()
    .from('event_folders')
    .update({ name: trimmed })
    .eq('id', folderId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteEventFolder(folderId: string): Promise<void> {
  const { error } = await client().from('event_folders').delete().eq('id', folderId);
  if (error) throw new Error(error.message);
}

/**
 * Sposta N presentations in una folder (o root se folderId === null).
 * Usa la RPC `move_presentations_to_folder` per atomicita' + activity_log
 * + check tenant/event server-side.
 */
export async function movePresentationsToFolder(
  presentationIds: string[],
  folderId: string | null,
): Promise<number> {
  if (presentationIds.length === 0) return 0;
  // `p_folder_id` accetta NULL runtime (= sposta in root), ma il type
  // generator lo riflette come `string` non-nullable. Cast intenzionale.
  const { data, error } = await client().rpc('move_presentations_to_folder', {
    p_presentation_ids: presentationIds,
    p_folder_id: folderId as unknown as string,
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}
