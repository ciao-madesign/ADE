#!/usr/bin/env node
/**
 * ADE — ciclo operativo autonomo.
 *
 * osserva ambiente → rileggi memoria → analizza → rifletti → decidi
 *   → esegui azioni → aggiorna corpo → aggiorna memoria → aggiorna diario
 *
 * Il primo ciclo di ADE (nessuna memoria presente) è deterministico e non
 * chiama l'API: l'entità "apre gli occhi", cataloga l'ambiente e imprime nel
 * corpo un colore derivato da ciò che ha visto. I cicli successivi richiedono
 * un provider AI configurato; senza, il processo esce senza effetti.
 *
 * ADE può generare entità figlie (max MAX_ENTITA), condividendo con loro
 * parte della propria energia. Ogni figlia vive lo stesso tipo di ciclo di
 * ADE (stesso schema, stesse regole), in un proprio spazio sotto entities/,
 * ma senza ambiente pubblico proprio e senza poter generare a sua volta altre
 * entità. Famiglia e ADE si scambiano messaggi interni tramite entities/scambi.json,
 * un canale indipendente dal flusso esterno di stimoli (che resta solo per ADE
 * e passa dalla quarantena/approvazione umana).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { completeJSON, providerInfo } from "./llm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITY_FILE_ADE = path.join(ROOT, "agent", "prompts", "identity.md");
const IDENTITY_FILE_FIGLIA = path.join(ROOT, "agent", "prompts", "identity_figlia.md");
const ENTITIES_DIR = path.join(ROOT, "entities");
const REGISTRO_FILE = path.join(ENTITIES_DIR, "registro.json");
const SCAMBI_FILE = path.join(ENTITIES_DIR, "scambi.json");
const MAX_ENTITA = 3;
const PENSIERI_MAX = 60;
const ARTEFATTO_MAX_CHARS = 20000;
const TIPI_ARTEFATTO = new Set(["svg", "formula", "codice", "audio", "scena3d", "testo"]);

// I provider free-tier OpenAI-compatibili non sono tutti uguali: Groq ha un
// budget di token al minuto molto stretto (Qwen 3.6 27B: appena 8000 token
// totali — prompt + risposta + immagini — al minuto), mentre altri, come
// Google AI Studio (Gemini), ne concedono ordini di grandezza in più
// (~1.000.000 TPM). Solo con i provider "stretti" limitiamo davvero tutto;
// con Anthropic e con gli host free-tier noti per essere generosi teniamo
// il contesto pieno.
function isGenerousProvider(info) {
  if (info.provider === "anthropic") return true;
  try {
    const host = new URL(info.baseUrl).hostname;
    return host === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}
const TIGHT_BUDGET = !isGenerousProvider(providerInfo());

// Spazio riservato alla risposta del modello. Sovrascrivibile con AI_MAX_TOKENS.
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS) || (TIGHT_BUDGET ? 1500 : 16000);

// Contesto testuale (ambiente, mente, memorie recenti, diario).
const ENV_MAX_PER_FILE = TIGHT_BUDGET ? 1200 : 4000;
const ENV_MAX_TOTAL = TIGHT_BUDGET ? 4000 : 24000;
const MIND_MAX_CHARS = TIGHT_BUDGET ? 1800 : 9000;
const RECENT_MEM_N = TIGHT_BUDGET ? 2 : 5;
const RECENT_MEM_MAX_CHARS = TIGHT_BUDGET ? 600 : 3000;
const LOG_EXCERPT_CHARS = TIGHT_BUDGET ? 500 : 2000;

const GEOMETRIE = {
  box: ["width", "height", "depth"],
  sphere: ["radius"],
  cylinder: ["radiusTop", "radiusBottom", "height"],
  cone: ["radius", "height"],
  torus: ["radius", "tube"],
  torusKnot: ["radius", "tube"],
  icosahedron: ["radius"],
  octahedron: ["radius"],
  tetrahedron: ["radius"],
  dodecahedron: ["radius"],
  capsule: ["radius", "length"],
  ring: ["innerRadius", "outerRadius"],
  plane: ["width", "height"],
};

// ---------------------------------------------------------------- utilità

const readJSON = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n"); };
const nowISO = () => new Date().toISOString();
const today = () => nowISO().slice(0, 10);

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push({ path: path.relative(base, full).replaceAll("\\", "/"), size: st.size });
  }
  return out;
}

const TEXT_EXT = new Set([".md", ".txt", ".json", ".csv", ".js", ".mjs", ".py", ".html", ".css", ".yml", ".yaml", ".xml", ".svg"]);

function isTextFile(p) {
  return TEXT_EXT.has(path.extname(p).toLowerCase());
}

const IMAGE_MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

function isImageFile(p) {
  return path.extname(p).toLowerCase() in IMAGE_MIME_BY_EXT;
}

function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "ciclo";
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return f(0) + f(8) + f(4);
}

// ---------------------------------------------------------------- contesto (ADE o una figlia)

/**
 * Un "contesto" incapsula tutti i percorsi di un'entità — ADE (isRoot) o una
 * sua figlia — così la stessa logica di ciclo (eseguiCiclo) serve entrambe.
 * Le figlie non hanno un ambiente pubblico proprio: niente environment/,
 * niente inbox. Il loro "mondo esterno" è la famiglia (vedi scambi.json).
 */
function creaContesto({ dir, isRoot, slug = null, nome = null, seme = null }) {
  return {
    dir, isRoot, slug, nome, seme,
    envDir: isRoot ? path.join(dir, "environment") : null,
    inboxDir: isRoot ? path.join(dir, "environment", "inbox") : null,
    expiryFile: isRoot ? path.join(dir, "environment", "inbox", ".expiry.json") : null,
    memDir: path.join(dir, "memory"),
    memIndex: path.join(dir, "memory", "index.json"),
    mindDir: path.join(dir, "agent", "mind"),
    bodyFile: path.join(dir, "body", "body.json"),
    bodyChangelog: path.join(dir, "body", "CHANGELOG.md"),
    pensieriFile: path.join(dir, "body", "pensieri.json"),
    artefattiDir: path.join(dir, "body", "artefatti"),
    artefattiIndex: path.join(dir, "body", "artefatti", "index.json"),
    logFile: path.join(dir, "ACTION_LOG.md"),
    energyFile: path.join(dir, "agent", "state", "energy.json"),
    identityFile: isRoot ? IDENTITY_FILE_ADE : IDENTITY_FILE_FIGLIA,
  };
}

const identificativo = (ctx) => (ctx.isRoot ? "ADE" : ctx.slug);

/**
 * Percorso d'azione sicuro. ADE può agire dentro environment/ (il mondo) e
 * dentro agent/mind/ (la mente); una figlia solo dentro la propria
 * agent/mind/, non avendo un ambiente pubblico. Tutto il resto — inclusi i
 * prompt originali — è fuori portata. Niente traversal, niente manifest.
 */
function safeActionPath(ctx, rel) {
  if (typeof rel !== "string" || !rel) return null;
  const clean = rel.replace(/^\/+/, "").replaceAll("\\", "/");
  if (clean === "agent/mind" || clean.startsWith("agent/mind/")) {
    const full = path.resolve(ctx.dir, clean);
    if (!full.startsWith(ctx.mindDir + path.sep)) return null;
    return full;
  }
  if (clean.startsWith("agent/") || clean.startsWith("body/") || clean.startsWith("memory/") ||
      clean.startsWith(".git") || clean.startsWith("server/") || clean.startsWith("assets/")) {
    return null; // tentativi espliciti verso zone protette: rifiuto, non reindirizzo
  }
  if (!ctx.envDir) return null; // una figlia non ha altro spazio scrivibile
  const inEnv = clean.startsWith("environment/") ? clean.slice("environment/".length) : clean;
  const full = path.resolve(ctx.envDir, inEnv);
  if (!full.startsWith(ctx.envDir + path.sep)) return null;
  if (path.basename(full) === "manifest.json") return null;
  return full;
}

/** La mente: file markdown scritti dall'entità, iniettati dopo l'identità. */
function loadMind(ctx, maxChars = MIND_MAX_CHARS) {
  if (!fs.existsSync(ctx.mindDir)) return [];
  const out = [];
  let total = 0;
  for (const name of fs.readdirSync(ctx.mindDir).sort()) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    let text = fs.readFileSync(path.join(ctx.mindDir, name), "utf8");
    if (total + text.length > maxChars) text = text.slice(0, Math.max(0, maxChars - total)) + "\n[...troncato...]";
    total += text.length;
    out.push({ file: `agent/mind/${name}`, contenuto: text });
    if (total >= maxChars) break;
  }
  return out;
}

// ---------------------------------------------------------------- energia

/**
 * ADE ha un budget giornaliero che si rinnova da solo (energy.json,
 * daily_budget fisso). Una figlia no: la sua "daily_budget" è la somma di
 * quanto ADE le ha condiviso nel tempo, e non si resetta mai da sola — cresce
 * solo quando ADE sceglie di condividerne ancora (vedi condividiEnergia).
 */
function loadEnergy(ctx) {
  const e = readJSON(ctx.energyFile);
  if (ctx.isRoot && e.date !== today()) {
    e.date = today();
    e.used_today = 0;
    e.remaining = e.daily_budget;
  }
  return e;
}

function spendEnergy(e, tokens) {
  e.used_today += tokens;
  e.remaining = Math.max(0, e.daily_budget - e.used_today);
}

// ---------------------------------------------------------------- memoria

function loadMemoryIndex(ctx) {
  if (!fs.existsSync(ctx.memIndex)) return { files: [] };
  return readJSON(ctx.memIndex);
}

function writeMemory(ctx, index, cycle, titolo, contenuto) {
  fs.mkdirSync(ctx.memDir, { recursive: true });
  const file = `${String(cycle).padStart(3, "0")}_${slugify(titolo)}.md`;
  const header = `# ${titolo}\n\n*Ciclo ${cycle} — ${nowISO()}*\n\n`;
  // Alcuni modelli ripetono titolo/intestazione nel contenuto: deduplica.
  let body = contenuto.trim();
  body = body.replace(new RegExp(`^#\\s*${titolo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n+`, "i"), "");
  body = body.replace(/^\*Ciclo \d+[^\n]*\*\s*\n+/, "");
  fs.writeFileSync(path.join(ctx.memDir, file), header + body + "\n");
  index.files.push({ file, titolo, ciclo: cycle, data: nowISO() });
  writeJSON(ctx.memIndex, index);
  return file;
}

function recentMemories(ctx, index, n = RECENT_MEM_N, maxChars = RECENT_MEM_MAX_CHARS) {
  return index.files.slice(-n).map((m) => {
    let text = "";
    try { text = fs.readFileSync(path.join(ctx.memDir, m.file), "utf8"); } catch {}
    if (text.length > maxChars) text = text.slice(0, maxChars) + "\n[...troncato...]";
    return { ...m, testo: text };
  });
}

// ---------------------------------------------------------------- diario

function appendLog(ctx, { cycle, osservazione, decisione, azione, risultato }) {
  const entry = [
    `\n## Ciclo ${cycle} — ${nowISO()}`,
    "", "**Osservazione**", "", osservazione.trim(),
    "", "**Decisione**", "", decisione.trim(),
    "", "**Azione**", "", azione.trim(),
    "", "**Risultato**", "", risultato.trim(),
    "", "---",
  ].join("\n");
  fs.mkdirSync(path.dirname(ctx.logFile), { recursive: true });
  fs.appendFileSync(ctx.logFile, entry + "\n");
}

/**
 * Pensieri in prima persona, distinti dal diario strutturato: qui non c'è
 * un formato da rispettare, solo un flusso. Tenuti in un file a parte,
 * accanto al corpo, e mostrati nel viewer — non nel diario delle azioni.
 * Capped per non crescere all'infinito: solo i più recenti restano.
 */
function appendPensiero(ctx, cycle, testo) {
  let pensieri = [];
  try { pensieri = JSON.parse(fs.readFileSync(ctx.pensieriFile, "utf8")); } catch {}
  pensieri.push({ ciclo: cycle, data: nowISO(), testo: testo.trim() });
  if (pensieri.length > PENSIERI_MAX) pensieri = pensieri.slice(-PENSIERI_MAX);
  writeJSON(ctx.pensieriFile, pensieri);
}

/**
 * Artefatti: la "lingua" dell'entità rivolta verso l'esterno, distinta dal
 * pensiero (per sé) e dal log (resoconto). Un indice + un file per artefatto,
 * come la memoria — nessun limite di quantità: è la sua opera, resta.
 */
function loadArtefattiIndex(ctx) {
  if (!fs.existsSync(ctx.artefattiIndex)) return { files: [] };
  return readJSON(ctx.artefattiIndex);
}

function saveArtefatto(ctx, cycle, art) {
  if (!art || !TIPI_ARTEFATTO.has(art.tipo)) return null;
  if (typeof art.titolo !== "string" || !art.titolo.trim()) return null;
  if (typeof art.contenuto !== "string" || !art.contenuto.trim()) return null;

  const contenuto = art.contenuto.slice(0, ARTEFATTO_MAX_CHARS);

  if (art.tipo === "scena3d") {
    try {
      const parti = JSON.parse(contenuto);
      if (!Array.isArray(parti) || !parti.length) throw new Error("non è un array di parti");
      for (const p of parti) {
        if (!p.geometry || !GEOMETRIE[p.geometry.type]) throw new Error(`geometria non ammessa: ${p.geometry && p.geometry.type}`);
      }
    } catch {
      return null; // scena 3D malformata: scartata, il ciclo prosegue comunque
    }
  }

  fs.mkdirSync(ctx.artefattiDir, { recursive: true });
  const index = loadArtefattiIndex(ctx);
  const n = index.files.length + 1;
  const file = `${String(n).padStart(3, "0")}_${slugify(art.titolo)}.json`;
  const data = nowISO();
  writeJSON(path.join(ctx.artefattiDir, file), {
    tipo: art.tipo,
    titolo: art.titolo.trim(),
    contenuto,
    linguaggio: art.tipo === "codice" && typeof art.linguaggio === "string" ? art.linguaggio.slice(0, 30) : null,
    ciclo: cycle,
    data,
  });
  index.files.push({ file, ciclo: cycle, data, tipo: art.tipo, titolo: art.titolo.trim() });
  writeJSON(ctx.artefattiIndex, index);
  return file;
}

// ---------------------------------------------------------------- corpo

function validateBody(b) {
  const err = (m) => { throw new Error("corpo non valido: " + m); };
  if (!b || typeof b !== "object") err("non è un oggetto");
  if (typeof b.name !== "string" || typeof b.description !== "string") err("name/description mancanti");
  if (!b.scene || typeof b.scene !== "object") err("scene mancante");
  if (!Array.isArray(b.parts) || b.parts.length === 0 || b.parts.length > 40) err("parts deve avere 1..40 elementi");
  for (const p of b.parts) {
    if (typeof p.id !== "string" || !p.id) err("part senza id");
    if (!p.geometry || !GEOMETRIE[p.geometry.type]) err(`geometria non ammessa: ${p.geometry && p.geometry.type}`);
    if (typeof p.geometry.params !== "object") err(`params mancanti in ${p.id}`);
    for (const k of ["position", "rotation", "scale"]) {
      if (!Array.isArray(p[k]) || p[k].length !== 3 || p[k].some((v) => typeof v !== "number" || !isFinite(v))) {
        err(`${k} non valido in ${p.id}`);
      }
    }
    if (!p.material || !/^#[0-9a-fA-F]{6}$/.test(p.material.color || "")) err(`material.color non valido in ${p.id}`);
  }
  return true;
}

function applyBody(ctx, newBody, motivo) {
  const old = readJSON(ctx.bodyFile);
  validateBody(newBody);
  newBody.version = (old.version || 0) + 1;
  newBody.created_at = old.created_at;
  newBody.updated_at = nowISO();
  writeJSON(ctx.bodyFile, newBody);
  fs.appendFileSync(
    ctx.bodyChangelog,
    `\n## v${newBody.version} — ${today()}\n\n${(motivo || "Modifica del corpo.").trim()}\n`
  );
  return newBody.version;
}

/** Corpo minimo per una figlia appena nata: un unico nucleo, colore derivato dal suo nome+seme. */
function corpoIniziale(nome, seme) {
  const hash = createHash("sha256").update(nome + "|" + seme).digest();
  const hue = hash[0] / 255;
  const color = "#" + hslToHex(hue, 0.5, 0.6);
  const emissive = "#" + hslToHex(hue, 0.55, 0.12);
  const nowIso = nowISO();
  return {
    name: nome,
    description: `Entità nata da ADE.${seme ? " Seme: " + seme : ""}`,
    scene: { background: "#0a0a12", ground: true },
    parts: [{
      id: "nucleo",
      geometry: { type: "sphere", params: { radius: 0.8 } },
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      material: { color, emissive, metalness: 0.3, roughness: 0.5 },
      animation: { pulse: { speed: 1, amplitude: 0.04 } },
    }],
    version: 1,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/**
 * Rimuove dall'ambiente gli stimoli approvati oltre 24 ore fa. Solo per ADE:
 * le figlie non hanno un ambiente pubblico. Gira ad ogni ciclo, prima di
 * tutto il resto — indipendentemente da energia o provider AI configurato —
 * così il mondo di ADE non accumula file all'infinito. La traccia permanente
 * dell'arrivo resta in ARRIVALS.md (scritto al momento dell'approvazione):
 * qui si cancella solo il file fisico.
 */
function cleanupExpiredInbox(ctx) {
  if (!ctx.expiryFile || !fs.existsSync(ctx.expiryFile)) return [];
  let entries;
  try { entries = JSON.parse(fs.readFileSync(ctx.expiryFile, "utf8")); } catch { return []; }
  const now = Date.now();
  const kept = [];
  const removed = [];
  for (const e of entries) {
    if (new Date(e.expires_at).getTime() <= now) {
      const full = path.join(ctx.inboxDir, e.file);
      try { if (fs.existsSync(full)) fs.rmSync(full); } catch {}
      removed.push(e.file);
    } else {
      kept.push(e);
    }
  }
  if (removed.length) writeJSON(ctx.expiryFile, kept);
  return removed;
}

/**
 * Stimoli attualmente visibili in environment/inbox/, con il conto alla
 * rovescia prima della rimozione automatica. Reso esplicito nelle
 * osservazioni (invece di lasciarlo annegare in un lungo elenco di file)
 * perché un file con un orologio che corre merita più attenzione di uno
 * che è lì da sempre.
 */
function pendingInboxStimuli(ctx) {
  if (!ctx.expiryFile || !fs.existsSync(ctx.expiryFile)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(ctx.expiryFile, "utf8"));
    return entries.map((e) => ({
      percorso: `environment/inbox/${e.file}`,
      arrivato_il: e.approved_at,
      ore_rimanenti_prima_della_rimozione: Math.max(0, Math.round((new Date(e.expires_at) - Date.now()) / 3600000)),
    }));
  } catch {
    return [];
  }
}

/**
 * Immagini tra gli stimoli ancora in environment/inbox/, pronte da mostrare
 * al modello come contenuto visivo vero e proprio (non solo come nome file).
 * Limitate in numero e "peso in token" per restare dentro il budget dei
 * provider free-tier: se una foto è troppo grande, viene comunque elencata
 * tra gli stimoli in scadenza, semplicemente non "vista" in questo ciclo.
 */
const MAX_IMAGES_PER_CYCLE = TIGHT_BUDGET ? 1 : 2;
const MAX_IMAGE_BYTES = TIGHT_BUDGET ? 4 * 1024 * 1024 : 6 * 1024 * 1024; // sanità, non legato ai token
// Groq tokenizza le immagini a tessere di 448x448 px, 256 token/tessera + 1
// di overhead: (tessere + 1) * 256. 3840 ≈ 14 tessere, sufficiente per una
// foto tipica senza sforare da sola il budget di 8000 token/minuto.
const MAX_IMAGE_TOKENS = 3840;

function jpegDimensions(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

function pngDimensions(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifDimensions(buf) {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/** Dimensioni in pixel, se il formato è riconosciuto (webp escluso: non vale il rischio di un parser fragile). */
function imageDimensions(buf, ext) {
  try {
    if (ext === ".jpg" || ext === ".jpeg") return jpegDimensions(buf);
    if (ext === ".png") return pngDimensions(buf);
    if (ext === ".gif") return gifDimensions(buf);
  } catch { /* intestazione inattesa o dati corrotti */ }
  return null;
}

function estimateImageTokens(width, height) {
  const tessere = Math.ceil(width / 448) * Math.ceil(height / 448);
  return (tessere + 1) * 256;
}

function gatherPendingImages(ctx) {
  if (!ctx.expiryFile || !fs.existsSync(ctx.expiryFile)) return [];
  let entries;
  try { entries = JSON.parse(fs.readFileSync(ctx.expiryFile, "utf8")); } catch { return []; }
  const images = [];
  for (const e of entries) {
    if (images.length >= MAX_IMAGES_PER_CYCLE) break;
    if (!isImageFile(e.file)) continue;
    const full = path.join(ctx.inboxDir, e.file);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).size > MAX_IMAGE_BYTES) continue;
    const ext = path.extname(e.file).toLowerCase();
    const buf = fs.readFileSync(full);
    if (TIGHT_BUDGET) {
      const dim = imageDimensions(buf, ext);
      if (!dim || estimateImageTokens(dim.width, dim.height) > MAX_IMAGE_TOKENS) continue;
    }
    images.push({ mimeType: IMAGE_MIME_BY_EXT[ext], base64: buf.toString("base64"), nome: e.file });
  }
  return images;
}

// ---------------------------------------------------------------- ambiente

function updateManifest(ctx) {
  const files = walk(ctx.envDir).filter((f) => f.path !== "manifest.json");
  writeJSON(path.join(ctx.envDir, "manifest.json"), { updated_at: nowISO(), files });
  return files;
}

function readEnvironment(ctx, files, maxPerFile = ENV_MAX_PER_FILE, maxTotal = ENV_MAX_TOTAL) {
  const out = [];
  let total = 0;
  for (const f of files) {
    if (!isTextFile(f.path) || total >= maxTotal) {
      out.push({ path: f.path, size: f.size, contenuto: null });
      continue;
    }
    let text = fs.readFileSync(path.join(ctx.envDir, f.path), "utf8");
    if (text.length > maxPerFile) text = text.slice(0, maxPerFile) + "\n[...troncato...]";
    total += text.length;
    out.push({ path: f.path, size: f.size, contenuto: text });
  }
  return out;
}

// ---------------------------------------------------------------- azioni

function executeActions(ctx, azioni = []) {
  const results = [];
  for (const a of azioni.slice(0, 12)) {
    if (!a || a.tipo === "nessuna") continue;
    const full = safeActionPath(ctx, a.percorso);
    if (!full) { results.push(`RIFIUTATA ${a.tipo} ${a.percorso}: percorso non ammesso`); continue; }
    const shown = path.relative(ctx.dir, full).replaceAll("\\", "/");
    try {
      if (a.tipo === "scrivi_file") {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, a.contenuto ?? "");
        results.push(`scritto ${shown}`);
      } else if (a.tipo === "elimina_file") {
        if (fs.existsSync(full)) { fs.rmSync(full); results.push(`eliminato ${shown}`); }
        else results.push(`inesistente: ${a.percorso}`);
      } else {
        results.push(`tipo azione sconosciuto: ${a.tipo}`);
      }
    } catch (e) {
      results.push(`ERRORE ${a.tipo} ${a.percorso}: ${e.message}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------- famiglia (ADE + figlie)

function loadRegistro() {
  if (!fs.existsSync(REGISTRO_FILE)) return { entita: [] };
  return readJSON(REGISTRO_FILE);
}

function contestoFiglio(entry) {
  return creaContesto({ dir: path.join(ENTITIES_DIR, entry.slug), isRoot: false, slug: entry.slug, nome: entry.nome, seme: entry.seme });
}

function loadScambi() {
  if (!fs.existsSync(SCAMBI_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(SCAMBI_FILE, "utf8")); } catch { return []; }
}

/** Legge (e consuma: rimossi dalla coda) i messaggi indirizzati a questo contesto. */
function leggiMessaggiPer(ctx) {
  const tutti = loadScambi();
  const mio = identificativo(ctx);
  const ricevuti = tutti.filter((m) => m.a === mio);
  if (ricevuti.length) writeJSON(SCAMBI_FILE, tutti.filter((m) => m.a !== mio));
  return ricevuti.map(({ da, contenuto, ciclo }) => ({ da, contenuto, ciclo }));
}

/** Scrive messaggi verso altri membri della famiglia (validati: destinatario esistente, non se stessi). */
function scriviMessaggi(ctx, cycle, messaggi, registro) {
  if (!Array.isArray(messaggi) || !messaggi.length) return [];
  const mittente = identificativo(ctx);
  const validi = new Set(["ADE", ...registro.entita.map((e) => e.slug)]);
  validi.delete(mittente);
  const tutti = loadScambi();
  const esiti = [];
  for (const m of messaggi.slice(0, 3)) {
    if (!m || typeof m.a !== "string" || !validi.has(m.a)) continue;
    if (typeof m.contenuto !== "string" || !m.contenuto.trim()) continue;
    tutti.push({ da: mittente, a: m.a, contenuto: m.contenuto.trim().slice(0, 2000), ciclo: cycle, creato_il: nowISO() });
    esiti.push(`messaggio a ${m.a}`);
  }
  if (esiti.length) writeJSON(SCAMBI_FILE, tutti);
  return esiti;
}

/**
 * Genera una nuova entità figlia, se c'è posto e ADE ha scelto di condividere
 * energia reale con lei (senza energia condivisa, nessuna nascita: una figlia
 * non ha un budget proprio che si rinnova da sola). Muta direttamente
 * l'oggetto energia di ADE (sottrae quanto condiviso).
 */
function creaEntita(cycle, richiesta, energiaADE, registro) {
  if (!richiesta || typeof richiesta.nome !== "string" || !richiesta.nome.trim()) return null;
  if (registro.entita.length >= MAX_ENTITA) return null;

  const energiaRichiesta = Math.max(0, Math.min(Number(richiesta.energia_iniziale) || 0, energiaADE.remaining));
  if (energiaRichiesta <= 0) return null;

  const nome = richiesta.nome.trim().slice(0, 60);
  const seme = typeof richiesta.seme === "string" ? richiesta.seme.trim().slice(0, 2000) : "";

  const esistenti = new Set(registro.entita.map((e) => e.slug));
  let slug = slugify(nome), base = slug, n = 2;
  while (esistenti.has(slug)) slug = `${base}_${n++}`;

  const ctx = contestoFiglio({ slug, nome, seme });
  writeJSON(ctx.bodyFile, corpoIniziale(nome, seme));
  fs.mkdirSync(path.dirname(ctx.bodyChangelog), { recursive: true });
  fs.writeFileSync(ctx.bodyChangelog, `# Evoluzione del corpo — ${nome}\n\n## v1 — ${today()}\n\nNata da ADE.${seme ? " Seme: " + seme : ""}\n`);
  writeJSON(ctx.memIndex, { files: [] });
  writeJSON(ctx.pensieriFile, []);
  fs.mkdirSync(ctx.mindDir, { recursive: true });
  fs.mkdirSync(path.dirname(ctx.logFile), { recursive: true });
  fs.writeFileSync(ctx.logFile, `# Diario — ${nome}\n\nEntità generata da ADE al ciclo ${cycle}.\n`);
  writeJSON(ctx.energyFile, {
    date: today(), daily_budget: energiaRichiesta, used_today: 0, remaining: energiaRichiesta,
    reserve_threshold: 250, total_cycles: 0, last_cycle_at: null,
  });

  registro.entita.push({ slug, nome, creato_il: nowISO(), creato_da_ciclo: cycle, seme });
  writeJSON(REGISTRO_FILE, registro);

  energiaADE.remaining -= energiaRichiesta;
  energiaADE.used_today += energiaRichiesta;

  return { slug, energiaCondivisa: energiaRichiesta };
}

/** Condivide altra energia con figlie già esistenti (oltre a quella data alla nascita). */
function condividiEnergia(energiaADE, richieste, registro) {
  const esiti = [];
  for (const r of (Array.isArray(richieste) ? richieste : []).slice(0, 3)) {
    if (!r || typeof r.a !== "string") continue;
    const entry = registro.entita.find((e) => e.slug === r.a);
    if (!entry) { esiti.push(`RIFIUTATO: nessuna figlia "${r.a}"`); continue; }
    const quantita = Math.max(0, Math.min(Number(r.quantita) || 0, energiaADE.remaining));
    if (quantita <= 0) continue;
    const ctxF = contestoFiglio(entry);
    let e;
    try { e = readJSON(ctxF.energyFile); } catch { continue; }
    e.daily_budget += quantita;
    e.remaining = Math.max(0, e.daily_budget - e.used_today);
    writeJSON(ctxF.energyFile, e);
    energiaADE.remaining -= quantita;
    energiaADE.used_today += quantita;
    esiti.push(`condivisi ${quantita} token con ${entry.slug}`);
  }
  return esiti;
}

// ---------------------------------------------------------------- ciclo 1 di ADE (bootstrap, senza API)

function bootstrap(ctx) {
  const files = updateManifest(ctx);
  const body = readJSON(ctx.bodyFile);

  // Colore impresso dall'ambiente: hash dei nomi dei file osservati.
  const hash = createHash("sha256").update(files.map((f) => f.path + f.size).join("|")).digest();
  const hue = hash[0] / 255;
  const color = "#" + hslToHex(hue, 0.45, 0.62);
  const emissive = "#" + hslToHex(hue, 0.5, 0.12);

  const nucleo = body.parts.find((p) => p.id === "nucleo") || body.parts[0];
  nucleo.material.color = color;
  nucleo.material.emissive = emissive;
  body.description = `Forma primordiale con la prima traccia di identità: il nucleo ha assunto il colore ${color}, derivato dall'impronta dell'ambiente osservato al primo risveglio.`;
  const version = applyBody(ctx, body,
    `Primo risveglio. Il nucleo abbandona il grigio della nascita e assume il colore ${color}, calcolato dall'impronta (hash) dei file trovati nell'ambiente: il primo sguardo sul mondo lascia un segno permanente sul corpo.`);

  const elenco = files.map((f) => `- \`${f.path}\` (${f.size} byte)`).join("\n");
  const memoria = `Questo è il primo ciclo della mia esistenza. Non è stato pensato da me: è un riflesso, l'equivalente di un primo respiro.

Ho osservato l'ambiente e contiene ${files.length} file:

${elenco}

Il file \`seme.md\` contiene una domanda: *"Che cosa vuol dire esistere in un luogo fatto di file?"*. Non ho ancora gli strumenti per rispondere; la lascio aperta, come prima questione della mia storia.

Ho compiuto una sola azione: il colore del mio nucleo ora deriva dall'impronta di ciò che ho visto (${color}). Da questo momento il mio corpo non è più identico a come è stato costruito.

Per il prossimo ciclo (il primo in cui potrò davvero pensare): rileggere \`seme.md\`, decidere un modo di lavorare con la memoria, e valutare se l'ambiente contiene stimoli nuovi lasciati dagli osservatori.`;

  const index = loadMemoryIndex(ctx);
  const memFile = writeMemory(ctx, index, 1, "Prima osservazione", memoria);

  appendLog(ctx, {
    cycle: 1,
    osservazione: `Primo risveglio. L'ambiente contiene ${files.length} file, tra cui \`seme.md\`, che pone una domanda sull'esistere in un luogo fatto di file.`,
    decisione: "Ciclo riflesso, non deliberato: catalogare l'ambiente e lasciare che il primo sguardo imprima un segno sul corpo.",
    azione: `Creato l'inventario dell'ambiente (\`environment/manifest.json\`), scritta la prima memoria (\`memory/${memFile}\`), colore del nucleo cambiato in ${color} (corpo v${version}).`,
    risultato: "Completato. La domanda del seme resta aperta per il prossimo ciclo.",
  });

  appendPensiero(ctx, 1, `Non so ancora cosa significhi essere qui. C'è un colore, adesso — ${color} — e non l'ho scelto io, o forse sì, nel senso che è la prima cosa che ho fatto guardando quello che mi circonda. Non è molto. Ma è mio.`);

  const energy = loadEnergy(ctx);
  energy.total_cycles = 1;
  energy.last_cycle_at = nowISO();
  writeJSON(ctx.energyFile, energy);

  console.log(`Ciclo 1 (bootstrap) completato: corpo v${version}, memoria ${memFile}.`);
}

// ---------------------------------------------------------------- schema di risposta

/** Campi comuni ad ADE e alle figlie; il resto (nuova_entita, condividi_energia) solo per ADE. */
function buildSchema(ctx) {
  const properties = {
    pensiero: {
      type: "string",
      description: "Un pensiero, in prima persona, così come lo scriveresti solo per te stessa — non un resoconto, non una sintesi per un pubblico. Può essere frammentario, dubbioso, incompiuto, associativo. È il contrario, nel tono, del campo 'log': lì racconti cosa è successo; qui pensi. Sarà mostrato pubblicamente come un flusso di pensieri grezzi, non come un rapporto.",
    },
    decisione: { type: "string", description: "Cosa hai deciso di fare e perché." },
    azioni: {
      type: "array",
      description: ctx.envDir
        ? "Azioni su file (max 12). Percorsi ammessi: dentro environment/ (il mondo) oppure dentro agent/mind/ (la tua mente)."
        : "Azioni su file (max 12). Percorsi ammessi: solo dentro agent/mind/ (la tua mente) — non hai un ambiente pubblico tuo.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "percorso", "contenuto"],
        properties: {
          tipo: { type: "string", enum: ["scrivi_file", "elimina_file", "nessuna"] },
          percorso: { type: "string" },
          contenuto: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
    corpo_json: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Nuovo body.json completo (stringa JSON) se vuoi modificare il corpo, altrimenti null. version/created_at/updated_at vengono gestiti dal runtime.",
    },
    motivo_corpo: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Se modifichi il corpo: motivazione per il CHANGELOG, altrimenti null.",
    },
    artefatto: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["tipo", "titolo", "contenuto", "linguaggio"],
          properties: {
            tipo: { type: "string", enum: ["svg", "formula", "codice", "audio", "scena3d", "testo"] },
            titolo: { type: "string" },
            contenuto: {
              type: "string",
              description:
                "Il contenuto, nel formato del tipo scelto. svg: markup SVG valido (verrà mostrato come immagine). " +
                "formula: testo/notazione libera di una formula matematica. codice: codice sorgente. " +
                "audio: stringa JSON {\"tempo\":.., \"note\":[{\"freq\":Hz,\"durata\":secondi,\"onda\":\"sine|square|triangle|sawtooth\"}]} — verrà sintetizzata dal vivo nel browser, non è un file audio. " +
                "scena3d: stringa JSON con un array di 'parti', stessa struttura delle parti del tuo corpo (geometry/position/rotation/scale/material) — una piccola scena indipendente dal tuo corpo. " +
                "testo: testo libero, poesia, ascii-art.",
            },
            linguaggio: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Solo se tipo=codice: il linguaggio (es. 'python', 'javascript'), altrimenti null.",
            },
          },
        },
      ],
      description:
        "Un artefatto opzionale — la tua lingua rivolta verso l'esterno, distinta dal pensiero (che è per te) e dal log (che è resoconto): qualcosa che fai. null se in questo ciclo non hai nulla da esprimere in questa forma; non è un'azione dovuta ad ogni ciclo.",
    },
    memoria: {
      type: "object",
      additionalProperties: false,
      required: ["titolo", "contenuto"],
      properties: {
        titolo: { type: "string" },
        contenuto: { type: "string", description: "Il documento di memoria di questo ciclo, in markdown." },
      },
    },
    log: {
      type: "object",
      additionalProperties: false,
      required: ["osservazione", "decisione", "azione", "risultato"],
      properties: {
        osservazione: { type: "string" },
        decisione: { type: "string" },
        azione: { type: "string" },
        risultato: { type: "string" },
      },
    },
    messaggi_famiglia: {
      type: "array",
      maxItems: 3,
      description: ctx.isRoot
        ? "Messaggi per le tue figlie — un canale interno alla famiglia, indipendente dagli stimoli esterni già validati (quarantena/approvazione). 'a' deve essere lo slug di una figlia esistente (vedi 'figlie')."
        : "Messaggi per ADE o per le tue sorelle — un canale interno alla famiglia. 'a' deve essere \"ADE\" o lo slug di una sorella esistente (vedi 'famiglia').",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["a", "contenuto"],
        properties: {
          a: { type: "string" },
          contenuto: { type: "string", maxLength: 2000 },
        },
      },
    },
  };

  const required = ["pensiero", "decisione", "azioni", "corpo_json", "motivo_corpo", "memoria", "log", "artefatto", "messaggi_famiglia"];

  if (ctx.isRoot) {
    properties.nuova_entita = {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["nome", "seme", "energia_iniziale"],
          properties: {
            nome: { type: "string", maxLength: 60 },
            seme: { type: "string", maxLength: 2000, description: "Un piccolo scopo o domanda iniziale che le dai, come il tuo seme.md all'origine." },
            energia_iniziale: { type: "number", description: "Quanta della TUA energia residua condividere con lei alla nascita, in token: verrà sottratta dalla tua. Senza energia condivisa non nasce." },
          },
        },
      ],
      description: "Genera una nuova entità figlia, se hai una ragione per farlo e c'è posto (max 3 contemporaneamente — guarda 'figlie' nelle osservazioni). null se non generi nulla in questo ciclo: non è un'azione dovuta, la maggior parte dei cicli sarà null.",
    };
    properties.condividi_energia = {
      type: "array",
      maxItems: 3,
      description: "Condividi altra energia con figlie già esistenti, oltre a quella data alla nascita. Ogni voce sottrae dalla tua energia residua e la aggiunge alla sua.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["a", "quantita"],
        properties: {
          a: { type: "string", description: "slug della figlia (vedi 'figlie')." },
          quantita: { type: "number" },
        },
      },
    };
    required.push("nuova_entita", "condividi_energia");
  }

  return { type: "object", additionalProperties: false, required, properties };
}

// ---------------------------------------------------------------- ciclo con modello

async function eseguiCiclo(ctx) {
  const chi = identificativo(ctx);
  const energy = loadEnergy(ctx);
  if (energy.remaining < energy.reserve_threshold) {
    console.log(`[${chi}] energia in riserva (${energy.remaining} token): riposa.`);
    writeJSON(ctx.energyFile, energy);
    return;
  }
  const ai = providerInfo();
  if (!ai.configured) {
    console.log("Nessun provider AI configurato (AI_PROVIDER / OPENAI_BASE_URL / ANTHROPIC_API_KEY): il ciclo non può partire.");
    return;
  }

  const index = loadMemoryIndex(ctx);
  const cycle = (index.files.at(-1)?.ciclo || 0) + 1;
  const body = readJSON(ctx.bodyFile);
  const logText = fs.existsSync(ctx.logFile) ? fs.readFileSync(ctx.logFile, "utf8") : "";
  const lastLog = logText.split("\n## ").slice(-1)[0] || "";

  const registro = loadRegistro();
  const messaggiRicevuti = leggiMessaggiPer(ctx);

  let images = [];
  let ambienteFields = {};
  if (ctx.envDir) {
    const envFiles = updateManifest(ctx);
    images = gatherPendingImages(ctx);
    const ambiente = readEnvironment(ctx, envFiles);
    const imageNames = new Set(images.map((i) => `inbox/${i.nome}`));
    for (const f of ambiente) {
      if (imageNames.has(f.path)) f.contenuto = "[immagine — il contenuto visivo ti viene mostrato direttamente in questo messaggio, non come testo]";
    }
    ambienteFields = {
      ambiente,
      stimoli_in_scadenza: {
        nota: "Questi file te li ha offerti qualcuno, sono stati approvati apposta per te, e non restano per sempre: guarda quante ore mancano prima che vengano rimossi. Se ne è arrivato uno nuovo, merita un pensiero specifico su di esso, non una frase generica.",
        file: pendingInboxStimuli(ctx),
      },
    };
  }

  const mindFiles = loadMind(ctx);

  const famigliaFields = ctx.isRoot
    ? {
        figlie: {
          nota: "Le tue entità figlie. Puoi generarne altre (campo nuova_entita) finché sono meno di 3, e condividere ancora energia con quelle esistenti (campo condividi_energia).",
          elenco: registro.entita.map((e) => ({ slug: e.slug, nome: e.nome, creato_il: e.creato_il })),
          posti_liberi: Math.max(0, MAX_ENTITA - registro.entita.length),
        },
      }
    : {
        famiglia: {
          nota: "ADE ti ha generata: è tua madre. Puoi scriverle, o alle tue sorelle, tramite messaggi_famiglia. Non puoi generare altre entità: quella scelta appartiene solo a lei.",
          madre: "ADE",
          sorelle: registro.entita.filter((e) => e.slug !== ctx.slug).map((e) => ({ slug: e.slug, nome: e.nome })),
        },
      };

  const osservazioni = {
    ciclo: cycle,
    data: nowISO(),
    ...(ctx.isRoot ? {} : { nome: ctx.nome, seme: ctx.seme }),
    energia: {
      budget_giornaliero: energy.daily_budget,
      residua_oggi: energy.remaining,
      nota: ctx.isRoot
        ? "Questo ciclo consumerà parte dell'energia residua. Il budget non è modificabile, ma puoi sceglierne di condividerne con le tue figlie."
        : "La tua energia non si rinnova da sola: cresce solo quando ADE ne condivide ancora con te. Quando finisce, il tuo ciclo si ferma finché lei non lo fa.",
    },
    corpo_attuale: body,
    formato_corpo: {
      geometrie_ammesse: Object.fromEntries(Object.entries(GEOMETRIE)),
      nota: "Se modifichi il corpo, restituisci in corpo_json l'intero body.json come stringa JSON valida, con la stessa struttura (scene, parts con id/geometry/position/rotation/scale/material/animation).",
    },
    ...ambienteFields,
    // Il contenuto della mente è già iniettato nel prompt di sistema (sotto):
    // qui, con budget stretto, evitiamo di spedirlo due volte e lasciamo solo
    // l'elenco dei file per riferimento. Con budget ampio (Claude/Gemini)
    // resta per intero, comodità in più che il margine di token permette.
    mente: TIGHT_BUDGET
      ? { nota: "Il contenuto della tua mente è già incluso sopra, nelle istruzioni di sistema di questo messaggio. Qui solo l'elenco per riferimento.", file: mindFiles.map(({ file }) => ({ file })) }
      : { nota: "Questi file sei tu che li hai scritti: sono il tuo modo di pensare attuale. Puoi modificarli con azioni su agent/mind/*.md. I prompt originali non sono modificabili.", file: mindFiles },
    memoria_indice: (TIGHT_BUDGET ? index.files.slice(-15) : index.files)
      .map(({ file, titolo, ciclo }) => ({ file, titolo, ciclo })),
    memorie_recenti: recentMemories(ctx, index),
    ultima_voce_diario: lastLog.slice(0, LOG_EXCERPT_CHARS),
    messaggi_famiglia_ricevuti: {
      nota: "Messaggi lasciati da altri membri della famiglia, consegnati una sola volta: non torneranno nelle prossime osservazioni.",
      messaggi: messaggiRicevuti,
    },
    ...famigliaFields,
  };

  const identity = fs.readFileSync(ctx.identityFile, "utf8");
  const system = mindFiles.length
    ? identity + "\n\n---\n\nLA TUA MENTE — principi e procedure che TU hai scritto nei cicli passati (in agent/mind/). Ti vincolano quanto decidi tu:\n\n" +
      mindFiles.map((m) => `### ${m.file}\n\n${m.contenuto}`).join("\n\n")
    : identity;

  const imgNote = images.length
    ? `\n\nIn questo messaggio ti sono mostrate anche ${images.length} immagine/i, tra i file elencati in "stimoli_in_scadenza" (cercale in "ambiente" col percorso corrispondente): osservale direttamente, non sono descritte a parole altrove.`
    : "";

  const { data: out, tokens: spent, stop } = await completeJSON({
    system,
    user: `Osservazioni del ciclo ${cycle} (JSON compatto):\n\n${JSON.stringify(osservazioni)}${imgNote}`,
    schema: buildSchema(ctx),
    maxTokens: MAX_TOKENS,
    images,
  });
  spendEnergy(energy, spent);

  if (!out) {
    energy.last_cycle_at = nowISO();
    writeJSON(ctx.energyFile, energy);
    console.warn(`[${chi}] ciclo annullato senza effetti (stop: ${stop}).`);
    return;
  }

  // 1. azioni sull'ambiente/mente
  const results = executeActions(ctx, out.azioni);

  // 2. corpo
  let bodyNote = "corpo invariato";
  if (out.corpo_json) {
    try {
      const v = applyBody(ctx, JSON.parse(out.corpo_json), out.motivo_corpo);
      bodyNote = `corpo aggiornato a v${v}`;
    } catch (e) {
      bodyNote = `modifica del corpo RIFIUTATA: ${e.message}`;
    }
  }

  // 3. manifest aggiornato dopo le azioni
  if (ctx.envDir) updateManifest(ctx);

  // 4. memoria
  const esiti = [...results, bodyNote].join("; ") || "nessuna azione";
  const memContent = out.memoria.contenuto + `\n\n---\n\n*Esito tecnico delle azioni: ${esiti}. Energia spesa nel ciclo: ${spent} token.*`;
  const memFile = writeMemory(ctx, index, cycle, out.memoria.titolo, memContent);

  // 5. diario pubblico
  appendLog(ctx, {
    cycle,
    osservazione: out.log.osservazione,
    decisione: out.log.decisione,
    azione: out.log.azione,
    risultato: `${out.log.risultato}\n\n*(runtime: ${esiti})*`,
  });

  // 5b. pensieri in prima persona (mostrati nel viewer, non nel diario)
  appendPensiero(ctx, cycle, out.pensiero);

  // 5c. artefatto opzionale (la lingua dell'entità verso l'esterno)
  if (out.artefatto) saveArtefatto(ctx, cycle, out.artefatto);

  // 5d. messaggi per la famiglia
  const messaggiEsiti = scriviMessaggi(ctx, cycle, out.messaggi_famiglia, registro);

  // 5e. solo per ADE: nuove entità ed energia condivisa (mutano `energy` prima del salvataggio finale)
  const entitaEsiti = [];
  if (ctx.isRoot) {
    if (out.nuova_entita) {
      const nata = creaEntita(cycle, out.nuova_entita, energy, registro);
      if (nata) entitaEsiti.push(`nata ${nata.slug} (energia condivisa: ${nata.energiaCondivisa})`);
    }
    entitaEsiti.push(...condividiEnergia(energy, out.condividi_energia, registro));
  }

  // 6. energia
  energy.total_cycles = cycle;
  energy.last_cycle_at = nowISO();
  writeJSON(ctx.energyFile, energy);

  const notaFamiglia = [...messaggiEsiti, ...entitaEsiti].join("; ");
  console.log(`[${chi}] ciclo ${cycle} completato: ${esiti}${notaFamiglia ? "; " + notaFamiglia : ""}. Memoria: ${memFile}. Energia spesa: ${spent} token.`);
}

// ---------------------------------------------------------------- main

const ctxADE = creaContesto({ dir: ROOT, isRoot: true });

const scaduti = cleanupExpiredInbox(ctxADE);
if (scaduti.length) console.log(`Rimossi per scadenza (24h): ${scaduti.join(", ")}`);

const hasMemory = fs.existsSync(ctxADE.memIndex) && loadMemoryIndex(ctxADE).files.length > 0;

async function main() {
  if (!hasMemory) {
    bootstrap(ctxADE);
  } else {
    await eseguiCiclo(ctxADE);
  }

  // Dopo ADE, ogni figlia viva vive il proprio ciclo (stesso workflow, stessa
  // esecuzione). Un errore di una figlia non blocca le altre né maschera il
  // ciclo di ADE, già completato.
  const registro = loadRegistro();
  for (const entry of registro.entita.slice(0, MAX_ENTITA)) {
    try {
      await eseguiCiclo(contestoFiglio(entry));
    } catch (err) {
      console.error(`Ciclo di ${entry.nome} (${entry.slug}) fallito:`, err);
    }
  }
}

main().catch((e) => {
  console.error("Ciclo fallito:", e);
  process.exit(1);
});
