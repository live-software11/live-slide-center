# Documentazione commerciale Live SLIDE CENTER

Cartella che raccoglie i materiali pre-vendita e contrattuali del prodotto.
Tutti i documenti sono **bozze tecniche** redatte dal CTO: prima dell'uso
operativo richiedono revisione legale (Contratto SLA) e approvazione di Andrea
Rizzari (Listino Prezzi).

| File                  | Versione | Stato             | Pubblico target                    |
|-----------------------|----------|-------------------|-------------------------------------|
| `Contratto_SLA.md`    | 1.0      | BOZZA legale      | cliente finale + consulente legale  |
| `Listino_Prezzi.md`   | 1.0      | BOZZA commerciale | cliente finale + sito marketing     |

## Allegati al contratto SLA

Quando si firma con il cliente, allegare anche (gia' presenti nel repo):
- `docs/Manuali/Manuale_Installazione_Local_Agent.md` → PDF (Allegato C)
- `docs/Manuali/Manuale_Installazione_Room_Agent.md` → PDF (Allegato D)

Generazione PDF: vedi `docs/Manuali/build-pdf.ps1`.

## Allegato A — DPA ex art. 28 GDPR

**Da redigere con avvocato GDPR specializzato.** Il contratto SLA fa riferimento
a "Allegato A" ma il documento separato non e' incluso in questo repo perche'
richiede consulenza legale specifica e potrebbe contenere dati di responsabili
del trattamento (sub-processor) soggetti a riservatezza.

Schema base raccomandato:
1. Identificazione Titolare (Cliente) e Responsabile (Fornitore)
2. Categorie di dati trattati (relatori, partecipanti, utenti)
3. Categorie di interessati
4. Finalita del trattamento (esclusivamente esecuzione del Servizio)
5. Sub-responsabili autorizzati (Supabase, Cloudflare)
6. Misure tecniche e organizzative (cifratura, RLS, backup, audit log)
7. Procedura notifica data breach (24h)
8. Modalita di restituzione/cancellazione dati a fine contratto
9. Durata del trattamento
10. Foro competente

## Note operative

- I prezzi nel listino sono in **EUR IVA esclusa** salvo specifica diversa
- Lo SLA prevede credito sul canone successivo, NON rimborsi (vedi art. 3.4)
- I limiti di responsabilita (art. 6.2) sono fissati al 100% del canone annuale:
  e' lo standard SaaS B2B italiano, ma da rivedere caso per caso per Enterprise
- Foro competente Roma (art. 10) e' fisso: cambiare solo per clienti enterprise
  con potere contrattuale forte

## Aggiornamenti

Aggiornare questi documenti quando:
- Cambiano i prezzi → bump versione `Listino_Prezzi.md` e comunicare ai clienti
  esistenti con preavviso 90 giorni
- Cambiano gli SLA → bump versione `Contratto_SLA.md` e firmare addendum con
  clienti gia' in subscription
- Si aggiungono sub-responsabili → aggiornare DPA (Allegato A) e notificare
  cliente
