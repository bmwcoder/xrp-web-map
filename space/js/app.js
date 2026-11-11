import {
  CENTER_IDS, GRADE_TEXT, GRADES, SIDE_HINT, SIDE_TEXT, SIDES,
  adoptionTally, applyFilters, createModel, defaultFilters, edgesOf,
  escapeHtml, formatUpdated, hostOf, latestEdges, safeUrl, searchNodes,
  shellAround, toggleGrade, toggleSide, toursFor, validateGraph,
} from "./graph.js";

const CACHE_NAME = "xrpmap-space-graph-v1";
const CACHE_REQ = new Request(new URL("./graph-cache.json", document.baseURI));
const CODE = "space-preview-2";
const PUBLIC_GRAPH = "https://xrpmap.org/graph.json";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  model: null,
  space: null,
  webgl: null,
  mode: "loading",
  sel: -1,
  tour: null,
  step: 0,
  motionOff: false,
  source: "",
  savedAt: "",
  loadError: "",
};

const preview = {
  get ready() { return state.mode === "webgl" || state.mode === "fallback"; },
  get mode() { return state.mode; },
  get meta() { return state.model && state.model.meta; },
  get counts() {
    const m = state.model;
    return m && { nodes: m.nodes.length, edges: m.edges.length, shownN: m.countN, shownE: m.countE, key: m.filters.key };
  },
  get fps() { return state.space ? state.space.fps : 0; },
  get renderer() { return state.webgl && state.webgl.renderer; },
  get software() { return !!(state.webgl && state.webgl.software); },
  get motionOff() { return state.motionOff; },
  get selected() {
    return state.sel >= 0 && state.model ? state.model.nodes[state.sel].id : null;
  },
  get tours() { return state.model ? toursFor(state.model).map((t) => t.id) : []; },
  get source() { return state.source; },
  get warnings() { return state.model ? state.model.warnings : []; },
  get engine() { return state.space; },
  get view() { return viewMetrics(); },
  get dataHref() { return state.dataHref || ""; },
};
window.__spacePreview = preview;

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function phone() { return innerWidth < 760; }

function placeChrome() {
  const top = $("#top")?.getBoundingClientRect().height || 62;
  const filters = $("#filters")?.getBoundingClientRect().height || 46;
  const foot = $("#foot")?.getBoundingClientRect().height || 76;
  const root = document.documentElement.style;
  root.setProperty("--top", `${Math.ceil(top)}px`);
  root.setProperty("--filters", `${Math.ceil(filters)}px`);
  root.setProperty("--foot", `${Math.ceil(foot)}px`);
}

async function fetchLive() {
  const candidates = [new URL("../graph.json", document.baseURI).href, PUBLIC_GRAPH];
  const errors = [];
  for (const href of candidates) {
    try {
      const res = await fetch(href, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("not valid JSON"); }
      return { data, text, href };
    } catch (error) {
      errors.push(`${href}: ${error.message || error}`);
    }
  }
  throw new Error(errors.join(" "));
}

async function readCache() {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(CACHE_REQ);
    if (!res) return null;
    const data = await res.json();
    return { data, savedAt: res.headers.get("x-saved-at") || "" };
  } catch {
    return null;
  }
}

async function writeCache(text) {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(CACHE_REQ, new Response(text, {
      headers: {
        "content-type": "application/json",
        "x-saved-at": new Date().toISOString(),
      },
    }));
  } catch { /* quota or private mode: the live fetch still worked */ }
}

async function loadGraph() {
  try {
    const live = await fetchLive();
    const check = validateGraph(live.data);
    if (!check.ok) {
      const error = new Error(check.errors.join(" "));
      error.schema = true;
      throw error;
    }
    await writeCache(live.text);
    return { data: live.data, source: "live", savedAt: "", href: live.href };
  } catch (error) {
    const cached = await readCache();
    if (cached) {
      const check = validateGraph(cached.data);
      if (check.ok) {
        return { data: cached.data, source: "cache", savedAt: cached.savedAt, loadError: error.message || String(error) };
      }
    }
    throw error;
  }
}

function banner(kind, html) {
  const el = $("#banner");
  if (!html) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.className = `banner ${kind}`;
  el.innerHTML = html;
}

function setBoot(text, isError) {
  const el = $("#boot");
  el.hidden = false;
  el.classList.toggle("err", !!isError);
  el.innerHTML = text;
}

function countsText() {
  const m = state.model;
  const n = (v) => v.toLocaleString("en-US");
  const scope = m.filters.key ? " · key connections" : " · all connections";
  return `${n(m.countN)} of ${n(m.nodes.length)} entities · ${n(m.countE)} of ${n(m.edges.length)} connections${scope}`;
}

function paintCounts() {
  const m = state.model;
  $("#counts").textContent = countsText();
  $("#updated").textContent = `Graph updated ${formatUpdated(m.meta.updated)}`;
  $("#updated").dateTime = m.meta.updated;
  $("#updated").title = m.meta.updated;
  const from = $("#dataFrom");
  if (from) {
    if (state.source === "cache") from.textContent = "Showing a copy saved in this browser.";
    else if (state.dataHref && state.dataHref.includes("xrpmap.org/graph.json") && !state.dataHref.startsWith(location.origin)) from.textContent = "Loaded from xrpmap.org/graph.json.";
    else from.textContent = "Loaded from this site’s graph.json.";
  }
  const hud = $("#hudCount");
  if (hud) hud.textContent = `${m.countN.toLocaleString("en-US")} shown · ${m.nodes.length.toLocaleString("en-US")} in graph`;
}

function syncFilterButtons() {
  const f = state.model.filters;
  $("#keyBtn").setAttribute("aria-pressed", String(f.key));
  $("#allBtn").setAttribute("aria-pressed", String(!f.key));
  for (const btn of $$("[data-grade]")) {
    const on = f.grades.size !== GRADES.length && f.grades.has(btn.dataset.grade);
    btn.setAttribute("aria-pressed", String(on));
  }
  for (const btn of $$("[data-side]")) {
    const on = f.sides.size !== SIDES.length && f.sides.has(btn.dataset.side);
    btn.setAttribute("aria-pressed", String(on));
  }
}

function afterFilterChange() {
  paintCounts();
  syncFilterButtons();
  if (state.space) state.space.applyVisibility();
  if (state.space) {
    applyFocusLayout(state.sel);
    if (state.sel >= 0) frameFocus(state.sel);
  }
  if (state.mode === "fallback") renderFallbackList();
  if (state.sel >= 0) renderPanel();
}

function revealSelection(index) {
  if (state.model.vn[index]) return;
  applyFilters(state.model, { key: false });
  if (!state.model.vn[index]) applyFilters(state.model, defaultFilters());
  if (!state.model.vn[index]) applyFilters(state.model, { key: false, grades: new Set(GRADES), sides: new Set(SIDES) });
}

function select(index, reason) {
  if (!state.model) return;
  if (state.tour && reason !== "tour") stopTour(false);
  state.sel = index;
  if (index >= 0) revealSelection(index);
  if (state.space) state.space.select(index, false);
  if (index >= 0) {
    renderPanel();
    openPanel();
    const id = state.model.nodes[index].id;
    if (reason !== "hash") history.pushState({ node: id }, "", `#node=${encodeURIComponent(id)}`);
  } else {
    closePanel();
    if (reason !== "hash" && location.hash.startsWith("#node=")) history.pushState({}, "", location.pathname + location.search);
  }
  afterFilterChange();
}

function openPanel() {
  const panel = $("#panel");
  panel.hidden = false;
  if (phone() && !panel.dataset.snap) panel.dataset.snap = "peek";
  requestAnimationFrame(() => panel.classList.add("open"));
}

function closePanel() {
  const panel = $("#panel");
  panel.classList.remove("open");
  panel.hidden = true;
}

function sourceLink(url) {
  const href = safeUrl(url);
  if (!href) return '<span class="src none">No source link</span>';
  return `<a class="src" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostOf(href))} ↗</a>`;
}

function gradeMark(grade) {
  const text = GRADE_TEXT[grade] || "Ungraded";
  return `<b class="g g${escapeHtml(grade || "U")}" title="${escapeHtml(text)}">${escapeHtml(grade || "–")}</b> <span>${escapeHtml(text)}</span>`;
}

function sideMark(side) {
  return `<span class="side side-${side}" title="${escapeHtml(SIDE_HINT[side] || "")}">${escapeHtml(SIDE_TEXT[side] || side)}</span>`;
}

function renderPanel() {
  const m = state.model;
  const node = m.nodes[state.sel];
  if (!node) return;
  const sector = node.sec === "center" ? "Core of the graph" : (m.sectorById[node.sec]?.title || node.sec);
  const all = edgesOf(m, node.i).slice().sort((a, b) => (b.key - a.key) || (b.strength - a.strength) || a.j - b.j);
  const tally = adoptionTally(all);
  const groups = new Map();
  for (const edge of all) {
    const other = m.nodes[edge.a === node.i ? edge.b : edge.a];
    if (!groups.has(other.type)) groups.set(other.type, []);
    groups.get(other.type).push([edge, other]);
  }
  const sources = node.sources.map(sourceLink).join("");
  const body = $("#pBody");
  body.innerHTML = `
    <p class="kicker">${escapeHtml(node.type)} · ${escapeHtml(sector)}</p>
    <h2 id="pTitle">${escapeHtml(node.label)}</h2>
    ${node.handle ? `<p class="handle">${escapeHtml(node.handle)}</p>` : ""}
    <p class="meta">${gradeMark(node.grade)} · ${all.length.toLocaleString("en-US")} connections${node.added ? ` · added ${escapeHtml(formatUpdated(node.added))}` : ""}</p>
    ${node.why ? `<p class="why"><b>Why it is here.</b> ${escapeHtml(node.why)}</p>` : ""}
    ${node.summary ? `<p class="sum">${escapeHtml(node.summary)}</p>` : ""}
    <div class="srcs"><b>Entity sources</b> ${sources || '<span class="src none">None stored</span>'}</div>
    <div class="split">
      <p><b>Connections</b> are sourced links between two entities. A connection is not adoption, a partnership, or an accusation.</p>
      <p><b>Adoption</b> is a separate mark on each connection: ${tally.supports} support it, ${tally.contradicts} contradict it, ${tally.neutral} are not about adoption.</p>
      <p>Around this entity, space shows only its real connections, moved nearby so the names can be read. Nothing is added. Home puts every entity back in the galaxy.</p>
    </div>
    ${[...groups.entries()].map(([type, rows]) => `
      <details open>
        <summary>${escapeHtml(type)} <small>${rows.length}</small></summary>
        ${rows.map(([edge, other], i) => `
          <div class="conn${i > 5 ? " more" : ""}${m.ve[edge.j] ? "" : " dim"}">
            <div class="c1"><button type="button" data-go="${other.i}">${escapeHtml(other.label)}</button>${edge.key ? ' <span class="key" title="Marked as a key connection in the public graph">key</span>' : ""} ${gradeMark(edge.grade)}</div>
            <p class="c2"><span>Connection.</span> ${escapeHtml(edge.label)}</p>
            <p class="c3">${sideMark(edge.side)} <span class="str" title="Link strength 1 to 5, separate from the source grade">${"●".repeat(edge.strength)}<span>${"●".repeat(5 - edge.strength)}</span></span> ${sourceLink(edge.source)}</p>
          </div>`).join("")}
        ${rows.length > 6 ? `<button type="button" class="text more-btn">Show ${rows.length - 6} more</button>` : ""}
      </details>`).join("")}
    ${all.length ? "" : '<p class="sum">No connections are stored for this entity.</p>'}
    <p class="fine">Grades describe the source. The adoption mark describes the XRP / Ripple rails question. Read the linked source.</p>`;
  body.scrollTop = 0;
}

function renderTours() {
  const tours = toursFor(state.model);
  const list = $("#tourList");
  if (!tours.length) {
    $("#tourBtn").hidden = true;
    list.innerHTML = "";
    return;
  }
  $("#tourBtn").hidden = false;
  list.innerHTML = tours.map((tour) => `
    <button type="button" data-tour="${escapeHtml(tour.id)}">
      <b>${escapeHtml(tour.title)}</b>
      <span>${escapeHtml(tour.blurb)} ${tour.steps.length} steps.</span>
    </button>`).join("");
}

function renderLatest() {
  const rows = latestEdges(state.model, 6);
  $("#latestList").innerHTML = rows.map((edge) => {
    const A = state.model.nodes[edge.a];
    const B = state.model.nodes[edge.b];
    return `<li><button type="button" data-go="${A.i}">${escapeHtml(A.lbl)}</button> → <button type="button" data-go="${B.i}">${escapeHtml(B.lbl)}</button><small>${escapeHtml(edge.label)}</small></li>`;
  }).join("") || "<li>No dated connections in this graph.</li>";
}

function renderFallbackList() {
  const m = state.model;
  const q = $("#q").value.trim();
  const nodes = (q ? searchNodes(m, q, 30) : m.nodes.filter((n) => m.vn[n.i]).sort((a, b) => b.deg - a.deg).slice(0, 40));
  $("#fallbackList").innerHTML = nodes.map((n) => `
    <button type="button" data-go="${n.i}">${escapeHtml(n.label)} <small>${escapeHtml(n.type)} · ${n.deg} connections</small></button>`).join("")
    || "<p>Nothing matches.</p>";
}

function visibleNeighbors(index) {
  const m = state.model;
  return edgesOf(m, index).filter((edge) => m.ve[edge.j]).map((edge) => m.nodes[edge.a === index ? edge.b : edge.a]);
}

function applyFocusLayout(index) {
  const space = state.space;
  if (!space?.syncPositions) return;
  if (index < 0) {
    space.syncPositions(null);
    return;
  }
  const origin = state.model.nodes[index];
  const shell = shellAround(origin, visibleNeighbors(index));
  const placed = new Map(shell.map((point) => [point.i, point]));
  space.syncPositions((node) => {
    const point = placed.get(node.i);
    return point ? [point.x, point.y, point.z] : null;
  });
}

function frameFocus(index) {
  const space = state.space;
  if (!space) return Promise.resolve();
  const ids = [index, ...visibleNeighbors(index).map((node) => node.i)];
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const pts = [];
  for (const i of ids) {
    const x = space.nodePos[i * 3];
    const y = space.nodePos[i * 3 + 1];
    const z = space.nodePos[i * 3 + 2];
    if (![x, y, z].every(Number.isFinite)) continue;
    cx += x;
    cy += y;
    cz += z;
    pts.push([x, y, z]);
  }
  if (!pts.length) return Promise.resolve();
  cx /= pts.length;
  cy /= pts.length;
  cz /= pts.length;
  let rad = 80;
  for (const [x, y, z] of pts) rad = Math.max(rad, Math.hypot(x - cx, y - cy, z - cz));
  const dist = Math.min(5200, Math.max(700, rad / Math.sin((50 * Math.PI / 180) / 2) * 1.18));
  const eye = space.camera.position.clone().set(cx + dist * 0.38, cy - dist * 0.78, cz + dist * 0.5);
  const target = space.controls.target.clone().set(cx, cy, cz - (phone() ? rad * 0.55 : 0));
  return space.flyTo(eye, target, state.motionOff ? 1 : 900);
}

function viewMetrics() {
  const space = state.space;
  const labels = document.querySelectorAll("#labels3d .lab").length;
  if (!space || state.sel < 0) return { n: 0, width: 0, height: 0, labels, header: $("#top").getBoundingClientRect().height, sheet: 0, innerHeight };
  const ids = [state.sel, ...visibleNeighbors(state.sel).map((node) => node.i)];
  const pts = [];
  for (const i of ids) {
    const projected = space.nodeVec(i).clone().project(space.camera);
    if (!Number.isFinite(projected.x) || projected.z > 1) continue;
    pts.push([(projected.x + 1) / 2 * space.w, (1 - projected.y) / 2 * space.h]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const panel = $("#panel");
  return {
    n: pts.length,
    width: pts.length ? Math.max(...xs) - Math.min(...xs) : 0,
    height: pts.length ? Math.max(...ys) - Math.min(...ys) : 0,
    labels,
    header: $("#top").getBoundingClientRect().height,
    sheet: panel.hidden ? 0 : panel.getBoundingClientRect().height,
    innerHeight,
  };
}

function labelSet() {
  const m = state.model;
  const out = [];
  const focus = state.sel;
  if (state.tour && focus < 0) {
    const step = state.tour.steps[state.step];
    for (const i of step?.group || []) out.push({ i, cls: "nl tag", force: true });
    if (step?.focus >= 0) out.push({ i: step.focus, cls: "nl sel", force: true });
    return out;
  }
  if (focus >= 0) {
    out.push({ i: focus, cls: "nl sel", force: true });
    const neighbors = visibleNeighbors(focus).sort((a, b) => b.deg - a.deg || (a.id < b.id ? -1 : 1));
    const picked = [];
    const seen = new Set();
    for (const node of neighbors) {
      if (seen.has(node.sec)) continue;
      seen.add(node.sec);
      picked.push(node);
    }
    for (const node of neighbors) {
      if (picked.length >= (phone() ? 7 : 12)) break;
      if (!picked.includes(node)) picked.push(node);
    }
    for (const node of picked) out.push({ i: node.i, cls: "nl nb", force: true });
    return out;
  }
  const cap = phone() ? 7 : 12;
  for (const id of [...CENTER_IDS, "rlusd"]) {
    const i = m.idx.get(id);
    if (i !== undefined && m.vn[i]) out.push({ i, cls: "nl gold", force: true });
  }
  const seen = new Set(out.map((item) => m.nodes[item.i].sec));
  const ranked = m.nodes.filter((node) => m.vn[node.i]).sort((a, b) => b.deg - a.deg);
  for (const node of ranked) {
    if (out.length >= cap) break;
    if (seen.has(node.sec)) continue;
    seen.add(node.sec);
    out.push({ i: node.i, cls: "nl" });
  }
  return out;
}

function webglInfo() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) || canvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "This browser did not provide a WebGL context." };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl.getParameter(gl.RENDERER) || "");
    const software = /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i.test(renderer);
    return { ok: true, renderer, software };
  } catch (error) {
    return { ok: false, reason: error.message || String(error) };
  }
}

function simplifySpace(space) {
  const software = state.webgl.software;
  if (software || state.motionOff || phone()) {
    space.bloomOn = false;
    if (space.bloom) space.bloom.enabled = false;
  }
  if (software || state.motionOff) {
    space.directRender = true;
    if (software && space.sky) space.sky.visible = false;
    const pixels = innerWidth * innerHeight;
    space.dpr = software ? (pixels > 700000 ? 0.5 : 0.85) : 1;
    space.resize();
  }
  space.motionOff = state.motionOff;
  space.lineMul = 1;
  space.controls.autoRotateSpeed = 0.12;
}

async function startSpace() {
  const info = webglInfo();
  state.webgl = info;
  if (!info.ok) {
    state.mode = "fallback";
    $("#fallback").hidden = false;
    $("#fallbackReason").textContent = info.reason;
    renderFallbackList();
    return;
  }
  try {
    const { Space } = await import("./space-WZLWI5EC.js");
    const space = new Space($("#space"), $("#labels3d"), state.model, {
      onPick: (index) => select(index, "pick"),
      onFrame: () => { preview.frame = (preview.frame || 0) + 1; },
      preserve: /shots/.test(location.search),
      software: info.software,
    });
    state.space = space;
    simplifySpace(space);
    space.setLabelSet(labelSet);
    space.setActive(true);
    space.host.appendChild($("#labels3d"));
    const canvas = space.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-label", "Galaxy of public XRP connections. Drag or use arrow keys to orbit, scroll or plus and minus to zoom, Enter or click a point to inspect it.");
    canvas.addEventListener("keydown", onCanvasKey);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      state.mode = "fallback";
      $("#fallback").hidden = false;
      $("#fallbackReason").textContent = "WebGL stopped. Search and source details still work.";
      renderFallbackList();
    });
    state.mode = "webgl";
    if (info.software) {
      const note = $("#soft");
      note.hidden = false;
      note.textContent = "Software WebGL on this browser: the full-screen sky shader is off. A real phone or tablet GPU was not measured and may be faster.";
    }
  } catch (error) {
    console.error(error);
    state.mode = "fallback";
    $("#fallback").hidden = false;
    $("#fallbackReason").textContent = "The 3D view failed to start. Search and source details still work.";
    renderFallbackList();
  }
}

function onCanvasKey(event) {
  const space = state.space;
  if (!space) return;
  if (event.key === "+" || event.key === "=") { zoom(1 / 1.25); event.preventDefault(); }
  else if (event.key === "-" || event.key === "_") { zoom(1.25); event.preventDefault(); }
  else if (event.key === "Enter") { select(space.pick(space.w / 2, space.h / 2), "pick"); event.preventDefault(); }
  else if (event.key.startsWith("Arrow")) {
    const step = event.shiftKey ? 0.16 : 0.07;
    const yaw = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
    const pitch = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
    orbitBy(yaw, pitch);
    event.preventDefault();
  } else if (event.key === "Home") { goHome(); event.preventDefault(); }
}

function orbitBy(yaw, pitch) {
  const space = state.space;
  const offset = space.camera.position.clone().sub(space.controls.target);
  if (yaw) offset.applyAxisAngle(space.camera.up, yaw);
  if (pitch) {
    const right = offset.clone().cross(space.camera.up);
    if (right.lengthSq() > 1e-6) offset.applyAxisAngle(right.normalize(), pitch);
  }
  if (offset.length() < 80) offset.setLength(80);
  if (offset.length() > 16000) offset.setLength(16000);
  space.camera.position.copy(space.controls.target).add(offset);
  space.camera.lookAt(space.controls.target);
  space.userBusy = false;
}

function zoom(scale) {
  const space = state.space;
  if (!space) return;
  const offset = space.camera.position.clone().sub(space.controls.target).multiplyScalar(scale);
  const dist = offset.length();
  if (dist < 80 || dist > 16000) return;
  space.flyTo(space.controls.target.clone().add(offset), space.controls.target.clone(), state.motionOff ? 1 : 420);
}

function setMotion(off) {
  state.motionOff = off;
  if (state.space) state.space.motionOff = off;
  $("#pauseBtn").setAttribute("aria-pressed", String(off));
  $("#pauseBtn").textContent = off ? "Motion off" : "Pause";
}

function fitGalaxy(duration = 900) {
  const space = state.space;
  if (!space) return Promise.resolve();
  applyFocusLayout(-1);
  const pts = [];
  for (const node of state.model.nodes) {
    if (!state.model.vn[node.i]) continue;
    const x = space.nodePos[node.i * 3];
    const y = space.nodePos[node.i * 3 + 1];
    const z = space.nodePos[node.i * 3 + 2];
    if ([x, y, z].every(Number.isFinite)) pts.push([x, y, z]);
  }
  if (pts.length < 2) return space.overview(state.motionOff ? 1 : duration);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= pts.length;
  cy /= pts.length;
  cz /= pts.length;
  const dists = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz)).sort((a, b) => a - b);
  const rad = Math.max(280, dists[Math.min(dists.length - 1, Math.floor((dists.length - 1) * 0.9))]);
  const fov = 50 * Math.PI / 180;
  const aspect = space.w / Math.max(space.h, 1);
  const vLimit = rad / Math.sin(fov / 2);
  const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  const hLimit = rad / Math.sin(hFov / 2);
  const chrome = space.h > 0 ? Math.min(0.45, ((parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top")) || 0) + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--foot")) || 0)) / space.h) : 0.2;
  const dist = Math.min(7000, Math.max(700, Math.max(vLimit, hLimit) * (0.78 + chrome)));
  const eye = space.camera.position.clone().set(cx + dist * 0.2, cy - dist * 0.86, cz + dist * 0.38);
  const target = space.controls.target.clone().set(cx, cy, cz);
  return space.flyTo(eye, target, state.motionOff ? 1 : duration);
}

async function goHome() {
  stopTour(false);
  $("#q").value = "";
  $("#results").hidden = true;
  applyFilters(state.model, defaultFilters());
  select(-1, "home");
  if (state.space) {
    state.space.setGroup(null);
    state.space.setPath(null);
    await fitGalaxy(state.motionOff ? 1 : 800);
  }
  afterFilterChange();
}

function stopTour(resetCamera) {
  state.tour = null;
  state.step = 0;
  $("#tour").hidden = true;
  document.body.classList.remove("touring");
  if (state.space) {
    state.space.tourOn = false;
    state.space.setPath(null);
    state.space.setGroup(null);
    state.space.cancelFly();
    applyFocusLayout(state.sel);
    if (resetCamera) state.space.overview(state.motionOff ? 1 : 1200);
  }
}

async function showStep() {
  const tour = state.tour;
  if (!tour || !state.space) return;
  const step = tour.steps[state.step];
  if (!(step.focus >= 0)) applyFocusLayout(-1);
  $("#tTitle").textContent = tour.title;
  $("#tCount").textContent = `${state.step + 1} of ${tour.steps.length}`;
  $("#tCaption").textContent = step.caption;
  $("#tSource").innerHTML = step.source ? sourceLink(step.source) : "";
  $("#tPrev").disabled = state.step === 0;
  $("#tNext").textContent = state.step === tour.steps.length - 1 ? "Done" : "Next";
  state.space.tourOn = true;
  state.space.setPath((step.path || []).map((p) => ({ a: p.a, b: p.b })));
  state.space.setGroup(step.group && step.group.length ? step.group : null);
  if (step.overview) {
    state.space.select(-1, false);
    state.sel = -1;
    closePanel();
    await fitGalaxy(state.motionOff ? 1 : 900);
  } else if (step.sector) {
    const anchor = state.space.sectorAnchors.find((item) => item.sec.id === step.sector);
    if (anchor) {
      const dist = phone() ? 2600 : 1900;
      const dest = anchor.center.clone();
      const approach = state.space.camera.position.clone().sub(state.space.controls.target);
      if (approach.lengthSq() < 1) approach.set(1, -1, 0.4);
      dest.add(approach.normalize().multiplyScalar(dist));
      await state.space.flyTo(dest, anchor.center.clone(), state.motionOff ? 1 : 1500);
    }
  } else if (step.focus >= 0) {
    state.sel = step.focus;
    state.space.select(step.focus, false);
    applyFocusLayout(step.focus);
    renderPanel();
    await frameFocus(step.focus);
  }
}

async function startTour(id) {
  const tour = toursFor(state.model).find((item) => item.id === id);
  if (!tour) return;
  $("#tourPop").hidden = true;
  if (state.mode !== "webgl") {
    banner("warn", "Tours fly through the 3D view. This browser has no WebGL, so the tour list stays available after WebGL returns.");
    return;
  }
  state.tour = tour;
  state.step = 0;
  $("#tour").hidden = false;
  document.body.classList.add("touring");
  await showStep();
}

function bindSearch() {
  const input = $("#q");
  const box = $("#results");
  let items = [];
  let cursor = 0;
  const paint = () => {
    items = searchNodes(state.model, input.value, 8);
    box.hidden = !input.value.trim();
    input.setAttribute("aria-expanded", String(!box.hidden));
    box.innerHTML = items.length
      ? items.map((node, i) => `<button type="button" role="option" id="opt${i}" class="${i === cursor ? "on" : ""}" data-i="${node.i}" aria-selected="${i === cursor}">${escapeHtml(node.label)} <small>${escapeHtml(node.type)} · ${node.deg}</small></button>`).join("")
      : '<p class="empty">No entity matches.</p>';
    if (state.mode === "fallback") renderFallbackList();
  };
  input.addEventListener("input", () => { cursor = 0; paint(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { cursor = Math.min(items.length - 1, cursor + 1); paint(); event.preventDefault(); }
    else if (event.key === "ArrowUp") { cursor = Math.max(0, cursor - 1); paint(); event.preventDefault(); }
    else if (event.key === "Enter" && items[cursor]) { choose(items[cursor].i); event.preventDefault(); }
    else if (event.key === "Escape") { input.value = ""; paint(); input.blur(); }
  });
  box.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (btn) choose(+btn.dataset.i);
  });
  function choose(index) {
    input.value = "";
    box.hidden = true;
    select(index, "search");
  }
}

function bindChrome() {
  $("#keyBtn").addEventListener("click", () => { applyFilters(state.model, { key: true }); afterFilterChange(); fitGalaxy(state.motionOff ? 1 : 700); });
  $("#allBtn").addEventListener("click", () => { applyFilters(state.model, { key: false }); afterFilterChange(); });
  for (const btn of $$("[data-grade]")) btn.addEventListener("click", () => { toggleGrade(state.model, btn.dataset.grade); afterFilterChange(); });
  for (const btn of $$("[data-side]")) btn.addEventListener("click", () => { toggleSide(state.model, btn.dataset.side); afterFilterChange(); });
  $("#filterBtn").addEventListener("click", () => {
    const open = document.body.classList.toggle("show-filters");
    $("#filterBtn").setAttribute("aria-expanded", String(open));
    placeChrome();
  });
  $("#pMore").addEventListener("click", () => {
    const panel = $("#panel");
    if (phone()) panel.dataset.snap = panel.dataset.snap === "full" ? "peek" : "full";
    const sources = $("#pBody .srcs");
    if (sources) sources.scrollIntoView({ block: "nearest" });
  });
  $("#homeBtn").addEventListener("click", () => goHome());
  $("#pauseBtn").addEventListener("click", () => setMotion(!state.motionOff));
  $("#zIn").addEventListener("click", () => zoom(1 / 1.3));
  $("#zOut").addEventListener("click", () => zoom(1.3));
  $("#zFit").addEventListener("click", () => fitGalaxy(state.motionOff ? 1 : 700));
  $("#reloadBtn").addEventListener("click", reload);
  $("#tourBtn").addEventListener("click", () => { $("#tourPop").hidden = !$("#tourPop").hidden; });
  $("#tourList").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-tour]");
    if (btn) startTour(btn.dataset.tour);
  });
  $("#tNext").addEventListener("click", async () => {
    if (!state.tour) return;
    if (state.step >= state.tour.steps.length - 1) { stopTour(true); return; }
    state.step++;
    await showStep();
  });
  $("#tPrev").addEventListener("click", async () => {
    if (!state.tour || state.step === 0) return;
    state.step--;
    await showStep();
  });
  $("#tStop").addEventListener("click", () => stopTour(true));
  $("#helpBtn").addEventListener("click", () => { $("#help").hidden = false; });
  $$("[data-close]").forEach((btn) => btn.addEventListener("click", () => { btn.closest(".modal").hidden = true; }));
  $("#panel").addEventListener("click", (event) => {
    const more = event.target.closest(".more-btn");
    if (more) { more.parentElement.classList.add("all"); more.remove(); return; }
    const go = event.target.closest("[data-go]");
    if (go) select(+go.dataset.go, "panel");
  });
  $("#pX").addEventListener("click", () => select(-1, "panel"));
  $("#latestList").addEventListener("click", (event) => {
    const go = event.target.closest("[data-go]");
    if (go) select(+go.dataset.go, "latest");
  });
  $("#fallbackList").addEventListener("click", (event) => {
    const go = event.target.closest("[data-go]");
    if (go) select(+go.dataset.go, "fallback");
  });
  const grab = $("#pGrab");
  let startY = null;
  let startSnap = "";
  grab.addEventListener("pointerdown", (event) => { startY = event.clientY; startSnap = $("#panel").dataset.snap || "peek"; grab.setPointerCapture(event.pointerId); });
  grab.addEventListener("pointerup", (event) => {
    if (startY === null) return;
    const dy = event.clientY - startY;
    startY = null;
    const panel = $("#panel");
    if (Math.abs(dy) < 8) panel.dataset.snap = startSnap === "full" ? "peek" : "full";
    else if (dy < -30) panel.dataset.snap = "full";
    else if (startSnap === "full") panel.dataset.snap = "peek";
    else select(-1, "panel");
  });
  addEventListener("keydown", (event) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (event.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") { event.preventDefault(); $("#q").focus(); }
    if (event.key === "Escape") {
      const modal = $(".modal:not([hidden])");
      if (modal) { modal.hidden = true; return; }
      if (!$("#tour").hidden) { stopTour(true); return; }
      if (!$("#tourPop").hidden) { $("#tourPop").hidden = true; return; }
      if (state.sel >= 0) { select(-1, "key"); return; }
    }
    if ((event.key === "h" || event.key === "H") && tag !== "INPUT" && tag !== "TEXTAREA") goHome();
  });
  addEventListener("popstate", () => applyHash(false));
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  if (media.addEventListener) media.addEventListener("change", () => setMotion(media.matches));
}

async function reload() {
  const btn = $("#reloadBtn");
  btn.disabled = true;
  const previous = state.model.meta.updated;
  try {
    const live = await fetchLive();
    const check = validateGraph(live.data);
    if (!check.ok) throw new Error(check.errors.join(" "));
    await writeCache(live.text);
    const nextN = live.data.nodes.length;
    const nextE = live.data.edges.length;
    if (live.data.meta.updated === previous && nextN === state.model.nodes.length && nextE === state.model.edges.length) {
      banner("ok", `Already showing the public graph from ${escapeHtml(formatUpdated(previous))} (${nextN.toLocaleString("en-US")} entities, ${nextE.toLocaleString("en-US")} connections).`);
    } else {
      banner("ok", "A newer public graph is available. Reloading this preview…");
      location.reload();
      return;
    }
  } catch (error) {
    banner("err", `Could not refresh graph.json. Still showing ${escapeHtml(formatUpdated(state.model.meta.updated))}. ${escapeHtml(error.message || String(error))}`);
  } finally {
    btn.disabled = false;
  }
}

function applyHash(fly) {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const tour = hash.get("tour");
  if (tour && toursFor(state.model).some((item) => item.id === tour)) {
    startTour(tour);
    return;
  }
  const id = hash.get("node");
  if (id && state.model.idx.has(id)) select(state.model.idx.get(id), fly ? "hash" : "hash");
}

function showDataStatus() {
  const m = state.model;
  if (state.source === "cache") {
    const when = state.savedAt ? formatUpdated(state.savedAt) : "an earlier visit";
    banner("err", `The live public graph could not be loaded (${escapeHtml(state.loadError)}). Showing the copy saved in this browser on ${escapeHtml(when)}. It may be older than <a href="../graph.json">graph.json</a>.`);
  }
  if (m.warnings.length) {
    const note = $("#warns");
    note.hidden = false;
    note.textContent = m.warnings.slice(0, 3).join(" ");
  }
}

async function main() {
  bindSearch();
  bindChrome();
  setMotion(reducedMotion());
  setBoot("Loading the public graph…", false);
  let loaded;
  try {
    loaded = await loadGraph();
  } catch (error) {
    console.error(error);
    const schema = error.schema ? " The file did not match the map schema." : "";
    setBoot(`<p>The public graph did not load.</p><p>${escapeHtml(error.message || String(error))}${escapeHtml(schema)}</p><button type="button" id="retry">Try again</button>`, true);
    $("#retry").addEventListener("click", () => location.reload());
    state.mode = "error";
    return;
  }
  try {
    state.model = createModel(loaded.data);
  } catch (error) {
    setBoot(`<p>The public graph failed schema checks.</p><p>${escapeHtml(error.message || String(error))}</p>`, true);
    state.mode = "error";
    return;
  }
  state.source = loaded.source;
  state.dataHref = loaded.href || "";
  state.savedAt = loaded.savedAt || "";
  state.loadError = loaded.loadError || "";
  paintCounts();
  const searchPlaceholder = () => {
    const n = state.model.nodes.length.toLocaleString("en-US");
    $("#q").placeholder = innerWidth < 980 ? "Search" : `Search ${n} entities`;
  };
  searchPlaceholder();
  addEventListener("resize", () => { searchPlaceholder(); placeChrome(); });
  syncFilterButtons();
  renderTours();
  renderLatest();
  showDataStatus();
  $("#boot").hidden = true;
  document.body.classList.add("ready");
  await startSpace();
  placeChrome();
  if (!/node=|tour=/.test(location.hash)) await fitGalaxy(1);
  applyHash(true);
}

main();
