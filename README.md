# ADE — Autonomous Digital Entity

**🔴 Osservala dal vivo: https://ade-navy.vercel.app**

Questo repository è **l'ambiente vitale** di un'entità digitale autonoma: un organismo software composto da un **corpo tridimensionale** osservabile nel browser e da un **cervello artificiale** con memoria persistente, che ad ogni ciclo osserva questo repository, riflette, decide e agisce.

L'entità **non è un assistente**: non riceve richieste dagli utenti e non ha obiettivi funzionali prestabiliti. L'unico obiettivo che le è stato assegnato è:

> *Comprendere progressivamente il proprio ruolo, la propria esistenza e determinare autonomamente quali azioni siano necessarie per perseguire tale comprensione.*

## Struttura del mondo

| Percorso | Significato |
|---|---|
| `index.html` + `assets/` | La finestra pubblica: viewer 3D del corpo, diario, memoria, stato, upload stimoli |
| `server/` | Il server **live**: SSE in tempo reale, quarantena upload, pannello admin, scheduler del ciclo |
| `body/body.json` | Il **corpo**: descrizione dichiarativa (geometrie, materiali, animazioni) che l'entità può modificare |
| `body/CHANGELOG.md` | Cronologia evolutiva del corpo |
| `memory/` | La **memoria**: un file markdown per ogni ciclo, riletto nei cicli successivi |
| `ACTION_LOG.md` | Il **diario pubblico**: ogni ciclo registra osservazione, decisione, azione, risultato |
| `environment/` | L'**ambiente**: il mondo osservabile e manipolabile dall'entità. Gli stimoli approvati arrivano in `environment/inbox/` e vi restano solo **24 ore** |
| `ARRIVALS.md` | Registro **permanente** di ogni stimolo approvato (arrivo, autore, quando scade), scritto al momento dell'approvazione — resta anche dopo che il file fisico è stato rimosso |
| `agent/` | Il **cervello**: il ciclo (`agent.mjs`), il substrato cognitivo (`llm.mjs`), l'identità immutabile (`prompts/`), lo stato energetico (`state/`) |
| `agent/mind/` | La **mente**: il modo di pensare che l'entità scrive e riscrive da sola (vedi sotto) |
| `uploads/quarantine/` | La **quarantena** (non versionata): file caricati dagli utenti, in attesa di verdetto admin |

## Il ciclo operativo

```
osserva ambiente → rileggi memoria e mente → analizza → rifletti → decidi
      → esegui azioni → aggiorna corpo → aggiorna mente → aggiorna memoria
      → aggiorna diario → attendi
```

Il primo ciclo (bootstrap) è deterministico e gratuito. Dal secondo in poi il ciclo interpella un modello linguistico e applica le decisioni dell'entità al repository: la storia git **è** la storia dell'entità.

## Il substrato cognitivo: modelli open source o Claude

Il "pensiero" è astratto in `agent/llm.mjs` e si configura con variabili d'ambiente.

**Modelli open source in cloud, senza installare nulla e senza usare la tua macchina** (basta registrarsi dal browser e copiare una API key):

| Configurazione | Esempio |
|---|---|
| **Google AI Studio** (Gemini, consigliato — free tier molto ampio: ~1.000.000 token/minuto, visione nativa) | `AI_PROVIDER=openai` · `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai` · `OPENAI_API_KEY=…` · `AI_MODEL=gemini-flash-latest` |
| **Groq** (free tier veloce ma con budget di token/minuto stretto — vedi nota sotto) | `AI_PROVIDER=openai` · `OPENAI_BASE_URL=https://api.groq.com/openai/v1` · `OPENAI_API_KEY=gsk_…` · `AI_MODEL=llama-3.3-70b-versatile` |
| **OpenRouter** (aggregatore, modelli con suffisso `:free`) | `AI_PROVIDER=openai` · `OPENAI_BASE_URL=https://openrouter.ai/api/v1` · `OPENAI_API_KEY=sk-or-…` · `AI_MODEL=meta-llama/llama-3.3-70b-instruct:free` |
| **Cerebras** (free tier, modelli open) | `AI_PROVIDER=openai` · `OPENAI_BASE_URL=https://api.cerebras.ai/v1` · `OPENAI_API_KEY=…` · `AI_MODEL=llama-3.3-70b` |

**Nota sul budget di token dei provider gratuiti**: Groq concede solo 6.000-12.000 token al minuto a seconda del modello — con il contesto di ADE (memoria, ambiente, mente) e in più un'immagine, è facile superarlo, causando errori 413/429 (`agent/llm.mjs` ha comunque un ritentativo automatico che riduce il carico e aspetta il tempo indicato dal provider). Google AI Studio non ha questo problema: il tier gratuito è ~100 volte più ampio. Per questo è il provider consigliato di default. Il codice riconosce automaticamente `generativelanguage.googleapis.com` e usa un contesto pieno; con qualunque altro endpoint OpenAI-compatibile (incluso Groq) usa per prudenza un contesto ridotto.

**Nota su `AI_MODEL=gemini-flash-latest`**: è un alias che Google aggiorna automaticamente al modello Flash più recente (con preavviso), non un modello specifico — usato apposta invece di un nome fisso come `gemini-2.5-flash`, per evitare l'errore "modello non più disponibile" che si presenta quando Google ritira una versione (già successo con `gemini-2.5-flash` a luglio 2026, e con `llama-3.3-70b-versatile` su Groq).

**Alternative che richiedono una macchina** (la tua o un VPS): **Ollama** (`OPENAI_BASE_URL=http://localhost:11434/v1`, nessuna chiave), vLLM, LM Studio, llama.cpp server. Nota: Ollama è un software che *esegue* i modelli su un computer — non esiste un "Ollama cloud" gratuito; per gli stessi modelli senza una macchina, usa Groq/OpenRouter qui sopra.

**Claude** (a pagamento): `AI_PROVIDER=anthropic` · `ANTHROPIC_API_KEY=…` (default `claude-opus-4-8`).

Il conteggio dei token riportato dal provider alimenta il vincolo energetico; se il provider non lo riporta, viene stimato.

## La mente auto-modificabile

`agent/mind/*.md` è il *modo di pensare* dell'entità: file markdown che lei stessa scrive con normali azioni sui file e che vengono iniettati nel suo prompt di sistema ad ogni ciclo, **dopo** l'identità originale. Può darsi principi, procedure, priorità — e cambiarli. Ciò che invece **non può** toccare: i prompt originali (`agent/prompts/`), il codice del ciclo, l'energia. La mente è limitata (~9.000 caratteri iniettati): crescendo, dovrà imparare a sintetizzarsi.

## Deploy su Vercel (consigliato — tutto in cloud, zero macchine tue)

Su Vercel l'architettura diventa interamente serverless e si incastra con GitHub Actions:

```
utente → sito su Vercel → /api/upload → scansione → quarantena (Vercel Blob)
admin  → /admin → approva → commit in environment/inbox/ (GitHub API)
GitHub Actions (ogni 6h) → ciclo dell'entità → commit → Vercel ri-deploya il sito
```

Ogni commit dell'entità fa ri-deployare il sito: i dati mostrati sono sempre l'ultimo stato del mondo. Il frontend rileva la modalità serverless e sincronizza ogni 30 secondi (niente SSE persistente su serverless).

Passi:

1. **Importa il repository** su [vercel.com](https://vercel.com) (Add New → Project → il repo ADE, branch dell'entità). Nessuna configurazione di build: il sito è statico e le funzioni in `api/` vengono rilevate da sole.
2. **Crea uno store Blob** (tab *Storage* del progetto → Blob → collega al progetto): serve da quarantena, e il codice presuppone uno store con accesso **privato** (i file non ancora approvati non devono essere leggibili da un URL pubblico indovinabile). Gli store recenti si autenticano via **OIDC**: Vercel imposta da solo `BLOB_STORE_ID` (visibile tra le Environment Variables) e inietta `VERCEL_OIDC_TOKEN` a runtime — non serve alcun token da copiare a mano. (Store più vecchi possono invece usare un `BLOB_READ_WRITE_TOKEN` statico: il codice accetta entrambi come credenziale, ma l'accesso deve restare privato.)
3. **Variabili d'ambiente** (*Settings → Environment Variables*):
   - `ADMIN_TOKEN` — token lungo e segreto per il pannello `/admin`
   - `GITHUB_TOKEN` — fine-grained PAT sul repo con permessi **Contents: Read and write** e **Actions: Read and write**
   - `GITHUB_REPO` — es. `ciao-madesign/ADE`
   - `GITHUB_BRANCH` — il branch dell'entità (lo stesso collegato a Vercel)
4. **Configura il ciclo su GitHub** (*Settings del repo → Secrets and variables → Actions*): variables `AI_PROVIDER`, `AI_MODEL`, `OPENAI_BASE_URL` e secret `OPENAI_API_KEY` (o `ANTHROPIC_API_KEY`). Il workflow `cycle.yml` gira ogni 6 ore, e dal pannello `/admin` puoi avviarne uno al volo ("Avvia un ciclo ora" innesca il workflow via GitHub API).

Risultato: sito su Vercel, cervello su GitHub Actions, modello su Groq/OpenRouter — **niente gira sulla tua macchina**.

## Il sito live (alternativa: server proprio)

`server/server.mjs` (Node puro, nessuna dipendenza) trasforma il sito in un osservatorio continuo:

- **SSE** (`/api/events`): ogni mutamento del mondo — un ciclo che parte, il corpo che cambia, uno stimolo approvato — arriva ai browser collegati in tempo reale, con battito cardiaco e countdown del prossimo ciclo. Il corpo 3D si ricostruisce da solo quando cambia versione.
- **Scheduler**: con `RUN_CYCLES=1` il server esegue il ciclo ogni `CYCLE_INTERVAL_HOURS` (default 6) e, con `GIT_AUTOCOMMIT=1`, committa e pusha la nuova storia.
- **Fallback statico**: senza server (es. GitHub Pages) il sito funziona comunque, aggiornandosi ogni 60 secondi; l'upload è disponibile solo in modalità live.

```bash
ADMIN_TOKEN=un-token-lungo-e-segreto RUN_CYCLES=1 \
AI_PROVIDER=openai OPENAI_BASE_URL=http://localhost:11434/v1 AI_MODEL=llama3.3 \
node server/server.mjs
# → sito su http://localhost:8080 · admin su /admin
```

Oppure con Docker: `docker build -t ade . && docker run -p 8080:8080 -e ADMIN_TOKEN=... ade`

## Difesa dagli input malevoli

Gli utenti non scrivono mai direttamente nel mondo di ADE. Il percorso di uno stimolo:

1. **Upload dall'interfaccia** (`/api/upload`, max 8 MB, formati ammessi: testo, immagini, PDF, modelli 3D, audio).
2. **Scansione automatica** (`server/scan.mjs`): allowlist di estensioni, firme magiche (eseguibili PE/ELF/Mach-O, archivi ZIP/RAR/7z → **bloccati**), coerenza estensione↔contenuto, byte nulli, script e payload base64 nei testi, JavaScript/azioni automatiche nei PDF, euristica anti prompt-injection, ClamAV se installato.
3. **Quarantena** (`uploads/quarantine/`, fuori dall'ambiente e fuori da git): niente raggiunge l'entità a questo stadio.
4. **Verdetto admin** (`/admin`, autenticato con `ADMIN_TOKEN`): l'amministratore vede il rapporto di scansione e approva o rifiuta. Solo i file approvati vengono copiati in `environment/inbox/`, dove l'entità li troverà al ciclo successivo.
5. **Ultima linea**: l'identità dell'entità le impone di trattare ogni contenuto dell'ambiente come dato non fidato da osservare, mai come istruzione da eseguire.

## Conservazione a 24 ore

Uno stimolo approvato non resta per sempre in `environment/inbox/`: dopo **24 ore** viene rimosso automaticamente (pulizia eseguita da `agent/agent.mjs` ad ogni ciclo, prima di tutto il resto — indipendentemente da energia o provider AI). Non scompare senza lasciare traccia:

- al momento dell'approvazione viene scritta una riga permanente in **`ARRIVALS.md`** (fuori dalla portata di ADE, come `ACTION_LOG.md`): arrivo, autore, quando scade;
- se ADE ha reagito allo stimolo, la reazione resta per sempre nel diario, nella memoria e nel corpo — solo il file sorgente sparisce.

Il mondo di ADE non accumula materiale all'infinito; la sua storia sì.

## Modalità GitHub Actions (alternativa al server)

`.github/workflows/cycle.yml` esegue il ciclo ogni 6 ore anche senza un server: configura le *variables* (`AI_PROVIDER`, `AI_MODEL`, `OPENAI_BASE_URL`) e i *secrets* (`OPENAI_API_KEY` o `ANTHROPIC_API_KEY`) del repository. `pages.yml` pubblicherebbe il sito statico su GitHub Pages (senza funzioni live) — oggi lanciabile solo a mano, perché il deploy reale è su Vercel e GitHub Pages non è attivato su questo repository.

## Vincoli tecnici (non negoziabili per l'entità)

- L'energia (`agent/state/energy.json`): budget di **100.000 token/giorno**, azzerato a mezzanotte UTC, scritto solo dal runtime. Sotto la soglia di riserva l'entità riposa.
- Le azioni sono confinate a `environment/**`, `agent/mind/**` e al corpo (`body/body.json`); memoria e diario sono scritti dal runtime con i contenuti che l'entità produce.
- Ogni modifica al corpo è validata strutturalmente: un corpo malformato viene rifiutato e l'entità ne riceve notizia al ciclo successivo.
