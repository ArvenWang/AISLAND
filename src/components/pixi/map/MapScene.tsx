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

export type MapAgentView = {
  x: number;
  y: number;
  isAlive: boolean;
  name: string;
  action: { type: string; phase: string; progress: number } | null;
  sleeping: boolean;
  selected: boolean;
};

export type MapResourceView = { id: string; kind: string; x: number; y: number; stock: number };
export type MapGroundItemView = { itemId: string; kind: string; x: number; y: number };
export type MapFireView = { fireId: string; x: number; y: number; state: string };

type MapSceneProps = {
  onReady?: (handle: MapSceneHandle) => void;
  agents?: Record<string, MapAgentView>;
  resources?: MapResourceView[];
  groundItems?: MapGroundItemView[];
  fires?: MapFireView[];
  view?: string;
  followAgent?: string | null;
  zoomLevel?: number;
  onSelectAgent?: (id: string) => void;
};

const TILE = 32;

// characters.png is the 2x-scaled 16-col atlas: character c occupies
// 32px-cell row (c * 2): linche row 0, shilei row 2, suhe row 4.
const AGENT_ROW: Record<string, number> = { agent_a: 0, agent_b: 2, agent_c: 4 };
const AGENT_COLOR: Record<string, number> = { agent_a: 0x4aa3ff, agent_b: 0x46d96a, agent_c: 0xff9a4a };

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
    const state: {
      agentSprites: Map<string, { spr: PIXI.Sprite; label: PIXI.Text; ring: PIXI.Graphics; bg: PIXI.Graphics; shadow: PIXI.Graphics }>;
      moving: Set<string>;
      walkFrame: Map<string, number>;
      ticker: PIXI.Ticker | null;
      resourceLabels: Map<string, PIXI.Text>;
      itemMarks: Map<string, PIXI.Graphics>;
      fireMarks: Map<string, PIXI.Graphics>;
      charTex: PIXI.Texture | null;
    } = { agentSprites: new Map(), resourceLabels: new Map(), itemMarks: new Map(), fireMarks: new Map(), charTex: null, moving: new Set(), walkFrame: new Map(), ticker: null };
    (container as PIXI.Container & { __mvp2State?: typeof state }).__mvp2State = state;
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

      // Characters layer above actors, below foreground canopy.
      const charLayer = new PIXI.Container();
      container.addChild(charLayer);

      const charTex = (() => {
        const tex = assets.characters as PIXI.Texture | undefined;
        return tex ?? null;
      })();
      state.charTex = charTex;

      const createAgentSprite = (id: string) => {
        const spr = new PIXI.Sprite(charTex ?? PIXI.Texture.EMPTY);
        // Character body ~1.25 tiles wide x ~1.6 tiles tall (Animal Crossing
        // proportions), standing on the tile with a soft ground shadow.
        spr.width = 40;
        spr.height = 52;
        spr.anchor.set(0.5, 0.92);
        spr.eventMode = 'static';
        spr.cursor = 'pointer';
        spr.on('pointertap', () => props.onSelectAgent?.(id));
        const shadow = new PIXI.Graphics();
        shadow.beginFill(0x000000, 0.28);
        shadow.drawEllipse(0, 0, 13, 4.5);
        shadow.endFill();
        const label = new PIXI.Text('', { fontFamily: 'ui-sans-serif, system-ui', fontSize: 15, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
        label.anchor.set(0.5, 0);
        const bg = new PIXI.Graphics();
        bg.visible = false;
        const ring = new PIXI.Graphics();
        ring.visible = false;
        charLayer.addChild(shadow, bg, ring, spr, label);
        state.agentSprites.set(id, { spr, label, ring, bg, shadow });
      };
      for (const id of ['agent_a', 'agent_b', 'agent_c']) createAgentSprite(id);

      const updateAgentFrames = () => {
        const agents = props.agents ?? {};
        for (const [id, { spr, label, ring, bg, shadow }] of state.agentSprites) {
          const a = agents[id];
          if (!a) {
            spr.visible = false;
            label.visible = false;
            ring.visible = false;
            shadow.visible = false;
            continue;
          }
          spr.visible = true;
          label.visible = true;
          const px = a.x * TILE + TILE / 2;
          const py = a.y * TILE + TILE * 0.92;
          spr.position.set(px, py);
          shadow.position.set(px, py + 3);
          shadow.visible = a.isAlive;
          label.position.set(px, py + 18);
          label.text = a.isAlive ? a.name : `${a.name}（死亡）`;
          // Labels adapt to zoom: far overview shows only selected/acting
          // agents; close-up (>=1x) shows everyone, Animal-Crossing style.
          const closeUp = (props.zoomLevel ?? 0.5) >= 1;
          label.visible = closeUp || a.selected || !!a.action;
          if (bg && label.visible) {
            const w = label.width + 12;
            const h = label.height + 6;
            bg.clear();
            bg.beginFill(0x0b1526, 0.72);
            bg.drawRoundedRect(-w / 2, 0, w, h, 4);
            bg.endFill();
            bg.position.set(px, py + 18);
            bg.visible = a.selected || !!a.action;
          } else if (bg) {
            bg.visible = false;
          }
          spr.tint = a.isAlive ? 0xffffff : 0x666666;
          spr.alpha = a.isAlive ? 1 : 0.55;
          const moving = a.isAlive && !!a.action && ['move', 'approach', 'explore'].includes(a.action.type);
          if (moving) {
            state.moving.add(id);
            if (!state.walkFrame.has(id)) state.walkFrame.set(id, 0);
          } else {
            state.moving.delete(id);
          }
          ring.visible = !!a.selected;
          if (a.selected) {
            ring.clear();
            ring.lineStyle(2, AGENT_COLOR[id] ?? 0xffffff, 0.9);
            ring.drawCircle(px, py - 4, 20);
            ring.position.set(0, 0);
          }
          if (charTex) {
            const row = AGENT_ROW[id] ?? 0;
            // Time-driven walk cycle: the ticker advances moving agents'
            // frames; idle agents stay on frame 0.
            const col = state.moving.has(id) && state.ticker ? (state.walkFrame.get(id) ?? 0) : 0;
            spr.texture = new PIXI.Texture(charTex.baseTexture, new PIXI.Rectangle(col * 32, row * 32, 32, 32));
          }
        }
      };

      // Walk animation ticker: ~6fps leg cycle while an agent is moving.
      const tick = () => {
        if (!charTex || state.moving.size === 0) return;
        for (const id of state.moving) {
          const entry = state.agentSprites.get(id);
          if (!entry) continue;
          const next = ((state.walkFrame.get(id) ?? 0) + 1) % 3;
          state.walkFrame.set(id, next);
          const row = AGENT_ROW[id] ?? 0;
          entry.spr.texture = new PIXI.Texture(charTex.baseTexture, new PIXI.Rectangle((next + 1) * 32, row * 32, 32, 32));
        }
      };
      state.ticker = PIXI.Ticker.shared;
      state.ticker.add(tick);
      (container as PIXI.Container & { __mvp2Tick?: () => void }).__mvp2Tick = () => {
        state.ticker?.remove(tick);
      };

      // Resource stock labels.
      const updateResources = () => {
        const closeUp = (props.zoomLevel ?? 0.5) >= 1;
        for (const label of state.resourceLabels.values()) label.visible = false;
        for (const r of props.resources ?? []) {
          let label = state.resourceLabels.get(r.id);
          if (!label) {
            label = new PIXI.Text('', { fontFamily: 'ui-sans-serif', fontSize: 10, fill: 0x9fe8ff, stroke: 0x000000, strokeThickness: 2 });
            charLayer.addChild(label);
            state.resourceLabels.set(r.id, label);
          }
          const sym = r.kind === 'spring' ? '💧' : r.kind === 'berry_bush' ? '🍒' : '🪵';
          label.text = `${sym}${Math.round(r.stock)}`;
          label.position.set(r.x * TILE + 16, r.y * TILE - 2);
          label.visible = closeUp;
        }
      };

      // Ground item marks.
      const updateItems = () => {
        for (const g of state.itemMarks.values()) g.visible = false;
        for (const it of props.groundItems ?? []) {
          let g = state.itemMarks.get(it.itemId);
          if (!g) {
            g = new PIXI.Graphics();
            charLayer.addChild(g);
            state.itemMarks.set(it.itemId, g);
          }
          g.clear();
          g.beginFill(0xffe08a, 0.95);
          g.drawRoundedRect(0, 0, 14, 10, 2);
          g.endFill();
          g.position.set(it.x * TILE + 9, it.y * TILE + 8);
          g.visible = true;
        }
      };

      // Fire marks with glow.
      const updateFires = () => {
        for (const g of state.fireMarks.values()) g.visible = false;
        for (const f of props.fires ?? []) {
          let g = state.fireMarks.get(f.fireId);
          if (!g) {
            g = new PIXI.Graphics();
            charLayer.addChild(g);
            state.fireMarks.set(f.fireId, g);
          }
          g.clear();
          g.beginFill(0xffaa33, 0.9);
          g.drawCircle(0, 0, 10);
          g.endFill();
          g.beginFill(0xff5500, 0.5);
          g.drawCircle(0, 0, 18);
          g.endFill();
          g.position.set(f.x * TILE + 16, f.y * TILE + 16);
          g.visible = true;
        }
      };

      updateAgentFrames();
      updateResources();
      updateItems();
      updateFires();

      const applyWorld = () => {
        updateAgentFrames();
        updateResources();
        updateItems();
        updateFires();
      };
      (container as PIXI.Container & { __mvp2Apply?: () => void }).__mvp2Apply = applyWorld;

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
    (instance as PIXI.Container & { __mvp2Apply?: () => void }).__mvp2Apply?.();
  },
});

export function useMapSceneReady(handle: MapSceneHandle | null): void {
  const ref = useRef<MapSceneHandle | null>(null);
  useEffect(() => {
    if (handle) ref.current = handle;
  }, [handle]);
}
