// Phase 3 map scene: authored terrain + one world-Y-sorted actor layer +
// canopy/effects/UI separation. The player sees a God view by default; fog is
// reserved for the cognitive-map debug view.

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

export type MapResourceView = { id: string; kind: string; x: number; y: number; stock: number; capacity?: number };
export type MapWreckView = { wreckId: string; x: number; y: number; searched: boolean };
export type MapGroundItemView = { itemId: string; kind: string; x: number; y: number };
export type MapFireView = { fireId: string; x: number; y: number; state: string };

type MapSceneProps = {
  onReady?: (handle: MapSceneHandle) => void;
  agents?: Record<string, MapAgentView>;
  resources?: MapResourceView[];
  wrecks?: MapWreckView[];
  groundItems?: MapGroundItemView[];
  fires?: MapFireView[];
  view?: string;
  followAgent?: string | null;
  zoomLevel?: number;
  onSelectAgent?: (id: string) => void;
};

const TILE = 32;

const AGENT_CHAR: Record<string, string> = { agent_a: 'linche', agent_b: 'shilei', agent_c: 'suhe' };
const AGENT_COLOR: Record<string, number> = { agent_a: 0x4aa3ff, agent_b: 0x46d96a, agent_c: 0xff9a4a };
const ACTION_DISPLAY: Record<string, string> = {
  move: '移动中',
  explore: '探索中',
  pickup_item: '拾取中',
  search_wreckage: '搜索中',
  harvest_water: '取水中',
  harvest_food: '采集中',
  harvest_wood: '收集木柴中',
  consume: '使用物品中',
  offer_item: '递交中',
  talk: '交谈中',
  build_fire: '生火中',
  add_fuel: '加柴中',
  sleep: '睡眠中',
  observe: '观察中',
};

type WalkKey = 'walk_down' | 'walk_up' | 'walk_left' | 'walk_right';
type CharacterMeta = {
  atlas: { cell: [number, number]; columns: number };
  characters: Record<string, {
    anchor: [number, number];
    directions: Record<'down' | 'left' | 'right' | 'up', { idle: number[]; walk: number[] }>;
    actions: Record<string, number>;
  }>;
};
type PropEntry = {
  rect: [number, number, number, number];
  anchor: [number, number];
  canopySplitY?: number;
};
type PropMeta = {
  entries: Record<string, PropEntry>;
  aliases: Record<string, string>;
  resourceStates: Record<string, Record<string, string>>;
  items: Record<string, string>;
};
type EffectMeta = {
  atlas: { cell: [number, number]; columns: number };
  sequences: Record<string, number[]>;
};

const ACTION_POSE: Record<string, string> = {
  observe: 'observe',
  pickup_item: 'low_reach',
  drop_item: 'low_reach',
  take_unattended_item: 'low_reach',
  harvest_water: 'low_reach',
  harvest_food: 'low_reach',
  harvest_wood: 'low_reach',
  consume: 'consume',
  offer_item: 'offer',
  accept_handover: 'receive',
  refuse_handover: 'refuse',
  search_wreckage: 'search',
  build_fire: 'build_fire',
  add_fuel: 'add_fuel',
  sleep: 'sleep',
  wake: 'wake',
  rest: 'rest',
  shout: 'shout',
  talk: 'talk',
};
const ACTION_EFFECT: Record<string, string> = {
  pickup_item: 'pickup',
  take_unattended_item: 'pickup',
  harvest_water: 'harvest',
  harvest_food: 'harvest',
  harvest_wood: 'harvest',
  offer_item: 'handover',
  accept_handover: 'handover',
  refuse_handover: 'refuse',
  shout: 'shout',
  sleep: 'sleep',
};

function seqKeyOf(facing?: { x: number; y: number }): WalkKey {
  if (!facing) return 'walk_down';
  if (facing.y > 0) return 'walk_down';
  if (facing.y < 0) return 'walk_up';
  return facing.x < 0 ? 'walk_left' : 'walk_right';
}

function atlasTexture(texture: PIXI.Texture, rect: [number, number, number, number]): PIXI.Texture {
  return new PIXI.Texture(texture.baseTexture, new PIXI.Rectangle(...rect));
}

function propEntry(meta: PropMeta, requested: string): { name: string; entry: PropEntry } | null {
  const name = meta.entries[requested] ? requested : meta.aliases[requested];
  const entry = name ? meta.entries[name] : null;
  return entry ? { name, entry } : null;
}

function propTexture(assets: MapAssets, name: string): PIXI.Texture | null {
  const found = propEntry(assets.propMeta as PropMeta, name);
  return found ? atlasTexture(assets.props, found.entry.rect) : null;
}

type CharacterFrameCache = Record<WalkKey, PIXI.Texture[]> & { idle: PIXI.Texture[] };

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
      seqKey: Map<string, WalkKey>;
      frameCache: Map<string, CharacterFrameCache>;
      actionFrames: Map<string, Record<string, PIXI.Texture>>;
      agentEffects: Map<string, PIXI.Sprite>;
      frameAcc: number;
      effectFrame: number;
      effectAcc: number;
      targetPos: Map<string, { x: number; y: number }>;
      ticker: PIXI.Ticker | null;
      resourceSprites: Map<string, { sprite: PIXI.Sprite; kind: 'spring' | 'berry_bush' | 'wood_pile' }>;
      wreckSprites: Map<string, PIXI.Sprite>;
      itemMarks: Map<string, PIXI.Sprite>;
      fireMarks: Map<string, { sprite: PIXI.Sprite; glow: PIXI.Sprite }>;
      ready: boolean;
    } = { agentSprites: new Map(), resourceSprites: new Map(), wreckSprites: new Map(), itemMarks: new Map(), fireMarks: new Map(), moving: new Set(), walkFrame: new Map(), seqKey: new Map(), frameCache: new Map(), actionFrames: new Map(), agentEffects: new Map(), frameAcc: 0, effectFrame: 0, effectAcc: 0, targetPos: new Map(), ticker: null, ready: false };
    (container as PIXI.Container & { __mvp2State?: typeof state }).__mvp2State = state;
    container.__handle = {
      update: () => undefined,
      worldWidth: 1,
      worldHeight: 1,
    };
    loadMapAssets().then(async (assets) => {
      const { map } = assets;
      const ground = new ChunkedTileLayer(map, assets.terrain, map.atlas.terrainCols, 'terrain');
      const cliffs = new ChunkedTileLayer(map, assets.cliffs, map.atlas.cliffCols ?? 4, 'cliffs');
      const decals = new ChunkedTileLayer(map, assets.decals, map.atlas.decalCols, 'decals');
      decals.alpha = 0.68;
      const actorLayer = new PIXI.Container();
      actorLayer.sortableChildren = true;
      const foreground = new PIXI.Container();
      const shoreEffects = new PIXI.Container();
      const effectsLayer = new PIXI.Container();
      effectsLayer.sortableChildren = true;
      const fog = new FogOverlay();
      // Every physical actor/prop shares one sortable layer. The canopy is
      // deliberately above it so a character can walk behind a tree crown.
      container.addChild(ground, cliffs, decals, shoreEffects, actorLayer, foreground, effectsLayer, fog);
      const charLayer = actorLayer;

      const characterMeta = assets.charMeta as CharacterMeta;
      const characterTexture = (index: number) => {
        const [width, height] = characterMeta.atlas.cell;
        const x = (index % characterMeta.atlas.columns) * width;
        const y = Math.floor(index / characterMeta.atlas.columns) * height;
        return atlasTexture(assets.characters, [x, y, width, height]);
      };
      for (const id of ['agent_a', 'agent_b', 'agent_c']) {
        const config = characterMeta.characters[AGENT_CHAR[id]];
        if (!config) continue;
        state.frameCache.set(id, {
          idle: config.directions.down.idle.map(characterTexture),
          walk_down: config.directions.down.walk.map(characterTexture),
          walk_left: config.directions.left.walk.map(characterTexture),
          walk_right: config.directions.right.walk.map(characterTexture),
          walk_up: config.directions.up.walk.map(characterTexture),
        });
        state.actionFrames.set(id, Object.fromEntries(Object.entries(config.actions).map(([name, index]) => [name, characterTexture(index)])));
      }
      state.ready = true;

      const createAgentSprite = (id: string) => {
        const spr = new PIXI.Sprite(PIXI.Texture.EMPTY);
        // Character body ~1.25 tiles wide x ~1.6 tiles tall (Animal Crossing
        // proportions), standing on the tile with a soft ground shadow.
        const anchor = characterMeta.characters[AGENT_CHAR[id]]?.anchor ?? [0.5, 0.9125];
        spr.anchor.set(anchor[0], anchor[1]);
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
        const effect = new PIXI.Sprite(PIXI.Texture.EMPTY);
        effect.anchor.set(0.5);
        effect.visible = false;
        charLayer.addChild(shadow, bg, ring, spr, label);
        effectsLayer.addChild(effect);
        state.agentEffects.set(id, effect);
        state.agentSprites.set(id, { spr, label, ring, bg, shadow });
      };
      for (const id of ['agent_a', 'agent_b', 'agent_c']) createAgentSprite(id);

      const propMeta = assets.propMeta as PropMeta;
      const effectMeta = assets.effectMeta as EffectMeta;
      const effectTexture = (sequence: string, progress = 0) => {
        const frames = effectMeta.sequences[sequence] ?? [];
        if (!frames.length) return PIXI.Texture.EMPTY;
        const index = frames[Math.min(frames.length - 1, Math.max(0, Math.floor(progress * frames.length)))];
        const [width, height] = effectMeta.atlas.cell;
        return atlasTexture(assets.effects, [
          (index % effectMeta.atlas.columns) * width,
          Math.floor(index / effectMeta.atlas.columns) * height,
          width,
          height,
        ]);
      };

      // The shoreline is derived from the authored terrain grid, not painted
      // into a screenshot. Each marker sits on a real shallow/wet-sand edge,
      // rotates with that edge and shares the generated four-frame foam loop.
      // A stable hash thins the set so the coast breathes instead of becoming
      // a continuous white outline.
      const shoreFoamSprites: PIXI.Sprite[] = [];
      const terrainAt = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) return -1;
        return map.terrainClass[y * map.width + x] ?? -1;
      };
      const shoreDirections = [
        { dx: 0, dy: -1, ox: 0, oy: -TILE / 2, rotation: 0 },
        { dx: 1, dy: 0, ox: TILE / 2, oy: 0, rotation: Math.PI / 2 },
        { dx: 0, dy: 1, ox: 0, oy: TILE / 2, rotation: Math.PI },
        { dx: -1, dy: 0, ox: -TILE / 2, oy: 0, rotation: -Math.PI / 2 },
      ];
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (terrainAt(x, y) !== 1 || ((x * 31 + y * 17) % 3) !== 0) continue;
          const edge = shoreDirections.find(({ dx, dy }) => terrainAt(x + dx, y + dy) === 2);
          if (!edge) continue;
          const foam = new PIXI.Sprite(effectTexture('shore_foam', ((x + y) % 4) / 4));
          foam.anchor.set(0.5);
          foam.position.set(x * TILE + TILE / 2 + edge.ox, y * TILE + TILE / 2 + edge.oy);
          foam.rotation = edge.rotation;
          foam.alpha = 0.78;
          foam.scale.set(0.72);
          foam.visible = false;
          shoreEffects.addChild(foam);
          shoreFoamSprites.push(foam);
        }
      }

      const updateAgentFrames = () => {
        const agents = liveProps.agents ?? {};
        for (const [id, { spr, label, ring, bg, shadow }] of state.agentSprites) {
          const a = agents[id];
          const effect = state.agentEffects.get(id);
          if (!a) {
            spr.visible = false;
            label.visible = false;
            ring.visible = false;
            shadow.visible = false;
            if (effect) effect.visible = false;
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
          shadow.visible = a.isAlive && !a.sleeping;
          const actionLabel = a.action ? ACTION_DISPLAY[a.action.type] ?? a.action.type : a.sleeping ? '睡眠中' : '';
          label.text = a.isAlive ? `${a.name}${actionLabel ? ` · ${actionLabel}` : ''}` : `${a.name}（死亡）`;
          // Labels adapt to zoom: far overview shows only selected/acting
          // agents; close-up (>=1x) shows everyone, Animal-Crossing style.
          const closeUp = (liveProps.zoomLevel ?? 0.5) >= 1;
          const inverseZoom = 1 / Math.max(0.5, liveProps.zoomLevel ?? 0.8);
          label.scale.set(inverseZoom);
          ring.scale.set(inverseZoom);
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
          spr.tint = 0xffffff;
          spr.alpha = 1;
          const moving = a.isAlive && !!a.action && (
            ['move', 'explore'].includes(a.action.type)
            || (a.action.phase === 'approach' && a.action.progress < 0.98)
          );
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
            ring.drawCircle(0, 0, 20);
            ring.position.set(px, py - 4);
          }
          const worldZ = py;
          spr.zIndex = worldZ;
          shadow.zIndex = worldZ - 0.5;
          ring.zIndex = worldZ + 0.1;
          bg.zIndex = worldZ + 0.2;
          label.zIndex = worldZ + 0.3;
          const key = seqKeyOf(a.facing);
          state.seqKey.set(id, key);
          const cache = state.frameCache.get(id);
          const actionFrames = state.actionFrames.get(id);
          if (state.ready && cache) {
            if (state.moving.has(id) && state.ticker) {
              const seq = cache[key];
              if (seq.length) spr.texture = seq[(state.walkFrame.get(id) ?? 0) % seq.length];
            } else if (!a.isAlive && actionFrames?.death) {
              spr.texture = actionFrames.death;
            } else if (a.sleeping && actionFrames?.sleep) {
              spr.texture = actionFrames.sleep;
            } else if (a.action && ACTION_POSE[a.action.type] && actionFrames?.[ACTION_POSE[a.action.type]]) {
              spr.texture = actionFrames[ACTION_POSE[a.action.type]];
            } else if (cache.idle.length) {
              spr.texture = cache.idle[0];
            }
          }
          spr.scale.set(1);
          if (effect) {
            const sequence = a.action ? ACTION_EFFECT[a.action.type] : a.sleeping ? 'sleep' : null;
            effect.visible = !!sequence && a.isAlive;
            if (sequence) {
              effect.texture = effectTexture(sequence, a.action?.progress ?? 0.5);
              effect.position.set(px, py - (sequence === 'shout' ? 24 : sequence === 'sleep' ? 18 : 8));
              effect.zIndex = worldZ + 100;
            }
          }
        }
      };

      // Walk animation ticker: advance one leg frame every 4 ticker frames
      // (~15fps over a 4-frame cycle = ~3.7 complete strides per second).
      const tick = (deltaTime: number) => {
        try {
          if (!state.ready) return;
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
              // Constant speed chase (~5px/ticker-frame = ~300px/s, ~9 tiles/s)
              // so sprites keep up with the faster 250ms server ticks.
              const step = Math.min(dist, 5 * deltaTime);
              spr.position.x += (dx / dist) * step;
              spr.position.y += (dy / dist) * step;
            } else {
              spr.position.set(target.x, target.y);
            }
            entry.shadow.position.set(spr.position.x, spr.position.y + 3);
            entry.label.position.set(spr.position.x, spr.position.y + 18);
            entry.ring.position.set(spr.position.x, spr.position.y - 4);
            const effect = state.agentEffects.get(id);
            if (effect?.visible) effect.position.x = spr.position.x;
          }
          state.effectAcc += deltaTime;
          if (state.effectAcc >= 8) {
            state.effectAcc = 0;
            state.effectFrame = (state.effectFrame + 1) % 4;
            for (const entry of state.fireMarks.values()) {
              if (entry.glow.visible) entry.glow.texture = effectTexture('fire_light', state.effectFrame / 4);
            }
            for (const foam of shoreFoamSprites) {
              if (foam.visible) foam.texture = effectTexture('shore_foam', state.effectFrame / 4);
            }
          }
          if (state.moving.size === 0) return;
          state.frameAcc += deltaTime;
          if (state.frameAcc < 4) return;
          state.frameAcc = 0;
          for (const id of state.moving) {
            const entry = state.agentSprites.get(id);
            if (!entry || entry.spr.destroyed) continue;
            const key = state.seqKey.get(id) ?? 'walk_down';
            const cache = state.frameCache.get(id);
            if (cache && cache[key].length) {
              const seqLen = cache[key].length;
              state.walkFrame.set(id, ((state.walkFrame.get(id) ?? 0) + 1) % seqLen);
              entry.spr.texture = cache[key][state.walkFrame.get(id) ?? 0];
            }
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

      // Resource state is expressed through the real resource sprite. Exact
      // stock stays in the inspector/debug view; the normal map never shows
      // emoji or floating inventory numbers.
      const updateResources = () => {
        for (const r of liveProps.resources ?? []) {
          const entry = state.resourceSprites.get(r.id);
          if (!entry) continue;
          const ratio = r.stock / Math.max(1, r.capacity ?? r.stock + 1);
          const stateName = r.stock <= 0
            ? 'depleted'
            : ratio < 0.28
              ? entry.kind === 'spring' ? 'low' : 'used'
              : ratio < 0.72 ? 'used' : 'full';
          const assetName = propMeta.resourceStates[entry.kind]?.[stateName]
            ?? propMeta.resourceStates[entry.kind]?.full;
          const texture = assetName ? propTexture(assets, assetName) : null;
          if (texture) entry.sprite.texture = texture;
          entry.sprite.alpha = 1;
          entry.sprite.tint = 0xffffff;
        }
      };

      const updateWrecks = () => {
        for (const wreck of liveProps.wrecks ?? []) {
          const sprite = state.wreckSprites.get(`${wreck.x},${wreck.y}`);
          if (!sprite) continue;
          const texture = propTexture(assets, wreck.searched ? 'wreckage_searched' : 'wreckage_full');
          if (texture) sprite.texture = texture;
        }
      };

      // Ground items are real sprites, never yellow rectangles.
      const updateItems = () => {
        for (const g of state.itemMarks.values()) g.visible = false;
        for (const it of liveProps.groundItems ?? []) {
          let sprite = state.itemMarks.get(it.itemId);
          if (!sprite) {
            const name = it.kind === 'water' ? 'water_bottle' : it.kind === 'food' ? 'food_ration' : it.kind === 'wood' ? 'wood_log' : it.kind;
            const found = propEntry(propMeta, propMeta.items[name] ?? name);
            const texture = found ? propTexture(assets, found.name) : null;
            if (!found || !texture) continue;
            sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(...found.entry.anchor);
            charLayer.addChild(sprite);
            state.itemMarks.set(it.itemId, sprite);
          }
          sprite.position.set(it.x * TILE + TILE / 2, it.y * TILE + TILE - 4);
          sprite.zIndex = it.y * TILE + TILE;
          sprite.visible = true;
        }
      };

      // Fire state and local light both come from authored generated assets.
      const updateFires = () => {
        for (const entry of state.fireMarks.values()) {
          entry.sprite.visible = false;
          entry.glow.visible = false;
        }
        for (const f of liveProps.fires ?? []) {
          let entry = state.fireMarks.get(f.fireId);
          if (!entry) {
            const glow = new PIXI.Sprite(effectTexture('fire_light', 0));
            glow.anchor.set(0.5);
            glow.blendMode = PIXI.BLEND_MODES.ADD;
            glow.alpha = 0.36;
            const sprite = new PIXI.Sprite(propTexture(assets, 'fire_burning') ?? PIXI.Texture.EMPTY);
            const fireEntry = propEntry(propMeta, 'fire_burning');
            sprite.anchor.set(...(fireEntry?.entry.anchor ?? [0.5, 1]));
            charLayer.addChild(sprite);
            effectsLayer.addChild(glow);
            entry = { sprite, glow };
            state.fireMarks.set(f.fireId, entry);
          }
          const fireName = propMeta.resourceStates.fire?.[f.state] ?? propMeta.resourceStates.fire?.burning;
          const fireTexture = fireName ? propTexture(assets, fireName) : null;
          if (fireTexture) entry.sprite.texture = fireTexture;
          entry.sprite.position.set(f.x * TILE + TILE / 2, f.y * TILE + TILE - 2);
          entry.sprite.zIndex = f.y * TILE + TILE + 1;
          entry.glow.position.set(f.x * TILE + TILE / 2, f.y * TILE + TILE / 2 - 8);
          entry.glow.scale.set(f.state === 'burning' ? 1.35 : 0.95);
          entry.glow.zIndex = f.y * TILE + TILE + 90;
          entry.sprite.visible = true;
          entry.glow.visible = f.state !== 'out';
        }
      };

      updateAgentFrames();
      updateResources();
      updateItems();
      updateFires();

      const applyWorld = () => {
        updateAgentFrames();
        updateResources();
        updateWrecks();
        updateItems();
        updateFires();
      };
      (container as PIXI.Container & { __mvp2Apply?: () => void }).__mvp2Apply = applyWorld;

      // Trees: trunk in actor-sorted layer, canopy in foreground layer.
      const treeSprites: Array<{ trunk: PIXI.Sprite; canopy: PIXI.Sprite; footY: number }> = [];
      for (const o of map.objects) {
        if (o.type !== 'tree') continue;
        const found = propEntry(propMeta, String(o.properties.assetId ?? ''));
        if (!found) continue;
        const [atlasX, atlasY, width, height] = found.entry.rect;
        const canopyH = found.entry.canopySplitY ?? Math.round(height * 0.68);
        const trunkH = height - canopyH;
        const trunkTex = atlasTexture(assets.props, [atlasX, atlasY + canopyH, width, trunkH]);
        const canopyTex = atlasTexture(assets.props, [atlasX, atlasY, width, canopyH]);
        const trunk = new PIXI.Sprite(trunkTex);
        const canopy = new PIXI.Sprite(canopyTex);
        const baseX = o.cellX * TILE + TILE / 2;
        const baseY = o.cellY * TILE + TILE;
        const fullX = baseX - width * found.entry.anchor[0];
        const fullY = baseY - height * found.entry.anchor[1];
        trunk.position.set(fullX, fullY + canopyH);
        canopy.position.set(fullX, fullY);
        canopy.visible = false;
        const footY = baseY;
        treeSprites.push({ trunk, canopy, footY });
        trunk.zIndex = footY;
        actorLayer.addChild(trunk);
        foreground.addChild(canopy);
      }

      // Ground props (rocks, bushes, wood, wreckage, spring).
      const propSprites: Array<{ spr: PIXI.Sprite; footY: number }> = [];
      for (const o of map.objects) {
        const name = String(o.properties.assetId ?? '');
        if (!name) continue;
        const found = propEntry(propMeta, name);
        const texture = found ? propTexture(assets, found.name) : null;
        if (!found || !texture) continue;
        const spr = new PIXI.Sprite(texture);
        spr.anchor.set(...found.entry.anchor);
        if (o.type === 'water_spring') spr.scale.set(1.32);
        const footY = o.cellY * TILE + TILE;
        spr.position.set(o.cellX * TILE + TILE / 2, footY);
        propSprites.push({ spr, footY });
        spr.zIndex = footY;
        actorLayer.addChild(spr);
        if (o.type === 'water_spring') state.resourceSprites.set(`spring_${o.id}`, { sprite: spr, kind: 'spring' });
        if (o.type === 'berry_bush') state.resourceSprites.set(`berry_${o.id}`, { sprite: spr, kind: 'berry_bush' });
        if (o.type === 'wood_pile') state.resourceSprites.set(`wood_${o.id}`, { sprite: spr, kind: 'wood_pile' });
        if (o.type === 'wreckage') state.wreckSprites.set(`${o.cellX},${o.cellY}`, spr);
      }
      updateResources();
      updateWrecks();

      const sortActors = () => {
        const items: Array<{ obj: PIXI.DisplayObject; footY: number }> = [];
        for (const p of propSprites) items.push({ obj: p.spr, footY: p.footY });
        for (const t of treeSprites) items.push({ obj: t.trunk, footY: t.footY });
        for (const it of items) it.obj.zIndex = it.footY;
        actorLayer.sortableChildren = true;
        actorLayer.sortChildren();
      };
      sortActors();

      const worldWidth = map.width * TILE;
      const worldHeight = map.height * TILE;
      container.__handle = {
        update(bounds: Bounds) {
          ground.update(bounds);
          cliffs.update(bounds);
          decals.update(bounds);
          const pad = 3 * TILE;
          const bx0 = bounds.x0 * TILE - pad;
          const by0 = bounds.y0 * TILE - pad;
          const bx1 = bounds.x1 * TILE + pad;
          const by1 = bounds.y1 * TILE + pad;
          actorLayer.visible = true;
          for (const p of propSprites) p.spr.visible = p.spr.x + p.spr.width >= bx0 && p.spr.x <= bx1 && p.spr.y + p.spr.height >= by0 && p.spr.y <= by1;
          for (const t of treeSprites) {
            t.canopy.visible = t.canopy.x + t.canopy.width >= bx0 && t.canopy.x <= bx1 && t.canopy.y + t.canopy.height >= by0 && t.canopy.y <= by1;
          }
          for (const foam of shoreFoamSprites) {
            foam.visible = foam.x + foam.width >= bx0 && foam.x - foam.width <= bx1 && foam.y + foam.height >= by0 && foam.y - foam.height <= by1;
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
