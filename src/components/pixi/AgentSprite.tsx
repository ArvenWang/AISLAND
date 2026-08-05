import { PixiComponent } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { loadAgentSpritesheet, facingFromDxDy, type Facing } from './sprites';

type Props = {
  sheet: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  moving: boolean;
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
};

export const AgentSprite = PixiComponent<Props, AgentNode>('AgentSprite', {
  config: { destroy: false },
  create(props: Props) {
    const root = new PIXI.Container() as AgentNode;
    root.interactive = true;
    root.cursor = 'pointer';
    root.on('pointertap', () => props.onClick?.());

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
  instance.agent.x = newProps.x;
  instance.agent.y = newProps.y;
  instance.agent.alpha = newProps.dimmed ? 0.4 : 1;
  instance.agent.tint = newProps.thinking ? 0xffd9a0 : 0xffffff;
  const facing: Facing = facingFromDxDy(newProps.dx, newProps.dy);
  if (instance.sheet?.animations[facing]) {
    if (newProps.moving) {
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
