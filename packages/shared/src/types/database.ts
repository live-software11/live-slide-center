/**
 * Placeholder: rigenerare con
 * `supabase gen types typescript --project-id <REF> > packages/shared/src/types/database.ts`
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = Record<string, never>;
