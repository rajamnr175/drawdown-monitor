"""Screenshot the site at 1440 / 1024 / 390 px.

Usage: python scripts/screenshot.py [outdir] [url]
Run a local server first, e.g. `python3 -m http.server 8765`.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

out = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots")
out.mkdir(parents=True, exist_ok=True)
url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8765/"
SECTIONS = ["standing", "correction", "crashes", "levels", "winning", "valuation"]

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (1440, 1024, 390):
        pg = b.new_page(viewport={"width": w, "height": 900}, device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        pg.on("pageerror", lambda e: errs.append(str(e)))
        if url.startswith("local"):
            # serve the repo straight from disk (no server process needed)
            ROOT_DIR = Path(__file__).resolve().parent.parent
            TYPES = {".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json"}

            def handle(route, request=None, root=ROOT_DIR, types=TYPES):
                path = route.request.url.split("://local/", 1)[1].split("?")[0] or "index.html"
                f = root / path
                if f.is_file():
                    route.fulfill(status=200, body=f.read_bytes(), content_type=types.get(f.suffix, "application/octet-stream"))
                else:
                    route.fulfill(status=404, body="not found")

            pg.route("http://local/**", handle)
            pg.goto("http://local/", wait_until="networkidle")
        else:
            pg.goto(url, wait_until="networkidle")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=str(out / f"{w}_top.png"))
        for s in SECTIONS:
            pg.locator(f"#{s}").screenshot(path=str(out / f"{w}_{s}.png"))
        overflow = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
        # SVG text clipped outside its svg's box?
        clipped = pg.evaluate("""() => {
          const bad = [];
          document.querySelectorAll('svg').forEach(s => {
            const r = s.getBoundingClientRect();
            s.querySelectorAll('text').forEach(t => {
              const b = t.getBoundingClientRect();
              if (b.width && (b.left < r.left - 1 || b.right > r.right + 1)) bad.push(t.textContent);
            });
          });
          return bad.slice(0, 15);
        }""")
        print(w, "overflow px:", overflow, "| clipped labels:", clipped, "| errors:", errs)
    b.close()
