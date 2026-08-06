// Fog-of-war overlay container. P2 (perception) fills this with the server
// cognitive-map texture; for P1 it renders nothing.

import * as PIXI from 'pixi.js';

export class FogOverlay extends PIXI.Container {
  setFog(_cells: Uint8Array | null, _worldWidth: number, _worldHeight: number, _tileSize: number) {
    // Implemented in P2 (service-side fog + knowledge isolation).
  }
}
