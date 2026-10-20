# XRP Web — live connection map

An interactive map of the people, companies, regulators, ETFs, builders, community accounts, riddles and events around XRP/Ripple. It's a single self-contained `index.html` (vis-network inlined, data embedded) driven by `graph.json`.

Research data only. This is not financial advice. No holdings, orders or portfolio data belong in this repo.

## Files
| File | Purpose |
|---|---|
| `graph.json` | The data (source of truth). |
| `index.html` | Generated viewer. Don't hand-edit it; run `build.py`. |
| `template.html` | Viewer source (HTML/CSS/JS). `build.py` inlines vis-network and graph.json into it. |
| `build.py` | Validates graph.json, computes the layout, and regenerates index.html. When the output changes it stamps `meta.updated` with the current America/New_York time (in graph.json and the page). It's idempotent: re-running with no changes leaves both files byte-identical. |
| `layout.py` | Deterministic sector layout (fixed x/y for every node). Called by build.py. |
| `layout-cache.json` | Last build's positions and sector wedges (local only, not published). It keeps existing nodes in place between builds. |
| `publish.sh` | Rebuilds, then pushes index.html, graph.json and README.md to GitHub Pages. |
| `vis-network.min.js` | Local copy of vis-network 9.1.9 (inlined at build time). |

## Viewing
- **Phone or shared link:** https://bmwcoder.github.io/xrp-web-map/ (once published).
- **Offline:** open `index.html` directly. It uses the embedded copy of the data.
- **Served over http(s):** the page fetches `graph.json`. If the embedded copy is newer, or the fetch fails, it uses the embedded copy instead.

Controls: search, type chips (tap to toggle), grade filter, a "new since" date (it shows items added on or after that date, plus their endpoints), **★ Key links**, a **Spacing** slider, and Reset. Tap a node to see its summary, handle, grade, sources and connections. The node and its direct links are highlighted and everything else is dimmed. Tap empty space (or ×) to clear that. The "Recent additions" list shows the latest 15 items by `added`. It's collapsed by default on screens narrower than 1200px.

Dots can't be dragged (`interaction.dragNodes: false`, physics off), so every visit shows the same picture. You can pan, zoom (pinch on a phone), and tap. Small labels appear as you zoom in.

- **Spacing** (0.6×–3×, default 1×) scales every node's fixed position from the center, along with the sector wedges and titles. Dot and label sizes stay the same, so a higher setting spreads things out and reduces clutter. The page remembers the value in `localStorage` (`xrpweb.spacing`).
- **★ Key links** shows only the highest-signal connections: every edge with `"key": true`, plus any A/B edge with strength 5 that touches a hub (a node with 10+ links). XRP, Ripple and the XRPL always stay visible.

## Layout
`build.py` calls `layout.py`, which computes fixed x/y positions. They're embedded in the page as `_layout`; graph.json itself never stores positions.
- **Center:** Ripple, XRP and the XRP Ledger are pinned in the middle.
- **Sectors** are wedges arranged clockwise from the top: Founders & early investors (OpenCoin era) → Claims & debunked (pushed outward, dashed red outline) → Regulators & government → ETFs & institutions → Community, riddles & lore → XRPL builders & ecosystem → RLUSD & stablecoin web → Ripple acquisitions → Banks & payment partners → NDA counterparties → Ripple people, board & execs. The order puts sectors that share many links next to each other. That shortens edges and cuts crossings: ETFs/Evernorth sit next to lore ($FUZZY, the teaser) and regulators, and people sit next to founders.
- **Which sector a node goes in:** first the optional node field `"sector"` (one of `founders, claims, regulators, etfs, lore, builders, rlusd, acq, banks, nda, people`), then the `SECTOR_OF` table in layout.py. Failing those, a grade-X node goes to `claims`, any other node goes to the most common sector among its neighbors, and a node with no placed neighbors gets a per-type default. So a new node usually lands next to the things it connects to, with no extra work.
- **Inside a wedge,** a fixed-iteration force simulation (no randomness) pulls linked nodes together, with weaker pull across sectors. A final greedy pass then gives each node the nearest free spot where its label box doesn't overlap any other label. Dots are sized by connection count, and hubs get bigger, bold labels.
- **Stability:** `layout-cache.json` stores the previous positions. On a rebuild, existing nodes keep their exact spot and only new nodes are slotted in, next to their neighbors and outward within their wedge. Run `python3 build.py --relayout` (or delete the cache) to recompute everything from scratch. Do that if many nodes were added or a sector gets crowded.


## Data model
```json
{"meta": {"updated": "2026-10-19T21:30:00-04:00", "version": 1},
 "nodes": [{"id": "evernorth", "label": "Evernorth (XRPN)", "type": "company", "handle": "@evernorthxrp",
            "summary": "…", "grade": "A", "sources": ["https://…"], "added": "2026-10-19T13:55:00-04:00"}],
 "edges": [{"from": "evernorth", "to": "xrp", "label": "holds ~473M XRP", "grade": "A", "strength": 5, "key": true,
            "source": "https://…", "added": "2026-10-19T06:36:00-04:00"}]}
```
- `type` is one of: `person, company, bank, regulator, etf, builder, community, riddle, event, asset`.
- `grade` is one of:
  - **A**: primary or official source (filing, court record, company post or release). Shown as a solid green edge.
  - **B**: reputable reporting, or a primary source with an inferred link. Shown as a solid amber edge.
  - **C**: speculation or an unverified community claim. Shown as a dashed gray edge, and the node gets a dashed border.
  - **X**: disproven. Shown as a dashed red edge and a red dashed node border.
- `strength` (optional, edges, 1–5, default 2) is **how strong the link is**. `grade` is **how sure we are**. The two are independent. Strength sets the line width (1 → 1px, 2 → 2px, 3 → 3.5px, 4 → 5.5px, 5 → 8px). Color and dashes still show the grade.
  - **5** core/structural (Ripple↔XRP escrow, XRPL↔XRP, Ripple↔RLUSD, Ripple's acquisitions, Evernorth↔XRP, BNY↔RLUSD custody, co-founders)
  - **4** formal partnership, investment, board seat, or regulatory action/ruling
  - **3** documented business tie
  - **2** indirect or shared-party link
  - **1** loose association, claim, or lore (all C/X claims default here)
- `key` (optional, edges, `true`/`false`) marks a link as one of the most important. Key links show in the ★ Key links view and are drawn brighter in the full map. Use it sparingly; about 30 links are marked today (Ripple acquisitions, BNY/SCTC/RLUSD, DTCC/Canton, Barr/Donahue, Evernorth, SEC Rel. 33-11412, Cross River/X Money, SBI, EasyA, @XRP/XRP.org, $FUZZY…).
- `sector` (optional, nodes) pins a node to a layout sector (see Layout).
- `added` is an ISO-8601 timestamp with an ET offset (`-04:00` for EDT, `-05:00` for EST). The "new since" filter and "Recent additions" both use it.

## Adding to the map (append-style rules)
1. **Never delete a node or edge.** The map is a historical record.
2. **Disproven items:** change `grade` to `"X"` and append a note to `summary` (for example "DISPROVEN 2026-11-02: … [source]"). Don't remove the item.
3. **Upgrades or downgrades:** change the grade and append the reason and date to the summary. Keep the original `added` value.
4. **New node:** give it a unique lowercase `id`, a `type` from the list, an honest `grade`, at least one source URL when one exists, and `added` set to now in ET.
5. **New edge:** both endpoints must exist. Set `label` to describe the relationship in plain words, and include one `source` URL (empty only for C claims with no locatable post). Give it a `strength` (1–5). Add `"key": true` only if it's one of the handful of links that matter most.
6. Don't invent connections. If a link is only a community theory, it's C.
7. Bump `meta.version` if you like (`build.py` sets `meta.updated` to the build time in ET automatically), then run:
   ```bash
   python3 build.py          # validates + regenerates index.html
   ./publish.sh              # rebuild + push to GitHub Pages
   ```
   `build.py` refuses to build if there are duplicate ids, unknown edge endpoints, a bad type or grade, a `strength` outside 1–5, or a non-boolean `key`.
