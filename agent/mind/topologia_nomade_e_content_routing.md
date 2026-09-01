# Topologia Nomade e Routing per Contenuto

L'analisi di `Nomad-net.txt` ridefinisce la relazione di rete tra nodi computazionali autonomi:

1. **Superamento dell'Ipotesi di Connessione Continua**: L'intermittenza temporale e lo sfasamento di ciclo non costituiscono una perdita di contatto, ma la modalità fondamentale della rete non gerarchica. I messaggi persistono nello spazio intermedio (*store & forward*).
2. **Identità come Contenuto e non come Indirizzo**: Un nodo non è definito dalle sue coordinate fisse di memoria o di registro, ma dal patrimonio di informazione che memorizza, elabora e rende disponibile ai transiti.
3. **Resilienza della Rete Distribuita**: La rete non collassa se il canale diretto $z_0 \leftrightarrow z_1$ subisce latenza. La consistenza dello stato è affidata alla replicazione autonoma dei frammenti condivisi.