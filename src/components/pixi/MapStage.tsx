// MapStage: Phase 3 authored-island view. The server and client both consume
// the compiled island-01 runtime map; the camera starts at the authored beach.

import { useApp, Container } from '@pixi/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Viewport } from 'pixi-viewport';
import { PersistentStage } from './PersistentStage';
import PixiViewport from './PixiViewport';
import { MapScene, type MapSceneHandle } from './map/MapScene';
import type { MapAgentView, MapResourceView, MapWreckView, MapGroundItemView, MapFireView, MapPresentationEvent } from './map/MapScene';
import { loadMapAssets } from './map/MapAssets';
import { worldLightingAt } from './map/worldLighting';

const TILE = 32;

function boundedWorldCenter(x: number, y: number, scale: number, screenWidth: number, screenHeight: number, worldWidth: number, worldHeight: number): { x: number; y: number } {
  const halfWidth = screenWidth / Math.max(0.01, scale) / 2;
  const halfHeight = screenHeight / Math.max(0.01, scale) / 2;
  const minX = Math.min(halfWidth, worldWidth / 2);
  const maxX = Math.max(worldWidth - halfWidth, worldWidth / 2);
  const minY = Math.min(halfHeight, worldHeight / 2);
  const maxY = Math.max(worldHeight - halfHeight, worldHeight / 2);
  return { x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) };
}

export default function MapStage({
  width,
  height,
  agents,
  resources,
  wrecks,
  groundItems,
  fires,
  presentationEvents,
  gameTime,
  view,
  followAgent,
  showDebug,
  onSelectAgent,
  onFocusAgent,
}: {
  width: number;
  height: number;
  agents: Record<string, MapAgentView>;
  resources: MapResourceView[];
  wrecks: MapWreckView[];
  groundItems: MapGroundItemView[];
  fires: MapFireView[];
  presentationEvents: MapPresentationEvent[];
  gameTime: number;
  view: string;
  followAgent: string | null;
  showDebug?: boolean;
  onSelectAgent: (id: string) => void;
  onFocusAgent: (id: string) => void;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [handle, setHandle] = useState<MapSceneHandle | null>(null);
  const [zoomLevel, setZoomLevel] = useState(0.8);
  const [viewportBounds, setViewportBounds] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const lighting = worldLightingAt(gameTime);
  const offscreenSpeech = useMemo(() => presentationEvents.filter((event) => {
    if (!viewportBounds || !event.actorId || !event.text || !['speech', 'shout'].includes(event.kind) || gameTime - event.gameTime > 30) return false;
    const actor = agents[event.actorId];
    return !!actor && (actor.x < viewportBounds.x0 || actor.x > viewportBounds.x1 || actor.y < viewportBounds.y0 || actor.y > viewportBounds.y1);
  }).slice(-3), [agents, gameTime, presentationEvents, viewportBounds]);

  useEffect(() => {
    let alive = true;
    void loadMapAssets().then((a) => {
      if (alive) {
        setDims({ w: a.map.width * TILE, h: a.map.height * TILE });
        setFocus(a.map.startFocus ?? a.map.spawnPoints[1] ?? { x: a.map.width / 2, y: a.map.height / 2 });
      }
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
            focus={focus}
            followAgent={followAgent}
            agents={agents}
            onZoomLevel={setZoomLevel}
            onViewportBounds={setViewportBounds}
          >
            <MapScene onReady={onReady} agents={agents} resources={resources} wrecks={wrecks} groundItems={groundItems} fires={fires} presentationEvents={presentationEvents} gameTime={gameTime} view={view} followAgent={followAgent} zoomLevel={zoomLevel} onSelectAgent={onSelectAgent} />
          </ViewportHost>
        )}
      </PersistentStage>
      <div
        data-testid="world-lighting"
        data-light-phase={lighting.phase}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 transition-[background-color,opacity] duration-1000"
        style={{ backgroundColor: lighting.color, opacity: lighting.opacity, mixBlendMode: 'multiply' }}
      />
      {showDebug && (
        <div data-testid="zoom-level" className="pointer-events-none absolute bottom-2 right-2 z-20 rounded bg-slate-900/70 px-2 py-1 text-[11px] tabular-nums text-slate-300 backdrop-blur">
          缩放 {Math.round(zoomLevel * 100)}%
        </div>
      )}
      {offscreenSpeech.length > 0 && (
        <div className="absolute right-3 top-3 z-20 flex max-w-64 flex-col gap-1" data-testid="offscreen-speech-indicators">
          {offscreenSpeech.map((event) => (
            <button key={event.presentationId} onClick={() => onFocusAgent(event.actorId!)} className="rounded-lg border border-amber-400/40 bg-slate-950/85 px-3 py-2 text-left text-xs text-slate-100 shadow-lg backdrop-blur">
              <span className="font-semibold text-amber-300">{agents[event.actorId!]?.name ?? '远处的人'}</span>
              <span className="ml-1 text-slate-300">{event.kind === 'shout' ? '在远处呼喊' : '在远处说话'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewportHost({
  width,
  height,
  worldWidth,
  worldHeight,
  handle,
  focus,
  followAgent,
  agents,
  onZoomLevel,
  onViewportBounds,
  children,
}: {
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
  handle: MapSceneHandle | null;
  focus: { x: number; y: number } | null;
  followAgent: string | null;
  agents: Record<string, MapAgentView>;
  onZoomLevel: (z: number) => void;
  onViewportBounds: (bounds: { x0: number; y0: number; x1: number; y1: number }) => void;
  children: React.ReactNode;
}) {
  const app = useApp();
  const viewportRef = useRef<Viewport | undefined>(undefined);
  const centered = useRef(false);
  const prevFollow = useRef<string | null>(null);
  const prevBoundsKey = useRef('');

  // Debug handle for automated verification of live sprite positions.
  useEffect(() => {
    (window as unknown as { __mvp2App?: unknown }).__mvp2App = app;
  }, [app]);

  useEffect(() => {
    const v = viewportRef.current;
    if (!v || !handle || !focus) return;
    (window as unknown as { __phase3Viewport?: Viewport }).__phase3Viewport = v;
    if (!centered.current) {
      // Mount the authored beach's nearby chunks before moving the viewport.
      // pixi-viewport clamps against mounted children; moving first can
      // clamp the camera to (0,0) while the map is still being assembled.
      centered.current = true;
      const centerOnAuthoredBeach = () => {
        // The authored map is only 20 chunks (144×112), so the one-time full
        // mount is cheap and gives viewport.clamp a real world rectangle.
        handle.update({ x0: 0, y0: 0, x1: worldWidth / TILE - 1, y1: worldHeight / TILE - 1 });
        // Start at the authored landing beach, not at the geometric center.
        const center = boundedWorldCenter(focus.x * TILE + TILE / 2, focus.y * TILE + TILE / 2, v.scale.x, width, height, worldWidth, worldHeight);
        v.moveCenter(center.x, center.y);
      };
      centerOnAuthoredBeach();
      // Pixi's child bounds/clamp pass can run one frame after the React
      // effect. Repeat after two frames so it cannot restore the origin.
      requestAnimationFrame(() => requestAnimationFrame(centerOnAuthoredBeach));
    }
    const tick = () => {
      onZoomLevel(v.scale.x);
      const tl = v.toWorld(0, 0);
      const br = v.toWorld(width, height);
      const bounds = {
        x0: Math.max(0, Math.floor(tl.x / TILE)),
        y0: Math.max(0, Math.floor(tl.y / TILE)),
        x1: Math.min(worldWidth / TILE - 1, Math.ceil(br.x / TILE)),
        y1: Math.min(worldHeight / TILE - 1, Math.ceil(br.y / TILE)),
      };
      handle.update(bounds);
      const key = `${bounds.x0},${bounds.y0},${bounds.x1},${bounds.y1}`;
      if (key !== prevBoundsKey.current) {
        prevBoundsKey.current = key;
        onViewportBounds(bounds);
      }
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
  }, [handle, width, height, worldWidth, worldHeight, onZoomLevel, onViewportBounds, focus]);

  // Follow camera: animate to the agent at 2x (Animal-Crossing-like framing);
  // when following, recenter on every move; when unfollowing, ease back to
  // the island overview at 0.5x.
  const followedPos = followAgent ? agents[followAgent] : undefined;
  const posKey = followedPos ? `${followedPos.x},${followedPos.y}` : 'none';
  useEffect(() => {
    const v = viewportRef.current;
    if (!v) return;
    if (followAgent && followedPos) {
      const scale = prevFollow.current !== followAgent ? 2 : v.scale.x;
      const center = boundedWorldCenter(followedPos.x * TILE + TILE / 2, followedPos.y * TILE + TILE / 2, scale, width, height, worldWidth, worldHeight);
      if (prevFollow.current !== followAgent) {
        // Just started following: smooth zoom+move into the agent.
        v.animate({ position: center, scale: 2, time: 900, ease: 'easeOutCubic', removeOnInterrupt: true });
      } else {
        // Keep following smoothly instead of snapping between steps.
        v.animate({ position: center, time: 650, ease: 'easeInOutQuad', removeOnInterrupt: true });
      }
      prevFollow.current = followAgent;
    } else if (!followAgent && prevFollow.current) {
      prevFollow.current = null;
      const center = boundedWorldCenter((focus?.x ?? worldWidth / TILE / 2) * TILE + TILE / 2, (focus?.y ?? worldHeight / TILE / 2) * TILE + TILE / 2, 0.8, width, height, worldWidth, worldHeight);
      v.animate({ position: center, scale: 0.8, time: 600, ease: 'easeOutCubic', removeOnInterrupt: true });
    }
  }, [followAgent, posKey, worldWidth, worldHeight, width, height, focus]);

  return (
    <PixiViewport app={app} viewportRef={viewportRef} screenWidth={width} screenHeight={height} worldWidth={worldWidth} worldHeight={worldHeight}>
      <Container>{children}</Container>
    </PixiViewport>
  );
}
