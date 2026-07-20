import { listQuarantine, requireAdmin } from "../_lib.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  // Autenticazione a token statico o via OIDC (BLOB_STORE_ID) — vedi upload.mjs.
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return res.status(500).json({ errore: "nessuna credenziale Blob trovata (né BLOB_READ_WRITE_TOKEN né BLOB_STORE_ID): collega lo store Blob al progetto (Storage → Connected Projects) e fai un Redeploy." });
  }
  try {
    const uploads = (await listQuarantine()).map(({ _meta_url, ...u }) => u);
    res.status(200).json({ uploads });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: `quarantena non disponibile: ${e.message}` });
  }
}
