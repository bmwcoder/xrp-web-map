import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyFilters, bestEdge, createModel, defaultFilters, edgesOf, searchNodes, shellAround, toursFor, validateGraph,
} from "../js/graph.js";

const live = JSON.parse(readFileSync(new URL("../../graph.json", import.meta.url), "utf8"));

test("live public graph matches the last verified stamp and counts", () => {
  assert.equal(live.meta.updated, "2026-11-11T08:25:56-05:00");
  assert.equal(live.nodes.length, 2371);
  assert.equal(live.edges.length, 6704);
  const check = validateGraph(live);
  assert.equal(check.ok, true, check.errors.join("; "));
});

test("model keeps every current entity and connection", () => {
  const model = createModel(live);
  assert.equal(model.nodes.length, 2371);
  assert.equal(model.edges.length, 6704);
  assert.equal(model.meta.updated, live.meta.updated);
  assert.equal(model.warnings.length, 0);
  for (const node of model.nodes) {
    assert.equal(Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z), true, node.id);
    assert.ok(node.sec);
  }
  const again = createModel(live);
  for (let i = 0; i < model.nodes.length; i++) {
    assert.equal(again.nodes[i].id, model.nodes[i].id);
    assert.equal(again.nodes[i].x, model.nodes[i].x);
    assert.equal(again.nodes[i].y, model.nodes[i].y);
    assert.equal(again.nodes[i].z, model.nodes[i].z);
  }
});

test("default view is key connections and counts are computed", () => {
  const model = createModel(live);
  assert.equal(model.filters.key, true);
  assert.ok(model.countE > 40 && model.countE < 140);
  assert.ok(model.countN > model.countE / 4);
  assert.ok(model.countN < model.nodes.length);
  assert.equal(model.edges.filter((e) => e.key).length, model.countE);
});

test("search finds XRP and does not invent a hit", () => {
  const model = createModel(live);
  const hits = searchNodes(model, "xrp", 5);
  assert.equal(hits[0].id, "xrp");
  assert.equal(searchNodes(model, "zzzz-not-an-entity", 5).length, 0);
});

test("tours only cite pairs that exist and keep adoption distinct", () => {
  const model = createModel(live);
  const tours = toursFor(model);
  const ids = tours.map((tour) => tour.id);
  assert.ok(ids.includes("galaxy"));
  assert.ok(ids.includes("adoption"));
  for (const tour of tours) {
    assert.ok(tour.steps.length >= 2);
    const sides = new Set();
    for (const step of tour.steps) {
      for (const pair of step.path || []) {
        const edge = model.edges.find((item) => item.a === pair.a && item.b === pair.b || item.a === pair.b && item.b === pair.a);
        assert.ok(edge, `${tour.id} missing pair`);
        if (tour.id === "adoption") sides.add(edge.side);
      }
      if (step.focus >= 0) assert.ok(model.nodes[step.focus]);
    }
    if (tour.id === "adoption") {
      assert.ok(sides.has("supports"));
      assert.ok(sides.has("contradicts"));
      assert.equal(sides.has("neutral"), true);
    }
  }
  const broken = createModel({
    meta: { updated: "2026-11-11T00:00:00-05:00" },
    nodes: [
      { id: "a", label: "A", type: "company", grade: "A" },
      { id: "b", label: "B", type: "company", grade: "A" },
    ],
    edges: [{ from: "a", to: "b", label: "linked", grade: "A", side: "neutral", key: true }],
  });
  assert.equal(toursFor(broken).some((tour) => tour.id === "xmoney" || tour.id === "stack"), false);
});

test("a removed X Money edge drops that step rather than inventing it", () => {
  const copy = structuredClone(live);
  copy.edges = copy.edges.filter((edge) => !(
    (edge.from === "musk" && edge.to === "xmoney") || (edge.from === "xmoney" && edge.to === "musk")
  ));
  const model = createModel(copy);
  assert.equal(bestEdge(model, "musk", "xmoney"), null);
  const tour = toursFor(model).find((item) => item.id === "xmoney");
  if (tour) {
    assert.equal(tour.steps.some((step) => /Musk/.test(step.title) && /X Money/.test(step.title)), false);
  }
});

test("schema failures are explicit", () => {
  assert.equal(validateGraph(null).ok, false);
  assert.equal(validateGraph({ nodes: [], edges: [] }).ok, false);
  assert.equal(validateGraph({ meta: { updated: "t" }, nodes: [{ id: "a", label: "A" }, { id: "a", label: "B" }], edges: [] }).ok, false);
  const loose = createModel({
    meta: { updated: "2026-11-11T00:00:00-05:00" },
    nodes: [
      { id: "a", label: "A", type: "bank", grade: "B" },
      { id: "b", label: "B", grade: "A" },
      { id: "c", label: "C", grade: "A" },
    ],
    edges: [
      { from: "a", to: "b", label: "knows", grade: "A" },
      { from: "b", to: "c", label: "funds", grade: "B", side: "supports" },
      { from: "a", to: "c", label: "meets", grade: "A", side: "contradicts" },
      { from: "c", to: "a", label: "cites", grade: "C", side: "neutral" },
      { from: "a", to: "b", label: "again", grade: "A", side: "neutral" },
      { from: "a", to: "missing", label: "nope", grade: "A", side: "supports" },
      { from: "a", to: "b", label: "odd", grade: "A", side: "sideways" },
    ],
  });
  assert.equal(loose.edges.length, 6);
  assert.equal(loose.edges.find((edge) => edge.label === "knows").side, "neutral");
  assert.equal(loose.edges.find((edge) => edge.label === "odd").side, "neutral");
  assert.ok(loose.warnings.length >= 1);
});

test("galaxy has vertical depth and a selection shell only moves real neighbors", () => {
  const model = createModel(live);
  const zs = model.nodes.map((node) => node.z);
  assert.ok(Math.max(...zs) - Math.min(...zs) > 1200);
  const xrp = model.nodes[model.idx.get("xrp")];
  const neighbors = edgesOf(model, xrp.i).map((edge) => model.nodes[edge.a === xrp.i ? edge.b : edge.a]);
  const shell = shellAround(xrp, neighbors);
  assert.equal(shell.length, neighbors.length);
  assert.deepEqual(new Set(shell.map((point) => point.i)), new Set(neighbors.map((node) => node.i)));
  const shellZ = shell.map((point) => point.z);
  assert.ok(Math.max(...shellZ) - Math.min(...shellZ) > 400);
  const again = shellAround(xrp, neighbors);
  assert.equal(again[0].x, shell[0].x);
  assert.equal(again[0].z, shell[0].z);
});

test("key filter can be cleared without changing totals", () => {
  const model = createModel(live);
  applyFilters(model, { key: false });
  assert.equal(model.countN, model.nodes.filter((node) => node.deg > 0).length);
  assert.equal(model.countE, model.edges.length);
  applyFilters(model, defaultFilters());
  assert.equal(model.filters.key, true);
});
