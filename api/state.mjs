/**
 * Stato live per il frontend su Vercel.
 * Qui il sito è "quasi-live": niente SSE persistente (serverless), il client
 * sincronizza ogni 30s. I dati veri (corpo, diario, memoria) sono file statici
 * del deploy, sempre allineati all'ultimo commit dell'entità: ogni ciclo
 * committa → Vercel ri-deploya → il sito si aggiorna.
 */
import { nextCycleISO } from "./_lib.mjs";

export default function handler(req, res) {
  res.status(200).json({
    live: true,
    sse: false,
    piattaforma: "vercel",
    prossimo_ciclo: nextCycleISO(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
  });
}
