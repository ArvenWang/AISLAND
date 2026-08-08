// Based on AI Town's PixiViewport (MIT), adapted for the island client.
import { PixiComponent } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { MutableRefObject, ReactNode } from 'react';

export type ViewportProps = {
  app: Application;
  viewportRef?: MutableRefObject<Viewport | undefined>;
  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
  children?: ReactNode;
};

export default PixiComponent('Viewport', {
  config: { destroy: false },
  create(props: ViewportProps) {
    const { app, children: _children, viewportRef, ...viewportProps } = props;
    const viewport = new Viewport({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      events: (app.renderer as unknown as { events: unknown }).events as never,
      passiveWheel: false,
      ...viewportProps,
    });
    if (viewportRef) viewportRef.current = viewport;
    viewport
      .drag()
      .pinch({})
      .wheel()
      .decelerate()
      .clamp({ direction: 'all', underflow: 'center' })
      .setZoom(0.8)
      .clampZoom({
        minScale: 0.5,
        maxScale: 2.5,
      });
    return viewport;
  },
  applyProps(viewport: Viewport, oldProps: Record<string, unknown>, newProps: Record<string, unknown>) {
    Object.keys(newProps).forEach((p) => {
      if (p !== 'app' && p !== 'viewportRef' && p !== 'children' && oldProps[p] !== newProps[p]) {
        (viewport as unknown as Record<string, unknown>)[p] = newProps[p];
      }
    });
  },
});
