// Sprint K + Sprint N (GUIDA_OPERATIVA_v3 §4.C + §4.F) — modulo aggregatore per le route HTTP.
//
// Ogni sotto-modulo registra una sezione del Router globale (vedi `server/mod.rs`):
//   • rest         → /rest/v1/<table>     (PostgREST minimal)
//   • rpc          → /rest/v1/rpc/<name>  (Supabase RPC mirror)
//   • storage_routes → /storage/v1/object/... e /storage-files/...
//   • functions    → /functions/v1/<name> (Supabase Edge Functions mirror)
//   • lan_events_routes → /events/file_added + /events/presentation_deleted (push admin → sala)
//                        + /events/stream (long-poll sala → SPA webview) — Sprint N2-N3

pub mod functions;
pub mod lan_events_routes;
pub mod rest;
pub mod rpc;
pub mod storage_routes;
