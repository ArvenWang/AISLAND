import { createRoot, AppContext } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { ReactNode, useEffect, useLayoutEffect, useRef } from 'react';

// Own Stage implementation: avoids @pixi/react's Stage teardown bug where
// app.destroy() throws during unmount (removeEventListener on null).
// The app is destroyed with a guard so the page never gets an uncaught error.
export function PersistentStage({
  children,
  width,
  height,
  backgroundColor,
  resolution,
}: {
  children: ReactNode;
  width: number;
  height: number;
  backgroundColor: number;
  resolution?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const rootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  const contentRef = useRef<ReactNode>(null);
  contentRef.current = children;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const app = new PIXI.Application({
      width,
      height,
      view: canvas,
      backgroundColor,
      antialias: false,
      autoDensity: true,
      resolution: resolution ?? (window.devicePixelRatio || 1),
    });
    app.ticker.start();
    appRef.current = app;
    rootRef.current = createRoot(app.stage);
    rootRef.current.render(<AppContext.Provider value={app}>{contentRef.current}</AppContext.Provider>);
    return () => {
      try {
        rootRef.current?.unmount();
        app.destroy(true, { children: true, texture: true, baseTexture: true });
      } catch (err) {
        console.warn('[pixi] stage teardown warning (ignored):', err);
      }
      appRef.current = null;
      rootRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const app = appRef.current;
    const root = rootRef.current;
    if (!app || !root) return;
    if (app.renderer.width !== width || app.renderer.height !== height) {
      app.renderer.resize(width, height);
    }
    root.render(<AppContext.Provider value={app}>{contentRef.current}</AppContext.Provider>);
  });

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
