/**
 * Pure graph helpers for the Space preview.
 * The public map's graph.json is the only data source. Positions are computed
 * here so a new publish shows up on refresh without rebuilding this page.
 */

export const GRADES = ["A", "B", "C", "X"];
export const SIDES = ["supports", "neutral", "contradicts"];
export const CENTER_IDS = ["xrp", "ripple", "xrpl"];

export const GRADE_TEXT = {
  A: "Primary or official source",
  B: "Reputable reporting",
  C: "Unverified claim",
  X: "Checked and found false",
};

export const SIDE_TEXT = {
  supports: "Adoption: supports",
  neutral: "Adoption: not about adoption",
  contradicts: "Adoption: contradicts",
};

export const SIDE_HINT = {
  supports: "This connection is also evidence that supports XRP or Ripple payment-rail adoption.",
  neutral: "This is a connection only. It does not say whether adoption is happening.",
  contradicts: "This connection is evidence against XRP or Ripple payment-rail adoption.",
};

const TYPE_SECTOR = {
  person: "people",
  bank: "banks",
  regulator: "regulators",
  etf: "etfs",
  builder: "builders",
  community: "lore",
  riddle: "lore",
  event: "macro",
  asset: "rlusd",
  company: "payments",
};

const SECTOR_ORDER = [
  "founders", "people", "acq", "banks", "payments", "rlusd", "builders",
  "lore", "etfs", "regulators", "macro", "nda", "claims", "other",
];

const SECTOR_META = {
  founders: ["Founders & early investors", "#7aa2ff"],
  people: ["Ripple people", "#8eb4ff"],
  acq: ["Ripple acquisitions", "#b9a2ff"],
  banks: ["Banks & payment partners", "#3dce9a"],
  payments: ["Payments & rails", "#2eb8a8"],
  rlusd: ["RLUSD & stablecoins", "#e6c15a"],
  builders: ["XRPL builders", "#3ec7e0"],
  lore: ["Community & lore", "#c79bff"],
  etfs: ["ETFs & institutions", "#f0c14a"],
  regulators: ["Regulators & government", "#f08a8a"],
  macro: ["Markets & events", "#f0a36a"],
  nda: ["NDA counterparties", "#9aa8c7"],
  claims: ["Claims & debunked", "#ef6b6b"],
  other: ["Other public entities", "#93a0bd"],
  center: ["Core", "#e6c15a"],
};

const GRADE_RANK = { A: 0, B: 1, C: 2, X: 3 };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

export function safeUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function hostOf(value) {
  const url = safeUrl(value);
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function hash01(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function formatUpdated(iso) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return iso ? String(iso) : "unknown";
  const when = new Date(t).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${when} ET`;
}

/**
 * Hard failures mean the file is not a usable public graph.
 * Warnings are records we skip or coerce; the rest still renders.
 */
export function validateGraph(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["Graph file is not a JSON object."], warnings };
  }
  if (!data.meta || typeof data.meta.updated !== "string" || !data.meta.updated.trim()) {
    errors.push("meta.updated is missing, so the page cannot show when the map was last built.");
  }
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) errors.push("nodes must be a non-empty array.");
  if (!Array.isArray(data.edges)) errors.push("edges must be an array.");
  if (errors.length) return { ok: false, errors, warnings };

  const ids = new Set();
  let badNodes = 0;
  for (const node of data.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || typeof node.label !== "string" || !node.label) {
      badNodes++;
      continue;
    }
    if (ids.has(node.id)) errors.push(`Duplicate node id “${node.id}”.`);
    ids.add(node.id);
  }
  if (badNodes) warnings.push(`${badNodes} nodes skipped (missing id or label).`);
  if (ids.size === 0) errors.push("No usable nodes.");
  if (errors.length) return { ok: false, errors, warnings };

  let badEdges = 0;
  for (const edge of data.edges) {
    if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string" || typeof edge.label !== "string") {
      badEdges++;
      continue;
    }
    if (!ids.has(edge.from) || !ids.has(edge.to)) badEdges++;
  }
  if (badEdges) warnings.push(`${badEdges} connections skipped (incomplete record or unknown endpoint).`);
  if (data.edges.length && badEdges / data.edges.length > 0.2) {
    errors.push("More than 20% of connections failed schema checks.");
  }
  return { ok: errors.length === 0, errors, warnings };
}

function sectorTitle(id) {
  return (SECTOR_META[id] && SECTOR_META[id][0]) || id.replace(/[-_]/g, " ");
}

function sectorColor(id) {
  if (SECTOR_META[id]) return SECTOR_META[id][1];
  const h = Math.round(hash01(id) * 360);
  return `hsl(${h} 42% 68%)`;
}

function assignSectors(nodes, rawEdges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of rawEdges) {
    if (!edge || !byId.has(edge.from) || !byId.has(edge.to)) continue;
    neighbors.get(edge.from).push(edge.to);
    neighbors.get(edge.to).push(edge.from);
  }
  for (const node of nodes) {
    if (typeof node.sector === "string" && node.sector.trim()) node.sec = node.sector.trim();
    else if (node.grade === "X") node.sec = "claims";
    else node.sec = "";
  }
  const ordered = nodes.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let pass = 0; pass < 4; pass++) {
    for (const node of ordered) {
      if ((typeof node.sector === "string" && node.sector.trim()) || node.grade === "X") continue;
      const counts = new Map();
      for (const id of neighbors.get(node.id)) {
        const sec = byId.get(id).sec;
        if (!sec || sec === "other" || sec === "center") continue;
        counts.set(sec, (counts.get(sec) || 0) + 1);
      }
      if (!counts.size) continue;
      let best = "";
      let bestN = -1;
      for (const [sec, n] of counts) {
        if (n > bestN || (n === bestN && sec < best)) {
          best = sec;
          bestN = n;
        }
      }
      node.sec = best;
    }
  }
  for (const node of nodes) {
    if (!node.sec) node.sec = TYPE_SECTOR[node.type] || "other";
  }
  for (const id of CENTER_IDS) {
    const node = byId.get(id);
    if (node) node.sec = "center";
  }
}

function layoutNodes(nodes) {
  const pins = {
    xrp: [0, 0, 40],
    ripple: [-260, 150, 120],
    xrpl: [210, -130, 200],
  };
  const groups = new Map();
  for (const node of nodes) {
    if (pins[node.id]) {
      const [x, y, z] = pins[node.id];
      node.x = x;
      node.y = y;
      node.z = z;
      continue;
    }
    if (!groups.has(node.sec)) groups.set(node.sec, []);
    groups.get(node.sec).push(node);
  }
  const known = SECTOR_ORDER.filter((id) => groups.has(id));
  const extra = [...groups.keys()].filter((id) => !known.includes(id)).sort();
  const order = known.concat(extra);
  const sectors = [];
  const shell = 1760;
  order.forEach((id, index) => {
    const list = groups.get(id).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const elev = (index + 0.5) / order.length * 2 - 1;
    const ring = Math.sqrt(Math.max(0.08, 1 - elev * elev));
    const az = -Math.PI / 2 + (index / order.length) * Math.PI * 2;
    const reach = id === "claims" ? shell * 1.22 : shell;
    const cx = Math.cos(az) * ring * reach;
    const cy = Math.sin(az) * ring * reach;
    const cz = elev * shell * 1.05;
    const spread = 150 + Math.sqrt(list.length) * 26;
    list.forEach((node) => {
      const hub = Math.min(1, Math.log2(1 + node.deg) / 7);
      const local = spread * (0.28 + 0.72 * (1 - hub * 0.75)) * (0.45 + 0.55 * hash01(node.id + ":r"));
      const phi = hash01(node.id + ":p") * Math.PI * 2;
      const lift = hash01(node.id + ":z") * 2 - 1;
      const ring2 = Math.sqrt(Math.max(0, 1 - lift * lift));
      node.x = cx + Math.cos(phi) * ring2 * local;
      node.y = cy + Math.sin(phi) * ring2 * local;
      node.z = cz + lift * local;
    });
    sectors.push({
      id,
      title: sectorTitle(id),
      color: sectorColor(id),
      a0: az - Math.PI / order.length,
      a1: az + Math.PI / order.length,
      r0: Math.max(200, reach - spread),
      r1: reach + spread,
      n: list.length,
    });
  });
  return sectors;
}

/** Place an entity's real neighbors on a 3D shell around it so the lines can be read.
 *  This does not add or remove connections. Leaving the selection restores galaxy positions.
 */
export function shellAround(origin, neighbors) {
  const list = neighbors.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const n = list.length;
  const radius = n > 80 ? 980 : n > 16 ? 760 : 560;
  const golden = Math.PI * (3 - Math.sqrt(5));
  return list.map((node, i) => {
    const lift = n === 0 ? 0 : 1 - ((i + 0.5) / n) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - lift * lift));
    const theta = i * golden;
    const rad = radius * (0.94 + 0.08 * hash01(node.id));
    return {
      i: node.i,
      x: origin.x + Math.cos(theta) * ring * rad,
      y: origin.y + Math.sin(theta) * ring * rad,
      z: origin.z + lift * rad,
    };
  });
}

export function createModel(data) {
  const check = validateGraph(data);
  if (!check.ok) {
    const error = new Error(check.errors.join(" "));
    error.errors = check.errors;
    error.warnings = check.warnings;
    throw error;
  }
  const warnings = check.warnings.slice();
  const kept = [];
  const seen = new Set();
  for (const raw of data.nodes) {
    if (!raw || typeof raw.id !== "string" || !raw.id || typeof raw.label !== "string" || !raw.label) continue;
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    kept.push({
      id: raw.id,
      label: raw.label,
      short: typeof raw.short === "string" ? raw.short : "",
      handle: typeof raw.handle === "string" ? raw.handle : "",
      summary: typeof raw.summary === "string" ? raw.summary : "",
      why: typeof raw.why === "string" ? raw.why : "",
      type: typeof raw.type === "string" ? raw.type : "company",
      grade: GRADES.includes(raw.grade) ? raw.grade : "",
      sources: Array.isArray(raw.sources) ? raw.sources.filter((s) => typeof s === "string") : [],
      added: typeof raw.added === "string" ? raw.added : "",
      sector: typeof raw.sector === "string" ? raw.sector : "",
      deg: 0,
    });
  }
  kept.sort((a, b) => (a.id < b.id ? -1 : 1));
  kept.forEach((node, i) => {
    node.i = i;
    node.addedT = Date.parse(node.added) || 0;
    node.lbl = (node.short || node.label).length > 28 ? `${(node.short || node.label).slice(0, 26)}…` : (node.short || node.label);
    node.search = `${node.label} ${node.short} ${node.handle} ${node.id}`.toLowerCase();
    });
  const ungraded = kept.filter((node) => !node.grade).length;
  if (ungraded) warnings.push(`${ungraded} entities have no usable grade.`);
  const idx = new Map(kept.map((node) => [node.id, node.i]));
  assignSectors(kept, Array.isArray(data.edges) ? data.edges : []);

  const edges = [];
  const seenEdge = new Set();
  let unknownSide = 0;
  let droppedGrade = 0;
  for (const raw of data.edges || []) {
    if (!raw || typeof raw.from !== "string" || typeof raw.to !== "string" || typeof raw.label !== "string") continue;
    const a = idx.get(raw.from);
    const b = idx.get(raw.to);
    if (a === undefined || b === undefined || a === b) continue;
    const grade = GRADES.includes(raw.grade) ? raw.grade : "";
    if (!grade) { droppedGrade++; continue; }
    const side = SIDES.includes(raw.side) ? raw.side : "neutral";
    if (raw.side && !SIDES.includes(raw.side)) unknownSide++;
    const key = `${raw.from}\0${raw.to}\0${raw.label}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    const edge = {
      j: edges.length,
      from: raw.from,
      to: raw.to,
      a,
      b,
      label: raw.label,
      grade,
      side,
      strength: Number.isFinite(raw.strength) ? Math.max(1, Math.min(5, raw.strength)) : 2,
      key: raw.key === true,
      source: typeof raw.source === "string" ? raw.source : "",
      added: typeof raw.added === "string" ? raw.added : "",
      addedT: Date.parse(raw.added) || 0,
      bad: false,
    };
    edges.push(edge);
    kept[a].deg++;
    kept[b].deg++;
  }
  if (droppedGrade) warnings.push(`${droppedGrade} connections skipped (missing grade).`);
  if (unknownSide) warnings.push(`${unknownSide} connections had an unknown adoption side and are shown as not about adoption.`);
  edges.forEach((edge, j) => { edge.j = j; });
  const sectors = layoutNodes(kept);
  const adj = kept.map(() => []);
  for (const edge of edges) {
    adj[edge.a].push(edge.j);
    adj[edge.b].push(edge.j);
  }
  const model = {
    meta: { updated: data.meta.updated, version: data.meta.version },
    nodes: kept,
    edges,
    sectors,
    sectorById: Object.fromEntries(sectors.map((s) => [s.id, s])),
    idx,
    adj,
    warnings,
    vn: new Uint8Array(kept.length),
    ve: new Uint8Array(edges.length),
    countN: 0,
    countE: 0,
    filters: defaultFilters(),
  };
  applyFilters(model);
  return model;
}

export function defaultFilters() {
  return {
    key: true,
    grades: new Set(GRADES),
    sides: new Set(SIDES),
  };
}

export function applyFilters(model, patch) {
  if (patch) {
    if (patch.key !== undefined) model.filters.key = !!patch.key;
    if (patch.grades) model.filters.grades = patch.grades;
    if (patch.sides) model.filters.sides = patch.sides;
  }
  const { key, grades, sides } = model.filters;
  const showUnknownGrade = grades.size === GRADES.length;
  const incident = new Int32Array(model.nodes.length);
  for (const edge of model.edges) {
    const gradeOk = grades.has(edge.grade) || (showUnknownGrade && !GRADES.includes(edge.grade));
    const sideOk = sides.has(edge.side);
    const keyOk = !key || edge.key === true;
    const on = gradeOk && sideOk && keyOk;
    model.ve[edge.j] = on ? 1 : 0;
    if (on) {
      incident[edge.a]++;
      incident[edge.b]++;
    }
  }
  let countN = 0;
  let countE = 0;
  for (let i = 0; i < model.nodes.length; i++) {
    const node = model.nodes[i];
    const hub = key && CENTER_IDS.includes(node.id);
    const orphan = !key && node.deg === 0;
    const on = incident[i] > 0 || hub || orphan;
    model.vn[i] = on ? 1 : 0;
    if (on) countN++;
  }
  for (let j = 0; j < model.edges.length; j++) {
    if (model.ve[j] && model.vn[model.edges[j].a] && model.vn[model.edges[j].b]) countE++;
    else model.ve[j] = 0;
  }
  model.countN = countN;
  model.countE = countE;
  return model;
}

export function toggleGrade(model, grade) {
  const current = model.filters.grades;
  const next = new Set(current.size === GRADES.length ? [] : current);
  if (next.has(grade)) next.delete(grade);
  else next.add(grade);
  applyFilters(model, { grades: next.size ? next : new Set(GRADES) });
}

export function toggleSide(model, side) {
  const current = model.filters.sides;
  const next = new Set(current.size === SIDES.length ? [] : current);
  if (next.has(side)) next.delete(side);
  else next.add(side);
  applyFilters(model, { sides: next.size ? next : new Set(SIDES) });
}

export function searchNodes(model, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const node of model.nodes) {
    const label = node.label.toLowerCase();
    let score = -1;
    if (label === q || node.id === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if ((node.short || "").toLowerCase().startsWith(q) || (node.handle || "").toLowerCase().replace("@", "").startsWith(q.replace("@", ""))) score = 70;
    else if (label.split(/[\s(/-]+/).some((part) => part.startsWith(q))) score = 60;
    else if (node.search.includes(q)) score = 45;
    else if (q.length > 3 && node.summary.toLowerCase().includes(q)) score = 15;
    if (score >= 0) hits.push([score + Math.min(18, Math.log2(1 + node.deg) * 2.5), node]);
  }
  hits.sort((a, b) => b[0] - a[0] || (a[1].id < b[1].id ? -1 : 1));
  return hits.slice(0, limit).map((hit) => hit[1]);
}

export function edgesOf(model, index) {
  return model.adj[index].map((j) => model.edges[j]);
}

function betterEdge(a, b) {
  if (!b) return true;
  if ((a.key === true) !== (b.key === true)) return a.key === true;
  if (GRADE_RANK[a.grade] !== GRADE_RANK[b.grade]) return GRADE_RANK[a.grade] < GRADE_RANK[b.grade];
  return (a.strength || 0) > (b.strength || 0);
}

export function bestEdge(model, from, to) {
  const a = model.idx.get(from);
  const b = model.idx.get(to);
  if (a === undefined || b === undefined) return null;
  let found = null;
  for (const j of model.adj[a]) {
    const edge = model.edges[j];
    if (edge.a === b || edge.b === b) {
      if (betterEdge(edge, found)) found = edge;
    }
  }
  return found;
}

function edgeStep(model, edge, focusId) {
  const focus = model.idx.get(focusId);
  const A = model.nodes[edge.a];
  const B = model.nodes[edge.b];
  return {
    title: `${A.label} → ${B.label}`,
    caption: `${A.label} → ${B.label}. Connection: ${edge.label}. Source grade ${edge.grade} (${GRADE_TEXT[edge.grade]}). ${SIDE_TEXT[edge.side]}.`,
    source: edge.source,
    focus: focus === undefined ? edge.a : focus,
    path: [{ a: edge.a, b: edge.b }],
    group: [edge.a, edge.b],
  };
}

function nodeStep(model, id) {
  const i = model.idx.get(id);
  if (i === undefined) return null;
  const node = model.nodes[i];
  const text = (node.why || node.summary || "").replace(/\s+/g, " ").trim();
  const clip = text.length > 280 ? `${text.slice(0, 277)}…` : text;
  return {
    title: node.label,
    caption: clip
      ? `${node.label}. Source grade ${node.grade || "—"} (${GRADE_TEXT[node.grade] || "not graded"}). ${clip}`
      : `${node.label}. Source grade ${node.grade || "—"}. No summary is stored on this entity.`,
    source: (node.sources || []).find((s) => safeUrl(s)) || "",
    focus: i,
    path: [],
    group: [i],
  };
}

function pairTour(model, id, title, blurb, pairs) {
  const steps = [];
  for (const [from, to, focus] of pairs) {
    const edge = bestEdge(model, from, to);
    if (!edge) continue;
    steps.push(edgeStep(model, edge, focus || to));
  }
  if (steps.length < 3) return null;
  return { id, title, blurb, steps };
}

function adoptionTour(model) {
  const picked = [];
  const used = new Set();
  for (const side of SIDES) {
    let found = null;
    for (const edge of model.edges) {
      if (edge.side !== side || used.has(edge.j)) continue;
      if (betterEdge(edge, found)) found = edge;
    }
    if (!found) continue;
    used.add(found.j);
    const focus = model.nodes[found.a].deg >= model.nodes[found.b].deg ? found.from : found.to;
    picked.push(edgeStep(model, found, focus));
  }
  if (picked.length < 2) return null;
  return {
    id: "adoption",
    title: "Connection or adoption?",
    blurb: "Three current links, when the graph has them: one that supports adoption, one that does not address it, and one that contradicts it.",
    steps: picked,
  };
}

export function toursFor(model) {
  const tours = [];
  const overview = {
    title: "Whole graph",
    caption: `${model.nodes.length.toLocaleString("en-US")} entities and ${model.edges.length.toLocaleString("en-US")} connections are in the graph loaded for this view. Updated ${model.meta.updated}.`,
    focus: -1,
    path: [],
    group: [],
    overview: true,
  };
  const galaxySteps = [overview];
  for (const id of CENTER_IDS) {
    const step = nodeStep(model, id);
    if (step) galaxySteps.push(step);
  }
  for (const id of ["banks", "regulators", "etfs", "builders"]) {
    const sector = model.sectorById[id];
    if (!sector || sector.n < 3) continue;
    galaxySteps.push({
      title: sector.title,
      caption: `${sector.title}: ${sector.n.toLocaleString("en-US")} entities in this group on the loaded graph. Grouping uses each entity’s sector when the public graph has one, otherwise the sectors of its connections.`,
      sector: id,
      focus: -1,
      path: [],
      group: [],
    });
  }
  if (galaxySteps.length >= 3) {
    tours.push({
      id: "galaxy",
      title: "Look around",
      blurb: "A short path across the loaded public graph. Captions are the graph’s own wording.",
      steps: galaxySteps,
    });
  }
  const adoption = adoptionTour(model);
  if (adoption) tours.push(adoption);
  const stack = pairTour(model, "stack", "Ripple stack links", "Only pairs that exist in the graph loaded just now.", [
    ["ripple", "rlusd", "rlusd"],
    ["sctc", "rlusd", "sctc"],
    ["bny", "rlusd", "bny"],
    ["bny", "xrp", "bny"],
    ["ripple", "rprime", "rprime"],
  ]);
  if (stack) tours.push(stack);
  const xmoney = pairTour(model, "xmoney", "X Money links in this graph", "Steps appear only when that exact pair is in the loaded graph.", [
    ["musk", "xmoney", "xmoney"],
    ["visa", "xmoney", "visa"],
    ["crossriver", "xmoney", "crossriver"],
    ["crossriver", "rlusd", "crossriver"],
    ["crossriver", "xrpl", "crossriver"],
  ]);
  if (xmoney) tours.push(xmoney);
  return tours;
}

export function latestEdges(model, limit = 8) {
  return model.edges
    .filter((edge) => edge.addedT)
    .slice()
    .sort((a, b) => b.addedT - a.addedT || a.j - b.j)
    .slice(0, limit);
}

export function adoptionTally(edges) {
  const tally = { supports: 0, neutral: 0, contradicts: 0 };
  for (const edge of edges) tally[edge.side] = (tally[edge.side] || 0) + 1;
  return tally;
}
