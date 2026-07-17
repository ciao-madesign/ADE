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
}

/* ------------------------------------------------ pannelli */

function renderCorpoInfo(body) {
  $("#corpo-versione").textContent = `corpo v${body.version}`;
  $("#corpo-aggiornato").textContent = body.updated_at ? `aggiornato ${body.updated_at.slice(0, 10)}` : "";
  $("#corpo-descrizione").textContent = body.description || "";
}

function renderEnergia(e) {
  $("#energia-residua").textContent = e.remaining.toLocaleString("it") + " tk";
  $("#energia-budget").textContent = e.daily_budget.toLocaleString("it") + " tk";
  $("#cicli").textContent = e.total_cycles;
  $("#ultimo-ciclo").textContent = e.last_cycle_at ? new Date(e.last_cycle_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "mai";
  $("#energia-barra").style.width = Math.round((e.remaining / e.daily_budget) * 100) + "%";
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

function renderEvoluzione(md) {
  const entries = md.split(/\n## /).slice(1).reverse();
  $("#evoluzione").textContent = entries.map((e) => "◇ " + e.trim()).join("\n\n") || "—";
}

/* ------------------------------------------------ avvio */

(async () => {
  try { renderEnergia(await fetchJSON("agent/state/energy.json")); } catch (e) { console.error("energia:", e); }
  try { renderDiario(await fetchText("ACTION_LOG.md")); } catch (e) { console.error("diario:", e); }
  try { renderMemoria(await fetchJSON("memory/index.json")); } catch { $("#memoria-lista").innerHTML = "<li class='nota'>Nessuna memoria ancora.</li>"; }
  try { renderAmbiente(await fetchJSON("environment/manifest.json")); } catch (e) { console.error("ambiente:", e); }
  try { renderEvoluzione(await fetchText("body/CHANGELOG.md")); } catch (e) { console.error("evoluzione:", e); }

  try {
    const body = await fetchJSON("body/body.json");
    renderCorpoInfo(body);
    await startViewer(body);
  } catch (e) { console.error("corpo:", e); }
})();
