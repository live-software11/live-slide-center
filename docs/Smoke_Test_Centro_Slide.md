# Smoke Test Centro Slide — Checklist QA end-to-end

> **Per chi:** sviluppatori (Andrea + AI agent) prima di taggare una nuova release desktop.
> **Tempo:** 30-45 minuti per il flusso completo.
> **Output:** documento compilato (copy/paste in CHANGELOG/release notes).

---

## Setup ambiente test

- [ ] **2 PC Windows 10/11** sulla stessa LAN privata (anche 1 PC fisico + 1 VM va bene).
- [ ] **1 dispositivo per browser admin** (laptop, tablet, anche il PC1 stesso in browser).
- [ ] **1 account cloud Live SLIDE CENTER** (admin di test su `app.liveslidecenter.com` o Vercel).
- [ ] **PC1** = Centro Slide/admin desktop. PC2 = sala/player desktop.
- [ ] **Rete:** stesso switch o router (no VLAN, no VPN).

---

## 1. Build & installer

- [ ] `pnpm typecheck` → 0 errori.
- [ ] `pnpm lint` → 0 warning relativi al desktop o feature `desktop-devices`.
- [ ] `pnpm test` (se applicabile) → tutti i test passano.
- [ ] `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` → 0 errori.
- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin slide-center-desktop license::` → 7+ test passano.
- [ ] Build firmata locale: `apps/desktop/scripts/release.ps1 -Signed` → installer NSIS + .sig + latest.json generati in `apps/desktop/release/`.
- [ ] Verifica integrità: `Get-FileHash` sull'installer ritorna lo stesso hash registrato in CHANGELOG.

## 2. Installazione PC1 (Centro Slide)

- [ ] Doppio click installer → SmartScreen warning (se signing self-signed) → "Esegui comunque".
- [ ] Selezione lingua: Italiano disponibile e default OK.
- [ ] EULA mostrato in italiano.
- [ ] Installazione completa in <60s.
- [ ] **Verifica firewall:** `Get-NetFirewallRule -DisplayName "*SLIDE CENTER*"` → regola creata, profilo Privato attivo.
- [ ] **Verifica Defender exclusion:** `Get-MpPreference | Select ExclusionPath` → cartella app inclusa.
- [ ] **Verifica menu Start:** voce "Live SLIDE CENTER" + icona desktop creati.

## 3. Primo avvio PC1

- [ ] Doppio click icona desktop → finestra Tauri si apre in <3s.
- [ ] Schermata "Scegli ruolo" appare al primo avvio. Selezionato "admin".
- [ ] Restart automatico dopo scelta ruolo.
- [ ] Server locale risponde: `Invoke-WebRequest http://127.0.0.1:7300/health` → 200 OK con `{role: "admin"}`.
- [ ] mDNS attivo: `Get-NetUDPEndpoint -LocalPort 5353` → processo listener presente.

## 4. Bind licenza cloud

- [ ] Browser su laptop separato → login admin tenant test su `app.liveslidecenter.com` (o `live-slide-center.vercel.app`).
- [ ] Sidebar mostra voce "**Centri Slide**" (sezione Tools admin).
- [ ] Click "Centri Slide" → apre `/centri-slide` con 3 sezioni vuote (PC server, magic-link, ruoli).
- [ ] Click "Genera link" → dialog appare. Compila etichetta "Smoke Test PC1", scadenza 1h, max usi 1.
- [ ] Click "Genera" → dialog "Successo" mostra QR + URL.
- [ ] Click "Copia URL" → toast "Copiato!".
- [ ] Lista magic-link mostra 1 elemento "active".
- [ ] **Sul PC1 desktop:** apri Live SLIDE CENTER → menu sinistra → "Licenza" (o vai a `/centro-slide/licenza`).
- [ ] Banner sticky "Centro Slide non collegato al cloud" visibile in cima.
- [ ] Incolla magic-link nel campo input → click "Collega".
- [ ] Loader 1-2s → success: "Licenza attiva — Tenant: <nome>, Plan: <piano>".
- [ ] Banner sticky scompare.
- [ ] **Sul cloud admin:** refresh pagina Centri Slide → ora vedo PC1 nella lista "PC server collegati" con badge "Online".

## 5. Test heartbeat (Sprint D6)

- [ ] **Su PC1:** wait 30 secondi dopo il primo bind → controllo log:
  ```powershell
  Get-Content "$env:LOCALAPPDATA\Live SLIDE CENTER\logs\app.log" -Tail 30 | Select-String "heartbeat"
  ```
  → deve apparire "Sprint D6 — heartbeat licenza desktop schedulato" e "Sprint D6 — heartbeat OK".
- [ ] **Test offline grace:** disconnetti PC1 da internet (cavo o WiFi off). Aspetta 1 min.
- [ ] In licenza pagina, badge resta "Active" (siamo in grace ben sotto le 24h).
- [ ] Riconnetti internet → click "Verifica ora" → toast success.
- [ ] **Su cloud admin:** `last_seen_at` di PC1 aggiornato (entro 60s).

## 6. Pannello admin Centri Slide — Magic-link e revoca

- [ ] Genera nuovo magic-link → consumalo da un PC2 di test (o forza errore "exhausted" creando 2 PC con maxUses=1).
- [ ] Click "Revoca" su un magic-link inutilizzato → conferma → lista aggiornata.
- [ ] Stampa QR del magic-link → window di stampa si apre, QR visibile, no chiamate a `api.qrserver.com` (verifica Network tab DevTools).

## 7. Pannello admin Centri Slide — Toggle ruolo PC sala

- [ ] **PC2:** installa Live SLIDE CENTER Desktop, scegli ruolo "sala".
- [ ] Genera magic-link sala dalla pagina evento (RoomProvisionTokensPanel) → apri su PC2 → bind automatico.
- [ ] **Sul cloud:** pannello Centri Slide → sezione "Ruolo PC sala" mostra PC2 con badge "Sala".
- [ ] Click "Promuovi a Centro Slide" → conferma → badge cambia in "Centro Slide", `room_id` viene azzerato.
- [ ] Refresh: stato persiste.
- [ ] Click "Riporta a sala" → conferma → badge torna "Sala".

## 8. Magic-link deep-link `/centro-slide/bind`

- [ ] **In browser cloud:** apri direttamente `https://<dominio>/centro-slide/bind?t=<un_token_valido>` → vedi pagina "Stai aprendo questo link nel browser" (modalità cloud).
- [ ] **Sul PC1 desktop:** apri il magic-link nel browser interno → bind automatico parte → success → redirect a `/`.

## 9. Aggiornamenti automatici (manuale, opzionale)

- [ ] Bumpa versione locale a 0.1.99 (test).
- [ ] Pubblica release fake con `latest.json` che punta alla versione attuale-1 → l'app **non** offre update.
- [ ] Pubblica release fake con `latest.json` che punta alla 0.2.0 → banner "Aggiornamento disponibile" appare in <30 min.
- [ ] Click "Installa" → download progress (silenzioso) → app si chiude → installer NSIS parte in modalità passive → app riapre automaticamente alla 0.2.0.
- [ ] Verifica `cmd_app_info` ritorna versione 0.2.0.

## 10. Disinstallazione

- [ ] **Impostazioni → App → Live SLIDE CENTER → Disinstalla.**
- [ ] Dialog "Conservare i dati dell'evento?" appare.
- [ ] Scegli "Sì" → uninstaller rimuove app ma `~/SlideCenter` resta.
- [ ] Reinstalla → al primo avvio i dati pre-esistenti sono visibili (eventi, file).
- [ ] Disinstalla di nuovo → scegli "No" → uninstaller cancella `~/SlideCenter`.
- [ ] **Verifica firewall rules rimosse:** `Get-NetFirewallRule -DisplayName "*SLIDE CENTER*"` → 0 risultati.
- [ ] **Verifica Defender exclusions rimosse:** `Get-MpPreference | Select ExclusionPath` → cartella non più presente.
- [ ] **Verifica menu Start vuoto:** voce "Live SLIDE CENTER" rimossa.
- [ ] **Verifica:** `~/.slidecenter/license.enc` resta sul disco (così reinstallando non serve ribindare).

## 11. Edge cases (regressione)

- [ ] **Bind con token già consumato:** errore "token_exhausted" mostrato in italiano.
- [ ] **Bind con token revocato:** errore "token_revoked".
- [ ] **Verify dopo revoca PC dal cloud:** prossimo heartbeat ritorna "device_revoked", banner sticky "Questo PC e' stato scollegato dal cloud" appare.
- [ ] **Verify con tenant sospeso:** banner "Account cloud sospeso" appare.
- [ ] **2 PC desktop legati allo stesso tenant:** entrambi visibili in lista admin, heartbeat indipendenti.
- [ ] **Restart PC senza internet:** app parte, server locale pronto, banner "Centro Slide offline" presente, modalità LAN funziona.

## 12. RLS & isolation tenant

- [ ] **Tenant A admin** vede solo i propri PC desktop in `/centri-slide`.
- [ ] **Tenant B admin** non vede PC desktop di Tenant A.
- [ ] Magic-link generato da Tenant A non può essere usato per bindare PC sotto Tenant B (la RPC ritorna `tenant_mismatch`).

---

## Output report

Compila questa sezione al termine del test e includila nel CHANGELOG.

```markdown
### Smoke test Centro Slide — v<X.Y.Z>

- **Data:** <YYYY-MM-DD>
- **Tester:** <nome>
- **Hardware:** PC1 = <CPU/RAM>, PC2 = <CPU/RAM>, switch = <modello>
- **OS:** PC1 = Windows <ver>, PC2 = Windows <ver>
- **Risultato:** ✅ PASS / ❌ FAIL

### Note / blocking issues

- [...]

### Tempo totale

- Setup: ___ min
- Test 1-7: ___ min
- Test 8-12: ___ min
- **Totale:** ___ min
```
