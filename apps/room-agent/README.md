# Live SLIDE CENTER — Room Agent (Tauri v2)

Applicazione desktop leggera installata su ogni **PC sala** durante un evento.
Discovery automatica del Local Agent + polling + download cifrato + tray icon.

## Stato

Implementato fino a Sprint 3 (distribuzione desktop). Sprint 4 (sistema licenze
Live WORKS APP — client Tauri) e Sprint 5 (hardening commerciale) seguiranno.

## Build di sviluppo

```powershell
cd apps/room-agent/src-tauri
cargo tauri dev
```

## Build di distribuzione (NSIS + portable)

Dalla root del monorepo:

```
clean-and-build.bat   (doppio click)
```

Oppure singolarmente:

```powershell
cd apps/room-agent
npm run release:full
```

Output: `release/live-slide-center-room-agent/` con installer NSIS, portable
ZIP, e `SHA256SUMS.txt`.

Vedi `docs/Manuali/Manuale_Distribuzione.md` e
`docs/Manuali/Manuale_Installazione_Room_Agent.md` per dettagli operatore.

## Funzionalita Sprint 1+2 implementate

- Polling LAN ogni 5s verso il Local Agent (`http://<lan-ip>:8080`).
- Download in cartella `%LOCALAPPDATA%\SlideCenter\<roomId>\` con rename atomico
  (`<file>.part` -> `<file>`) e strip Mark-of-the-Web post-rename.
- Discovery 4-tier in cascata: UNC -> UDP broadcast -> mDNS -> IP manuale, cache
  60s.
- Tray icon Windows con stato sync.
- Autostart al login utente via HKCU (no UAC al boot).
- NSIS installer hooks (Defender exclusion + rete Private + UDP 5353 mDNS).
- Comando Tauri `set_network_private` esposto.

## Architettura runtime

```
┌─ Tauri main thread ─────────────────────────────────────┐
│  ├─ Tray icon          (std)           sync indicator   │
│  ├─ Poller             (tokio loop)    5s GET /files    │
│  ├─ Downloader         (tokio task)    rename + MOTW    │
│  ├─ Discovery cascata  (on-demand)     UNC/UDP/mDNS/IP  │
│  └─ Autostart HKCU     (std)           start at login   │
└──────────────────────────────────────────────────────────┘
```

## EN

Lightweight desktop tray app installed on each **room PC** during an event.
Auto-discovers the Local Agent on the LAN, polls it every 5 seconds for new
presentation versions, downloads to a local folder with atomic renames and
Mark-of-the-Web stripping. Auto-starts at user login via HKCU (no UAC).
Implemented through Sprint 3 (desktop distribution). See `docs/Manuali/` for
operator manuals.
