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
  const [zoomLevel, setZoomLevel] = useState(0.5);

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
    <div className="relative h-full w-full">
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
            onZoomLevel={setZoomLevel}
            zoomLevel={zoomLevel}
          >
            <MapScene onReady={onReady} agents={agents} resources={resources} groundItems={groundItems} fires={fires} view={view} followAgent={followAgent} zoomLevel={zoomLevel} onSelectAgent={onSelectAgent} />
          </ViewportHost>
        )}
      </PersistentStage>
      <div data-testid="zoom-level" className="pointer-events-none absolute bottom-2 right-2 rounded bg-slate-900/70 px-2 py-1 text-[11px] tabular-nums text-slate-300 backdrop-blur">
        缩放 {Math.round(zoomLevel * 100)}%
      </div>
    </div>
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
  onZoomLevel,
  zoomLevel,
  children,
}: {
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
  handle: MapSceneHandle | null;
  followAgent: string | null;
  agents: Record<string, MapAgentView>;
  onZoomLevel: (z: number) => void;
  zoomLevel: number;
  children: React.ReactNode;
}) {
  const app = useApp();
  const viewportRef = useRef<Viewport | undefined>(undefined);
  const centered = useRef(false);
  const prevFollow = useRef<string | null>(null);

  // Debug handle for automated verification of live sprite positions.
  useEffect(() => {
    (window as unknown as { __mvp2App?: unknown }).__mvp2App = app;
  }, [app]);

  useEffect(() => {
    const v = viewportRef.current;
    if (!v || !handle) return;
    if (!centered.current) {
      centered.current = true;
      // Start centered on the island instead of the ocean at (0,0).
      v.moveCenter(worldWidth / 2, worldHeight / 2);
    }
    const tick = () => {
      onZoomLevel(v.scale.x);
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
  }, [handle, width, height, worldWidth, worldHeight, onZoomLevel]);

  // Follow camera: animate to the agent at 2x (Animal-Crossing-like framing);
  // when following, recenter on every move; when unfollowing, ease back to
  // the island overview at 0.5x.
  const followedPos = followAgent ? agents[followAgent] : undefined;
  const posKey = followedPos ? `${followedPos.x},${followedPos.y}` : 'none';
  useEffect(() => {
    const v = viewportRef.current;
    if (!v) return;
    if (followAgent && followedPos) {
      const cx = followedPos.x * TILE + TILE / 2;
      const cy = followedPos.y * TILE + TILE / 2;
      if (prevFollow.current !== followAgent) {
        // Just started following: smooth zoom+move into the agent.
        v.animate({ position: { x: cx, y: cy }, scale: 2, time: 900, ease: 'easeOutCubic', removeOnInterrupt: true });
      } else {
        // Keep following smoothly instead of snapping between steps.
        v.animate({ position: { x: cx, y: cy }, time: 650, ease: 'easeInOutQuad', removeOnInterrupt: true });
      }
      prevFollow.current = followAgent;
    } else if (!followAgent && prevFollow.current) {
      prevFollow.current = null;
      v.animate({ position: { x: worldWidth / 2, y: worldHeight / 2 }, scale: 0.5, time: 600, ease: 'easeOutCubic', removeOnInterrupt: true });
    }
  }, [followAgent, posKey, worldWidth, worldHeight]);

  return (
    <PixiViewport app={app} viewportRef={viewportRef} screenWidth={width} screenHeight={height} worldWidth={worldWidth} worldHeight={worldHeight}>
      <Container>{children}</Container>
    </PixiViewport>
  );
}
