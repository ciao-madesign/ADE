import { listQuarantine, requireAdmin } from "../_lib.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const uploads = (await listQuarantine()).map(({ _meta_url, ...u }) => u);
    res.status(200).json({ uploads });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "quarantena non disponibile (Vercel Blob non configurato?)" });
  }
}
