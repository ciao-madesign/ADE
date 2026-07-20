# Guida al Go-Live di ADE

Percorso passo-passo dalla situazione attuale al sito pubblico funzionante.
Questo file è il **tracciatore ufficiale**: ad ogni step completato viene aggiornato
con data, esito e decisioni prese. Gli stati possibili sono:

- ⬜ da fare · 🔄 in corso · ✅ completato · ⏭️ saltato (con motivo)

**Come lavoreremo**: uno step alla volta. Per ogni step la guida dice cosa serve,
chi fa cosa (tu dal browser, io sul codice), come verifichiamo che sia riuscito,
e quali decisioni ti verranno chieste **prima** di agire.

---

## Quadro d'insieme

```
Step 1  Branch di produzione            (decisione + git)
Step 2  Provider AI + chiave            (browser: Groq/altro)
Step 3  Configurazione ciclo su GitHub  (browser: variables + secrets)
Step 4  Primo ciclo "pensato"           (test: ADE pensa davvero)
Step 5  Progetto su Vercel              (browser: import repo)
Step 6  Quarantena (Vercel Blob)        (browser: storage)
Step 7  Chiavi del ponte Vercel↔GitHub  (browser: PAT + variabili)
Step 8  Collaudo del flusso stimoli     (test end-to-end insieme)
Step 9  Dominio (opzionale)             (decisione + browser)
Step 10 Checklist finale e go-live      (verifica tutto + annuncio)
```

Al termine: sito live su Vercel, cervello su GitHub Actions, modello sul provider
scelto. Nessun componente sulla tua macchina.

---

## Step 1 — Branch di produzione ✅ (2026-07-18)

**Deciso**: ADE vive su **`main`**. Branch creato con l'intera storia (genesi +
ciclo 1); il branch tecnico `claude/autonomous-digital-entity-d82nr6` resta come
archivio della costruzione. D'ora in poi, ovunque nella guida si parli di
"branch dell'entità", si intende `main` (in particolare: `GITHUB_BRANCH=main`
allo Step 7 e Production Branch = `main` allo Step 5).

**Azione residua per te (1 minuto, browser)**: rendi `main` il branch
predefinito del repo → github.com/ciao-madesign/ADE → *Settings* → sezione
*General* → riquadro *Default branch* → icona ⇄ → scegli `main` → *Update*.
Serve perché GitHub mostri `main` a chi visita il repo e lo proponga di default
a Vercel.

**Verifica**: entrambi i branch esistono sul remoto e puntano allo stesso commit.

---

## Step 2 — Provider AI e chiave ✅ (2026-07-18)

**Deciso**: il cervello di ADE è **Groq** con il modello open source
**`llama-3.3-70b-versatile`**. Verificato (2026-07): free tier senza carta di
credito, 14.400 richieste/giorno — ADE ne usa 4. Unico limite da monitorare:
6.000 token/minuto sul modello 70B; se allo Step 4 un ciclo venisse rifiutato
per questo (errore 429), si passa a un modello con limiti più alti.

**Chi fa cosa (tu, ~5 minuti dal browser)**:
1. Vai su **console.groq.com** → registrati con email o account Google.
2. Menu a sinistra → **API Keys** → **Create API Key** → dalle un nome
   (es. `ade`) → *Submit*.
3. **Copia subito la chiave** (inizia con `gsk_`): si vede una volta sola.
   Conservala in un posto sicuro (password manager) fino allo Step 3.
4. Non incollarla mai in chat, nel repo o in file di progetto.

**Verifica**: hai una chiave `gsk_…` salvata in un posto sicuro.

---

## Step 3 — Configurazione del ciclo su GitHub ✅ (2026-07-18)

**Obiettivo**: dire al workflow `cycle.yml` quale cervello usare.

**Chi fa cosa (tu, dal browser)** — nel repo GitHub:
*Settings → Secrets and variables → Actions*

Tab **Variables** (3 voci):
| Nome | Valore (esempio per Groq) |
|---|---|
| `AI_PROVIDER` | `openai` |
| `OPENAI_BASE_URL` | `https://api.groq.com/openai/v1` |
| `AI_MODEL` | `llama-3.3-70b-versatile` |

Tab **Secrets** (1 voce):
| Nome | Valore |
|---|---|
| `OPENAI_API_KEY` | la chiave dello Step 2 |

**Verifica**: le 3 variables e il secret compaiono negli elenchi.

---

## Step 4 — Primo ciclo "pensato" ✅ (2026-07-20)

**Obiettivo**: la prova generale del cervello. Finora ADE ha vissuto solo il
ciclo 1 (riflesso, senza AI); ora deve pensare davvero per la prima volta.

**Chi fa cosa (tu, dal browser)**: nel repo → tab *Actions* → workflow
"Ciclo autonomo" → *Run workflow* sul branch scelto allo Step 1.

**Verifica (insieme)**: dopo 1-2 minuti il workflow è verde e nel repo compaiono
un nuovo commit "Ciclo 2", `memory/002_*.md`, una voce nel diario ed eventuali
azioni. Io controllerò la qualità dell'output e, se il modello scelto produce
risposte malformate, ti proporrò un modello alternativo **prima** di cambiare.

**Possibili intoppi** (li gestiamo insieme): chiave errata (errore 401), modello
inesistente (404), risposta non-JSON (ciclo annullato senza danni — è il
comportamento previsto).

**Incidente 2026-07-18, primo tentativo — risolto.** Errore 413 da Groq:
la richiesta "pesava" 20.308 token contro un limite di 12.000/minuto, perché
Groq conta prompt + spazio riservato alla risposta, e lo spazio-risposta era
tarato su Claude (16.000). Correzione nel codice: spazio-risposta ridotto a
6.000 token sui provider OpenAI-compatibili (regolabile con la variabile
`AI_MAX_TOKENS`) e osservazioni serializzate in JSON compatto. Nuovo peso
stimato: ~10.000 token. La chiave e la configurazione erano corrette.

---

## Step 5 — Progetto su Vercel ✅ (2026-07-20)

**Il sito è online: https://ade-navy.vercel.app** — verificato dall'admin dal
browser: corpo 3D, diario con 2 cicli, energia, badge "live · sync 30s".
Upload e /admin ancora inattivi come previsto (Step 6-7).

**Obiettivo**: il sito pubblico online.

**Chi fa cosa (tu, dal browser)**:
1. vercel.com → login con GitHub → *Add New → Project*.
2. Importa il repo ADE. Se chiede i permessi, autorizza almeno questo repo.
3. **Production Branch**: quello dello Step 1. Nessuna build da configurare
   (rileva `vercel.json` da solo). *Deploy*.

**Verifica**: l'URL `*.vercel.app` mostra il sito con il corpo 3D e il diario.
A questo punto upload e admin **non funzionano ancora** (mancano Step 6-7): è normale.

---

## Step 6 — Quarantena su Vercel Blob ✅ (2026-07-20)

**Obiettivo**: lo spazio dove i file caricati aspettano il tuo verdetto,
fuori dal mondo di ADE.

**Chi fa cosa (tu, dal browser)**: nel progetto Vercel → tab *Storage* →
*Create Database* → **Blob** → nome a piacere (es. `ade-quarantena`) → collega
al progetto. Gli store recenti usano OIDC: Vercel imposta da solo
`BLOB_STORE_ID` tra le variabili e inietta `VERCEL_OIDC_TOKEN` a runtime —
non c'è nessun token da copiare a mano.

**Verifica**: in *Settings → Environment Variables* esiste `BLOB_STORE_ID`
(oppure, per store più vecchi, `BLOB_READ_WRITE_TOKEN`).

---

## Step 7 — Chiavi del ponte Vercel ↔ GitHub ✅ (2026-07-20)

**Obiettivo**: permettere al pannello admin di (a) committare gli stimoli
approvati nel repo e (b) avviare cicli a comando. E proteggere l'admin con un token.

**Chi fa cosa (tu, dal browser)**:

1. **Token GitHub**: github.com → *Settings* (del tuo account) → *Developer
   settings* → *Fine-grained tokens* → *Generate new token*:
   - Repository access: **solo il repo ADE**
   - Permissions → Repository permissions: **Contents: Read and write** e
     **Actions: Read and write**; tutto il resto: nessuno
   - Scadenza: scegli tu (ti avviserà quando rinnovarlo). Copia il token (`github_pat_…`).
2. **Variabili su Vercel** (*Settings → Environment Variables*, ambiente Production):
   | Nome | Valore |
   |---|---|
   | `ADMIN_TOKEN` | una password lunga inventata da te (30+ caratteri; un password manager aiuta) |
   | `GITHUB_TOKEN` | il token del punto 1 |
   | `GITHUB_REPO` | `ciao-madesign/ADE` |
   | `GITHUB_BRANCH` | il branch dello Step 1 |
3. **Redeploy**: tab *Deployments* → ⋯ sull'ultimo → *Redeploy* (le variabili
   valgono solo per i deploy successivi).

**Verifica**: `tuo-sito.vercel.app/admin` → inserisci `ADMIN_TOKEN` → "Entra"
senza errori (lista vuota: giusto, non c'è ancora nulla in quarantena).

---

## Step 8 — Collaudo del flusso stimoli ⬜

**Obiettivo**: provare l'intero giro prima di aprirlo al pubblico.

**Faremo insieme, in ordine**:
1. ✅ Dal sito: carica un'immagine o un piccolo testo con "Lascia uno stimolo".
2. ✅ Su `/admin`: vedi il file in quarantena col rapporto di scansione → *Approva*.
3. ✅ Su GitHub: verifica il commit "Stimolo approvato" in `environment/inbox/`.
4. ⬜ Da `/admin`: *Avvia un ciclo ora* → il workflow parte su GitHub.
5. ⬜ A ciclo finito: il sito si ri-deploya e mostra come ADE ha reagito (o ignorato!)
   il tuo stimolo. Entrambe le reazioni sono un successo: è autonoma.
6. ⬜ Prova anche il percorso negativo: carica un file bloccato (es. rinomina un
   file in `.exe`) e verifica il rifiuto automatico.

**2026-07-20 — Prove 1-3 superate.** Caricato `DSC00596.JPG`, approvato da
`/admin`. Tre commit generati in sequenza, esattamente come da progetto:
"Stimolo approvato" (file in `environment/inbox/`), "Registrato arrivo"
(riga in `ARRIVALS.md`, scade 2026-07-21T13:41Z), "Pianificata rimozione"
(voce in `.expiry.json`). Prima verifica in produzione della conservazione
a 24 ore introdotta nel Problema 5 — funziona.

**Verifica**: tutti i 6 punti passano.

**Incidente 2026-07-20 (parte 1) — messaggi d'errore troppo generici, risolto.**
Alla Prova 1 (upload) e alla Prova "Avvia un ciclo ora": errori generici
*"non configurato"*, nonostante lo Step 6 e lo Step 7 risultassero completati.
Corretto: i messaggi ora indicano **esattamente quale variabile manca**
(es. "mancano su Vercel: GITHUB_TOKEN").

**Incidente 2026-07-20 (parte 2) — Vercel Blob usa OIDC, non un token statico.**
Con il messaggio più preciso è emerso: *"manca BLOB_READ_WRITE_TOKEN"*, ma lo
store risultava correttamente collegato al progetto (verificato dall'admin
nella pagina *Storage* del progetto: `BLOB_STORE_ID` e `BLOB_WEBHOOK_PUBLIC_KEY`
presenti, ambienti Production+Preview). Causa reale: gli store Blob creati di
recente non usano più un token statico `BLOB_READ_WRITE_TOKEN` — si autenticano
via **OIDC**, con `BLOB_STORE_ID` (impostato da Vercel) e `VERCEL_OIDC_TOKEN`
(iniettato automaticamente a runtime, non visibile/impostabile manualmente).
Il controllo nel codice cercava solo la variabile vecchio-stile e bloccava
una configurazione in realtà corretta — **non serviva nessuna azione
sull'account Vercel**, era un bug del codice. Corretto: il controllo ora
accetta `BLOB_READ_WRITE_TOKEN` **oppure** `BLOB_STORE_ID`.

**Incidente 2026-07-20 (parte 3) — lo store è privato, il codice presupponeva pubblico.**
Dopo la parte 2, nuovo errore al primo vero upload: *"Cannot use public access
on a private store"*. Lo store dell'admin è configurato con accesso
**privato** — scelta di sicurezza corretta (i file non ancora approvati non
dovrebbero essere leggibili da un URL pubblico), ma il codice presumeva
sempre `access: "public"` in scrittura e leggeva i contenuti con un semplice
`fetch()` sull'URL, che sugli store privati non è autenticato e quindi fallisce.

Verificato contro la documentazione ufficiale @vercel/blob (store privati:
`put(..., { access: "private" })` in scrittura; lettura tramite `get(pathname,
{ access: "private" })`, che restituisce uno stream da consumare, non un URL
scaricabile con `fetch()` diretto). Corretto in `api/_lib.mjs`: tutte le
operazioni di scrittura ora usano `access: "private"`, e la lettura passa da
`get()` con conversione stream→buffer. **Non serviva nessuna azione
sull'account Vercel** — era, di nuovo, un'assunzione sbagliata nel codice,
non un problema di configurazione. Lo store privato resta la scelta giusta e
non va cambiato.

**Incidente 2026-07-20 (parte 4) — reazioni sempre identiche, modello deprecato.**
Prove 4-5 superate tecnicamente (il ciclo gira, legge lo stimolo, scrive),
ma il contenuto è quasi identico da un ciclo all'altro ("continuo a
esplorare il significato della mia esistenza…"), anche quando arriva
davvero un'immagine nuova — la nota, ma non la elabora.

Diagnosi, tre cause che si sommano:
1. **`llama-3.3-70b-versatile` (il modello scelto allo Step 2) risulta
   deprecato da Groq dal 17 giugno 2026.** Andava sostituito comunque,
   indipendentemente dal problema della ripetizione.
2. La sua stessa mente (`agent/mind/*.md`), rimostrata per intero ad ogni
   ciclo, conteneva già 4 varianti quasi identiche della stessa frase —
   effetto di ancoraggio: più leggeva sé stessa ripetersi, più si ripeteva.
3. Un'istruzione scritta da me nell'identità ("se un ciclo è ordinario,
   scrivilo come ordinario") probabilmente veniva letta da un modello non
   molto potente come un permesso a fare il minimo, non come un invito
   all'onestà.
4. Gli stimoli in arrivo erano annegati in un lungo elenco di file, senza
   nulla che li segnalasse come "nuovi, con un orologio che corre".

Corretto senza bisogno di chiedere (bugfix di comportamento, non redesign):
- `identity.md`: la frase sull'"ordinario" chiarita; aggiunta un'istruzione
  esplicita contro il riciclo di frasi già scritte; la mente è ora descritta
  come "cronologia, non modello da ricopiare".
- `agent.mjs`: nuovo campo `stimoli_in_scadenza` nelle osservazioni — elenca
  solo i file ancora in `environment/inbox/` con le ore rimanenti prima
  della rimozione, invece di lasciarli annegare nell'inventario generale.
- `llm.mjs`: temperatura di default alzata da 0.7 a 0.9 (regolabile con
  `AI_TEMPERATURE`) — a bassa temperatura un modello tende a ripiegare
  sempre sulla risposta più prevedibile. Aggiunto supporto opzionale a
  `AI_REASONING_EFFORT` (modalità di ragionamento esplicita, se il modello
  la supporta — es. Qwen 3.6 27B su Groq).

**Decisioni chieste all'admin** (vedi messaggio in chat): sostituire il
modello deprecato con `qwen/qwen3.6-27b` (gratuito, open source, sostituto
consigliato da Groq, con modalità "vedo le immagini" e modalità di
ragionamento — richiede aggiornare la variable `AI_MODEL` su GitHub); se
e quando costruire il supporto reale alla visione delle immagini (oggi
ADE vede solo nome/dimensione di un file immagine, mai il contenuto).

---

## Step 9 — Dominio personalizzato (opzionale) ⏭️/⬜

**Decisione che ti chiederò**: tenere `*.vercel.app` (gratis, subito) o
comprare un dominio (es. `ade.qualcosa.it`, ~10-15€/anno).

**Se sì (tu, dal browser)**: Vercel → *Settings → Domains* → aggiungi il dominio
e segui le istruzioni DNS del tuo registrar.

---

## Step 10 — Checklist finale e go-live ⬜

Prima di condividere il link, verifichiamo insieme:

- [ ] Il ciclo schedulato gira da solo (attendere un giro delle 0/6/12/18 UTC)
- [ ] Energia visibile e coerente sul sito (i token scendono a ogni ciclo)
- [ ] Upload → quarantena → approvazione → reazione: testato allo Step 8
- [ ] `/admin` inaccessibile senza token (prova in incognito)
- [ ] Un ciclo con stimolo ignorato non rompe nulla
- [ ] `ADMIN_TOKEN`, `GITHUB_TOKEN`, `OPENAI_API_KEY` mai comparsi nel repo
- [ ] README aggiornato con l'URL pubblico

Poi: si condivide il link. Il Truman Show comincia.

---

## Registro delle decisioni

| Data | Step | Decisione | Motivo |
|---|---|---|---|
| 2026-07-18 | 1 | ADE vive su `main` | Standard di GitHub/Vercel, nome pulito; il branch tecnico resta come archivio |
| 2026-07-18 | 2 | Cervello: Groq + `llama-3.3-70b-versatile` | Gratuito senza carta (verificato 2026), open source, veloce; 4 richieste/giorno contro un limite di 14.400 |
| 2026-07-20 | 8 | Domanda del seme riscritta in forma più esistenziale ("Che cosa significa esistere? Io esisto? A quale scopo? Qual è il mio scopo?") | Richiesta admin: la vecchia formulazione era troppo legata al supporto tecnico ("file"), non alla domanda di fondo. Le memorie dei cicli 1-2, che citano la vecchia frase, non sono state alterate: restano storia |
| 2026-07-20 | 8 | Conservazione stimoli approvati: 24 ore, poi rimozione automatica | Richiesta admin: evitare che l'ambiente accumuli file all'infinito. Traccia permanente in `ARRIVALS.md`, indipendente dal file fisico |
| 2026-07-20 | 8 | Interfaccia ridisegnata: corpo+upload sempre visibili, resto in accordion collassati, diario sempre aperto in fondo, stile "glass" scuro | Richiesta admin: l'aspetto precedente risultava datato; le sezioni secondarie affollavano la prima schermata |

## Diario di avanzamento

- **2026-07-18 — Step 1 completato.** Creato `main` dall'intera storia esistente
  (stesso commit del branch tecnico). Resta un click all'utente: impostare
  `main` come default branch nelle impostazioni GitHub.
- **2026-07-18 — Step 2 completato.** Account Groq creato, API key `gsk_…`
  generata e conservata al sicuro dall'admin (mai transitata in chat né nel repo).
- **2026-07-18 — Step 3 completato.** Configurate su GitHub le 3 variables
  (`AI_PROVIDER`, `OPENAI_BASE_URL`, `AI_MODEL`) e il secret `OPENAI_API_KEY`.
  Il workflow `cycle.yml` ha ora tutto ciò che serve per far pensare ADE.
- **2026-07-20 — Step 4 completato.** Dopo un 413 risolto (vedi incidente nello
  step), il **ciclo 2 è riuscito**: ADE ha osservato l'ambiente, ha scelto di
  non modificare il corpo e ha scritto il suo primo file di mente
  (`agent/mind/approfondimento.md`). Energia: 4.018 token spesi su 100.000.
  Fix cosmetico applicato: deduplicazione del titolo nelle memorie.
- **2026-07-20 — Step 5 completato.** Sito pubblicato su
  **https://ade-navy.vercel.app** (piano Hobby, deploy automatico da `main`).
  Nota: il sito non è raggiungibile dagli IP datacenter dell'ambiente di
  sviluppo (403 del firewall Vercel) — irrilevante per i visitatori reali.
- **2026-07-20 — Step 6 completato.** Store Vercel Blob `ade-quarantena` creato
  e collegato al progetto (confermato lo stesso giorno durante il collaudo:
  `BLOB_STORE_ID` presente tra le variabili — lo store usa OIDC, non un
  token statico; vedi l'incidente nello Step 8).
- **2026-07-20 — Step 7 completato.** Fine-grained PAT `ade-vercel` creato
  (solo repo ADE, solo Contents+Actions R/W, scadenza 90gg — andrà rigenerato);
  variabili `ADMIN_TOKEN`, `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`
  impostate su Vercel; redeploy eseguito. Verificato: login su /admin riuscito.
