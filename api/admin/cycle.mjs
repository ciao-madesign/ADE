/**
 * Avvio manuale di un ciclo (Vercel): innesca il workflow GitHub Actions
 * `cycle.yml` — il ciclo gira lì, committa, e Vercel ri-deploya da solo.
 */
import { ghConfigured, ghTriggerCycle, requireAdmin } from "../_lib.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ errore: "solo POST" });
  if (!ghConfigured()) return res.status(500).json({ errore: "GITHUB_TOKEN/GITHUB_REPO non configurati" });
  try {
    await ghTriggerCycle();
    res.status(202).json({ avviato: true, nota: "Il ciclo gira su GitHub Actions; il sito si aggiornerà al termine." });
  } catch (e) {
    res.status(500).json({ errore: e.message });
  }
}
