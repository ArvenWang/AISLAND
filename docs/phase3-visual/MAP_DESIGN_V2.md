# AISLAND Phase 3 Map Design v2

## Spatial thesis

The island is a social pressure vessel, not a resource diagram. Three
survivors wake on a broad south-west beach. From there, three routes overlap
and separate: a legible coastal arc, a short but disorienting forest route,
and a costly ridge route with a later loop. The spring valley is a likely
meeting place, never a declared public camp.

## Authored macro spaces

- **A / Wreck beach:** broad south-west dry-sand shelf, two wreck clusters,
  insufficient opening supplies, three separated spawn points.
- **B / Coastal woodland:** sparse visual cover and driftwood along the west
  and south coast; usable as a safer but longer route.
- **C / South forest mouth:** a narrowing tree corridor with two forks and a
  partial return loop.
- **D / Spring valley:** a concealed open basin around the only stable spring;
  two approaches create a natural encounter bottleneck.
- **E / Broken ridge:** an irregular north-south rock mass with two passes and
  one costly viewpoint. It creates a shortcut only after route knowledge.
- **F / North forest:** denser cover, food, and two low-visibility pockets for
  private rest, hiding, or unattended items.
- **G / Opposite edge:** mixed narrow beach and rock-backed coast. Reaching it
  is a cognitive discovery, not a reward spawn.

## Fixed route families

1. `coast-arc`: longest, most legible, lowest disorientation.
2. `forest-thread`: shortest approach to the spring, higher move and vision
   cost, with a fork near the southern mouth.
3. `ridge-loop`: high-cost eastward route with a pass, viewpoint, and learned
   return shortcut.

The route curves and coastline control points are explicit in the design-time
authoring tool. No random field or procedural island generator decides macro
topology. The only seeded placement is local vegetation distribution, which
is written back into the fixed TMJ.

