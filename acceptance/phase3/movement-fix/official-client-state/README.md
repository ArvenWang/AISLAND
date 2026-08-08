# Official web-game movement evidence

The official `develop-web-game` client was run in headed mode after the fix.
Its `state-*.json` snapshots record authoritative coordinate changes for all
three agents and contain no console-error file.

Pixi/WebGL still returns all-black images through this helper's
`canvas.toDataURL()` capture path, even in headed mode. Those misleading PNGs
are intentionally omitted. The GPU-composited before/after screenshots are in
`../live-browser/` and were captured with Playwright's page screenshot path.
