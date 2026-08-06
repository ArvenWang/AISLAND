import { useMemo } from 'react';
import { Container, PixiComponent, applyDefaultProps, useApp } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { AgentSprite } from './AgentSprite';
import PixiViewport from './PixiViewport';
import { PersistentStage } from './PersistentStage';
import type { ClientWorld } from '../../api/client';
import { getProfile } from '../../../server/engine/profile';
import type { WorldView } from '../../state/useWorld';
import type { TerrainKind } from '../../../server/engine/types';

const TILE = 32;
// 参与渐变混合的地形（water=深水在最外层）
const TERRAIN_KINDS: TerrainKind[] = ['grass', 'sand', 'shallow', 'water', 'dirt', 'rock'];
const FIELD_MAX_D = 3; // 距离场上限（格），超过视为不影响本格

type MapLayerProps = { map: ClientWorld['map'] };

const IslandMapLayer = PixiComponent<MapLayerProps, PIXI.Container>('IslandMapLayer', {
  config: { destroy: false },
  create(props: MapLayerProps) {
    const { map } = props;
    const container = new PIXI.Container();
    const base = PIXI.BaseTexture.from(map.tilesetUrl, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    const numXtiles = Math.floor(map.tilesetDimX / map.tileDim);
    const tileCache = new Map<number, PIXI.Texture>();
    const textureFor = (idx: number): PIXI.Texture => {
      let t = tileCache.get(idx);
      if (!t) {
        t = new PIXI.Texture(base, new PIXI.Rectangle((idx % numXtiles) * map.tileDim, Math.floor(idx / numXtiles) * map.tileDim, map.tileDim, map.tileDim));
        tileCache.set(idx, t);
      }
      return t;
    };

    // ---- 距离场（多源 BFS）：每格到各地形最近距离，用于跨格连续渐变 ----
    const W = map.width;
    const H = map.height;
    const distanceFields = new Map<TerrainKind, Int16Array>();
    for (const kind of TERRAIN_KINDS) {
      const dist = new Int16Array(W * H).fill(FIELD_MAX_D + 1);
      const queue: number[] = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (map.terrain[y][x] === kind) {
            dist[y * W + x] = 0;
            queue.push(y * W + x);
          }
        }
      }
      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        const cx = idx % W;
        const cy = (idx / W) | 0;
        const d = dist[idx];
        if (d >= FIELD_MAX_D) continue;
        const neighbors = [
          cy * W + cx + 1,
          cy * W + cx - 1,
          (cy + 1) * W + cx,
          (cy - 1) * W + cx,
        ];
        for (const n of neighbors) {
          if (n < 0 || n >= W * H) continue;
          const nx = n % W;
          if (Math.abs(nx - cx) > 1) continue; // 左右越界（换行误连）
          if (dist[n] > d + 1) {
            dist[n] = d + 1;
            queue.push(n);
          }
        }
      }
      distanceFields.set(kind, dist);
    }

    // 先铺基础地形（每个格子先用自己的中心变体，待像素就绪后替换为混合纹理）
    const sprites: Array<{ spr: PIXI.Sprite }> = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const spr = new PIXI.Sprite(textureFor(map.terrainTile[y][x]));
        spr.x = x * map.tileDim;
        spr.y = y * map.tileDim;
        container.addChild(spr);
        sprites.push({ spr });
      }
    }

    // tileset 像素就绪后：按距离场为每个格子合成"跨格渐变"纹理
    const tsImg = new Image();
    tsImg.src = map.tilesetUrl;
    const applyBlend = () => {
      if (!tsImg.width) return;
      const canvas2d = document.createElement('canvas');
      canvas2d.width = map.tilesetDimX;
      canvas2d.height = map.tilesetDimY;
      const ctx2d = canvas2d.getContext('2d')!;
      ctx2d.drawImage(tsImg, 0, 0);
      const tsData = ctx2d.getImageData(0, 0, map.tilesetDimX, map.tilesetDimY).data;
      const tilePxCache = new Map<number, Uint8ClampedArray>();
      const tilePixels = (tileIdx: number): Uint8ClampedArray => {
        const hit = tilePxCache.get(tileIdx);
        if (hit) return hit;
        const out = new Uint8ClampedArray(32 * 32 * 4);
        const tx = (tileIdx % numXtiles) * 32;
        const ty = Math.floor(tileIdx / numXtiles) * 32;
        for (let y = 0; y < 32; y++) {
          const srcOff = ((ty + y) * map.tilesetDimX + tx) * 4;
          out.set(tsData.subarray(srcOff, srcOff + 128), y * 128);
        }
        tilePxCache.set(tileIdx, out);
        return out;
      };
      // 各地形首变体索引（混合时用；自身项用该格自己的变体）
      const T_INDEX_FIRST: Record<string, number> = {
        water: 24,
        shallow: 16,
        sand: 8,
        grass: 0,
        dirt: 32,
        rock: 40,
      };
      // 每格权重：IDW（反距离平方），只保留权重最高的 3 种地形
      const blendCache = new Map<string, PIXI.Texture>();
      const KIND_IDX = new Map<TerrainKind, number>(TERRAIN_KINDS.map((k, i) => [k, i]));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const cellIdx = y * W + x;
          const weights: Array<{ kind: TerrainKind; w: number }> = [];
          for (const kind of TERRAIN_KINDS) {
            const d = distanceFields.get(kind)![cellIdx];
            if (d > FIELD_MAX_D) continue;
            weights.push({ kind, w: 1 / ((d + 1) * (d + 1)) });
          }
          weights.sort((a, b) => b.w - a.w);
          const top = weights.slice(0, 3);
          const total = top.reduce((s, t) => s + t.w, 0);
          if (total <= 0) continue;
          const selfIdx = map.terrainTile[y][x];
          const key = `${selfIdx}|${top.map((t) => KIND_IDX.get(t.kind) + ':' + Math.round((t.w / total) * 100)).join(',')}`;
          let tex = blendCache.get(key);
          if (!tex) {
            // 合成：自身用本格变体纹理，其他用首变体纹理
            const sources = top.map((t) => {
              const px =
                t.kind === map.terrain[y][x]
                  ? tilePixels(selfIdx)
                  : tilePixels(T_INDEX_FIRST[t.kind]);
              return { px, w: t.w / total };
            });
            const c = document.createElement('canvas');
            c.width = 32;
            c.height = 32;
            const cctx = c.getContext('2d')!;
            const img = cctx.createImageData(32, 32);
            for (let py = 0; py < 32; py++) {
              for (let px2 = 0; px2 < 32; px2++) {
                const o = (py * 32 + px2) * 4;
                let r = 0;
                let g = 0;
                let b = 0;
                for (const s of sources) {
                  r += s.px[o] * s.w;
                  g += s.px[o + 1] * s.w;
                  b += s.px[o + 2] * s.w;
                }
                img.data[o] = r;
                img.data[o + 1] = g;
                img.data[o + 2] = b;
                img.data[o + 3] = 255;
              }
            }
            cctx.putImageData(img, 0, 0);
            tex = PIXI.Texture.from(c);
            blendCache.set(key, tex);
          }
          sprites[cellIdx].spr.texture = tex;
        }
      }
      void blendCache;
    };
    if (tsImg.complete && tsImg.width) {
      applyBlend();
    } else {
      tsImg.onload = applyBlend;
    }
    // Decorative object tiles (trees etc.) from the gentle-obj sheet.
    const objBase = PIXI.BaseTexture.from('/assets/gentle-obj.png', { scaleMode: PIXI.SCALE_MODES.NEAREST });
    const objNumXtiles = Math.floor(1440 / map.tileDim);
    for (const obj of map.objectTiles) {
      const t = new PIXI.Texture(objBase, new PIXI.Rectangle((obj.tileIndex % objNumXtiles) * map.tileDim, Math.floor(obj.tileIndex / objNumXtiles) * map.tileDim, map.tileDim, map.tileDim));
      const spr = new PIXI.Sprite(t);
      spr.x = obj.x * map.tileDim;
      spr.y = obj.y * map.tileDim;
      container.addChild(spr);
    }
    // v0.2 独立装饰 props：每个 prop 是单独透明 PNG，锚点按类型区分
    for (const p of map.decorProps ?? []) {
      const tex = PIXI.Texture.from(`/assets/island/${p.asset}.png`);
      const spr = new PIXI.Sprite(tex);
      spr.anchor.set(0.5, p.anchorY);
      spr.x = (p.x + 0.5) * map.tileDim;
      spr.y = (p.y + 0.5) * map.tileDim;
      spr.width = p.w;
      spr.height = p.h;
      container.addChild(spr);
    }
    container.interactive = true;
    container.hitArea = new PIXI.Rectangle(0, 0, map.width * map.tileDim, map.height * map.tileDim);
    return container;
  },
  applyProps(instance, oldProps, newProps) {
    applyDefaultProps(instance, oldProps, newProps);
  },
});

export function IslandStage({
  world,
  view,
  selectedAgentId,
  onSelectAgent,
  width,
  height,
}: {
  world: ClientWorld;
  view: WorldView;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  width: number;
  height: number;
}) {
  return (
    <PersistentStage width={width} height={height} backgroundColor={0x1a2b4a}>
      <StageContent world={world} view={view} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} width={width} height={height} />
    </PersistentStage>
  );
}

function StageContent({
  world,
  view,
  selectedAgentId,
  onSelectAgent,
  width,
  height,
}: {
  world: ClientWorld;
  view: WorldView;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  width: number;
  height: number;
}) {
  const app = useApp();
  const { map } = world;
  const agents = Object.values(world.agents);
  const agentView = view !== 'god' ? world.agents[view] : null;

  const bubbleByAgent = useMemo(() => {
    const out: Record<string, string> = {};
    for (let i = world.events.length - 1; i >= 0 && i >= world.events.length - 14; i--) {
      const e = world.events[i];
      if (e.type === 'message_spoken' && e.actorId && !out[e.actorId]) {
        out[e.actorId] = String(e.payload?.text ?? '');
      }
    }
    return out;
  }, [world.events]);

  const markers = useMemo(() => {
    const list: Array<{ id: string; x: number; y: number; emoji: string; label: string; stock?: string; known: boolean }> = [];
    for (const node of map.resourceNodes) {
      const known = agentView ? agentView.knownLocations.includes(node.id) : true;
      list.push({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        emoji: node.kind === 'spring' ? '💧' : node.kind === 'grove' ? '🥥' : '🦀',
        label: node.kind === 'spring' ? '淡水泉' : node.kind === 'grove' ? '椰林' : '潮池',
        stock: `${node.stock}/${node.capacity}`,
        known,
      });
    }
    for (const c of Object.values(map.containers)) {
      list.push({ id: c.id, x: c.position.x, y: c.position.y, emoji: '📦', label: '公共物资', stock: undefined, known: true });
    }
    for (const loc of map.locations) {
      if (loc.id === 'crash_camp') continue;
      const known = agentView ? agentView.knownLocations.includes(loc.id) : true;
      list.push({ id: loc.id, x: loc.position.x, y: loc.position.y, emoji: loc.kind === 'ridge' ? '⛰️' : '🔍', label: loc.name, stock: undefined, known });
    }
    for (const c of Object.values(world.containers)) {
      if (c.kind === 'corpse_backpack') {
        const known = agentView ? agentView.knownLocations.includes(c.id) || Math.abs(c.position.x - agentView.position.x) + Math.abs(c.position.y - agentView.position.y) <= 7 : true;
        list.push({ id: c.id, x: c.position.x, y: c.position.y, emoji: '🎒', label: `${world.agents[c.ownerId ?? '']?.name ?? ''}的背包`, stock: `水${c.inventory.water} 食${c.inventory.food}`, known });
      }
    }
    return list;
  }, [map, world.containers, agentView, world.agents]);

  return (
    <PixiViewport app={app} screenWidth={width} screenHeight={height} worldWidth={map.width * TILE} worldHeight={map.height * TILE}>
      <IslandMapLayer key={world.worldId} map={map} />
      <Container>
        {markers.map((m) => (
          <Marker
            key={m.id}
            x={m.x * TILE + TILE / 2}
            y={m.y * TILE + TILE / 2}
            emoji={m.emoji}
            label={m.label}
            stock={m.stock}
            known={m.known}
          />
        ))}
      </Container>
      <Container>
        {agents.map((a) => {
          const profile = getProfile(a.profileId);
          const moveAction = a.currentAction?.action.type === 'move' ? a.currentAction : null;
          return (
            <AgentSprite
              key={a.id}
              sheet={profile.spriteSheet}
              x={a.position.x * TILE + TILE / 2}
              y={a.position.y * TILE + TILE / 2}
              dx={a.facing.x}
              dy={a.facing.y}
              moving={a.currentAction?.action.type === 'move'}
              path={moveAction?.path}
              moveStart={moveAction?.startedAt}
              moveEnd={moveAction?.endsAt}
              gameTime={world.gameTime}
              thinking={a.planDebug !== undefined && !!a.currentAction === false && world.status === 'running'}
              bubble={bubbleByAgent[a.id] ?? null}
              name={a.name}
              selected={selectedAgentId === a.id}
              dimmed={agentView ? agentView.id !== a.id && Math.abs(a.position.x - agentView.position.x) + Math.abs(a.position.y - agentView.position.y) > 7 : false}
              onClick={() => onSelectAgent(a.id)}
            />
          );
        })}
      </Container>
    </PixiViewport>
  );
}

const Marker = PixiComponent<{ x: number; y: number; emoji: string; label: string; stock?: string; known: boolean }, PIXI.Container>('Marker', {
  config: { destroy: false },
  create(props) {
    const root = new PIXI.Container();
    const icon = new PIXI.Text(props.emoji, { fontFamily: 'system-ui', fontSize: 24 });
    icon.anchor.set(0.5, 0.9);
    root.addChild(icon);
    const name = new PIXI.Text(props.label, {
      fontFamily: 'system-ui',
      fontSize: 11,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
    });
    name.anchor.set(0.5, 0);
    name.y = 12;
    root.addChild(name);
    if (props.stock !== undefined) {
      const stock = new PIXI.Text(props.stock, {
        fontFamily: 'system-ui',
        fontSize: 11,
        fill: 0xffe9a8,
        stroke: 0x000000,
        strokeThickness: 3,
      });
      stock.anchor.set(0.5, 0);
      stock.y = 26;
      root.addChild(stock);
    }
    applyMarkerProps(root, {} as never, props);
    return root;
  },
  applyProps(instance, oldProps: never, newProps) {
    applyMarkerProps(instance, oldProps, newProps);
  },
});

function applyMarkerProps(instance: PIXI.Container, _oldProps: never, newProps: { x: number; y: number; known: boolean }) {
    instance.x = newProps.x;
    instance.y = newProps.y;
    instance.alpha = newProps.known ? 1 : 0.18;
}
