# Phase 3 map authoring tool

`author_phase3_map_v2.py` is a design-time source authoring tool, not part of
the game build. It rasterizes the deliberately placed control points and
social-space zones documented in `docs/phase3-visual/MAP_DESIGN_V2.md`, then
writes the accepted result into the canonical Tiled source only when
`--install` is passed.

Normal builds must only run `scripts/map/compile-phase3.ts`; they do not call
this tool and do not alter `island-01.tmj`.

