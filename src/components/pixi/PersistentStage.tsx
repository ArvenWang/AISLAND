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
  const destroyTimerRef = useRef<number | null>(null);
  const contentRef = useRef<ReactNode>(null);
  contentRef.current = children;

  useEffect(() => {
    // React StrictMode（开发模式）会同步执行 mount -> cleanup -> mount：
    // 若 cleanup 立即销毁 app，第二次 mount 在同一 canvas 上重建 WebGL
    // 上下文会失败（checkMaxIfStatementsInShader 异常）。因此 cleanup 只
    // 安排延迟销毁；双跑重挂载发生在同一宏任务内，会在销毁前取消并复用。
    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const existing = (canvas as HTMLCanvasElement & { __pixiApp?: PIXI.Application }).__pixiApp;
    let app: PIXI.Application;
    if (existing) {
      // StrictMode 双跑：复用已创建的 app，避免同 canvas 重建 WebGL 上下文
      app = existing;
    } else {
      app = new PIXI.Application({
        width,
        height,
        view: canvas,
        backgroundColor,
        antialias: false,
        autoDensity: true,
        resolution: resolution ?? (window.devicePixelRatio || 1),
      });
      (canvas as HTMLCanvasElement & { __pixiApp?: PIXI.Application }).__pixiApp = app;
      app.ticker.start();
    }
    appRef.current = app;
    rootRef.current = rootRef.current ?? createRoot(app.stage);
    rootRef.current.render(<AppContext.Provider value={app}>{contentRef.current}</AppContext.Provider>);
    return () => {
      // 延迟到下一个宏任务再销毁；若组件立即重新挂载（StrictMode 双跑、
      // 视图切换重建），上面的 clearTimeout 会取消销毁并复用实例。
      destroyTimerRef.current = window.setTimeout(() => {
        try {
          rootRef.current?.unmount();
          // 不能传 true：移除 canvas 会破坏 React 管理的 DOM 树
          app.destroy(false, { children: true, texture: true, baseTexture: true });
        } catch (err) {
          console.warn('[pixi] stage teardown warning (ignored):', err);
        }
        if ((canvas as HTMLCanvasElement & { __pixiApp?: PIXI.Application }).__pixiApp === app) {
          delete (canvas as HTMLCanvasElement & { __pixiApp?: PIXI.Application }).__pixiApp;
        }
        appRef.current = null;
        rootRef.current = null;
        destroyTimerRef.current = null;
      }, 0);
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
