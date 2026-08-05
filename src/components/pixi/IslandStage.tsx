import { useMemo } from 'react';
import { Container, PixiComponent, applyDefaultProps, useApp } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { AgentSprite } from './AgentSprite';
import PixiViewport from './PixiViewport';
import { PersistentStage } from './PersistentStage';
import type { ClientWorld } from '../../api/client';
import { getProfile } from '../../../server/engine/profile';
import type { WorldView } from '../../state/useWorld';

const TILE = 32;

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
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const spr = new PIXI.Sprite(textureFor(map.terrainTile[y][x]));
        spr.x = x * map.tileDim;
        spr.y = y * map.tileDim;
        container.addChild(spr);
      }
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
          return (
            <AgentSprite
              key={a.id}
              sheet={profile.spriteSheet}
              x={a.position.x * TILE + TILE / 2}
              y={a.position.y * TILE + TILE / 2}
              dx={a.facing.x}
              dy={a.facing.y}
              moving={a.currentAction?.action.type === 'move'}
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
