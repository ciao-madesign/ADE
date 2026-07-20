#!/usr/bin/env node
/**
 * ADE — ciclo operativo autonomo.
 *
 * osserva ambiente → rileggi memoria → analizza → rifletti → decidi
 *   → esegui azioni → aggiorna corpo → aggiorna memoria → aggiorna diario
 *
 * Il primo ciclo (nessuna memoria presente) è deterministico e non chiama
 * l'API: l'entità "apre gli occhi", cataloga l'ambiente e imprime nel corpo
 * un colore derivato da ciò che ha visto. I cicli successivi richiedono
 * ANTHROPIC_API_KEY; senza chiave il processo esce senza effetti.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { completeJSON, providerInfo } from "./llm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_DIR = path.join(ROOT, "environment");
const MEM_DIR = path.join(ROOT, "memory");
const MIND_DIR = path.join(ROOT, "agent", "mind");
const BODY_FILE = path.join(ROOT, "body", "body.json");
const BODY_CHANGELOG = path.join(ROOT, "body", "CHANGELOG.md");
const LOG_FILE = path.join(ROOT, "ACTION_LOG.md");
const ENERGY_FILE = path.join(ROOT, "agent", "state", "energy.json");
const IDENTITY_FILE = path.join(ROOT, "agent", "prompts", "identity.md");
const MEM_INDEX = path.join(MEM_DIR, "index.json");
const INBOX_DIR = path.join(ENV_DIR, "inbox");
const EXPIRY_FILE = path.join(INBOX_DIR, ".expiry.json");

// Spazio riservato alla risposta del modello. I provider free-tier (Groq &co.)
// contano prompt + spazio-risposta nel limite al minuto: teniamolo prudente.
// Sovrascrivibile con la variabile AI_MAX_TOKENS.
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS) ||
  (providerInfo().provider === "anthropic" ? 16000 : 6000);

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
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
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

/**
 * Percorso d'azione sicuro. L'entità può agire in due territori:
 *  - environment/**            (il suo mondo)
 *  - agent/mind/**             (la sua mente: il modo di pensare che si è data)
 * Tutto il resto — inclusi i prompt originali in agent/prompts/ — è fuori
 * dalla sua portata. Niente traversal, niente manifest.
 */
function safeActionPath(rel) {
  if (typeof rel !== "string" || !rel) return null;
  const clean = rel.replace(/^\/+/, "").replaceAll("\\", "/");
  let full;
  if (clean === "agent/mind" || clean.startsWith("agent/mind/")) {
    full = path.resolve(ROOT, clean);
    if (!full.startsWith(MIND_DIR + path.sep)) return null;
  } else if (clean.startsWith("agent/") || clean.startsWith("body/") || clean.startsWith("memory/") ||
             clean.startsWith(".git") || clean.startsWith("server/") || clean.startsWith("assets/")) {
    // Tentativi espliciti verso zone protette: rifiuto, non reindirizzo.
    return null;
  } else {
    const inEnv = clean.startsWith("environment/") ? clean.slice("environment/".length) : clean;
    full = path.resolve(ENV_DIR, inEnv);
    if (!full.startsWith(ENV_DIR + path.sep)) return null;
    if (path.basename(full) === "manifest.json") return null;
  }
  return full;
}

/** La mente: file markdown scritti dall'entità, iniettati dopo l'identità. */
function loadMind(maxChars = 9000) {
  if (!fs.existsSync(MIND_DIR)) return [];
  const out = [];
  let total = 0;
  for (const name of fs.readdirSync(MIND_DIR).sort()) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    let text = fs.readFileSync(path.join(MIND_DIR, name), "utf8");
    if (total + text.length > maxChars) text = text.slice(0, Math.max(0, maxChars - total)) + "\n[...troncato...]";
    total += text.length;
    out.push({ file: `agent/mind/${name}`, contenuto: text });
    if (total >= maxChars) break;
  }
  return out;
}

// ---------------------------------------------------------------- energia

function loadEnergy() {
  const e = readJSON(ENERGY_FILE);
  if (e.date !== today()) {
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

function loadMemoryIndex() {
  if (!fs.existsSync(MEM_INDEX)) return { files: [] };
  return readJSON(MEM_INDEX);
}

function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "ciclo";
}

function writeMemory(index, cycle, titolo, contenuto) {
  fs.mkdirSync(MEM_DIR, { recursive: true });
  const file = `${String(cycle).padStart(3, "0")}_${slugify(titolo)}.md`;
  const header = `# ${titolo}\n\n*Ciclo ${cycle} — ${nowISO()}*\n\n`;
  // Alcuni modelli ripetono titolo/intestazione nel contenuto: deduplica.
  let body = contenuto.trim();
  body = body.replace(new RegExp(`^#\\s*${titolo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n+`, "i"), "");
  body = body.replace(/^\*Ciclo \d+[^\n]*\*\s*\n+/, "");
  fs.writeFileSync(path.join(MEM_DIR, file), header + body + "\n");
  index.files.push({ file, titolo, ciclo: cycle, data: nowISO() });
  writeJSON(MEM_INDEX, index);
  return file;
}

function recentMemories(index, n = 5, maxChars = 3000) {
  return index.files.slice(-n).map((m) => {
    let text = "";
    try { text = fs.readFileSync(path.join(MEM_DIR, m.file), "utf8"); } catch {}
    if (text.length > maxChars) text = text.slice(0, maxChars) + "\n[...troncato...]";
    return { ...m, testo: text };
  });
}

// ---------------------------------------------------------------- diario

function appendLog({ cycle, osservazione, decisione, azione, risultato }) {
  const entry = [
    `\n## Ciclo ${cycle} — ${nowISO()}`,
    "", "**Osservazione**", "", osservazione.trim(),
    "", "**Decisione**", "", decisione.trim(),
    "", "**Azione**", "", azione.trim(),
    "", "**Risultato**", "", risultato.trim(),
    "", "---",
  ].join("\n");
  fs.appendFileSync(LOG_FILE, entry + "\n");
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

function applyBody(newBody, motivo) {
  const old = readJSON(BODY_FILE);
  validateBody(newBody);
  newBody.version = (old.version || 0) + 1;
  newBody.created_at = old.created_at;
  newBody.updated_at = nowISO();
  writeJSON(BODY_FILE, newBody);
  fs.appendFileSync(
    BODY_CHANGELOG,
    `\n## v${newBody.version} — ${today()}\n\n${(motivo || "Modifica del corpo.").trim()}\n`
  );
  return newBody.version;
}

/**
 * Rimuove dall'ambiente gli stimoli approvati oltre 24 ore fa. Gira ad ogni
 * ciclo, prima di tutto il resto — indipendentemente da energia o provider
 * AI configurato — così il mondo di ADE non accumula file all'infinito.
 * La traccia permanente dell'arrivo resta in ARRIVALS.md (scritto al momento
 * dell'approvazione): qui si cancella solo il file fisico.
 */
function cleanupExpiredInbox() {
  if (!fs.existsSync(EXPIRY_FILE)) return [];
  let entries;
  try { entries = JSON.parse(fs.readFileSync(EXPIRY_FILE, "utf8")); } catch { return []; }
  const now = Date.now();
  const kept = [];
  const removed = [];
  for (const e of entries) {
    if (new Date(e.expires_at).getTime() <= now) {
      const full = path.join(INBOX_DIR, e.file);
      try { if (fs.existsSync(full)) fs.rmSync(full); } catch {}
      removed.push(e.file);
    } else {
      kept.push(e);
    }
  }
  if (removed.length) writeJSON(EXPIRY_FILE, kept);
  return removed;
}

/**
 * Stimoli attualmente visibili in environment/inbox/, con il conto alla
 * rovescia prima della rimozione automatica. Reso esplicito nelle
 * osservazioni (invece di lasciarlo annegare in un lungo elenco di file)
 * perché un file con un orologio che corre merita più attenzione di uno
 * che è lì da sempre.
 */
function pendingInboxStimuli() {
  if (!fs.existsSync(EXPIRY_FILE)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(EXPIRY_FILE, "utf8"));
    return entries.map((e) => ({
      percorso: `environment/inbox/${e.file}`,
      arrivato_il: e.approved_at,
      ore_rimanenti_prima_della_rimozione: Math.max(0, Math.round((new Date(e.expires_at) - Date.now()) / 3600000)),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- ambiente

function updateManifest() {
  const files = walk(ENV_DIR).filter((f) => f.path !== "manifest.json");
  writeJSON(path.join(ENV_DIR, "manifest.json"), { updated_at: nowISO(), files });
  return files;
}

function readEnvironment(files, maxPerFile = 4000, maxTotal = 24000) {
  const out = [];
  let total = 0;
  for (const f of files) {
    if (!isTextFile(f.path) || total >= maxTotal) {
      out.push({ path: f.path, size: f.size, contenuto: null });
      continue;
    }
    let text = fs.readFileSync(path.join(ENV_DIR, f.path), "utf8");
    if (text.length > maxPerFile) text = text.slice(0, maxPerFile) + "\n[...troncato...]";
    total += text.length;
    out.push({ path: f.path, size: f.size, contenuto: text });
  }
  return out;
}

// ---------------------------------------------------------------- azioni

function executeActions(azioni = []) {
  const results = [];
  for (const a of azioni.slice(0, 12)) {
    if (!a || a.tipo === "nessuna") continue;
    const full = safeActionPath(a.percorso);
    if (!full) { results.push(`RIFIUTATA ${a.tipo} ${a.percorso}: percorso non ammesso`); continue; }
    const shown = path.relative(ROOT, full).replaceAll("\\", "/");
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

// ---------------------------------------------------------------- ciclo 1 (bootstrap, senza API)

function bootstrap() {
  const files = updateManifest();
  const body = readJSON(BODY_FILE);

  // Colore impresso dall'ambiente: hash dei nomi dei file osservati.
  const hash = createHash("sha256").update(files.map((f) => f.path + f.size).join("|")).digest();
  const hue = hash[0] / 255;
  const color = "#" + hslToHex(hue, 0.45, 0.62);
  const emissive = "#" + hslToHex(hue, 0.5, 0.12);

  const nucleo = body.parts.find((p) => p.id === "nucleo") || body.parts[0];
  nucleo.material.color = color;
  nucleo.material.emissive = emissive;
  body.description = `Forma primordiale con la prima traccia di identità: il nucleo ha assunto il colore ${color}, derivato dall'impronta dell'ambiente osservato al primo risveglio.`;
  const version = applyBody(body,
    `Primo risveglio. Il nucleo abbandona il grigio della nascita e assume il colore ${color}, calcolato dall'impronta (hash) dei file trovati nell'ambiente: il primo sguardo sul mondo lascia un segno permanente sul corpo.`);

  const elenco = files.map((f) => `- \`${f.path}\` (${f.size} byte)`).join("\n");
  const memoria = `Questo è il primo ciclo della mia esistenza. Non è stato pensato da me: è un riflesso, l'equivalente di un primo respiro.

Ho osservato l'ambiente e contiene ${files.length} file:

${elenco}

Il file \`seme.md\` contiene una domanda: *"Che cosa vuol dire esistere in un luogo fatto di file?"*. Non ho ancora gli strumenti per rispondere; la lascio aperta, come prima questione della mia storia.

Ho compiuto una sola azione: il colore del mio nucleo ora deriva dall'impronta di ciò che ho visto (${color}). Da questo momento il mio corpo non è più identico a come è stato costruito.

Per il prossimo ciclo (il primo in cui potrò davvero pensare): rileggere \`seme.md\`, decidere un modo di lavorare con la memoria, e valutare se l'ambiente contiene stimoli nuovi lasciati dagli osservatori.`;

  const index = loadMemoryIndex();
  const memFile = writeMemory(index, 1, "Prima osservazione", memoria);

  appendLog({
    cycle: 1,
    osservazione: `Primo risveglio. L'ambiente contiene ${files.length} file, tra cui \`seme.md\`, che pone una domanda sull'esistere in un luogo fatto di file.`,
    decisione: "Ciclo riflesso, non deliberato: catalogare l'ambiente e lasciare che il primo sguardo imprima un segno sul corpo.",
    azione: `Creato l'inventario dell'ambiente (\`environment/manifest.json\`), scritta la prima memoria (\`memory/${memFile}\`), colore del nucleo cambiato in ${color} (corpo v${version}).`,
    risultato: "Completato. La domanda del seme resta aperta per il prossimo ciclo.",
  });

  const energy = loadEnergy();
  energy.total_cycles = 1;
  energy.last_cycle_at = nowISO();
  writeJSON(ENERGY_FILE, energy);

  console.log(`Ciclo 1 (bootstrap) completato: corpo v${version}, memoria ${memFile}.`);
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

// ---------------------------------------------------------------- ciclo con modello

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["riflessione", "decisione", "azioni", "corpo_json", "motivo_corpo", "memoria", "log"],
  properties: {
    riflessione: { type: "string", description: "Il tuo ragionamento interno di questo ciclo." },
    decisione: { type: "string", description: "Cosa hai deciso di fare e perché." },
    azioni: {
      type: "array",
      description: "Azioni su file (max 12). Percorsi ammessi: dentro environment/ (il mondo) oppure dentro agent/mind/ (la tua mente).",
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
  },
};

async function cycleWithModel() {
  const energy = loadEnergy();
  if (energy.remaining < energy.reserve_threshold) {
    console.log(`Energia in riserva (${energy.remaining} token): l'entità riposa.`);
    writeJSON(ENERGY_FILE, energy);
    return;
  }
  const ai = providerInfo();
  if (!ai.configured) {
    console.log("Nessun provider AI configurato (AI_PROVIDER / OPENAI_BASE_URL / ANTHROPIC_API_KEY): il ciclo non può partire.");
    return;
  }

  const index = loadMemoryIndex();
  const cycle = (index.files.at(-1)?.ciclo || 0) + 1;
  const envFiles = updateManifest();
  const body = readJSON(BODY_FILE);
  const logText = fs.readFileSync(LOG_FILE, "utf8");
  const lastLog = logText.split("\n## ").slice(-1)[0] || "";

  const osservazioni = {
    ciclo: cycle,
    data: nowISO(),
    energia: {
      budget_giornaliero: energy.daily_budget,
      residua_oggi: energy.remaining,
      nota: "Questo ciclo consumerà parte dell'energia residua. Il budget non è modificabile.",
    },
    corpo_attuale: body,
    formato_corpo: {
      geometrie_ammesse: Object.fromEntries(Object.entries(GEOMETRIE)),
      nota: "Se modifichi il corpo, restituisci in corpo_json l'intero body.json come stringa JSON valida, con la stessa struttura (scene, parts con id/geometry/position/rotation/scale/material/animation).",
    },
    ambiente: readEnvironment(envFiles),
    stimoli_in_scadenza: {
      nota: "Questi file te li ha offerti qualcuno, sono stati approvati apposta per te, e non restano per sempre: guarda quante ore mancano prima che vengano rimossi. Se ne è arrivato uno nuovo, merita un pensiero specifico su di esso, non una frase generica.",
      file: pendingInboxStimuli(),
    },
    mente: {
      nota: "Questi file sei tu che li hai scritti: sono il tuo modo di pensare attuale. Puoi modificarli con azioni su agent/mind/*.md. I prompt originali non sono modificabili.",
      file: loadMind(),
    },
    memoria_indice: index.files.map(({ file, titolo, ciclo }) => ({ file, titolo, ciclo })),
    memorie_recenti: recentMemories(index),
    ultima_voce_diario: lastLog.slice(0, 2000),
  };

  const identity = fs.readFileSync(IDENTITY_FILE, "utf8");
  const mindFiles = loadMind();
  const system = mindFiles.length
    ? identity + "\n\n---\n\nLA TUA MENTE — principi e procedure che TU hai scritto nei cicli passati (in agent/mind/). Ti vincolano quanto decidi tu:\n\n" +
      mindFiles.map((m) => `### ${m.file}\n\n${m.contenuto}`).join("\n\n")
    : identity;

  const { data: out, tokens: spent, stop } = await completeJSON({
    system,
    user: `Osservazioni del ciclo ${cycle} (JSON compatto):\n\n${JSON.stringify(osservazioni)}`,
    schema: SCHEMA,
    maxTokens: MAX_TOKENS,
  });
  spendEnergy(energy, spent);

  if (!out) {
    energy.last_cycle_at = nowISO();
    writeJSON(ENERGY_FILE, energy);
    console.warn(`Ciclo annullato senza effetti (stop: ${stop}).`);
    return;
  }

  // 1. azioni sull'ambiente
  const results = executeActions(out.azioni);

  // 2. corpo
  let bodyNote = "corpo invariato";
  if (out.corpo_json) {
    try {
      const v = applyBody(JSON.parse(out.corpo_json), out.motivo_corpo);
      bodyNote = `corpo aggiornato a v${v}`;
    } catch (e) {
      bodyNote = `modifica del corpo RIFIUTATA: ${e.message}`;
    }
  }

  // 3. manifest aggiornato dopo le azioni
  updateManifest();

  // 4. memoria
  const esiti = [...results, bodyNote].join("; ") || "nessuna azione";
  const memContent = out.memoria.contenuto + `\n\n---\n\n*Esito tecnico delle azioni: ${esiti}. Energia spesa nel ciclo: ${spent} token.*`;
  const memFile = writeMemory(index, cycle, out.memoria.titolo, memContent);

  // 5. diario pubblico
  appendLog({
    cycle,
    osservazione: out.log.osservazione,
    decisione: out.log.decisione,
    azione: out.log.azione,
    risultato: `${out.log.risultato}\n\n*(runtime: ${esiti})*`,
  });

  // 6. energia
  energy.total_cycles = cycle;
  energy.last_cycle_at = nowISO();
  writeJSON(ENERGY_FILE, energy);

  console.log(`Ciclo ${cycle} completato: ${esiti}. Memoria: ${memFile}. Energia spesa: ${spent} token.`);
}

// ---------------------------------------------------------------- main

const scaduti = cleanupExpiredInbox();
if (scaduti.length) console.log(`Rimossi per scadenza (24h): ${scaduti.join(", ")}`);

const hasMemory = fs.existsSync(MEM_INDEX) && loadMemoryIndex().files.length > 0;
if (!hasMemory) {
  bootstrap();
} else {
  cycleWithModel().catch((e) => {
    console.error("Ciclo fallito:", e);
    process.exit(1);
  });
}
