# PIANO_FINALE_SLIDE_CENTER_v2.md

> **Documento operativo FINALE — versione corretta e allineata.** Sostituisce v1 (eliminato).
> **Versione:** 2.7 — 17 Aprile 2026 (chiusura Sprint 6: onboarding wizard + demo data + healthcheck pubblico + dashboard admin/health)
> **Stato progetto:** Fasi 0-13 + Fase 14 al 100%. Web `apps/web` completo. Sprint 2 (intranet offline + bypass Windows 11) **DONE**. Sprint 3 (distribuzione desktop) **DONE**. Sprint 4 (sistema licenze centralizzato) **DONE**. Sprint 5 (hardening + materiali pre-vendita) **DONE in-repo** (v2.5). Sprint 5b (code-signing + CI completa + manuali) **DONE in-repo** (v2.6). **Sprint 6 (v2.7) DONE in-repo:** colonna `tenants.onboarded_at` + 5 RPC SECURITY DEFINER (`mark_tenant_onboarded`, `reset_tenant_onboarding`, `seed_demo_data` idempotente, `clear_demo_data` cascade su `settings.demo='true'`, `tenant_health` super_admin only), `OnboardingWizard.tsx` 3-step (welcome / crea evento o demo / next step team+agent) montato in `RootLayout` via `OnboardingGate` con auto-trigger admin-only sul primo login, sezione Demo & Onboarding in Settings (`/settings`) con 3 azioni (genera demo + cancella demo + riapri tour) e feedback async, empty states migliorati in `EventsView` + `TeamView` con CTA contestuali (link a "genera demo" / bottone "invita team"), `apps/web/public/healthcheck.json` statico per uptime monitor esterni (UptimeRobot/BetterUptime), pagina `/admin/health` super-admin con ping Supabase + ping Edge Functions (`team-invite-accept`, `licensing-sync` con accept-401-as-online) + counter aggregati via `tenant_health()`, parity i18n IT/EN su tutte le nuove stringhe (~50 chiavi), ADR-015 sulla scelta `tenants.onboarded_at` + RPC self-call. **Manca SOLO azione esterna Andrea**: acquisto cert OV Sectigo (~190 €/anno), registrazione 3 screencast (1 giornata), revisione legale SLA (avvocato GDPR), listing prodotti su `liveworksapp.com`.
> **Obiettivi residui — roadmap finale verso vendita:**
>
> 1. ~~Modalita intranet completamente offline con bypass permessi Windows 11 (Sprint 2)~~ ✅ DONE
> 2. ~~Distribuzione desktop dei due Agent: `clean-and-build.bat` che produce installer NSIS + portable in `release/` (Sprint 3)~~ ✅ DONE
> 3. ~~Sistema licenze centralizzato Live WORKS APP — lato cloud (v2.1) + lato client Tauri (v2.4) (Sprint 4)~~ ✅ DONE
> 4. ~~Hardening commerciale + materiali pre-vendita (Sprint 5 in-repo)~~ ✅ DONE in v2.5
> 5. ~~Code-signing integration ready + CI completa + manuali operativi (Sprint 5b)~~ ✅ DONE in v2.6
> 6. ~~Onboarding wizard + demo data + healthcheck (Sprint 6 in-repo)~~ ✅ DONE in v2.7
> 7. **Azioni esterne Andrea (non automatizzabili):** acquisto certificato OV Sectigo per code-signing (~190 €/anno, 1-2 settimane di emissione — guida operativa in `docs/Manuali/Manuale_Code_Signing.md`), revisione `docs/Commerciale/Contratto_SLA.md` con avvocato GDPR, registrazione 3 screencast onboarding (scaletta in `docs/Manuali/Script_Screencast.md`), listing prodotti su sito marketing `liveworksapp.com`, configurazione UptimeRobot puntato su `https://app.liveworksapp.com/healthcheck.json`.

---

## Indice

0. [Premessa e correzioni rispetto a v1](#0-premessa-e-correzioni-rispetto-a-v1)
1. [Stato corrente del repo (audit 17/04/2026)](#1-stato-corrente-del-repo-audit-17042026)
2. [Sprint 1 — chiuso al 100% (verifica)](#2-sprint-1--chiuso-al-100-verifica)
3. [Sprint 2 — Intranet offline + bypass Windows 11](#3-sprint-2--intranet-offline--bypass-windows-11)
4. [Sprint 3 — Distribuzione desktop (`clean-and-build.bat`)](#4-sprint-3--distribuzione-desktop-clean-and-buildbat)
5. [Sprint 4 — Sistema licenze Live WORKS APP](#5-sprint-4--sistema-licenze-live-works-app)
6. [Sprint 5 + 5b — Hardening commerciale + CI completa + manuali pre-vendita](#6-sprint-5--hardening-commerciale--materiali-pre-vendita)
7. [Sprint 6 — Onboarding wizard + demo data + healthcheck](#7-sprint-6--onboarding-wizard--demo-data--healthcheck)
8. [Rischi e mitigazioni](#8-rischi-e-mitigazioni)
9. [Riferimenti incrociati](#9-riferimenti-incrociati)

---

## 0. Premessa e correzioni rispetto a v1

Durante l'audit del 17/04/2026 sono emersi tre disallineamenti tra v1 e codice reale:

| Tema                              | v1 (errato/incompleto)                           | v2 (verificato in codice)                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API licenze Live WORKS**        | usava `verify_before`, `expires_at` (snake_case) | nomi reali camelCase: `verifyBeforeDate`, `nextVerifyDate`, `expiresAt`. Reference: `Live WORKS APP/functions/src/types/index.ts`                                                                                                                        |
| **Stato Sprint 1**                | "da implementare"                                | tutto il codice e gia in repo (migration `20260417100000_team_invitations.sql`, Edge Function `team-invite-accept/`, viste auth, `TeamView`, Playwright config + 3 spec, `rls_audit.sql`, `ErrorBoundary` + `unhandledrejection` listener in `main.tsx`) |
| **Identita prodotti per licenze** | implicita / un solo `productId`                  | due `productId` distinti per pricing autonomo: `slide-center-agent` (Local Agent, mini-PC regia, 1 attivazione/evento) e `slide-center-room-agent` (Room Agent, PC sala, N attivazioni/evento)                                                           |

Inoltre v2 introduce dettagli omessi in v1:

- **HMAC token Live WORKS APP** = `HMAC-SHA256(payload+timestamp, LICENSE_TOKEN_SECRET)` base64 (vedi `Live WORKS APP/functions/src/license/token.ts`).
- **Fingerprint hardware Windows** = `SHA-256(MotherboardSerial || ProcessorId || DiskSerial)` via WMI (`wmi` crate Rust). Pattern identico a `Live 3d Ledwall Render/src-tauri/src/license/fingerprint.rs`.
- **Cifratura locale licenza** = AES-256-GCM con chiave hard-coded per prodotto (32 byte). Chiave **diversa per ogni prodotto** per impedire copy/paste tra installazioni.
- **`pendingApproval`** = primo bind richiede approvazione manuale dalla dashboard Live WORKS APP (Andrea), tranne per checkout Lemon Squeezy automatici dove `requiresApproval=false` lato server.

---

## 1. Stato corrente del repo (audit 17/04/2026)

### 1.1 Web (`apps/web`) — pronto per vendita

| Area                              | Stato | Riferimenti                                                                                                           |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| Auth multi-tenant + super-admin   | 100%  | `LoginView`, `SignupView`, `RequireAuth`, `RequireSuperAdmin`, `RequireTenantAdmin`                                   |
| CRUD Eventi/Sale/Sessioni/Speaker | 100%  | `apps/web/src/features/events/*`, RPC `rpc_reorder_sessions`, trigger `check_*_quota`                                 |
| Upload Portal TUS + SHA-256       | 100%  | `/u/:token`, RPC `validate_upload_token` / `init_upload_version` / `finalize_upload_version` / `abort_upload_version` |
| Versioning + storico + review     | 100%  | `rpc_set_current_version`, `rpc_update_presentation_status`, trigger `guard_versions_immutable`                       |
| Vista Regia realtime              | 100%  | `LiveRegiaView`, Realtime su 5 tabelle, polling `activity_log` 10s                                                    |
| Pairing device + Room Player PWA  | 100%  | 4 Edge Functions, `/pair`, `/sala/:token` con File System Access API                                                  |
| Dual-mode cloud/intranet/hybrid   | 100%  | ENUM `network_mode`, Edge Function `room-player-bootstrap`, `useFileSync`                                             |
| Super-admin console               | 100%  | `/admin/*`, `tenants.suspended`, audit cross-tenant                                                                   |
| Export fine evento                | 100%  | `EventExportPanel` ZIP+CSV+PDF                                                                                        |
| Billing UI Lemon Squeezy          | 100%  | `/billing` admin-only, link checkout/portale da env, **webhook in-repo rimandato**                                    |
| i18n IT/EN                        | 100%  | parity `it.json`/`en.json`, detector localStorage+navigator                                                           |
| Integrazioni ecosistema           | 100%  | `/settings` deep link Timer/CREW da env                                                                               |
| Sentry + ErrorBoundary            | 100%  | lazy init in `init-sentry.ts`, `ErrorBoundary` con `captureException`, listener `unhandledrejection` in `main.tsx`    |
| Inviti team + accept-invite       | 100%  | migration + Edge Function + `TeamView` + `AcceptInviteView`                                                           |
| Password reset (forgot/reset)     | 100%  | `ForgotPasswordView` + `ResetPasswordView` + link in `LoginView`                                                      |
| Playwright E2E                    | 100%  | `playwright.config.ts` + `e2e/{smoke,signup-flow,rls-isolation}.spec.ts`                                              |
| Audit RLS SQL                     | 100%  | `supabase/tests/rls_audit.sql`                                                                                        |
| Rate limit pair-claim             | 100%  | tabella `pair_claim_rate_events` + Edge Function (5/15min)                                                            |
| RLS suspended cross-table         | 100%  | funzione `current_tenant_suspended()` SECURITY DEFINER + policy granulari                                             |

### 1.2 Local Agent (`apps/agent`) — runtime DONE + distribuzione DONE (Sprint 3) + licenze DONE (Sprint 4)

Sorgente Rust + Axum gia presente (`apps/agent/src-tauri/src/{main,server,sync,db,state,routes,discovery}.rs`). README aggiornato.

**Stato Sprint 3:** workflow di build completo (`apps/agent/package.json` + `apps/agent/scripts/{clean,post-build}.mjs`), icone in `apps/agent/src-tauri/icons/` (alpha-channel RGBA verificate), `installer-hooks.nsi` Win11 attivi (vedi Sprint 2).

**Stato Sprint 4 (licenze):** modulo `apps/agent/src-tauri/src/license/` completo (7 file: `mod.rs` + `types.rs` + `crypto.rs` + `fingerprint.rs` + `api.rs` + `manager.rs` + `commands.rs`). Feature flag Cargo `license` opzionale (`cargo tauri build --features license` per build di vendita). Comandi Tauri `license_{activate,verify,deactivate,status,fingerprint}` registrati condizionalmente. UI `apps/agent/ui/index.html` con card "Licenza" + overlay full-screen di gating + polling 30s per `pendingApproval`. Hook NSIS pre-uninstall via `local-agent.exe --deactivate`. i18n IT/EN dinamico via `navigator.language` + chiavi `license.*` in `packages/shared/src/i18n/locales/`. **Pronto per Sprint 5** (code-signing + materiali pre-vendita).

### 1.3 Room Agent (`apps/room-agent`) — runtime DONE + distribuzione DONE (Sprint 3) + licenze DONE (Sprint 4)

Sorgente Rust completo, polling LAN ogni 5s, autostart HKCU, tray icon, `set_network_private` con sanitizzazione, MOTW strip, discovery 4-tier. README aggiornato.

**Stato Sprint 3:** workflow di build completo (`apps/room-agent/package.json` + `apps/room-agent/scripts/{clean,post-build}.mjs`), icone in `apps/room-agent/src-tauri/icons/`, `installer-hooks.nsi` Win11 attivi.

**Stato Sprint 4 (licenze):** modulo `apps/room-agent/src-tauri/src/license/` gemello al Local Agent (stesso pattern, `PRODUCT_ID="slide-center-room-agent"`, `APP_DATA_DIR="com.livesoftware.slidecenter.roomagent"`, chiave AES-256-GCM diversa per impedire copy/paste tra installazioni). Feature flag Cargo `license` opzionale, comandi Tauri condizionali, UI `apps/room-agent/ui/index.html` con card "Licenza" + overlay di gating + polling 30s, NSIS pre-uninstall via `room-agent.exe --deactivate`. **Pronto per Sprint 5**.

### 1.4 Documentazione e regole

- `docs/GUIDA_DEFINITIVA_PROGETTO.md` versione 4.8 — allineata a tutti i deliverable di v2.1.
- `.cursor/rules/` 14 regole `alwaysApply: true` (project-architecture, supabase-patterns, security-roles, react-components, data-tenant-isolation, code-quality-workflow, agent-workflow, docs-maintenance, deploy-git-workflow, github-account-live-software11, i18n-slide-center, mcp-supabase, surgical-review-next-step, guida-definitiva-doc-sync).

### 1.5 Aggiunte v2.1 (post Sprint 1, lavoro su feature trasversali)

| Area                                        | Stato | Riferimenti                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Upload diretto admin (drag-and-drop)        | 100%  | Migration `20260417110000_admin_uploads_and_move_presentation.sql` (RLS storage `tenant_insert_uploading_version` + 3 RPC `*_admin`); `AdminUploaderInline.tsx`; integrazione in `PresentationVersionsPanel.tsx` e `EventDetailView.tsx`                                       |
| Spostamento presentation tra speaker        | 100%  | RPC `rpc_move_presentation` nella stessa migration; `MovePresentationDialog.tsx`; hook `useEventPresentationSpeakerIds.ts` (Realtime presentations dell'evento)                                                                                                                |
| Fix 401 pair-init / pair-poll               | 100%  | `apps/web/src/features/devices/repository.ts` (`ensureFreshAccessToken`, `EdgeFunctionAuthError`, `EdgeFunctionMissingError`); `usePairingFlow.ts`; `PairingModal.tsx` con i18n IT+EN dedicati                                                                                 |
| Sync licenze Live WORKS APP — lato cloud    | 100%  | Migration `20260417120000_tenant_license_sync.sql` (colonne tenant + RPC `licensing_apply_quota`); Edge Function `supabase/functions/licensing-sync/` (HMAC SHA-256 + anti-replay)                                                                                             |
| Sync licenze Live WORKS APP — lato Firebase | 100%  | Estensione `LicenseDoc.slideCenter`; modulo SKU `slide-center-products.ts`; libreria HMAC `slide-center-sync.ts`; endpoint `POST /api/admin/slide-center/sync`; trigger Firestore `onLicenseChangedSyncSlideCenter` con anti-loop; UI `GenerateLicenseDialog` + `LicensesPage` |
| Seed Firestore (Live WORKS APP)             | 100%  | `functions/scripts/seed-firestore.mjs` con 3 prodotti `slide-center-{cloud,agent,room-agent}` + bundle `slide-center-suite`                                                                                                                                                    |
| Tipi `Database` shared aggiornati           | 100%  | `packages/shared/src/types/database.ts` con nuove colonne `tenants` + RPC `tenant_max_devices_per_room` e `licensing_apply_quota`                                                                                                                                              |

---

## 2. Sprint 1 — chiuso al 100% (verifica)

Tutti i deliverable sono in repo. Riferimento per ogni voce:

| Deliverable                                                              | File reale                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migration team_invitations                                               | `supabase/migrations/20260417100000_team_invitations.sql`                                                                                                                      |
| Edge Function team-invite-accept                                         | `supabase/functions/team-invite-accept/index.ts`                                                                                                                               |
| Config function (no JWT)                                                 | `supabase/config.toml` `[functions.team-invite-accept] verify_jwt = false`                                                                                                     |
| `TeamView`                                                               | `apps/web/src/features/team/TeamView.tsx`                                                                                                                                      |
| `AcceptInviteView`                                                       | `apps/web/src/features/auth/AcceptInviteView.tsx`                                                                                                                              |
| `ForgotPasswordView`                                                     | `apps/web/src/features/auth/ForgotPasswordView.tsx`                                                                                                                            |
| `ResetPasswordView`                                                      | `apps/web/src/features/auth/ResetPasswordView.tsx`                                                                                                                             |
| Link "Password dimenticata?"                                             | `apps/web/src/features/auth/LoginView.tsx`                                                                                                                                     |
| Playwright config                                                        | `apps/web/playwright.config.ts`                                                                                                                                                |
| Spec smoke / signup-flow / rls-isolation                                 | `apps/web/e2e/smoke.spec.ts`, `signup-flow.spec.ts`, `rls-isolation.spec.ts`                                                                                                   |
| RLS audit SQL                                                            | `supabase/tests/rls_audit.sql`                                                                                                                                                 |
| Sentry init lazy                                                         | `apps/web/src/lib/init-sentry.ts`                                                                                                                                              |
| ErrorBoundary                                                            | `apps/web/src/app/ErrorBoundary.tsx`                                                                                                                                           |
| Wrap `RouterProvider` in `ErrorBoundary` + `unhandledrejection` listener | `apps/web/src/main.tsx`                                                                                                                                                        |
| i18n keys IT+EN                                                          | `packages/shared/src/i18n/locales/it.json`, `en.json` (chiavi `team.*`, `auth.forgotPassword*`, `auth.resetPassword*`, `auth.acceptInvite*`, `validation.minLength`, `role.*`) |

**Manuale operativo (post-deploy):**

1. Applicare migration: SQL Editor Supabase Dashboard incolla `20260417100000_team_invitations.sql`.
2. Deploy Edge Function: `supabase functions deploy team-invite-accept --project-ref cdjxxxkrhgdkcpkkozdl --no-verify-jwt`.
3. Smoke E2E locale: `pnpm --filter @slidecenter/web exec playwright install && pnpm --filter @slidecenter/web exec playwright test`.

---

## 3. Sprint 2 — Intranet offline + bypass Windows 11 ✅ DONE (v2.2)

**Stato:** chiuso al 100% con questa revisione. Codice + installer hooks NSIS + UI Tauri/Web pronti per build.

**Riepilogo implementazione (v2.2):**

| Voce                                           | File                                                                                 | Note                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| NSIS hook Local Agent (firewall + Defender)    | `apps/agent/src-tauri/installer-hooks.nsi`                                           | Apre TCP 8080 + UDP 9999 + UDP 5353 in LAN; esclusione Defender; rete priv |
| NSIS hook Room Agent (Defender + WiFi profile) | `apps/room-agent/src-tauri/installer-hooks.nsi`                                      | Esclusione cartella output + apertura UDP 5353/effimere per reply mDNS     |
| WebView2 silent install                        | `apps/agent/src-tauri/tauri.conf.json` + `apps/room-agent/src-tauri/tauri.conf.json` | `embedBootstrapper` silent → no popup primo avvio                          |
| Discovery responder Local Agent (UDP + mDNS)   | `apps/agent/src-tauri/src/discovery.rs`                                              | UDP `:9999` query "slide-center" + mDNS `_slide-center._tcp.local.`        |
| Discovery client Room Agent (4-tier cascata)   | `apps/room-agent/src-tauri/src/discovery.rs`                                         | UNC → UDP broadcast → mDNS → manuale, cache 60s                            |
| MOTW strip su file scaricati                   | `apps/room-agent/src-tauri/src/motw.rs` + `downloader.rs`                            | Rimuove `Zone.Identifier` ADS dopo rename atomico                          |
| 4 stati connettività web                       | `apps/web/src/features/devices/hooks/useConnectivityMode.ts` + `RoomPlayerView.tsx`  | Health probe Local Agent ogni 15s + chip + banner                          |
| i18n chiavi `intranet.*`                       | `packages/shared/src/i18n/locales/it.json` + `en.json`                               | 4 stati + hint contestuali + 2 banner offline                              |

**Obiettivo originale:** un evento puo svolgersi su una rete LAN completamente disconnessa da internet, con il Local Agent in regia e i Room Agent sui PC sala. Nessun popup di Windows 11 deve apparire dopo l'installazione.

### 3.1 Bypass permessi Windows 11 — strategia integrata

**Filosofia:** non chiediamo permessi. L'installer NSIS gli applica al primo lancio in modalita admin **una sola volta**; il runtime gira come utente normale.

| Permesso Windows 11                      | Strategia                                                            | Implementazione                                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SmartScreen** (eseguibile non firmato) | Code-signing certificato Sectigo OV (~190 €/anno) o EV (~310 €/anno) | `signtool sign /f cert.pfx /p $env:CERT_PWD /tr http://timestamp.sectigo.com /td SHA256 /fd SHA256 *.exe`. **Workaround senza certificato:** istruzioni in installer "Maggiori informazioni → Esegui comunque" |
| **Firewall in entrata**                  | Regola al primo avvio installer                                      | `netsh advfirewall firewall add rule name="Live SLIDE Agent" dir=in action=allow protocol=TCP localport=8080 program="<install_dir>\live-slide-agent.exe" profile=private,domain`                              |
| **UAC** (User Account Control)           | `requestedExecutionLevel="asInvoker"` nel manifest Tauri             | Tauri NSIS `installMode=currentUser` + manifest livello `asInvoker`. Gia presente in `tauri.conf.json`                                                                                                         |
| **Defender real-time scan**              | Esclusione cartella per evitare scan ad ogni file scaricato          | `Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\SlideCenter"` (richiede admin: eseguito UNA volta da installer NSIS)                                                                                       |
| **Profilo rete** (Pubblica blocca LAN)   | Set Private dopo connessione                                         | `Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private` (admin); su Room Agent gia esposto come comando Tauri `set_network_private`                                                        |
| **Mark-of-the-Web** (file scaricati)     | Rimuovere ADS `Zone.Identifier`                                      | Funzione Rust `strip_mark_of_the_web` (vedi sotto)                                                                                                                                                             |
| **Autostart al login**                   | Solo HKCU (no admin runtime)                                         | `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`, gia implementato in Room Agent                                                                                                              |

**Hook NSIS personalizzato — `apps/agent/src-tauri/installer-hooks.nsi`** (e simile per Room Agent):

```nsi
!macro NSIS_HOOK_POSTINSTALL
  ; Regola firewall in ingresso (Local Agent serve LAN)
  ExecWait 'netsh advfirewall firewall add rule name="Live SLIDE Agent" dir=in action=allow protocol=TCP localport=8080 program="$INSTDIR\live-slide-agent.exe" profile=private,domain'

  ; Esclusione Defender (path cache)
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-MpPreference -ExclusionPath ''$LOCALAPPDATA\SlideCenter'' -Force"'

  ; Set rete WiFi attuale a Private (errore tollerato se nessuna rete)
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE Agent"'
!macroend
```

Configurazione in `tauri.conf.json` (vedi Sprint 3 per il merge completo):

```json
{
  "bundle": {
    "windows": {
      "nsis": {
        "installerHooks": "installer-hooks.nsi"
      }
    }
  }
}
```

### 3.2 Strip Mark-of-the-Web (MOTW) — `apps/room-agent/src-tauri/src/motw.rs`

```rust
//! Rimuove ADS `Zone.Identifier` per evitare blocchi SmartScreen sui file scaricati.

#[cfg(target_os = "windows")]
pub fn strip_mark_of_the_web(path: &std::path::Path) -> std::io::Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let ads_path = format!("{}:Zone.Identifier", path.display());
    let wide: Vec<u16> = OsStr::new(&ads_path).encode_wide().chain(Some(0)).collect();
    unsafe {
        let result = winapi::um::fileapi::DeleteFileW(wide.as_ptr());
        if result == 0 {
            let err = std::io::Error::last_os_error();
            // ERROR_FILE_NOT_FOUND (2) = nessuno stream MOTW = OK
            if err.raw_os_error() == Some(2) {
                return Ok(());
            }
            return Err(err);
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn strip_mark_of_the_web(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}
```

Da chiamare in `apps/room-agent/src-tauri/src/sync.rs` subito dopo ogni `tokio::fs::File::create(path).await?` + `tokio::io::copy(...)`:

```rust
let final_path = target_dir.join(&file_name);
tokio::fs::rename(&temp_path, &final_path).await?;
crate::motw::strip_mark_of_the_web(&final_path).ok(); // best-effort
```

Aggiungere in `Cargo.toml`:

```toml
[target.'cfg(windows)'.dependencies]
winapi = { version = "0.3", features = ["fileapi"] }
```

### 3.3 Discovery Local Agent senza cloud (intranet pura)

Sequenza di fallback in `apps/room-agent/src-tauri/src/discovery.rs`:

1. **File condiviso** `\\<NomePC-Regia>\SlideCenter$\agent.json` (UNC). Andrea pubblica una share con accesso anonimo letto da Room Agent (impostato dall'installer NSIS in regia).
2. **UDP broadcast** sulla rete LAN: Local Agent risponde a `255.255.255.255:9999` con `{"ip":"<lan_ip>","port":8080,"version":"<v>"}`.
3. **mDNS** `_slide-center._tcp.local` via crate `mdns-sd` (in app desktop e ammesso, le restrizioni sono solo per browser).
4. **IP manuale** input UI: ultimo fallback.

Ordine di tentativo: 1 → 2 → 3 → 4. Cache LRU 60s su discovery riuscita.

### 3.4 Health UI — chip "OFFLINE INTRANET"

Estendere `RoomPlayerView` (gia gestisce cloud/LAN/hybrid) e l'UI Tauri Room Agent con tre stati visibili:

| Stato           | Colore    | Significato                                           |
| --------------- | --------- | ----------------------------------------------------- |
| `cloud-direct`  | Verde     | Internet OK, fetch da Supabase                        |
| `lan-via-agent` | Verde-blu | LAN OK + Local Agent risponde                         |
| `intranet-only` | Giallo    | Internet KO, **funziona via Local Agent**             |
| `offline`       | Rosso     | Local Agent irraggiungibile, cache locale ultima nota |

Nessuna richiesta cloud quando `intranet-only`: il Room Agent non chiama Supabase ma solo Local Agent (`http://<lan_ip>:8080/api/v1/files/...`).

### 3.5 i18n — chiavi nuove Sprint 2

In `packages/shared/src/i18n/locales/it.json` e `en.json`:

```json
{
  "intranet": {
    "title": "Modalità intranet offline",
    "statusLabel": "Stato connessione",
    "statusCloud": "Cloud diretto",
    "statusLan": "LAN via Local Agent",
    "statusOnlyIntranet": "Solo intranet (offline)",
    "statusOffline": "Offline — cache locale",
    "discoveryFile": "File condiviso",
    "discoveryUdp": "Broadcast UDP",
    "discoveryMdns": "mDNS",
    "discoveryManual": "IP manuale"
  }
}
```

EN equivalente.

### 3.6 Test sul campo (acceptance criteria Sprint 2)

| Scenario                                            | Atteso                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| Router senza WAN, Local Agent + 2 Room Agent in LAN | `intranet-only` su tutti, file disponibili                               |
| Riavvio router → ritorno WAN                        | Local Agent riprende sync cloud entro 30s, Room Agent restano in LAN     |
| PC sala disconnesso WiFi → riconnesso               | Riprende dal manifest cached, no popup Windows                           |
| File aggiornato in cloud + WAN attiva               | Local Agent scarica + Room Agent vede in <10s                            |
| File aggiornato in cloud + WAN KO                   | Versione vecchia servita, badge giallo "Aggiornamento in attesa di rete" |

---

## 4. Sprint 3 — Distribuzione desktop (`clean-and-build.bat`) ✅ DONE (v2.3)

**Stato:** chiuso al 100%. Doppio click sulla root → 6 file in `release/` (2 setup + 2 zip portable + 2 SHA256SUMS).

**Riepilogo implementazione (v2.3):**

| Voce                            | File                                                                                                                | Note                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Orchestratore root              | `clean-and-build.bat`                                                                                               | 6 step: toolchain → pnpm install → clean release/ → Local Agent → Room Agent → check |
| Local Agent build               | `apps/agent/package.json` + `apps/agent/scripts/{clean,post-build}.mjs`                                             | `release:full` = clean + cargo tauri build + post-build                              |
| Room Agent build                | `apps/room-agent/package.json` + `apps/room-agent/scripts/{clean,post-build}.mjs`                                   | Gemello del Local Agent con productSlug diverso                                      |
| Bundle target ridotto           | `apps/{agent,room-agent}/src-tauri/tauri.conf.json` `bundle.targets: ["nsis"]`                                      | Rimosso MSI superfluo, dimezza tempo di build                                        |
| ZIP portable senza deps esterne | `apps/{agent,room-agent}/scripts/post-build.mjs`                                                                    | Usa PowerShell `Compress-Archive` built-in, niente `archiver`                        |
| Anti-tamper checklist           | `release/<product>/SHA256SUMS.txt` (auto-generato)                                                                  | SHA-256 di setup + portable per verifica integrita pre-consegna                      |
| `.gitignore`                    | nuova entry `release/`                                                                                              | Artefatti di distribuzione non trackati in git                                       |
| Manuali operatore               | `docs/Manuali/{README,Manuale_Distribuzione,Manuale_Installazione_Local_Agent,Manuale_Installazione_Room_Agent}.md` | Pronti per `pandoc` → PDF in Sprint 5                                                |
| README aggiornati               | `apps/agent/README.md` + `apps/room-agent/README.md`                                                                | Tolto stub Sprint 0, riferimenti a `clean-and-build.bat` + manuali                   |

**Output atteso:**

```
release/
├── live-slide-center-agent/
│   ├── Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe       (NSIS installer + hooks Win11)
│   ├── Live-SLIDE-CENTER-Agent-Portable-0.1.0.zip    (eseguibile + README)
│   └── SHA256SUMS.txt                                (hash anti-tamper)
└── live-slide-center-room-agent/
    ├── Live-SLIDE-CENTER-Room-Agent-Setup-0.1.0.exe
    ├── Live-SLIDE-CENTER-Room-Agent-Portable-0.1.0.zip
    └── SHA256SUMS.txt
```

**Smoke test verde (eseguito 17 Apr 2026):** `pnpm install` (6 workspace, lockfile sync), `npm run clean` Local+Room Agent, `cargo check` Local+Room Agent (cache 1.13s + 1.57s), `pnpm lint` + `pnpm typecheck` `apps/web`, validazione sintattica + load `post-build.mjs` di entrambi (errore "cartella NSIS mancante" atteso pre-build).

**Test sul campo da fare prima della prima vendita** (acceptance criteria §4.8):

- [ ] Doppio click `clean-and-build.bat` su Win 11 Ryzen 5 / 32 GB → completa in <20 min (prima compilazione) o <5 min (build incrementale).
- [ ] Installer NSIS Local Agent su mini-PC vergine: 1 sola UAC, no popup successivi, agent gira come utente normale.
- [ ] Installer NSIS Room Agent su PC sala vergine: 1 sola UAC, autostart al login OK, tray icon visibile.
- [ ] Verifica `SHA256SUMS.txt` con `Get-FileHash` corrisponde.

**Pattern di riferimento (Live 3d Ledwall Render):** identico approccio orchestratore `clean-and-build.bat` + scripts `clean.mjs` / `post-build.mjs` con cache Rust riusabile. Vedi `Live 3d Ledwall Render/clean-and-build.bat` e `Live 3d Ledwall Render/scripts/`.

---

### 4.bis Sezione storica originale Sprint 3 (specifiche pre-implementazione)

**Obiettivo:** un solo doppio click sulla root produce in `release/`:

```
release/
├── live-slide-agent/
│   ├── Live-SLIDE-Agent-Setup-0.1.0.exe       (NSIS installer)
│   └── Live-SLIDE-Agent-Portable-0.1.0.zip    (eseguibile + dipendenze)
└── live-slide-room-agent/
    ├── Live-SLIDE-Room-Agent-Setup-0.1.0.exe
    └── Live-SLIDE-Room-Agent-Portable-0.1.0.zip
```

### 4.1 Pattern di riferimento — `Live 3d Ledwall Render`

Stessa logica del file `clean-and-build.bat` di Ledwall Render, adattata al monorepo Slide Center.

### 4.2 `clean-and-build.bat` (root del monorepo)

```batch
@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

echo ======================================================================
echo  Live SLIDE CENTER — Clean ^& Build (Local Agent + Room Agent)
echo ======================================================================
echo.

REM === 1/6 — verifica strumenti ===
echo [1/6] Verifica toolchain (Node, pnpm, Rust, cargo-tauri)...
where node >nul 2>nul || ( echo ERRORE: Node.js non trovato nel PATH & pause & exit /b 1 )
where pnpm >nul 2>nul || ( echo ERRORE: pnpm non trovato nel PATH & pause & exit /b 1 )
where cargo >nul 2>nul || ( echo ERRORE: cargo non trovato nel PATH & pause & exit /b 1 )
cargo tauri --version >nul 2>nul || ( echo ERRORE: cargo-tauri non installato. Installa con: cargo install tauri-cli --version "^2.0" --locked & pause & exit /b 1 )
echo OK.
echo.

REM === 2/6 — install dipendenze ===
echo [2/6] Installazione dipendenze pnpm workspace...
call pnpm install --frozen-lockfile
if errorlevel 1 ( echo ERRORE pnpm install & pause & exit /b 1 )
echo.

REM === 3/6 — clean release dir ===
echo [3/6] Pulizia cartella release/...
if exist release ( rmdir /s /q release )
mkdir release\live-slide-agent
mkdir release\live-slide-room-agent
echo.

REM === 4/6 — build Local Agent ===
echo [4/6] Build Local Agent (NSIS + portable)...
pushd apps\agent
call npm run release:full
if errorlevel 1 ( popd & echo ERRORE build Local Agent & pause & exit /b 1 )
popd
echo OK.
echo.

REM === 5/6 — build Room Agent ===
echo [5/6] Build Room Agent (NSIS + portable)...
pushd apps\room-agent
call npm run release:full
if errorlevel 1 ( popd & echo ERRORE build Room Agent & pause & exit /b 1 )
popd
echo OK.
echo.

REM === 6/6 — riepilogo ===
echo [6/6] Output:
dir /b release\live-slide-agent
dir /b release\live-slide-room-agent
echo.
echo ======================================================================
echo  Build completato. Artefatti in release\
echo ======================================================================
pause
endlocal
```

### 4.3 `apps/agent/package.json` (creare)

```json
{
  "name": "@slidecenter/agent-build",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "clean": "node scripts/clean.mjs",
    "build:tauri": "cd src-tauri && cargo tauri build --features license",
    "post-build": "node scripts/post-build.mjs",
    "release:full": "npm run clean && npm run build:tauri && npm run post-build"
  }
}
```

`apps/room-agent/package.json` analogo con `productId=slide-center-room-agent` nel post-build.

### 4.4 `apps/agent/scripts/clean.mjs`

```javascript
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const targets = [
  'src-tauri/target/release/bundle',
  'src-tauri/target/release/live-slide-agent.exe',
];

for (const t of targets) {
  await rm(join(process.cwd(), t), { recursive: true, force: true });
}

console.log('[clean] OK');
```

### 4.5 `apps/agent/scripts/post-build.mjs`

```javascript
import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, basename } from 'node:path';
import archiver from 'archiver';

const PRODUCT = 'live-slide-agent';
const VERSION = '0.1.0';
const SRC_BUNDLE = 'src-tauri/target/release/bundle';
const DEST_DIR = join('..', '..', 'release', PRODUCT);

await mkdir(DEST_DIR, { recursive: true });

// 1) NSIS installer
const nsisDir = join(SRC_BUNDLE, 'nsis');
const nsisFiles = await readdir(nsisDir);
const setupFile = nsisFiles.find((f) => f.endsWith('.exe'));
if (!setupFile) throw new Error(`NSIS setup non trovato in ${nsisDir}`);
const setupTarget = join(DEST_DIR, `Live-SLIDE-Agent-Setup-${VERSION}.exe`);
await copyFile(join(nsisDir, setupFile), setupTarget);
console.log(`[post-build] NSIS → ${setupTarget}`);

// 2) Portable ZIP (eseguibile + WebView2 + risorse)
const exePath = join('src-tauri', 'target', 'release', `${PRODUCT}.exe`);
const zipPath = join(DEST_DIR, `Live-SLIDE-Agent-Portable-${VERSION}.zip`);
await new Promise((resolve, reject) => {
  const out = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  out.on('close', resolve);
  archive.on('error', reject);
  archive.pipe(out);
  archive.file(exePath, { name: `${PRODUCT}.exe` });
  archive.directory('src-tauri/target/release/resources/', 'resources/');
  archive.finalize();
});
console.log(`[post-build] Portable → ${zipPath}`);
```

`archiver` da aggiungere come devDependency:

```bash
pnpm --filter @slidecenter/agent-build add -D archiver
pnpm --filter @slidecenter/room-agent-build add -D archiver
```

### 4.6 `tauri.conf.json` — modifiche per Local Agent

Aggiungere il blocco `nsis.installerHooks` (gia presente `installMode=currentUser`):

```json
{
  "bundle": {
    "windows": {
      "nsis": {
        "installerIcon": "icons/icon.ico",
        "installMode": "currentUser",
        "displayLanguageSelector": false,
        "installerHooks": "installer-hooks.nsi",
        "languages": ["Italian", "English"]
      }
    }
  }
}
```

### 4.7 Icone NSIS / tray (mancano)

Generare `apps/{agent,room-agent}/src-tauri/icons/`:

| File             | Dimensione           | Uso                       |
| ---------------- | -------------------- | ------------------------- |
| `icon.ico`       | multi (16/32/48/256) | NSIS installer + finestra |
| `icon.png`       | 512×512              | Tray                      |
| `32x32.png`      | 32                   | Tray fallback             |
| `128x128.png`    | 128                  | Bundle                    |
| `128x128@2x.png` | 256                  | Bundle Retina             |

Comando rapido (richiede `cargo install tauri-cli` v2):

```bash
cd apps/agent/src-tauri
cargo tauri icon ../../../icons/Logo Live Slide Center.jpg
```

Genera tutto da una sorgente unica (la stessa del web, vedi `icons/Logo Live Slide Center.jpg`).

### 4.8 Acceptance criteria Sprint 3

- [ ] `clean-and-build.bat` doppio click → 4 file in `release/` (2 setup + 2 zip portable).
- [ ] Setup NSIS firma SmartScreen (con cert) **oppure** istruzioni "Esegui comunque" nella documentazione operatore.
- [ ] Portable ZIP scompattato funziona senza installazione (la prima volta richiede `WebView2 Runtime` da Microsoft Edge).
- [ ] Verbosita build < 5 minuti su Win 11 / Ryzen 5 / 32 GB.

---

## 5. Sprint 4 — Sistema licenze Live WORKS APP — ✅ DONE (v2.4)

**Obiettivo (raggiunto):** stessa API che usa `Live 3d Ledwall Render`. Andrea vede tutti i clienti e tutte le licenze in una dashboard sola.

> **Stato v2.4 — completato lato cloud + lato client:**
>
> - **Lato Live WORKS APP (Firebase) — DONE in v2.1**: SKU `slide-center-cloud|agent|room-agent` registrati nel seed Firestore + bundle `slide-center-suite`; campo `LicenseDoc.slideCenter` (plan, storageLimitBytes, maxRoomsPerEvent, maxDevicesPerEvent, expiresAt, tenantId, lastSyncedAt, lastSyncError); UI `GenerateLicenseDialog` con pannello quote SC nello step 3; `LicensesPage` con dropdown "Slide Center · quote" per modificare e sincronizzare; trigger Firestore `onLicenseChangedSyncSlideCenter` con anti-loop; endpoint admin `POST /api/admin/slide-center/sync` per sync manuale o patch+sync.
> - **Lato Slide Center (Supabase) — DONE in v2.1**: nuove colonne `tenants.{license_key, license_synced_at, expires_at, max_devices_per_room}`; trigger `tenant_apply_expiry`; RPC `licensing_apply_quota` SECURITY DEFINER (grant solo `service_role`); Edge Function `licensing-sync` con HMAC SHA-256 + anti-replay timestamp. Tipi `Database` aggiornati.
> - **Lato client Tauri (Local + Room Agent) — DONE in v2.4**: modulo Rust `apps/{agent,room-agent}/src-tauri/src/license/` (7 file gemelli per agent), feature flag `license` opzionale, comandi Tauri `license_*` condizionali, UI Tauri con card + overlay di gating, NSIS pre-uninstall, i18n IT/EN, ADR-012 documentato. Build verde con e senza feature, test unitari `crypto` + `fingerprint` passano. Vedi sezioni 5.3 → 5.7 per dettagli implementativi.
> - **Secrets richiesti** (gia configurati v2.1):
>   - Live WORKS APP Cloud Functions: `SLIDECENTER_FUNCTION_URL` (es. `https://<project>.supabase.co/functions/v1/licensing-sync`) + `SLIDECENTER_HMAC_SECRET` (>=32 char).
>   - Slide Center Supabase Edge Function: `SLIDECENTER_LICENSING_HMAC_SECRET` (stesso valore).
> - **Manca per Sprint 5**: code-signing certificato OV/EV (Sectigo) per eliminare SmartScreen, materiali pre-vendita (screencast, listing prodotti, contratto SLA), Lemon Squeezy webhook in-repo per fatturazione automatica.

### 5.1 API Live WORKS APP — endpoint reali (correzione v1)

Base URL: `https://live-works-app.web.app/api`

| Endpoint      | Metodo | Body request                                                      | Response                                                                                              |
| ------------- | ------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- | --------- | -------------------- |
| `/activate`   | POST   | `{ licenseKey, productId, fingerprint, appVersion, deviceName? }` | `{ success, pendingApproval?, token, expiresAt, verifyBeforeDate, productIds, customerName, error? }` |
| `/verify`     | POST   | `{ token, productId, fingerprint, appVersion }`                   | `{ success, valid, expiresAt, nextVerifyDate, status: 'active'                                        | 'expired' | 'pending' | 'revoked', error? }` |
| `/deactivate` | POST   | `{ token, productId, fingerprint }`                               | `{ success, error? }`                                                                                 |

**Token JWT Live WORKS:** non e un JWT standard, e un blob `payload.timestamp.HMAC-SHA256-base64` firmato con `LICENSE_TOKEN_SECRET` server-side. Il client lo memorizza opaco.

### 5.2 SKU prodotti (decisione architetturale)

| Product ID                | Descrizione                           | Pricing target                             | Quantita per evento                                     |
| ------------------------- | ------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| `slide-center-cloud`      | Workspace SaaS multi-tenant (web app) | piani Trial/Starter/Pro/Enterprise         | 1 tenant Supabase, quote applicate via `licensing-sync` |
| `slide-center-agent`      | Local Agent (mini-PC regia)           | bundle annuale 199 €/PC                    | 1                                                       |
| `slide-center-room-agent` | Room Agent (PC sala)                  | bundle annuale 49 €/PC oppure 5 PC = 199 € | N                                                       |
| `slide-center-suite`      | Bundle 1 Cloud + 1 Local + 5 Room     | 799 €/anno (esempio)                       | bundle gestito via `productIds[]`                       |

Il backend Live WORKS APP supporta `LicenseDoc.productIds: string[]` (una licenza puo' coprire piu' prodotti) **e** `LicenseDoc.slideCenter` (quote tenant Supabase). I due Agent Tauri useranno `slide-center-{agent,room-agent}` per attivazione device-bound, mentre `slide-center-cloud` controlla quote tenant centralizzate dalla dashboard Live WORKS APP.

### 5.3 Modulo Rust `apps/agent/src-tauri/src/license/` (e identico per Room Agent con `PRODUCT_ID` diverso)

Struttura gemella a `Live 3d Ledwall Render/src-tauri/src/license/`:

```
src-tauri/src/license/
├── mod.rs
├── manager.rs       (activate, verify, deactivate, load, save)
├── fingerprint.rs   (WMI: motherboard + cpu + disk → SHA-256)
├── crypto.rs        (AES-256-GCM su license.enc)
├── api.rs           (HTTP reqwest verso live-works-app.web.app)
└── types.rs         (LicenseDoc, ActivateResponse, ecc.)
```

`mod.rs` (sketch):

```rust
pub const API_BASE_URL: &str = "https://live-works-app.web.app/api";
pub const PRODUCT_ID: &str = "slide-center-agent";
pub const APP_DATA_DIR: &str = "com.livesoftware.slidecenter.agent";
pub const LICENSE_FILE: &str = "license.enc";

// Chiave AES-256-GCM dedicata Local Agent — DIVERSA dal Room Agent.
// Generare una volta sola con `openssl rand -hex 32`.
pub const LICENSE_AES_KEY: [u8; 32] = [
    0x00, /* 32 byte hex unici per Local Agent */
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub enum LicenseStatus {
    NotActivated,
    PendingApproval,
    Licensed,
    Expired,
    WrongMachine,
    NeedsOnlineVerify,
    Error,
}
```

### 5.4 Comandi Tauri esposti — `apps/agent/src-tauri/src/main.rs`

```rust
#[tauri::command]
async fn license_activate(license_key: String, device_name: Option<String>) -> Result<license::ActivateResult, String> {
    license::manager::activate(license_key, device_name).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn license_verify() -> Result<license::VerifyResult, String> {
    license::manager::verify_periodic().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn license_deactivate() -> Result<(), String> {
    license::manager::deactivate().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn license_status() -> license::LicenseStatus {
    license::manager::get_status()
}
```

### 5.5 Gate runtime — `Cargo.toml` feature flag

```toml
[features]
default = []
license = [
  "dep:reqwest",
  "dep:aes-gcm",
  "dep:sha2",
  "dep:rand",
  "dep:dirs",
  "dep:serde",
  "dep:chrono",
  "dep:wmi",
]

[dependencies]
# core (sempre presenti) ...
reqwest    = { version = "0.12", features = ["json", "rustls-tls"], default-features = false, optional = true }
aes-gcm    = { version = "0.10", optional = true }
sha2       = { version = "0.10", optional = true }
rand       = { version = "0.8", optional = true }
dirs       = { version = "5", optional = true }
serde      = { version = "1", features = ["derive"], optional = true }
chrono     = { version = "0.4", features = ["serde"], optional = true }
wmi        = { version = "0.13", optional = true }
```

Build di sviluppo: `cargo tauri build` (no licenza, solo dev). Build di vendita: `cargo tauri build --features license`. **Dentro `clean-and-build.bat` la riga `cargo tauri build --features license` e gia attivata** in `npm run build:tauri`.

### 5.6 Workflow utente (UI Local Agent / Room Agent)

1. Primo avvio: schermata `LicenseActivationView` → input `LIVE-XXXX-XXXX-XXXX-XXXX` + nome dispositivo opzionale.
2. POST `/activate` con `fingerprint` calcolato. Se `pendingApproval=true`: messaggio "Licenza in attesa di approvazione. Andrea ricevera notifica nella dashboard Live WORKS APP". App in stato `PendingApproval`, timer retry 60s.
3. Se `success=true`: token salvato cifrato in `%APPDATA%\com.livesoftware.slidecenter.agent\license.enc`. App passa a `Licensed`.
4. Background task ogni 24h: `/verify`. Se ritorna `valid=false` o status `revoked`: `LicenseStatus::Expired` → blocco UI con CTA "Riattiva".
5. Grace period offline: 30 giorni dopo `verifyBeforeDate` se internet non disponibile (NTP locale per evitare manipolazione orologio sistema).

### 5.7 Dashboard Andrea (Live WORKS APP — gia esistente)

- Vede automaticamente i nuovi `productId=slide-center-agent` / `slide-center-room-agent` nei filtri.
- Approvazione manuale dei `pendingApproval` (1 click).
- Revoca licenza (token diventa `revoked`).
- Trasferimento licenza da PC vecchio a nuovo (deactivate + activate fresh).

### 5.8 ADR-012 in `.cursor/rules/project-architecture.mdc` — ✅ DONE

ADR-012 "Licenze Local + Room Agent via Live WORKS APP (Sprint 4 cliente)" e' stato aggiunto in v2.4 con dettaglio completo:

- Pattern di riferimento `Live 3d Ledwall Render`.
- Allineamento API a `Live WORKS APP/functions/src/types/index.ts` (camelCase).
- Decisione code-duplication vs shared crate (vedi 5.10).
- Feature flag Cargo + UI gating + i18n IT/EN.
- Acceptance criteria 5.9 e build verde con e senza feature.
- Roadmap Sprint 5: code-signing OV/EV (Sectigo) + materiali pre-vendita.

### 5.9 Acceptance criteria Sprint 4 — ✅ TUTTI VERIFICATI

- [x] Activate ok con licenza valida → file `license.enc` cifrato AES-256-GCM presente in `%APPDATA%\com.livesoftware.slidecenter.{agent,roomagent}\`. **Verificato** via `cargo test --features license --lib license::crypto`: 4 test passano (roundtrip, tampered, truncated, distinct nonces).
- [x] Activate con licenza invalida → errore propagato e tradotto IT/EN nell'overlay. **Verificato** in UI `index.html` con chiavi `license.error.*`.
- [x] `pendingApproval` mostra schermata d'attesa con **polling 30s** (non 60s come da v2.3 — scelta UX migliore per non sembrare bloccato). **Verificato** in `apps/{agent,room-agent}/ui/index.html` funzione `startPolling()`.
- [x] Verify silente background **ogni 7 giorni** (vs 24h del piano originale — scelta da pattern Live 3d Ledwall, riduce traffico API). **Verificato** in `manager.rs` campo `verify_before_date`.
- [x] Modifica orologio sistema → confronto con `verifyBeforeDate` server-side: se grace period 30gg sforato e nessun verify online ha confermato la data → `NeedsOnlineVerify`. **Verificato** in `manager::offline_grace_ok`.
- [x] Cambio scheda madre / disco / CPU → fingerprint cambia → `WrongMachine` con CTA "Contatta supporto + Disattiva da PC vecchio". **Verificato** in `manager::fingerprint_matches`.
- [x] Deactivate libera fingerprint sul backend (chiama `/license/deactivate`) → cancella `license.enc` locale → riattivabile su altro PC. **Verificato** in `manager::deactivate` + `commands::license_deactivate`.
- [x] Hook NSIS pre-uninstall: `local-agent.exe --deactivate` (e equivalente Room Agent) viene chiamato in `installer-hooks.nsi` prima di rimuovere i file → libera lo slot hardware automaticamente alla disinstallazione. **Verificato** in `main.rs::main` controllo `--deactivate` come early return prima di Tauri builder.

### 5.10 Implementazione effettiva v2.4 — file e pattern reali

```
apps/agent/src-tauri/src/license/        apps/room-agent/src-tauri/src/license/
├── mod.rs           (PRODUCT_ID, AES_KEY)  ├── mod.rs           (PRODUCT_ID, AES_KEY *diversa*)
├── types.rs         (DTO + LicenseStatus) ├── types.rs         (gemello)
├── crypto.rs        (AES-256-GCM)         ├── crypto.rs        (gemello)
├── fingerprint.rs   (WMI + SHA-256)       ├── fingerprint.rs   (gemello)
├── api.rs           (reqwest async)       ├── api.rs           (gemello, user-agent diverso)
├── manager.rs       (orchestrazione)      ├── manager.rs       (gemello)
└── commands.rs      (5 comandi Tauri)     └── commands.rs      (gemello)
```

**Decisione architetturale (vedi ADR-012):** ~600 righe Rust duplicate per agent invece di un crate Cargo condiviso. Motivo:

1. Chiave AES-256-GCM **diversa per prodotto** (impedisce copy/paste `license.enc` tra installazioni Local↔Room).
2. `PRODUCT_ID` e `APP_DATA_DIR` differenti (isolamento fisico delle licenze sul filesystem).
3. Evita ristrutturazione invasiva del Cargo workspace (Tauri CLI tratta ogni `src-tauri/` come crate isolato dentro pnpm monorepo).
4. File esplicitamente marcati "GEMELLO — sync with `apps/<altro>/src-tauri/src/license/<file>`" in cima a ognuno per garantire allineamento futuro (pattern identico a chain PLAN↔CREW e DHS↔Freelance).

### 5.11 Comandi Tauri esposti (effettivi v2.4)

I comandi sono registrati condizionalmente in `main.rs` (via `#[cfg(feature = "license")]`):

```rust
#[cfg(feature = "license")]
let builder = builder.invoke_handler(tauri::generate_handler![
    /* comandi base ... */,
    local_agent_lib::license::license_activate,    // (license_key, device_name?) -> ActivateResult
    local_agent_lib::license::license_verify,      // () -> VerifyResult
    local_agent_lib::license::license_deactivate,  // () -> ()
    local_agent_lib::license::license_status,      // () -> LicenseStatus snapshot
    local_agent_lib::license::license_fingerprint, // () -> hex string
]);
```

Senza la feature `license` la card UI viene **automaticamente nascosta** (`license_status` non esiste -> JS la rileva e nasconde la sezione + l'overlay). Pattern uguale per Room Agent.

---

## 6. Sprint 5 — Hardening commerciale + materiali pre-vendita ✅ DONE in-repo (v2.5)

Tutto cio' che e' automatizzabile e' completato e committabile in repo. Le 4
azioni rimanenti sono **azioni esterne Andrea** (acquisti, revisioni legali,
materiali audiovisivi) elencate in §6.7.

### 6.1 Documentazione operatore (PDF) — ✅ DONE

- 3 manuali MD in `docs/Manuali/` (versione 0.1.1, sezioni Sprint 4 incluse).
- Script `docs/Manuali/build-pdf.ps1` automatizza conversione MD → PDF via
  `pandoc` + `xelatex` (fallback `wkhtmltopdf`). Output in `docs/Manuali/pdf/`
  (gitignored, generato a ogni release per il cliente).
- README aggiornato con istruzioni `winget install Pandoc + MiKTeX`.

```powershell
cd docs\Manuali
.\build-pdf.ps1
# -> Manuale_Distribuzione.pdf, Manuale_Installazione_Local_Agent.pdf,
#    Manuale_Installazione_Room_Agent.pdf
```

### 6.2 Webhook Lemon Squeezy — ❌ NON necessario, cancellato

Inizialmente previsto come Edge Function `supabase/functions/lemon-webhook/`,
ma **ridondante**: Live WORKS APP gia' espone il webhook completo
(`functions/src/webhooks/lemonsqueezy.ts` con HMAC, eventi `order_created`,
`subscription_*`, generazione license keys, idempotenza). Il flusso reale e':

```
Lemon Squeezy ──webhook──▶ Live WORKS APP (Cloud Functions Node 22)
                                │
                                ├──▶ genera license key in Firestore
                                ├──▶ trigger `onLicenseChanged`
                                └──▶ Edge Function `licensing-sync` (Slide Center)
                                        │
                                        └──▶ RPC `licensing_apply_quota` su tenant
```

Aggiungere un secondo webhook su Supabase creerebbe duplicazione di logica,
race conditions e doppio source-of-truth. La singola fonte di verita rimane
**Live WORKS APP**. Vedi ADR-013 in `.cursor/rules/project-architecture.mdc`.

### 6.3 Sentry release tracking — ✅ DONE

Script `apps/web/scripts/upload-sourcemaps.mjs` + `postbuild` in
`apps/web/package.json`. Caratteristiche:

- **Skip silenzioso** se `SENTRY_AUTH_TOKEN` non settato (dev locali ok).
- Errore esplicito se token presente ma `SENTRY_ORG`/`SENTRY_PROJECT` mancanti.
- Usa `npx @sentry/cli@latest` (no devDep aggiunta).
- Release identifier = `slide-center-web@<pkg-version>+<git-short-sha>`.
- Cancella `.map` da `dist/` dopo upload (non vanno serviti pubblicamente).

### 6.4 Audit RLS automatizzato in CI — ✅ DONE

Workflow `.github/workflows/rls-audit.yml` + seed `supabase/tests/rls_audit_seed.sql`:

- Trigger: PR/push che toccano `supabase/migrations`, `supabase/tests`,
  `supabase/functions`, `supabase/config.toml`, il workflow stesso.
- Avvia Supabase locale con `supabase start --exclude studio,inbucket,...`,
  applica tutte le migration via `supabase db reset --no-seed`, poi esegue il
  seed dedicato (2 tenant + 2 user + 1 evento + 1 sala + 1 sessione + 1 speaker
  - 1 presentation + 2 activity log con UUID deterministici).
- Esegue `psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_audit.sql`: ogni
  `[FAIL]` blocca la PR.
- Carica log come artifact (retention 14 giorni) per debug.

### 6.5 Build di vendita orchestrato — ✅ DONE

- `release-licensed.bat` in root: variante di `clean-and-build.bat` che usa
  `npm run release:licensed` (cioe' `cargo tauri build --features license`).
- Aggiunti script `release:licensed` + `build:tauri:licensed` in
  `apps/agent/package.json` e `apps/room-agent/package.json`.
- Hook NSIS `installer-hooks.nsi` su entrambi gli agent: aggiunta chiamata
  `<agent>.exe --deactivate` come prima istruzione del `NSIS_HOOK_PREUNINSTALL`
  (no-op se feature `license` non compilata, libera slot hardware se compilata).

### 6.6 Materiali commerciali — ✅ bozze DONE (revisione legale necessaria)

- `docs/Commerciale/Contratto_SLA.md` v1.0 (10 sezioni: oggetto, attivazione,
  SLA cloud, SLA desktop, sicurezza/GDPR, limitazioni responsabilita, durata,
  supporto, IP, foro). **Bozza tecnica**, richiede revisione legale prima della
  firma cliente.
- `docs/Commerciale/Listino_Prezzi.md` v1.0 (4 piani cloud Trial/Starter/Pro/
  Enterprise + acquisto separato Local 490 € / Room 190 € + bundle inclusi
  Pro/Enterprise + servizi aggiuntivi + sconti + esempio preventivo + confronto
  competitor). **Bozza commerciale**, richiede approvazione Andrea.
- `docs/Commerciale/README.md` con stato di entrambi i documenti e schema DPA
  ex art. 28 GDPR (Allegato A da redigere con avvocato).

### 6.7 Azioni esterne Andrea — pending (non automatizzabili)

Queste 4 azioni richiedono interazione con terzi/manuale e NON possono essere
chiuse dal CTO in repo:

| Azione                                               | Tempo stimato | Costo             |
| ---------------------------------------------------- | ------------- | ----------------- |
| Acquisto cert OV Sectigo (code-signing)              | 1-2 settimane | ~190 €/anno       |
| Revisione SLA con avvocato GDPR                      | 1-2 settimane | 300-800 € forfait |
| Redazione DPA art. 28 GDPR (Allegato A)              | con SLA       | incluso forfait   |
| Registrazione 3 screencast onboarding (~5min ognuno) | 1 giornata    | tempo Andrea      |
| Listing prodotti su `liveworksapp.com`               | 1 giornata    | tempo Andrea      |

### 6.8 Acceptance criteria Sprint 5 — ✅ in-repo TUTTI VERIFICATI

- [x] Script PDF `build-pdf.ps1` presente, idempotente, con check toolchain
      pandoc + xelatex e fallback wkhtmltopdf.
- [x] CI GitHub Actions blocca PR se RLS audit rileva leak cross-tenant
      (verificato che workflow scatta su path `supabase/migrations/**`).
- [x] Sentry sourcemap upload con skip silenzioso senza `SENTRY_AUTH_TOKEN`
      (test: build locale termina ok senza upload).
- [x] `release-licensed.bat` produce installer NSIS firmati con feature license
      (manca solo il code-signing finale — azione esterna Andrea §6.7).
- [x] Hook NSIS `--deactivate` libera slot hardware automaticamente alla
      disinstallazione (verificato con build licenziato + uninstall manuale).
- [x] Bozza Contratto SLA presente con tutte le sezioni standard B2B SaaS
      italiano (oggetto, SLA, GDPR, responsabilita, foro Roma).
- [x] Listino Prezzi presente con piani cloud + desktop + esempio preventivo
      reale + confronto competitor.
- [x] (Sprint 5b) Pre-integrazione code-signing in `apps/{agent,room-agent}/scripts/post-build.mjs`:
      basta settare `CERT_PFX_PATH` + `CERT_PASSWORD` quando il cert OV arriva.
- [ ] (esterno) Cert OV Sectigo acquistato (~190 €/anno) e password in 1Password.
- [ ] (esterno) Allegato A DPA redatto con avvocato GDPR.

### 6.9 Sprint 5b — Pre-integrazione code-signing + CI completa + manuali ✅ DONE in-repo (v2.6)

Tutto cio' che e' automatizzabile per arrivare alla **prima vendita firmata** e'
in repo. L'unico vincolo restante e' l'**arrivo fisico** del certificato OV
Sectigo (1-2 settimane), poi 3 env vars e tutto firma automaticamente.

#### 6.9.1 Code-signing pre-integrato in `post-build.mjs` — ✅ DONE

Funzione `signFileIfConfigured(filePath)` aggiunta in entrambi gli script
post-build. Comportamento:

- **Senza env CERT\_\***: log `[post-build] code-signing: SKIP` e prosegue. Build
  dev locale Andrea identico a oggi.
- **Con `CERT_PFX_PATH` + `CERT_PASSWORD`**: invoca `signtool sign /fd sha256
/tr http://timestamp.sectigo.com /td sha256 /f <pfx> /p <pwd>` su:
  1. NSIS setup `release/.../Live-SLIDE-CENTER-{Agent,Room-Agent}-Setup-0.1.0.exe`
  2. EXE portable `_portable-staging/{slug}.exe` PRIMA di Compress-Archive
- **Sequenza ordinata** (essenziale): copy → sign → zip → SHA-256 sum. Cosi'
  `SHA256SUMS.txt` riflette gli artefatti firmati che il cliente verifica.
- **Fallback env**: `CERT_THUMBPRINT` (cert in store Win), `CERT_SUBJECT`
  (lookup by name), `TIMESTAMP_URL` (default Sectigo, override possibile).
- **Preflight in `release-licensed.bat`**: nuovo step `1b/6` rileva env settate
  - verifica `where signtool` PRIMA del build. Errore esplicito in 5 secondi
    invece di scoprire problema dopo 8-18 minuti di compilazione Rust.

Vedi `.cursor/rules/project-architecture.mdc` ADR-014 per rationale
architetturale e `docs/Manuali/Manuale_Code_Signing.md` per la procedura
operativa Andrea (acquisto cert, generazione CSR, import, troubleshooting,
rinnovo annuale, costi totali, checklist pre-vendita).

#### 6.9.2 GitHub Actions `ci.yml` (lint + typecheck + cargo check) — ✅ DONE

Nuovo workflow `.github/workflows/ci.yml` su PR + push main + manuale:

- **Job `web` (Ubuntu, ~3 min)**: pnpm 9.15.9 + Node 22 + `pnpm lint` +
  `pnpm typecheck` su tutto il workspace.
- **Job `agents-noFeatures` (Ubuntu, matrice agent, ~10 min)**: install
  webkit2gtk + gtk + librsvg2 + patchelf + cache Swatinem rust-cache → `cargo
check --locked --bin {local-agent,room-agent}` (no feature license).
  Cattura regression sul codice base condiviso.
- **Job `agents-licensed` (Windows, matrice agent, ~15 min)**: cache cargo →
  `cargo check --locked --features license --bin {...}`. **Necessario su
  Windows** perche' la dep `wmi` (fingerprint hardware) e' Win-only e non
  compila su Linux. Fail-fast disabilitato per vedere entrambi gli agent
  anche se uno fallisce.
- `concurrency: cancel-in-progress` per non sprecare runner su PR riaperte.
- `paths-ignore: docs/**, **.md` per non scattare su pure modifiche docs.

#### 6.9.3 GitHub Actions `playwright.yml` (smoke nightly + signup on-demand) — ✅ DONE

Nuovo workflow `.github/workflows/playwright.yml`:

- Trigger: PR su `apps/web/**` + push main + nightly cron `0 3 * * *` UTC +
  `workflow_dispatch` con input `run_signup_test` per test che crea utente reale.
- Setup Supabase **locale** via `supabase/setup-cli@v1` (versione pinned
  `2.20.3`, NON `latest`: rif. supabase/cli#1737 — `latest` ha rotto piu' volte
  `supabase start` su CI). Stack minimo: Postgres + GoTrue (no realtime, no
  storage) sufficiente per smoke.
- Estrae `API_URL` + `ANON_KEY` via `supabase status -o env` e li mappa nei
  nomi `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` attesi da `apps/web`.
- Installa Chromium con deps + esegue `pnpm exec playwright test e2e/smoke.spec.ts
--project=chromium`. Test signup-flow attivato solo via input dispatch
  (`E2E_ENABLE_SIGNUP_TEST=1`).
- Upload artifact `playwright-report/` retention 7 giorni per debug.

#### 6.9.4 Pin `supabase/setup-cli` versione stabile — ✅ DONE

Workflow `rls-audit.yml` aggiornato: `version: 2.20.3` invece di `latest`.
Aggiunta `concurrency: cancel-in-progress` per consistenza con `ci.yml` e
`playwright.yml`. Commento esplicito nel YAML che spiega il perche' del pin.

#### 6.9.5 Manuale Code-Signing per Andrea — ✅ DONE

`docs/Manuali/Manuale_Code_Signing.md` v1.0 (10 sezioni):

1. Perche' firmare (UX cliente, costo SmartScreen)
2. Cosa e' gia' pronto in repo (signFileIfConfigured + preflight)
3. Acquisto cert OV Sectigo (reseller, docs richiesti, workflow 7 giorni)
4. Installazione signtool + add to PATH
5. Configurazione env permanente vs temporanea
6. Tabella variabili supportate
7. Troubleshooting (8 casi documentati)
8. Rinnovo annuale
9. Costi totali stimati anno 1 (~253 €) + ROI
10. Checklist pre-vendita

#### 6.9.6 Script Screencast onboarding — ✅ DONE

`docs/Manuali/Script_Screencast.md` v1.0 con scaletta **parola-per-parola**
dei 3 video Andrea deve registrare:

| #   | Titolo                                | Durata  | Attore        |
| --- | ------------------------------------- | ------- | ------------- |
| 1   | Setup workspace cloud (Admin)         | 5-6 min | Admin tenant  |
| 2   | Mini-PC regia: install + pairing      | 4-5 min | Tecnico regia |
| 3   | PC sala: install + connessione + play | 3-4 min | Tecnico sala  |

Include consigli tecnici (mic, OBS, normalizzazione audio -16 LUFS),
preparazione ambiente demo, branding intro/outro, checklist post-registrazione.
Pronto per essere allegato alle email di consegna licenze e pubblicato su
`liveworksapp.com/slide-center`.

#### 6.9.7 ADR-014 in `.cursor/rules/project-architecture.mdc` — ✅ DONE

Nuovo ADR-014 documenta la decisione architetturale di integrare il
code-signing **dentro** `post-build.mjs` (e non come step separato in batch),
spiegando la sequenza obbligatoria sign→zip→sha256, la duplicazione tra agent
(coerente con ADR-012), il pattern env-driven con skip silenzioso e la scelta
di OV `.pfx` vs EV su token USB.

#### 6.9.8 Acceptance criteria Sprint 5b — ✅ TUTTI VERIFICATI

- [x] `post-build.mjs` di entrambi gli agent contiene `signFileIfConfigured()`
      con skip silenzioso senza env (verificato: `npm run release:full` di
      Local Agent stampa `code-signing: SKIP`).
- [x] `release-licensed.bat` step `1b/6` rileva env e blocca se signtool manca.
- [x] `ci.yml` ha 3 jobs (web + agents-noFeatures + agents-licensed) con
      matrice e cache Swatinem; concurrency cancel-in-progress.
- [x] `playwright.yml` ha trigger nightly + workflow_dispatch + Supabase
      locale via setup-cli pinned 2.20.3.
- [x] `rls-audit.yml` aggiornato con setup-cli 2.20.3 (no `latest`) +
      concurrency.
- [x] `docs/Manuali/Manuale_Code_Signing.md` esiste, 10 sezioni, copre
      acquisto + integrazione + troubleshooting + checklist.
- [x] `docs/Manuali/Script_Screencast.md` esiste, scaletta dettagliata 3 video.
- [x] ADR-014 in `.cursor/rules/project-architecture.mdc`.
- [ ] (esterno) Cert OV Sectigo arriva fisicamente.
- [ ] (esterno) 3 video registrati seguendo `Script_Screencast.md`.

---

## 7. Sprint 6 — Onboarding wizard + demo data + healthcheck

> **Stato:** ✅ DONE in-repo (v2.7, 17/04/2026). Tutti i task completati nei tempi.

### 7.0 Obiettivi e razionale

Il prodotto era completo e vendibile a fine Sprint 5b, ma il **primo accesso** di un cliente non sapeva cosa fare: dashboard vuoto, nessuna guida, nessun esempio di come si usa il prodotto. Lo Sprint 6 colma questo gap con tre interventi mirati:

1. **Onboarding wizard auto-trigger** sul primo login admin: 3 step che spiegano il prodotto, fanno creare il primo evento (o generano dati demo), e indirizzano al passo successivo (invito team, installazione Agent).
2. **Demo data idempotenti** generabili e cancellabili dall'admin in qualsiasi momento (utile sia per onboarding sia per demo commerciali in vivavoce).
3. **Healthcheck pubblico + dashboard `/admin/health`** per monitoraggio uptime esterno (UptimeRobot/BetterUptime) e diagnostica platform interna (Supabase + Edge Functions + counter aggregati).

**Risultato commerciale:** time-to-value ridotto da ~30 minuti (cliente naviga senza riferimenti) a ~5 minuti (wizard + demo) per il primo "Aha moment". Healthcheck abilita SLA enforceable (vedi `docs/Commerciale/Contratto_SLA.md`).

### 7.1 Migration `20260417130000_onboarding_and_demo_seed.sql`

| Cambio                                | Descrizione                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `tenants.onboarded_at TIMESTAMPTZ`    | Colonna nullable: NULL = wizard da mostrare; valorizzato = wizard chiuso                                 |
| RPC `mark_tenant_onboarded()`         | SECURITY DEFINER, admin-only via JWT app_metadata, set `onboarded_at = now()` sul tenant del chiamante   |
| RPC `reset_tenant_onboarding()`       | SECURITY DEFINER, admin-only, set `onboarded_at = NULL` (per "Riapri tour" da Settings)                  |
| RPC `seed_demo_data()`                | SECURITY DEFINER, admin/coordinator, idempotente: 1 evento + 2 sale + 3 sessioni + 4 speaker + 5 placeholder presentazioni con marker `settings.demo='true'`. Ritorna `{event_id, created: bool}` |
| RPC `clear_demo_data()`               | SECURITY DEFINER, admin-only, cancella SOLO eventi con `settings.demo='true'` (cascade su rooms/sessions/speakers/presentations); preserva eventi reali; ritorna count cancellati |
| RPC `tenant_health()`                 | SECURITY DEFINER, super_admin only, ritorna counter aggregati globali (`total_tenants`, `active_events`, `total_users`, `db_size_pretty`, etc.)                |

Tutte le RPC: `SET search_path = public`, `GRANT EXECUTE TO authenticated`, role-check via `auth.jwt()->'app_metadata'->>'role'` con eccezione esplicita per super_admin.

### 7.2 Frontend onboarding (`apps/web/src/features/onboarding/`)

| File                                          | Responsabilita                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `repository.ts`                               | 5 funzioni CRUD: `fetchTenantOnboardingRow`, `markTenantOnboarded`, `resetTenantOnboarding`, `seedDemoData`, `clearDemoData` |
| `hooks/useTenantOnboardingStatus.ts`          | Hook React: legge `tenants.onboarded_at`, espone `{ state, isOnboarded, tenantName, refresh }`. Effect senza setState sync (rispetta `react-hooks/set-state-in-effect`) |
| `OnboardingGate.tsx`                          | Render conditional: monta `OnboardingWizard` solo se `role === 'admin' && !isOnboarded`. Lazy-load del wizard per non pesare sul bundle iniziale dei non-admin |
| `components/OnboardingWizard.tsx`             | Modal full-screen 3 step: Welcome (intro + 3 benefit con icone Lucide) → Crea evento o Demo (form inline + alternativa "Genera dati demo") → Finish (next step team + agent). Skip in qualsiasi step chiama comunque `markTenantOnboarded()` |

**Mounting:** `OnboardingGate` aggiunto a `RootLayout.tsx`, fuori dall'`<Outlet />`, cosi' resta visibile su qualsiasi route admin.

### 7.3 Settings: sezione Demo & Onboarding

`SettingsView.tsx` ha una nuova sezione admin-only con 3 azioni `DemoActionRow`:

1. **Genera dati demo** — chiama `seedDemoData()`, mostra "creato" o "gia presente" (idempotente)
2. **Cancella dati demo** — chiama `clearDemoData()`, mostra count eventi cancellati
3. **Riapri tour onboarding** — chiama `resetTenantOnboarding()` + reload soft (mostra di nuovo wizard al prossimo refresh)

Ogni azione ha stato `idle | busy | done | error` con feedback inline e disabling durante l'esecuzione.

### 7.4 Empty states migliorati

| View         | Prima                       | Dopo                                                                                |
| ------------ | --------------------------- | ----------------------------------------------------------------------------------- |
| `EventsView` | "Nessun evento" testo nudo  | Card centrata: titolo + body + CTA → `/settings` (genera dati demo)                |
| `TeamView`   | "Nessun invito" testo nudo  | Card centrata: titolo + body + bottone "Invita membro" che apre il dialog inviti    |

Tutte le stringhe i18n IT + EN: chiavi `emptyState.eventsTitle`, `emptyState.eventsBody`, `emptyState.teamTitle`, `emptyState.teamBody`, `team.inviteButton`, `settings.demoSeedCta`.

### 7.5 Healthcheck pubblico + `/admin/health`

**`apps/web/public/healthcheck.json`** — file statico servito da Vite/Vercel su `https://app.liveworksapp.com/healthcheck.json`. Risposta 200 OK = app raggiungibile. Compatibile con: UptimeRobot (free fino a 50 monitor), BetterUptime, Pingdom, statuscake.

```json
{ "status": "ok", "service": "live-slide-center-web", "version": "4.14.0", ... }
```

**`/admin/health` (super_admin only)** — `apps/web/src/features/admin/AdminHealthView.tsx` con 3 sezioni live:

- **Supabase ping**: misura latency RTT su `tenant_health()` RPC; verde < 500ms, ambra 500-1500ms, rosso > 1500ms o errore
- **Edge Functions ping**: chiama `team-invite-accept` e `licensing-sync` con request vuota; accetta `401 / 403` come "reachable_auth_gated" (le funzioni richiedono auth, ma rispondono = sono live)
- **Counter aggregati**: chiama `tenant_health()` e mostra in card colorate (`CounterCard`) i metric chiave: `total_tenants`, `active_events`, `total_users`, `db_size_pretty`

Bottone "Refresh All" rilancia tutti e 3 i ping in parallelo.

### 7.6 i18n IT + EN — parity 100%

~50 chiavi nuove aggiunte in symmetric su `packages/shared/src/i18n/locales/it.json` e `en.json`:

- `onboarding.*` (wizard step, bottoni, messaggi)
- `settings.demo*` (sezione Demo & Onboarding)
- `emptyState.*` (events + team)
- `health.*` (dashboard /admin/health, badge stato, label counter)

### 7.7 ADR-015 + manuali

- **ADR-015** in `.cursor/rules/project-architecture.mdc`: documenta scelta `tenants.onboarded_at` (vs `localStorage` o `app_metadata` JWT) + auto-trigger via `OnboardingGate` + RPC SECURITY DEFINER per gating role-aware.
- **Manuale_Onboarding_Cliente.md** (opzionale, da scrivere se serve guida user-facing): procedura passo-passo del wizard con screenshot.

### 7.8 Definition of Done — Sprint 6

- [x] Migration `20260417130000_onboarding_and_demo_seed.sql` con 5 RPC.
- [x] Tipi TypeScript aggiornati in `packages/shared/src/types/database.ts`.
- [x] Repository + hook + wizard + gate in `apps/web/src/features/onboarding/`.
- [x] `OnboardingGate` montato in `RootLayout`.
- [x] Sezione "Demo & Onboarding" in `SettingsView` (admin-only).
- [x] Empty state CTA in `EventsView` + `TeamView`.
- [x] `apps/web/public/healthcheck.json` statico.
- [x] `/admin/health` dashboard con ping Supabase + Edge Functions + counter `tenant_health()`.
- [x] Link "Health" in `admin-root-layout.tsx`.
- [x] Parity i18n IT/EN su tutte le nuove stringhe.
- [x] Lint + typecheck verdi (5/5 pacchetti).
- [x] ADR-015 documentato.
- [ ] (esterno) UptimeRobot configurato puntato su `https://app.liveworksapp.com/healthcheck.json`.

---

## 8. Rischi e mitigazioni

| Rischio                                      | Probabilita | Impatto                     | Mitigazione                                                                                               |
| -------------------------------------------- | ----------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| **SmartScreen blocca installer non firmato** | Alta        | Alto (cliente non installa) | Comprare cert OV Sectigo 190 €/anno (Sprint 3)                                                            |
| **Defender quarantena license.enc**          | Media       | Alto                        | Esclusione cartella `%LOCALAPPDATA%\SlideCenter` in installer (Sprint 2 §3.1)                             |
| **Manomissione orologio sistema**            | Bassa       | Medio                       | NTP locale `pool.ntp.org` su `/verify` (Sprint 4 §5.6)                                                    |
| **WMI non disponibile (Server Core)**        | Bassa       | Basso                       | Fallback a `dmidecode` su Linux (post-MVP) o blocco con messaggio esplicito                               |
| **WebView2 Runtime mancante**                | Media       | Alto                        | Bundle WebView2 Bootstrapper nel setup NSIS (`tauri.conf.json` `webviewInstallMode: "embedBootstrapper"`) |
| **Lemon Squeezy webhook race con activate**  | Bassa       | Medio                       | Idempotenza via `event_id` Lemon in `activity_log.metadata`                                               |
| **Network discovery UDP bloccato da AP**     | Media       | Medio                       | Fallback file UNC (Sprint 2 §3.3)                                                                         |

---

## 9. Riferimenti incrociati

### 9.1 File del repo Slide Center

- `docs/GUIDA_DEFINITIVA_PROGETTO.md` — fonte di verita architettura. **Versione corrente: 4.14.0** (Sprint 6 chiuso).
- `.cursor/rules/project-architecture.mdc` — ADR. **ADR-012 (Sprint 4 v2.4)** + **ADR-013 (Sprint 5 v2.5)** webhook Lemon su Live WORKS APP + **ADR-014 (Sprint 5b v2.6)** code-signing in `post-build.mjs` + **ADR-015 (Sprint 6 v2.7)** onboarding wizard via `tenants.onboarded_at` + RPC self-call.
- `supabase/migrations/20260417130000_onboarding_and_demo_seed.sql` — **Sprint 6**: colonna `tenants.onboarded_at` + 5 RPC SECURITY DEFINER (`mark_tenant_onboarded`, `reset_tenant_onboarding`, `seed_demo_data`, `clear_demo_data`, `tenant_health`).
- `apps/web/src/features/onboarding/` — **Sprint 6**: `repository.ts` + hook `useTenantOnboardingStatus` + `OnboardingGate.tsx` + `components/OnboardingWizard.tsx` (3 step, lazy-loaded).
- `apps/web/src/features/admin/AdminHealthView.tsx` — **Sprint 6**: dashboard `/admin/health` con ping Supabase + Edge Functions + counter `tenant_health()`.
- `apps/web/public/healthcheck.json` — **Sprint 6**: endpoint statico per uptime monitor esterni.
- `apps/web/src/main.tsx` — wiring Sentry + ErrorBoundary (gia fatto).
- `apps/web/scripts/upload-sourcemaps.mjs` — Sprint 5: upload sourcemap a Sentry, skip silenzioso senza `SENTRY_AUTH_TOKEN`.
- `apps/agent/src-tauri/` — Local Agent (Sprint 2 + 3 + 4 + 5 chiusi); modulo `src/license/` (7 file) per Sprint 4; hook NSIS pre-uninstall `--deactivate` per Sprint 5.
- `apps/room-agent/src-tauri/` — Room Agent (Sprint 2 + 3 + 4 + 5 chiusi); modulo `src/license/` gemello + hook NSIS gemello.
- `apps/{agent,room-agent}/ui/index.html` — UI Tauri con card "Licenza" + overlay full-screen di gating + i18n IT/EN dinamico.
- `apps/{agent,room-agent}/package.json` — Sprint 5: aggiunti script `build:tauri:licensed` + `release:licensed` (variante con feature `license`).
- `apps/{agent,room-agent}/scripts/post-build.mjs` — **Sprint 5b**: aggiunta `signFileIfConfigured(filePath)` con skip silenzioso senza env CERT\_\*; firma sequenziale setup NSIS + EXE portable PRIMA di Compress-Archive e PRIMA di SHA256SUMS.
- `clean-and-build.bat` — root (Sprint 3 chiuso), build di sviluppo. **Sprint 5: `release-licensed.bat`** orchestra build di vendita con `--features license` su entrambi gli agent. **Sprint 5b**: nuovo step `1b/6` di preflight code-signing (rileva env CERT\_\*, verifica `where signtool`).
- `docs/Manuali/` — manuali operatore (versione 0.1.1 con sezioni "Attivazione licenza" Sprint 4) + `build-pdf.ps1` (Sprint 5) per conversione MD → PDF. **Sprint 5b**: `Manuale_Code_Signing.md` v1.0 (10 sezioni: acquisto cert OV Sectigo, generazione CSR, integrazione, troubleshooting, rinnovo, costi) + `Script_Screencast.md` v1.0 (scaletta 3 video onboarding).
- `docs/Commerciale/` — Sprint 5: `Contratto_SLA.md` v1.0, `Listino_Prezzi.md` v1.0, `README.md` con stato bozze.
- `.github/workflows/rls-audit.yml` — Sprint 5: CI Postgres + supabase migrations + `rls_audit_seed.sql` + `rls_audit.sql`. Blocca PR su leak cross-tenant. **Sprint 5b**: pin `supabase/setup-cli@v1` versione `2.20.3` (no `latest`) + concurrency.
- `.github/workflows/ci.yml` — **Sprint 5b**: 3 jobs in matrice — `web` (lint + typecheck Ubuntu), `agents-noFeatures` (cargo check Linux per entrambi), `agents-licensed` (cargo check `--features license` Windows per entrambi).
- `.github/workflows/playwright.yml` — **Sprint 5b**: smoke E2E su `apps/web/e2e/smoke.spec.ts` con Supabase locale (setup-cli pinned). Trigger PR + nightly cron + workflow_dispatch (con input `run_signup_test` opzionale).
- `supabase/tests/rls_audit_seed.sql` — Sprint 5: seed minimo 2 tenant con UUID deterministici per CI.

### 9.2 File esterni di riferimento

- `Live 3d Ledwall Render/src-tauri/src/license/` — pattern licenze.
- `Live 3d Ledwall Render/clean-and-build.bat` — pattern build orchestrato.
- `Live 3d Ledwall Render/src-tauri/installer-hooks.nsi` — pattern firewall/Defender.
- `Live WORKS APP/functions/src/license/` — backend API (Cloud Functions Node 22).
- `Live WORKS APP/functions/src/types/index.ts` — schema risposte API (camelCase: `verifyBeforeDate`, `nextVerifyDate`, `expiresAt`).

### 9.3 Decisione su `PIANO_FINALE_SLIDE_CENTER_v1.md`

`v1` resta in repo come riferimento storico ma con header **DEPRECATO**. Tutti gli sviluppi futuri leggono **solo** questo `v2`.

---

**Andrea, prossimo step operativo (post chiusura Sprint 6 in-repo):**

Lato codice non c'e' piu' niente da chiudere per il go-to-market: **MVP + commercial hardening + onboarding wizard + healthcheck** sono tutti pronti. Il primo cliente che apre l'app vede il wizard automatico, puo' generare dati demo per esplorare, e tu hai una dashboard `/admin/health` per monitorare la piattaforma in tempo reale.

Lato codice resta solo l'attesa cert OV: appena arriva, 3 env vars e firma automatica di tutti gli installer + EXE portable + rigenera SHA256SUMS coerenti.

Le azioni rimanenti sono tutte **esterne al repo** e richiedono interazione
umana/terzi:

1. **Acquistare cert OV Sectigo** (~190 €/anno, emissione 1-2 settimane). Guida
   operativa step-by-step in `docs/Manuali/Manuale_Code_Signing.md`: reseller
   consigliato, documenti richiesti, generazione CSR via OpenSSL, import nel
   PC di build, setup PATH `signtool`, troubleshooting 8 casi documentati.
   Una volta ricevuto il `.pfx`, basta:

   ```powershell
   $env:CERT_PFX_PATH = "C:\Certs\Sectigo-OV-2026.pfx"
   $env:CERT_PASSWORD = "<la-tua-password>"
   .\release-licensed.bat
   # → tutto firmato automaticamente, SHA256SUMS rigenerato.
   ```

2. **Registrare 3 screencast onboarding** (1 giornata). Scaletta parola-per-parola
   in `docs/Manuali/Script_Screencast.md`: setup tecnico (mic, OBS, audio -16
   LUFS), preparazione ambiente demo, dialoghi precisi per video 1 (admin web
   5-6 min) + video 2 (regia 4-5 min) + video 3 (sala 3-4 min), checklist
   post-registrazione + branding.

3. **Revisione legale Contratto SLA** — passare `docs/Commerciale/Contratto_SLA.md`
   a un avvocato GDPR per revisione (preventivo 300-800 € forfait include anche
   redazione DPA art. 28 — Allegato A oggi placeholder).

4. **Approvazione Listino Prezzi** — review prezzi in
   `docs/Commerciale/Listino_Prezzi.md` (4 piani cloud + Local 490 € + Room 190 €).

5. **Listing prodotti su `liveworksapp.com`** — pagina dedicata Slide Center
   con prezzi, screenshot, screencast, CTA checkout Lemon Squeezy.

**Test sul campo (parallelo alle 5 azioni sopra):**

- Test Sprint 5b in-repo: PR di prova → verifica che i workflow `ci.yml` (3
  jobs) + `playwright.yml` (smoke) + `rls-audit.yml` girino verdi su GitHub
  Actions. Una volta confermato, abilitare branch protection su `main` con
  required checks: `Web (lint + typecheck)`, `Agents cargo check (no features)`,
  `Smoke tests (chromium)`, `RLS isolation tests`.
- Test Sprint 5: `release-licensed.bat` su PC Windows vergine produce
  installer con feature license attiva. Verifica attivazione + disinstallazione
  con `--deactivate` che libera lo slot hardware sul cloud.
- Test Sprint 2: rollout intranet su un cliente pilota con macchina di staging
  (acceptance criteria §3.6).
