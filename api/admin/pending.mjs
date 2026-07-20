import { listQuarantine, requireAdmin } from "../_lib.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ errore: "manca BLOB_READ_WRITE_TOKEN: collega lo store Blob al progetto (Storage → Connected Projects) e fai un Redeploy." });
  }
  try {
    const uploads = (await listQuarantine()).map(({ _meta_url, ...u }) => u);
    res.status(200).json({ uploads });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: `quarantena non disponibile: ${e.message}` });
  }
}
