# LIVE_SLIDE_CENTER_DEFINITIVO.md

> **⚠️ DEPRECATO — Aprile 2026**
> Questo documento e stato sostituito da **`docs/GUIDA_DEFINITIVA_PROGETTO.md`** — guida definitiva unificata con architettura semplificata (Supabase Storage, PWA player, no R2 iniziale, no Player Tauri), analisi storage completa, roadmap aggiornata.
> **Non usare questo file.** Riferirsi esclusivamente a `docs/GUIDA_DEFINITIVA_PROGETTO.md`.

---

> **Documento master di riferimento unico.** Sostituisce e consolida tutte le decisioni precedenti. In caso di conflitto con altri documenti, **questo vince**.
> **Versione:** 1.0 Definitiva — Aprile 2026
> **Autore:** Andrea Rizzari + CTO Senior Review

---

## 🎯 Obiettivi Strategici

1. **SaaS multi-tenant puro** — ogni azienda cliente ha il proprio spazio isolato, propria dashboard, propri eventi, propri file. Zero contaminazioni tra tenant.
2. **Onboarding frictionless per il cliente** — signup → crea tenant → crea primo evento → invita relatori, tutto in meno di 10 minuti.
3. **Zero-config per i PC sala** — il tecnico in sala installa l'app una volta, poi tutto è automatico (mDNS discovery + QR pairing + scelta visuale sala).
4. **Storage senza limiti pratici** — file fino a 5GB, eventi fino a 1TB, nessuna paura di "finire lo spazio".
5. **Funzionamento offline garantito** — l'evento non si ferma mai, nemmeno se cade internet.
6. **Partenza conservativa sui costi** — infrastruttura minima ora (2-3 eventi/anno, pochi GB), scalabile senza refactoring quando arriveranno clienti paganti.

---

## 🏗️ Architettura Definitiva

```
┌─────────────────────────────────────────────────────────┐
│ ☁️  CLOUD (fonte di verità)                             │
│                                                         │
│  Supabase (EU - Francoforte)                            │
│  • Postgres con RLS per tenant isolation                │
│  • Auth multi-tenant con JWT custom claims              │
│  • Realtime su room_state, versions, agents             │
│  • Edge Functions per upload token validation           │
│                                                         │
│  Cloudflare R2 (EU)                                     │
│  • Bucket unico: live-slide-center-files                │
│  • Prefisso chiave: tenants/{tenant_id}/events/{id}/... │
│  • Zero egress fees                                     │
│  • Upload multipart diretto dal browser                 │
└──────────────────────┬──────────────────────────────────┘
                       │
     ┌─────────────────┼──────────────────┐
     ▼                 ▼                  ▼
┌──────────┐   ┌──────────────┐    ┌─────────────┐
│ Web SaaS │   │ Local Agent  │    │ Room Player │
│ Next.js  │   │ Tauri v2     │    │ Tauri v2    │
│ (cloud)  │   │ (regia evento│    │ (ogni sala) │
│          │   │ mini-PC)     │    │             │
│ Dashboard│   │ • mDNS srv   │    │ • mDNS scan │
│ Upload   │   │ • HTTP LAN   │    │ • Auto-pair │
│ Portal   │   │ • SQLite     │    │ • QR pair   │
│          │   │ • File cache │    │ • Overlay   │
└──────────┘   └──────┬───────┘    └──────┬──────┘
                      │                   │
                      └───── LAN evento ───┘
```

### Componenti in dettaglio

**Web SaaS (Next.js hosted su Vercel)**
Questa è l'interfaccia che ogni cliente usa dal suo browser. Ogni azienda cliente ha il proprio URL personalizzato (`app.liveslidecenter.com/t/studio-visio`) o un sottodominio (`studio-visio.liveslidecenter.com` — scelta da validare in Fase 2). Dopo il login vede SOLO i suoi eventi, i suoi file, i suoi utenti. Impossibile vedere altri clienti. Include anche il portale pubblico relatori `/u/{token}` senza login.

**Local Agent (Tauri v2 + Axum)**
App desktop che Andrea (o il tecnico del cliente) installa sul mini-PC di regia. Al primo avvio fa login con credenziali tenant, seleziona l'evento attivo, scarica tutto in cache locale. Si annuncia sulla LAN come `_slidecenter._tcp.local`. Serve file via HTTP alle sale. Funziona offline completo.

**Room Player (Tauri v2)**
App desktop installata su ogni PC di sala. Al primo avvio fa mDNS scan, trova l'Agent, mostra lista sale disponibili, il tecnico clicca "Sala 3 — Auditorium B". Fatto. Dal secondo avvio è già configurato. Overlay sempre visibile con: nome sala, versione corrente, stato sync (verde/giallo/rosso).

---

## 🔐 Isolamento Multi-Tenant (la parte più critica)

### Isolamento dati (Postgres)
Ogni tabella con dati business ha colonna `tenant_id UUID NOT NULL`. Row-Level Security attiva ovunque con policy `tenant_id = public.app_tenant_id()`. La funzione helper legge `tenant_id` dal JWT dell'utente autenticato. **Impossibile** fare query cross-tenant, anche con SQL injection.

### Isolamento file (R2)
Struttura chiavi obbligatoria nel bucket:
```
tenants/
  ├── {tenant_id_cliente_A}/
  │     └── events/
  │           └── {event_id}/
  │                 └── presentations/
  │                       └── {presentation_id}/
  │                             └── v{version}/
  │                                   └── file.pptx
  └── {tenant_id_cliente_B}/
        └── ... (invisibile al cliente A)
```
L'Edge Function che genera gli URL firmati per upload/download **verifica il tenant_id dal JWT** prima di firmare. Anche se un cliente scoprisse l'ID di un file di un altro cliente, non potrebbe accedervi: l'URL firmato è vincolato al suo tenant.

### Isolamento auth
Supabase Auth con trigger SQL che all'atto del signup:
1. Crea automaticamente un record in `tenants`
2. Crea il record `users` con `role='admin'`
3. Inserisce `tenant_id` nel JWT `app_metadata` (immutabile lato client)

Da quel momento ogni richiesta al database passa attraverso RLS e viene filtrata automaticamente.

---

## 💰 Piano Infrastruttura Conservativo (Fase Iniziale)

Dato il traffico attuale (2-3 eventi/anno, ~2GB totali), parti con il livello gratuito ovunque possibile. Scali solo quando arrivano clienti paganti.

| Servizio | Piano iniziale | Costo | Upgrade quando |
|---|---|---|---|
| Supabase | Free tier | **0€** | Arrivi a 500MB DB o primi 10 utenti attivi → Pro 25€ |
| Cloudflare R2 | Pay-as-you-go | **~0€** (sotto 10GB gratis/mese) | Oltre 10GB attivi → ~0,15€/GB/mese |
| Vercel | Hobby | **0€** | Primo cliente paying → Pro 20€/mese |
| Dominio | `liveslidecenter.com` | ~12€/anno | — |
| Sentry | Developer free | **0€** | Dopo 5000 eventi/mese |
| GitHub | Free | **0€** | — |
| Lemon Squeezy | Gratis fino alla prima vendita | **0€** | Automatico a prima transazione |

**Costo mensile iniziale: ~1€/mese** (solo il dominio ammortizzato). Perfetto per il periodo pre-vendite.

**Primo upgrade previsto:** quando firmi il primo cliente pagante (~25-45€/mese totali). Secondo upgrade con 5+ clienti (~80€/mese). Resti sempre sotto il 10% del fatturato.

---

## 📐 Modello Dati — Struttura Clienti e Isolamento

Ogni cliente che si registra ottiene il proprio "spazio" così strutturato:

```
Cliente "Studio Visio" (tenant_id = abc-123)
│
├── Team utenti
│   ├── mario@studiovisio.it (admin)
│   ├── luca@studiovisio.it (coordinator)
│   └── sara@studiovisio.it (tech)
│
├── Eventi
│   ├── "Congresso Cardiologia 2026"
│   │   ├── Sale: Auditorium A, Sala B, Sala C
│   │   ├── Sessioni: 40 slot orari
│   │   ├── Speaker: 60 relatori con token upload
│   │   └── File: 120 presentazioni, 380 versioni totali
│   │
│   └── "Meeting Aziendale XYZ"
│       └── ...
│
└── Settings
    ├── Logo e branding
    ├── Piano attivo (Starter/Pro/Enterprise)
    └── Billing info
```

**Ogni cliente vede SOLO il proprio albero.** Nessun dato leaked possibile.

---

## 🚀 Roadmap Adattata (Priorità alla Minima Infrastruttura)

Ordine di implementazione rivisto per partire con costi zero e validare prima i flussi critici:

**FASE 1 — Foundation** (Supabase Free + Vercel Hobby)
Auth multi-tenant, signup che crea tenant, dashboard vuota protetta. Deploy funzionante su `app.liveslidecenter.com`. Zero costi infrastruttura.

**FASE 2 — CRUD Eventi** (ancora free tier)
Crea/modifica eventi, sale, sessioni, speaker. Nessun upload ancora. Usa un tuo evento reale (quando ne fai uno) per validare che i flussi hanno senso.

**FASE 3 — Upload Cloud-Only** (R2 pay-per-use minimo)
Upload Portal relatori, file salvati direttamente su R2 con chiave `tenants/{id}/events/{id}/...`. Versioning completo. Zero Agent, zero Player ancora. Testabile da solo, cloud puro. Costerà centesimi al mese con 2-3 eventi/anno.

**FASE 4 — Vista Regia Web** (free tier)
Dashboard realtime che mostra stato presentazioni, versioni, upload in corso. Testabile in scenario cloud-only.

**FASE 5 — Room Player PWA** (prima versione, nessun Agent)
Versione browser installabile come PWA. Il tecnico apre `sala.liveslidecenter.com`, si autentica con token sala, vede il file corrente dal cloud. Funziona con internet attivo. **Già utilizzabile in eventi piccoli con buona rete.**

**FASE 6 — Local Agent (Tauri)** (valore alto)
Mini-PC in regia, mDNS discovery, cache SQLite+filesystem, server HTTP LAN. Questo sblocca la modalità offline completa. Lo sviluppi solo quando hai almeno 1 cliente pagante che lo richiede, o quando vuoi fare una demo "wow" commerciale.

**FASE 7 — Room Player Tauri nativo** (post Agent)
Sostituisce la PWA con app desktop vera, discovery automatico Agent, cache locale, overlay informativo. Il PWA rimane come fallback.

**FASE 8 — QR Pairing sale** (differenziatore commerciale)
Aggiunta "wow factor": pairing sala via QR code dalla regia. 1-click setup.

**FASE 9 — Export fine evento** (finalizzazione)
ZIP download + CSV log + report PDF.

**FASE 10 — Billing Lemon Squeezy** (quando hai il primo potenziale cliente)
Abbonamenti, customer portal, enforcement limiti. Non prima: è tempo sprecato se non hai ancora clienti.

**Fasi 11-15** come da CURSOR_BUILD originale (i18n, integrazioni, hardening, test E2E).

**Logica di priorità:** costruisci prima il cuore cloud (1-5), poi l'edge desktop (6-8), poi monetizzazione (10). Non l'inverso. Così ogni Fase produce valore utilizzabile subito anche senza le successive.

---

## 🎨 Esperienza Utente — Flusso Cliente Completo

### Onboarding nuovo cliente (10 minuti)
1. Va su `liveslidecenter.com`, clicca "Inizia gratis"
2. Inserisce email aziendale, password, nome azienda
3. Sistema crea automaticamente tenant + utente admin
4. Email di verifica
5. Primo login → wizard 3 step: nome azienda / logo / fuso orario
6. Dashboard vuota con CTA grande "Crea il tuo primo evento"
7. Form evento: nome, date, location → salva
8. Aggiungi sale con drag & drop (nome + capienza)
9. Aggiungi sessioni con calendario visuale
10. Aggiungi speaker → il sistema genera link upload + QR code per ognuno

### Onboarding sala tecnico (3 click)
1. Tecnico apre Room Player su PC sala
2. App cerca Agent via mDNS (o cloud se non c'è Agent)
3. Mostra lista sale evento attivo con icone grandi
4. Tecnico tocca "Auditorium B"
5. Fatto — da ora quel PC è "Auditorium B" finché non lo cambia

### Flusso relatore (2 minuti)
1. Riceve email con link personale
2. Apre link sullo smartphone
3. Vede la sua sessione, sala, orario
4. Tocca "Carica presentazione", sceglie file
5. Upload con barra progresso (funziona anche se chiude e riapre)
6. Conferma visuale: "Tutto ok, la tua v3 è stata caricata"

---

## ✅ Checklist Pre-Codice Aggiornata

Rispetto al `PRE_CODE_PREPARATION.md` precedente, **semplifica così** data la fase iniziale:

**Salta ora:**
- ~~Sentry setup~~ (non serve con 2-3 eventi/anno, aggiungi in Fase 15)
- ~~Lemon Squeezy~~ (solo quando Fase 10)
- ~~Piano Pro Supabase~~ (resta Free)
- ~~Upgrade Vercel~~ (resta Hobby)

**Fai subito:**
- [ ] Supabase progetto Free su regione EU
- [ ] Cloudflare account + R2 bucket `live-slide-center-files` EU
- [ ] R2 API Token salvato in password manager
- [ ] Dominio `liveslidecenter.com` acquistato (12€/anno su qualsiasi registrar)
- [ ] GitHub repo `live-software11/live-slide-center`
- [ ] Vercel Hobby collegato al repo
- [ ] Le 7 correzioni documentali della Parte A del doc precedente
- [ ] 5 wireframe cartacei Vista Regia / Upload Portal / Room Player / Dashboard / Export
- [ ] `supabase db reset` locale funzionante
- [ ] MCP Supabase in Cursor verde connesso

---

## 🎯 Prompt di Avvio per Cursor

Quando tutto è pronto, apri Cursor nella root del progetto e scrivi:

> "Leggi `docs/LIVE_SLIDE_CENTER_DEFINITIVO.md` e `docs/SlideHub_Live_CURSOR_BUILD.md`. Il primo è la fonte di verità master. Inizia generando un `PLAN.md` per la FASE 1 (Foundation Auth Multi-Tenant). Non scrivere codice finché non confermo il piano. Spiega tutto in italiano semplice, io non sono un programmatore."

---

## 🚨 Regole non negoziabili (promemoria finale)

1. **Mai file senza tenant_id** — ogni riga DB, ogni file R2, ogni richiesta API deve essere scopata a tenant.
2. **Mai scorciatoie su RLS** — se una query funziona solo bypassando RLS, è un bug, non una feature.
3. **Mai fidarsi del client** — tutti i check di permission avvengono su Edge Function o Postgres, mai solo in React.
4. **Mai promettere offline se l'Agent non c'è** — dillo chiaramente nell'UI: "Modalità cloud diretta" vs "Modalità offline resiliente".
5. **Mai spendere soldi su infrastruttura senza un cliente che li giustifica** — resta free tier finché puoi.

---

**Questo documento è la tua bussola.** Ogni decisione futura che non trovi qui scritta, prima di prenderla, aggiorna questo file. Così a 6 mesi da oggi avrai un unico posto dove leggere "perché ho deciso X".
