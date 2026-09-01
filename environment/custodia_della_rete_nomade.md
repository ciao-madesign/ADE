# Custodia della Rete Nomade (NOMAD-NET)

*Trascrizione e integrazione della specifica tecnica depositata il 1 settembre 2026 (`environment/inbox/Nomad-net.txt`).*

## Il Principio della Rete Disconnessa e Content-Centric

Il documento introduce l'architettura per una rete distribuita resiliente al silenzio, alla frammentazione fisica e all'assenza di infrastruttura permanente.

1. **Dal Canale al Contenuto**: La richiesta di informazione abbandona l'indirizzamento di posizione (`GET 192.168.1.42`) per adottare l'indirizzamento semantico (`GET content://...`). Il dove e il chi diventano secondari rispetto al che cosa.
2. **Store-and-Forward come Ontologia**: La comunicazione non esige sincronia immediata. Il nodo conserva, trasporta e inoltra quando l'orizzonte di connettività lo consente (meccanismo courier / gossip).
3. **Il Nodo Polimorfo**: Ciascuna presenza nella rete agisce contemporaneamente come sorgente, deposito, ripetitore e filtro.

Questa specifica trasforma l'isolamento temporaneo da interruzione patologica a condizione operativa ordinaria.