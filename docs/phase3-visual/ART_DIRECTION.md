# AISLAND Phase 3 Visual Bible v1

## Product role

The world must explain survival and social action before the player opens a
log. Terrain establishes risk and route choice; characters and props expose
physical state; animation commit frames agree with server-authoritative state.

## Locked visual language

- Original contemporary 2D pixel illustration, not a reproduction of another
  game's characters or exact house style.
- Top-down three-quarter gameplay camera on a fixed 32 px orthogonal grid.
- Clean silhouettes and deliberate pixel clusters; restrained micro-texture.
- Warm neutral daylight from upper-left, short soft shadow to lower-right.
- Terrain has lower contrast than characters, items, and interactable nodes.
- Deep teal water, pale turquoise shallows, muted warm sand, natural medium
  greens, and gray-brown rock form one palette family.
- No non-uniform sprite scaling. Actors use authored display dimensions and a
  shared foot anchor.

The first visual reference is
`assets/source/phase3/v2/concepts/golden-beach-v1.png`.

The reproducible source-to-runtime workflow is documented in
`docs/phase3-visual/ASSET_PIPELINE_V2.md`; normalized generation records and
hashes live in `assets/source/phase3/v2/prompts/visual-generation-v1.json`.

## Layer contract

1. `GroundTileLayer`: terrain and rock/cliff top.
2. `GroundDecalLayer`: paths, leaf litter, sand detail, footprints.
3. `LowObjectLayer`: ground items and low dressing.
4. `WorldSortableLayer`: actors, trunks, rocks, wreckage, resource bodies.
5. `CanopyForeground`: canopies and cliff foreground lips.
6. `WorldEffectsLayer`: fire, light, sound, transfer and pickup effects.
7. `AgentFogLayer`: debug-only cognitive map.
8. `ScreenUI`: bubbles, selection, and product UI.

## Terrain contract

- Six ground materials: deep water, shallow water, wet sand, dry sand, grass,
  and rock top.
- Every final tile is derived from one canonical periodic material and one
  shared topology mask. Image generation never produces unrelated final edge
  tiles independently.
- Tiled metadata uses the official eight positions in this order: top,
  top-right, right, bottom-right, bottom, bottom-left, left, top-left.
- All legal cardinal pairs and diagonal junctions must have exact pixel-edge
  agreement. Pure center variants may change only their protected interior.
- Main terrain tiles are not rotated or flipped at runtime, preserving texture
  and lighting direction.

## Character contract

- Three civilian survivors with distinct silhouette, body shape, hair,
  clothing color, and carried gear; no warrior/fantasy vocabulary.
- Four-direction idle and walk are mandatory.
- Grounded actions use an accepted identity master, character anchor sheet,
  shared output scale, body axis, and foot line.
- Body actions and wide/detached FX are separate assets.
- Interaction families cover observe, low reach, hand-to-face, give/receive,
  refuse, kneel/fire, shout/talk, rest/sleep, exhausted, wake, and death.

## Prop and state contract

- Compact static dressing may use 2x2 or 3x3 packs.
- Wreckage, spring, large trees, fire, collision-bearing objects, and stateful
  resources are generated one-by-one or in explicit state strips.
- Resources use authored `full`, `used`, `depleted`, and optional `regrowing`
  visuals; alpha/tint alone cannot communicate gameplay state.
- Every atlas entry records source image, prompt, trimmed rectangle, display
  size, foot anchor, collision footprint, sort layer, state/action, license,
  and QC result.

## Rejection rules

- Visible grid seams, broken diagonal junctions, one-off corner patches.
- Magenta/green chroma fringe on black, white, green, or map backgrounds.
- Character identity, scale, foot, or horizontal body-axis drift.
- Emoji, debug rectangles, permanent stock numbers, fake buttons, or labels as
  substitutes for world art.
- Reusing legacy ninja, samurai, mixed-palette terrain, or old generated props.
