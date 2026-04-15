# Room Agent — Live SLIDE CENTER

Applicazione desktop leggera (Tauri v2, Rust) installata su ogni **PC sala** durante un evento.

## Funzionalità

- Polling ogni 5 secondi verso il **Local Agent** LAN per nuovi file della sala assegnata
- Download automatico nella cartella `C:\Users\<utente>\AppData\Local\SlideCenter\<roomId>\`
- Tray icon con stato (verde = sync, giallo = download, rosso = offline)
- Autostart al login di Windows (registro HKCU, nessuna UAC richiesta)
- Apertura cartella locale con un click

## Build

```bash
# Dalla root del monorepo
cd apps/room-agent/src-tauri
cargo tauri build
```

L'installer NSIS viene generato in `target/release/bundle/nsis/`.

## Setup tipico su PC sala

1. Installa `Live SLIDE CENTER Room Agent Setup.exe` (un solo click, nessuna UAC)
2. Avvia il Room Agent dalla tray
3. Nella UI: inserisci **IP:porta** del Local Agent (es. `192.168.1.100:8080`), **ID Sala**, **ID Evento**
4. Clicca **Connetti e avvia sync** — i file iniziano a scaricarsi automaticamente
5. Attiva **Avvio automatico** per far partire l'agent ad ogni accensione del PC

## Note sicurezza Windows 11

- Il Room Agent gira come utente normale (no UAC dopo installazione)
- Il profilo di rete deve essere "Privato" per permettere la comunicazione LAN — lo puoi impostare nelle impostazioni di rete Windows oppure via PowerShell (eseguito con privilegi admin la prima volta)
- I file scaricati non hanno Mark-of-the-Web → non vengono bloccati da SmartScreen
- Per firmare l'installer con code-signing: aggiungere `signtool` nel `tauri.conf.json` bundle section

## EN

Lightweight desktop tray app (Tauri v2, Rust) installed on each **room PC**.
Polls the Local Agent every 5 seconds, automatically downloads presentation files to a local folder, and supports Windows auto-start via HKCU registry (no UAC after install).
