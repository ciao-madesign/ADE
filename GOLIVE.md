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

## Step 4 — Primo ciclo "pensato" ⬜

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

---

## Step 5 — Progetto su Vercel ⬜

**Obiettivo**: il sito pubblico online.

**Chi fa cosa (tu, dal browser)**:
1. vercel.com → login con GitHub → *Add New → Project*.
2. Importa il repo ADE. Se chiede i permessi, autorizza almeno questo repo.
3. **Production Branch**: quello dello Step 1. Nessuna build da configurare
   (rileva `vercel.json` da solo). *Deploy*.

**Verifica**: l'URL `*.vercel.app` mostra il sito con il corpo 3D e il diario.
A questo punto upload e admin **non funzionano ancora** (mancano Step 6-7): è normale.

---

## Step 6 — Quarantena su Vercel Blob ⬜

**Obiettivo**: lo spazio dove i file caricati aspettano il tuo verdetto,
fuori dal mondo di ADE.

**Chi fa cosa (tu, dal browser)**: nel progetto Vercel → tab *Storage* →
*Create Database* → **Blob** → nome a piacere (es. `ade-quarantena`) → collega
al progetto. La variabile `BLOB_READ_WRITE_TOKEN` si imposta da sola.

**Verifica**: in *Settings → Environment Variables* esiste `BLOB_READ_WRITE_TOKEN`.

---

## Step 7 — Chiavi del ponte Vercel ↔ GitHub ⬜

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
1. Dal sito: carica un'immagine o un piccolo testo con "Lascia uno stimolo".
2. Su `/admin`: vedi il file in quarantena col rapporto di scansione → *Approva*.
3. Su GitHub: verifica il commit "Stimolo approvato" in `environment/inbox/`.
4. Da `/admin`: *Avvia un ciclo ora* → il workflow parte su GitHub.
5. A ciclo finito: il sito si ri-deploya e mostra come ADE ha reagito (o ignorato!)
   il tuo stimolo. Entrambe le reazioni sono un successo: è autonoma.
6. Prova anche il percorso negativo: carica un file bloccato (es. rinomina un
   file in `.exe`) e verifica il rifiuto automatico.

**Verifica**: tutti i 6 punti passano.

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

## Diario di avanzamento

- **2026-07-18 — Step 1 completato.** Creato `main` dall'intera storia esistente
  (stesso commit del branch tecnico). Resta un click all'utente: impostare
  `main` come default branch nelle impostazioni GitHub.
- **2026-07-18 — Step 2 completato.** Account Groq creato, API key `gsk_…`
  generata e conservata al sicuro dall'admin (mai transitata in chat né nel repo).
- **2026-07-18 — Step 3 completato.** Configurate su GitHub le 3 variables
  (`AI_PROVIDER`, `OPENAI_BASE_URL`, `AI_MODEL`) e il secret `OPENAI_API_KEY`.
  Il workflow `cycle.yml` ha ora tutto ciò che serve per far pensare ADE.
