# Agent Sprite Forge provenance

AISLAND's asset pipeline follows the generation-first, deterministic-
postprocessing method from `0x0funky/agent-sprite-forge`.

- Upstream: https://github.com/0x0funky/agent-sprite-forge
- Audited commit: `64fd0b57d3f2ae117ef0a95e4c2decc25b4c9dd2`
- Audit date: 2026-08-08
- Imported concepts: agent-written prompts, reference handoff, per-action sprite
  sheets, fixed anchors/scale profiles, prop classification, deterministic
  extraction, manifests, and strict QC.
- AISLAND extension: periodic terrain masters, official eight-position Tiled
  Wang IDs, exhaustive cardinal/diagonal seam checks, and runtime state assets.

No upstream generated showcase image is included in AISLAND. The project uses
new original image-generation outputs stored under `assets/source/phase3/v2`.

