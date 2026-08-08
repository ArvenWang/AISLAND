import * as fs from 'node:fs';
import * as path from 'node:path';
import { speechBubbleDurationMs, speechBubbleOverlapRatio } from '../../src/components/pixi/map/presentation';

describe('Phase 3.1 world presentation', () => {
  test('speech duration follows the readable 3.5-7 second contract', () => {
    expect(speechBubbleDurationMs('短句')).toBe(3500);
    expect(speechBubbleDurationMs('这是一段长度适中的地图内对话，需要给玩家足够的阅读时间。')).toBeGreaterThan(3500);
    expect(speechBubbleDurationMs('很长'.repeat(80))).toBe(7000);
  });

  test('overlap telemetry measures the smaller bubble area', () => {
    expect(speechBubbleOverlapRatio({ x: 0, y: 0, width: 200, height: 80 }, { x: 0, y: 92, width: 200, height: 80 })).toBe(0);
    expect(speechBubbleOverlapRatio({ x: 0, y: 0, width: 200, height: 80 }, { x: 100, y: 0, width: 200, height: 80 })).toBe(0.5);
  });

  test('map renderer owns a bubble layer, queues turns, and exports visual telemetry', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../../src/components/pixi/map/MapScene.tsx'), 'utf8');
    const view = fs.readFileSync(path.join(__dirname, '../../src/components/GameView.tsx'), 'utf8');
    expect(scene).toContain('bubbleLayer');
    expect(scene).toContain('bubbleQueues');
    expect(scene).toContain('speechBubbleDurationMs');
    expect(scene).toContain('__phase31PresentationTelemetry');
    expect(scene).toContain("hasReadableSpeech && ['talk', 'shout'].includes(a.action.type)");
    expect(view).toContain("schema: 'aisland.phase31.game_state_text.v1'");
    expect(view).toContain('bubbles: runtimeWindow.__phase31PresentationTelemetry?.bubbles');
    expect(view).toContain('ui: { logDrawerOpen: timelineOpen, inspectorOpen: selected !== null }');
  });
});
