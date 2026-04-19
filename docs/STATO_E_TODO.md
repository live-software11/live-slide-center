# STATO E TO-DO LIVE SLIDE CENTER

> **Documento operativo gemello di `ARCHITETTURA_LIVE_SLIDE_CENTER.md`.**
> Qui sta SOLO cosa rimane da fare. Per "cosa fa il prodotto" e "come è fatto" → architettura.
>
> **Versione:** 3.2 (2026-04-19 sera tardi) — aggiunta riga Sprint X-2 (hotfix field-test: TUS abort 403 + slide-validator 401 ES256 + invalidazione cache PWA). Storia sprint 0.1→0.29 archiviata in `_archive/STATO_E_TODO_storia_sprint_0.1-0.29.md` e consolidata in `ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22.
> **Owner:** Andrea Rizzari
> **Stato globale:** **SEMAFORO VERDE** per produzione. Cloud + Desktop in parity 100% (Sprint W chiuso 19/04/2026). Sentry attivo per error monitoring (configurato 19/04/2026). Workspace ottimizzato (cleanup 11.83 GB → 96% riduzione, 19/04/2026). Upload hardening Sprint X-1 + X-2 chiusi 19/04/2026 (desktop + cloud + smoke test secrets + TUS terminal-state hardening + edge-function ES256 fix).

---

## INDICE

1. [Stato attuale](#1-stato-attuale)
2. [Cose da fare ORA (azioni esterne Andrea, NON automatizzabili)](#2-cose-da-fare-ora-azioni-esterne-andrea-non-automatizzabili)
3. [Field test desktop (quando vorrai farlo)](#3-field-test-desktop-quando-vorrai-farlo)
4. [Sprint Q — Sync hybrid cloud↔desktop (opzionale, ready-to-code)](#4-sprint-q--sync-hybrid-clouddesktop-opzionale-ready-to-code)
5. [Backlog post-vendita (sales + legale + marketing)](#5-backlog-post-vendita-sales--legale--marketing)
6. [Backlog post-MVP (idee future, NON urgenti)](#6-backlog-post-mvp-idee-future-non-urgenti)
7. [Comandi rapidi (cheat-sheet quotidiano)](#7-comandi-rapidi-cheat-sheet-quotidiano)

---

## 1. Stato attuale

| Macro-area                                                                                          | Stato  | Riferimento architettura                                       |
| --------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| Cloud SaaS (`apps/web`)                                                                             | DONE   | ARCHITETTURA § 13                                              |
| Desktop offline (`apps/desktop` Tauri 2)                                                            | DONE   | ARCHITETTURA § 14                                              |
| Local + Room Agent storici (`apps/agent`, `apps/room-agent`)                                        | LEGACY | ARCHITETTURA § 15 + `Manuali/Manuale_Installazione_*_Agent.md` |
| Multi-tenancy + RLS + RBAC + GDPR                                                                   | DONE   | ARCHITETTURA § 6                                               |
| Pairing PC sala (cloud + LAN)                                                                       | DONE   | ARCHITETTURA § 9                                               |
| Sistema licenze Live WORKS APP                                                                      | DONE   | ARCHITETTURA § 12                                              |
| i18n IT/EN parity (~1416 chiavi)                                                                    | DONE   | ARCHITETTURA § 18                                              |
| Quality gates + CI (web + agent + Playwright)                                                       | DONE   | ARCHITETTURA § 19                                              |
| Email transazionali Resend (4 template)                                                             | DONE   | ARCHITETTURA § 17                                              |
| GDPR export ZIP + status page pubblica                                                              | DONE   | ARCHITETTURA § 17                                              |
| Audit log tenant + welcome email                                                                    | DONE   | ARCHITETTURA § 17                                              |
| Code-signing CI ready (env-driven)                                                                  | DONE   | ARCHITETTURA § 19                                              |
| Smoke test desktop + healthcheck                                                                    | DONE   | ARCHITETTURA § 14.4                                            |
| Enforcement regola sovrana #2 (file da locale)                                                      | DONE   | ARCHITETTURA § 11                                              |
| Cloud finale + types regen + cast removal (Sprint W)                                                | DONE   | ARCHITETTURA § 22                                              |
| Backup verifier daily + DR runbook                                                                  | DONE   | `DISASTER_RECOVERY.md`                                         |
| Desktop schema mirror parity (mig 0004→0010)                                                        | DONE   | ARCHITETTURA § 22 + `Manuali/Manuale_Centro_Slide_Desktop.md`  |
| UI conditional cloud-only feature gate                                                              | DONE   | ARCHITETTURA § 22                                              |
| NSIS desktop installer 0.1.1 + smoke verde                                                          | DONE   | `Manuali/Manuale_Centro_Slide_Desktop.md` Parte B              |
| Sentry runtime error monitoring                                                                     | DONE   | `DISASTER_RECOVERY.md` § "Setup Sentry"                        |
| Workspace cleanup + ignore files universal                                                          | DONE   | `DISASTER_RECOVERY.md` § "Workspace cleanup"                   |
| Sprint X-1 upload hardening (desktop simple-upload + cloud TUS race-cancel + smoke secrets via env) | DONE   | ARCHITETTURA § 22 "Sprint X-1"                                 |
| Sprint X-2 field-test hotfix (TUS abort post-done 403 + slide-validator 401 ES256 + PWA cache bust) | DONE   | ARCHITETTURA § 22 "Sprint X-2"                                 |

### Conseguenza pratica

Non c'è nulla di bloccante per usare il prodotto in produzione DHS. Tutto ciò che segue è:

- **Azione esterna NON automatizzabile** (acquisti, contratti, video, listing) → § 2.
- **Opzionale ma ready-to-code** (Sprint Q hybrid cloud↔desktop) → § 4.
- **Roadmap commerciale** (sales/legale/marketing) → § 5 + `Commerciale/Roadmap_Vendita_Esterna.md`.

### Roadmap ad alto livello

Tutti i macro-sprint R / S / T / U / W sono **chiusi**. Per la prossima fase non ci sono sprint di sviluppo schedulati: il prodotto è pronto al primo evento DHS. Le prossime evoluzioni dipendono da:

| Sprint | Focus                         | Quando partire                                                       |
| ------ | ----------------------------- | -------------------------------------------------------------------- |
| Q      | Sync hybrid cloud↔desktop     | Quando cliente chiede backup cloud automatico durante eventi offline |
| (TBD)  | API pubblica REST integratori | Quando 5+ clienti la chiedono                                        |
| (TBD)  | Mobile app companion          | Quando 10+ clienti la chiedono                                       |
| (TBD)  | Multi-lingua oltre IT/EN      | Quando primo cliente non IT/EN                                       |
| (TBD)  | White-label                   | Quando primo cliente Enterprise lo chiede                            |

Storia dettagliata sprint chiusi → `ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22 + archive `_archive/STATO_E_TODO_storia_sprint_0.1-0.29.md`.

---

## 2. Cose da fare ORA (azioni esterne Andrea, NON automatizzabili)

### 2.1 Email transazionali (Sprint 7) — sblocca welcome + license expiring + storage warning

**Stato:** infrastruttura DONE, manca solo configurazione esterna.

| #   | Azione                                                                                                                                                                                    | Tempo  | Costo                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------- |
| 1   | Registra account Resend su <https://resend.com> con `live.software11@gmail.com`                                                                                                           | 5 min  | €0 (free 3.000 email/mese) |
| 2   | Aggiungi dominio `liveworksapp.com` → segui istruzioni DNS (TXT + CNAME)                                                                                                                  | 30 min | €0 (Aruba esistente)       |
| 3   | Genera API key Resend → annota in password manager                                                                                                                                        | 2 min  | €0                         |
| 4   | Genera `EMAIL_SEND_INTERNAL_SECRET` (>=32 char) da PowerShell                                                                                                                             | 1 min  | €0                         |
| 5   | Imposta 4 secrets su Supabase Edge Functions: `RESEND_API_KEY`, `RESEND_FROM_EMAIL=info@liveworksapp.com`, `EMAIL_SEND_INTERNAL_SECRET`, `PUBLIC_APP_URL=https://app.liveslidecenter.com` | 5 min  | €0                         |
| 6   | Deploy Edge Functions: `pnpm fn:deploy email-send email-cron-licenses gdpr-export`                                                                                                        | 5 min  | €0                         |
| 7   | Schedule cron giornaliero su GitHub Actions — vedi `Manuali/Manuale_Email_Resend.md` § "Schedulazione"                                                                                    | 10 min | €0                         |
| 8   | Test: invita un membro team → ricevi welcome email entro 5s                                                                                                                               | 1 min  | €0                         |

Totale: ~1 ora. **Costo:** €0 (Resend free tier basta per primi 6 mesi).

> Riferimento dettagliato: `Manuali/Manuale_Email_Resend.md`.

### 2.2 Code-signing certificato OV Sectigo — elimina SmartScreen warning

**Stato:** integrazione build DONE (env-driven), manca solo certificato fisico.

| #   | Azione                                                                                    | Tempo                                   | Costo                |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------- | -------------------- |
| 1   | Acquista cert OV Sectigo via reseller (consigliato: ssl.com o ksoftware.net)              | 30 min ordine + 1-2 settimane emissione | ~€190/anno           |
| 2   | Genera CSR via OpenSSL (vedi `Manuali/Manuale_Code_Signing.md` § 2)                       | 10 min                                  | €0                   |
| 3   | Validazione OV: documenti azienda DHS                                                     | 3-5 giorni                              | €0 (vendor verifica) |
| 4   | Ricezione `.pfx` + password via email                                                     | -                                       | -                    |
| 5   | Installa `signtool` (Windows SDK) + add to PATH                                           | 15 min                                  | €0                   |
| 6   | Setta env: `CERT_PFX_PATH`, `CERT_PASSWORD`, `TIMESTAMP_URL=http://timestamp.sectigo.com` | 5 min                                   | €0                   |
| 7   | Test build firmata: `release-licensed.bat` → output firmato + `SHA256SUMS.txt` corretto   | 10 min                                  | €0                   |

Totale: ~1 giornata setup + 1-2 settimane emissione cert. **Costo:** €190/anno.

> Riferimento: `Manuali/Manuale_Code_Signing.md`.

### 2.3 Screencast onboarding (3 video, ~5 min ciascuno)

**Stato:** scaletta parola-per-parola pronta, manca registrazione.

| #   | Video                                                                        | Durata target | Tools                      |
| --- | ---------------------------------------------------------------------------- | ------------- | -------------------------- |
| 1   | Onboarding admin web (signup → primo evento → invita relatori → vista regia) | 5-6 min       | OBS Studio + microfono USB |
| 2   | Setup Centro Slide Desktop (download installer → primo boot → bind cloud)    | 4-5 min       | Idem                       |
| 3   | Setup PC sala (installer → discovery LAN → ricezione file)                   | 3-4 min       | Idem                       |

Totale: 1 giornata di registrazione + 1 giornata di editing leggero. **Costo:** €0 (OBS gratuito).

> Riferimento: `Manuali/Script_Screencast.md` (scaletta + setup tecnico OBS + audio target -16 LUFS + checklist post).

### 2.4 Revisione legale SLA + DPA art. 28

**Stato:** bozza tecnica SLA DONE, manca revisione legale.

| #   | Azione                                                                                       | Tempo         | Costo (preventivo)    |
| --- | -------------------------------------------------------------------------------------------- | ------------- | --------------------- |
| 1   | Trova avvocato GDPR/contratti SaaS B2B (consigliato: tramite ordine Roma o Camera Civile)    | 1 settimana   | -                     |
| 2   | Brief: invia `Commerciale/Contratto_SLA.md` v1.0 + `Commerciale/README.md` con schema DPA    | 30 min        | -                     |
| 3   | Revisione SLA + redazione DPA Allegato A (10 punti raccomandati nel README)                  | 1-2 settimane | €300-800 forfait      |
| 4   | Iterazione modifiche con avvocato                                                            | -             | (incluso nel forfait) |
| 5   | Pubblica versione finale in `Commerciale/Contratto_SLA.md` + `Commerciale/DPA_Allegato_A.md` | 30 min        | €0                    |

Totale: 2-3 settimane elapsed. **Costo:** €300-800.

### 2.5 Listing prodotti su sito marketing `liveworksapp.com`

| #   | Azione                                                                                                               | Tempo  | Costo               |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------ | ------------------- |
| 1   | Pagina prodotto Slide Center con descrizione + 3 piani (Starter/Pro/Enterprise) + screenshot UI + 3 screencast embed | 4 ore  | €0 (riuso template) |
| 2   | Pagina prodotto Centro Slide Desktop + bundle Suite + checkout Lemon Squeezy                                         | 2 ore  | €0                  |
| 3   | CTA "Prova Trial gratis" → link a `https://app.liveslidecenter.com/signup`                                           | 15 min | €0                  |
| 4   | Footer: link a `/status` + email supporto + link a Contratto_SLA.md + DPA_Allegato_A.md                              | 30 min | €0                  |

Totale: 1 giornata. **Costo:** €0 (lavoro su sito esistente Aruba).

### 2.6 Approvazione listino prezzi

| #   | Azione                                                                                                 | Tempo  | Costo |
| --- | ------------------------------------------------------------------------------------------------------ | ------ | ----- |
| 1   | Leggi `Commerciale/Listino_Prezzi.md` v1.0 (4 piani + bundle + sconti)                                 | 30 min | €0    |
| 2   | Decidi prezzi DEFINITIVI (eventuali modifiche al file) e firma sotto "Approvato Andrea Rizzari + data" | 15 min | €0    |
| 3   | Configura prodotti su Lemon Squeezy con prezzi approvati (oppure delega a Live WORKS APP)              | 1 ora  | €0    |

Totale: 2 ore. **Costo:** €0.

---

## 3. Field test desktop (quando vorrai farlo)

> **Stato:** opzionale per uso interno DHS, **bloccante** per vendita esterna della versione desktop. Per la procedura QA dettagliata della versione desktop attuale (Tauri 2 unificato) vedi `Manuali/Manuale_Centro_Slide_Desktop.md` Parte B (smoke test 12 sezioni). Questa sezione resta come **field test su evento reale**.

### 3.1 Quando ha senso

- Hai un evento DHS reale tra 2+ settimane → test su quell'evento.
- Vuoi vendere il desktop a clienti esterni → field test obbligatorio.
- Vuoi decidere GO/NO-GO Sprint Q (vedi § 4).

### 3.2 Pre-requisiti hardware

| Macchina   | Ruolo                 | Specifiche minime                                                       |
| ---------- | --------------------- | ----------------------------------------------------------------------- |
| PC-ADMIN   | admin (Centro Slide)  | Win 10/11 64-bit, 8 GB RAM, SSD 100 GB liberi, Ethernet 1 Gbps          |
| PC-SALA-1  | sala A (proiezione)   | Win 10/11, 4 GB RAM, GPU integrata, HDMI/DP collegato a videoproiettore |
| PC-SALA-2  | sala B (proiezione)   | Win 11 enterprise (con AppLocker o policy aziendali se possibile)       |
| PC-SALA-3  | sala C (proiezione)   | Win 10 anziano (4 anni+), 4 GB RAM, HDD meccanico se possibile          |
| Switch     | rete LAN              | Switch 1 Gbps managed o unmanaged. NO Wi-Fi only.                       |
| Cavi RJ45  | x4                    | Cat5e o superiore                                                       |
| Dataset    | 200 file              | Mix PPTX/PDF/MP4 4K, totale 8-10 GB                                     |
| Proiettore | x1 collegato a SALA-1 | Per validare riproduzione video 4K reale                                |

### 3.3 Procedura sintetica (T-2, T-1, T, T+1)

**T-2 giorni (preparazione):**

```powershell
gh auth status                                  # deve mostrare live-software11
git pull origin main                            # main aggiornato
pnpm --filter @slidecenter/desktop prereqs      # toolchain OK
pnpm --filter @slidecenter/desktop release:nsis # build NSIS

# Crea zip distribuibile
$ver = (Get-Content apps\desktop\src-tauri\tauri.conf.json | ConvertFrom-Json).version
$out = "release\SlideCenterDesktop_v${ver}_fieldtest.zip"
Compress-Archive -Force -Path `
    "apps\desktop\src-tauri\target\release\bundle\nsis\Live SLIDE CENTER Desktop_${ver}_x64-setup.exe", `
    "apps\desktop\scripts\smoke-test.mjs", `
    "apps\desktop\scripts\smoke-test.ps1" `
    -DestinationPath $out
```

Copia su chiavetta USB → installa su 4 PC field test.

**T-1 giorno (smoke test):** su OGNI PC esegui il flusso `Manuali/Manuale_Centro_Slide_Desktop.md` Parte B.

**Giorno T (test ~5 ore):**

| Fase | Cosa                                                                                                             | Durata |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| A    | Setup iniziale (apri 4 PC, crea evento "Field Test", 3 sale + 5 sessioni/sala, pair 3 PC sala via discovery LAN) | 60 min |
| B    | Sync file LAN parallelo (drag&drop 50 file × 50MB su 3 sessioni in parallelo, misura MB/s — target > 50 MB/s)    | 60 min |
| C    | Stress playback 4K + download in modalità LIVE (verifica FPS ≥ 50 in DevTools Performance)                       | 45 min |
| D    | Resilienza rete (stacca cavo PC-SALA-2 → pallino rosso entro 30s; stacca cavo PC-ADMIN → sale in STANDALONE)     | 30 min |
| E    | Riavvii e persistenza (5 riavvii consecutivi PC-SALA-1 → auto-rejoin sempre OK via `device.json`)                | 45 min |
| F    | UI parity cloud vs desktop (apri cloud Vercel + desktop side-by-side → identici visivamente?)                    | 30 min |
| G    | (Opzionale) VPN site-to-site (PC-ADMIN sede A + PC-SALA-1 sede B via VPN)                                        | 60 min |

**Giorno T+1 (decisione GO/NO-GO):**

- **GO produzione** se: 4 criteri OK (no crash, no perdita stato, no stuttering 4K, mediana sync < 3s).
- **NO-GO produzione** se: 1+ fallisce → apri sprint hardening dedicato.

### 3.4 Template feedback (compilazione obbligatoria)

Crea `docs/feedback/<YYYY-MM-DD>_field_test_desktop/REPORT.md` (compila DURANTE il test, non dopo). Contenuto minimo:

```markdown
# Field Test Desktop — Report

## Metadata

- Data: ...
- Versione testata (`/info` → `version`): ...
- Commit SHA: ...
- Tester: ...
- Sede / rete (LAN unmanaged 1Gbit / managed / VPN site-to-site): ...
- Durata totale (h reali): ...
- File test totali (n + GB): ...

## Inventario PC (hostname, ruolo, OS, RAM, disco libero, antivirus/dominio/AppLocker)

## Smoke test esiti (allega JSON `Documents\SlideCenterFieldTest\`)

## Esiti checklist (10 punti dalla Parte B di `Manuale_Centro_Slide_Desktop.md`)

## Stress 4K (FPS medio, frame drop, audio sync)

## Bug rilevati (severita, componente, riproducibile, step, atteso vs osservato, log/screenshot, bloccante per produzione)

## Decisione GO/NO-GO (firma + data)
```

### 3.5 Procedura rollback "tutto crasha" durante field test

Se l'app desktop diventa inutilizzabile durante il test:

1. Su PC sala interessato: chiudi Live SLIDE CENTER Desktop dal task manager.
2. Apri il browser e vai su `https://live-slide-center.vercel.app` (versione cloud).
3. Esegui pairing tradizionale (codice 6 cifre / QR).
4. Continua l'evento sulla versione cloud — UI identica (Sprint O), zero retraining.

Recupero dati post-crash:

1. Su tutti i PC sala: zip `~/SlideCenter/` (contiene SQLite + device.json + storage locale dei file).
2. Salva log Tauri: `%APPDATA%\com.livesoftware.slidecenter.desktop\logs\` (se esistono).
3. Salva report smoke-test JSON.
4. Apri immediatamente issue su GitHub `live-software11/Live-SLIDE-CENTER` con label `bug-field-test` + allega tutto.
5. Sospendi field test, riprendi dopo fix verificato.

---

## 4. Sprint Q — Sync hybrid cloud↔desktop (opzionale, ready-to-code)

### 4.1 Cosa fa

Push-only worker desktop → cloud (`presentation_versions` + `room_state` + `paired_devices`) per:

- Backup automatico dei file su cloud durante un evento offline.
- Dashboard cloud che vede TUTTI gli eventi (anche quelli desktop).
- Multi-sede senza VPN (admin in sede A vede stato sala in sede B via cloud).

**Sempre push-only**: il desktop è SEMPRE master, il cloud non può rispondere a una `getFile()` (regola sovrana #2 in ARCHITETTURA § 11).

### 4.2 Quando deciderlo (framework GO/NO-GO post field test)

Compila durante/dopo il field test:

| #   | Domanda                                                                             | SI/NO |
| --- | ----------------------------------------------------------------------------------- | ----- |
| 1   | Ho avuto bisogno, durante il field test, di vedere file da un PC NON sulla LAN?     |       |
| 2   | Ho avuto bisogno di backup automatico dei file su cloud?                            |       |
| 3   | Ho clienti che useranno la versione desktop in più sedi distribuite (no VPN)?       |       |
| 4   | Voglio un'unica dashboard cloud che vede TUTTI gli eventi (anche quelli offline)?   |       |
| 5   | Sono disposto a investire 5-7 giorni di sviluppo + tenant linking + auth cross-sys? |       |

**Regola:**

- Almeno **2 SI** → **GO Sprint Q** (apri sprint con priorità media).
- 0-1 SI → **NO-GO Sprint Q** (uso interno aziendale + LAN sono sufficienti, non spendere tempo).

### 4.3 Plan ready-to-code (5-7 giorni)

#### Giorno 1: schema + policy

Migration `supabase/migrations/<YYYYMMDD>_sprint_q_hybrid_sync.sql`:

```sql
CREATE TABLE hybrid_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  table_name TEXT NOT NULL,
  last_pushed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_pushed_pk UUID,
  total_pushed BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT uq_hybrid_sync_device_table UNIQUE (tenant_id, device_id, table_name)
);

ALTER TABLE hybrid_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hybrid_sync_state FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE OR REPLACE FUNCTION public.hybrid_sync_push(
  p_tenant_id UUID,
  p_device_id UUID,
  p_table TEXT,
  p_rows JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted INT := 0; v_skipped INT := 0;
BEGIN
  -- valida tenant + device
  -- per ogni riga in p_rows: UPSERT con ON CONFLICT DO NOTHING (idempotente)
  -- aggiorna hybrid_sync_state
  -- ritorna {inserted, skipped, last_pushed_at}
END; $$;

GRANT EXECUTE ON FUNCTION hybrid_sync_push TO service_role;
```

Schema SQLite locale (`apps/desktop/src-tauri/migrations/`):

```sql
CREATE TABLE IF NOT EXISTS hybrid_sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  pushed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON hybrid_sync_outbox(pushed_at) WHERE pushed_at IS NULL;
```

Trigger SQLite su INSERT/UPDATE in `presentation_versions`, `room_state`, `paired_devices` → INSERT in `hybrid_sync_outbox`.

#### Giorno 2-3: worker Rust

`apps/desktop/src-tauri/src/hybrid_sync.rs`:

```rust
pub struct HybridSyncWorker {
    state: Arc<AppState>,
    cloud_url: String,
    cloud_service_key: String,  // service_role token per RPC hybrid_sync_push
    interval_secs: u64,         // default 60
}

impl HybridSyncWorker {
    pub async fn run_loop(self) {
        loop {
            tokio::time::sleep(Duration::from_secs(self.interval_secs)).await;
            if let Err(e) = self.push_pending().await {
                eprintln!("[hybrid_sync] error: {e:?}");
            }
        }
    }

    async fn push_pending(&self) -> Result<()> {
        // SELECT batch da hybrid_sync_outbox WHERE pushed_at IS NULL LIMIT 100
        // Group by table_name
        // POST a Supabase RPC hybrid_sync_push con HMAC + service_role
        // Su success: UPDATE hybrid_sync_outbox SET pushed_at = strftime('%s','now')
        // Su failure: UPDATE attempts++, last_error
        // Backoff esponenziale dopo 3 fallimenti
        Ok(())
    }
}
```

Spawn nel `main.rs` SOLO se `device.json` ha `hybrid_sync.enabled = true` (opt-in).

#### Giorno 4: UI toggle + status

`apps/web/src/features/settings/SettingsView.tsx` → sezione "Sync hybrid cloud" (visibile solo in modalità desktop):

```tsx
<HybridSyncSection
  enabled={hybridSyncEnabled}
  lastSyncAt={hybridSyncLastSyncAt}
  pendingRows={hybridSyncPendingRows}
  onToggle={async (next) => {
    await invoke('cmd_set_hybrid_sync_enabled', { enabled: next });
    refresh();
  }}
/>
```

Comandi Tauri da esporre: `cmd_get_hybrid_sync_status`, `cmd_set_hybrid_sync_enabled`, `cmd_force_hybrid_sync_now`.

#### Giorno 5: tenant linking + auth cross-system

Il desktop deve sapere CHE TENANT cloud usare. Soluzioni:

- **Opzione A (semplice)**: settings UI "Connetti a cloud" → utente fa login Supabase → ottiene JWT con `tenant_id` → desktop salva `tenant_id + service_role token` in `device.json` cifrato.
- **Opzione B (sicura, raccomandata)**: dashboard cloud admin "Genera token desktop" → pair-code 6 cifre → desktop fa pair → riceve JWT scoped a `tenant_id + table_name IN (presentation_versions, room_state, paired_devices)` con scadenza 365gg.

Consigliato: **Opzione B** (no service_role su disco).

#### Giorno 6-7: test + docs

- E2E: simula crash di rete durante push, riprende dopo.
- Idempotenza: ripeti push stesso payload, verifica `inserted=0, skipped=N`.
- Conflitti: desktop e cloud entrambi modificano `room_state` → desktop vince (push-only).
- Aggiorna `ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22 con "Sprint Q DONE".
- Aggiorna `STATO_E_TODO.md` § 4 con "DONE".

### 4.4 Costi stimati Sprint Q

| Voce                                   | Costo                              |
| -------------------------------------- | ---------------------------------- |
| Sviluppo (5-7 giorni Andrea + AI)      | €0 diretto (tempo opportunità)     |
| Storage cloud aggiuntivo (backup)      | ~€0.021/GB/mese su Supabase Pro    |
| Bandwidth push (60s × 200 file × 50MB) | ~€2/mese per evento attivo         |
| Maintenance ongoing                    | ~1 ora/mese (monitoring + bug fix) |

Totale: **negligibile in costi diretti** se hai già Supabase Pro per il cloud SaaS.

### 4.5 File impattati

```
NEW:
  supabase/migrations/<YYYYMMDD>_sprint_q_hybrid_sync.sql
  apps/desktop/src-tauri/migrations/<YYYYMMDD>_hybrid_sync_outbox.sql
  apps/desktop/src-tauri/src/hybrid_sync.rs
  apps/web/src/features/settings/components/HybridSyncSection.tsx
  apps/web/src/features/settings/hooks/useHybridSyncStatus.ts

MODIFY:
  apps/desktop/src-tauri/src/main.rs                    (spawn worker se opt-in)
  apps/desktop/src-tauri/src/lib.rs                     (pub mod hybrid_sync)
  apps/desktop/src-tauri/Cargo.toml                     (no nuove deps, riusa reqwest+tokio+rusqlite)
  apps/web/src/features/settings/SettingsView.tsx       (aggiungi sezione)
  packages/shared/src/i18n/locales/{it,en}.json         (~15 chiavi nuove `hybridSync.*`)
  packages/shared/src/types/database.ts                 (RPC + tabella nuova)
  docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md                 (§ 22 mark DONE)
  docs/STATO_E_TODO.md                                  (§ 4 mark DONE)
```

---

## 5. Backlog post-vendita (sales + legale + marketing)

> Per le azioni esterne dettagliate vedi `Commerciale/Roadmap_Vendita_Esterna.md` (10 sezioni, 47 voci, budget complessivo €3.700-€7.000 one-time + €1.090-€3.930/anno).

### 5.1 Macro-aree pending

| Area             | Cosa fare                                                | Tempo          | Costo                  |
| ---------------- | -------------------------------------------------------- | -------------- | ---------------------- |
| Legale           | DPA art. 28, T&C, DPIA, nomina DPO esterno               | 4-6 settimane  | €1.500-€3.500          |
| Fiscale          | P.IVA verifica VIES, Lemon Squeezy fatturazione          | 1 settimana    | €0 (esistente)         |
| Marketing        | Sito + materiale + 3 video + SEO + social                | 8-12 settimane | €2.000-€4.000 one-time |
| Pricing          | Approvare listino, configurare Lemon Squeezy             | 1 settimana    | €0                     |
| Operations       | Help desk + docs + status page brandizzata + UptimeRobot | 4 settimane    | €600-€1.500/anno       |
| Pipeline clienti | Prospect 5 + demo + early-adopter program                | 3-6 mesi       | €0 diretto             |

### 5.2 Decisioni urgenti pre-primo-cliente

Vedi `Commerciale/Roadmap_Vendita_Esterna.md` § "Decisioni urgenti":

1. Pricing definitivo (mensile vs annuale, sconti).
2. Modalità di vendita (self-service vs assistita).
3. Target verticale (medicale / corporate / fiere / generalista).
4. Geografia (solo Italia / EU / mondo).
5. Margine target (per dimensionare costo acquisizione cliente).

---

## 6. Backlog post-MVP (idee future, NON urgenti)

### 6.1 Idee dal piano commerciale

| Idea                                          | Effort                 | Quando guardarla                             |
| --------------------------------------------- | ---------------------- | -------------------------------------------- |
| API pubblica REST per integratori esterni     | 2-3 settimane          | Quando 5+ clienti la chiedono                |
| Mobile app companion (React Native o Flutter) | 4-6 settimane          | Quando 10+ clienti la chiedono               |
| Multi-lingua oltre IT/EN (FR, DE, ES, NL)     | 1 settimana per lingua | Quando primo cliente non IT/EN               |
| White-label (logo + colori cliente)           | 1-2 settimane          | Quando primo cliente Enterprise lo chiede    |
| Integrazione calendar (Google/Outlook)        | 1 settimana            | Quando 3+ clienti la chiedono                |
| OBS plugin per regia AV avanzata              | 3-4 settimane          | Quando si entra nel mercato AV professionale |

### 6.2 Hardening tecnico opzionale

| Idea                                                         | Effort     | Beneficio                                                                        |
| ------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------- |
| Migrazione Storage da Supabase a Cloudflare R2 (zero egress) | 1 giornata | Quando egress > $50/mese                                                         |
| Database read replicas (Supabase Pro+ feature)               | 2 ore      | Quando >100 tenant o 1M+ righe/giorno                                            |
| pgBouncer proxy per connection pooling avanzato              | 1 giornata | Quando >50 concurrent users                                                      |
| Sentry sourcemaps upload automatico (script già pronto)      | 30 min     | Stack trace leggibili (vedi DR § Sentry)                                         |
| OpenTelemetry tracing distribuito                            | 2-3 giorni | Quando debug cross-system diventa lungo                                          |
| Edge Functions warm-keep cron-job.org                        | 30 min     | Solo se Sentry mostra cold-start > 500ms (vedi `DISASTER_RECOVERY.md` appendice) |
| Auto-rollback Vercel su smoke fail (post-deploy GH Action)   | 4 ore      | Sicurezza extra rilascio prod                                                    |

### 6.3 Cose che PROBABILMENTE non faremo mai

- Migrazione a Next.js (SSR non serve per SaaS dashboard).
- Migrazione a Electron (Tauri 2 è migliore in tutto).
- Self-hosting Supabase (perdi gestita, complessità esplode).
- Versione Linux/macOS desktop (target di vendita 95% Windows aziendale).

---

## 7. Comandi rapidi (cheat-sheet quotidiano)

### 7.1 Account check (PRIMA di qualsiasi push remoto)

```powershell
gh auth status                      # deve mostrare live-software11
firebase login:list                 # deve includere live.software11@gmail.com (per Live PLAN/CREW/WORKS)
supabase projects list              # deve mostrare slidecenter (Frankfurt)
```

### 7.2 Sviluppo cloud

```powershell
pnpm install                                                    # primo setup
pnpm dev                                                        # tutti i dev server
pnpm --filter @slidecenter/web dev                              # solo web
pnpm --filter @slidecenter/web typecheck
pnpm --filter @slidecenter/web lint
pnpm --filter @slidecenter/web build
pnpm --filter @slidecenter/web build:desktop                    # build per Tauri desktop
pnpm --filter @slidecenter/shared build                         # rebuild types/i18n
pnpm i18n:check                                                 # verifica parity IT/EN
```

### 7.3 Sviluppo desktop (Tauri 2)

```powershell
pnpm --filter @slidecenter/desktop prereqs                      # check toolchain
pnpm --filter @slidecenter/desktop dev                          # dev mode con hot reload
pnpm --filter @slidecenter/desktop release:nsis                 # build NSIS x64
.\release-licensed.bat                                          # build con feature license (vendita)
.\clean-and-build.bat                                           # build dev senza license
```

### 7.4 Sviluppo desktop (Local + Room Agent legacy)

> Solo per manutenzione storica. Lo sviluppo nuovo va su `apps/desktop` (Tauri 2 unificato).

```powershell
pnpm --filter @slidecenter/agent dev
pnpm --filter @slidecenter/room-agent dev
pnpm --filter @slidecenter/agent build:tauri:licensed
pnpm --filter @slidecenter/room-agent build:tauri:licensed
```

### 7.5 Database (Supabase) e Vercel

```powershell
# Comandi nativi CLI
supabase start                                                  # avvia stack locale (Docker)
supabase stop
supabase db diff
supabase db push                                                # applica migrations REMOTE (attenzione)
supabase migration new <nome>
supabase gen types typescript --local > packages/shared/src/types/database.ts
supabase functions serve                                         # dev Edge Functions
supabase functions deploy <nome>
supabase test db                                                 # esegui test RLS pgTAP

# Wrapper pnpm (Sprint Q+1)
pnpm db:types                                                   # rigenera DB types da REMOTE
pnpm db:types:local                                             # rigenera DB types da LOCAL
pnpm db:diff
pnpm db:lint
pnpm db:push
pnpm fn:deploy                                                  # deploy Edge Functions (tutte)

# Vercel (Sprint W)
pnpm vercel:env:pull                                            # scarica env produzione in .env.local
pnpm vercel:deploy:prod                                         # deploy produzione manuale
pnpm smoke:cloud                                                # smoke test cloud production (21 check)
pnpm smoke:cloud:json                                           # output JSON per CI / monitor
```

### 7.6 Quality gates

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm i18n:check

# Rust
cd apps\desktop\src-tauri
cargo check --all-features
cargo clippy --all-features -- -D warnings
cargo test --all-features
```

### 7.7 Workspace cleanup periodico (post-Sprint W)

```powershell
# Quando deploy Vercel > 5 min o sidebar Cursor lenta — vedi DISASTER_RECOVERY.md § "Workspace cleanup"
$paths = @(
  "apps/desktop/src-tauri/target",
  "apps/agent/src-tauri/target",
  "apps/room-agent/src-tauri/target",
  "apps/web/dist", "apps/web/dist-desktop", "apps/web/.turbo",
  "packages/shared/dist", "packages/ui/dist",
  ".turbo", "node_modules/.cache",
  ".vercel-deploy.log", ".vercel-smoke.log"
)
foreach ($p in $paths) {
  if (Test-Path $p) { Remove-Item -Recurse -Force $p; Write-Host "Cleaned $p" }
}

# Verifica post-cleanup
pnpm --filter @slidecenter/web typecheck   # deve passare
pnpm --filter @slidecenter/web build       # deve fare build in < 5s
pnpm smoke:cloud                            # deve restare 21/21 verde
```

### 7.8 Disaster recovery (rollback rapido)

```powershell
# Lista deploy recenti
vercel ls live-slide-center --scope livesoftware11-3449s-projects | Select-Object -First 15

# Rollback istantaneo (60s, no rebuild) a deploy precedente verde
vercel promote https://live-slide-center-<hash>.vercel.app --scope livesoftware11-3449s-projects --yes

# Verifica
pnpm smoke:cloud
```

Per gli altri 5 scenari (Supabase down, data-loss, Vercel down, perdita parziale storage, setup Sentry da zero) → `DISASTER_RECOVERY.md`.

### 7.9 Git workflow

```powershell
git status
git diff
git log --oneline -10
git add .
git commit -m "$(cat <<'EOF'
fix(desktop): timeout discovery LAN su switch managed

Problema: switch managed bloccavano IGMP snooping aggressivo.
Soluzione: aumentato timeout da 2s a 5s + retry exponenziale.

Fix #42 (field test feedback)
EOF
)"
git push origin main                                            # solo dopo gh auth status verde
```

---

**FINE.** Per architettura tecnica: `ARCHITETTURA_LIVE_SLIDE_CENTER.md`. Per setup ambiente sviluppo: `Setup_Strumenti_e_MCP.md`. Per AI agents (Claude/Cursor): `Istruzioni_Claude_Desktop.md`. Per operazioni di emergenza: `DISASTER_RECOVERY.md`. Per setup desktop: `Manuali/Manuale_Centro_Slide_Desktop.md`.
