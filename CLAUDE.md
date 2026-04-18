# Live SLIDE CENTER — Sintesi viva (CLAUDE.md)

> Questo file e' la **mappa rapida** del progetto per AI assistenti / nuovi developer.
> **Per architettura completa:** `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` (UNICA fonte di verita).
> **Per cose da fare:** `docs/STATO_E_TODO.md`.
> **Per setup ambiente:** `docs/Setup_Strumenti_e_MCP.md`.
> **Per regole AI:** `.cursor/rules/*.mdc`.
> **Per quotidianita':** comandi qui sotto.
>
> **Versione CLAUDE.md:** 2.1 — 18 aprile 2026 sera (post fix deploy Vercel + MCP Vercel ufficiale, vedi `STATO_E_TODO.md` §0.26).

## Cos'e'

SaaS multi-tenant per **gestione presentazioni in eventi live**. Nome commerciale: **Slide Center**.

- **Cloud:** dashboard React (`apps/web`) + Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions).
- **Desktop offline:** singolo binario Tauri 2 (`apps/desktop`) con server Rust Axum embedded — **stessa SPA** del cloud, backend locale + LAN + mDNS.
- **Owner:** Andrea Rizzari (CTO/imprenditore).

## Account (REGOLA SACRA — verificare PRIMA di ogni operazione remota)

| Servizio | Account                                        | Verifica         |
| -------- | ---------------------------------------------- | ---------------- |
| GitHub   | **live-software11**                            | `gh auth status` |
| Supabase | live.software11@gmail.com (project `cdjxxxkrhgdkcpkkozdl`) | Dashboard |
| Vercel   | live.software11@gmail.com (scope `livesoftware11-3449s-projects`, project `live-slide-center`) | `vercel whoami` |
| Repo     | `github.com/live-software11/live-slide-center` | `git remote -v`  |

Mai operare con account `Andraven11` (e' per Preventivi DHS / Gestionale FREELANCE).

## Stack in una riga

React 19 + TS strict + Vite 8 + Tailwind 4 + Tauri 2 + Rust Axum + Supabase (Postgres 17, project `cdjxxxkrhgdkcpkkozdl`) + pnpm + Turborepo.

## Struttura monorepo (alto livello)

```
live-slide-center/
├── apps/
│   ├── web/              # React 19 SPA (cloud + desktop) — feature folders
│   ├── desktop/          # Tauri 2 unico (Sprint J-Q): wrapper + server Rust Axum
│   ├── agent/            # Local Agent legacy Fase 7 (admin LAN, Tauri+Axum)
│   └── room-agent/       # Room Agent legacy Fase 7 (PC sala daemon, autostart)
├── packages/
│   └── shared/           # @slidecenter/shared — types DB + i18n + utility cross-app
├── supabase/
│   ├── migrations/       # 25+ SQL migration (Fasi 0-15)
│   ├── functions/        # 15 Edge Functions Deno
│   ├── tests/            # rls_audit.sql + pgTAP
│   └── config.toml
├── docs/                 # Vedere docs-roadmap.mdc per la mappa completa
├── icons/                # Sorgente brand (Logo Live Slide Center.jpg)
├── package.json          # workspace pnpm + script Turbo
├── turbo.json            # pipeline build/dev/lint/typecheck/test
├── pnpm-workspace.yaml
└── .cursor/rules/        # Suite rules AI (vedere sotto)
```

## Comandi quotidiani

```powershell
# Dev (PowerShell — usare ; non &&)
pnpm install
pnpm dev                                       # tutti gli apps in parallelo (Turbo)
pnpm --filter @slidecenter/web dev             # solo cloud SPA (porta 5173)
pnpm dev:desktop                               # Tauri 2 desktop (Vite + webview)

# Quality gate (PRIMA di chiudere ogni task — vedi 02-quality-gate.mdc)
pnpm typecheck
pnpm lint
pnpm build
pnpm test                                      # se hai toccato logica business

# Per modifiche apps/desktop/src-tauri:
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --all-targets -- -D warnings

# Build desktop NSIS (Sprint J-Q)
pnpm --filter @slidecenter/desktop release:nsis
# oppure wrapper PowerShell user-friendly:
apps/desktop/scripts/release.ps1 -Signed

# Supabase
supabase db push                               # applica migration pendenti
supabase functions deploy <nome>               # deploy singola Edge Function
supabase gen types typescript --project-id cdjxxxkrhgdkcpkkozdl > packages/shared/src/types/database.ts

# Git (account live-software11)
gh auth status                                 # verifica account
git status; git add <file>; git commit -m "feat: msg"; git push

# Vercel (account livesoftware11-3449, project live-slide-center)
vercel whoami                                  # verifica account
vercel --prod --yes --archive=tgz              # SBLOCCO MANUALE: deploy production
                                               # --archive=tgz OBBLIGATORIO (monorepo > 15k file)
                                               # Usare solo se auto-deploy GitHub->Vercel e' rotto
                                               # vedi ARCHITETTURA §20.3.1 + STATO_E_TODO §0.26
```

Per messaggi commit multilinea (PowerShell NON supporta heredoc bash): scrivere il messaggio con `Write` tool in `.commit-msg-tmp.txt`, poi `git commit -F .commit-msg-tmp.txt` + delete file.

## Suite Cursor rules (`.cursor/rules/`)

**3 livelli per minimizzare context overload:**

### alwaysApply (sempre attive — ~12K totali)

| File                      | Cosa garantisce                                                              |
| ------------------------- | ---------------------------------------------------------------------------- |
| `00-project-identity.mdc` | Identita progetto, fonti di verita, account, vincoli sovrani                 |
| `01-data-isolation.mdc`   | Tenant isolation + RLS pattern obbligatori + RBAC + Storage path             |
| `02-quality-gate.mdc`     | Workflow chiusura task: typecheck/lint/build + standard senior               |
| `03-i18n.mdc`             | i18n IT/EN obbligatorio + terminologia dominio eventi live                   |
| `04-git-workflow.mdc`     | Account live-software11, format commit, deploy Vercel/Supabase/Tauri         |
| `mcp-supabase.mdc`        | Uso server MCP Supabase (project_id, capabilities)                           |
| `mcp-vercel.mdc`          | Uso server MCP Vercel (deploy + build/runtime logs + workflow CLI fallback)  |

### Globs mirati (caricati solo quando matchi i file)

| File                      | Globs                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `web-react.mdc`           | `apps/web/src/**/*.{ts,tsx}` — pattern React 19, design system, perf   |
| `web-supabase-client.mdc` | `apps/web/src/lib/supabase.ts`, `repository.ts`, hooks `use*.ts`       |
| `supabase-db.mdc`         | `supabase/migrations/**`, `supabase/functions/**`, `supabase/tests/**` |
| `desktop-tauri.mdc`       | `apps/desktop/**`, `apps/web/src/lib/desktop-bridge.ts`                |
| `legacy-agents.mdc`       | `apps/agent/**`, `apps/room-agent/**` (Fase 7 legacy)                  |

### Agent-requestable (caricabili on-demand)

| File                    | Quando leggerla                                                         |
| ----------------------- | ----------------------------------------------------------------------- |
| `architecture-deep.mdc` | Feature cross-cloud-desktop-LAN o refactoring grande di un sottosistema |
| `field-test-fase15.mdc` | Pianificare/chiudere uno sprint A-Q o capire cosa fa quale sprint       |
| `docs-roadmap.mdc`      | Aggiornare docs o cercare quale guida usare                             |

## Stato progetto (aprile 2026)

### Cloud (Fasi 0-14): COMPLETATO 100%

Schema PostgreSQL maturo (RLS + custom claims JWT + 25+ migration), 15 Edge Functions, sistema pairing PC sala (cloud), Storage TUS resumable, Realtime postgres_changes + Broadcast, Auth con team invitations, GDPR export, billing redirect Live WORKS APP, status page pubblica, super_admin tenant management.

### Field test (Fase 15.1, Sprint A-I): COMPLETATO 100%

| Sprint | Tema                                                                 |
| ------ | -------------------------------------------------------------------- |
| A      | playback_mode (auto/live/turbo) — tuning polling sala                |
| B      | Realtime Broadcast `room:<uuid>` — PC sala anon                      |
| C      | Resume HTTP Range + verify SHA-256 + skip se completo                |
| D      | Bootstrap optimization (cached fields, manifest one-shot)            |
| E      | Retry/backoff (E1) + recovery offline (E2) + storage guard (E3)      |
| F      | Bulk actions admin (move, delete, change presentation)               |
| G      | Drag&drop file fra sessioni (RPC `rpc_move_presentation_to_session`) |
| H      | File preview universale (PPT/PDF/Keynote thumbnail + zoom)           |
| I      | "In onda" (`current_presentation_id` + RPC sicura)                   |

### Desktop offline (Fase 15.2, Sprint J-P + FT): TUTTI DONE

| Sprint | Tema                                                                       |
| ------ | -------------------------------------------------------------------------- |
| J      | Bootstrap Tauri 2 + plugin (shell/fs/http/notification/dialog) + NSIS      |
| K      | Server Rust Axum locale + SQLite (rusqlite WAL) + storage + Range          |
| L      | mDNS publish + browse `_slidecenter._tcp.local` + role admin/sala          |
| M      | Persistenza assoluta sala (`device.json` auto-rejoin)                      |
| N      | LAN push admin → sala (fan-out + ring buffer + long-poll `/events/stream`) |
| O      | Backend status hook + `BackendModeBadge` + astrazione Realtime             |
| P      | Updater Tauri + `DesktopUpdateBanner` + script PowerShell release          |
| FT     | Field Test Readiness Pack (smoke test + runbook + template feedback)       |

### Field test desktop (RINVIATO per scelta Andrea)

**Stato:** non in esecuzione. Quando Andrea avra' un evento DHS reale o un cliente esterno interessato alla versione desktop, eseguire la **procedura completa** descritta in `docs/STATO_E_TODO.md` § 3 (preparazione T-2 / smoke T-1 / esecuzione T / decisione T+1) + template feedback inline (§ 3.5) + procedura rollback (§ 3.6).

- **Pre-volo automatizzato:** `pnpm --filter @slidecenter/desktop smoke-test:sala` su ogni PC field-test (deve restituire `>>> SEMAFORO VERDE` su 100% dei PC).
- **Decisioni misurabili:** GO/NO-GO produzione + GO/NO-GO Sprint Q definite in `docs/STATO_E_TODO.md` § 3.5 e § 4.2 (5 domande SI/NO, soglia 2 SI per Sprint Q).

### Sprint Q (OPZIONALE): Sync hybrid cloud<->offline

**Stato:** **NON in progress.** Decisione GO/NO-GO vincolata al framework in `docs/STATO_E_TODO.md` § 4.2 (post-field-test).

**Goal (se GO):** quando il desktop torna online, sync con cloud Supabase per backup + condivisione cross-sede. Push-only (desktop master, cloud backup). Worker 60s, `synced_at` su SQLite, TUS upload bucket. **Piano operativo READY-TO-CODE** in `docs/STATO_E_TODO.md` § 4.3 (file da creare, RPC, schema migration, UI, costi stimati ~5€/mese-evento, test manuali).

**Quando NON serve:** uso interno single-site senza necessita di backup cloud o condivisione fra sedi.

**Hardening, code-signing, multi-OS:** **NON sono Sprint Q.** Code-signing OV Sectigo e' un'attivita esterna pianificabile (vedi `docs/STATO_E_TODO.md` § 2.2 + `docs/Manuali/Manuale_Code_Signing.md`).

### Audit chirurgico 18/04/2026 (Sprint R / S / T pianificati)

**Stato:** **audit completato, famiglia Sprint R DONE + famiglia Sprint S DONE + Sprint T-1 DONE + Sprint T-2 DONE (9/10 GAP chiusi: G1+G2+G3+G4+G5+G6+G7+G8+G9), resta solo G10 (Sprint T-3 competitor parity).**

**Sintesi 10 GAP rilevati** rispetto agli obiettivi prodotto sovrani (parita cloud/desktop, file da locale, versioning chiaro, perf zero impatto, super-admin licenze, OneDrive-style, drag PC, upload da sala, export ordinato, competitor parity):

| Sprint  | Focus                                  | Gap addressati | Tempo dev | Stato                                      |
| ------- | -------------------------------------- | -------------- | --------- | ------------------------------------------ |
| **R-1** | Super-admin crea tenant + licenze      | G1             | 1.5g      | **DONE 18/04/2026 (vedi §0.9)**            |
| **R-2** | Lemon Squeezy webhook + email          | G2             | 2g        | **DONE 18/04/2026 (vedi §0.10)**           |
| **R-3** | PC sala upload speaker check-in        | G3             | 2g        | **DONE 18/04/2026 (vedi §0.11)**           |
| **S-1** | Drag&drop folder admin OneDrive-style  | G4             | 1g        | **DONE 18/04/2026 (vedi §0.12)**           |
| **S-2** | Drag&drop visivo PC ↔ sale             | G5             | 1g        | **DONE 18/04/2026 (vedi §0.13)**           |
| **S-3** | Export ZIP ordinato per sala/sessione  | G6             | 0.5g      | **DONE 18/04/2026 (vedi §0.14)**           |
| **S-4** | Ruolo device "Centro Slide" multi-room | G7             | 1.5g      | **DONE 18/04/2026 (vedi §0.15)**           |
| **T-1** | Badge versione "in onda" + toast       | G8             | 0.5g      | **DONE 18/04/2026 (vedi §0.16)**           |
| **T-2** | Telemetria perf PC sala (heap/storage/FPS/battery) | G9     | 1g        | **DONE 18/04/2026 (vedi §0.17)**           |
| **T-3** | Competitor parity (file checking, ePoster) | G10        | 2g        | pending (match feature PreSeria/Slidecrew) |

**Dettaglio dei 10 GAP, file coinvolti, soluzione tecnica, decisioni richieste ad Andrea:** `docs/STATO_E_TODO.md` § 0.

**Backward compatibility:** 100% (tutti gli sprint sono opt-in via flag, nessun breaking change). Nessun aumento di costi infra (Supabase Free + Vercel Free + Lemon Squeezy free tier sufficienti).

### Sprint R-1 (G1) — Super-admin crea tenant + licenze (DONE 18/04/2026)

**Stato:** **completato e verde.** Andrea (super_admin) puo' creare un nuovo tenant cliente + invitare il primo admin direttamente dal pannello `/admin/tenants` senza passare da CLI/Supabase Dashboard.

| Area                | Cosa                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migration           | `supabase/migrations/20260418060000_admin_create_tenant.sql` — RPC SECURITY DEFINER `admin_create_tenant_with_invite(...)` con `is_super_admin()` check, validazioni stringenti (slug, plan, storage, email, license format), INSERT atomico tenant+invite+activity_log. |
| Repository          | `apps/web/src/features/admin/repository.ts` — `createTenantWithInvite()` + `suggestSlug()` + mappa errori i18n.                                                                                                                                                          |
| UI                  | `apps/web/src/features/admin/components/CreateTenantDialog.tsx` — form completo (nome, slug auto-derivato, plan, quote per piano, expires_at, license_key opzionale, email primo admin) + schermata risultato con copy-to-clipboard dell'invite URL.                     |
| UI integration      | `apps/web/src/features/admin/AdminTenantsView.tsx` — bottone "Crea nuovo tenant" in header lista.                                                                                                                                                                        |
| i18n                | 36 chiavi nuove `admin.createTenant.*` IT/EN parity + `common.copy`/`common.copied` riusabili.                                                                                                                                                                           |
| Schema team_invites | `invited_by_user_id` ora nullable + nuovo `invited_by_role TEXT` per supportare inviti da super_admin (che non ha riga in `public.users`).                                                                                                                               |

**Quality gates verdi:** `pnpm typecheck` (5/5 OK), `pnpm --filter @slidecenter/web lint` (0 errors), `pnpm --filter @slidecenter/web build` (1.16s, AdminTenantsView 19.62 kB gzip 4.62 kB).

**Cosa NON e' incluso (delegato a sprint successivi):**

- ~~Email automatica all'admin invitato (R-1.b)~~ → **incluso in R-2 inline** (template `kind='admin-invite'` IT/EN su `email-send`).
- ~~Sync con Live WORKS APP per registrare la licenza la'~~ → **R-2 DONE** (vedi sotto).

### Sprint R-2 (G2) — Lemon Squeezy webhook + email admin-invite (DONE 18/04/2026)

**Stato:** **completato e verde.** Quando un cliente compra Slide Center su Live WORKS APP (Lemon Squeezy storefront), viene creato automaticamente il tenant in Slide Center + spedita email di benvenuto con invite link al primo admin. Zero touch manuale del super-admin.

| Area           | Cosa                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration      | `supabase/migrations/20260418070000_lemon_squeezy_integration.sql` — 3 colonne nuove `tenants.lemon_squeezy_*` (subscription/customer/variant), tabella `lemon_squeezy_plan_mapping` (configurabile da super-admin), tabella `lemon_squeezy_event_log` (UNIQUE su event*id per idempotency), 3 RPC SECURITY DEFINER (`record*\_`, `mark\_\_\_processed`, `apply_subscription_event`). |
| Edge Function  | `supabase/functions/lemon-squeezy-webhook/index.ts` — HMAC SHA-256 verify (header `X-Signature`), dispatch su 9 event types, idempotency strict, chain a `email-send` con `kind='admin-invite'` quando crea nuovo tenant.                                                                                                                                                             |
| Email template | `supabase/functions/email-send/index.ts` — nuovo `EmailKind='admin-invite'` con subject + HTML inline IT/EN. Include CTA accept-invite, scadenza visibile, fallback URL plain text.                                                                                                                                                                                                   |
| Config         | `supabase/config.toml` — registrata `[functions.lemon-squeezy-webhook]` con `verify_jwt = false`.                                                                                                                                                                                                                                                                                     |
| Types          | `packages/shared/src/types/database.ts` — 2 tabelle, 3 colonne tenants, 3 RPC nuove allineate al DB schema.                                                                                                                                                                                                                                                                           |
| Env            | `.env.example` — aggiunto `LEMON_SQUEEZY_WEBHOOK_SECRET` (Edge secret).                                                                                                                                                                                                                                                                                                               |

**Quality gates verdi:** `pnpm typecheck` (5/5 OK), `pnpm --filter @slidecenter/web lint` (0 errors), `pnpm --filter @slidecenter/web build` (1.66s). Zero ReadLints issues sui file R-2.

**Eventi gestiti:** `subscription_created` (crea tenant + invito admin + email), `subscription_updated/payment_success/resumed` (update plan/quote), `subscription_cancelled/expired/paused` (suspend), `subscription_unpaused/payment_failed` (logged). Race condition `_updated` PRIMA `_created` → noop graceful.

**Setup manuale Andrea (~15 min, vedi `docs/STATO_E_TODO.md` §0.10.6):**

1. Genera `LEMON_SQUEEZY_WEBHOOK_SECRET` (random ≥32 char) → set come Supabase Edge secret.
2. Configura webhook su Lemon Squeezy Dashboard (URL + secret + abilita 9 events).
3. Popola `lemon_squeezy_plan_mapping` con i tuoi `variant_id` reali (one-time SQL su Studio).
4. Test E2E in sandbox Lemon Squeezy con carta `4242 4242 4242 4242`.

**Cosa NON e' incluso:**

- Sync inverso (cancellazione manuale tenant → cancella subscription Lemon Squeezy) → R-2.b deferred (raro, +0.5g).
- UI super-admin per editare `lemon_squeezy_plan_mapping` → R-2.c deferred (+0.5g).
- Auto-detect lingua cliente (Lemon Squeezy non espone `customer.locale` standard).

### Sprint R-3 (G3) — PC sala upload speaker check-in (DONE 18/04/2026)

**Stato:** **completato e verde.** Il relatore ultimo-minuto puo' caricare/sostituire file della propria sessione **direttamente dal PC sala**, senza intervento dell'admin in regia. UI drag&drop + button + progress reale (XHR.upload.onprogress). Auth via `device_token` (no JWT). Upload diretto a Storage via signed URL → bypass limite 6MB Edge Functions (file da 500MB+ funzionano).

| Area            | Cosa                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration enum  | `supabase/migrations/20260418080000_room_device_upload_enum.sql` — `ALTER TYPE upload_source ADD VALUE 'room_device'` + `ALTER TYPE actor_type ADD VALUE 'device'`. Migration separata per vincolo PostgreSQL (ADD VALUE non puo' coesistere con DDL che lo usa stessa transazione).                                                        |
| Migration RPC   | `supabase/migrations/20260418080100_room_device_upload_rpcs.sql` — 3 RPC SECURITY DEFINER (`init/finalize/abort_upload_version_for_room_device`) auth via hash token, validazione cross-room (PC sala A non carica per sala B), tenant suspended, evento closed, file size cap, storage quota. `GRANT EXECUTE` solo `service_role`.         |
| Edge Functions  | `supabase/functions/room-device-upload-{init,finalize,abort}/index.ts` — orchestrano la chain: `init` chiama RPC + genera signed upload URL Storage (validita 2h); `finalize` chiama RPC + broadcast Realtime `room_device_upload_completed` su `room:<id>`; `abort` cleanup orfani. Tutte con `verify_jwt = false` (auth e' device_token). |
| Client SDK      | `apps/web/src/features/devices/repository.ts` — `invokeRoomDeviceUpload{Init,Finalize,Abort}` wrappers fetch.                                                                                                                                                                                                                               |
| React hook      | `apps/web/src/features/devices/hooks/useRoomDeviceUpload.ts` — orchestratore stato + cancellazione + cleanup unmount. Stati: idle → preparing → uploading → hashing → finalizing → done/error/cancelled. SHA-256 in parallelo all'upload (lat percepita -30%).                                                                              |
| UI dropzone     | `apps/web/src/features/devices/components/RoomDeviceUploadDropzone.tsx` — drag&drop overlay + button + progress bar + toast IT/EN. Visibile solo se `room_state.current_session != null`.                                                                                                                                                   |
| UI integrazione | `apps/web/src/features/devices/RoomPlayerView.tsx` — inserisce dropzone sotto StorageUsagePanel. On success → `refreshNow()` → file appare in lista locale.                                                                                                                                                                                 |
| i18n            | 18 nuove chiavi `roomPlayer.upload.*` IT/EN parity (title, hint, button, 14 errori mappati).                                                                                                                                                                                                                                                |
| Types           | `packages/shared/src/types/database.ts` — `room_device` aggiunto a `upload_source`, `device` a `actor_type`, signature delle 3 nuove RPC.                                                                                                                                                                                                   |
| Activity feed   | RPC scrivono `actor='device'`, `actor_id=device_id`, `actor_name='PC sala N'` → admin vede subito "PC sala 1 — upload_finalize_room_device" senza decodificare UUID.                                                                                                                                                                        |
| Realtime gratis | Trigger esistente `broadcast_presentation_version_change` (Sprint B) intercetta INSERT/UPDATE su `presentation_versions` → emette `presentation_changed` su `room:<id>`. Quindi anche PC sala stesso (multi-PC) e LiveRegiaView (via `postgres_changes`) si aggiornano in <1s. **Zero codice realtime nuovo.**                              |

**Quality gates verdi:** `pnpm --filter @slidecenter/web typecheck` (0 err), `lint` (0 err), `build` (1.30s, RoomPlayerView 52.24 kB gzip 14 kB). Migration syntax check OK.

**Sicurezza:** invarianti su cross-room/cross-tenant/tenant-suspended/event-closed/file-size/storage-quota/SHA-256-format/object-existence — tutti enforced lato RPC. Hook UI gestisce cleanup orfani su cancel/error/unmount. RPC service_role-only (client web NON puo' chiamarle direttamente).

**Setup manuale Andrea (~5 min):**

1. `supabase db push` → applica le 2 nuove migration (enum + RPC).
2. `supabase functions deploy room-device-upload-init room-device-upload-finalize room-device-upload-abort`.
3. (Opzionale) Test con PC sala paired: vedere dropzone "Carica file in sessione".

**Cosa NON e' incluso:**

- Multi-file batch upload da PC sala → R-3.b deferred (95% relatori caricano 1 file, +0.5g).
- Selettore manuale di sessione (oggi sempre sulla `current_session`) → R-3.c deferred (+0.5g).
- Dialog conferma "stai sostituendo file dell'admin" → versioning DB gia' gestisce, UI futura (+0.5g).

### Sprint S-1 (G4) — Drag&drop folder admin OneDrive-style (DONE 18/04/2026)

**Stato:** **completato e verde.** L'admin puo' trascinare una **cartella intera** (con sotto-cartelle) sulla zona drop di una sessione → tutti i file vengono uploadati in coda mantenendo la struttura come prefisso del filename. UX "OneDrive-style" senza modifiche di schema DB.

| Area              | Cosa                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Utility           | `apps/web/src/features/presentations/lib/folder-traversal.ts` — `extractFilesFromDataTransfer` (drop) + `extractFilesFromInputDirectory` (file picker). Traversal ricorsivo BFS via `webkitGetAsEntry` + `FileSystemDirectoryEntry.createReader().readEntries()` in batch. Limiti hard 500 file / 10 livelli depth / 255 char filename. Dedup + skip vuoti. |
| UI dropzone       | `apps/web/src/features/presentations/components/SessionFilesPanel.tsx` — bottone "Sfoglia cartella" (icona `Folder`) + secondo input `<input webkitdirectory directory>` (cast Record<string,string> per types React 19). `onDrop` riscritto: chiama sempre `extractFilesFromDataTransfer`, branch su `containedFolders`.                                   |
| Feedback UX       | Box transient (5s) sotto dropzone: "{{count}} file aggiunti dalla cartella «{{folder}}»" + warning aggregati (vuoti/duplicati/nameTooLong/truncated). Caso empty: "La cartella «X» e' vuota o non contiene file validi".                                                                                                                                    |
| Filename strategy | Path relativo preservato come prefisso (`Conferenza-2026/Sala-1/intro.pptx`). Se path > 255 char, tronca segmenti iniziali con `.../` + nome+estensione finale. Se anche solo basename > 255, scarta il file e conta in `folderWarnNameLen`.                                                                                                                |
| Schema DB         | **Invariato.** RPC `init_upload_version_for_session` accettava gia' filename con "/". Sanitizzazione regex `[^A-Za-z0-9._-]` applicata solo a `storage_key`, `file_name` viaggia trasparente.                                                                                                                                                               |
| i18n              | 10 nuove chiavi `sessionFiles.*` IT/EN parity (1217/1217 totali).                                                                                                                                                                                                                                                                                           |

**Quality gates verdi:** `pnpm --filter @slidecenter/web typecheck` (0 err), `lint` (0 err), `build` (1.28s). i18n parity script PowerShell PASS.

**Sicurezza/Performance:**

- `MAX_FILES_PER_DROP=500` previene freeze da drop accidentale (es. "Documents/" intera).
- `MAX_TRAVERSAL_DEPTH=10` previene cycle infiniti (anche se browser non segue symlink).
- Sovereign rule #2 rispettata: file partono dal disco locale dell'admin, vanno a Storage via TUS, poi sync ai PC sala.
- Idempotenza: ogni file = 1 `version_id` distinto in coda (concurrency=1), no race possibile.

**Setup manuale Andrea:** **NESSUNO**. Modifica solo client-side, nessuna migration, nessun deploy Edge.

**Cosa NON e' incluso:**

- Tree-view preview pre-upload (anteprima struttura cartella prima di confermare) → S-1.b deferred (+0.5g).
- Filtro estensione file (oggi tutti i tipi vanno in coda) → S-1.c deferred (+0.2g, banale).

### Sprint S-2 (G5) — Drag&drop visivo PC ↔ sale (DONE 18/04/2026)

**Stato:** **completato e verde.** L'admin puo' assegnare i PC alle sale tramite **lavagna drag&drop** Kanban-style (colonna "Non assegnati" + N colonne sala). Toggle persistente "Lista | Lavagna" affianca la vista classica senza rimpiazzarla. HTML5 DnD nativo, aggiornamento ottimistico, realtime listener gia' attivo allinea altri admin in <1s.

| Area             | Cosa                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Componente       | `apps/web/src/features/devices/components/RoomAssignBoard.tsx` (nuovo) — grid responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, colonne con header (icona + nome + count), drop zone con ring/colore feedback, card device draggable con grip + Monitor + connectivity dot + Wifi/WifiOff. MIME custom `application/x-sc-device-id` per validare drop (ignora drop esterni). |
| Integrazione UI  | `DevicesPanel.tsx` — toggle a 2 tab "Lista                                                                                                                                                                                                                                                                                                                                         | Lavagna" (icone `List` e `LayoutGrid`) con persistenza `localStorage:sc:devices:viewMode`. Default `list` per retro-compatibilita.                                                                                                                                                |
| State management | Optimistic dictionary `optimisticRoom: Record<deviceId, roomId                                                                                                                                                                                                                                                                                                                     | null>`. Drop → UI aggiornata immediatamente → `updateDeviceRoom(deviceId, targetRoomId)`(esistente) →`onRefresh()`. Errore → rollback automatico + banner `errors.move_failed`(5s). Busy-state`Loader2`per device durante mutation,`pointer-events: none` per evitare doppi drop. |
| Schema DB        | **Invariato.** Mutation usa `updateDeviceRoom` (UPDATE su `paired_devices.room_id` + `updated_at`). RLS `tenant_isolation` permette gia' la mutazione all'admin del tenant.                                                                                                                                                                                                        |
| Realtime         | **Zero broadcast custom.** `usePairedDevices` ha gia' un listener `postgres_changes` su `paired_devices` filtered by `event_id`, quindi un drop su Browser A propaga automaticamente a Browser B in <1s.                                                                                                                                                                           |
| i18n             | 12 nuove chiavi `devices.panel.viewModeLabel/viewList/viewBoard` + `devices.board.*` IT/EN parity (1229/1229 totali).                                                                                                                                                                                                                                                              |
| Accessibilita    | Vista Lista (con dropdown nel kebab menu) resta invariata come fallback per touch/keyboard users. La lavagna e' mouse-only per scelta MVP.                                                                                                                                                                                                                                         |

**Quality gates verdi:** `pnpm --filter @slidecenter/web typecheck` (0 err), `lint` (0 err), `build` (2.0s, +negligible bundle in chunk EventDetailView). i18n parity script Node PASS.

**Sicurezza/Performance:**

- Mutation invariata: stessa RLS `tenant_isolation` → sicurezza identica al dropdown esistente.
- Sovereign rule #2 N/A: nessun file viaggia, solo metadata di allocazione.
- Bundle delta trascurabile: `RoomAssignBoard` e' lazy-loaded nel chunk `EventDetailView` (gia' splittato).

**Setup manuale Andrea:** **NESSUNO**. Modifica solo client; non servono migrations, env vars, deploy Edge Functions. L'admin trova il toggle "Lista | Lavagna" automaticamente al prossimo refresh dell'app.

**Cosa NON e' incluso:**

- Multi-select drag (shift+click + drag bundle) → S-2.b deferred (+0.5g, raro: i centri slide hanno 5-15 PC totali).
- Touch device support (tablet drag&drop): fallback intenzionale a vista Lista. Per supportare nativamente touch servirebbe `@dnd-kit/core` con touch backend (+1g + 1 dep).
- Animazioni transizione card (framer-motion) → S-2.c deferred (+0.3g, scelta MVP zero-deps).

### Sprint S-3 (G6) — Export ZIP fine evento ordinato sala/sessione (DONE 18/04/2026)

**Stato:** **completato e verde.** Lo ZIP fine evento (download admin da `EventExportPanel`) e' ora **nested per Sala/Sessione** con `info.txt` UTF-8 in root contenente metadata evento, sostituendo il vecchio formato piatto `slides/Speaker_vN_file.ext`. Andrea ha richiesto esplicitamente "in modo ordinato" → niente toggle UI, default unico.

| Area            | Cosa                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Refactor        | `apps/web/src/features/events/lib/event-export.ts` — `CurrentSlideExportRow` esteso con `roomId/roomName/sessionId`. `listCurrentReadySlidesForExport` ora richiede `rooms: RoomRow[]`. `buildEventSlidesZip` accetta `EventSlidesZipOptions` (event, rooms, sessions, t, locale, generatedAtIso, onProgress, includeReadme). 2 nuove pure-function: `buildSlidePathSegments`, `buildEventInfoReadme`. |
| UI integrazione | `apps/web/src/features/events/components/EventExportPanel.tsx` — passa `rooms` (gia' disponibile come prop) e i nuovi parametri al refactor. Nessun cambiamento UI visibile (Andrea ha chiesto "in modo ordinato" → semplifichiamo, no toggle).                                                                                                                                                        |
| Output ZIP      | `<evento>_slides.zip / Sala/Sessione/Speaker_vN_filename.ext` + `info.txt` (UTF-8 BOM) con header, metadata evento, conteggio file per sala, totale bytes, ora generazione, footer support. Slide orfane → `_senza-sala_/_senza-sessione_/...` (cartelle marker visibili).                                                                                                                             |
| Schema DB       | **Invariato.** Refactor pure-function client-side, zero migrations.                                                                                                                                                                                                                                                                                                                                    |
| i18n            | 14 nuove chiavi sotto `event.export.zip.*` (readmeTitle, readmeEvent, readmeDateRange, readmeStatus, readmeNetworkMode, readmeRoomsCount, readmeSessionsCount, readmeSlidesCount, readmeTotalBytes, readmeStructureHint, readmeBreakdownTitle, readmeNoRoom, readmeGeneratedAt, readmeFooter). Parity 1243/1243.                                                                                       |

**Quality gates verdi:** `pnpm --filter @slidecenter/web typecheck` (0 err), `lint` (0 err), `build` (1.3s, EventExportPanel 412KB → 412KB +1KB ininfluente). i18n parity script Node PASS.

**Sicurezza/Performance:**

- Path sanitization: `sanitizeExportSegment` (gia' esistente) applicato a roomName/sessionTitle/speakerName/fileName con regex stretta `[/\\?%*:|"<>]→_`.
- Storage URL signed via `createVersionDownloadUrlWithClient` (gia' esistente, scadenza 1h).
- Compression: `DEFLATE level 6` invariata.
- Memory: l'intero ZIP viene buildato in memoria browser (come prima) — limite pratico ~500MB su Chrome desktop. Per eventi piu' grandi serve streaming server-side (S-3.b deferred).

**Setup manuale Andrea:** **NESSUNO**. Refactor pure-function client-side. Niente migrations DB, niente env vars, niente deploy Edge Functions. Al primo nuovo export ZIP, Andrea trovera' lo ZIP nella nuova struttura.

**Cosa NON e' incluso:**

- Toggle UI "ordinato | piatto" → omesso (richiesta esplicita Andrea: "in modo ordinato").
- README localizzato per nomi cartella (sale/sessioni dal DB) → solo le label di `info.txt` sono i18n IT/EN (in base alla lingua dell'admin che esporta).
- Streaming server-side (Edge Function ZIP builder) per eventi >500MB → S-3.b deferred (+1g + 1 nuova Edge Function).

### Sprint S-4 (G7) — Ruolo device "Centro Slide" multi-room (DONE 18/04/2026)

**Stato:** **completato e verde.** Aggiunto ruolo `paired_devices.role` (`'room'` default | `'control_center'`). Un PC promosso a "Centro Slide" riceve i file di **TUTTE** le sale dell'evento (manifest multi-room dal `room-player-bootstrap`), filesystem locale `Sala/Sessione/file`, header dedicato con badge `CENTRO`, dropzone upload nascosto (read-only). Promote/demote da kebab in `DeviceList`; sezione fixed "Centri Slide" sopra la lavagna in `RoomAssignBoard` (non draggable).

| Area              | Cosa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DB migration      | `supabase/migrations/20260418090000_paired_devices_role.sql` — `paired_devices.role TEXT NOT NULL DEFAULT 'room' CHECK (role IN ('room','control_center'))` + indice `idx_devices_event_centers` + RPC `update_device_role(p_device_id, p_new_role) SECURITY INVOKER` (rispetta RLS tenant_isolation, super-admin escape, force `room_id=NULL` su promote, bumpa `updated_at` per realtime). Scelto `TEXT+CHECK` invece di `ENUM` per evitare problemi `ALTER TYPE ADD VALUE` in transazione (vedi R-3). |
| Edge Function     | `supabase/functions/room-player-bootstrap/index.ts` — branch `deviceRole === 'control_center'`: query `presentations` su **tutte** le sale dell'evento, `FileRow` arricchito con `roomId/roomName`, sort multi-room (`roomName → sessionScheduledStart → filename`), payload include `control_center: true` + `rooms[]`. Skip `playback_mode` update per centri.                                                                                                                                          |
| Hook              | `apps/web/src/features/devices/hooks/useFileSync.ts` — `FileSyncItem` con `roomId/roomName`. `downloadVersion` e `cleanupOrphanFiles` usano `item.roomName` come **primo segmento** del path locale. Nuovo flag `disableRealtime` (centri = polling-only, no per-room subscription, sufficiente per use-case backup).                                                                                                                                                                                    |
| Repository        | `apps/web/src/features/devices/repository.ts` — `RoomPlayerBootstrapResponse` esteso (`device.role?`, `control_center?`, `rooms?`). Nuova `updateDeviceRole(deviceId, newRole)` wrapper RPC.                                                                                                                                                                                                                                                                                                            |
| UI RoomPlayerView | `apps/web/src/features/devices/RoomPlayerView.tsx` — branch dedicato per centri: title=event-name, badge `CENTRO`, sub `roomsCount` plural, icona `Building2`. `RealtimeChip` nascosto. `RoomDeviceUploadDropzone` nascosto (read-only).                                                                                                                                                                                                                                                                |
| UI DeviceList     | `apps/web/src/features/devices/components/DeviceList.tsx` — kebab "Promuovi a Centro Slide" / "Riporta a sala normale" con `window.confirm`. Card differenziata: bg `sc-primary/15`, icona `Building2`, badge "CENTRO" inline, hint "Centro Slide · sincronizza tutte le sale dell'evento". Sezione "Assegna sala" nascosta per centri.                                                                                                                                                                  |
| UI RoomAssignBoard| `apps/web/src/features/devices/components/RoomAssignBoard.tsx` — split `regularDevices` (board drag&drop) vs `centerDevices` (sezione fixed in cima, non draggable). Card centro con icona + status realtime + hint "assegnato a tutte le sale". Empty state distingue "no device" vs "solo centri pairati".                                                                                                                                                                                            |
| i18n              | 18 nuove chiavi: `devices.list.{promoteToCenter,promoteToCenterConfirm,demoteToRoom,demoteToRoomConfirm,roleBadgeCenter,centerHint,roleChangeError}` + `devices.board.{centersTitle,centersLabel,centersHint,centerCardTitle,allCentersHint}` + `roomPlayer.center.{headerTitle,headerSubtitleFallback,badge,roomsCount_one,roomsCount_other}`. Parita perfetta IT/EN 1260/1260.                                                                                                                       |

**Quality gates verdi:** `pnpm --filter @slidecenter/shared build` (rigenera `dist/types/database.d.ts`), `shared typecheck` (0 err), `web typecheck` (0 err), `web lint` (0 warning), `web build` (13.79s, 99 entries PWA). i18n parity Node script PASS.

**Sicurezza/Performance:**

- RPC `SECURITY INVOKER` rispetta RLS `tenant_isolation_paired_devices` (no privilege escalation).
- Cross-tenant explicit reject con `ERRCODE=42501`.
- Super-admin escape hatch (per troubleshooting da `/admin/tenants`).
- Backward compat 100%: tutti i device esistenti hanno `role='room'` di default, branch `else` originale invariato.
- Centri = no Realtime per-room subscription (evita saturazione quota Supabase Realtime). Polling 30s del bootstrap sufficiente per backup use-case.
- Centri = read-only (no upload dropzone): un centro non sa "in che sala" sta ora il relatore, abilitare upload creerebbe ambiguita su `presentations.room_id`.

**Setup manuale Andrea (~5 minuti):**

1. `pnpm supabase db push --include-all` — applica migration `20260418090000_paired_devices_role.sql`.
2. `pnpm supabase functions deploy room-player-bootstrap` — re-deploy Edge Function.
3. `pnpm gen:db-types` — rigenera tipi DB per CI types-drift check (verifica che `database.generated.ts` non abbia diff vs `database.ts`).
4. Test smoke: pair 1 PC, kebab → "Promuovi a Centro Slide" → verifica appare in sezione "Centri Slide" sopra la lavagna + badge "CENTRO" su `RoomPlayerView` + filesystem locale `Sala/Sessione/file`.

**Cosa NON e' incluso (deferred):**

- CenterPlayerView con tree-view "Sala → Sessione → File" → S-4.b deferred (oggi usa stesso layout di RoomPlayerView).
- Sort custom dei file in centri → S-4.c deferred (oggi hardcoded `roomName ASC → sessionScheduledStart ASC → filename ASC`).
- Metric "X file mancano vs admin" (QA pre-evento) → S-4.d deferred (oggi mostra solo file presenti su Storage).
- Centri con Realtime per-room subscription → riconsiderare se Andrea pairera' >5 Centri simultaneamente.

### Sprint T-1 (G8) — Badge versione "in onda" + toast cambio versione (DONE 18/04/2026)

**Stato:** **completato e verde.** Versione "in onda" ora visibile **a colpo d'occhio** in sala. Badge `vN/M` con color coding sovrano: verde se la corrente e' anche la piu' recente, giallo se l'admin ha riportato indietro la corrente (esiste una versione piu' nuova). Badge `inline` sempre visibile accanto al filename in `FileSyncStatus`; badge `overlay` top-right durante l'anteprima fullscreen di `FilePreviewDialog` (auto-fade 5s, ricompare on mouse/touch/key — UX standard player video). Toast notify automatico su cambio versione.

| Area              | Cosa                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge Function     | `supabase/functions/room-player-bootstrap/index.ts` — aggiunto `version_number` al SELECT su `presentation_versions`; nuova query aggregata `MAX(version_number)` per ogni `presentation_id` filtrato `status IN ('ready','superseded')`; `FileRow` esteso con `versionNumber: number \| null` + `versionTotal: number \| null`. Indice `idx_pv_presentation_id` esistente sufficiente, no nuovi indici.                                                  |
| Repository client | `apps/web/src/features/devices/repository.ts` — `RoomPlayerBootstrapFileRow` esteso con `versionNumber` + `versionTotal` (entrambi nullable per BC).                                                                                                                                                                                                                                                                                                       |
| Hook              | `apps/web/src/features/devices/hooks/useFileSync.ts` — `FileSyncItem` esteso, `rowToItem` propaga (fallback `?? null`).                                                                                                                                                                                                                                                                                                                                    |
| Component nuovo   | `apps/web/src/features/devices/components/VersionBadge.tsx` — riusabile, due varianti: `inline` (chip text-[10px]) / `overlay` (badge text-sm con shadow + backdrop-blur, opacity 0/100 con transition 500ms). Color coding: verde `sc-success` (latest) / giallo `sc-warning` (older) / neutro `sc-primary` (single). Pattern derived-state-from-props con setter durante render body (evita `setState` in `useEffect` — regola React 19 lint stretta).      |
| UI lista          | `apps/web/src/features/devices/components/FileSyncStatus.tsx` — `<VersionBadge variant="inline">` accanto al filename in `FileRow`.                                                                                                                                                                                                                                                                                                                        |
| UI preview        | `apps/web/src/features/presentations/components/FilePreviewDialog.tsx` — nuovo prop `versionInfo?: { number, total }` opzionale; `<VersionBadge variant="overlay">` `absolute right-6 top-6 z-10` nel body; `wakeKey` state incrementato su `onMouseMove`/`onTouchStart`/`onKeydown` per "wake-up" del badge.                                                                                                                                                |
| UI toast          | `apps/web/src/features/devices/RoomPlayerView.tsx` — `useEffect` su `items` traccia `presentationId → ultimo versionNumber visto` (ref Map). Se cambia: vn > prev → toast `info` "Nuova versione caricata: v{n}" (8s); vn < prev → toast `warning` "Versione riportata a v{n} (esiste anche v{total})" (10s). Skip primo render con `prev === null` per evitare spam in apertura sala.                                                                       |
| i18n              | 10 nuove chiavi: `roomPlayer.versionBadge.{label,single,tooltipLatest,tooltipOlder,tooltipSingle,aria}` + `roomPlayer.versionToast.{newer.title,newer.body,rollback.title,rollback.body}`. Parita perfetta IT/EN 1270/1270.                                                                                                                                                                                                                                |

**Quality gates verdi:** `pnpm --filter @slidecenter/shared build` (rigenera tipi), `shared typecheck` (0 err), `web typecheck` (0 err), `web lint` (0 err — 1 fix iter: refactor `VersionBadge` per pattern derived-state, evita `react-hooks/set-state-in-effect`), `web build` (1.58s, PWA 99 entries 3312 KiB, RoomPlayerView 54.58 kB gzip 14.56 kB). i18n parity Node script PASS 1270/1270.

**Sicurezza/Performance:**

- Backward-compat 100%: bootstrap pre-T-1 omette i campi → `?? null` nel `rowToItem` → badge non rende → no crash.
- No nuove RLS / no nuove RPC. La nuova query `presentation_versions(presentation_id IN (...))` usa indice esistente `idx_pv_presentation_id`. Cost overhead trascurabile (<1ms su event con 50 presentazioni).
- Sovrano #2 rispettato: `versionInfo` e' SOLO metadata visualizzato; il file resta sul disco locale del PC sala. Nessun fetch cloud durante l'anteprima.
- Sovrano #3 chiuso definitivamente: versione "in onda" sempre visibile a colpo d'occhio.

**Setup manuale Andrea (~2 minuti):**

1. `pnpm supabase functions deploy room-player-bootstrap` — re-deploy Edge Function (obbligatorio: senza, i client ricevono `versionNumber=null` e il badge non appare).
2. Frontend deploy automatico via Vercel push.
3. Test smoke: pair PC sala, carica v1 di un file, verifica badge "v1" neutro inline. Carica v2, verifica badge **VERDE "v2 / 2"** + toast info "Nuova versione caricata: v2". Da admin riporta current a v1, verifica badge **GIALLO "v1 / 2"** + toast warning. Apri preview fullscreen, verifica badge overlay top-right con auto-fade 5s.

**Cosa NON e' incluso (deferred):**

- Refresh automatico del preview quando arriva nuova versione mentre l'utente sta gia' guardando → T-1.b deferred (oggi: badge cambia colore ma blob locale resta in v_old finche' non si chiude e riapre il preview).
- Badge `vN/M` su `LiveRegiaView` admin → T-1.c deferred (l'admin gia' vede `version_number` esplicito in `PresentationVersionsPanel`, "nice-to-have" non bloccante).
- Animazione transizione colore badge (verde→giallo) con framer-motion → T-1.d deferred.
- Timestamp + autore della versione corrente nel badge overlay → T-1.e deferred.

### Sprint T-2 (G9) — Telemetria perf live PC sala (DONE 18/04/2026)

**Stato:** **completato e verde.** L'admin in centro slide ora vede **a colpo d'occhio** se ognuno dei suoi PC sala (5 / 12 / 30 device per evento) sta soffrendo (heap quasi pieno, storage browser saturato, FPS in caduta libera, batteria scarica) **prima** che il pubblico veda lag/freeze/blackout.

| Area              | Cosa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration         | `supabase/migrations/20260418100000_device_metric_pings.sql` (300+ linee). Tabella append-only `public.device_metric_pings` (BIGSERIAL PK, FK `tenant/device/event/room` con `ON DELETE CASCADE/SET NULL`, `source CHECK ('browser'\|'desktop')`, browser metrics `js_heap_used_pct/mb`, `storage_quota_used_pct/mb`, `fps`, `network_type`, `network_downlink_mbps`, `battery_pct/charging`, `visibility`. Desktop metrics nullable `cpu_pct`, `ram_used_pct/mb`, `disk_free_pct/gb`. Common `app_uptime_sec`, `playback_mode`, `device_role`. CHECK ranges anti-spoof). Indici hot-path: `(device_id,ts DESC)`, `(event_id,ts DESC)`, `(ts)`. |
| RLS               | SELECT consentita solo per `is_super_admin()` o `(tenant_id=app_tenant_id() AND role IN ('admin','tech'))`. INSERT/UPDATE/DELETE bloccati a tutti — solo via SECURITY DEFINER.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| RPC ingest        | `record_device_metric_ping(p_device_id, p_payload) SECURITY DEFINER` — chiamata dall'Edge Function con service_role. Lookup `paired_devices`, **rate-limit soft 3s** (no-op se ultimo ping <3s), INSERT con NULLIF safe-cast su tutti i campi, exception handler best-effort (ritorna `{ok:false, error}`).                                                                                                                                                                                                                                                                                                                                   |
| RPC fetch         | `fetch_device_metrics_for_event(p_event_id, p_window_min, p_max_pings_per_device) SECURITY DEFINER STABLE` — per ogni device ritorna `{device, latest, pings[]}`. Auth `app_tenant_id() = events.tenant_id` + ruolo admin/tech. Clamp parametri (windowMin 1..60, maxPings 1..200) anti-DoS.                                                                                                                                                                                                                                                                                                                                                   |
| RPC cleanup       | `cleanup_device_metric_pings() SECURITY DEFINER` — retention 24h via pg_cron `0 3 * * *` daily 03:00 UTC. Idempotente (`DO $$` block che salta lo schedule se `pg_cron` non installato; non blocca il deploy).                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Edge Function     | `supabase/functions/room-player-bootstrap/index.ts` — accetta nuovo body `metrics?: object` opzionale. Validato (object non array). Se presente, dopo `last_seen_at` chiama `record_device_metric_ping(device.id, enrichedPayload)` con `playback_mode` + `device_role` iniettati lato server (anti-spoofing). Best-effort fire-and-forget try/catch.                                                                                                                                                                                                                                                                                          |
| Tipi shared       | `packages/shared/src/types/database.ts` — aggiunta tabella `device_metric_pings` con `Insert: never; Update: never;` (safety) + 3 RPC types.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Repository client | `apps/web/src/features/devices/repository.ts` — `invokeRoomPlayerBootstrap(token, includeVersions, playbackMode, metrics?)` con nuovo parametro. 4 nuovi tipi (`DeviceMetricPingPayload`, `DeviceMetricPing`, `DeviceMetricsLatest`, `DeviceMetricsRow`). Nuova `fetchDeviceMetricsForEvent(eventId, {windowMin, maxPingsPerDevice})`.                                                                                                                                                                                                                                                                                                         |
| Hook collector    | `apps/web/src/features/devices/hooks/useDevicePerformanceCollector.ts` — FPS via `requestAnimationFrame` EMA 5s con auto-pause su `visibilitychange='hidden'` (max 240fps clamp), heap via `performance.memory` (Chrome only, fallback null Safari/Firefox), storage via `navigator.storage.estimate()`, network via `navigator.connection.{type,downlink}`, battery via `navigator.getBattery()` con cache + listener `levelchange/chargingchange`, visibility via `document.visibilityState`, uptime via `Date.now() - performance.timeOrigin`, source `'browser'`/`'desktop'` se Tauri. Espone `collectMetrics(): Promise<...>` zero-throw. |
| Integrazione PWA  | `apps/web/src/features/devices/RoomPlayerView.tsx` — chiama `collectMetrics()` prima di ogni invocazione del polling bootstrap, passa il payload come 4° arg.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Hook admin        | `apps/web/src/features/devices/hooks/useDeviceMetrics.ts` — polling default 8s. Pausa quando `document.visibilityState='hidden'`. Refresh immediato al rientro visibility. Anti-race con `reqIdRef` counter (ignora risposta se l'eventId e' cambiato). Mantiene ultimo dato valido on error, espone `error` separato.                                                                                                                                                                                                                                                                                                                         |
| Component         | `apps/web/src/features/devices/components/Sparkline.tsx` — SVG inline puro, zero dependencies (~200 byte di markup totali per metrica). Path D continuo, marker current value, colorazione automatica verde/giallo/rosso a soglia. Supporta `inverted` (FPS, disk_free, battery dove "pochi=male").                                                                                                                                                                                                                                                                                                                                            |
| Widget admin      | `apps/web/src/features/devices/components/LivePerfTelemetryPanel.tsx` (470 linee). Card per device con header health-dot + nome + badge `CENTRO` per control_center + status (offline/network/source) + battery badge. Grid metriche heap/storage/FPS sempre visibili, CPU/RAM SOLO se `source='desktop'`. Sparkline 30 min sotto ogni numero big colorato. Footer compact uptime + playback mode + downlink Mbps. Pannello collassabile (default chiuso, summary header `X sani \| Y attenzione \| Z critici \| W ignoti` sempre visibile, persistito `localStorage:sc:liveperftelemetry:open`). Auto-hidden quando 0 device pairati.          |
| Toast alert       | Debounced 30s. Stato critical/warning persiste >=30s → toast `error`/`warning` 1× con titolo+descr i18n. Stato `recovered` (critical→healthy dopo notify) → toast `success`. Tracciato per device con `useRef<Map<deviceId, {health, sinceTs, notified}>>`.                                                                                                                                                                                                                                                                                                                                                                                   |
| Soglie sovrane    | Configurate inline nel componente (facili da tunare in field): heap >=85 warning / >=95 critical, storage >=90/95, FPS <30/15 (inverted), CPU >=85/95 (solo desktop), RAM >=90/95 (solo desktop), disk_free <=10/5 (inverted, solo desktop), battery <=20/10 (inverted, solo se `!charging`).                                                                                                                                                                                                                                                                                                                                                  |
| Integrazione UI   | `apps/web/src/features/events/EventDetailView.tsx` — integrato sotto `<DevicesPanel />` nella sezione "Devices" dell'evento.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| i18n              | 51 nuove chiavi sotto `deviceTelemetry.*` in `it.json` + `en.json` (parita perfetta 1312/1312).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Decisioni architetturali sovrane:**

1. **Piggyback su `room-player-bootstrap` invece di endpoint dedicato** — zero round-trip extra. Il PC sala gia' polla ogni 5/12/60s. Endpoint separato significherebbe doppio request rate × N device.
2. **Polling 8s admin invece di Realtime postgres_changes** — il volume INSERT su `device_metric_pings` saturerebbe il channel (1 INSERT ogni 5-12s × 30 device = 6 INSERT/s = 21.600/h). Realtime instabile sopra ~5 INSERT/s sostenuti. L'admin guarda trend di 30 min, non tick singoli — 8s di polling e' UX live indistinguibile + costo Supabase 100× minore.
3. **RLS chiusa su INSERT con SECURITY DEFINER RPC** — il PC sala NON ha sessione utente Supabase (auth via `device_token`). Service_role-via-Edge e' la soluzione standard.
4. **Rate-limit 3s lato server** — anti-flood. Se il PC sala bugga e chiama bootstrap a 1Hz invece di 5/12/60s, evitiamo di esplodere `device_metric_pings`. 3s e' inferiore a tutti i tick standard quindi 100% dei ping legittimi passa.
5. **Retention 24h** — l'admin guarda telemetria DURANTE l'evento (a sera) o subito dopo (review post-mortem). Oltre 24h e' rumore. Cleanup giornaliero pg_cron mantiene la tabella sotto i 100 MB anche con 5 eventi paralleli.
6. **Soglie inline nel componente** — Andrea le ricalibra dopo i primi 2-3 eventi reali. Quando saranno stabili, le sposteremo in `tenant_settings`.
7. **Niente CPU/RAM reali in fase 1** — il PC sala oggi e' una **PWA** in browser. Il browser e' sandboxed: NON puo' vedere `% CPU` o `% RAM` reale del SO. Quello che mostriamo (heap JS, storage quota) e' la "salute" del browser/applicazione, non del PC. Per CPU/RAM reali serve il client desktop Tauri con `sysinfo` Rust crate (fase 2 di T-2, schedulata insieme a Sprint Q hybrid sync). Lo schema DB e' gia' pronto (`cpu_pct`, `ram_used_pct`, `disk_free_pct` nullable + UI condizionata su `source='desktop'`).
8. **Toast debounce 30s** — spam-prevention. Senza debounce, ogni refresh (8s) farebbe 1 toast. 30s e' il "tempo che ci mette un PC sala lento a essere notato dal pubblico" — sotto quel valore di solito si tratta di spike transitorio.
9. **Pannello collassato di default** — il summary header e' gia' informativo. L'admin lo apre solo quando vede badge giallo/rosso o per audit pre-evento. Risparmia 600+ pixel di scroll quando tutto e' OK.

**Quality gates verdi:** `pnpm --filter @slidecenter/shared build` (rigenera tipi DB), `web typecheck` (0 err — 6 fix iter: TFunction da i18next, lucide-icon `title` rimosso, `useToast()` API corretta, `getBatteryMetrics` rimosso unused), `web lint` (0 err — 1 fix iter `prefer-const` su `let timer`), `web build` (PWA generata, 101 entries precache). i18n parity Node script PASS 1312/1312. ReadLints 10 file modificati: 0 errori.

**Sicurezza/Performance:**

- **Backward-compat 100%:** bootstrap pre-T-2 omette `metrics` → branch `if (incomingMetrics)` non eseguito → no insert. Client pre-T-2 non riceve campi nuovi sull'output (zero modifiche payload risposta bootstrap).
- **Sovrano #2 rispettato:** la telemetria e' SOLO metadata sulla salute del PC. Zero impatto sui file in playback (collector e' fire-and-forget, polling esistente).
- **Costo Supabase:** stima 30 device × 12s polling × 24h evento = 216.000 INSERT/giorno = ~6.5MB di tabella/giorno. Cleanup 24h mantiene la dimensione costante. Zero impatto pricing free tier.
- **Privacy:** zero PII raccolto. Solo numeri tecnici (heap/CPU/FPS/etc). Battery level NON identificativo.

**Setup manuale Andrea (~3 minuti):**

1. `pnpm supabase db push` — applica migration `20260418100000_device_metric_pings.sql` (oppure GitHub Actions auto-deploy).
2. `pnpm supabase functions deploy room-player-bootstrap` — re-deploy Edge Function (obbligatorio: senza, le metriche client vengono inviate ma scartate).
3. **pg_cron extension:** se non gia' attiva, abilitarla da Supabase Dashboard → Database → Extensions. Senza pg_cron il cleanup retention non parte (la tabella cresce indefinitamente). Fallback manuale: chiamare `cleanup_device_metric_pings()` via cron Vercel.
4. Frontend deploy automatico via Vercel push.
5. Test smoke: pair PC sala, apri admin → tab evento → verifica pannello "Telemetria perf live PC sala" con summary "1 sano". Forza heap alto (apri console: `for(let i=0;i<10;i++) window.__leak = (window.__leak||[]).concat(new Array(1e7))`) → entro 30s toast warning + badge giallo. Pulisci: `delete window.__leak; window.gc?.()` → toast success "recovered".

**Cosa NON e' incluso (deferred):**

- **T-2.b** collector desktop Tauri Rust (`sysinfo` crate) → CPU/RAM/disk reali per PC sala intranet. Schedulare insieme a Sprint Q hybrid sync.
- **T-2.c** salvare le soglie in `tenant_settings` (oggi inline). Aspettiamo 2-3 eventi reali per validare i valori.
- **T-2.d** storico esportabile telemetria (CSV/PDF) per post-mortem evento. Oggi retention 24h e' write-only.
- **T-2.e** alert via webhook esterno (Slack / Discord / email) per critici notturni. Oggi solo toast in UI admin (richiede admin presente al PC).
- **T-2.f** confronto cross-evento ("PC Sala 2 evento Acme vs evento Beta — heap medio +30%"). Richiede aggregazione storica → out-of-scope T-2 MVP.

### Hardening Supabase + Vercel (Sprint Q+1) — DONE 18/04/2026

**Stato:** **completato e verde.** Eseguito PRIMA degli sprint R/S/T per garantire backend production-ready.

| Area            | Cosa                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase DB     | 7 indici hot-path (`20260418040000_perf_hot_path_indexes.sql`) + revoke `anon` write least-privilege (`20260418050000_security_least_privilege.sql`)  |
| Supabase Client | PKCE flow + `storageKey` namespace + `x-application-name` header + Realtime rate limit (`apps/web/src/lib/supabase.ts`)                               |
| Vercel headers  | HSTS 2 anni preload, CSP completa Supabase+Sentry+Vercel Analytics, X-Frame-Options DENY, COOP/CORP same-origin, Permissions-Policy super-restrittiva |
| Vercel cache    | Assets immutable 1 anno, immagini 30 giorni, redirect SEO, cleanUrls                                                                                  |
| PWA cache       | NIENTE cache su `/auth/v1/*` e `/realtime/v1/*`; signed URL TTL ridotto a 60s                                                                         |
| CI/CD           | `db-types-drift.yml` (anti-regressione schema vs codice) + `deploy-supabase.yml` (auto-deploy Edge Functions, opt-in migrations)                      |
| DX              | 7 nuovi script: `pnpm db:types`, `db:types:local`, `db:diff`, `db:lint`, `db:push`, `fn:deploy`, `vercel:env:pull`, `vercel:deploy:prod`              |
| Documentazione  | `.env.example` riscritto con sezioni chiare (frontend/CLI/Edge secrets/Vercel)                                                                        |

**Quality gates verdi:** `pnpm typecheck` + `pnpm lint` + `pnpm --filter @slidecenter/web build` tutti OK.

**Cosa resta a Andrea (manuale, ~30 min):** vedi `docs/STATO_E_TODO.md` § 0.8.4 (apply migrations, set Edge secrets, set Vercel env vars, set GitHub Actions secrets).

### Tre modalita di esecuzione del prodotto (vedi ARCHITETTURA § 3)

Ogni feature deve funzionare in tutte e tre le modalita o dichiarare esplicitamente la sua compatibilita:

| Modalita         | Backend                                    | Sync sala       | Quando si vende                                            |
| ---------------- | ------------------------------------------ | --------------- | ---------------------------------------------------------- |
| Cloud SaaS       | Supabase (PG + Auth + Storage + Realtime)  | Realtime PG     | Eventi multi-sede, accesso da remoto, cross-tenant         |
| Desktop intranet | Rust Axum locale + SQLite + mDNS           | LAN push + poll | Eventi single-site senza Internet (fiere, navi, congressi) |
| Hybrid (post-Q)  | Desktop master + Supabase backup push-only | LAN + cloud 60s | Aziende che vogliono backup cloud + multi-sede             |

## Vincoli sovrani (NON negoziabili)

1. **Stabilita live > tutto.** Mai compromettere un evento in produzione per una feature nuova.
2. **Tenant isolation** — RLS sempre attivo. Vedi `01-data-isolation.mdc`.
3. **File partono sempre da locale.** Il PC sala legge dal proprio disco; cloud/LAN solo per sync. **Enforcement programmatico:** wrapper PC sala devono passare `enforceLocalOnly: true` a `useFilePreviewSource` (rifiuta `mode: 'remote'` con `sovereignViolation`). Vedi `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 11 per la matrice di enforcement completa.
4. **UI identica fra cloud e desktop.** Stessa codebase `apps/web/src/**`.
5. **Persistenza assoluta sala.** Riavvio non perde stato. Solo utente o admin disconnettono.
6. **i18n completezza:** ogni stringa IT visibile in UI ha coppia EN nello stesso commit.
7. **Dark mode only** — token Tailwind `sc-*`. MAI `zinc-*` o `blue-600` diretti.
8. **`apps/player/` NON deve esistere** — Room Player = route `/sala/:token` in `apps/web/`.
9. **`presentation_versions` append-only** — nuove versioni = nuove righe (mai UPDATE).
10. **MAI mDNS dal browser** — solo da Rust via Tauri command.
11. **MAI Supabase JS client diretto in modalita desktop** — sempre via `lib/backend-client.ts`.
12. **MAI contenuto file clienti visibile a super_admin** (GDPR — solo metadati).

## Brand & favicon

- **Sorgente:** `icons/Logo Live Slide Center.jpg` (file unico in git).
- **Pipeline:** `apps/web/scripts/generate-brand-icons.mjs` (devDependency `sharp`) eseguita da `prebuild`/`predev` su `@slidecenter/web`.
- **Output:** `apps/web/public/` (favicon-16x16, favicon-32x32, apple-touch-icon, pwa-192x192, pwa-512x512, logo-live-slide-center.jpg).
- **In React:** sempre `AppBrandLogo` da `src/components/AppBrandLogo.tsx` + `t('app.displayName')`. Mai duplicare `<img>`.

## Documentazione (mappa rapida)

| Documento                                | Quando consultarlo                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` | **FONTE UNICA DI VERITA**: cos'e' / com'e' fatto (~90 KB, 24 sez.)                     |
| `docs/STATO_E_TODO.md`                   | **FONTE UNICA TO-DO**: cosa rimane da fare, field test, Sprint Q                       |
| `docs/Setup_Strumenti_e_MCP.md`          | Setup IDE, MCP servers, Cursor + mappa documentazione completa                         |
| `docs/Istruzioni_Claude_Desktop.md`      | Prompt + workflow per AI assistant (Claude Desktop / Cursor)                           |
| `docs/Manuali/`                          | 7 manuali operativi (admin, installer, distribuzione, code-signing, email, screencast) |
| `docs/Commerciale/`                      | Materiali vendita (Listino, SLA, Roadmap_Vendita_Esterna, README)                      |

In conflitto vince sempre **`ARCHITETTURA_LIVE_SLIDE_CENTER.md`**. Per dettagli su sprint specifici → `.cursor/rules/field-test-fase15.mdc`.

## Ecosistema Live Software (cross-project)

Live SLIDE CENTER e' parte di un ecosistema piu' ampio (10 app + 1 sito) — gestito da CTO Andrea Rizzari. App correlate:

- **Live PLAN + Live CREW** (Firebase Blaze, GitHub `live-software11`) — gestione produzioni live multi-tenant.
- **Live WORKS APP** (Firebase Blaze) — piattaforma licenze + checkout Lemon Squeezy. **SLIDE CENTER e' integrato qui** per validare licenze (Edge Fn `licensing-sync`).
- **Preventivi DHS + Gestionale FREELANCE** (Firebase Spark, account separato `Andraven11`).
- Desktop nativi: Live 3d Ledwall Render (Tauri+Three.js), Live Speaker Timer (Tauri+Axum), Live Speaker Teleprompter (.NET WPF), Live Video Composer (Python).
- Sito marketing: `www.liveworksapp.com` (Vite + Tailwind + Aruba).

**REGOLA:** quando lavori in questo workspace (`Live SLIDE CENTER/`), usa solo account `live-software11` + Supabase project `cdjxxxkrhgdkcpkkozdl`. Cross-project sync NON applicabile (Slide Center e' single project Supabase).

## Mentalita

Ogni modifica deve essere trattata come se andasse in produzione domani mattina su un evento live di un cliente pagante. Se una soluzione e' veloce ma instabile, scartala. Meglio un intervento piccolo verificato che un salto grande non controllato.

Per dettagli operativi specifici → leggi la rule pertinente (`.cursor/rules/`) o il documento in `docs/`. Le rules `alwaysApply` coprono il 90% del lavoro quotidiano.
