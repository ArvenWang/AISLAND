#!/usr/bin/env python3
"""Build AISLAND's generated-material, seam-locked Tiled terrain atlas."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import itertools
import math
import shutil
import struct
import zlib
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


TILE_SIZE = 32
PERIODIC_SIZE = 256
ATLAS_COLS = 16
TERRAINS = ("deep", "shallow", "wetSand", "drySand", "grass", "rock")
LEGAL_PAIRS = ((0, 1), (1, 2), (2, 3), (3, 4), (4, 5))
MATERIAL_FILES = {
    "deep": "deep-water-v1.png",
    "shallow": "shallow-water-v1.png",
    "wetSand": "wet-sand-v1.png",
    "drySand": "dry-sand-v1.png",
    "grass": "grass-v1.png",
    "rock": "rock-v1.png",
}
WANG_COLORS = ("#14516b", "#68b9ad", "#9f7c55", "#d5a95d", "#69963c", "#817563")
EDGE_ACCENTS = {
    (0, 1): ((93, 188, 202), 0.18),
    (1, 2): ((235, 239, 207), 0.58),
    (2, 3): ((117, 88, 55), 0.20),
    (3, 4): ((72, 113, 48), 0.28),
    (4, 5): ((83, 91, 57), 0.24),
}


def root_dir() -> Path:
    return Path(__file__).resolve().parents[2]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cosine_band(distance: np.ndarray, width: float) -> np.ndarray:
    value = np.clip(1.0 - distance / width, 0.0, 1.0)
    return 0.5 - 0.5 * np.cos(value * math.pi)


def periodicize(source: Image.Image) -> Image.Image:
    side = min(source.width, source.height)
    x0 = (source.width - side) // 2
    y0 = (source.height - side) // 2
    image = source.crop((x0, y0, x0 + side, y0 + side)).convert("RGB")
    image = image.resize((PERIODIC_SIZE, PERIODIC_SIZE), Image.Resampling.LANCZOS)
    array = np.asarray(image, dtype=np.float32)
    half = PERIODIC_SIZE // 2
    rolled = np.roll(array, shift=(half, half), axis=(0, 1))
    blurred = np.asarray(
        Image.fromarray(np.clip(rolled, 0, 255).astype(np.uint8), "RGB").filter(
            ImageFilter.GaussianBlur(radius=9)
        ),
        dtype=np.float32,
    )
    yy, xx = np.mgrid[0:PERIODIC_SIZE, 0:PERIODIC_SIZE]
    vertical = cosine_band(np.abs(xx - half), 30.0)
    horizontal = cosine_band(np.abs(yy - half), 30.0)
    mask = 1.0 - (1.0 - vertical) * (1.0 - horizontal)
    mixed = rolled * (1.0 - mask[..., None]) + blurred * mask[..., None]
    unrolled = np.roll(mixed, shift=(-half, -half), axis=(0, 1))
    return Image.fromarray(np.clip(unrolled, 0, 255).astype(np.uint8), "RGB")


def enforce_periodic_edges(image: Image.Image) -> Image.Image:
    array = np.asarray(image.convert("RGB"), dtype=np.uint16).copy()
    horizontal = ((array[:, 0] + array[:, -1]) // 2).astype(np.uint8)
    array[:, 0] = horizontal
    array[:, -1] = horizontal
    vertical = ((array[0] + array[-1]) // 2).astype(np.uint8)
    array[0] = vertical
    array[-1] = vertical
    corner = np.mean(
        np.stack((array[0, 0], array[0, -1], array[-1, 0], array[-1, -1])),
        axis=0,
    ).astype(np.uint8)
    array[0, 0] = array[0, -1] = array[-1, 0] = array[-1, -1] = corner
    return Image.fromarray(array.astype(np.uint8), "RGB")


def canonical_tile(periodic: Image.Image) -> Image.Image:
    tile = periodic.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)
    return enforce_periodic_edges(tile)


def lock_boundary(candidate: Image.Image, canonical: Image.Image, boundary_width: float = 5.0) -> Image.Image:
    candidate_array = np.asarray(candidate.convert("RGB"), dtype=np.float32)
    locked = np.asarray(canonical, dtype=np.float32)
    yy, xx = np.mgrid[0:TILE_SIZE, 0:TILE_SIZE]
    distance = np.minimum.reduce((xx, yy, TILE_SIZE - 1 - xx, TILE_SIZE - 1 - yy)).astype(np.float32)
    interior = np.clip(distance / boundary_width, 0.0, 1.0)
    interior = interior * interior * (3.0 - 2.0 * interior)
    result = locked * (1.0 - interior[..., None]) + candidate_array * interior[..., None]
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def shifted_materials(
    periodic_materials: dict[int, Image.Image],
    variant: int,
) -> dict[int, Image.Image]:
    materials: dict[int, Image.Image] = {}
    for terrain, periodic in periodic_materials.items():
        array = np.asarray(periodic.convert("RGB"), dtype=np.uint8)
        shift_y = (37 * variant + 53 * terrain) % PERIODIC_SIZE
        shift_x = (71 * variant + 29 * terrain) % PERIODIC_SIZE
        shifted = np.roll(array, shift=(shift_y, shift_x), axis=(0, 1))
        tile = Image.fromarray(shifted, "RGB").resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)
        materials[terrain] = tile
    return materials


def old_wang_tiles(tileset: dict[str, object]) -> list[dict[str, object]]:
    wangset = list(tileset.get("wangsets") or [])[0]
    if "wangtiles" in wangset:
        return list(wangset.get("wangtiles") or [])
    return list(wangset.get("tiles") or [])


def signature_from_wangid(wangid: list[int]) -> tuple[int, int, int, int]:
    if len(wangid) == 4:
        return tuple(int(value) for value in wangid)  # type: ignore[return-value]
    if len(wangid) != 8:
        raise ValueError(f"Unsupported Wang ID length: {len(wangid)}")
    return (wangid[7] - 1, wangid[1] - 1, wangid[5] - 1, wangid[3] - 1)


def to_wangid(signature: tuple[int, int, int, int]) -> list[int]:
    nw, ne, sw, se = (value + 1 for value in signature)
    top = nw if nw == ne else 0
    right = ne if ne == se else 0
    bottom = sw if sw == se else 0
    left = nw if nw == sw else 0
    return [top, ne, right, se, bottom, sw, left, nw]


def signature_sort_key(signature: tuple[int, int, int, int]) -> tuple[object, ...]:
    unique = tuple(sorted(set(signature)))
    pure = len(unique) == 1
    return (0 if pure else 1, len(unique), unique, signature)


def required_signatures(existing: Iterable[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    signatures = set(existing)
    for terrain in range(len(TERRAINS)):
        signatures.add((terrain, terrain, terrain, terrain))
    for low, high in LEGAL_PAIRS:
        for bits in range(16):
            signatures.add(
                tuple(high if bits & (1 << index) else low for index in range(4))  # type: ignore[arg-type]
            )
    # Curved, nested terrain bands can place three consecutive materials in a
    # single 2x2 corner signature (for example wet sand, dry sand, and grass).
    # Author every topology whose four cardinal corner adjacencies remain on
    # the legal material chain. This is finite, deterministic Wang coverage;
    # it is not a runtime corner patch.
    for signature in itertools.product(range(len(TERRAINS)), repeat=4):
        nw, ne, sw, se = signature
        if all(abs(a - b) <= 1 for a, b in ((nw, ne), (nw, sw), (ne, se), (sw, se))):
            signatures.add(signature)
    return sorted(signatures, key=signature_sort_key)


def build_palette(material_tiles: dict[int, Image.Image]) -> Image.Image:
    swatches = Image.new("RGB", (TILE_SIZE * len(material_tiles), TILE_SIZE + 8))
    for terrain, tile in material_tiles.items():
        swatches.paste(tile, (terrain * TILE_SIZE, 0))
    draw = ImageDraw.Draw(swatches)
    for index, (color, _) in enumerate(EDGE_ACCENTS.values()):
        x0 = index * 8
        draw.rectangle((x0, TILE_SIZE, x0 + 7, TILE_SIZE + 7), fill=color)
    return swatches.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def render_signature(
    signature: tuple[int, int, int, int],
    materials: dict[int, Image.Image],
    palette: Image.Image,
) -> Image.Image:
    axis = np.linspace(0.0, 1.0, TILE_SIZE, dtype=np.float32)
    yy, xx = np.meshgrid(axis, axis, indexing="ij")
    warped_x = np.clip(xx + 0.035 * np.sin(2 * math.pi * yy + 0.55) * np.sin(math.pi * xx), 0.0, 1.0)
    warped_y = np.clip(yy + 0.035 * np.sin(2 * math.pi * xx + 1.65) * np.sin(math.pi * yy), 0.0, 1.0)
    corner_weights = (
        (1.0 - warped_x) * (1.0 - warped_y),
        warped_x * (1.0 - warped_y),
        (1.0 - warped_x) * warped_y,
        warped_x * warped_y,
    )
    weights = np.zeros((len(TERRAINS), TILE_SIZE, TILE_SIZE), dtype=np.float32)
    for terrain, contribution in zip(signature, corner_weights):
        weights[terrain] += contribution
    weights = np.power(weights, 2.35)
    weights /= np.maximum(np.sum(weights, axis=0, keepdims=True), 1e-6)
    material_arrays = np.stack(
        [np.asarray(materials[index].convert("RGB"), dtype=np.float32) for index in range(len(TERRAINS))]
    )
    color = np.sum(weights[..., None] * material_arrays, axis=0)

    if len(set(signature)) > 1:
        order = np.argsort(weights, axis=0)
        first = order[-1]
        second = order[-2]
        first_weight = np.take_along_axis(weights, first[None, ...], axis=0)[0]
        second_weight = np.take_along_axis(weights, second[None, ...], axis=0)[0]
        boundary = np.clip(1.0 - np.abs(first_weight - second_weight) / 0.16, 0.0, 1.0)
        for pair, (accent, alpha) in EDGE_ACCENTS.items():
            pair_mask = (
                ((first == pair[0]) & (second == pair[1]))
                | ((first == pair[1]) & (second == pair[0]))
            ).astype(np.float32)
            amount = (boundary * pair_mask * alpha)[..., None]
            color = color * (1.0 - amount) + np.asarray(accent, dtype=np.float32) * amount

    image = Image.fromarray(np.clip(color, 0, 255).astype(np.uint8), "RGB")
    return image.quantize(palette=palette, dither=Image.Dither.NONE).convert("RGB")


def make_tileset(
    tiles: list[dict[str, object]],
    atlas_width: int,
    atlas_height: int,
    image_path: str,
) -> dict[str, object]:
    colors = [
        {
            "color": WANG_COLORS[index],
            "name": terrain,
            "probability": 1,
            "tile": next(
                int(tile["id"])
                for tile in tiles
                if tile["signature"] == [index, index, index, index] and tile["variant"] == 0
            ),
        }
        for index, terrain in enumerate(TERRAINS)
    ]
    tile_entries = []
    wangtiles = []
    for tile in tiles:
        signature = tuple(int(value) for value in tile["signature"])
        terrain = TERRAINS[signature[3]]
        tile_entries.append(
            {
                "id": tile["id"],
                "type": terrain,
                "class": "terrain-tile",
                "probability": tile["probability"],
                "properties": [
                    {"name": "terrainClass", "type": "string", "value": terrain},
                    {"name": "terrainSignature", "type": "string", "value": ",".join(map(str, signature))},
                    {"name": "variant", "type": "int", "value": tile["variant"]},
                    {"name": "authoredWang", "type": "bool", "value": True},
                ],
            }
        )
        wangtiles.append({"tileid": tile["id"], "wangid": to_wangid(signature)})
    return {
        "type": "tileset",
        "version": "1.10",
        "tiledversion": "1.12.2",
        "name": "phase3-terrain-v2",
        "tilewidth": TILE_SIZE,
        "tileheight": TILE_SIZE,
        "tilecount": len(tiles),
        "columns": ATLAS_COLS,
        "image": image_path,
        "imagewidth": atlas_width,
        "imageheight": atlas_height,
        "transformations": {"hflip": False, "vflip": False, "rotate": False, "preferuntransformed": True},
        "properties": [
            {"name": "sourceOfTruth", "type": "bool", "value": True},
            {"name": "edgeStrategy", "type": "string", "value": "periodic-material-shared-mixed-wang"},
            {"name": "generator", "type": "string", "value": "scripts/asset-forge/build_terrain_v2.py"},
        ],
        "wangsets": [
            {
                "name": "Phase3TerrainV2",
                "type": "mixed",
                "tile": colors[4]["tile"],
                "colors": colors,
                "wangtiles": wangtiles,
            }
        ],
        "tiles": tile_entries,
    }


def binary_wangid(signature: tuple[int, int, int, int]) -> list[int]:
    nw, ne, sw, se = signature
    return [
        1 if nw and ne else 0,
        1 if ne else 0,
        1 if ne and se else 0,
        1 if se else 0,
        1 if sw and se else 0,
        1 if sw else 0,
        1 if nw and sw else 0,
        1 if nw else 0,
    ]


def cliff_edge_template(a: int, b: int, colors: np.ndarray) -> np.ndarray:
    edge = np.zeros((TILE_SIZE, 4), dtype=np.uint8)
    if a == b:
        return edge
    axis = np.linspace(0.0, 1.0, TILE_SIZE)
    occupancy = (1.0 - axis) * a + axis * b
    rim = np.abs(occupancy - 0.5) <= 0.075
    edge[rim, :3] = np.clip(colors[rim, :3] * 0.72 + np.array((62, 50, 42)) * 0.28, 0, 255).astype(np.uint8)
    edge[rim, 3] = 255
    return edge


def render_cliff_tile(signature: tuple[int, int, int, int], rock: Image.Image) -> Image.Image:
    nw, ne, sw, se = signature
    axis = np.linspace(0.0, 1.0, TILE_SIZE, dtype=np.float32)
    yy, xx = np.meshgrid(axis, axis, indexing="ij")
    weight = nw * (1 - xx) * (1 - yy) + ne * xx * (1 - yy) + sw * (1 - xx) * yy + se * xx * yy
    occupied = weight >= 0.5
    texture = np.asarray(rock.convert("RGB"), dtype=np.float32)
    output = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)

    # A south-facing vertical face: each non-rock pixel searches upward for
    # the nearest authored rock-top pixel. North-facing boundaries retain a
    # thin rim but no false vertical wall.
    for x in range(TILE_SIZE):
        for y in range(TILE_SIZE):
            if occupied[y, x]:
                below_is_open = y + 1 < TILE_SIZE and not occupied[y + 1, x]
                if below_is_open:
                    output[y, x, :3] = np.clip(texture[y, x] * 0.78 + np.array((78, 66, 54)) * 0.22, 0, 255)
                    output[y, x, 3] = 255
                continue
            depth = None
            for step in range(1, 11):
                source_y = y - step
                if source_y < 0:
                    break
                if occupied[source_y, x]:
                    depth = step
                    break
            if depth is None:
                continue
            factor = 0.64 - min(depth, 10) * 0.018
            vertical_band = 0.92 + 0.08 * math.sin((x + depth * 1.7) * math.pi / 5.0)
            output[y, x, :3] = np.clip(texture[(y - depth) % TILE_SIZE, x] * factor * vertical_band, 0, 255)
            output[y, x, 3] = 255 if depth <= 8 else max(0, 255 - (depth - 8) * 85)

    # Every outer edge depends only on its two Wang corner values. Compatible
    # neighboring tiles therefore share exactly the same RGBA border.
    top = cliff_edge_template(nw, ne, texture[0])
    bottom = cliff_edge_template(sw, se, texture[-1])
    left = cliff_edge_template(nw, sw, texture[:, 0])
    right = cliff_edge_template(ne, se, texture[:, -1])
    output[0, :] = top
    output[-1, :] = bottom
    output[:, 0] = left
    output[:, -1] = right
    output[0, 0] = output[0, -1] = output[-1, 0] = output[-1, -1] = (0, 0, 0, 0)
    return Image.fromarray(output, "RGBA")


def build_cliff_family(rock: Image.Image, image_path: str) -> tuple[Image.Image, dict[str, object], list[Image.Image]]:
    images: list[Image.Image] = []
    tiles = []
    wangtiles = []
    for bits in range(16):
        signature = tuple(1 if bits & (1 << index) else 0 for index in range(4))
        image = render_cliff_tile(signature, rock)
        images.append(image)
        tiles.append(
            {
                "id": bits,
                "type": "cliff-face",
                "class": "cliff-face",
                "properties": [
                    {"name": "cliffSignature", "type": "string", "value": ",".join(map(str, signature))},
                    {"name": "collisionSemantic", "type": "bool", "value": True},
                ],
            }
        )
        wangtiles.append({"tileid": bits, "wangid": binary_wangid(signature)})
    atlas = Image.new("RGBA", (4 * TILE_SIZE, 4 * TILE_SIZE), (0, 0, 0, 0))
    for index, image in enumerate(images):
        atlas.alpha_composite(image, ((index % 4) * TILE_SIZE, (index // 4) * TILE_SIZE))
    tileset = {
        "type": "tileset",
        "version": "1.10",
        "tiledversion": "1.12.2",
        "name": "phase3-cliffs-v2",
        "tilewidth": TILE_SIZE,
        "tileheight": TILE_SIZE,
        "tilecount": 16,
        "columns": 4,
        "image": image_path,
        "imagewidth": atlas.width,
        "imageheight": atlas.height,
        "transformations": {"hflip": False, "vflip": False, "rotate": False, "preferuntransformed": True},
        "wangsets": [
            {
                "name": "Phase3CliffV2",
                "type": "mixed",
                "tile": 15,
                "colors": [{"color": "#817563", "name": "cliff", "probability": 1, "tile": 15}],
                "wangtiles": wangtiles,
            }
        ],
        "tiles": tiles,
    }
    return atlas, tileset, images


def cliff_seam_qc(images: list[Image.Image]) -> dict[str, object]:
    arrays = [np.asarray(image.convert("RGBA"), dtype=np.int16) for image in images]
    signatures = [tuple(1 if bits & (1 << index) else 0 for index in range(4)) for bits in range(16)]
    horizontal = vertical = 0
    horizontal_max = vertical_max = 0
    for li, left in enumerate(signatures):
        for ri, right in enumerate(signatures):
            if left[1] == right[0] and left[3] == right[2]:
                horizontal += 1
                horizontal_max = max(horizontal_max, int(np.max(np.abs(arrays[li][:, -1] - arrays[ri][:, 0]))))
            if left[2] == right[0] and left[3] == right[1]:
                vertical += 1
                vertical_max = max(vertical_max, int(np.max(np.abs(arrays[li][-1, :] - arrays[ri][0, :]))))
    return {
        "horizontalCompatiblePairs": horizontal,
        "verticalCompatiblePairs": vertical,
        "horizontalMaxChannelDelta": horizontal_max,
        "verticalMaxChannelDelta": vertical_max,
        "passed": horizontal_max == 0 and vertical_max == 0,
    }


def compatible_horizontal(left: list[int], right: list[int]) -> bool:
    return left[2] == right[6] and left[1] == right[7] and left[3] == right[5]


def compatible_vertical(top: list[int], bottom: list[int]) -> bool:
    return top[4] == bottom[0] and top[5] == bottom[7] and top[3] == bottom[1]


def seam_qc(tile_images: list[Image.Image], tiles: list[dict[str, object]]) -> dict[str, object]:
    arrays = [np.asarray(image.convert("RGB"), dtype=np.int16) for image in tile_images]
    wangids = [to_wangid(tuple(int(value) for value in tile["signature"])) for tile in tiles]
    horizontal_count = 0
    vertical_count = 0
    horizontal_max = 0
    vertical_max = 0
    for left_index, left_wang in enumerate(wangids):
        for right_index, right_wang in enumerate(wangids):
            if compatible_horizontal(left_wang, right_wang):
                horizontal_count += 1
                horizontal_max = max(
                    horizontal_max,
                    int(np.max(np.abs(arrays[left_index][:, -1] - arrays[right_index][:, 0]))),
                )
            if compatible_vertical(left_wang, right_wang):
                vertical_count += 1
                vertical_max = max(
                    vertical_max,
                    int(np.max(np.abs(arrays[left_index][-1, :] - arrays[right_index][0, :]))),
                )

    corner_pixels: dict[tuple[int, str], set[tuple[int, int, int]]] = {}
    corner_specs = ((7, "nw", 0, 0), (1, "ne", 0, -1), (5, "sw", -1, 0), (3, "se", -1, -1))
    for index, wangid in enumerate(wangids):
        for wang_index, label, y, x in corner_specs:
            color = int(wangid[wang_index])
            corner_pixels.setdefault((color, label), set()).add(tuple(int(value) for value in arrays[index][y, x]))
    diagonal_variants = max(len(values) for values in corner_pixels.values())
    return {
        "horizontalCompatiblePairs": horizontal_count,
        "verticalCompatiblePairs": vertical_count,
        "horizontalMaxChannelDelta": horizontal_max,
        "verticalMaxChannelDelta": vertical_max,
        "diagonalCornerMaxColorVariants": diagonal_variants,
        "passed": horizontal_max == 0 and vertical_max == 0 and diagonal_variants == 1,
    }


def pattern_grid(low: int, high: int, mode: str, size: int = 9) -> list[list[int]]:
    grid = [[low for _ in range(size)] for _ in range(size)]
    for y in range(size):
        for x in range(size):
            dx = x - (size - 1) / 2
            dy = y - (size - 1) / 2
            if mode == "blob" and dx * dx + dy * dy <= 10.5:
                grid[y][x] = high
            elif mode == "hole":
                grid[y][x] = high
                if dx * dx + dy * dy <= 4.0:
                    grid[y][x] = low
            elif mode == "diagonal" and (x > y or (x in {2, 6} and y in {2, 6})):
                grid[y][x] = high
    return grid


def render_grid(
    grid: list[list[int]],
    tiles_by_signature: dict[tuple[int, int, int, int], list[Image.Image]],
    seed: str,
) -> Image.Image:
    rows = len(grid) - 1
    cols = len(grid[0]) - 1
    image = Image.new("RGB", (cols * TILE_SIZE, rows * TILE_SIZE))
    for y in range(rows):
        for x in range(cols):
            signature = (grid[y][x], grid[y][x + 1], grid[y + 1][x], grid[y + 1][x + 1])
            candidates = tiles_by_signature[signature]
            digest = hashlib.sha256(f"{seed}:{x},{y}:{signature}".encode("utf-8")).digest()
            tile = candidates[int.from_bytes(digest[:2], "big") % len(candidates)]
            image.paste(tile, (x * TILE_SIZE, y * TILE_SIZE))
    return image


def stress_sheet(
    tiles_by_signature: dict[tuple[int, int, int, int], list[Image.Image]],
) -> Image.Image:
    scale = 2
    panel_size = 8 * TILE_SIZE * scale
    gap = 12
    sheet = Image.new("RGB", (3 * panel_size + 4 * gap, 5 * panel_size + 6 * gap), (20, 27, 32))
    for row, pair in enumerate(LEGAL_PAIRS):
        for col, mode in enumerate(("blob", "hole", "diagonal")):
            panel = render_grid(pattern_grid(*pair, mode), tiles_by_signature, f"{pair}:{mode}")
            panel = panel.resize((panel_size, panel_size), Image.Resampling.NEAREST)
            sheet.paste(panel, (gap + col * (panel_size + gap), gap + row * (panel_size + gap)))
    return sheet


def decode_layer(layer: dict[str, object]) -> list[int]:
    data = layer.get("data")
    if isinstance(data, list):
        return [int(value) for value in data]
    if not isinstance(data, str):
        return []
    raw = base64.b64decode(data)
    compression = layer.get("compression")
    if compression == "zlib":
        raw = zlib.decompress(raw)
    elif compression == "gzip":
        raw = zlib.decompress(raw, zlib.MAX_WBITS | 16)
    return list(struct.unpack("<" + "I" * (len(raw) // 4), raw))


def encode_layer(layer: dict[str, object], gids: list[int]) -> None:
    if isinstance(layer.get("data"), list):
        layer["data"] = gids
        return
    raw = struct.pack("<" + "I" * len(gids), *gids)
    compression = layer.get("compression")
    if compression == "zlib":
        raw = zlib.compress(raw, level=9)
    elif compression == "gzip":
        import gzip

        raw = gzip.compress(raw, compresslevel=9)
    layer["data"] = base64.b64encode(raw).decode("ascii")


def install(
    root: Path,
    atlas_path: Path,
    staged_tileset: dict[str, object],
    cliff_atlas_path: Path,
    staged_cliff_tileset: dict[str, object],
    old_gid_to_signature: dict[int, tuple[int, int, int, int]],
    tile_records: list[dict[str, object]],
) -> None:
    source_atlas = root / "assets/source/phase3/atlases/terrain.png"
    source_tileset = root / "assets/source/phase3/tilesets/terrain.tsj"
    source_cliff_atlas = root / "assets/source/phase3/atlases/cliffs.png"
    source_cliff_tileset = root / "assets/source/phase3/tilesets/cliffs.tsj"
    source_map = root / "assets/source/phase3/maps/island-01.tmj"
    shutil.copyfile(atlas_path, source_atlas)
    shutil.copyfile(cliff_atlas_path, source_cliff_atlas)

    installed_tileset = json.loads(json.dumps(staged_tileset))
    installed_tileset["image"] = "../atlases/terrain.png"
    source_tileset.write_text(json.dumps(installed_tileset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    installed_cliff_tileset = json.loads(json.dumps(staged_cliff_tileset))
    installed_cliff_tileset["image"] = "../atlases/cliffs.png"
    source_cliff_tileset.write_text(json.dumps(installed_cliff_tileset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    primary: dict[tuple[int, int, int, int], list[int]] = {}
    for record in tile_records:
        signature = tuple(int(value) for value in record["signature"])
        primary.setdefault(signature, []).append(int(record["id"]) + 1)
    source = json.loads(source_map.read_text(encoding="utf-8"))
    terrain_layer = next(layer for layer in source["layers"] if layer["name"] == "TerrainBase")
    old_gids = decode_layer(terrain_layer)
    width = int(source["width"])
    new_gids = []
    for index, old_gid in enumerate(old_gids):
        signature = old_gid_to_signature[int(old_gid)]
        candidates = primary[signature]
        if len(set(signature)) == 1:
            x = index % width
            y = index // width
            digest = hashlib.sha256(f"{x},{y},{signature[0]}".encode("utf-8")).digest()
            chosen = candidates[int.from_bytes(digest[:2], "big") % len(candidates)]
        else:
            chosen = candidates[0]
        new_gids.append(chosen)
    encode_layer(terrain_layer, new_gids)
    source["tilesets"][0]["source"] = "../tilesets/terrain.tsj"
    properties = source.setdefault("properties", [])
    properties = [item for item in properties if item.get("name") != "visualAssetVersion"]
    properties.append({"name": "visualAssetVersion", "type": "string", "value": "phase3-visual-v2"})
    source["properties"] = properties
    source_map.write_text(json.dumps(source, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def build(install_outputs: bool = False) -> dict[str, object]:
    root = root_dir()
    v2 = root / "assets/source/phase3/v2"
    raw_dir = v2 / "materials/raw"
    periodic_dir = v2 / "materials/periodic"
    atlas_dir = v2 / "atlases"
    tileset_dir = v2 / "tilesets"
    acceptance_dir = root / "acceptance/phase3/visual-v2"
    for directory in (periodic_dir, atlas_dir, tileset_dir, acceptance_dir):
        directory.mkdir(parents=True, exist_ok=True)

    existing_tileset_path = root / "assets/source/phase3/tilesets/terrain.tsj"
    existing_tileset = json.loads(existing_tileset_path.read_text(encoding="utf-8"))
    old_gid_to_signature = {
        int(item["tileid"]) + 1: signature_from_wangid([int(value) for value in item["wangid"]])
        for item in old_wang_tiles(existing_tileset)
    }
    signatures = required_signatures(old_gid_to_signature.values())

    periodic_materials: dict[int, Image.Image] = {}
    material_tiles: dict[int, Image.Image] = {}
    material_sources = []
    for index, terrain in enumerate(TERRAINS):
        source_path = raw_dir / MATERIAL_FILES[terrain]
        periodic = periodicize(Image.open(source_path))
        periodic.save(periodic_dir / f"{terrain}-periodic-v1.png")
        periodic_materials[index] = periodic
        material_tiles[index] = canonical_tile(periodic)
        material_sources.append(
            {
                "terrain": terrain,
                "path": source_path.relative_to(root).as_posix(),
                "sha256": sha256(source_path),
                "size": list(Image.open(source_path).size),
            }
        )

    palette = build_palette(material_tiles)
    tile_records: list[dict[str, object]] = []
    tile_images: list[Image.Image] = []
    tiles_by_signature: dict[tuple[int, int, int, int], list[Image.Image]] = {}
    variant_material_sets = {
        variant: shifted_materials(periodic_materials, variant)
        for variant in range(1, 4)
    }
    for signature in signatures:
        image = render_signature(signature, material_tiles, palette)
        variants = [image]
        for variant in range(1, 4):
            candidate = render_signature(signature, variant_material_sets[variant], palette)
            variants.append(lock_boundary(candidate, image))
        for variant, variant_image in enumerate(variants):
            tile_id = len(tile_records)
            probability = (1.0, 0.85, 0.75, 0.65)[variant]
            tile_records.append(
                {
                    "id": tile_id,
                    "signature": list(signature),
                    "variant": variant,
                    "probability": probability,
                }
            )
            tile_images.append(variant_image)
            tiles_by_signature.setdefault(signature, []).append(variant_image)

    rows = math.ceil(len(tile_images) / ATLAS_COLS)
    atlas = Image.new("RGB", (ATLAS_COLS * TILE_SIZE, rows * TILE_SIZE))
    for index, image in enumerate(tile_images):
        atlas.paste(image, ((index % ATLAS_COLS) * TILE_SIZE, (index // ATLAS_COLS) * TILE_SIZE))
    atlas_path = atlas_dir / "terrain-v2.png"
    atlas.save(atlas_path)

    tileset = make_tileset(tile_records, atlas.width, atlas.height, "../atlases/terrain-v2.png")
    tileset_path = tileset_dir / "terrain-v2.tsj"
    tileset_path.write_text(json.dumps(tileset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    cliff_atlas, cliff_tileset, cliff_images = build_cliff_family(material_tiles[5], "../atlases/cliffs-v2.png")
    cliff_atlas_path = atlas_dir / "cliffs-v2.png"
    cliff_tileset_path = tileset_dir / "cliffs-v2.tsj"
    cliff_atlas.save(cliff_atlas_path)
    cliff_tileset_path.write_text(json.dumps(cliff_tileset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cliff_seams = cliff_seam_qc(cliff_images)
    if not cliff_seams["passed"]:
        raise ValueError(f"Cliff seam QC failed: {cliff_seams}")
    cliff_preview = Image.new("RGBA", cliff_atlas.size, (101, 148, 57, 255))
    cliff_preview.alpha_composite(cliff_atlas)
    cliff_preview = cliff_preview.resize((cliff_preview.width * 3, cliff_preview.height * 3), Image.Resampling.NEAREST)
    cliff_preview_path = acceptance_dir / "cliffs-v2-atlas.png"
    cliff_preview.convert("RGB").save(cliff_preview_path)

    seam = seam_qc(tile_images, tile_records)
    if not seam["passed"]:
        raise ValueError(f"Terrain seam QC failed: {seam}")
    stress = stress_sheet(tiles_by_signature)
    stress_path = acceptance_dir / "terrain-v2-stress.png"
    stress.save(stress_path)

    contact = Image.new("RGB", (3 * 256, 2 * 256))
    for index, periodic in periodic_materials.items():
        contact.paste(periodic, ((index % 3) * 256, (index // 3) * 256))
    contact_path = acceptance_dir / "terrain-v2-materials.png"
    contact.save(contact_path)

    triple_signatures = [signature for signature in signatures if len(set(signature)) >= 3]
    report = {
        "schema": "aisland.terrain_asset_qc.v2",
        "passed": True,
        "tileSize": TILE_SIZE,
        "atlas": {
            "path": atlas_path.relative_to(root).as_posix(),
            "size": list(atlas.size),
            "tiles": len(tile_images),
            "columns": ATLAS_COLS,
        },
        "tileset": tileset_path.relative_to(root).as_posix(),
        "cliffs": {
            "atlas": cliff_atlas_path.relative_to(root).as_posix(),
            "tileset": cliff_tileset_path.relative_to(root).as_posix(),
            "tiles": 16,
            "seams": cliff_seams,
            "preview": cliff_preview_path.relative_to(root).as_posix(),
        },
        "signatures": {
            "total": len(signatures),
            "actualSource": len(set(old_gid_to_signature.values())),
            "tripleOrMore": len(triple_signatures),
            "legalPairFamilies": [[TERRAINS[a], TERRAINS[b]] for a, b in LEGAL_PAIRS],
        },
        "materials": material_sources,
        "seams": seam,
        "stressPreview": stress_path.relative_to(root).as_posix(),
        "materialPreview": contact_path.relative_to(root).as_posix(),
        "installed": install_outputs,
    }
    if install_outputs:
        install(root, atlas_path, tileset, cliff_atlas_path, cliff_tileset, old_gid_to_signature, tile_records)
    report_path = acceptance_dir / "terrain-v2-qc.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", help="Replace the Phase 3 source atlas/TSJ and rewrite TerrainBase GIDs after QC.")
    args = parser.parse_args()
    print(json.dumps(build(install_outputs=args.install), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
