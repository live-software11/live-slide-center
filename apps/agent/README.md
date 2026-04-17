# Live SLIDE CENTER — Local Agent (Tauri v2 + Axum)

Applicazione desktop installata sul **mini-PC in regia** durante l'evento.
Cache locale presentazioni + server HTTP LAN + discovery LAN per i Room Agent.

## Stato

Implementato fino a Sprint 3 (distribuzione desktop). Sprint 4 (sistema licenze
Live WORKS APP — client Tauri) e Sprint 5 (hardening commerciale) seguiranno.

## Build di sviluppo

```powershell
# Hot reload UI + Rust (richiede cargo + cargo-tauri)
cd apps/agent/src-tauri
cargo tauri dev
```

## Build di distribuzione (NSIS + portable)

Dalla root del monorepo:

```
clean-and-build.bat   (doppio click)
```

Oppure singolarmente:

```powershell
cd apps/agent
npm run release:full
```

Output: `release/live-slide-center-agent/` con installer NSIS, portable ZIP,
e `SHA256SUMS.txt`.

Vedi `docs/Manuali/Manuale_Distribuzione.md` e
`docs/Manuali/Manuale_Installazione_Local_Agent.md` per dettagli operatore.

## Funzionalita Sprint 1+2 implementate

- HTTP server Axum su `:8080` (`/api/v1/files/{event_id}/{filename}`).
- SQLite WAL cache (`%LOCALAPPDATA%\LiveSLIDECENTER\cache.db`).
- Sync continuo da Supabase Storage con SHA-256 verify.
- Discovery responder UDP `:9999` + mDNS `_slide-center._tcp.local.`
- NSIS installer hooks (firewall + Defender exclusion + rete Private).
- WebView2 Bootstrapper silent install.

## Architettura runtime

```
┌─ Tauri main thread ─────────────────────────────────────┐
│  ├─ Axum HTTP server   (tokio)        :8080             │
│  ├─ Sync worker        (tokio loop)   30s polling cloud │
│  ├─ UDP discovery      (tokio task)   :9999             │
│  └─ mDNS daemon        (std thread)   _slide-center._tcp│
└──────────────────────────────────────────────────────────┘
```

`mdns-sd` daemon gira in `std::thread::Builder` dedicato perche' il suo
runtime interno non e' compatibile con `tokio::spawn_blocking`.

## EN

Desktop application installed on the **control room mini-PC** during the event.
Local presentation cache + LAN HTTP server + LAN discovery for Room Agents.
Implemented through Sprint 3 (desktop distribution). See `docs/Manuali/` for
operator manuals.
