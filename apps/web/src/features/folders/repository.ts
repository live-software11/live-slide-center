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

/**
 * Sprint U-3 (File Explorer V2): garantisce che esista una catena di
 * sotto-cartelle a partire da `parentId`, creando solo le mancanti.
 *
 * USE CASE: l'utente droppa "ConferenzaABC/SalaPlenaria/SessioneMattina/file.pptx"
 * dal SO. Vogliamo ricreare quella struttura come folders + caricare il file
 * nella folder finale. `segments = ["ConferenzaABC", "SalaPlenaria", "SessioneMattina"]`.
 *
 * STRATEGIA:
 *  1. Per ogni segmento, cerca una folder con (event_id, parent_id, name).
 *  2. Se esiste, riusa il suo id come parent del segmento successivo.
 *  3. Se non esiste, la crea via `createEventFolder`.
 *
 * Non e' atomica: se la creazione fallisce a meta', le folders gia' create
 * restano (che e' OK — l'utente le vede nel tree e puo' riprovare l'upload).
 *
 * Ritorna l'ID della folder finale (deepest).
 */
export interface EnsureFolderPathInput {
  tenantId: string;
  eventId: string;
  parentId: string | null;
  segments: string[];
}

export async function ensureFolderPath(input: EnsureFolderPathInput): Promise<string | null> {
  const segments = input.segments
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200);
  if (segments.length === 0) return input.parentId;

  // Pre-fetch tutte le folders dell'evento (un solo round-trip).
  // Per eventi tipici (10-100 folders) il payload e' piccolo.
  const allFolders = await listEventFolders(input.eventId);
  const byParentName = new Map<string, EventFolderRow>();
  for (const f of allFolders) {
    const k = `${f.parent_id ?? 'root'}::${f.name.toLowerCase()}`;
    byParentName.set(k, f);
  }

  let currentParent: string | null = input.parentId;
  for (const seg of segments) {
    const k = `${currentParent ?? 'root'}::${seg.toLowerCase()}`;
    const existing = byParentName.get(k);
    if (existing) {
      currentParent = existing.id;
      continue;
    }
    const created = await createEventFolder({
      tenantId: input.tenantId,
      eventId: input.eventId,
      parentId: currentParent,
      name: seg,
    });
    const newKey = `${currentParent ?? 'root'}::${seg.toLowerCase()}`;
    byParentName.set(newKey, created);
    currentParent = created.id;
  }
  return currentParent;
}
