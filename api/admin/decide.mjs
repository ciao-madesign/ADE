/**
 * Verdetto admin su un upload in quarantena (Vercel).
 * Approvazione = commit del file in environment/inbox/ sul branch dell'entità
 * via GitHub API → Vercel ri-deploya → ADE lo troverà al prossimo ciclo.
 */
import { sanitizeName } from "../../server/scan.mjs";
import {
  deleteBlobUrl, ghConfigured, ghCreateFile, listQuarantine,
  readQuarantineBin, requireAdmin, updateQuarantineMeta,
} from "../_lib.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ errore: "solo POST" });

  const { id, azione, motivo } = req.body || {};
  if (!id || !["approva", "rifiuta"].includes(azione)) {
    return res.status(400).json({ errore: "servono 'id' e azione 'approva'|'rifiuta'" });
  }

  try {
    const metas = await listQuarantine();
    const meta = metas.find((m) => m.id === id);
    if (!meta) return res.status(404).json({ errore: "upload inesistente" });
    if (meta.stato !== "in_quarantena") return res.status(400).json({ errore: `già deciso: ${meta.stato}` });

    const bin = await readQuarantineBin(id);

    if (azione === "approva") {
      if (!ghConfigured()) return res.status(500).json({ errore: "GITHUB_TOKEN/GITHUB_REPO non configurati" });
      if (!bin) return res.status(410).json({ errore: "contenuto non più disponibile" });
      const dest = await ghCreateFile(
        `environment/inbox/${sanitizeName(meta.nome_sicuro)}`,
        bin.buffer,
        `Stimolo approvato: ${meta.nome_sicuro} (da ${meta.autore})`
      );
      meta.stato = "approvato";
      meta.destinazione = dest;
    } else {
      meta.stato = "rifiutato";
    }

    meta.deciso_il = new Date().toISOString();
    meta.motivo_decisione = String(motivo || "").slice(0, 300);
    await updateQuarantineMeta(meta);
    if (bin) await deleteBlobUrl(bin.url); // i byte non restano in giro dopo il verdetto

    const { _meta_url, ...clean } = meta;
    res.status(200).json(clean);
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: e.message });
  }
}
