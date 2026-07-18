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

export async function listQuarantine() {
  const { list } = await blobModule();
  const { blobs } = await list({ prefix: "quarantine/" });
  const metas = [];
  for (const b of blobs.filter((x) => x.pathname.endsWith(".meta.json"))) {
    try {
      const r = await fetch(b.url, { cache: "no-store" });
      metas.push({ ...(await r.json()), _meta_url: b.url });
    } catch { /* meta illeggibile: ignora */ }
  }
  return metas.sort((a, b) => (a.caricato_il < b.caricato_il ? 1 : -1));
}

export async function saveQuarantine(id, buffer, meta) {
  const { put } = await blobModule();
  await put(`quarantine/${id}.bin`, buffer, { access: "public", addRandomSuffix: false });
  await put(`quarantine/${id}.meta.json`, JSON.stringify(meta, null, 2), {
    access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
  });
}

export async function readQuarantineBin(id) {
  const { list } = await blobModule();
  const { blobs } = await list({ prefix: `quarantine/${id}.bin` });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: "no-store" });
  return { buffer: Buffer.from(await r.arrayBuffer()), url: blobs[0].url };
}

export async function updateQuarantineMeta(meta) {
  const { put } = await blobModule();
  await put(`quarantine/${meta.id}.meta.json`, JSON.stringify(meta, null, 2), {
    access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
  });
}

export async function deleteBlobUrl(url) {
  const { del } = await blobModule();
  try { await del(url); } catch { /* già assente */ }
}

/* ------------------------------------------------ pianificazione */

/** Prossimo ciclo: il cron di GitHub Actions gira alle 0/6/12/18 UTC. */
export function nextCycleISO() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Math.floor(now.getUTCHours() / 6) * 6 + 6, 0, 0));
  return next.toISOString();
}
