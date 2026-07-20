/**
 * Upload di uno stimolo (Vercel): scansione → quarantena su Vercel Blob.
 * Nulla tocca il repository finché l'admin non approva.
 */
import { randomUUID } from "node:crypto";
import { scanFile } from "../server/scan.mjs";
import { saveQuarantine } from "./_lib.mjs";

// Rate limit best-effort per IP (si azzera quando l'istanza serverless muore;
// per un limite robusto usare Upstash/KV).
const seen = new Map();
const LIMIT = 5, WINDOW = 24 * 3600 * 1000;

function overLimit(ip) {
  const now = Date.now();
  const hits = (seen.get(ip) || []).filter((t) => now - t < WINDOW);
  if (hits.length >= LIMIT) return true;
  hits.push(now);
  seen.set(ip, hits);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ errore: "solo POST" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "sconosciuto";
  if (overLimit(ip)) return res.status(429).json({ errore: "limite di caricamenti raggiunto, riprova domani" });

  const { nome, dati_base64, nota, autore } = req.body || {};
  if (!nome || !dati_base64) return res.status(400).json({ errore: "servono 'nome' e 'dati_base64'" });

  let buffer;
  try { buffer = Buffer.from(dati_base64, "base64"); }
  catch { return res.status(400).json({ errore: "base64 non valido" }); }

  const rapporto = scanFile(nome, buffer);
  if (rapporto.esito === "bloccato") {
    return res.status(200).json({ stato: "rifiutato_automaticamente", rapporto });
  }

  const id = randomUUID();
  const meta = {
    id,
    nome_originale: String(nome).slice(0, 200),
    nome_sicuro: rapporto.nome_sicuro,
    nota: String(nota || "").slice(0, 500),
    autore: String(autore || "anonimo").slice(0, 80),
    caricato_il: new Date().toISOString(),
    stato: "in_quarantena",
    rapporto,
  };

  // Vercel Blob si autentica con un token statico (BLOB_READ_WRITE_TOKEN,
  // store "vecchio stile") oppure via OIDC (BLOB_STORE_ID + VERCEL_OIDC_TOKEN,
  // quest'ultimo iniettato automaticamente da Vercel a runtime per gli store
  // collegati al progetto — è il caso normale per gli store creati di recente).
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return res.status(500).json({
      errore: "quarantena non disponibile: nessuna credenziale Blob trovata (né BLOB_READ_WRITE_TOKEN né BLOB_STORE_ID). Verifica che lo store Vercel Blob sia collegato al progetto (Storage → il tuo store → Connected Projects) e che sia stato fatto un Redeploy dopo il collegamento.",
    });
  }
  try {
    await saveQuarantine(id, buffer, meta);
  } catch (e) {
    console.error("blob:", e);
    return res.status(500).json({ errore: `quarantena non disponibile: ${e.message}` });
  }

  return res.status(200).json({ stato: "in_quarantena", id, rapporto });
}
