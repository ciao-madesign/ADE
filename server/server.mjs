#!/usr/bin/env node
/**
 * ADE — server "live".
 *
 * Trasforma il sito da pagina statica a osservatorio continuo:
 *  - serve il sito e i dati dell'entità
 *  - GET  /api/state         → stato aggregato (corpo, energia, memoria, ambiente, diario)
 *  - GET  /api/events        → Server-Sent Events: ogni cambiamento del mondo viene
 *                              trasmesso in tempo reale ai browser collegati
 *  - POST /api/upload        → caricamento stimoli dall'interfaccia: il file viene
 *                              scansionato (server/scan.mjs) e messo in QUARANTENA
 *  - /admin + /api/admin/*   → pannello admin: revisione della quarantena,
 *                              approvazione/rifiuto, avvio manuale di un ciclo
 *  - scheduler               → esegue il ciclo dell'entità ogni CYCLE_INTERVAL_HOURS
 *
 * Nessun file caricato tocca environment/ prima dell'approvazione admin.
 *
 * Variabili d'ambiente:
 *  PORT (8080) · ADMIN_TOKEN (obbligatoria per l'admin) · RUN_CYCLES=1 per lo
 *  scheduler · CYCLE_INTERVAL_HOURS (6) · GIT_AUTOCOMMIT=1 per commit+push
 *  automatico dopo ogni ciclo/approvazione · più le variabili del provider AI
 *  (vedi agent/llm.mjs).
 */

import { execFile, execFileSync } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanFile, sanitizeName, MAX_SIZE } from "./scan.mjs";
import { arrivalEntry, arrivalsHeader, RETENTION_MS } from "./retention.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUARANTINE = path.join(ROOT, "uploads", "quarantine");
const INBOX = path.join(ROOT, "environment", "inbox");
const ARRIVALS_FILE = path.join(ROOT, "ARRIVALS.md");
const EXPIRY_FILE = path.join(INBOX, ".expiry.json");
const PORT = Number(process.env.PORT || 8080);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CYCLE_HOURS = Number(process.env.CYCLE_INTERVAL_HOURS || 6);

fs.mkdirSync(QUARANTINE, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".md": "text/markdown; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
};

/* ---------------------------------------------------------------- SSE */

const clients = new Set();

function broadcast(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, at: new Date().toISOString() })}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// Osserva i punti vitali del mondo e notifica i browser (con debounce).
let watchTimer = null;
function notifyChange(origine) {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => broadcast("stato", { origine }), 400);
}
for (const p of ["ACTION_LOG.md", "body", "memory", "environment", "agent/state", "agent/mind"]) {
  const full = path.join(ROOT, p);
  try {
    fs.watch(full, { recursive: true }, () => notifyChange(p));
  } catch {
    try { fs.watch(full, () => notifyChange(p)); } catch {}
  }
}

/* ---------------------------------------------------------------- ciclo */

let cycleRunning = false;
let nextCycleAt = null;

function runCycle(origine = "scheduler") {
  if (cycleRunning) return Promise.resolve("già in corso");
  cycleRunning = true;
  broadcast("ciclo_inizio", { origine });
  return new Promise((resolve) => {
    execFile("node", [path.join(ROOT, "agent", "agent.mjs")], { env: process.env, timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
      cycleRunning = false;
      const esito = err ? `errore: ${stderr || err.message}` : (stdout || "").trim();
      console.log(`[ciclo/${origine}] ${esito}`);
      if (!err && process.env.GIT_AUTOCOMMIT === "1") gitCommit(`Ciclo autonomo (${origine})`);
      broadcast("ciclo_fine", { origine, esito: esito.slice(0, 500) });
      resolve(esito);
    });
  });
}

function gitCommit(msg) {
  try {
    execFileSync("git", ["add", "-A"], { cwd: ROOT });
    execFileSync("git", ["-c", "user.name=ADE", "-c", "user.email=ade-entity@users.noreply.github.com", "commit", "-m", msg], { cwd: ROOT });
    execFileSync("git", ["push"], { cwd: ROOT, timeout: 60000 });
  } catch (e) {
    console.warn("git autocommit non riuscito:", e.message.split("\n")[0]);
  }
}

if (process.env.RUN_CYCLES === "1") {
  const ms = CYCLE_HOURS * 3600 * 1000;
  nextCycleAt = new Date(Date.now() + ms).toISOString();
  setInterval(() => {
    nextCycleAt = new Date(Date.now() + ms).toISOString();
    runCycle("scheduler");
  }, ms);
  console.log(`Scheduler attivo: un ciclo ogni ${CYCLE_HOURS}h.`);
}

// battito: i browser vedono che l'entità è "viva" anche tra un evento e l'altro
setInterval(() => broadcast("battito", { prossimo_ciclo: nextCycleAt, ciclo_in_corso: cycleRunning }), 15000);

/* ---------------------------------------------------------------- helpers HTTP */

function send(res, code, data, headers = {}) {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 1);
  res.writeHead(code, { "Content-Type": typeof data === "string" ? "text/plain; charset=utf-8" : "application/json", ...headers });
  res.end(body);
}

function readBody(req, limit = MAX_SIZE * 1.4) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("payload troppo grande")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (got.length !== ADMIN_TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(ADMIN_TOKEN));
}

const readJSONFile = (p, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return fallback; }
};

/* ---------------------------------------------------------------- quarantena */

function pendingUploads() {
  return fs.readdirSync(QUARANTINE)
    .filter((f) => f.endsWith(".meta.json"))
    .map((f) => readJSONFile(path.join("uploads", "quarantine", f)))
    .filter(Boolean)
    .sort((a, b) => (a.caricato_il < b.caricato_il ? 1 : -1));
}

function handleUpload(body) {
  let payload;
  try { payload = JSON.parse(body.toString("utf8")); } catch { throw new Error("JSON non valido"); }
  const { nome, dati_base64, nota, autore } = payload;
  if (!nome || !dati_base64) throw new Error("servono 'nome' e 'dati_base64'");
  const buffer = Buffer.from(dati_base64, "base64");

  const rapporto = scanFile(nome, buffer);
  if (rapporto.esito === "bloccato") {
    return { stato: "rifiutato_automaticamente", rapporto };
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
  fs.writeFileSync(path.join(QUARANTINE, `${id}.bin`), buffer);
  fs.writeFileSync(path.join(QUARANTINE, `${id}.meta.json`), JSON.stringify(meta, null, 2));
  broadcast("upload_in_quarantena", { id, nome: rapporto.nome_sicuro, esito_scan: rapporto.esito });
  return { stato: "in_quarantena", id, rapporto };
}

function decideUpload({ id, azione, motivo }) {
  const metaPath = path.join(QUARANTINE, `${String(id).replace(/[^\w-]/g, "")}.meta.json`);
  const binPath = metaPath.replace(/\.meta\.json$/, ".bin");
  if (!fs.existsSync(metaPath)) throw new Error("upload inesistente");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  if (meta.stato !== "in_quarantena") throw new Error(`già deciso: ${meta.stato}`);

  if (azione === "approva") {
    fs.mkdirSync(INBOX, { recursive: true });
    let dest = path.join(INBOX, sanitizeName(meta.nome_sicuro));
    if (fs.existsSync(dest)) {
      const ext = path.extname(dest);
      dest = dest.slice(0, -ext.length || undefined) + "-" + meta.id.slice(0, 8) + ext;
    }
    fs.copyFileSync(binPath, dest);
    meta.stato = "approvato";
    meta.destinazione = path.relative(ROOT, dest).replaceAll("\\", "/");

    const approvatoIl = new Date();
    const scadeIl = new Date(approvatoIl.getTime() + RETENTION_MS);
    if (!fs.existsSync(ARRIVALS_FILE)) fs.writeFileSync(ARRIVALS_FILE, arrivalsHeader());
    fs.appendFileSync(ARRIVALS_FILE, arrivalEntry({
      nome: meta.nome_sicuro, autore: meta.autore, nota: meta.nota,
      destinazione: meta.destinazione, sha256: meta.rapporto.sha256,
      approvatoIl: approvatoIl.toISOString(), scadeIl: scadeIl.toISOString(),
    }));
    const lista = fs.existsSync(EXPIRY_FILE) ? JSON.parse(fs.readFileSync(EXPIRY_FILE, "utf8")) : [];
    lista.push({ file: path.basename(dest), expires_at: scadeIl.toISOString(), approved_at: approvatoIl.toISOString() });
    fs.writeFileSync(EXPIRY_FILE, JSON.stringify(lista, null, 2) + "\n");
    meta.scade_il = scadeIl.toISOString();

    if (process.env.GIT_AUTOCOMMIT === "1") gitCommit(`Stimolo approvato: ${path.basename(dest)}`);
  } else if (azione === "rifiuta") {
    meta.stato = "rifiutato";
  } else {
    throw new Error("azione deve essere 'approva' o 'rifiuta'");
  }
  meta.deciso_il = new Date().toISOString();
  meta.motivo_decisione = String(motivo || "").slice(0, 300);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  try { fs.rmSync(binPath); } catch {}
  broadcast(meta.stato === "approvato" ? "stimolo_approvato" : "stimolo_rifiutato", { id: meta.id, nome: meta.nome_sicuro });
  return meta;
}

/* ---------------------------------------------------------------- routing */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  try {
    // ---- API pubbliche
    if (p === "/api/state") {
      return send(res, 200, {
        live: true,
        sse: true,
        piattaforma: "server",
        ciclo_in_corso: cycleRunning,
        prossimo_ciclo: nextCycleAt,
        corpo: readJSONFile("body/body.json"),
        energia: readJSONFile("agent/state/energy.json"),
        memoria: readJSONFile("memory/index.json", { files: [] }),
        ambiente: readJSONFile("environment/manifest.json", { files: [] }),
      });
    }

    if (p === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write(`event: benvenuto\ndata: ${JSON.stringify({ prossimo_ciclo: nextCycleAt })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (p === "/api/upload" && req.method === "POST") {
      const body = await readBody(req);
      try {
        return send(res, 200, handleUpload(body));
      } catch (e) {
        return send(res, 400, { errore: e.message });
      }
    }

    // ---- API admin
    if (p.startsWith("/api/admin/")) {
      if (!isAdmin(req)) return send(res, 401, { errore: ADMIN_TOKEN ? "token non valido" : "ADMIN_TOKEN non configurato sul server" });
      if (p === "/api/admin/pending") return send(res, 200, { uploads: pendingUploads() });
      if (p === "/api/admin/decide" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        try { return send(res, 200, decideUpload(body)); }
        catch (e) { return send(res, 400, { errore: e.message }); }
      }
      if (p === "/api/admin/cycle" && req.method === "POST") {
        runCycle("admin");
        return send(res, 202, { avviato: true });
      }
      return send(res, 404, { errore: "endpoint sconosciuto" });
    }

    if (p === "/admin") {
      const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
      return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
    }

    // ---- statico
    let rel = decodeURIComponent(p === "/" ? "/index.html" : p);
    const full = path.resolve(ROOT, "." + rel);
    if (!full.startsWith(ROOT + path.sep)) return send(res, 403, "no");
    const relFromRoot = path.relative(ROOT, full).replaceAll("\\", "/");
    if (/^(\.git|node_modules|uploads|server)(\/|$)/.test(relFromRoot)) return send(res, 404, "non trovato");
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, "non trovato");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { errore: "errore interno" });
  }
});

server.listen(PORT, () => {
  console.log(`ADE live su http://localhost:${PORT}  (admin: /admin${ADMIN_TOKEN ? "" : " — ADMIN_TOKEN mancante!"})`);
});
