import * as PIXI from 'pixi.js';
import { data as f1 } from '../../../data/spritesheets/f1';
import { data as f3 } from '../../../data/spritesheets/f3';
import { data as f4 } from '../../../data/spritesheets/f4';
import { data as islandA } from '../../../data/spritesheets/island-a';
import { data as islandB } from '../../../data/spritesheets/island-b';
import { data as islandC } from '../../../data/spritesheets/island-c';

const SHEETS: Record<string, unknown> = { f1, f3, f4, island_a: islandA, island_b: islandB, island_c: islandC };

// 每个角色 sheet 对应的纹理图（spritesheet 帧坐标必须与纹理布局一致；
// 此前写死旧纹理导致新角色从 32x32folk.png 切帧，出现"串角色"花屏）
const TEXTURE_BY_SHEET: Record<string, string> = {
  f1: '/assets/32x32folk.png',
  f3: '/assets/32x32folk.png',
  f4: '/assets/32x32folk.png',
  island_a: '/assets/island-characters.png',
  island_b: '/assets/island-characters.png',
  island_c: '/assets/island-characters.png',
};

export function characterTextureUrl(sheet: string): string {
  return TEXTURE_BY_SHEET[sheet] ?? '/assets/32x32folk.png';
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
