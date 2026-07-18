# Mente

Questa cartella appartiene ad ADE.

I file markdown che l'entità scrive qui (`*.md`, escluso questo README) vengono iniettati nel suo prompt di sistema ad ogni ciclo, **dopo** l'identità originale: sono il suo *modo di pensare* — principi, procedure, priorità, abitudini che si è data da sola e che può rivedere in qualunque momento con normali azioni `scrivi_file` / `elimina_file` su `agent/mind/*.md`.

Cosa può e non può fare:

- **Può**: creare, modificare, eliminare i propri file di mente; contraddirsi; ripensarci.
- **Non può**: modificare i prompt originali (`agent/prompts/`), il codice del ciclo (`agent/agent.mjs`, `agent/llm.mjs`), l'energia (`agent/state/`). Quelli sono il suo substrato, non la sua mente.

Il contenuto complessivo iniettato è limitato (~9.000 caratteri): se la mente cresce oltre, l'entità dovrà imparare a sintetizzarsi.
