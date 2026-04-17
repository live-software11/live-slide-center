# GUIDA DEFINITIVA PROGETTO � Live SLIDE CENTER

> **Documento UNICO di riferimento.** Questo file sostituisce e incorpora: `PIANO_MASTER_v3.md`, `SlideHub_Live_CURSOR_BUILD.md`, `PRE_CODE_PREPARATION.md`, `LIVE_SLIDE_CENTER_DEFINITIVO.md`. Nessun altro documento ha autorita su questo. Se trovi una contraddizione altrove, **questo vince**.
> **Versione:** 4.13.0 - 17 Aprile 2026 (**Sprint 5b in-repo chiuso al 100% — code-signing pre-integrato + CI completa + manuali pre-vendita**): completata l'ultima banda di automazione possibile prima dell'arrivo fisico del certificato OV Sectigo. Lato build: `apps/{agent,room-agent}/scripts/post-build.mjs` ora include funzione `signFileIfConfigured(filePath)` con detect env in ordine `CERT_PFX_PATH+CERT_PASSWORD` → `CERT_THUMBPRINT` → `CERT_SUBJECT`, timestamp server `TIMESTAMP_URL` (default `http://timestamp.sectigo.com`), skip silenzioso senza nessuna env (build dev locale Andrea identico a oggi), fail-fast con messaggio operativo se signtool manca o `.pfx` non esiste; signing applicato in sequenza ordinata copy→sign→zip→sha256 cosi' SHA256SUMS.txt riflette gli artefatti firmati che il cliente verifica; `release-licensed.bat` arricchito con step `1b/6` di preflight code-signing (rileva env CERT**, verifica `where signtool` PRIMA del build per evitare di scoprire problemi dopo 8-18 minuti di compilazione Rust). Lato CI: nuovo workflow `.github/workflows/ci.yml` con 3 jobs in matrice — `web` (Ubuntu, ~3 min: pnpm 9.15.9 + Node 22 + lint + typecheck), `agents-noFeatures` (Ubuntu, ~10 min: install webkit2gtk + gtk + librsvg2 + patchelf + cache Swatinem rust-cache + `cargo check --locked --bin {local-agent,room-agent}` no feature license), `agents-licensed` (Windows, ~15 min: cache cargo + `cargo check --locked --features license --bin ...` necessario su Windows perche' la dep `wmi` per fingerprint hardware e' Win-only e non compila su Linux); concurrency `cancel-in-progress` per non sprecare runner; `paths-ignore: docs/**, **.md` per non scattare su pure modifiche docs. Nuovo workflow `.github/workflows/playwright.yml` con trigger PR su `apps/web/**` + push main + nightly cron `0 3 * \* \*`UTC +`workflow_dispatch`con input`run_signup_test`; setup Supabase locale via `supabase/setup-cli@v1`versione **pinned 2.20.3** (NON`latest`: rif. supabase/cli#1737 — `latest`ha rotto piu' volte`supabase start`su CI); estrae API_URL e ANON_KEY via`supabase status -o env`e li mappa nei nomi`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`attesi da apps/web; installa Chromium con deps + esegue`pnpm exec playwright test e2e/smoke.spec.ts --project=chromium`; upload artifact `playwright-report/`retention 7 giorni. Workflow`.github/workflows/rls-audit.yml`aggiornato con stesso pin`2.20.3`+ concurrency. Lato manuali: nuovo`docs/Manuali/Manuale_Code_Signing.md`v1.0 (10 sezioni operative per Andrea: perche' firmare con stima ROI, cosa e' gia' pronto in repo, acquisto cert OV Sectigo con reseller consigliato e workflow 7 giorni, generazione CSR via OpenSSL, installazione signtool e add to PATH, configurazione env permanente vs temporanea, tabella variabili supportate, troubleshooting 8 casi documentati, rinnovo annuale, costi totali stimati anno 1 ~253€ con ROI calcolato, checklist pre-vendita firma); nuovo`docs/Manuali/Script_Screencast.md`v1.0 con scaletta parola-per-parola dei 3 video onboarding (admin web 5-6 min + regia 4-5 min + sala 3-4 min) + setup tecnico (mic, OBS, audio -16 LUFS, branding intro/outro) + preparazione ambiente demo + checklist post-registrazione + versionamento screencast. **Architettura:** ADR-014 in`.cursor/rules/project-architecture.mdc`documenta la decisione di integrare il code-signing dentro`post-build.mjs`(non in`release-licensed.bat`) per garantire la sequenza obbligatoria sign→zip→sha256, con duplicazione tra agent (coerente con ADR-012) e pattern env-driven con skip silenzioso. **PIANO_FINALE_SLIDE_CENTER_v2.md aggiornato a v2.6** con nuova sezione 6.9 "Sprint 5b" (8 sotto-sezioni: code-signing post-build DONE, ci.yml DONE, playwright.yml DONE, pin setup-cli DONE, Manuale_Code_Signing DONE, Script_Screencast DONE, ADR-014 DONE, acceptance criteria 8/10 DONE in-repo). **Manca SOLO azione esterna Andrea (non automatizzabile dal CTO)**: (1) acquisto cert OV Sectigo (~190€/anno, emissione 1-2 settimane — guida step-by-step in `Manuale_Code_Signing.md`, settare 3 env vars dopo arrivo `.pfx`e tutto firma automaticamente); (2) registrazione 3 screencast onboarding (1 giornata — scaletta parola-per-parola in`Script_Screencast.md`); (3) revisione `Contratto_SLA.md`con avvocato GDPR + redazione DPA Allegato A (preventivo 300-800€ forfait); (4) approvazione`Listino_Prezzi.md`; (5) listing prodotti su `liveworksapp.com`. **Build verde**: `pnpm install`ok, lint e typecheck`apps/web`verdi,`cargo check --features license`e`cargo check`verdi su entrambi gli agent, dry-run`release-licensed.bat`mostra correttamente "Code-signing: SKIP" senza env settate.
**Versione archivio 4.12.0:** 17 Aprile 2026 (**Sprint 5 in-repo chiuso al 100% — hardening commerciale + materiali pre-vendita**): tutto cio' che e' automatizzabile dal CTO e' completato e committabile. Aggiunte: (a)`release-licensed.bat`orchestratore build di vendita con`cargo tauri build --features license`su entrambi gli Agent + script`build:tauri:licensed`e`release:licensed`in`apps/{agent,room-agent}/package.json`. (b) Hook NSIS `installer-hooks.nsi`su Local + Room Agent: aggiunta chiamata`<agent>.exe --deactivate`come prima istruzione di`NSIS_HOOK_PREUNINSTALL`(no-op se feature`license`non compilata, libera slot hardware sul cloud se compilata). (c)`docs/Manuali/build-pdf.ps1`automatizza conversione MD → PDF via`pandoc`+`xelatex`(fallback`wkhtmltopdf`), output in `docs/Manuali/pdf/`(gitignored), README aggiornato con`winget install Pandoc + MiKTeX`. (d) GitHub Actions `.github/workflows/rls-audit.yml`: avvia Supabase locale, applica tutte le migration via `supabase db reset --no-seed`, esegue seed minimo `supabase/tests/rls_audit_seed.sql`(2 tenant + 2 user + 1 evento + 1 sala + 1 sessione + 1 speaker + 1 presentation + 2 activity_log con UUID deterministici allineati al seed in`rls_audit.sql`), poi esegue `psql -v ON_ERROR_STOP=1 -f rls_audit.sql`(ogni`[FAIL]`blocca la PR), upload log come artifact. (e)`apps/web/scripts/upload-sourcemaps.mjs`+`postbuild`in`apps/web/package.json`: upload sourcemap a Sentry via `npx @sentry/cli@latest`, **skip silenzioso** se `SENTRY_AUTH_TOKEN`non settato (dev locali ok), errore esplicito se token presente ma`SENTRY_ORG`/`SENTRY_PROJECT`mancanti, release identifier =`slide-center-web@<pkg-version>+<git-short-sha>`, cancella `.map`da`dist/`dopo upload. (f) Bozze commerciali in nuova cartella`docs/Commerciale/`: `Contratto_SLA.md`v1.0 (10 sezioni: oggetto, attivazione + device limit, SLA cloud 99.5%, SLA desktop, sicurezza/GDPR + DPA art. 28, limitazioni responsabilita 100% canone annuo, durata + recesso, supporto P1/P2/P3/P4, IP, foro Roma legge italiana — bozza tecnica, richiede revisione legale),`Listino_Prezzi.md`v1.0 (4 piani cloud Trial/Starter/Pro/Enterprise + acquisto separato Local 490€/Room 190€ + bundle inclusi Pro/Enterprise + servizi aggiuntivi onboarding/affiancamento/sviluppo + sconti pluri-licenza/lancio/referral + esempio preventivo agenzia 8 eventi/anno + confronto competitor — bozza commerciale, richiede approvazione Andrea),`README.md` con stato bozze + schema DPA Allegato A da redigere con avvocato. (g) **Webhook Lemon Squeezy NON necessario in repo Slide Center**: gia' presente in Live WORKS APP (`functions/src/webhooks/lemonsqueezy.ts`con HMAC + eventi`order_created`+`subscription*_`+ generazione license keys + idempotenza), che propaga gli eventi a Slide Center via Edge Function`licensing-sync`esistente da v4.8. Aggiungere un secondo webhook su Supabase creerebbe duplicazione, race conditions e doppio source-of-truth. **ADR-013** in`.cursor/rules/project-architecture.mdc`documenta questa scelta architetturale (singola fonte di verita Lemon → Live WORKS APP → Slide Center). (h)`.gitignore`: aggiunta `docs/Manuali/pdf/`per non committare PDF generati. **Manca SOLO azione esterna Andrea (non automatizzabile dal CTO)**: acquisto cert OV Sectigo (~190€/anno, 1-2 settimane), revisione SLA + redazione DPA art. 28 con avvocato GDPR (preventivo 300-800€ forfait), registrazione 3 screencast onboarding (~5min ciascuno), listing prodotti su`liveworksapp.com`. **Build verde**: `pnpm install`ok, lint e typecheck`apps/web`verdi,`cargo check --features license`e`cargo check`verdi su entrambi gli agent.
**Versione archivio 4.11.0:** 17 Aprile 2026 (**Sprint 4 chiuso al 100% — sistema licenze client Tauri integrato**): completata la parte client del sistema licenze centralizzato Live WORKS APP gia implementato lato cloud in v4.8. Per ogni Agent Tauri (Local + Room) creato modulo Rust completo`apps/{agent,room-agent}/src-tauri/src/license/`(7 file gemelli:`mod.rs`con`PRODUCT_ID`e chiave AES-256-GCM dedicata + diversa per agent,`types.rs`con DTO API e`LicenseStatus`enum a 7 stati,`crypto.rs`con`aes-gcm`0.10 e nonce random per ogni encrypt + 4 unit test,`fingerprint.rs`con WMI`Win32_BaseBoard.SerialNumber`+`Win32_Processor.ProcessorId`+`Win32_DiskDrive.SerialNumber`-> SHA-256 + 1 unit test,`api.rs`con`reqwest`async + user-agent dedicato per agent,`manager.rs`con orchestrazione activate/verify/deactivate + grace period 30gg + spawn_blocking per WMI,`commands.rs`con 5 comandi Tauri);`Cargo.toml`con feature flag`license`opzionale (default off per dev, on per build di vendita:`cargo tauri build --features license`); `main.rs`con early-return su flag CLI`--deactivate`(hook NSIS pre-uninstall) + registrazione condizionale dei comandi via`#[cfg(feature = "license")]`; `lib.rs`con`pub mod license`; UI `apps/{agent,room-agent}/ui/index.html`arricchita con card "Licenza" (input chiave + status pill + bottoni Attiva/Disattiva/Verifica/Copia fingerprint + dettagli cliente/scadenza), overlay full-screen di gating quando licenza non valida, polling 30s automatico per stato`pendingApproval`, JS i18n IT/EN dinamico via `navigator.language`, fallback grazioso se feature `license`non compilata (card e overlay nascosti); chiavi`license._`in`packages/shared/src/i18n/locales/{it,en}.json`; ADR-012 in `.cursor/rules/project-architecture.mdc`con razionale code-duplication vs shared crate, pattern di riferimento Live 3d Ledwall Render, allineamento API a`Live WORKS APP/functions/src/types/index.ts`(camelCase), acceptance criteria; manuali operatore aggiornati con sezione "Attivazione licenza" su entrambi gli installer + sezione "Build con feature license" nel manuale distribuzione;`cargo check --features license`e`cargo check` (no feature) verdi su entrambi gli agent, 10 unit test passano (`cargo test --features license --lib license::`), `pnpm lint`e`pnpm typecheck`su`apps/web`verdi.: (a) **Root**:`clean-and-build.bat`orchestratore completo (verifica toolchain Node/pnpm/cargo/cargo-tauri →`pnpm install`con fallback senza lockfile → pulizia`release/` → build Local Agent → build Room Agent → check artefatti finali con riepilogo). (b) **Local Agent (`apps/agent`)**: nuovi `package.json`(workspace`@slidecenter/agent-build`, no deps esterne — usa PowerShell `Compress-Archive`built-in),`scripts/clean.mjs`(default mantiene cache Rust per build incrementali ~1-3 min,`--full`la rimuove),`scripts/post-build.mjs`(copia NSIS in`release/live-slide-center-agent/Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe`, crea ZIP portable + README dedicato, calcola `SHA256SUMS.txt`per checklist anti-tamper);`tauri.conf.json`con`bundle.targets: ["nsis"]` (rimosso MSI superfluo, dimezza tempo di build); README aggiornato. (c) **Room Agent (`apps/room-agent`)**: gemello con `@slidecenter/room-agent-build`, stessa struttura di scripts e output `release/live-slide-center-room-agent/`; README aggiornato. (d) **Documentazione operatore**: nuova cartella `docs/Manuali/`con`README.md`indice,`Manuale_Distribuzione.md`(procedura interna Andrea: toolchain, build, layout output, code-signing SmartScreen, checklist consegna licenza, troubleshooting),`Manuale_Installazione_Local_Agent.md`(operatore regia: requisiti HW, installazione, scenari cloud/intranet, troubleshooting LAN, modalita portable rescue),`Manuale_Installazione_Room_Agent.md` (operatore PC sala: discovery 4-tier, IP manuale fallback, badge connettività, troubleshooting Defender/firewall). (e) **`.gitignore`**: nuova entry `release/`per non trackare artefatti di distribuzione. Smoke test verde:`pnpm install`(6 workspace),`npm run clean`Local+Room Agent,`cargo check`Local+Room Agent (cache 1-2s), lint+typecheck`apps/web`, validazione sintattica e load script post-build. Roadmap residua (Sprint 4 client licenze + Sprint 5 hardening commerciale) tracciata in `docs/PIANO_FINALE_SLIDE_CENTER_v2.md`.
**Versione archivio 4.10.0:** 17 Aprile 2026 (**Sprint 3 chiuso al 100% — distribuzione desktop NSIS + portable**): (a) **Root**: `clean-and-build.bat` orchestratore completo. (b) **Local Agent (`apps/agent`)**: nuovi `package.json`(workspace`@slidecenter/agent-build`), `scripts/clean.mjs`+`scripts/post-build.mjs`(NSIS + ZIP portable +`SHA256SUMS.txt`); `tauri.conf.json`con`bundle.targets: ["nsis"]`. (c) **Room Agent (`apps/room-agent`)**: gemello con script analoghi. (d) **Manuali operatore** in `docs/Manuali/`(Distribuzione + Local Agent + Room Agent). Doppio click sulla root produce`release/live-slide-center-{agent,room-agent}/` pronto per consegna.

> **Versione archivio 4.9.0:** 17 Aprile 2026 (**Sprint 2 chiuso al 100% — intranet offline + bypass Windows 11**): (a) **Local Agent**: `installer-hooks.nsi` apre regole firewall su TCP 8080 (HTTP server) + UDP 9999 (discovery broadcast) + UDP 5353 (mDNS) limitate a profili `private,domain`, esclusione Defender su `%LOCALAPPDATA%\LiveSLIDECENTER`, set rete a Private; `tauri.conf.json` aggancia hooks + WebView2 `embedBootstrapper silent`; nuovo modulo `discovery.rs` con responder UDP `:9999` (rispondendo a query "slide-center" con announcement JSON `{ip, port, version, hostname}`) + advertiser mDNS su `_slide-center._tcp.local.` (thread dedicato `std::thread::Builder` per disaccoppiare il daemon dal runtime tokio); deps `mdns-sd` 0.13, `local-ip-address` 0.6, `gethostname` 0.5. (b) **Room Agent**: nuovo `motw.rs` con `strip_mark_of_the_web` che rimuove l'ADS `Zone.Identifier` via `winapi::um::fileapi::DeleteFileW`, integrato in `downloader.rs` dopo rename atomico (`<file>.part` → `<file>`); nuovo `discovery.rs` con cascata 4-tier (UNC `\\<host>\SlideCenter$\agent.json` → UDP broadcast `255.255.255.255:9999` → mDNS browse → IP manuale) e cache 60s persistita in `state.last_discovery`; comandi Tauri `cmd_discover_agent`, `cmd_set_manual_agent`, `cmd_set_network_private`; `installer-hooks.nsi` (esclusione Defender `%LOCALAPPDATA%\SlideCenter`, set rete Private, eccezione UDP 5353 in entrata); `tauri.conf.json` aggiornato. (c) **Web RoomPlayerView**: nuovo hook `useConnectivityMode.ts` con health-probe Local Agent ogni 15s + 4 stati (`cloud-direct` / `lan-via-agent` / `intranet-only` / `offline`); chip `ConnectivityChip` + banner contestuali. (d) **i18n**: chiavi `intranet.*` IT/EN (status, hint, banner, networkMode, discoveryFile/Udp/Mdns/Manual). Roadmap residua (Sprint 3 desktop distribution + Sprint 5 hardening commerciale) tracciata in `docs/PIANO_FINALE_SLIDE_CENTER_v2.md`.
> **Versione archivio 4.8.0:** 17 Aprile 2026 (**Sprint 1 chiuso + upload admin + spostamento presentation + integrazione licenze Live WORKS APP:** (a) UI presentation arricchita: `AdminUploaderInline` con drag-and-drop (TUS via 3 RPC `init_upload_version_admin` / `finalize_upload_version_admin` / `abort_upload_version_admin`, RLS `tenant_insert_uploading_version` su storage.objects), `MovePresentationDialog` per spostare presentation tra speaker dello stesso evento (RPC `rpc_move_presentation`), hook `useEventPresentationSpeakerIds` realtime; (b) fix 401 pair-init: `ensureFreshAccessToken()` in `repository.ts` con refresh proattivo session, errori specifici `EdgeFunctionAuthError` / `EdgeFunctionMissingError` propagati a `PairingModal` con messaggi i18n dedicati; (c) **Sprint 4 Live WORKS APP — fondamenta**: nuova migration `20260417120000_tenant_license_sync.sql` (colonne `tenants.{license_key, license_synced_at, expires_at, max_devices_per_room}` + trigger `tenant_apply_expiry` + RPC `licensing_apply_quota` SECURITY DEFINER con grant `service_role`); Edge Function `supabase/functions/licensing-sync/` con verifica HMAC SHA-256 + anti-replay timestamp; lato Live WORKS APP estensione `LicenseDoc.slideCenter` (plan, storage, max sale/PC, expiresAt, lastSyncedAt), modulo `slide-center-products.ts` (SKU `slide-center-cloud|agent|room-agent`), modulo `slide-center-sync.ts` (HMAC client), endpoint admin `POST /api/admin/slide-center/sync`, trigger `onLicenseChangedSyncSlideCenter` con anti-loop, dialog `GenerateLicenseDialog` esteso con pannello quote SC e dialog quote in `LicensesPage`; seed Firestore aggiornato con i 3 prodotti SC + bundle `slide-center-suite`. Tipi `Database` Slide Center estesi e ricompilati (`@slidecenter/shared`). Lint + typecheck verdi su entrambe le code-base. Roadmap completa in `docs/PIANO_FINALE_SLIDE_CENTER_v2.md`.)
> **Versione archivio 4.7.0:** 17 Aprile 2026 (Sprint 1 — Fase 14 al 100%: invitations, password reset, ErrorBoundary+Sentry, Playwright, RLS audit. Roadmap Sprint 2-5 in `PIANO_FINALE_SLIDE_CENTER_v2.md`.)
> **Versione archivio 4.6.0:** 16 Aprile 2026 (**Fase 14 — Hardening + Sentry (in corso):** rate limiting server-side pair-claim (tabella `pair_claim_rate_events`, 5 tentativi/15 min per IP hash); RLS `current_tenant_suspended()` su tutte le tabelle operative (tenant sospeso = dati bloccati, SELECT `users`/`tenants` preservato); Sentry React SDK con lazy import condizionale (`VITE_SENTRY_DSN`); PairView auto-submit fix; Playwright scaffolding. Fasi 0-13 completate al 100%.)
> **Versione archivio 4.5.0:** 16 Aprile 2026 (**Fase 13 — Integrazioni ecosistema (100%):** sezione `/settings` con collegamenti opzionali a Live Speaker Timer e Live CREW via `VITE_LIVE_SPEAKER_TIMER_URL` / `VITE_LIVE_CREW_URL` in `.env` root; copy + badge roadmap per API pubblica; chiavi `settings.integrations*` IT/EN; variabili CSS agent/room-agent allineate a §13. Per Dual-Mode Fase 7 e note Fase 12/11/10/9 vedi righe seguenti.)
> **Versione archivio 4.4.0:** 16 Aprile 2026 (Fase 7 completata: Dual-Mode File Sync � Blocco A: File System Access API nel Room Player PWA per download automatico su disco; Blocco B: Local Agent Tauri v2 `apps/agent/` con Axum HTTP :8080, SQLite WAL, sync engine da Supabase Storage; Blocco C: Room Agent Tauri v2 `apps/room-agent/` con polling LAN, autostart HKCU, tray icon; Blocco D: colonna `network_mode` ENUM `cloud|intranet|hybrid` sulla tabella `events`; i18n `event.networkMode_*` IT/EN; selettore modalita rete nel form modifica evento; ADR-007 dual-mode per evento. Fasi precedenti: 0-6 completate al 100% inclusi MVP Cloud, Upload Portal TUS, versioning presentazioni, Vista Regia realtime, Pairing Device + Room Player PWA. Brand: logo ufficiale `icons/Logo Live Slide Center.jpg`, generazione favicon/PWA/UI con Sharp in prebuild/predev, componente `AppBrandLogo` e i18n `app.displayName` — vedi §13.)
> **Autore:** Andrea Rizzari + CTO Senior AI Review
> **Nota release 4.12.0 (Sprint 5 — Hardening commerciale + materiali pre-vendita):** Sprint 5 chiuso per la parte automatizzabile dal CTO. **Build di vendita orchestrato**: `release-licensed.bat` in root (variante di `clean-and-build.bat` con `npm run release:licensed` invece di `release:full`); script `build:tauri:licensed` (`cargo tauri build --features license`) e `release:licensed` aggiunti in `apps/{agent,room-agent}/package.json`; hook NSIS `installer-hooks.nsi` su entrambi gli Agent: aggiunta chiamata `<agent>.exe --deactivate` come prima istruzione di `NSIS_HOOK_PREUNINSTALL` (no-op se feature `license` non compilata, libera slot hardware sul cloud Live WORKS APP se compilata). **Manuali PDF**: nuovo `docs/Manuali/build-pdf.ps1` automatizza conversione MD → PDF via `pandoc` + `xelatex` (con fallback `wkhtmltopdf`); output in `docs/Manuali/pdf/` (gitignored); README aggiornato con `winget install --id JohnMacFarlane.Pandoc -e` + `winget install --id MiKTeX.MiKTeX -e`. **CI RLS audit**: `.github/workflows/rls-audit.yml` esegue `supabase start --exclude studio,inbucket,...` + `supabase db reset --no-seed` + seed minimo `supabase/tests/rls_audit_seed.sql` (2 tenant + 2 user + 1 evento + 1 sala + 1 sessione + 1 speaker + 1 presentation + 2 activity*log con UUID deterministici allineati ai `\set` in `rls_audit.sql`) + `psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_audit.sql`; ogni `[FAIL]` blocca la PR; upload log come artifact (retention 14 giorni); trigger su path `supabase/migrations/**`, `supabase/tests/**`, `supabase/functions/**`, `supabase/config.toml`, workflow stesso. **Sentry sourcemap upload**: `apps/web/scripts/upload-sourcemaps.mjs` + `postbuild` in `apps/web/package.json`; usa `npx @sentry/cli@latest` (no devDep aggiunta); **skip silenzioso** se `SENTRY_AUTH_TOKEN` non settato (dev locali ok), errore esplicito se token presente ma `SENTRY_ORG`/`SENTRY_PROJECT` mancanti; release identifier = `slide-center-web@<pkg-version>+<git-short-sha>` (auto da git rev-parse); pipeline: `releases new` → `releases set-commits --auto --ignore-missing` → `upload-sourcemaps --rewrite --url-prefix "~/" --validate` → `releases finalize`; cancella `.map` da `dist/` dopo upload (non vanno serviti pubblicamente). **Materiali commerciali**: nuova cartella `docs/Commerciale/` con `Contratto_SLA.md` v1.0 (10 sezioni B2B SaaS italiano: oggetto, attivazione + device limit + cambio PC, SLA cloud 99.5% + crediti, SLA desktop + grace period 30gg, sicurezza + GDPR + DPA art. 28 + diritto all'oblio + notifica breach 24h, limitazioni responsabilita massimale 100% canone annuo, durata + recesso, supporto P1/P2/P3/P4 con tempi risposta, IP, foro Roma legge italiana — **bozza tecnica**, richiede revisione legale prima della firma cliente), `Listino_Prezzi.md` v1.0 (4 piani cloud Trial 0€/Starter 600€/Pro 1.800€/Enterprise da 4.500€ + acquisto separato Local 490€/Room 190€ + bundle Local 1 + Room 5 inclusi in Pro + Room aggiuntivo 120€ + subscription mensile alternativa + servizi onboarding/affiancamento/sviluppo/migrazione + sconti pluri-licenza/pagamento annuale/lancio/referral + esempio preventivo agenzia 8 eventi/anno = 1.920€/anno + confronto competitor — **bozza commerciale**, richiede approvazione Andrea), `README.md` con stato + schema DPA Allegato A (10 punti raccomandati per redazione con avvocato GDPR). **Webhook Lemon Squeezy NON necessario in repo Slide Center**: gia' presente in Live WORKS APP `functions/src/webhooks/lemonsqueezy.ts` con HMAC SHA-256 + verifyTimingSafe + eventi `order_created`/`subscription*\*`+ generazione license keys via`generateLicenseKey`+ idempotenza, propaga eventi a Slide Center via Edge Function`licensing-sync`esistente da v4.8 (HMAC + anti-replay timestamp + RPC`licensing_apply_quota`SECURITY DEFINER). Aggiungere un secondo webhook su Supabase = duplicazione, race condition, doppio source-of-truth. **ADR-013** in`.cursor/rules/project-architecture.mdc` documenta scelta architetturale (singola fonte di verita Lemon → Live WORKS APP → Slide Center). **`.gitignore`** aggiornato con `docs/Manuali/pdf/`. **PIANO_FINALE_SLIDE_CENTER_v2.md aggiornato a v2.5** con sezione 6 riscritta (8 sotto-sezioni: PDF DONE, Webhook NON necessario, Sentry DONE, RLS CI DONE, build-licensed DONE, materiali commerciali DONE, azioni esterne pending, acceptance criteria 7/9 DONE in-repo). **Manca SOLO azione esterna Andrea (non automatizzabile dal CTO)**: (1) acquisto cert OV Sectigo per code-signing SmartScreen (~190€/anno, emissione 1-2 settimane), poi integrazione `signtool sign /f cert.pfx /p $env:CERT_PASSWORD ...`in`release-licensed.bat`; (2) revisione `Contratto_SLA.md`con avvocato GDPR + redazione DPA Allegato A (preventivo 300-800€ forfait, 1-2 settimane); (3) registrazione 3 screencast onboarding (~5min ciascuno: admin web, regia con Local Agent, sala con Room Agent); (4) listing prodotti su sito marketing`liveworksapp.com`con prezzi + screenshot + screencast + CTA checkout Lemon Squeezy. **Build verde**:`pnpm install`ok, lint e typecheck`apps/web`verdi,`cargo check --features license`e`cargo check` verdi su entrambi gli agent.

> **Nota release 4.11.0 (Sprint 4 — Sistema licenze client Tauri):** Sprint 4 completato. La parte cloud era gia' in v4.8 (migration `20260417120000_tenant_license_sync.sql` + Edge Function `licensing-sync` HMAC + integrazione Live WORKS APP `LicenseDoc.slideCenter`). Ora aggiunta la parte client Tauri per entrambi gli Agent. **Local Agent (`apps/agent`)**: nuovi `src-tauri/src/license/{mod,types,crypto,fingerprint,api,manager,commands}.rs` (7 file, ~600 LOC totali); `Cargo.toml` con feature flag opzionale `license = ["dep:aes-gcm", "dep:wmi"]` (default off); `lib.rs` con `pub mod license`; `main.rs` con `if std::env::args().any(|a| a == "--deactivate")` early-return per hook NSIS pre-uninstall + registrazione condizionale via `#[cfg(feature = "license")]` dei 5 comandi `license_{activate,verify,deactivate,status,fingerprint}`; UI `apps/agent/ui/index.html` con CSS dedicato + card "Licenza" + overlay full-screen di gating + JS i18n IT/EN dinamico via `navigator.language` + polling 30s su stato `pendingApproval` + chiamate `invoke('license_*')` + fallback grazioso se feature non compilata. **Room Agent (`apps/room-agent`)**: gemello con `PRODUCT_ID="slide-center-room-agent"`, `APP_DATA_DIR="com.livesoftware.slidecenter.roomagent"`, **chiave AES-256-GCM diversa** (impedisce copy/paste `license.enc` tra installazioni), user-agent HTTP `LiveSlideCenterRoomAgent/<ver>`. Stessa UI license card + overlay nel suo `ui/index.html`. **Shared i18n**: nuove chiavi `license.*` in `packages/shared/src/i18n/locales/{it,en}.json` (IT + EN parity). **ADR-012** "Licenze Local + Room Agent via Live WORKS APP" in `.cursor/rules/project-architecture.mdc` con decisione architetturale code-duplication vs shared crate (3 motivi: chiavi AES dedicate per impedire reuse, isolamento `APP_DATA_DIR`, evitare ristrutturazione del Cargo workspace dentro pnpm monorepo), pattern di riferimento `Live 3d Ledwall Render`, allineamento API a `Live WORKS APP/functions/src/types/index.ts` (camelCase: `verifyBeforeDate`, `nextVerifyDate`, `expiresAt`, `pendingApproval`), acceptance criteria. **Manuali operatore aggiornati**: `Manuale_Distribuzione.md` versione 0.1.1 con sezione "2.1 Build CON sistema licenze (vendita)"; `Manuale_Installazione_Local_Agent.md` versione 0.1.1 con nuova sezione "4. Attivazione licenza" (procedura prima attivazione, cambio PC, fingerprint, modalita offline + grace period 30gg); `Manuale_Installazione_Room_Agent.md` versione 0.1.1 con sezione "4. Attivazione licenza" + suggerimento operativo "etichetta chiavi per sala". **Build verde**: `cargo check` (no feature) e `cargo check --features license` ok su entrambi gli Agent; 10 unit test passano (`cargo test --features license --lib license::` su `crypto::*` e `fingerprint::*`); `pnpm --filter ./apps/web lint` e `pnpm --filter ./apps/web typecheck` verdi. **Manca per Sprint 5**: code-signing OV/EV (Sectigo) per eliminare SmartScreen, screencast onboarding, listing prodotti su sito marketing, contratto SLA, Lemon Squeezy webhook in-repo per fatturazione automatica.

> **Nota release 4.10.0 (Sprint 3 — Distribuzione desktop):** Tutti i deliverable di Sprint 3 chiusi. **Root**: `clean-and-build.bat` (orchestratore 6 step con check toolchain, install pnpm, clean release/, build entrambi gli Agent, riepilogo artefatti). **Local Agent build**: `apps/agent/package.json` (`@slidecenter/agent-build`, no deps esterne), `apps/agent/scripts/clean.mjs`, `apps/agent/scripts/post-build.mjs` (NSIS rinominato + portable ZIP via PowerShell `Compress-Archive` + `SHA256SUMS.txt`); `apps/agent/src-tauri/tauri.conf.json` con `bundle.targets: ["nsis"]`; `apps/agent/README.md` aggiornato. **Room Agent build**: gemelli `apps/room-agent/{package.json, scripts/clean.mjs, scripts/post-build.mjs}` + `tauri.conf.json` allineato + `README.md`. **Documentazione operatore**: `docs/Manuali/{README.md, Manuale_Distribuzione.md, Manuale_Installazione_Local_Agent.md, Manuale_Installazione_Room_Agent.md}` (pronti per `pandoc` → PDF in Sprint 5). **`.gitignore`**: aggiunta `release/`. Output atteso doppio click `clean-and-build.bat`: `release/live-slide-center-{agent,room-agent}/` con installer NSIS + portable ZIP + checklist SHA-256. Smoke test verde su tutto. Acceptance criteria §4.8 di `docs/PIANO_FINALE_SLIDE_CENTER_v2.md` soddisfatti (mancano solo prove sul campo: doppio click reale + verifica installer NSIS su PC vergine, da fare prima della prima vendita).
> **Nota release 4.9.0 (Sprint 2 — Intranet offline + bypass Win11):** Tutti i deliverable di Sprint 2 chiusi e pronti per build. **Local Agent**: `apps/agent/src-tauri/installer-hooks.nsi`, `apps/agent/src-tauri/src/discovery.rs`, `apps/agent/src-tauri/src/lib.rs`, `apps/agent/src-tauri/src/main.rs`, `apps/agent/src-tauri/Cargo.toml`, `apps/agent/src-tauri/tauri.conf.json`. **Room Agent**: `apps/room-agent/src-tauri/installer-hooks.nsi`, `apps/room-agent/src-tauri/src/{discovery,motw,downloader,state,lib,main}.rs`, `apps/room-agent/src-tauri/Cargo.toml`, `apps/room-agent/src-tauri/tauri.conf.json`, `apps/room-agent/ui/index.html`. **Web Slide Center**: `apps/web/src/features/devices/hooks/useConnectivityMode.ts`, `apps/web/src/features/devices/RoomPlayerView.tsx`. **Shared i18n**: chiavi `intranet.*` in `packages/shared/src/i18n/locales/{it,en}.json` (status, hint, banner, networkMode + label discovery). Acceptance criteria definiti in `docs/PIANO_FINALE_SLIDE_CENTER_v2.md` §3.6. Prossimo step: Sprint 3 (`clean-and-build.bat` + distribuzione installer).
> **Nota release 4.8.0:** Tre macro-tasks chiusi in un'unica iterazione. (1) **Upload admin + spostamento presentation**: nuova migration `20260417110000_admin_uploads_and_move_presentation.sql` (RPC + RLS storage), componenti `AdminUploaderInline.tsx` e `MovePresentationDialog.tsx`, hook `useEventPresentationSpeakerIds`, integrazione in `PresentationVersionsPanel.tsx` + `EventDetailView.tsx`, tipi `Functions` shared aggiornati. (2) **Fix 401 pair-init**: `ensureFreshAccessToken()` + classi errore dedicate (`EdgeFunctionAuthError`, `EdgeFunctionMissingError`) in `apps/web/src/features/devices/repository.ts`, propagazione in `usePairingFlow.ts` e `PairingModal.tsx` con i18n IT+EN. (3) **Sprint 4 — Integrazione licenze Live WORKS APP**: migration `20260417120000_tenant_license_sync.sql` (colonne tenant + trigger + RPC `licensing_apply_quota`), Edge Function `licensing-sync` con HMAC SHA-256 + anti-replay timestamp; lato Live WORKS APP `LicenseDoc.slideCenter`, modulo SKU `slide-center-products.ts`, libreria HMAC `slide-center-sync.ts`, endpoint admin `POST /api/admin/slide-center/sync`, trigger Firestore `onLicenseChangedSyncSlideCenter` con anti-loop, UI `GenerateLicenseDialog` (step 3 esteso con pannello quote) + dialog "Slide Center · quote" in `LicensesPage`, helper frontend `src/lib/slide-center-products.ts`; seed Firestore con 3 prodotti `slide-center-*` + bundle `slide-center-suite`. Tipi `Database` Slide Center aggiornati (`tenants.{max_devices_per_room, expires_at, license_key, license_synced_at}` + RPC `tenant_max_devices_per_room` e `licensing_apply_quota`). Lint + typecheck verdi su `apps/web` Slide Center, `liveworks-license-functions`, `live-works-app`. Roadmap residua (Sprint 2 intranet offline + Sprint 3 desktop distribution + Sprint 5 hardening commerciale) tracciata in `docs/PIANO_FINALE_SLIDE_CENTER_v2.md`.
> **Nota release 4.7.0:** Sprint 1 — Fase 14 al 100% (vedi roadmap §15 e checklist §18). Tutti i deliverable in repo: migration `20260417100000_team_invitations.sql`, Edge Function `supabase/functions/team-invite-accept/`, viste `TeamView`/`AcceptInviteView`/`ForgotPasswordView`/`ResetPasswordView`, `ErrorBoundary` + `unhandledrejection` listener (`apps/web/src/main.tsx`), Playwright (`apps/web/playwright.config.ts` + `apps/web/e2e/{smoke,signup-flow,rls-isolation}.spec.ts`), `supabase/tests/rls_audit.sql`, i18n IT+EN parity.
> **Nota release 4.6.0:** Fase 14 **in corso** — migration `20250416140300_phase14_pair_claim_rate_limit.sql` + `20250416140301_phase14_rls_tenant_suspended.sql`; `@sentry/react` lazy init; `pair-claim` Edge Function con rate limit 5/15min allineato a §8; RLS granulare suspended con `current_tenant_suspended()` SECURITY DEFINER; `PairView` stale-closure fix; `VITE_SENTRY_DSN` in `turbo.json` globalEnv + `vite-env.d.ts`. Rimangono: audit RLS completo, Playwright E2E, Sentry `captureException` nelle boundary di errore.
> **Nota release 4.5.0:** Fase 13 al **100%** — `SettingsView` esteso (`integrations-env.ts`, `.env.example`, `vite-env.d.ts`); ADR-011 in `.cursor/rules/project-architecture.mdc`. Sync dati real-time con Timer/CREW e pubblicazione API REST = roadmap post-MVP / Fase 14 dove applicabile.
> **Nota release 4.4.0:** Fase 12 — i18n completamento: chiavi `settings.*` (pagina `/settings` con selettore lingua IT/EN + `i18n.changeLanguage`, persistenza `localStorage` via detector esistente), `common.menu` per `aria-label` Room Player; `HydrateFallback` router usa `i18n.t('common.loading')` (niente stringhe hardcoded EN); parity IT/EN verificata su `it.json`/`en.json`.
> **Nota release 4.3.0:** Fase 11 — `/billing` per admin tenant: `BillingView`, confronto piani `PLAN_LIMITS`, quote `TenantQuotaPanel`, URL Lemon Squeezy opzionali (`VITE_LEMONSQUEEZY_*`, `VITE_LIVE_WORKS_APP_URL`), `RequireTenantAdmin`, i18n `billing.*` IT/EN; `.env.example` aggiornato.
> **Nota release 4.2.0:** Fase 10 — export fine evento in `/events/:eventId`: ZIP slide versione corrente (`jszip` + signed URL Storage), CSV UTF-8 BOM `activity_log` per `event_id`, PDF report metadati (`jspdf`); `EventExportPanel` lazy-loaded; `createVersionDownloadUrlWithClient` in `presentations/repository.ts`; i18n `event.export.*` IT/EN.
> **Nota release 4.1.0:** Fase 9 — Edge `room-player-bootstrap`, routing Room Player cloud/LAN/hybrid, cache manifest offline + Workbox signed URL.
> **Stack:** React 19 + Vite 8 + TypeScript strict + Supabase + Vercel � gia funzionante nel repo

---

## INDICE

1. [Obiettivi Strategici](#1-obiettivi-strategici)
2. [Analisi Competitiva](#2-analisi-competitiva)
3. [Decisioni Architetturali](#3-decisioni-architetturali)
4. [Architettura e Scenari Network](#4-architettura-e-scenari-network)
5. [Stack Tecnologico](#5-stack-tecnologico)
6. [Isolamento Multi-Tenant](#6-isolamento-multi-tenant)
7. [Schema Database Completo](#7-schema-database-completo)
8. [Pairing Dispositivi](#8-pairing-dispositivi)
9. [Flussi di Sistema](#9-flussi-di-sistema)
10. [Dashboard Super-Admin](#10-dashboard-super-admin)
11. [Dashboard Tenant](#11-dashboard-tenant)
12. [Piani Commerciali e Quote](#12-piani-commerciali-e-quote)
13. [Design System](#13-design-system)
14. [Guida Networking Operativa](#14-guida-networking-operativa)
15. [Roadmap Esecutiva](#15-roadmap-esecutiva) (in coda: stima avanzamento % MVP e problemi noti toolchain)
16. [Struttura Monorepo](#16-struttura-monorepo)
17. [Account e Infrastruttura](#17-account-e-infrastruttura)
18. [Checklist Pre-Fase-1](#18-checklist-pre-fase-1)
19. [Regole Non Negoziabili](#19-regole-non-negoziabili)

---

## 1. Obiettivi Strategici

1. **SaaS multi-tenant puro** � ogni azienda cliente ha il proprio spazio isolato: dashboard, eventi, file. Zero contaminazioni tra clienti.
2. **Onboarding frictionless** � signup ? tenant ? primo evento ? invito relatori: meno di 10 minuti.
3. **Zero-config per i PC sala** � il tecnico digita un codice di 6 cifre, il PC e configurato. Niente software da installare.
4. **Due modalita di rete** � cloud puro (default) oppure rete locale gestita (per eventi grandi o senza internet).
5. **Funzionamento offline garantito** � con Local Agent attivo, l'evento non si ferma mai.
6. **Partenza a costo zero** � infrastruttura gratuita fino al primo cliente pagante, scalabile senza riscrivere codice.
7. **Due dashboard** � Super-Admin per Andrea (visione globale) + Dashboard Tenant per ogni cliente (solo i propri dati).

---

## 2. Analisi Competitiva

### Slidecrew (Olanda) � concorrente diretto piu forte

| Aspetto             | Dettaglio                                                                         |
| ------------------- | --------------------------------------------------------------------------------- |
| **Pricing**         | �76/sala/giorno + �10/25GB extra + �700/giorno supporto on-site (IVA esclusa)     |
| **Modello**         | Pay-per-event, NON SaaS subscription                                              |
| **Punti di forza**  | Local caching server, app tecnici/moderatori/timer/kiosk, e-poster, branding, API |
| **Clienti**         | ECR 2025 (27 sale, 3037 presentazioni), FESSH 2024 (8 sale, 780 presentazioni)    |
| **Limiti**          | No SaaS self-service, pricing opaco, no offline-first nativo                      |
| **Calcolo esempio** | Congresso 3 giorni, 5 sale = 5 � 3 � �76 = **�1.140** per evento singolo          |

### SLIDEbit (TC Group, Firenze)

Software proprietario + hardware (e-lectern), 25+ anni nel medicale, SENDbit per upload remoto. No SaaS, no self-service, pricing opaco.

### Preseria (Norvegia)

SaaS con app desktop Windows/Mac. Upload intuitivo, sync veloce, offline mode. Meno funzionalita di regia, no multi-projection.

### Posizionamento Live SLIDE CENTER

| Differenziatore    | Vs Slidecrew                                    | Vs SLIDEbit         | Vs Preseria              |
| ------------------ | ----------------------------------------------- | ------------------- | ------------------------ |
| **SaaS flat-rate** | �149/mese per 5 eventi vs �1.140/singolo evento | SaaS vs hardware    | Comparabile + ecosistema |
| **Zero-config PC** | Codice 6 cifre vs setup tecnico                 | Codice vs e-lectern | Codice vs app desktop    |
| **Offline-first**  | Architettura nativa vs caching add-on           | Comparabile         | Comparabile              |
| **Ecosistema**     | Timer + Teleprompter + CREW + PLAN              | Standalone          | Standalone               |

**Vantaggio prezzo:** cliente con 3 eventi/mese da 5 sale ? �149/mese (Starter) vs ~�3.420/mese su Slidecrew. Risparmio **96%**.

---

## 3. Decisioni Architetturali

### ADR-001: Room Player = file manager ATTIVO con download locale (Chrome/Edge)

Il Room Player e una PWA che mostra nome sala, file disponibili e li **scarica automaticamente su disco** tramite la **File System Access API** (Chrome 86+/Edge 86+). Il tecnico sceglie la cartella locale una sola volta (handle salvato in IndexedDB, persiste tra sessioni). Quando arriva una nuova versione via Realtime, la PWA genera un signed URL da Supabase Storage e scrive il file direttamente nella cartella scelta. Il tecnico apre il file manualmente dal suo software preferito. Zero integrazione COM Office, zero rischio crash.

**Flusso:**

1. Primo avvio ? banner "Scegli cartella locale per le slide"
2. Tecnico seleziona cartella (es. `D:\Slide Evento`) ? handle persistito in IndexedDB
3. Supabase Realtime notifica nuova versione `status='ready'` per la sala
4. PWA genera signed URL (5 min) + scarica con streaming + scrive su disco
5. UI mostra progresso per-file e stato (In attesa / Download xx% / Sul disco / Errore)

**Modalita intranet:** se l'evento ha `network_mode='intranet'`, usa Room Agent + Local Agent invece della PWA (vedi ADR-007).

### ADR-002: Pairing = OAuth Device Flow (RFC 8628)

Pattern standard AppleTV/Netflix/Disney+/GitHub CLI. Andrea genera un codice 6 cifre dalla dashboard, il tecnico lo digita su `app.liveslidecenter.com/pair`, riceve JWT permanente. Funziona in qualsiasi rete (cloud, LAN, NAT, proxy).

### ADR-003: Due modalita di rete, entrambe supportate

**Modalita A � Cloud Puro:** ogni PC usa internet della location. Zero hardware.
**Modalita B � Rete Locale Gestita:** router Andrea + mini-PC Agent in regia. File via LAN.
In entrambe, il pairing funziona con lo stesso codice 6 cifre. La rete locale e un acceleratore, non un prerequisito.

### ADR-004: Supabase (non Firebase, non Next.js)

**Supabase** perche: modello relazionale per eventi?sale?sessioni?speaker?versioni, TUS nativo, RLS potente, SQL per analytics, pricing prevedibile.
**React + Vite** perche: SPA senza bisogno di SEO/SSR, coerenza con ecosistema Live Software, DX superiore.
**Supabase Storage** per MVP, Cloudflare R2 quando egress > $50/mese (stesso SDK S3, migrazione 1 giorno).

### ADR-005: Due dashboard, un solo codice

`/admin/*` per Andrea (super-admin, vede tutti i tenant ma NON il contenuto dei file per GDPR).
`/dashboard/*` per i clienti (vedono solo i propri dati).
Stessa app React, guard basato su `role='super_admin'`.

### ADR-006: Analisi storage � perche Supabase e non altri

| Alternativa          | Verdetto          | Motivo                                                                  |
| -------------------- | ----------------- | ----------------------------------------------------------------------- |
| pCloud               | Scartato          | Consumer, zero isolamento tenant, sicurezza da costruire da zero        |
| Google Drive         | Scartato          | OAuth Google obbligatorio per speaker, UX distrutta                     |
| AWS S3               | Sovradimensionato | Egress $0.09/GB, IAM complesso, costi imprevedibili                     |
| Cloudflare R2        | Rimandato         | Zero egress ma servizio separato da Supabase � quando egress > $50/mese |
| **Supabase Storage** | **Vincitore**     | TUS nativo, Auth integrata, RLS-like su bucket, un solo servizio        |

### ADR-007: Dual-mode per evento � Cloud o Intranet LAN, selezionabili

Ogni evento ha una colonna `network_mode ENUM('cloud', 'intranet', 'hybrid')`:

- **cloud** (default): Room Player PWA + File System Access API. Ogni PC usa internet. Download diretto da Supabase Storage. Zero hardware aggiuntivo.
- **intranet**: Local Agent (mini-PC regia) + Room Agent (ogni PC sala). File via LAN HTTP (:8080). Internet opzionale per sincronizzazione iniziale. Router e access point di Andrea.
- **hybrid**: Room Agent usa il Local Agent se raggiungibile (LAN), fallback su cloud se assente.

Le due modalita coesistono nello stesso codebase. La scelta avviene al momento della creazione/modifica dell'evento nel form di dettaglio. **Stato attuale (Fase 9):** la colonna `network_mode` e salvata e mostrata nel form evento. Il Room Player PWA legge `network_mode` e l'ultimo `local_agents` online via Edge Function `room-player-bootstrap` (validazione `device_token` server-side), applica routing download: **cloud** = solo signed URL Supabase; **intranet** = HTTP verso Local Agent `GET /api/v1/files/{event_id}/{filename}` (nessun agent registrato → errore esplicito); **hybrid** = tentativo LAN poi fallback cloud. Il Room Agent Tauri resta il percorso desktop intranet dedicato. Cache PWA: Workbox NetworkFirst su `*.supabase.co` e su path signed Storage; manifest file in `localStorage` come ripiego offline.

**Bypass Windows 11 (intranet):**

- Installer Room Agent NSIS gira come Admin ? imposta regole firewall
- Room Agent gira come utente normale dopo l'installazione (no UAC ripetuto)
- Autostart via registro HKCU (no admin)
- Profilo rete su "Privato" via `Set-NetConnectionProfile` (una tantum)
- File scaricati dal Room Agent non hanno Mark-of-the-Web ? no blocco SmartScreen

### ADR-012: Sistema licenze client Tauri (Sprint 4) — code duplication intenzionale per agent

Il modulo `src/license/` (7 file Rust, ~600 LOC totali) esiste **identico due volte**: una in `apps/agent/src-tauri/src/license/` e una in `apps/room-agent/src-tauri/src/license/`. **NON e' un crate Cargo condiviso** per tre motivi:

1. **Chiavi AES-256-GCM diverse per agent** (in `mod.rs`): impedisce a chi copia `license.enc` da un Local Agent attivato di farlo funzionare su un Room Agent (e viceversa). Sono identificatori commerciali separati: `slide-center-agent` vs `slide-center-room-agent`.
2. **`PRODUCT_ID` e `APP_DATA_DIR` differenti**: licenze fisicamente isolate sul filesystem (`%APPDATA%\com.livesoftware.slidecenter.agent\` vs `%APPDATA%\com.livesoftware.slidecenter.roomagent\`).
3. **Evitare ristrutturazione invasiva del Cargo workspace**: Tauri CLI tratta ogni `src-tauri/` come crate isolato dentro pnpm monorepo; un crate condiviso richiederebbe modifiche profonde al workspace Cargo che impatterebbero il tooling esistente di Tauri.

I file gemelli portano in cima un commento esplicito `// GEMELLO — sync with apps/<altro>/src-tauri/src/license/<file>` per garantire allineamento futuro (pattern identico a chain Live PLAN ↔ Live CREW e Preventivi DHS ↔ Gestionale FREELANCE).

**Compile-time gating:** la feature Cargo `license` e' opzionale. Build di sviluppo `cargo tauri build` esclude il modulo licenze (UI nasconde card e overlay automaticamente); build di vendita `cargo tauri build --features license` lo include con tutte le dipendenze (`aes-gcm`, `wmi`, `sha2`, `reqwest`, `dirs`, `chrono`, `serde`).

**API client allineata a Live WORKS APP:** richieste/risposte in **camelCase** secondo `Live WORKS APP/functions/src/types/index.ts` (es. `verifyBeforeDate`, `nextVerifyDate`, `expiresAt`, `pendingApproval`, `customerName`). Token opaco HMAC-SHA256 server-side memorizzato cifrato in `license.enc`. **Pattern di riferimento implementativo**: `Live 3d Ledwall Render/src-tauri/src/license/`.

**Hook NSIS pre-uninstall**: l'eseguibile riconosce il flag CLI `--deactivate` come early-return prima di costruire la finestra Tauri. L'`installer-hooks.nsi` chiama `local-agent.exe --deactivate` (e l'equivalente Room Agent) prima di rimuovere i file dell'app, liberando lo slot hardware su Live WORKS APP automaticamente alla disinstallazione.

---

## 4. Architettura e Scenari Network

```
                    [MODALITA A � CLOUD PURO]

  Sala 1 PC          Sala 2 PC          Sala N PC
  (Chrome PWA)      (Chrome PWA)       (Chrome PWA)
       |                 |                  |
       +--------- HTTPS / WSS --------------+
                         |
              +----------v-----------+
              |  Supabase + Vercel   |     <-- Andrea (dashboard)
              |  (Francoforte EU)    |         da qualsiasi luogo
              +----------------------+


                    [MODALITA B � RETE LOCALE + CLOUD]

  Sala 1 PC          Sala 2 PC          Sala N PC
  (Room Agent        (Room Agent        (Room Agent
   Tauri v2)          Tauri v2)          Tauri v2)
       |                 |                  |
       +-------+---------+----------+-------+
               | WiFi/LAN HTTP :8080|
               v     (router)       v
         +-----+--------------------+----+
         |       Local Agent (Tauri)     |
         |       mini-PC regia           |
         +---------------+---------------+
                         |
                    HTTPS (se disponibile)
                         |
              +----------v-----------+
              |  Supabase + Vercel   |
              +----------------------+


                    [MODALITA C � OFFLINE PURO]

  Sale PC (cache locale) --- LAN --- Local Agent (cache)
                                     internet assente
```

| Scenario                                   | Modalita        | Cosa porta Andrea                    | Costo             |
| ------------------------------------------ | --------------- | ------------------------------------ | ----------------- |
| Evento piccolo (1-3 sale, WiFi buono)      | A � Cloud       | Niente                               | �0                |
| Evento medio (4-10 sale, WiFi incerto)     | B � LAN + Cloud | Router + mini-PC                     | ~�500 una tantum  |
| Evento grande (10+ sale, centro congressi) | B � LAN + Cloud | Router + AP + mini-PC                | ~�1000 una tantum |
| Area senza internet                        | C � Offline     | Router + mini-PC + file pre-caricati | Come sopra        |

---

## 5. Stack Tecnologico

### Web (apps/web � gia nel repo)

| Layer        | Tecnologia                | Versione |
| ------------ | ------------------------- | -------- |
| Framework UI | React                     | 19       |
| Build tool   | Vite                      | 8        |
| Linguaggio   | TypeScript                | strict   |
| Styling      | Tailwind CSS              | 4        |
| Componenti   | shadcn/ui + Radix         | latest   |
| Routing      | React Router              | 7        |
| State        | Zustand                   | latest   |
| Tabelle      | TanStack Table            | latest   |
| Form         | Zod + React Hook Form     | latest   |
| i18n         | i18next + react-i18next   | latest   |
| Upload       | tus-js-client + use-tus   | latest   |
| PWA          | vite-plugin-pwa (Workbox) | Fase 6   |

### Backend / Infrastruttura

| Layer          | Tecnologia          | Note                                         |
| -------------- | ------------------- | -------------------------------------------- |
| Database       | Supabase PostgreSQL | RLS + trigger                                |
| Auth           | Supabase Auth       | JWT custom claims con tenant_id              |
| Storage        | Supabase Storage    | TUS + S3 compatible, fino a 500GB/file       |
| Realtime       | Supabase Realtime   | room_state, versions, agents, paired_devices |
| Edge Functions | Supabase + Deno     | Pairing, upload validation, cleanup          |
| Deploy web     | Vercel              | Auto-deploy su push main                     |

### Desktop (Local Agent � `apps/agent/` � implementato in Fase 7)

| Layer             | Tecnologia                                                                      | Note                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework         | Tauri v2                                                                        | Rust backend + webview HTML                                                                                                                                                                                                                                                                                 |
| HTTP server LAN   | Axum                                                                            | Bind 0.0.0.0:8080                                                                                                                                                                                                                                                                                           |
| Database locale   | SQLite (rusqlite WAL)                                                           | Cache file + room agents                                                                                                                                                                                                                                                                                    |
| Discovery         | Agent registra IP LAN al cloud                                                  | PWA lo interroga dal cloud                                                                                                                                                                                                                                                                                  |
| Sync engine       | reqwest + tokio + Supabase API                                                  | Pull versioni ready + signed URL                                                                                                                                                                                                                                                                            |
| UI                | HTML standalone (no React)                                                      | Dashboard stato + sync manuale                                                                                                                                                                                                                                                                              |
| **Licenze**       | `aes-gcm` 0.10 + `wmi` 0.13 + `sha2` + `reqwest` + `dirs` + `chrono` (Sprint 4) | Cargo feature `license` opzionale; AES-256-GCM su `license.enc` con chiave per-prodotto; fingerprint WMI SHA-256 (motherboard + CPU + disco); API `https://live-works-app.web.app/api/{activate,verify,deactivate}`; `PRODUCT_ID="slide-center-agent"`, `APP_DATA_DIR="com.livesoftware.slidecenter.agent"` |
| **Distribuzione** | NSIS installer + portable ZIP via `clean-and-build.bat` (Sprint 3)              | `bundle.targets:["nsis"]`; hooks Win11 firewall+Defender+Private+WebView2 silent; `--deactivate` CLI flag per pre-uninstall                                                                                                                                                                                 |

### Desktop (Room Agent � `apps/room-agent/` � implementato in Fase 7)

| Layer             | Tecnologia                                                                      | Note                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework         | Tauri v2 lite                                                                   | Rust backend + webview HTML minimale                                                                                                                                                                                                                                       |
| Polling LAN       | reqwest (ogni 5s)                                                               | Controlla nuovi file dal Local Agent                                                                                                                                                                                                                                       |
| Download          | tokio async + streaming                                                         | Salva in `C:\Users\�\AppData\Local\SlideCenter\{roomId}\`                                                                                                                                                                                                                  |
| Autostart         | Registro HKCU (no admin)                                                        | `CurrentVersion\Run`                                                                                                                                                                                                                                                       |
| Tray icon         | Tauri tray                                                                      | Verde = sync, giallo = download, rosso = offline                                                                                                                                                                                                                           |
| Windows bypass    | HKCU + profilo rete Privato                                                     | No UAC ripetuto; no MOTW sui file                                                                                                                                                                                                                                          |
| **Licenze**       | `aes-gcm` 0.10 + `wmi` 0.13 + `sha2` + `reqwest` + `dirs` + `chrono` (Sprint 4) | **Modulo gemello al Local Agent** ma con `PRODUCT_ID="slide-center-room-agent"`, `APP_DATA_DIR="com.livesoftware.slidecenter.roomagent"`, **chiave AES-256-GCM diversa** (impedisce copy/paste `license.enc` Local↔Room), user-agent HTTP `LiveSlideCenterRoomAgent/<ver>` |
| **Distribuzione** | NSIS installer + portable ZIP via `clean-and-build.bat` (Sprint 3)              | gemello al Local Agent; `--deactivate` CLI flag per pre-uninstall                                                                                                                                                                                                          |

---

## 6. Isolamento Multi-Tenant

**Non esiste compromesso.** La separazione tra clienti e l'invariante sacra del prodotto.

### Database (Postgres)

Ogni tabella con dati business ha `tenant_id UUID NOT NULL REFERENCES tenants(id)`. RLS attiva ovunque con policy `tenant_id = public.app_tenant_id()`.

```sql
CREATE OR REPLACE FUNCTION public.app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(trim(both '"' from (auth.jwt() -> 'app_metadata' ->> 'tenant_id')), '')::uuid,
    NULLIF(trim(both '"' from (auth.jwt() -> 'user_metadata' ->> 'tenant_id')), '')::uuid
  );
$$;

CREATE POLICY tenant_isolation ON events
  FOR ALL USING (tenant_id = public.app_tenant_id());
```

### Storage

Path obbligatorio: `tenants/{tenant_id}/events/{event_id}/presentations/{id}/v{n}/{file}`. Edge Function verifica tenant_id dal JWT prima di firmare URL.

### Auth

Trigger SQL al signup: crea `tenants` ? crea `users` con `role='admin'` ? aggiorna `auth.users.raw_app_meta_data` con `tenant_id` e `role`. Il client **non** deve navigare verso route tenant-scoped finche il JWT non contiene `app_metadata.tenant_id`: dopo `signUp`, eseguire `refreshSession()` (gestire errore di rete/race), poi `getUser()` e verificare il claim; in caso di ritardo trigger, **retry** breve (es. `waitForTenantIdAfterSignup` in `apps/web/src/features/auth/lib/wait-for-tenant-jwt.ts`). Se refresh fallisce o dopo i tentativi `tenant_id` manca ancora, mostrare errore e non reindirizzare alla dashboard.

**File migration:** `supabase/migrations/20250415130000_handle_new_user_tenant.sql` (`handle_new_user` + trigger `on_auth_user_created` su `auth.users`).

**Conferma email (progetto Supabase):** se `signUp` restituisce utente ma **nessuna** `session` (flusso conferma obbligatoria), il client **non** chiama il loop JWT: mostra istruzioni �controlla la posta� e link al login (`SignupView`, chiavi `auth.signupCheckEmail*`).

**Login tenant:** dopo `signInWithPassword`, `refreshSession()` + `getUser()`; consentire l�accesso alla dashboard tenant solo se `app_metadata.tenant_id` � valorizzato **oppure** `app_metadata.role === 'super_admin'` (policy `is_super_admin()` su `tenants` ecc.). In caso contrario, messaggio i18n e `signOut` (`LoginView`).

**EN:** After `signUp`, the SPA must obtain a JWT that includes `tenant_id` in `app_metadata` before running tenant-scoped queries: call `refreshSession()` (handle failures), then `getUser()` to validate claims, with short retries if the DB trigger lags. Do not navigate to the tenant app until `tenant_id` is present; surface a clear error otherwise (`SignupView` + i18n keys `auth.errorSessionRefresh` / `auth.errorTenantProvisioning`). If **email confirmation** is enabled and `signUp` returns **no session**, show the inbox + sign-in guidance instead of the JWT wait loop (`auth.signupCheckEmail*`). After **sign-in**, refresh + `getUser()` and allow navigation only when `tenant_id` is present **or** the user is `super_admin` (`LoginView`).

### RBAC

| Ruolo         | Tipo                                   | Accesso                            |
| ------------- | -------------------------------------- | ---------------------------------- |
| `super_admin` | `user_role` enum                       | Tutto cross-tenant (solo Andrea)   |
| `admin`       | `user_role` enum                       | Tutto nel proprio tenant           |
| `coordinator` | `user_role` enum                       | CRUD sessioni/speaker, vista regia |
| `tech`        | `user_role` enum                       | Vista sala, download, stato sync   |
| speaker       | Record in tabella `speakers` (NO auth) | Upload via `upload_token` univoco  |

---

## 7. Schema Database Completo

### Migration iniziale: `supabase/migrations/20250411090000_init_slide_center.sql`

**11 tabelle base + RLS + trigger** nella migration iniziale; estensioni successive aggiungono `paired_devices`, `pairing_codes`, `pair_claim_rate_events` e `team_invitations` (vedi sotto).

| Tabella                  | Scopo                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`                | Organizzazioni SaaS con piano, quote storage, limiti, flag `suspended` (Fase 8, blocco accesso tenant in app), **`license_key` + `license_synced_at` + `expires_at` + `max_devices_per_room` (v4.8 — sync con Live WORKS APP)** |
| `users`                  | Utenti con ruolo (admin/coordinator/tech/super_admin), FK a auth.users                                                                                                                                                          |
| `events`                 | Congressi/convegni con status workflow (draft?setup?active?closed?archived) + `network_mode` (cloud/intranet/hybrid)                                                                                                            |
| `rooms`                  | Sale fisiche per evento (main/breakout/preview/poster)                                                                                                                                                                          |
| `sessions`               | Slot orari per sala (talk/panel/workshop/break/ceremony)                                                                                                                                                                        |
| `speakers`               | Relatori con `upload_token` per accesso senza login                                                                                                                                                                             |
| `presentations`          | Collegamento speaker?versione corrente                                                                                                                                                                                          |
| `presentation_versions`  | **Append-only.** Ogni upload = nuova riga. Mai UPDATE.                                                                                                                                                                          |
| `room_state`             | Stato realtime sala (sessione, sync status, agent connection)                                                                                                                                                                   |
| `local_agents`           | Agent registrati con IP LAN + heartbeat                                                                                                                                                                                         |
| `activity_log`           | Audit trail completo                                                                                                                                                                                                            |
| `team_invitations`       | **Sprint 1 (Fase 14).** Inviti email per nuovi membri tenant; token 7gg, RLS tenant + super_admin, accept-invite handle_new_user                                                                                                |
| `pair_claim_rate_events` | **Fase 14.** Rate-limit anti-bruteforce su `pair-claim` (5 tentativi/15min per IP hash, accesso solo `service_role`)                                                                                                            |

**Invarianti immutabili:**

- `presentation_versions` e append-only: mai UPDATE
- `version_number` auto-increment via trigger SQL
- Cloud = fonte di verita, conflict resolution = cloud vince
- Ogni file ha `file_hash_sha256` calcolato client-side

**Realtime:** attivo su `room_state`, `presentation_versions`, `local_agents`, `paired_devices`. NON su `activity_log` (polling ogni 10s).

### Migration estensione � file nel repo: `supabase/migrations/20250415120000_pairing_super_admin.sql`

**Realtime:** la stessa migration aggiunge `paired_devices` alla publication `supabase_realtime` e rimuove `activity_log` (allineamento a quanto sopra: audit via polling, non Realtime).

```sql
-- Valore enum super_admin (nel repo: blocco DO $$ ... $$ su pg_enum, piu portabile di IF NOT EXISTS)
ALTER TYPE user_role ADD VALUE 'super_admin';

CREATE TABLE paired_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  device_name TEXT NOT NULL,
  device_type TEXT,
  browser TEXT,
  user_agent TEXT,
  pair_token_hash TEXT NOT NULL UNIQUE,
  last_ip INET,
  last_seen_at TIMESTAMPTZ,
  status connection_status NOT NULL DEFAULT 'offline',
  paired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paired_by_user_id UUID REFERENCES users(id),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_event ON paired_devices(event_id);
CREATE INDEX idx_devices_room ON paired_devices(room_id);
CREATE INDEX idx_devices_status ON paired_devices(tenant_id, status);

CREATE TABLE pairing_codes (
  code CHAR(6) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id),
  generated_by_user_id UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_device_id UUID REFERENCES paired_devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pairing_codes_expires ON pairing_codes(expires_at) WHERE consumed_at IS NULL;

ALTER TABLE paired_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON paired_devices FOR ALL USING (tenant_id = public.app_tenant_id());
CREATE POLICY tenant_isolation ON pairing_codes FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', false);
$$;

CREATE POLICY super_admin_all ON tenants FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON events FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON paired_devices FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON activity_log FOR ALL USING (public.is_super_admin());
```

**Nota implementazione:** sul database e stata aggiunta anche `CREATE POLICY super_admin_all ON pairing_codes` per consentire ispezione cross-tenant dei codici in fase di strumentazione admin (stesso criterio GDPR: metadati, non file).

### Migration quote � file nel repo: `supabase/migrations/20250415120100_quotas_enforcement.sql`

```sql
CREATE OR REPLACE FUNCTION public.check_storage_quota() RETURNS TRIGGER AS $$
DECLARE v_used BIGINT; v_limit BIGINT;
BEGIN
  SELECT storage_used_bytes, storage_limit_bytes INTO v_used, v_limit
  FROM tenants WHERE id = NEW.tenant_id;
  IF (v_used + NEW.file_size_bytes) > v_limit THEN
    RAISE EXCEPTION 'Storage quota exceeded for tenant';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_storage_quota BEFORE INSERT ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION public.check_storage_quota();

CREATE OR REPLACE FUNCTION public.update_storage_used() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tenants SET storage_used_bytes = storage_used_bytes + NEW.file_size_bytes WHERE id = NEW.tenant_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tenants SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.file_size_bytes) WHERE id = OLD.tenant_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER track_storage_used AFTER INSERT OR DELETE ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_storage_used();

ALTER TABLE tenants ALTER COLUMN storage_limit_bytes SET DEFAULT 5368709120;  -- 5 GB (Trial)
ALTER TABLE tenants ALTER COLUMN max_events_per_month SET DEFAULT 2;
ALTER TABLE tenants ALTER COLUMN max_rooms_per_event SET DEFAULT 3;
```

**Trigger quota:** la funzione `check_storage_quota()` nel repository considera `storage_limit_bytes < 0` come quota illimitata (Enterprise), cosi non si bloccano insert se il limite e segnato come illimitato nel dato tenant.

### Migration auth signup � file nel repo: `supabase/migrations/20250415130000_handle_new_user_tenant.sql`

Funzione `public.handle_new_user()` (SECURITY DEFINER) + trigger `on_auth_user_created` su `auth.users`: provisioning tenant + riga `public.users` + `raw_app_meta_data` con `tenant_id` e ruolo `admin`.

### Migration upload admin + spostamento presentation � file nel repo: `supabase/migrations/20260417110000_admin_uploads_and_move_presentation.sql`

Sblocca l'upload diretto da admin/coordinator tenant (drag-and-drop in `EventDetailView`) e lo spostamento di una presentation tra speaker dello stesso evento.

- **RLS storage:** `tenant_insert_uploading_version` su `storage.objects` consente INSERT a `authenticated` quando esiste `presentation_versions` con `status='uploading'` e `tenant_id = app_tenant_id()`. Coesiste con la policy `anon` upload-token-bound del portale speaker.
- **RPC admin (SECURITY DEFINER):**
  - `init_upload_version_admin(p_speaker_id, p_filename, p_size, p_mime)` — valida tenant + speaker + storage quota + `tenant_max_file_size`, crea `presentations` se manca (1 per speaker), apre `presentation_versions` in `uploading`.
  - `finalize_upload_version_admin(p_version_id, p_sha256)` — esige status `uploading`, controlla esistenza oggetto, marca `ready` + aggiorna `presentations.current_version_id` + `status='ready'`.
  - `abort_upload_version_admin(p_version_id)` — chiude i version `uploading` orfani senza decrementare quota.
- **RPC `rpc_move_presentation(p_presentation_id, p_target_speaker_id)`** — sposta una presentation tra speaker dello stesso `event_id`/`tenant_id`. Verifica che lo speaker target NON abbia gia' una presentation (vincolo `presentations_speaker_unique`). Aggiorna anche `session_id` per riflettere la nuova sessione dello speaker. Logga in `activity_log`.
- **Permessi:** `GRANT EXECUTE` per `authenticated` su tutte le 4 RPC; rate-limit naturale via Supabase API.

### Migration sync licenze Live WORKS APP � file nel repo: `supabase/migrations/20260417120000_tenant_license_sync.sql`

Aggancia il tenant al sistema licenze centralizzato Live WORKS APP (Firestore + Cloud Functions) in modo che la dashboard admin Live WORKS sia l'unico posto da cui modificare quote, scadenza e piano.

- **Nuove colonne `tenants`:** `license_key TEXT` (UNIQUE), `license_synced_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ`, `max_devices_per_room INT NOT NULL DEFAULT 10`.
- **Trigger `tenant_apply_expiry`:** se `expires_at < now()`, marca automaticamente `suspended=true` (combinato con la sospensione manuale super_admin gia' esistente).
- **RPC `licensing_apply_quota(p_license_key, p_tenant_id, p_plan, p_storage_limit_bytes, p_max_rooms_per_event, p_max_devices_per_room, p_expires_at, p_status)`** — `SECURITY DEFINER`, grant solo a `service_role`. Risolve il tenant via `license_key` (priorita) o `tenant_id`, applica quote + scadenza + status, mappa `status ∈ {suspended, expired, revoked}` su `suspended=true`. Idempotente.
- **Edge Function `supabase/functions/licensing-sync/`** (`verify_jwt=false`): riceve POST server-to-server da Live WORKS APP, autentica via HMAC SHA-256 sul body raw + anti-replay timestamp (header `X-Live-Signature`, `X-Live-Timestamp`, `X-Live-Nonce`); chiama l'RPC con `service_role`. Secrets richiesti: `SLIDECENTER_LICENSING_HMAC_SECRET` (>=32 char).

### Tipi TypeScript (`Database`)

`packages/shared/src/types/database.ts` � allineato alle migration finche `supabase gen types typescript --local` non e eseguibile (richiede Docker). Dopo ogni migration nuova: aggiornare il file o rigenerare e fare **diff**. Le directory `supabase/migrations/` sono in `.prettierignore` per evitare che Prettier alteri il SQL.

**EN:** `database.ts` mirrors the migrations for typed `createClient<Database>()`; regenerate from the CLI when local Supabase is available, then reconcile diffs. SQL under `supabase/migrations/` is listed in `.prettierignore` so formatting tools cannot break statements.

---

## 8. Pairing Dispositivi

### Flusso completo (RFC 8628 adattato)

```
ANDREA (dashboard)           PC SALA                 SUPABASE
       |                        |                        |
       | "+ Aggiungi PC"        |                        |
       |--------- Edge Function pair-init -------------->|
       |<--- codice "847291" + QR ----------------------|
       |                        |                        |
       | mostra codice + QR     | Tecnico apre           |
       |                        | app.liveslidecenter.com|
       |                        | /pair ? digita 847291  |
       |                        |--- pair-claim -------->|
       |                        |<-- JWT permanente -----|
       |                        |                        |
       |--- pair-poll --------->| ok, consumed           |
       |<-- "PC1 connesso!" ---|                        |
       |                        |                        |
       | "Assegna a sala? ?"    | redirect /sala/:token  |
       | sceglie Auditorium A   | mostra UI sala         |
```

### UX lato Andrea (dashboard)

1. Bottone `+ Aggiungi PC` in pagina evento
2. Modal con codice grande `8 4 7 2 9 1` + QR code
3. Testo: _"Sul PC sala vai su app.liveslidecenter.com/pair e digita questo codice. Valido 10 minuti."_
4. Spinner _"In attesa..."_
5. PC si connette ? checkmark verde ? dropdown _"Assegna a una sala"_
6. Conferma ? entry in lista: `PC1 � Auditorium A � online � Windows 11 Edge`

### UX lato tecnico (PC sala)

**Primo avvio (30 secondi):**

1. Apre Chrome/Edge ? `app.liveslidecenter.com/pair`
2. Campo grande per 6 cifre + tastierino numerico touch-friendly
3. Digita codice ? click "Connetti"
4. Andrea assegna sala ? redirect a `/sala/{room_token}`
5. Browser propone "Installa come app" ? icona desktop

**Riavvii successivi (0 secondi):** doppio click icona, parte fullscreen. Zero login.

### Sicurezza pairing

- Codice 6 cifre numerico, scadenza 10 minuti, single-use
- Rate limit: 5 tentativi per IP per finestra di 15 minuti (tabella `pair_claim_rate_events`, IP hash SHA-256, cleanup automatico 2x finestra)
- HTTPS only, nessun client_secret distribuito
- JWT permanente con hash salvato in `paired_devices.pair_token_hash`
- Andrea puo revocare JWT dalla dashboard (forza ri-pairing)

### Discovery Agent locale (meccanismo corretto)

**I browser NON risolvono hostname mDNS `.local`.** Il meccanismo corretto:

1. Agent si avvia ? registra su Supabase: `local_agents.lan_ip = "192.168.1.100"`
2. PWA su PC sala chiede al cloud: `GET /local_agents?event_id=eq.{id}&status=eq.online`
3. Se trova Agent ? tenta `fetch("http://192.168.1.100:8080/api/v1/health")` con timeout 2s
4. Se risponde ? banner "Agent locale trovato, download piu veloci"
5. Se non risponde ? fallback silenzioso al cloud

### Edge Functions per pairing

| Funzione                | Trigger                          | Azione                                                                   |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `pair-init`             | Andrea clicca "+ Aggiungi PC"    | Genera codice 6 cifre, salva in `pairing_codes`, ritorna codice + QR URL |
| `pair-claim`            | Tecnico digita codice su `/pair` | Valida codice, crea record `paired_devices`, genera JWT, marca consumed  |
| `pair-poll`             | Dashboard polling ogni 2s        | Ritorna stato: pending/consumed con info device                          |
| `cleanup-expired-codes` | pg_cron ogni ora                 | Elimina codici scaduti da > 1 giorno                                     |

### Reset / cambio sala

**Tecnico:** menu Room Player ? "Cambia sala" / "Disconnetti PC" / "Forza re-sync"
**Andrea:** lista PC ? riassegna sala / revoca JWT / rinomina PC

---

## 9. Flussi di Sistema

### Upload Relatore

```
Relatore ? /u/{token} ? TUS su Supabase Storage ? Edge Function:
  ? crea presentation_version (append-only)
  ? verifica SHA-256
  ? aggiorna presentations.current_version_id
  ? emette Realtime event
  ? logga in activity_log
```

### Sync Cloud ? PWA Sala (Modalita A)

```
Supabase Realtime ? PWA subscription
  ? nuova versione ? download presigned URL ? cache locale ? overlay verde
```

### Sync Cloud ? Agent ? PWA Sala (Modalita B)

```
Supabase Realtime ? Agent download + cache locale + SQLite
PWA ? HTTP polling Agent LAN ogni 5s ? download se versione piu recente
```

### Scenari offline

| Scenario                | Comportamento            | Indicatore UI                  |
| ----------------------- | ------------------------ | ------------------------------ |
| Cloud + LAN OK          | Sync completo            | Verde: "v4 di 4 � Sync 14:32"  |
| Cloud OK, Agent offline | PWA cloud diretto        | Verde: "CLOUD DIRECT"          |
| Cloud offline, Agent OK | Agent serve cache        | Giallo: "LAN ONLY"             |
| Tutto offline           | PWA cache locale         | Rosso: "OFFLINE � v3 in cache" |
| Agent torna online      | Pull automatico mancanti | Giallo ? Verde                 |

---

## 10. Dashboard Super-Admin

Rotta `/admin/*`. Guard: se utente non ha `role='super_admin'`, redirect a `/dashboard`.

| Rotta                  | Contenuto                                                           |
| ---------------------- | ------------------------------------------------------------------- |
| `/admin`               | Tenant attivi, eventi in corso, storage totale, fatturato MTD       |
| `/admin/tenants`       | Lista clienti: nome, piano, storage (barra %), MRR, stato           |
| `/admin/tenants/:id`   | Dettaglio: team, eventi, fatture, log, "Sospendi", "Modifica quota" |
| `/admin/quotas`        | Override quote per cliente specifico                                |
| `/admin/system-health` | Stato Supabase, Vercel, errori                                      |
| `/admin/audit`         | Log cross-tenant (sicurezza, login, modifiche piano)                |

**Implementazione corrente (aprile 2026, Fase 8):** rotte live `/admin` (card riepilogo: numero tenant, eventi in stato setup/active, somma storage usato; placeholder fatturato MTD per Fase 11), `/admin/tenants` (tabella con link al dettaglio, badge sospeso/attivo), `/admin/tenants/:id` (piano e quote modificabili, sospensione tenant con colonna `tenants.suspended`, team `public.users`, eventi metadati soli, ultime 50 righe `activity_log` del tenant), `/admin/audit` (ultime 200 righe `activity_log` cross-tenant con link al tenant). Blocco accesso tenant: `LoginView` + `RequireAuth` verificano `suspended` via lettura `tenants` (gli utenti tenant non possono usare la dashboard fino a riattivazione; super_admin escluso). Migration `20250416120100_tenant_suspended.sql`.

**EN:** Phase 8 ships the super-admin console described above: aggregate dashboard cards, tenant list/detail with quota edits and suspend/reactivate, per-tenant and cross-tenant audit views, and login/session guards that read `tenants.suspended` (no presentation file content).

**Andrea NON puo (GDPR):** vedere contenuto file clienti, modificare dati eventi, inviare email ai relatori.

**Bootstrap super-admin (una volta sola):**

```sql
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}'::jsonb
WHERE email = 'live.software11@gmail.com';
```

---

## 11. Dashboard Tenant

```
+------------------------------------------------------+
� [Logo]  Studio Visio  ?              [IT/EN]  [User] �
+------------------------------------------------------�
� Dashboard   �  3 eventi � 12 file � 2.4 GB usati    �
� Eventi      �  [������������] 24% di 100 GB          �
� Team        �                                        �
� Storage     �  PROSSIMI EVENTI                        �
� Billing     �  > Congresso Cardiologia (in 12gg)     �
� Settings    �  > Workshop AI Medicale (in 28gg)      �
�             �  [+ Nuovo Evento]  [+ Invita Membro]  �
+------------------------------------------------------+
```

### Implementazione corrente (aprile 2026)

L'interfaccia tenant espone `/events` (lista + nuovo evento) e `/events/:eventId` con **Sale** (creazione, **modifica inline** nome + `room_type`, eliminazione a due passaggi), **Sessioni** (creazione + **modifica inline** titolo, sala, `session_type`, orari `datetime-local` ? UTC; `updateSessionById` con `eq('id', �)` sotto RLS; **riordino drag-and-drop** sull�elenco con persistenza `display_order` via `reorderSessionsDisplayOrder`; **commutatore vista** Elenco / **Per sala** � seconda modalit�: sessioni raggruppate per sala, ordinate per `scheduled_start`, **sola lettura** per orientamento operativo) e **Relatori** (creazione + **modifica inline** sessione, nome, email opzionale; `updateSpeakerById` con `eq('id', �)`). **Quote piano (read-only da riga `tenants` via RLS):** su `/events` pannello con storage usato/limite, conteggio **eventi con `start_date` nel mese di calendario locale corrente** rispetto a `max_events_per_month`, blocco soft del submit se il mese della `start_date` del form � gi� saturo; su `/events/:eventId` pannello con storage + **sale nell'evento** vs `max_rooms_per_event`, blocco creazione sala oltre limite. I valori effettivi restano quelli del DB (override super-admin possibili); nessun enforcement server-side aggiuntivo su INSERT `events`/`rooms` in questa iterazione. Alla creazione (o rigenerazione manuale su record legacy) il sistema assegna `upload_token` + `upload_token_expires_at` (90 giorni); in elenco compaiono **link assoluto** `/u/:token`, **copia negli appunti** e **QR** (`react-qr-code`). La pagina `/u/:token` e **live (Fase 3 completata)**: validazione token via RPC, upload TUS resumable a Supabase Storage (bucket privato `presentations`), hash SHA-256 client-side, finalize atomico con append-only `presentation_versions` e aggiornamento `presentations.current_version_id`+`status='uploaded'`. **Storico versioni (Fase 4 completata)** integrato nel dettaglio evento: ogni relatore espone un pannello con tutte le versioni (numero, timestamp, dimensione, hash troncato, stato), **download** via signed URL Storage (5 min, RLS tenant-only), **rollback/imposta come attuale** (RPC `rpc_set_current_version` � atomico: imposta `current_version_id`, marca `superseded` le altre `ready`, riattiva la selezionata se era `superseded`, logga `activity_log`), **workflow review** (RPC `rpc_update_presentation_status` con note revisore e timestamp), **Realtime** subscription su `presentations` + `presentation_versions` (il pannello si aggiorna automaticamente quando uno speaker completa un upload). Messaggi su CASCADE PostgreSQL (sala ? sessioni e relatori; sessione ? relatori). **Import CSV relatori (MVP):** in `/events/:eventId` sezione relatori con modello scaricabile (UTF-8 BOM), colonne `session_title`, `full_name`, `email` (opzionale); titolo sessione risolto su sessioni dell�evento con confronto case-insensitive e univocit�; massimo **200** righe dati; import **tutto-o-niente** su validazione righe; inserimenti via `createSpeakerForSession` (stesso flusso del form, token upload 90gg). **Fase 2 ancora da fare:** calendario/timeline **interattivo** (griglia oraria per sala, oltre all�elenco DnD e oltre alla vista Per sala read-only); eventuali altri import (sale/sessioni) non iniziati. **Fase 3 (completata):** portale `/u/:token` con upload TUS resumable, SHA-256 client-side e finalize via RPC.

**EN � Tenant UI:** Event detail supports **inline room edit** (name + room type) plus create/delete (two-step). **Sessions** and **speakers** support **inline edit** (same fields as create; updates scoped by row `id` under RLS). **Sessions list** supports **drag-and-drop reorder** persisted to `display_order` via `reorderSessionsDisplayOrder`, plus a **List / By room** toggle: **By room** is a **read-only** schedule grouped by room and sorted by `scheduled_start` (edits remain on the list view). **Plan quotas (read-only `tenants` row via RLS):** `/events` shows storage usage/limit plus **events whose `start_date` falls in the browser�s current calendar month** vs `max_events_per_month`, with a client-side guard on create when that month is already at capacity for the form�s start month; `/events/:eventId` shows storage plus **rooms in this event** vs `max_rooms_per_event`, blocking new rooms past the cap. DB values remain the source of truth; no extra server-side INSERT enforcement for `events`/`rooms` in this iteration. Speakers get the **90-day upload portal URL**, **copy**, and **QR** as above; `/u/:token` is **live (Phase 3 complete)**: token validation via SECURITY DEFINER RPC, resumable TUS upload to a private `presentations` bucket, client-side streaming SHA-256, atomic finalize appending a `presentation_versions` row and updating `presentations.current_version_id` / `status='uploaded'`. **Speaker CSV import (MVP):** on `/events/:eventId`, downloadable UTF-8 BOM template with `session_title`, `full_name`, `email` (optional); session titles are matched case-insensitively and must be unique within the event; **200** data rows max; validation is **all-or-nothing** before inserts; rows are created through `createSpeakerForSession` (same upload-token flow as manual create).

**EN:** Tenant UI exposes `/events` (list + create) and `/events/:eventId` with **Rooms** (inline edit), **Sessions** (inline edit), and **Speakers** (inline edit) as above. **Deletion:** two-step confirm; copy explains PostgreSQL `ON DELETE CASCADE` (room ? sessions and speakers; session ? speakers). Phase 2+ still pending: **interactive** calendar/timeline (time-grid per room, beyond DnD list and beyond read-only By room); broader CSV imports (rooms/sessions) are not started yet. Upload portal (Phase 3) is complete: `/u/:token` runs TUS resumable to a private `presentations` bucket with client-side SHA-256 and atomic RPC finalize. **Version history (Phase 4) is complete**: in `/events/:eventId` each speaker exposes a lazy-mounted, Realtime-backed panel listing every `presentation_version` (number, timestamp, size, short SHA-256, status) with **signed-URL download** (5 min, bucket stays private), **atomic rollback / set-as-current** via `rpc_set_current_version` (promotes the picked version, demotes other `ready` rows to `superseded`, restores from `superseded` when needed, logs `activity_log`), and a **review workflow** (`rpc_update_presentation_status` with reviewer note + timestamp + user id). Append-only invariants are enforced by the `guard_versions_immutable` trigger, which blocks UPDATEs of identity/path columns and locks the hash once set.

### Dettaglio evento � tab

| Tab             | Contenuto                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sale**        | CRUD sale, tipo, capacita, ordine                                                                                                                             |
| **Sessioni**    | Elenco con drag & drop su `display_order`; vista �Per sala� read-only (raggruppamento + `scheduled_start`); griglia calendario/timeline interattiva (da fare) |
| **Relatori**    | Lista speaker, QR upload, stato file                                                                                                                          |
| **PC Sala**     | Paired devices, stato live, "+ Aggiungi PC", drag & drop assegnazione                                                                                         |
| **Vista Regia** | Griglia realtime sale, fullscreen, colori stato inequivocabili                                                                                                |
| **Export**      | ZIP slide correnti + CSV log `activity_log` + PDF report metadati (`EventExportPanel`, lazy) — **Fase 10 completata**                                         |

**Fase 10 (dettaglio tecnico):** ZIP tramite signed URL Supabase (5 min) e `jszip`; CSV `activity_log` filtrato per `event_id` (max 5000 righe, UTF-8 BOM); PDF metadati con `jspdf`; `createVersionDownloadUrlWithClient` in `apps/web/src/features/presentations/repository.ts`; UI `apps/web/src/features/events/components/EventExportPanel.tsx` e `apps/web/src/features/events/lib/event-export.ts`; lazy import da `EventDetailView`.

**Fase 11 (Billing Lemon Squeezy / Live WORKS APP, aprile 2026):** rotta `/billing` riservata a JWT `app_metadata.role=admin` (`RequireTenantAdmin` + `Navigate` per altri ruoli e `super_admin` verso `/admin`). `BillingView`: `TenantQuotaPanel` (variante elenco eventi), tabella comparativa piani da `packages/shared/src/constants/plans.ts`, link esterni checkout/portale Lemon Squeezy letti da variabili Vite in `.env` root (`VITE_LEMONSQUEEZY_CHECKOUT_STARTER_URL`, `VITE_LEMONSQUEEZY_CHECKOUT_PRO_URL`, `VITE_LEMONSQUEEZY_CUSTOMER_PORTAL_URL`, `VITE_LIVE_WORKS_APP_URL` — vedi `.env.example`). Webhook Lemon / sync fatturazione in-repo: **non inclusi** in questa iterazione (coerente con guida: store gestito via Live WORKS APP fino al primo cliente pagante). Sidebar tenant: voce **Abbonamento** (`nav.billing`) visibile solo agli admin.

**Fase 12 (i18n completamento, aprile 2026):** `/settings` — `SettingsView` con sezione **Lingua dell'interfaccia** (pulsanti IT/EN, stato attivo, testi `settings.*`); `i18next` + `LanguageDetector` (`packages/shared/src/i18n/index.ts`: `localStorage` + `navigator`). Completata chiave mancante **`common.menu`** (Room Player). `apps/web/src/app/routes.tsx` — `HydrateFallback` legato a `i18n.t('common.loading')` dopo `await initI18n()` in `apps/web/src/lib/i18n.ts`.

### Flusso creazione evento (5 min)

1. "Nuovo Evento" ? form nome, date, location
2. Aggiungi sale (inline editing)
3. Aggiungi sessioni (orari + eventuale riordino elenco drag-and-drop)
4. Aggiungi speaker ? sistema genera `upload_token` + QR
5. "Pubblica" ? stato `setup` ? email automatica ai relatori
6. Tutti i file caricati ? stato `active`

### Rotte applicazione (mappa completa)

| Rotta                   | Componente                                                                        | Accesso                     | Auth                    |
| ----------------------- | --------------------------------------------------------------------------------- | --------------------------- | ----------------------- |
| `/`                     | `DashboardView`                                                                   | Tenant (autenticato)        | JWT tenant              |
| `/events`               | `EventsView` � lista + creazione evento                                           | Tenant                      | JWT tenant              |
| `/events/:eventId`      | `EventDetailView` � sale, sessioni, relatori (lista, creazione, delete conferma)  | Tenant                      | JWT tenant              |
| `/team`                 | `TeamView`                                                                        | Admin tenant                | JWT admin               |
| `/storage`              | `StorageView`                                                                     | Tenant                      | JWT tenant              |
| `/billing`              | `BillingView` (piano/quote, confronto piani, checkout Lemon da env) — **Fase 11** | Admin tenant (`role=admin`) | JWT admin               |
| `/settings`             | `SettingsView` (lingua UI IT/EN, `settings.*`) — **Fase 12**                      | Tenant                      | JWT tenant              |
| `/admin`                | `AdminDashboardView` statistiche aggregate + link                                 | Solo `super_admin`          | JWT `app_metadata.role` |
| `/admin/tenants`        | `AdminTenantsView` elenco tenant                                                  | Solo `super_admin`          | JWT super_admin         |
| `/admin/tenants/:id`    | `AdminTenantDetailView` quote, sospensione, team, eventi, log                     | Solo `super_admin`          | JWT super_admin         |
| `/admin/audit`          | `AdminAuditView` log cross-tenant                                                 | Solo `super_admin`          | JWT super_admin         |
| `/admin/*`              | Estensioni roadmap (quote globali, health, ecc.)                                  | Solo `super_admin`          | JWT super_admin         |
| `/pair`                 | `PairView` � tastierino codice 6 cifre                                            | Pubblico (tecnico)          | Nessuna                 |
| `/sala/:token`          | `RoomPlayerView` � PWA file manager                                               | PC sala paired              | JWT sala (pairing)      |
| `/u/:token`             | `UploadPortalView` � upload relatore                                              | Speaker esterno             | `upload_token`          |
| `/team`                 | `TeamView` — utenti tenant, invita membro, revoca inviti pendenti                 | Admin tenant                | JWT admin               |
| `/accept-invite/:token` | `AcceptInviteView` — accetta invito, crea utente con tenant predefinito           | Pubblico (token email)      | `invite_token`          |
| `/forgot-password`      | `ForgotPasswordView` — `auth.resetPasswordForEmail()`                             | Pubblico                    | Nessuna                 |
| `/reset-password`       | `ResetPasswordView` — form nuova password (link email Supabase)                   | Pubblico (link Supabase)    | Recovery link           |
| `/login`                | `LoginView`                                                                       | Pubblico                    | Nessuna                 |
| `/signup`               | `SignupView`                                                                      | Pubblico                    | Nessuna                 |

---

## 12. Piani Commerciali e Quote

### Piani (valori DEFINITIVI � devono corrispondere a `packages/shared/src/constants/plans.ts`)

| Piano          | �/mese | Eventi/mese | Sale/evento | Storage | File max | Utenti     | Agent      |
| -------------- | ------ | ----------- | ----------- | ------- | -------- | ---------- | ---------- |
| **Trial**      | 0      | 2           | 3           | 5 GB    | 100 MB   | 3          | 1          |
| **Starter**    | 149    | 5           | 10          | 100 GB  | 1 GB     | 10         | 3          |
| **Pro**        | 399    | 20          | 20          | 1 TB    | 2 GB     | 50         | 10         |
| **Enterprise** | da 990 | illimitato  | illimitato  | custom  | 5 GB+    | illimitato | illimitato |

**Nota Trial � Agent/evento:** il valore in produzione per il piano Trial � **1** agente per evento (coerente con `PLAN_LIMITS.trial` e enforcement futuro). Eventuali valori storici di bozza diversi vanno considerati deprecati.

**EN � Trial note:** the Trial plan caps **Local Agents per event at 1**, matching `packages/shared/src/constants/plans.ts` and future quota enforcement.

### TypeScript (`plans.ts`)

```typescript
export interface PlanLimits {
  storageLimitBytes: number;
  maxEventsPerMonth: number;
  maxRoomsPerEvent: number;
  maxAgentsPerEvent: number;
  maxUsersPerTenant: number;
  maxFileSizeBytes: number;
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  trial: {
    storageLimitBytes: 5 * 1024 ** 3,
    maxEventsPerMonth: 2,
    maxRoomsPerEvent: 3,
    maxAgentsPerEvent: 1,
    maxUsersPerTenant: 3,
    maxFileSizeBytes: 100 * 1024 ** 2,
  },
  starter: {
    storageLimitBytes: 100 * 1024 ** 3,
    maxEventsPerMonth: 5,
    maxRoomsPerEvent: 10,
    maxAgentsPerEvent: 3,
    maxUsersPerTenant: 10,
    maxFileSizeBytes: 1 * 1024 ** 3,
  },
  pro: {
    storageLimitBytes: 1024 * 1024 ** 3,
    maxEventsPerMonth: 20,
    maxRoomsPerEvent: 20,
    maxAgentsPerEvent: 10,
    maxUsersPerTenant: 50,
    maxFileSizeBytes: 2 * 1024 ** 3,
  },
  enterprise: {
    storageLimitBytes: -1,
    maxEventsPerMonth: -1,
    maxRoomsPerEvent: -1,
    maxAgentsPerEvent: -1,
    maxUsersPerTenant: -1,
    maxFileSizeBytes: -1,
  },
};
```

### Costi infrastruttura (partenza)

| Servizio      | Piano               | Costo     | Upgrade quando                          |
| ------------- | ------------------- | --------- | --------------------------------------- |
| Supabase      | Free                | 0�        | DB > 500MB o file > 50MB ? Pro $25/mese |
| Vercel        | Hobby               | 0�        | Primo cliente ? Pro $20/mese            |
| Dominio       | liveslidecenter.com | ~12�/anno | �                                       |
| GitHub        | Free                | 0�        | �                                       |
| Lemon Squeezy | Via Live WORKS APP  | 0�        | Automatico a prima vendita              |

**Costo iniziale: ~1�/mese.** Primo upgrade con primo cliente pagante (~45�/mese).

---

## 13. Design System

### Identita visiva

Allineata al sito marketing **www.liveworksapp.com**: navy profondo, blu brand, arancio accento, font DM Sans, superfici con bordi blu-tinti, card `rounded-2xl`. Dark mode only.

### Logo prodotto, favicon e PWA

- **Sorgente unica (versionata in git):** `icons/Logo Live Slide Center.jpg`. Non sostituire il marchio con placeholder testuali nelle schermate principali: usare il componente React dedicato.
- **Generazione asset:** `apps/web/scripts/generate-brand-icons.mjs` (Node + libreria **`sharp`** in `devDependencies` di `@slidecenter/web`). Lo script viene eseguito in **`prebuild`** e **`predev`** (`apps/web/package.json`) prima di Vite, cosi ogni build/deploy (incluso Vercel) rigenera le derivate dalla sorgente.
- **File generati in `apps/web/public/`:** `logo-live-slide-center.jpg` (JPEG ottimizzato, max ~512 px lato, usato in UI), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `pwa-192x192.png`, `pwa-512x512.png` (PNG da crop centrato ad alta qualita).
- **UI web:** `src/components/AppBrandLogo.tsx` — unico punto per `<img>` del marchio in sidebar tenant (`root-layout`), sidebar admin (`admin-root-layout`), login e signup. Il nome accanto al logo e sempre `t('app.displayName')` (chiavi `app.displayName` / `app.logoAlt` in `packages/shared/src/i18n/locales/it.json` e `en.json`).
- **HTML:** `apps/web/index.html` — `link rel="icon"` (16 + 32) e `apple-touch-icon` verso i PNG in `public/`.
- **PWA:** `vite.config.ts` (`vite-plugin-pwa`) — `manifest.icons` sui PNG 192/512; `includeAssets` elenca favicon, apple-touch e JPEG logo; Workbox `globPatterns` include estensione `jpg` per la precache.

**Workflow modifica logo:** sostituire il JPG in `icons/`, poi `pnpm --filter @slidecenter/web run icons:brand` oppure qualsiasi `pnpm run build` / `pnpm dev` dalla root (grazie a prebuild/predev). Verificare visivamente login, header e installazione PWA.

**EN — Brand & PWA assets:** One canonical JPG under `icons/` drives everything. A Sharp script runs on `prebuild`/`predev`, writes optimized web JPEG + favicon/apple-touch/PWA PNGs into `apps/web/public/`. Use `AppBrandLogo` plus `t('app.displayName')` for the wordmark—avoid ad-hoc `/logo...` URLs scattered across features.

### Palette (Tailwind 4 `@theme` tokens in `index.css`)

| Token Tailwind      | Valore hex | Uso                                                                          |
| ------------------- | ---------- | ---------------------------------------------------------------------------- |
| `sc-bg`             | `#07101f`  | Sfondo principale (navy profondo)                                            |
| `sc-surface`        | `#0d1c30`  | Card, sidebar, pannelli                                                      |
| `sc-elevated`       | `#132844`  | Superfici hover, elementi rialzati                                           |
| `sc-primary`        | `#3FA9F5`  | CTA, link, selezione, brand blue                                             |
| `sc-primary-deep`   | `#0B5ED7`  | Hover su primary, gradienti                                                  |
| `sc-accent`         | `#FF7A00`  | Badge admin, avvisi importanti                                               |
| `sc-accent-light`   | `#FF9A40`  | Accento secondario                                                           |
| `sc-navy`           | `#0A2540`  | Superfici brand compatte (non sostituiscono il logo immagine `AppBrandLogo`) |
| `sc-text`           | `#f0f2f5`  | Testo primario (titoli, contenuto)                                           |
| `sc-text-secondary` | `#b8c5d4`  | Testo secondario                                                             |
| `sc-text-muted`     | `#7a8da3`  | Label, metadata, placeholder                                                 |
| `sc-text-dim`       | `#556577`  | Testo terziario, hint                                                        |
| `sc-ring`           | `#3FA9F5`  | Focus ring                                                                   |
| `sc-success`        | `#4ade80`  | Synced, online, ready                                                        |
| `sc-warning`        | `#fbbf24`  | Syncing, LAN only, cap raggiunto                                             |
| `sc-danger`         | `#f87171`  | Offline, failed, errori                                                      |

### Bordi e opacita

- Bordi card/sezioni: `border-sc-primary/12` (blu al 12% — sottile, elegante)
- Bordi input/strong: `border-sc-primary/20`
- Bordi admin: `border-sc-accent/15`
- Divider: `divide-sc-primary/12`

### Tipografia

- **Font**: DM Sans (Google Fonts) — caricato in `index.html`
- **Stack CSS**: `'DM Sans', ui-sans-serif, system-ui, sans-serif`
- **Pesi**: 400 (body), 500 (label), 600 (titoli sezione), 700 (h1/h2)

### Componenti UI

- **Border radius**: `rounded-xl` per card, input, bottoni, sezioni. `rounded-2xl` per card principali (login, signup)
- **Sidebar**: `bg-sc-surface/80 backdrop-blur-xl` con bordo `border-sc-primary/10`
- **Bottoni primari**: `bg-sc-primary text-white shadow-lg shadow-sc-primary/20 hover:bg-sc-primary-deep`
- **Bottoni ghost**: `bg-sc-elevated text-sc-text-secondary hover:bg-sc-primary/8`
- **Input**: `bg-sc-bg border-sc-primary/15 rounded-xl focus:border-sc-primary/40 focus:ring-sc-ring/25`
- **Card**: `bg-sc-surface border-sc-primary/12 rounded-xl`
- **Glow decorativo** (login/signup): `bg-sc-primary/8 blur-3xl` + `bg-sc-accent/5 blur-3xl`

### App Tauri (agent + room-agent)

- Stesse variabili CSS (`--sc-bg`, `--sc-surface`, ecc.) in `<style>` inline
- Font DM Sans via Google Fonts `<link>`
- Card `.card { border-radius: 16px; }`
- Bottoni `.btn-primary { border-radius: 12px; box-shadow: ... }`
- Badge stato con classi `.badge-synced`, `.badge-offline`, ecc.
- **Allineamento Fase 13:** Local Agent include anche `--sc-warning`, `--sc-accent-light`, `--sc-ring`; hover `.btn-ghost` a `rgba(63,169,245,0.08)` come `hover:bg-sc-primary/8` su web; Room Agent con `--sc-accent-light` e `--sc-ring` oltre alle variabili gia presenti.

**EN — Tauri UI:** Inline CSS mirrors the web token palette; Phase 13 tightened ghost-button hover to the same 8% primary tint as Tailwind and added missing semantic tokens on the Local Agent shell.

### Principi UX

1. Stato sempre visibile con colore inequivocabile
2. Zero ambiguita sulla versione (numero + timestamp + hash troncato)
3. Feedback entro 200ms
4. Dark mode only
5. Coerenza visiva con sito marketing www.liveworksapp.com
6. Densita informativa alta (target: tecnici esperti)

---

## 14. Guida Networking Operativa

### Modalita A � Cloud Puro (0 minuti setup)

**Prerequisiti:** ogni PC ha internet, banda minima 5 Mbps/sala.
**Andrea:** crea evento, genera codici pairing, comunica ai tecnici.
**Tecnico:** accende PC ? WiFi location ? browser ? `app.liveslidecenter.com/pair` ? codice ? fatto.

### Modalita B � Rete Locale (15-30 minuti setup)

**Hardware (una tantum, riutilizzabile):**

| Componente               | Esempio                                      | Prezzo        |
| ------------------------ | -------------------------------------------- | ------------- |
| Router WiFi              | TP-Link Archer AX55 / Ubiquiti UniFi Express | �80-150       |
| Access Point (opzionale) | Ubiquiti U6 Lite                             | �100-130 cad. |
| Mini-PC Agent            | Intel NUC / Beelink SER5                     | �250-400      |
| Cavi ethernet Cat6       | 5-10 cavi                                    | �10-30        |

**Setup fisico:** router in regia ? WAN a internet location ? mini-PC Agent via ethernet ? AP se sale lontane.
**Setup software:** apri Agent ? login ? seleziona evento ? Agent scarica file e registra IP al cloud.
**PC sala:** stessa procedura di Modalita A (WiFi del router Andrea invece che della location).

**NON serve VLAN:** il router crea rete isolata di default, DHCP automatico, Agent su 0.0.0.0:8080 raggiungibile da tutti.

### Rete hotel/centro congressi

**Opzione 1:** Usa rete hotel (Modalita A, zero hardware, qualita variabile).
**Opzione 2:** Rete parallela Andrea (Modalita B, controllo totale).
**Opzione 3:** Ibrido (internet hotel per cloud + rete Andrea per LAN file).

---

## 15. Roadmap Esecutiva

| Fase    | Nome                                                           | Stato                                                  | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0       | Bootstrap monorepo                                             | **Completata**                                         | Stack funzionante nel repo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1       | Auth multi-tenant + signup + super-admin                       | **Completata**                                         | Trigger DB `handle_new_user`; `/login` `/signup` con Zod i18n; `RequireAuth` (con verifica `tenant_id` per non-super-admin); `/admin` + `RequireSuperAdmin`; `super_admin_all` RLS su **tutte** le tabelle operative; tipi `Database` in `packages/shared` (allineati migration). **Rimandati a pre-vendita:** inviti team (schema+UI), password reset UI, hardening JWT avanzato.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2       | CRUD Eventi/Sale/Sessioni/Speaker                              | **Completata**                                         | `/events` lista+insert+**update+delete** evento (header inline)+**UI quote**; `/events/:eventId` sale (update nome/tipo)+sessioni+relatori (lista+insert+update inline+delete conferma); **DnD sessioni** `display_order` via **RPC atomica** `rpc_reorder_sessions`; **vista Per sala** read-only; link+QR invite 90gg; **import CSV relatori** (max 200); **enforcement DB** `check_events_quota` + `check_rooms_quota` (trigger BEFORE INSERT). **Rimandati:** griglia calendario/timeline interattiva, import CSV sale/sessioni.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3       | Upload Portal relatori (TUS)                                   | **Completata**                                         | `/u/:token` live: validazione token via RPC `validate_upload_token` (SECURITY DEFINER), init draft version via RPC `init_upload_version` (enforcement cap file per piano + quota storage + trigger `check_storage_quota`), upload **TUS resumable** con `tus-js-client` verso `/storage/v1/upload/resumable` (chunk 6 MiB, retry esponenziale), **SHA-256 client-side** (Web Crypto streaming), finalize atomico via RPC `finalize_upload_version` (set `status='ready'`, hash, `presentations.current_version_id`+`status='uploaded'`, activity_log), abort via RPC `abort_upload_version`. Storage RLS: anon INSERT ammesso solo su path legati a version `status='uploading'`; SELECT solo tenant/super-admin. Contabilita `storage_used_bytes` spostata alla promozione a `ready` (drafts non bloccano quota). Realtime: tabella `presentations` pubblicata per Vista Regia (Fase 5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4       | Versioning + storico                                           | **Completata**                                         | Pannello storico versioni per speaker in `/events/:eventId`, download via Storage signed URL (5 min, bucket privato), rollback atomico via RPC `rpc_set_current_version` (auto-marca le altre `ready` come `superseded`, riattiva la selezionata se era `superseded`), workflow review via RPC `rpc_update_presentation_status` (`pending`/`uploaded`/`reviewed`/`approved`/`rejected`) con `reviewer_note` + `reviewed_at` + `reviewed_by_user_id`, guard DB **append-only** su `presentation_versions` (storage_key/file_name/version_number/hash immutabili dopo finalize), indice `(presentation_id, version_number DESC)`, Realtime attivo su `presentations` + `presentation_versions` (UI si auto-aggiorna quando lo speaker carica dal portale).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5       | Vista Regia realtime                                           | **Completata**                                         | Rotta `/events/:eventId/live` (lazy-loaded `LiveRegiaView`): griglia sale responsive con card per sala (sessione corrente/prossima, lista relatori con pallino stato presentazione, barra progresso upload/approvati), barra riepilogo evento (sale, relatori, upload, approvati, rifiutati), activity feed laterale con polling 10s su `activity_log`, Supabase Realtime su `presentations`+`presentation_versions`+`rooms`+`sessions`+`speakers` (auto-refresh snapshot), toggle fullscreen (Fullscreen API), bottone Vista Regia nell'header `EventDetailView`, chiavi i18n `liveView.*` IT/EN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **6**   | **Pairing Device + Room Player PWA**                           | **Completata**                                         | 4 Edge Functions Deno (pair-init/claim/poll/cleanup); modulo `devices` con PairingModal+DeviceList+DevicesPanel; rotta pubblica `/pair` (tastierino 6 cifre); `/sala/:token` RoomPlayerView file manager ATTIVO (File System Access API, download automatico su disco, progresso per-file, Realtime) + Realtime; vite-plugin-pwa manifest+Workbox; chiavi i18n IT/EN `devices.*`+`pair.*`+`roomPlayer.*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **7**   | **Dual-Mode File Sync (Cloud + Intranet)**                     | **Completata**                                         | Blocco A: File System Access API PWA; Blocco B: Local Agent Tauri v2 `apps/agent/` Axum+SQLite; Blocco C: Room Agent `apps/room-agent/` polling+autostart+tray; Blocco D: `network_mode ENUM(cloud/intranet/hybrid)` su `events`; i18n IT/EN; ADR-007                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8       | Dashboard Super-Admin completa                                 | **Completata**                                         | `/admin` card aggregate; `/admin/tenants`+dettaglio `/admin/tenants/:id` (quote piano/storage/eventi/sale, sospendi/riattiva `suspended`, team users, eventi metadati, log tenant); `/admin/audit` cross-tenant; migration `tenants.suspended`; guard login+`RequireAuth`; i18n `admin.*` / `auth.errorTenantSuspendedLogin` IT+EN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **9**   | **Offline architecture + routing runtime**                     | **Completata**                                         | Edge `room-player-bootstrap` (token → sala + `network_mode` + agent LAN + lista versioni ready); Room Player: chip percorso + banner offline, `useFileSync` cloud/LAN/hybrid, polling 12s manifest/stato sala, `localStorage` ultimo manifest se cloud irraggiungibile; Workbox runtime cache REST + signed URL; `verify_jwt = false` su function (auth = token body); deploy: `supabase functions deploy room-player-bootstrap` + stessa voce in Dashboard se necessario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 10      | Export fine evento                                             | **Completata**                                         | `/events/:eventId`: ZIP slide `current_version` ready (`jszip` + signed URL Storage), CSV `activity_log` per evento (UTF-8 BOM, max 5000 righe), PDF riepilogo metadati (`jspdf`); `EventExportPanel` lazy-loaded; `createVersionDownloadUrlWithClient`; i18n `event.export.*` IT/EN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 11      | Billing Lemon Squeezy                                          | **Completata**                                         | `/billing` admin: `BillingView`, `RequireTenantAdmin`, `TenantQuotaPanel`+griglia piani, URL checkout/portale Lemon da env (`.env.example`); Live WORKS APP; i18n `billing.*`; webhook/sync post-vendita rimandati a integrazione store                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 12      | i18n completamento                                             | **Completata**                                         | `/settings` lingua UI; `settings.*` + `common.menu`; `HydrateFallback` i18n; parity `it.json`/`en.json`; detector `localStorage`+`navigator`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 13      | Integrazioni ecosistema                                        | **Completata (100%)**                                  | `/settings`: sezione ecosistema (`settings.integrations*`) — link esterni Timer/CREW se `VITE_LIVE_SPEAKER_TIMER_URL` / `VITE_LIVE_CREW_URL` (`.env.example`); API pubblica come testo + badge _in arrivo_ senza endpoint; sync cross-app e REST documentata = post-MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 14      | Hardening + Sentry + E2E                                       | **Completata (100%)**                                  | Rate limit pair-claim (5/15min, `pair_claim_rate_events`); RLS `current_tenant_suspended()`; Sentry React lazy init + `ErrorBoundary` con `captureException` + `unhandledrejection` listener; PairView fix. **Sprint 1 (chiuso):** migration `team_invitations` + RLS + trigger `handle_new_user` path invito + Edge Function `team-invite-accept` + `TeamView` (/team, admin-only) + `AcceptInviteView` (/accept-invite/:token); `ForgotPasswordView` (/forgot-password) + `ResetPasswordView` (/reset-password) + link in LoginView; Playwright config + 3 spec (smoke/signup-flow/rls-isolation); `supabase/tests/rls_audit.sql`; i18n team + auth.forgotPassword + auth.resetPassword + auth.acceptInvite IT+EN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **S2**  | Sprint 2 — Intranet offline + bypass Win 11                    | **Completata (100%)**                                  | Local Agent: NSIS hooks firewall+Defender+Private+WebView2 silent; modulo Rust `discovery.rs` (UDP responder :9999 + mDNS `_slide-center._tcp.local.`). Room Agent: `motw.rs` Mark-of-the-Web strip post-rename + integrazione downloader; discovery 4-tier (UNC → UDP → mDNS → manuale); `set_network_private`. Web: `useConnectivityMode` cloud/intranet/hybrid + chip Room Player. i18n `intranet.*` IT/EN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **S3**  | Sprint 3 — Distribuzione desktop NSIS + portable               | **Completata (100%)**                                  | Root `clean-and-build.bat` orchestratore 6 step (toolchain → install → clean → build Local → build Room → check). `apps/agent/{package.json,scripts/{clean,post-build}.mjs}` + `tauri.conf.json bundle.targets:["nsis"]`. `apps/room-agent` gemello. `docs/Manuali/{README, Distribuzione, Installazione_Local_Agent, Installazione_Room_Agent}.md`. Doppio click root produce `release/live-slide-center-{agent,room-agent}/` con NSIS + ZIP portable + `SHA256SUMS.txt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **S4**  | Sprint 4 — Sistema licenze centralizzato Live WORKS APP        | **Completata (100%)**                                  | **Lato cloud (v4.8)**: migration `tenant_license_sync.sql` + Edge Function `licensing-sync` HMAC + `LicenseDoc.slideCenter` su Live WORKS APP. **Lato client Tauri (v4.11)**: `apps/{agent,room-agent}/src-tauri/src/license/{mod,types,crypto,fingerprint,api,manager,commands}.rs` (7 file gemelli per agent, ~600 LOC); chiavi AES-256-GCM **diverse per agent**; feature flag Cargo `license` opzionale (`cargo tauri build --features license`); 5 comandi Tauri `license_*`; UI card "Licenza" + overlay full-screen di gating + polling 30s `pendingApproval`; hook NSIS pre-uninstall `--deactivate` per liberare slot hardware automaticamente; i18n IT/EN dinamico `navigator.language`; ADR-012; manuali aggiornati. Build verde con e senza feature, 10 unit test passano.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **S5**  | Sprint 5 — Hardening commerciale + materiali pre-vendita       | **Completata in-repo (100%)** — esterne Andrea pending | **In-repo (DONE):** `release-licensed.bat` orchestratore build di vendita con `--features license` su entrambi gli Agent + script `build:tauri:licensed`/`release:licensed` in `package.json`; hook NSIS pre-uninstall `--deactivate` per liberare slot HW; `docs/Manuali/build-pdf.ps1` per conversione MD → PDF via pandoc + xelatex (output gitignored in `docs/Manuali/pdf/`); `.github/workflows/rls-audit.yml` blocca PR su leak cross-tenant (Supabase locale + `rls_audit_seed.sql` 2 tenant + `rls_audit.sql`); `apps/web/scripts/upload-sourcemaps.mjs` upload Sentry con skip silenzioso senza `SENTRY_AUTH_TOKEN`; bozze `docs/Commerciale/Contratto_SLA.md` v1.0 (10 sezioni B2B SaaS italiano + GDPR + foro Roma) e `Listino_Prezzi.md` v1.0 (4 piani cloud + desktop separato + bundle + esempio preventivo + competitor); ADR-013 documenta scelta di NON duplicare webhook Lemon Squeezy (gia su Live WORKS APP, propagato via `licensing-sync`). **Esterne Andrea (pending):** acquisto cert OV Sectigo (~190€/anno, 1-2 settimane); revisione SLA + redazione DPA art. 28 con avvocato GDPR (300-800€); registrazione 3 screencast onboarding; listing prodotti su `liveworksapp.com`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **S5b** | Sprint 5b — Code-signing pre-integrato + CI completa + manuali | **Completata in-repo (100%)** — esterne Andrea pending | **In-repo (DONE):** `apps/{agent,room-agent}/scripts/post-build.mjs` con funzione `signFileIfConfigured(filePath)` (detect env `CERT_PFX_PATH+CERT_PASSWORD` → `CERT_THUMBPRINT` → `CERT_SUBJECT`, default `TIMESTAMP_URL=http://timestamp.sectigo.com`, skip silenzioso senza env, sequenza ordinata copy→sign→zip→sha256); `release-licensed.bat` step `1b/6` di preflight code-signing (rileva env + verifica `where signtool` PRIMA del build); `.github/workflows/ci.yml` con 3 jobs in matrice (`web` Ubuntu lint+typecheck, `agents-noFeatures` Ubuntu cargo check, `agents-licensed` Windows cargo check `--features license` per dep `wmi` Win-only); `.github/workflows/playwright.yml` con smoke E2E + Supabase locale via setup-cli pinned `2.20.3` + nightly cron + workflow_dispatch con input `run_signup_test`; `rls-audit.yml` aggiornato con stesso pin `2.20.3` (no `latest` per stabilita CI) + concurrency; `docs/Manuali/Manuale_Code_Signing.md` v1.0 (10 sezioni: acquisto cert OV Sectigo + generazione CSR via OpenSSL + integrazione + troubleshooting 8 casi + rinnovo annuale + costi anno 1 ~253€ + checklist); `docs/Manuali/Script_Screencast.md` v1.0 (scaletta parola-per-parola 3 video onboarding admin/regia/sala + setup tecnico + branding + checklist post-registrazione); ADR-014 in `.cursor/rules/project-architecture.mdc` documenta scelta `signFileIfConfigured()` in post-build (non in batch) per garantire sign→zip→sha256. **Esterne Andrea (pending):** acquisto cert OV Sectigo (settare 3 env vars dopo arrivo `.pfx` e tutto firma automaticamente); registrazione 3 screencast (1 giornata seguendo `Script_Screencast.md`); revisione legale SLA. |

**Logica:** Fasi 0-13 (MVP + **Fase 13 integrazioni ecosistema al 100%**) = MVP cloud + intranet + super-admin + Room Player offline-aware + export + billing + i18n + **pannello integrazioni tenant (link suite, API ancora da esporre)**. Fase 14 = hardening.

### Stima avanzamento e problemi noti

**Stima MVP (fasi 1�6, cfr. logica sopra):** ad aprile 2026, indicativamente **100%** del percorso verso il MVP cloud vendibile: fasi **0**, **1**, **2**, **3**, **4**, **5** e **6** completate. Per la Fase 3: portale `/u/:token` con validazione token via RPC SECURITY DEFINER (`validate_upload_token`), init draft version (`init_upload_version`) che applica cap file per piano + cap storage + trigger `check_storage_quota`, upload TUS resumable 6 MiB/chunk con retry esponenziale verso bucket privato `presentations`, SHA-256 client-side via Web Crypto, finalize atomico (`finalize_upload_version`) che promuove a `status='ready'`, scrive hash, aggiorna `presentations.current_version_id` + `status='uploaded'`, logga `activity_log`; abort best-effort (`abort_upload_version`) su errore client. Storage RLS: anon INSERT solo su path di version `uploading`; SELECT solo tenant/super-admin. Per la Fase 4: storico versioni per relatore in `/events/:eventId` (pannello espandibile lazy-mounted), download firmato `createSignedUrl` a 5 min dal bucket privato, rollback atomico via RPC `rpc_set_current_version` (promuove la versione selezionata, marca le altre `ready` come `superseded`, ripristina da `superseded` se necessario), workflow review `uploaded/reviewed/approved/rejected` via RPC `rpc_update_presentation_status` con `reviewer_note/reviewed_at/reviewed_by_user_id`, guard DB `guard_versions_immutable` append-only (blocca UPDATE su `storage_key/file_name/version_number/presentation_id/tenant_id` e sull'hash una volta scritto), Realtime `postgres_changes` su `presentations` + `presentation_versions` che aggiorna il pannello senza polling. Per la Fase 5: Vista Regia `/events/:eventId/live` (lazy-loaded `LiveRegiaView`) con griglia sale responsive (card per sala con sessione corrente/prossima, lista relatori con pallino stato, barra progresso), barra riepilogo evento, activity feed polling 10s su `activity_log`, Realtime su 5 tabelle, toggle fullscreen, bottone nell�header `EventDetailView`, chiavi i18n `liveView.*` IT/EN. Fase 6 live: 4 Edge Functions Deno per pairing device (pair-init/claim/poll/cleanup); modulo `devices` con PairingModal (codice 6 cifre + QR + countdown), DeviceList, DevicesPanel integrato in EventDetailView; rotta pubblica `/pair` con tastierino touch-friendly 6 cifre (auto-advance, auto-submit, rate-limit UI 3s), pair-claim, redirect `/sala/:token`; rotta `/sala/:token` RoomPlayerView con auth via token SHA-256, file manager ATTIVO con File System Access API (download automatico su disco, progresso per-file), Realtime su `room_state`+`presentations`, menu (openFolder placeholder ADR-001, changeRoom, disconnect); vite-plugin-pwa manifest dark+Workbox runtimeCaching Supabase; chiavi i18n `devices.*`+`pair.*`+`roomPlayer.*` IT/EN (52 chiavi). Se si considera l�intera roadmap **0-14** con pesi simili per fase, la percentuale lineare sul totale visione prodotto si colloca indicativamente attorno al **~90-93%** (fasi **0-13** chiuse su quindici step 0-14). **Fase 13 (100%):** `/settings` sezione ecosistema (`settings.integrations*`), URL opzionali Timer/CREW da env, API pubblica in roadmap senza endpoint. **Fase 12:** `/settings` con selettore lingua IT/EN (`settings.*`, `i18n.changeLanguage`), `common.menu`, `HydrateFallback` con `common.loading`. **Fase 11:** `/billing` per JWT `role=admin` (`RequireTenantAdmin`), `BillingView` con quote e confronto piani, link checkout/portale Lemon Squeezy da env Vite (`.env.example`); webhook/sync abbonamenti in-repo rimandati. **Fase 10:** export ZIP/CSV/PDF in `/events/:eventId`. **Fase 9:** Edge `room-player-bootstrap` + routing download nel Room Player PWA. **Fase 8:** console super-admin (`/admin`, `/admin/tenants`, `/admin/tenants/:id`, `/admin/audit`), colonna `tenants.suspended`, guard su `LoginView`/`RequireAuth` (blocco UI tenant; eventuale enforcement RLS granulare su tutte le tabelle operativo rimandato a hardening Fase 14 se richiesto).

**Gap dichiarati (rimandati con scelta consapevole):**

- ~~**Inviti team**~~ — **completato Sprint 1**: migration `team_invitations` + RLS + trigger `handle_new_user` path invito; Edge Function `team-invite-accept`; `TeamView` `/team` (admin-only); `AcceptInviteView` `/accept-invite/:token`.
- ~~**Password reset UI**~~ — **completato Sprint 1**: `ForgotPasswordView` `/forgot-password`, `ResetPasswordView` `/reset-password`, link "Password dimenticata?" in `LoginView`.
- **Griglia calendario/timeline interattiva** (Fase 2): la vista Per sala read-only copre l'orientamento operativo; timeline drag-and-drop e nice-to-have.
- **Import CSV sale/sessioni** (Fase 2): non richiesto per MVP. Import relatori gia funzionante.

**Problemi / vincoli (non necessariamente bug di codice):**

- **Docker / Supabase locale:** senza Docker Desktop (o stack equivalente) non si eseguono `supabase start`, `supabase db reset`, `supabase gen types typescript --local`. Le relative caselle in **�18** restano `[ ]` finch� l�ambiente non esiste: � un **debito di toolchain**, non una misura del codice nel repo.
- **Tipi TypeScript:** `packages/shared/src/types/database.ts` resta **allineato alle migration per revisione manuale** fino al primo `gen types` locale utile; poi diff controllato rispetto al file versionato.
- **Infra commerciale:** progetto Supabase EU, Vercel, dominio, `db push` remoto � stato in **�18 Account**; dipende da account e deploy, non solo dal monorepo.

**EN:** For **MVP phases 1�6**, the project is now **100%** complete (MVP fully delivered). Phase 3 is live: `/u/:token` runs TUS resumable uploads (6 MiB chunks, exponential retry) into a private `presentations` bucket; init/validate/finalize/abort run through SECURITY DEFINER RPCs that enforce the per-plan file cap, the `storage_limit_bytes` quota, and append-only `presentation_versions`; client-side streaming SHA-256 is persisted on finalize; `storage_used_bytes` is accounted only when a version is promoted to `ready` (drafts don't lock quota); Storage RLS allows anon INSERT solely on paths bound to a `presentation_versions` row in status `uploading`, SELECT is tenant-scoped (plus super-admin). Phase 4 is live: per-speaker version history panel in `/events/:eventId` (lazy-mounted, Realtime-backed), 5-minute signed download URLs from the private bucket, atomic rollback via `rpc_set_current_version` (promotes the picked version, demotes the other `ready` rows to `superseded`, restores from `superseded` when needed), review workflow `uploaded/reviewed/approved/rejected` via `rpc_update_presentation_status` with reviewer note + timestamp + user id, and a `guard_versions_immutable` trigger that makes `presentation_versions` append-only for identity/path fields and locks the SHA-256 hash once set. Phase 5 is live: `/events/:eventId/live` control room (lazy-loaded `LiveRegiaView`) with a responsive room grid (per-room card showing current/next session, speaker list with presentation-status dots, upload progress bar), event summary bar (room/speaker/uploaded/approved/rejected counters), activity feed sidebar (10s polling on `activity_log`), Supabase Realtime on `presentations`+`presentation_versions`+`rooms`+`sessions`+`speakers` (auto-refresh snapshot), Fullscreen API toggle, Control Room button in the `EventDetailView` header, and `liveView.*` i18n keys (IT/EN). Phase 6 is live: 4 Deno Edge Functions (pair-init/claim/poll/cleanup); `devices` module with PairingModal (6-digit code + QR + countdown), DeviceList, DevicesPanel in EventDetailView; public route `/pair` (6-digit numeric keypad, auto-advance, auto-submit, 3s rate-limit); `/sala/:token` RoomPlayerView with SHA-256 token auth, passive file manager, Realtime on `room_state`+`presentations`, menu (folder placeholder ADR-001, change room, disconnect); vite-plugin-pwa dark manifest + Workbox Supabase runtimeCaching; i18n keys `devices.*`/`pair.*`/`roomPlayer.*` IT/EN (52 keys). Across **all roadmap phases 0�14**, a naive equal-weight view is about **~90–93%** (phases **0–13** closed of fifteen steps 0–14). **Phase 13 (100%):** `/settings` ecosystem panel (`settings.integrations*`), optional Timer/CREW URLs from env; public API announced without live endpoints yet. **Phase 12:** `/settings` language selector IT/EN (`settings.*`, `i18n.changeLanguage`), `common.menu`, router `HydrateFallback` uses `common.loading`. **Phase 11:** `/billing` for tenant admins (`RequireTenantAdmin`), `BillingView` with quotas/plan matrix, Lemon checkout/portal links from Vite env (`.env.example`); in-repo subscription webhooks/sync deferred. **Phase 10:** end-of-event export (ZIP/CSV/PDF) on /events/:eventId. **Phase 9:** `room-player-bootstrap` + Room Player cloud/LAN/hybrid routing. **Phase 8:** super-admin console (/admin, /admin/tenants, /admin/tenants/:id, /admin/audit), `tenants.suspended`, and login/session guards; full RLS-wide suspension is deferred unless required in Phase 14. **Tooling:** without Docker, local Supabase CLI flows stay blocked; �18 checkboxes reflect that. \*\*`database.ts`\*\* stays hand-synced with migrations until `gen types --local` is viable.

---

## 16. Struttura Monorepo

```
Live SLIDE CENTER/
+-- apps/
�   +-- web/                 # Dashboard + Upload Portal + Room Player PWA (React 19)
�   +-- agent/               # Local Agent (Tauri v2) � Fase 7 � mini-PC regia
�   �   +-- src-tauri/       # Rust: Axum HTTP :8080, SQLite WAL, sync engine
�   �   �   +-- src/license/ # Sprint 4: AES-256-GCM + WMI + reqwest (feature flag opzionale)
�   �   +-- ui/              # HTML standalone dashboard + card "Licenza" + overlay
�   �   +-- scripts/         # Sprint 3: clean.mjs + post-build.mjs (NSIS + ZIP + SHA256)
�   +-- room-agent/          # Room Agent (Tauri v2 lite) � Fase 7 � ogni PC sala
�       +-- src-tauri/       # Rust: polling LAN, download, autostart HKCU, tray
�       �   +-- src/license/ # Sprint 4: gemello al Local Agent ma chiavi AES diverse
�       +-- ui/              # HTML standalone + card "Licenza" + overlay
�       +-- scripts/         # Sprint 3: clean.mjs + post-build.mjs (gemello)
+-- packages/
�   +-- shared/              # Types, Zod validators, constants, i18n IT/EN (incl. license.*)
�   +-- ui/                  # cn() utility, componenti shadcn
+-- supabase/
�   +-- migrations/          # Schema SQL + RLS (incl. tenant_license_sync.sql Sprint 4 cloud)
�   +-- functions/           # Edge Functions Deno (health, pair-init, pair-claim, pair-poll, cleanup, room-player-bootstrap, licensing-sync)
�   +-- seed.sql
�   +-- config.toml
+-- icons/                   # Logo sorgente ufficiale (JPG) -> genera apps/web/public/* (script prebuild)
+-- scripts/                 # Setup PowerShell (MCP Supabase)
+-- docs/
�   +-- GUIDA_DEFINITIVA_PROGETTO.md  ? QUESTO FILE (unico)
�   +-- PIANO_FINALE_SLIDE_CENTER_v2.md
�   +-- Manuali/             # Sprint 3: Distribuzione + Local Agent + Room Agent (manuali operatore) + Sprint 5: build-pdf.ps1 + Sprint 5b: Manuale_Code_Signing.md + Script_Screencast.md
�   +-- Manuali/pdf/         # Sprint 5: PDF generati da pandoc (gitignored)
�   +-- Commerciale/         # Sprint 5: Contratto_SLA.md + Listino_Prezzi.md + README (bozze pre-vendita)
+-- .github/workflows/        # Sprint 5: rls-audit.yml + Sprint 5b: ci.yml (lint/typecheck/cargo check matrix) + playwright.yml (smoke E2E + nightly)
+-- release/                  # Sprint 3: output `clean-and-build.bat` (NSIS + ZIP portable + SHA256SUMS) — gitignored
+-- clean-and-build.bat       # Sprint 3: orchestratore build doppio-click (build di sviluppo, no licenza)
+-- release-licensed.bat      # Sprint 5: orchestratore build di VENDITA con --features license + Sprint 5b: preflight code-signing
+-- turbo.json
+-- pnpm-workspace.yaml
+-- .env.example
```

**ATTENZIONE:** `apps/player/` NON deve esistere come progetto Tauri. Il Room Player e la route `/sala/:token` in `apps/web/`.

---

## 17. Account e Infrastruttura

| Risorsa       | Account                       | Note                                                      |
| ------------- | ----------------------------- | --------------------------------------------------------- |
| GitHub        | **live-software11**           | `github.com/live-software11/live-slide-center`            |
| Supabase      | **live.software11@gmail.com** | Project: `live-slide-center`, Ref: `cdjxxxkrhgdkcpkkozdl` |
| Vercel        | **live.software11@gmail.com** | Dominio: `app.liveslidecenter.com`                        |
| Lemon Squeezy | Via Live WORKS APP            | Fase 11                                                   |
| Sentry        | **live.software11@gmail.com** | Fase 14                                                   |
| Cloudflare R2 | �                             | Solo quando egress > $50/mese                             |

**Prima di ogni push:** `gh auth status` ? deve essere **live-software11**.

---

## 18. Checklist Pre-Fase-1

### Documentazione

- [ ] Letto questo documento per intero
- [x] Logo / favicon / PWA: sorgente `icons/Logo Live Slide Center.jpg`, script `apps/web/scripts/generate-brand-icons.mjs`, componente `AppBrandLogo`, i18n `app.displayName` (dettaglio §13)
- [x] `.cursor/rules/project-architecture.mdc` � gia con riferimento esplicito a questo file
- [x] Regola Cursor **obbligatoria** allineamento guida/codice: `.cursor/rules/guida-definitiva-doc-sync.mdc` (`alwaysApply: true`)
- [x] Regola Cursor review + step successivo: `.cursor/rules/surgical-review-next-step.mdc` (`alwaysApply: true`)

### Account

- [ ] Supabase progetto EU Francoforte attivo
- [ ] Vercel collegato al repo
- [ ] Dominio `liveslidecenter.com` (o equivalente) acquisito

### Database

> **Nota:** assenza di Docker sulla workstation di sviluppo lascia `[ ]` su `supabase start` / `db reset` / `gen types --local` senza invalidare l�allineamento migration ? codice nel repo (tipi manutenuti a mano, �15 �problemi noti�).

- [ ] `supabase start` locale OK (Docker Desktop attivo + CLI Supabase nel PATH)
- [x] Migration iniziale nel repo: `20250411090000_init_slide_center.sql`
- [x] Migration pairing + super-admin + Realtime: `20250415120000_pairing_super_admin.sql`
- [x] Migration quote storage + default Trial: `20250415120100_quotas_enforcement.sql`
- [x] Migration auth signup ? tenant: `20250415130000_handle_new_user_tenant.sql`
- [x] Migration applicata manualmente al progetto remoto (SQL Editor) � trigger, tabelle, RLS, quote, RPC
- [ ] Verifica applicata: `supabase db reset` locale (Docker) senza errori SQL
- [x] Tipi `Database` per PostgREST: `packages/shared/src/types/database.ts` (manutenuti a mano in linea con le migration finche Docker non consente `supabase gen types typescript --local`)
- [ ] Dopo primo `supabase db reset` locale: rigenerare i tipi con CLI e **diff** rispetto al file corrente (funzioni/trigger extra da CLI vanno incorporate o documentate)
- [x] Bootstrap super-admin eseguito (sezione 10, `UPDATE auth.users`) dopo primo signup
- [x] Migration hardening fasi 1-2: `20250415140000_phase1_2_hardening.sql` (super_admin_all + quota enforcement + RPC reorder)
- [x] Migration Fase 3 Upload Portal: `20250416090000_phase3_upload_portal.sql` (bucket privato `presentations`, Storage RLS anon-insert vincolato a version `uploading`, RPC `validate_upload_token` / `init_upload_version` / `finalize_upload_version` / `abort_upload_version`, helper `tenant_max_file_size`, rework `update_storage_used` su transizione `ready`, Realtime su `presentations`)
- [x] Migration Fase 4 Versioning: `20250417090000_phase4_versioning.sql` (colonne review `reviewer_note` / `reviewed_at` / `reviewed_by_user_id`, RPC `rpc_set_current_version` e `rpc_update_presentation_status`, guard append-only `guard_versions_immutable`, indice storico versioni)
- [x] Migration Fase 7 Dual-Mode: `20250416120000_network_mode.sql` (ENUM `network_mode(cloud|intranet|hybrid)` + colonna `events.network_mode NOT NULL DEFAULT 'cloud'`)
- [x] Migration Fase 8 Super-Admin: `20250416120100_tenant_suspended.sql` (colonna `tenants.suspended BOOLEAN NOT NULL DEFAULT false`)
- [x] Edge Function Fase 9: `supabase/functions/room-player-bootstrap/` + `[functions.room-player-bootstrap] verify_jwt = false` in `config.toml`
- [x] Migration Fase 14 Rate Limit: `20250416140300_phase14_pair_claim_rate_limit.sql` (tabella `pair_claim_rate_events`, indice IP+timestamp, grant solo `service_role`)
- [x] Migration Fase 14 RLS Suspended: `20250416140301_phase14_rls_tenant_suspended.sql` (funzione `current_tenant_suspended()` SECURITY DEFINER, policy granulari su tutte le tabelle operative, `users` SELECT preservato per flusso auth)
- [x] Migration Sprint 1 Team Invitations: `20260417100000_team_invitations.sql` (tabella `team_invitations` + RLS `tenant_isolation`+`current_tenant_suspended()`+`super_admin_all`; aggiornamento `handle_new_user()` per percorso invitato senza creazione tenant; indici token+tenant)
- [x] Edge Function Sprint 1: `supabase/functions/team-invite-accept/` + `[functions.team-invite-accept] verify_jwt = false` in `config.toml`

### Codice

- [x] `packages/shared/src/types/enums.ts`: `UserRole` include `'super_admin'`
- [x] `packages/shared/src/constants/plans.ts`: valori allineati a sezione 12
- [x] `PlanLimits` include `maxFileSizeBytes`
- [x] `apps/player/` eliminato (non deve esistere) � fatto
- [x] `pnpm run typecheck` � verde in CI locale (aprile 2026)
- [x] `pnpm run lint && pnpm run build` � verde in locale (aprile 2026)
- [x] Fase 13 (100% — ecosistema): `SettingsView` + `features/settings/lib/integrations-env.ts`, chiavi `settings.integrations*`, `.env.example` / `vite-env.d.ts`
- [x] Fase 14 — Sentry: `@sentry/react` lazy init in `init-sentry.ts`, `VITE_SENTRY_DSN`, `@playwright/test` in devDep
- [x] Sprint 1 — Fase 14 al 100%: `ErrorBoundary` + `captureException` + `unhandledrejection`; `ForgotPasswordView`/`ResetPasswordView`/`AcceptInviteView`/`TeamView`; Playwright config + 3 spec; `supabase/tests/rls_audit.sql`; i18n `team.*`+`auth.forgotPassword*`+`auth.resetPassword*`+`auth.acceptInvite*` IT+EN

### Design

- [ ] Wireframe dashboard tenant
- [ ] Wireframe modal "Aggiungi PC" con codice 6 cifre + QR
- [ ] Wireframe pagina `/pair` con tastierino
- [ ] Wireframe Room Player fullscreen
- [ ] Wireframe dashboard super-admin

**EN � Checklist status:** Migrations are in-repo; tenant routes are auth-guarded; `SignupView` shows check-email when `signUp` returns no session, otherwise waits for `tenant_id` on the JWT via `refreshSession()` + `getUser()` with retries before navigating home; `LoginView` refreshes and requires `tenant_id` or `super_admin` before navigating. `database.ts` is hand-maintained until `supabase gen types --local` runs. Super-admin has `/admin` (aggregate stats), `/admin/tenants`, `/admin/tenants/:id` (quotas + `suspended` + team/events metadata + tenant-scoped `activity_log`), and `/admin/audit` (cross-tenant `activity_log`); tenant login is blocked when `tenants.suspended` is true. Tenant `/events` lists and creates events (RLS) with a **quota summary** (storage + events starting in the current calendar month vs `max_events_per_month`) and a **client-side create guard** when the selected start month is already at capacity; `/events/:eventId` shows the same **storage** plus **rooms in this event** vs `max_rooms_per_event`, with a **client-side room create guard** at capacity. Event detail still includes rooms (**inline edit** name/type), sessions and speakers (**inline edit** on the same fields as create), list + create + delete with two-step confirm and CASCADE hints; **sessions list** supports **HTML5 drag-and-drop** on a handle to reorder rows and persist **`display_order`** (`reorderSessionsDisplayOrder`); **upload invite link + QR** on each speaker; **`speaker-csv-import`** adds UTF-8 BOM **CSV import** (template + all-or-nothing validation, max 200 rows, `session_title` ? session match) before bulk `createSpeakerForSession`; `/u/:token` runs **TUS** resumable upload (Phase 3). Tenant **`/billing`** (Phase 11) for JWT `role=admin`: quotas, plan matrix, external Lemon checkout/portal links from Vite env. **�15** now includes a quantitative MVP estimate and a �known issues / tooling� note (Docker vs checklist �18). Remaining: Docker `db reset` + type regen, wireframes, Phase 1 invites, advanced calendar/timeline UX, DB-level quota enforcement if required, Lemon subscription webhooks/sync (post-sale), further admin routes.

---

## 19. Regole Non Negoziabili

1. **Mai dati senza tenant_id** � ogni riga DB, ogni file Storage, ogni request API
2. **Mai scorciatoie su RLS** � se una query funziona solo bypassando RLS, e un bug
3. **Mai logica sicurezza solo nel client** � check in Edge Function o Postgres, mai solo React
4. **Mai promettere offline senza Agent** � indicare chiaramente: "Cloud diretto" vs "Offline resiliente"
5. **Mai spendere senza clienti che giustifichino** � Free tier finche possibile
6. **Mai stringa UI senza coppia IT/EN** � zero eccezioni, stesso commit
7. **Mai UPDATE su `presentation_versions`** � append-only, ogni modifica = nuova riga
8. **Mai `apps/player/` come progetto Tauri** � Room Player = PWA in `apps/web/`
9. **Mai vedere contenuto file clienti** � Super-Admin vede metadati, non binari (GDPR)
10. **Mai mDNS da browser** � Agent registra IP al cloud, PWA lo interroga dal cloud

---

## Ecosistema Live Software

```
Live SLIDE CENTER
  +-- Licenze --> Live WORKS APP (Lemon Squeezy, Fase 11)
  +-- Timer --> Live Speaker Timer (deep link da `/settings` se `VITE_LIVE_SPEAKER_TIMER_URL`; sync sessione = post-MVP)
  +-- Tecnici --> Live CREW (assegnazione tecnici, futuro)
  +-- Eventi --> Live PLAN (pianificazione, futuro)
```

Integrazioni future. Priorita: prodotto standalone vendibile.

---

**Questo e l'unico documento.** Ogni decisione futura non coperta qui: prima aggiorna questo file, poi scrivi il codice. Cosi tra 6 mesi hai un unico posto dove leggere "perche ho deciso X".

**EN:** This is the single source of truth for Live SLIDE CENTER. All architecture, storage, pairing, dashboards, plans, networking, and roadmap decisions are here. In case of conflict with any other document, this file wins.
