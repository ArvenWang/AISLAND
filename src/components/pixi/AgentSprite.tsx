import { PixiComponent } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { loadAgentSpritesheet, facingFromDxDy, type Facing } from './sprites';
import type { Vec2 } from '../../../server/engine/types';

const TILE = 32;
// 走格子节奏：每格耗时与格间停顿（与模拟速度解耦，保证视觉上"一格一格走"）
const STEP_MS = 300;
const PAUSE_MS = 100;

type Props = {
  sheet: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  moving: boolean;
  // 移动动画数据：服务端在高速模拟下位置会跳变，
  // 前端根据 path + 起止时间自行插值，保证角色"走到"而不是"瞬移"。
  path?: Vec2[];
  moveStart?: number;
  moveEnd?: number;
  gameTime: number;
  thinking: boolean;
  bubble: string | null;
  name: string;
  selected: boolean;
  dimmed: boolean;
  onClick?: () => void;
};

type AgentNode = PIXI.Container & {
  agent: PIXI.AnimatedSprite;
  sheet?: PIXI.Spritesheet;
  ring: PIXI.Graphics;
  bubble: PIXI.Container;
  bubbleBg: PIXI.Graphics;
  bubbleText: PIXI.Text;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  tickFn: (deltaTime: number) => void;
  initialized: boolean;
  // 走格子状态：waypoints 为像素坐标序列（含起点），wpIndex 指向当前格，
  // wpT 为走向下一格的进度（0..1），wpPause 为格间停顿剩余秒数。
  waypoints: { x: number; y: number }[];
  wpIndex: number;
  wpT: number;
  wpPause: number;
  lastMoveStart: number | undefined;
  dx: number;
  dy: number;
};

// 沿路径按累计像素距离插值，t ∈ [0,1]
function pathPixelAt(path: Vec2[], t: number): { x: number; y: number } | null {
  if (!path || path.length === 0) return null;
  const pts = path.map((p) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 }));
  if (pts.length === 1) return pts[0];
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(d);
    total += d;
  }
  if (total <= 0) return pts[0];
  let target = Math.min(1, Math.max(0, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const f = segs[i] === 0 ? 0 : target / segs[i];
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
    }
    target -= segs[i];
  }
  return pts[pts.length - 1];
}

export const AgentSprite = PixiComponent<Props, AgentNode>('AgentSprite', {
  config: { destroy: false },
  create(props: Props) {
    const root = new PIXI.Container() as AgentNode;
    root.interactive = true;
    root.cursor = 'pointer';
    root.on('pointertap', () => props.onClick?.());

    // 平滑移动：server 每次下发的是离散位置，这里按帧插值，
    // 避免角色"瞬移"到目标点（REL-006）。
    root.currentX = props.x;
    root.currentY = props.y;
    root.targetX = props.x;
    root.targetY = props.y;
    root.initialized = false;
    root.waypoints = [];
    root.wpIndex = 0;
    root.wpT = 0;
    root.wpPause = 0;
    root.lastMoveStart = undefined;
    root.dx = props.dx;
    root.dy = props.dy;
    root.tickFn = (deltaTime: number) => {
      // Pixi deltaTime 以 60fps 为基准，换算为秒
      const dt = deltaTime / 60;
      if (root.waypoints.length > 1 && root.wpIndex < root.waypoints.length - 1) {
        // 逐格步进：先停顿，再沿当前格到下一格匀速移动
        if (root.wpPause > 0) {
          root.wpPause -= dt;
          return;
        }
        root.wpT += (dt * 1000) / STEP_MS;
        if (root.wpT >= 1) {
          root.wpT = 0;
          root.wpIndex += 1;
          if (root.wpIndex < root.waypoints.length - 1) {
            root.wpPause = PAUSE_MS / 1000;
          }
        }
        const a = root.waypoints[root.wpIndex];
        const b = root.waypoints[Math.min(root.wpIndex + 1, root.waypoints.length - 1)];
        root.currentX = a.x + (b.x - a.x) * root.wpT;
        root.currentY = a.y + (b.y - a.y) * root.wpT;
        // 朝向跟随移动方向
        if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
          root.dx = b.x >= a.x ? 1 : -1;
          root.dy = 0;
        } else {
          root.dy = b.y >= a.y ? 1 : -1;
          root.dx = 0;
        }
        root.agent.x = root.currentX;
        root.agent.y = root.currentY;
        if (!root.agent.playing) root.agent.play();
        return;
      }
      // 无移动队列：平滑趋近服务端权威位置（探索/采集等原地动作）
      const dx = root.targetX - root.currentX;
      const dy = root.targetY - root.currentY;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        const step = Math.min(1, 1 - Math.exp(-8 * dt));
        root.currentX += dx * step;
        root.currentY += dy * step;
        root.agent.x = root.currentX;
        root.agent.y = root.currentY;
      }
    };
    PIXI.Ticker.shared.add(root.tickFn);
    root.on('removed', () => {
      PIXI.Ticker.shared.remove(root.tickFn);
    });

    const agent = new PIXI.AnimatedSprite([PIXI.Texture.EMPTY]);
    agent.anchor.set(0.5, 0.85);
    agent.animationSpeed = 0.15;
    root.agent = agent;
    root.addChild(agent);

    const loaded = loadAgentSpritesheet(props.sheet);
    if (loaded) {
      const ss = new PIXI.Spritesheet(loaded.base, loaded.data as PIXI.ISpritesheetData);
      ss.parse().then(() => {
        root.sheet = ss;
        root.agent.textures = ss.animations.down;
        root.agent.gotoAndStop(0);
      });
    }

    const nameLabel = new PIXI.Text(props.name, {
      fontFamily: 'system-ui',
      fontSize: 12,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
      align: 'center',
    });
    nameLabel.anchor.set(0.5, 0);
    nameLabel.y = -26;
    root.addChild(nameLabel);

    const ring = new PIXI.Graphics();
    ring.lineStyle(2, 0xffc53d, 0.9);
    ring.drawCircle(0, -14, 18);
    ring.visible = false;
    root.ring = ring;
    root.addChild(ring);

    const bubble = new PIXI.Container();
    bubble.visible = false;
    const bubbleBg = new PIXI.Graphics();
    const bubbleText = new PIXI.Text('', {
      fontFamily: 'system-ui',
      fontSize: 12,
      fill: 0x1e293b,
      wordWrap: true,
      wordWrapWidth: 180,
    });
    bubble.addChild(bubbleBg, bubbleText);
    bubble.y = -60;
    root.bubble = bubble;
    root.bubbleBg = bubbleBg;
    root.bubbleText = bubbleText;
    root.addChild(bubble);

    return root;
  },

  applyProps(instance: AgentNode, oldProps: Props | Record<string, never>, newProps: Props) {
    applyAgentProps(instance, oldProps, newProps);
  },
});

function applyAgentProps(instance: AgentNode, oldProps: Props | Record<string, never>, newProps: Props) {
  void oldProps;
  // 走格子：新 move 动作开始时，把路径展开为格子队列；
  // 队列推进由 tickFn 驱动，与服务端位置跳变解耦。
  if (
    newProps.moving &&
    newProps.path &&
    newProps.path.length > 1 &&
    newProps.moveStart !== undefined &&
    newProps.moveStart !== instance.lastMoveStart
  ) {
    instance.waypoints = newProps.path.map((p) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 }));
    instance.wpIndex = 0;
    instance.wpT = 0;
    instance.wpPause = 0;
    instance.lastMoveStart = newProps.moveStart;
    instance.currentX = instance.waypoints[0].x;
    instance.currentY = instance.waypoints[0].y;
    instance.agent.x = instance.currentX;
    instance.agent.y = instance.currentY;
  }
  let targetPos: { x: number; y: number } | null = null;
  targetPos = { x: newProps.x, y: newProps.y };
  instance.targetX = targetPos.x;
  instance.targetY = targetPos.y;
  // 首次挂载直接定位（世界加载/切换时角色出现在正确位置，不做飞行动画）
  if (!instance.initialized) {
    instance.currentX = targetPos.x;
    instance.currentY = targetPos.y;
    instance.initialized = true;
  }
  instance.agent.x = instance.currentX;
  instance.agent.y = instance.currentY;
  instance.agent.alpha = newProps.dimmed ? 0.4 : 1;
  instance.agent.tint = newProps.thinking ? 0xffd9a0 : 0xffffff;
  // 移动中朝向跟随走格子方向；静止时用服务端 facing
  const faceDx = instance.waypoints.length > 1 && instance.wpIndex < instance.waypoints.length - 1 ? instance.dx : newProps.dx;
  const faceDy = instance.waypoints.length > 1 && instance.wpIndex < instance.waypoints.length - 1 ? instance.dy : newProps.dy;
  const facing: Facing = facingFromDxDy(faceDx, faceDy);
  if (instance.sheet?.animations[facing]) {
  const isMoving =
    (instance.waypoints.length > 1 && instance.wpIndex < instance.waypoints.length - 1) ||
    newProps.moving;
    if (isMoving) {
      instance.agent.textures = instance.sheet.animations[facing];
      if (!instance.agent.playing) instance.agent.play();
    } else {
      instance.agent.textures = instance.sheet.animations[facing];
      instance.agent.gotoAndStop(0);
    }
  }
  instance.ring.visible = newProps.selected;
  if (newProps.bubble) {
    instance.bubble.visible = true;
    instance.bubbleText.text = newProps.bubble;
    instance.bubbleBg.clear();
    instance.bubbleBg.beginFill(0xffffff, 0.95);
    instance.bubbleBg.lineStyle(1, 0xcbd5e1, 1);
    instance.bubbleBg.drawRoundedRect(-4, -4, instance.bubbleText.width + 8, instance.bubbleText.height + 8, 6);
  } else {
    instance.bubble.visible = false;
  }
}
