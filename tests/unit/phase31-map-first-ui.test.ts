import * as fs from 'fs';
import * as path from 'path';

function source(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

describe('Phase 3.1 map-first UI contract', () => {
  const gameView = source('src/components/GameView.tsx');
  const startPage = source('src/components/StartPage.tsx');
  const mapStage = source('src/components/pixi/MapStage.tsx');
  const mapScene = source('src/components/pixi/map/MapScene.tsx');

  test('UI-001: map is the default product surface with closed peek and record drawer', () => {
    expect(gameView).toContain("const [selected, setSelected] = useState<string | null>(null)");
    expect(gameView).toContain('const [timelineOpen, setTimelineOpen] = useState(false)');
    expect(gameView).toContain('min-h-[100dvh]');
    expect(gameView).not.toContain('h-screen');
    expect(gameView).toContain('h-11 shrink-0');
    expect(gameView).toContain("timelineOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'");
  });

  test('UI-002: normal HUD exposes only time, pause, 1x/2x/4x and records', () => {
    expect(gameView).toContain('PRODUCT_SPEEDS.map');
    expect(gameView).toContain('data-testid="btn-pause"');
    expect(gameView).toContain('data-testid="timeline-toggle"');
    expect(gameView).toContain('开发工具');
    const compactCards = gameView.slice(gameView.indexOf('Compact agent cards'), gameView.indexOf('Insight panel'));
    expect(compactCards).not.toContain('Math.round(a.needs');
    expect(compactCards).toContain('bodyOverview(a)');
  });

  test('UI-003: character click toggles Agent Peek and presents goal, motive, body, memory and relationship judgment', () => {
    expect(gameView).toContain('current === a.id ? null : a.id');
    expect(gameView).toContain('此刻想做什么');
    expect(gameView).toContain('私人动机');
    expect(gameView).toContain('身体与行动');
    expect(gameView).toContain('关键记忆');
    expect(gameView).toContain('怎么看待其他人');
  });

  test('UI-004: cognitive views, exact telemetry, evidence export and zoom are debug-only', () => {
    expect(gameView).toContain('debugMode && (');
    expect(gameView).toContain('data-testid="btn-export"');
    expect(gameView).toContain('showDebug={debugMode && showDebug}');
    expect(mapStage).toContain('{showDebug && (');
    expect(mapStage).toContain('data-testid="zoom-level"');
  });

  test('UI-005: camera centers stay inside the authored island at every zoom', () => {
    expect(mapStage).toContain('function boundedWorldCenter');
    expect(mapStage).toContain('worldWidth - halfWidth');
    expect(mapStage).toContain('worldHeight - halfHeight');
    expect(mapStage).toContain('boundedWorldCenter(focus.x * TILE');
    expect(mapStage).toContain('boundedWorldCenter(followedPos.x * TILE');
  });

  test('UI-006: character presentation has no detached shadow, action plate or pickup flash', () => {
    expect(mapScene).not.toContain('drawEllipse(0, 0, 13, 4.5)');
    expect(mapScene).not.toContain('bg.drawRoundedRect(-w / 2');
    expect(mapScene).not.toContain("pickup_item: 'pickup'");
    expect(mapScene).not.toContain("take_unattended_item: 'pickup'");
  });

  test('UI-007: landing copy matches the authoritative seven-day world duration', () => {
    expect(startPage).toContain('荒岛七天');
    expect(startPage).not.toContain('荒岛五天');
  });
});
