import * as PIXI from 'pixi.js';
import { data as f1 } from '../../../data/spritesheets/f1';
import { data as f3 } from '../../../data/spritesheets/f3';
import { data as f4 } from '../../../data/spritesheets/f4';

const SHEETS: Record<string, unknown> = { f1, f3, f4 };

export function characterTextureUrl(_sheet: string): string {
  return '/assets/32x32folk.png';
}

export function loadAgentSpritesheet(sheet: string): { base: PIXI.BaseTexture; data: unknown } | null {
  const data = SHEETS[sheet];
  if (!data) return null;
  const base = PIXI.BaseTexture.from(characterTextureUrl(sheet), { scaleMode: PIXI.SCALE_MODES.NEAREST });
  return { base, data };
}

export type Facing = 'down' | 'up' | 'left' | 'right';

export function facingFromDxDy(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
