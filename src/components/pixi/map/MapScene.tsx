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
  facing?: { x: number; y: number };
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

// characters.png is the 2x-scaled 16-col atlas with 64px cells: each
// character occupies one 64px row (linche 0, shilei 1, suhe 2). Every
// character has 16 frames laid out as 4 direction blocks x 4 walk frames:
// cols 0-3 down, 4-7 left, 8-11 right, 12-15 up (dirOrder in meta).
const AGENT_ROW: Record<string, number> = { agent_a: 0, agent_b: 1, agent_c: 2 };
const CELL = 64;
const FRAME_SIZE = 32;
const WALK_FRAMES = 4;
const DIR_BLOCK: Record<string, number> = { down: 0, left: 1, right: 2, up: 3 };
const AGENT_COLOR: Record<string, number> = { agent_a: 0x4aa3ff, agent_b: 0x46d96a, agent_c: 0xff9a4a };

function dirIndexOf(facing?: { x: number; y: number }): number {
  if (!facing) return 0;
  if (facing.y > 0) return DIR_BLOCK.down;
  if (facing.x < 0) return DIR_BLOCK.left;
  if (facing.x > 0) return DIR_BLOCK.right;
  return DIR_BLOCK.up;
}

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
    // PixiComponent only calls create() once; keep a live reference to the
    // latest props so internal closures always read fresh agent positions
    // instead of the very first render's snapshot.
    let liveProps: MapSceneProps = props;
    const state: {
      agentSprites: Map<string, { spr: PIXI.Sprite; label: PIXI.Text; ring: PIXI.Graphics; bg: PIXI.Graphics; shadow: PIXI.Graphics }>;
      moving: Set<string>;
      walkFrame: Map<string, number>;
      walkTextures: Map<string, Array<PIXI.Texture>>;
      idleTextures: Map<string, PIXI.Texture>;
      frameTextures: Map<string, Array<PIXI.Texture>>;
      frameAcc: number;
      targetPos: Map<string, { x: number; y: number }>;
      ticker: PIXI.Ticker | null;
      resourceLabels: Map<string, PIXI.Text>;
      itemMarks: Map<string, PIXI.Graphics>;
      fireMarks: Map<string, PIXI.Graphics>;
      charTex: PIXI.Texture | null;
    } = { agentSprites: new Map(), resourceLabels: new Map(), itemMarks: new Map(), fireMarks: new Map(), charTex: null, moving: new Set(), walkFrame: new Map(), walkTextures: new Map(), idleTextures: new Map(), frameTextures: new Map(), frameAcc: 0, targetPos: new Map(), ticker: null };
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
        spr.on('pointertap', () => liveProps.onSelectAgent?.(id));
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
        const agents = liveProps.agents ?? {};
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
          // Server-authoritative target; the ticker interpolates the sprite
          // towards it so movement renders continuously (PRD 18.1 client
          // interpolation) instead of snapping once per game step.
          const current = state.targetPos.get(id);
          if (!current) {
            spr.position.set(px, py);
            state.targetPos.set(id, { x: px, y: py });
          } else {
            state.targetPos.set(id, { x: px, y: py });
          }
          shadow.visible = a.isAlive;
          label.text = a.isAlive ? a.name : `${a.name}（死亡）`;
          // Labels adapt to zoom: far overview shows only selected/acting
          // agents; close-up (>=1x) shows everyone, Animal-Crossing style.
          const closeUp = (liveProps.zoomLevel ?? 0.5) >= 1;
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
            // 16 frames per character: 4 direction blocks x 4 walk frames.
            let frames = state.frameTextures.get(id);
            if (!frames) {
              frames = Array.from({ length: 16 }, (_, i) => new PIXI.Texture(charTex.baseTexture, new PIXI.Rectangle(i * CELL, row * CELL, FRAME_SIZE, FRAME_SIZE)));
              state.frameTextures.set(id, frames);
            }
            const dir = dirIndexOf(a.facing);
            const moving = state.moving.has(id) && state.ticker;
            spr.texture = moving ? frames[dir * WALK_FRAMES + (state.walkFrame.get(id) ?? 0)] : frames[dir * WALK_FRAMES];
          }
        }
      };

      // Walk animation ticker: advance one leg frame every 4 ticker frames
      // (~15fps over a 4-frame cycle = ~3.7 complete strides per second).
      const tick = (deltaTime: number) => {
        try {
          if (!charTex || !charTex.valid || charTex.baseTexture.destroyed) return;
          // Interpolate sprites toward their server targets for continuous
          // movement (PRD 18.1 client interpolation; server stays authoritative).
          for (const [id, entry] of state.agentSprites) {
            const target = state.targetPos.get(id);
            const spr = entry.spr;
            if (!target || spr.destroyed || !spr.visible) continue;
            const dx = target.x - spr.position.x;
            const dy = target.y - spr.position.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0.5) {
              // Constant speed chase (~2.2px/ticker-frame = ~130px/s), fast
              // enough to keep up with 2x world time without overshooting.
              const step = Math.min(dist, 2.2 * deltaTime);
              spr.position.x += (dx / dist) * step;
              spr.position.y += (dy / dist) * step;
            } else {
              spr.position.set(target.x, target.y);
            }
            entry.shadow.position.set(spr.position.x, spr.position.y + 3);
            entry.label.position.set(spr.position.x, spr.position.y + 18);
          }
          if (state.moving.size === 0) return;
          state.frameAcc += deltaTime;
          if (state.frameAcc < 4) return;
          state.frameAcc = 0;
          for (const id of state.moving) {
            const entry = state.agentSprites.get(id);
            if (!entry || entry.spr.destroyed) continue;
            const next = ((state.walkFrame.get(id) ?? 0) + 1) % WALK_FRAMES;
            state.walkFrame.set(id, next);
            const agent = liveProps.agents?.[id];
            const dir = dirIndexOf(agent?.facing);
            const frames = state.frameTextures.get(id);
            if (frames) entry.spr.texture = frames[dir * WALK_FRAMES + next];
          }
        } catch {
          // Stage may be tearing down; stop the cycle.
          state.ticker?.remove(tick);
        }
      };
      state.ticker = PIXI.Ticker.shared;
      state.ticker.add(tick);
      (container as PIXI.Container & { __mvp2Tick?: () => void }).__mvp2Tick = () => {
        state.ticker?.remove(tick);
      };

      // Resource stock labels.
      const updateResources = () => {
        const closeUp = (liveProps.zoomLevel ?? 0.5) >= 1;
        for (const label of state.resourceLabels.values()) label.visible = false;
        for (const r of liveProps.resources ?? []) {
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
        for (const it of liveProps.groundItems ?? []) {
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
        for (const f of liveProps.fires ?? []) {
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
      liveProps.onReady?.(container.__handle);
    });
    (container as PIXI.Container & { __mvp2SetProps?: (p: MapSceneProps) => void }).__mvp2SetProps = (p: MapSceneProps) => {
      liveProps = p;
    };
    return container;
  },
  applyProps(instance, _old, newProps) {
    if (newProps.onReady && instance.__handle) {
      newProps.onReady(instance.__handle);
    }
    (instance as PIXI.Container & { __mvp2SetProps?: (p: MapSceneProps) => void }).__mvp2SetProps?.(newProps);
    (instance as PIXI.Container & { __mvp2Apply?: () => void }).__mvp2Apply?.();
  },
  willUnmount(instance) {
    (instance as PIXI.Container & { __mvp2Tick?: () => void }).__mvp2Tick?.();
  },
});

export function useMapSceneReady(handle: MapSceneHandle | null): void {
  const ref = useRef<MapSceneHandle | null>(null);
  useEffect(() => {
    if (handle) ref.current = handle;
  }, [handle]);
}
