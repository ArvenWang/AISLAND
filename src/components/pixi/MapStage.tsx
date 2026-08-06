// MapStage: full-screen browsable MVP2 map (P1 render target). The server
// world migration (agents on this map) lands in P3/P6.

import { useApp, Container } from '@pixi/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Viewport } from 'pixi-viewport';
import { PersistentStage } from './PersistentStage';
import PixiViewport from './PixiViewport';
import { MapScene, type MapSceneHandle } from './map/MapScene';
import type { MapAgentView, MapResourceView, MapGroundItemView, MapFireView } from './map/MapScene';
import { loadMapAssets } from './map/MapAssets';

const TILE = 32;

export default function MapStage({
  width,
  height,
  agents,
  resources,
  groundItems,
  fires,
  view,
  followAgent,
  onSelectAgent,
}: {
  width: number;
  height: number;
  agents: Record<string, MapAgentView>;
  resources: MapResourceView[];
  groundItems: MapGroundItemView[];
  fires: MapFireView[];
  view: string;
  followAgent: string | null;
  onSelectAgent: (id: string) => void;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [handle, setHandle] = useState<MapSceneHandle | null>(null);

  useEffect(() => {
    let alive = true;
    void loadMapAssets().then((a) => {
      if (alive) setDims({ w: a.map.width * TILE, h: a.map.height * TILE });
    });
    return () => {
      alive = false;
    };
  }, []);

  const onReady = useCallback((h: MapSceneHandle) => {
    setHandle(h);
    setDims({ w: h.worldWidth, h: h.worldHeight });
  }, []);

  return (
    <PersistentStage width={width} height={height} backgroundColor={0x0f1f3a}>
      {dims && (
        <ViewportHost
          width={width}
          height={height}
          worldWidth={dims.w}
          worldHeight={dims.h}
          handle={handle}
          followAgent={followAgent}
          agents={agents}
        >
          <MapScene onReady={onReady} agents={agents} resources={resources} groundItems={groundItems} fires={fires} view={view} followAgent={followAgent} onSelectAgent={onSelectAgent} />
        </ViewportHost>
      )}
    </PersistentStage>
  );
}

function ViewportHost({
  width,
  height,
  worldWidth,
  worldHeight,
  handle,
  followAgent,
  agents,
  children,
}: {
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
  handle: MapSceneHandle | null;
  followAgent: string | null;
  agents: Record<string, MapAgentView>;
  children: React.ReactNode;
}) {
  const app = useApp();
  const viewportRef = useRef<Viewport | undefined>(undefined);
  const centered = useRef(false);

  useEffect(() => {
    const v = viewportRef.current;
    if (!v || !handle) return;
    if (!centered.current) {
      centered.current = true;
      // Start centered on the island instead of the ocean at (0,0).
      v.moveCenter(worldWidth / 2, worldHeight / 2);
    }
    const tick = () => {
      const tl = v.toWorld(0, 0);
      const br = v.toWorld(width, height);
      handle.update({
        x0: Math.max(0, Math.floor(tl.x / TILE)),
        y0: Math.max(0, Math.floor(tl.y / TILE)),
        x1: Math.min(worldWidth / TILE - 1, Math.ceil(br.x / TILE)),
        y1: Math.min(worldHeight / TILE - 1, Math.ceil(br.y / TILE)),
      });
    };
    v.on('moved', tick);
    v.on('zoomed', tick);
    v.on('frame-end', tick);
    tick();
    return () => {
      v.off('moved', tick);
      v.off('zoomed', tick);
      v.off('frame-end', tick);
    };
  }, [handle, width, height, worldWidth, worldHeight]);

  // Follow camera: recenter on the followed agent whenever it moves.
  const followedPos = followAgent ? agents[followAgent] : undefined;
  const posKey = followedPos ? `${followedPos.x},${followedPos.y}` : 'none';
  useEffect(() => {
    const v = viewportRef.current;
    if (!v || !followAgent || !followedPos) return;
    v.moveCenter(followedPos.x * TILE + TILE / 2, followedPos.y * TILE + TILE / 2);
  }, [followAgent, posKey]);

  return (
    <PixiViewport app={app} viewportRef={viewportRef} screenWidth={width} screenHeight={height} worldWidth={worldWidth} worldHeight={worldHeight}>
      <Container>{children}</Container>
    </PixiViewport>
  );
}
