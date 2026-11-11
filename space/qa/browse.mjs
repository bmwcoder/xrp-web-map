/**
 * Browser QA for the Space preview. Not part of the page.
 *   cd /tmp && npm install playwright-core
 *   node /workspace/space/qa/browse.mjs http://127.0.0.1:8765
 *
 * Uses the system Chrome. Set CHROME to override the binary.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright-core";

const base = process.argv[2] || "http://127.0.0.1:8765";
const chrome = process.env.CHROME || "/usr/local/bin/google-chrome";
const out = process.env.SHOTS || "/tmp/space-qa";
mkdirSync(out, { recursive: true });

const problems = [];
function check(name, ok, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  console.log(line);
  if (!ok) problems.push(line);
}

function attach(page, bucket) {
  page.on("pageerror", (err) => bucket.errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") bucket.errors.push(msg.text());
    if (msg.type() === "warning") bucket.warnings.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (url.includes("graph.json") || url.includes("/space/")) bucket.failed.push(`${url} ${req.failure()?.errorText || ""}`);
  });
}

async function settle(page) {
  await page.waitForFunction(() => window.__spacePreview && window.__spacePreview.ready, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function readPreview(page) {
  return page.evaluate(() => {
    const p = window.__spacePreview;
    return {
      mode: p.mode,
      meta: p.meta,
      counts: p.counts,
      fps: p.fps,
      renderer: p.renderer,
      software: p.software,
      motionOff: p.motionOff,
      selected: p.selected,
      tours: p.tours,
      source: p.source,
      warnings: p.warnings,
    };
  });
}

function ocr(file) {
  try { return execFileSync("tesseract", [file, "stdout", "--psm", "6"], { encoding: "utf8" }); }
  catch { return ""; }
}

async function fps(page) {
  await page.waitForTimeout(1500);
  return page.evaluate(() => window.__spacePreview.fps);
}

async function inspectXrp(page) {
  await page.fill("#q", "xrp");
  await page.waitForSelector("#results button");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#panel:not([hidden]) h2");
  const text = await page.locator("#pBody").innerText();
  const href = await page.locator("#pBody a.src").first().getAttribute("href");
  const title = await page.locator("#pTitle").innerText();
  return { text, href, title };
}

async function runProfile(browser, name, contextOptions, path) {
  const bucket = { errors: [], warnings: [], failed: [] };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  attach(page, bucket);
  const t0 = Date.now();
  await page.goto(`${base}/space/`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const boot = Date.now() - t0;
  const info = await readPreview(page);
  check(`${name} ready`, info.mode === "webgl", info.mode);
  check(`${name} live graph`, info.source === "live" && info.meta.updated === "2026-11-11T08:25:56-05:00", `${info.source} ${info.meta && info.meta.updated}`);
  check(`${name} counts`, info.counts.nodes === 2371 && info.counts.edges === 6704 && info.counts.shownE === 91, JSON.stringify(info.counts));
  check(`${name} updated visible`, (await page.locator("#updated").innerText()).includes("2026"), await page.locator("#updated").innerText());
  await page.screenshot({ path: `${out}/${path}-home.png` });
  const homeFill = await page.evaluate(() => {
    const space = window.__spacePreview.engine;
    const model = space.s;
    const pts = [];
    for (const node of model.nodes) {
      if (!model.vn[node.i]) continue;
      const projected = space.nodeVec(node.i).clone().project(space.camera);
      if (projected.z < 1) pts.push([(projected.x + 1) / 2 * space.w, (1 - projected.y) / 2 * space.h]);
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { width: Math.max(...xs) - Math.min(...xs), view: space.w };
  });
  check(`${name} home graph fills the view`, homeFill.width > homeFill.view * 0.45, `${Math.round(homeFill.width)}/${Math.round(homeFill.view)}`);
  if (name === "phone") {
    const clipped = await page.evaluate(() => {
      const brand = document.querySelector(".brand").getBoundingClientRect();
      const home = document.querySelector("#homeBtn").getBoundingClientRect();
      return !(home.right <= brand.left || home.left >= brand.right || home.bottom <= brand.top || home.top >= brand.bottom);
    });
    check(`${name} Home is not under the brand`, !clipped);
  }
  const narrow = (page.viewportSize()?.width || 1000) < 760;
  if (narrow) {
    const header = await page.locator("#top").evaluate((el) => el.getBoundingClientRect().height);
    const filtersDisplay = await page.locator("#filters").evaluate((el) => getComputedStyle(el).display);
    check(`${name} header stays compact`, header < 170, `${Math.round(header)}px`);
    check(`${name} filters start closed`, filtersDisplay === "none", filtersDisplay);
    await page.click("#filterBtn");
  }
  await page.click("#allBtn");
  await page.waitForFunction(() => window.__spacePreview.counts.shownE === 6704);
  check(`${name} all-connections control`, (await readPreview(page)).counts.shownE === 6704);
  await page.click("#keyBtn");
  await page.waitForFunction(() => window.__spacePreview.counts.shownE === 91 && window.__spacePreview.counts.key === true);
  check(`${name} key-connections control`, (await readPreview(page)).counts.shownE === 91);
  if (narrow) await page.click("#filterBtn");
  await page.click("#pauseBtn");
  check(`${name} pause control`, (await page.locator("#pauseBtn").getAttribute("aria-pressed")) === "true" && (await readPreview(page)).motionOff === true);
  await page.click("#pauseBtn");
  const shot = await inspectXrp(page);
  await page.waitForFunction(() => {
    const view = window.__spacePreview.view;
    return view && view.n > 10 && view.width > 220 && view.height > 120 && view.labels >= 6;
  }, null, { timeout: 8000 });
  const view = await page.evaluate(() => window.__spacePreview.view);
  check(`${name} selected neighborhood has depth`, view.width > 220 && view.height > 120 && view.labels >= 6, JSON.stringify(view));
  check(`${name} selected XRP`, shot.title === "XRP", shot.title);
  check(`${name} grade and adoption copy`, /Primary or official source/.test(shot.text) && /Connections/.test(shot.text) && /Adoption/.test(shot.text), shot.text.slice(0, 180));
  check(`${name} source link`, /^https:\/\//.test(shot.href || ""), shot.href || "");
  if (narrow) check(`${name} sheet leaves the galaxy visible`, view.sheet / view.innerHeight < 0.42, `${Math.round(view.sheet)}/${view.innerHeight}`);
  await page.screenshot({ path: `${out}/${path}-selected.png` });
  if (name === "desktop" || name === "phone") {
    const clip = await page.evaluate(() => {
      const panel = document.querySelector("#panel").getBoundingClientRect();
      const filters = document.querySelector("#filters").getBoundingClientRect();
      const head = document.querySelector("#top").getBoundingClientRect();
      const y = Math.max(head.bottom, filters.height ? filters.bottom : 0) + 4;
      const side = panel.left > window.innerWidth * 0.45;
      const width = side ? panel.left - 8 : window.innerWidth - 8;
      const height = side ? window.innerHeight - y - 48 : panel.top - y - 4;
      return { x: 4, y, width: Math.max(80, width), height: Math.max(80, height) };
    });
    const crop = `${out}/${path}-labels.png`;
    await page.screenshot({ path: crop, clip });
    const text = ocr(crop);
    const wanted = name === "desktop" ? /Bitwise|Evernorth|Santander|DekaBank|XRPL/i : /Bitwise|Evernorth|Santander|BNY|XRPL/i;
    check(`${name} screenshot shows entity names`, wanted.test(text), text.replace(/\s+/g, " ").slice(0, 180));
  }
  await page.click("#pMore");
  await page.waitForSelector("#pBody .srcs a");
  check(`${name} evidence control shows sources`, (await page.locator("#pBody .srcs a").count()) >= 1);
  await page.screenshot({ path: `${out}/${path}-evidence.png` });
  await page.click("#homeBtn");
  await page.waitForTimeout(400);
  check(`${name} home clears selection`, (await page.locator("#panel").getAttribute("hidden")) !== null);
  check(`${name} home restores key view`, (await page.locator("#keyBtn").getAttribute("aria-pressed")) === "true");
  const rate = await fps(page);
  check(`${name} fps`, rate >= 8, String(rate));
  info.fpsAfter = rate;
  info.bootMs = boot;
  info.errors = bucket.errors;
  info.warnings = bucket.warnings.slice(0, 8);
  info.failed = bucket.failed;
  check(`${name} console clean`, bucket.errors.length === 0, bucket.errors.join(" | "));
  if (name === "desktop") {
    await page.click("#reloadBtn");
    await page.waitForFunction(() => /Already showing the public graph/.test(document.querySelector("#banner").textContent));
    check("refresh sees current graph", true, await page.locator("#banner").innerText());
    await page.keyboard.press("Escape");
    await page.locator("#space canvas").focus();
    const moved = await page.evaluate(() => {
      const before = window.__spacePreview.engine.camera.position.clone();
      document.querySelector("#space canvas").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      const after = window.__spacePreview.engine.camera.position;
      return Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    });
    check("desktop arrow orbits", moved > 1, String(Math.round(moved)));
  }
  await context.close();
  return info;
}

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const desktop = await runProfile(browser, "desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, "desktop");
const tablet = await runProfile(browser, "tablet", { ...devices["iPad (gen 7)"], viewport: { width: 810, height: 1080 } }, "tablet");
const phone = await runProfile(browser, "phone", devices["iPhone 13"], "phone");

const reduced = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
const rpage = await reduced.newPage();
const rbucket = { errors: [], warnings: [], failed: [] };
attach(rpage, rbucket);
await rpage.goto(`${base}/space/`, { waitUntil: "domcontentloaded" });
await settle(rpage);
const rinfo = await readPreview(rpage);
check("reduced motion starts paused", rinfo.motionOff === true && (await rpage.locator("#pauseBtn").getAttribute("aria-pressed")) === "true");
await rpage.keyboard.press("/");
check("slash focuses search", await rpage.evaluate(() => document.activeElement && document.activeElement.id === "q"));
await reduced.close();

const tourCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const tour = await tourCtx.newPage();
const tbucket = { errors: [], warnings: [], failed: [] };
attach(tour, tbucket);
await tour.goto(`${base}/space/`, { waitUntil: "domcontentloaded" });
await settle(tour);
await tour.click("#tourBtn");
await tour.click('#tourList button[data-tour="adoption"]');
await tour.waitForFunction(() => {
  const el = document.querySelector("#tCaption");
  return el && /Connection:/.test(el.textContent) && /Adoption:/.test(el.textContent);
});
const cap1 = await tour.locator("#tCaption").innerText();
check("adoption tour caption", /Connection:/.test(cap1) && /Adoption:/.test(cap1), cap1.slice(0, 180));
await tour.click("#tNext");
await tour.waitForFunction((prev) => document.querySelector("#tCaption").textContent !== prev, cap1);
const cap2 = await tour.locator("#tCaption").innerText();
check("adoption tour advances", cap2 !== cap1 && cap2.length > 20, cap2.slice(0, 120));
const moved = await tour.evaluate(() => {
  const cam = window.__spacePreview.engine.camera.position.clone();
  const canvas = window.__spacePreview.engine.renderer.domElement;
  canvas.focus();
  canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  const next = window.__spacePreview.engine.camera.position;
  return Math.hypot(next.x - cam.x, next.y - cam.y, next.z - cam.z) > 1;
});
check("arrow key orbits", moved);
await tour.screenshot({ path: `${out}/desktop-tour.png` });
await tour.click("#tStop");
check("tour ends", await tour.locator("#tour").getAttribute("hidden") !== null);
check("tour console clean", tbucket.errors.length === 0, tbucket.errors.join(" | "));
await tourCtx.close();

const phoneTourCtx = await browser.newContext(devices["iPhone 13"]);
const phoneTour = await phoneTourCtx.newPage();
await phoneTour.goto(`${base}/space/`, { waitUntil: "domcontentloaded" });
await settle(phoneTour);
await phoneTour.click("#tourBtn");
await phoneTour.click('#tourList button[data-tour="adoption"]');
await phoneTour.waitForFunction(() => /Connection:/.test(document.querySelector("#tCaption")?.textContent || "") && /Adoption:/.test(document.querySelector("#tCaption")?.textContent || ""));
check("phone tour caption", /Adoption:/.test(await phoneTour.locator("#tCaption").innerText()));
await phoneTour.screenshot({ path: `${out}/phone-tour.png` });
await phoneTour.click("#tNext");
await phoneTour.click("#tStop");
await phoneTourCtx.close();

await browser.close();

const software = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu"],
});
const sw = await software.newContext({ viewport: { width: 810, height: 1080 }, hasTouch: true, isMobile: true });
const sp = await sw.newPage();
const sbucket = { errors: [], warnings: [], failed: [] };
attach(sp, sbucket);
const t1 = Date.now();
await sp.goto(`${base}/space/`, { waitUntil: "domcontentloaded" });
await settle(sp);
const sboot = Date.now() - t1;
const sinfo = await readPreview(sp);
const sfps = await fps(sp);
await sp.screenshot({ path: `${out}/tablet-swiftshader.png` });
check("swiftshader boots", sinfo.mode === "webgl" || sinfo.mode === "fallback", `${sinfo.mode} fps ${sfps} boot ${sboot}ms renderer ${sinfo.renderer}`);
check("swiftshader console", sbucket.errors.length === 0, sbucket.errors.join(" | "));
await software.close();

const noweb = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--disable-webgl", "--disable-3d-apis"],
});
const nctx = await noweb.newContext({ viewport: { width: 390, height: 844 } });
const np = await nctx.newPage();
const nbucket = { errors: [], warnings: [], failed: [] };
attach(np, nbucket);
await np.goto(`${base}/space/`, { waitUntil: "domcontentloaded" });
await settle(np);
const ninfo = await readPreview(np);
check("no-webgl fallback", ninfo.mode === "fallback", ninfo.mode);
check("fallback still has counts", ninfo.counts.nodes === 2371, JSON.stringify(ninfo.counts));
const hubs = await np.locator("#fallbackList button").count();
check("fallback lists entities before search", hubs > 0, String(hubs));
await np.locator("#fallbackList button").first().click({ force: true });
await np.waitForSelector("#panel:not([hidden])");
await np.click("#pX");
await np.fill("#q", "BNY");
await np.waitForSelector("#results button");
const listed = await np.locator("#results button").count();
check("fallback search lists entities", listed > 0, String(listed));
await np.locator("#results button").first().click();
await np.waitForSelector("#panel:not([hidden])");
const ntext = await np.locator("#pBody").innerText();
check("fallback source panel", /Connection/.test(ntext) && /grade|Primary|Reporting|claim|false/i.test(ntext));
await np.screenshot({ path: `${out}/phone-fallback.png` });
check("fallback console", nbucket.errors.filter((e) => !/WebGL/.test(e)).length === 0, nbucket.errors.join(" | "));
await noweb.close();

const home = await chromium.launch({ executablePath: chrome, headless: true });
const hctx = await home.newContext();
const hp = await hctx.newPage();
await hp.goto(`${base}/`, { waitUntil: "domcontentloaded" });
check("production title unchanged", (await hp.title()) === "XRP Web — connection map", await hp.title());
await home.close();

console.log("\nPERF", JSON.stringify({ desktop, tablet, phone, swiftshader: { ...sinfo, fps: sfps, bootMs: sboot } }, null, 2));
if (problems.length) {
  console.error(`\n${problems.length} FAILED`);
  process.exit(1);
}
console.log("\nALL BROWSER CHECKS PASSED");
