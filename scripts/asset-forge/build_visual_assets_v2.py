#!/usr/bin/env python3
"""Compile generated Phase 3 characters, props, decals, and effects.

The pipeline follows agent-sprite-forge's chroma-key/grid workflow, then adds
AISLAND-specific fixed anchors, state manifests, magenta decontamination, and
multi-background QC.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "assets/source/phase3/v2"
PHASE31 = ROOT / "assets/source/phase31/v1"
VENDOR = ROOT / "tools/asset-forge/vendor/agent-sprite-forge/generate2dsprite"
sys.path.insert(0, str(VENDOR))
from generate2dsprite import remove_bg_magenta  # type: ignore  # noqa: E402


CHAR_CELL = (64, 80)
CHAR_ATLAS_COLS = 16
ACTION_NAMES = (
    "observe",
    "low_reach",
    "consume",
    "offer",
    "receive",
    "refuse",
    "talk",
    "shout",
    "build_fire",
    "add_fuel",
    "search",
    "rest",
    "sleep",
    "wake",
    "exhausted",
    "death",
)
CHARACTERS = ("linche", "shilei", "suhe")


@dataclass(frozen=True)
class PropSpec:
    source: str
    rows: int
    cols: int
    index: int
    name: str
    target: tuple[int, int]
    category: str
    anchor: tuple[float, float] = (0.5, 1.0)
    layer: str = "world-sortable"
    source_root: str = "phase3"


PROP_SPECS = (
    *(PropSpec("vegetation-v1.png", 2, 3, i, f"tree_{i}", (128, 160), "prop", (0.5, 0.96), "tree-split") for i in range(6)),
    PropSpec("structural-v1.png", 3, 4, 0, "wreckage_full", (160, 112), "prop"),
    PropSpec("structural-v1.png", 3, 4, 1, "wreckage_searched", (160, 112), "prop"),
    PropSpec("structural-v1.png", 3, 4, 2, "wreckage_tail", (144, 104), "prop"),
    PropSpec("structural-v1.png", 3, 4, 3, "luggage_debris", (112, 72), "prop"),
    *(PropSpec("structural-v1.png", 3, 4, 4 + i, name, (104, 80), "resource", (0.5, 0.88)) for i, name in enumerate(("spring_full", "spring_used", "spring_low", "spring_dry"))),
    *(PropSpec("structural-v1.png", 3, 4, 8 + i, f"rock_{i}", ((76, 64), (76, 72), (80, 60), (72, 92))[i], "prop") for i in range(4)),
    *(PropSpec("resources-v1.png", 4, 4, i, name, (68, 52), "resource") for i, name in enumerate(("berry_full", "berry_used", "berry_depleted", "berry_regrowing"))),
    *(PropSpec("resources-v1.png", 4, 4, 4 + i, name, (68, 48), "resource") for i, name in enumerate(("wood_full", "wood_used", "wood_depleted", "wood_renewed"))),
    *(PropSpec("resources-v1.png", 4, 4, 8 + i, name, (68, 52), "fire") for i, name in enumerate(("fire_unlit", "fire_burning", "fire_weak", "fire_embers"))),
    *(PropSpec("resources-v1.png", 4, 4, 12 + i, name, (68, 52), "fire") for i, name in enumerate(("fire_out", "fire_newly_lit", "fire_steady", "fire_dying"))),
    *(PropSpec("items-v1.png", 2, 4, i, name, size, "item") for i, (name, size) in enumerate((
        ("water_bottle", (28, 36)),
        ("food_ration", (34, 28)),
        ("lighter", (22, 32)),
        ("tinder", (38, 30)),
        ("wood_log", (42, 28)),
        ("backpack", (44, 48)),
        ("water_bottle_empty", (28, 36)),
        ("first_aid", (36, 32)),
    ))),
    PropSpec("phase31-extensions-v1.png", 2, 4, 0, "tree_6", (128, 160), "prop", (0.5, 0.96), "tree-split", "phase31"),
    PropSpec("phase31-extensions-v1.png", 2, 4, 1, "tree_7", (128, 160), "prop", (0.5, 0.96), "tree-split", "phase31"),
    PropSpec("phase31-extensions-v1.png", 2, 4, 2, "rock_4", (84, 70), "prop", (0.5, 0.94), "world-sortable", "phase31"),
    PropSpec("phase31-extensions-v1.png", 2, 4, 3, "rock_5", (88, 68), "prop", (0.5, 0.94), "world-sortable", "phase31"),
    PropSpec("phase31-extensions-v1.png", 2, 4, 4, "debris_luggage_0", (92, 64), "prop", (0.5, 0.92), "world-sortable", "phase31"),
    PropSpec("phase31-extensions-v1.png", 2, 4, 5, "debris_luggage_1", (84, 58), "prop", (0.5, 0.92), "world-sortable", "phase31"),
    PropSpec("phase31-extensions-v1.png", 2, 4, 6, "debris_luggage_2", (96, 64), "prop", (0.5, 0.92), "world-sortable", "phase31"),
    PropSpec("phase31-extensions-v1.png", 2, 4, 7, "landmark_rock", (144, 176), "prop", (0.5, 0.96), "world-sortable", "phase31"),
)


def prop_source_path(spec: PropSpec) -> Path:
    root = PHASE31 if spec.source_root == "phase31" else V2
    return root / "props/raw" / spec.source


def asset_semantics(name: str) -> dict[str, object]:
    common: dict[str, object] = {"assetId": name, "reusePolicy": "repeatable"}
    if name.startswith("tree_"):
        return {**common, "variantGroup": "tree", "minSameVariantDistance": 3, "collisionFootprint": [1, 1], "interactionPoint": [0.5, 0.96]}
    if name.startswith("rock_"):
        return {**common, "variantGroup": "rock", "maxInstances": 28, "minSameVariantDistance": 3, "collisionFootprint": [1, 1], "interactionPoint": [0.5, 0.94]}
    if name in {"wreckage_full", "wreckage_searched", "wreck_fuselage_full", "wreck_fuselage_searched"}:
        return {**common, "reusePolicy": "unique", "maxInstances": 1, "stateGroup": "wreck_fuselage", "collisionFootprint": [5, 2], "interactionPoint": [0.58, 0.82]}
    if name in {"wreckage_tail", "wreck_tail"}:
        return {**common, "reusePolicy": "limited", "maxInstances": 1, "variantGroup": "crash_structure", "collisionFootprint": [3, 2], "interactionPoint": [0.5, 0.9]}
    if name in {"luggage_debris", "debris_luggage_0", "debris_luggage_1", "debris_luggage_2"}:
        return {**common, "variantGroup": "crash_debris", "maxInstances": 5, "minSameVariantDistance": 2, "collisionFootprint": [1, 1], "interactionPoint": [0.5, 0.92]}
    if name == "landmark_rock":
        return {**common, "reusePolicy": "unique", "maxInstances": 1, "variantGroup": "landmark", "collisionFootprint": [2, 2], "interactionPoint": [0.5, 0.96]}
    if name.startswith("spring_"):
        return {**common, "reusePolicy": "stateful", "maxInstances": 1, "stateGroup": "spring", "collisionFootprint": [2, 2], "interactionPoint": [0.5, 0.88]}
    if name.startswith("berry_"):
        return {**common, "reusePolicy": "stateful", "maxInstances": 4, "variantGroup": "food_resource", "stateGroup": "berry_bush", "collisionFootprint": [1, 1], "interactionPoint": [0.5, 1.0]}
    if name in {"wood_full", "wood_used", "wood_depleted", "wood_renewed"}:
        return {**common, "reusePolicy": "stateful", "maxInstances": 6, "variantGroup": "wood_source", "stateGroup": "wood_pile", "collisionFootprint": [1, 1], "interactionPoint": [0.5, 1.0]}
    if name.startswith("fire_"):
        return {**common, "reusePolicy": "stateful", "stateGroup": "fire", "collisionFootprint": [1, 1], "interactionPoint": [0.5, 1.0]}
    return {**common, "collisionFootprint": [1, 1], "interactionPoint": [0.5, 1.0]}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def grid_cell(image: Image.Image, rows: int, cols: int, index: int) -> Image.Image:
    row, col = divmod(index, cols)
    x0 = round(col * image.width / cols)
    x1 = round((col + 1) * image.width / cols)
    y0 = round(row * image.height / rows)
    y1 = round((row + 1) * image.height / rows)
    return image.crop((x0, y0, x1, y1))


def magenta_mask(array: np.ndarray) -> np.ndarray:
    rgb = array[..., :3].astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (np.minimum(r, b) - g > 24) & (np.abs(r - b) < 92) & (np.maximum(r, b) > 34)


def neighbor_transparency(alpha: np.ndarray) -> np.ndarray:
    transparent = alpha == 0
    padded = np.pad(transparent, 1, constant_values=True)
    result = np.zeros_like(transparent)
    for dy in range(3):
        for dx in range(3):
            if dx == 1 and dy == 1:
                continue
            result |= padded[dy : dy + alpha.shape[0], dx : dx + alpha.shape[1]]
    return result


def decontaminate(image: Image.Image, passes: int = 3) -> Image.Image:
    array = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    for _ in range(passes):
        alpha = array[..., 3]
        contaminated = magenta_mask(array) & (alpha > 0) & neighbor_transparency(alpha)
        if not np.any(contaminated):
            break
        array[contaminated] = (0, 0, 0, 0)
    # Remove low-alpha chroma residue after resampling while preserving the
    # opaque authored palette.
    residue = magenta_mask(array) & (array[..., 3] < 210)
    array[residue] = (0, 0, 0, 0)
    return Image.fromarray(array, "RGBA")


def clean_chroma(image: Image.Image) -> Image.Image:
    cleaned = remove_bg_magenta(image.convert("RGBA"), threshold=96, edge_threshold=172)
    return decontaminate(cleaned)


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        raise ValueError("Generated grid cell became empty after chroma removal")
    return bbox


def resize_subject(subject: Image.Image, width: int, height: int) -> Image.Image:
    resized = subject.resize((max(1, width), max(1, height)), Image.Resampling.LANCZOS)
    resized = ImageEnhance.Sharpness(resized).enhance(1.22)
    return decontaminate(resized)


def filter_components(image: Image.Image, min_area: int = 1, keep_largest: bool = False) -> Image.Image:
    array = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    alpha = array[..., 3]
    height, width = alpha.shape
    seen = np.zeros((height, width), dtype=bool)
    components: list[list[tuple[int, int]]] = []
    for y in range(height):
        for x in range(width):
            if seen[y, x] or alpha[y, x] == 0:
                continue
            stack = [(x, y)]
            seen[y, x] = True
            component: list[tuple[int, int]] = []
            while stack:
                cx, cy = stack.pop()
                component.append((cx, cy))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < width and 0 <= ny < height and not seen[ny, nx] and alpha[ny, nx] > 0:
                            seen[ny, nx] = True
                            stack.append((nx, ny))
            components.append(component)
    if not components:
        return image
    allowed = {id(max(components, key=len))} if keep_largest else {id(component) for component in components if len(component) >= min_area}
    for component in components:
        if id(component) in allowed:
            continue
        for x, y in component:
            array[y, x] = (0, 0, 0, 0)
    return Image.fromarray(array, "RGBA")


def fit_subject(image: Image.Image, target: tuple[int, int], margin: int = 2) -> Image.Image:
    bbox = alpha_bbox(image)
    subject = image.crop(bbox)
    scale = min((target[0] - 2 * margin) / subject.width, (target[1] - 2 * margin) / subject.height)
    width = max(1, round(subject.width * scale))
    height = max(1, round(subject.height * scale))
    subject = resize_subject(subject, width, height)
    canvas = Image.new("RGBA", target, (0, 0, 0, 0))
    x = (target[0] - width) // 2
    y = target[1] - margin - height
    canvas.alpha_composite(subject, (x, y))
    return canvas


def normalized_character_frame(image: Image.Image, scale: float, local_index: int, action: bool) -> Image.Image:
    subject = image.crop(alpha_bbox(image))
    width = max(1, round(subject.width * scale))
    height = max(1, round(subject.height * scale))
    subject = resize_subject(subject, width, height)
    canvas = Image.new("RGBA", CHAR_CELL, (0, 0, 0, 0))
    baseline = 73
    if action and local_index in (12, 15):
        baseline = 68
    x = (CHAR_CELL[0] - width) // 2
    y = baseline - height
    if x < 1 or y < 1 or x + width >= CHAR_CELL[0] or y + height >= CHAR_CELL[1]:
        emergency = min((CHAR_CELL[0] - 4) / width, (CHAR_CELL[1] - 6) / height, 1.0)
        width = max(1, round(width * emergency))
        height = max(1, round(height * emergency))
        subject = resize_subject(subject, width, height)
        x = (CHAR_CELL[0] - width) // 2
        y = baseline - height
    canvas.alpha_composite(subject, (x, y))
    return filter_components(canvas, keep_largest=True)


def character_sheet_cells(path: Path) -> list[Image.Image]:
    source = Image.open(path).convert("RGBA")
    return [clean_chroma(grid_cell(source, 4, 4, index)) for index in range(16)]


def build_characters(staged: Path) -> tuple[dict[str, object], list[Image.Image]]:
    total_frames = len(CHARACTERS) * 32
    rows = math.ceil(total_frames / CHAR_ATLAS_COLS)
    atlas = Image.new("RGBA", (CHAR_ATLAS_COLS * CHAR_CELL[0], rows * CHAR_CELL[1]), (0, 0, 0, 0))
    metadata: dict[str, object] = {
        "version": "phase3-characters-v2",
        "atlas": {"width": atlas.width, "height": atlas.height, "cell": list(CHAR_CELL), "columns": CHAR_ATLAS_COLS},
        "characters": {},
    }
    all_frames: list[Image.Image] = []
    for character_index, character in enumerate(CHARACTERS):
        locomotion_path = V2 / f"characters/raw/{character}-locomotion-v1.png"
        action_path = V2 / f"characters/raw/{character}-actions-v1.png"
        locomotion = character_sheet_cells(locomotion_path)
        actions = character_sheet_cells(action_path)
        loc_heights = [alpha_bbox(frame)[3] - alpha_bbox(frame)[1] for frame in locomotion]
        action_heights = [alpha_bbox(actions[i])[3] - alpha_bbox(actions[i])[1] for i in range(12)] + [alpha_bbox(actions[14])[3] - alpha_bbox(actions[14])[1]]
        loc_scale = 58.0 / float(np.median(loc_heights))
        action_scale = 58.0 / float(np.median(action_heights))
        processed = [normalized_character_frame(frame, loc_scale, i, False) for i, frame in enumerate(locomotion)]
        processed += [normalized_character_frame(frame, action_scale, i, True) for i, frame in enumerate(actions)]
        first = character_index * 32
        frame_meta = []
        for local_index, frame in enumerate(processed):
            frame_index = first + local_index
            x = (frame_index % CHAR_ATLAS_COLS) * CHAR_CELL[0]
            y = (frame_index // CHAR_ATLAS_COLS) * CHAR_CELL[1]
            atlas.alpha_composite(frame, (x, y))
            bbox = alpha_bbox(frame)
            frame_meta.append({"index": frame_index, "rect": [x, y, *CHAR_CELL], "alphaBBox": list(bbox)})
            all_frames.append(frame)
        directions = {}
        for direction_index, direction in enumerate(("down", "left", "right", "up")):
            start = first + direction_index * 4
            directions[direction] = {"idle": [start], "walk": [start, start + 1, start + 2, start + 3]}
        metadata["characters"][character] = {  # type: ignore[index]
            "firstFrame": first,
            "frameCount": 32,
            "displaySize": list(CHAR_CELL),
            "anchor": [0.5, 0.9125],
            "footY": 73,
            "directions": directions,
            "actions": {name: first + 16 + index for index, name in enumerate(ACTION_NAMES)},
            "frames": frame_meta,
            "source": {
                "locomotion": locomotion_path.relative_to(ROOT).as_posix(),
                "actions": action_path.relative_to(ROOT).as_posix(),
                "locomotionSha256": sha256(locomotion_path),
                "actionsSha256": sha256(action_path),
            },
        }
    atlas.save(staged / "characters.png")
    (staged / "characters.meta.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata, all_frames


def shelf_pack(images: Sequence[tuple[str, Image.Image]], width: int = 1024, padding: int = 4) -> tuple[Image.Image, dict[str, list[int]]]:
    placements: dict[str, list[int]] = {}
    x = y = padding
    row_height = 0
    for name, image in images:
        if x + image.width + padding > width:
            x = padding
            y += row_height + padding
            row_height = 0
        placements[name] = [x, y, image.width, image.height]
        x += image.width + padding
        row_height = max(row_height, image.height)
    height = y + row_height + padding
    atlas_height = 1 << max(1, (height - 1).bit_length())
    atlas = Image.new("RGBA", (width, atlas_height), (0, 0, 0, 0))
    for name, image in images:
        px, py, _, _ = placements[name]
        atlas.alpha_composite(image, (px, py))
    return atlas, placements


def build_props(staged: Path) -> tuple[dict[str, object], dict[str, Image.Image]]:
    cache: dict[str, Image.Image] = {}
    processed: dict[str, Image.Image] = {}
    specs_by_name: dict[str, PropSpec] = {}
    for spec in PROP_SPECS:
        source_path = prop_source_path(spec)
        cache_key = source_path.as_posix()
        if cache_key not in cache:
            cache[cache_key] = Image.open(source_path).convert("RGBA")
        cell = grid_cell(cache[cache_key], spec.rows, spec.cols, spec.index)
        sprite = fit_subject(clean_chroma(cell), spec.target)
        if spec.name in {"luggage_debris", "wood_depleted"}:
            sprite = filter_components(sprite, min_area=3)
        else:
            sprite = filter_components(sprite, keep_largest=True)
        processed[spec.name] = sprite
        specs_by_name[spec.name] = spec
    atlas, placements = shelf_pack(list(processed.items()))
    atlas.save(staged / "props.png")
    entries = {}
    for name, image in processed.items():
        spec = specs_by_name[name]
        source_path = prop_source_path(spec)
        entry = {
            "rect": placements[name],
            "displaySize": list(image.size),
            "anchor": list(spec.anchor),
            "category": spec.category,
            "layer": spec.layer,
            "source": source_path.relative_to(ROOT).as_posix(),
            "sourceGrid": [spec.rows, spec.cols, spec.index],
            **asset_semantics(name),
        }
        if name.startswith("tree_"):
            entry["canopySplitY"] = round(image.height * 0.68)
            entry["collisionFootprint"] = [1, 1]
        entries[name] = entry
    aliases = {
        "rock": "rock_0",
        "rock_alt": "rock_1",
        "wreckage": "wreckage_full",
        "wreck_fuselage_full": "wreckage_full",
        "wreck_fuselage_searched": "wreckage_searched",
        "wreck_tail": "wreckage_tail",
        "spring": "spring_full",
        "berry_bush": "berry_full",
        "wood_pile": "wood_full",
        "campfire": "fire_burning",
    }
    world_asset_meta: dict[str, dict[str, object]] = {}
    for asset_id, entry in entries.items():
        world_asset_meta[asset_id] = {
            key: entry[key]
            for key in (
                "assetId", "variantGroup", "reusePolicy", "maxInstances",
                "minSameVariantDistance", "displaySize", "anchor",
                "collisionFootprint", "interactionPoint", "stateGroup",
            )
            if key in entry
        }
    for asset_id, target in aliases.items():
        target_entry = entries[target]
        world_asset_meta[asset_id] = {
            "displaySize": target_entry["displaySize"],
            "anchor": target_entry["anchor"],
            **asset_semantics(asset_id),
        }
    metadata = {
        "version": "phase31-props-v1",
        "atlas": {"width": atlas.width, "height": atlas.height},
        "entries": entries,
        "aliases": aliases,
        "worldAssetMeta": world_asset_meta,
        "resourceStates": {
            "wreck_fuselage": {"full": "wreck_fuselage_full", "searched": "wreck_fuselage_searched"},
            "spring": {"full": "spring_full", "used": "spring_used", "low": "spring_low", "depleted": "spring_dry"},
            "berry_bush": {"full": "berry_full", "used": "berry_used", "depleted": "berry_depleted", "regrowing": "berry_regrowing"},
            "wood_pile": {"full": "wood_full", "used": "wood_used", "depleted": "wood_depleted", "regrowing": "wood_renewed"},
            "fire": {"unlit": "fire_unlit", "burning": "fire_burning", "weak": "fire_weak", "embers": "fire_embers", "out": "fire_out"},
        },
        "items": {name: name for name in ("water_bottle", "food_ration", "lighter", "tinder", "wood_log", "backpack", "water_bottle_empty", "first_aid")},
        "reusePolicySchema": {
            "allowed": ["unique", "limited", "repeatable", "stateful"],
            "uniqueStateGroupsCountAsOneEntity": True,
        },
    }
    (staged / "props.meta.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata, processed


def build_grid_atlas(source_path: Path, rows: int, cols: int, target: tuple[int, int]) -> tuple[Image.Image, list[Image.Image]]:
    source = Image.open(source_path).convert("RGBA")
    frames = [fit_subject(clean_chroma(grid_cell(source, rows, cols, index)), target) for index in range(rows * cols)]
    atlas = Image.new("RGBA", (cols * target[0], rows * target[1]), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, ((index % cols) * target[0], (index // cols) * target[1]))
    return atlas, frames


def build_decals(staged: Path) -> list[Image.Image]:
    atlas, frames = build_grid_atlas(V2 / "props/raw/decals-v1.png", 4, 4, (32, 32))
    atlas.save(staged / "decals.png")
    metadata = {
        "version": "phase3-decals-v2",
        "tileSize": 32,
        "columns": 4,
        "entries": {
            name: {"gid": index + 1, "rect": [(index % 4) * 32, (index // 4) * 32, 32, 32]}
            for index, name in enumerate((
                "sand_shells", "wet_pebbles", "footprints", "drift_fragments",
                "leaf_litter", "fern_fronds", "bare_earth", "wild_leaves",
                "path_center", "path_left", "path_right", "path_fork",
                "moist_soil", "dense_litter", "twigs", "mossy_stones",
            ))
        },
    }
    (staged / "decals.meta.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return frames


def build_effects(staged: Path) -> tuple[dict[str, object], list[Image.Image]]:
    frames: list[Image.Image] = []
    sources = (V2 / "effects/raw/effects-a-v1.png", V2 / "effects/raw/effects-b-v1.png")
    for source in sources:
        _, source_frames = build_grid_atlas(source, 4, 4, (64, 64))
        frames.extend(source_frames)
    cols = 8
    rows = 4
    atlas = Image.new("RGBA", (cols * 64, rows * 64), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, ((index % cols) * 64, (index // cols) * 64))
    atlas.save(staged / "effects.png")
    sequences = {
        "pickup": [0, 1, 2, 3],
        "handover": [4, 5, 6, 7],
        "shout": [8, 9, 10, 11],
        "fire_light": [12, 13, 14, 15],
        "shore_foam": [16, 17, 18, 19],
        "harvest": [20, 21, 22, 23],
        "refuse": [24, 25, 26, 27],
        "sleep": [28, 29, 30, 31],
    }
    metadata = {
        "version": "phase3-effects-v2",
        "atlas": {"width": atlas.width, "height": atlas.height, "cell": [64, 64], "columns": cols},
        "sequences": sequences,
        "frameMs": {"pickup": 90, "handover": 100, "shout": 120, "fire_light": 180, "shore_foam": 180, "harvest": 100, "refuse": 110, "sleep": 260},
    }
    (staged / "effects.meta.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata, frames


def magenta_qc(images: Iterable[Image.Image]) -> dict[str, int | float]:
    pixels = 0
    residue = 0
    magenta_hue = 0
    visible = 0
    edge_touches = 0
    for image in images:
        array = np.asarray(image.convert("RGBA"), dtype=np.uint8)
        alpha = array[..., 3]
        pixels += int(alpha.size)
        visible += int(np.count_nonzero(alpha))
        rgb = array[..., :3].astype(np.float32)
        chroma_distance = np.sqrt((rgb[..., 0] - 255.0) ** 2 + rgb[..., 1] ** 2 + (rgb[..., 2] - 255.0) ** 2)
        # Strict residual means a visible pixel remains close enough to the
        # actual #FF00FF key to flash as a fringe. Broader magenta-like hues
        # are reported separately because purple luggage and coral feedback
        # are legitimate authored colors, not background contamination.
        residue += int(np.count_nonzero((chroma_distance < 120.0) & (alpha > 0)))
        magenta_hue += int(np.count_nonzero(magenta_mask(array) & (alpha > 0)))
        if np.any(alpha[0]) or np.any(alpha[-1]) or np.any(alpha[:, 0]) or np.any(alpha[:, -1]):
            edge_touches += 1
    return {
        "visiblePixels": visible,
        "magentaResiduePixels": residue,
        "magentaResidueRatio": residue / max(1, visible),
        "magentaLikeHuePixelsInformational": magenta_hue,
        "edgeTouchFrames": edge_touches,
        "scannedPixels": pixels,
    }


def make_gallery(path: Path, titled: Sequence[tuple[str, Image.Image]], cell: tuple[int, int], columns: int) -> None:
    rows = math.ceil(len(titled) / columns)
    sheet = Image.new("RGB", (columns * cell[0], rows * cell[1]), (22, 30, 32))
    draw = ImageDraw.Draw(sheet)
    backgrounds = ((231, 188, 101), (91, 139, 56), (238, 238, 232), (22, 30, 32))
    for index, (name, image) in enumerate(titled):
        x = (index % columns) * cell[0]
        y = (index // columns) * cell[1]
        draw.rectangle((x, y, x + cell[0], y + cell[1]), fill=backgrounds[index % len(backgrounds)])
        px = x + (cell[0] - image.width) // 2
        py = y + cell[1] - image.height - 12
        sheet.paste(image, (px, py), image)
        draw.rectangle((x, y + cell[1] - 12, x + cell[0], y + cell[1]), fill=(10, 15, 18))
        draw.text((x + 3, y + cell[1] - 11), name[:22], fill=(238, 238, 232))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def install(staged: Path) -> None:
    target = ROOT / "assets/source/phase3/atlases"
    for name in (
        "characters.png",
        "characters.meta.json",
        "props.png",
        "props.meta.json",
        "decals.png",
        "decals.meta.json",
        "effects.png",
        "effects.meta.json",
    ):
        shutil.copyfile(staged / name, target / name)


def build(install_outputs: bool) -> dict[str, object]:
    staged = V2 / "atlases"
    staged.mkdir(parents=True, exist_ok=True)
    char_meta, character_frames = build_characters(staged)
    prop_meta, props = build_props(staged)
    decal_frames = build_decals(staged)
    effect_meta, effect_frames = build_effects(staged)
    qc = {
        "characters": magenta_qc(character_frames),
        "props": magenta_qc(props.values()),
        "decals": magenta_qc(decal_frames),
        "effects": magenta_qc(effect_frames),
    }
    passed = all(float(result["magentaResidueRatio"]) <= 0.001 for result in qc.values())
    if not passed:
        raise ValueError(f"Visual chroma QC failed: {qc}")
    acceptance = ROOT / "acceptance/phase31/assets"
    character_gallery = []
    for char_index, character in enumerate(CHARACTERS):
        offset = char_index * 32
        for local in (0, 4, 8, 12, 16, 17, 19, 21, 23, 24, 27, 28, 30, 31):
            character_gallery.append((f"{character}:{local}", character_frames[offset + local]))
    make_gallery(acceptance / "characters-gallery.png", character_gallery, (96, 108), 7)
    make_gallery(acceptance / "props-gallery.png", list(props.items()), (180, 184), 6)
    make_gallery(acceptance / "effects-gallery.png", [(str(i), frame) for i, frame in enumerate(effect_frames)], (84, 84), 8)
    report = {
        "schema": "aisland.phase31.visual_asset_qc.v1",
        "passed": passed,
        "installed": install_outputs,
        "upstreamMethod": "agent-sprite-forge chroma-grid-anchor-manifest",
        "characters": {"atlas": "assets/source/phase3/v2/atlases/characters.png", "count": 3, "frames": 96, "qc": qc["characters"]},
        "props": {"atlas": "assets/source/phase3/v2/atlases/props.png", "count": len(props), "qc": qc["props"]},
        "decals": {"atlas": "assets/source/phase3/v2/atlases/decals.png", "count": 16, "qc": qc["decals"]},
        "effects": {"atlas": "assets/source/phase3/v2/atlases/effects.png", "count": 32, "qc": qc["effects"]},
        "galleries": [
            "acceptance/phase31/assets/characters-gallery.png",
            "acceptance/phase31/assets/props-gallery.png",
            "acceptance/phase31/assets/effects-gallery.png",
        ],
        "manifests": {
            "characters": char_meta,
            "propsVersion": prop_meta["version"],
            "effectsVersion": effect_meta["version"],
        },
    }
    if install_outputs:
        install(staged)
    (acceptance / "visual-assets-qc.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    args = parser.parse_args()
    print(json.dumps(build(args.install), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
