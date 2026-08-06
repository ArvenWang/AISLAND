// Fog-of-war overlay: renders the agent's cognitive map (explored/visible)
// as a canvas texture over the world. Visible = clear, explored = dim,
// unknown = opaque black. Server state drives it (P2+).

import * as PIXI from 'pixi.js';
import { Texture } from 'pixi.js';

export class FogOverlay extends PIXI.Container {
  private sprite: PIXI.Sprite | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private texture: Texture | null = null;
  private lastKey = '';

  setFog(cells: { explored: Uint8Array; visible: Uint8Array } | null, mapWidth: number, mapHeight: number, tileSize: number) {
    const scale = 2; // px per cell on the fog texture
    const key = cells ? `${mapWidth}x${mapHeight}` : '';
    if (!cells) {
      if (this.sprite) {
        this.sprite.visible = false;
      }
      return;
    }
    let tex = this.texture;
    if (key !== this.lastKey || !this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = mapWidth * scale;
      this.canvas.height = mapHeight * scale;
      this.texture?.destroy(true);
      tex = Texture.from(this.canvas);
      tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      this.texture = tex;
      if (!this.sprite) {
        this.sprite = new PIXI.Sprite(tex);
        this.addChild(this.sprite);
      } else {
        this.sprite.texture = tex;
      }
      this.sprite.width = mapWidth * tileSize;
      this.sprite.height = mapHeight * tileSize;
      this.lastKey = key;
    }
    if (!tex || !this.sprite) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(this.canvas.width, this.canvas.height);
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const i = y * mapWidth + x;
        const fill = cells.visible[i] ? [0, 0, 0, 0] : cells.explored[i] ? [6, 10, 18, 190] : [2, 4, 10, 255];
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const o = ((y * scale + sy) * this.canvas!.width + x * scale + sx) * 4;
            img.data[o] = fill[0];
            img.data[o + 1] = fill[1];
            img.data[o + 2] = fill[2];
            img.data[o + 3] = fill[3];
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.update();
    this.sprite.visible = true;
  }

  destroy(options?: PIXI.IDestroyOptions | boolean) {
    this.texture?.destroy(true);
    this.texture = null;
    this.canvas = null;
    super.destroy(options);
  }
}
