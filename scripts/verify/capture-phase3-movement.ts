import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from '@playwright/test';

type TextState = {
  worldId: string;
  gameTime: number;
  agents: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    action: { type: string; phase: string; progress: number } | null;
  }>;
};

const root = path.join(__dirname, '../..');
const output = path.join(root, 'acceptance/phase3/movement-fix/live-browser');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors: Array<{ type: string; text: string }> = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push({ type: 'console.error', text: message.text() });
  });
  page.on('pageerror', (error) => errors.push({ type: 'pageerror', text: String(error) }));

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '开始新游戏' }).click();
  await page.waitForFunction(() => typeof (window as unknown as { render_game_to_text?: unknown }).render_game_to_text === 'function');
  const close = page.getByTestId('close-inspector');
  if (await close.isVisible()) await close.click();
  await page.evaluate(() => {
    const viewport = (window as unknown as {
      __phase3Viewport?: { moveCenter: (x: number, y: number) => void; setZoom: (zoom: number, center?: boolean) => void };
    }).__phase3Viewport;
    viewport?.setZoom(1.5, true);
    viewport?.moveCenter(48 * 32 + 16, 96 * 32 + 16);
  });

  await page.waitForFunction(() => {
    const text = (window as unknown as { render_game_to_text: () => string }).render_game_to_text();
    const state = JSON.parse(text) as TextState;
    return state.agents.some((agent) => agent.action?.type === 'move');
  }, undefined, { timeout: 30_000 });

  const before = JSON.parse(await page.evaluate(() => (window as unknown as { render_game_to_text: () => string }).render_game_to_text())) as TextState;
  const moving = before.agents.find((agent) => agent.action?.type === 'move');
  if (!moving) throw new Error('Movement label appeared without a moving agent in text state');
  fs.writeFileSync(path.join(output, 'before.json'), `${JSON.stringify(before, null, 2)}\n`);
  await page.screenshot({ path: path.join(output, 'before.png'), fullPage: false });

  await page.waitForFunction(({ id, x, y }) => {
    const text = (window as unknown as { render_game_to_text: () => string }).render_game_to_text();
    const state = JSON.parse(text) as TextState;
    const agent = state.agents.find((entry) => entry.id === id);
    return !!agent && (agent.x !== x || agent.y !== y);
  }, { id: moving.id, x: moving.x, y: moving.y }, { timeout: 10_000 });
  await page.waitForTimeout(180);

  const after = JSON.parse(await page.evaluate(() => (window as unknown as { render_game_to_text: () => string }).render_game_to_text())) as TextState;
  const moved = after.agents.find((agent) => agent.id === moving.id);
  if (!moved || (moved.x === moving.x && moved.y === moving.y)) throw new Error(`${moving.id} did not move`);
  fs.writeFileSync(path.join(output, 'after.json'), `${JSON.stringify(after, null, 2)}\n`);
  await page.screenshot({ path: path.join(output, 'after.png'), fullPage: false });

  await page.evaluate(async (worldId) => {
    await fetch(`/api/mvp2/worlds/${worldId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
  }, after.worldId);
  const result = {
    passed: errors.length === 0,
    agentId: moving.id,
    from: { x: moving.x, y: moving.y, gameTime: before.gameTime },
    to: { x: moved.x, y: moved.y, gameTime: after.gameTime },
    browserErrors: errors,
  };
  fs.writeFileSync(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(output, 'errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
  await browser.close();
  if (errors.length) throw new Error(`Movement capture found ${errors.length} browser errors`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
