# QA Fix Report — Smoke test web app + correzioni puntuali

> **Data:** 18 Aprile 2026
> **Ambiente testato:** Live SLIDE CENTER web (deploy Vercel preview), backend Supabase field-test
> **Account test:** `admin.alpha@fieldtest.local` (admin tenant Alpha) + `live.software11@gmail.com` (super_admin)
> **Esito sintetico:** 6 fix applicati (UI, accessibilita, formato dati, branding) — 2 gap funzionali aperti documentati per pianificazione successiva

---

## 1. Cosa ho fatto in questa sessione

Smoke test guidato da menu su tutta la console:

1. Login + Dashboard (admin tenant)
2. Lista eventi → Dettaglio evento (Produzione, Sessioni, Speakers, Sale & PC)
3. Vista Regia (`/events/:id/live`)
4. Settings utente + cambio lingua
5. Team management
6. Centri Slide
7. Billing
8. Audit log
9. Privacy & GDPR
10. Switch a sessione `super_admin` per `/admin`

Da questo passaggio sono usciti **8 issue**: 6 puntuali (corretti subito) + 2 gap funzionali (lasciati aperti perche' richiedono design decisions).

---

## 2. Bug correttisubito (codice gia' aggiornato sul branch corrente)

Tutti i fix sono passati lint + typecheck (`pnpm --filter @slidecenter/web lint && pnpm --filter @slidecenter/web typecheck`).

### Fix 1 — Dashboard: storage in MB illeggibili (Bug 4)

- **Sintomo:** la card "Spazio di archiviazione" mostrava valori tipo `1048576 MB` (cioe' 1 TB) e nel hint `"Usato 0% di 1048576 MB"`. Branding pagina Billing usa `1 TB` correttamente, dashboard era incoerente.
- **Causa:** `DashboardView.tsx` divideva `bytes / 1024 / 1024` e poi le i18n string `dashboard.storage.usage` / il render diretto facevano append literal di `" MB"`.
- **Fix:**
  - `apps/web/src/features/dashboard/DashboardView.tsx`: ora usa `formatBytes(bytes, locale)` (gia' presente in `apps/web/src/features/upload-portal/lib/format-bytes.ts`) sia per `value` che per `limit`.
  - `packages/shared/src/i18n/locales/{it,en}.json` (chiave `dashboard.storage.usage`): rimosso `MB` literal — ora la stringa contiene solo `{{limit}}` (l'unita' arriva da `formatBytes`).
- **Verifica:** ora la dashboard mostra `1 TB` o `512 GB` o `2.4 GB` a seconda del piano, coerente con la pagina Billing.

### Fix 2 — Sidebar: badge eventi mostra "0" durante il loading (Bug 5)

- **Sintomo:** all'apertura dell'app il badge "Eventi" in sidebar mostrava `0` per un attimo, poi diventava `5` (o quanti). Stesso flash su "Nessun evento" sotto la lista.
- **Causa:** `AppShell.tsx` usava `state.status === 'ready' ? state.data.events : []`, quindi durante `loading`/`idle` rendeva un array vuoto e disegnava il badge `0` + il messaggio "Nessun evento".
- **Fix:**
  - `apps/web/src/app/shell/AppShell.tsx`: introdotto flag `isSidebarLoading` derivato da `state.status` e propagato a `TenantSidebarSections`. Durante loading: il badge non viene renderizzato e al posto di "Nessun evento" / "Nessun PC sala" appare un placeholder `Caricamento eventi…` / `Caricamento PC sala…`.
  - `packages/shared/src/i18n/locales/{it,en}.json` (`appShell.loadingEvents`, `appShell.loadingDevices`): nuove chiavi.
- **Verifica:** prima impressione coerente con lo stato reale, niente piu' "0" fantasma.

### Fix 3 — Lista eventi: testo doppio "In preparazione setup" (Bug 6)

- **Sintomo:** ogni riga di `/events` mostrava sotto il nome `2026-04-18 → 2026-04-20 · In preparazione` e a destra in piccolo `setup`. Lettura percepita: "In preparazione setup" — ridondanza + testo enum tecnico esposto all'utente finale.
- **Causa:** `EventsView.tsx` renderizzava sia il label tradotto (via `eventStatusLabel`) sia il valore enum raw `{ev.status}` come `<span>` separato.
- **Fix:**
  - `apps/web/src/features/events/EventsView.tsx`: rimosso lo `<span>` con `{ev.status}`. Aggiunto componente `EventStatusBadge` che rende il label tradotto come pillola colorata in base allo status (`active` = primary, `setup` = warning, `closed/archived` = dim).
- **Verifica:** ogni evento mostra UNA sola label leggibile, colorata per stato, niente piu' enum raw.

### Fix 4 — Vista Regia: `<ActivityFeed>` duplicato nel DOM (Bug 9)

- **Sintomo:** in `/events/:id/live` l'activity feed era presente DUE volte nel DOM (un `<aside>` per `lg+` con `hidden lg:block` e un `<div>` per mobile con `lg:hidden`). Visivamente ne vedevi sempre uno solo, ma uno screen reader leggeva il landmark `Activity` due volte.
- **Causa:** doppia copia con visibilita' gestita solo via classi Tailwind, niente `aria-hidden` ne' render condizionale.
- **Fix:**
  - Nuovo helper `apps/web/src/lib/use-media-query.ts` (`useMediaQuery(query: string): boolean` con `useSyncExternalStore` — pattern React 19 che evita l'errore `react-hooks/set-state-in-effect`).
  - `apps/web/src/features/live-view/OnAirView.tsx`: usa `useMediaQuery(BREAKPOINTS.lg)` per rendere UNA sola istanza di `<ActivityFeed>` (a destra in lg+, sotto in mobile).
- **Verifica:** screen reader riceve un solo landmark; bundle invariato (stesso componente, layout dinamico).
- **Bonus:** `useMediaQuery` riusabile per fix futuri di duplicazioni mobile/desktop.

### Fix 5 — Onboarding: due bottoni con accessible name "Salta tour" (Bug A)

- **Sintomo:** la modal di onboarding nuovo tenant esponeva due bottoni con stesso `aria-label`/testo "Salta tour" (icona X in alto a destra + bottone testuale in fondo). Tab keyboard + screen reader li annunciava entrambi nel modo "Salta tour, button" → ambiguita'.
- **Fix:**
  - `apps/web/src/features/onboarding/components/OnboardingWizard.tsx`: il bottone `<X>` in alto-destra ora usa `t('onboarding.close')` ("Chiudi" / "Close") come `aria-label` + `title`, mantenendo il bottone in fondo come "Salta tour".
  - `packages/shared/src/i18n/locales/{it,en}.json`: nuova chiave `onboarding.close` ("Chiudi" / "Close").
- **Verifica:** i due elementi hanno semantica distinta: "Chiudi" (X icona) vs "Salta tour" (call-to-action testuale).

### Fix 6 — Super_admin in `/admin`: nessun bottone Logout + branding incoerente (bonus)

- **Sintomo:**
  1. In `/admin` (variant `admin` di AppShell) il `UserFooter` rimuoveva il bottone Logout — il super_admin non aveva modo di uscire dalla console admin senza ricaricare la pagina o usare URL diretti.
  2. La pagina di login mostrava "Accedi al Slide Center" mentre il display name ufficiale e' "Live Slide Center" → branding incoerente.
- **Fix:**
  - `apps/web/src/app/shell/AppShell.tsx`: rimosso il check `variant === 'admin' ? null` da `UserFooter`. Logout ora mostrato in entrambi i variant (resta escluso solo in modalita' desktop Tauri, dove il logout passa altrove). Rimossa la prop `variant` non piu' utilizzata.
  - `packages/shared/src/i18n/locales/it.json`: `auth.loginPageTitle` → "Accedi a Live Slide Center", `errorTenantMissingLogin` → "...richiesta per Live Slide Center..." + `tenantSuspendedBody` / `a11yLoginTitle` allineati. Le occorrenze di "Centro Slide" / "Centri Slide" sono state lasciate intatte perche' designano il **modulo PC server desktop**, non il prodotto.
- **Verifica:** super_admin ora puo' fare logout dal sidebar admin; branding coerente con `app.displayName` "Live Slide Center" su tutta la console.

---

## 3. Gap funzionali aperti (NON corretti — richiedono decisione di prodotto)

### Gap A — TeamView: nessuna lista membri attivi (Bug 10) — IMPATTO MEDIO

- **File:** `apps/web/src/features/team/TeamView.tsx`
- **Sintomo:** la pagina `/team` mostra ESCLUSIVAMENTE lo stato delle invite (`team_invitations`: pending / accepted / expired). Non c'e' alcuna lista dei membri ATTUALMENTE ATTIVI sul tenant (`public.users` con role admin/coordinator/tech).
- **Conseguenza pratica:**
  - L'admin non vede chi sono i suoi coordinatori/tech una volta che hanno accettato l'invito.
  - Non puo' rimuovere/suspendere/cambiare ruolo a un membro esistente — operazione possibile solo via SQL diretto o super_admin.
  - Il flusso "vedo team → modifico ruolo" non esiste in UI.
- **Cosa serve per chiudere il gap:**
  1. Query parallela su `public.users WHERE tenant_id = current_tenant_id` (RLS gia' garantisce isolamento).
  2. Merge UI: tab o sezione separata "Membri attivi" + "Inviti pendenti" — da disegnare.
  3. Decidere quali azioni esporre per riga membro: rimuovi accesso? cambia ruolo? deattiva?
  4. Eventuale RPC server per cambio ruolo / disattivazione (audit trail).
- **Stima:** 1-2 giornate (UI + RPC + i18n + test E2E).
- **Raccomandazione:** Sprint dedicato "Team management v2" prima del field test commerciale; per il field test interno e' sufficiente l'attuale.

### Gap B — Super_admin: nessuna dashboard tenant funzionante a `/`

- **File:** `apps/web/src/features/dashboard/DashboardView.tsx` (branch `if (role === 'super_admin')`)
- **Sintomo:** se un super_admin entra dalla rotta tenant `/` (anziche' `/admin`), vede solo il titolo "Dashboard" + link "Vai ad Amministrazione". Sidebar tenant vuota perche' `useSidebarData` ritorna `EMPTY` quando `tenantId` e' null (super_admin non ha tenant).
- **Causa:** scelta di design corretta ma incompleta — il super_admin non ha senso renderizzato in `RootLayout`/tenant.
- **Cosa serve:**
  - Opzione A (consigliata): redirect automatico `/` → `/admin` per super_admin in `RequireAuth`.
  - Opzione B: rendere la dashboard tenant utile anche al super_admin (panoramica multi-tenant) — overkill per ora.
- **Stima:** 30 minuti (opzione A).
- **Raccomandazione:** fix rapido in prossimo sprint.

---

## 4. Aree non testate in questa sessione (rimangono nei TODO)

| Area                                      | Motivo skip                                                                                  | Suggerimento                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Signup nuovo tenant + onboarding completo | Richiede creazione tenant pulito + verifica email; il login era gia' attivo come super_admin | Dedicare 30 min con email reale per testare onboarding Step 1→3 + seed demo                 |
| Super_admin: gestione tenant + audit log  | Esplorato visivamente ma non con CRUD attivo                                                 | Verificare crea/sospendi tenant + filter audit log su date/action/severity                  |
| RLS isolation cross-tenant                | Test via URL manipulation richiede 2 sessioni parallele                                      | Test con account `admin.alpha` che tenta GET `/events/:id` di tenant Bravo → atteso 404/403 |
| Vista Regia con dati live reali           | In assenza di PC sala connesso non si vede la pipeline `room_state` reale                    | Da fare in field test con almeno un Tauri Room Agent attivo                                 |

---

## 5. File modificati in questa sessione

```
apps/web/src/app/shell/AppShell.tsx                       — fix 2 + fix 6
apps/web/src/features/dashboard/DashboardView.tsx          — fix 1
apps/web/src/features/events/EventsView.tsx                — fix 3 (+ EventStatusBadge)
apps/web/src/features/live-view/OnAirView.tsx              — fix 4
apps/web/src/features/onboarding/components/OnboardingWizard.tsx — fix 5
apps/web/src/lib/use-media-query.ts                        — nuovo hook (per fix 4)
packages/shared/src/i18n/locales/it.json                   — coppie i18n (fix 1, 2, 5, 6)
packages/shared/src/i18n/locales/en.json                   — coppie i18n EN
docs/QA_FIX_REPORT_2026-04-18.md                           — questo file
```

---

## 6. Comandi di verifica eseguiti

```bash
pnpm --filter @slidecenter/web typecheck   # OK (0 errori)
pnpm --filter @slidecenter/web lint        # OK (0 errori, 0 warning)
```

Nessun test E2E lanciato (Playwright) — i fix sono di superficie UI, copertura visiva diretta su browser durante il smoke test.

---

## 7. Prossimi passi suggeriti per Andrea

1. **Pull dei fix sul branch di lavoro** + visual regression rapida sulle pagine: Dashboard, Events list, Onboarding modal, Vista Regia.
2. **Decidere Gap A (TeamView):** sprint dedicato prima di vendere a clienti che hanno team > 1 utente.
3. **Decidere Gap B (super_admin redirect):** fix da 30 min, candidato a hot-patch immediato.
4. **Procedere con i test rimanenti** (signup, RLS isolation cross-tenant) prima del primo field test reale.
