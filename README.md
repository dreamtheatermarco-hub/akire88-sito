# akire88.it

Sito one-page di Akire88: pagine statiche su **GitHub Pages** (cartella `docs/`), modulo di contatto e newsletter su **Supabase** (database in UE + Edge Functions), dominio ed email su **Register.it**.

```
docs/                 ← il sito pubblicato (HTML, CSS, JS, font, immagini)
  assets/js/config.js ← URL e chiave pubblica di Supabase (da compilare)
  CNAME               ← dominio www.akire88.it per GitHub Pages
supabase/
  migrations/         ← tabelle contact_requests e newsletter_subscribers
  functions/contact   ← salva la richiesta e avvisa assistenza@akire88.it
  functions/newsletter← iscrizione con doppia conferma, conferma, disiscrizione
  functions/admin     ← pannello /admin: iscritti e invio newsletter
  functions/mail      ← pannello /admin: posta in arrivo e risposte (IMAP)
  dashboard/          ← le stesse funzioni in un unico file per l'editor web
```

Nessuna libreria esterna, nessun cookie, font ospitati nel sito.

---

## 1. Supabase

1. Crea un progetto (o usa quello esistente) con regione **Central EU (Frankfurt)**.
2. **SQL Editor** → incolla ed esegui `supabase/migrations/20261018000000_sito_akire88.sql`.
3. Pubblica le due funzioni con la [Supabase CLI](https://supabase.com/docs/guides/cli):

   ```bash
   supabase login
   supabase link --project-ref <ID-PROGETTO>
   supabase functions deploy contact
   supabase functions deploy newsletter
   ```

4. Imposta i segreti (Project Settings → Edge Functions → Secrets, oppure da terminale):

   ```bash
   supabase secrets set \
     SMTP_HOST=<server SMTP Register> \
     SMTP_PORT=465 \
     SMTP_USER=assistenza@akire88.it \
     SMTP_PASS='<password della casella>' \
     MAIL_FROM=assistenza@akire88.it \
     NOTIFY_TO=assistenza@akire88.it \
     SITE_URL=https://www.akire88.it \
     ALLOWED_ORIGINS=https://www.akire88.it,https://akire88.it
   ```

   - Il server SMTP lo trovi nel pannello Register, nella sezione della casella email (impostazioni del client di posta). Usa la porta **465 con SSL**: Supabase blocca le porte 25 e 587.
   - `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sono già disponibili nelle funzioni, non vanno aggiunti.

5. Apri `docs/assets/js/config.js` e inserisci **Project URL** e chiave **anon public** (Project Settings → API). Mai la chiave `service_role`.

## 2. GitHub Pages

1. Repository → **Settings → Pages** → *Build and deployment* → Source: **Deploy from a branch**.
2. Branch: **main**, cartella: **/docs** → Save.
3. *Custom domain*: `www.akire88.it` (è già nel file `docs/CNAME`). Quando il DNS è attivo, spunta **Enforce HTTPS**.
4. Consigliato: verifica il dominio dal tuo profilo GitHub (**Settings → Pages → Add a domain**). GitHub ti darà un record TXT da aggiungere su Register: impedisce ad altri di usare il tuo dominio.

## 3. DNS su Register

Pannello Register → dominio `akire88.it` → **Gestione DNS**. Tocca solo questi record e lascia com'è tutto ciò che riguarda la posta (MX, SPF, record `mail`, `pop`, `smtp` ecc.).

| Tipo  | Nome      | Valore                     |
|-------|-----------|----------------------------|
| A     | @ (vuoto) | 185.199.108.153            |
| A     | @ (vuoto) | 185.199.109.153            |
| A     | @ (vuoto) | 185.199.110.153            |
| A     | @ (vuoto) | 185.199.111.153            |
| AAAA  | @ (vuoto) | 2606:50c0:8000::153        |
| AAAA  | @ (vuoto) | 2606:50c0:8001::153        |
| AAAA  | @ (vuoto) | 2606:50c0:8002::153        |
| AAAA  | @ (vuoto) | 2606:50c0:8003::153        |
| CNAME | www       | `<tuo-utente-github>.github.io.` |

Prima elimina gli eventuali record A/CNAME di `@` e `www` che puntano alla pagina di cortesia di Register. La propagazione richiede da pochi minuti a qualche ora; il certificato HTTPS arriva da solo poco dopo.

## 4. Pannello admin (`/admin`)

Indirizzo: https://www.akire88.it/admin/ (escluso dai motori di ricerca, non collegato dal sito).

1. **SQL Editor** → esegui `supabase/migrations/20261018010000_newsletter_campagne.sql` (storico degli invii).
2. **Edge Functions** → nuova funzione chiamata `admin` con il codice di `supabase/dashboard/admin.ts`.
3. **Edge Functions → Secrets** → aggiungi `ADMIN_USER` e `ADMIN_PASSWORD` (password lunga e unica). Facoltativo: `ADMIN_SESSION_HOURS` (default 8).

Nel pannello:
- **Iscritti**: contatori, ricerca, filtro per stato, esportazione CSV, rimozione.
- **Scrivi newsletter**: oggetto, titolo, testo (riga vuota = paragrafo, `**grassetto**`, link automatici), pulsante facoltativo con link. Anteprima con la stessa grafica delle email, invio di prova, poi invio a tutti gli iscritti confermati con conferma.
- **Inviate**: storico con destinatari ed eventuali errori.

Ogni newsletter contiene il link personale di disiscrizione. Register applica limiti di invio orari alle caselle: con liste grandi (centinaia di iscritti) conviene un servizio di invio dedicato.

### Posta (tab "Posta" del pannello)

Legge la casella assistenza@akire88.it via IMAP e permette di rispondere con la grafica Akire88.

1. **Edge Functions** → nuova funzione `mail` con il codice di `supabase/dashboard/mail.ts`.
2. Segreti (facoltativi, hanno già un valore predefinito): `IMAP_HOST` (predefinito `pop.securemail.pro`), `IMAP_PORT` (993). Utente e password sono quelli SMTP; se diversi, `IMAP_USER` e `IMAP_PASS`.

- **Nuove**: senza risposta e non risolti (il pallino indica i non letti) · **Risposte**: già risposti · **Risolte**: chiuse senza rispondere (spam, già gestite) con "Segna come risolta", riapribili · **Tutte**: gli ultimi 80.
- "Risolta" è un'etichetta IMAP (`$Risolta`): il messaggio resta nella casella.
- Aprire un messaggio lo segna come letto; "Segna come non letta" lo riporta indietro.
- La risposta parte da assistenza@akire88.it con titolo facoltativo, testo, pulsante con link, firma e messaggio originale citato. Il messaggio viene segnato come "risposto" (visibile anche in Outlook, Apple Mail ecc.) e una copia va nella cartella Inviata.
- Gli allegati ricevuti sono elencati ma si aprono dal programma di posta.

## 5. Prova finale

- [ ] Il sito si apre su https://www.akire88.it e https://akire88.it reindirizza a www
- [ ] Il modulo "Contattaci" mostra "Richiesta inviata!" e arriva l'email ad assistenza@akire88.it
- [ ] L'iscrizione alla newsletter manda l'email di conferma e il link porta a "Iscrizione confermata!"
- [ ] La riga compare nelle tabelle Supabase
- [ ] Privacy e Cookie si aprono dal footer

## Modifiche future

Modifica i file in `docs/` e fai push su `main`: GitHub Pages pubblica in circa un minuto.
Per provare in locale: `cd docs && python3 -m http.server 8080` e apri http://localhost:8080 (i moduli funzionano solo dal dominio indicato in `ALLOWED_ORIGINS`; per i test aggiungi temporaneamente `http://localhost:8080`).
