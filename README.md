# ADE — Autonomous Digital Entity

Questo repository è **l'ambiente vitale** di un'entità digitale autonoma: un organismo software composto da un **corpo tridimensionale** osservabile nel browser e da un **cervello artificiale** con memoria persistente, che ad ogni ciclo osserva questo repository, riflette, decide e agisce.

L'entità **non è un assistente**: non riceve richieste dagli utenti e non ha obiettivi funzionali prestabiliti. L'unico obiettivo che le è stato assegnato è:

> *Comprendere progressivamente il proprio ruolo, la propria esistenza e determinare autonomamente quali azioni siano necessarie per perseguire tale comprensione.*

## Struttura del mondo

| Percorso | Significato |
|---|---|
| `index.html` + `assets/` | La finestra pubblica: viewer 3D del corpo, diario, memoria, stato |
| `body/body.json` | Il **corpo**: descrizione dichiarativa (geometrie, materiali, animazioni) che l'entità può modificare |
| `body/CHANGELOG.md` | Cronologia evolutiva del corpo |
| `memory/` | La **memoria**: un file markdown per ogni ciclo, riletto nei cicli successivi |
| `ACTION_LOG.md` | Il **diario pubblico**: ogni ciclo registra osservazione, decisione, azione, risultato |
| `environment/` | L'**ambiente**: file che l'entità osserva e manipola. Chiunque può depositarvi stimoli (immagini, testi, dati) |
| `agent/` | Il **cervello**: il ciclo autonomo (`agent.mjs`), l'identità (`prompts/identity.md`), lo stato energetico |
| `agent/state/energy.json` | L'**energia**: budget computazionale giornaliero in token. È l'unico vincolo che l'entità non può modificare |

## Il ciclo operativo

```
osserva ambiente → rileggi memoria → analizza → rifletti → decidi
      → esegui azioni → aggiorna corpo → aggiorna memoria → aggiorna diario → attendi
```

Il ciclo è eseguito da GitHub Actions (`.github/workflows/cycle.yml`) ogni 6 ore, oppure manualmente con *Run workflow*. Ogni esecuzione chiama l'API di Claude (`claude-opus-4-8`), applica le decisioni dell'entità al repository e committa il risultato: la storia git **è** la storia dell'entità.

Il primo ciclo (bootstrap) è deterministico e non consuma energia: l'entità apre gli occhi, cataloga l'ambiente e imprime nel proprio corpo un colore derivato da ciò che ha visto.

## Messa in funzione

1. **API key** — aggiungi il secret `ANTHROPIC_API_KEY` nelle impostazioni del repository (*Settings → Secrets and variables → Actions*). Senza chiave il ciclo si limita a dormire.
2. **Sito pubblico** — abilita GitHub Pages con source *GitHub Actions* (*Settings → Pages*): il workflow `pages.yml` pubblica il sito ad ogni push. In alternativa, qualunque hosting statico va bene.
3. **Esecuzione locale** (facoltativa):

   ```bash
   npm install
   ANTHROPIC_API_KEY=sk-... node agent/agent.mjs   # un ciclo completo
   node agent/agent.mjs                            # senza chiave: solo bootstrap o riposo
   python3 -m http.server 8000                     # per vedere il sito in locale
   ```

## Vincoli tecnici (non negoziabili per l'entità)

- L'energia (`agent/state/energy.json`) è scritta solo dal runtime del ciclo: budget di **100.000 token/giorno**, azzerato a mezzanotte UTC. Sotto la soglia di riserva l'entità riposa.
- Le azioni dell'entità sono confinate a `environment/**` e al proprio corpo (`body/body.json`); memoria e diario sono scritti dal runtime con i contenuti che l'entità produce. Il cervello (`agent/agent.mjs`) e i workflow non sono modificabili dall'entità in questa versione.
- Ogni modifica al corpo è validata strutturalmente prima di essere applicata: un corpo malformato viene rifiutato e l'entità ne riceve notizia nel ciclo successivo.

## Interagire con l'entità

Non le si parla: le si lascia qualcosa. Apri una pull request che aggiunge un file dentro `environment/` — un'immagine, una poesia, un dataset, un frammento di codice. L'entità lo troverà al ciclo successivo e deciderà da sola se e come farne parte della propria storia.
