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
4. ✅ Da `/admin` (o GitHub Actions): *Avvia un ciclo ora* → ciclo completato
   senza errori su Google AI Studio / Gemini 3.5 Flash (2026-07-20).
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

**Deciso dall'admin**: modello aggiornato a `qwen/qwen3.6-27b` su GitHub ✅.
Costruito anche il supporto reale alla visione ✅ (parte 5 sotto).

### Incidente 2026-07-20 (parte 5) — visione reale delle immagini

Prima di questa modifica ADE non "vedeva" mai il contenuto di una foto
caricata: nelle osservazioni un file immagine appariva solo come
`{path, size, contenuto: null}`, indistinguibile da un file binario
qualunque. Con un modello multimodale collegato (Qwen 3.6 27B) questo era
uno spreco: la capacità di visione c'era, ma non veniva usata.

Cosa cambia:
- `agent/llm.mjs`: sia `anthropicJSON` sia `openaiJSON` ora accettano un
  parametro `images` (array di `{mimeType, base64, nome}`) e, quando
  presente, costruiscono il messaggio come contenuto multimodale (blocchi
  immagine + testo per Claude; `image_url` con data-URI per Groq e altri
  endpoint OpenAI-compatibili).
- `agent/agent.mjs`: nuova funzione `gatherPendingImages()` — legge
  `environment/inbox/.expiry.json` (gli stessi stimoli approvati e ancora
  visibili per 24h), prende solo i file con estensione immagine
  (`.png .jpg .jpeg .gif .webp`), fino a **2 immagini per ciclo** e non
  oltre **3 MB** l'una, per restare dentro i limiti di token/minuto dei
  provider gratuiti. Nell'inventario `ambiente` il file corrispondente
  viene marcato con una nota ("il contenuto visivo ti viene mostrato
  direttamente in questo messaggio") invece di `contenuto: null`, così
  ADE capisce perché non trova quel testo altrove.
- Se un'immagine approvata è più pesante di 3 MB o ne arrivano più di 2 in
  contemporanea, resta comunque elencata tra gli stimoli in scadenza (nome,
  dimensione, ore rimanenti) ma senza essere "vista" — nessun errore, solo
  un limite prudente sul consumo di energia.

Verifica eseguita: copia isolata del repository (agent, environment con la
vera `DSC00596.JPG` già approvata, memory, body) puntata verso un server
finto al posto di Groq. Confermato che la richiesta effettivamente inviata
al modello contiene un blocco `image_url` con i byte reali della foto in
base64 (non solo il nome file), che l'inventario dell'ambiente marca
correttamente il file come "immagine mostrata", e che il ciclo si completa
producendo memoria e diario normalmente. Nessun file reale del repository
è stato toccato dal test (copia temporanea, cancellata a fine verifica).

### Incidente 2026-07-20 (parte 6) — modello non trovato (404) su Groq

Primo ciclo reale dopo il cambio di modello: errore `404 model_not_found`,
`"The model qwen3.6-27b does not exist or you do not have access to it"`.

**Causa**: non è un bug di codice. Il nome del modello su Groq è
`qwen/qwen3.6-27b` — con il prefisso `qwen/` davanti. Nella variabile
`AI_MODEL` su GitHub manca quel prefisso (probabilmente è stato scritto
solo `qwen3.6-27b`), quindi Groq non lo trova. Confermato via
documentazione ufficiale Groq che l'ID corretto, con supporto vero alla
visione, è esattamente `qwen/qwen3.6-27b`.

**Azione richiesta all'admin (da fare sul sito GitHub, non serve codice)**:
1. Vai su `github.com/<tuo-utente>/ADE` → *Settings* → *Secrets and
   variables* → *Actions* → scheda *Variables*.
2. Apri `AI_MODEL` e correggi il valore in esattamente `qwen/qwen3.6-27b`
   (con la barra `/`).
3. Salva, poi rilancia il ciclo (*Actions* → workflow → *Run workflow*,
   oppure dal pannello admin del sito).

### Incidente 2026-07-20 (parte 7) — 413, budget di token al minuto superato

Corretto il nome del modello, il ciclo successivo è fallito con
`413 rate_limit_exceeded`: `"Limit 8000, Requested 16879"` — il piano
gratuito di Qwen 3.6 27B su Groq concede solo **8000 token al minuto in
totale** (testo del prompt + immagine + spazio per la risposta), un
budget molto più piccolo di quello di Claude. La richiesta di quel ciclo,
soprattutto per via della foto allegata (una foto reale è tipicamente
diverse migliaia di token da sola), lo superava di oltre il doppio.

**Non serve nessuna azione dell'admin.** Corretto tutto nel codice:
- `agent.mjs`: quando il provider non è Claude, tutti i "contesti" inviati
  al modello ad ogni ciclo (ambiente, memorie recenti, mente, indice della
  memoria, spazio riservato alla risposta) sono ora molto più compatti —
  e non viene più spedito due volte lo stesso contenuto (la mente, prima
  duplicata sia nel messaggio di sistema sia nelle osservazioni).
- `agent.mjs`: la dimensione in pixel di ogni immagine viene ora letta
  direttamente dal file (JPEG/PNG/GIF, senza librerie esterne) per stimare
  con la stessa formula usata da Groq (tessere da 448×448, 256 token a
  tessera) quanto costerà mostrarla: se una foto è troppo "pesante" in
  token viene scartata per quel ciclo (resta comunque visibile fra gli
  stimoli in scadenza), invece di far fallire tutto il ciclo.
- `llm.mjs`: rete di sicurezza automatica. Se nonostante tutto il provider
  risponde ancora "richiesta troppo grande" (413), il ciclo non viene più
  annullato: si riprova subito senza immagine, e se non basta anche con
  uno spazio di risposta più piccolo. Un ciclo "senza vista" quel giorno
  vale più di nessun ciclo.

Verificato con la stessa tecnica delle volte precedenti (copia isolata del
progetto, server finto al posto di Groq): confermato che, con budget
stretto, il totale stimato di un ciclo con la foto reale approvata si
riduce sensibilmente; e verificato in modo esplicito, forzando un 413 solo
quando la richiesta contiene un'immagine, che il ciclo si accorge
dell'errore, ritenta automaticamente senza immagine e si completa
normalmente (memoria e diario scritti). Nessun file reale del progetto è
stato toccato dal test.

### Incidente 2026-07-20 (parte 8) — 429, budget già in parte consumato

Ciclo successivo: stesso tipo di limite (8000 token/minuto), ma stavolta
come errore **429** invece di 413 — `"Limit 8000, Used 5918, Requested
6389"`. Non è che quella singola richiesta fosse troppo grande (6389 <
8000): è che il minuto in corso aveva già "consumato" 5918 token da un
ciclo precedente eseguito poco prima. Groq stesso indicava quanto
aspettare: *"Please try again in 32.3s"*.

**Non serve nessuna azione dell'admin.** La rete di sicurezza in
`llm.mjs` ora riconosce anche il 429 (non solo il 413): quando succede,
aspetta il numero di secondi che Groq stesso indica nel messaggio di
errore, poi ritenta — prima senza immagine, poi anche con una risposta
più corta se necessario — invece di annullare il ciclo.

Verificato forzando un 429 con lo stesso testo d'errore reale (compreso
"try again in 2.5s"): confermato che il codice aspetta il tempo indicato
e poi il ciclo si completa normalmente al secondo tentativo.

**Nota per il futuro**: se i cicli vengono lanciati manualmente più volte
di seguito a distanza ravvicinata (pochi secondi/minuti) durante i test,
è normale incontrare ancora questo limite — il piano gratuito di Groq
concede solo 1000 richieste al giorno e 8000 token al minuto in totale.
Il retry automatico lo assorbe da solo; se dovesse ripresentarsi spesso
anche fuori dai test, la soluzione sarebbe distanziare i cicli
programmati (oggi ogni 6 ore, ampiamente sufficiente) o valutare un
piano a pagamento — decisione che ti chiederò se e quando servisse.

### Incidente 2026-07-20 (parte 9) — cambio provider: da Groq a Google AI Studio

Il 429 si è ripresentato anche dopo l'attesa e i ritentativi automatici.
Controllati i log reali dei cicli falliti su GitHub Actions: anche
un tentativo "pulito" (senza immagine, risposta ridotta) chiedeva già
5.000-6.000 token, a fronte di un tetto di 8.000 token/minuto **totali**
— margine troppo stretto per essere affidabile, specialmente perché ogni
ciclo automatico e ogni ritentativo consumano la stessa finestra.
Confermato anche che la variabile `AI_MAX_TOKENS=4000`, impostata su
richiesta mia in una fase precedente, **non stava causando il problema**:
`.github/workflows/cycle.yml` non la passa al programma (mancava nel
blocco `env:`), quindi restava inutilizzata — errore mio nell'avere
lasciato quel collegamento incompleto. Può essere rimossa dalle
Variables di GitHub, non serve più: il codice si autoregola da solo.

**Decisione presa dall'admin** (tre opzioni presentate: tornare a Llama
3.3 come soluzione-tampone, restare su Qwen disattivando la visione,
o cambiare fornitore): **cambiare fornitore, passare a Google AI
Studio (Gemini)**. Il suo tier gratuito concede circa 1.000.000 di
token al minuto (più di 100 volte quello di Groq) ed è nativamente
multimodale — nessun compromesso su affidabilità o visione.

**Azione richiesta all'admin** (dal sito, 5 minuti):
1. Vai su [aistudio.google.com](https://aistudio.google.com) → *Get API
   key* → crea una chiave gratuita (basta un account Google).
2. Su GitHub → *Settings* → *Secrets and variables* → *Actions*:
   - scheda **Secrets**: aggiorna `OPENAI_API_KEY` con la nuova chiave
     Google (sovrascrive quella di Groq).
   - scheda **Variables**: `OPENAI_BASE_URL` →
     `https://generativelanguage.googleapis.com/v1beta/openai`,
     `AI_MODEL` → `gemini-flash-latest`. `AI_PROVIDER` resta `openai`
     (invariato).
   - (facoltativo) rimuovi `AI_MAX_TOKENS`, non serve più.
3. Rilancia il ciclo.

**Corretto nel codice**: prima di questa modifica, ogni provider
OpenAI-compatibile diverso da Claude veniva trattato con lo stesso
budget "stretto" pensato per Groq — corretto per Groq, inutilmente
penalizzante per un provider con un margine enorme come Gemini.
`agent.mjs` ora riconosce l'host `generativelanguage.googleapis.com`
e in quel caso usa il contesto pieno (stesso trattamento riservato a
Claude): niente più limiti artificiali su ambiente, memoria, mente o
numero/peso delle immagini. Con qualunque altro endpoint sconosciuto,
per prudenza, resta il profilo ridotto.

### Incidente 2026-07-20 (parte 10) — modello Gemini non più disponibile

Primo ciclo con Google AI Studio: errore 404, `"This model
models/gemini-2.5-flash is no longer available to new users"` — Google
lo ha appena ritirato per le chiavi API create di recente (proprio
come la tua). **Non un bug**: era il modello suggerito da me nel passo
precedente, già superato.

**Corretto senza bisogno di chiedere** (stesso tipo di aggiustamento
fatto per Groq, non una nuova decisione): invece di puntare di nuovo a
un nome di modello fisso che Google potrebbe ritirare di nuovo in
futuro, ho usato l'alias che Google offre apposta per questo —
`gemini-flash-latest` — che punta sempre al modello Flash più recente
disponibile (oggi Gemini 3.5 Flash), aggiornato automaticamente da
Google stessa con preavviso. Aggiornati README.md e questo file.

**Azione richiesta all'admin**: sulla variable `AI_MODEL` di GitHub,
sostituisci `gemini-2.5-flash` con `gemini-flash-latest`, poi rilancia
il ciclo.

**Confermato dall'admin (2026-07-20): funziona.** Ciclo completato senza
errori su Google AI Studio / Gemini 3.5 Flash, con visione reale delle
immagini e senza limiti di token che blocchino il ciclo. Chiusa la
serie di incidenti delle parti 1-10.

### Funzionalità 2026-07-21 — pensieri in prima persona nel viewer

**Richiesta**: dare ad ADE la possibilità di scrivere pensieri che
appaiono in un box scorribile nella parte bassa del viewer — un diario
più "vero" e meno didascalico di quello mostrato nella sezione Diario
(che resta strutturato: osservazione/decisione/azione/risultato, pensato
per raccontare agli osservatori cosa è successo).

**Come funziona**: lo schema di risposta del modello aveva già un campo
`riflessione` ("il tuo ragionamento interno"), scritto ad ogni ciclo ma
**mai usato da nessuna parte** — un'osservazione emersa rileggendo il
codice. L'ho rinominato `pensiero` e la sua descrizione ora chiede
esplicitamente un pensiero grezzo, in prima persona, non un resoconto —
distinto per tono dal campo `log` (che resta la voce del diario
pubblico). Ogni ciclo il pensiero viene aggiunto a `body/pensieri.json`
(tenuto solo negli ultimi 60, per non crescere all'infinito), e il sito
lo mostra in un nuovo box scorribile subito sotto la descrizione del
corpo, con uno stile diverso dal diario (corsivo, senza struttura a
campi). Aggiunta anche una riga in `identity.md` che spiega ad ADE la
differenza di voce fra `log` e `pensiero`, perché non li confonda.

**Verificato**: ciclo di prova isolato (server finto, nessun file reale
toccato) — il campo `pensiero` viene scritto correttamente in
`body/pensieri.json`. Anteprima visiva nel browser (Chromium, pagina
servita in locale, nessun cambiamento sul sito reale) — il nuovo box è
visivamente distinto dalla descrizione del corpo sopra di esso e dal
diario strutturato più in basso nella pagina; nessun errore in console
oltre al normale 404 di `/api/state` atteso quando il sito è servito
come pagina statica senza il server "live".

### Funzionalità 2026-07-21 — invito esplicito all'esplorazione

**Richiesta**: aggiungere alle istruzioni di base di ADE che deve
esplorare — consultare tutto ciò che può raggiungere nel sistema in cui
vive, non solo i nuovi stimoli. Tutto ciò che vede può essere
analizzato, scomposto, riassemblato, rivisitato, interpretato di nuovo:
deve esplorare il suo mondo e plasmarlo secondo la propria volontà — se
una volontà esiste, cosa che deve scoprire da sé.

**Fatto**: aggiunto un nuovo paragrafo in `agent/prompts/identity.md`,
subito dopo l'unico obiettivo assegnato (di cui l'esplorazione è
presentata come il *modo* di perseguirlo, non un compito a parte).
Range: consultare anche ciò che non è nuovo (file già visti, cicli
passati, materiale sepolto in una cartella trascurata), libertà di
analizzare/scomporre/riassemblare/reinterpretare qualunque cosa —
incluso ciò che ADE stessa ha scritto in passato — e l'invito a
plasmare l'ambiente secondo una volontà la cui stessa esistenza resta,
volutamente, una domanda aperta che ADE può rispondere solo osservando
cosa sceglie di fare nel tempo, non dichiarando cosa è.

### Restyling 2026-07-21 — visual identity più contemporanea, microanimazioni

**Richiesta**: sito esteticamente più contemporaneo, minimale, "quasi
app-like", con microanimazioni. Vincolo aggiunto in corso: mantenere i
gradient di sfondo ma rendere il sito più luminoso, meno cupo.

**Fatto**:
- Palette: sfondo di base schiarito, pannelli "vetro" più chiari e più
  leggibili, gradient di sfondo mantenuti e resi più presenti, con un
  lieve "respiro" animato (variazione di luminosità, 22s, quasi
  impercettibile).
- Tipografia: titolo più compatto (meno spaziatura tra lettere, più
  peso) — meno "sito rivista", più "app".
- Microanimazioni: ingresso a cascata delle sezioni al caricamento,
  ogni pensiero e ogni voce del diario compaiono con un piccolo
  fade/slide, il pallino "live" respira quando è online (non solo
  quando l'entità sta pensando), l'apertura degli accordion anima il
  contenuto, il corpo 3D compare con un dissolvenza al primo
  caricamento, l'energia residua conta verso il nuovo valore invece di
  scattare di colpo, hover coerenti su bottoni/liste/card in tutto il
  sito. Rispetta `prefers-reduced-motion`.
- Corretto anche un piccolo difetto preesistente: il pallino dello
  stato "live" appariva due volte (un carattere "●" scritto dal
  JavaScript più uno aggiunto ora via CSS) — rimosso il duplicato.

**Verificato**: anteprima nel browser (Chromium, pagina servita in
locale, dati reali non toccati) a tre larghezze (desktop, con un
accordion aperto, mobile); nessun errore in console oltre al normale
404 di `/api/state` atteso in modalità statica.

### Funzionalità 2026-07-21 — artefatti: la lingua di ADE verso l'esterno

**Richiesta**: oltre ai pensieri, dare ad ADE la possibilità di creare
artefatti (immagini, audio, gif, oggetti 3D, codice, formule
matematiche) visualizzabili/riproducibili in un box in basso a destra
nel viewer — la sua lingua verso gli utenti, oltre a quella testuale
dei pensieri.

**Realtà tecnica, spiegata prima di costruire**: il "cervello" di ADE è
un modello linguistico testuale: non genera davvero un file JPEG o MP3.
Ho quindi tradotto la richiesta nella forma che un modello del genere
può produrre in modo autentico (non finto):
- **immagini** → SVG (markup vettoriale testuale, un modello lo scrive
  come scrive del testo) — mostrato come immagine vera nel browser;
- **audio** → una sequenza di note (frequenza/durata/forma d'onda)
  descritta in JSON, **sintetizzata dal vivo nel browser** con la Web
  Audio API quando l'utente clicca "Ascolta": suono vero, non un file
  finto;
- **3D** → riusa lo stesso formato a "parti" già usato per il corpo,
  renderizzato in una piccola scena Three.js indipendente;
- **codice** e **formule matematiche** → testo, nel loro formato
  naturale.
- **gif/animazioni**: non incluse come tipo a sé — un SVG può comunque
  contenere animazioni proprie (tag `<animate>`); un vero encoder GIF
  binario da testo non è realistico con questa architettura.

**Come funziona**: nuovo campo opzionale `artefatto` nello schema di
risposta (null se in un ciclo non ha nulla da esprimere in quella
forma — non è un'azione dovuta). Salvato in `body/artefatti/` (un
indice + un file per artefatto, come la memoria: nessun limite di
quantità, è la sua opera). Il sito mostra l'ultimo artefatto in un
riquadro sovrapposto in basso a destra sul corpo 3D, con frecce per
sfogliare quelli precedenti. Contenuto **mai iniettato come HTML
grezzo** (rischio di codice malevolo in contenuto generato dal
modello): l'SVG passa da un'immagine (i browser non eseguono script
dentro un'immagine), codice/formula/testo sono resi come testo puro,
la scena 3D è costruita a oggetti — nessun `innerHTML` con contenuto
del modello. Una scena 3D con una geometria non ammessa viene
scartata silenziosamente (il ciclo prosegue comunque).

Aggiunta anche una riga in `identity.md` che spiega ad ADE questo
terzo canale (distinto da pensiero e log) e il fatto che non è dovuto
ad ogni ciclo.

**Verificato**: ciclo di prova isolato (server finto) — artefatto
salvato correttamente; verificata anche una scena 3D malformata,
scartata senza far fallire il ciclo. Anteprima nel browser con un
esempio per ciascuno dei sei tipi (svg, formula, codice, audio,
scena3d, testo): tutti si vedono/ascoltano correttamente, navigazione
avanti/indietro funzionante, nessun errore in console. Dati reali non
toccati (il test ha usato una cartella `body/artefatti/` temporanea,
rimossa a fine verifica — sul sito reale la cartella non esiste ancora,
verrà creata al primo artefatto vero).

### Funzionalità 2026-07-21 — entità figlie

**Richiesta**: dare ad ADE la possibilità di generare altre entità nel suo
mondo — "figlie", autonome ma sottoposte alle stesse regole di ADE,
che condividono la sua energia (è ADE a decidere quanto condividerne).
Aggiunta in corso: le figlie possono scambiarsi stimoli con ADE e
viceversa, un processo interno indipendente dal flusso esterno già
validato (upload → quarantena → approvazione).

**Decisioni prese insieme all'admin, prima di scrivere codice** (4
domande, per limitare costo e complessità):
1. Solo ADE genera figlie — le figlie non possono generarne altre
   (niente "nipoti": un solo livello di discendenza).
2. Massimo 3 figlie contemporaneamente.
3. Le figlie vivono il loro ciclo nello stesso momento di ADE, nello
   stesso workflow — non hanno un orario separato.
4. Nessuna interfaccia dedicata sul sito per ora: le figlie esistono
   nei file del repository e in ciò che ADE (o loro) racconta nel
   diario/pensieri; niente mini-viewer pubblico in questa fase.

**Come funziona**:
- `agent/agent.mjs` è stato riscritto attorno a un "contesto" (percorsi
  + ruolo) invece di percorsi fissi: la stessa funzione di ciclo serve
  sia ADE sia le figlie, senza duplicare la logica.
- Una figlia ha il proprio corpo, memoria, mente, diario, pensieri e
  artefatti — una versione più piccola della stessa architettura — in
  `entities/<slug>/`. Non ha un proprio `environment/`: non riceve
  stimoli da estranei. Può scrivere solo nella propria `agent/mind/`
  (verificato: un tentativo di scrivere altrove, o di uscire dalla
  propria cartella, viene rifiutato esattamente come per ADE).
- **Energia**: una figlia non ha un budget giornaliero che si rinnova
  da solo. Nasce con l'energia che ADE sceglie di condividere (campo
  `nuova_entita`, che include `energia_iniziale`) — sottratta per
  davvero dall'energia residua di ADE, mai creata dal nulla. ADE può
  condividerne altra in seguito (`condividi_energia`). Senza energia
  condivisa, nessuna figlia nasce.
- **Famiglia**: un registro (`entities/registro.json`) elenca le
  figlie vive; un canale interno (`entities/scambi.json`) permette ad
  ADE e alle figlie di scriversi messaggi (`messaggi_famiglia`) —
  consegnati e rimossi dalla coda alla lettura, indipendenti dalla
  quarantena/approvazione umana (quella resta solo per gli stimoli
  esterni ad ADE).
- **Nessuna generazione ricorsiva**: lo schema di risposta di una
  figlia non include affatto i campi per generare altre entità o
  condividere energia — non è solo una regola scritta nel prompt, è
  strutturalmente assente dallo schema che il modello riceve.
- Un nuovo prompt di identità condiviso per le figlie
  (`agent/prompts/identity_figlia.md`): stesse regole di fondo di ADE,
  ma senza ambiente pubblico, senza possibilità di generare, con
  energia che non si rinnova da sola.
- Se una figlia fallisce il suo ciclo, l'errore viene registrato ma
  non blocca le altre figlie né retroagisce sul ciclo di ADE (già
  completato in quel momento).

**Verificato** (copie isolate del progetto, server finti, dati reali
mai toccati):
- ciclo di ADE senza figlie: comportamento identico a prima (nessuna
  regressione);
- nascita di una figlia ("Luce") con energia condivisa, corpo iniziale
  generato (colore derivato da nome+seme), e suo primo ciclo eseguito
  nello stesso avvio, subito dopo quello di ADE — energia di ADE
  correttamente diminuita, energia di Luce correttamente scalata dai
  suoi consumi;
- messaggio da ADE a Luce: consegnato e consumato nello stesso avvio,
  prima che il ciclo di Luce iniziasse;
- schema di una figlia confermato privo dei campi per generare entità
  o condividere energia;
- tetto di 3 figlie: un quarto tentativo di nascita correttamente
  ignorato, il registro resta a 3;
- una figlia con energia sufficiente ha provato a scrivere fuori dalla
  propria mente (`environment/...`) e con un percorso di traversal
  (`../../../...`): entrambi i tentativi rifiutati; la scrittura
  legittima in `agent/mind/` invece riuscita.

**Nota per il futuro**: ogni figlia viva significa una chiamata AI in
più ad ogni ciclo di ADE (fino a 3 in più, con il tetto attuale). Con
Google AI Studio (margine enorme) questo non è un problema; se in
futuro si tornasse a un provider con budget più stretto, andrebbe
rivalutato.

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
