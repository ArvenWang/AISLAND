# AISLAND Phase 3 authored map

`maps/island-01.tmj` is the macro-map source of truth for Phase 3. It is a
fixed 144×112 Tiled map; the compiler may decode it and derive runtime typed
arrays, but it must not rewrite the file or generate its topology.

The visual terrain atlas is a complete generated-material Wang signature
atlas. Each tile is a full 32×32 tile; there is no runtime strip/corner
patching. Characters, props, decals and effects are the Phase 3 v2 civilian
asset set compiled from `v2/`; the legacy ninja/samurai sheets are not used by
the Phase 3 production renderer.

`MoveCost` is authored as cost×10 and compiled to island minutes per traversed
cell. The current source calibration makes the fastest authored spawn-to-spring
route 7.2 island hours at 60 minutes per island hour; `map:phase3:analyze`
enforces the PRD 7–9 hour gate.

See `docs/phase3-visual/ASSET_PIPELINE_V2.md` for generation provenance,
rebuild commands and acceptance evidence.
