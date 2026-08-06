import { SpritesheetData } from './types';

// 苏禾（植物研究员）：island-characters.png 第 3 组（列偏移 8）
const COL = 8;
const frame = (x: number, y: number) => ({
  frame: { x: (COL + x) * 32, y: y * 32, w: 32, h: 32 },
  sourceSize: { w: 32, h: 32 },
  spriteSourceSize: { x: 0, y: 0 },
});

export const data: SpritesheetData = {
  frames: {
    down: frame(0, 0),
    down2: frame(1, 0),
    down3: frame(2, 0),
    down4: frame(3, 0),
    up: frame(0, 1),
    up2: frame(1, 1),
    up3: frame(2, 1),
    up4: frame(3, 1),
    left: frame(0, 2),
    left2: frame(1, 2),
    left3: frame(2, 2),
    left4: frame(3, 2),
    right: frame(0, 3),
    right2: frame(1, 3),
    right3: frame(2, 3),
    right4: frame(3, 3),
  },
  meta: { scale: '1' },
  animations: {
    down: ['down', 'down2', 'down3', 'down4'],
    up: ['up', 'up2', 'up3', 'up4'],
    left: ['left', 'left2', 'left3', 'left4'],
    right: ['right', 'right2', 'right3', 'right4'],
  },
};
