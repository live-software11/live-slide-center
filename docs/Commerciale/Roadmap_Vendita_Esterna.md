---
title: Roadmap Vendita Esterna — Pending burocratici Sprint 7+
versione: 1.0 (aprile 2026)
audience: Andrea Rizzari (decision)
stato: BOZZA — da completare prima del go-to-market commerciale
---

# Roadmap Vendita Esterna — Live SLIDE CENTER

Documento operativo che lista **tutte le attivita NON tecniche** necessarie a
trasformare Live SLIDE CENTER da strumento interno DHS a prodotto SaaS
vendibile a terzi. Ogni voce ha:

- **Stato:** todo / in-progress / done
- **Owner:** chi deve farlo (Andrea, Avvocato, Commercialista, ecc.)
- **Costo stimato:** budget di riferimento (one-time / annuale)
- **Blocca:** quali milestone commerciali dipendono dal completamento
- **Riferimenti:** documenti / link / contatti

> **Nota.** Lo stack tecnico e' completo al 100% post-Sprint 7 (intranet,
> licenze, code-signing, onboarding, GDPR export, email transazionali,
> notifiche). I "pending" qui sotto sono **esclusivamente** burocratici,
> contrattuali, fiscali, marketing — non bloccano l'uso interno DHS.

---

## 1. Compliance legale

### 1.1 DPA (Data Processing Agreement) — Art. 28 GDPR

- **Stato:** todo
- **Owner:** Avvocato GDPR (esterno)
- **Costo:** 800-1.500 € one-time per redazione + 300 €/anno revisioni
- **Blocca:** vendita a clienti che richiedono DPA firmato (PA, sanita, banche,
  multinazionali, qualsiasi cliente B2B serio)
- **Riferimenti:**
  - Schema base in `docs/Commerciale/README.md` § "Allegato A — DPA ex art. 28 GDPR"
  - Sub-processor da elencare: Supabase (DB/Storage), Cloudflare (CDN), Resend
    (email), Lemon Squeezy (licensing & billing), GitHub (codice/issues)
- **Output atteso:** PDF firmato + variante allegato al SLA + processo
  aggiornamento sub-processor (notifica clienti 30gg prima)

### 1.2 Privacy Policy & Cookie Policy pubblica

- **Stato:** todo
- **Owner:** Andrea + Avvocato (review finale)
- **Costo:** 0-200 € (template iubenda professionale ~99 €/anno)
- **Blocca:** sito marketing `www.liveworksapp.com` (gia' online ma senza
  privacy policy completa); GDPR compliance basilare; sezione `/legal/privacy`
  della webapp
- **Output atteso:** 2 pagine HTML (Privacy + Cookie) linkate da footer sito
  e webapp, generate da iubenda o redatte manualmente

### 1.3 Termini e Condizioni di servizio (T&C)

- **Stato:** todo (esiste solo `Contratto_SLA.md` per B2B firmato)
- **Owner:** Andrea + Avvocato
- **Costo:** 500-800 € one-time
- **Blocca:** signup self-service (oggi i nuovi tenant si registrano senza
  accettare T&C esplicite); checkout self-service via Lemon Squeezy
- **Output atteso:** pagina `/legal/terms` + checkbox accettazione obbligatoria
  in `SignupView.tsx`

### 1.4 Adeguamento DPIA (Data Protection Impact Assessment)

- **Stato:** todo (consigliato per casi sensibili: ospedali, scuole, eventi PA)
- **Owner:** Avvocato GDPR + DPO cliente (se obbligato)
- **Costo:** 800-1.200 € per DPIA generica
- **Blocca:** vendita ad enti pubblici e settori regolati
- **Output atteso:** documento DPIA template adattabile per cliente

### 1.5 Designazione DPO interno

- **Stato:** valutare se necessario
- **Owner:** Andrea (decisione) → eventualmente avvocato GDPR esterno come DPO
- **Costo:** 1.500-3.000 €/anno DPO esterno; 0 € se Andrea non e' obbligato
- **Blocca:** appalti pubblici (richiedono spesso DPO formalizzato)
- **Riferimento:** Art. 37 GDPR — obbligatorio solo se trattamento sistematico
  su larga scala. Per Live SLIDE CENTER probabilmente NON obbligatorio nei
  primi anni (poche centinaia di tenant), ma aiuta vendita

---

## 2. Fiscale & Amministrativo

### 2.1 Apertura partita IVA (gia' attiva: Live Software)

- **Stato:** done
- **Owner:** Commercialista
- **Note:** Verificare con commercialista che codice ATECO copra anche
  "fornitura SaaS B2B" (62.01.00 produzione software + 63.11.30 elaborazione
  dati). In caso contrario, aggiungere.

### 2.2 Iscrizione VIES (per fatturazione UE B2B)

- **Stato:** todo (verificare con commercialista)
- **Owner:** Commercialista
- **Costo:** 0 € (procedura amministrativa)
- **Blocca:** vendita reverse-charge a clienti UE → senza VIES si applica IVA
  italiana piena (poco competitivo)
- **Output atteso:** numero VAT IT con flag VIES attivo, verificabile su
  [https://ec.europa.eu/taxation_customs/vies/](https://ec.europa.eu/taxation_customs/vies/)

### 2.3 Convenzione fatturazione elettronica (gia' attiva)

- **Stato:** done (presumibilmente Aruba/Fattura24/altro)
- **Owner:** Commercialista
- **Note:** Verificare integrazione webhook con Lemon Squeezy → emissione
  automatica fattura B2B (oggi probabilmente manuale)

### 2.4 Iscrizione registro AGCOM (servizi digitali)

- **Stato:** verificare obbligo
- **Owner:** Commercialista / Avvocato
- **Costo:** 250-500 €/anno
- **Note:** Servizi cloud B2B sotto soglia minima fatturato non sono obbligati,
  ma valutare quando ci si avvicina al milione di fatturato

### 2.5 Apertura conto Lemon Squeezy / Stripe per checkout

- **Stato:** Lemon Squeezy gia' attivo per Live WORKS APP (licenze desktop)
- **Owner:** Andrea
- **Note:** Per Slide Center si puo' riusare lo stesso account Lemon Squeezy
  oppure passare a Stripe diretto (commissioni piu' basse ma fatturazione
  europea da gestire). Decidere prima del lancio.

---

## 3. Marketing & Sito

### 3.1 Sito marketing `www.liveworksapp.com` — sezione Slide Center

- **Stato:** todo
- **Owner:** Andrea (con web designer)
- **Costo:** 1.000-2.500 € one-time (design + copywriting + foto)
- **Blocca:** SEO, lead generation, demo request
- **Sezioni necessarie:**
  - Hero + value proposition ("la regia presentazioni in 1 clic")
  - 3 USP: intranet/offline, multi-tenant SaaS, code-signed installer
  - Demo video (vedi `docs/Manuali/Script_Screencast.md`)
  - Pricing (link `Listino_Prezzi.md`)
  - Form richiesta demo + signup CTA
  - Pagine legali (T&C + Privacy + Cookie + DPA template)
  - Blog/case study (almeno 1 con cliente reale: DHS stessa)

### 3.2 Materiale sales (one-pager, slide deck)

- **Stato:** todo
- **Owner:** Andrea
- **Costo:** 0-500 € (template + tempo)
- **Blocca:** call commerciali, fiere di settore (SIB, MEET, IBC)
- **Deliverable:** PDF 2 pagine + slide deck Keynote/PowerPoint 10 slide

### 3.3 Demo video tutorial (gia' scriptati Sprint 5b)

- **Stato:** script pronto, registrazione todo
- **Owner:** Andrea (registrazione) + montaggio post-prod
- **Costo:** 200-500 € (mic, OBS, software editing)
- **Riferimento:** `docs/Manuali/Script_Screencast.md`

### 3.4 SEO base

- **Stato:** todo
- **Owner:** Andrea + freelance SEO
- **Costo:** 500-1.500 € setup + 200-500 €/mese mantenimento (opzionale)
- **Keyword target:** "software regia presentazioni eventi", "gestione slide
  conferenze", "presentation switcher live", "speaker timer cloud"

### 3.5 Account social (LinkedIn azienda + YouTube tutorial)

- **Stato:** verificare se esiste pagina LinkedIn `Live Software`
- **Owner:** Andrea
- **Costo:** 0 € (organico) o 200-500 €/mese (sponsorizzate)

---

## 4. Pricing & Listino

### 4.1 Definizione piani definitivi

- **Stato:** bozza in `Listino_Prezzi.md`
- **Owner:** Andrea
- **Note:** Verificare:
  - Free trial 14 vs 30 giorni
  - Limiti hard (eventi/mese, storage, postazioni regia)
  - Discount annuale (20% standard)
  - Volume discount enterprise (>10 tenant)
- **Output atteso:** listino approvato + sincronizzato con `Listino_Prezzi.md`
  - pubblicato sul sito + configurato come Lemon Squeezy products

### 4.2 Politica rinnovo automatico

- **Stato:** decidere
- **Owner:** Andrea
- **Note:** Lemon Squeezy supporta sia subscription auto-rinnovo sia one-time
  payment. Per SaaS pre-Free EU AI Act consigliato auto-rinnovo con notifica
  T-30 (gia' implementata Sprint 7) + diritto di recesso 14 gg (B2C) / clausola
  contrattuale (B2B).

### 4.3 Calcolo costi infrastruttura → margine reale

- **Stato:** stima approssimativa, da formalizzare
- **Owner:** Andrea + commercialista
- **Componenti costo per tenant attivo:**
  - Supabase: ~$0.50-2/mese per tenant medio (DB + storage + Edge)
  - Resend: ~$0.001 per email (4-5 email/mese per tenant = trascurabile)
  - Lemon Squeezy: 5% + $0.50 per transazione
  - Cloudflare CDN: gratuito su piano Pro Live Software
  - Code signing cert Sectigo: 190 €/anno fisso (non per-tenant)
- **Output atteso:** spreadsheet con BEP (break-even point) per ogni piano

---

## 5. Operations & Supporto

### 5.1 Help desk / ticketing

- **Stato:** todo (oggi: solo email diretta `live.software11@gmail.com`)
- **Owner:** Andrea
- **Costo:** 0 € (Notion / GitHub Issues) o 30-100 €/mese (Freshdesk, Zoho Desk)
- **Blocca:** SLA support tier promesso ai clienti Pro/Enterprise
- **Note:** Pre-Sprint 8 sufficiente Notion + form contatto sul sito

### 5.2 Documentazione utente esterna

- **Stato:** parziale (`Manuale_Onboarding_Admin.md` esiste)
- **Owner:** Andrea
- **Note:** Espandere con:
  - FAQ tipica primo cliente
  - Video tutorial dei 3 ruoli (admin, regia, sala)
  - Knowledge base searchable (es. Notion publish, GitBook, Mintlify)

### 5.3 Status page pubblica (uptime monitoring)

- **Stato:** todo
- **Owner:** Andrea
- **Costo:** 0-30 €/mese (UptimeRobot free / Better Uptime)
- **Blocca:** SLA 99.5% promesso ai clienti Pro
- **Output atteso:** `status.liveworksapp.com` con uptime web + Edge Functions

### 5.4 Backup off-site verificati

- **Stato:** Supabase backup automatici esistono, ma non testati restore
- **Owner:** Andrea
- **Note:** Schedulare test restore mensile su DB di staging. Documentare
  procedura disaster recovery in `docs/Operations/`.

### 5.5 SLA monitoring tools

- **Stato:** todo
- **Owner:** Andrea
- **Tools consigliati:**
  - Sentry per error tracking webapp + Edge ($26/mese piano team)
  - Logtail per log aggregation Edge Functions ($5-15/mese)
  - PostHog per product analytics ($0 piano free fino a 1M event/mese)

---

## 6. Pipeline commerciale primi clienti

### 6.1 Lista prospect target (primi 20-30 nomi)

- **Stato:** todo
- **Owner:** Andrea
- **Note:** Identificare aziende eventi che oggi usano metodi obsoleti:
  - Agenzie eventi MICE locali (Roma, Milano, Bologna)
  - Studi audio/video professionali con cliente conferenze
  - Centri congressi (Auditorium Conciliazione, Mico Milano, ecc.)
  - Aziende formazione corporate (con eventi interni mensili)

### 6.2 Demo personalizzata prep (90 minuti)

- **Stato:** scaletta da definire
- **Owner:** Andrea
- **Output:** template demo che funziona in 30-45 minuti (call) oppure
  on-site (90 minuti)

### 6.3 Programma early-adopter

- **Stato:** todo
- **Owner:** Andrea
- **Suggerimento:** Primi 5 clienti → 50% sconto primo anno + accesso a feature
  beta + diritto a casi studio pubblicabili

### 6.4 Referral program

- **Stato:** valutare per fase 2 (post primi 10 clienti)
- **Owner:** Andrea
- **Costo:** struttura tipica: 20% del primo canone annuale del referral

---

## 7. Estensioni prodotto (non Sprint 7)

### 7.1 Multi-lingua espansa (oltre IT/EN)

- **Stato:** infrastruttura pronta (i18next gia' usato)
- **Owner:** Andrea + traduttori freelance
- **Costo:** 0.10-0.20 €/parola per lingua
- **Lingue prioritarie:** ES, FR, DE per mercato EU; PT-BR per Brasile

### 7.2 Mobile companion app (iOS/Android)

- **Stato:** valutare framework (RN / Flutter / .NET MAUI)
- **Owner:** Andrea (decisione tecnica) + sviluppatore mobile
- **Costo:** 8.000-15.000 € MVP esterno, oppure 4-6 mesi self
- **Note:** Per remoti/relatori che caricano slide da smartphone (gia'
  funziona via webapp, ma app dedicata migliora UX)

### 7.3 White-label per agenzie

- **Stato:** non in roadmap immediato
- **Note:** Pricing custom (es. 5.000 €/anno + setup), domain custom, branding
  cliente. Considerare solo se richiesto da prospect specifico.

### 7.4 Marketplace integrazioni Stream Deck / OSC

- **Stato:** in piano per Live Production Suite (futuro stack C#)
- **Note:** Non blocca vendita Slide Center; e' un upsell

---

## 8. Roadmap consolidata (suggerimento timing)

| Fase  | Quando            | Pending da chiudere                                                                                      |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| **0** | Subito (in corso) | Uso interno DHS — nessun pending bloccante (Sprint 7 chiude lo stack tecnico).                           |
| **1** | T+1 mese          | Privacy/T&C/DPA base (1.1, 1.2, 1.3); status page (5.3); Lemon Squeezy products (4.1).                   |
| **2** | T+2-3 mesi        | Sito marketing rivisto (3.1); script demo registrati (3.3); pipeline primi 5 prospect (6.1, 6.3).        |
| **3** | T+4-6 mesi        | DPIA template (1.4); help desk strutturato (5.1); knowledge base pubblica (5.2); referral program (6.4). |
| **4** | T+6-12 mesi       | Multi-lingua aggiuntiva (7.1); valutazione mobile app (7.2); SEO investment (3.4).                       |

---

## 9. Budget complessivo stimato (12 mesi)

| Categoria                                | One-time          | Ricorrente annuale |
| ---------------------------------------- | ----------------- | ------------------ |
| Legale (DPA + T&C + Privacy)             | 1.500-2.500 €     | 300-500 €          |
| Marketing (sito + materiale)             | 2.000-4.000 €     | 0-1.500 €          |
| Tools (status page, support, monitoring) | 0 €               | 600-1.500 €        |
| Lemon Squeezy commissioni                | -                 | 5-7% del fatturato |
| Resend email (oltre Free)                | -                 | 0-240 €            |
| Demo video (registrazione)               | 200-500 €         | -                  |
| Cert code-signing (gia' attivo)          | -                 | 190 €              |
| **Totale base**                          | **3.700-7.000 €** | **1.090-3.930 €**  |

> Fatturato break-even (con piano "Pro" ipotetico a 99 €/mese): ~10-15 tenant
> attivi nel primo anno per coprire i costi non-tech sopra.

---

## 10. Decisioni urgenti (da prendere prima del primo cliente esterno)

1. **Forma giuridica fatturazione:** continuare con P.IVA personale "Live
   Software" oppure costituire SRL/SaaS dedicata? (impatto fiscale + immagine)
2. **Stripe vs Lemon Squeezy:** confermare un solo provider per checkout,
   sincronizzato con Live WORKS APP per coerenza licenze.
3. **Free trial:** 14 giorni full-feature oppure freemium con limiti hard?
4. **Lingua principale prima espansione:** ES (mercato grande, vicino), FR
   (eventi premium), DE (eventi corporate) — scegliere una sola per partire.
5. **Avvocato GDPR di riferimento:** trovarlo prima dei primi 5 clienti.
   Suggerimento: studi specializzati Roma/Milano (~150-200 €/h).

---

**Mantenere aggiornato.** Quando una voce passa a `done`, marcarla qui ed
eventualmente spostarla in un file separato `docs/Commerciale/Done_Externalizzazione.md`
per non appesantire la roadmap.
