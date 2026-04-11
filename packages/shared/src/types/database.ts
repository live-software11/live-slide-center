/**
 * Placeholder — rigenerare con:
 * npx supabase gen types typescript --project-id <REF> > packages/shared/src/types/database.ts
 *
 * Il tipo esatto viene sovrascritto dal comando sopra; questa interfaccia base
 * garantisce che il codice compili anche prima della generazione.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
