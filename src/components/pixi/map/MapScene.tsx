// MVP2 map scene: chunked tile layers + props + y-sorted actors + foreground
// canopy + fog overlay. Camera culling via update(bounds).

import { PixiComponent } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { useEffect, useRef } from 'react';
import { ChunkedTileLayer, type Bounds } from './ChunkedTileLayer';
import { FogOverlay } from './FogOverlay';
import { loadMapAssets, type MapAssets } from './MapAssets';

export type MapSceneHandle = {
  update(bounds: Bounds): void;
  worldWidth: number;
  worldHeight: number;
};

type MapSceneProps = {
  onReady?: (handle: MapSceneHandle) => void;
};

const TILE = 32;

// Props atlas layout: cellSize x cellSize cells (props.png). Index from meta.
function propTexture(assets: MapAssets, tileIndex: number, w: number, h: number, sub?: { x: number; y: number; w: number; h: number }): PIXI.Texture {
  const cell = (assets.propMeta as { cellSize?: number }).cellSize ?? 112;
  const cx = (tileIndex % 8) * cell;
  const cy = Math.floor(tileIndex / 8) * cell;
  const rect = sub ? new PIXI.Rectangle(cx + sub.x, cy + sub.y, sub.w, sub.h) : new PIXI.Rectangle(cx, cy, w, h);
  return new PIXI.Texture(assets.props.baseTexture, rect);
}

export const MapScene = PixiComponent<MapSceneProps, PIXI.Container & { __handle?: MapSceneHandle }>('MapScene', {
  config: { destroy: false },
  create(props: MapSceneProps) {
    const container = new PIXI.Container() as PIXI.Container & { __handle?: MapSceneHandle };
    container.__handle = {
      update: () => undefined,
      worldWidth: 1,
      worldHeight: 1,
    };
    loadMapAssets().then((assets) => {
      const { map } = assets;
      const ground = new ChunkedTileLayer(map, assets.terrain, map.atlas.terrainCols, false);
      const decals = new ChunkedTileLayer(map, assets.decals, map.atlas.decalCols, true);
      const propsLayer = new PIXI.Container();
      const actorLayer = new PIXI.Container();
      const foreground = new PIXI.Container();
      const fog = new FogOverlay();
      container.addChild(ground, decals, propsLayer, actorLayer, foreground, fog);

      const meta = assets.propMeta as { props?: Record<string, { tile: number }>; items?: Record<string, { tile: number }>; tileSizes?: Array<[number, number]> };
      const tileOf = (name: string): { tile: number; w: number; h: number } | null => {
        const v = meta.props?.[name] ?? meta.items?.[name];
        if (!v) return null;
        const size = meta.tileSizes?.[v.tile] ?? [32, 32];
        return { tile: v.tile, w: size[0], h: size[1] };
      };

      // Trees: trunk in actor-sorted layer, canopy in foreground layer.
      const treeSprites: Array<{ trunk: PIXI.Sprite; canopy: PIXI.Sprite; footY: number }> = [];
      for (const o of map.objects) {
        if (o.type !== 'tree') continue;
        const variant = Number(o.properties.variant ?? 0);
        const info = tileOf(`tree_${variant}`);
        if (!info) continue;
        const canopyH = 70;
        const trunkH = info.h - canopyH;
        const trunkTex = propTexture(assets, info.tile, info.w, info.h, { x: 0, y: canopyH, w: info.w, h: trunkH });
        const canopyTex = propTexture(assets, info.tile, info.w, info.h, { x: 0, y: 0, w: info.w, h: canopyH });
        const trunk = new PIXI.Sprite(trunkTex);
        const canopy = new PIXI.Sprite(canopyTex);
        const baseY = o.y + o.height;
        trunk.position.set(o.x, baseY - trunkH);
        canopy.position.set(o.x, baseY - info.h);
        canopy.visible = false;
        const footY = baseY;
        treeSprites.push({ trunk, canopy, footY });
        actorLayer.addChild(trunk);
        foreground.addChild(canopy);
      }

      // Ground props (rocks, bushes, wood, wreckage, spring).
      const propSprites: Array<{ spr: PIXI.Sprite; footY: number }> = [];
      const propTypeToName: Record<string, string> = {
        rock: 'rock',
        berry_bush: 'berry_bush',
        wood_pile: 'wood_log',
        wreckage: 'wreckage',
        spring: 'spring',
      };
      for (const o of map.objects) {
        const name = propTypeToName[o.type];
        if (!name) continue;
        const info = tileOf(name);
        if (!info) continue;
        const spr = new PIXI.Sprite(propTexture(assets, info.tile, info.w, info.h));
        spr.position.set(o.x, o.y);
        const footY = o.y + o.height;
        propSprites.push({ spr, footY });
        propsLayer.addChild(spr);
      }

      // Spawn markers (subtle, for debugging the beach layout).
      for (const s of map.spawnPoints) {
        const m = new PIXI.Graphics();
        m.beginFill(0xffffff, 0.55);
        m.drawCircle(s.x * TILE + TILE / 2, s.y * TILE + TILE / 2, 4);
        m.endFill();
        propsLayer.addChild(m);
      }

      const sortActors = () => {
        const items: Array<{ obj: PIXI.DisplayObject; footY: number }> = [];
        for (const p of propSprites) items.push({ obj: p.spr, footY: p.footY });
        for (const t of treeSprites) items.push({ obj: t.trunk, footY: t.footY });
        items.sort((a, b) => a.footY - b.footY);
        for (const it of items) actorLayer.addChild(it.obj);
        actorLayer.sortableChildren = false;
      };
      sortActors();

      const worldWidth = map.width * TILE;
      const worldHeight = map.height * TILE;
      container.__handle = {
        update(bounds: Bounds) {
          ground.update(bounds);
          decals.update(bounds);
          const pad = 3 * TILE;
          const bx0 = bounds.x0 * TILE - pad;
          const by0 = bounds.y0 * TILE - pad;
          const bx1 = bounds.x1 * TILE + pad;
          const by1 = bounds.y1 * TILE + pad;
          propsLayer.visible = true;
          for (const p of propSprites) p.spr.visible = p.spr.x + p.spr.width >= bx0 && p.spr.x <= bx1 && p.spr.y + p.spr.height >= by0 && p.spr.y <= by1;
          for (const t of treeSprites) {
            t.canopy.visible = t.canopy.x + t.canopy.width >= bx0 && t.canopy.x <= bx1 && t.canopy.y + t.canopy.height >= by0 && t.canopy.y <= by1;
          }
        },
        worldWidth,
        worldHeight,
      };
      props.onReady?.(container.__handle);
    });
    return container;
  },
  applyProps(instance, _old, newProps) {
    if (newProps.onReady && instance.__handle) {
      newProps.onReady(instance.__handle);
    }
  },
});

export function useMapSceneReady(handle: MapSceneHandle | null): void {
  const ref = useRef<MapSceneHandle | null>(null);
  useEffect(() => {
    if (handle) ref.current = handle;
  }, [handle]);
}
