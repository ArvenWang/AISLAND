# Official web-game client evidence

These three state snapshots were produced by the official
`develop-web-game/scripts/web_game_playwright_client.js` client after starting
a real local world and running the reference input choreography. They prove
that `render_game_to_text()` exposes the live Phase 3 visual/map contract and
that the world advances into a real movement action without console errors.

The helper captures a Pixi/WebGL canvas through `canvas.toDataURL()`. Under its
SwiftShader launch flags that path returns an all-black PNG even though the
page renders correctly. Those misleading black files are intentionally not
kept. GPU-composited visual evidence is captured separately as full-page
screenshots under `acceptance/phase3/visual-v2/live-game/`, where
`errors.json` is empty.
