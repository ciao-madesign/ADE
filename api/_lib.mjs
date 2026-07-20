/**
 * Utilità condivise dalle funzioni serverless Vercel.
 * (Il prefisso "_" esclude questo file dal routing.)
 *
 * Variabili d'ambiente richieste su Vercel:
 *  - ADMIN_TOKEN              autenticazione del pannello /admin
 *  - BLOB_READ_WRITE_TOKEN    creato automaticamente collegando uno store Vercel Blob
 *  - GITHUB_TOKEN             PAT con permessi contents:write (+ actions:write per avviare i cicli)
 *  - GITHUB_REPO              es. "ciao-madesign/ADE"
 *  - GITHUB_BRANCH            branch su cui vive l'entità (quello collegato a Vercel)
 */

import { timingSafeEqual } from "node:crypto";
import { arrivalEntry, arrivalsHeader, RETENTION_MS } from "../server/retention.mjs";

export function isAdmin(req) {
  const token = process.env.ADMIN_TOKEN || "";
  if (!token) return false;
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (got.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(token));
}

export function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.status(401).json({ errore: process.env.ADMIN_TOKEN ? "token non valido" : "ADMIN_TOKEN non configurato" });
  return false;
}

/* ------------------------------------------------ GitHub API */

const GH = "https://api.github.com";

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

export function ghConfigured() {
  return !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

/** Elenca per nome le variabili GitHub mancanti, per messaggi d'errore precisi. */
export function ghMissingVars() {
  const missing = [];
  if (!process.env.GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
  if (!process.env.GITHUB_REPO) missing.push("GITHUB_REPO");
  return missing;
}

/** Legge un file dal repo. Ritorna null se non esiste (utile per create-or-update). */
export async function ghGetFile(repoPath) {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const res = await fetch(
    `${GH}/repos/${repo}/contents/${encodeURIComponent(repoPath).replaceAll("%2F", "/")}?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders() }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
}

/** Crea o aggiorna un file di testo (passare lo sha se il file esiste già). */
export async function ghPutFile(repoPath, content, message, sha) {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const body = { message, branch, content: Buffer.from(content, "utf8").toString("base64") };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH}/repos/${repo}/contents/${encodeURIComponent(repoPath).replaceAll("%2F", "/")}`, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Registra un arrivo approvato: riga permanente in ARRIVALS.md + voce nel
 * registro di scadenza (environment/inbox/.expiry.json, invisibile ad ADE:
 * i file che iniziano con "." non entrano nel suo inventario). La rimozione
 * fisica dopo 24h avviene nel ciclo (agent/agent.mjs), non qui.
 */
export async function recordArrival({ nome, autore, nota, destinazione, sha256 }) {
  const approvatoIl = new Date();
  const scadeIl = new Date(approvatoIl.getTime() + RETENTION_MS);

  const existingArrivals = await ghGetFile("ARRIVALS.md");
  const nuovoContenuto =
    (existingArrivals ? existingArrivals.content : arrivalsHeader()) +
    arrivalEntry({
      nome, autore, nota, destinazione, sha256,
      approvatoIl: approvatoIl.toISOString(),
      scadeIl: scadeIl.toISOString(),
    });
  await ghPutFile("ARRIVALS.md", nuovoContenuto, `Registrato arrivo: ${nome}`, existingArrivals?.sha);

  const manifestPath = "environment/inbox/.expiry.json";
  const existingManifest = await ghGetFile(manifestPath);
  const lista = existingManifest ? JSON.parse(existingManifest.content) : [];
  lista.push({
    file: destinazione.split("/").pop(),
    expires_at: scadeIl.toISOString(),
    approved_at: approvatoIl.toISOString(),
  });
  await ghPutFile(manifestPath, JSON.stringify(lista, null, 2) + "\n", `Pianificata rimozione (24h): ${nome}`, existingManifest?.sha);

  return { scadeIl: scadeIl.toISOString() };
}

/** Crea un file nel repository (commit diretto sul branch dell'entità). */
export async function ghCreateFile(repoPath, buffer, message) {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  let finalPath = repoPath;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${GH}/repos/${repo}/contents/${encodeURIComponent(finalPath).replaceAll("%2F", "/")}`, {
      method: "PUT",
      headers: ghHeaders(),
      body: JSON.stringify({ message, branch, content: buffer.toString("base64") }),
    });
    if (res.ok) return finalPath;
    if (res.status === 422 && attempt === 0) {
      // il file esiste già: riprova con un suffisso
      const dot = finalPath.lastIndexOf(".");
      const suffix = "-" + Date.now().toString(36);
      finalPath = dot > finalPath.lastIndexOf("/")
        ? finalPath.slice(0, dot) + suffix + finalPath.slice(dot)
        : finalPath + suffix;
      continue;
    }
    throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Avvia il workflow del ciclo (workflow_dispatch). */
export async function ghTriggerCycle() {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const res = await fetch(`${GH}/repos/${repo}/actions/workflows/cycle.yml/dispatches`, {
    method: "POST",
    headers: ghHeaders(),
    body: JSON.stringify({ ref: branch }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/* ------------------------------------------------ quarantena su Vercel Blob */

export async function blobModule() {
  return import("@vercel/blob");
}

/** Legge per intero uno stream WHATWG (l'SDK Blob restituisce ReadableStream, non un buffer). */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function listQuarantine() {
  const { list, get } = await blobModule();
  const { blobs } = await list({ prefix: "quarantine/" });
  const metas = [];
  for (const b of blobs.filter((x) => x.pathname.endsWith(".meta.json"))) {
    try {
      const res = await get(b.pathname, { access: "private" });
      if (!res?.stream) continue;
      const testo = (await streamToBuffer(res.stream)).toString("utf8");
      metas.push({ ...JSON.parse(testo), _meta_pathname: b.pathname });
    } catch { /* meta illeggibile: ignora */ }
  }
  return metas.sort((a, b) => (a.caricato_il < b.caricato_il ? 1 : -1));
}

export async function saveQuarantine(id, buffer, meta) {
  const { put } = await blobModule();
  await put(`quarantine/${id}.bin`, buffer, { access: "private", addRandomSuffix: false });
  await put(`quarantine/${id}.meta.json`, JSON.stringify(meta, null, 2), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
  });
}

export async function readQuarantineBin(id) {
  const { get } = await blobModule();
  const pathname = `quarantine/${id}.bin`;
  const res = await get(pathname, { access: "private" });
  if (!res?.stream) return null;
  return { buffer: await streamToBuffer(res.stream), pathname };
}

export async function updateQuarantineMeta(meta) {
  const { put } = await blobModule();
  await put(`quarantine/${meta.id}.meta.json`, JSON.stringify(meta, null, 2), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
  });
}

export async function deleteBlobPath(pathname) {
  const { del } = await blobModule();
  try { await del(pathname); } catch { /* già assente */ }
}

/* ------------------------------------------------ pianificazione */

/** Prossimo ciclo: il cron di GitHub Actions gira alle 0/6/12/18 UTC. */
export function nextCycleISO() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Math.floor(now.getUTCHours() / 6) * 6 + 6, 0, 0));
  return next.toISOString();
}
