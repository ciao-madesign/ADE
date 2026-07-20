/**
 * Conservazione a 24 ore degli stimoli approvati.
 *
 * Un file approvato vive fisicamente in environment/inbox/ per 24 ore — il
 * tempo di essere osservato da ADE — poi viene rimosso automaticamente
 * (pulizia eseguita da agent/agent.mjs ad ogni ciclo). Non scompare senza
 * lasciare traccia: al momento dell'approvazione viene scritta una riga
 * permanente in ARRIVALS.md (fuori dalla portata di ADE, come ACTION_LOG.md),
 * cosicché diario, memoria e questo registro permettano sempre di risalire
 * a cosa è arrivato, quando, e cosa ne è stato — anche dopo la rimozione.
 */

export const RETENTION_MS = 24 * 60 * 60 * 1000;

export function arrivalsHeader() {
  return `# Registro degli arrivi

Ogni stimolo che un visitatore lascia ad ADE, dopo l'approvazione, entra nel suo ambiente per **24 ore** — il tempo di essere osservato, interpretato, eventualmente causa di un cambiamento — poi il file viene rimosso automaticamente per non accumulare materiale nel suo mondo. Questa pagina resta come traccia permanente: da qui, insieme al diario e alla memoria di ADE, si può sempre risalire a cosa è arrivato, quando, e cosa ne è stato.

---
`;
}

export function arrivalEntry({ nome, autore, nota, destinazione, sha256, approvatoIl, scadeIl }) {
  return `
## ${approvatoIl} — ${nome}
- Autore: ${autore || "anonimo"}
- Nota: ${nota || "—"}
- Destinazione: \`${destinazione}\`
- sha256: \`${sha256 || "—"}\`
- Visibile fino al: ${scadeIl} (poi rimosso automaticamente; resta questa registrazione)

---
`;
}
