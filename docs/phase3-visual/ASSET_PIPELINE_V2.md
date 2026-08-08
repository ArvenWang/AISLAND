# AISLAND Phase 3 Asset Forge v2

## Why this pipeline exists

The final map is not an image. It is a deterministic product of authored
social-space topology, canonical material masters, legal tile adjacency, and
runtime state. Image generation supplies coherent visual ingredients; code
supplies geometry, anchors, state identity, atlas layout and proof.

AISLAND follows the chroma-grid-anchor-manifest workflow audited from
`0x0funky/agent-sprite-forge` at commit
`64fd0b57d3f2ae117ef0a95e4c2decc25b4c9dd2`. The exact imported scripts and
MIT license are under `tools/asset-forge/vendor/agent-sprite-forge/`.

## Source-to-runtime flow

1. `ART_DIRECTION.md` and `golden-beach-v1.png` lock camera, palette, light,
   civilian identity and readability.
2. Built-in image generation creates material masters and strict magenta-grid
   character, prop, decal and effect sheets. Normalized prompts, output hashes,
   accepted/rejected status and tool-output IDs are recorded in
   `assets/source/phase3/v2/prompts/visual-generation-v1.json`.
3. `build_terrain_v2.py` periodicizes the six material masters, compiles legal
   Mixed Wang signatures, adds a separate cliff Wang family and exhaustively
   checks horizontal, vertical and diagonal seams.
4. `build_visual_assets_v2.py` applies the upstream chroma extraction method,
   removes edge contamination, fixes display size and foot anchors, packs
   deterministic atlases, writes state/action manifests and runs
   multi-background QC.
5. `compile-phase3.ts` decodes the accepted TMJ into chunked runtime data. It
   never generates or mutates macro topology.
6. `MapScene.tsx` resolves character actions, physical resource states,
   ground items, fires and coast foam from the generated manifests.

## Rebuild commands

```sh
npm run asset:terrain:v2:install
npm run asset:visual:v2:install
npm run map:phase3:all
npm run verify:phase3
```

The image-generation step is deliberately not hidden inside a build command.
It is an art-direction decision gate. Accepted source images and their hashes
are versioned; deterministic compilation starts after that gate.

## Acceptance evidence

- Terrain and cliff seam proof:
  `acceptance/phase3/visual-v2/terrain-v2-qc.json`
- Character, prop, decal and effect proof:
  `acceptance/phase3/visual-v2/visual-assets-v2-qc.json`
- Stress mosaics and galleries: `acceptance/phase3/visual-v2/`
- Five live game regions, night presentation and browser error log:
  `acceptance/phase3/visual-v2/live-game/`

An output is not accepted merely because an atlas was generated. The build,
contract tests, map analysis, live browser capture and human visual review are
separate gates.
