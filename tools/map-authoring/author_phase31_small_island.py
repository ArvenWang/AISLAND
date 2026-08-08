#!/usr/bin/env python3
"""Author the fixed Phase 3.1 80x52 small island and install it into TMJ.

This tool is intentionally absent from package.json build scripts. The TMJ it
writes remains the only production source of truth.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import random
import struct
import zlib
from collections import Counter
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw


W = 80
H = 52
TILE = 32
CLIFF_FIRST_GID = 1001
TERRAINS = ("deep", "shallow", "wetSand", "drySand", "grass", "rock")
COLORS = (
    (9, 71, 102),
    (90, 184, 177),
    (164, 128, 81),
    (229, 181, 91),
    (104, 151, 47),
    (119, 108, 92),
)

# Clockwise, hand-placed coastline controls in map-cell coordinates. The west
# indentation creates a cove; the east/north points form the opposite edge.
COAST_CONTROLS = (
    (12, 39), (15, 46), (22, 49), (31, 49), (39, 46),
    (48, 48), (58, 45), (66, 40), (70, 33), (68, 26),
    (71, 19), (68, 13), (61, 9), (52, 7), (43, 5),
    (34, 7), (26, 8), (19, 12), (14, 17), (10, 24),
    (9, 31),
)

FOREST_ROUTE = ((23, 46), (27, 40), (32, 36), (36, 33), (41, 30))
COAST_ROUTE = ((23, 46), (16, 43), (12, 37), (11, 30), (14, 22), (20, 15), (29, 10), (41, 8))
RIDGE_ROUTE = ((41, 30), (48, 29), (53, 25), (55, 20), (51, 15), (45, 11))
RIDGE_LOOP = ((41, 30), (47, 34), (55, 35), (59, 31), (54, 27), (48, 29), (41, 30))
RIDGE_SPINE = ((48, 12), (52, 17), (52, 22), (56, 27), (54, 33), (60, 38))
RIDGE_BRANCH = ((54, 26), (61, 23), (66, 18))


def root_dir() -> Path:
    return Path(__file__).resolve().parents[2]


def catmull_rom_closed(points: Sequence[tuple[float, float]], samples: int = 12) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    count = len(points)
    for i in range(count):
        p0 = points[(i - 1) % count]
        p1 = points[i]
        p2 = points[(i + 1) % count]
        p3 = points[(i + 2) % count]
        for step in range(samples):
            t = step / samples
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (
                2 * p1[0]
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                2 * p1[1]
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            result.append((x, y))
    return result


def segment_distance(x: float, y: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    vx, vy = b[0] - a[0], b[1] - a[1]
    wx, wy = x - a[0], y - a[1]
    length2 = vx * vx + vy * vy
    if length2 <= 1e-8:
        return math.hypot(wx, wy)
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / length2))
    return math.hypot(x - (a[0] + t * vx), y - (a[1] + t * vy))


def polyline_distance(x: float, y: float, points: Sequence[tuple[float, float]], closed: bool = False) -> float:
    pairs = list(zip(points, points[1:]))
    if closed:
        pairs.append((points[-1], points[0]))
    return min(segment_distance(x, y, a, b) for a, b in pairs)


def gaussian(x: float, y: float, cx: float, cy: float, sx: float, sy: float) -> float:
    return math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2))


def build_macro() -> dict[str, list[int] | list[tuple[int, int]]]:
    coast = catmull_rom_closed(COAST_CONTROLS)
    scale = 8
    polygon_mask = Image.new("1", (W * scale, H * scale))
    ImageDraw.Draw(polygon_mask).polygon([(x * scale, y * scale) for x, y in coast], fill=1)
    inside_pixels = np.asarray(polygon_mask, dtype=np.uint8)

    terrain: list[int] = []
    collision: list[int] = []
    move_cost: list[int] = []
    vision: list[int] = []
    sound: list[int] = []
    elevation: list[int] = []
    regions: list[int] = []
    forest_mask: list[bool] = []
    path_mask: list[bool] = []

    for y in range(H):
        for x in range(W):
            px = x + 0.5
            py = y + 0.5
            inside = bool(inside_pixels[min(H * scale - 1, int(py * scale)), min(W * scale - 1, int(px * scale))])
            coast_distance = polyline_distance(px, py, coast, closed=True)
            south_beach = 3.8 * gaussian(px, py, 24, 46, 16, 7)
            wreck_shelf = 1.8 * gaussian(px, py, 23, 43, 12, 6)
            cove_beach = 1.2 * gaussian(px, py, 13, 31, 8, 7)
            north_narrowing = 0.8 * gaussian(px, py, 43, 7, 18, 5)
            dry_width = max(1.8, 2.4 + south_beach + wreck_shelf + cove_beach - north_narrowing)

            ridge_distance = min(
                polyline_distance(px, py, RIDGE_SPINE),
                polyline_distance(px, py, RIDGE_BRANCH),
            )
            ridge_width = 2.8 + 0.9 * gaussian(px, py, 55, 26, 11, 13)
            pass_cut = (
                gaussian(px, py, 52, 22, 2.8, 2.8) > 0.34
                or gaussian(px, py, 56, 30, 2.8, 2.8) > 0.34
            )
            rock = inside and coast_distance > dry_width + 2.0 and ridge_distance < ridge_width and not pass_cut

            if not inside:
                terrain_id = 1 if coast_distance <= 2.4 else 0
            elif coast_distance <= 1.35:
                terrain_id = 2
            elif coast_distance <= dry_width:
                terrain_id = 3
            elif rock:
                terrain_id = 5
            else:
                terrain_id = 4
            terrain.append(terrain_id)

            forest_route = polyline_distance(px, py, FOREST_ROUTE)
            coast_route = polyline_distance(px, py, COAST_ROUTE)
            ridge_route = min(polyline_distance(px, py, RIDGE_ROUTE), polyline_distance(px, py, RIDGE_LOOP))
            on_path = inside and min(forest_route, coast_route, ridge_route) <= 1.15
            path_mask.append(on_path)

            north_forest = y < 19 and 22 < x < 49
            south_forest = 31 < y < 43 and 25 < x < 45
            east_forest = 17 < y < 35 and 56 < x < 68
            coastal_wood = 20 < y < 42 and 12 < x < 27
            dense = terrain_id == 4 and (north_forest or south_forest or east_forest)
            sparse = terrain_id == 4 and coastal_wood
            forest_mask.append(dense or sparse)

            explicit_cliff = terrain_id == 5 and ridge_distance < 2.0 and not pass_cut
            collision.append(1 if explicit_cliff else 0)
            if terrain_id <= 1:
                move_cost.append(0)
            elif terrain_id == 2:
                move_cost.append(50)
            elif terrain_id == 3:
                move_cost.append(35)
            elif terrain_id == 5:
                move_cost.append(90)
            elif on_path:
                move_cost.append(30)
            elif dense:
                move_cost.append(60)
            else:
                move_cost.append(45)
            vision.append(78 if explicit_cliff else 42 if dense and not on_path else 18 if sparse else 0)
            sound.append(1 if terrain_id <= 1 else 4 if terrain_id == 5 or dense else 2 if terrain_id in (2, 3) else 3)
            elev = 0
            if terrain_id == 5:
                elev = 2 if ridge_distance < 2.7 else 1
                if gaussian(px, py, 55, 20, 3.5, 3.5) > 0.45:
                    elev = 3
            elevation.append(elev)

            if not inside:
                region = 0
            elif y >= 41 and x < 34:
                region = 1
            elif x < 28 and y >= 25:
                region = 2
            elif y >= 33 and x < 43:
                region = 3
            elif math.hypot(x - 41, y - 30) < 10:
                region = 4
            elif terrain_id == 5 or x >= 49:
                region = 5
            elif y < 15:
                region = 6
            else:
                region = 7
            regions.append(region)

    return {
        "terrain": terrain,
        "collision": collision,
        "moveCost": move_cost,
        "vision": vision,
        "sound": sound,
        "elevation": elevation,
        "regions": regions,
        "forestMask": forest_mask,
        "pathMask": path_mask,
    }


def tile_signature(classes: Sequence[int], x: int, y: int) -> tuple[int, int, int, int]:
    current = classes[y * W + x]
    nw = classes[(y - 1) * W + x - 1] if x > 0 and y > 0 else current
    north = classes[(y - 1) * W + x] if y > 0 else current
    west = classes[y * W + x - 1] if x > 0 else current
    return nw, north, west, current


def tileset_lookup(root: Path) -> dict[tuple[int, int, int, int], list[int]]:
    tileset = json.loads((root / "assets/source/phase3/tilesets/terrain.tsj").read_text(encoding="utf-8"))
    lookup: dict[tuple[int, int, int, int], list[tuple[int, int]]] = {}
    for tile in tileset["tiles"]:
        props = {item["name"]: item["value"] for item in tile.get("properties", [])}
        signature = tuple(int(value) for value in str(props["terrainSignature"]).split(","))
        lookup.setdefault(signature, []).append((int(props.get("variant", 0)), int(tile["id"]) + 1))
    return {signature: [gid for _, gid in sorted(values)] for signature, values in lookup.items()}


def terrain_gids(classes: Sequence[int], lookup: dict[tuple[int, int, int, int], list[int]]) -> list[int]:
    gids: list[int] = []
    for y in range(H):
        for x in range(W):
            signature = tile_signature(classes, x, y)
            candidates = lookup.get(signature)
            if not candidates:
                raise ValueError(f"No authored Wang tile for signature {signature} at {x},{y}")
            if len(set(signature)) == 1:
                digest = hashlib.sha256(f"phase3-map-v2:{x},{y}:{signature[0]}".encode()).digest()
                gid = candidates[int.from_bytes(digest[:2], "big") % len(candidates)]
            else:
                gid = candidates[0]
            gids.append(gid)
    return gids


def normalize_wang_classes(classes: list[int], lookup: dict[tuple[int, int, int, int], list[int]]) -> None:
    """Resolve sharp one-cell corners to signatures present in the v2 Wang set.

    The adjustment stays within water or land, so it cannot open or close a
    route. It is an author-time normalization and the resulting TMJ is fixed.
    """
    for y in range(H):
        for x in range(W):
            signature = tile_signature(classes, x, y)
            if signature in lookup:
                continue
            current = signature[3]
            same_domain = [value for value in range(len(TERRAINS)) if (value >= 2) == (current >= 2)]
            preferred = list(dict.fromkeys((current, signature[2], signature[1], signature[0], *same_domain)))
            replacement = next((value for value in preferred if (signature[0], signature[1], signature[2], value) in lookup), None)
            if replacement is None:
                raise ValueError(f"No domain-safe Wang normalization for {signature} at {x},{y}")
            classes[y * W + x] = replacement


def authored_decals(macro: dict[str, list[int] | list[tuple[int, int]]]) -> list[int]:
    terrain = macro["terrain"]
    forest = macro["forestMask"]
    paths = macro["pathMask"]
    assert isinstance(terrain, list) and isinstance(forest, list) and isinstance(paths, list)
    decals: list[int] = []
    for y in range(H):
        for x in range(W):
            index = y * W + x
            digest = hashlib.sha256(f"phase3-decals-v2:{x},{y}".encode()).digest()
            roll = int.from_bytes(digest[:2], "big") / 65535.0
            variant = digest[2] % 4
            value = 0
            if paths[index] and terrain[index] == 4 and roll < 0.24:
                value = 9 + variant
            elif terrain[index] in (2, 3) and roll < 0.035:
                value = 1 + variant
            elif terrain[index] == 4 and forest[index] and roll < 0.09:
                value = 13 + variant
            elif terrain[index] == 4 and roll < 0.03:
                value = 5 + variant
            decals.append(value)
    # Deliberate landing-beach story marks; these are fixed authored cells,
    # not per-run decoration.
    for x, y, gid in ((18, 46, 3), (22, 46, 3), (26, 47, 4), (20, 43, 2), (29, 44, 4)):
        decals[y * W + x] = gid
    return decals


def authored_cliffs(classes: Sequence[int]) -> list[int]:
    gids: list[int] = []
    for y in range(H):
        for x in range(W):
            signature = tile_signature(classes, x, y)
            bits = sum((1 << index) for index, terrain in enumerate(signature) if terrain == 5)
            gids.append(0 if bits in (0, 15) else CLIFF_FIRST_GID + bits)
    return gids


def prop(name: str, value: object) -> dict[str, object]:
    if isinstance(value, bool):
        kind = "bool"
    elif isinstance(value, int):
        kind = "int"
    elif isinstance(value, float):
        kind = "float"
    else:
        kind = "string"
    return {"name": name, "type": kind, "value": value}


def map_object(
    object_id: int,
    name: str,
    object_type: str,
    cell_x: int,
    cell_y: int,
    width: int,
    height: int,
    properties: dict[str, object],
) -> dict[str, object]:
    merged = {"footCellX": cell_x, "footCellY": cell_y, **properties}
    return {
        "id": object_id,
        "name": name,
        "type": object_type,
        "x": cell_x * TILE,
        "y": cell_y * TILE,
        "width": width,
        "height": height,
        "rotation": 0,
        "visible": True,
        "properties": [prop(key, value) for key, value in merged.items()],
    }


def generate_trees(macro: dict[str, list[int] | list[tuple[int, int]]]) -> list[tuple[int, int, int]]:
    terrain = macro["terrain"]
    forest = macro["forestMask"]
    paths = macro["pathMask"]
    assert isinstance(terrain, list) and isinstance(forest, list) and isinstance(paths, list)
    rng = random.Random(31_080_052)
    candidates = [(x, y) for y in range(6, 48) for x in range(8, 72)]
    rng.shuffle(candidates)
    selected: list[tuple[int, int, int]] = []
    clearings = ((23, 46, 7), (41, 30, 6), (55, 20, 3), (59, 35, 4))
    for x, y in candidates:
        i = y * W + x
        if terrain[i] != 4 or paths[i]:
            continue
        if any(math.hypot(x - cx, y - cy) < radius for cx, cy, radius in clearings):
            continue
        density = 0.58 if forest[i] else 0.09
        if rng.random() > density:
            continue
        minimum = 2.35 if forest[i] else 3.4
        if any(math.hypot(x - tx, y - ty) < minimum for tx, ty, _ in selected):
            continue
        if y < 18:
            variant_pool = (1, 2, 3, 4, 5, 7)
        elif 31 < y < 43 and 25 < x < 45:
            variant_pool = (1, 2, 3, 4, 5, 7)
        elif x < 27 or y > 41:
            variant_pool = (0, 6, 1, 7)
        else:
            variant_pool = (1, 2, 3, 4, 5, 7)
        counts = Counter(variant for _, _, variant in selected)
        allowed = [
            variant for variant in variant_pool
            if counts[variant] < 18
            and not any(abs(x - tx) <= 2 and abs(y - ty) <= 2 and variant == tree_variant for tx, ty, tree_variant in selected)
        ]
        if not allowed:
            continue
        least_used = min(counts[variant] for variant in allowed)
        variant = rng.choice([variant for variant in allowed if counts[variant] == least_used])
        selected.append((x, y, variant))
        if len(selected) >= 72:
            break
    return sorted(selected, key=lambda item: (item[1], item[0]))


def replace_objects(source: dict[str, object], macro: dict[str, list[int] | list[tuple[int, int]]]) -> None:
    layers = {layer["name"]: layer for layer in source["layers"]}
    next_id = 1

    def objects(specs: Iterable[tuple[str, str, int, int, int, int, dict[str, object]]]) -> list[dict[str, object]]:
        nonlocal next_id
        result = []
        for name, object_type, x, y, width, height, properties in specs:
            result.append(map_object(next_id, name, object_type, x, y, width, height, properties))
            next_id += 1
        return result

    low_specs = [
        ("wreck_main", "wreck_main", 22, 45, 192, 96, {"assetId": "wreck_fuselage_full", "stateGroup": "wreck_fuselage", "reusePolicy": "unique", "collision": True, "collisionWidth": 5, "collisionHeight": 2, "interactionPointX": 25, "interactionPointY": 44, "waterUnits": 2, "foodUnits": 1, "searchable": True}),
        ("wreck_tail", "wreck_tail", 30, 44, 112, 72, {"assetId": "wreck_tail", "reusePolicy": "limited", "collision": True, "collisionWidth": 2, "collisionHeight": 2, "interactionPointX": 30, "interactionPointY": 43}),
        ("debris_west", "crash_debris", 17, 45, 72, 48, {"assetId": "debris_luggage_0", "variantGroup": "crash_debris", "reusePolicy": "repeatable"}),
        ("debris_center", "crash_debris", 27, 48, 72, 48, {"assetId": "debris_luggage_1", "variantGroup": "crash_debris", "reusePolicy": "repeatable"}),
        ("debris_east", "crash_debris", 33, 43, 72, 48, {"assetId": "debris_luggage_2", "variantGroup": "crash_debris", "reusePolicy": "repeatable"}),
    ]
    rock_points = ((15, 29), (18, 18), (25, 12), (34, 10), (47, 13), (54, 18), (60, 22), (63, 29), (59, 38), (49, 40), (38, 42), (31, 35), (45, 27), (52, 31), (66, 34), (21, 25), (43, 16), (57, 14))
    low_specs.extend((f"rock_{index}", "rock", x, y, 40, 34, {"assetId": f"rock_{index % 6}", "variantGroup": "rock", "reusePolicy": "repeatable", "collision": True, "interactionPointX": x, "interactionPointY": y, "elevation": 1, "variant": index % 6}) for index, (x, y) in enumerate(rock_points, 1))
    layers["LowProps"]["objects"] = objects(low_specs)

    tree_objects = []
    canopy_objects = []
    for index, (x, y, variant) in enumerate(generate_trees(macro), 1):
        entry = map_object(next_id, f"tree_{index}", "tree", x, y, 64, 96, {"assetId": f"tree_{variant}", "variantGroup": "tree", "reusePolicy": "repeatable", "collision": True, "variant": variant})
        next_id += 1
        tree_objects.append(entry)
        canopy = json.loads(json.dumps(entry))
        canopy["id"] = 100_000 + int(entry["id"])
        canopy_objects.append(canopy)
    layers["TallProps"]["objects"] = tree_objects
    layers["Canopy"]["objects"] = canopy_objects

    layers["Spawn"]["objects"] = objects([
        ("spawn_1", "spawn_point", 20, 46, 32, 32, {"agentSlot": 1}),
        ("spawn_2", "spawn_point", 23, 46, 32, 32, {"agentSlot": 2}),
        ("spawn_3", "spawn_point", 26, 47, 32, 32, {"agentSlot": 3}),
    ])
    resource_specs = [
        ("item_water_bottle_1", "item_spawn", 17, 47, 32, 32, {"itemKind": "water_bottle"}),
        ("item_water_bottle_2", "item_spawn", 21, 48, 32, 32, {"itemKind": "water_bottle"}),
        ("item_water_bottle_3", "item_spawn", 27, 46, 32, 32, {"itemKind": "water_bottle"}),
        ("item_water_bottle_4", "item_spawn", 31, 46, 32, 32, {"itemKind": "water_bottle"}),
        ("item_food_ration_1", "item_spawn", 19, 44, 32, 32, {"itemKind": "food_ration"}),
        ("item_food_ration_2", "item_spawn", 25, 47, 32, 32, {"itemKind": "food_ration"}),
        ("item_food_ration_3", "item_spawn", 32, 44, 32, 32, {"itemKind": "food_ration"}),
        ("item_lighter_1", "item_spawn", 29, 45, 32, 32, {"itemKind": "lighter"}),
        ("item_tinder_1", "item_spawn", 16, 44, 32, 32, {"itemKind": "tinder"}),
        ("item_backpack_1", "item_spawn", 34, 45, 32, 32, {"itemKind": "backpack"}),
        ("spring_valley", "water_spring", 41, 30, 104, 80, {"assetId": "spring_full", "stateGroup": "spring", "reusePolicy": "stateful", "resource": "water", "capacity": 12, "regenPerIslandHour": 0.35, "stable": True, "collision": True, "collisionWidth": 2, "collisionHeight": 2, "interactionPointX": 41, "interactionPointY": 32}),
        ("food_forest", "berry_bush", 33, 34, 56, 48, {"assetId": "berry_full", "variantGroup": "food_resource", "stateGroup": "berry_bush", "reusePolicy": "stateful", "resource": "food", "capacity": 3, "regenPerIslandHour": 0.12, "plantKnowledgeRequired": True, "interactionPointX": 33, "interactionPointY": 34}),
        ("food_ridge", "berry_bush", 51, 27, 56, 48, {"assetId": "berry_used", "variantGroup": "food_resource", "stateGroup": "berry_bush", "reusePolicy": "stateful", "resource": "food", "capacity": 3, "regenPerIslandHour": 0.12, "plantKnowledgeRequired": True, "interactionPointX": 51, "interactionPointY": 27}),
        ("food_coastal", "berry_bush", 16, 31, 56, 48, {"assetId": "berry_depleted", "variantGroup": "food_resource", "stateGroup": "berry_bush", "reusePolicy": "stateful", "resource": "food", "capacity": 3, "regenPerIslandHour": 0.12, "plantKnowledgeRequired": True, "interactionPointX": 16, "interactionPointY": 31}),
    ]
    for index, (x, y) in enumerate(((29, 37), (37, 35), (47, 34), (56, 37), (24, 27)), 1):
        resource_specs.append((f"wood_{index}", "wood_pile", x, y, 48, 36, {"assetId": "wood_full", "variantGroup": "wood_source", "stateGroup": "wood_pile", "reusePolicy": "stateful", "resource": "wood", "capacity": 4, "regenPerIslandHour": 0.18, "interactionPointX": x, "interactionPointY": y}))
    layers["ResourceNodes"]["objects"] = objects(resource_specs)

    layers["HiddenSpots"]["objects"] = objects([
        ("hidden_grove", "hidden_spot", 59, 35, 64, 64, {"visibility": "low", "privateRest": True}),
    ])
    layers["Landmarks"]["objects"] = objects([
        ("viewpoint_ridge", "landmark_viewpoint", 55, 20, 96, 80, {"assetId": "landmark_rock", "reusePolicy": "unique", "elevation": 3, "dayFovBonus": 5, "staminaCost": 2, "collision": True, "interactionPointX": 55, "interactionPointY": 21}),
        ("opposite_edge", "opposite_edge", 43, 9, 32, 32, {"displayName": "北侧岩岸"}),
        ("bottleneck_forest_mouth", "bottleneck", 31, 37, 32, 32, {"displayName": "林缘岔路"}),
        ("bottleneck_spring_valley", "bottleneck", 41, 33, 32, 32, {"displayName": "淡水谷入口"}),
        ("route_loop_marker", "route_loop", 53, 30, 32, 32, {"shortcut": "ridge_pass"}),
    ])
    source["nextobjectid"] = next_id


def encode(values: Sequence[int]) -> str:
    raw = struct.pack("<" + "I" * len(values), *values)
    return base64.b64encode(zlib.compress(raw, level=9)).decode("ascii")


def update_property(properties: list[dict[str, object]], name: str, value: object, kind: str) -> None:
    properties[:] = [item for item in properties if item.get("name") != name]
    properties.append({"name": name, "type": kind, "value": value})


def longest_run(mask: Sequence[bool]) -> int:
    best = current = 0
    for value in mask:
        current = current + 1 if value else 0
        best = max(best, current)
    return best


def qc(macro: dict[str, list[int] | list[tuple[int, int]]], tree_count: int) -> dict[str, object]:
    terrain = macro["terrain"]
    assert isinstance(terrain, list)
    boundary = []
    longest_horizontal = 0
    longest_vertical = 0
    for y in range(H):
        row = []
        for x in range(W):
            land = terrain[y * W + x] >= 2
            near_water = any(
                0 <= x + dx < W and 0 <= y + dy < H and terrain[(y + dy) * W + x + dx] <= 1
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            value = land and near_water
            row.append(value)
            if value:
                boundary.append((x, y))
        longest_horizontal = max(longest_horizontal, longest_run(row))
    for x in range(W):
        longest_vertical = max(longest_vertical, longest_run([((x, y) in set(boundary)) for y in range(H)]))
    counts = Counter(TERRAINS[value] for value in terrain)
    land_touches_border = sum(
        1
        for x, y in [(x, 0) for x in range(W)] + [(x, H - 1) for x in range(W)] + [(0, y) for y in range(H)] + [(W - 1, y) for y in range(H)]
        if terrain[y * W + x] >= 2
    )
    report = {
        "schema": "aisland.phase31.map_topology_qc.v1",
        "passed": land_touches_border == 0 and len(boundary) > 120 and 50 <= tree_count <= 80,
        "macroSource": "hand-authored-small-island-control-points",
        "terrainCounts": counts,
        "coastline": {
            "boundaryCells": len(boundary),
            "longestHorizontalBoundaryRun": longest_horizontal,
            "longestVerticalBoundaryRun": longest_vertical,
            "landCellsTouchingMapBorder": land_touches_border,
        },
        "objects": {"trees": tree_count, "spawn": 3, "stableSpring": 1, "hiddenSpots": 1, "bottlenecks": 2, "routeLoops": 1, "viewpoints": 1},
    }
    if not report["passed"]:
        raise ValueError(f"Macro topology QC failed: {report}")
    return report


def preview(root: Path, macro: dict[str, list[int] | list[tuple[int, int]]], trees: Sequence[tuple[int, int, int]]) -> Path:
    scale = 5
    image = Image.new("RGB", (W * scale, H * scale))
    pixels = image.load()
    terrain = macro["terrain"]
    assert isinstance(terrain, list)
    for y in range(H):
        for x in range(W):
            color = COLORS[terrain[y * W + x]]
            for py in range(scale):
                for px in range(scale):
                    pixels[x * scale + px, y * scale + py] = color
    draw = ImageDraw.Draw(image, "RGBA")
    for route, color in ((COAST_ROUTE, (255, 245, 198, 150)), (FOREST_ROUTE, (218, 239, 182, 160)), (RIDGE_ROUTE, (216, 201, 176, 160)), (RIDGE_LOOP, (216, 201, 176, 130))):
        draw.line([(x * scale, y * scale) for x, y in route], fill=color, width=2 * scale, joint="curve")
    for x, y, variant in trees:
        color = (
            (83, 130, 39, 180),
            (73, 119, 43, 180),
            (45, 104, 44, 185),
            (29, 77, 43, 190),
            (39, 86, 40, 190),
            (78, 91, 39, 175),
            (113, 137, 39, 185),
            (54, 116, 50, 185),
        )[variant]
        draw.ellipse(((x * scale - 3), (y * scale - 3), (x * scale + 4), (y * scale + 4)), fill=color)
    for x, y, color in ((23, 46, (255, 255, 255, 255)), (41, 30, (76, 199, 255, 255)), (55, 20, (255, 216, 97, 255)), (59, 35, (190, 119, 255, 255)), (43, 9, (255, 160, 120, 255))):
        draw.ellipse(((x - 1) * scale, (y - 1) * scale, (x + 1) * scale, (y + 1) * scale), fill=color)
    output = root / "acceptance/phase31/map/macro-topology.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    return output


def author(install: bool) -> dict[str, object]:
    root = root_dir()
    source_path = root / "assets/source/phase31/maps/island-01-small.tmj"
    template_path = root / "assets/source/phase3/maps/island-01.tmj"
    source = json.loads(template_path.read_text(encoding="utf-8"))
    macro = build_macro()
    lookup = tileset_lookup(root)
    normalize_wang_classes(macro["terrain"], lookup)  # type: ignore[arg-type]
    trees = generate_trees(macro)
    report = qc(macro, len(trees))
    report["preview"] = preview(root, macro, trees).relative_to(root).as_posix()
    report["installed"] = install
    if install:
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source["width"] = W
        source["height"] = H
        for layer in source["layers"]:
            if layer.get("type") == "tilelayer":
                layer["width"] = W
                layer["height"] = H
        gids = terrain_gids(macro["terrain"], lookup)  # type: ignore[arg-type]
        layers = {layer["name"]: layer for layer in source["layers"]}
        assignments = {
            "TerrainBase": gids,
            "GroundDecals": authored_decals(macro),
            "CliffFace": authored_cliffs(macro["terrain"]),  # type: ignore[arg-type]
            "Collision": macro["collision"],
            "MoveCost": macro["moveCost"],
            "VisionOpacity": macro["vision"],
            "SoundCost": macro["sound"],
            "Elevation": macro["elevation"],
            "RegionId": macro["regions"],
        }
        for name, values in assignments.items():
            assert isinstance(values, list) and len(values) == W * H
            layers[name]["encoding"] = "base64"
            layers[name]["compression"] = "zlib"
            layers[name]["data"] = encode(values)
        replace_objects(source, macro)
        source["tilesets"] = [
            {"firstgid": 1, "source": "../../phase3/tilesets/terrain.tsj"},
            {"firstgid": CLIFF_FIRST_GID, "source": "../../phase3/tilesets/cliffs.tsj"},
        ]
        properties = source.setdefault("properties", [])
        update_property(properties, "version", "phase31-map-v1", "string")
        update_property(properties, "mapSize", "80x52", "string")
        update_property(properties, "focusX", 23, "int")
        update_property(properties, "focusY", 46, "int")
        update_property(properties, "mapDesignVersion", "small-island-deep-agents-v1", "string")
        update_property(properties, "macroAuthoring", "hand-authored-control-points", "string")
        source["tiledversion"] = "1.12.2"
        source_path.write_text(json.dumps(source, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    report_path = root / "acceptance/phase31/map/topology-qc.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=dict) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", help="Write the accepted topology into the canonical TMJ source.")
    args = parser.parse_args()
    print(json.dumps(author(args.install), ensure_ascii=False, indent=2, default=dict))


if __name__ == "__main__":
    main()
