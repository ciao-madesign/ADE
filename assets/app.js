// ADE — finestra pubblica: rendering del corpo e dei pannelli di osservazione.
// Three.js è vendorizzato in assets/vendor/ e caricato dinamicamente, così un
// eventuale problema col viewer non impedisce ai pannelli dati di funzionare.

const $ = (sel) => document.querySelector(sel);

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

/* ------------------------------------------------ corpo 3D */

function buildGeometry(THREE, g) {
  const p = g.params || {};
  switch (g.type) {
    case "box": return new THREE.BoxGeometry(p.width ?? 1, p.height ?? 1, p.depth ?? 1);
    case "sphere": return new THREE.SphereGeometry(p.radius ?? 1, p.widthSegments ?? 32, p.heightSegments ?? 16);
    case "cylinder": return new THREE.CylinderGeometry(p.radiusTop ?? 1, p.radiusBottom ?? 1, p.height ?? 1, p.radialSegments ?? 24);
    case "cone": return new THREE.ConeGeometry(p.radius ?? 1, p.height ?? 1, p.radialSegments ?? 24);
    case "torus": return new THREE.TorusGeometry(p.radius ?? 1, p.tube ?? 0.3, p.radialSegments ?? 12, p.tubularSegments ?? 48);
    case "torusKnot": return new THREE.TorusKnotGeometry(p.radius ?? 1, p.tube ?? 0.3);
    case "icosahedron": return new THREE.IcosahedronGeometry(p.radius ?? 1, p.detail ?? 0);
    case "octahedron": return new THREE.OctahedronGeometry(p.radius ?? 1, p.detail ?? 0);
    case "tetrahedron": return new THREE.TetrahedronGeometry(p.radius ?? 1, p.detail ?? 0);
    case "dodecahedron": return new THREE.DodecahedronGeometry(p.radius ?? 1, p.detail ?? 0);
    case "capsule": return new THREE.CapsuleGeometry(p.radius ?? 0.5, p.length ?? 1);
    case "ring": return new THREE.RingGeometry(p.innerRadius ?? 0.5, p.outerRadius ?? 1);
    case "plane": return new THREE.PlaneGeometry(p.width ?? 1, p.height ?? 1);
    default: return new THREE.SphereGeometry(0.5);
  }
}

async function startViewer(body) {
  const THREE = await import("three");
  const { OrbitControls } = await import("./vendor/OrbitControls.js");
  const container = $("#viewer");
  container.innerHTML = "";
  let disposed = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(body.scene?.background || "#0a0a12");
  if (body.scene?.fog) scene.fog = new THREE.Fog(new THREE.Color(body.scene.fog), 8, 22);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(4.2, 3.0, 5.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.3, 0);
  controls.enableDamping = true;
  controls.maxDistance = 15;
  controls.minDistance = 2;

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(4, 6, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8899ff, 0.5);
  rim.position.set(-5, 2, -4);
  scene.add(rim);

  if (body.scene?.ground !== false) {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.MeshStandardMaterial({ color: body.scene?.ground_color || "#11131c", roughness: 0.9, metalness: 0.1 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.PolarGridHelper(9, 12, 6, 48, 0x232838, 0x1a1e2c);
    grid.position.y = 0.002;
    scene.add(grid);
  }

  const meshes = [];
  for (const part of body.parts || []) {
    const m = part.material || {};
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(m.color || "#888888"),
      metalness: m.metalness ?? 0.3,
      roughness: m.roughness ?? 0.5,
      emissive: new THREE.Color(m.emissive || "#000000"),
      wireframe: !!m.wireframe,
      transparent: (m.opacity ?? 1) < 1,
      opacity: m.opacity ?? 1,
      flatShading: !!m.flat,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(buildGeometry(THREE, part.geometry || {}), mat);
    mesh.position.fromArray(part.position || [0, 0, 0]);
    mesh.rotation.fromArray(part.rotation || [0, 0, 0]);
    mesh.scale.fromArray(part.scale || [1, 1, 1]);
    mesh.userData = { anim: part.animation || {}, base: { position: [...(part.position || [0, 0, 0])], scale: [...(part.scale || [1, 1, 1])] } };
    scene.add(mesh);
    meshes.push(mesh);
  }

  const clock = new THREE.Clock();
  function animate() {
    if (disposed) return;
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const dt = clock.getDelta();
    for (const mesh of meshes) {
      const { anim, base } = mesh.userData;
      if (anim.spin) {
        mesh.rotation.x += (anim.spin[0] || 0) * dt * 60 * 0.016;
        mesh.rotation.y += (anim.spin[1] || 0) * dt * 60 * 0.016;
        mesh.rotation.z += (anim.spin[2] || 0) * dt * 60 * 0.016;
      }
      if (anim.pulse) {
        const s = 1 + Math.sin(t * (anim.pulse.speed || 1)) * (anim.pulse.amplitude || 0.03);
        mesh.scale.set(base.scale[0] * s, base.scale[1] * s, base.scale[2] * s);
      }
      if (anim.orbit) {
        const o = anim.orbit;
        const a = t * (o.speed || 0.3) + (o.phase || 0);
        const c = o.center || [0, 0, 0];
        const r = o.radius || 1;
        if (o.axis === "x") {
          mesh.position.set(c[0], c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r);
        } else if (o.axis === "z") {
          mesh.position.set(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]);
        } else {
          mesh.position.set(c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r);
        }
      }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  addEventListener("resize", () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return { dispose() { disposed = true; renderer.dispose(); container.innerHTML = ""; } };
}

/* ------------------------------------------------ artefatti */
// La "lingua" di ADE verso l'esterno: SVG, formule, codice, un breve suono
// (sintetizzato dal vivo, non un file audio), una piccola scena 3D, testo
// libero. Mai iniettati come HTML grezzo (rischio XSS su contenuto generato
// dal modello): SVG passa da un'immagine data-URI (non esegue script),
// codice/formula/testo via textContent, scena3d costruita a oggetti Three.js.

let artefattiFiles = [];
let artefattoCorrente = -1;
let miniScena = null;

async function disegnaArtefatto(art) {
  if (miniScena) { miniScena.dispose(); miniScena = null; }
  const cont = $("#artefatto-contenuto");
  cont.innerHTML = "";

  if (art.tipo === "svg") {
    const img = document.createElement("img");
    img.className = "artefatto-svg";
    img.alt = art.titolo;
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(art.contenuto)));
    cont.appendChild(img);
  } else if (art.tipo === "formula") {
    const div = document.createElement("div");
    div.className = "artefatto-formula";
    div.textContent = art.contenuto;
    cont.appendChild(div);
  } else if (art.tipo === "codice") {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = art.contenuto;
    pre.appendChild(code);
    cont.appendChild(pre);
  } else if (art.tipo === "testo") {
    const div = document.createElement("div");
    div.className = "artefatto-testo";
    div.textContent = art.contenuto;
    cont.appendChild(div);
  } else if (art.tipo === "audio") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "artefatto-audio-btn";
    btn.textContent = "▶ Ascolta";
    btn.addEventListener("click", () => suonaArtefatto(art.contenuto, btn));
    cont.appendChild(btn);
  } else if (art.tipo === "scena3d") {
    const div = document.createElement("div");
    div.className = "artefatto-scena3d";
    cont.appendChild(div);
    try {
      const parti = JSON.parse(art.contenuto);
      miniScena = await avviaMiniScena(div, parti);
    } catch (e) {
      div.textContent = "scena non valida";
      console.error("artefatto scena3d:", e);
    }
  }
}

function suonaArtefatto(contenutoJSON, btn) {
  let spec;
  try { spec = JSON.parse(contenutoJSON); } catch { return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const onde = new Set(["sine", "square", "triangle", "sawtooth"]);
  let t = ctx.currentTime + 0.05;
  for (const nota of (spec.note || []).slice(0, 200)) {
    const freq = Math.max(20, Math.min(8000, Number(nota.freq) || 440));
    const durata = Math.max(0.05, Math.min(3, Number(nota.durata) || 0.3));
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = onde.has(nota.onda) ? nota.onda : "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durata);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durata + 0.05);
    t += durata;
  }
  btn.textContent = "♪ in ascolto…";
  setTimeout(() => { btn.textContent = "▶ Ascolta"; ctx.close(); }, Math.max(0, (t - ctx.currentTime)) * 1000 + 200);
}

async function avviaMiniScena(container, parti) {
  if (!Array.isArray(parti) || !parti.length) throw new Error("scena vuota");
  const THREE = await import("three");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / (container.clientHeight || 170), 0.1, 100);
  camera.position.set(2.6, 2, 3.2);
  camera.lookAt(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight || 170);
  container.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(3, 4, 2);
  scene.add(key);

  const meshes = [];
  for (const p of parti.slice(0, 20)) {
    if (!p || !p.geometry) continue;
    const m = p.material || {};
    let geo;
    try { geo = buildGeometry(THREE, p.geometry); } catch { continue; }
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(m.color || "#8fe3c7"),
      metalness: m.metalness ?? 0.3,
      roughness: m.roughness ?? 0.5,
      wireframe: !!m.wireframe,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.fromArray(p.position || [0, 0, 0]);
    mesh.rotation.fromArray(p.rotation || [0, 0, 0]);
    mesh.scale.fromArray(p.scale || [1, 1, 1]);
    scene.add(mesh);
    meshes.push(mesh);
  }

  let disposed = false;
  const clock = new THREE.Clock();
  function animate() {
    if (disposed) return;
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    for (const mesh of meshes) mesh.rotation.y += dt * 0.4;
    renderer.render(scene, camera);
  }
  animate();
  return { dispose() { disposed = true; renderer.dispose(); container.innerHTML = ""; } };
}

function aggiornaArtefattoNav() {
  const totale = artefattiFiles.length;
  $("#artefatto-indice").textContent = totale ? `${artefattoCorrente + 1}/${totale}` : "";
  $("#artefatto-prev").disabled = artefattoCorrente <= 0;
  $("#artefatto-next").disabled = artefattoCorrente >= totale - 1;
}

async function mostraArtefatto(i) {
  if (i < 0 || i >= artefattiFiles.length) return;
  artefattoCorrente = i;
  aggiornaArtefattoNav();
  const meta = artefattiFiles[i];
  $("#artefatto-titolo").textContent = meta.titolo;
  try {
    const art = await fetchJSON(`body/artefatti/${meta.file}`);
    await disegnaArtefatto(art);
  } catch (e) {
    console.error("artefatto:", e);
  }
}

async function renderArtefattiIndex(index) {
  artefattiFiles = index.files || [];
  const box = $("#artefatto-box");
  if (!artefattiFiles.length) { box.hidden = true; return; }
  box.hidden = false;
  const nuovoUltimo = artefattiFiles.length - 1;
  if (artefattoCorrente === -1 || artefattoCorrente >= nuovoUltimo) await mostraArtefatto(nuovoUltimo);
  else aggiornaArtefattoNav();
}

function setupArtefattiNav() {
  $("#artefatto-prev").addEventListener("click", () => mostraArtefatto(artefattoCorrente - 1));
  $("#artefatto-next").addEventListener("click", () => mostraArtefatto(artefattoCorrente + 1));
}

/* ------------------------------------------------ pannelli */

function renderCorpoInfo(body) {
  $("#corpo-versione").textContent = `corpo v${body.version}`;
  $("#corpo-aggiornato").textContent = body.updated_at ? `aggiornato ${body.updated_at.slice(0, 10)}` : "";
  $("#corpo-descrizione").textContent = body.description || "";
}

let energiaPrecedente = null;

function animaNumero(el, da, a, suffisso, durata = 700) {
  const inizio = performance.now();
  function tick(ora) {
    const t = Math.min(1, (ora - inizio) / durata);
    const smorzato = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(da + (a - da) * smorzato).toLocaleString("it") + suffisso;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderEnergia(e) {
  const da = energiaPrecedente === null ? e.remaining : energiaPrecedente;
  animaNumero($("#energia-residua"), da, e.remaining, " tk");
  energiaPrecedente = e.remaining;
  $("#energia-budget").textContent = e.daily_budget.toLocaleString("it") + " tk";
  $("#cicli").textContent = e.total_cycles;
  $("#ultimo-ciclo").textContent = e.last_cycle_at ? new Date(e.last_cycle_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "mai";
  const pct = Math.round((e.remaining / e.daily_budget) * 100);
  $("#energia-barra").style.width = pct + "%";
  const mini = $("#energia-mini");
  if (mini) mini.textContent = `⚡ ${pct}%`;
}

function mdInline(s) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderDiario(md) {
  // Le voci sono sezioni "## Ciclo N — data" separate da "---".
  const blocks = md.split(/\n## /).slice(1);
  const cont = $("#diario");
  cont.innerHTML = "";
  for (const block of blocks.reverse()) {
    const lines = block.split("\n");
    const title = lines[0];
    const rest = lines.slice(1).join("\n").replace(/\n---\s*$/, "");
    const div = document.createElement("div");
    div.className = "ciclo";
    let html = `<h3>${mdInline(title)}</h3>`;
    const campi = rest.split(/\n\*\*(Osservazione|Decisione|Azione|Risultato)\*\*\n/).slice(1);
    for (let i = 0; i < campi.length; i += 2) {
      const testo = (campi[i + 1] || "").trim().split("\n").map(mdInline).join("<br>");
      html += `<div class="campo"><b>${campi[i]}</b>${testo}</div>`;
    }
    div.innerHTML = html;
    cont.appendChild(div);
  }
  if (!blocks.length) cont.innerHTML = "<p class='nota'>Nessun ciclo ancora registrato.</p>";
}

function renderMemoria(index) {
  const ul = $("#memoria-lista");
  ul.innerHTML = "";
  for (const m of [...index.files].reverse()) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.textContent = `${String(m.ciclo).padStart(3, "0")} · ${m.titolo}`;
    a.addEventListener("click", async () => {
      const viewer = $("#memoria-viewer");
      viewer.hidden = false;
      viewer.textContent = await fetchText(`memory/${m.file}`);
      viewer.scrollTop = 0;
    });
    const quando = document.createElement("span");
    quando.className = "quando";
    quando.textContent = (m.data || "").slice(0, 10);
    li.append(a, quando);
    ul.appendChild(li);
  }
  if (!index.files.length) ul.innerHTML = "<li class='nota'>Nessuna memoria ancora.</li>";
}

function renderAmbiente(manifest) {
  const ul = $("#ambiente-lista");
  ul.innerHTML = "";
  for (const f of manifest.files) {
    const li = document.createElement("li");
    li.innerHTML = `<code>${f.path}</code><span class="size">${f.size} B</span>`;
    ul.appendChild(li);
  }
}

function renderPensieri(list) {
  const cont = $("#pensieri-lista");
  cont.innerHTML = "";
  for (const p of list) {
    const div = document.createElement("div");
    div.className = "pensiero";
    const quando = (p.data || "").slice(0, 16).replace("T", " ");
    div.innerHTML = `<p>${mdInline(p.testo)}</p><span class="pensiero-meta">ciclo ${p.ciclo} · ${quando}</span>`;
    cont.appendChild(div);
  }
  if (!list.length) cont.innerHTML = "<p class='nota'>Ancora nessun pensiero.</p>";
  cont.scrollTop = cont.scrollHeight;
}

function renderEvoluzione(md) {
  const entries = md.split(/\n## /).slice(1).reverse();
  $("#evoluzione").textContent = entries.map((e) => "◇ " + e.trim()).join("\n\n") || "—";
}

/* ------------------------------------------------ avvio + modalità live */

let viewer = null;
let bodyVersion = null;

async function refreshAll() {
  try { renderEnergia(await fetchJSON("agent/state/energy.json")); } catch (e) { console.error("energia:", e); }
  try { renderDiario(await fetchText("ACTION_LOG.md")); } catch (e) { console.error("diario:", e); }
  try { renderMemoria(await fetchJSON("memory/index.json")); } catch { $("#memoria-lista").innerHTML = "<li class='nota'>Nessuna memoria ancora.</li>"; }
  try { renderAmbiente(await fetchJSON("environment/manifest.json")); } catch (e) { console.error("ambiente:", e); }
  try { renderEvoluzione(await fetchText("body/CHANGELOG.md")); } catch (e) { console.error("evoluzione:", e); }
  try { renderPensieri(await fetchJSON("body/pensieri.json")); } catch { $("#pensieri-lista").innerHTML = "<p class='nota'>Ancora nessun pensiero.</p>"; }
  try { await renderArtefattiIndex(await fetchJSON("body/artefatti/index.json")); } catch { $("#artefatto-box").hidden = true; }

  try {
    const body = await fetchJSON("body/body.json");
    renderCorpoInfo(body);
    if (body.version !== bodyVersion) {
      bodyVersion = body.version;
      if (viewer) viewer.dispose();
      viewer = await startViewer(body);
    }
  } catch (e) { console.error("corpo:", e); }
}

function setBadge(stato, testo) {
  const b = $("#live-badge");
  b.className = stato;
  b.textContent = testo;
}

function setCountdown(iso) {
  const el = $("#prossimo-ciclo");
  if (!iso) { el.textContent = ""; return; }
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) { el.textContent = "ciclo imminente"; return; }
  const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
  el.textContent = `prossimo ciclo tra ${h}h ${String(m).padStart(2, "0")}m`;
}

function connectLive() {
  const es = new EventSource("/api/events");
  es.addEventListener("benvenuto", (e) => {
    setBadge("online", "live");
    setCountdown(JSON.parse(e.data).prossimo_ciclo);
  });
  es.addEventListener("battito", (e) => {
    const d = JSON.parse(e.data);
    setBadge(d.ciclo_in_corso ? "pensando" : "online", d.ciclo_in_corso ? "l'entità sta pensando…" : "live");
    setCountdown(d.prossimo_ciclo);
  });
  es.addEventListener("ciclo_inizio", () => setBadge("pensando", "l'entità sta pensando…"));
  for (const ev of ["stato", "ciclo_fine", "stimolo_approvato"]) {
    es.addEventListener(ev, () => { setBadge("online", "live"); refreshAll(); });
  }
  es.onerror = () => {
    setBadge("offline", "connessione persa, ritento…");
    es.close();
    setTimeout(connectLive, 5000);
  };
}

function setupUpload() {
  $("#upload-sezione").hidden = false;
  $("#upload-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#upload-file").files[0];
    const esito = $("#upload-esito");
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { esito.textContent = "File oltre gli 8 MB."; return; }
    esito.textContent = "Scansione in corso…";
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const r = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: file.name,
        dati_base64: btoa(bin),
        nota: $("#upload-nota").value,
        autore: $("#upload-autore").value,
      }),
    });
    const out = await r.json();
    if (!r.ok) { esito.textContent = "Errore: " + (out.errore || r.status); return; }
    if (out.stato === "rifiutato_automaticamente") {
      esito.textContent = "Rifiutato dallo scanner: " + out.rapporto.motivi.join("; ");
    } else {
      esito.textContent = `In quarantena (scansione: ${out.rapporto.esito}). Un amministratore deciderà se farlo entrare nel mondo di ADE.`;
      $("#upload-form").reset();
    }
  });
}

function setupAccordionAnimazione() {
  for (const dettaglio of document.querySelectorAll("details.accordion")) {
    const corpo = dettaglio.querySelector(".accordion-body");
    dettaglio.addEventListener("toggle", () => {
      if (!dettaglio.open) return;
      corpo.classList.remove("entrando");
      void corpo.offsetWidth; // forza il reflow: riavvia l'animazione anche se già vista
      corpo.classList.add("entrando");
    });
  }
}

/** Il viewer può espandersi, collassando il riquadro di upload a una barra sottile. */
function setupEspansioneViewer() {
  const stage = document.querySelector(".stage");
  const bottone = $("#espandi-viewer");
  const titolo = $("#upload-titolo");
  if (!stage || !bottone) return;

  function imposta(espanso) {
    stage.classList.toggle("espanso", espanso);
    bottone.setAttribute("aria-pressed", String(espanso));
    bottone.textContent = espanso ? "⤡" : "⤢";
    bottone.title = espanso ? "riduci il viewer" : "espandi il viewer";
    if (titolo) titolo.setAttribute("aria-expanded", String(!espanso));
    // Il canvas Three.js non segue da solo il ridimensionamento CSS del
    // contenitore (solo il resize della finestra è collegato): notifichiamo
    // noi, sia subito sia a transizione conclusa, per un canvas sempre nitido.
    const viewer = $("#viewer");
    const notifica = () => dispatchEvent(new Event("resize"));
    notifica();
    if (viewer) viewer.addEventListener("transitionend", notifica, { once: true });
  }

  bottone.addEventListener("click", () => imposta(!stage.classList.contains("espanso")));
  if (titolo) {
    const riapri = () => { if (stage.classList.contains("espanso")) imposta(false); };
    titolo.addEventListener("click", riapri);
    titolo.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); riapri(); } });
  }
}

(async () => {
  setupAccordionAnimazione();
  setupArtefattiNav();
  setupEspansioneViewer();
  await refreshAll();
  try {
    const state = await fetchJSON("/api/state");
    if (state.live) {
      setupUpload();
      setCountdown(state.prossimo_ciclo);
      if (state.sse === false) {
        // Serverless (Vercel): niente SSE, sincronizzazione periodica leggera.
        setBadge("online", "live · sync 30s");
        setInterval(async () => {
          try { setCountdown((await fetchJSON("/api/state")).prossimo_ciclo); } catch {}
          await refreshAll();
        }, 30000);
      } else {
        connectLive();
      }
      return;
    }
  } catch { /* hosting statico: nessun server live */ }
  setBadge("offline", "osservazione differita (aggiornamento ogni 60s)");
  setInterval(refreshAll, 60000);
})();
