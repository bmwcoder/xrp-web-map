# XRP Web — live connection map

An interactive map of the people, companies, regulators, ETFs, builders, community accounts, riddles and events around XRP/Ripple. It's a single self-contained `index.html` (vis-network inlined, data embedded) driven by `graph.json`.

Research data only. This is not financial advice. No holdings, orders or portfolio data belong in this repo.

## Files
| File | Purpose |
|---|---|
| `graph.json` | The data (source of truth). |
| `index.html` | Generated viewer. Don't hand-edit it; run `build.py`. |
| `template.html` | Viewer source (HTML/CSS/JS). `build.py` inlines vis-network and graph.json into it. |
| `build.py` | Validates graph.json and regenerates index.html. It's idempotent: re-running with no changes leaves the file byte-identical. |
| `publish.sh` | Rebuilds, then pushes index.html, graph.json and README.md to GitHub Pages. |
| `vis-network.min.js` | Local copy of vis-network 9.1.9 (inlined at build time). |

## Viewing
- **Phone or shared link:** https://bmwcoder.github.io/xrp-web-map/ (once published).
- **Offline:** open `index.html` directly. It uses the embedded copy of the data.
- **Served over http(s):** the page fetches `graph.json`. If the embedded copy is newer, or the fetch fails, it uses the embedded copy instead.

Controls: search, type chips (tap to toggle), grade filter, a "new since" date (it shows items added on or after that date, plus their endpoints), and Reset. Tap a node to see its summary, handle, grade, sources and connections. The "Recent additions" list shows the latest 15 items by `added`.

## Data model
```json
{"meta": {"updated": "2026-10-19T21:30:00-04:00", "version": 1},
 "nodes": [{"id": "evernorth", "label": "Evernorth (XRPN)", "type": "company", "handle": "@evernorthxrp",
            "summary": "…", "grade": "A", "sources": ["https://…"], "added": "2026-10-19T13:55:00-04:00"}],
 "edges": [{"from": "evernorth", "to": "xrp", "label": "holds ~473M XRP", "grade": "A",
            "source": "https://…", "added": "2026-10-19T06:36:00-04:00"}]}
```
- `type` is one of: `person, company, bank, regulator, etf, builder, community, riddle, event, asset`.
- `grade` is one of:
  - **A**: primary or official source (filing, court record, company post or release). Shown as a solid green edge.
  - **B**: reputable reporting, or a primary source with an inferred link. Shown as a solid amber edge.
  - **C**: speculation or an unverified community claim. Shown as a dashed gray edge, and the node gets a dashed border.
  - **X**: disproven. Shown as a dashed red edge and a red dashed node border.
- `added` is an ISO-8601 timestamp with an ET offset (`-04:00` for EDT, `-05:00` for EST). The "new since" filter and "Recent additions" both use it.

## Adding to the map (append-style rules)
1. **Never delete a node or edge.** The map is a historical record.
2. **Disproven items:** change `grade` to `"X"` and append a note to `summary` (for example "DISPROVEN 2026-11-02: … [source]"). Don't remove the item.
3. **Upgrades or downgrades:** change the grade and append the reason and date to the summary. Keep the original `added` value.
4. **New node:** give it a unique lowercase `id`, a `type` from the list, an honest `grade`, at least one source URL when one exists, and `added` set to now in ET.
5. **New edge:** both endpoints must exist. Set `label` to describe the relationship in plain words, and include one `source` URL (empty only for C claims with no locatable post).
6. Don't invent connections. If a link is only a community theory, it's C.
7. Bump `meta.updated` (ET) and `meta.version`, then run:
   ```bash
   python3 build.py          # validates + regenerates index.html
   ./publish.sh              # rebuild + push to GitHub Pages
   ```
   `build.py` refuses to build if there are duplicate ids, unknown edge endpoints, or a bad type or grade.
