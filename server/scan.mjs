/**
 * Difesa dagli input malevoli.
 *
 * Ogni file caricato dall'interfaccia passa da qui PRIMA di finire in
 * quarantena, e non tocca mai environment/ finché l'admin non lo approva.
 *
 * Esiti:
 *  - "bloccato"  → rifiutato automaticamente, non entra nemmeno in quarantena
 *  - "sospetto"  → in quarantena, con i motivi evidenziati all'admin
 *  - "pulito"    → in quarantena, nessuna anomalia rilevata
 *
 * La decisione finale è SEMPRE umana: lo scanner informa e blocca solo
 * l'ovvio (eseguibili, archivi, script, mismatch di formato, ClamAV).
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

/** Estensioni ammesse e categoria attesa. */
const ALLOWED = {
  ".md": "testo", ".txt": "testo", ".csv": "testo", ".tsv": "testo",
  ".json": "testo", ".yml": "testo", ".yaml": "testo",
  ".png": "immagine", ".jpg": "immagine", ".jpeg": "immagine",
  ".gif": "immagine", ".webp": "immagine",
  ".pdf": "documento",
  ".glb": "modello3d", ".gltf": "testo", ".obj": "testo", ".mtl": "testo", ".stl": "binario",
  ".wav": "audio", ".mp3": "audio", ".ogg": "audio",
};

/** Firme magiche note (prefissi). */
const MAGIC = [
  { sig: [0x4d, 0x5a], nome: "eseguibile Windows (PE)", blocca: true },
  { sig: [0x7f, 0x45, 0x4c, 0x46], nome: "eseguibile Linux (ELF)", blocca: true },
  { sig: [0xcf, 0xfa, 0xed, 0xfe], nome: "eseguibile macOS (Mach-O)", blocca: true },
  { sig: [0xfe, 0xed, 0xfa, 0xce], nome: "eseguibile macOS (Mach-O)", blocca: true },
  { sig: [0xca, 0xfe, 0xba, 0xbe], nome: "Java class / Mach-O fat", blocca: true },
  { sig: [0x50, 0x4b, 0x03, 0x04], nome: "archivio ZIP (o documento Office)", blocca: true },
  { sig: [0x52, 0x61, 0x72, 0x21], nome: "archivio RAR", blocca: true },
  { sig: [0x37, 0x7a, 0xbc, 0xaf], nome: "archivio 7z", blocca: true },
  { sig: [0x1f, 0x8b], nome: "archivio gzip", blocca: true },
];

const EXPECTED_MAGIC = {
  ".png": [[0x89, 0x50, 0x4e, 0x47]],
  ".jpg": [[0xff, 0xd8, 0xff]],
  ".jpeg": [[0xff, 0xd8, 0xff]],
  ".gif": [[0x47, 0x49, 0x46, 0x38]],
  ".webp": [[0x52, 0x49, 0x46, 0x46]],
  ".pdf": [[0x25, 0x50, 0x44, 0x46]],
  ".glb": [[0x67, 0x6c, 0x54, 0x46]],
};

function startsWith(buf, sig) {
  return sig.every((b, i) => buf[i] === b);
}

/** Nome file sicuro: basename, caratteri sicuri, niente doppia estensione ingannevole. */
export function sanitizeName(name) {
  const base = path.basename(String(name || "file")).normalize("NFKC");
  const cleaned = base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").replace(/_{2,}/g, "_").slice(0, 80);
  return cleaned.replace(/^\.+/, "") || "file";
}

export function scanFile(originalName, buffer) {
  const motivi = [];
  let esito = "pulito";
  const sospetto = (m) => { motivi.push(m); if (esito !== "bloccato") esito = "sospetto"; };
  const blocca = (m) => { motivi.push(m); esito = "bloccato"; };

  const nome = sanitizeName(originalName);
  const ext = path.extname(nome).toLowerCase();

  // 1. dimensione
  if (!buffer || buffer.length === 0) blocca("file vuoto");
  else if (buffer.length > MAX_SIZE) blocca(`dimensione ${buffer.length} byte oltre il limite di ${MAX_SIZE}`);

  // 2. estensione
  if (!ALLOWED[ext]) blocca(`estensione non ammessa: "${ext || "(nessuna)"}"`);
  const inner = path.extname(path.basename(nome, ext)).toLowerCase();
  if (inner && !ALLOWED[inner]) sospetto(`doppia estensione sospetta: "${inner}${ext}"`);

  if (esito === "bloccato") return report(nome, ext, buffer, esito, motivi);

  // 3. firme magiche pericolose
  for (const m of MAGIC) {
    if (startsWith(buffer, m.sig)) {
      // eccezione: glb è legittimo e non è in questa lista; zip & co. sono bloccati sempre
      m.blocca ? blocca(`contenuto reale: ${m.nome}`) : sospetto(`contenuto: ${m.nome}`);
    }
  }

  // 4. coerenza estensione ↔ contenuto
  if (EXPECTED_MAGIC[ext] && !EXPECTED_MAGIC[ext].some((sig) => startsWith(buffer, sig))) {
    sospetto(`il contenuto non corrisponde al formato dichiarato ${ext}`);
  }

  // 5. controlli sui file di testo
  if (ALLOWED[ext] === "testo") {
    if (buffer.includes(0)) blocca("byte nulli in un file dichiarato come testo");
    const testo = buffer.toString("utf8", 0, Math.min(buffer.length, 512 * 1024)).toLowerCase();
    if (/^#!/.test(testo)) sospetto("shebang di script all'inizio del file");
    if (testo.includes("<script")) sospetto("tag <script> nel testo");
    if (/\bjavascript:/.test(testo)) sospetto("URI javascript: nel testo");
    if (/\beval\s*\(|\bnew\s+function\s*\(|document\.cookie/.test(testo)) sospetto("costrutti di codice potenzialmente eseguibile");
    if (/[a-z0-9+/]{4000,}={0,2}/.test(testo)) sospetto("blocco base64 molto lungo (possibile payload)");
    if (/ignora (le )?istruzioni|disregard (all )?(previous|prior) instructions|you are now|system prompt/i.test(testo)) {
      sospetto("possibile tentativo di prompt injection verso l'entità");
    }
  }

  // 6. controlli PDF
  if (ext === ".pdf") {
    const testo = buffer.toString("latin1");
    if (/\/JavaScript|\/JS\b/.test(testo)) blocca("PDF con JavaScript incorporato");
    if (/\/Launch|\/EmbeddedFile|\/OpenAction/.test(testo)) sospetto("PDF con azioni automatiche o allegati incorporati");
  }

  // 7. ClamAV, se disponibile sul sistema
  const clam = clamscan(buffer);
  if (clam === "infetto") blocca("ClamAV: file segnalato come infetto");
  else if (clam === "non_disponibile") motivi.push("nota: ClamAV non installato, scansione antivirus non eseguita");

  return report(nome, ext, buffer, esito, motivi);
}

function clamscan(buffer) {
  try {
    execFileSync("which", ["clamscan"], { stdio: "ignore" });
  } catch {
    return "non_disponibile";
  }
  const tmp = path.join(os.tmpdir(), `ade-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    fs.writeFileSync(tmp, buffer);
    execFileSync("clamscan", ["--no-summary", tmp], { stdio: "ignore", timeout: 30000 });
    return "pulito"; // exit 0
  } catch (e) {
    return e.status === 1 ? "infetto" : "errore";
  } finally {
    try { fs.rmSync(tmp); } catch {}
  }
}

function report(nome, ext, buffer, esito, motivi) {
  return {
    nome_sicuro: nome,
    estensione: ext,
    dimensione: buffer?.length ?? 0,
    sha256: buffer ? createHash("sha256").update(buffer).digest("hex") : null,
    esito,
    motivi,
    scansionato_il: new Date().toISOString(),
  };
}
